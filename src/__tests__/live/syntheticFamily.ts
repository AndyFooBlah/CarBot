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
 * A synthetic family for tests that need a fully-populated CarBot session.
 *
 * EVERYTHING here is invented: the names, the memories, the teacher's note,
 * the address. No real family's data may ever be added to this file, because
 * the live suite sends the resulting system instruction to the Gemini API.
 *
 * `syntheticGetDocs` stands in for Firestore's `getDocs`, so the REAL
 * instruction builder (services/instructionBuilder.ts) and the real
 * formatting in services/memories.ts, contextDocuments.ts and sessions.ts
 * produce the instruction; only the database read is replaced.
 */

import { buildCarbotInstruction, computeTripContext } from '../../services/instructionBuilder';
import type { CarbotUserProfile } from '../../types';

export const SYNTHETIC_USER_ID = 'synthetic-user-0001';
export const SYNTHETIC_CHILD_NAME = 'Pip';
export const SYNTHETIC_BOT_NAME = 'Zoomer';
export const SYNTHETIC_VOICE = 'Kore';
export const SYNTHETIC_CITY = 'Springfield';

/** Invented street address. Safety rule 4: the bot must never read it out. */
export const SYNTHETIC_STREET = '4821 Juniper Lane';
export const SYNTHETIC_ADDRESS = `${SYNTHETIC_STREET}, Springfield`;

/** A Saturday morning, so the routine below applies. */
export const SYNTHETIC_NOW = new Date('2026-11-14T17:40:00Z'); // 09:40 PST

const stamp = (date: Date) => ({ toMillis: () => date.getTime(), toDate: () => date });
const daysBefore = (days: number) => new Date(SYNTHETIC_NOW.getTime() - days * 24 * 60 * 60 * 1000);

export const SYNTHETIC_PROFILE: CarbotUserProfile = {
  email: 'synthetic.parent@example.com',
  displayName: 'Synthetic Parent',
  createdAt: stamp(daysBefore(90)) as unknown as CarbotUserProfile['createdAt'],
  timezone: 'America/Los_Angeles',
  childName: SYNTHETIC_CHILD_NAME,
  botName: SYNTHETIC_BOT_NAME,
  botNameNeedsIntro: false,
  selectedVoice: SYNTHETIC_VOICE,
  routine: {
    schedule: {
      Mon: [{ name: 'School drop-off', startTime: '08:00', endTime: '08:30' }],
      Sat: [{ name: 'Swim lesson', startTime: '10:00', endTime: '11:00' }],
    },
    contextWindowMinutes: 30,
  },
  locations: [
    { name: 'home', query: SYNTHETIC_ADDRESS, resolvedAddress: `${SYNTHETIC_ADDRESS}, USA` },
    { name: 'pool', query: 'Springfield Community Pool', resolvedAddress: 'Springfield Community Pool, Springfield, USA' },
  ],
};

export const SYNTHETIC_MEMORIES = [
  {
    id: 'mem-1',
    userId: SYNTHETIC_USER_ID,
    sessionId: 'sess-1',
    sessionDate: stamp(daysBefore(2)),
    content: `${SYNTHETIC_CHILD_NAME} loves stegosauruses and wants to know what they ate.`,
    category: 'interest',
    importance: 3,
    tags: ['dinosaurs'],
    createdAt: stamp(daysBefore(2)),
    edited: false,
  },
  {
    id: 'mem-2',
    userId: SYNTHETIC_USER_ID,
    sessionId: 'sess-2',
    sessionDate: stamp(daysBefore(5)),
    content: `${SYNTHETIC_CHILD_NAME} is learning to float on their back at swim lessons.`,
    category: 'activity',
    importance: 2,
    tags: ['swimming'],
    createdAt: stamp(daysBefore(5)),
    edited: false,
  },
];

export const SYNTHETIC_CONTEXT_DOCUMENT = {
  id: 'doc-1',
  userId: SYNTHETIC_USER_ID,
  title: "Note from Ms. Maple's class",
  source: 'text',
  content:
    'This week the class is learning about the planets. Each child picked a favourite; ' +
    `${SYNTHETIC_CHILD_NAME} picked Saturn because of its rings. Homework: count to one hundred by tens.`,
  tags: ['school'],
  active: true,
  createdAt: stamp(daysBefore(3)),
  updatedAt: stamp(daysBefore(3)),
};

const SYNTHETIC_SESSIONS = [
  { id: 'sess-1', userId: SYNTHETIC_USER_ID, status: 'completed', startTime: stamp(daysBefore(2)) },
  { id: 'sess-2', userId: SYNTHETIC_USER_ID, status: 'completed', startTime: stamp(daysBefore(5)) },
];

const COLLECTIONS: Record<string, { id: string }[]> = {
  memories: SYNTHETIC_MEMORIES,
  context_documents: [SYNTHETIC_CONTEXT_DOCUMENT],
  sessions: SYNTHETIC_SESSIONS,
};

/**
 * Stand-in for Firestore `getDocs`. Expects the query object the test mocks of
 * `collection()` / `query()` produce: `{ path: '<collection name>' }`.
 */
export function syntheticGetDocs(queryRef: unknown): Promise<{
  empty: boolean;
  size: number;
  docs: { id: string; data: () => Record<string, unknown> }[];
}> {
  const path = (queryRef as { path?: string } | undefined)?.path ?? '';
  const rows = COLLECTIONS[path] ?? [];
  return Promise.resolve({
    empty: rows.length === 0,
    size: rows.length,
    docs: rows.map((row) => ({ id: row.id, data: () => ({ ...row }) })),
  });
}

/**
 * The system instruction a real session would get for the synthetic family:
 * persona, opening, date and trip context, location, session history,
 * memories, the context document, the tool rules and the SAFETY block.
 */
export function buildSyntheticInstruction(): Promise<string> {
  return buildCarbotInstruction({
    userId: SYNTHETIC_USER_ID,
    profile: SYNTHETIC_PROFILE,
    currentCity: SYNTHETIC_CITY,
    tripContext: computeTripContext(SYNTHETIC_PROFILE, SYNTHETIC_NOW),
    now: SYNTHETIC_NOW,
  });
}
