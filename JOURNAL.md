# Project journal

An append-only record of how CarBot was built: **decisions** (and who made them), **friction** hit, what we
**learned**, what **surprised** us, and ideas for later.

**Format:** every entry starts with a UTC timestamp and a tag:
`- 2026-10-16T17:52Z [decision] …`. Tags: `[step]`, `[decision]` (who decided, and why), `[friction]`,
`[learning]`, `[surprise]`, `[incident]`, `[idea]`, `[milestone]`.

**Append-only.** Never edit or delete a past entry. To correct one, append a new entry naming the earlier
one's timestamp. A copy is synced to the owner's private repo (`andy-private-docs/journals/`).

**Backfill note.** Created 2026-10-16 under the new project-journal rule in `~/.claude/CLAUDE.md`. Entries
before that date were reconstructed from commit history and session records, so their timestamps are commit
times and are marked `~`. Resolution is coarse for April–September — one entry per turning point, not per
commit — and detailed only where a session had the work directly in hand. The reasoning behind earlier
decisions was mostly never written down and is lost; that is the gap this rule exists to close.

"Owner" is the project owner. "Session" is a Claude Code session working on the repo.

**Rule for every contributor (human or agent):** add an entry here in the same commit or PR as the change
that prompted it. That covers any decision, any workaround, anything that took more than one try, and any
result that differed from expectation.

---

## 2026-04: build-out and a long security pass

- ~2026-04-11T21:28Z [milestone] Project starts with requirements and technical design: a voice-first
  companion for car rides with kids, built on VoiceCommon and KnowledgeCommon rather than its own session
  stack.
- ~2026-04-13T22:41Z [decision] Knowledge tools moved out of VoiceCommon into KnowledgeCommon, so voice
  infrastructure and knowledge tools version independently. CarBot consumes both.
- ~2026-04-17T17:03Z [step] Settings gains a voice selector and a "Say hi" preview button. The preview opens
  its **own** direct Live connection rather than going through VoiceCommon — a second Live path that is easy
  to forget during any later migration. (It was indeed nearly missed in September.)
- ~2026-04-17T21:24Z [decision] Per-user Gemini Live voice quota plus a 4-hour hard timeout. A kid-facing
  voice app left running in a car is an open-ended billing risk.
- ~2026-04-17T22:00Z to ~2026-04-18T13:35Z [incident] Sustained security pass (H1/H2/M1–M6): recipient email
  masked in send logs, `geoProxy` input validation and rate limits, explicit deny on `_usage`,
  `wikipedia_cache` writes locked with TTL cleanup, `onSessionCompleted` duration gate, transcript length cap,
  context upload allowlist. The shape of the risk is that this app talks to children and emails parents.
- ~2026-04-18T10:48Z [learning] Rate-limit errors were made **model-interpretable** — the bot needs to
  understand its own tool failures well enough to say something sensible out loud, not just fail.

## 2026-05 to 2026-09-10: testing and data lifecycle

- ~2026-05-09T13:03Z [step] VoiceSimulator integrated for conversational testing.
- ~2026-09-10T22:15Z [decision] Non-negotiable SAFETY block in the prompt, untrusted data explicitly
  delimited, `safetySettings` set, and email docs inactive by default.
- ~2026-09-10T22:33Z [milestone] Data lifecycle: session delete, account deletion, audio retention, and a
  privacy statement.

## 2026-09-18 to 2026-09-19: dependency modernization and the Live model migration

- ~2026-09-18T16:14Z [step] firebase-admin 13→14, googleapis 144→180, modular Firestore API in `rateLimit`
  and `cacheWikipedia`, and ESLint added to the CI functions job (#35).
- 2026-09-19T11:36Z [milestone] Live sessions moved to `gemini-3.8-live` (stable, released 2026-09-15) on
  voice-common 0.15.0, replacing `gemini-3.1-flash-live-preview`. Pricing is identical, so this is a
  preview-to-stable move at no cost change. (5fa9873)
- 2026-09-19T11:36Z [surprise] The migration is **not** a one-line model swap. `gemini-3.8-live` rejects
  `thinkingConfig` and closes the WebSocket with `1007 Thinking level is not supported for this model` at
  setup, which reads like a connection fault rather than a config error. voice-common 0.14.x sent
  `thinkingLevel: MINIMAL` unconditionally, so the library bump to 0.15.0 was mandatory, not optional — 0.14.1
  has no way to suppress the field.
- 2026-09-19T11:36Z [friction] `src/services/voicePreview.ts` carried its own hardcoded model id **and** its
  own `thinkingConfig`. Left alone it would have failed every voice audition in Settings with a 1007 while
  real sessions worked, which is a hard failure to attribute. Both now come from one shared constant in
  `geminiBroker.ts`. The general lesson: **count the Live paths before migrating, not after.**
- 2026-09-19T11:40Z [learning] CarBot's tests cannot catch a Live config regression. `src/__tests__/setup.ts`
  mocks `@andyfooblah/voice-common` wholesale with a stub `useSession`, so no connect config is ever
  exercised, and `voicePreview.ts` has no test at all. The migration was verified instead by replaying the
  exact preview connect config against the live API (it streamed audio, no 1007) and by checking the deployed
  bundle.
- 2026-09-19T11:45Z [step] Deployed to Firebase `carbot-andybrook`; live bundle confirmed to carry
  `gemini-3.8-live`, page loads with no console errors.
- 2026-09-19T11:45Z [learning] `gemini-3.1-flash-live-preview` still appears once in the shipped bundle. That
  is voice-common's exported `DEFAULT_LIVE_MODEL`, now dead weight since the app overrides it — so grepping
  the bundle for the old id is a **false-positive** check for "did the migration happen".
- ~2026-09-19T11:50Z [idea] Turn-taking here is server VAD with defaults, which suits an interruption-heavy
  car full of kids. Worth leaving alone: BiographyBot wants the opposite (patient waiting) and the two
  requirements genuinely conflict, so the shared library should keep exposing this as a parameter.

## 2026-10-16: journal created

- 2026-10-16T21:48Z [milestone] JOURNAL.md created under the new project-journal rule, backfilled as above.
