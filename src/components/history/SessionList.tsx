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
 * Session history list page (/sessions).
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@andyfooblah/voicecommon';
import { getCarbotSessions, tripContextLabel } from '../../services/sessions';
import type { CarbotSession } from '../../services/sessions';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function statusBadge(status: string) {
  const classes: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    completed: 'bg-slate-100 text-slate-600',
    interrupted: 'bg-amber-100 text-amber-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${classes[status] ?? classes.completed}`}>
      {status}
    </span>
  );
}

export function SessionList() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<CarbotSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getCarbotSessions(user.uid)
      .then(setSessions)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [user]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Sessions</h1>
        <Link
          to="/sessions/new"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
        >
          + New Session
        </Link>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {sessions.length === 0 && !loading && (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">🚗</p>
          <p className="font-medium">No sessions yet</p>
          <p className="text-sm mt-1">Start your first conversation with CarBot!</p>
        </div>
      )}

      <div className="space-y-2">
        {sessions.map((session) => {
          const date = session.startTime?.toDate?.();
          const dateStr = date?.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
          const timeStr = date?.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          });

          return (
            <Link
              key={session.id}
              to={`/sessions/${session.id}`}
              className="block bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900 text-sm">{dateStr}</span>
                    <span className="text-slate-400 text-xs">{timeStr}</span>
                    {statusBadge(session.status)}
                  </div>
                  {session.tripContext && (
                    <p className="text-xs text-blue-600 mt-0.5">{tripContextLabel(session.tripContext)}</p>
                  )}
                  {session.summary && (
                    <p className="text-sm text-slate-600 mt-1 truncate">{session.summary}</p>
                  )}
                </div>
                <div className="text-xs text-slate-400 whitespace-nowrap shrink-0">
                  {formatDuration(session.durationSeconds)}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
