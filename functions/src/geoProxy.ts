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
 * geoProxy — server-side proxy for Google Maps Geocoding + Weather APIs.
 *
 * Keeps the Maps API key off the client bundle. The Weather API
 * (weather.googleapis.com) does not send CORS headers, so browser-direct
 * calls are always blocked regardless; a server-side proxy is required.
 *
 * Setup:
 *   firebase functions:secrets:set GOOGLE_MAPS_API_KEY
 *
 * Required APIs (Google Cloud Console):
 *   - Geocoding API
 *   - Maps Platform Weather API
 */

import { onCall, CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { enforceRateLimit } from './rateLimit';

export const googleMapsApiKey = defineSecret('GOOGLE_MAPS_API_KEY');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GeoResult {
  formattedAddress: string;
  lat: number;
  lng: number;
}

async function geocodeServer(query: string, key: string): Promise<GeoResult | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query.trim())}&key=${key}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json() as Record<string, unknown>;
  if (data['status'] !== 'OK') return null;
  const results = data['results'] as Array<Record<string, unknown>>;
  if (!results?.length) return null;
  const r = results[0];
  const geo = r['geometry'] as Record<string, unknown>;
  const loc = geo?.['location'] as Record<string, number>;
  return {
    formattedAddress: r['formatted_address'] as string,
    lat: loc?.lat,
    lng: loc?.lng,
  };
}

async function reverseGeocodeCity(lat: number, lng: number, key: string): Promise<string | null> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
    `&result_type=locality&key=${key}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json() as Record<string, unknown>;
  if (data['status'] !== 'OK') return null;
  const results = data['results'] as Array<Record<string, unknown>>;
  if (!results?.length) return null;
  const components = results[0]['address_components'] as Array<{ types: string[]; long_name: string }> | undefined;
  const locality = components?.find((c) => c.types.includes('locality'));
  return locality?.long_name ?? null;
}

function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------
// Callable function
// ---------------------------------------------------------------------------

export const geoProxy = onCall(
  {
    secrets: [googleMapsApiKey],
    region: 'us-central1',
  },
  async (request: CallableRequest) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
    await enforceRateLimit(request.auth.uid, 'geoProxy');

    const key = googleMapsApiKey.value();
    if (!key) throw new HttpsError('internal', 'GOOGLE_MAPS_API_KEY not configured on server.');

    const { type, query, queryB, lat, lng } = request.data as {
      type: 'geocode' | 'distance' | 'weather' | 'reverseGeocodeCity';
      query?: string;
      queryB?: string;
      lat?: number;
      lng?: number;
    };

    if (!type) throw new HttpsError('invalid-argument', 'type is required.');

    // --- Reverse geocode (lat/lng → city) ---
    if (type === 'reverseGeocodeCity') {
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        throw new HttpsError('invalid-argument', 'lat and lng required for reverseGeocodeCity.');
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new HttpsError('invalid-argument', 'lat/lng out of range.');
      }
      const city = await reverseGeocodeCity(lat, lng, key);
      return { city, result: city ?? '' };
    }

    if (!query) throw new HttpsError('invalid-argument', 'query is required.');
    if (typeof query !== 'string' || query.length > 500) {
      throw new HttpsError('invalid-argument', 'query is too long.');
    }
    if (queryB !== undefined && (typeof queryB !== 'string' || queryB.length > 500)) {
      throw new HttpsError('invalid-argument', 'queryB is too long.');
    }

    // --- Geocode ---
    if (type === 'geocode') {
      const geo = await geocodeServer(query, key);
      if (!geo) return { result: `No location found for "${query}".` };
      return {
        result: `${geo.formattedAddress} (coordinates: ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)})`,
        formattedAddress: geo.formattedAddress,
        lat: geo.lat,
        lng: geo.lng,
      };
    }

    // --- Distance ---
    if (type === 'distance') {
      if (!queryB) throw new HttpsError('invalid-argument', 'queryB required for distance.');
      const [geoA, geoB] = await Promise.all([geocodeServer(query, key), geocodeServer(queryB, key)]);
      if (!geoA) return { result: `Could not find location for "${query}".` };
      if (!geoB) return { result: `Could not find location for "${queryB}".` };
      const miles = haversineDistanceMiles(geoA.lat, geoA.lng, geoB.lat, geoB.lng);
      const km = miles * 1.60934;
      return {
        result: `${geoA.formattedAddress} to ${geoB.formattedAddress}: approximately ${Math.round(miles)} miles (${Math.round(km)} km) as the crow flies.`,
      };
    }

    // --- Weather ---
    if (type === 'weather') {
      const geo = await geocodeServer(query, key);
      if (!geo) return { result: `Could not find location "${query}" for weather lookup.` };

      const locParams = `location.latitude=${geo.lat}&location.longitude=${geo.lng}&unitsSystem=IMPERIAL`;
      const [currentRes, forecastRes] = await Promise.all([
        fetch(`https://weather.googleapis.com/v1/currentConditions:lookup?key=${key}&${locParams}`),
        fetch(`https://weather.googleapis.com/v1/forecast/days:lookup?key=${key}&${locParams}&days=3`),
      ]);

      if (!currentRes.ok && !forecastRes.ok) {
        return { result: `Weather data unavailable for "${query}" at this time.` };
      }

      let summary = `Weather for ${geo.formattedAddress}:`;

      if (currentRes.ok) {
        const current = await currentRes.json() as Record<string, unknown>;
        const temp = current['temperature'] as Record<string, number> | undefined;
        const feels = current['feelsLikeTemperature'] as Record<string, number> | undefined;
        const cond = current['weatherCondition'] as Record<string, Record<string, string>> | undefined;
        const tempF = temp?.['degrees'];
        const feelsF = feels?.['degrees'];
        const condition = cond?.['description']?.['text'] ?? '';
        if (tempF != null) {
          const tempC = Math.round((tempF - 32) * 5 / 9);
          summary += ` Currently ${Math.round(tempF)}°F (${tempC}°C)`;
          if (feelsF != null && Math.abs(feelsF - tempF) >= 3) {
            summary += `, feels like ${Math.round(feelsF)}°F (${Math.round((feelsF - 32) * 5 / 9)}°C)`;
          }
          if (condition) summary += `, ${condition.toLowerCase()}`;
          summary += '.';
        }
      }

      if (forecastRes.ok) {
        const forecast = await forecastRes.json() as Record<string, unknown>;
        const days = (forecast['forecastDays'] as Array<Record<string, unknown>>) ?? [];
        if (days.length > 0) {
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dayParts = days.slice(0, 3).map((d) => {
            const dd = d['displayDate'] as Record<string, number> | undefined;
            const label = dd ? dayNames[new Date(dd['year'], dd['month'] - 1, dd['day']).getDay()] : '?';
            const hiTemp = d['maxTemperature'] as Record<string, number> | undefined;
            const loTemp = d['minTemperature'] as Record<string, number> | undefined;
            const daytime = d['daytimeForecast'] as Record<string, unknown> | undefined;
            const condObj = daytime?.['weatherCondition'] as Record<string, Record<string, string>> | undefined;
            const cond = condObj?.['description']?.['text'] ?? '';
            let part = label;
            if (hiTemp?.['degrees'] != null && loTemp?.['degrees'] != null) {
              part += ` ${Math.round(hiTemp['degrees']!)}/${Math.round(loTemp['degrees']!)}°F`;
            }
            if (cond) part += ` ${cond.toLowerCase()}`;
            return part;
          });
          summary += ` Next 3 days: ${dayParts.join(', ')}.`;
        }
      }

      return { result: summary };
    }

    throw new HttpsError('invalid-argument', `Unknown type: ${type}`);
  },
);
