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
 * Client-side wrappers for the voiceQuota callable functions.
 *
 * Use checkAndReserveVoiceQuota() to reserve a session slot before starting
 * a Gemini Live session. Use recordVoiceUsage() after the session ends to
 * record its duration against the per-day audio-minutes cap.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '@andyfooblah/voice-common';

export interface VoiceQuotaCheckResult {
  allowed: boolean;
  reason?: string;
  sessionStartCount: number;
  audioMinutes: number;
  limits: {
    maxSessionsPerDay: number;
    maxAudioMinutesPerDay: number;
  };
}

export async function checkAndReserveVoiceQuota(): Promise<VoiceQuotaCheckResult> {
  const fn = httpsCallable<unknown, VoiceQuotaCheckResult>(functions, 'checkAndReserveVoiceQuota');
  const res = await fn({});
  return res.data;
}

export async function getVoiceQuotaStatus(): Promise<VoiceQuotaCheckResult> {
  const fn = httpsCallable<unknown, VoiceQuotaCheckResult>(functions, 'getVoiceQuotaStatus');
  const res = await fn({});
  return res.data;
}

export async function recordVoiceUsage(durationSeconds: number): Promise<void> {
  try {
    const fn = httpsCallable<{ durationSeconds: number }, { ok: boolean }>(functions, 'recordVoiceUsage');
    await fn({ durationSeconds });
  } catch (err) {
    // Non-fatal — quota recording is best-effort. If the network fails or the
    // tab is dying, we accept the usage being undercounted.
    console.warn('[voiceQuota] recordVoiceUsage failed:', err);
  }
}
