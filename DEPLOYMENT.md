# CarBot Deployment Checklist

## API key hardening (SECURITY_REVIEW H1 mitigation)

The `VITE_GEMINI_API_KEY` ships in the client bundle — the Gemini Live
WebSocket has no server-side proxy. The only mitigation is aggressive
referrer restrictions in Google Cloud Console so the key is useless if
extracted. Voice quota (per-user minute cap, enforced server-side in
`checkAndReserveVoiceQuota`) bounds the blast radius if abuse happens.

Every time a new hosting domain is added or a new Gemini key is minted,
walk this checklist:

### 1. Gemini API key — Generative Language API

Google Cloud Console → APIs & Services → Credentials → the key used for
`VITE_GEMINI_API_KEY`.

- **Application restrictions**: HTTP referrers.
  - `https://carbot-andybrook.web.app/*`
  - `https://carbot-andybrook.firebaseapp.com/*`
  - `http://localhost:5173/*` (only during active dev; remove before rotating)
- **API restrictions**: restrict to "Generative Language API" only.
- **Quotas**: confirm per-day caps on "Generate Content Requests" are
  low enough that a leak can't drain the project budget before you notice.

### 2. Maps API key — server-side only

This key lives in Firebase Secret Manager (`GOOGLE_MAPS_API_KEY`) and is
consumed by `geoProxy`. It must NOT be referrer-restricted — Cloud
Functions calls don't send a browser referrer.

- **Application restrictions**: None (or IP-restricted to GCF egress).
- **API restrictions**: Geocoding API + Maps Weather API only.
- Confirm the key is NOT in any `.env` file checked into git. (`git log
  --all -- .env.local` was verified empty for this repo.)

### 3. Post-deploy smoke test

After hosting deploy:
1. Open the hosting URL, sign in with Google.
2. Start a voice session; verify it connects (Gemini key works from the
   allowed referrer).
3. Verify geo lookups work (ask the bot "where am I?" — it should
   reverse-geocode successfully).
4. From a browser on a different domain, paste the key into a Gemini API
   cURL — it should return `403`. If it doesn't, referrer restrictions
   are not in effect yet.

### 4. Rotating the key

If the key is suspected compromised:
1. Mint a new key in GCP Console with the restrictions above pre-applied.
2. Update `.env.production` locally, rebuild, redeploy hosting.
3. Delete the old key in GCP Console.
4. Watch `functions` logs for any 403s (indicates stragglers still using
   the old key).
