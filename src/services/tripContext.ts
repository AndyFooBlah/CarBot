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

import type { Routine, TripContext, DayOfWeek } from '../types';

/** Short name for each day, matching the Routine.schoolDays format. */
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
 * Infer the trip context from the current date/time and the user's routine.
 *
 * @param routine - User's school schedule config. If undefined/null, returns 'unstructured'.
 * @param now - The current date/time (defaults to new Date()).
 * @returns The inferred TripContext.
 */
export function inferTripContext(
  routine: Routine | null | undefined,
  now: Date = new Date(),
): TripContext {
  if (!routine || !routine.schoolDays?.length) {
    return 'unstructured';
  }

  const dayName = DAY_NAMES[now.getDay()];
  const isSchoolDay = routine.schoolDays.includes(dayName);

  if (!isSchoolDay) {
    return 'non_school_day';
  }

  const windowMinutes = routine.contextWindowMinutes ?? 30;
  const currentMinutes = dateToMinutesSinceMidnight(now);

  const morningMinutes = parseTimeToMinutes(routine.morningDepartureTime);
  if (!isNaN(morningMinutes)) {
    const diff = Math.abs(currentMinutes - morningMinutes);
    if (diff <= windowMinutes) {
      return 'school_commute_morning';
    }
  }

  const afternoonMinutes = parseTimeToMinutes(routine.afternoonPickupTime);
  if (!isNaN(afternoonMinutes)) {
    const diff = Math.abs(currentMinutes - afternoonMinutes);
    if (diff <= windowMinutes) {
      return 'school_commute_afternoon';
    }
  }

  return 'school_day_other';
}

/**
 * Convert a TripContext value to a natural-language phrase suitable for
 * inclusion in a Gemini system instruction.
 *
 * @param context - The inferred trip context.
 * @param now - The current date/time (defaults to new Date()).
 * @returns A human-readable description, or null if context is 'unstructured'.
 */
export function tripContextToDescription(
  context: TripContext,
  now: Date = new Date(),
): string | null {
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const timeOfDay = now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening';

  switch (context) {
    case 'school_commute_morning':
      return `It's ${dayName} morning and the family is heading to school.`;
    case 'school_commute_afternoon':
      return `It's ${dayName} afternoon and the family is heading home after school.`;
    case 'school_day_other':
      return `It's a school day (${dayName} ${timeOfDay}).`;
    case 'non_school_day':
      return `It's ${dayName} — not a school day.`;
    case 'unstructured':
      return null;
  }
}
