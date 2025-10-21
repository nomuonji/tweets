## SNS Analytics & Publishing Hub

Internal tool for analysing X (Twitter) and Threads posts, generating AI-assisted drafts, and managing scheduled publishing. All data is stored in Firestore and recurring jobs run via GitHub Actions (no Cloud Functions required).

### Highlights
- Manual or scripted sync (`npm run sync:posts`) for linked accounts. Scoring uses the weighted formula plus impression fallbacks.
- Ranking view with period / media-type / platform filters and links back to the source post.
- Draft generation powered by Gemini with similarity warnings, guided by configurable "Tips" and account-specific "Exemplary Posts". A prompt preview is available within the generator.
- OAuth 2.0 PKCE flow for X and Threads, plus a manual registration form for pasting tokens.
- GitHub Actions workflows for post sync, schedule execution, and token refresh.

### Authentication
1. **OAuth 2.0 flow**  E`/accounts/connect` ↁE“認可フローを開始 Eredirects to the provider. Callback `/api/oauth/[platform]/callback` exchanges tokens and stores them in Firestore.
2. **Manual registration**  EThe form on `/accounts/connect` accepts:
   - OAuth 2.0 Bearer tokens (with optional refresh token / expiry / scopes).
   - OAuth 1.0a credentials (Consumer Key, Consumer Secret, Access Token, Access Token Secret). These are saved with `oauth_version: "oauth1"` so legacy keys such as `TWITTER_APP_KEY / TWITTER_APP_SECRET / TWITTER_ACCESS_TOKEN / TWITTER_ACCESS_SECRET` work without PKCE.

### Tech Stack
- **Frontend**: Next.js App Router, Tailwind CSS
- **Data**: Firestore (Admin SDK on the server, Web SDK on the client)
- **Integrations**: Twitter API v2 (`twitter-api-v2`), Threads Graph API (official), OpenAI Responses & Embeddings
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
   - Capture Threads access tokens per account via the manual registration form (include the numeric `Threads user ID`). `.env` values (`THREADS_ACCESS_TOKEN`, `THREADS_USER_ID`) are optional fallbacks for legacy setups.
   - For OAuth 1.0a fallback, provide `TWITTER_APP_KEY`, `TWITTER_APP_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`.
2. Install dependencies: `npm install`
3. Run local dev server: `npm run dev`

### Handy Commands
| Command | Description |
| --- | --- |
| `npm run sync:posts` | Fetch posts for linked accounts and recompute scores. |
| `npm run sync:schedules` | Publish scheduled drafts and update status. |
| `npm run sync:refresh-tokens` | Refresh OAuth tokens that are about to expire. |

### Sync Behaviour
- Default fetch limits per run: X ↁE20 posts, Threads ↁE100 posts. Override by passing `maxPosts` to the sync API or raising the `SYNC_MAX_POSTS` cap.
- Threads sync uses the official Graph API with pagination (100 items per page) until the configured limit is reached.

### GitHub Actions
- `sync.yml`  Eevery 3 hours (and manual) to import posts.
- `scheduler.yml`  Ehourly execution of scheduled drafts.
- `refresh-tokens.yml`  Edaily token refresh.  
  Configure repository secrets (`FIREBASE_SERVICE_ACCOUNT`, `OPENAI_API_KEY`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `THREADS_APP_ID`, `THREADS_APP_SECRET`, etc.).

### Firestore Collections
- `/accounts`  Eplatform metadata, OAuth tokens (including OAuth1 fields), sync cursors, error states.
- `/posts`  Enormalised post data with metrics, score, raw payload or GCS URL.
- `/drafts`  Egenerated drafts with status (`draft`/`scheduled`/`published`) and schedule slot.
- `/tips`  EGlobal knowledge base of tips for writing effective posts. Managed at `/tips`.
- `/accounts/{accountId}/exemplary_posts`  EAccount-specific posts to guide the AI on style and tone. Managed on the dashboard.
- `/settings/default`  Escoring configuration, generation preferences, slot templates, timezone.

### Recommended Follow-up
1. Register OAuth apps for each platform and confirm callback URLs match `.env`.
2. When adding a Threads account manually, enter the numeric user ID (e.g. `31573770612207145`) and bearer token in the form so they persist with the account. Use `.env` only if you need project-wide fallbacks.
3. Add integration tests with Firebase Emulator and mocked platform APIs as your workflow matures.
