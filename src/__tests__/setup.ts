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
 * Vitest global test setup.
 *
 * - Imports jest-dom matchers (toBeInTheDocument, etc.)
 * - Mocks the @andyfooblah/voicecommon module so tests never hit Firebase
 */

import '@testing-library/jest-dom';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock VoiceCommon — prevents Firebase SDK initialization during tests.
// ---------------------------------------------------------------------------

vi.mock('@andyfooblah/voicecommon', () => {
  const mockDb = {};
  const mockAuth = { currentUser: null };
  const mockStorage = {};

  return {
    db: mockDb,
    auth: mockAuth,
    storage: mockStorage,
    initializeVoiceCommon: vi.fn(),
    useSession: vi.fn(() => ({
      sessionId: null,
      status: 'idle',
      startSession: vi.fn(),
      stopSession: vi.fn(),
      messages: [],
    })),
    useAuth: vi.fn(() => ({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
    })),
  };
});

// ---------------------------------------------------------------------------
// Mock firebase/firestore — tests that exercise Firestore services use these
// ---------------------------------------------------------------------------

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...path) => ({ path: path.join('/') })),
  doc: vi.fn((_db, ...path) => ({ path: path.join('/') })),
  query: vi.fn((...args) => args[0]),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => undefined })),
  addDoc: vi.fn(() => Promise.resolve({ id: 'mock-doc-id' })),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  setDoc: vi.fn(() => Promise.resolve()),
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(() => Promise.resolve()),
  })),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => Date.now(), toDate: () => new Date() })),
    fromDate: vi.fn((d: Date) => ({ toMillis: () => d.getTime(), toDate: () => d })),
  },
}));
