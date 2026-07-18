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
 *        a. Verify the message passed DMARC (per Gmail's own
 *           Authentication-Results verdict) — rejects From-header spoofing.
 *        b. Look up the sender's email in `users` collection. Registration
 *           is the only per-user gate; there is no separate opt-in flag.
 *        c. If both checks pass, decode and store the email body in
 *           `emails/{emailId}`.
 *        d. Create or update a context document in `context_documents/{docId}`
 *           linked to the ingested email.
 *   4. Update the stored historyId so next run only fetches new messages.
 *
 * Trust model: attribution = DMARC-authenticated From address matched
 * against a registered user's email. Gmail has already evaluated
 * SPF/DKIM/DMARC on receipt; we read its verdict from the topmost
 * Authentication-Results header rather than re-verifying signatures
 * ourselves. Messages failing DMARC are dropped (marked read) — a spoofed
 * From: of a registered parent must not become a context document in a
 * kid-facing bot. Senders on domains with no DMARC policy will fail this
 * gate; all major consumer providers (Gmail, iCloud, Outlook, Yahoo)
 * publish one, so in practice this only excludes unauthenticated
 * bulk/spoofed mail.
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
 * Mask an email address for logging: keep the first character of the
 * local part and the domain, hide the rest. "parent@example.com" →
 * "p***@example.com". Never returns the full local part, so log
 * aggregation systems don't accumulate raw addresses (issue #27).
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * True if Gmail's own DMARC evaluation of this message passed.
 *
 * Gmail runs SPF/DKIM/DMARC on every inbound message and records the
 * verdict in an Authentication-Results header with its authserv-id
 * ("mx.google.com"). We trust ONLY headers bearing that authserv-id —
 * a sender can inject their own forged Authentication-Results header,
 * but cannot forge one that Gmail prepends on receipt; per RFC 8601
 * the topmost matching header is the receiving server's own.
 *
 * DMARC (not bare SPF/DKIM) is the correct check here because it is
 * the alignment test: it requires the *visible From: domain* to match
 * what SPF/DKIM actually authenticated — which is precisely the
 * spoofing gap in From-header-based attribution.
 *
 * Note: we cannot rely on Gmail having spam-foldered DMARC failures.
 * gmail.com itself publishes p=none, so a spoofed @gmail.com From can
 * land in INBOX — but the dmarc=fail verdict is still recorded in the
 * header, which is what we check.
 */
export function dmarcPasses(
  headers: Array<{ name?: string; value?: string }> | undefined,
): boolean {
  const authResults = (headers ?? [])
    .filter((h) => h.name?.toLowerCase() === 'authentication-results')
    .map((h) => h.value ?? '');
  // Topmost header whose authserv-id is Gmail's own.
  const googleVerdict = authResults.find((v) =>
    v.trim().toLowerCase().startsWith('mx.google.com'),
  );
  if (!googleVerdict) return false;
  return /(?:^|;)\s*dmarc=pass\b/i.test(googleVerdict);
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

      const headers = (msg.payload?.headers ?? []) as Array<{ name?: string; value?: string }>;
      const from = getHeader(headers, 'from');
      const subject = getHeader(headers, 'subject');
      const dateHeader = getHeader(headers, 'date');

      // Extract sender email from "Name <email>" format or plain email
      const fromEmailMatch = from.match(/<([^>]+)>/) ?? from.match(/(\S+@\S+)/);
      const fromEmail = fromEmailMatch?.[1]?.toLowerCase() ?? '';

      if (!fromEmail) {
        // Don't log the raw From header — it can carry a display name (PII).
        console.log(`[emailIngestion] Could not parse sender for message ${messageId}`);
        continue;
      }

      // DMARC gate: only accept messages Gmail itself verified as
      // authentically from the claimed From: domain. Without this, a
      // spoofed From: of a registered parent's address would be enough
      // to inject a context document into the family's sessions.
      if (!dmarcPasses(headers)) {
        console.warn(
          `[emailIngestion] DMARC failed for message ${messageId} from ${maskEmail(fromEmail)} — dropping`,
        );
        await gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
        continue;
      }

      // Check if sender is a registered user
      const userId = emailToUserId[fromEmail];
      if (!userId) {
        console.log(`[emailIngestion] Unknown sender, skipping: ${maskEmail(fromEmail)}`);
        // Mark as read so we don't reprocess
        await gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
        continue;
      }

      // Extract body text
      const body = extractPlainText(msg.payload as Parameters<typeof extractPlainText>[0]).slice(0, MAX_BODY_CHARS);
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

      // No subject (sender-authored PII) and masked sender in logs (#27);
      // userId is kept for trace correlation.
      console.log(`[emailIngestion] Ingested email ${messageId} from ${maskEmail(fromEmail)} → user ${userId}`);
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
