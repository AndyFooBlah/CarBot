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
 * reconcileMemories — user-triggered batch repair of memory extraction.
 *
 * For each of the caller's sessions, in newest-first order, up to
 * MAX_SESSIONS_PER_RUN:
 *
 *   - If the session already has a `memories/facts` doc, skip — it's been
 *     processed (whether facts came back empty or not).
 *   - If the session is `status='active'` and the start time is older than
 *     STALE_ACTIVE_THRESHOLD_MS, mark it `interrupted`. This unblocks
 *     extraction for sessions the client never finalized (browser crash,
 *     tab closed, or the pre-2026-05-09 bug where the bot's endSession
 *     tool call didn't actually call stopSession).
 *   - If the session is `status='active'` and recent, leave it alone — real
 *     in-flight session.
 *   - Run extraction. The underlying function early-returns without writing
 *     if the transcript is missing or too short, so those sessions get
 *     re-scanned cheaply on a later reconcile if a transcript appears.
 *
 * Returns per-category counts so the UI can show a precise summary.
 */

import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { extractMemoriesFromSession, geminiApiKey } from './memoryExtraction';
import { enforceRateLimit } from './rateLimit';

/** Active sessions older than this are considered abandoned and can be marked interrupted. */
const STALE_ACTIVE_THRESHOLD_MS = 15 * 60 * 1000;
/** Cap one reconcile call at N sessions so it always completes within the function timeout. */
const MAX_SESSIONS_PER_RUN = 100;
/** How many session extractions can run in parallel. */
const CONCURRENCY = 5;

export interface ReconcileMemoriesResult {
  /** Sessions actually inspected this run (≤ MAX_SESSIONS_PER_RUN). */
  totalSessions: number;
  /** Already had a facts doc; skipped. */
  alreadyProcessed: number;
  /** Were `status='active'` for more than 15 min — flipped to 'interrupted'. */
  markedInterrupted: number;
  /** Successfully extracted (the function wrote a facts doc, possibly empty). */
  extracted: number;
  /** Were skipped because they had no transcript or the transcript was too short. */
  noTranscript: number;
  /** Threw during processing. */
  errors: number;
  /** Are recent active sessions left alone (real in-flight). */
  inFlight: number;
  /** True if there were more user sessions than MAX_SESSIONS_PER_RUN. */
  cappedAtMax: boolean;
}

const EMPTY_RESULT: () => ReconcileMemoriesResult = () => ({
  totalSessions: 0,
  alreadyProcessed: 0,
  markedInterrupted: 0,
  extracted: 0,
  noTranscript: 0,
  errors: 0,
  inFlight: 0,
  cappedAtMax: false,
});

/**
 * Internal entry point — exposed for direct testing without the auth /
 * rate-limit layer of the callable.
 */
export async function reconcileMemoriesForUser(uid: string): Promise<ReconcileMemoriesResult> {
  const db = getFirestore();

  const sessionsSnap = await db
    .collection('sessions')
    .where('userId', '==', uid)
    .orderBy('startTime', 'desc')
    .limit(MAX_SESSIONS_PER_RUN + 1)
    .get();

  const cappedAtMax = sessionsSnap.size > MAX_SESSIONS_PER_RUN;
  const sessions = sessionsSnap.docs.slice(0, MAX_SESSIONS_PER_RUN);

  const result = EMPTY_RESULT();
  result.totalSessions = sessions.length;
  result.cappedAtMax = cappedAtMax;

  // Concurrent worker pool — pull from a shared queue.
  const queue = [...sessions];
  async function worker(): Promise<void> {
    while (queue.length) {
      const sessionDoc = queue.shift();
      if (!sessionDoc) return;
      try {
        await processOneSession(sessionDoc, result);
      } catch (err) {
        logger.error('[reconcileMemories] Failed processing session', {
          uid,
          sessionId: sessionDoc.id,
          err: err instanceof Error ? err.message : String(err),
        });
        result.errors++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return result;
}

async function processOneSession(
  sessionDoc: FirebaseFirestore.QueryDocumentSnapshot,
  result: ReconcileMemoriesResult,
): Promise<void> {
  const session = sessionDoc.data() as { status?: string; startTime?: { toMillis?: () => number } };

  // 1. If facts doc already exists, skip — already processed.
  const factsRef = sessionDoc.ref.collection('memories').doc('facts');
  const factsBefore = await factsRef.get();
  if (factsBefore.exists) {
    result.alreadyProcessed++;
    return;
  }

  // 2. Recent active sessions are real in-flight — don't touch them.
  //    Stale active sessions get flipped to 'interrupted' so extraction
  //    can run; we don't know the actual duration, so leave it 0.
  if (session.status === 'active') {
    const startMs = session.startTime?.toMillis?.() ?? 0;
    const ageMs = Date.now() - startMs;
    if (ageMs < STALE_ACTIVE_THRESHOLD_MS) {
      result.inFlight++;
      return;
    }
    await sessionDoc.ref.update({
      status: 'interrupted',
      endTime: Timestamp.now(),
    });
    result.markedInterrupted++;
  }

  // 3. Run extraction. The underlying function writes the facts doc on
  //    successful completion (even with zero facts) and returns early
  //    without writing if the transcript is missing or too short.
  await extractMemoriesFromSession(sessionDoc.id);

  const factsAfter = await factsRef.get();
  if (factsAfter.exists) {
    result.extracted++;
  } else {
    result.noTranscript++;
  }
}

export const reconcileMemories = onCall(
  {
    secrets: [geminiApiKey],
    timeoutSeconds: 540,
    memory: '512MiB',
    region: 'us-central1',
  },
  async (request: CallableRequest): Promise<ReconcileMemoriesResult> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const uid = request.auth.uid;
    await enforceRateLimit(uid, 'reconcileMemories');

    logger.info('[reconcileMemories] Starting reconciliation', { uid });
    const result = await reconcileMemoriesForUser(uid);
    logger.info('[reconcileMemories] Complete', { uid, ...result });

    return result;
  },
);
