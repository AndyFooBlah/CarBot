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
 * liveConfig — the one place CarBot's Gemini Live configuration is assembled.
 *
 * CarBot opens a Live session from three places:
 *
 *   1. the conversation   hooks/useCarbotSession.ts, through VoiceCommon's
 *                         `useSession` (server VAD, all defaults)
 *   2. the voice audition services/voicePreview.ts, a direct
 *                         `ai.live.connect` from the Settings page
 *   3. the diagnostics    services/liveProbe.ts, a raw WebSocket setup from
 *      probe              the /diagnostics page
 *
 * Every one of them takes the model from `GEMINI_LIVE_MODEL`
 * (services/geminiBroker.ts, the only file that spells the id) and builds its
 * config here, through VoiceCommon's `buildLiveConnectConfig` /
 * `resolveThinkingConfig`. Those derive what the model accepts (for example
 * whether `thinkingConfig` must be sent or must be omitted) from VoiceCommon's
 * model registry, so changing the model id is a one-line change that cannot
 * leave one path sending a config the new model rejects.
 *
 * The test suites import the same functions:
 *   - src/__tests__/liveConfig.test.ts and friends pin the exact configs;
 *   - src/__tests__/live/*.live.test.ts (`npm run test:live`) send them to the
 *     real Gemini Live API.
 *
 * This module is pure: no Firebase, no DOM, no network.
 */

import type { FunctionDeclaration, LiveConnectConfig, SpeechConfig, ThinkingConfig } from '@google/genai';
import {
  LIVE_API_VERSION,
  buildLiveConnectConfig,
  resolveThinkingConfig,
} from '@andyfooblah/voice-common';
import type { ThinkingRequest } from '@andyfooblah/voice-common';
import { allKnowledgeTools } from '@andyfooblah/knowledge-common';
import { allMathGameTools } from './mathGames';
import { GEMINI_LIVE_MODEL } from './geminiBroker';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Thinking is left to VoiceCommon: `'auto'` sends whatever the model in
 * `GEMINI_LIVE_MODEL` needs (for the current model that is nothing at all: it
 * rejects the field). Do not hand-set a level per path.
 */
export const CARBOT_LIVE_THINKING: ThinkingRequest = 'auto';

/** API version the browser opens the Live WebSocket on (VoiceCommon's pin). */
export const CARBOT_LIVE_API_VERSION = LIVE_API_VERSION;

/** `speechConfig` for a prebuilt voice, or undefined for the model default. */
export function carbotSpeechConfig(voiceName: string | null | undefined): SpeechConfig | undefined {
  return voiceName ? { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } : undefined;
}

// ---------------------------------------------------------------------------
// 1. The conversation (useCarbotSession → VoiceCommon useSession)
// ---------------------------------------------------------------------------

/** Every tool the conversation declares. VoiceCommon appends `endSession`. */
export const CARBOT_LIVE_TOOLS: FunctionDeclaration[] = [...allKnowledgeTools, ...allMathGameTools];

/** Bracketed system cue that makes the bot take the first turn. */
export const CARBOT_AUTO_GREET_TEXT =
  '[Session started. Please greet the family and begin the conversation as described in your instructions.]';

/**
 * The Live-related options `useCarbotSession` passes to `useSession`.
 *
 * Turn-taking is deliberately absent: CarBot uses server VAD with VoiceCommon's
 * defaults, so `manualTurnControl`, `endOfSpeechSilenceMs` and
 * `endOfSpeechSensitivity` are not set.
 */
export interface CarbotLiveSessionOptions {
  liveModel: string;
  thinkingLevel: ThinkingRequest;
  tools: FunctionDeclaration[];
  autoGreetText: string;
  speechConfig: SpeechConfig | undefined;
}

export function carbotLiveSessionOptions(profile: { selectedVoice?: string | null }): CarbotLiveSessionOptions {
  return {
    liveModel: GEMINI_LIVE_MODEL,
    thinkingLevel: CARBOT_LIVE_THINKING,
    tools: CARBOT_LIVE_TOOLS,
    autoGreetText: CARBOT_AUTO_GREET_TEXT,
    speechConfig: carbotSpeechConfig(profile.selectedVoice),
  };
}

/**
 * The exact `config` VoiceCommon's `useSession` sends to `ai.live.connect`
 * for a CarBot conversation: `useSession` calls `buildLiveConnectConfig` with
 * the options above, and so does this function. The live suite sends the
 * result to the real API.
 */
export function buildCarbotLiveConnectConfig(params: {
  systemInstruction: string;
  selectedVoice?: string | null;
  /** Session-resumption handle on a reconnect; absent on a fresh session. */
  resumptionHandle?: string | null;
}): LiveConnectConfig {
  const options = carbotLiveSessionOptions({ selectedVoice: params.selectedVoice });
  return buildLiveConnectConfig({
    model: options.liveModel,
    systemInstruction: params.systemInstruction,
    tools: options.tools,
    thinkingLevel: options.thinkingLevel,
    speechConfig: options.speechConfig,
    resumptionHandle: params.resumptionHandle,
  });
}

// ---------------------------------------------------------------------------
// 2. The Settings voice audition (voicePreview.ts → ai.live.connect)
// ---------------------------------------------------------------------------

/** System instruction for the one-line voice audition. */
export const VOICE_PREVIEW_INSTRUCTION = 'You are a friendly AI assistant. Speak naturally and warmly.';

/** The single text cue the audition sends. */
export function voicePreviewPrompt(botName: string): string {
  return `Say exactly this, warmly: "Hi! I'm ${botName}."`;
}

/**
 * The exact `config` `previewVoice` passes to `ai.live.connect`: the same
 * model and builder as a conversation, with the chosen voice, no tools and no
 * `endSession` (nothing handles tool calls on this path).
 */
export function buildVoicePreviewConnectConfig(voiceName: string): LiveConnectConfig {
  return buildLiveConnectConfig({
    model: GEMINI_LIVE_MODEL,
    systemInstruction: VOICE_PREVIEW_INSTRUCTION,
    thinkingLevel: CARBOT_LIVE_THINKING,
    speechConfig: carbotSpeechConfig(voiceName),
    includeEndSessionTool: false,
  });
}

// ---------------------------------------------------------------------------
// 3. The /diagnostics probe (liveProbe.ts → raw WebSocket)
// ---------------------------------------------------------------------------

/** The first frame of a raw Live WebSocket session. */
export interface LiveSetupMessage {
  setup: {
    model: string;
    generationConfig: {
      responseModalities: string[];
      thinkingConfig?: ThinkingConfig;
    };
  };
}

/**
 * Minimal `setup` frame for the diagnostics probe: the production model and
 * audio output, plus whatever `thinkingConfig` that model requires. A setup
 * the model rejects closes the socket (code 1007) instead of answering
 * `setupComplete`, which is exactly what the probe is there to show.
 */
export function buildLiveSetupMessage(): LiveSetupMessage {
  const thinkingConfig = resolveThinkingConfig(GEMINI_LIVE_MODEL, CARBOT_LIVE_THINKING);
  return {
    setup: {
      model: `models/${GEMINI_LIVE_MODEL}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    },
  };
}

/**
 * WebSocket URL for a Live session authenticated with an ephemeral token
 * (`auth_tokens/...` from `mintGeminiLiveToken`). Mirrors what @google/genai
 * builds for such a token: the `Constrained` method and an `access_token`
 * query parameter. A long-lived API key must never reach this function.
 */
export function liveWebSocketUrl(ephemeralToken: string): string {
  if (!ephemeralToken.startsWith('auth_tokens/')) {
    throw new Error('liveWebSocketUrl expects an ephemeral token minted by the broker.');
  }
  return (
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.' +
    `${CARBOT_LIVE_API_VERSION}.GenerativeService.BidiGenerateContentConstrained` +
    `?access_token=${ephemeralToken}`
  );
}
