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
 * dataCleanup — scheduled and on-demand data repair tasks.
 *
 * Scheduled (daily at 3 AM Pacific):
 *   cleanMissedTranscripts  — finds completed sessions without a clean
 *                             transcript and generates them
 *   cleanStaleActiveSessions — marks sessions stuck in 'active' for > 6 hours
 *                             as 'interrupted' so they don't pollute counts
 *
 * Callable (authenticated, per-session):
 *   cleanTranscriptForSession — manually regenerate a clean transcript for a
 *                               single session; called from the UI
 */

import { onCall, CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { geminiApiKey } from './memoryExtraction';
import { generateCleanTranscript } from './cleanTranscript';
import { extractMemoriesFromSession } from './memoryExtraction';
import {
  sendSessionSummaryEmail,
  gmailClientId,
  gmailClientSecret,
  gmailRefreshToken,
  carbotEmailAddress,
  carbotWebUrl,
} from './sessionSummaryEmail';

// ---------------------------------------------------------------------------
// Scheduled: clean transcripts missed by onSessionCompleted
// ---------------------------------------------------------------------------

export const dailyDataCleanup = onSchedule(
  {
    schedule: '0 11 * * *', // 3 AM Pacific (UTC-8) = 11 AM UTC
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [geminiApiKey],
  },
  async () => {
    console.log('[dailyDataCleanup] Starting');
    const db = getFirestore();

    const results = await Promise.allSettled([
      repairMissedTranscripts(db),
      repairMissedMemories(db),
      cleanStaleActiveSessions(db),
    ]);

    for (const [i, result] of results.entries()) {
      const names = ['repairMissedTranscripts', 'repairMissedMemories', 'cleanStaleActiveSessions'];
      if (result.status === 'rejected') {
        console.error(`[dailyDataCleanup] ${names[i]} failed:`, result.reason);
      }
    }

    console.log('[dailyDataCleanup] Done');
  },
);

// ---------------------------------------------------------------------------
// Callable: manually regenerate a clean transcript for one session
// ---------------------------------------------------------------------------

export const cleanTranscriptForSession = onCall(
  {
    secrets: [geminiApiKey],
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async (request: CallableRequest) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

    const { sessionId } = request.data as { sessionId: string };
    if (!sessionId || typeof sessionId !== 'string') {
      throw new HttpsError('invalid-argument', 'sessionId is required.');
    }

    // Verify the session belongs to the calling user
    const db = getFirestore();
    const sessionSnap = await db.collection('sessions').doc(sessionId).get();
    if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found.');
    if (sessionSnap.data()?.userId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Session does not belong to you.');
    }

    console.log(`[cleanTranscriptForSession] Regenerating for session ${sessionId}`);
    await generateCleanTranscript(sessionId);
    return { success: true };
  },
);

/**
 * Manually re-run memory extraction + summary generation for one session.
 * Used by the diagnostics page when the automatic post-session trigger was
 * missed or produced a poor result.
 */
export const extractMemoriesForSession = onCall(
  {
    secrets: [geminiApiKey],
    region: 'us-central1',
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (request: CallableRequest) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

    const { sessionId } = request.data as { sessionId: string };
    if (!sessionId || typeof sessionId !== 'string') {
      throw new HttpsError('invalid-argument', 'sessionId is required.');
    }

    const db = getFirestore();
    const sessionSnap = await db.collection('sessions').doc(sessionId).get();
    if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found.');
    if (sessionSnap.data()?.userId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Session does not belong to you.');
    }

    console.log(`[extractMemoriesForSession] Re-running for session ${sessionId}`);
    await extractMemoriesFromSession(sessionId);
    return { success: true };
  },
);

/**
 * Manually re-send the session summary email for one session. Used by the
 * diagnostics page to retry a failed email delivery.
 */
export const sendSummaryEmailForSession = onCall(
  {
    secrets: [
      geminiApiKey,
      gmailClientId,
      gmailClientSecret,
      gmailRefreshToken,
      carbotEmailAddress,
      carbotWebUrl,
    ],
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async (request: CallableRequest) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

    const { sessionId } = request.data as { sessionId: string };
    if (!sessionId || typeof sessionId !== 'string') {
      throw new HttpsError('invalid-argument', 'sessionId is required.');
    }

    const db = getFirestore();
    const sessionSnap = await db.collection('sessions').doc(sessionId).get();
    if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found.');
    if (sessionSnap.data()?.userId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Session does not belong to you.');
    }

    console.log(`[sendSummaryEmailForSession] Sending for session ${sessionId}`);
    await sendSessionSummaryEmail(sessionId);
    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find completed sessions (up to 7 days old) that have a raw transcript but
 * no clean transcript doc, and generate the clean version.
 */
async function repairMissedTranscripts(db: ReturnType<typeof getFirestore>): Promise<void> {
  const cutoff = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const sessionsSnap = await db
    .collection('sessions')
    .where('status', '==', 'completed')
    .where('startTime', '>=', cutoff)
    .get();

  if (sessionsSnap.empty) {
    console.log('[repairMissedTranscripts] No completed sessions in window');
    return;
  }

  let repaired = 0;
  let skipped = 0;

  for (const sessionDoc of sessionsSnap.docs) {
    const cleanSnap = await sessionDoc.ref.collection('transcript').doc('clean').get();
    if (cleanSnap.exists) { skipped++; continue; }

    const rawSnap = await sessionDoc.ref.collection('transcript').doc('entries').get();
    if (!rawSnap.exists) { skipped++; continue; }

    try {
      await generateCleanTranscript(sessionDoc.id);
      repaired++;
    } catch (err) {
      console.error(`[repairMissedTranscripts] Failed for ${sessionDoc.id}:`, err);
    }
  }

  console.log(`[repairMissedTranscripts] Repaired ${repaired}, skipped ${skipped}`);
}

/**
 * Find completed sessions (up to 7 days old) that have no extracted memories,
 * and run memory extraction for them.
 */
async function repairMissedMemories(db: ReturnType<typeof getFirestore>): Promise<void> {
  const cutoff = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const sessionsSnap = await db
    .collection('sessions')
    .where('status', '==', 'completed')
    .where('startTime', '>=', cutoff)
    .get();

  let repaired = 0;
  let skipped = 0;

  for (const sessionDoc of sessionsSnap.docs) {
    // Check for the session-level memories doc written by memoryExtraction
    const memoriesSnap = await sessionDoc.ref.collection('memories').doc('facts').get();
    if (memoriesSnap.exists) { skipped++; continue; }

    try {
      await extractMemoriesFromSession(sessionDoc.id);
      repaired++;
    } catch (err) {
      console.error(`[repairMissedMemories] Failed for ${sessionDoc.id}:`, err);
    }
  }

  console.log(`[repairMissedMemories] Repaired ${repaired}, skipped ${skipped}`);
}

/**
 * Find sessions stuck in 'active' for more than 6 hours and mark them
 * 'interrupted'. These arise when the app crashes before stopSession fires.
 */
async function cleanStaleActiveSessions(db: ReturnType<typeof getFirestore>): Promise<void> {
  const staleThreshold = Timestamp.fromMillis(Date.now() - 6 * 60 * 60 * 1000);
  const staleSnap = await db
    .collection('sessions')
    .where('status', '==', 'active')
    .where('startTime', '<=', staleThreshold)
    .get();

  if (staleSnap.empty) {
    console.log('[cleanStaleActiveSessions] No stale sessions');
    return;
  }

  const updates = staleSnap.docs.map((d) =>
    d.ref.update({ status: 'interrupted', endTime: Timestamp.now() }),
  );
  await Promise.all(updates);
  console.log(`[cleanStaleActiveSessions] Marked ${staleSnap.size} stale sessions as interrupted`);
}
