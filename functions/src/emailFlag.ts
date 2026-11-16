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
 * The single switch for every email feature (issue #36).
 *
 * `EMAIL_FEATURES_ENABLED` lives in `functions/.env` (committed; not a
 * secret). When it is anything other than the string "true":
 *
 *   - `ingestEmailsScheduled` is not exported from index.ts, so it is not
 *     deployed and its Cloud Scheduler job does not exist;
 *   - `sendSessionSummaryEmail` and the `sendSummaryEmailForSession` callable
 *     log one line and return without touching Gemini or Gmail;
 *   - the web build (vite.config.ts) marks the email UI as "currently off".
 *
 * This module is deliberately free of Firebase imports: vite.config.ts and
 * the root vitest suite import it, and neither installs functions/ deps. The
 * param declaration that makes the flag visible in the functions config is
 * in sessionSummaryEmail.ts.
 *
 * Two readers, because the value reaches the code by two routes:
 *
 *   - At RUNTIME firebase-tools has copied `functions/.env` into the
 *     function's environment, so `emailFeaturesEnabled()` reads process.env.
 *   - At DEPLOY-TIME DISCOVERY (when firebase-tools loads index.js to list
 *     what to deploy) dotenv values are NOT in the environment (verified
 *     against firebase-tools 15.17: discovery only receives FIREBASE_CONFIG
 *     and GCLOUD_PROJECT). Deciding whether to export the scheduled function
 *     therefore falls back to reading `functions/.env` directly:
 *     `emailFeaturesEnabledAtLoad()`. The Vite build uses the same function.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const EMAIL_FLAG = 'EMAIL_FEATURES_ENABLED';

type Env = Record<string, string | undefined>;

/** Only the exact string "true" enables email; unset, empty, "1", "TRUE" do not. */
function isOn(value: string | undefined): boolean {
  return value === 'true';
}

/** Runtime check. Default (unset) is OFF. */
export function emailFeaturesEnabled(env: Env = process.env): boolean {
  return isOn(env[EMAIL_FLAG]);
}

/**
 * Value of EMAIL_FEATURES_ENABLED in dotenv text, or undefined if absent.
 * Understands the subset firebase-tools writes and we commit: `KEY=value`
 * lines, optional surrounding quotes, `#` comments. The last assignment wins.
 */
export function readFlagFromDotenv(text: string): string | undefined {
  let found: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || m[1] !== EMAIL_FLAG) continue;
    let value = m[2].trim();
    const quoted = value.match(/^(["'])(.*)\1$/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '').trim();
    found = value;
  }
  return found;
}

/** `functions/.env`, resolved from functions/src (ts) or functions/lib (js). */
function readFunctionsDotenv(): string {
  return readFileSync(join(__dirname, '..', '.env'), 'utf8');
}

/**
 * Module-load / build-time check: the environment wins when it has the
 * variable, otherwise `functions/.env` is read. A missing or unreadable file
 * means OFF.
 */
export function emailFeaturesEnabledAtLoad(
  env: Env = process.env,
  readDotenv: () => string = readFunctionsDotenv,
): boolean {
  if (env[EMAIL_FLAG] !== undefined) return isOn(env[EMAIL_FLAG]);
  try {
    return isOn(readFlagFromDotenv(readDotenv()));
  } catch {
    return false;
  }
}

/** The one log line every disabled email path writes. */
export function emailDisabledMessage(what: string): string {
  return `[email] ${EMAIL_FLAG} is off — skipping ${what} (email features are disabled, issue #36)`;
}
