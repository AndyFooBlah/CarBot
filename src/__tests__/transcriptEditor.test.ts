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
  getRawTranscript,
  getCleanTranscript,
  getActiveTranscript,
  saveTranscriptEdit,
} from '../services/transcriptEditor';
import type { TranscriptEntry } from '@andyfooblah/voice-common';
import { getDoc, getDocs, addDoc } from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_ENTRIES = [
  { role: 'user', text: 'Hello CarBot', messageIndex: 0 },
  { role: 'bot', text: 'Hi there!', messageIndex: 1 },
] as unknown as TranscriptEntry[];

function mockDocExists(data: unknown) {
  vi.mocked(getDoc).mockResolvedValueOnce({
    exists: () => true,
    data: () => data,
  } as ReturnType<typeof getDoc> extends Promise<infer T> ? T : never);
}

function mockDocMissing() {
  vi.mocked(getDoc).mockResolvedValueOnce({
    exists: () => false,
    data: () => undefined,
  } as ReturnType<typeof getDoc> extends Promise<infer T> ? T : never);
}

function mockDocsResult(docs: Array<{ id: string; data: unknown }>) {
  vi.mocked(getDocs).mockResolvedValueOnce({
    docs: docs.map((d) => ({ id: d.id, data: () => d.data, ...d.data as object })),
    empty: docs.length === 0,
  } as ReturnType<typeof getDocs> extends Promise<infer T> ? T : never);
}

// ---------------------------------------------------------------------------
// getRawTranscript
// ---------------------------------------------------------------------------

describe('getRawTranscript', () => {
  beforeEach(() => {
    vi.mocked(getDoc).mockReset();
  });

  it('returns entries when transcript document exists', async () => {
    mockDocExists({ entries: MOCK_ENTRIES });
    const result = await getRawTranscript('session-1');
    expect(result).toEqual(MOCK_ENTRIES);
  });

  it('returns empty array when document does not exist', async () => {
    mockDocMissing();
    const result = await getRawTranscript('session-1');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getCleanTranscript
// ---------------------------------------------------------------------------

describe('getCleanTranscript', () => {
  beforeEach(() => {
    vi.mocked(getDoc).mockReset();
  });

  it('returns transcript data when document exists', async () => {
    const now = new Date();
    const cleanData = {
      entries: MOCK_ENTRIES,
      generatedAt: { toDate: () => now, toMillis: () => now.getTime() },
      model: 'gemini-2.0-flash',
    };
    mockDocExists(cleanData);
    const result = await getCleanTranscript('session-1');
    expect(result).not.toBeNull();
    expect(result!.entries).toEqual(MOCK_ENTRIES);
    expect(result!.model).toBe('gemini-2.0-flash');
  });

  it('returns null when document does not exist', async () => {
    mockDocMissing();
    const result = await getCleanTranscript('session-1');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getActiveTranscript
// ---------------------------------------------------------------------------

describe('getActiveTranscript', () => {
  beforeEach(() => {
    vi.mocked(getDocs).mockReset();
    vi.mocked(getDoc).mockReset();
  });

  it('returns the most recent edit when edits exist', async () => {
    const editedEntries = [{ role: 'user', text: 'Edited text', messageIndex: 0 }];
    mockDocsResult([
      {
        id: 'edit-1',
        data: {
          type: 'entries',
          entries: editedEntries,
          editedAt: { toDate: () => new Date(), toMillis: () => Date.now() },
        },
      },
    ]);
    const result = await getActiveTranscript('session-1', 'entries');
    expect(result).toEqual(editedEntries);
    // Should not fall through to getDoc
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('falls back to raw transcript when no edits exist (entries type)', async () => {
    mockDocsResult([]); // no edits
    mockDocExists({ entries: MOCK_ENTRIES }); // raw transcript
    const result = await getActiveTranscript('session-1', 'entries');
    expect(result).toEqual(MOCK_ENTRIES);
  });

  it('falls back to clean transcript when no edits exist (clean type)', async () => {
    const cleanEntries = [{ role: 'bot', text: 'Clean response', messageIndex: 1 }];
    mockDocsResult([]); // no edits
    mockDocExists({ entries: cleanEntries, generatedAt: {}, model: 'gemini-2.0-flash' }); // clean doc
    const result = await getActiveTranscript('session-1', 'clean');
    expect(result).toEqual(cleanEntries);
  });

  it('returns empty array when no edits and no original (entries type)', async () => {
    mockDocsResult([]);
    mockDocMissing();
    const result = await getActiveTranscript('session-1', 'entries');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// saveTranscriptEdit
// ---------------------------------------------------------------------------

describe('saveTranscriptEdit', () => {
  beforeEach(() => {
    vi.mocked(addDoc).mockClear();
    vi.mocked(addDoc).mockResolvedValue({ id: 'edit-new-id' } as ReturnType<typeof addDoc> extends Promise<infer T> ? T : never);
  });

  it('calls addDoc and returns the new edit ID', async () => {
    const id = await saveTranscriptEdit('session-1', 'entries', MOCK_ENTRIES);
    expect(id).toBe('edit-new-id');
    expect(addDoc).toHaveBeenCalledOnce();
  });

  it('stores the type, entries, and editedAt', async () => {
    await saveTranscriptEdit('session-1', 'clean', MOCK_ENTRIES, 'Fixed typo');
    const [, editData] = vi.mocked(addDoc).mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(editData.type).toBe('clean');
    expect(editData.entries).toEqual(MOCK_ENTRIES);
    expect(editData.editedAt).toBeDefined();
  });

  it('includes note when provided', async () => {
    await saveTranscriptEdit('session-1', 'entries', MOCK_ENTRIES, 'Corrected names');
    const [, editData] = vi.mocked(addDoc).mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(editData.note).toBe('Corrected names');
  });

  it('does not include note key when not provided', async () => {
    await saveTranscriptEdit('session-1', 'entries', MOCK_ENTRIES);
    const [, editData] = vi.mocked(addDoc).mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(editData).not.toHaveProperty('note');
  });
});
