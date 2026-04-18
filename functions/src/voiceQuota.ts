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
 * voiceQuota — server-side per-user quota enforcement for Gemini Live sessions.
 *
 * Gemini Live streams from the browser directly to Google using the client's
 * API key, so the server cannot observe session traffic. Instead we gate
 * session *starts* through a callable: the client must call
 * `checkAndReserveVoiceQuota` before opening the Gemini connection, and
 * `recordVoiceUsage` after the session ends. A well-behaved client respects
 * this; a compromised client bypasses it — but runaway/accidental over-use by
 * the legitimate app flow (repeat reconnects, background tabs left open) is
 * what we're actually defending against here.
 *
 * Storage: _usage/{uid}/daily/{YYYY-MM-DD}
 *   {
 *     sessionStartCount: number,   // increments on each successful reservation
 *     audioMinutes: number,        // increments via recordVoiceUsage
 *     updatedAt: Timestamp,
 *   }
 *
 * Limits are generous enough that a 10-hour continuous session for an elderly
 * family member is allowed, but a broken loop that tries to reconnect forever
 * will be blocked.
 */

import { onCall, CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// Per-user daily caps. Picked to comfortably cover a marathon session while
// still being a meaningful safety net.
const MAX_SESSIONS_PER_DAY = 50;
const MAX_AUDIO_MINUTES_PER_DAY = 18 * 60; // 18 hours

/** YYYY-MM-DD in the caller's local date — the server uses UTC for stability. */
function todayUtcKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

interface QuotaDoc {
  sessionStartCount?: number;
  audioMinutes?: number;
  updatedAt?: Timestamp;
}

interface CheckResult {
  allowed: boolean;
  reason?: string;
  sessionStartCount: number;
  audioMinutes: number;
  limits: {
    maxSessionsPerDay: number;
    maxAudioMinutesPerDay: number;
  };
}

/**
 * Atomically checks the caller's quota and, if allowed, reserves a session
 * slot by incrementing sessionStartCount. Returns the current counters and
 * the limits so the client can surface useful messaging.
 */
export const checkAndReserveVoiceQuota = onCall(
  { region: 'us-central1' },
  async (request: CallableRequest): Promise<CheckResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

    const uid = request.auth.uid;
    const dayKey = todayUtcKey();
    const db = getFirestore();
    const docRef = db.collection('_usage').doc(uid).collection('daily').doc(dayKey);

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const data = (snap.exists ? snap.data() : {}) as QuotaDoc;
      const sessions = data.sessionStartCount ?? 0;
      const minutes = data.audioMinutes ?? 0;

      if (sessions >= MAX_SESSIONS_PER_DAY) {
        return {
          allowed: false,
          reason: `Daily session limit reached (${MAX_SESSIONS_PER_DAY}). Please try again tomorrow.`,
          sessionStartCount: sessions,
          audioMinutes: minutes,
          limits: { maxSessionsPerDay: MAX_SESSIONS_PER_DAY, maxAudioMinutesPerDay: MAX_AUDIO_MINUTES_PER_DAY },
        };
      }
      if (minutes >= MAX_AUDIO_MINUTES_PER_DAY) {
        return {
          allowed: false,
          reason: `Daily voice-minutes limit reached (${MAX_AUDIO_MINUTES_PER_DAY / 60}h). Please try again tomorrow.`,
          sessionStartCount: sessions,
          audioMinutes: minutes,
          limits: { maxSessionsPerDay: MAX_SESSIONS_PER_DAY, maxAudioMinutesPerDay: MAX_AUDIO_MINUTES_PER_DAY },
        };
      }

      tx.set(
        docRef,
        {
          sessionStartCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return {
        allowed: true,
        sessionStartCount: sessions + 1,
        audioMinutes: minutes,
        limits: { maxSessionsPerDay: MAX_SESSIONS_PER_DAY, maxAudioMinutesPerDay: MAX_AUDIO_MINUTES_PER_DAY },
      };
    });
  },
);

/**
 * Read-only view of the caller's current daily quota usage. Used by the
 * diagnostics page; does not mutate any state.
 */
export const getVoiceQuotaStatus = onCall(
  { region: 'us-central1' },
  async (request: CallableRequest): Promise<CheckResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

    const uid = request.auth.uid;
    const dayKey = todayUtcKey();
    const db = getFirestore();
    const docRef = db.collection('_usage').doc(uid).collection('daily').doc(dayKey);

    const snap = await docRef.get();
    const data = (snap.exists ? snap.data() : {}) as QuotaDoc;
    const sessions = data.sessionStartCount ?? 0;
    const minutes = data.audioMinutes ?? 0;

    const sessionsLeft = Math.max(0, MAX_SESSIONS_PER_DAY - sessions);
    const minutesLeft = Math.max(0, MAX_AUDIO_MINUTES_PER_DAY - minutes);
    return {
      allowed: sessionsLeft > 0 && minutesLeft > 0,
      sessionStartCount: sessions,
      audioMinutes: minutes,
      limits: { maxSessionsPerDay: MAX_SESSIONS_PER_DAY, maxAudioMinutesPerDay: MAX_AUDIO_MINUTES_PER_DAY },
    };
  },
);

/**
 * Records the duration of a completed session against the caller's daily
 * usage. Called from the client when the session ends (best-effort; if the
 * tab dies mid-session, we won't record — accepted trade-off).
 */
export const recordVoiceUsage = onCall(
  { region: 'us-central1' },
  async (request: CallableRequest) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

    const uid = request.auth.uid;
    const { durationSeconds } = request.data as { durationSeconds?: number };
    if (typeof durationSeconds !== 'number' || durationSeconds < 0 || durationSeconds > 24 * 3600) {
      throw new HttpsError('invalid-argument', 'durationSeconds must be a non-negative number ≤ 86400.');
    }

    const minutes = durationSeconds / 60;
    const dayKey = todayUtcKey();
    const db = getFirestore();
    const docRef = db.collection('_usage').doc(uid).collection('daily').doc(dayKey);

    await docRef.set(
      {
        audioMinutes: FieldValue.increment(minutes),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { ok: true };
  },
);
