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
 * useCarbotSession → VoiceCommon: what the hook actually hands to
 * `useSession`, and the Live config that results.
 *
 * VoiceCommon is NOT mocked wholesale here. Only `useSession` itself is
 * replaced (running it needs a microphone, an AudioContext and Firestore);
 * the model registry and `buildLiveConnectConfig` are the real ones. The test
 * captures the options the hook passes, feeds them through the real builder
 * exactly as `useSession` does, and compares the result with the config the
 * live suite sends to the real API. So a change to the model, the thinking
 * level, the tools, the voice or the turn-taking options in the hook fails
 * here, offline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { LiveConnectConfig } from '@google/genai';
import type { UseSessionOptions } from '@andyfooblah/voice-common';

const useSessionMock = vi.hoisted(() => vi.fn());
const startSessionMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@andyfooblah/voice-common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@andyfooblah/voice-common')>()),
  useSession: useSessionMock,
}));

// Firestore-backed and callable-backed services the hook touches on start.
vi.mock('../services/voiceQuota', () => ({
  checkAndReserveVoiceQuota: vi.fn(() => Promise.resolve({ allowed: true })),
  recordVoiceUsage: vi.fn(() => Promise.resolve()),
}));
vi.mock('../services/contextDocuments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/contextDocuments')>()),
  getActiveContextDocuments: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../services/memories', () => ({ getMemoryContextString: vi.fn(() => Promise.resolve('')) }));
vi.mock('../services/sessions', () => ({
  getRecentSessionTimestamps: vi.fn(() => Promise.resolve('')),
  setSessionCarbotFields: vi.fn(() => Promise.resolve()),
}));
vi.mock('../services/userProfile', () => ({ markBotNameIntroduced: vi.fn(() => Promise.resolve()) }));

import { DEFAULT_LIVE_MODEL, buildLiveConnectConfig, resolveLiveModel } from '@andyfooblah/voice-common';
import { useCarbotSession } from '../hooks/useCarbotSession';
import { GEMINI_LIVE_MODEL } from '../services/geminiBroker';
import { CARBOT_AUTO_GREET_TEXT, CARBOT_LIVE_TOOLS, buildCarbotLiveConnectConfig } from '../services/liveConfig';
import { SAFETY_BLOCK } from '../services/promptSafety';
import type { CarbotUserProfile } from '../types';

function makeProfile(overrides: Partial<CarbotUserProfile> = {}): CarbotUserProfile {
  return {
    email: 'parent@example.com',
    displayName: 'Test Parent',
    createdAt: { toMillis: () => 0, toDate: () => new Date(0) } as unknown as CarbotUserProfile['createdAt'],
    timezone: 'America/Los_Angeles',
    childName: 'Pip',
    botName: 'Zoomer',
    selectedVoice: 'Kore',
    ...overrides,
  };
}

/**
 * The config `useSession` builds from its options. Mirrors the one call in
 * VoiceCommon's hook (`connectGemini`), which VoiceCommon's own tests pin:
 * "the hook passes exactly the builder's output to live.connect".
 */
function configUseSessionSends(options: UseSessionOptions, instruction: string): LiveConnectConfig {
  return buildLiveConnectConfig({
    model: resolveLiveModel(options.liveModel),
    systemInstruction: instruction,
    tools: options.tools,
    thinkingLevel: options.thinkingLevel ?? 'auto',
    speechConfig: options.speechConfig,
    manualTurnControl: options.manualTurnControl,
    endOfSpeechSilenceMs: options.endOfSpeechSilenceMs,
    endOfSpeechSensitivity: options.endOfSpeechSensitivity,
    resumptionHandle: null,
  });
}

function lastOptions(): UseSessionOptions {
  return useSessionMock.mock.calls.at(-1)![0] as UseSessionOptions;
}

beforeEach(() => {
  vi.clearAllMocks();
  useSessionMock.mockImplementation(() => ({
    sessionId: null,
    connectionStatus: 'idle',
    messages: [],
    startSession: startSessionMock,
    stopSession: vi.fn(() => Promise.resolve()),
  }));
  // jsdom has no geolocation; getCurrentCity() falls back to null.
});

describe('useCarbotSession: options passed to VoiceCommon', () => {
  it('passes the one model constant and lets VoiceCommon resolve thinking', () => {
    renderHook(() => useCarbotSession({ userId: 'u1', profile: makeProfile() }));
    const options = lastOptions();
    expect(options.liveModel).toBe(GEMINI_LIVE_MODEL);
    expect(options.liveModel).toBe(DEFAULT_LIVE_MODEL);
    expect(options.thinkingLevel).toBe('auto');
  });

  it('passes the shared tool list, the opening cue and the profile voice', () => {
    renderHook(() => useCarbotSession({ userId: 'u1', profile: makeProfile({ selectedVoice: 'Fenrir' }) }));
    const options = lastOptions();
    expect(options.tools).toBe(CARBOT_LIVE_TOOLS);
    expect(options.autoGreetText).toBe(CARBOT_AUTO_GREET_TEXT);
    expect(options.speechConfig).toEqual({ voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } });
    expect(options.userId).toBe('u1');
    expect(typeof options.onToolCall).toBe('function');
  });

  it('sets no turn-taking or API-version override (server VAD, library defaults)', () => {
    renderHook(() => useCarbotSession({ userId: 'u1', profile: makeProfile() }));
    const options = lastOptions();
    for (const key of ['manualTurnControl', 'endOfSpeechSilenceMs', 'endOfSpeechSensitivity', 'liveApiVersion'] as const) {
      expect(options[key]).toBeUndefined();
    }
  });

  it('passes no voice when the profile has none', () => {
    renderHook(() => useCarbotSession({ userId: 'u1', profile: makeProfile({ selectedVoice: undefined }) }));
    expect(lastOptions().speechConfig).toBeUndefined();
  });
});

describe('useCarbotSession: the Live config that results', () => {
  it('startSession hands VoiceCommon the built instruction, and the config equals the one the live suite tests', async () => {
    const profile = makeProfile();
    const { result } = renderHook(() => useCarbotSession({ userId: 'u1', profile }));
    await act(async () => {
      await result.current.startSession();
    });

    expect(startSessionMock).toHaveBeenCalledTimes(1);
    const instruction = (startSessionMock.mock.calls[0] as unknown as [string])[0];
    expect(instruction).toContain('Your name is Zoomer.');
    expect(instruction).toContain('(Pip)');
    // The safety block is the last thing the model reads.
    expect(instruction.endsWith(SAFETY_BLOCK)).toBe(true);

    const sent = configUseSessionSends(lastOptions(), instruction);
    expect(sent).toEqual(buildCarbotLiveConnectConfig({ systemInstruction: instruction, selectedVoice: 'Kore' }));
    expect(sent).not.toHaveProperty('thinkingConfig');
    expect(sent.speechConfig).toEqual({ voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } });
    expect(sent.realtimeInputConfig?.automaticActivityDetection).not.toHaveProperty('disabled');
  });

  it('does not open a session when the daily voice quota is used up', async () => {
    const { checkAndReserveVoiceQuota } = await import('../services/voiceQuota');
    vi.mocked(checkAndReserveVoiceQuota).mockResolvedValueOnce({ allowed: false, reason: 'Daily limit reached.' } as never);
    const { result } = renderHook(() => useCarbotSession({ userId: 'u1', profile: makeProfile() }));
    await act(async () => {
      await result.current.startSession();
    });
    expect(startSessionMock).not.toHaveBeenCalled();
    expect(result.current.quotaError).toBe('Daily limit reached.');
  });

  it('dispatches a tool call from the model to the real implementation', async () => {
    renderHook(() => useCarbotSession({ userId: 'u1', profile: makeProfile() }));
    const reply = await lastOptions().onToolCall!('checkMathAnswer', { a: 12, b: 30, operation: 'add', userAnswer: 42 });
    expect(reply).toMatch(/42/);
    expect(await lastOptions().onToolCall!('noSuchTool', {})).toBe('Unknown tool: noSuchTool');
  });
});
