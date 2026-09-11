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
 * probeModels — diagnostics callable that sends a 1-token prompt to every
 * model the post-session pipeline depends on (see models.ts) and reports
 * per-model reachability.
 *
 * Why: Google retires preview models with short notice and a retired ID
 * returns 404. The nightly jobs (cleanTranscript, memoryExtraction, summary
 * email) log the failure and move on, so a dead model can go unnoticed for
 * months (#32). The /diagnostics page calls this so the failure is visible.
 *
 * Auth required; one slot from the caller's daily `invokeGemini` bucket.
 */

import { GoogleGenAI } from '@google/genai';
import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { enforceRateLimit } from './rateLimit';
import { POST_SESSION_MODELS } from './models';

export interface ModelProbeResult {
  model: string;
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

export interface ProbeModelsResponse {
  results: ModelProbeResult[];
}

export function buildProbeModelsHandler(deps: { apiKey: () => string }) {
  return async (request: CallableRequest): Promise<ProbeModelsResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    await enforceRateLimit(request.auth.uid, 'invokeGemini');

    const apiKey = deps.apiKey();
    if (!apiKey) {
      throw new HttpsError('internal', 'GEMINI_API_KEY is not configured on this server.');
    }
    const ai = new GoogleGenAI({ apiKey });

    const results = await Promise.all(
      POST_SESSION_MODELS.map(async (model): Promise<ModelProbeResult> => {
        const start = Date.now();
        try {
          await ai.models.generateContent({
            model,
            contents: 'Reply with the single word OK.',
            // Thinking models may spend the budget before emitting text; we
            // only care that the request is accepted (a retired model 404s).
            config: { maxOutputTokens: 1, temperature: 0 },
          });
          return { model, ok: true, latencyMs: Date.now() - start, error: null };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn('[probeModels] model probe failed', { model, err: message });
          return { model, ok: false, latencyMs: Date.now() - start, error: message.slice(0, 300) };
        }
      }),
    );

    return { results };
  };
}
