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
 * Client-side callers for the geoProxy Firebase callable function.
 *
 * The Maps API key lives exclusively in Firebase Secret Manager.
 * The Weather API (weather.googleapis.com) does not send CORS headers
 * so direct browser calls are always blocked; the proxy is required.
 *
 * These functions are passed as toolOverrides to initializeKnowledgeCommon
 * so that KC's getWeather / searchPlace / getDistanceBetweenPlaces route
 * through the proxy instead of calling the Maps API directly.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '@andyfooblah/voice-common';

interface GeoProxyResult {
  result: string;
  formattedAddress?: string;
  city?: string | null;
  lat?: number;
  lng?: number;
}

type GeoProxyInput =
  | { type: 'geocode' | 'distance' | 'weather'; query: string; queryB?: string }
  | { type: 'reverseGeocodeCity'; lat: number; lng: number };

async function callGeoProxy(data: GeoProxyInput): Promise<GeoProxyResult> {
  const fn = httpsCallable<GeoProxyInput, GeoProxyResult>(functions, 'geoProxy');
  const res = await fn(data);
  return res.data;
}

/**
 * Translate a Firebase callable error into a message the Gemini Live model
 * can interpret and relay to the user. The httpsCallable wrapper surfaces a
 * server-thrown HttpsError as a FunctionsError with `code` prefixed by
 * `functions/` (e.g. `functions/resource-exhausted`).
 *
 * Rate-limit errors get a specific, retryable message so the model can say
 * "we've hit our daily limit" instead of silently degrading.
 */
function toolErrorMessage(err: unknown, fallback: string): string {
  const code = (err as { code?: string })?.code;
  if (code === 'functions/resource-exhausted') {
    const msg = (err as { message?: string })?.message ?? '';
    return `Rate limit reached: ${msg} The user should be told we've used this service too many times today and can try again tomorrow.`;
  }
  return fallback;
}

export async function proxySearchPlace(query: string): Promise<string> {
  try {
    return (await callGeoProxy({ type: 'geocode', query })).result;
  } catch (err) {
    console.warn('[geoProxy] searchPlace error:', err);
    return toolErrorMessage(err, 'Maps search unavailable at this time.');
  }
}

export async function proxyGetDistanceBetweenPlaces(from: string, to: string): Promise<string> {
  try {
    return (await callGeoProxy({ type: 'distance', query: from, queryB: to })).result;
  } catch (err) {
    console.warn('[geoProxy] getDistanceBetweenPlaces error:', err);
    return toolErrorMessage(err, 'Distance lookup unavailable at this time.');
  }
}

export async function proxyGetWeather(location: string): Promise<string> {
  try {
    return (await callGeoProxy({ type: 'weather', query: location })).result;
  } catch (err) {
    console.warn('[geoProxy] getWeather error:', err);
    return toolErrorMessage(err, 'Weather lookup unavailable at this time.');
  }
}

/**
 * Forward-geocode a user-entered location name to a formatted address.
 * Returns the raw query unchanged if the proxy call fails or finds nothing.
 */
export async function proxyResolveAddress(query: string): Promise<string> {
  try {
    const res = await callGeoProxy({ type: 'geocode', query });
    return res.formattedAddress ?? query;
  } catch (err) {
    console.warn('[geoProxy] resolveAddress error:', err);
    return query;
  }
}

/**
 * Reverse-geocode a lat/lng pair to a city name (locality). Returns null if
 * the proxy call fails or no locality is found. Coordinates are sent only
 * to the server-side proxy, never directly to Google.
 */
export async function proxyReverseGeocodeCity(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await callGeoProxy({ type: 'reverseGeocodeCity', lat, lng });
    return res.city ?? null;
  } catch (err) {
    console.warn('[geoProxy] reverseGeocodeCity error:', err);
    return null;
  }
}
