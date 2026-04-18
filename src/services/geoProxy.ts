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
}

async function callGeoProxy(
  data: { type: 'geocode' | 'distance' | 'weather'; query: string; queryB?: string },
): Promise<string> {
  const fn = httpsCallable<typeof data, GeoProxyResult>(functions, 'geoProxy');
  const res = await fn(data);
  return res.data.result;
}

export async function proxySearchPlace(query: string): Promise<string> {
  try {
    return await callGeoProxy({ type: 'geocode', query });
  } catch (err) {
    console.warn('[geoProxy] searchPlace error:', err);
    return 'Maps search unavailable at this time.';
  }
}

export async function proxyGetDistanceBetweenPlaces(from: string, to: string): Promise<string> {
  try {
    return await callGeoProxy({ type: 'distance', query: from, queryB: to });
  } catch (err) {
    console.warn('[geoProxy] getDistanceBetweenPlaces error:', err);
    return 'Distance lookup unavailable at this time.';
  }
}

export async function proxyGetWeather(location: string): Promise<string> {
  try {
    return await callGeoProxy({ type: 'weather', query: location });
  } catch (err) {
    console.warn('[geoProxy] getWeather error:', err);
    return 'Weather lookup unavailable at this time.';
  }
}
