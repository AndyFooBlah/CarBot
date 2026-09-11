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
 * dataLifecycle — deletion and retention for a family's data (#34).
 *
 * Callables (authenticated, owner-only):
 *   deleteSession   — one session: doc + transcript/* + transcriptEdits/* +
 *                     memories/* subcollection + fanned-out memories/{id}
 *                     for that session + the .webm in Storage.
 *   deleteAccount   — everything: every session (as above), context
 *                     documents, ingested emails, remaining memories, usage
 *                     counters, the user doc, the sessions/{uid}/ Storage
 *                     prefix, and finally the Firebase Auth user.
 *
 * Nightly (called from dailyDataCleanup):
 *   enforceAudioRetention — per user, delete session audio older than the
 *                     parent's `audioRetentionDays` setting (default 90;
 *                     null = forever) and clear audioUrl. Transcripts and
 *                     memories are kept.
 *
 * Firestore rules deny client-side deletes of `sessions/*` and `users/*`,
 * so these callables are the only deletion path and nothing can be left
 * half-deleted (orphaned subcollections, dangling audio).
 */

import { onCall, CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp, type Firestore, type DocumentReference, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import {
  audioObjectPath,
  objectPathFromDownloadUrl,
  resolveAudioRetentionDays,
  selectSessionsForAudioPurge,
  audioRetentionCutoffMs,
  type SessionAudioView,
} from './retentionPolicy';

type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Delete every document in a collection in batches of 400. */
async function deleteCollection(
  db: Firestore,
  ref: FirebaseFirestore.CollectionReference | FirebaseFirestore.Query,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snap = await ref.limit(400).get();
    if (snap.empty) return deleted;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < 400) return deleted;
  }
}

/** Delete a Storage object, ignoring "not found". */
async function deleteObjectIfExists(bucket: Bucket, path: string): Promise<boolean> {
  try {
    await bucket.file(path).delete({ ignoreNotFound: true });
    return true;
  } catch (err) {
    console.warn(`[dataLifecycle] Failed to delete gs object ${path}:`, err);
    return false;
  }
}

/** Delete the recording(s) for a session: canonical path + whatever audioUrl points at. */
async function deleteSessionAudio(
  bucket: Bucket,
  userId: string,
  sessionId: string,
  audioUrl: string | null | undefined,
): Promise<void> {
  const paths = new Set<string>([audioObjectPath(userId, sessionId)]);
  const fromUrl = objectPathFromDownloadUrl(audioUrl);
  // Only honour a URL-derived path inside the caller's own prefix — never let
  // a crafted audioUrl point the delete at someone else's object.
  if (fromUrl && fromUrl.startsWith(`sessions/${userId}/`)) paths.add(fromUrl);
  for (const p of paths) await deleteObjectIfExists(bucket, p);
}

/**
 * Remove one session and everything attributable to it. The session doc is
 * deleted LAST so a partial failure leaves a visible session the user can
 * retry, not orphaned subcollections.
 */
export async function purgeSession(
  db: Firestore,
  bucket: Bucket,
  sessionRef: DocumentReference,
  userId: string,
  audioUrl: string | null | undefined,
): Promise<void> {
  const sessionId = sessionRef.id;
  await deleteCollection(db, sessionRef.collection('transcript'));
  await deleteCollection(db, sessionRef.collection('transcriptEdits'));
  await deleteCollection(db, sessionRef.collection('memories'));
  await deleteCollection(
    db,
    db.collection('memories').where('userId', '==', userId).where('sessionId', '==', sessionId),
  );
  await deleteSessionAudio(bucket, userId, sessionId, audioUrl);
  await sessionRef.delete();
}

function requireOwnedSession(
  request: CallableRequest,
  snap: DocumentSnapshot,
): { uid: string; audioUrl: string | undefined } {
  if (!snap.exists) throw new HttpsError('not-found', 'Session not found.');
  const uid = request.auth!.uid;
  const data = snap.data() ?? {};
  if (data.userId !== uid) {
    throw new HttpsError('permission-denied', 'Session does not belong to you.');
  }
  return { uid, audioUrl: typeof data.audioUrl === 'string' ? data.audioUrl : undefined };
}

// ---------------------------------------------------------------------------
// Callable: deleteSession
// ---------------------------------------------------------------------------

export const deleteSession = onCall(
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' },
  async (request: CallableRequest) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
    const { sessionId } = (request.data ?? {}) as { sessionId?: unknown };
    if (!sessionId || typeof sessionId !== 'string') {
      throw new HttpsError('invalid-argument', 'sessionId is required.');
    }

    const db = getFirestore();
    const ref = db.collection('sessions').doc(sessionId);
    const snap = await ref.get();
    const { uid, audioUrl } = requireOwnedSession(request, snap);
    if (snap.data()?.status === 'active') {
      throw new HttpsError('failed-precondition', 'Stop the session before deleting it.');
    }

    await purgeSession(db, getStorage().bucket(), ref, uid, audioUrl);
    console.log(`[deleteSession] Deleted session ${sessionId} for user ${uid}`);
    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// Callable: deleteAccount
// ---------------------------------------------------------------------------

export const deleteAccount = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request: CallableRequest) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
    const uid = request.auth.uid;
    const { confirm } = (request.data ?? {}) as { confirm?: unknown };
    if (confirm !== 'DELETE') {
      throw new HttpsError('failed-precondition', 'Confirmation phrase missing.');
    }

    const db = getFirestore();
    const bucket = getStorage().bucket();
    console.log(`[deleteAccount] Starting for user ${uid}`);

    // 1. Sessions (and everything hanging off them).
    const sessions = await db.collection('sessions').where('userId', '==', uid).get();
    for (const s of sessions.docs) {
      const audioUrl = s.data().audioUrl as string | undefined;
      await purgeSession(db, bucket, s.ref, uid, audioUrl);
    }

    // 2. Flat per-user collections.
    const counts = {
      sessions: sessions.size,
      contextDocuments: await deleteCollection(db, db.collection('context_documents').where('userId', '==', uid)),
      emails: await deleteCollection(db, db.collection('emails').where('userId', '==', uid)),
      memories: await deleteCollection(db, db.collection('memories').where('userId', '==', uid)),
      usage: await deleteCollection(db, db.collection('_usage').doc(uid).collection('daily')),
    };
    await db.collection('_usage').doc(uid).delete().catch(() => null);

    // 3. Any remaining objects under the user's Storage prefix.
    try {
      await bucket.deleteFiles({ prefix: `sessions/${uid}/` });
    } catch (err) {
      console.warn(`[deleteAccount] deleteFiles prefix sessions/${uid}/ failed:`, err);
    }

    // 4. Profile document, then the Auth user (last — once it is gone the
    //    caller can no longer retry).
    await db.collection('users').doc(uid).delete();
    await getAuth().deleteUser(uid);

    console.log(`[deleteAccount] Done for user ${uid}`, counts);
    return { success: true, ...counts };
  },
);

// ---------------------------------------------------------------------------
// Nightly: enforce per-user audio retention
// ---------------------------------------------------------------------------

/** Max sessions purged per user per run — bounds the nightly job's runtime. */
const MAX_PURGES_PER_USER_PER_RUN = 200;

export async function enforceAudioRetention(db: Firestore): Promise<void> {
  const bucket = getStorage().bucket();
  const nowMs = Date.now();
  const users = await db.collection('users').get();

  let purged = 0;
  let usersForever = 0;
  for (const userDoc of users.docs) {
    const uid = userDoc.id;
    const days = resolveAudioRetentionDays(userDoc.data().audioRetentionDays);
    const cutoff = audioRetentionCutoffMs(days, nowMs);
    if (cutoff === null) { usersForever++; continue; }

    // Coarse server-side filter on startTime (indexed with userId); the
    // precise decision — endTime, status, audioUrl, already-purged — is made
    // by selectSessionsForAudioPurge.
    const snap = await db
      .collection('sessions')
      .where('userId', '==', uid)
      .where('startTime', '<', Timestamp.fromMillis(cutoff))
      .orderBy('startTime', 'desc')
      .limit(MAX_PURGES_PER_USER_PER_RUN * 2)
      .get();

    const views: (SessionAudioView & { ref: DocumentReference })[] = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ref: d.ref,
        userId: uid,
        status: String(data.status ?? ''),
        audioUrl: data.audioUrl as string | undefined,
        startTimeMs: (data.startTime as Timestamp | undefined)?.toMillis() ?? 0,
        endTimeMs: (data.endTime as Timestamp | null | undefined)?.toMillis() ?? null,
        audioPurgedAtMs: (data.audioPurgedAt as Timestamp | undefined)?.toMillis() ?? null,
      };
    });

    const toPurge = selectSessionsForAudioPurge(views, days, nowMs).slice(0, MAX_PURGES_PER_USER_PER_RUN);
    for (const s of toPurge) {
      try {
        await deleteSessionAudio(bucket, uid, s.id, s.audioUrl);
        await s.ref.update({ audioUrl: '', audioPurgedAt: Timestamp.now() });
        purged++;
      } catch (err) {
        console.error(`[enforceAudioRetention] Failed for session ${s.id}:`, err);
      }
    }
  }

  console.log(
    `[enforceAudioRetention] Purged audio for ${purged} session(s) across ${users.size} user(s) (${usersForever} keep forever)`,
  );
}
