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
 * Transcript editor service.
 *
 * Manages versioned edits to session transcripts. Both the raw transcript
 * ('entries') and the clean transcript ('clean') can be edited. Each edit
 * creates a new document in the `edits` subcollection; originals are never
 * overwritten.
 *
 * The "active" version is always the most recent edit, or the original if
 * no edits exist. This resolution is used by memory extraction and summary
 * generation in Cloud Functions.
 *
 * Storage layout:
 *   sessions/{sessionId}/transcript/entries     — raw (VoiceCommon default)
 *   sessions/{sessionId}/transcript/clean       — AI-generated clean version
 *   sessions/{sessionId}/transcriptEdits/{id}   — versioned edit history (flat sub-collection)
 *
 * Note: edits use a flat sub-collection `transcriptEdits` rather than nesting under
 * `transcript/edits`, because Firestore alternates collection/document at each path
 * segment and `transcript/edits` would be a document path (4 segments), not a collection.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  orderBy,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@andyfooblah/voicecommon';
import type { TranscriptEntry } from '@andyfooblah/voicecommon';
import type { TranscriptEdit } from '../types';

export type TranscriptType = 'entries' | 'clean';

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Fetch the original raw transcript entries for a session.
 * Returns an empty array if the transcript document does not exist yet.
 */
export async function getRawTranscript(sessionId: string): Promise<TranscriptEntry[]> {
  const snap = await getDoc(
    doc(db, 'sessions', sessionId, 'transcript', 'entries'),
  );
  if (!snap.exists()) return [];
  return (snap.data()?.entries as TranscriptEntry[]) ?? [];
}

/**
 * Fetch the AI-generated clean transcript for a session.
 * Returns null if the clean transcript has not been generated yet.
 */
export async function getCleanTranscript(
  sessionId: string,
): Promise<{ entries: TranscriptEntry[]; generatedAt: Timestamp; model: string } | null> {
  const snap = await getDoc(
    doc(db, 'sessions', sessionId, 'transcript', 'clean'),
  );
  if (!snap.exists()) return null;
  return snap.data() as { entries: TranscriptEntry[]; generatedAt: Timestamp; model: string };
}

/**
 * Fetch all edit documents for a session + transcript type, newest first.
 */
export async function getTranscriptHistory(
  sessionId: string,
  type: TranscriptType,
): Promise<TranscriptEdit[]> {
  const snap = await getDocs(
    query(
      collection(db, 'sessions', sessionId, 'transcriptEdits'),
      where('type', '==', type),
      orderBy('editedAt', 'desc'),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TranscriptEdit);
}

/**
 * Fetch the "active" transcript — the most recent edit if any, otherwise
 * the original. This is what Cloud Functions should use for processing.
 *
 * @returns The active entries, or an empty array if no transcript exists.
 */
export async function getActiveTranscript(
  sessionId: string,
  type: TranscriptType,
): Promise<TranscriptEntry[]> {
  const history = await getTranscriptHistory(sessionId, type);
  if (history.length > 0) {
    return history[0].entries;
  }

  if (type === 'entries') {
    return getRawTranscript(sessionId);
  }

  const clean = await getCleanTranscript(sessionId);
  return clean?.entries ?? [];
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Save a new transcript edit.
 *
 * Creates a document in `sessions/{sessionId}/transcriptEdits/{newId}`.
 * The original transcript documents are never modified.
 *
 * @param sessionId - The session to edit.
 * @param type - Which transcript to edit ('entries' or 'clean').
 * @param entries - The full updated transcript entries.
 * @param note - Optional user annotation describing the edit.
 * @returns The ID of the newly created edit document.
 */
export async function saveTranscriptEdit(
  sessionId: string,
  type: TranscriptType,
  entries: TranscriptEntry[],
  note?: string,
): Promise<string> {
  const editData: Omit<TranscriptEdit, 'id'> = {
    type,
    entries,
    editedAt: Timestamp.now(),
    ...(note ? { note } : {}),
  };

  const ref = await addDoc(
    collection(db, 'sessions', sessionId, 'transcriptEdits'),
    editData,
  );
  return ref.id;
}
