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
 * Client-side wrappers for the diagnostics-page callables.
 * These are thin httpsCallable invocations used only by the DiagnosticsPage.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '@andyfooblah/voice-common';

export async function callCleanTranscriptForSession(sessionId: string): Promise<void> {
  const fn = httpsCallable<{ sessionId: string }, { success: boolean }>(functions, 'cleanTranscriptForSession');
  await fn({ sessionId });
}

export async function callExtractMemoriesForSession(sessionId: string): Promise<void> {
  const fn = httpsCallable<{ sessionId: string }, { success: boolean }>(functions, 'extractMemoriesForSession');
  await fn({ sessionId });
}

export async function callSendSummaryEmailForSession(sessionId: string): Promise<void> {
  const fn = httpsCallable<{ sessionId: string }, { success: boolean }>(functions, 'sendSummaryEmailForSession');
  await fn({ sessionId });
}
