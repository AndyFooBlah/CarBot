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
 * Session detail page (/sessions/:id).
 *
 * Shows: audio player, three tabs (Raw Transcript, Clean Transcript,
 * Memory Highlights). Each transcript tab supports inline editing with
 * full version history.
 */

import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getSession } from '@andyfooblah/voicecommon';
import type { SessionMetadata, TranscriptEntry } from '@andyfooblah/voicecommon';
import { getSessionMemories } from '../../services/memories';
import {
  getRawTranscript,
  getCleanTranscript,
  getTranscriptHistory,
  getActiveTranscript,
  saveTranscriptEdit,
} from '../../services/transcriptEditor';
import type { TranscriptType } from '../../services/transcriptEditor';
import type { Memory, TranscriptEdit } from '../../types';
import { tripContextLabel } from '../../services/sessions';
import type { CarbotSession } from '../../services/sessions';

type Tab = 'raw' | 'clean' | 'memories';

function MemoryCard({ memory }: { memory: Memory }) {
  const importanceColor = ['', 'text-slate-500', 'text-blue-600', 'text-amber-600'][memory.importance];
  const importanceLabel = ['', 'minor', 'notable', 'important'][memory.importance];
  return (
    <div className="border border-slate-200 rounded-xl p-3 bg-white">
      <p className="text-sm text-slate-800">{memory.content}</p>
      <div className="flex gap-2 mt-2 flex-wrap">
        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{memory.category}</span>
        <span className={`text-xs font-medium ${importanceColor}`}>{importanceLabel}</span>
        {memory.tags.map((t) => (
          <span key={t} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{t}</span>
        ))}
      </div>
    </div>
  );
}

function TranscriptView({
  sessionId,
  type,
}: {
  sessionId: string;
  type: TranscriptType;
}) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [editedEntries, setEditedEntries] = useState<TranscriptEntry[]>([]);
  const [editNote, setEditNote] = useState('');
  const [history, setHistory] = useState<TranscriptEdit[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleanInfo, setCleanInfo] = useState<{ generatedAt: Date; model: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    const load = async () => {
      if (type === 'entries') {
        const raw = await getRawTranscript(sessionId);
        setEntries(raw);
      } else {
        const clean = await getCleanTranscript(sessionId);
        if (clean) {
          setCleanInfo({ generatedAt: clean.generatedAt.toDate(), model: clean.model });
          setEntries(clean.entries);
        }
      }
      const hist = await getTranscriptHistory(sessionId, type);
      setHistory(hist);
      // If there are edits, show the most recent
      if (hist.length > 0) {
        setEntries(hist[0].entries);
      }
    };
    load().catch(console.error).finally(() => setLoading(false));
  }, [sessionId, type]);

  const startEdit = () => {
    setEditedEntries(entries.map((e) => ({ ...e })));
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditNote('');
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await saveTranscriptEdit(sessionId, type, editedEntries, editNote || undefined);
      setEntries(editedEntries);
      const updated = await getTranscriptHistory(sessionId, type);
      setHistory(updated);
      setEditing(false);
      setEditNote('');
    } catch (err) {
      console.error('Failed to save edit:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-8"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400 text-sm">
        {type === 'clean' ? 'Clean transcript not yet generated.' : 'No transcript available.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Metadata / actions bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {history.length > 0 && (
            <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
              Edited {history.length}×
            </span>
          )}
          {cleanInfo && type === 'clean' && (
            <span className="text-xs text-slate-400">
              Generated {cleanInfo.generatedAt.toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            {showHistory ? 'Hide history' : `History (${history.length})`}
          </button>
          {!editing && (
            <button
              onClick={startEdit}
              className="text-xs px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Version history drawer */}
      {showHistory && history.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Version History</p>
          {history.map((edit, i) => (
            <button
              key={edit.id}
              onClick={() => setEntries(edit.entries)}
              className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 transition-all"
            >
              <span className="font-medium">v{history.length - i}</span>{' '}
              <span className="text-slate-500">
                {edit.editedAt.toDate().toLocaleString()}
              </span>
              {edit.note && <span className="text-slate-400 ml-2">— {edit.note}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Transcript entries */}
      {editing ? (
        <div className="space-y-2">
          {editedEntries.map((entry, idx) => (
            <div key={idx} className="flex gap-2 items-start">
              <span className={`text-xs font-medium pt-2 w-14 shrink-0 ${entry.role === 'user' ? 'text-blue-600' : entry.role === 'bot' ? 'text-emerald-600' : 'text-slate-400'}`}>
                {entry.role}
              </span>
              <textarea
                value={entry.text}
                onChange={(e) => {
                  const next = [...editedEntries];
                  next[idx] = { ...next[idx], text: e.target.value };
                  setEditedEntries(next);
                }}
                className="flex-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={Math.max(1, Math.ceil(entry.text.length / 80))}
              />
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <input
              type="text"
              placeholder="Edit note (optional)"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={cancelEdit}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveEdit}
              disabled={saving}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, idx) => (
            <div key={idx} className="flex gap-3">
              <span className={`text-xs font-semibold pt-0.5 w-10 shrink-0 ${entry.role === 'user' ? 'text-blue-600' : entry.role === 'bot' ? 'text-emerald-600' : 'text-slate-400'}`}>
                {entry.role === 'user' ? 'You' : entry.role === 'bot' ? 'Bot' : '🔧'}
              </span>
              <p className="text-sm text-slate-800 leading-relaxed">{entry.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<CarbotSession | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tab, setTab] = useState<Tab>('raw');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getSession(id),
      getSessionMemories(id),
    ])
      .then(([sess, mems]) => {
        setSession(sess as CarbotSession | null);
        setMemories(mems);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!session || !id) {
    return (
      <div className="text-center py-16 text-slate-400">
        Session not found. <Link to="/sessions" className="text-blue-600 hover:underline">Back to sessions</Link>
      </div>
    );
  }

  const date = session.startTime?.toDate?.();
  const dateStr = date?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const duration = session.durationSeconds
    ? `${Math.floor(session.durationSeconds / 60)}m ${session.durationSeconds % 60}s`
    : 'unknown';

  const tabs: { key: Tab; label: string }[] = [
    { key: 'raw', label: 'Raw Transcript' },
    { key: 'clean', label: 'Clean Transcript' },
    { key: 'memories', label: `Memories (${memories.length})` },
  ];

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/sessions" className="text-sm text-blue-600 hover:underline">← All sessions</Link>

      {/* Session header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{dateStr}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
              <span>{duration}</span>
              {session.tripContext && (
                <span className="text-blue-600">{tripContextLabel(session.tripContext)}</span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                session.status === 'completed' ? 'bg-slate-100 text-slate-600' :
                session.status === 'active' ? 'bg-green-100 text-green-700' :
                'bg-amber-100 text-amber-700'
              }`}>{session.status}</span>
            </div>
          </div>
        </div>
        {session.summary && (
          <p className="mt-3 text-slate-700 text-sm bg-slate-50 rounded-xl px-3 py-2">{session.summary}</p>
        )}

        {/* Audio player */}
        {session.audioUrl && (
          <div className="mt-4">
            <p className="text-xs text-slate-500 mb-1">Session audio</p>
            <audio
              controls
              src={session.audioUrl}
              className="w-full rounded-lg"
              preload="none"
            />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div>
        <div className="flex gap-1 border-b border-slate-200 mb-4">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'raw' && <TranscriptView sessionId={id} type="entries" />}
        {tab === 'clean' && <TranscriptView sessionId={id} type="clean" />}
        {tab === 'memories' && (
          <div className="space-y-3">
            {memories.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-8">
                Memory extraction runs after the session completes. Check back shortly.
              </p>
            ) : (
              memories.map((m) => <MemoryCard key={m.id} memory={m} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
