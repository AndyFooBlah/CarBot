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
 * invokeGemini — generic server-side proxy for `ai.models.generateContent`.
 *
 * The client no longer holds the Gemini API key; instead it POSTs the same
 * params shape (`{ model, contents, config }`) to this callable and gets the
 * response back. GEMINI_API_KEY lives only in Firebase Secret Manager.
 *
 * Request must come from a signed-in user. Each call is rate-limited so a
 * compromised account cannot rack up arbitrary bills. The model allow-list
 * keeps callers off very expensive tiers that aren't used in production.
 *
 * For Live-API WebSocket sessions the equivalent is `mintGeminiLiveToken`
 * (liveToken.ts) — that one issues a single-use ephemeral token instead of
 * proxying every audio frame.
 */

import { GoogleGenAI } from '@google/genai';
import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { enforceRateLimit } from './rateLimit';
import { FLASH_MODEL, FLASH_LITE_MODEL } from './models';
import { KID_SAFETY_SETTINGS } from './safety';

/**
 * Models the client is allowed to invoke through the proxy. Keep this tight
 * — any model in this list can be invoked with arbitrary params by any
 * signed-in user (subject to the rate limit), so only include what our
 * features actually need.
 */
const ALLOWED_MODELS = new Set<string>([
  'gemini-3.1-pro-preview',
  FLASH_MODEL,
  FLASH_LITE_MODEL,
  'gemini-2.5-flash',
  'gemini-embedding-001',
]);


/**
 * The only `config` keys a client may set. Everything else is dropped before
 * the SDK sees it. Add a key only after checking it cannot change where the
 * request goes, what credentials it carries, or what the server fetches.
 * (`safetySettings` is not here on purpose: the server sets it below.)
 */
export const ALLOWED_CONFIG_KEYS = [
  'thinkingConfig',
  'temperature',
  'topP',
  'topK',
  'seed',
  'candidateCount',
  'maxOutputTokens',
  'stopSequences',
  'responseMimeType',
  'responseSchema',
  'responseJsonSchema',
  'systemInstruction',
] as const;

/** Cap output tokens to bound the worst-case cost of a single call. */
const MAX_OUTPUT_TOKENS_CEILING = 32_768;

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

export function buildInvokeGeminiHandler(deps: {
  apiKey: () => string;
}) {
  return async (request: CallableRequest): Promise<InvokeGeminiResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const uid = request.auth.uid;
    await enforceRateLimit(uid, 'invokeGemini');

    const { model, contents, config } = (request.data ?? {}) as Partial<InvokeGeminiRequest>;
    if (typeof model !== 'string' || !model) {
      throw new HttpsError('invalid-argument', 'model is required.');
    }
    if (!ALLOWED_MODELS.has(model)) {
      throw new HttpsError('permission-denied', `Model ${model} is not allowed.`);
    }
    if (contents === undefined || contents === null) {
      throw new HttpsError('invalid-argument', 'contents is required.');
    }

    // SECURITY: copy ONLY allow-listed generation settings. Never spread the
    // client's config object. `config.httpOptions.baseUrl` is honoured per
    // request by @google/genai, and the SDK still attaches
    // `x-goog-api-key: <GEMINI_API_KEY>` to whatever host it names — so a
    // caller who could set it would be handed the production key (found in
    // LegacyBot's identical broker, 2026-11-15, reproduced with a dummy key).
    // `tools` is excluded too: no client needs server-side tools.
    const safeConfig: Record<string, unknown> = {};
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      for (const key of ALLOWED_CONFIG_KEYS) {
        if (Object.prototype.hasOwnProperty.call(config, key)) {
          safeConfig[key] = (config as Record<string, unknown>)[key];
        }
      }
    }
    if (typeof safeConfig.candidateCount === 'number' && safeConfig.candidateCount > 1) {
      safeConfig.candidateCount = 1;
    }
    // Child-facing product: the strictest safety settings are enforced here
    // for every proxied call — a client cannot loosen them (#33).
    safeConfig.safetySettings = [...KID_SAFETY_SETTINGS];
    if (
      typeof safeConfig.maxOutputTokens === 'number' &&
      safeConfig.maxOutputTokens > MAX_OUTPUT_TOKENS_CEILING
    ) {
      safeConfig.maxOutputTokens = MAX_OUTPUT_TOKENS_CEILING;
    }

    const apiKey = deps.apiKey();
    if (!apiKey) {
      throw new HttpsError('internal', 'GEMINI_API_KEY is not configured on this server.');
    }

    const ai = new GoogleGenAI({ apiKey });
    try {
      const response = await ai.models.generateContent({
        model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contents: contents as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: safeConfig as any,
      });
      return {
        text: response.text ?? '',
        candidates: response.candidates ?? [],
        usageMetadata: response.usageMetadata,
      };
    } catch (err: unknown) {
      logger.error('[invokeGemini] Gemini call failed', {
        uid,
        model,
        err: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('internal', 'Gemini call failed.');
    }
  };
}
