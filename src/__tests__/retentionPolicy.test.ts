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
 * Tests for the pure audio-retention selection logic that the nightly
 * Cloud Function job uses (#34). The module lives in functions/src but has
 * no Firebase imports, so it is exercised from the root vitest suite.
 */

import { describe, it, expect } from 'vitest';
import {
  AUDIO_RETENTION_OPTIONS,
  DEFAULT_AUDIO_RETENTION_DAYS,
  resolveAudioRetentionDays,
  audioRetentionCutoffMs,
  selectSessionsForAudioPurge,
  audioObjectPath,
  objectPathFromDownloadUrl,
  type SessionAudioView,
} from '../../functions/src/retentionPolicy';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 10, 12, 0, 0); // 2026-09-10T12:00Z

function session(overrides: Partial<SessionAudioView> & { id: string; ageDays: number }): SessionAudioView {
  const { ageDays, ...rest } = overrides;
  const endTimeMs = NOW - ageDays * DAY;
  return {
    userId: 'u1',
    status: 'completed',
    audioUrl: 'https://firebasestorage.googleapis.com/v0/b/b/o/sessions%2Fu1%2Fx.webm?alt=media',
    startTimeMs: endTimeMs - 20 * 60 * 1000,
    endTimeMs,
    ...rest,
  };
}

describe('resolveAudioRetentionDays', () => {
  it('defaults to 90 days when unset or invalid (never silently "forever")', () => {
    expect(DEFAULT_AUDIO_RETENTION_DAYS).toBe(90);
    expect(resolveAudioRetentionDays(undefined)).toBe(90);
    expect(resolveAudioRetentionDays('forever')).toBe(90);
    expect(resolveAudioRetentionDays(0)).toBe(90);
    expect(resolveAudioRetentionDays(-5)).toBe(90);
    expect(resolveAudioRetentionDays(45)).toBe(90);
    expect(resolveAudioRetentionDays(NaN)).toBe(90);
  });

  it('accepts each allowed option, with null meaning forever', () => {
    for (const opt of AUDIO_RETENTION_OPTIONS) {
      expect(resolveAudioRetentionDays(opt)).toBe(opt);
    }
    expect(resolveAudioRetentionDays(null)).toBeNull();
  });
});

describe('audioRetentionCutoffMs', () => {
  it('is null for forever and now - N days otherwise', () => {
    expect(audioRetentionCutoffMs(null, NOW)).toBeNull();
    expect(audioRetentionCutoffMs(30, NOW)).toBe(NOW - 30 * DAY);
    expect(audioRetentionCutoffMs(365, NOW)).toBe(NOW - 365 * DAY);
  });
});

describe('selectSessionsForAudioPurge', () => {
  it('selects only sessions that ended strictly before the cutoff', () => {
    const sessions = [
      session({ id: 'old', ageDays: 91 }),
      session({ id: 'boundary', ageDays: 90 }),
      session({ id: 'fresh', ageDays: 10 }),
    ];
    const picked = selectSessionsForAudioPurge(sessions, 90, NOW).map((s) => s.id);
    expect(picked).toEqual(['old']);
  });

  it('respects the chosen window (30 / 365)', () => {
    const sessions = [
      session({ id: 'a', ageDays: 31 }),
      session({ id: 'b', ageDays: 100 }),
      session({ id: 'c', ageDays: 400 }),
    ];
    expect(selectSessionsForAudioPurge(sessions, 30, NOW).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(selectSessionsForAudioPurge(sessions, 365, NOW).map((s) => s.id)).toEqual(['c']);
  });

  it('selects nothing when retention is forever', () => {
    const sessions = [session({ id: 'ancient', ageDays: 5000 })];
    expect(selectSessionsForAudioPurge(sessions, null, NOW)).toEqual([]);
  });

  it('never touches an active session, even a stale one', () => {
    const sessions = [session({ id: 'stuck', ageDays: 200, status: 'active' })];
    expect(selectSessionsForAudioPurge(sessions, 30, NOW)).toEqual([]);
  });

  it('does include interrupted sessions', () => {
    const sessions = [session({ id: 'int', ageDays: 200, status: 'interrupted' })];
    expect(selectSessionsForAudioPurge(sessions, 90, NOW).map((s) => s.id)).toEqual(['int']);
  });

  it('skips sessions with no audio or already purged', () => {
    const sessions = [
      session({ id: 'noaudio', ageDays: 200, audioUrl: '' }),
      session({ id: 'nullaudio', ageDays: 200, audioUrl: null }),
      session({ id: 'purged', ageDays: 200, audioPurgedAtMs: NOW - DAY }),
      session({ id: 'due', ageDays: 200 }),
    ];
    expect(selectSessionsForAudioPurge(sessions, 90, NOW).map((s) => s.id)).toEqual(['due']);
  });

  it('falls back to startTime when a session has no endTime', () => {
    const noEnd = session({ id: 'noend', ageDays: 0, endTimeMs: null, startTimeMs: NOW - 120 * DAY });
    const recentNoEnd = session({ id: 'recent', ageDays: 0, endTimeMs: null, startTimeMs: NOW - 5 * DAY });
    expect(selectSessionsForAudioPurge([noEnd, recentNoEnd], 90, NOW).map((s) => s.id)).toEqual(['noend']);
  });

  it('returns the original objects (so callers keep refs)', () => {
    const s = session({ id: 'x', ageDays: 200 }) as SessionAudioView & { ref: string };
    s.ref = 'doc-ref';
    const [picked] = selectSessionsForAudioPurge([s], 90, NOW);
    expect(picked).toBe(s);
    expect(picked.ref).toBe('doc-ref');
  });
});

describe('storage paths', () => {
  it('audioObjectPath matches the storage.rules layout', () => {
    expect(audioObjectPath('u1', 's1')).toBe('sessions/u1/s1.webm');
  });

  it('objectPathFromDownloadUrl decodes a Firebase download URL', () => {
    expect(
      objectPathFromDownloadUrl(
        'https://firebasestorage.googleapis.com/v0/b/proj.firebasestorage.app/o/sessions%2Fu1%2Fs1.webm?alt=media&token=abc',
      ),
    ).toBe('sessions/u1/s1.webm');
  });

  it('objectPathFromDownloadUrl rejects non-Firebase URLs and empty input', () => {
    expect(objectPathFromDownloadUrl('https://evil.example/sessions/u2/x.webm')).toBeNull();
    expect(objectPathFromDownloadUrl('')).toBeNull();
    expect(objectPathFromDownloadUrl(null)).toBeNull();
    expect(objectPathFromDownloadUrl(undefined)).toBeNull();
  });
});
