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
 * Client-side wrapper for the reconcileMemories Cloud Function.
 *
 * The callable runs Gemini extraction across the user's recent sessions —
 * filling in memories for sessions that finalized successfully but never
 * had extraction run, and unblocking orphaned active sessions (the
 * pre-2026-05-09 bug where the bot's endSession didn't actually call
 * stopSession). Server-side caps at 100 sessions per call and 5 calls
 * per user per day.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '@andyfooblah/voice-common';

export interface ReconcileMemoriesResult {
  totalSessions: number;
  alreadyProcessed: number;
  markedInterrupted: number;
  extracted: number;
  noTranscript: number;
  errors: number;
  inFlight: number;
  cappedAtMax: boolean;
}

export async function reconcileMemories(): Promise<ReconcileMemoriesResult> {
  const fn = httpsCallable<void, ReconcileMemoriesResult>(functions, 'reconcileMemories');
  const res = await fn();
  return res.data;
}

/** Render a result into a single human-readable summary line for the UI. */
export function summarizeReconcileResult(r: ReconcileMemoriesResult): string {
  const parts: string[] = [];
  if (r.extracted > 0) parts.push(`extracted memories from ${r.extracted}`);
  if (r.alreadyProcessed > 0) parts.push(`${r.alreadyProcessed} already up to date`);
  if (r.markedInterrupted > 0) parts.push(`${r.markedInterrupted} stale active session${r.markedInterrupted === 1 ? '' : 's'} cleaned up`);
  if (r.noTranscript > 0) parts.push(`${r.noTranscript} too short to extract`);
  if (r.inFlight > 0) parts.push(`${r.inFlight} still in progress`);
  if (r.errors > 0) parts.push(`${r.errors} error${r.errors === 1 ? '' : 's'}`);
  const head = parts.length === 0
    ? `Scanned ${r.totalSessions} sessions; nothing to do.`
    : `Scanned ${r.totalSessions} sessions: ${parts.join(', ')}.`;
  return r.cappedAtMax ? `${head} Hit the per-run cap — run again to continue.` : head;
}
