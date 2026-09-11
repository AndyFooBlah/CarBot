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
 * Audio-retention policy — pure functions, no Firebase imports, so the
 * selection logic is unit-testable from the root vitest suite
 * (src/__tests__/retentionPolicy.test.ts) and shared by the nightly
 * enforcement job in dataLifecycle.ts (#34).
 *
 * Policy: a parent chooses how long session AUDIO is kept (30 / 90 / 365
 * days, or forever). Default 90 days. When audio expires, the .webm is
 * deleted from Storage and the session's audioUrl is cleared; transcripts,
 * memories and the session record itself are kept (they are small and the
 * parent can delete the whole session or account explicitly).
 */

/** Allowed values for `users/{uid}.audioRetentionDays`. `null` = keep forever. */
export const AUDIO_RETENTION_OPTIONS = [30, 90, 365, null] as const;
export type AudioRetentionDays = (typeof AUDIO_RETENTION_OPTIONS)[number];

/** Applied when the profile has no (or an invalid) setting. */
export const DEFAULT_AUDIO_RETENTION_DAYS: AudioRetentionDays = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Normalize whatever is stored on the user document to a valid setting.
 * `undefined` (never set) -> default; `null` -> forever; any other value that
 * is not one of the options -> default (fail safe, never "forever").
 */
export function resolveAudioRetentionDays(raw: unknown): AudioRetentionDays {
  if (raw === null) return null;
  if (typeof raw === 'number' && (AUDIO_RETENTION_OPTIONS as readonly unknown[]).includes(raw)) {
    return raw as AudioRetentionDays;
  }
  return DEFAULT_AUDIO_RETENTION_DAYS;
}

/** Minimal view of a session used for purge selection (all times in epoch ms). */
export interface SessionAudioView {
  id: string;
  userId: string;
  status: string;
  audioUrl: string | null | undefined;
  startTimeMs: number;
  endTimeMs: number | null;
  /** Set once the nightly job has already purged this session's audio. */
  audioPurgedAtMs?: number | null;
}

/**
 * The cutoff instant: audio from sessions that ENDED before this is expired.
 * Returns null when retention is "forever".
 */
export function audioRetentionCutoffMs(days: AudioRetentionDays, nowMs: number): number | null {
  if (days === null) return null;
  return nowMs - days * DAY_MS;
}

/**
 * Pick the sessions whose audio should be deleted under `days` retention.
 *
 * A session qualifies when ALL of:
 *   - retention is not "forever"
 *   - it is no longer active (completed or interrupted) — never pull audio
 *     out from under a live session
 *   - it still has an audioUrl and has not already been purged
 *   - its end time (falling back to start time if it never got one) is
 *     strictly older than the cutoff
 */
export function selectSessionsForAudioPurge<T extends SessionAudioView>(
  sessions: readonly T[],
  days: AudioRetentionDays,
  nowMs: number,
): T[] {
  const cutoff = audioRetentionCutoffMs(days, nowMs);
  if (cutoff === null) return [];
  return sessions.filter((s) => {
    if (s.status === 'active') return false;
    if (!s.audioUrl) return false;
    if (s.audioPurgedAtMs) return false;
    const endedAt = s.endTimeMs ?? s.startTimeMs;
    return endedAt < cutoff;
  });
}

/** Canonical Storage object path for a session recording (see storage.rules). */
export function audioObjectPath(userId: string, sessionId: string): string {
  return `sessions/${userId}/${sessionId}.webm`;
}

/**
 * Extract the object path from a Firebase Storage download URL
 * (`https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<url-encoded path>?...`).
 * Returns null for anything that does not look like one. Used as a
 * belt-and-braces second delete target in case a recording was archived at
 * a non-canonical path.
 */
export function objectPathFromDownloadUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}
