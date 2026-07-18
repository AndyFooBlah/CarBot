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

**K1 — resolved.** KnowledgeCommon (Wikipedia RAG, date-time tools) is
now wired through the same server-side brokers as everything else:
CarBot passes `{ invokeGemini, embedContent: embedGemini }` into
`initializeKnowledgeCommon`, so the library never holds a key. There is
no `VITE_GEMINI_API_KEY` anywhere in the project and no Gemini key in
the client bundle. Two automated guards keep it that way: the ESLint
`no-restricted-syntax` rule on `VITE_GEMINI_*` reads, and the
post-build bundle scanner (`scripts/check-bundle-for-secrets.mjs`),
which fails the build on any key-shaped string in `dist/` other than
the allowlisted Firebase web `apiKey` (a project identifier, not a
secret — access control lives in Firestore/Storage rules).

### 1. Gemini secret on the server

Set the production key once:

```
firebase functions:secrets:set GEMINI_API_KEY
```

Both `mintGeminiLiveToken` and `invokeGemini` declare `secrets:
[geminiApiKey]` so they automatically receive the latest version on the
next deploy of `firebase deploy --only functions`.

### 2. Old client-side key cleanup (one-time, post-K1)

The pre-K1 architecture shipped a referrer-restricted Gemini key in the
bundle (`VITE_GEMINI_API_KEY`). That key is no longer used anywhere.
One-time cleanup in GCP Console → APIs & Services → Credentials:

- Confirm the old client-side key has been **deleted** (not just
  restricted). If any deployed bundle from before the broker migration
  is still cached anywhere, deletion is what makes it inert.
- The only browser-visible key should now be the Firebase web `apiKey`;
  keep its API restrictions scoped to the Firebase services in use.

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
5. Confirm the bundle is key-free: the build already fails on any
   key-shaped string via `scripts/check-bundle-for-secrets.mjs`, but a
   manual `grep -R "AIza" dist/` should match only the Firebase web
   `apiKey`.

### 5. Rotating the keys

**Server-side `GEMINI_API_KEY`** (used by the broker):
1. Mint a new key in GCP Console.
2. `firebase functions:secrets:set GEMINI_API_KEY` and paste the new value.
3. `firebase deploy --only functions` to redeploy with the new secret.
4. Delete the old key in GCP Console.

There is no client-side Gemini key to rotate — the browser only ever
holds single-use ephemeral tokens minted by `mintGeminiLiveToken`.
