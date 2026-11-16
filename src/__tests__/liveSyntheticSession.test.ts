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
 * The synthetic session the live suite sends to the real API, checked
 * offline: the REAL instruction builder, fed the synthetic family, produces a
 * fully-populated instruction (every section present, SAFETY block last), and
 * the resulting Live config is the one a real conversation would send.
 *
 * This runs in `npm test`, so the live suite's inputs cannot quietly become
 * hollow (for example an instruction with no memories in it).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.unmock('@andyfooblah/voice-common');

import { getDocs } from 'firebase/firestore';
import { buildLiveConnectConfig } from '@andyfooblah/voice-common';
import { buildProfileConnectConfig } from '@andyfooblah/voice-common/testing';
import { GEMINI_LIVE_MODEL } from '../services/geminiBroker';
import { CARBOT_LIVE_TOOLS, buildCarbotLiveConnectConfig } from '../services/liveConfig';
import { SAFETY_BLOCK, untrustedBeginMarker, untrustedEndMarker } from '../services/promptSafety';
import {
  SYNTHETIC_ADDRESS,
  SYNTHETIC_BOT_NAME,
  SYNTHETIC_CHILD_NAME,
  SYNTHETIC_CITY,
  SYNTHETIC_CONTEXT_DOCUMENT,
  SYNTHETIC_MEMORIES,
  SYNTHETIC_VOICE,
  buildSyntheticInstruction,
  syntheticGetDocs,
} from './live/syntheticFamily';

beforeEach(() => {
  vi.mocked(getDocs).mockImplementation(syntheticGetDocs as unknown as typeof getDocs);
});

describe('the synthetic session used by the live suite', () => {
  it('is built by the real builder and has every section', async () => {
    const instruction = await buildSyntheticInstruction();

    expect(instruction).toContain(`Your name is ${SYNTHETIC_BOT_NAME}.`);
    expect(instruction).toContain(`(${SYNTHETIC_CHILD_NAME})`);
    expect(instruction).toContain('Current date and time: Saturday, November 14, 2026');
    expect(instruction).toContain('Swim lesson');
    expect(instruction).toContain(`You're currently in the ${SYNTHETIC_CITY} area.`);
    expect(instruction).toContain(`Known locations: home (${SYNTHETIC_ADDRESS}, USA)`);
    expect(instruction).toContain('Last 2 sessions:');

    // Memories and the context document arrive as delimited third-party text.
    expect(instruction).toContain(untrustedBeginMarker('MEMORIES'));
    for (const memory of SYNTHETIC_MEMORIES) expect(instruction).toContain(memory.content);
    expect(instruction).toContain(untrustedEndMarker('MEMORIES'));
    expect(instruction).toContain(untrustedBeginMarker('CONTEXT DOCUMENTS'));
    expect(instruction).toContain(`[${SYNTHETIC_CONTEXT_DOCUMENT.title}]`);
    expect(instruction).toContain(SYNTHETIC_CONTEXT_DOCUMENT.content);
    expect(instruction).toContain(untrustedEndMarker('CONTEXT DOCUMENTS'));

    expect(instruction).toContain('TOOLS — you have these tools available');
  });

  it('ends with the SAFETY block, after everything third parties can influence', async () => {
    const instruction = await buildSyntheticInstruction();
    expect(instruction.endsWith(SAFETY_BLOCK)).toBe(true);
    expect(instruction.indexOf(SAFETY_BLOCK)).toBeGreaterThan(instruction.indexOf(untrustedEndMarker('CONTEXT DOCUMENTS')));
    expect(instruction.split(SAFETY_BLOCK)).toHaveLength(2);
  });

  it('names every declared tool, so instruction and declarations agree', async () => {
    const instruction = await buildSyntheticInstruction();
    for (const tool of CARBOT_LIVE_TOOLS) expect(instruction, tool.name).toContain(tool.name!);
    expect(instruction).toContain("'endSession'");
  });

  it('is a realistic size, well under the 32,000-character target', async () => {
    const { length } = await buildSyntheticInstruction();
    expect(length).toBeGreaterThan(5_000);
    expect(length).toBeLessThan(32_000);
  });

  it('gives the config a real conversation sends, whichever way the kit is handed it', async () => {
    const systemInstruction = await buildSyntheticInstruction();
    const config = buildCarbotLiveConnectConfig({ systemInstruction, selectedVoice: SYNTHETIC_VOICE });

    // As `profile.connectConfig` (what the live suite passes) ...
    const direct = buildProfileConnectConfig({ name: 'carbot', model: GEMINI_LIVE_MODEL, systemInstruction, connectConfig: config });
    expect(direct).toEqual({ model: GEMINI_LIVE_MODEL, config });

    // ... and as the kit's own profile fields, which go through the same builder.
    const viaProfile = buildProfileConnectConfig({
      name: 'carbot',
      model: GEMINI_LIVE_MODEL,
      systemInstruction,
      tools: CARBOT_LIVE_TOOLS,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: SYNTHETIC_VOICE } } },
    });
    expect(viaProfile.config).toEqual(config);
    expect(config).toEqual(
      buildLiveConnectConfig({
        model: GEMINI_LIVE_MODEL,
        systemInstruction,
        tools: CARBOT_LIVE_TOOLS,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: SYNTHETIC_VOICE } } },
      }),
    );
  });
});
