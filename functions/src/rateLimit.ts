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
 * Per-user daily rate limiting for cost-generating callables.
 *
 * Mirrors LegacyBot's pattern. Counters live in `_usage/{uid}/daily/{day}`,
 * locked down by Firestore rules — only the admin SDK (these functions)
 * can read/write them.
 */

import { getFirestore, FieldValue, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export const RATE_LIMITS = {
  geoProxy: 500,
  cacheWikipediaArticle: 100,
  mintGeminiLiveToken: 200,
  invokeGemini: 1000,
  embedGemini: 500,
  // reconcileMemories runs Gemini extraction on up to 100 sessions per
  // invocation. Five runs/day = 500 extractions/day max — enough for
  // legitimate use, low enough to bound cost if a UI bug causes a loop.
  reconcileMemories: 5,
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Atomically reserve one slot in the user's daily allotment for `bucket`.
 * Throws HttpsError('resource-exhausted') when the cap is exceeded.
 */
export async function enforceRateLimit(uid: string, bucket: RateLimitBucket): Promise<void> {
  const cap = RATE_LIMITS[bucket];
  const dayKey = utcDayKey();
  const db = getFirestore();
  const docRef = db.collection('_usage').doc(uid).collection('daily').doc(dayKey);
  const field = `${bucket}Count`;

  await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(docRef);
    const current = (snap.exists ? (snap.data()?.[field] ?? 0) : 0) as number;

    if (current >= cap) {
      throw new HttpsError(
        'resource-exhausted',
        `Daily limit reached for ${bucket} (${cap}/day). Try again tomorrow.`,
      );
    }

    if (snap.exists) {
      tx.update(docRef, {
        [field]: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(docRef, {
        [field]: 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
}
