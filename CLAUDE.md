# CarBot — Claude Code Instructions

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

CarBot uses `@andyfooblah/voicecommon` as a `file:../voicecommon` dependency.
After any changes to VoiceCommon, run `npm run build:lib` in the VoiceCommon
directory, then `npm install` here to pick up the updated dist.

## Architecture notes

### VoiceCommon integration
- Call `initializeVoiceCommon(config)` in `src/index.tsx` before `ReactDOM.createRoot()`
- Import Firebase services (`db`, `auth`, `storage`) from `@andyfooblah/voicecommon`
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
