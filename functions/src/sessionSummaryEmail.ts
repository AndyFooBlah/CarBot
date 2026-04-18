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
 * Session summary email Cloud Function.
 *
 * After a session completes, generates a human-readable summary using
 * Gemini and emails it to the user via the CarBot Gmail account.
 *
 * Setup required:
 *   1. Create a Gmail account for CarBot
 *   2. Enable Gmail API on the Firebase project's Google Cloud console
 *   3. Create OAuth2 credentials and obtain a refresh token
 *   4. Store the following as Firebase Secret Manager secrets:
 *        GMAIL_CLIENT_ID
 *        GMAIL_CLIENT_SECRET
 *        GMAIL_REFRESH_TOKEN
 *        CARBOT_EMAIL_ADDRESS (the CarBot Gmail address)
 *
 * The session summary email is sent with:
 *   From: CarBot Gmail address
 *   To:   User's registered Firebase Auth email
 *   Subject: CarBot recap: [date] — [one-line summary]
 *   Body: Plain-text summary + link to transcript
 */

import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import { defineSecret } from 'firebase-functions/params';
import { geminiApiKey } from './memoryExtraction';
import type { SessionDocument, UserDocument, TranscriptEntry } from './types';

export const gmailClientId = defineSecret('GMAIL_CLIENT_ID');
export const gmailClientSecret = defineSecret('GMAIL_CLIENT_SECRET');
export const gmailRefreshToken = defineSecret('GMAIL_REFRESH_TOKEN');
export const carbotEmailAddress = defineSecret('CARBOT_EMAIL_ADDRESS');
export const carbotWebUrl = defineSecret('CARBOT_WEB_URL');

const SUMMARY_PROMPT = `Write a friendly, warm session recap email for a parent whose child just had a conversation with their AI car companion (CarBot) during a car ride.

Write 3-4 short paragraphs:
1. Brief overview (when, how long, what kind of trip)
2. Memorable moments or funny things that were said
3. Main topics discussed
4. Any specific dates, events, or plans mentioned (skip this paragraph if none)

Tone: warm, like a note from a friend. Plain text, no bullet points or markdown.
Keep it under 300 words.

Session date: DATE_PLACEHOLDER
Duration: DURATION_PLACEHOLDER
Trip type: TRIP_PLACEHOLDER

Transcript:
`;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} minutes ${s > 0 ? `and ${s} seconds` : ''}` : `${s} seconds`;
}

/** Create a base64url-encoded RFC 2822 email message. */
function makeEmailMessage(
  to: string,
  from: string,
  subject: string,
  body: string,
): string {
  const msg = [
    `To: ${to}`,
    `From: CarBot <${from}>`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');

  return Buffer.from(msg).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Create an authenticated Gmail API client using stored OAuth2 credentials. */
function createGmailClient() {
  const oauth2Client = new google.auth.OAuth2(
    gmailClientId.value(),
    gmailClientSecret.value(),
  );
  oauth2Client.setCredentials({ refresh_token: gmailRefreshToken.value() });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Generate a session summary and send it to the user's email.
 */
export async function sendSessionSummaryEmail(sessionId: string): Promise<void> {
  const db = getFirestore();

  // Fetch session and user
  const sessionSnap = await db.collection('sessions').doc(sessionId).get();
  if (!sessionSnap.exists) return;
  const session = sessionSnap.data() as SessionDocument;

  const userSnap = await db.collection('users').doc(session.userId).get();
  if (!userSnap.exists) return;
  const user = userSnap.data() as UserDocument;

  // Respect the user's email preference
  if (user.emailSummariesEnabled === false) {
    console.log('[sessionSummaryEmail] Email summaries disabled for user:', session.userId);
    return;
  }

  // Get transcript (prefer clean, fall back to raw)
  let entries: TranscriptEntry[] = [];
  const cleanSnap = await db
    .collection('sessions').doc(sessionId)
    .collection('transcript').doc('clean')
    .get();

  if (cleanSnap.exists) {
    entries = (cleanSnap.data()?.entries ?? []) as TranscriptEntry[];
  } else {
    const rawSnap = await db
      .collection('sessions').doc(sessionId)
      .collection('transcript').doc('entries')
      .get();
    if (rawSnap.exists) {
      entries = (rawSnap.data()?.entries ?? []) as TranscriptEntry[];
    }
  }

  const transcriptText = entries
    .filter((e) => e.role !== 'tool')
    .map((e) => (e.role === 'user' ? 'Human' : 'CarBot') + ': ' + e.text)
    .join('\n');

  // Format session metadata
  const sessionDate = session.startTime.toDate().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const duration = formatDuration(session.durationSeconds);
  const tripType = session.tripContext?.replace(/_/g, ' ') ?? 'car ride';

  // Call Gemini to generate summary
  const apiKey = geminiApiKey.value();
  let summaryBody = `Your CarBot session on ${sessionDate} lasted ${duration}.`;

  if (transcriptText.length > 50) {
    const prompt = SUMMARY_PROMPT
      .replace('DATE_PLACEHOLDER', sessionDate)
      .replace('DURATION_PLACEHOLDER', duration)
      .replace('TRIP_PLACEHOLDER', tripType)
      + transcriptText;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 1024 },
        }),
      },
    );

    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      const generated: string = (data as any).candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (generated.trim()) summaryBody = generated.trim();
    } else {
      console.warn('[sessionSummaryEmail] Gemini summary failed, using fallback');
    }
  }

  // Build email
  const webUrl = carbotWebUrl.value() || 'https://your-carbot-app.web.app';
  const transcriptLink = `${webUrl}/sessions/${sessionId}`;
  const summary = session.summary ?? tripType;

  const emailBody = `${summaryBody}

---
View full transcript and audio: ${transcriptLink}

---
You're receiving this because session summaries are enabled in CarBot settings.
`;

  const subject = `CarBot recap: ${session.startTime.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${summary.slice(0, 60)}`;

  // Send via Gmail
  try {
    const gmail = createGmailClient();
    const raw = makeEmailMessage(user.email, carbotEmailAddress.value(), subject, emailBody);
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    console.log(`[sessionSummaryEmail] Sent summary to ${user.email} for session ${sessionId}`);
  } catch (err) {
    // Email failure is non-fatal — log and continue
    console.error('[sessionSummaryEmail] Failed to send email:', err);
  }
}
