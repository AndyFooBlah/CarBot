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
 * Vitest config for the LIVE suite: `npm run test:live`.
 *
 * These tests open real Gemini Live sessions with CarBot's production
 * configuration. They self-skip (green) unless GEMINI_API_KEY is set in the
 * environment, run in Node (no jsdom), one file at a time so parallel
 * sessions do not trip rate limits or skew latency, and are excluded from
 * `npm test`. See README.md, "Testing".
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/__tests__/live/setup.live.ts'],
    include: ['src/__tests__/live/**/*.live.test.ts'],
    fileParallelism: false,
    // Always print the one-line result of every check, and the safety
    // transcripts, for passing tests too.
    silent: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // A network blip should not fail the run; a real break fails twice.
    retry: 1,
  },
});
