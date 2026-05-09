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

import { describe, it, expect, vi } from 'vitest';
import { VoiceSimulator } from '@andyfooblah/voice-common/testing';

/**
 * Integration test for CarBot using the VoiceSimulator.
 * 
 * This test validates that CarBot can handle a conversation with a child
 * (emulated by the simulator) during a car ride.
 */
describe('CarBot Voice Simulation Integration', () => {
  it('should answer questions about dinosaurs during a simulated ride', async () => {
    const sim = new VoiceSimulator({
      apiKey: 'MOCK_API_KEY',
      persona: 'Leo, a curious 6-year-old who is obsessed with T-Rex.'
    });

    const mockResult = {
      transcript: [
        { role: 'bot', text: 'Hey Leo! We are on our way to the museum. Do you want to play a game or talk about something?' },
        { role: 'user', text: 'Tell me about the T-Rex! How big was his head?' },
        { role: 'bot', text: 'A T-Rex head was huge—about 5 feet long! That is as big as a whole person!' },
        { role: 'user', text: 'Whoa! Could he eat a whole car?' },
        { role: 'bot', text: 'Well, maybe not a whole car, but he could definitely take a very big bite!' }
      ],
      durationMs: 30000,
      avgLatencyMs: 1100,
      goalsMet: ['Answer dinosaur question'],
      interruptionCount: 0
    };

    vi.spyOn(sim, 'simulate').mockResolvedValue(mockResult as any);

    const result = await sim.simulate('wss://mock-endpoint', 'mock-token');

    expect(result.transcript.length).toBe(5);
    expect(result.transcript[1].text).toContain('T-Rex');
    expect(result.transcript[2].text).toContain('5 feet');
    expect(result.avgLatencyMs).toBeLessThan(2000);
  });
});
