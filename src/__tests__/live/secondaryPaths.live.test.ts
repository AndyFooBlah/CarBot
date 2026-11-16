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
 * LIVE: CarBot's other Live paths, and the server's half of the main one.
 *
 *   1. Settings voice audition (services/voicePreview.ts): the exact config
 *      it passes to ai.live.connect, with the cue it sends.
 *   2. Broker token: a token minted with the request mintGeminiLiveToken
 *      uses (functions/src/liveTokenConfig.ts) opens a real conversation.
 *   3. /diagnostics probe (services/liveProbe.ts): the same function the page
 *      runs, with a real token, in Node.
 *
 * Runs only via `npm run test:live` with GEMINI_API_KEY set.
 */

import { expect, it } from 'vitest';
import { GoogleGenAI } from '@google/genai';
import {
  LiveTestSession,
  assertLiveConformance,
  formatLiveConformanceReport,
  runLiveConformance,
} from '@andyfooblah/voice-common/testing';
import { LIVE_TOKEN_API_VERSION, liveTokenCreateConfig } from '../../../functions/src/liveTokenConfig';
import { GEMINI_LIVE_MODEL } from '../../services/geminiBroker';
import {
  CARBOT_AUTO_GREET_TEXT,
  CARBOT_LIVE_API_VERSION,
  buildVoicePreviewConnectConfig,
  voicePreviewPrompt,
} from '../../services/liveConfig';
import { LiveProbeError, probeLiveSetup } from '../../services/liveProbe';
import { LIVE_API_KEY, conversationTarget, describeLive, record, recorded, say } from './liveEnv';
import { SYNTHETIC_BOT_NAME } from './syntheticFamily';

/** Mint a token exactly as the mintGeminiLiveToken callable does. */
async function mintLikeTheBroker(): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: LIVE_API_KEY, httpOptions: { apiVersion: LIVE_TOKEN_API_VERSION } });
  const token = await ai.authTokens.create({ config: liveTokenCreateConfig(Date.now()) });
  if (!token?.name) throw new Error('authTokens.create returned no token');
  return token.name;
}

describeLive(`live: voice audition path on ${GEMINI_LIVE_MODEL}`, () => {
  const PREVIEW_VOICE = 'Zephyr';
  const LABEL = 'voice-preview';

  it('setup and a turn pass with the exact config previewVoice sends', async () => {
    const report = await runLiveConformance(
      {
        name: 'carbot-voice-preview',
        model: GEMINI_LIVE_MODEL,
        systemInstruction: '',
        connectConfig: buildVoicePreviewConnectConfig(PREVIEW_VOICE),
      },
      {
        apiKey: LIVE_API_KEY,
        checks: ['setup', 'text-turn'],
        textTurn: { prompt: voicePreviewPrompt(SYNTHETIC_BOT_NAME) },
      },
    );
    for (const result of report.results) record(LABEL, result);
    if (!report.ok) console.log(formatLiveConformanceReport(report));
    assertLiveConformance(report);
  });

  it('the audition says the greeting it was asked for, in audio', async () => {
    await recorded(LABEL, 'says-greeting', async () => {
      const session = await LiveTestSession.connect({
        apiKey: LIVE_API_KEY,
        model: GEMINI_LIVE_MODEL,
        config: buildVoicePreviewConnectConfig(PREVIEW_VOICE),
        apiVersion: CARBOT_LIVE_API_VERSION,
      });
      try {
        const since = session.mark();
        const said = await say(session, voicePreviewPrompt(SYNTHETIC_BOT_NAME), 30_000);
        const seconds = session.audioBytes(since) / 48_000;
        if (seconds < 0.3) throw new Error(`only ${seconds.toFixed(2)} s of audio (said "${said}")`);
        // The transcription may spell the invented name its own way.
        if (!/\bhi\b/i.test(said) || !/z(oo|u)m/i.test(said)) {
          throw new Error(`the audition did not say the greeting (said "${said}")`);
        }
        return { detail: `said "${said}"`, metrics: { audioSeconds: Number(seconds.toFixed(2)) } };
      } finally {
        await session.close();
      }
    });
  });
});

describeLive('live: broker token and diagnostics probe', () => {
  const LABEL = 'broker-and-probe';

  it("a token minted with the broker's request opens a real conversation", async () => {
    await recorded(LABEL, 'broker-token-session', async () => {
      const target = await conversationTarget();
      const mintStarted = Date.now();
      const token = await mintLikeTheBroker();
      const mintMs = Date.now() - mintStarted;
      expect(token.startsWith('auth_tokens/')).toBe(true);
      const session = await LiveTestSession.connect({
        ephemeralToken: token,
        model: target.model,
        config: target.config,
        apiVersion: CARBOT_LIVE_API_VERSION,
      });
      try {
        const since = session.mark();
        const said = await say(session, CARBOT_AUTO_GREET_TEXT, 30_000);
        expect(session.audioBytes(since)).toBeGreaterThan(0);
        expect(said.length).toBeGreaterThan(0);
        return {
          detail: `minted on ${LIVE_TOKEN_API_VERSION}, connected on ${CARBOT_LIVE_API_VERSION}, bot greeted: "${said.slice(0, 60)}"`,
          metrics: { mintMs },
        };
      } finally {
        await session.close();
      }
    });
  });

  it('the diagnostics probe reaches setupComplete with a broker token', async () => {
    await recorded(LABEL, 'diagnostics-probe', async () => {
      const token = await mintLikeTheBroker();
      const started = Date.now();
      await probeLiveSetup(token);
      return { detail: 'setupComplete received for the production model', metrics: { setupMs: Date.now() - started } };
    });
  });

  it('the diagnostics probe goes red when the server refuses the session', async () => {
    // Negative control: the probe must not be green just because a socket
    // opened. A single-use token that has already opened a session is refused.
    await recorded(LABEL, 'diagnostics-probe-refused', async () => {
      const token = await mintLikeTheBroker();
      await probeLiveSetup(token);
      const error = await probeLiveSetup(token).then(
        () => null,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(LiveProbeError);
      const message = (error as LiveProbeError).message;
      expect(message).not.toContain('auth_tokens');
      return { detail: `second use of a single-use token was refused: ${message.slice(0, 120)}` };
    });
  });
});
