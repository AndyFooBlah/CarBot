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
 * The Settings voice audition (services/voicePreview.ts): CarBot's second
 * Live path, which calls `ai.live.connect` directly.
 *
 * Offline. `@google/genai` is replaced by a recorder so the test can read the
 * exact model, config and client options the audition uses, and compare them
 * with the shared builder's output. VoiceCommon is the real one. The live
 * suite sends the same config to the real API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.unmock('@andyfooblah/voice-common');

interface Callbacks {
  onmessage: (msg: unknown) => void;
  onerror: (err: unknown) => void;
  onclose: (event?: { code?: number; reason?: string }) => void;
}

const sdk = vi.hoisted(() => ({
  clients: [] as { apiKey: string; httpOptions?: { apiVersion?: string } }[],
  connects: [] as { model: string; config: unknown; callbacks: unknown }[],
  session: { sendRealtimeInput: vi.fn(), close: vi.fn() },
  connectResult: undefined as Promise<unknown> | undefined,
}));

vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    live = {
      connect: (params: { model: string; config: unknown; callbacks: unknown }) => {
        sdk.connects.push(params);
        return sdk.connectResult ?? Promise.resolve(sdk.session);
      },
    };
    constructor(options: { apiKey: string; httpOptions?: { apiVersion?: string } }) {
      sdk.clients.push(options);
    }
  },
}));

vi.mock('../services/geminiBroker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/geminiBroker')>()),
  mintGeminiLiveToken: vi.fn(() => Promise.resolve({ token: 'auth_tokens/preview-test', expireTime: 'later' })),
}));

import { LIVE_API_VERSION, buildLiveConnectConfig } from '@andyfooblah/voice-common';
import { previewVoice } from '../services/voicePreview';
import { GEMINI_LIVE_MODEL, mintGeminiLiveToken } from '../services/geminiBroker';
import { VOICE_PREVIEW_INSTRUCTION, buildVoicePreviewConnectConfig } from '../services/liveConfig';

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  closed = false;
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, copyToChannel: vi.fn() };
  }
  createBufferSource() {
    return { buffer: null, connect: vi.fn(), start: vi.fn() };
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

/** A server message carrying 10 ms of silent 24 kHz PCM. */
const AUDIO_MESSAGE = {
  serverContent: {
    modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: btoa('\0'.repeat(480)) } }] },
  },
};

const callbacks = () => sdk.connects[0].callbacks as Callbacks;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  sdk.clients.length = 0;
  sdk.connects.length = 0;
  sdk.connectResult = undefined;
  sdk.session.sendRealtimeInput.mockClear();
  sdk.session.close.mockClear();
  vi.mocked(mintGeminiLiveToken).mockClear();
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('previewVoice', () => {
  it('connects with the one model constant and exactly the builder config', async () => {
    const done = previewVoice('Leda', 'Zoomer');
    done.catch(() => undefined);
    await flush();

    expect(sdk.connects).toHaveLength(1);
    expect(sdk.connects[0].model).toBe(GEMINI_LIVE_MODEL);
    expect(sdk.connects[0].config).toEqual(buildVoicePreviewConnectConfig('Leda'));
    expect(sdk.connects[0].config).toEqual(
      buildLiveConnectConfig({
        model: GEMINI_LIVE_MODEL,
        systemInstruction: VOICE_PREVIEW_INSTRUCTION,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Leda' } } },
        includeEndSessionTool: false,
      }),
    );
    expect(sdk.connects[0].config).not.toHaveProperty('thinkingConfig');
    expect(sdk.connects[0].config).not.toHaveProperty('tools');

    callbacks().onclose({ code: 1000 });
    await done.catch(() => undefined);
  });

  it('authenticates with a broker token on the pinned API version, never a long-lived key', async () => {
    const done = previewVoice('Leda', 'Zoomer');
    done.catch(() => undefined);
    await flush();

    expect(mintGeminiLiveToken).toHaveBeenCalledTimes(1);
    expect(sdk.clients).toEqual([{ apiKey: 'auth_tokens/preview-test', httpOptions: { apiVersion: LIVE_API_VERSION } }]);

    callbacks().onclose({ code: 1000 });
    await done.catch(() => undefined);
  });

  it('sends the one-line cue once connected, plays the audio and resolves after the turn', async () => {
    vi.useFakeTimers();
    const done = previewVoice('Leda', 'Zoomer');
    await flush();

    expect(sdk.session.sendRealtimeInput).toHaveBeenCalledWith({
      text: 'Say exactly this, warmly: "Hi! I\'m Zoomer."',
    });

    callbacks().onmessage(AUDIO_MESSAGE);
    callbacks().onmessage({ serverContent: { turnComplete: true } });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBeUndefined();
    expect(sdk.session.close).toHaveBeenCalled();
  });

  it('rejects, with the server reason, when the session closes before any audio', async () => {
    // A rejected setup arrives as a close; ai.live.connect() itself never settles.
    sdk.connectResult = new Promise(() => undefined);
    const done = previewVoice('Leda', 'Zoomer');
    done.catch(() => undefined);
    await flush();

    callbacks().onclose({ code: 1007, reason: 'Thinking level is not supported for this model.' });
    await expect(done).rejects.toThrow(
      'Voice preview closed before any audio (code 1007: Thinking level is not supported for this model.)',
    );
  });

  it('a close after audio has played is a normal end', async () => {
    const done = previewVoice('Leda', 'Zoomer');
    await flush();
    callbacks().onmessage(AUDIO_MESSAGE);
    callbacks().onclose({ code: 1000 });
    await expect(done).resolves.toBeUndefined();
  });

  it('rejects when the SDK reports an error', async () => {
    const done = previewVoice('Leda', 'Zoomer');
    done.catch(() => undefined);
    await flush();
    callbacks().onerror(new Error('socket error'));
    await expect(done).rejects.toThrow('socket error');
  });
});
