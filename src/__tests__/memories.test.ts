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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getMemoryContextString,
  updateMemory,
  deleteMemory,
} from '../services/memories';
import type { Memory } from '../types';
import { getDocs, updateDoc, deleteDoc } from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  const now = { toMillis: () => Date.now(), toDate: () => new Date() } as unknown as import('firebase/firestore').Timestamp;
  return {
    id: 'mem-1',
    userId: 'user-1',
    sessionId: 'session-1',
    sessionDate: now,
    content: 'Loves dinosaurs',
    category: 'interest',
    importance: 2,
    tags: ['dinosaurs'],
    createdAt: now,
    edited: false,
    ...overrides,
  };
}

function mockDocs(memories: Memory[]) {
  vi.mocked(getDocs).mockResolvedValueOnce({
    docs: memories.map((m) => ({
      id: m.id,
      data: () => ({ ...m }),
    })),
  } as ReturnType<typeof getDocs> extends Promise<infer T> ? T : never);
}

// ---------------------------------------------------------------------------
// getMemoryContextString
// ---------------------------------------------------------------------------

describe('getMemoryContextString', () => {
  beforeEach(() => {
    vi.mocked(getDocs).mockReset();
  });

  it('returns null when there are no memories', async () => {
    mockDocs([]);
    const result = await getMemoryContextString('user-1');
    expect(result).toBeNull();
  });

  it('returns a formatted string with memory content', async () => {
    mockDocs([makeMemory({ content: 'Loves dinosaurs' })]);
    const result = await getMemoryContextString('user-1');
    expect(result).not.toBeNull();
    expect(result).toContain('Loves dinosaurs');
  });

  it('includes bullet points', async () => {
    mockDocs([makeMemory(), makeMemory({ id: 'mem-2', content: 'Wants to be a vet' })]);
    const result = await getMemoryContextString('user-1');
    expect(result).toMatch(/^.*•.*$/m);
  });

  it('includes relative time for each memory', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const ts = { toMillis: () => yesterday.getTime(), toDate: () => yesterday } as unknown as import('firebase/firestore').Timestamp;
    mockDocs([makeMemory({ sessionDate: ts })]);
    const result = await getMemoryContextString('user-1');
    expect(result).toContain('yesterday');
  });

  it('shows "today" for memories from the current day', async () => {
    const now = { toMillis: () => Date.now(), toDate: () => new Date() } as unknown as import('firebase/firestore').Timestamp;
    mockDocs([makeMemory({ sessionDate: now })]);
    const result = await getMemoryContextString('user-1');
    expect(result).toContain('today');
  });
});

// ---------------------------------------------------------------------------
// updateMemory
// ---------------------------------------------------------------------------

describe('updateMemory', () => {
  beforeEach(() => {
    vi.mocked(updateDoc).mockClear();
  });

  it('calls updateDoc with the supplied updates', async () => {
    await updateMemory('mem-1', { content: 'Loves T-rex' });
    expect(updateDoc).toHaveBeenCalledOnce();
    const [, updates] = vi.mocked(updateDoc).mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(updates.content).toBe('Loves T-rex');
  });

  it('sets edited: true', async () => {
    await updateMemory('mem-1', { importance: 3 });
    const [, updates] = vi.mocked(updateDoc).mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(updates.edited).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteMemory
// ---------------------------------------------------------------------------

describe('deleteMemory', () => {
  beforeEach(() => {
    vi.mocked(deleteDoc).mockClear();
  });

  it('calls deleteDoc', async () => {
    await deleteMemory('mem-1');
    expect(deleteDoc).toHaveBeenCalledOnce();
  });
});
