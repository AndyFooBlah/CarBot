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
import type { DayOfWeek, Routine, LocationConfig } from '../../types';

const ALL_DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

export function SettingsPage() {
  const { user } = useAuth();
  const { profile, loading, refetch } = useUserProfile(user?.uid ?? null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  // Profile fields
  const [childName, setChildName] = useState('');
  const [emailSummaries, setEmailSummaries] = useState(true);

  // Routine fields
  const [schoolDays, setSchoolDays] = useState<DayOfWeek[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [morningTime, setMorningTime] = useState('08:15');
  const [afternoonTime, setAfternoonTime] = useState('15:30');
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
      setSchoolDays(profile.routine.schoolDays);
      setMorningTime(profile.routine.morningDepartureTime);
      setAfternoonTime(profile.routine.afternoonPickupTime);
      setWindowMinutes(profile.routine.contextWindowMinutes);
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
      const routine: Routine = {
        schoolDays,
        morningDepartureTime: morningTime,
        afternoonPickupTime: afternoonTime,
        contextWindowMinutes: windowMinutes,
      };
      await saveRoutine(user.uid, routine);
      flash('Routine saved');
      refetch();
    } catch (err) {
      setError(String(err));
    }
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

  const toggleDay = (day: DayOfWeek) => {
    setSchoolDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
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

      {/* Routine */}
      <Section title="School Routine">
        <Field label="School days">
          <div className="flex gap-1.5 flex-wrap">
            {ALL_DAYS.map((day) => (
              <button
                key={day}
                onClick={() => toggleDay(day)}
                className={`text-sm px-3 py-1 rounded-lg font-medium transition-colors ${
                  schoolDays.includes(day)
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Morning departure" hint="When you leave for school">
            <input
              type="time"
              value={morningTime}
              onChange={(e) => setMorningTime(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </Field>
          <Field label="Afternoon pickup" hint="When you pick up from school">
            <input
              type="time"
              value={afternoonTime}
              onChange={(e) => setAfternoonTime(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </Field>
        </div>
        <Field label={`Context window: ±${windowMinutes} minutes`} hint="How far from drive time still counts as a commute">
          <input
            type="range"
            min={5}
            max={60}
            step={5}
            value={windowMinutes}
            onChange={(e) => setWindowMinutes(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>5 min</span><span>60 min</span>
          </div>
        </Field>
        <button
          onClick={handleSaveRoutine}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
        >
          Save Routine
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
