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
 * voicePreview — plays a short Gemini Live audio clip so the user can audition
 * a voice before saving their selection.
 *
 * Opens a minimal Gemini Live session (no tools, no Firestore, no mic), sends
 * a single text prompt asking the bot to say "Hi, I'm <botName>.", streams the
 * PCM audio chunks through Web Audio, then closes the session.
 */

import { GoogleGenAI } from '@google/genai';
import { GEMINI_LIVE_MODEL, mintGeminiLiveToken } from './geminiBroker';
import {
  CARBOT_LIVE_API_VERSION,
  buildVoicePreviewConnectConfig,
  voicePreviewPrompt,
} from './liveConfig';

/**
 * Play a short voice preview of the given voice saying "Hi! I'm <botName>."
 *
 * Authenticates the Live WebSocket with a single-use ephemeral token minted
 * by the server-side broker — no long-lived Gemini key in the browser.
 *
 * @param voiceName  - Gemini Live voice name (e.g. "Puck", "Kore")
 * @param botName    - Name the bot introduces itself with
 */
export async function previewVoice(
  voiceName: string,
  botName: string,
): Promise<void> {
  const { token } = await mintGeminiLiveToken();
  // Same API version VoiceCommon's useSession pins for an ephemeral token.
  const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: CARBOT_LIVE_API_VERSION } });

  // Web Audio context at 24 kHz to match Gemini Live PCM output rate
  const audioCtx = new AudioContext({ sampleRate: 24000 });

  // Schedule audio chunks end-to-end; advance startTime as chunks arrive
  let scheduledUntil = audioCtx.currentTime;

  return new Promise<void>((resolve, reject) => {
    let closed = false;
    let gotAudio = false;
    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

    const finish = (err?: unknown) => {
      if (closed) return;
      closed = true;
      try { liveSession?.close(); } catch { /* ignore */ }
      void audioCtx.close();
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve();
    };

    ai.live.connect({
      // The audition uses the same Live model and config builder as a real
      // session (services/liveConfig.ts), so a model that works here works
      // there, and the live suite covers this exact config.
      model: GEMINI_LIVE_MODEL,
      config: buildVoicePreviewConnectConfig(voiceName),
      callbacks: {
        onmessage: (msg) => {
          // Play each PCM chunk as it arrives
          if (msg.serverContent?.modelTurn?.parts) {
            for (const part of msg.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith('audio/pcm') && part.inlineData.data) {
                gotAudio = true;
                const raw = atob(part.inlineData.data);
                const bytes = new Uint8Array(raw.length);
                for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

                const pcm16 = new Int16Array(bytes.buffer);
                const float32 = new Float32Array(pcm16.length);
                for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;

                const buffer = audioCtx.createBuffer(1, float32.length, 24000);
                buffer.copyToChannel(float32, 0);

                const source = audioCtx.createBufferSource();
                source.buffer = buffer;
                source.connect(audioCtx.destination);

                const scheduleAt = Math.max(audioCtx.currentTime, scheduledUntil);
                source.start(scheduleAt);
                scheduledUntil = scheduleAt + buffer.duration;
              }
            }
          }

          // Once the bot has finished its turn, wait for the audio to finish then close
          if (msg.serverContent?.turnComplete) {
            const remainingMs = Math.max(0, (scheduledUntil - audioCtx.currentTime) * 1000) + 300;
            setTimeout(() => finish(), remainingMs);
          }
        },
        onerror: (err) => finish(err),
        // A close before any audio means the audition never played. The
        // server reports a rejected setup (bad model, bad config, bad voice)
        // this way, and ai.live.connect() never settles in that case, so
        // this is the only place the failure can surface.
        onclose: (event) => {
          if (gotAudio) finish();
          else finish(new Error(`Voice preview closed before any audio (code ${event?.code ?? 'unknown'}${event?.reason ? `: ${event.reason}` : ''})`));
        },
      },
    }).then((session) => {
      liveSession = session;
      // Ask the bot to say the greeting — nothing more
      session.sendRealtimeInput({ text: voicePreviewPrompt(botName) });
    }).catch(finish);
  });
}
