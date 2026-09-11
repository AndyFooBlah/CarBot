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
 * Gemini model IDs used by CarBot's Cloud Functions — the single place these
 * live on the server. The client-side equivalent for the one model the
 * browser names directly is `GEMINI_FLASH_MODEL` in
 * `src/services/geminiBroker.ts`; keep the two in sync.
 *
 * Verified against https://ai.google.dev/gemini-api/docs/models on
 * 2026-09-10. Google shuts preview models down with short notice and a
 * retired ID returns 404, so prefer stable IDs here and re-verify before
 * changing. The `probeModels` callable (probeModels.ts) sends a 1-token
 * prompt to every model in POST_SESSION_MODELS from the /diagnostics page so
 * a retired model shows up red instead of failing silently in the nightly
 * jobs (#32).
 */

/** Newest stable Flash — memory extraction, session summary, schedule parsing. */
export const FLASH_MODEL = 'gemini-3.8-flash';

/** Stable Flash-Lite — clean-transcript generation (large input, low reasoning). */
export const FLASH_LITE_MODEL = 'gemini-3.5-flash-lite';

/** Text embeddings for the Wikipedia RAG cache (still served; successor is gemini-embedding-2). */
export const EMBEDDING_MODEL = 'gemini-embedding-001';

/** Models exercised by the post-session pipeline; each is probed by `probeModels`. */
export const POST_SESSION_MODELS: readonly string[] = [FLASH_MODEL, FLASH_LITE_MODEL];
