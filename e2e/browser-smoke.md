# CarBot browser smoke test

Operator-driven read-only smoke test. An agent (Claude via `claude-in-chrome`)
navigates each route, runs `e2e/probe.js` to capture page shape + console
errors, and reports failures. No writes, no data modifications.

**Target**: https://carbot-andybrook.web.app
**Precondition**: user is already signed in in the active Chrome tab.

## Run it

1. Open the target site in a tab. Confirm you're signed in.
2. Tell the agent: "run e2e/browser-smoke.md against CarBot".
3. The agent opens each route, runs `probe.js`, and reports pass/fail.
4. A clean run ends with "0 console errors, N routes passed".

## Harness (what the agent does, per route)

1. `navigate` to the URL.
2. Wait ~500ms for client-side render.
3. Inject `e2e/probe.js` via `javascript_tool`.
4. Run `read_console_messages` with pattern `error|warn`.
5. Assert the expectations below. Never click anything in "Do NOT click".

## Routes

| # | URL | Expect | Notes |
|---|-----|--------|-------|
| 1 | `/` | redirects to `/sessions` (final URL contains `/sessions`) | Top-level redirect. |
| 2 | `/sessions` | nav contains `Sessions`/`Context`/`Memories`/`Settings`/`Diagnostics`; page shows a list of sessions or empty-state. | SessionList. Capture `$sessionId` from first session card link. |
| 3 | `/context` | heading mentions `Context` or `Library`; list of documents or empty state. | ContextLibrary. |
| 4 | `/memories` | heading mentions `Memories`; list of memory entries or empty state. | MemoryBrowser. |
| 5 | `/settings` | heading mentions `Settings`; toggles/inputs for preferences visible. | SettingsPage. Don't change any setting. |
| 6 | `/diagnostics` | heading mentions `Diagnostics`; shows session-level retry controls. | DiagnosticsPage (added recently). |
| 7 | `/sessions/$sessionId` | transcript text or "No transcript yet" visible. | SessionDetail. Only if `$sessionId` captured in #2. |

**Skipped on purpose**: `/sessions/new` — starts a Gemini Live voice session
that needs mic. Read-only audit can't exercise it.

**Skipped on purpose**: `/login` — only relevant when signed out.

## Do NOT click

- `Delete`, `Remove`, `Clear`, `Revoke`
- `Start session`, `Begin`, `Record`
- `Retry`, `Re-run`, `Regenerate` on diagnostics (these call paid Gemini APIs)
- `Send summary email` (spends Gmail quota)
- `Save`, `Submit`, `Apply` on settings
- `Sign out`

## Expected console noise (not a failure)

- `[auth] user signed in as ...` — informational.
- One-time Firebase `getToken` warnings on cold start.

Anything else at `error` or `warn` level is a finding.

## Failure triage

When a route fails, include:

- The URL.
- Expected vs found (h1, first 3 buttonTexts, first 3 console errors).
- Final URL after navigate (catches unexpected redirects).
- Any `401`/`403`/`5xx` network requests.

## Verified routes log

Append a one-liner per run to `e2e/last-run.txt`:

```
2026-04-18 14:32 UTC — 7/7 passed, 0 console errors
```

Do not commit `last-run.txt` — it's operator output, not source.
