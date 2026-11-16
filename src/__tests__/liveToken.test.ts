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
 * The server half of the Live path: what `mintGeminiLiveToken` asks for.
 *
 * functions/src/liveTokenConfig.ts has no Firebase imports, so it is tested
 * from the root suite (functions/ has no test runner of its own). The live
 * suite mints a real token with the same request.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  LIVE_TOKEN_API_VERSION,
  NEW_SESSION_WINDOW_MS,
  TOKEN_TTL_MS,
  liveTokenCreateConfig,
} from '../../functions/src/liveTokenConfig';

const ROOT = path.resolve(__dirname, '..', '..');
const NOW = Date.UTC(2026, 10, 15, 12, 0, 0); // 2026-11-15T12:00:00Z

describe('liveTokenCreateConfig', () => {
  it('asks for a single-use token: 30-minute session, 60 seconds to open it', () => {
    expect(liveTokenCreateConfig(NOW)).toEqual({
      uses: 1,
      expireTime: '2026-11-15T12:30:00.000Z',
      newSessionExpireTime: '2026-11-15T12:01:00.000Z',
    });
    expect(TOKEN_TTL_MS).toBe(30 * 60 * 1000);
    expect(NEW_SESSION_WINDOW_MS).toBe(60 * 1000);
  });

  it('does not constrain the token to a model or a config', () => {
    // Nothing here can disagree with the browser's GEMINI_LIVE_MODEL.
    expect(Object.keys(liveTokenCreateConfig(NOW)).sort()).toEqual(['expireTime', 'newSessionExpireTime', 'uses']);
  });

  it('mints on the API version that serves authTokens.create', () => {
    expect(LIVE_TOKEN_API_VERSION).toBe('v1alpha');
  });
});

describe('mintGeminiLiveToken (functions/src/liveToken.ts)', () => {
  const source = fs.readFileSync(path.join(ROOT, 'functions/src/liveToken.ts'), 'utf8');

  it('mints with exactly that request and API version', () => {
    expect(source).toMatch(/const config = liveTokenCreateConfig\(Date\.now\(\)\);/);
    expect(source).toMatch(/httpOptions: \{ apiVersion: LIVE_TOKEN_API_VERSION \}/);
    expect(source).toMatch(/ai\.authTokens\.create\(\{ config \}\)/);
  });

  it('requires a signed-in caller and applies the per-user rate limit before minting', () => {
    const auth = source.indexOf("throw new HttpsError('unauthenticated'");
    const limit = source.indexOf("enforceRateLimit(request.auth.uid, 'mintGeminiLiveToken')");
    const mint = source.indexOf('ai.authTokens.create');
    expect(auth).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(auth);
    expect(mint).toBeGreaterThan(limit);
  });
});
