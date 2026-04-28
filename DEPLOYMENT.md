# CarBot Deployment Checklist

## API key hardening

`GEMINI_API_KEY` lives **only** in Firebase Secret Manager — it is no longer
shipped in the client bundle. CarBot's own client code (settings page,
voice preview, diagnostics, sessions) routes every Gemini call through
two Cloud Functions callables:

- `mintGeminiLiveToken` — issues a single-use ephemeral token (~30 min TTL,
  ~60 s window to open the Live session) for browser-direct WebSocket
  authentication. Per-user 200/day rate limit.
- `invokeGemini` — server-side proxy for `ai.models.generateContent` with a
  model allow-list and `maxOutputTokens` ceiling. Per-user 1000/day rate
  limit.

A leaked ephemeral token expires in 30 minutes; a leaked invoke call is
bounded by the model allow-list and per-user quota. Either is a much
smaller blast radius than a leaked long-lived key.

**Open gap (TODO K1):** `KnowledgeCommon` — used here for Wikipedia RAG and
date-time tools — still calls Gemini directly from the browser using the
key passed via `initializeKnowledgeCommon({ geminiApiKey })`. Until
KnowledgeCommon gains broker support, `VITE_GEMINI_API_KEY` is still
present in CarBot's bundle for those tools' use only. Mitigations below
still apply to that residual key.

### 1. Gemini secret on the server

Set the production key once:

```
firebase functions:secrets:set GEMINI_API_KEY
```

Both `mintGeminiLiveToken` and `invokeGemini` declare `secrets:
[geminiApiKey]` so they automatically receive the latest version on the
next deploy of `firebase deploy --only functions`.

### 2. Residual client-bundle Gemini key (KnowledgeCommon)

Until K1 ships, GCP Console → APIs & Services → Credentials → the key
passed via `VITE_GEMINI_API_KEY`:

- **Application restrictions**: HTTP referrers.
  - `https://carbot-andybrook.web.app/*`
  - `https://carbot-andybrook.firebaseapp.com/*`
  - `http://localhost:3004/*` (only during active dev; remove before rotating)
- **API restrictions**: restrict to "Generative Language API" only.
- **Quotas**: confirm per-day caps on "Generate Content Requests" are
  low enough that a leak can't drain the project budget before you notice.

### 3. Maps API key — server-side only

This key lives in Firebase Secret Manager (`GOOGLE_MAPS_API_KEY`) and is
consumed by `geoProxy`. It must NOT be referrer-restricted — Cloud
Functions calls don't send a browser referrer.

- **Application restrictions**: None (or IP-restricted to GCF egress).
- **API restrictions**: Geocoding API + Maps Weather API only.
- Confirm the key is NOT in any `.env` file checked into git. (`git log
  --all -- .env.local` was verified empty for this repo.)

### 4. Post-deploy smoke test

After hosting deploy:
1. Open the hosting URL, sign in with Google.
2. Open the diagnostics page; the "Gemini 3.1 Flash Live" probe goes
   through the server-side broker — a green probe means broker → token
   mint → Gemini Live are all reachable.
3. Start a voice session; verify it connects.
4. Verify geo lookups work (ask the bot "where am I?" — it should
   reverse-geocode successfully).
5. From a browser on a different domain, paste the residual
   `VITE_GEMINI_API_KEY` into a Gemini API cURL — it should return `403`
   (referrer restrictions are in effect).

### 5. Rotating the keys

**Server-side `GEMINI_API_KEY`** (used by the broker):
1. Mint a new key in GCP Console.
2. `firebase functions:secrets:set GEMINI_API_KEY` and paste the new value.
3. `firebase deploy --only functions` to redeploy with the new secret.
4. Delete the old key in GCP Console.

**Client-side `VITE_GEMINI_API_KEY`** (residual, KnowledgeCommon only —
will go away with K1):
1. Mint a new key in GCP Console with the restrictions above pre-applied.
2. Update `.env.production` locally, rebuild, redeploy hosting.
3. Delete the old key in GCP Console.
