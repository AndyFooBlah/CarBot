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
 * Settings page (/settings).
 *
 * Three sections:
 *   1. Profile — child's name, email summaries
 *   2. Routine — freeform activity input parsed by Gemini Flash
 *   3. Locations — named places (home, school, etc.) resolved via Maps geocoding
 */

import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { useAuth, getConfig } from '@andyfooblah/voice-common';
import { proxyResolveAddress } from '../../services/geoProxy';
import { useUserProfile } from '../../hooks/useUserProfile';
import { previewVoice } from '../../services/voicePreview';
import {
  saveRoutine,
  saveLocations,
  saveChildName,
  saveBotName,
  saveEmailSummariesEnabled,
  saveSelectedVoice,
} from '../../services/userProfile';
import type { DayOfWeek, Routine, ScheduleEntry, NamedLocation } from '../../types';

// ---------------------------------------------------------------------------
// Gemini schedule parser
// ---------------------------------------------------------------------------

interface ParsedOccurrence {
  day: DayOfWeek;
  startTime: string;
  endTime: string;
}

/**
 * Use Gemini Flash to parse a natural-language schedule description into
 * structured day/time occurrences.
 *
 * Example input: "Go to school from 7:15 to 8:15 every weekday morning"
 * Example output: [
 *   { day: "Mon", startTime: "07:15", endTime: "08:15" },
 *   { day: "Tue", startTime: "07:15", endTime: "08:15" },
 *   ...
 * ]
 */
async function parseScheduleWithGemini(
  activityName: string,
  description: string,
  apiKey: string,
): Promise<ParsedOccurrence[]> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `You are a schedule parser. Parse the following schedule description into structured JSON.

Activity name: "${activityName}"
Schedule description: "${description}"

Return ONLY a JSON array (no markdown, no explanation) where each element has:
- "day": one of "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"
- "startTime": 24-hour time string "HH:MM"
- "endTime": 24-hour time string "HH:MM"

Examples:
- "every weekday from 7:15 to 8:15" → [{"day":"Mon","startTime":"07:15","endTime":"08:15"},{"day":"Tue","startTime":"07:15","endTime":"08:15"},{"day":"Wed","startTime":"07:15","endTime":"08:15"},{"day":"Thu","startTime":"07:15","endTime":"08:15"},{"day":"Fri","startTime":"07:15","endTime":"08:15"}]
- "Saturdays 9:30am to 11am" → [{"day":"Sat","startTime":"09:30","endTime":"11:00"}]
- "Monday and Wednesday afternoons 3pm-4:30pm" → [{"day":"Mon","startTime":"15:00","endTime":"16:30"},{"day":"Wed","startTime":"15:00","endTime":"16:30"}]

Return only valid JSON array, nothing else.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  const text = response.text ?? '';
  // Strip any accidental markdown code fences
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const parsed = JSON.parse(cleaned) as ParsedOccurrence[];
  if (!Array.isArray(parsed)) throw new Error('Expected JSON array from Gemini');
  return parsed;
}

// ---------------------------------------------------------------------------
// Helper: format a time string for display (e.g. "07:15" → "7:15am")
// ---------------------------------------------------------------------------

function formatTime(t: string): string {
  const [hStr, mStr] = t.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return t;
  const period = h < 12 ? 'am' : 'pm';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${period}` : `${h12}:${mStr}${period}`;
}

// ---------------------------------------------------------------------------
// Helper: summarise schedule for display
// ---------------------------------------------------------------------------

interface ActivitySummary {
  name: string;
  /** Human-readable list of occurrences, e.g. "Mon–Fri 7:15–8:15am" */
  summary: string;
  /** The raw occurrences so we can remove them by day */
  occurrences: ParsedOccurrence[];
}

/**
 * Group the current schedule state into per-activity summaries for display.
 * We reverse-engineer activities from the schedule by grouping entries with
 * the same name across days.
 */
function buildActivitySummaries(
  schedule: Partial<Record<DayOfWeek, ScheduleEntry[]>>,
): ActivitySummary[] {
  // Collect all (day, entry) pairs
  const all: Array<{ day: DayOfWeek; entry: ScheduleEntry }> = [];
  for (const [day, entries] of Object.entries(schedule) as [DayOfWeek, ScheduleEntry[]][]) {
    for (const entry of entries) {
      all.push({ day, entry });
    }
  }

  // Group by activity name + time (same name + same times = same activity)
  const groups = new Map<string, { name: string; occurrences: ParsedOccurrence[] }>();
  for (const { day, entry } of all) {
    const key = `${entry.name}|${entry.startTime}|${entry.endTime}`;
    if (!groups.has(key)) {
      groups.set(key, { name: entry.name, occurrences: [] });
    }
    groups.get(key)!.occurrences.push({ day, startTime: entry.startTime, endTime: entry.endTime });
  }

  const ORDER: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return Array.from(groups.values()).map(({ name, occurrences }) => {
    // Sort occurrences by day order
    occurrences.sort((a, b) => ORDER.indexOf(a.day) - ORDER.indexOf(b.day));

    // Build a compact day list, e.g. "Mon–Fri" or "Mon, Wed, Fri"
    const days = occurrences.map((o) => o.day);
    let dayStr: string;
    const isConsecutive = days.every((d, i) => i === 0 || ORDER.indexOf(d) === ORDER.indexOf(days[i - 1]) + 1);
    if (days.length > 2 && isConsecutive) {
      dayStr = `${days[0]}–${days[days.length - 1]}`;
    } else {
      dayStr = days.join(', ');
    }

    const { startTime, endTime } = occurrences[0];
    const timeStr = `${formatTime(startTime)}–${formatTime(endTime)}`;

    return {
      name,
      summary: `${dayStr} · ${timeStr}`,
      occurrences,
    };
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddActivityForm — inline form shown when user taps "Add Activity"
// ---------------------------------------------------------------------------

function AddActivityForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, occurrences: ParsedOccurrence[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');

  const handleParse = async () => {
    if (!name.trim() || !description.trim()) return;
    setParsing(true);
    setParseError('');
    try {
      const apiKey = getConfig().geminiApiKey;
      if (!apiKey) throw new Error('No Gemini API key configured');
      const occurrences = await parseScheduleWithGemini(name.trim(), description.trim(), apiKey);
      if (occurrences.length === 0) {
        setParseError("Couldn't find any day/time patterns — try rephrasing.");
        return;
      }
      onAdd(name.trim(), occurrences);
    } catch (err) {
      setParseError(`Parse failed: ${String(err)}`);
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Activity name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. School drop-off"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">When does it happen?</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleParse(); }}
          placeholder="e.g. Every weekday from 7:15 to 8:15"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {parseError && (
        <p className="text-xs text-red-600">{parseError}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={handleParse}
          disabled={parsing || !name.trim() || !description.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {parsing ? 'Parsing…' : 'Add →'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-slate-500 text-sm hover:text-slate-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddLocationForm — inline form for adding a named location
// ---------------------------------------------------------------------------

function AddLocationForm({
  onAdd,
  onCancel,
}: {
  onAdd: (loc: NamedLocation) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');

  const handleAdd = async () => {
    if (!name.trim() || !query.trim()) return;
    setResolving(true);
    setResolveError('');
    try {
      const resolvedAddress = await proxyResolveAddress(query.trim());
      onAdd({ name: name.trim().toLowerCase(), query: query.trim(), resolvedAddress });
    } catch (err) {
      setResolveError(`Failed: ${String(err)}`);
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. home, school, hockey rink"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Address or place name</label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="e.g. Lincoln Elementary, Palo Alto or 100 Main St"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {resolveError && (
        <p className="text-xs text-red-600">{resolveError}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={handleAdd}
          disabled={resolving || !name.trim() || !query.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {resolving ? 'Looking up…' : 'Add →'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-slate-500 text-sm hover:text-slate-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SettingsPage
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { user } = useAuth();
  const { profile, loading, refetch } = useUserProfile(user?.uid ?? null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  // Profile fields
  const [childName, setChildName] = useState('');
  const [botName, setBotName] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Puck');
  const [voicePreviewState, setVoicePreviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [emailSummaries, setEmailSummaries] = useState(true);

  // Routine fields
  const [schedule, setSchedule] = useState<Partial<Record<DayOfWeek, ScheduleEntry[]>>>({});
  const [windowMinutes, setWindowMinutes] = useState(30);
  const [showAddForm, setShowAddForm] = useState(false);

  // Location fields
  const [locations, setLocations] = useState<NamedLocation[]>([]);
  const [showAddLocationForm, setShowAddLocationForm] = useState(false);

  // Initialize from profile
  useEffect(() => {
    if (!profile) return;
    setChildName(profile.childName ?? '');
    setBotName(profile.botName ?? '');
    setSelectedVoice(profile.selectedVoice ?? 'Puck');
    setEmailSummaries(profile.emailSummariesEnabled ?? true);
    if (profile.routine) {
      setSchedule(profile.routine.schedule ?? {});
      setWindowMinutes(profile.routine.contextWindowMinutes ?? 30);
    }
    if (profile.locations) {
      setLocations(profile.locations);
    }
  }, [profile]);

  const flash = (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(''), 2500);
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    try {
      await saveChildName(user.uid, childName);
      await saveBotName(user.uid, botName.trim() || 'CarBot');
      await saveSelectedVoice(user.uid, selectedVoice);
      await saveEmailSummariesEnabled(user.uid, emailSummaries);
      flash('Profile saved');
      refetch();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSaveRoutine = async () => {
    if (!user) return;
    try {
      const routine: Routine = { schedule, contextWindowMinutes: windowMinutes };
      await saveRoutine(user.uid, routine);
      flash('Schedule saved');
      refetch();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleActivityAdded = (name: string, occurrences: ParsedOccurrence[]) => {
    setSchedule((prev) => {
      const next = { ...prev };
      for (const { day, startTime, endTime } of occurrences) {
        next[day] = [...(next[day] ?? []), { name, startTime, endTime }];
      }
      return next;
    });
    setShowAddForm(false);
  };

  const handleRemoveActivity = (summary: ActivitySummary) => {
    setSchedule((prev) => {
      const next = { ...prev };
      for (const { day, startTime, endTime } of summary.occurrences) {
        const entries = (next[day] ?? []).filter(
          (e) => !(e.name === summary.name && e.startTime === startTime && e.endTime === endTime),
        );
        if (entries.length === 0) {
          delete next[day];
        } else {
          next[day] = entries;
        }
      }
      return next;
    });
  };

  const activities = buildActivitySummaries(schedule);

  const handleLocationAdded = (loc: NamedLocation) => {
    setLocations((prev) => [...prev, loc]);
    setShowAddLocationForm(false);
  };

  const handleRemoveLocation = (index: number) => {
    setLocations((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveLocations = async () => {
    if (!user) return;
    try {
      await saveLocations(user.uid, locations);
      flash('Locations saved');
      refetch();
    } catch (err) {
      setError(String(err));
    }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold text-slate-900">Settings</h1>

      {saved && (
        <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-700 font-medium">
          ✓ {saved}
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError('')} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Profile */}
      <Section title="Profile">
        <Field label="Bot name" hint="The name CarBot introduces itself with. Changing this triggers a fresh introduction on the next session.">
          <input
            type="text"
            value={botName}
            onChange={(e) => setBotName(e.target.value)}
            placeholder="CarBot"
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </Field>
        <Field label="Bot voice" hint="The Gemini Live voice used for speech. Takes effect on the next session.">
          <div className="flex gap-2 items-center">
            <select
              value={selectedVoice}
              onChange={(e) => { setSelectedVoice(e.target.value); setVoicePreviewState('idle'); }}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="Puck">Puck (default)</option>
              <option value="Aoede">Aoede</option>
              <option value="Charon">Charon</option>
              <option value="Fenrir">Fenrir</option>
              <option value="Kore">Kore</option>
              <option value="Leda">Leda</option>
              <option value="Orus">Orus</option>
              <option value="Zephyr">Zephyr</option>
            </select>
            <button
              disabled={voicePreviewState === 'loading'}
              onClick={async () => {
                setVoicePreviewState('loading');
                try {
                  const apiKey = getConfig().geminiApiKey;
                  if (!apiKey) throw new Error('No Gemini API key configured');
                  await previewVoice(selectedVoice, botName.trim() || 'CarBot', apiKey);
                  setVoicePreviewState('idle');
                } catch {
                  setVoicePreviewState('error');
                  setTimeout(() => setVoicePreviewState('idle'), 3000);
                }
              }}
              className={`shrink-0 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                voicePreviewState === 'loading'
                  ? 'bg-slate-100 text-slate-400 cursor-wait'
                  : voicePreviewState === 'error'
                    ? 'bg-red-50 text-red-500 border border-red-200'
                    : 'bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100'
              }`}
            >
              {voicePreviewState === 'loading' ? '…' : voicePreviewState === 'error' ? 'failed' : 'Say hi'}
            </button>
          </div>
        </Field>
        <Field label="Child's name" hint="Used in transcript speaker labels and system instruction">
          <input
            type="text"
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            placeholder="e.g. Leo"
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </Field>
        <Field label="Session summary emails">
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              onClick={() => setEmailSummaries(!emailSummaries)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${emailSummaries ? 'bg-blue-600' : 'bg-slate-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${emailSummaries ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className="text-sm text-slate-600">{emailSummaries ? 'Enabled' : 'Disabled'}</span>
          </label>
        </Field>
        <button
          onClick={handleSaveProfile}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
        >
          Save Profile
        </button>
      </Section>

      {/* Schedule */}
      <Section title="Weekly Schedule">
        <p className="text-sm text-slate-500 -mt-1">
          Add recurring activities. CarBot uses this to understand what you're most likely doing when a session starts.
        </p>

        {/* Activity list */}
        {activities.length > 0 && (
          <div className="space-y-2">
            {activities.map((activity, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800">{activity.name}</p>
                  <p className="text-xs text-slate-500">{activity.summary}</p>
                </div>
                <button
                  onClick={() => handleRemoveActivity(activity)}
                  className="text-slate-400 hover:text-red-500 text-lg leading-none px-1 ml-3 shrink-0"
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add activity form or button */}
        {showAddForm ? (
          <AddActivityForm
            onAdd={handleActivityAdded}
            onCancel={() => setShowAddForm(false)}
          />
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full px-4 py-2.5 border-2 border-dashed border-slate-300 text-slate-500 text-sm rounded-xl hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            + Add Activity
          </button>
        )}

        <Field
          label="Context window"
          hint="Sessions started this many minutes before an activity's start time (or after its end time) are treated as in transit"
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={windowMinutes}
              onChange={(e) => setWindowMinutes(Math.max(5, Math.min(120, Number(e.target.value))))}
              min={5}
              max={120}
              step={5}
              className="w-16 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-500">minutes</span>
          </div>
        </Field>

        <button
          onClick={handleSaveRoutine}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
        >
          Save Schedule
        </button>
      </Section>

      {/* Locations */}
      <Section title="Locations">
        <p className="text-sm text-slate-500 -mt-1">
          Name the places you travel to. CarBot uses these so you can refer to them naturally in conversation.
        </p>

        {/* Location list */}
        {locations.length > 0 && (
          <div className="space-y-2">
            {locations.map((loc, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{loc.name}</p>
                  <p className="text-xs text-slate-500 truncate">{loc.resolvedAddress}</p>
                </div>
                <button
                  onClick={() => handleRemoveLocation(i)}
                  className="text-slate-400 hover:text-red-500 text-lg leading-none px-1 ml-3 shrink-0"
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add location form or button */}
        {showAddLocationForm ? (
          <AddLocationForm
            onAdd={handleLocationAdded}
            onCancel={() => setShowAddLocationForm(false)}
          />
        ) : (
          <button
            onClick={() => setShowAddLocationForm(true)}
            className="w-full px-4 py-2.5 border-2 border-dashed border-slate-300 text-slate-500 text-sm rounded-xl hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            + Add Location
          </button>
        )}

        <button
          onClick={handleSaveLocations}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
        >
          Save Locations
        </button>
      </Section>
    </div>
  );
}
