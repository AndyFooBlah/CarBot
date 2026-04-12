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
 * Gmail email ingestion Cloud Function.
 *
 * Polls CarBot's Gmail inbox on a schedule and converts new emails from
 * registered users into context documents so CarBot can reference their
 * content during sessions.
 *
 * Flow:
 *   1. Authenticate with Gmail using the stored OAuth2 refresh token.
 *   2. Fetch messages newer than the last-seen historyId stored in Firestore
 *      (or all unread messages on first run).
 *   3. For each message:
 *        a. Look up the sender's email in `users` collection.
 *        b. If found and user has email ingestion enabled, decode and store
 *           the email body in `emails/{emailId}`.
 *        c. Create or update a context document in `context_documents/{docId}`
 *           linked to the ingested email.
 *   4. Update the stored historyId so next run only fetches new messages.
 *
 * Setup required (same secrets as sessionSummaryEmail):
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN,
 *   CARBOT_EMAIL_ADDRESS
 *
 * Schedule: every 15 minutes via Cloud Scheduler (configured in index.ts).
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import { gmailClientId, gmailClientSecret, gmailRefreshToken, carbotEmailAddress } from './sessionSummaryEmail';

/** Firestore document that stores polling state. */
const POLLING_STATE_DOC = 'system/gmailPollingState';

/** Maximum email body length to store (avoids huge Firestore documents). */
const MAX_BODY_CHARS = 10_000;

/** Create an authenticated Gmail API client. */
function createGmailClient() {
  const oauth2Client = new google.auth.OAuth2(
    gmailClientId.value(),
    gmailClientSecret.value(),
  );
  oauth2Client.setCredentials({ refresh_token: gmailRefreshToken.value() });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Decode a Gmail message part from base64url encoding.
 */
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Extract plain text body from a Gmail message payload.
 * Handles both simple and multipart messages.
 */
function extractPlainText(
  payload: {
    mimeType?: string;
    body?: { data?: string };
    parts?: Array<{ mimeType?: string; body?: { data?: string }; parts?: unknown[] }>;
  } | undefined,
): string {
  if (!payload) return '';

  // Direct text/plain body
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart — search parts recursively
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // No plain text found, try text/html as fallback
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        // Strip basic HTML tags to get readable text
        const html = decodeBase64Url(part.body.data);
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }

  return '';
}

/**
 * Get a header value from a Gmail message.
 */
function getHeader(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/**
 * Build a concise context document title from an email subject.
 */
function titleFromSubject(subject: string): string {
  // Strip common prefixes like "Re:", "Fwd:", etc.
  const clean = subject.replace(/^(Re|Fwd|FW|RE|FWD):\s*/i, '').trim();
  return clean.length > 80 ? clean.slice(0, 77) + '...' : clean || 'Email';
}

/**
 * Poll Gmail for new messages and ingest them as context documents.
 */
export async function ingestEmails(): Promise<void> {
  const db = getFirestore();
  const gmail = createGmailClient();
  const carbotEmail = carbotEmailAddress.value();

  // Load polling state (last processed historyId)
  let lastHistoryId: string | null = null;
  try {
    const stateSnap = await db.doc(POLLING_STATE_DOC).get();
    lastHistoryId = stateSnap.data()?.historyId ?? null;
  } catch {
    console.log('[emailIngestion] No polling state found, fetching all unread messages');
  }

  // Build query: unread messages sent TO the CarBot address
  let messageIds: string[] = [];

  if (lastHistoryId) {
    // Incremental: use history API to get only new messages
    try {
      const historyRes = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: lastHistoryId,
        historyTypes: ['messageAdded'],
        labelId: 'INBOX',
      });

      const historyItems = historyRes.data.history ?? [];
      for (const item of historyItems) {
        for (const msg of item.messagesAdded ?? []) {
          if (msg.message?.id) {
            messageIds.push(msg.message.id);
          }
        }
      }
    } catch (err: unknown) {
      const error = err as { code?: number };
      if (error?.code === 404) {
        // historyId expired; fall back to full fetch
        console.warn('[emailIngestion] historyId expired, falling back to full unread fetch');
        lastHistoryId = null;
      } else {
        throw err;
      }
    }
  }

  if (!lastHistoryId) {
    // Full fetch: all unread messages in INBOX
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `to:${carbotEmail} is:unread`,
      maxResults: 50,
    });
    messageIds = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  }

  if (messageIds.length === 0) {
    console.log('[emailIngestion] No new messages to process');
    return;
  }

  console.log(`[emailIngestion] Processing ${messageIds.length} messages`);

  // Build a lookup of registered user emails → userIds
  const usersSnap = await db.collection('users').get();
  const emailToUserId: Record<string, string> = {};
  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    if (data.email) {
      emailToUserId[data.email.toLowerCase()] = userDoc.id;
    }
  }

  let latestHistoryId: string | null = null;
  const batch = db.batch();
  let batchCount = 0;

  for (const messageId of messageIds) {
    try {
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });
      const msg = msgRes.data;

      // Track latest historyId
      if (msg.historyId) {
        latestHistoryId = msg.historyId;
      }

      const headers = msg.payload?.headers ?? [];
      const from = getHeader(headers, 'from');
      const subject = getHeader(headers, 'subject');
      const dateHeader = getHeader(headers, 'date');

      // Extract sender email from "Name <email>" format or plain email
      const fromEmailMatch = from.match(/<([^>]+)>/) ?? from.match(/(\S+@\S+)/);
      const fromEmail = fromEmailMatch?.[1]?.toLowerCase() ?? '';

      if (!fromEmail) {
        console.log(`[emailIngestion] Could not parse sender from: ${from}`);
        continue;
      }

      // Check if sender is a registered user
      const userId = emailToUserId[fromEmail];
      if (!userId) {
        console.log(`[emailIngestion] Unknown sender, skipping: ${fromEmail}`);
        // Mark as read so we don't reprocess
        await gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
        continue;
      }

      // Extract body text
      const body = extractPlainText(msg.payload).slice(0, MAX_BODY_CHARS);
      if (!body.trim()) {
        console.log(`[emailIngestion] Empty body for message ${messageId}`);
        await gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
        continue;
      }

      const now = Timestamp.now();
      const receivedAt = dateHeader ? Timestamp.fromDate(new Date(dateHeader)) : now;

      // Write ingested email record
      const emailRef = db.collection('emails').doc(messageId);
      batch.set(emailRef, {
        id: messageId,
        userId,
        gmailMessageId: messageId,
        from: fromEmail,
        subject,
        receivedAt,
        processedAt: now,
        body,
      });

      // Create a context document linked to this email
      const title = titleFromSubject(subject);
      const ctxRef = db.collection('context_documents').doc();
      batch.set(ctxRef, {
        id: ctxRef.id,
        userId,
        title,
        source: 'email',
        content: body,
        tags: ['email'],
        active: true,
        createdAt: now,
        updatedAt: now,
        emailId: messageId,
      });

      // Update the email record with the context doc ID
      batch.update(emailRef, { contextDocId: ctxRef.id });

      // Mark as read
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });

      batchCount += 2; // email + context doc

      // Commit in batches of ~400 operations (Firestore limit is 500)
      if (batchCount >= 400) {
        await batch.commit();
        batchCount = 0;
      }

      console.log(`[emailIngestion] Ingested email "${subject}" from ${fromEmail} → user ${userId}`);
    } catch (err) {
      console.error(`[emailIngestion] Failed to process message ${messageId}:`, err);
    }
  }

  // Commit remaining operations
  if (batchCount > 0) {
    await batch.commit();
  }

  // Update polling state
  if (latestHistoryId) {
    await db.doc(POLLING_STATE_DOC).set(
      { historyId: latestHistoryId, lastRunAt: Timestamp.now() },
      { merge: true },
    );
  }

  console.log(`[emailIngestion] Done. Processed ${messageIds.length} messages.`);
}
