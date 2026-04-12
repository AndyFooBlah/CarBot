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

import { describe, it, expect } from 'vitest';
import {
  inferTripContext,
  parseTimeToMinutes,
  dateToMinutesSinceMidnight,
  tripContextToDescription,
} from '../services/tripContext';
import type { Routine } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Date object for a specific day and time. */
function makeDate(
  dayOfWeek: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun',
  time: string,
): Date {
  // Find the most recent date with the given day of week
  const dayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const [h, m] = time.split(':').map(Number);

  // Use a fixed reference week (2026-04-06 is a Monday)
  const baseMonday = new Date(2026, 3, 6, h, m, 0, 0); // April 6
  const offset = dayIndex[dayOfWeek] - 1; // Monday = 1, offset from Monday
  baseMonday.setDate(baseMonday.getDate() + offset);
  return baseMonday;
}

const DEFAULT_ROUTINE: Routine = {
  schoolDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  morningDepartureTime: '08:00',
  afternoonPickupTime: '15:00',
  contextWindowMinutes: 30,
};

// ---------------------------------------------------------------------------
// parseTimeToMinutes
// ---------------------------------------------------------------------------

describe('parseTimeToMinutes', () => {
  it('parses standard HH:MM times', () => {
    expect(parseTimeToMinutes('08:00')).toBe(480);
    expect(parseTimeToMinutes('15:30')).toBe(930);
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });

  it('handles single-digit hours', () => {
    expect(parseTimeToMinutes('8:00')).toBe(480);
    expect(parseTimeToMinutes('9:45')).toBe(585);
  });

  it('returns NaN for invalid formats', () => {
    expect(parseTimeToMinutes('')).toBeNaN();
    expect(parseTimeToMinutes('25:00')).toBeNaN();
    expect(parseTimeToMinutes('8:60')).toBeNaN();
    expect(parseTimeToMinutes('not-a-time')).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// dateToMinutesSinceMidnight
// ---------------------------------------------------------------------------

describe('dateToMinutesSinceMidnight', () => {
  it('returns correct minutes for a given time', () => {
    const d = new Date(2026, 3, 7, 8, 0); // 08:00
    expect(dateToMinutesSinceMidnight(d)).toBe(480);
  });

  it('handles midnight', () => {
    expect(dateToMinutesSinceMidnight(new Date(2026, 3, 7, 0, 0))).toBe(0);
  });

  it('handles 23:59', () => {
    expect(dateToMinutesSinceMidnight(new Date(2026, 3, 7, 23, 59))).toBe(1439);
  });
});

// ---------------------------------------------------------------------------
// inferTripContext
// ---------------------------------------------------------------------------

describe('inferTripContext', () => {
  it('returns unstructured when routine is null', () => {
    expect(inferTripContext(null, makeDate('Mon', '08:00'))).toBe('unstructured');
  });

  it('returns unstructured when routine is undefined', () => {
    expect(inferTripContext(undefined, makeDate('Mon', '08:00'))).toBe('unstructured');
  });

  it('returns unstructured when schoolDays is empty', () => {
    expect(inferTripContext({ ...DEFAULT_ROUTINE, schoolDays: [] }, makeDate('Mon', '08:00'))).toBe('unstructured');
  });

  it('returns non_school_day on weekend', () => {
    expect(inferTripContext(DEFAULT_ROUTINE, makeDate('Sat', '08:00'))).toBe('non_school_day');
    expect(inferTripContext(DEFAULT_ROUTINE, makeDate('Sun', '15:00'))).toBe('non_school_day');
  });

  it('returns school_commute_morning exactly at departure time', () => {
    expect(inferTripContext(DEFAULT_ROUTINE, makeDate('Mon', '08:00'))).toBe('school_commute_morning');
  });

  it('returns school_commute_morning within the window', () => {
    // 30 min before departure
    expect(inferTripContext(DEFAULT_ROUTINE, makeDate('Mon', '07:30'))).toBe('school_commute_morning');
    // 30 min after departure
    expect(inferTripContext(DEFAULT_ROUTINE, makeDate('Mon', '08:30'))).toBe('school_commute_morning');
  });

  it('returns school_day_other just outside the morning window', () => {
    // 31 minutes before departure
    expect(inferTripContext(DEFAULT_ROUTINE, makeDate('Mon', '07:29'))).toBe('school_day_other');
    // 31 minutes after departure
    expect(inferTripContext(DEFAULT_ROUTINE, makeDate('Mon', '08:31'))).toBe('school_day_other');
  });

  it('returns school_commute_afternoon exactly at pickup time', () => {
    expect(inferTripContext(DEFAULT_ROUTINE, makeDate('Fri', '15:00'))).toBe('school_commute_afternoon');
  });

  it('returns school_commute_afternoon within the window', () => {
    expect(inferTripContext(DEFAULT_ROUTINE, makeDate('Wed', '14:30'))).toBe('school_commute_afternoon');
    expect(inferTripContext(DEFAULT_ROUTINE, makeDate('Wed', '15:30'))).toBe('school_commute_afternoon');
  });

  it('returns school_day_other in the middle of the day', () => {
    expect(inferTripContext(DEFAULT_ROUTINE, makeDate('Tue', '12:00'))).toBe('school_day_other');
  });

  it('uses custom contextWindowMinutes', () => {
    const narrow = { ...DEFAULT_ROUTINE, contextWindowMinutes: 10 };
    // 11 min before departure — outside 10-min window
    expect(inferTripContext(narrow, makeDate('Mon', '07:49'))).toBe('school_day_other');
    // 10 min before departure — inside window
    expect(inferTripContext(narrow, makeDate('Mon', '07:50'))).toBe('school_commute_morning');
  });

  it('handles routines with only some school days', () => {
    const mwf = { ...DEFAULT_ROUTINE, schoolDays: ['Mon', 'Wed', 'Fri'] as Routine['schoolDays'] };
    expect(inferTripContext(mwf, makeDate('Tue', '08:00'))).toBe('non_school_day');
    expect(inferTripContext(mwf, makeDate('Wed', '08:00'))).toBe('school_commute_morning');
  });
});

// ---------------------------------------------------------------------------
// tripContextToDescription
// ---------------------------------------------------------------------------

describe('tripContextToDescription', () => {
  it('returns null for unstructured', () => {
    expect(tripContextToDescription('unstructured')).toBeNull();
  });

  it('returns a non-null string for all other contexts', () => {
    const contexts = [
      'school_commute_morning',
      'school_commute_afternoon',
      'school_day_other',
      'non_school_day',
    ] as const;

    for (const ctx of contexts) {
      const result = tripContextToDescription(ctx, makeDate('Mon', '08:00'));
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result!.length).toBeGreaterThan(0);
    }
  });

  it('mentions morning for morning commute', () => {
    const result = tripContextToDescription('school_commute_morning', makeDate('Mon', '08:00'));
    expect(result).toMatch(/morning/i);
  });

  it('mentions after school for afternoon commute', () => {
    const result = tripContextToDescription('school_commute_afternoon', makeDate('Mon', '15:00'));
    expect(result).toMatch(/after school|home/i);
  });
});
