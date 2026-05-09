# CarBot — Claude Code Instructions

## 🔑 Sensitive API keys — read first

`GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY` are **server-side only**. They live in Firebase Secret Manager and are accessed only by Cloud Functions. They must NEVER appear in:

- A `VITE_*` env var (Vite bakes the entire `import.meta.env` object into the bundle, so even an unreferenced `.env.local` entry leaks)
- Any file under `src/` — directly, in fallbacks, in comments-as-examples, or in test fixtures that touch real values
- Any committed file (including `.env.example`, `dist/`, docs)

The browser reaches Gemini exclusively via the broker callables in `src/services/geminiBroker.ts`:

| Need | Use |
|---|---|
| Gemini Live WebSocket session (sessions, voice preview, diagnostics) | `mintGeminiLiveToken()` → ephemeral token (~30 min, single-use) |
| `ai.models.generateContent` (e.g. schedule parsing in `SettingsPage`) | `invokeGemini({ model, contents, config? })` |
| `ai.models.embedContent` (used inside KnowledgeCommon's Wikipedia RAG) | `embedGemini({ model, contents })` |

CarBot wires `{ invokeGemini, embedContent: embedGemini }` into `initializeKnowledgeCommon` so the library never holds a key either.

**Two automated guards stop accidental regressions:**

1. **ESLint** (`eslint.config.js`) — `no-restricted-syntax` errors on any read of `import.meta.env.VITE_GEMINI_*`, `VITE_GOOGLE_MAPS_*`, or `VITE_*_(SECRET|TOKEN)`. Each rule fires with a message naming the broker callable to use instead.
2. **Post-build bundle scan** (`scripts/check-bundle-for-secrets.mjs`, run as part of `npm run build`) — greps `dist/` for `AIza...`, `sk-...`, `ya29...`, `xox*-...`, `gh*_...`, GCP service-account JSON shapes. The Firebase web `apiKey` is auto-allowlisted from `.env.local`. Anything else fails the build.

If either guard fires, **fix the leak**; do not weaken the rule.

To rotate the server-side Gemini key: `firebase functions:secrets:set GEMINI_API_KEY`, then redeploy functions.

## After any material change

Before considering a task complete, ensure all of the following are done:

1. **Tests** — verify tests exist for the changed behavior and all tests pass:
   ```bash
   npm test -- --run
   ```
2. **Type check**:
   ```bash
   npx tsc --noEmit
   ```
3. **Docs** — update `design.md` if architecture, data model, or data flow changed
4. **Issues** — close the relevant GitHub issue (`gh issue close N`)
5. **Commit** — commit all changed files with a descriptive message
6. **Push** — push to `origin/main`

## Dev commands

```bash
npm install                    # install dependencies
npm run dev                    # start dev server (port 3004)
npm test -- --run              # run all tests once
npm run test:watch             # watch mode
npx tsc --noEmit               # type-check only
npx eslint src --ext .ts,.tsx  # lint

# Firebase
firebase deploy --only functions
firebase deploy --only firestore:rules,storage
firebase emulator:start        # start local emulators
```

## VoiceCommon dependency

CarBot uses `@andyfooblah/voice-common` as a `file:../VoiceCommon` dependency.
After any changes to VoiceCommon, run `npm run build:lib` in the VoiceCommon
directory, then `npm install` here to pick up the updated dist.

## Architecture notes

### VoiceCommon integration
- Call `initializeVoiceCommon(config)` in `src/index.tsx` before `ReactDOM.createRoot()`
- Import Firebase services (`db`, `auth`, `storage`) from `@andyfooblah/voice-common`
- Use `useSession` from VoiceCommon; wrap it in `useCarbotSession` for CarBot-specific behavior
- The CarBot system instruction is assembled by `src/services/instructionBuilder.ts`

### Session data model
VoiceCommon manages the base session document at `sessions/{sessionId}`.
CarBot extends it with `tripContext`, `contextDocIds`, and `summary` fields,
written immediately after session creation via a Firestore update.

Transcript storage:
- Real-time (during session): `sessions/{sessionId}/transcript/entries` — VoiceCommon default path
- Clean transcript (post-session): `sessions/{sessionId}/transcript/clean` — Cloud Function written
- Edit history: `sessions/{sessionId}/transcript/edits/{editId}` — versioned edits

### Security
All collections require `userId` field matching `request.auth.uid`.
Security is enforced at Firestore rules level, not just application level.
Cloud Functions run with admin SDK and bypass rules — they must check userId explicitly.

### License headers
All source files carry an Apache 2.0 header (Copyright 2026 Andrew Brook).
