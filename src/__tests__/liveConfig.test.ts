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
 * The Live configuration of every CarBot code path, pinned exactly.
 *
 * These are offline tests (no network, no key). They use the REAL
 * `@andyfooblah/voice-common`: the global test setup mocks that module so
 * component tests never initialise Firebase, and this file undoes the mock,
 * because the point here is the config the real builder produces for CarBot's
 * real inputs. The same functions are sent to the real Gemini Live API by
 * `npm run test:live` (src/__tests__/live/).
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';

vi.unmock('@andyfooblah/voice-common');

import {
  DEFAULT_LIVE_MODEL,
  END_SESSION_TOOL_NAME,
  LIVE_API_VERSION,
  buildLiveConnectConfig,
  endSessionTool,
  getLiveModelInfo,
  resolveThinkingConfig,
} from '@andyfooblah/voice-common';
import { allKnowledgeTools } from '@andyfooblah/knowledge-common';
import { allMathGameTools } from '../services/mathGames';
import { GEMINI_LIVE_MODEL } from '../services/geminiBroker';
import {
  CARBOT_AUTO_GREET_TEXT,
  CARBOT_LIVE_API_VERSION,
  CARBOT_LIVE_THINKING,
  CARBOT_LIVE_TOOLS,
  VOICE_PREVIEW_INSTRUCTION,
  buildCarbotLiveConnectConfig,
  buildLiveSetupMessage,
  buildVoicePreviewConnectConfig,
  carbotLiveSessionOptions,
  carbotSpeechConfig,
  liveWebSocketUrl,
  voicePreviewPrompt,
} from '../services/liveConfig';

const ROOT = path.resolve(__dirname, '..', '..');
const INSTRUCTION = 'You are a test instruction.';

/** Server VAD exactly as VoiceCommon sends it when no turn option is set. */
const SERVER_VAD_DEFAULTS = {
  automaticActivityDetection: {
    startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
    endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
  },
};

const EXPECTED_TOOL_NAMES = [
  'getWeather',
  'searchPlace',
  'getDistanceBetweenPlaces',
  'getJoke',
  'searchWikipedia',
  'computeTimeDifference',
  'computeTimeOffset',
  'generateMathProblem',
  'checkMathAnswer',
];

describe('the model constant', () => {
  it('is the model VoiceCommon would pick by default, and a current one', () => {
    expect(GEMINI_LIVE_MODEL).toBe('gemini-3.8-live');
    expect(getLiveModelInfo(GEMINI_LIVE_MODEL)?.status).toBe('current');
    expect(GEMINI_LIVE_MODEL).toBe(DEFAULT_LIVE_MODEL);
  });

  it('thinking is left to the registry on every path', () => {
    expect(CARBOT_LIVE_THINKING).toBe('auto');
  });
});

describe('conversation config (useCarbotSession → useSession)', () => {
  it('is exactly this for a chosen voice', () => {
    expect(buildCarbotLiveConnectConfig({ systemInstruction: INSTRUCTION, selectedVoice: 'Kore' })).toEqual({
      systemInstruction: { parts: [{ text: INSTRUCTION }] },
      responseModalities: ['AUDIO'],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: [...allKnowledgeTools, ...allMathGameTools, endSessionTool()] }],
      realtimeInputConfig: SERVER_VAD_DEFAULTS,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      sessionResumption: {},
      contextWindowCompression: { slidingWindow: {} },
    });
  });

  it('sends no thinkingConfig: the model rejects one (close 1007)', () => {
    const config = buildCarbotLiveConnectConfig({ systemInstruction: INSTRUCTION, selectedVoice: 'Kore' });
    expect(config).not.toHaveProperty('thinkingConfig');
    expect(resolveThinkingConfig(GEMINI_LIVE_MODEL, CARBOT_LIVE_THINKING)).toBeUndefined();
  });

  it("'auto' gives the same config the hand-set 'none' used to", () => {
    // Until voice-common 0.16.0 CarBot passed thinkingLevel: 'none' itself.
    const base = {
      model: GEMINI_LIVE_MODEL,
      systemInstruction: INSTRUCTION,
      tools: CARBOT_LIVE_TOOLS,
      speechConfig: carbotSpeechConfig('Kore'),
    };
    expect(buildLiveConnectConfig({ ...base, thinkingLevel: 'auto' })).toEqual(
      buildLiveConnectConfig({ ...base, thinkingLevel: 'none' }),
    );
    expect(buildCarbotLiveConnectConfig({ systemInstruction: INSTRUCTION, selectedVoice: 'Kore' })).toEqual(
      buildLiveConnectConfig({ ...base, thinkingLevel: 'none' }),
    );
  });

  it('omits speechConfig when the profile has no voice (model default voice)', () => {
    for (const selectedVoice of [undefined, null, '']) {
      expect(buildCarbotLiveConnectConfig({ systemInstruction: INSTRUCTION, selectedVoice })).not.toHaveProperty(
        'speechConfig',
      );
    }
    expect(carbotSpeechConfig(undefined)).toBeUndefined();
  });

  it('uses server VAD with defaults: no manual turn control, no silence override', () => {
    const { realtimeInputConfig } = buildCarbotLiveConnectConfig({ systemInstruction: INSTRUCTION });
    expect(realtimeInputConfig).toEqual(SERVER_VAD_DEFAULTS);
    expect(realtimeInputConfig?.automaticActivityDetection).not.toHaveProperty('disabled');
    expect(realtimeInputConfig?.automaticActivityDetection).not.toHaveProperty('silenceDurationMs');
  });

  it('carries a resumption handle on a reconnect', () => {
    expect(
      buildCarbotLiveConnectConfig({ systemInstruction: INSTRUCTION, resumptionHandle: 'handle-1' }).sessionResumption,
    ).toEqual({ handle: 'handle-1' });
  });

  it('declares exactly the nine app tools, and endSession is appended last', () => {
    expect(CARBOT_LIVE_TOOLS.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
    const declared = buildCarbotLiveConnectConfig({ systemInstruction: INSTRUCTION }).tools?.flatMap(
      (t) => ('functionDeclarations' in t ? t.functionDeclarations ?? [] : []).map((d) => d.name),
    );
    expect(declared).toEqual([...EXPECTED_TOOL_NAMES, END_SESSION_TOOL_NAME]);
  });

  it('every declared tool is dispatched by the hook, and nothing else is', () => {
    const hook = fs.readFileSync(path.join(ROOT, 'src/hooks/useCarbotSession.ts'), 'utf8');
    const dispatched = [...hook.matchAll(/case '([A-Za-z]+)':/g)].map((m) => m[1]);
    expect(dispatched.sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it('session options are the ones the hook spreads into useSession', () => {
    expect(carbotLiveSessionOptions({ selectedVoice: 'Puck' })).toEqual({
      liveModel: GEMINI_LIVE_MODEL,
      thinkingLevel: 'auto',
      tools: CARBOT_LIVE_TOOLS,
      autoGreetText: CARBOT_AUTO_GREET_TEXT,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
    });
    expect(CARBOT_AUTO_GREET_TEXT).toMatch(/^\[Session started\./);
  });
});

describe('voice audition config (voicePreview.ts → ai.live.connect)', () => {
  it('is exactly this', () => {
    expect(buildVoicePreviewConnectConfig('Zephyr')).toEqual({
      systemInstruction: { parts: [{ text: VOICE_PREVIEW_INSTRUCTION }] },
      responseModalities: ['AUDIO'],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: SERVER_VAD_DEFAULTS,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
      sessionResumption: {},
      contextWindowCompression: { slidingWindow: {} },
    });
  });

  it("equals the shared builder's output for its inputs", () => {
    expect(buildVoicePreviewConnectConfig('Zephyr')).toEqual(
      buildLiveConnectConfig({
        model: GEMINI_LIVE_MODEL,
        systemInstruction: VOICE_PREVIEW_INSTRUCTION,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
        includeEndSessionTool: false,
      }),
    );
  });

  it('has no tools and no thinkingConfig (it once carried its own)', () => {
    const config = buildVoicePreviewConnectConfig('Zephyr');
    expect(config).not.toHaveProperty('tools');
    expect(config).not.toHaveProperty('thinkingConfig');
  });

  it('asks for one fixed sentence', () => {
    expect(voicePreviewPrompt('Zoomer')).toBe('Say exactly this, warmly: "Hi! I\'m Zoomer."');
  });
});

describe('diagnostics probe setup (liveProbe.ts → raw WebSocket)', () => {
  it('names the production model and sends only what that model accepts', () => {
    expect(buildLiveSetupMessage()).toEqual({
      setup: {
        model: `models/${GEMINI_LIVE_MODEL}`,
        generationConfig: { responseModalities: ['AUDIO'] },
      },
    });
  });

  it('takes thinkingConfig from the registry, like the other paths', () => {
    const fromRegistry = resolveThinkingConfig(GEMINI_LIVE_MODEL, 'auto');
    expect(buildLiveSetupMessage().setup.generationConfig.thinkingConfig).toEqual(fromRegistry);
  });

  it('builds the ephemeral-token WebSocket URL the SDK would', () => {
    expect(CARBOT_LIVE_API_VERSION).toBe(LIVE_API_VERSION);
    expect(liveWebSocketUrl('auth_tokens/abc123')).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.' +
        `${LIVE_API_VERSION}.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens/abc123`,
    );
  });

  it('refuses anything that is not an ephemeral token (never a long-lived key in a URL)', () => {
    expect(() => liveWebSocketUrl('not-a-token')).toThrow(/ephemeral token/);
    expect(() => liveWebSocketUrl('')).toThrow(/ephemeral token/);
  });
});
