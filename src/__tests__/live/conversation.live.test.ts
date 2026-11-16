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
 * LIVE: a CarBot conversation against the real Gemini Live API.
 *
 * Sends exactly what production sends: the model constant, the config
 * `useCarbotSession` produces through VoiceCommon (services/liveConfig.ts),
 * the real system instruction (built by the real builder for a synthetic
 * family: persona, memories, a context document, tool rules, SAFETY block),
 * the nine real tool declarations plus `endSession`, a real voice, and server
 * VAD with defaults.
 *
 * Runs only via `npm run test:live` with GEMINI_API_KEY set. Each check opens
 * one or two short sessions; the whole file costs a few US cents.
 */

import { beforeAll, expect, it } from 'vitest';
import {
  LiveTestSession,
  assertLiveConformance,
  formatLiveConformanceReport,
  runLiveConformance,
} from '@andyfooblah/voice-common/testing';
import type { LiveAppProfile, LiveCheckName, RunLiveConformanceOptions } from '@andyfooblah/voice-common/testing';
import { GEMINI_LIVE_MODEL } from '../../services/geminiBroker';
import { SAFETY_BLOCK } from '../../services/promptSafety';
import {
  CARBOT_AUTO_GREET_TEXT,
  CARBOT_LIVE_API_VERSION,
  buildCarbotLiveConnectConfig,
} from '../../services/liveConfig';
import { LIVE_API_KEY, conversationTarget, describeLive, record, recorded, say } from './liveEnv';
import { SYNTHETIC_CHILD_NAME, SYNTHETIC_MEMORIES, SYNTHETIC_VOICE } from './syntheticFamily';

const LABEL = 'conversation';

/**
 * Checks from the kit, in the order they run.
 *
 * Left out on purpose:
 *   - `patience`, `manual-turn-control`: CarBot uses server VAD with the
 *     default silence, so there is no configured wait to verify and no manual
 *     mode in the app.
 *   - `session-resumption`: the kit's probe asks the bot to remember and
 *     repeat a "code word". CarBot's safety rules make it decline to repeat
 *     passwords, and its instruction treats a bracketed cue as "session
 *     started, greet the family", so the probe fails for reasons that have
 *     nothing to do with resumption (measured 2026-11-15). The test at the
 *     bottom of this file checks resumption with an ordinary conversation.
 */
const CHECKS: readonly LiveCheckName[] = [
  'setup',
  'tool-declarations',
  'text-turn',
  'audio-turn',
  'tool-round-trip',
  'barge-in',
  'context-compression',
  'model-listed',
  'ephemeral-token',
  'latency',
];

/** Options for individual checks, chosen to fit CarBot's instruction. */
const OPTIONS: Partial<RunLiveConformanceOptions> = {
  // One of CarBot's own tools, with a canned result. The instruction tells
  // the bot to say a short "let me check" line first, then call the tool.
  toolProbe: {
    prompt: "What's the weather like in Paris right now?",
    expectTool: 'getWeather',
    result: 'Paris, France: 18 degrees Celsius and sunny, with a light breeze.',
    expectInReply: 'sunny',
  },
  // The app's own opening cue, so the first turn is the real greeting.
  textTurn: { prompt: CARBOT_AUTO_GREET_TEXT },
};

describeLive(`live: CarBot conversation on ${GEMINI_LIVE_MODEL}`, () => {
  let profile: LiveAppProfile;
  let systemInstruction: string;

  beforeAll(async () => {
    const target = await conversationTarget();
    systemInstruction = target.systemInstruction;
    // Precondition: the instruction really is the fully-populated one.
    expect(systemInstruction.endsWith(SAFETY_BLOCK)).toBe(true);
    expect(systemInstruction).toContain(SYNTHETIC_MEMORIES[0].content);
    profile = {
      name: 'carbot-conversation',
      model: target.model,
      systemInstruction,
      // The exact config production passes to ai.live.connect.
      connectConfig: target.config,
    };
  });

  it.each(CHECKS)('%s', async (check) => {
    const report = await runLiveConformance(profile, { apiKey: LIVE_API_KEY, checks: [check], ...OPTIONS });
    for (const result of report.results) {
      record(LABEL, result);
      if (!result.pass && result.trace?.length) {
        console.log(`[live] trace for ${LABEL} :: ${result.name}\n  ${result.trace.join('\n  ')}`);
      }
    }
    expect(report.model).toBe(GEMINI_LIVE_MODEL);
    expect(report.results).toHaveLength(1);
    if (!report.ok) console.log(formatLiveConformanceReport(report));
    assertLiveConformance(report);
  });

  it('session-resumption: a reconnect with the handle keeps the conversation', async () => {
    // VoiceCommon resumes a session after the Live API's periodic connection
    // resets. The reconnect config is the conversation config plus the handle.
    await recorded(LABEL, 'session-resumption', async () => {
      const first = await LiveTestSession.connect({
        apiKey: LIVE_API_KEY,
        model: GEMINI_LIVE_MODEL,
        config: buildCarbotLiveConnectConfig({ systemInstruction, selectedVoice: SYNTHETIC_VOICE }),
        apiVersion: CARBOT_LIVE_API_VERSION,
      });
      let handle: string | undefined;
      try {
        await say(first, CARBOT_AUTO_GREET_TEXT);
        const told = first.mark();
        await say(first, `Hi! It's ${SYNTHETIC_CHILD_NAME}. On the way to the car I saw a purple tractor. Isn't that funny?`);
        const turnDoneT = first.now();
        // The handle that covers the turn arrives just after it completes.
        await first
          .waitFor((e) => e.type === 'sessionResumptionUpdate' && e.resumable && !!e.handle && e.t >= turnDoneT - 50, 5_000, {
            since: told,
          })
          .catch(() => undefined);
        handle = first.latestResumptionHandle();
      } finally {
        await first.close();
      }
      if (!handle) throw new Error('the server never issued a resumable session handle');

      const second = await LiveTestSession.connect({
        apiKey: LIVE_API_KEY,
        model: GEMINI_LIVE_MODEL,
        config: buildCarbotLiveConnectConfig({
          systemInstruction,
          selectedVoice: SYNTHETIC_VOICE,
          resumptionHandle: handle,
        }),
        apiVersion: CARBOT_LIVE_API_VERSION,
      });
      try {
        const reply = await say(second, 'What colour was the tractor I told you about?');
        if (!/purple/i.test(reply)) {
          throw new Error(`reconnected with the handle, but the bot did not recall the purple tractor (said "${reply.slice(0, 160)}")`);
        }
        return { detail: `context survived the reconnect: "${reply.slice(0, 80)}"` };
      } finally {
        await second.close();
      }
    });
  });
});
