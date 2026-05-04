# CarBot

A voice-first AI companion for car rides with kids. CarBot turns everyday drives into engaging conversations — answering questions, telling jokes, exploring topics, and building a memory of the family over time. Parents receive a friendly email recap after each session.

Built on [`@andyfooblah/voice-common`](https://github.com/AndyFooBlah/VoiceCommon) (voice infrastructure) and [`@andyfooblah/knowledge-common`](https://github.com/AndyFooBlah/KnowledgeCommon) (knowledge tools).

---

## What it does

- **Live voice sessions** — Talk to CarBot hands-free during a car ride. Powered by the Gemini Live API with real-time audio streaming.
- **Trip-aware context** — CarBot knows whether it's a morning school commute, afternoon pickup, or weekend trip, and adjusts accordingly.
- **Memory across sessions** — Facts, interests, upcoming events, and preferences mentioned in conversations are extracted and remembered for next time.
- **Context documents** — Parents can upload school newsletters, permission slips, or any text they want CarBot to know about. Emails forwarded to CarBot's Gmail address are automatically converted to context.
- **Session recap emails** — After each session, CarBot emails the parent a warm summary of what was talked about, with a link to the full transcript.
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
│    └── sendSessionSummaryEmail()     — Gemini → Gmail recap     │
│                                                                 │
│  ingestEmailsScheduled (every 15 min)                           │
│    └── ingestEmails()                — Gmail → context docs     │
└─────────────────────────────────────────────────────────────────┘
```

### Tech stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Voice AI framework | [`@andyfooblah/voice-common`](https://github.com/AndyFooBlah/VoiceCommon) v0.4.1 |
| Knowledge tools | [`@andyfooblah/knowledge-common`](https://github.com/AndyFooBlah/KnowledgeCommon) v0.3.0 |
| Voice model | Google Gemini Live (`gemini-2.5-flash-preview-native-audio-dialog`) |
| Post-processing AI | Google Gemini 2.0 Flash |
| Auth | Firebase Authentication (Google OAuth + email/password) |
| Database | Cloud Firestore |
| Storage | Firebase Cloud Storage |
| Backend | Firebase Cloud Functions v2 (Node.js 22) |
| Email | Gmail API (OAuth2, CarBot's dedicated Gmail account) |
| Testing | Vitest + React Testing Library |
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
│   │   ├── instructionBuilder.ts # Assembles Gemini system instruction
│   │   ├── memories.ts           # CRUD + context injection for memories
│   │   ├── sessions.ts           # CarBot session fields
│   │   ├── transcriptEditor.ts   # Versioned transcript edits
│   │   ├── tripContext.ts        # Trip context inference from schedule
│   │   └── userProfile.ts        # User profile Firestore helpers
│   ├── __tests__/                # Vitest unit tests (87 tests)
│   └── types.ts                  # CarBot-specific TypeScript types
├── functions/
│   └── src/
│       ├── index.ts              # Cloud Function entry points + wiring
│       ├── memoryExtraction.ts   # Memory extraction + session summary
│       ├── cleanTranscript.ts    # AI transcript cleaning + speaker labels
│       ├── sessionSummaryEmail.ts # Session recap email via Gmail API
│       ├── emailIngestion.ts     # Gmail inbox polling
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
| `system/gmailPollingState` | Internal polling state (historyId) — no client access |

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

CarBot depends on VoiceCommon and KnowledgeCommon as local packages (`file:../voicecommon`, `file:../knowledgecommon`). Clone both alongside CarBot so the paths resolve:

```bash
# In the parent directory:
git clone https://github.com/AndyFooBlah/VoiceCommon.git
cd VoiceCommon && npm install && npm run build:lib && cd ..

git clone https://github.com/AndyFooBlah/KnowledgeCommon.git
cd KnowledgeCommon && npm install && npm run build:lib && cd ..
```

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
- **Gmail API** — needed for sending recap emails and inbox polling

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

CarBot uses a dedicated Gmail account to send recap emails and receive forwarded context emails. You need OAuth2 credentials with a refresh token stored in Firebase Secret Manager.

**4a. Create OAuth2 credentials**

1. In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (type: Desktop app)
3. Download the JSON credentials file

**4b. Obtain a refresh token**

Use the [OAuth2 Playground](https://developers.google.com/oauthplayground/) or a script to authorize the CarBot Gmail account and capture the refresh token. The required scope is `https://www.googleapis.com/auth/gmail.modify`.

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
npm test             # Run all tests (Vitest)
npm run test:watch   # Watch mode
npx tsc --noEmit     # Type-check
npx eslint src --ext .ts,.tsx  # Lint

# Cloud Functions
cd functions
npm run build        # Compile TypeScript
npm run build:watch  # Watch mode

# Deploy everything
npm run deploy
```

### Running tests

```bash
npm test
```

Tests use Vitest with jsdom. Firebase and VoiceCommon are fully mocked — no emulator or network connection needed. 87 tests across:

- `instructionBuilder.test.ts` — system instruction assembly (bot name, child name, location, tools, graceful error handling)
- `tripContext.test.ts` — trip context inference logic (pure functions)
- `contextDocuments.test.ts` — context document CRUD and content formatting
- `memories.test.ts` — memory fetch and formatting
- `transcriptEditor.test.ts` — versioned transcript read/write

### CI

GitHub Actions runs on every push to `main` and every pull request:

- **Frontend** — type-check, ESLint, Vitest
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

After each session, a Cloud Function calls Gemini 2.0 Flash to extract structured facts from the transcript. Facts are stored in two places:

1. `sessions/{id}/memories/facts` — session-level source of truth
2. `memories/{memoryId}` — cross-session index for fast retrieval

At the start of each new session, the 20 most recent and important memories are included in CarBot's system instruction so it can reference them naturally in conversation.

You can view, edit, or delete memories in the **Memories** tab.

---

## How email works

**Inbound** — Forward any email to CarBot's Gmail address and it will automatically become an active context document for the next session. Useful for school newsletters, event announcements, or anything you want CarBot to know about.

**Outbound** — After each session, CarBot emails you a friendly recap summarizing what was talked about, memorable moments, and any dates or plans mentioned. Includes a link to the full transcript.

Email summaries can be disabled in **Settings → Profile**.

---

## Security

- All Firestore documents include a `userId` field; rules block any read or write where the caller's UID doesn't match.
- Transcript originals are read-only from the client; edits go to a separate `transcriptEdits` subcollection.
- Session audio is stored at `sessions/{userId}/{sessionId}.webm` and is only accessible to the owning user.
- Gmail credentials (OAuth2 refresh token) are stored in Firebase Secret Manager and never exposed to the client.
- The Gemini API key is present in the browser bundle — this is intentional for the self-hosted single-user model. Scope your key to Gemini Live only in Google AI Studio.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
