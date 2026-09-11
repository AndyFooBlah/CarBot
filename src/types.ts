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
 * A single scheduled activity for a given day.
 * e.g. { name: "Drop-off", startTime: "07:15", endTime: "08:15" }
 */
export interface ScheduleEntry {
  name: string;
  /** Start time in 'HH:MM' (24-hour, local time). */
  startTime: string;
  /** End time in 'HH:MM' (24-hour, local time). */
  endTime: string;
}

/**
 * User-configured weekly schedule.
 * Stored in `users/{uid}.routine`.
 *
 * Each day that has at least one entry is treated as a "structured day".
 * Days with no entries are treated as unscheduled.
 */
export interface Routine {
  /**
   * Per-day activity list. Only days with activities need to be present.
   * e.g. Mon–Fri might have Drop-off + Pickup; Sat might have Ice Hockey + Violin.
   */
  schedule: Partial<Record<DayOfWeek, ScheduleEntry[]>>;
  /**
   * How many minutes before an activity's start time (or after its end time)
   * still counts as "in transit". Default: 30.
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
 * A single user-defined named location.
 * Stored as an array in `users/{uid}.locations`.
 */
export interface NamedLocation {
  /** Short label used in conversation, e.g. "home", "school", "hockey rink". */
  name: string;
  /** The address/place query the user entered, e.g. "Lincoln Elementary, Palo Alto". */
  query: string;
  /** Full formatted address resolved via Maps geocoding. Equals query if no Maps key. */
  resolvedAddress: string;
}

/** Kept for type compatibility — use NamedLocation[] on the profile instead. */
export type LocationConfig = NamedLocation[];

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
  locations?: NamedLocation[];
  /** Child's name, used in transcript speaker labels. */
  childName?: string;
  /** The name the bot introduces itself with, e.g. "Zoomer". Default: "CarBot". */
  botName?: string;
  /**
   * When true, the bot will introduce itself by name at the start of the next
   * session. Set to true whenever botName is saved; cleared after first
   * successful session with that name.
   */
  botNameNeedsIntro?: boolean;
  /** Whether to receive session summary emails. Default: true. */
  emailSummariesEnabled?: boolean;
  /** Gemini Live voice name (e.g. "Puck", "Kore"). Default: Gemini API default (Puck). */
  selectedVoice?: string;
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
  /**
   * Set when a parent has looked at the document (toggled it, edited it, or
   * pressed "Mark reviewed"). Email-sourced docs arrive inactive and without
   * this field; the Context page counts those as "new documents to review".
   */
  reviewedAt?: Timestamp;
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
  entries: import('@andyfooblah/voice-common').TranscriptEntry[];
  editedAt: Timestamp;
  /** Optional user annotation. */
  note?: string;
}
