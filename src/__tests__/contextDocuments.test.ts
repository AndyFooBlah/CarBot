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
  buildContextDocumentSection,
  createContextDocument,
  updateContextDocument,
  setContextDocumentActive,
  deleteContextDocument,
  MAX_CONTENT_LENGTH,
  INSTRUCTION_INLINE_LIMIT,
} from '../services/contextDocuments';
import type { ContextDocument } from '../types';
import { addDoc, updateDoc, deleteDoc } from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<ContextDocument> = {}): ContextDocument {
  const now = { toMillis: () => Date.now(), toDate: () => new Date() } as unknown as import('firebase/firestore').Timestamp;
  return {
    id: 'doc-1',
    userId: 'user-1',
    title: 'Test Document',
    source: 'text',
    content: 'Hello world.',
    tags: [],
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildContextDocumentSection (pure function — no mocks needed)
// ---------------------------------------------------------------------------

describe('buildContextDocumentSection', () => {
  it('returns null for an empty list', () => {
    expect(buildContextDocumentSection([])).toBeNull();
  });

  it('includes document title and content', () => {
    const doc = makeDoc({ title: 'Field Trip Reminder', content: 'The field trip is on Friday.' });
    const result = buildContextDocumentSection([doc]);
    expect(result).toContain('[Field Trip Reminder]');
    expect(result).toContain('The field trip is on Friday.');
  });

  it('includes all documents', () => {
    const docs = [
      makeDoc({ id: 'a', title: 'Doc A', content: 'Content A' }),
      makeDoc({ id: 'b', title: 'Doc B', content: 'Content B' }),
    ];
    const result = buildContextDocumentSection(docs);
    expect(result).toContain('[Doc A]');
    expect(result).toContain('[Doc B]');
    expect(result).toContain('Content A');
    expect(result).toContain('Content B');
  });

  it('truncates content that exceeds INSTRUCTION_INLINE_LIMIT', () => {
    const longContent = 'a'.repeat(INSTRUCTION_INLINE_LIMIT + 100);
    const doc = makeDoc({ content: longContent });
    const result = buildContextDocumentSection([doc])!;
    expect(result).toContain('[...truncated]');
    // The result should not contain the full content
    expect(result.length).toBeLessThan(longContent.length + 200);
  });

  it('does not truncate content within the limit', () => {
    const content = 'a'.repeat(INSTRUCTION_INLINE_LIMIT);
    const doc = makeDoc({ content });
    const result = buildContextDocumentSection([doc])!;
    expect(result).not.toContain('[...truncated]');
  });

  it('separates multiple docs with a divider', () => {
    const docs = [
      makeDoc({ id: 'a', title: 'A', content: 'AA' }),
      makeDoc({ id: 'b', title: 'B', content: 'BB' }),
    ];
    const result = buildContextDocumentSection(docs)!;
    expect(result).toContain('---');
  });
});

// ---------------------------------------------------------------------------
// createContextDocument (calls addDoc)
// ---------------------------------------------------------------------------

describe('createContextDocument', () => {
  beforeEach(() => {
    vi.mocked(addDoc).mockClear();
    vi.mocked(addDoc).mockResolvedValue({ id: 'new-doc-id' } as ReturnType<typeof addDoc> extends Promise<infer T> ? T : never);
  });

  it('calls addDoc and returns the new document id', async () => {
    const id = await createContextDocument('user-1', 'My Doc', 'Some content', 'text');
    expect(id).toBe('new-doc-id');
    expect(addDoc).toHaveBeenCalledOnce();
  });

  it('truncates content to MAX_CONTENT_LENGTH', async () => {
    const overlong = 'x'.repeat(MAX_CONTENT_LENGTH + 5000);
    await createContextDocument('user-1', 'Big Doc', overlong, 'upload');
    const callArgs = vi.mocked(addDoc).mock.calls[0];
    const docData = callArgs[1] as { content: string };
    expect(docData.content.length).toBe(MAX_CONTENT_LENGTH);
  });

  it('sets active to true by default', async () => {
    await createContextDocument('user-1', 'Doc', 'Content', 'text');
    const docData = vi.mocked(addDoc).mock.calls[0][1] as { active: boolean };
    expect(docData.active).toBe(true);
  });

  it('stores optional filename when provided', async () => {
    await createContextDocument('user-1', 'Doc', 'Content', 'upload', { filename: 'report.pdf' });
    const docData = vi.mocked(addDoc).mock.calls[0][1] as { filename?: string };
    expect(docData.filename).toBe('report.pdf');
  });
});

// ---------------------------------------------------------------------------
// updateContextDocument, setContextDocumentActive, deleteContextDocument
// ---------------------------------------------------------------------------

describe('updateContextDocument', () => {
  beforeEach(() => {
    vi.mocked(updateDoc).mockClear();
  });

  it('calls updateDoc with the updates and a new updatedAt', async () => {
    await updateContextDocument('doc-1', { title: 'New Title' });
    expect(updateDoc).toHaveBeenCalledOnce();
    const [, updates] = vi.mocked(updateDoc).mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(updates.title).toBe('New Title');
    expect(updates.updatedAt).toBeDefined();
  });

  it('truncates content updates to MAX_CONTENT_LENGTH', async () => {
    const overlong = 'y'.repeat(MAX_CONTENT_LENGTH + 1000);
    await updateContextDocument('doc-1', { content: overlong });
    const [, updates] = vi.mocked(updateDoc).mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect((updates.content as string).length).toBe(MAX_CONTENT_LENGTH);
  });
});

describe('setContextDocumentActive', () => {
  beforeEach(() => {
    vi.mocked(updateDoc).mockClear();
  });

  it('calls updateDoc with the active flag', async () => {
    await setContextDocumentActive('doc-1', false);
    const [, updates] = vi.mocked(updateDoc).mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(updates.active).toBe(false);
  });
});

describe('deleteContextDocument', () => {
  beforeEach(() => {
    vi.mocked(deleteDoc).mockClear();
  });

  it('calls deleteDoc', async () => {
    await deleteContextDocument('doc-1');
    expect(deleteDoc).toHaveBeenCalledOnce();
  });
});
