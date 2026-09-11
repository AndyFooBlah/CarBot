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
 * Context document service.
 *
 * Manages the `context_documents/{docId}` collection — user-supplied text
 * documents (uploaded files, pasted text, or ingested emails) that are
 * injected into CarBot's system instruction when marked active.
 */

import {
  collection,
  doc,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@andyfooblah/voice-common';
import type { ContextDocument, ContextDocumentSource } from '../types';
import { sanitizeInline, stripControlChars, MAX_CONTEXT_DOC_SECTION_CHARS } from './promptSafety';

/** Maximum content length stored in Firestore (50,000 chars). */
export const MAX_CONTENT_LENGTH = 50_000;

/**
 * Maximum length of a single document's content included verbatim in the
 * system instruction. Longer docs get a truncated excerpt instead.
 */
export const INSTRUCTION_INLINE_LIMIT = 2_000;

/**
 * M5: MIME + size allowlist for client-side uploads.
 *
 * The UI exposes a file picker restricted to .txt/.md/.pdf, but the type
 * attribute is a hint only — a user can still select any file. These caps
 * are enforced in `validateContextUpload()` before any content is read,
 * so a crafted upload can't drive text extraction against a malformed or
 * oversized payload. (Uploads don't hit Cloud Storage — they're text that
 * goes straight into Firestore as a document string.)
 */
export const MAX_CONTEXT_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_CONTEXT_MIME_TYPES: readonly string[] = [
  'text/plain',
  'text/markdown',
  'application/pdf',
  // Some browsers report empty string for .md files; validateContextUpload
  // falls back to the extension in that case.
  '',
];
const ALLOWED_CONTEXT_EXTENSIONS: readonly string[] = ['.txt', '.md', '.pdf'];

export function validateContextUpload(file: File): void {
  if (file.size > MAX_CONTEXT_UPLOAD_BYTES) {
    throw new Error(
      `File is ${Math.round(file.size / 1024 / 1024)} MB; limit is ${MAX_CONTEXT_UPLOAD_BYTES / 1024 / 1024} MB.`,
    );
  }
  const mimeOk = ALLOWED_CONTEXT_MIME_TYPES.includes(file.type);
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  const extOk = ALLOWED_CONTEXT_EXTENSIONS.includes(ext);
  if (!mimeOk && !extOk) {
    throw new Error(
      `Unsupported file type. Accepted: .txt, .md, .pdf (got "${file.name}").`,
    );
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Fetch all context documents for a user, ordered by last updated. */
export async function getContextDocuments(userId: string): Promise<ContextDocument[]> {
  const snap = await getDocs(
    query(
      collection(db, 'context_documents'),
      where('userId', '==', userId),
      orderBy('updatedAt', 'desc'),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ContextDocument);
}

/** Fetch only active context documents. */
export async function getActiveContextDocuments(userId: string): Promise<ContextDocument[]> {
  const snap = await getDocs(
    query(
      collection(db, 'context_documents'),
      where('userId', '==', userId),
      where('active', '==', true),
      orderBy('updatedAt', 'desc'),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ContextDocument);
}

/**
 * Build the context document section of the system instruction.
 *
 * Short documents (< INSTRUCTION_INLINE_LIMIT chars) are included in full.
 * Longer documents are truncated with a "[...truncated]" notice.
 *
 * @returns A formatted string, or null if there are no active documents.
 */
export function buildContextDocumentSection(docs: ContextDocument[]): string | null {
  if (docs.length === 0) return null;

  // Per-doc cap (INSTRUCTION_INLINE_LIMIT) plus a total cap on the section so
  // an unbounded number of active docs cannot crowd out the rest of the
  // prompt (#33). Titles and bodies are stripped of control characters.
  const sections: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const d of docs) {
    const header = `[${sanitizeInline(d.title, 120) || 'Untitled'}]`;
    const content = stripControlChars(d.content);
    const body =
      content.length <= INSTRUCTION_INLINE_LIMIT
        ? content
        : content.slice(0, INSTRUCTION_INLINE_LIMIT) + '\n[...truncated]';
    const section = `${header}\n${body}`;
    if (used + section.length > MAX_CONTEXT_DOC_SECTION_CHARS) {
      omitted++;
      continue;
    }
    sections.push(section);
    used += section.length;
  }
  if (omitted > 0) {
    sections.push(`[...${omitted} more document${omitted === 1 ? '' : 's'} omitted — too much context]`);
  }

  return `Context documents supplied by the parent (reference information):\n\n${sections.join('\n\n---\n\n')}`;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/** Create a new context document from a text or file upload. */
export async function createContextDocument(
  userId: string,
  title: string,
  content: string,
  source: ContextDocumentSource,
  options?: { tags?: string[]; filename?: string; emailId?: string },
): Promise<string> {
  const now = Timestamp.now();
  const docData: Omit<ContextDocument, 'id'> = {
    userId,
    title,
    source,
    content: content.slice(0, MAX_CONTENT_LENGTH),
    tags: options?.tags ?? [],
    active: true,
    createdAt: now,
    updatedAt: now,
    ...(options?.filename ? { filename: options.filename } : {}),
    ...(options?.emailId ? { emailId: options.emailId } : {}),
  };

  const ref = await addDoc(collection(db, 'context_documents'), docData);
  return ref.id;
}

/** Update the content and/or title of a context document. */
export async function updateContextDocument(
  docId: string,
  updates: { title?: string; content?: string; tags?: string[] },
): Promise<void> {
  await updateDoc(doc(db, 'context_documents', docId), {
    ...updates,
    ...(updates.content ? { content: updates.content.slice(0, MAX_CONTENT_LENGTH) } : {}),
    updatedAt: Timestamp.now(),
  });
}

/**
 * Toggle the active state of a context document. Touching the toggle counts
 * as the parent having reviewed the document (see needsReview).
 */
export async function setContextDocumentActive(docId: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, 'context_documents', docId), {
    active,
    reviewedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}

/**
 * Mark a document as reviewed without changing its active state. Used for
 * email-sourced documents, which arrive inactive (#33) so third-party text
 * never reaches the child's prompt until a parent has looked at it.
 */
export async function markContextDocumentReviewed(docId: string): Promise<void> {
  await updateDoc(doc(db, 'context_documents', docId), {
    reviewedAt: Timestamp.now(),
  });
}

/** True for an email-sourced document a parent has not yet activated or reviewed. */
export function needsReview(d: Pick<ContextDocument, 'source' | 'active' | 'reviewedAt'>): boolean {
  return d.source === 'email' && !d.active && !d.reviewedAt;
}

/** Hard-delete a context document. */
export async function deleteContextDocument(docId: string): Promise<void> {
  await deleteDoc(doc(db, 'context_documents', docId));
}

// ---------------------------------------------------------------------------
// PDF text extraction (client-side)
// ---------------------------------------------------------------------------

/**
 * Extract plain text from a PDF file using pdfjs-dist.
 * Loads pdfjs lazily to avoid bundling the worker when not needed.
 *
 * @throws If the file is not a valid PDF or text extraction fails.
 */
export async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();

  // Lazy import to avoid bundling pdfjs in the main chunk
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const parts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter((item): item is import('pdfjs-dist/types/src/display/api').TextItem =>
        'str' in item,
      )
      .map((item) => item.str)
      .join(' ');
    parts.push(pageText);
  }

  return parts.join('\n\n');
}
