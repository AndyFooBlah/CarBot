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
 * CarBot Cloud Functions entry point.
 *
 * Exports:
 *
 *   onSessionCompleted (Firestore trigger)
 *     Triggered when sessions/{sessionId}.status changes to 'completed'.
 *     Runs three post-session tasks in parallel:
 *       1. extractMemoriesFromSession  — extract facts + generate summary
 *       2. generateCleanTranscript     — AI-cleaned, labeled transcript
 *       3. sendSessionSummaryEmail     — friendly email recap to parent
 *
 *   ingestEmailsScheduled (Cloud Scheduler, every 15 minutes)
 *     Polls the CarBot Gmail inbox and converts emails from registered
 *     users into active context documents.
 */

import { initializeApp } from 'firebase-admin/app';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { extractMemoriesFromSession } from './memoryExtraction';
import { generateCleanTranscript } from './cleanTranscript';
import { sendSessionSummaryEmail } from './sessionSummaryEmail';
import { ingestEmails } from './emailIngestion';
import {
  geminiApiKey,
} from './memoryExtraction';
import {
  gmailClientId,
  gmailClientSecret,
  gmailRefreshToken,
  carbotEmailAddress,
  carbotWebUrl,
} from './sessionSummaryEmail';

export { geoProxy } from './geoProxy';
export { cacheWikipediaArticle } from './cacheWikipedia';
export {
  dailyDataCleanup,
  cleanTranscriptForSession,
  extractMemoriesForSession,
  sendSummaryEmailForSession,
} from './dataCleanup';
export {
  checkAndReserveVoiceQuota,
  recordVoiceUsage,
  getVoiceQuotaStatus,
} from './voiceQuota';

initializeApp();

/**
 * Firestore trigger: runs after a session document is updated.
 * Detects the transition to 'completed' status and kicks off
 * all post-processing tasks.
 */
export const onSessionCompleted = onDocumentUpdated(
  {
    document: 'sessions/{sessionId}',
    secrets: [
      geminiApiKey,
      gmailClientId,
      gmailClientSecret,
      gmailRefreshToken,
      carbotEmailAddress,
      carbotWebUrl,
    ],
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (event) => {
    const sessionId = event.params.sessionId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    // Only run when status transitions to 'completed'
    if (before?.status === after?.status || after?.status !== 'completed') {
      return;
    }

    console.log(`[onSessionCompleted] Processing session ${sessionId}`);

    // Run all three post-processing tasks in parallel.
    // Each task handles its own errors internally — a failure in one
    // does not block the others.
    const results = await Promise.allSettled([
      extractMemoriesFromSession(sessionId),
      generateCleanTranscript(sessionId),
      sendSessionSummaryEmail(sessionId),
    ]);

    for (const [i, result] of results.entries()) {
      const names = ['extractMemories', 'generateCleanTranscript', 'sendSummaryEmail'];
      if (result.status === 'rejected') {
        console.error(`[onSessionCompleted] ${names[i]} failed:`, result.reason);
      }
    }

    console.log(`[onSessionCompleted] Done for session ${sessionId}`);
  },
);

/**
 * Scheduled function: polls CarBot's Gmail inbox every 15 minutes.
 * Converts emails from registered users into active context documents.
 */
export const ingestEmailsScheduled = onSchedule(
  {
    schedule: 'every 15 minutes',
    secrets: [
      gmailClientId,
      gmailClientSecret,
      gmailRefreshToken,
      carbotEmailAddress,
    ],
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async () => {
    console.log('[ingestEmailsScheduled] Starting Gmail poll');
    await ingestEmails();
  },
);
