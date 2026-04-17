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
 * CarBot session service.
 *
 * Extends VoiceCommon's base session storage with CarBot-specific fields:
 * tripContext, contextDocIds, and summary. These are written to the session
 * document immediately after VoiceCommon creates the base record.
 *
 * All base session CRUD (createSession, finalizeSession, etc.) is handled
 * by VoiceCommon's storage service.
 */

import {
  doc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { db, getUserSessions } from '@andyfooblah/voice-common';
import type { SessionMetadata } from '@andyfooblah/voice-common';
import type { CarbotSessionFields, TripContext } from '../types';

/** VoiceCommon SessionMetadata extended with CarBot-specific fields. */
export type CarbotSession = SessionMetadata & Partial<CarbotSessionFields>;

/**
 * Write CarBot-specific fields to an existing session document.
 * Called immediately after VoiceCommon's useSession sets sessionId.
 */
export async function setSessionCarbotFields(
  sessionId: string,
  fields: CarbotSessionFields,
): Promise<void> {
  await updateDoc(doc(db, 'sessions', sessionId), {
    tripContext: fields.tripContext,
    contextDocIds: fields.contextDocIds,
    ...(fields.summary !== undefined ? { summary: fields.summary } : {}),
  });
}

/**
 * Fetch all sessions for a user including CarBot-specific fields.
 * Returns sessions ordered by startTime descending.
 */
export async function getCarbotSessions(userId: string): Promise<CarbotSession[]> {
  // VoiceCommon's getUserSessions returns base SessionMetadata[]
  // The CarBot fields are on the same document, so they'll be present
  // when the snapshot is typed as CarbotSession.
  return getUserSessions(userId) as Promise<CarbotSession[]>;
}

/**
 * Fetch the start times of the most recent completed sessions.
 * Used for injecting session history context into the system instruction.
 *
 * Sessions that started within the last 60 seconds are excluded so the
 * session that just ended doesn't appear to be the current one.
 *
 * @param userId - The authenticated user's UID.
 * @param timezone - IANA timezone string for formatting, e.g. "America/Los_Angeles".
 * @param now - The current time (used to exclude very recent sessions).
 * @param maxSessions - Maximum sessions to retrieve (default 3).
 * @returns Formatted string listing past session times, or null if none.
 */
export async function getRecentSessionTimestamps(
  userId: string,
  timezone: string,
  now: Date,
  maxSessions = 3,
): Promise<string | null> {
  const cutoff = Timestamp.fromDate(new Date(now.getTime() - 60_000));
  const snap = await getDocs(
    query(
      collection(db, 'sessions'),
      where('userId', '==', userId),
      where('status', '==', 'completed'),
      where('startTime', '<', cutoff),
      orderBy('startTime', 'desc'),
      limit(maxSessions),
    ),
  );

  if (snap.empty) return null;

  const lines = snap.docs.map((d) => {
    const data = d.data();
    const date: Date | undefined = data.startTime?.toDate?.();
    if (!date) return null;
    const formatted = date.toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    return `• ${formatted}`;
  }).filter(Boolean);

  if (lines.length === 0) return null;
  return `Last ${lines.length} session${lines.length > 1 ? 's' : ''}:\n${lines.join('\n')}`;
}

/**
 * Fetch one-line summaries from the most recent completed sessions.
 * Used for injecting session history into the system instruction.
 *
 * @param userId - The authenticated user's UID.
 * @param maxSessions - Maximum sessions to retrieve (default 5).
 * @returns Formatted string of recent session summaries, or null.
 */
export async function getRecentSessionSummaries(
  userId: string,
  maxSessions = 5,
): Promise<string | null> {
  const snap = await getDocs(
    query(
      collection(db, 'sessions'),
      where('userId', '==', userId),
      where('status', '==', 'completed'),
      orderBy('startTime', 'desc'),
      limit(maxSessions),
    ),
  );

  const summaries = snap.docs
    .map((d) => {
      const data = d.data();
      const date = data.startTime?.toDate?.()?.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      const summary = data.summary;
      return date && summary ? `• ${date}: ${summary}` : null;
    })
    .filter(Boolean);

  if (summaries.length === 0) return null;
  return `Recent sessions:\n${summaries.join('\n')}`;
}

/**
 * Get a friendly label for a TripContext value.
 */
export function tripContextLabel(context: TripContext | undefined): string {
  switch (context) {
    case 'school_commute_morning': return 'Morning commute';
    case 'school_commute_afternoon': return 'Afternoon pickup';
    case 'school_day_other': return 'School day';
    case 'non_school_day': return 'Non-school day';
    case 'unstructured':
    default:
      return 'Unscheduled';
  }
}
