# CarBot — Technical Design

## 1. Architecture Overview

CarBot is a React/TypeScript SPA that uses VoiceCommon (`@andyfooblah/voicecommon`) as its core framework. Firebase handles auth, database, and storage. Cloud Functions handle all server-side processing (memory extraction, email, transcript cleaning).

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (SPA)                            │
│                                                                 │
│  ┌──────────┐  ┌────────────────┐  ┌───────────────────────┐  │
│  │  Auth    │  │  Session View  │  │  Management UI        │  │
│  │(VoiceCom)│  │ (VoiceCommon   │  │  • Context docs       │  │
│  │          │  │  useSession)   │  │  • Memory viewer      │  │
│  └──────────┘  └────────────────┘  │  • Transcript editor  │  │
│                                    │  • Settings           │  │
│                                    └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                   │                    │
         ▼                   ▼                    ▼
  Firebase Auth       Gemini Live API       Firestore + GCS
                      (via VoiceCommon)

┌─────────────────────────────────────────────────────────────────┐
│                    Cloud Functions (Node 22)                     │
│                                                                 │
│  onSessionCompleted  →  extractMemories()                       │
│                      →  generateCleanTranscript()               │
│                      →  sendSessionSummaryEmail()               │
│                                                                 │
│  onEmailReceived     →  ingestEmailAsContextDocument()          │
│  (scheduled/webhook)                                            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
  Gmail API (CarBot's own account)
```

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | VoiceCommon (`@andyfooblah/voicecommon`) |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Voice AI | Google Gemini Live (`gemini-2.5-flash-preview-native-audio-dialog`) |
| Auth | Firebase Authentication (Google OAuth) |
| Database | Cloud Firestore |
| Storage | Firebase Cloud Storage |
| Backend | Firebase Cloud Functions v2 (Node.js 22) |
| Email | Gmail API (service account, CarBot's Gmail) |
| Testing | Vitest, React Testing Library |
| CI | GitHub Actions |

---

## 3. Firestore Data Model

All data is user-scoped. Every top-level document includes a `userId` field matching the Firebase Auth UID of the owner. Firestore rules enforce this at the database level.

### 3.1 `users/{uid}`

| Field | Type | Description |
|-------|------|-------------|
| `email` | `string` | Firebase auth email |
| `displayName` | `string` | Display name |
| `createdAt` | `Timestamp` | Account creation time |
| `timezone` | `string?` | IANA timezone |
| `routine` | `Routine?` | School schedule config (see §3.2) |
| `locations` | `LocationConfig?` | Home + school locations (see §3.3) |

### 3.2 `Routine` (embedded in `users/{uid}`)

| Field | Type | Description |
|-------|------|-------------|
| `schoolDays` | `string[]` | Days of week: `['Mon','Tue','Wed','Thu','Fri']` |
| `morningDepartureTime` | `string` | HH:MM in user's local time, e.g. `"08:15"` |
| `afternoonPickupTime` | `string` | HH:MM in user's local time, e.g. `"15:30"` |
| `contextWindowMinutes` | `number` | How many minutes around drive time counts as commute (default: 30) |

### 3.3 `LocationConfig` (embedded in `users/{uid}`)

| Field | Type | Description |
|-------|------|-------------|
| `homeCity` | `string` | Human-readable home city/neighborhood |
| `schoolName` | `string` | School name for context injection |
| `schoolAddress` | `string?` | Address (used for geolocation comparison, not stored with sessions) |

### 3.4 `sessions/{sessionId}`

Inherits from VoiceCommon `SessionMetadata`, plus:

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `string` | Owner UID |
| `startTime` | `Timestamp` | Session start |
| `endTime` | `Timestamp \| null` | Session end; null while active |
| `audioUrl` | `string` | GCS URL for raw audio |
| `status` | `"active" \| "completed" \| "interrupted"` | Lifecycle state |
| `durationSeconds` | `number` | Total duration |
| `tripContext` | `TripContext` | Inferred context at session start (see §4.1) |
| `summary` | `string?` | One-line AI summary, set post-session |
| `contextDocIds` | `string[]` | IDs of context docs active at session start |

### 3.5 `sessions/{sessionId}/transcript/raw`

Single document:
```
{
  entries: TranscriptEntry[],   // verbatim from Gemini input transcription
  version: number,              // always 1 for the original
  createdAt: Timestamp
}
```

### 3.6 `sessions/{sessionId}/transcript/clean`

Single document (written post-session by Cloud Function):
```
{
  entries: TranscriptEntry[],   // AI-corrected, punctuated, speaker-labeled
  version: number,
  generatedAt: Timestamp,
  model: string                 // which Gemini model generated this
}
```

### 3.7 `sessions/{sessionId}/transcript/edits/{editId}` (subcollection)

Each edit creates a new document:
```
{
  type: 'raw' | 'clean',
  entries: TranscriptEntry[],
  editedAt: Timestamp,
  note: string?                 // optional user annotation
}
```

### 3.8 `sessions/{sessionId}/memories`

Single document (written post-session):
```
{
  facts: MemoryFact[],
  extractedAt: Timestamp,
  model: string
}
```

`MemoryFact`:
```typescript
interface MemoryFact {
  id: string;
  content: string;              // e.g. "Leo said his favorite dinosaur is the ankylosaurus"
  category: MemoryCategory;     // see §4.3
  importance: 1 | 2 | 3;       // 1=minor, 2=notable, 3=important
  tags: string[];
}
```

`MemoryCategory`: `'interest' | 'event' | 'plan' | 'fact' | 'preference' | 'relationship' | 'other'`

### 3.9 `memories/{memoryId}` (global index for search)

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `string` | Owner UID |
| `sessionId` | `string` | Source session |
| `sessionDate` | `Timestamp` | When the memory was captured |
| `content` | `string` | Full text of the fact |
| `category` | `MemoryCategory` | Category |
| `importance` | `1 \| 2 \| 3` | Priority |
| `tags` | `string[]` | User-editable tags |
| `createdAt` | `Timestamp` | When extracted |
| `edited` | `boolean` | Whether user has modified this |

### 3.10 `context_documents/{docId}`

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `string` | Owner UID |
| `title` | `string` | Human-readable title |
| `source` | `'upload' \| 'email' \| 'text'` | How it was created |
| `content` | `string` | Full text content (≤ 50,000 chars) |
| `tags` | `string[]` | User-applied tags |
| `active` | `boolean` | Whether included in session context |
| `createdAt` | `Timestamp` | Creation time |
| `updatedAt` | `Timestamp` | Last update |
| `emailId` | `string?` | Source email ID if `source === 'email'` |
| `filename` | `string?` | Original filename if `source === 'upload'` |

### 3.11 `emails/{emailId}`

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `string` | Owner UID |
| `gmailMessageId` | `string` | Gmail message ID (for deduplication) |
| `from` | `string` | Sender address |
| `subject` | `string` | Email subject |
| `receivedAt` | `Timestamp` | Email receipt time |
| `processedAt` | `Timestamp?` | When ingested into context docs |
| `contextDocId` | `string?` | Resulting context_document ID |
| `body` | `string` | Plain-text email body (≤ 50,000 chars) |

---

## 4. Feature Design

### 4.1 Trip Context Inference

At session start, CarBot calls `inferTripContext(userId, now)`:

```typescript
type TripContext =
  | 'school_commute_morning'
  | 'school_commute_afternoon'
  | 'school_day_other'
  | 'non_school_day'
  | 'unstructured';

function inferTripContext(routine: Routine | undefined, now: Date): TripContext
```

Logic:
1. If no routine configured → `'unstructured'`
2. If current day not in `schoolDays` → `'non_school_day'`
3. If current time within `contextWindowMinutes` of `morningDepartureTime` → `'school_commute_morning'`
4. If current time within `contextWindowMinutes` of `afternoonPickupTime` → `'school_commute_afternoon'`
5. Otherwise → `'school_day_other'`

The context is converted to a natural-language phrase in the system instruction builder:
```
"It's a Tuesday morning and the family is heading to school."
"It's a Wednesday afternoon and the family is heading home after school."
```

### 4.2 Session System Instruction Assembly

`buildCarbotInstruction(context: SessionContext): string` assembles:

1. **Base persona** — CarBot's personality (friendly, curious, kid-appropriate)
2. **Trip context** — from §4.1
3. **Location** — city name from browser geolocation or configured home city
4. **Recent memories** — top N facts from `memories` collection, ordered by `sessionDate DESC, importance DESC`
5. **Active context documents** — full content for short docs (< 2000 chars), summary stub for longer ones
6. **Recent session summaries** — one-line summaries from the last 5 sessions

Total assembled instruction target: ≤ 8000 tokens.

### 4.3 Memory Extraction (Cloud Function)

`onSessionCompleted` triggers `extractMemories(sessionId)`:

1. Fetch clean transcript (or raw if clean not yet available)
2. Call Gemini with a structured extraction prompt requesting a JSON array of `MemoryFact[]`
3. Write facts to `sessions/{sessionId}/memories`
4. Fan out each fact to `memories/{memoryId}` (for cross-session search)
5. Generate one-line session summary; write to `sessions/{sessionId}.summary`

Extraction prompt requests facts in categories: interests, events (with dates), plans, preferences, relationships, notable quotes.

### 4.4 Clean Transcript Generation (Cloud Function)

`onSessionCompleted` triggers `generateCleanTranscript(sessionId)`:

1. Fetch raw transcript entries
2. Call Gemini with a cleanup prompt: fix transcription errors, add punctuation, add speaker labels (`[Parent]`, `[Leo]` or generic `[Child]`)
3. Write result to `sessions/{sessionId}/transcript/clean`

Speaker labels use child's name if configured in user profile; otherwise generic.

### 4.5 Gmail Integration — Inbound

Architecture: A scheduled Cloud Function runs every 15 minutes (or can be manually triggered):

1. Authenticate with Gmail API using a service account / OAuth2 credentials stored in Cloud Function secrets
2. Query Gmail for unread messages sent to CarBot's address
3. For each unread message:
   - Check `emails` collection for `gmailMessageId` (deduplication)
   - Parse `from`, `subject`, `receivedAt`, plain-text body
   - Write to `emails/{emailId}`
   - Write parsed content to `context_documents/{docId}` with `source: 'email'`, `active: true`
   - Mark email as read in Gmail
4. Emit one Firestore write per email; Cloud Function exits

The CarBot Gmail address is a hardcoded constant in Cloud Function config. Emails from any sender are ingested (the user controls who has the address).

### 4.6 Gmail Integration — Outbound (Session Summaries)

`onSessionCompleted` triggers `sendSessionSummary(sessionId)`:

1. Fetch session record + memories + clean transcript
2. Call Gemini to generate a 3-5 paragraph summary: overview, memorable moments, topics discussed, any dates/events mentioned
3. Compose email:
   - **To:** user's registered email
   - **From:** CarBot Gmail address
   - **Subject:** `"CarBot recap: [date] — [session summary one-liner]"`
   - **Body:** plain-text summary + link to transcript (deep link into web app)
4. Send via Gmail API

### 4.7 Transcript Editing

The transcript editor shows raw and clean transcripts side-by-side. Editing either:

1. User clicks "Edit" on a transcript view — enters edit mode (textarea or line-by-line)
2. User saves → POST to a Cloud Function (or direct Firestore write) that:
   - Creates `sessions/{sessionId}/transcript/edits/{newEditId}` with the full new content
   - The `type` field marks which transcript was edited
3. The session detail view always shows the most recent edit (by `editedAt`) for each type; a "Version history" toggle reveals older versions

Original `raw` and `clean` documents are never modified.

### 4.8 Context Document Management

The context library page (`/context`) lists all context documents sorted by `updatedAt DESC`. 

**Upload flow:**
1. User selects a file (`.txt`, `.md`, `.pdf`) — PDF is extracted to text client-side via `pdfjs-dist`
2. Text content is written to `context_documents/{docId}` with `source: 'upload'`

**Text entry flow:**
1. User pastes or types into a textarea and gives it a title
2. Written to `context_documents/{docId}` with `source: 'text'`

**Activation:** Toggle switch per document. Active documents are injected into the next session's system instruction.

---

## 5. Cloud Storage Layout

```
sessions/{userId}/{sessionId}.webm    # Raw audio (mixed, WebM/Opus 128kbps)
```

(Inherits from VoiceCommon — no changes to the storage layout.)

---

## 6. Firestore Indexes

| Collection | Fields | Query purpose |
|------------|--------|---------------|
| `sessions` | `userId ASC, startTime DESC` | Session history list |
| `sessions` | `userId ASC, status ASC, startTime DESC` | Filter active sessions |
| `memories` | `userId ASC, sessionDate DESC, importance DESC` | Context injection |
| `memories` | `userId ASC, tags ASC, sessionDate DESC` | Tag-filtered memory search |
| `context_documents` | `userId ASC, active ASC, updatedAt DESC` | Active doc list for injection |
| `emails` | `userId ASC, receivedAt DESC` | Email inbox view |

---

## 7. Security

### 7.1 Firestore Rules (summary)

```
sessions/{sessionId}: allow read, write if request.auth.uid == resource.data.userId
sessions/{sessionId}/transcript/**: allow read, write if userId matches session owner
sessions/{sessionId}/memories: allow read, write if userId matches session owner
sessions/{sessionId}/transcript/edits/{editId}: allow read, write if userId matches
memories/{memoryId}: allow read, write if request.auth.uid == resource.data.userId
context_documents/{docId}: allow read, write if request.auth.uid == resource.data.userId
emails/{emailId}: allow read, write if request.auth.uid == resource.data.userId
users/{uid}: allow read, write if request.auth.uid == uid
```

### 7.2 Storage Rules

```
sessions/{userId}/{sessionId}.webm: allow read, write if request.auth.uid == userId
```

### 7.3 Gmail Credentials

Gmail API credentials (OAuth2 refresh token or service account key) are stored as Cloud Function environment secrets (Firebase Secret Manager). Never written to Firestore or returned to the client.

### 7.4 Client-Side API Keys

Gemini API key is present in the browser bundle (via `initializeVoiceCommon`). This is acceptable for the single-user self-hosted model: the key is the owner's own key from Google AI Studio. The Gemini key scope should be limited to Gemini Live only.

---

## 8. App Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | → `/sessions` | Redirect |
| `/sessions` | Session History | List of past sessions with date, duration, context, summary |
| `/sessions/new` | New Session | Live voice session with real-time transcript + waveform |
| `/sessions/:id` | Session Detail | Transcript viewer, memory highlights, audio player, edit UI |
| `/context` | Context Library | Upload/manage context documents, view email inbox |
| `/memories` | Memory Browser | Browsable/searchable memory facts across all sessions |
| `/settings` | Settings | Routine config, location config, profile |

---

## 9. Project Structure

```
src/
├── services/
│   ├── tripContext.ts        # inferTripContext() and context enum
│   ├── instructionBuilder.ts # buildCarbotInstruction() - assembles system instruction
│   ├── contextDocuments.ts   # CRUD for context_documents collection
│   ├── memories.ts           # CRUD + retrieval for memories collection
│   ├── emailIngestion.ts     # (client-side) display/manage ingested emails
│   └── transcriptEditor.ts  # versioned transcript edit helpers
├── hooks/
│   ├── useSession.ts         # wraps VoiceCommon useSession with CarBot instruction
│   ├── useMemories.ts        # fetch + search memories
│   └── useContextDocs.ts     # fetch + manage context documents
├── components/
│   ├── session/
│   │   ├── SessionView.tsx           # Live session page
│   │   └── SessionDetail.tsx         # Past session detail + transcript editor
│   ├── history/
│   │   └── SessionList.tsx           # Session history list
│   ├── context/
│   │   ├── ContextLibrary.tsx        # Context document management
│   │   ├── DocumentUploader.tsx      # File + text upload UI
│   │   └── EmailInbox.tsx            # View ingested emails
│   ├── memories/
│   │   └── MemoryBrowser.tsx         # Browse + edit memory facts
│   ├── settings/
│   │   ├── RoutineSettings.tsx       # School schedule config
│   │   └── LocationSettings.tsx      # Home + school location config
│   └── shared/
│       └── Layout.tsx
├── types.ts
└── App.tsx

functions/
└── src/
    ├── index.ts              # Function entry points
    ├── memoryExtraction.ts   # extractMemories() + generateCleanTranscript()
    ├── emailIngestion.ts     # Gmail polling + ingestEmailAsContextDocument()
    └── sessionSummary.ts     # sendSessionSummary()
```

---

## 10. Open Design Questions

1. **Memory retrieval strategy** — Simple recency + importance sort is the v1 approach. A future iteration could use Firestore vector search (or Vertex AI) for semantic retrieval. The data model supports either.

2. **Context document length** — Very long documents (e.g. multi-page PDFs) can't fit in the system instruction. v1 uses a truncation strategy; a future version could use RAG to pull relevant excerpts.

3. **Gmail OAuth vs. service account** — Service account requires Google Workspace; a personal Gmail account needs OAuth2 with a refresh token. v1 uses OAuth2 with a refresh token stored in Cloud Function secrets.

4. **Child's name** — The clean transcript generator and memory extractor will use the child's name if configured in settings. This is a user-supplied string, not inferred from conversation.

5. **Multi-child households** — v1 assumes one child. The data model doesn't preclude a `children: { name, age }[]` field in `users/{uid}` for a later iteration.
