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
 * CarBot-specific TypeScript types.
 *
 * Base session and transcript types are inherited from VoiceCommon.
 * This file defines the additional types specific to CarBot: routine
 * configuration, trip context, memories, and context documents.
 */

import { Timestamp } from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Routine & trip context
// ---------------------------------------------------------------------------

/** Days of the week used in routine config. */
export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

/**
 * User-configured school schedule.
 * Stored in `users/{uid}.routine`.
 */
export interface Routine {
  /** Which days are school days. */
  schoolDays: DayOfWeek[];
  /** Morning departure time in 'HH:MM' (24-hour, local time). */
  morningDepartureTime: string;
  /** Afternoon pickup time in 'HH:MM' (24-hour, local time). */
  afternoonPickupTime: string;
  /**
   * How many minutes on either side of a drive time still counts as a commute.
   * Default: 30.
   */
  contextWindowMinutes: number;
}

/**
 * Inferred context for a car trip.
 * Computed from the Routine config + current date/time.
 */
export type TripContext =
  | 'school_commute_morning'
  | 'school_commute_afternoon'
  | 'school_day_other'
  | 'non_school_day'
  | 'unstructured';

// ---------------------------------------------------------------------------
// Location config
// ---------------------------------------------------------------------------

/**
 * User-configured location names.
 * Stored in `users/{uid}.locations`.
 * Only human-readable names — never raw coordinates.
 */
export interface LocationConfig {
  /** Home city or neighborhood, e.g. "Palo Alto, CA". */
  homeCity: string;
  /** School name, e.g. "Lincoln Elementary". */
  schoolName: string;
  /** Optional: school address for display only. */
  schoolAddress?: string;
}

// ---------------------------------------------------------------------------
// User profile (extends VoiceCommon UserProfile)
// ---------------------------------------------------------------------------

/**
 * CarBot user profile document stored at `users/{uid}`.
 */
export interface CarbotUserProfile {
  email: string;
  displayName: string;
  createdAt: Timestamp;
  timezone?: string;
  routine?: Routine;
  locations?: LocationConfig;
  /** Child's name, used in transcript speaker labels. */
  childName?: string;
  /** Whether to receive session summary emails. Default: true. */
  emailSummariesEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Session extension fields
// ---------------------------------------------------------------------------

/**
 * CarBot-specific fields added to VoiceCommon's base session document.
 * Written immediately after session creation via a Firestore update.
 */
export interface CarbotSessionFields {
  /** Inferred trip context at session start. */
  tripContext: TripContext;
  /** IDs of context documents that were active at session start. */
  contextDocIds: string[];
  /** One-line AI summary — written post-session by Cloud Function. */
  summary?: string;
}

// ---------------------------------------------------------------------------
// Memory facts
// ---------------------------------------------------------------------------

/** Categories for memory facts extracted from conversation. */
export type MemoryCategory =
  | 'interest'
  | 'event'
  | 'plan'
  | 'fact'
  | 'preference'
  | 'relationship'
  | 'other';

/**
 * A single extracted fact from a session transcript.
 */
export interface MemoryFact {
  id: string;
  content: string;
  category: MemoryCategory;
  /** 1 = minor detail, 2 = notable, 3 = important. */
  importance: 1 | 2 | 3;
  tags: string[];
}

/**
 * Full memory document as stored in `memories/{memoryId}`.
 */
export interface Memory {
  id: string;
  userId: string;
  sessionId: string;
  sessionDate: Timestamp;
  content: string;
  category: MemoryCategory;
  importance: 1 | 2 | 3;
  tags: string[];
  createdAt: Timestamp;
  /** True if the user has manually edited this fact. */
  edited: boolean;
}

// ---------------------------------------------------------------------------
// Context documents
// ---------------------------------------------------------------------------

export type ContextDocumentSource = 'upload' | 'email' | 'text';

/**
 * A user-supplied context document.
 * Stored in `context_documents/{docId}`.
 */
export interface ContextDocument {
  id: string;
  userId: string;
  title: string;
  source: ContextDocumentSource;
  content: string;
  tags: string[];
  /** When true, this document is included in the next session's system instruction. */
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Present when source === 'email'. */
  emailId?: string;
  /** Original filename when source === 'upload'. */
  filename?: string;
}

// ---------------------------------------------------------------------------
// Ingested emails
// ---------------------------------------------------------------------------

/**
 * An email ingested by the Gmail polling Cloud Function.
 * Stored in `emails/{emailId}`.
 */
export interface IngestedEmail {
  id: string;
  userId: string;
  gmailMessageId: string;
  from: string;
  subject: string;
  receivedAt: Timestamp;
  processedAt?: Timestamp;
  contextDocId?: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Transcript editing
// ---------------------------------------------------------------------------

/**
 * A versioned transcript edit stored at
 * `sessions/{sessionId}/transcriptEdits/{editId}`.
 */
export interface TranscriptEdit {
  id: string;
  /** Which transcript was edited. */
  type: 'entries' | 'clean';
  entries: import('@andyfooblah/voicecommon').TranscriptEntry[];
  editedAt: Timestamp;
  /** Optional user annotation. */
  note?: string;
}
