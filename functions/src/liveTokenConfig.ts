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
 * What `mintGeminiLiveToken` asks the provider for, as pure data.
 *
 * Kept free of Firebase imports so the root test suite can import it: the
 * offline tests pin these values, and the live suite (`npm run test:live`)
 * mints a token with exactly this request and opens a Live session with the
 * browser's real connect config, so the broker's half of the production path
 * is exercised against the real API.
 *
 * The token deliberately carries NO `liveConnectConstraints`: it does not
 * name a Live model, so the server cannot drift from the browser's
 * `GEMINI_LIVE_MODEL` (src/services/geminiBroker.ts). If a model constraint
 * is ever added here, src/__tests__/liveModelGuard.test.ts must be changed to
 * assert it equals that constant.
 */

/**
 * API version `authTokens.create` is called on. The SDK defaults to v1,
 * which returns 404 for this method.
 * See https://ai.google.dev/gemini-api/docs/ephemeral-tokens
 */
export const LIVE_TOKEN_API_VERSION = 'v1alpha';

/** How long the minted token is valid before Gemini rejects it. */
export const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** How long after minting the token may be used to open a new session. */
export const NEW_SESSION_WINDOW_MS = 60 * 1000; // 1 minute

export interface LiveTokenCreateConfig {
  /** One Live session per token. */
  uses: 1;
  /** ISO timestamp when the Live session expires. */
  expireTime: string;
  /** ISO timestamp after which the token can no longer open a session. */
  newSessionExpireTime: string;
}

/** The `config` passed to `ai.authTokens.create` for a token minted at `nowMs`. */
export function liveTokenCreateConfig(nowMs: number): LiveTokenCreateConfig {
  return {
    uses: 1,
    expireTime: new Date(nowMs + TOKEN_TTL_MS).toISOString(),
    newSessionExpireTime: new Date(nowMs + NEW_SESSION_WINDOW_MS).toISOString(),
  };
}
