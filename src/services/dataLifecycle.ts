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
 * Client wrappers for the data-lifecycle callables (#34).
 *
 * Deletion is server-side only: Firestore rules deny client deletes of
 * `sessions/*` and `users/*`, so a session or an account can only be
 * removed through these callables, which also clean up subcollections,
 * fanned-out memories and the audio file in Storage.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '@andyfooblah/voice-common';

/** Delete one session and everything attributable to it. */
export async function deleteSession(sessionId: string): Promise<void> {
  const fn = httpsCallable<{ sessionId: string }, { success: boolean }>(functions, 'deleteSession');
  await fn({ sessionId });
}

export interface DeleteAccountResult {
  success: boolean;
  sessions: number;
  contextDocuments: number;
  emails: number;
  memories: number;
}

/**
 * Delete the signed-in user's account and all of their data, then the Auth
 * user itself. The caller must pass the literal confirmation phrase.
 */
export async function deleteAccount(confirm: 'DELETE'): Promise<DeleteAccountResult> {
  const fn = httpsCallable<{ confirm: string }, DeleteAccountResult>(functions, 'deleteAccount');
  const res = await fn({ confirm });
  return res.data;
}

/** UI options for the audio-retention setting (mirrors functions/src/retentionPolicy.ts). */
export const AUDIO_RETENTION_CHOICES: ReadonlyArray<{ value: 30 | 90 | 365 | null; label: string }> = [
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days (default)' },
  { value: 365, label: '1 year' },
  { value: null, label: 'Keep forever' },
];
