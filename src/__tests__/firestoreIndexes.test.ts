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
 * Guard for the composite indexes the nightly cleanup job depends on (#73).
 *
 * `dailyDataCleanup` (functions/src/dataCleanup.ts) queries `sessions` across
 * all users by `status` and a `startTime` range. Without the index below the
 * query fails with "The query requires an index", which it did every night
 * for at least a month before anyone noticed. This test cannot prove the
 * index is deployed (the deploy workflow does that), but it stops the
 * definition being dropped from firestore.indexes.json while the queries
 * still exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');

interface IndexDef {
  collectionGroup: string;
  queryScope: string;
  fields: { fieldPath: string; order?: string }[];
}

const indexes: IndexDef[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'firestore.indexes.json'), 'utf8'),
).indexes;

const shape = (i: IndexDef) =>
  `${i.collectionGroup}/${i.queryScope}: ${i.fields.map((f) => `${f.fieldPath} ${f.order}`).join(', ')}`;

describe('firestore.indexes.json', () => {
  it('defines sessions (status ASC, startTime ASC) for the cross-user cleanup queries', () => {
    expect(indexes.map(shape)).toContain('sessions/COLLECTION: status ASCENDING, startTime ASCENDING');
  });

  it('the cleanup job still issues the queries that index serves', () => {
    const source = fs.readFileSync(path.join(ROOT, 'functions/src/dataCleanup.ts'), 'utf8');
    // Equality on status plus a range on startTime, with no userId filter.
    expect(source).toMatch(/where\('status', '==', 'completed'\)\s*\.where\('startTime', '>=', cutoff\)/);
    expect(source).toMatch(/where\('status', '==', 'active'\)\s*\.where\('startTime', '<=', staleThreshold\)/);
  });

  it('is wired into firebase.json so a deploy creates it', () => {
    const firebaseJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
    expect(firebaseJson.firestore.indexes).toBe('firestore.indexes.json');
  });

  it('has no duplicate definitions', () => {
    const shapes = indexes.map(shape);
    expect(new Set(shapes).size).toBe(shapes.length);
  });
});
