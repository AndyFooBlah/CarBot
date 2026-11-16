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
 * Guard: one Live model id, in one file, on every path, client and server.
 *
 * Scans shipping source (src/ and functions/src/, minus tests) and fails with
 * file and line when
 *   - a Gemini Live model id is written anywhere other than the constant in
 *     src/services/geminiBroker.ts (a second copy is how one path gets left
 *     behind on a model change);
 *   - an id VoiceCommon's registry marks legacy or shut down appears at all,
 *     outside a line marked `model-history:`;
 *   - code opens a Live session (ai.live.connect, a BidiGenerateContent
 *     WebSocket) from a file that is not on the list of known Live paths;
 *   - the server starts pinning a Live model without a matching assertion.
 *
 * Offline: no network, no key.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';

vi.unmock('@andyfooblah/voice-common');

import { DEFAULT_LIVE_MODEL, LIVE_MODELS, getLiveModelInfo } from '@andyfooblah/voice-common';
import { GEMINI_LIVE_MODEL } from '../services/geminiBroker';

const ROOT = path.resolve(__dirname, '..', '..');

/** The only file allowed to spell a Live model id. */
const CONSTANT_FILE = 'src/services/geminiBroker.ts';

/** Marker for a comment line that deliberately names a past model. */
const HISTORY_MARKER = 'model-history:';

/**
 * Files that open a Live session, and how. A new Live path must be added here
 * AND built through services/liveConfig.ts AND covered by the live suite.
 */
const KNOWN_LIVE_PATHS: Record<string, string> = {
  'src/services/voicePreview.ts': 'Settings voice audition: ai.live.connect with buildVoicePreviewConnectConfig',
  'src/services/liveProbe.ts': '/diagnostics probe: raw WebSocket with buildLiveSetupMessage',
  'src/services/liveConfig.ts': 'builds the WebSocket URL for the probe',
  // The conversation goes through VoiceCommon's useSession, which holds the
  // only other ai.live.connect call (inside the library, not in this repo).
};

const MODEL_ID = /\bgemini-[a-z0-9][a-z0-9.-]*/g;
const OPENS_LIVE = /\blive\s*\.\s*connect\s*\(|BidiGenerateContent|new\s+WebSocket\s*\(/;

const trimId = (raw: string) => raw.replace(/[.-]+$/, '');
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

/** A Live (realtime, bidirectional audio) model id, known to the registry or not. */
function isLiveModelId(id: string): boolean {
  return getLiveModelInfo(id) !== undefined || /(^|-)live(-|$)|native-audio/.test(id);
}

type Finding = { file: string; line: number; text: string; problem: string };

export function classifyLine(file: string, lineNumber: number, text: string): Finding[] {
  const findings: Finding[] = [];
  for (const match of text.matchAll(MODEL_ID)) {
    const id = trimId(match[0]);
    if (!isLiveModelId(id)) continue;
    const info = getLiveModelInfo(id);
    const stale = info !== undefined && info.status !== 'current';
    if (text.includes(HISTORY_MARKER)) continue;
    if (stale) {
      findings.push({
        file,
        line: lineNumber,
        text: id,
        problem: `${info.status} Live model (replacement: ${info.replacement ?? DEFAULT_LIVE_MODEL})`,
      });
    } else if (file !== CONSTANT_FILE) {
      findings.push({
        file,
        line: lineNumber,
        text: id,
        problem: `Live model id outside ${CONSTANT_FILE}: import GEMINI_LIVE_MODEL instead`,
      });
    }
  }
  if (OPENS_LIVE.test(text) && !(file in KNOWN_LIVE_PATHS) && !isComment(text)) {
    findings.push({
      file,
      line: lineNumber,
      text: text.trim().slice(0, 80),
      problem: 'opens a Live session from a file that is not a known Live path (see KNOWN_LIVE_PATHS)',
    });
  }
  return findings;
}

function* sourceFiles(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '__tests__', '__mocks__', 'dist', 'lib'].includes(entry.name)) continue;
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(entry.name)) {
      yield full;
    }
  }
}

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function scan(tops: string[]): { findings: Finding[]; files: string[] } {
  const findings: Finding[] = [];
  const files: string[] = [];
  for (const top of tops) {
    for (const full of sourceFiles(path.join(ROOT, top))) {
      const file = path.relative(ROOT, full).split(path.sep).join('/');
      files.push(file);
      fs.readFileSync(full, 'utf8')
        .split('\n')
        .forEach((text, i) => findings.push(...classifyLine(file, i + 1, text)));
    }
  }
  return { findings, files };
}

const format = (findings: Finding[]) =>
  findings.map((f) => `${f.file}:${f.line}  ${f.text}  ${f.problem}`).join('\n');

describe('Live model guard: shipping source', () => {
  const { findings, files } = scan(['src', path.join('functions', 'src'), 'scripts']);

  it('names a Live model in one file only, and never a retired one', () => {
    expect(format(findings)).toBe('');
  });

  it('really scanned the client and the server (not vacuously green)', () => {
    expect(files).toContain(CONSTANT_FILE);
    expect(files).toContain('src/hooks/useCarbotSession.ts');
    expect(files).toContain('src/components/diagnostics/DiagnosticsPage.tsx');
    expect(files).toContain('functions/src/liveToken.ts');
    expect(files).toContain('functions/src/invokeGemini.ts');
    expect(files.length).toBeGreaterThan(40);
  });

  it('the constant file spells the id exactly once, as the exported constant', () => {
    const source = read(CONSTANT_FILE);
    const ids = [...source.matchAll(MODEL_ID)].map((m) => trimId(m[0])).filter(isLiveModelId);
    expect(ids).toEqual([GEMINI_LIVE_MODEL]);
    expect(source).toContain(`export const GEMINI_LIVE_MODEL = '${GEMINI_LIVE_MODEL}';`);
  });

  it('every known Live path exists and takes its config from liveConfig.ts', () => {
    for (const file of Object.keys(KNOWN_LIVE_PATHS)) expect(files).toContain(file);
    expect(read('src/services/voicePreview.ts')).toMatch(/config: buildVoicePreviewConnectConfig\(voiceName\)/);
    expect(read('src/services/voicePreview.ts')).toMatch(/model: GEMINI_LIVE_MODEL,/);
    expect(read('src/services/liveProbe.ts')).toMatch(/JSON\.stringify\(buildLiveSetupMessage\(\)\)/);
    expect(read('src/hooks/useCarbotSession.ts')).toMatch(/\.\.\.carbotLiveSessionOptions\(profile\)/);
    expect(read('src/components/diagnostics/DiagnosticsPage.tsx')).toMatch(/await probeLiveSetup\(token\)/);
  });

  it('no path hand-sets a thinking level', () => {
    const offenders: string[] = [];
    for (const file of files.filter((f) => f.startsWith('src/') && f !== 'src/services/liveConfig.ts')) {
      read(file)
        .split('\n')
        .forEach((text, i) => {
          if (isComment(text)) return;
          if (/thinkingLevel\s*:|thinkingConfig\s*:/.test(text)) offenders.push(`${file}:${i + 1}  ${text.trim()}`);
        });
    }
    expect(offenders.join('\n')).toBe('');
  });
});

describe('Live model guard: the model itself', () => {
  it('is current in the registry and is the newest default', () => {
    const info = getLiveModelInfo(GEMINI_LIVE_MODEL);
    expect(info, `${GEMINI_LIVE_MODEL} is not in VoiceCommon's Live model registry`).toBeDefined();
    expect(info!.status).toBe('current');
    // VoiceCommon moves DEFAULT_LIVE_MODEL when a newer Live model is
    // verified. If this fails after a voice-common upgrade, a newer model
    // exists: change GEMINI_LIVE_MODEL, run `npm run test:live`, then ship.
    expect(GEMINI_LIVE_MODEL).toBe(DEFAULT_LIVE_MODEL);
  });
});

describe('Live model guard: client and server cannot drift', () => {
  const serverFiles = [...sourceFiles(path.join(ROOT, 'functions', 'src'))].map((full) =>
    path.relative(ROOT, full).split(path.sep).join('/'),
  );

  it('the server names no Live model anywhere', () => {
    expect(serverFiles.length).toBeGreaterThan(10);
    for (const file of serverFiles) {
      const ids = [...read(file).matchAll(MODEL_ID)].map((m) => trimId(m[0])).filter(isLiveModelId);
      expect(ids, file).toEqual([]);
    }
  });

  it('the ephemeral token is not constrained to a model', () => {
    // An unconstrained token works with whatever GEMINI_LIVE_MODEL is. If a
    // constraint is added (liveConnectConstraints.model), replace this test
    // with one asserting it equals GEMINI_LIVE_MODEL.
    for (const file of serverFiles) {
      const code = read(file)
        .split('\n')
        .filter((line) => !isComment(line))
        .join('\n');
      expect(code, file).not.toMatch(/liveConnectConstraints|lockAdditionalFields/);
    }
  });

  it('the generateContent proxy allow-list holds no Live model', () => {
    const source = read('functions/src/invokeGemini.ts');
    const block = source.slice(source.indexOf('const ALLOWED_MODELS'), source.indexOf(']);', source.indexOf('const ALLOWED_MODELS')));
    expect(block).toContain('FLASH_MODEL');
    expect(block).not.toMatch(/live|native-audio/i);
  });
});

describe('Live model guard: docs', () => {
  it('README, design and deployment docs name only current Live models', () => {
    const stale: string[] = [];
    for (const doc of ['README.md', 'design.md', 'DEPLOYMENT.md', 'CLAUDE.md', 'product_requirements.md', 'e2e/browser-smoke.md']) {
      if (!fs.existsSync(path.join(ROOT, doc))) continue;
      read(doc)
        .split('\n')
        .forEach((text, i) => {
          if (text.includes(HISTORY_MARKER)) return;
          for (const match of text.matchAll(MODEL_ID)) {
            const id = trimId(match[0]);
            if (isLiveModelId(id) && getLiveModelInfo(id)?.status !== 'current') stale.push(`${doc}:${i + 1}  ${id}`);
          }
        });
    }
    expect(stale.join('\n')).toBe('');
  });
});

describe('Live model guard: the scanner catches what it should', () => {
  it('flags a second copy of the current id', () => {
    expect(classifyLine('src/services/voicePreview.ts', 7, "const PREVIEW_MODEL = 'gemini-3.8-live';")).toEqual([
      expect.objectContaining({ line: 7, text: 'gemini-3.8-live', problem: expect.stringMatching(/^Live model id outside/) }),
    ]);
    expect(classifyLine('functions/src/liveToken.ts', 1, "model: 'models/gemini-3.8-live',")).toHaveLength(1);
  });

  it('flags legacy and shut-down ids, even in the constant file and in comments', () => {
    const legacy = Object.values(LIVE_MODELS).filter((m) => m.status !== 'current');
    expect(legacy.length).toBeGreaterThan(0);
    for (const model of legacy) {
      expect(classifyLine(CONSTANT_FILE, 1, `export const GEMINI_LIVE_MODEL = '${model.id}';`)[0].problem).toMatch(
        /^(legacy|shutdown) Live model/,
      );
      expect(classifyLine('src/hooks/useCarbotSession.ts', 1, `// ${model.id} was the old model`)).toHaveLength(1);
    }
  });

  it('flags a Live-shaped id the registry has never heard of', () => {
    expect(classifyLine('src/a.ts', 1, "'gemini-9.9-live-preview'")).toHaveLength(1);
    expect(classifyLine('src/a.ts', 1, "'gemini-2.5-flash-preview-native-audio-dialog'")).toHaveLength(1);
  });

  it('allows the constant, marked history lines and non-Live models', () => {
    expect(classifyLine(CONSTANT_FILE, 1, "export const GEMINI_LIVE_MODEL = 'gemini-3.8-live';")).toEqual([]);
    expect(classifyLine('src/a.ts', 1, '// model-history: replaced gemini-3.1-flash-live-preview in 2026-09')).toEqual([]);
    expect(classifyLine('functions/src/models.ts', 1, "export const FLASH_MODEL = 'gemini-3.8-flash';")).toEqual([]);
    expect(classifyLine('src/a.ts', 1, "'gemini-3.5-flash-lite' 'gemini-embedding-001'")).toEqual([]);
  });

  it('flags a new place that opens a Live session', () => {
    expect(classifyLine('src/components/Foo.tsx', 3, 'const s = await ai.live.connect({ model, config });')).toHaveLength(1);
    expect(classifyLine('src/components/Foo.tsx', 3, 'const ws = new WebSocket(url);')).toHaveLength(1);
    expect(classifyLine('src/services/voicePreview.ts', 3, '    ai.live.connect({')).toEqual([]);
    expect(classifyLine('src/components/Foo.tsx', 3, ' * calls ai.live.connect( in a comment')).toEqual([]);
  });
});
