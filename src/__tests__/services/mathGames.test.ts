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

import { describe, it, expect } from 'vitest';
import {
  generateMathProblem,
  checkMathAnswer,
  generateMathProblemTool,
  checkMathAnswerTool,
  allMathGameTools,
} from '../../services/mathGames';

// Pull the operands + answer back out of generateMathProblem's structured
// return string so the tests can verify invariants without re-parsing in
// production code.
function parseProblem(s: string): { a: number; b: number; op: 'add' | 'subtract'; answer: number } {
  const m = s.match(/a=(\d+), b=(\d+), operation="(add|subtract)"/);
  if (!m) throw new Error(`Could not parse problem: ${s}`);
  const ans = s.match(/Correct answer.*: (-?\d+)\.?$/m);
  if (!ans) throw new Error(`Could not parse answer from: ${s}`);
  return {
    a: Number(m[1]),
    b: Number(m[2]),
    op: m[3] as 'add' | 'subtract',
    answer: Number(ans[1]),
  };
}

describe('generateMathProblem', () => {
  it('returns a valid 2-digit add problem when operation="add"', () => {
    const out = generateMathProblem('add');
    const { a, b, op, answer } = parseProblem(out);
    expect(op).toBe('add');
    expect(a).toBeGreaterThanOrEqual(10);
    expect(a).toBeLessThanOrEqual(99);
    expect(b).toBeGreaterThanOrEqual(10);
    expect(b).toBeLessThanOrEqual(99);
    expect(answer).toBe(a + b);
  });

  it('returns a valid 2-digit subtract problem with non-negative answer', () => {
    // Run several iterations because the operands are randomized — a single
    // happy run could pass a buggy "always returns the same numbers" impl.
    for (let i = 0; i < 50; i++) {
      const out = generateMathProblem('subtract');
      const { a, b, op, answer } = parseProblem(out);
      expect(op).toBe('subtract');
      expect(a).toBeGreaterThanOrEqual(10);
      expect(a).toBeLessThanOrEqual(99);
      expect(b).toBeGreaterThanOrEqual(10);
      expect(b).toBeLessThanOrEqual(99);
      // The hard invariant: subtraction never produces a negative result.
      expect(b).toBeLessThanOrEqual(a);
      expect(answer).toBe(a - b);
      expect(answer).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns either operation when called with no argument or 'mix'", () => {
    const ops = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const out = generateMathProblem();
      ops.add(parseProblem(out).op);
      const out2 = generateMathProblem('mix');
      ops.add(parseProblem(out2).op);
    }
    // Both ops should appear in 200 random draws — failing this means the
    // RNG branching is broken.
    expect(ops).toContain('add');
    expect(ops).toContain('subtract');
  });

  it("warns the bot not to speak the correct answer aloud", () => {
    const out = generateMathProblem('add');
    expect(out).toMatch(/do NOT say this aloud/i);
  });
});

describe('checkMathAnswer', () => {
  it('returns "Correct!" when the user matches the right answer (add)', () => {
    expect(checkMathAnswer({ a: 47, b: 38, operation: 'add', userAnswer: 85 }))
      .toMatch(/Correct/);
  });

  it('returns "Correct!" for subtract too', () => {
    expect(checkMathAnswer({ a: 70, b: 23, operation: 'subtract', userAnswer: 47 }))
      .toMatch(/Correct/);
  });

  it('flags an off-by-some-amount wrong answer with the gap', () => {
    const out = checkMathAnswer({ a: 47, b: 38, operation: 'add', userAnswer: 80 });
    expect(out).toMatch(/Incorrect/);
    expect(out).toContain('85'); // correct
    expect(out).toContain('80'); // user said
    expect(out).toMatch(/5 too low/);
  });

  it('flags a too-high wrong answer with the gap', () => {
    const out = checkMathAnswer({ a: 47, b: 38, operation: 'add', userAnswer: 90 });
    expect(out).toMatch(/Incorrect/);
    expect(out).toMatch(/5 too high/);
  });

  it('rejects a non-finite user answer', () => {
    expect(checkMathAnswer({ a: 47, b: 38, operation: 'add', userAnswer: NaN }))
      .toMatch(/Invalid/);
  });

  it('rejects an unknown operation', () => {
    expect(checkMathAnswer({ a: 47, b: 38, operation: 'multiply', userAnswer: 85 }))
      .toMatch(/Invalid operation/);
  });
});

describe('tool declarations', () => {
  it('exposes both tools via allMathGameTools', () => {
    const names = allMathGameTools.map((t) => t.name);
    expect(names).toEqual(['generateMathProblem', 'checkMathAnswer']);
  });

  it('generateMathProblem accepts an optional operation argument', () => {
    const props = generateMathProblemTool.parameters?.properties ?? {};
    expect(Object.keys(props)).toContain('operation');
    // operation should NOT be required (default is mix)
    expect(generateMathProblemTool.parameters?.required ?? []).not.toContain('operation');
  });

  it('checkMathAnswer requires all four fields', () => {
    const required = checkMathAnswerTool.parameters?.required ?? [];
    expect(required).toEqual(expect.arrayContaining(['a', 'b', 'operation', 'userAnswer']));
  });
});
