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
 *   enforceAudioRetention   — deletes session audio older than each parent's
 *                             audioRetentionDays setting (dataLifecycle.ts, #34)
 *
 * Callable (authenticated, per-session):
 *   cleanTranscriptForSession — manually regenerate a clean transcript for a
 *                               single session; called from the UI
 */

import { onCall, CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
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
import { enforceAudioRetention } from './dataLifecycle';
import { emailDisabledMessage, emailFeaturesEnabled } from './emailFlag';

// ---------------------------------------------------------------------------
// Scheduled: clean transcripts missed by onSessionCompleted
// ---------------------------------------------------------------------------

/**
 * The nightly tasks, in the order dailyDataCleanup runs them. The three
 * session tasks query `sessions` across all users by `status` + `startTime`,
 * which needs the composite index `sessions (status ASC, startTime ASC)` in
 * firestore.indexes.json (#73).
 */
const DAILY_CLEANUP_TASKS = [
  'repairMissedTranscripts',
  'repairMissedMemories',
  'cleanStaleActiveSessions',
  'cleanWikipediaCache',
  'enforceAudioRetention',
] as const;

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

    // Order matters: results[i] is reported under DAILY_CLEANUP_TASKS[i].
    const results = await Promise.allSettled([
      repairMissedTranscripts(db),
      repairMissedMemories(db),
      cleanStaleActiveSessions(db),
      cleanWikipediaCache(db),
      enforceAudioRetention(db),
    ]);

    const failed: string[] = [];
    for (const [i, result] of results.entries()) {
      const task = DAILY_CLEANUP_TASKS[i];
      if (result.status === 'rejected') {
        failed.push(task);
        // logger.error, not console.error: a multi-line console payload
        // reaches Cloud Logging with no severity, which hid three failing
        // tasks from every `severity>=ERROR` query for a month (#73).
        const reason: unknown = result.reason;
        logger.error(`[dailyDataCleanup] ${task} failed`, {
          task,
          error: reason instanceof Error ? reason.message : String(reason),
          stack: reason instanceof Error ? reason.stack : undefined,
        });
      } else {
        logger.info(`[dailyDataCleanup] ${task} succeeded`, { task });
      }
    }

    const summary = {
      succeeded: results.length - failed.length,
      failed: failed.length,
      failedTasks: failed,
    };
    if (failed.length > 0) {
      logger.error(`[dailyDataCleanup] Done: ${failed.length} of ${results.length} tasks failed`, summary);
    } else {
      logger.info(`[dailyDataCleanup] Done: all ${results.length} tasks succeeded`, summary);
    }
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
 *
 * While email features are off (EMAIL_FEATURES_ENABLED, issue #36) it sends
 * nothing and returns `{ success: false, disabled: true }`; the diagnostics
 * page hides its button in that state.
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

    if (!emailFeaturesEnabled()) {
      console.log(emailDisabledMessage('manual summary email re-send'));
      return { success: false, disabled: true };
    }

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
      logger.error(`[repairMissedTranscripts] Failed for ${sessionDoc.id}`, {
        sessionId: sessionDoc.id,
        error: err instanceof Error ? err.message : String(err),
      });
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
      logger.error(`[repairMissedMemories] Failed for ${sessionDoc.id}`, {
        sessionId: sessionDoc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`[repairMissedMemories] Repaired ${repaired}, skipped ${skipped}`);
}

/**
 * M6: Delete `wikipedia_cache/{articleId}` docs older than 30 days,
 * including their `chunks` subcollection. The cache is a global resource
 * shared by all users, so it would otherwise grow without bound.
 */
async function cleanWikipediaCache(db: ReturnType<typeof getFirestore>): Promise<void> {
  const cutoff = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const snap = await db
    .collection('wikipedia_cache')
    .where('fetchedAt', '<', cutoff)
    .limit(200)
    .get();

  if (snap.empty) {
    console.log('[cleanWikipediaCache] Nothing to clean');
    return;
  }

  let deleted = 0;
  for (const articleDoc of snap.docs) {
    const chunks = await articleDoc.ref.collection('chunks').get();
    const batch = db.batch();
    chunks.docs.forEach((c) => batch.delete(c.ref));
    batch.delete(articleDoc.ref);
    await batch.commit();
    deleted++;
  }
  console.log(`[cleanWikipediaCache] Deleted ${deleted} stale article(s)`);
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
