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
 * Gemini `safetySettings` for a child-facing product (#33).
 *
 * Strictest blocking on all four adjustable harm categories. The shape is
 * identical for the REST `generateContent` body and the @google/genai SDK.
 * Mirrors `KID_SAFETY_SETTINGS` in src/services/promptSafety.ts.
 *
 * Applied to: `invokeGemini` (server-enforced — the client cannot loosen
 * it) and the parent-facing session summary email. Deliberately NOT applied
 * to cleanTranscript / memoryExtraction: those are faithful transformations
 * of the family's own recorded speech, and a block there would silently
 * drop the record rather than protect anyone.
 */
export const KID_SAFETY_SETTINGS: ReadonlyArray<{ category: string; threshold: string }> = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
];
