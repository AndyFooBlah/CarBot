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
 * useCarbotSession — CarBot's session hook.
 *
 * Wraps VoiceCommon's useSession with CarBot-specific behavior:
 *   - Assembles the system instruction from profile, memories, and context docs
 *   - Attempts browser geolocation before starting
 *   - Writes CarBot-specific fields (tripContext, contextDocIds) to the session
 *     document once VoiceCommon creates it
 *   - Provides the built-in CarBot tool set (weather, maps, jokes, wikipedia)
 *
 * The caller receives the same interface as VoiceCommon's UseSessionReturn,
 * plus `tripContext` so the UI can display it.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from '@andyfooblah/voice-common';
import type { UseSessionReturn } from '@andyfooblah/voice-common';
import {
  allKnowledgeTools,
  getWeather,
  searchPlace,
  getDistanceBetweenPlaces,
  getJoke,
  searchWikipedia,
} from '@andyfooblah/knowledge-common';
import { getActiveContextDocuments } from '../services/contextDocuments';
import { buildCarbotInstruction, getCurrentCity, computeTripContext } from '../services/instructionBuilder';
import { setSessionCarbotFields } from '../services/sessions';
import { markBotNameIntroduced } from '../services/userProfile';
import { checkAndReserveVoiceQuota, recordVoiceUsage } from '../services/voiceQuota';
import type { CarbotUserProfile, TripContext } from '../types';

/**
 * Maximum duration a single session is allowed to run before the client
 * auto-ends it. Guards against tabs left open indefinitely. Set high enough
 * that a legitimate long conversation with an elderly family member is not
 * interrupted.
 */
const MAX_SESSION_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface UseCarbotSessionOptions {
  userId: string;
  profile: CarbotUserProfile;
  onSessionEndRequest?: () => void;
  onBotSpeaking?: (speaking: boolean) => void;
}

export interface UseCarbotSessionReturn extends UseSessionReturn {
  tripContext: TripContext;
  /**
   * Human-readable quota error message when startSession was blocked by the
   * per-day voice quota. Cleared automatically on the next startSession call.
   */
  quotaError: string | null;
}

export function useCarbotSession(options: UseCarbotSessionOptions): UseCarbotSessionReturn {
  const { userId, profile, onSessionEndRequest, onBotSpeaking } = options;

  // The assembled system instruction — built once per session start
  const [systemInstruction, setSystemInstruction] = useState('');
  const [tripContext, setTripContext] = useState<TripContext>('unstructured');
  const [quotaError, setQuotaError] = useState<string | null>(null);

  // Track the context doc IDs that were active at session start for storage
  const activeDocIdsRef = useRef<string[]>([]);
  // Whether the CarBot fields have been written to Firestore for this session
  const carbotFieldsWrittenRef = useRef(false);
  // When the current session started — used to compute duration at stop time
  const sessionStartAtRef = useRef<number | null>(null);
  // Timer that auto-ends the session if it runs past MAX_SESSION_DURATION_MS
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const vcSession = useSession({
    userId,
    systemInstruction,
    tools: allKnowledgeTools,
    autoGreetText: '[Session started. Please greet the family and begin the conversation as described in your instructions.]',
    speechConfig: profile.selectedVoice ? {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: profile.selectedVoice } },
    } : undefined,
    onToolCall: async (name: string, args: Record<string, unknown>) => {
      switch (name) {
        case 'getWeather':
          return getWeather(args.location as string);
        case 'searchPlace':
          return searchPlace(args.query as string);
        case 'getDistanceBetweenPlaces':
          return getDistanceBetweenPlaces(args.from as string, args.to as string);
        case 'getJoke':
          return getJoke(args.category as string | undefined);
        case 'searchWikipedia':
          return searchWikipedia({
            question: args.question as string,
            maxChunks: args.maxChunks as number | undefined,
            maxAgeDays: args.maxAgeDays as number | undefined,
          });
        default:
          return `Unknown tool: ${name}`;
      }
    },
    onSessionEndRequest,
    onBotSpeaking,
  });

  // Watch for sessionId to become available, then write CarBot fields
  useEffect(() => {
    if (vcSession.sessionId && !carbotFieldsWrittenRef.current) {
      carbotFieldsWrittenRef.current = true;
      setSessionCarbotFields(vcSession.sessionId, {
        tripContext,
        contextDocIds: activeDocIdsRef.current,
      }).catch((err) => console.error('[useCarbotSession] Failed to write CarBot fields:', err));
    }
  }, [vcSession.sessionId, tripContext]);

  // Wrap startSession to build the instruction first
  const startSession = useCallback(async () => {
    setQuotaError(null);

    // Reserve a session slot before doing any expensive work. If the daily
    // quota is exhausted this short-circuits cleanly without opening a
    // Gemini connection.
    try {
      const quota = await checkAndReserveVoiceQuota();
      if (!quota.allowed) {
        setQuotaError(quota.reason ?? 'Voice session unavailable at this time.');
        return;
      }
    } catch (err) {
      console.error('[useCarbotSession] Voice quota check failed:', err);
      setQuotaError('Could not verify voice quota. Please try again.');
      return;
    }

    carbotFieldsWrittenRef.current = false;
    const now = new Date();
    const context = computeTripContext(profile, now);
    setTripContext(context);

    // Gather active doc IDs for the session record
    const activeDocs = await getActiveContextDocuments(userId).catch(() => []);
    activeDocIdsRef.current = activeDocs.map((d) => d.id);

    // Try to get current city (non-fatal)
    const currentCity = await getCurrentCity();

    // Assemble the system instruction
    const instruction = await buildCarbotInstruction({
      userId,
      profile,
      currentCity,
      tripContext: context,
      now,
    });

    console.log('[CarBot] System instruction built (%d chars):\n%s', instruction.length, instruction);
    setSystemInstruction(instruction);

    // Pass the instruction directly to avoid the stale-closure problem:
    // setSystemInstruction schedules a re-render; vcSession.startSession()
    // would otherwise run before that render and see the old (empty) value.
    sessionStartAtRef.current = Date.now();
    await vcSession.startSession(instruction);

    // Arm the hard-timeout watchdog — see MAX_SESSION_DURATION_MS.
    if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
    maxDurationTimerRef.current = setTimeout(() => {
      console.warn('[useCarbotSession] Session exceeded max duration — auto-ending');
      vcSession.stopSession().catch((err) =>
        console.error('[useCarbotSession] Auto-stop failed:', err),
      );
    }, MAX_SESSION_DURATION_MS);

    // Session connected — if the bot introduced itself with its name, clear
    // the flag so it doesn't repeat the introduction next session.
    if (profile.botNameNeedsIntro) {
      markBotNameIntroduced(userId).catch((err) =>
        console.error('[useCarbotSession] Failed to clear botNameNeedsIntro:', err),
      );
    }
  }, [userId, profile, vcSession]);

  // Wrap stopSession to record usage and clear the hard-timeout watchdog.
  const stopSession = useCallback(async () => {
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    const startedAt = sessionStartAtRef.current;
    sessionStartAtRef.current = null;

    try {
      await vcSession.stopSession();
    } finally {
      if (startedAt) {
        const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
        recordVoiceUsage(durationSeconds).catch(() => null);
      }
    }
  }, [vcSession]);

  // Clean up the watchdog if the component unmounts mid-session.
  useEffect(() => {
    return () => {
      if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
    };
  }, []);

  return {
    ...vcSession,
    startSession,
    stopSession,
    tripContext,
    quotaError,
  };
}
