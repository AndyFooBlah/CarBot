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
 * Memory browser page (/memories).
 *
 * Lists all extracted memory facts across sessions, with filtering by
 * category. Each fact can be edited (content/tags) or deleted.
 */

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@andyfooblah/voicecommon';
import { getMemories, updateMemory, deleteMemory } from '../../services/memories';
import type { Memory, MemoryCategory } from '../../types';

const CATEGORIES: MemoryCategory[] = ['interest', 'event', 'plan', 'fact', 'preference', 'relationship', 'other'];

const CATEGORY_ICON: Record<MemoryCategory, string> = {
  interest: '⭐',
  event: '📅',
  plan: '📋',
  fact: '💡',
  preference: '❤️',
  relationship: '👥',
  other: '📌',
};

const IMPORTANCE_COLOR = ['', 'text-slate-400', 'text-blue-500', 'text-amber-500'];
const IMPORTANCE_LABEL = ['', '·', '★', '★★'];

function MemoryRow({
  memory,
  onSave,
  onDelete,
}: {
  memory: Memory;
  onSave: (id: string, content: string, tags: string[]) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(memory.content);
  const [editTags, setEditTags] = useState(memory.tags.join(', '));

  const date = memory.sessionDate?.toDate?.()?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={3}
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            placeholder="Tags (comma-separated)"
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                onSave(memory.id, editContent, editTags.split(',').map((t) => t.trim()).filter(Boolean));
                setEditing(false);
              }}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Save
            </button>
            <button
              onClick={() => { setEditing(false); setEditContent(memory.content); setEditTags(memory.tags.join(', ')); }}
              className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span>{CATEGORY_ICON[memory.category]}</span>
              <span className={`text-xs font-bold ${IMPORTANCE_COLOR[memory.importance]}`}>
                {IMPORTANCE_LABEL[memory.importance]}
              </span>
              <span className="text-xs text-slate-400">{date}</span>
              {memory.edited && <span className="text-xs text-slate-400 italic">edited</span>}
            </div>
            <p className="text-sm text-slate-800">{memory.content}</p>
            {memory.tags.length > 0 && (
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {memory.tags.map((t) => (
                  <span key={t} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            )}
            <Link
              to={`/sessions/${memory.sessionId}`}
              className="text-xs text-slate-400 hover:text-blue-600 mt-1 inline-block"
            >
              View session →
            </Link>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setEditing(true)} className="text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100">Edit</button>
            <button onClick={() => onDelete(memory.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MemoryBrowser() {
  const { user } = useAuth();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<MemoryCategory | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!user) return;
    setLoading(true);
    getMemories(user.uid, 200, filterCategory === 'all' ? undefined : filterCategory)
      .then(setMemories)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [user, filterCategory]);

  const handleSave = async (id: string, content: string, tags: string[]) => {
    await updateMemory(id, { content, tags }).catch((err) => setError(String(err)));
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this memory?')) return;
    await deleteMemory(id).catch((err) => setError(String(err)));
    load();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Memories</h1>
        <p className="text-sm text-slate-500 mt-0.5">Facts CarBot has learned about your family</p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterCategory('all')}
          className={`text-sm px-3 py-1 rounded-lg font-medium transition-colors ${filterCategory === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          All ({memories.length})
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`text-sm px-3 py-1 rounded-lg font-medium transition-colors ${filterCategory === cat ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {CATEGORY_ICON[cat]} {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : memories.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">🧠</p>
          <p className="font-medium">No memories yet</p>
          <p className="text-sm mt-1">Memories are extracted automatically after each session completes.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {memories.map((m) => (
            <MemoryRow key={m.id} memory={m} onSave={handleSave} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
