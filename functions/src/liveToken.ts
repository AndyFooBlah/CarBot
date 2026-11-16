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
 * mintGeminiLiveToken — server-side minting of short-lived Gemini Live tokens.
 *
 * Clients must never see the real GEMINI_API_KEY. Before opening a Gemini
 * Live WebSocket, signed-in users call this callable to obtain an ephemeral
 * token scoped to a single Live session with a ~30 minute expiry. Once the
 * session is opened (or the token expires), the token is useless.
 *
 * Defences:
 *   - A bundled static API key can be harvested from a page's JavaScript and
 *     replayed indefinitely. An ephemeral token is single-use and short-lived,
 *     so even if a client exposes it, the blast radius is one session.
 *   - A per-user rate limit (`mintGeminiLiveToken` bucket) stops a compromised
 *     account from minting unlimited tokens.
 */

import { GoogleGenAI } from '@google/genai';
import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { enforceRateLimit } from './rateLimit';
import { LIVE_TOKEN_API_VERSION, liveTokenCreateConfig } from './liveTokenConfig';

export interface MintGeminiLiveTokenResponse {
  /** Ephemeral token string to pass as the `apiKey` field on the client Live connect. */
  token: string;
  /** ISO timestamp when the Live session expires. Clients should reconnect before this. */
  expireTime: string;
}

export function buildMintGeminiLiveTokenHandler(deps: {
  apiKey: () => string;
}) {
  return async (request: CallableRequest): Promise<MintGeminiLiveTokenResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    await enforceRateLimit(request.auth.uid, 'mintGeminiLiveToken');

    const apiKey = deps.apiKey();
    if (!apiKey) {
      throw new HttpsError('internal', 'GEMINI_API_KEY is not configured on this server.');
    }

    // The request (single use, 30-minute session, 1-minute window to open it,
    // no model constraint) and the API version live in liveTokenConfig.ts so
    // the tests can pin them and the live suite can mint the same token.
    const config = liveTokenCreateConfig(Date.now());
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: LIVE_TOKEN_API_VERSION } });
    try {
      const token = await ai.authTokens.create({ config });
      if (!token?.name) {
        throw new Error('authTokens.create returned empty token');
      }
      return { token: token.name, expireTime: config.expireTime };
    } catch (err) {
      logger.error('[mintGeminiLiveToken] Failed to mint token', err);
      throw new HttpsError('internal', 'Failed to mint Gemini Live token.');
    }
  };
}
