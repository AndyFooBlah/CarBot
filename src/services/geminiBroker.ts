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
 * Client-side wrappers for the server-side Gemini broker callables.
 *
 * The browser never holds GEMINI_API_KEY. To talk to Gemini:
 *   - Live (WebSocket): mint a single-use ephemeral token via
 *     mintGeminiLiveToken(), then pass it as the `apiKey` to GoogleGenAI's
 *     live.connect(). The token expires in ~30 minutes. The Live model id is
 *     GEMINI_LIVE_MODEL below; the configs are built in liveConfig.ts.
 *   - Non-realtime text: call invokeGemini() instead of constructing a
 *     GoogleGenAI client. Returns the same `{ text, candidates, usageMetadata }`
 *     shape as the SDK's response so callers don't need other changes.
 *
 * Both callables are per-user rate-limited on the server. See
 * functions/src/liveToken.ts and functions/src/invokeGemini.ts.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '@andyfooblah/voice-common';

/**
 * The one Gemini text model the browser names directly (schedule parsing in
 * SettingsPage). Must be in the server allow-list; keep in sync with
 * `FLASH_MODEL` in functions/src/models.ts (verified 2026-09-10).
 */
export const GEMINI_FLASH_MODEL = 'gemini-3.8-flash';

/**
 * The Gemini Live model. This is the ONLY place the id is written: every Live
 * path in the browser (the conversation, the Settings voice audition, the
 * /diagnostics probe) reads this constant and builds its config in
 * services/liveConfig.ts. The server does not name a Live model at all (the
 * ephemeral token is unconstrained, see functions/src/liveTokenConfig.ts).
 *
 * Do not add a thinking level, or any other per-model setting, next to it:
 * VoiceCommon's model registry derives what each model accepts, and
 * liveConfig.ts asks it (`thinkingLevel: 'auto'`).
 *
 * Before changing the id: check it against the provider's model list, then
 * run `npm run test:live` (README, "Testing"). src/__tests__/liveModelGuard.test.ts
 * fails if the id appears anywhere else, if it is not a current model in
 * VoiceCommon's registry, or if VoiceCommon's default has moved past it.
 */
export const GEMINI_LIVE_MODEL = 'gemini-3.8-live';

export interface MintGeminiLiveTokenResponse {
  token: string;
  expireTime: string;
}

export async function mintGeminiLiveToken(): Promise<MintGeminiLiveTokenResponse> {
  const fn = httpsCallable<void, MintGeminiLiveTokenResponse>(
    functions,
    'mintGeminiLiveToken',
  );
  const res = await fn();
  return res.data;
}

export interface InvokeGeminiRequest {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
}

export interface InvokeGeminiResponse {
  text: string;
  candidates: unknown;
  usageMetadata?: unknown;
}

export async function invokeGemini(
  req: InvokeGeminiRequest,
): Promise<InvokeGeminiResponse> {
  const fn = httpsCallable<InvokeGeminiRequest, InvokeGeminiResponse>(
    functions,
    'invokeGemini',
  );
  const res = await fn(req);
  return res.data;
}

export interface EmbedGeminiRequest {
  model: string;
  contents: string[];
}

export interface EmbedGeminiResponse {
  embeddings: number[][];
}

export async function embedGemini(
  req: EmbedGeminiRequest,
): Promise<EmbedGeminiResponse> {
  const fn = httpsCallable<EmbedGeminiRequest, EmbedGeminiResponse>(
    functions,
    'embedGemini',
  );
  const res = await fn(req);
  return res.data;
}
