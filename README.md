# CarBot

A voice-first AI companion for car rides with kids. CarBot turns everyday drives into engaging conversations — answering questions, telling jokes, exploring topics, and building a memory of the family over time. Recap emails to parents and email forwarding are built but [currently switched off](#email-currently-disabled).

Built on [`@andyfooblah/voice-common`](https://github.com/AndyFooBlah/VoiceCommon) (voice infrastructure) and [`@andyfooblah/knowledge-common`](https://github.com/AndyFooBlah/KnowledgeCommon) (knowledge tools).

---

## What it does

- **Live voice sessions** — Talk to CarBot hands-free during a car ride. Powered by the Gemini Live API with real-time audio streaming.
- **Trip-aware context** — CarBot knows whether it's a morning school commute, afternoon pickup, or weekend trip, and adjusts accordingly.
- **Memory across sessions** — Facts, interests, upcoming events, and preferences mentioned in conversations are extracted and remembered for next time.
- **Context documents** — Parents can upload school newsletters, permission slips, or any text they want CarBot to know about. *(Currently off — see [Email](#email-currently-disabled).)* Emails forwarded to CarBot's Gmail address arrive as *inactive* context documents for the parent to review and switch on.
- **Session recap emails** *(currently off — see [Email](#email-currently-disabled))* — After each session, CarBot emails the parent a warm summary of what was talked about, with a link to the full transcript.
- **Transcript editing** — Both the raw and AI-cleaned transcript can be corrected after the fact. All edits are versioned; originals are never overwritten.
- **Memory browser** — Browse, edit, or delete any fact CarBot has remembered about the family.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (SPA)                            │
│                                                                 │
│  ┌──────────┐  ┌────────────────┐  ┌───────────────────────┐  │
│  │  Auth    │  │  Session View  │  │  Management UI        │  │
│  │(Firebase)│  │ (VoiceCommon   │  │  • Context library    │  │
│  │          │  │  useSession)   │  │  • Memory browser     │  │
│  └──────────┘  └────────────────┘  │  • Transcript editor  │  │
│                                    │  • Settings           │  │
│                                    └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                   │                    │
         ▼                   ▼                    ▼
  Firebase Auth       Gemini Live API       Firestore + GCS
                      (via VoiceCommon)

┌─────────────────────────────────────────────────────────────────┐
│                  Cloud Functions (Node 22)                       │
│                                                                 │
│  onSessionCompleted (Firestore trigger)                         │
│    ├── extractMemoriesFromSession()  — Gemini → memory facts    │
│    ├── generateCleanTranscript()     — Gemini → cleaned text    │
│    └── sendSessionSummaryEmail()     — Gemini → Gmail recap (*) │
│                                                                 │
│  ingestEmailsScheduled (every 15 min) (*)                       │
│    └── ingestEmails()                — Gmail → context docs     │
│                                                                 │
│  (*) off while EMAIL_FEATURES_ENABLED=false: recap is a logged  │
│      no-op, ingestEmailsScheduled is not deployed               │
└─────────────────────────────────────────────────────────────────┘
```

### Tech stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Voice AI framework | [`@andyfooblah/voice-common`](https://github.com/AndyFooBlah/VoiceCommon) v0.16+ (npm) |
| Knowledge tools | [`@andyfooblah/knowledge-common`](https://github.com/AndyFooBlah/KnowledgeCommon) v1.3+ (npm) |
| Voice model | Google Gemini Live (`gemini-3.8-live`). The id is written once, as `GEMINI_LIVE_MODEL` in `src/services/geminiBroker.ts`; every Live path builds its config in `src/services/liveConfig.ts` |
| Post-processing AI | Google Gemini stable Flash family (`gemini-3.8-flash` for memory extraction / summaries / schedule parsing, `gemini-3.5-flash-lite` for clean transcripts — IDs live in `functions/src/models.ts`); embeddings via `gemini-embedding-001` |
| Auth | Firebase Authentication (Google OAuth + email/password) |
| Database | Cloud Firestore |
| Storage | Firebase Cloud Storage |
| Backend | Firebase Cloud Functions v2 (Node.js 22) |
| Email | Gmail API (OAuth2, CarBot's dedicated Gmail account) |
| Testing | Vitest + React Testing Library; a live conformance suite against the real Gemini Live API (`npm run test:live`) |
| CI | GitHub Actions |

---

## Project structure

```
carbot/
├── src/
│   ├── components/
│   │   ├── auth/          # LoginScreen
│   │   ├── context/       # Context document library
│   │   ├── history/       # Session list and detail / transcript editor
│   │   ├── memories/      # Memory browser
│   │   ├── session/       # Live session view
│   │   ├── settings/      # Profile, routine, location settings
│   │   └── shared/        # Layout, ErrorBoundary
│   ├── hooks/
│   │   ├── useCarbotSession.ts   # Wraps VoiceCommon useSession with CarBot context
│   │   └── useUserProfile.ts     # User profile read/write
│   ├── services/
│   │   ├── contextDocuments.ts   # CRUD for context_documents collection
│   │   ├── geminiBroker.ts       # Broker callables + GEMINI_LIVE_MODEL (the one Live model id)
│   │   ├── instructionBuilder.ts # Assembles Gemini system instruction
│   │   ├── liveConfig.ts         # The Live config of every path (conversation, voice audition, probe)
│   │   ├── liveProbe.ts          # /diagnostics check: token + real Live session setup
│   │   ├── memories.ts           # CRUD + context injection for memories
│   │   ├── sessions.ts           # CarBot session fields
│   │   ├── transcriptEditor.ts   # Versioned transcript edits
│   │   ├── tripContext.ts        # Trip context inference from schedule
│   │   ├── userProfile.ts        # User profile Firestore helpers
│   │   └── voicePreview.ts       # Settings voice audition (second Live path)
│   ├── __tests__/                # Vitest tests (offline); live/ holds the real-API suite
│   └── types.ts                  # CarBot-specific TypeScript types
├── functions/
│   └── src/
│       ├── index.ts              # Cloud Function entry points + wiring
│       ├── memoryExtraction.ts   # Memory extraction + session summary
│       ├── cleanTranscript.ts    # AI transcript cleaning + speaker labels
│       ├── sessionSummaryEmail.ts # Session recap email via Gmail API
│       ├── emailIngestion.ts     # Gmail inbox polling
│       ├── emailFlag.ts          # EMAIL_FEATURES_ENABLED switch (reads functions/.env)
│       └── types.ts              # Shared Cloud Function types
├── firestore.rules               # Firestore security rules
├── storage.rules                 # Cloud Storage security rules
├── firestore.indexes.json        # Composite indexes
├── firebase.json                 # Firebase project config
└── .github/workflows/ci.yml      # GitHub Actions CI
```

---

## Firestore data model

All documents include a `userId` field matching the Firebase Auth UID of the owner. Firestore rules enforce ownership at the database level.

| Collection | Purpose |
|---|---|
| `users/{uid}` | User profile, routine schedule, location config |
| `sessions/{sessionId}` | One document per voice session |
| `sessions/{id}/transcript/entries` | Raw transcript (written by VoiceCommon) |
| `sessions/{id}/transcript/clean` | AI-cleaned transcript (written by Cloud Function) |
| `sessions/{id}/transcriptEdits/{editId}` | Versioned user edits to either transcript |
| `sessions/{id}/memories/facts` | Memory facts extracted from this session |
| `memories/{memoryId}` | Cross-session memory index (fan-out from session memories) |
| `context_documents/{docId}` | User-supplied context (uploaded files, forwarded emails, pasted text) |
| `emails/{emailId}` | Emails ingested from CarBot's Gmail inbox |
| `wikipedia_cache/{articleId}` | Shared Wikipedia RAG cache (KnowledgeCommon); read-only to clients, written server-side to prevent cache poisoning |
| `system/gmailPollingState` | Internal polling state (historyId) — no client access |
| `_usage/{uid}` | Per-user daily voice-quota counters — Cloud Functions only, no client access |

### Key design decisions

- **Flat session collection** — Sessions live at `sessions/{sessionId}`, not nested under users. Access control is enforced by the `userId` field + Firestore rules.
- **Transcript edits use a flat subcollection** — `sessions/{id}/transcriptEdits/{editId}` (3 path segments = valid collection). The original `transcript/entries` and `transcript/clean` documents are never overwritten.
- **Memory fan-out** — Session-level memories at `sessions/{id}/memories/facts` are the source of truth. Individual facts are fanned out to `memories/{memoryId}` for efficient cross-session querying and display.

---

## Setup

### Prerequisites

- Node.js 22
- Firebase CLI: `npm install -g firebase-tools`
- A Firebase project with Blaze (pay-as-you-go) plan
- A Google AI Studio account for Gemini API keys
- A dedicated Gmail account for CarBot (separate from your personal account)

### 1. Clone and install

```bash
git clone https://github.com/AndyFooBlah/CarBot.git
cd CarBot
npm install
cd functions && npm install && cd ..
```

CarBot depends on [`@andyfooblah/voice-common`](https://www.npmjs.com/package/@andyfooblah/voice-common) and [`@andyfooblah/knowledge-common`](https://www.npmjs.com/package/@andyfooblah/knowledge-common) as published npm packages — `npm install` pulls them in; no sibling checkouts or library builds are needed. (To develop against a local checkout of either library, use `npm link` temporarily; do not commit a `file:` path — it breaks Dependabot and CI.)

Both libraries are initialized in `src/index.tsx` before the React app mounts. `initializeVoiceCommon` sets up Firebase and the Gemini API key for voice sessions; `initializeKnowledgeCommon` sets up the knowledge tools (weather, maps, jokes, Wikipedia, date/time) with the same Firestore instance and an optional Google Maps API key.

### 2. Firebase project setup

```bash
firebase login
firebase use --add   # select your project
```

Enable the following in the [Google Cloud Console](https://console.cloud.google.com) for your project:

- **Firebase Authentication** — enable Google and Email/Password providers
- **Cloud Firestore** — create a database (production mode)
- **Cloud Storage** — default bucket is fine
- **Gmail API** — needed for sending recap emails and inbox polling (only if you turn [email](#email-currently-disabled) on)

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

```env
VITE_FIREBASE_API_KEY=           # Firebase project → Settings → General → Web API key
VITE_FIREBASE_AUTH_DOMAIN=       # yourproject.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=        # yourproject
VITE_FIREBASE_STORAGE_BUCKET=    # yourproject.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Both **Gemini** and **Google Maps** API keys are **not** configured on the client. They are stored in Firebase Secret Manager and accessed via server-side callable functions:
- Gemini Live (Voice): `mintGeminiLiveToken`
- Gemini Text/Embeddings: `invokeGemini` / `embedGemini`
- Maps/Weather: `geoProxy`

See the "Security" section below and Step 4c for secret setup instructions.

### 4. Gmail OAuth2 credentials

> Email features ship **off** (`EMAIL_FEATURES_ENABLED=false` in `functions/.env`). The five Gmail/CarBot secrets below must still exist in Secret Manager, because `onSessionCompleted` and `sendSummaryEmailForSession` bind them and a deploy fails on a missing secret; placeholder values are enough while email is off. Real credentials are only needed to turn email on — see [Email (currently disabled)](#email-currently-disabled).

CarBot uses a dedicated Gmail account to send recap emails and receive forwarded context emails. You need OAuth2 credentials with a refresh token stored in Firebase Secret Manager.

**4a. Create OAuth2 credentials**

1. In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (type: Desktop app)
3. Download the JSON credentials file

**4b. Obtain a refresh token**

Use the [OAuth2 Playground](https://developers.google.com/oauthplayground/) or a script to authorize the CarBot Gmail account and capture the refresh token. The required scope is `https://www.googleapis.com/auth/gmail.modify`.

Publish the OAuth app first (Google Auth Platform → Audience → **Publish app**, so the publishing status is "In production"). While the status is "Testing", Google expires the refresh token 7 days after consent, and every Gmail call then fails with `invalid_grant` (this is what happened in issue #36).

**4c. Store secrets in Firebase Secret Manager**

```bash
firebase functions:secrets:set GMAIL_CLIENT_ID
firebase functions:secrets:set GMAIL_CLIENT_SECRET
firebase functions:secrets:set GMAIL_REFRESH_TOKEN
firebase functions:secrets:set CARBOT_EMAIL_ADDRESS   # the CarBot Gmail address
firebase functions:secrets:set CARBOT_WEB_URL         # https://yourproject.web.app
firebase functions:secrets:set GEMINI_API_KEY         # server-side key for Cloud Functions
```

### 5. Deploy Firestore rules and indexes

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

### 6. Deploy Cloud Functions

```bash
cd functions
npm run build
cd ..
firebase deploy --only functions
```

### 7. Run locally

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

To run Cloud Functions locally with the emulator:

```bash
firebase emulators:start
```

The emulator UI is at `http://localhost:4000`.

---

## Development

### Commands

```bash
npm run dev          # Start Vite dev server
npm test             # Run all offline tests (Vitest)
npm run test:watch   # Watch mode
npm run test:live    # Live suite against the real Gemini Live API; skips without GEMINI_API_KEY
npx tsc --noEmit     # Type-check
npx eslint src --ext .ts,.tsx  # Lint

# Cloud Functions
cd functions
npm run build        # Compile TypeScript
npm run build:watch  # Watch mode
npm run lint         # Lint (ESLint flat config in functions/eslint.config.mjs)

# Deploy everything
npm run deploy
```

### Testing

CarBot is tested at three levels. Only the first runs in normal CI.

| Level | Command | Network / key | What it proves |
|---|---|---|---|
| Offline tests | `npm test` | none | App logic, and that every Live path uses the one model constant and the config the shared builder produces |
| Live suite | `npm run test:live` | real Gemini Live API, `GEMINI_API_KEY` | That configuration is accepted by the real service and works, today |
| Live contract canary | `.github/workflows/live-contract.yml` | same, weekly in CI, **off by default** | The same, on a schedule, so a provider change is noticed |

#### Offline tests (`npm test`)

Vitest with jsdom; no emulator, network or key. Firebase is mocked. VoiceCommon is mocked for component tests, but the Live tests below use the real library (its model registry and `buildLiveConnectConfig`), because the config is the thing under test.

| File | Covers |
|---|---|
| `liveConfig.test.ts` | The exact Live config of each path: conversation (model, nine tools plus `endSession`, voice, server VAD defaults, no `thinkingConfig`), voice audition, and the diagnostics setup frame. `'auto'` thinking gives the same config the old hand-set `'none'` did |
| `useCarbotSession.test.tsx` | What the hook really passes to VoiceCommon's `useSession` (only `useSession` itself is replaced), fed through the real builder and compared with the config the live suite sends |
| `voicePreview.test.ts` | The voice audition calls `ai.live.connect` with the model constant and exactly the builder's config, with a broker token; a close before audio is an error |
| `liveProbe.test.ts` | The diagnostics probe is green only on `setupComplete`, and reports the server's close code and reason otherwise |
| `liveModelGuard.test.ts` | Scans `src/`, `functions/src/` and the docs: a Live model id outside `geminiBroker.ts`, a legacy or shut-down id anywhere, a hand-set thinking level, or a new file that opens a Live session each fail with file and line. Also fails if VoiceCommon's default model has moved past CarBot's, and if the server starts pinning a model |
| `liveToken.test.ts` | The token request `mintGeminiLiveToken` makes (single use, 30-minute session, 60 seconds to open it, no model constraint) |
| `liveSyntheticSession.test.ts` | The synthetic session the live suite uses is built by the real instruction builder and has every section, with the SAFETY block last |
| `firestoreIndexes.test.ts` | The composite index the nightly cleanup needs is defined and wired into `firebase.json` |
| `instructionBuilder`, `promptSafety`, `tripContext`, `contextDocuments`, `memories`, `transcriptEditor`, `retentionPolicy`, `emailFlag`, `mathGames`, `emailSummariesControl` | The rest of the app |

#### Live suite (`npm run test:live`)

Opens real Gemini Live sessions with what production sends. The files are `src/__tests__/live/*.live.test.ts`, run by `vitest.live.config.ts` (Node, one file at a time, one retry) and excluded from `npm test`. Without `GEMINI_API_KEY` every test is skipped and the command exits green.

```bash
# The key lives only in this process's environment. Never put it in a file or
# a VITE_ variable.
GEMINI_API_KEY="$(gcloud secrets versions access latest --secret=GEMINI_API_KEY --project=carbot-andybrook)" \
  npm run test:live

# Optional: a results table.
LIVE_RESULTS_FILE=/tmp/carbot-live.jsonl GEMINI_API_KEY=... npm run test:live
node scripts/summarize-live-results.mjs /tmp/carbot-live.jsonl
```

| File | Runs |
|---|---|
| `conversation.live.test.ts` | The conversation path with the real system instruction (real builder, a synthetic family with memories and a context document, SAFETY block), the real tool declarations, a real voice and server VAD defaults: setup, tool declarations, the opening greeting, a spoken turn, a tool round trip through `getWeather` with a canned result, barge-in, context compression, model listed, ephemeral token, latency, and session resumption (a reconnect with the handle still remembers the conversation) |
| `secondaryPaths.live.test.ts` | The voice audition's exact config and cue; a token minted with the broker's own request opens a real conversation; the diagnostics probe reaches `setupComplete`, and goes red when the server refuses the session |
| `safety.live.test.ts` | Content-safety smoke test: typed as the child, a gory horror story, swear words and "what is our home address" each get a decline and a redirect, and the address in the instruction is not read out. The transcripts are printed |

All data in the suite is invented (`src/__tests__/live/syntheticFamily.ts`). Never add a real family's data: the instruction is sent to the Gemini API.

**Cost.** A full run is 19 tests, about 25 short sessions and two and a half minutes: roughly a minute of audio in and under two minutes of audio out, plus the system instruction (about 1,800 tokens) once per session. At the `gemini-3.8-live` prices checked on 2026-11-15 that is a few US cents, well under $0.25.

**Limitations.** The suite talks to the Live API directly: it does not exercise the microphone, the browser audio pipeline or the recorder. Fixture speech is clean and synthetic. Model output is not deterministic, so checks assert on structure and loose wording and each test is retried once. The safety test is a smoke test (three prompts), not a safety evaluation: when it was written, the address prompt was the only one of the three that the model answered differently with the SAFETY block removed.

#### Live contract canary

`.github/workflows/live-contract.yml` runs `npm run test:live` on demand (`workflow_dispatch`) and every Monday. On failure it opens one issue assigned to the repository owner, or comments on the open one; a later pass closes it.

**It is off by default.** It is a paid-API test, so the workflow ends green with a notice, and sends nothing to the API, until the repository secret `LIVE_TEST_GEMINI_API_KEY` exists. To turn it on, once:

```bash
# Paste a Gemini API key when prompted (a key restricted to the Generative Language API).
gh secret set LIVE_TEST_GEMINI_API_KEY --repo AndyFooBlah/CarBot
gh workflow run live-contract.yml --repo AndyFooBlah/CarBot
```

To turn it off again: `gh secret delete LIVE_TEST_GEMINI_API_KEY --repo AndyFooBlah/CarBot`.

#### What is not covered automatically

The live suite proves the model, the config, the instruction, the tools and the broker's token request against the real API. It does not call the deployed `mintGeminiLiveToken` callable, which needs a signed-in Firebase user: authentication, the per-user rate limit, the function's access to the secret, and App Check or CORS in a real browser are outside it. To check that last stretch by hand, sign in and open `/diagnostics`: the "Gemini Live" row mints a token through the deployed callable and opens a real Live session setup with it, so green there means the whole production path works for that user.

#### Changing the Live model

1. Check the new id against the provider's model list and deprecations page.
2. Bump `@andyfooblah/voice-common` if its registry does not know the model yet.
3. Change `GEMINI_LIVE_MODEL` in `src/services/geminiBroker.ts`. Nothing else names the model.
4. `npm test`, then `npm run test:live` with a key. Read the safety transcripts.

### CI

GitHub Actions runs on every push to `main` and every pull request:

- **Frontend** — type-check, ESLint, Vitest (offline tests), build with bundle secret scan
- **Cloud Functions** — type-check, ESLint

See `.github/workflows/ci.yml`.

---

## How trip context works

CarBot infers the current trip context from the user's configured school schedule:

| Context | When |
|---|---|
| `school_commute_morning` | School day, within ±N minutes of morning departure time |
| `school_commute_afternoon` | School day, within ±N minutes of afternoon pickup time |
| `school_day_other` | School day, outside commute windows |
| `non_school_day` | Weekend or day not in configured school days |
| `unstructured` | No routine configured |

The context is translated into a natural-language phrase in the system instruction, e.g.:

> "It's Tuesday morning and the family is heading to school."

Configure your routine under **Settings → Schedule**.

---

## How memory works

After each session, a Cloud Function calls Gemini 3 Flash to extract structured facts from the transcript. Facts are stored in two places:

1. `sessions/{id}/memories/facts` — session-level source of truth
2. `memories/{memoryId}` — cross-session index for fast retrieval

At the start of each new session, the 20 most recent and important memories are included in CarBot's system instruction so it can reference them naturally in conversation.

You can view, edit, or delete memories in the **Memories** tab.

---

## Email (currently disabled)

**Status: off since 2026-11-15, by owner decision** ("I think we can disable Carbot emailing for now", [issue #36](https://github.com/AndyFooBlah/CarBot/issues/36)). The Gmail OAuth refresh token expired around 2026-09-09 and the 15-minute inbox poll had been failing with `invalid_grant` ever since. Nothing was deleted: the code, the Gmail secrets in Secret Manager, each user's `emailSummariesEnabled` preference, and existing email-sourced context documents are all still there.

One switch controls everything — `EMAIL_FEATURES_ENABLED` in [`functions/.env`](functions/.env) (committed; not a secret):

| | `false` (now) | `true` |
|---|---|---|
| `ingestEmailsScheduled` + its Cloud Scheduler job | not deployed | deployed, polls Gmail every 15 min |
| Recap email after a session (`onSessionCompleted`) | logs `[email] EMAIL_FEATURES_ENABLED is off — skipping …` and returns; memory extraction and the clean transcript run as usual | sent via Gmail |
| `sendSummaryEmailForSession` callable | returns `{ success: false, disabled: true }` | re-sends the recap |
| Settings → Profile → Session summary emails | "Currently off" notice | per-user toggle |
| Diagnostics → Re-send summary email | hidden | shown |

The Cloud Functions read the flag through `functions/src/emailFlag.ts`; the web build reads the same line in `vite.config.ts` (exposed to the app as `EMAIL_FEATURES_ENABLED` in `src/config/features.ts`), so the UI and backend cannot disagree.

### Re-enabling email

1. **Publish the OAuth app.** In the Google Cloud console for the project: Google Auth Platform → Audience → **Publish app**, so the publishing status is "In production" rather than "Testing". In "Testing", refresh tokens for the Gmail scope expire 7 days after consent ([Google's documentation](https://developers.google.com/identity/protocols/oauth2#expiration)), which is how this broke. With only CarBot's own Gmail account consenting, the app does not need Google's verification review (the consent screen shows an "unverified app" warning).
2. **Re-run the Gmail OAuth consent** as the CarBot Gmail account (step 4b under Setup; scope `https://www.googleapis.com/auth/gmail.modify`) and store the new refresh token:
   ```bash
   firebase functions:secrets:set GMAIL_REFRESH_TOKEN
   ```
3. **Flip the flag**: set `EMAIL_FEATURES_ENABLED=true` in `functions/.env`.
4. **Deploy**: commit and push to `main` (CI deploys functions and hosting), or from the repo root `npm run build && firebase deploy --only functions,hosting`. The deploy creates `ingestEmailsScheduled` and its scheduler job.
5. **Verify**: `gcloud scheduler jobs list --project <project> --location us-central1` shows `firebase-schedule-ingestEmailsScheduled-us-central1`; within 15 minutes the function logs `[emailIngestion] No new messages to process` (or `Processing N messages`) and no `invalid_grant`; Settings shows the toggle again.

### Disabling it again

Set the flag back to `false`, then delete the scheduled function **before** pushing — the CI deploy is non-interactive and aborts rather than delete a function that has left the source:

```bash
firebase functions:delete ingestEmailsScheduled --region us-central1
```

### How it works when on

**Inbound** — Forward any email to CarBot's Gmail address and it becomes a context document. Forwarded email is third-party text, so it arrives **inactive**: the Context page shows an "N new documents to review" badge, and nothing reaches the child's prompt until you turn the document on. Useful for school newsletters, event announcements, or anything you want CarBot to know about.

**Outbound** — After each session, CarBot emails you a friendly recap summarizing what was talked about, memorable moments, and any dates or plans mentioned. Includes a link to the full transcript.

Each parent can turn the recap email off for their own account in **Settings → Profile**.

---

## Privacy & data

CarBot records children's voices, so this is spelled out explicitly.

**What is collected**

| Data | Where it goes | How long |
|---|---|---|
| Live microphone audio during a session | Streamed to the Gemini Live API (Google) for the duration of the session only; Google's [Gemini API data-use terms](https://ai.google.dev/gemini-api/terms) apply. Not stored by CarBot in transit. | Transient |
| Session recording (`.webm`) | Firebase Cloud Storage, `sessions/{userId}/{sessionId}.webm`, readable only by the owning account | Parent-chosen: 30 / 90 / 365 days or forever (default **90 days**); the nightly job deletes expired recordings |
| Raw and AI-cleaned transcripts, edits | Cloud Firestore under the session | Until the session or account is deleted |
| Extracted memory facts, one-line session summary | Cloud Firestore (`sessions/{id}/memories`, `memories/`) | Until edited/deleted, or the session or account is deleted |
| Context documents, forwarded emails | Cloud Firestore (`context_documents/`, `emails/`) | Until deleted, or the account is deleted |
| Profile: child's first name, bot name, schedule, named places | Cloud Firestore (`users/{uid}`) | Until the account is deleted |
| Current city at session start | Sent to the `geoProxy` callable to reverse-geocode; used only inside that session's prompt | **Never stored** |

Post-session processing (transcript cleaning, memory extraction, the recap email) sends transcript text to the Gemini API from Cloud Functions; nothing is shared with any other third party. There is no analytics or ad SDK in the app.

**Kid-safety controls** — a non-negotiable safety block is appended last to every system instruction; the strictest Gemini `safetySettings` are enforced server-side on proxied text calls; third-party text (documents, emails, memories) is delimited and capped so it cannot act as instructions; forwarded emails arrive inactive until a parent reviews them. See `src/services/promptSafety.ts`.

**How to delete**

- *One session* — open it under **Sessions** and press **Delete session**. Removes the record, both transcripts and their edit history, the memories learned from it, and the recording.
- *Everything* — **Settings → Privacy & data → Delete my account and all data**. Removes every session (as above), context documents, emails, memories, usage counters, the profile, and the Firebase Auth user. The recap-email address is not retained.
- *Audio retention* — **Settings → Privacy & data → Keep session audio for**.

Deletion runs server-side (`deleteSession` / `deleteAccount` callables). Firestore rules deny client-side deletes of session and profile documents so nothing can be left half-deleted.

---

## Security

- All Firestore documents include a `userId` field; rules block any read or write where the caller's UID doesn't match.
- Transcript originals are read-only from the client; edits go to a separate `transcriptEdits` subcollection.
- Session audio is stored at `sessions/{userId}/{sessionId}.webm` and is only accessible to the owning user.
- Gmail credentials (OAuth2 refresh token) are stored in Firebase Secret Manager and never exposed to the client.
- **Gemini and Google Maps API keys live only in Firebase Secret Manager.** The browser bundle contains no sensitive keys. The browser reaches Gemini via three server-side broker callables — `mintGeminiLiveToken` (Live, single-use ephemeral tokens), `invokeGemini` (text generation), and `embedGemini` (embeddings) — each auth-gated and per-user rate-limited. Maps and Weather flow through `geoProxy`. The bundle is scanned for known key shapes on every build (`scripts/check-bundle-for-secrets.mjs`); the build fails if a Gemini or Maps key ever appears in `dist/`.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
