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
 * Context document library page (/context).
 *
 * Lists all context documents, allows upload (file or text), toggling
 * active state, editing, tagging, and deletion.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@andyfooblah/voice-common';
import {
  getContextDocuments,
  createContextDocument,
  updateContextDocument,
  setContextDocumentActive,
  deleteContextDocument,
  markContextDocumentReviewed,
  needsReview,
  extractTextFromPdf,
  validateContextUpload,
  MAX_CONTENT_LENGTH,
} from '../../services/contextDocuments';
import type { ContextDocument } from '../../types';

const SOURCE_BADGE: Record<string, string> = {
  upload: 'bg-purple-50 text-purple-700',
  text: 'bg-teal-50 text-teal-700',
  email: 'bg-amber-50 text-amber-700',
};

function DocCard({
  doc: d,
  onToggleActive,
  onDelete,
  onEdit,
  onMarkReviewed,
}: {
  doc: ContextDocument;
  onToggleActive: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onMarkReviewed: () => void;
}) {
  const date = d.updatedAt?.toDate?.()?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const review = needsReview(d);
  const border = review ? 'border-amber-300 bg-amber-50/40' : d.active ? 'border-blue-200' : 'border-slate-200 opacity-70';
  return (
    <div className={`bg-white border rounded-xl p-4 transition-all ${border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-slate-900 text-sm truncate">{d.title}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_BADGE[d.source] ?? 'bg-slate-100 text-slate-600'}`}>
              {d.source}
            </span>
            {review && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800" title="Forwarded emails stay off until you review them">
                new — review before CarBot can use it
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{date} · {d.content.length.toLocaleString()} chars</p>
          {d.tags.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {d.tags.map((t) => (
                <span key={t} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Active toggle */}
          <button
            onClick={onToggleActive}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${d.active ? 'bg-blue-600' : 'bg-slate-300'}`}
            title={d.active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${d.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          {review && (
            <button onClick={onMarkReviewed} className="text-xs text-amber-700 hover:text-amber-900 px-2 py-1 rounded hover:bg-amber-100" title="Keep it off, but stop flagging it as new">Mark reviewed</button>
          )}
          <button onClick={onEdit} className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded hover:bg-slate-100">Edit</button>
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">Delete</button>
        </div>
      </div>
      <p className="text-xs text-slate-600 mt-2 line-clamp-2 font-mono leading-relaxed">{d.content.slice(0, 200)}{d.content.length > 200 ? '…' : ''}</p>
    </div>
  );
}

export function ContextLibrary() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<ContextDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-document form
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<'text' | 'file'>('text');
  const [addTitle, setAddTitle] = useState('');
  const [addContent, setAddContent] = useState('');
  const [addTags, setAddTags] = useState('');
  const [addFilename, setAddFilename] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit form
  const [editingDoc, setEditingDoc] = useState<ContextDocument | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const load = () => {
    if (!user) return;
    setLoading(true);
    getContextDocuments(user.uid)
      .then(setDocs)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [user]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      validateContextUpload(file);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      e.target.value = '';
      return;
    }
    setAddFilename(file.name);
    if (!addTitle) setAddTitle(file.name.replace(/\.[^.]+$/, ''));
    setAddBusy(true);
    try {
      let text: string;
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        text = await extractTextFromPdf(file);
      } else {
        text = await file.text();
      }
      setAddContent(text.slice(0, MAX_CONTENT_LENGTH));
    } catch (err) {
      setError(`Could not read file: ${String(err)}`);
    } finally {
      setAddBusy(false);
    }
  };

  const handleAdd = async () => {
    if (!user || !addTitle.trim() || !addContent.trim()) return;
    setAddBusy(true);
    try {
      const tags = addTags.split(',').map((t) => t.trim()).filter(Boolean);
      await createContextDocument(user.uid, addTitle.trim(), addContent, addMode === 'file' ? 'upload' : 'text', {
        tags,
        ...(addFilename ? { filename: addFilename } : {}),
      });
      setShowAdd(false);
      setAddTitle(''); setAddContent(''); setAddTags(''); setAddFilename('');
      load();
    } catch (err) {
      setError(String(err));
    } finally {
      setAddBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this document?')) return;
    await deleteContextDocument(id).catch((err) => setError(String(err)));
    load();
  };

  const handleToggleActive = async (d: ContextDocument) => {
    await setContextDocumentActive(d.id, !d.active).catch((err) => setError(String(err)));
    load();
  };

  const handleMarkReviewed = async (d: ContextDocument) => {
    await markContextDocumentReviewed(d.id).catch((err) => setError(String(err)));
    load();
  };

  const openEdit = (d: ContextDocument) => {
    setEditingDoc(d);
    setEditTitle(d.title);
    setEditContent(d.content);
    setEditTags(d.tags.join(', '));
  };

  const handleEditSave = async () => {
    if (!editingDoc) return;
    setEditBusy(true);
    try {
      const tags = editTags.split(',').map((t) => t.trim()).filter(Boolean);
      await updateContextDocument(editingDoc.id, { title: editTitle, content: editContent, tags });
      setEditingDoc(null);
      load();
    } catch (err) {
      setError(String(err));
    } finally {
      setEditBusy(false);
    }
  };

  const activeCount = docs.filter((d) => d.active).length;
  const reviewCount = docs.filter(needsReview).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">Context Library</h1>
            {reviewCount > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800" data-testid="review-badge">
                {reviewCount} new document{reviewCount !== 1 ? 's' : ''} to review
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeCount} active document{activeCount !== 1 ? 's' : ''} will be included in your next session
            {reviewCount > 0 && ' · forwarded emails stay off until you turn them on'}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
        >
          + Add Document
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Add document form */}
      {showAdd && (
        <div className="bg-white border border-blue-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Add Document</h2>
            <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-700">✕</button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setAddMode('text')} className={`text-sm px-3 py-1.5 rounded-lg font-medium ${addMode === 'text' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Paste text</button>
            <button onClick={() => setAddMode('file')} className={`text-sm px-3 py-1.5 rounded-lg font-medium ${addMode === 'file' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Upload file</button>
          </div>
          <input
            type="text"
            placeholder="Document title"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {addMode === 'file' ? (
            <div>
              <input ref={fileInputRef} type="file" accept=".txt,.md,.pdf" className="hidden" onChange={handleFileChange} />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-8 border-2 border-dashed border-slate-300 rounded-xl text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
              >
                {addFilename ? `📄 ${addFilename}` : 'Click to select .txt, .md, or .pdf'}
              </button>
              {addContent && <p className="text-xs text-slate-500 mt-1">{addContent.length.toLocaleString()} characters extracted</p>}
            </div>
          ) : (
            <textarea
              placeholder="Paste your document content here…"
              value={addContent}
              onChange={(e) => setAddContent(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          <input
            type="text"
            placeholder="Tags (comma-separated, e.g. lesson-plan, field-trip)"
            value={addTags}
            onChange={(e) => setAddTags(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm border border-slate-300 rounded-xl hover:bg-slate-50">Cancel</button>
            <button
              onClick={handleAdd}
              disabled={addBusy || !addTitle.trim() || !addContent.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50"
            >
              {addBusy ? 'Saving…' : 'Save Document'}
            </button>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingDoc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-20 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Edit Document</h2>
              <button onClick={() => setEditingDoc(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={12}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="Tags (comma-separated)"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingDoc(null)} className="px-4 py-2 text-sm border border-slate-300 rounded-xl hover:bg-slate-50">Cancel</button>
              <button
                onClick={handleEditSave}
                disabled={editBusy}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50"
              >
                {editBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document list */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : docs.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">📄</p>
          <p className="font-medium">No documents yet</p>
          <p className="text-sm mt-1">Add teacher notes, lesson plans, or any text you want CarBot to know about.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((d) => (
            <DocCard
              key={d.id}
              doc={d}
              onToggleActive={() => handleToggleActive(d)}
              onDelete={() => handleDelete(d.id)}
              onEdit={() => openEdit(d)}
              onMarkReviewed={() => handleMarkReviewed(d)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
