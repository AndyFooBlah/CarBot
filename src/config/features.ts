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
 * Build-time feature switches for the web client.
 *
 * EMAIL_FEATURES_ENABLED mirrors the Cloud Functions switch of the same name.
 * It is NOT set here: vite.config.ts reads `functions/.env` at build time and
 * injects the value as `__EMAIL_FEATURES_ENABLED__`, so the functions and the
 * UI flip together from that one line. Anywhere the define is absent (vitest,
 * tooling) the value is `false`, matching the functions default.
 *
 * While it is false the UI must not promise email: Settings shows the recap
 * email preference as "Currently off" and Diagnostics hides the "Re-send
 * summary email" action. Import this constant for any new email UI.
 */
/* global __EMAIL_FEATURES_ENABLED__ -- injected by vite.config.ts, declared in vite-env.d.ts */
export const EMAIL_FEATURES_ENABLED: boolean =
  typeof __EMAIL_FEATURES_ENABLED__ !== 'undefined' && __EMAIL_FEATURES_ENABLED__ === true;
