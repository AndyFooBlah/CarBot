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
 * The /diagnostics Live probe (services/liveProbe.ts), against a scripted
 * WebSocket. Offline. The live suite runs the same function against the real
 * API with a real ephemeral token.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.unmock('@andyfooblah/voice-common');

import { LiveProbeError, probeLiveSetup } from '../services/liveProbe';
import type { ProbeWebSocket } from '../services/liveProbe';
import { buildLiveSetupMessage, liveWebSocketUrl } from '../services/liveConfig';
import { GEMINI_LIVE_MODEL } from '../services/geminiBroker';

const TOKEN = 'auth_tokens/test-token-0123456789';

class FakeSocket implements ProbeWebSocket {
  binaryType = 'blob';
  onopen: ProbeWebSocket['onopen'] = null;
  onmessage: ProbeWebSocket['onmessage'] = null;
  onerror: ProbeWebSocket['onerror'] = null;
  onclose: ProbeWebSocket['onclose'] = null;
  sent: string[] = [];
  closed = 0;
  constructor(readonly url: string) {}
  send(data: string) { this.sent.push(data); }
  close() { this.closed++; }
}

function start(options: { timeoutMs?: number } = {}) {
  let socket!: FakeSocket;
  const promise = probeLiveSetup(TOKEN, {
    ...options,
    createWebSocket: (url) => (socket = new FakeSocket(url)),
  });
  // Keep an unhandled rejection from failing the run before the test asserts.
  promise.catch(() => undefined);
  return { socket, promise };
}

afterEach(() => vi.useRealTimers());

describe('probeLiveSetup', () => {
  it('opens the ephemeral-token endpoint and sends the production setup frame', () => {
    const { socket } = start();
    expect(socket.url).toBe(liveWebSocketUrl(TOKEN));
    expect(socket.binaryType).toBe('arraybuffer');
    expect(socket.sent).toEqual([]);

    socket.onopen!({});
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual(buildLiveSetupMessage());
    expect(JSON.parse(socket.sent[0]).setup.model).toBe(`models/${GEMINI_LIVE_MODEL}`);
  });

  it('is green only on setupComplete, not on open', async () => {
    const { socket, promise } = start();
    let settled = false;
    void promise.then(() => (settled = true));
    socket.onopen!({});
    await Promise.resolve();
    expect(settled).toBe(false);

    socket.onmessage!({ data: JSON.stringify({ setupComplete: {} }) });
    await expect(promise).resolves.toBeUndefined();
    expect(socket.closed).toBe(1);
  });

  it('reads setupComplete from a binary frame, as the server sends it', async () => {
    const { socket, promise } = start();
    socket.onopen!({});
    socket.onmessage!({ data: new TextEncoder().encode(JSON.stringify({ setupComplete: {} })).buffer });
    await expect(promise).resolves.toBeUndefined();
  });

  it('ignores frames that are not setupComplete', async () => {
    const { socket, promise } = start();
    socket.onopen!({});
    socket.onmessage!({ data: 'not json' });
    socket.onmessage!({ data: JSON.stringify({ serverContent: {} }) });
    socket.onmessage!({ data: JSON.stringify({ setupComplete: {} }) });
    await expect(promise).resolves.toBeUndefined();
  });

  it('reports the server close code and reason when the setup is rejected', async () => {
    const { socket, promise } = start();
    socket.onopen!({});
    socket.onclose!({ code: 1007, reason: 'Thinking level is not supported for this model.' });
    await expect(promise).rejects.toBeInstanceOf(LiveProbeError);
    await expect(promise).rejects.toMatchObject({
      code: 1007,
      reason: 'Thinking level is not supported for this model.',
      message: 'setup rejected, socket closed with code 1007: Thinking level is not supported for this model.',
    });
  });

  it('fails on a socket error', async () => {
    const { socket, promise } = start();
    socket.onerror!({});
    await expect(promise).rejects.toThrow('WebSocket failed');
    expect(socket.closed).toBe(1);
  });

  it('fails when the server never answers', async () => {
    vi.useFakeTimers();
    const { socket, promise } = start({ timeoutMs: 5000 });
    socket.onopen!({});
    vi.advanceTimersByTime(4999);
    await Promise.resolve();
    expect(socket.closed).toBe(0);
    vi.advanceTimersByTime(1);
    await expect(promise).rejects.toThrow('no setupComplete within 5000 ms');
    expect(socket.closed).toBe(1);
  });

  it('never puts the token in an error message', async () => {
    for (const fail of [
      (s: FakeSocket) => s.onerror!({}),
      (s: FakeSocket) => s.onclose!({ code: 1008, reason: 'denied' }),
    ]) {
      const { socket, promise } = start();
      fail(socket);
      const error = await promise.then(() => null, (e: Error) => e);
      expect(error).toBeInstanceOf(LiveProbeError);
      expect(error!.message).not.toContain('auth_tokens');
    }
  });

  it('a late close after success does not turn the result into a failure', async () => {
    const { socket, promise } = start();
    socket.onopen!({});
    socket.onmessage!({ data: JSON.stringify({ setupComplete: {} }) });
    socket.onclose!({ code: 1000, reason: '' });
    await expect(promise).resolves.toBeUndefined();
  });
});
