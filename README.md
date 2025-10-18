## SNS Analytics & Publishing Hub

Internal tool for analysing X (Twitter) and Threads posts, generating AI-assisted drafts, and managing scheduled publishing. All data is stored in Firestore and recurring jobs run via GitHub Actions (no Cloud Functions required).

### Highlights
- Manual or scripted sync (`npm run sync:posts`) for linked accounts. Scoring uses the weighted formula plus impression fallbacks.
- Ranking view with period / media-type / platform filters and links back to the source post.
- Draft generation powered by OpenAI with similarity warnings and optional scheduling slots (today / tomorrow / next week × morning, noon, night).
- OAuth 2.0 PKCE flow for X and Threads, plus a manual registration form for pasting tokens.
- GitHub Actions workflows for post sync, schedule execution, and token refresh.

### Authentication
1. **OAuth 2.0 flow** – `/accounts/connect` → “認可フローを開始” redirects to the provider. Callback `/api/oauth/[platform]/callback` exchanges tokens and stores them in Firestore.
2. **Manual registration** – The form on `/accounts/connect` accepts:
   - OAuth 2.0 Bearer tokens (with optional refresh token / expiry / scopes).
   - OAuth 1.0a credentials (Consumer Key, Consumer Secret, Access Token, Access Token Secret). These are saved with `oauth_version: "oauth1"` so legacy keys such as `TWITTER_APP_KEY / TWITTER_APP_SECRET / TWITTER_ACCESS_TOKEN / TWITTER_ACCESS_SECRET` work without PKCE.

### Tech Stack
- **Frontend**: Next.js App Router, Tailwind CSS
- **Data**: Firestore (Admin SDK on the server, Web SDK on the client)
- **Integrations**: Twitter API v2 (`twitter-api-v2`), Threads Graph API (placeholder), OpenAI Responses & Embeddings
- **Automation**: Node scripts (`tsx`) + GitHub Actions

### Directory Layout
```
src/
  app/                 # App Router pages & API routes
  components/          # UI components (layout, filters, generator UI, etc.)
  lib/
    firebase/          # Firebase initialisers
    oauth/             # PKCE utilities
    platforms/         # X / Threads API adapters (OAuth2 + OAuth1)
    services/          # Firestore, sync, scheduling, token helpers
    scoring.ts         # Score calculation helper
scripts/               # Node entry points for GitHub Actions / local runs
.github/workflows/     # Cron-style automations (sync / scheduler / refresh)
```

### Setup
1. Copy `.env.example` to `.env` and fill Firebase, OpenAI, X, and Threads credentials.
   - `FIREBASE_SERVICE_ACCOUNT` accepts JSON or Base64.
   - `X_REDIRECT_URI` & `THREADS_REDIRECT_URI` must match the callback URLs registered in each developer portal (e.g. `http://localhost:3000/api/oauth/x/callback`).
   - `X_SCOPES` / `THREADS_SCOPES` define requested permissions.
   - For OAuth 1.0a fallback, provide `TWITTER_APP_KEY`, `TWITTER_APP_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`.
2. Install dependencies: `npm install`
3. Run local dev server: `npm run dev`

### Handy Commands
| Command | Description |
| --- | --- |
| `npm run sync:posts` | Fetch posts for linked accounts and recompute scores. |
| `npm run sync:schedules` | Publish scheduled drafts and update status. |
| `npm run sync:refresh-tokens` | Refresh OAuth tokens that are about to expire. |

### GitHub Actions
- `sync.yml` – every 3 hours (and manual) to import posts.
- `scheduler.yml` – hourly execution of scheduled drafts.
- `refresh-tokens.yml` – daily token refresh.  
  Configure repository secrets (`FIREBASE_SERVICE_ACCOUNT`, `OPENAI_API_KEY`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `THREADS_APP_ID`, `THREADS_APP_SECRET`, etc.).

### Firestore Collections
- `/accounts` – platform metadata, OAuth tokens (including OAuth1 fields), sync cursors, error states.
- `/posts` – normalised post data with metrics, score, raw payload or GCS URL.
- `/drafts` – generated drafts with status (`draft`/`scheduled`/`published`) and schedule slot.
- `/settings/default` – scoring configuration, generation preferences, slot templates, timezone.
- `/logs` – sync / post / error entries (JSON detail).

### Recommended Follow-up
1. Register OAuth apps for each platform and confirm callback URLs match `.env`.
2. Update Threads integration once the official API release stabilises (token exchange, scopes).
3. Add integration tests with Firebase Emulator and mocked platform APIs as your workflow matures.
