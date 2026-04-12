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
 *   2. Routine — school days, drive times, context window
 *   3. Location — home city, school name
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '@andyfooblah/voicecommon';
import { useUserProfile } from '../../hooks/useUserProfile';
import {
  saveRoutine,
  saveLocationConfig,
  saveChildName,
  saveEmailSummariesEnabled,
} from '../../services/userProfile';
import type { DayOfWeek, Routine, ScheduleEntry, LocationConfig } from '../../types';

const ALL_DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DAY_LABELS: Record<DayOfWeek, string> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday',
  Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
};

const EMPTY_ENTRY: ScheduleEntry = { name: '', startTime: '', endTime: '' };

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

function TimeInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-28"
    />
  );
}

function DayScheduleEditor({
  label,
  entries,
  onAdd,
  onUpdate,
  onRemove,
}: {
  day: DayOfWeek;
  label: string;
  entries: ScheduleEntry[];
  onAdd: () => void;
  onUpdate: (idx: number, entry: ScheduleEntry) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <button
          onClick={onAdd}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          + Add
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-slate-400 ml-0.5">No activities</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={entry.name}
                onChange={(e) => onUpdate(idx, { ...entry, name: e.target.value })}
                placeholder="Activity"
                className="flex-1 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
              />
              <TimeInput
                value={entry.startTime}
                onChange={(v) => onUpdate(idx, { ...entry, startTime: v })}
              />
              <span className="text-slate-400 text-sm shrink-0">–</span>
              <TimeInput
                value={entry.endTime}
                onChange={(v) => onUpdate(idx, { ...entry, endTime: v })}
              />
              <button
                onClick={() => onRemove(idx)}
                className="text-slate-400 hover:text-red-500 text-lg leading-none shrink-0 px-1"
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const { profile, loading, refetch } = useUserProfile(user?.uid ?? null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  // Profile fields
  const [childName, setChildName] = useState('');
  const [emailSummaries, setEmailSummaries] = useState(true);

  // Routine fields
  const [schedule, setSchedule] = useState<Partial<Record<DayOfWeek, ScheduleEntry[]>>>({});
  const [windowMinutes, setWindowMinutes] = useState(30);

  // Location fields
  const [homeCity, setHomeCity] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [schoolAddress, setSchoolAddress] = useState('');

  // Initialize from profile
  useEffect(() => {
    if (!profile) return;
    setChildName(profile.childName ?? '');
    setEmailSummaries(profile.emailSummariesEnabled ?? true);
    if (profile.routine) {
      setSchedule(profile.routine.schedule ?? {});
      setWindowMinutes(profile.routine.contextWindowMinutes ?? 30);
    }
    if (profile.locations) {
      setHomeCity(profile.locations.homeCity);
      setSchoolName(profile.locations.schoolName);
      setSchoolAddress(profile.locations.schoolAddress ?? '');
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

  const addEntry = (day: DayOfWeek) => {
    setSchedule((prev) => ({
      ...prev,
      [day]: [...(prev[day] ?? []), { ...EMPTY_ENTRY }],
    }));
  };

  const updateEntry = (day: DayOfWeek, idx: number, entry: ScheduleEntry) => {
    setSchedule((prev) => {
      const entries = [...(prev[day] ?? [])];
      entries[idx] = entry;
      return { ...prev, [day]: entries };
    });
  };

  const removeEntry = (day: DayOfWeek, idx: number) => {
    setSchedule((prev) => {
      const entries = (prev[day] ?? []).filter((_, i) => i !== idx);
      const next = { ...prev };
      if (entries.length === 0) {
        delete next[day];
      } else {
        next[day] = entries;
      }
      return next;
    });
  };

  const handleSaveLocation = async () => {
    if (!user) return;
    try {
      const locations: LocationConfig = {
        homeCity,
        schoolName,
        ...(schoolAddress ? { schoolAddress } : {}),
      };
      await saveLocationConfig(user.uid, locations);
      flash('Location saved');
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
          List activities for each day with start and end times. CarBot uses this to understand
          what you're most likely doing when a session starts.
        </p>

        <div className="space-y-5">
          {/* Weekdays */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Weekdays</p>
            <div className="space-y-4">
              {(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as DayOfWeek[]).map((day) => (
                <DayScheduleEditor
                  key={day}
                  day={day}
                  label={DAY_LABELS[day]}
                  entries={schedule[day] ?? []}
                  onAdd={() => addEntry(day)}
                  onUpdate={(idx, entry) => updateEntry(day, idx, entry)}
                  onRemove={(idx) => removeEntry(day, idx)}
                />
              ))}
            </div>
          </div>

          {/* Weekend */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Weekend</p>
            <div className="space-y-4">
              {(['Sat', 'Sun'] as DayOfWeek[]).map((day) => (
                <DayScheduleEditor
                  key={day}
                  day={day}
                  label={DAY_LABELS[day]}
                  entries={schedule[day] ?? []}
                  onAdd={() => addEntry(day)}
                  onUpdate={(idx, entry) => updateEntry(day, idx, entry)}
                  onRemove={(idx) => removeEntry(day, idx)}
                />
              ))}
            </div>
          </div>
        </div>

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

      {/* Location */}
      <Section title="Location">
        <Field label="Home city / neighborhood" hint="Used when geolocation is unavailable (never stored with sessions)">
          <input
            type="text"
            value={homeCity}
            onChange={(e) => setHomeCity(e.target.value)}
            placeholder="e.g. Palo Alto, CA"
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </Field>
        <Field label="School name">
          <input
            type="text"
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            placeholder="e.g. Lincoln Elementary"
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </Field>
        <Field label="School address (optional)" hint="Display only — not stored with sessions">
          <input
            type="text"
            value={schoolAddress}
            onChange={(e) => setSchoolAddress(e.target.value)}
            placeholder="e.g. 100 Lincoln Ave, Palo Alto, CA"
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </Field>
        <button
          onClick={handleSaveLocation}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
        >
          Save Location
        </button>
      </Section>
    </div>
  );
}
