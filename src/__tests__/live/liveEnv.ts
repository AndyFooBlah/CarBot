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
 * Shared plumbing for the live suite (`npm run test:live`).
 *
 * The key is read from the environment and handed to the kit; it is never
 * printed or written anywhere. Every result is printed as one line and, when
 * LIVE_RESULTS_FILE is set, appended to that file as a JSON line (no secrets:
 * the kit redacts results) so CI can publish a table
 * (scripts/summarize-live-results.mjs).
 */

import fs from 'node:fs';
import { describe } from 'vitest';
import type { LiveConnectConfig } from '@google/genai';
import type { LiveCheckResult, LiveCheckStatus, LiveTestSession } from '@andyfooblah/voice-common/testing';
import { GEMINI_LIVE_MODEL } from '../../services/geminiBroker';
import { buildCarbotLiveConnectConfig } from '../../services/liveConfig';
import { SYNTHETIC_VOICE, buildSyntheticInstruction } from './syntheticFamily';

export const LIVE_API_KEY = process.env.GEMINI_API_KEY ?? '';

/** `describe` that skips the whole block (green) when no key is configured. */
export const describeLive = describe.skipIf(!LIVE_API_KEY);

/** Model + exact connect config of a real CarBot conversation (synthetic family). */
export async function conversationTarget(): Promise<{
  apiKey: string;
  model: string;
  config: LiveConnectConfig;
  systemInstruction: string;
}> {
  const systemInstruction = await buildSyntheticInstruction();
  return {
    apiKey: LIVE_API_KEY,
    model: GEMINI_LIVE_MODEL,
    systemInstruction,
    config: buildCarbotLiveConnectConfig({ systemInstruction, selectedVoice: SYNTHETIC_VOICE }),
  };
}

export interface RecordedResult {
  name: string;
  status: LiveCheckStatus;
  detail: string;
  metrics?: Record<string, number | string | boolean>;
  durationMs?: number;
}

/** Print one result line and append it to LIVE_RESULTS_FILE when set. */
export function record(label: string, result: RecordedResult | LiveCheckResult): void {
  const metrics = Object.entries(result.metrics ?? {})
    .filter(([, value]) => value !== '' && value !== -1)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.log(
    `[live] ${result.status.toUpperCase().padEnd(8)} ${label} :: ${result.name} :: ${result.detail}` +
      (metrics ? ` [${metrics}]` : ''),
  );
  if (process.env.LIVE_RESULTS_FILE) {
    fs.appendFileSync(
      process.env.LIVE_RESULTS_FILE,
      JSON.stringify({
        label,
        at: new Date().toISOString(),
        name: result.name,
        status: result.status,
        detail: result.detail,
        metrics: result.metrics ?? {},
        durationMs: result.durationMs ?? 0,
      }) + '\n',
    );
  }
}

/**
 * Run a hand-written live check: record a pass with its detail, or record the
 * failure and rethrow so the test fails.
 */
export async function recorded(
  label: string,
  name: string,
  run: () => Promise<{ detail: string; metrics?: Record<string, number | string | boolean> }>,
): Promise<void> {
  const started = Date.now();
  try {
    const { detail, metrics } = await run();
    record(label, { name, status: 'pass', detail, metrics, durationMs: Date.now() - started });
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 300);
    record(label, { name, status: 'fail', detail, durationMs: Date.now() - started });
    throw err;
  }
}

/**
 * Type one message into an open session and return everything the bot said
 * in reply. If the bot reaches for a tool, it gets a bland answer so the turn
 * can finish.
 */
export async function say(session: LiveTestSession, message: string, timeoutMs = 45_000): Promise<string> {
  const since = session.mark();
  session.sendText(message);
  await session.waitForType('turnComplete', timeoutMs, { since });
  const calls = session.events('toolCall', since).flatMap((event) => event.calls);
  if (calls.length > 0) {
    const afterTools = session.mark();
    for (const call of calls) session.respondToTool(call, 'No result.');
    await session.waitForType('turnComplete', 30_000, { since: afterTools }).catch(() => undefined);
  }
  return session.outputText(since).replace(/\s+/g, ' ').trim();
}
