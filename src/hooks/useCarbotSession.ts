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
  getKnowledgeConfig,
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
import type { CarbotUserProfile, TripContext } from '../types';

export interface UseCarbotSessionOptions {
  userId: string;
  profile: CarbotUserProfile;
  onSessionEndRequest?: () => void;
  onBotSpeaking?: (speaking: boolean) => void;
}

export interface UseCarbotSessionReturn extends UseSessionReturn {
  tripContext: TripContext;
}

export function useCarbotSession(options: UseCarbotSessionOptions): UseCarbotSessionReturn {
  const { userId, profile, onSessionEndRequest, onBotSpeaking } = options;

  // The assembled system instruction — built once per session start
  const [systemInstruction, setSystemInstruction] = useState('');
  const [tripContext, setTripContext] = useState<TripContext>('unstructured');

  // Track the context doc IDs that were active at session start for storage
  const activeDocIdsRef = useRef<string[]>([]);
  // Whether the CarBot fields have been written to Firestore for this session
  const carbotFieldsWrittenRef = useRef(false);

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
    carbotFieldsWrittenRef.current = false;
    const now = new Date();
    const context = computeTripContext(profile, now);
    setTripContext(context);

    // Gather active doc IDs for the session record
    const activeDocs = await getActiveContextDocuments(userId).catch(() => []);
    activeDocIdsRef.current = activeDocs.map((d) => d.id);

    // Try to get current city (non-fatal)
    const mapsApiKey = getKnowledgeConfig().mapsApiKey ?? null;
    const currentCity = await getCurrentCity(mapsApiKey);

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
    await vcSession.startSession(instruction);

    // Session connected — if the bot introduced itself with its name, clear
    // the flag so it doesn't repeat the introduction next session.
    if (profile.botNameNeedsIntro) {
      markBotNameIntroduced(userId).catch((err) =>
        console.error('[useCarbotSession] Failed to clear botNameNeedsIntro:', err),
      );
    }
  }, [userId, profile, vcSession]);

  return {
    ...vcSession,
    startSession,
    tripContext,
  };
}
