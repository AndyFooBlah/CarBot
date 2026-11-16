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
 * Setup for the live suite (vitest.live.config.ts).
 *
 * The only thing replaced is the database read: `firebase/firestore` returns
 * the synthetic family (syntheticFamily.ts) so the real instruction builder
 * runs without Firebase. VoiceCommon, KnowledgeCommon and @google/genai are
 * the real modules, and nothing about the Live connection is mocked.
 */

import { vi } from 'vitest';

vi.mock('firebase/firestore', async () => {
  const { syntheticGetDocs } = await import('./syntheticFamily');
  const stamp = (date: Date) => ({ toMillis: () => date.getTime(), toDate: () => date });
  return {
    collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    query: (ref: unknown) => ref,
    where: () => ({}),
    orderBy: () => ({}),
    limit: () => ({}),
    getDocs: syntheticGetDocs,
    getDoc: () => Promise.resolve({ exists: () => false, data: () => undefined }),
    Timestamp: { now: () => stamp(new Date()), fromDate: stamp },
  };
});
