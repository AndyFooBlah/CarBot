// Copyright 2026 Andrew Brook
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Memory extraction Cloud Function.
 *
 * Called from onSessionCompleted after a session ends. Reads the active
 * transcript (most recent transcriptEdit if any, otherwise original entries),
 * calls Gemini to extract structured memory facts, and writes them to:
 *   - sessions/{sessionId}/memories/facts   (session-level source of truth)
 *   - memories/{memoryId}                   (cross-session searchable index)
 *
 * Also generates a one-line session summary written to sessions/{sessionId}.summary.
 *
 * Firestore path notes:
 *   - Raw transcript:  sessions/{id}/transcript/entries  (VoiceCommon default)
 *   - Clean transcript: sessions/{id}/transcript/clean
 *   - Edit history:    sessions/{id}/transcriptEdits/{editId}  (flat sub-collection)
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import type { MemoryFact, TranscriptEntry, SessionDocument } from './types';

export const geminiApiKey = defineSecret('GEMINI_API_KEY');

const MEMORY_EXTRACTION_PROMPT = `You are analyzing a voice conversation transcript between a parent, their child, and an AI car companion named CarBot.

Extract structured memory facts from this conversation that would be useful to remember for future conversations.
Focus on:
- Interests and hobbies mentioned (the child's or parent's)
- Upcoming events, field trips, or dates mentioned
- Plans the family made
- Personal facts and preferences expressed
- Relationships mentioned (friends, teachers, relatives)
- Anything notably funny, memorable, or important

Return a JSON object with this EXACT structure (no other text, no markdown):
{
  "facts": [
    {
      "id": "fact-1",
      "content": "Brief, specific statement of the fact in third person",
      "category": "interest",
      "importance": 2,
      "tags": ["relevant-tag"]
    }
  ],
  "summary": "One sentence summary of what was talked about in this session"
}

Category must be one of: interest, event, plan, fact, preference, relationship, other
Importance: 1=minor detail, 2=notable, 3=very important
Extract at most 15 facts. Only extract genuinely memorable information, not generic chitchat.
Keep each fact under 100 characters.

Transcript:
`;

/** Build a plain-text transcript from entries, filtering out tool calls. */
function transcriptToText(entries: TranscriptEntry[]): string {
  return entries
    .filter((e) => e.role !== 'tool')
    .map((e) => (e.role === 'user' ? 'Human' : 'CarBot') + ': ' + e.text)
    .join('\n');
}

/** Parse Gemini's JSON response, with graceful fallback. */
function parseResponse(text: string): { facts: MemoryFact[]; summary: string } {
  try {
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(clean);
    return {
      facts: (parsed.facts ?? []) as MemoryFact[],
      summary: (typeof parsed.summary === 'string' ? parsed.summary : '') as string,
    };
  } catch {
    console.error('[memoryExtraction] Failed to parse JSON:', text.slice(0, 300));
    return { facts: [], summary: '' };
  }
}

/**
 * Get the active transcript for a session.
 * Prefers the most recent edit in `transcriptEdits` collection;
 * falls back to `transcript/entries` (VoiceCommon default).
 */
async function getActiveTranscript(sessionId: string): Promise<TranscriptEntry[]> {
  const db = getFirestore();

  // Check for user edits first (newest first)
  const editsSnap = await db
    .collection('sessions').doc(sessionId)
    .collection('transcriptEdits')
    .where('type', '==', 'entries')
    .orderBy('editedAt', 'desc')
    .limit(1)
    .get();

  if (!editsSnap.empty) {
    return (editsSnap.docs[0].data().entries ?? []) as TranscriptEntry[];
  }

  // Fall back to VoiceCommon raw transcript
  const rawSnap = await db
    .collection('sessions').doc(sessionId)
    .collection('transcript').doc('entries')
    .get();

  return rawSnap.exists ? ((rawSnap.data()?.entries ?? []) as TranscriptEntry[]) : [];
}

/**
 * Extract memories and summary from a completed session.
 */
export async function extractMemoriesFromSession(sessionId: string): Promise<void> {
  const db = getFirestore();

  const sessionSnap = await db.collection('sessions').doc(sessionId).get();
  if (!sessionSnap.exists) {
    console.warn('[memoryExtraction] Session not found:', sessionId);
    return;
  }
  const session = sessionSnap.data() as SessionDocument;

  const entries = await getActiveTranscript(sessionId);
  if (entries.length === 0) {
    console.log('[memoryExtraction] No transcript entries for session:', sessionId);
    return;
  }

  const rawTranscriptText = transcriptToText(entries);
  if (rawTranscriptText.length < 50) {
    console.log('[memoryExtraction] Transcript too short for extraction');
    return;
  }

  // M3: cap transcript at 100k chars before prompting. A normal hour-long
  // session runs ~20-30k; past 100k the prompt is pathological (either a
  // runaway session or a crafted payload) and keeping the last N chars
  // preserves the most recent context rather than truncating it away.
  const TRANSCRIPT_MAX = 100_000;
  const transcriptText = rawTranscriptText.length > TRANSCRIPT_MAX
    ? rawTranscriptText.slice(-TRANSCRIPT_MAX)
    : rawTranscriptText;
  if (rawTranscriptText.length > TRANSCRIPT_MAX) {
    console.warn(
      `[memoryExtraction] Transcript ${rawTranscriptText.length} chars exceeded ${TRANSCRIPT_MAX} cap; using last ${TRANSCRIPT_MAX} chars`,
    );
  }

  // Call Gemini
  const apiKey = geminiApiKey.value();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: MEMORY_EXTRACTION_PROMPT + transcriptText }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      }),
    },
  );

  if (!res.ok) {
    console.error('[memoryExtraction] Gemini error:', res.status, await res.text());
    return;
  }

  const data = await res.json() as Record<string, unknown>;
  const rawText: string = (data as any).candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const { facts, summary } = parseResponse(rawText);

  const now = Timestamp.now();
  const batch = db.batch();

  // Session-level memories (source of truth)
  batch.set(
    db.collection('sessions').doc(sessionId).collection('memories').doc('facts'),
    { facts, extractedAt: now, model: 'gemini-3-flash-preview' },
  );

  // Fan out to cross-session index
  for (const fact of facts) {
    const memRef = db.collection('memories').doc();
    batch.set(memRef, {
      userId: session.userId,
      sessionId,
      sessionDate: session.startTime,
      content: fact.content,
      category: fact.category,
      importance: fact.importance,
      tags: fact.tags,
      createdAt: now,
      edited: false,
    });
  }

  // Session summary
  if (summary) {
    batch.update(db.collection('sessions').doc(sessionId), { summary });
  }

  await batch.commit();
  console.log(`[memoryExtraction] Extracted ${facts.length} facts for session ${sessionId}`);
}
