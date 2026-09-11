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
 * Clean transcript generation Cloud Function.
 *
 * After a session completes, reads the raw transcript (`transcript/entries`)
 * and calls Gemini to produce a corrected, punctuated, speaker-labeled version.
 * Writes the result to `sessions/{sessionId}/transcript/clean`.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { geminiApiKey } from './memoryExtraction';
import { FLASH_LITE_MODEL } from './models';
import type { TranscriptEntry, SessionDocument, UserDocument } from './types';

const CLEAN_TRANSCRIPT_PROMPT = `You are cleaning up a raw voice transcription from a car conversation between a parent, their child, and an AI assistant named CarBot.

Your task:
1. Fix obvious transcription errors (mishear, wrong homophones, etc.)
2. Add proper punctuation and capitalization
3. Break run-on sentences into natural conversational units
4. Add speaker labels: [CHILD_NAME], [Parent], [CarBot]
5. Remove filler words (um, uh, like) only when they don't add meaning
6. Do NOT change the meaning, add content, or paraphrase

Return a JSON array of transcript entries in this EXACT format (no other text, no markdown):
[
  {"role": "user", "text": "cleaned text", "messageIndex": 0},
  {"role": "bot", "text": "CarBot's response", "messageIndex": 1}
]

Role must be: "user" (for the human speakers) or "bot" (for CarBot).
Preserve the original order. Do not merge or split turns.

Child's name (use in labels): CHILD_PLACEHOLDER

Raw transcript:
`;

/**
 * Generate and store a clean version of a session transcript.
 */
export async function generateCleanTranscript(
  sessionId: string,
  childName?: string,
): Promise<void> {
  const db = getFirestore();

  // Get raw transcript
  const rawSnap = await db
    .collection('sessions').doc(sessionId)
    .collection('transcript').doc('entries')
    .get();

  if (!rawSnap.exists) {
    console.log('[cleanTranscript] No raw transcript for session:', sessionId);
    return;
  }

  const entries = (rawSnap.data()?.entries ?? []) as TranscriptEntry[];
  if (entries.length < 2) {
    console.log('[cleanTranscript] Transcript too short to clean');
    return;
  }

  // Get child's name from session → user profile if not provided
  let resolvedChildName = childName ?? 'Child';
  if (!childName) {
    const sessionSnap = await db.collection('sessions').doc(sessionId).get();
    if (sessionSnap.exists) {
      const session = sessionSnap.data() as SessionDocument;
      const userSnap = await db.collection('users').doc(session.userId).get();
      if (userSnap.exists) {
        resolvedChildName = (userSnap.data() as UserDocument).childName ?? 'Child';
      }
    }
  }

  // Build prompt with child's name substituted
  const rawTranscriptText = entries
    .filter((e) => e.role !== 'tool')
    .map((e, i) => `{"role":"${e.role}","text":"${e.text.replace(/"/g, '\\"')}","messageIndex":${i}}`)
    .join('\n');

  // M3: cap transcript at 100k chars. Past that the prompt is pathological
  // and Gemini's output cap (8192 tokens) can't round-trip it anyway.
  const TRANSCRIPT_MAX = 100_000;
  const transcriptText = rawTranscriptText.length > TRANSCRIPT_MAX
    ? rawTranscriptText.slice(-TRANSCRIPT_MAX)
    : rawTranscriptText;
  if (rawTranscriptText.length > TRANSCRIPT_MAX) {
    console.warn(
      `[cleanTranscript] Transcript ${rawTranscriptText.length} chars exceeded ${TRANSCRIPT_MAX} cap; using last ${TRANSCRIPT_MAX} chars`,
    );
  }

  const prompt = CLEAN_TRANSCRIPT_PROMPT.replace('CHILD_PLACEHOLDER', resolvedChildName) + transcriptText;

  // Call Gemini
  const apiKey = geminiApiKey.value();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${FLASH_LITE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
    },
  );

  if (!res.ok) {
    console.error('[cleanTranscript] Gemini error:', res.status, await res.text());
    return;
  }

  const data = await res.json() as Record<string, unknown>;
  const rawText: string = (data as any).candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  let cleanedEntries: TranscriptEntry[];
  try {
    const stripped = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    cleanedEntries = JSON.parse(stripped) as TranscriptEntry[];
  } catch {
    console.error('[cleanTranscript] Failed to parse Gemini response:', rawText.slice(0, 300));
    return;
  }

  // Write clean transcript document
  await db
    .collection('sessions').doc(sessionId)
    .collection('transcript').doc('clean')
    .set({
      entries: cleanedEntries,
      generatedAt: Timestamp.now(),
      model: FLASH_LITE_MODEL,
      version: 1,
    });

  console.log(`[cleanTranscript] Generated clean transcript for session ${sessionId} (${cleanedEntries.length} entries)`);
}
