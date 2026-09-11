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
 * Shared types for CarBot Cloud Functions.
 * Mirrors the client-side types in src/types.ts.
 */

import { Timestamp } from 'firebase-admin/firestore';

export type MemoryCategory =
  | 'interest'
  | 'event'
  | 'plan'
  | 'fact'
  | 'preference'
  | 'relationship'
  | 'other';

export interface MemoryFact {
  id: string;
  content: string;
  category: MemoryCategory;
  importance: 1 | 2 | 3;
  tags: string[];
}

export interface TranscriptEntry {
  role: 'user' | 'bot' | 'tool';
  text: string;
  timestamp: Timestamp;
  messageIndex?: number;
  toolName?: string;
}

export interface SessionDocument {
  userId: string;
  status: 'active' | 'completed' | 'interrupted';
  startTime: Timestamp;
  endTime: Timestamp | null;
  durationSeconds: number;
  audioUrl: string;
  summary?: string;
  tripContext?: string;
  contextDocIds?: string[];
  /** Set by the nightly retention job when the .webm was deleted (audioUrl is then ''). */
  audioPurgedAt?: Timestamp;
}

export interface UserDocument {
  email: string;
  displayName: string;
  childName?: string;
  emailSummariesEnabled?: boolean;
  timezone?: string;
  /** Audio retention: 30 | 90 | 365 days, null = forever, undefined = default (90). */
  audioRetentionDays?: 30 | 90 | 365 | null;
}
