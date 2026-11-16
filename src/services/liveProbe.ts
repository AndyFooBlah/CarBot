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
 * liveProbe — the /diagnostics check that a Gemini Live session can really be
 * opened, end to end, the way a conversation opens one.
 *
 * Given an ephemeral token from the broker it opens the Live WebSocket, sends
 * a `setup` frame for the production model (services/liveConfig.ts) and waits
 * for the server's `setupComplete`. Opening the socket alone proves little:
 * the server accepts the connection first and rejects a bad model, a bad
 * config or a bad token afterwards, by closing it. So the probe is green only
 * on `setupComplete`, and a rejection reports the server's close code and
 * reason (for example `1007 Thinking level is not supported for this model`).
 *
 * No audio is sent or requested, so a probe costs nothing beyond the setup.
 */

import { buildLiveSetupMessage, liveWebSocketUrl } from './liveConfig';

/** The server closed the socket, or never answered, before `setupComplete`. */
export class LiveProbeError extends Error {
  constructor(
    message: string,
    /** WebSocket close code, when the server closed the connection. */
    readonly code?: number,
    /** WebSocket close reason from the server. */
    readonly reason?: string,
  ) {
    super(message);
    this.name = 'LiveProbeError';
  }
}

/** The parts of the WebSocket API the probe uses (so tests can supply a fake). */
export interface ProbeWebSocket {
  binaryType: string;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface ProbeLiveSetupOptions {
  /** How long to wait for `setupComplete`. Default 8000 ms. */
  timeoutMs?: number;
  /** WebSocket constructor. Default: the global one. */
  createWebSocket?: (url: string) => ProbeWebSocket;
}

function decodeFrame(data: unknown): string {
  if (typeof data === 'string') return data;
  // Tag check rather than `instanceof`: a buffer created in another realm
  // (a worker, an iframe, a test environment) fails `instanceof ArrayBuffer`.
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
    return new TextDecoder().decode(new Uint8Array(data as ArrayBuffer));
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  return '';
}

/**
 * Open a Live session with the production model and resolve once the server
 * answers `setupComplete`.
 *
 * @param ephemeralToken - single-use token from `mintGeminiLiveToken()`
 * @throws {LiveProbeError} when the server rejects the setup, the socket
 *   fails, or nothing arrives in time. The message never contains the token.
 */
export function probeLiveSetup(
  ephemeralToken: string,
  options: ProbeLiveSetupOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const createWebSocket =
    options.createWebSocket ?? ((url: string) => new WebSocket(url) as unknown as ProbeWebSocket);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const ws = createWebSocket(liveWebSocketUrl(ephemeralToken));
    // The server sends JSON in binary frames.
    ws.binaryType = 'arraybuffer';

    const finish = (err?: LiveProbeError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(
      () => finish(new LiveProbeError(`no setupComplete within ${timeoutMs} ms`)),
      timeoutMs,
    );

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify(buildLiveSetupMessage()));
      } catch {
        finish(new LiveProbeError('could not send the setup frame'));
      }
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(decodeFrame(event.data)) as { setupComplete?: unknown };
        if (message.setupComplete !== undefined) finish();
      } catch {
        // Not JSON: ignore and keep waiting for setupComplete.
      }
    };
    ws.onerror = () => finish(new LiveProbeError('WebSocket failed'));
    ws.onclose = (event) => {
      const reason = event.reason ? `: ${event.reason}` : '';
      finish(
        new LiveProbeError(
          `setup rejected, socket closed with code ${event.code ?? 'unknown'}${reason}`,
          event.code,
          event.reason,
        ),
      );
    };
  });
}
