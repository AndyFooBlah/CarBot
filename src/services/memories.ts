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
 * Memory service for CarBot.
 *
 * Manages the `memories/{memoryId}` collection — the cross-session searchable
 * store of facts extracted from conversations. Also provides helpers to build
 * the memory context string injected into each session's system instruction.
 *
 * Memory extraction itself is handled by the Cloud Function in functions/src/.
 * This module handles client-side read, edit, and delete operations.
 */

import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  updateDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@andyfooblah/voice-common';
import type { Memory, MemoryCategory } from '../types';
import { sanitizeInline, MAX_MEMORY_ITEM_CHARS } from './promptSafety';

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Fetch memories for a user, ordered by recency then importance.
 *
 * @param userId - The authenticated user's UID.
 * @param maxResults - Maximum number of memories to return (default 100).
 * @param filterCategory - Optional category filter.
 */
export async function getMemories(
  userId: string,
  maxResults = 100,
  filterCategory?: MemoryCategory,
): Promise<Memory[]> {
  const constraints = [
    where('userId', '==', userId),
    orderBy('sessionDate', 'desc'),
    orderBy('importance', 'desc'),
    limit(maxResults),
  ];

  if (filterCategory) {
    constraints.unshift(where('category', '==', filterCategory));
  }

  const snap = await getDocs(query(collection(db, 'memories'), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Memory);
}

/**
 * Fetch the most recent and important memories for context injection.
 * Returns up to `maxResults` memories, formatted as a bullet list.
 *
 * @param userId - The authenticated user's UID.
 * @param maxResults - Maximum number of memories to include (default 20).
 * @returns A formatted string, or null if there are no memories.
 */
export async function getMemoryContextString(
  userId: string,
  maxResults = 20,
): Promise<string | null> {
  const memories = await getMemories(userId, maxResults);
  if (memories.length === 0) return null;

  const bullets = memories.map((m) => {
    const daysAgo = Math.round(
      (Date.now() - m.sessionDate.toMillis()) / (1000 * 60 * 60 * 24),
    );
    const when =
      daysAgo === 0 ? 'today' :
      daysAgo === 1 ? 'yesterday' :
      `${daysAgo} days ago`;
    return `• ${sanitizeInline(m.content, MAX_MEMORY_ITEM_CHARS)} (${when})`;
  });

  return `Recent things you know about this family:\n${bullets.join('\n')}`;
}

/**
 * Fetch memories associated with a specific session.
 * Used in the session detail view's "Memory Highlights" tab.
 *
 * @param sessionId - The session to fetch memories for.
 * @param userId - The authenticated user's UID. Required by Firestore security
 *   rules — the query must filter by userId so the rule can be evaluated.
 */
export async function getSessionMemories(sessionId: string, userId: string): Promise<Memory[]> {
  const snap = await getDocs(
    query(
      collection(db, 'memories'),
      where('userId', '==', userId),
      where('sessionId', '==', sessionId),
      orderBy('importance', 'desc'),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Memory);
}

// ---------------------------------------------------------------------------
// Write / Edit
// ---------------------------------------------------------------------------

/**
 * Update the content and/or tags of a memory fact.
 * Sets `edited: true` on the document.
 */
export async function updateMemory(
  memoryId: string,
  updates: { content?: string; tags?: string[]; importance?: 1 | 2 | 3 },
): Promise<void> {
  await updateDoc(doc(db, 'memories', memoryId), {
    ...updates,
    edited: true,
    updatedAt: Timestamp.now(),
  });
}

/**
 * Hard-delete a memory fact.
 * Note: this removes the document from the `memories` collection but does
 * not update the `sessions/{sessionId}/memories` subcollection document.
 * That source-of-truth is preserved for audit purposes.
 */
export async function deleteMemory(memoryId: string): Promise<void> {
  await deleteDoc(doc(db, 'memories', memoryId));
}
