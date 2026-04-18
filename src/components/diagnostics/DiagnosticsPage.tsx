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
 * DiagnosticsPage — full-page diagnostics + manual post-session triggers.
 *
 * Sections:
 *   1. External-service probes (Wikipedia, Jokes, geoProxy tools, Firestore,
 *      Gemini Live WebSocket reachability)
 *   2. Voice-quota usage for the current UTC day
 *   3. Per-session manual triggers (clean transcript, extract memories,
 *      re-send summary email) for the most recent completed session
 */

import React, { useCallback, useEffect, useState } from 'react';
import { getDoc, doc } from 'firebase/firestore';
import { db, useAuth, getUserSessions } from '@andyfooblah/voice-common';
import type { SessionMetadata } from '@andyfooblah/voice-common';
import { searchWikipedia, getJoke } from '@andyfooblah/knowledge-common';
import { proxySearchPlace, proxyGetWeather, proxyGetDistanceBetweenPlaces } from '../../services/geoProxy';
import { getVoiceQuotaStatus, type VoiceQuotaCheckResult } from '../../services/voiceQuota';
import {
  callCleanTranscriptForSession,
  callExtractMemoriesForSession,
  callSendSummaryEmailForSession,
} from '../../services/diagnosticsActions';

// ---------------------------------------------------------------------------
// Shared probe runner

interface ProbeResult {
  label: string;
  latencyMs: number | null;
  error: string | null;
  ok: boolean;
}

async function probe(label: string, fn: () => Promise<unknown>): Promise<ProbeResult> {
  const start = performance.now();
  try {
    await fn();
    return { label, latencyMs: Math.round(performance.now() - start), error: null, ok: true };
  } catch (err) {
    return {
      label,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  }
}

function ProbeRow({ r }: { r: ProbeResult }) {
  const statusClass = !r.ok
    ? 'text-red-600'
    : r.latencyMs !== null && r.latencyMs >= 2000
      ? 'text-amber-600'
      : 'text-emerald-600';
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-700">{r.label}</span>
      <span className={`text-xs font-mono ${statusClass}`} title={r.error ?? undefined}>
        {r.ok ? `${r.latencyMs} ms` : `error: ${r.error ?? 'unknown'}`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  result,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  result: string | null;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <button
        onClick={onClick}
        disabled={busy}
        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[180px] text-left"
      >
        {busy ? 'Running…' : label}
      </button>
      {result && <span className="text-xs text-slate-600">{result}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Service-probe section

const SAMPLE_QUERY_A = 'Palo Alto, CA';
const SAMPLE_QUERY_B = 'San Francisco, CA';

function ServiceProbes({ uid }: { uid: string | undefined }) {
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    const settled = await Promise.allSettled([
      probe('Wikipedia', () => searchWikipedia({ question: 'John F. Kennedy' })),
      probe('Jokes', () => getJoke()),
      probe('geoProxy — searchPlace', () => proxySearchPlace(SAMPLE_QUERY_A)),
      probe('geoProxy — getWeather', () => proxyGetWeather(SAMPLE_QUERY_A)),
      probe('geoProxy — getDistance', () => proxyGetDistanceBetweenPlaces(SAMPLE_QUERY_A, SAMPLE_QUERY_B)),
      probe('Firestore', async () => {
        if (!uid) throw new Error('not authenticated');
        await getDoc(doc(db, 'users', uid));
      }),
      probe('Gemini 3.1 Flash Live (WebSocket reachability)', async () => {
        const key = import.meta.env.VITE_GEMINI_API_KEY as string;
        if (!key) throw new Error('VITE_GEMINI_API_KEY not configured');
        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`;
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(url);
          const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 6000);
          ws.onopen = () => { clearTimeout(timer); ws.close(); resolve(); };
          ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket failed')); };
        });
      }),
    ]);
    setResults(
      settled.map((s) =>
        s.status === 'fulfilled' ? s.value : { label: '?', latencyMs: null, error: String(s.reason), ok: false },
      ),
    );
    setRunning(false);
  }, [uid]);

  useEffect(() => {
    if (uid) void run();
  }, [uid, run]);

  return (
    <Card title="External services">
      <div>
        {results === null ? (
          <p className="text-sm text-slate-500 animate-pulse">Running probes…</p>
        ) : (
          results.map((r) => <ProbeRow key={r.label} r={r} />)
        )}
      </div>
      <button
        onClick={run}
        disabled={running}
        className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
      >
        {running ? 'Re-running…' : 'Re-run probes'}
      </button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Voice-quota section

function VoiceQuota() {
  const [status, setStatus] = useState<VoiceQuotaCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getVoiceQuotaStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card title="Voice quota (today, UTC)">
      {loading && <p className="text-sm text-slate-500 animate-pulse">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {status && (
        <div className="space-y-1 text-sm text-slate-700">
          <div className="flex justify-between">
            <span>Sessions started</span>
            <span className="font-mono">
              {status.sessionStartCount} / {status.limits.maxSessionsPerDay}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Audio minutes</span>
            <span className="font-mono">
              {Math.round(status.audioMinutes)} / {status.limits.maxAudioMinutesPerDay}
            </span>
          </div>
          <p className={`text-xs mt-2 ${status.allowed ? 'text-emerald-600' : 'text-red-600'}`}>
            {status.allowed ? 'New sessions are allowed.' : 'Daily limit reached — try again tomorrow.'}
          </p>
        </div>
      )}
      <button
        onClick={load}
        disabled={loading}
        className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
      >
        Refresh
      </button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Session actions

function SessionActions({ uid }: { uid: string }) {
  const [session, setSession] = useState<SessionMetadata | null>(null);
  const [loading, setLoading] = useState(true);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const sessions = await getUserSessions(uid);
        setSession(sessions[0] ?? null);
      } finally {
        setLoading(false);
      }
    })();
  }, [uid]);

  const runAction = async (key: string, fn: () => Promise<void>) => {
    if (!session) return;
    setBusyKey(key);
    setResults((r) => ({ ...r, [key]: '' }));
    try {
      await fn();
      setResults((r) => ({ ...r, [key]: 'Done ✓' }));
    } catch (err) {
      setResults((r) => ({ ...r, [key]: `Failed: ${err instanceof Error ? err.message : String(err)}` }));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Card title="Post-session actions (most recent session)">
      {loading ? (
        <p className="text-sm text-slate-500 animate-pulse">Loading latest session…</p>
      ) : !session || !session.id ? (
        <p className="text-sm text-slate-500">No sessions yet.</p>
      ) : (
        (() => {
          const sid = session.id;
          return (
            <>
              <p className="text-xs text-slate-500 font-mono break-all">
                sessionId: {sid}
              </p>
              <ActionButton
                label="Regenerate clean transcript"
                busy={busyKey === 'transcript'}
                result={results.transcript ?? null}
                onClick={() => runAction('transcript', () => callCleanTranscriptForSession(sid))}
              />
              <ActionButton
                label="Re-run memory extraction"
                busy={busyKey === 'memories'}
                result={results.memories ?? null}
                onClick={() => runAction('memories', () => callExtractMemoriesForSession(sid))}
              />
              <ActionButton
                label="Re-send summary email"
                busy={busyKey === 'email'}
                result={results.email ?? null}
                onClick={() => runAction('email', () => callSendSummaryEmailForSession(sid))}
              />
            </>
          );
        })()
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page

export function DiagnosticsPage() {
  const { user } = useAuth();
  const uid = user?.uid;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Diagnostics</h1>
        <p className="text-sm text-slate-500 mt-1">
          Live health checks and manual post-session triggers. Safe to run anytime.
        </p>
      </div>

      <ServiceProbes uid={uid} />
      <VoiceQuota />
      {uid && <SessionActions uid={uid} />}
    </div>
  );
}
