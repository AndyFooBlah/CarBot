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
 * Math-game tools.
 *
 * Two stateless tools that let the bot drill the user with simple
 * 2-digit addition / subtraction:
 *
 *   - `generateMathProblem` returns a fresh problem and (privately) the
 *     correct answer. The bot reads back the question to the user, but
 *     the description explicitly forbids speaking the answer aloud.
 *   - `checkMathAnswer` re-computes the correct answer from the operands
 *     the bot supplies and compares it against what the user said. The
 *     bot doesn't have to do any arithmetic itself — the tool is the
 *     ground truth — so it can't accidentally tell a kid they were right
 *     when they weren't.
 *
 * Subtraction problems are constrained so a − b is never negative; both
 * operands are always two digits (10–99).
 */

import { FunctionDeclaration, Type } from '@google/genai';

const MIN_TWO_DIGIT = 10;
const MAX_TWO_DIGIT = 99;

type Operation = 'add' | 'subtract';

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function symbolFor(op: Operation): string {
  return op === 'add' ? '+' : '-';
}

// ---------------------------------------------------------------------------
// generateMathProblem

export const generateMathProblemTool: FunctionDeclaration = {
  name: 'generateMathProblem',
  description:
    'Generate a 2-digit addition or subtraction problem to quiz the user with. ' +
    'Both operands are 10–99; subtraction is constrained so the answer is never negative. ' +
    "After calling this, ask the user the question conversationally — but do NOT speak the correct answer aloud. " +
    'When the user gives their answer, call checkMathAnswer with the operands from this result and the user-supplied number to verify.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      operation: {
        type: Type.STRING,
        description:
          "Which operation: 'add', 'subtract', or 'mix' (default — randomly pick one).",
      },
    },
  },
};

export function generateMathProblem(operation?: string): string {
  const op: Operation =
    operation === 'add'
      ? 'add'
      : operation === 'subtract'
        ? 'subtract'
        : Math.random() < 0.5
          ? 'add'
          : 'subtract';

  let a: number;
  let b: number;
  let answer: number;
  if (op === 'add') {
    a = randInt(MIN_TWO_DIGIT, MAX_TWO_DIGIT);
    b = randInt(MIN_TWO_DIGIT, MAX_TWO_DIGIT);
    answer = a + b;
  } else {
    // Subtract: pick a first, then b ≤ a so the answer is non-negative.
    a = randInt(MIN_TWO_DIGIT + 1, MAX_TWO_DIGIT);
    b = randInt(MIN_TWO_DIGIT, a);
    answer = a - b;
  }

  // The bot uses this string to (a) ask the question and (b) remember the
  // operands so it can call checkMathAnswer on the user's reply. The
  // "Correct answer" line is private to the bot — the description above
  // tells it not to speak it.
  return [
    `Problem: ${a} ${symbolFor(op)} ${b} = ?`,
    `Operands for checkMathAnswer: a=${a}, b=${b}, operation="${op}".`,
    `Correct answer (do NOT say this aloud — only use it via checkMathAnswer): ${answer}.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// checkMathAnswer

export const checkMathAnswerTool: FunctionDeclaration = {
  name: 'checkMathAnswer',
  description:
    "Check whether the user's answer to a math problem is correct. " +
    'Pass the same a, b, and operation values from the original generateMathProblem call, ' +
    'plus the number the user spoke as their answer. The tool returns whether the user was correct, ' +
    'the actual correct answer, and how far off they were if not.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      a: {
        type: Type.NUMBER,
        description: 'First operand (the value from generateMathProblem).',
      },
      b: {
        type: Type.NUMBER,
        description: 'Second operand (the value from generateMathProblem).',
      },
      operation: {
        type: Type.STRING,
        description: "'add' or 'subtract' (the value from generateMathProblem).",
      },
      userAnswer: {
        type: Type.NUMBER,
        description: 'The number the user said as their answer.',
      },
    },
    required: ['a', 'b', 'operation', 'userAnswer'],
  },
};

export interface CheckMathAnswerArgs {
  a: number;
  b: number;
  operation: string;
  userAnswer: number;
}

export function checkMathAnswer(args: CheckMathAnswerArgs): string {
  const { a, b, operation, userAnswer } = args;
  if (
    typeof a !== 'number' ||
    typeof b !== 'number' ||
    typeof userAnswer !== 'number' ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(userAnswer)
  ) {
    return 'Invalid arguments — a, b, and userAnswer must all be finite numbers.';
  }
  if (operation !== 'add' && operation !== 'subtract') {
    return `Invalid operation "${operation}" — must be 'add' or 'subtract'.`;
  }

  const op = operation as Operation;
  const correct = op === 'add' ? a + b : a - b;
  const sym = symbolFor(op);

  if (userAnswer === correct) {
    return (
      `Correct! ${a} ${sym} ${b} = ${correct}. ` +
      'Celebrate briefly with the user (one short sentence) and offer another problem if they want to keep going.'
    );
  }

  const gap = userAnswer - correct;
  const direction = gap > 0 ? `${gap} too high` : `${-gap} too low`;
  return (
    `Incorrect. ${a} ${sym} ${b} = ${correct} (the user said ${userAnswer}, ${direction}). ` +
    'Be encouraging — tell them the correct answer in a friendly way and offer another problem if they want to try again.'
  );
}

// ---------------------------------------------------------------------------
// Convenience array for spreading into the session tools list.

export const allMathGameTools: FunctionDeclaration[] = [
  generateMathProblemTool,
  checkMathAnswerTool,
];
