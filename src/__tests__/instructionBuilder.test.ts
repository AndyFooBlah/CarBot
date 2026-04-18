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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCarbotInstruction, computeTripContext, getCurrentCity } from '../services/instructionBuilder';
import type { SessionContext } from '../services/instructionBuilder';
import type { CarbotUserProfile, Routine } from '../types';

// ---------------------------------------------------------------------------
// Mock Firestore-backed services used by buildCarbotInstruction
// ---------------------------------------------------------------------------

vi.mock('../services/memories', () => ({
  getMemoryContextString: vi.fn(() => Promise.resolve('')),
}));

vi.mock('../services/contextDocuments', () => ({
  getActiveContextDocuments: vi.fn(() => Promise.resolve([])),
  buildContextDocumentSection: vi.fn(() => ''),
}));

vi.mock('../services/sessions', () => ({
  getRecentSessionTimestamps: vi.fn(() => Promise.resolve('')),
}));

import { getMemoryContextString } from '../services/memories';
import { getActiveContextDocuments, buildContextDocumentSection } from '../services/contextDocuments';
import { getRecentSessionTimestamps } from '../services/sessions';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date('2026-04-13T08:15:00Z');

const SCHOOL_ROUTINE: Routine = {
  schedule: {
    Mon: [{ name: 'Drop-off', startTime: '07:15', endTime: '08:15' }],
    Tue: [{ name: 'Drop-off', startTime: '07:15', endTime: '08:15' }],
    Wed: [{ name: 'Drop-off', startTime: '07:15', endTime: '08:15' }],
    Thu: [{ name: 'Drop-off', startTime: '07:15', endTime: '08:15' }],
    Fri: [{ name: 'Drop-off', startTime: '07:15', endTime: '08:15' }],
  },
  contextWindowMinutes: 30,
};

function makeProfile(overrides: Partial<CarbotUserProfile> = {}): CarbotUserProfile {
  return {
    email: 'test@example.com',
    displayName: 'Test User',
    createdAt: { toMillis: () => 0, toDate: () => new Date(0) } as unknown as import('firebase/firestore').Timestamp,
    timezone: 'America/Los_Angeles',
    childName: 'Leo',
    ...overrides,
  };
}

function makeContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    userId: 'user-1',
    profile: makeProfile(),
    currentCity: null,
    tripContext: 'unstructured',
    now: FIXED_DATE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildCarbotInstruction
// ---------------------------------------------------------------------------

describe('buildCarbotInstruction', () => {
  beforeEach(() => {
    vi.mocked(getMemoryContextString).mockResolvedValue('');
    vi.mocked(getActiveContextDocuments).mockResolvedValue([]);
    vi.mocked(buildContextDocumentSection).mockReturnValue('');
    vi.mocked(getRecentSessionTimestamps).mockResolvedValue('');
  });

  it('returns a non-empty string', async () => {
    const result = await buildCarbotInstruction(makeContext());
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('uses "CarBot" as default bot name when botName not set', async () => {
    const result = await buildCarbotInstruction(makeContext());
    expect(result).toContain('Your name is CarBot.');
  });

  it('uses the custom botName from profile', async () => {
    const result = await buildCarbotInstruction(makeContext({ profile: makeProfile({ botName: 'Zoomer' }) }));
    expect(result).toContain('Your name is Zoomer.');
  });

  it('trims whitespace from botName', async () => {
    const result = await buildCarbotInstruction(makeContext({ profile: makeProfile({ botName: '  Sparky  ' }) }));
    expect(result).toContain('Your name is Sparky.');
  });

  it("includes the child's name in the persona", async () => {
    const result = await buildCarbotInstruction(makeContext());
    expect(result).toContain('Leo');
  });

  it('falls back to "the child" when childName not set', async () => {
    const result = await buildCarbotInstruction(makeContext({ profile: makeProfile({ childName: undefined }) }));
    expect(result).toContain('the child');
  });

  it('includes the current date', async () => {
    const result = await buildCarbotInstruction(makeContext());
    // April 13 should appear in some form
    expect(result).toMatch(/April 13/);
  });

  it('includes currentCity when provided', async () => {
    const result = await buildCarbotInstruction(makeContext({ currentCity: 'Palo Alto' }));
    expect(result).toContain('Palo Alto');
  });

  it('omits location section when currentCity is null', async () => {
    const result = await buildCarbotInstruction(makeContext({ currentCity: null }));
    expect(result).not.toContain("You're currently in the");
  });

  it('includes known locations from profile', async () => {
    const profile = makeProfile({
      locations: [{ name: 'school', query: 'Lincoln Elementary', resolvedAddress: 'Lincoln Elementary, Palo Alto, CA' }],
    });
    const result = await buildCarbotInstruction(makeContext({ profile }));
    expect(result).toContain('school');
    expect(result).toContain('Lincoln Elementary, Palo Alto, CA');
  });

  it('includes tool instructions', async () => {
    const result = await buildCarbotInstruction(makeContext());
    expect(result).toContain('searchWikipedia');
    expect(result).toContain('getWeather');
    expect(result).toContain('getJoke');
    expect(result).toContain('searchPlace');
  });

  it('includes name-intro line when botNameNeedsIntro is true', async () => {
    const result = await buildCarbotInstruction(makeContext({ profile: makeProfile({ botName: 'Zippy', botNameNeedsIntro: true }) }));
    expect(result).toContain('introduce yourself by name');
  });

  it('suppresses name intro when botNameNeedsIntro is false', async () => {
    const result = await buildCarbotInstruction(makeContext({ profile: makeProfile({ botNameNeedsIntro: false }) }));
    expect(result).toContain("Don't introduce yourself by name");
  });

  it('joins parts with double newlines', async () => {
    const result = await buildCarbotInstruction(makeContext());
    expect(result).toContain('\n\n');
  });

  it('includes memory context when service returns content', async () => {
    vi.mocked(getMemoryContextString).mockResolvedValue('Leo loves dinosaurs.');
    const result = await buildCarbotInstruction(makeContext());
    expect(result).toContain('Leo loves dinosaurs.');
  });

  it('includes context document section when service returns content', async () => {
    vi.mocked(buildContextDocumentSection).mockReturnValue('School newsletter: field trip on Friday.');
    const result = await buildCarbotInstruction(makeContext());
    expect(result).toContain('School newsletter: field trip on Friday.');
  });

  it('includes session timestamps when service returns content', async () => {
    vi.mocked(getRecentSessionTimestamps).mockResolvedValue('Last session: Monday at 8am.');
    const result = await buildCarbotInstruction(makeContext());
    expect(result).toContain('Last session: Monday at 8am.');
  });

  it('continues gracefully when memory service throws', async () => {
    vi.mocked(getMemoryContextString).mockRejectedValue(new Error('Firestore error'));
    await expect(buildCarbotInstruction(makeContext())).resolves.not.toThrow();
  });

  it('continues gracefully when context document service throws', async () => {
    vi.mocked(getActiveContextDocuments).mockRejectedValue(new Error('Firestore error'));
    await expect(buildCarbotInstruction(makeContext())).resolves.not.toThrow();
  });

  it('continues gracefully when session timestamp service throws', async () => {
    vi.mocked(getRecentSessionTimestamps).mockRejectedValue(new Error('Firestore error'));
    await expect(buildCarbotInstruction(makeContext())).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// computeTripContext
// ---------------------------------------------------------------------------

describe('computeTripContext', () => {
  it('returns "unstructured" when profile has no routine', () => {
    const profile = makeProfile({ routine: undefined });
    expect(computeTripContext(profile, FIXED_DATE)).toBe('unstructured');
  });

  it('returns a structured trip context when routine is configured', () => {
    const profile = makeProfile({ routine: SCHOOL_ROUTINE });
    // FIXED_DATE is Monday April 13, 2026 at 08:15 UTC = 01:15 PDT — outside window
    // Result will be school_day_other or similar, just not 'unstructured'
    const result = computeTripContext(profile, FIXED_DATE);
    expect(result).not.toBe('unstructured');
  });

  it('uses current time when no date argument provided', () => {
    const profile = makeProfile({ routine: undefined });
    // Should not throw when called without a date
    expect(() => computeTripContext(profile)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getCurrentCity
// ---------------------------------------------------------------------------

describe('getCurrentCity', () => {
  it('returns null when geolocation is not available', async () => {
    // jsdom doesn't have navigator.geolocation by default
    Object.defineProperty(window.navigator, 'geolocation', {
      value: undefined,
      configurable: true,
    });
    const result = await getCurrentCity();
    expect(result).toBeNull();
  });
});
