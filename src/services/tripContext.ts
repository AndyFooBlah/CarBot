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
 * Trip context inference for CarBot.
 *
 * Given a user's Routine configuration and the current date/time, determines
 * what kind of trip this is (morning commute to school, afternoon pickup,
 * general school day, non-school day, or unconfigured).
 *
 * All comparisons are done in local time using simple HH:MM string arithmetic
 * rather than a timezone library, because the routine is already stored in the
 * user's local time and the browser's Date object reflects local time.
 */

import type { Routine, ScheduleEntry, TripContext, DayOfWeek } from '../types';

/** Short name for each day, matching DayOfWeek values (indexed by Date.getDay()). */
const DAY_NAMES: DayOfWeek[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Parse a 'HH:MM' string to total minutes since midnight.
 * Returns NaN if the format is invalid.
 */
export function parseTimeToMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return NaN;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

/**
 * Get total minutes since midnight for a given Date (in local time).
 */
export function dateToMinutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Return the schedule entries for a given day, sorted by start time.
 */
function getDayEntries(routine: Routine, dayName: DayOfWeek): ScheduleEntry[] {
  return [...(routine.schedule?.[dayName] ?? [])].sort(
    (a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime),
  );
}

/**
 * Infer the trip context from the current date/time and the user's routine.
 *
 * A "structured day" is any day that has at least one schedule entry.
 * - Morning commute: within contextWindow of the first entry's start time.
 * - Afternoon commute: within contextWindow of the last entry's end time.
 * - School day other: structured day but not near any activity boundary.
 * - Non-school day: no entries for today but routine is configured.
 * - Unstructured: no routine or empty schedule.
 *
 * @param routine - User's schedule config. If undefined/null, returns 'unstructured'.
 * @param now - The current date/time (defaults to new Date()).
 */
export function inferTripContext(
  routine: Routine | null | undefined,
  now: Date = new Date(),
): TripContext {
  if (!routine) return 'unstructured';

  const hasAnyEntries = Object.values(routine.schedule ?? {}).some((e) => e && e.length > 0);
  if (!hasAnyEntries) return 'unstructured';

  const dayName = DAY_NAMES[now.getDay()];
  const dayEntries = getDayEntries(routine, dayName);

  if (dayEntries.length === 0) {
    return 'non_school_day';
  }

  const windowMinutes = routine.contextWindowMinutes ?? 30;
  const currentMinutes = dateToMinutesSinceMidnight(now);

  // Near the start of the first activity → morning commute equivalent
  const firstStart = parseTimeToMinutes(dayEntries[0].startTime);
  if (!isNaN(firstStart) && Math.abs(currentMinutes - firstStart) <= windowMinutes) {
    return 'school_commute_morning';
  }

  // Near the end of the last activity → afternoon commute equivalent
  const lastEnd = parseTimeToMinutes(dayEntries[dayEntries.length - 1].endTime);
  if (!isNaN(lastEnd) && Math.abs(currentMinutes - lastEnd) <= windowMinutes) {
    return 'school_commute_afternoon';
  }

  return 'school_day_other';
}

/**
 * Return the schedule entry whose time window (startTime – endTime, extended by
 * contextWindow on each side) contains the current time, or null if none matches.
 */
export function getActiveActivity(
  routine: Routine | null | undefined,
  now: Date = new Date(),
): ScheduleEntry | null {
  if (!routine) return null;
  const dayName = DAY_NAMES[now.getDay()];
  const dayEntries = getDayEntries(routine, dayName);
  const windowMinutes = routine.contextWindowMinutes ?? 30;
  const currentMinutes = dateToMinutesSinceMidnight(now);

  for (const entry of dayEntries) {
    const start = parseTimeToMinutes(entry.startTime);
    const end = parseTimeToMinutes(entry.endTime);
    if (isNaN(start) || isNaN(end)) continue;
    if (currentMinutes >= start - windowMinutes && currentMinutes <= end + windowMinutes) {
      return entry;
    }
  }
  return null;
}

/**
 * Return a human-readable summary of today's full schedule for the system prompt.
 * e.g. "Saturday schedule: Ice Hockey 7:30–8:30, Violin 9:30–11:00"
 */
export function getDayScheduleSummary(
  routine: Routine | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!routine) return null;
  const dayName = DAY_NAMES[now.getDay()];
  const dayEntries = getDayEntries(routine, dayName);
  if (dayEntries.length === 0) return null;

  const fmt = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const period = h < 12 ? 'am' : 'pm';
    const hour = h % 12 || 12;
    return m === 0 ? `${hour}${period}` : `${hour}:${m.toString().padStart(2, '0')}${period}`;
  };

  const label = now.toLocaleDateString('en-US', { weekday: 'long' });
  const items = dayEntries.map((e) => `${e.name} ${fmt(e.startTime)}–${fmt(e.endTime)}`).join(', ');
  return `${label} schedule: ${items}.`;
}

/**
 * Convert a TripContext value to a natural-language phrase suitable for
 * inclusion in a Gemini system instruction.
 *
 * @param context - The inferred trip context.
 * @param now - The current date/time (defaults to new Date()).
 * @param routine - Optional routine, used to name the specific activity.
 */
export function tripContextToDescription(
  context: TripContext,
  now: Date = new Date(),
  routine?: Routine | null,
): string | null {
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const timeOfDay = now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening';
  const activity = routine ? getActiveActivity(routine, now) : null;

  switch (context) {
    case 'school_commute_morning':
      return activity
        ? `It's ${dayName} morning and the family is heading to ${activity.name}.`
        : `It's ${dayName} morning and the family is heading out.`;
    case 'school_commute_afternoon':
      return activity
        ? `It's ${dayName} ${timeOfDay} — ${activity.name} is wrapping up and the family is heading home.`
        : `It's ${dayName} ${timeOfDay} and the family is heading home.`;
    case 'school_day_other':
      return `It's ${dayName} ${timeOfDay}.`;
    case 'non_school_day':
      return `It's ${dayName} — no activities scheduled.`;
    case 'unstructured':
      return null;
  }
}
