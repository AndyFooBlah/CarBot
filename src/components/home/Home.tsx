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
 * Home page (`/`) — the landing experience after sign-in.
 *
 * One primary CTA (Start a Session) plus a few small at-a-glance cards.
 * Cards hide themselves when their data isn't available so the page stays
 * clean for new accounts: a brand-new user sees nothing but the greeting
 * and the Start button.
 *
 * Layout decisions (per the design discussion):
 *   - Recent sessions: last 3, with one-line summary if extracted
 *   - Today's schedule: only when a routine is configured
 *   - Voice quota: only when ≥50% of the daily cap is used (otherwise noise)
 *   - Favorite topics: only when memories have been extracted
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@andyfooblah/voice-common';
import { getCarbotSessions, type CarbotSession } from '../../services/sessions';
import { getDayScheduleSummary } from '../../services/tripContext';
import { getVoiceQuotaStatus, type VoiceQuotaCheckResult } from '../../services/voiceQuota';
import { useUserProfile } from '../../hooks/useUserProfile';
import { getMemories } from '../../services/memories';
import type { Memory } from '../../types';

export function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useUserProfile(user?.uid ?? null);

  const [sessions, setSessions] = useState<CarbotSession[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [quota, setQuota] = useState<VoiceQuotaCheckResult | null>(null);

  useEffect(() => {
    if (!user) return;
    // Load recent sessions for the activity widget.
    getCarbotSessions(user.uid)
      .then((all) => setSessions(all.slice(0, 3)))
      .catch((err) => console.error('[Home] sessions load failed:', err));
    // Load up to 30 memories so we can derive favorite topics from tags.
    getMemories(user.uid, 30)
      .then(setMemories)
      .catch((err) => console.error('[Home] memories load failed:', err));
    // Quota status is best-effort — failure just means we hide the widget.
    getVoiceQuotaStatus()
      .then(setQuota)
      .catch(() => null);
  }, [user]);

  const greetingName = user?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? null;

  const todaysSchedule = profile?.routine
    ? getDayScheduleSummary(profile.routine, new Date())
    : null;

  const favoriteTopics = topTagsFromMemories(memories, 8);

  // Show quota only when ≥50% of the daily cap is consumed — otherwise it's
  // just noise. Same threshold as the Settings page warning.
  const quotaUsedFraction = quota
    ? Math.max(
        quota.sessionStartCount / quota.limits.maxSessionsPerDay,
        quota.audioMinutes / quota.limits.maxAudioMinutesPerDay,
      )
    : 0;
  const showQuota = quota && quotaUsedFraction >= 0.5;

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome back{greetingName ? `, ${greetingName}` : ''}
        </h1>
      </div>

      {/* Primary CTA */}
      <button
        onClick={() => navigate('/sessions/new')}
        className="w-full bg-blue-600 text-white rounded-2xl px-6 py-5 text-lg font-semibold shadow-sm hover:bg-blue-700 transition-colors flex items-center justify-center gap-3"
      >
        <span aria-hidden>▶</span> Start a session
      </button>

      {/* Recent sessions */}
      <RecentSessionsCard sessions={sessions} />

      {/* Side-by-side: schedule + quota (each hides if irrelevant) */}
      {(todaysSchedule || showQuota) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {todaysSchedule && <TodayCard text={todaysSchedule} />}
          {showQuota && quota && <QuotaCard quota={quota} />}
        </div>
      )}

      {/* Favorite topics — only when we have memories */}
      {favoriteTopics.length > 0 && <FavoriteTopicsCard tags={favoriteTopics} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components

function RecentSessionsCard({ sessions }: { sessions: CarbotSession[] }) {
  if (sessions.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 text-center text-slate-500 text-sm">
        No sessions yet — tap "Start a session" to begin.
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Recent sessions</h2>
        <Link to="/sessions" className="text-xs text-blue-600 hover:text-blue-800">View all →</Link>
      </div>
      <ul className="divide-y divide-slate-100">
        {sessions.map((s) => (
          <li key={s.id} className="py-2.5">
            <Link
              to={`/sessions/${s.id}`}
              className="block hover:bg-slate-50 -mx-2 px-2 py-1 rounded transition-colors"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-slate-900 whitespace-nowrap">
                  {formatRelativeDate(s.startTime?.toDate?.() ?? new Date())}
                </span>
                <span className="text-xs text-slate-400 whitespace-nowrap">
                  {formatDuration(s.durationSeconds ?? 0)}
                </span>
              </div>
              {s.summary && (
                <p className="text-sm text-slate-600 mt-0.5 line-clamp-1">{s.summary}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TodayCard({ text }: { text: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-2">Today</h2>
      <p className="text-sm text-slate-700 whitespace-pre-line">{text}</p>
    </div>
  );
}

function QuotaCard({ quota }: { quota: VoiceQuotaCheckResult }) {
  const minutesLeft = Math.max(0, quota.limits.maxAudioMinutesPerDay - quota.audioMinutes);
  const sessionsLeft = Math.max(0, quota.limits.maxSessionsPerDay - quota.sessionStartCount);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-2">Daily quota</h2>
      <p className="text-sm text-slate-700">
        <span className="font-semibold">{minutesLeft}</span> min and{' '}
        <span className="font-semibold">{sessionsLeft}</span> session{sessionsLeft === 1 ? '' : 's'} left today
      </p>
    </div>
  );
}

function FavoriteTopicsCard({ tags }: { tags: Array<{ tag: string; count: number }> }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Favorite topics</h2>
        <Link to="/memories" className="text-xs text-blue-600 hover:text-blue-800">Browse memories →</Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {tags.map(({ tag, count }) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700"
          >
            #{tag}
            <span className="text-slate-400">·{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers

function topTagsFromMemories(memories: Memory[], limit: number): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const m of memories) {
    for (const t of m.tags ?? []) {
      const tag = t.toLowerCase().trim();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, n]) => n >= 2) // Drop hapax tags — not really "favorite"
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

function formatRelativeDate(d: Date): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sessionDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - sessionDay) / (24 * 60 * 60 * 1000));
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Yesterday ${time}`;
  if (dayDiff > 1 && dayDiff < 7) {
    return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}
