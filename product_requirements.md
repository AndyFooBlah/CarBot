# CarBot — Product Requirements

## 1. Overview

CarBot is a voice-first AI companion for car rides with kids. It runs in the browser, connects to Google Gemini Live for real-time voice conversation, and is context-aware: it knows your family's schedule, location, and history of past conversations so every ride feels like a continuation of an ongoing relationship rather than a cold-start chatbot session.

The primary interaction mode is **voice only** — the app launches on a phone or tablet in the car and the family just talks. The secondary interaction mode is a **web UI used from a laptop** to manage context documents, review transcripts, and configure settings.

---

## 2. User Profile

**Primary users:** One parent + one or more children, sharing a single account.

**Usage pattern:**
- Daily school commutes (morning + afternoon)
- Occasional longer drives
- Parent logs in from laptop to upload teacher notes, review conversations

**Single-user model:** For the initial release, each account is fully isolated. One authenticated user has access to all data in their account and no access to any other account's data.

---

## 3. Functional Requirements

### 3.1 Routine & Schedule Context

**FR-1** The system shall allow the user to configure a weekly school schedule, including:
- Which days of the week are school days
- Morning departure time (home → school)
- Afternoon pickup time (school → home)

**FR-2** At session start, the system shall infer the current trip context from the current date and time relative to the configured schedule. Possible contexts:
- `school_commute_morning` — school day, within ±30 min of morning departure
- `school_commute_afternoon` — school day, within ±30 min of afternoon pickup
- `school_day_other` — school day, other time
- `weekend` — non-school day
- `unstructured` — no schedule configured

**FR-3** The inferred trip context shall be included in the Gemini system instruction to prime conversational tone and topics (e.g., "heading to school" vs. "heading home after school").

---

### 3.2 Location Awareness

**FR-4** The user shall be able to configure a home location and a school location (by name and/or address) in settings.

**FR-5** The session start sequence shall request browser geolocation (with permission). If granted, the approximate current location (city/neighborhood — not street address) shall be included in the Gemini system instruction.

**FR-6** Location data shall never be stored permanently. It is used only for in-session context and discarded when the session ends.

---

### 3.3 Memory System

**FR-7** After each session is completed, a Cloud Function shall extract structured memory facts from the transcript. Examples: interests mentioned, books or movies referenced, upcoming events, family plans.

**FR-8** Extracted facts shall be stored in a searchable memory store (per-user Firestore collection), tagged with session ID, date, and category.

**FR-9** At session start, the system shall retrieve the most relevant recent memories (by recency and relevance) and inject a summary into the system instruction, giving the bot context about the family it's talking to.

**FR-10** The user shall be able to view, edit, and delete individual memory facts from the web UI.

**FR-11** Session-level memory summaries ("highlights") shall be stored alongside the session record, distinct from the raw extracted facts.

---

### 3.4 Context Document Management

**FR-12** The user shall be able to upload documents (plain text, Markdown, PDF) to a context library via the web UI.

**FR-13** The user shall be able to paste freeform text directly into the web UI to create a context document.

**FR-14** Each context document shall support user-supplied tags (e.g., `lesson-plan`, `field-trip`, `teacher-note`) and a title.

**FR-15** Context documents shall have an `active` flag. Only active documents are considered when building the session context.

**FR-16** At session start, active context documents (or relevant excerpts) shall be included in or summarized into the system instruction.

**FR-17** The user shall be able to view, edit, deactivate, and delete context documents from the web UI.

---

### 3.5 Email Inbox (Inbound)

**FR-18** CarBot shall have a dedicated Gmail account that the user can send or forward emails to.

**FR-19** A Cloud Function (scheduled or triggered) shall read new emails from the CarBot Gmail inbox using the Gmail API.

**FR-20** Email content shall be stored as context documents (same data model as uploaded documents, with `source: 'email'`) and subject to the same tagging and activation rules.

**FR-21** The user shall be able to view emails that have been ingested, see which sessions they influenced, and delete them.

---

### 3.6 Email Outbound (Session Summaries)

**FR-22** After each session is completed, a Cloud Function shall generate a summary of the conversation (topics discussed, memorable moments, any dates or events mentioned).

**FR-23** The summary shall be emailed to the user's registered email address from the CarBot Gmail account.

**FR-24** The email format shall be plain-text-friendly (readable in any email client) with a link to the full transcript in the web app.

---

### 3.7 Session Storage & Archival

**FR-25** The following artifacts shall be stored permanently per session:
- **Raw audio** — mixed WebM/Opus recording (GCS)
- **Raw transcript** — verbatim voice-to-text output (Firestore)
- **Clean transcript** — AI-post-processed version with corrections, punctuation, speaker labels (Firestore, generated post-session)
- **Memory highlights** — structured facts extracted from the session (Firestore)

**FR-26** None of the above artifacts shall ever be automatically deleted.

**FR-27** Sessions shall be browsable in a history view showing date, duration, trip context, and a one-line summary.

---

### 3.8 Transcript Editing

**FR-28** The user shall be able to edit both the raw transcript and the clean transcript from the session detail view.

**FR-29** Editing shall create a new versioned document; the original is preserved and never overwritten.

**FR-30** The version history shall be visible and each prior version shall remain accessible.

**FR-31** The "active" version (most recent edit, or original if unedited) shall be used for memory extraction, summary emails, and context injection.

---

### 3.9 Security & Access Control

**FR-32** All user data (sessions, transcripts, memories, context documents, emails) shall be scoped to the authenticated user's UID. No user shall ever be able to read or write another user's data.

**FR-33** Firestore security rules shall enforce user-scoped access at the database level — security must not rely solely on application-layer checks.

**FR-34** Cloud Storage rules shall enforce that only the owning user can read or write their session audio.

**FR-35** The CarBot Gmail account credentials shall be stored as Cloud Function environment secrets, never exposed to the client.

**FR-36** Geolocation data shall never be written to any persistent store.

---

## 4. Non-Functional Requirements

**NFR-1 Latency:** The voice session shall connect and begin accepting speech within 3 seconds of the user tapping "Start."

**NFR-2 Availability:** The app shall be functional offline for up to 30 seconds of interrupted connectivity without crashing (graceful degradation).

**NFR-3 Data retention:** All session artifacts (audio, transcripts, memories) shall be retained indefinitely. No automated purge policy.

**NFR-4 Privacy:** Location data is never stored. Conversation data is stored only in the user's own Firestore/GCS namespace. No data is shared with third parties beyond the Google services already in use (Firebase, Gemini, Gmail).

**NFR-5 Single-device usage:** The app is designed for one active session at a time from one device. No multi-device sync during a live session is required.

**NFR-6 Browser support:** Chrome on Android and Chrome on desktop. Safari/Firefox are nice-to-have.

---

## 5. Out of Scope (v1)

- Multi-user / family member accounts
- Real-time location tracking or turn-by-turn navigation
- Native mobile app (iOS/Android)
- Payments or subscriptions
- Sharing conversations with other users
- Integration with school district APIs
- Automatic transcript translation
