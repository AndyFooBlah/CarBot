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

// @vitest-environment node

/**
 * Tests for the single email switch, EMAIL_FEATURES_ENABLED (#36).
 *
 * The module lives in functions/src but has no Firebase imports, so it is
 * exercised from the root vitest suite (the same arrangement as
 * retentionPolicy). It decides three things: whether the scheduled Gmail
 * ingestion function is exported at all, whether the summary-email paths
 * run, and (through vite.config.ts) whether the web UI offers email.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EMAIL_FLAG,
  emailFeaturesEnabled,
  emailFeaturesEnabledAtLoad,
  readFlagFromDotenv,
  emailDisabledMessage,
} from '../../functions/src/emailFlag';

describe('emailFeaturesEnabled (runtime check)', () => {
  it('is OFF when the variable is unset — the default', () => {
    expect(emailFeaturesEnabled({})).toBe(false);
  });

  it('is ON only for the exact string "true"', () => {
    expect(emailFeaturesEnabled({ [EMAIL_FLAG]: 'true' })).toBe(true);
  });

  it.each(['false', '', '1', 'TRUE', 'True', 'yes', 'on', ' true'])('is OFF for %j', (value) => {
    expect(emailFeaturesEnabled({ [EMAIL_FLAG]: value })).toBe(false);
  });
});

describe('readFlagFromDotenv', () => {
  it('reads a plain assignment in either state', () => {
    expect(readFlagFromDotenv('EMAIL_FEATURES_ENABLED=true\n')).toBe('true');
    expect(readFlagFromDotenv('EMAIL_FEATURES_ENABLED=false\n')).toBe('false');
  });

  it('ignores comments, blank lines and other keys', () => {
    const text = [
      '# EMAIL_FEATURES_ENABLED=true (commented out)',
      '',
      'OTHER_EMAIL_FEATURES_ENABLED=true',
      'EMAIL_FEATURES_ENABLED_X=true',
      'SOMETHING=1',
    ].join('\n');
    expect(readFlagFromDotenv(text)).toBeUndefined();
  });

  it('handles quotes, spaces, CRLF, export and trailing comments', () => {
    expect(readFlagFromDotenv('EMAIL_FEATURES_ENABLED="true"')).toBe('true');
    expect(readFlagFromDotenv("EMAIL_FEATURES_ENABLED='true'")).toBe('true');
    expect(readFlagFromDotenv('EMAIL_FEATURES_ENABLED = true\r\nX=1\r\n')).toBe('true');
    expect(readFlagFromDotenv('export EMAIL_FEATURES_ENABLED=true')).toBe('true');
    expect(readFlagFromDotenv('EMAIL_FEATURES_ENABLED=false # parked, see #36')).toBe('false');
  });

  it('lets the last assignment win', () => {
    expect(readFlagFromDotenv('EMAIL_FEATURES_ENABLED=true\nEMAIL_FEATURES_ENABLED=false')).toBe('false');
  });
});

describe('emailFeaturesEnabledAtLoad (deploy discovery and web build)', () => {
  const dotenv = (text: string) => () => text;

  it('falls back to functions/.env when the environment has no value', () => {
    expect(emailFeaturesEnabledAtLoad({}, dotenv('EMAIL_FEATURES_ENABLED=true'))).toBe(true);
    expect(emailFeaturesEnabledAtLoad({}, dotenv('EMAIL_FEATURES_ENABLED=false'))).toBe(false);
  });

  it('prefers the environment over the file, in both directions', () => {
    const neverRead = vi.fn(() => 'EMAIL_FEATURES_ENABLED=true');
    expect(emailFeaturesEnabledAtLoad({ [EMAIL_FLAG]: 'false' }, neverRead)).toBe(false);
    expect(neverRead).not.toHaveBeenCalled();
    expect(emailFeaturesEnabledAtLoad({ [EMAIL_FLAG]: 'true' }, dotenv('EMAIL_FEATURES_ENABLED=false'))).toBe(true);
  });

  it('is OFF when the file does not mention the flag', () => {
    expect(emailFeaturesEnabledAtLoad({}, dotenv('# nothing here\n'))).toBe(false);
  });

  it('is OFF when the file cannot be read', () => {
    expect(
      emailFeaturesEnabledAtLoad({}, () => {
        throw new Error('ENOENT');
      }),
    ).toBe(false);
  });
});

describe('the committed functions/.env', () => {
  const committed = readFileSync(fileURLToPath(new URL('../../functions/.env', import.meta.url)), 'utf8');

  it('declares the flag explicitly (a non-interactive deploy fails without a value)', () => {
    expect(['true', 'false']).toContain(readFlagFromDotenv(committed));
  });

  it('holds only the email flag — it is committed to a public repo, so no secrets', () => {
    const keys = committed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('=')[0].trim());
    expect(keys).toEqual([EMAIL_FLAG]);
  });
});

describe('emailDisabledMessage', () => {
  it('names the flag and what was skipped', () => {
    const msg = emailDisabledMessage('summary email for session abc');
    expect(msg).toContain(EMAIL_FLAG);
    expect(msg).toContain('summary email for session abc');
  });
});
