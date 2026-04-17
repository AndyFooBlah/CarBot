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
 * CarBot system instruction builder.
 *
 * Assembles the Gemini system instruction for each session by combining:
 *   1. CarBot's base persona
 *   2. Current date/time and trip context
 *   3. Location (from browser geolocation or configured home city)
 *   4. Recent memory facts from past conversations
 *   5. Active context documents (teacher notes, etc.)
 *   6. Recent session summaries
 *
 * The assembled instruction targets ≤ 8000 tokens (~32,000 characters).
 * Content is prioritized: persona + context → memories → docs → summaries.
 */

import { getMemoryContextString } from './memories';
import { getActiveContextDocuments, buildContextDocumentSection } from './contextDocuments';
import { inferTripContext, tripContextToDescription, getDayScheduleSummary } from './tripContext';
import { getRecentSessionTimestamps } from './sessions';
import type { CarbotUserProfile, TripContext } from '../types';

export interface SessionContext {
  userId: string;
  /** User profile containing routine, locations, childName, etc. */
  profile: CarbotUserProfile;
  /** City name from browser geolocation, or null if unavailable/denied. */
  currentCity: string | null;
  /** Pre-computed trip context (computed before calling buildCarbotInstruction). */
  tripContext: TripContext;
  /** Current date/time. */
  now: Date;
}

/**
 * Build the full CarBot system instruction for a session.
 *
 * Fetches memories and context documents from Firestore, then assembles
 * the instruction string. Should be called once when the session starts.
 *
 * @param context - The session context (profile, location, trip context, etc.)
 * @returns The assembled system instruction string.
 */
export async function buildCarbotInstruction(context: SessionContext): Promise<string> {
  const { userId, profile, currentCity, tripContext, now } = context;
  const childName = profile.childName ?? 'the child';

  const parts: string[] = [];

  const botName = profile.botName?.trim() || 'CarBot';

  // --- 1. Base persona ---
  parts.push(`Your name is ${botName}. You are a warm, curious, and entertaining AI companion for car rides.
You're talking with a parent and their child (${childName}) while they're in the car.
Your job is to make the ride fun and engaging for everyone — tell stories, play word games, ask interesting questions, share fascinating facts, and have real conversations.
Be natural, playful, and age-appropriate. Match the energy of whoever is talking.
Keep responses conversational and suitable for speaking aloud — avoid bullet points, markdown, or long formal paragraphs.
If the conversation naturally wraps up, you can suggest ending the session by saying something like "Want to save that for next time?"`);

  // --- 1b. Opening turn ---
  // The session sends an activityEnd signal immediately on connect so the bot
  // speaks first. These instructions shape that opening.
  const introLine = profile.botNameNeedsIntro
    ? `This is the first time you've spoken with this family (or your name just changed to ${botName}), so introduce yourself by name as part of your greeting.`
    : `Don't introduce yourself by name — they already know you.`;

  parts.push(`At the very start of every session, YOU speak first — take the first turn without waiting for the user to say anything.
${introLine}
Keep your opening to 1–2 short spoken sentences: start with a warm greeting, then ask who you're talking with today and what they're up to (or where they're headed). Do NOT assume who is in the car, what direction they're going, or what kind of day they've had — always ask rather than guess.
Vary your phrasing each session — don't repeat the same opening. Do not exceed two short sentences.`);

  // --- 2. Date, time, and trip context ---
  const tz = profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateStr = now.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  parts.push(`Current date and time: ${dateStr}, ${timeStr}.`);

  const tripDesc = tripContextToDescription(tripContext, now, profile.routine);
  if (tripDesc) {
    parts.push(tripDesc);
  }

  // Include today's full schedule so the bot knows what's coming up
  const daySchedule = getDayScheduleSummary(profile.routine, now);
  if (daySchedule) {
    parts.push(daySchedule);
  }

  // --- 3. Location ---
  if (currentCity) {
    parts.push(`You're currently in the ${currentCity} area.`);
  }

  if (profile.locations && profile.locations.length > 0) {
    const locationList = profile.locations
      .map((l) => `${l.name} (${l.resolvedAddress})`)
      .join(', ');
    parts.push(`Known locations: ${locationList}.`);
  }

  // --- 4. Recent session timestamps ---
  try {
    const sessionHistory = await getRecentSessionTimestamps(userId, tz, now, 3);
    if (sessionHistory) {
      parts.push(sessionHistory);
    }
  } catch (err) {
    console.error('[instructionBuilder] Failed to load session timestamps:', err);
  }

  // --- 5. Recent memories (async) ---
  try {
    const memoryContext = await getMemoryContextString(userId, 20);
    if (memoryContext) {
      parts.push(memoryContext);
    }
  } catch (err) {
    console.error('[instructionBuilder] Failed to load memories:', err);
  }

  // --- 6. Active context documents (async) ---
  try {
    const activeDocs = await getActiveContextDocuments(userId);
    const docSection = buildContextDocumentSection(activeDocs);
    if (docSection) {
      parts.push(docSection);
    }
  } catch (err) {
    console.error('[instructionBuilder] Failed to load context documents:', err);
  }

  // --- 7. Knowledge tools ---
  parts.push(`TOOLS — you have these tools available and MUST use them:
- ALWAYS call 'searchWikipedia' before answering questions about specific facts, historical events, people, animals, places, science topics, or anything from the real world. Never answer factual questions from memory alone — always look them up first using this tool.
- Call 'getWeather' when the user asks about the weather or mentions going somewhere.
- Call 'searchPlace' or 'getDistanceBetweenPlaces' for location or distance questions.
- Call 'getJoke' when the user asks for a joke or when a moment of levity feels right.`);

  return parts.join('\n\n');
}

/**
 * Attempt to get the user's current city via browser geolocation.
 *
 * Uses the Google Maps Geocoding API to reverse-geocode to city level.
 * Returns null if:
 *   - Geolocation permission is denied
 *   - Geolocation times out (3 seconds)
 *   - No Maps API key is configured
 *   - The geocoding request fails
 *
 * The result is ONLY used for in-session context and is never stored.
 *
 * @param mapsApiKey - Google Maps API key. Pass null to skip geolocation.
 */
export async function getCurrentCity(mapsApiKey: string | null | undefined): Promise<string | null> {
  if (!mapsApiKey) return null;

  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not available'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 3000,
        maximumAge: 60000,
        enableHighAccuracy: false,
      });
    });

    const { latitude, longitude } = position.coords;
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&result_type=locality&key=${mapsApiKey}`,
    );
    const data = await res.json();

    if (data.status === 'OK' && data.results?.length > 0) {
      // Return only the city component — never the street address
      const cityComponent = data.results[0].address_components?.find(
        (c: { types: string[] }) => c.types.includes('locality'),
      );
      return cityComponent?.long_name ?? null;
    }
  } catch {
    // Geolocation denied or timed out — silently fall back to null
  }

  return null;
}

/**
 * Compute the trip context for a session, using the user's routine config.
 * This is a thin wrapper over `inferTripContext` that also handles the case
 * where the user profile has no routine configured.
 */
export function computeTripContext(profile: CarbotUserProfile, now: Date = new Date()): TripContext {
  return inferTripContext(profile.routine ?? null, now);
}
