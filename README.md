# Mihad AI

**Mihad AI** is a deployment-ready, mobile-first SaaS workspace for authorized YouTube operations. It combines multi-channel OAuth, resumable job records, uploads, safe bulk editing, metadata analysis, creative assistance, public URL analysis, operational analytics, and API readiness in a premium black-and-neon interface.

> Mihad AI uses the official YouTube Data API v3. It does not scrape YouTube, download videos, bypass access controls, or modify content outside channels explicitly authorized by the signed-in user.

## Product surface

- Secure account registration and session authentication
- Google OAuth 2.0 channel connection, refresh-token support, sync, revocation, and removal
- Video upload, optional thumbnail, playlist assignment, privacy, future publishing, progress, history, and retained-file retry
- Verified bulk title, description, tag, privacy, and playlist operations for owned channel videos
- Explainable 100-point SEO analysis and best-practice checklist
- AI/title/description/hashtag/tag/thumbnail-brief generation with an optional OpenAI-compatible provider and a safe local template fallback
- Official-API public URL analyzer with metadata, statistics, and available thumbnail sizes
- Workspace upload analytics, channel snapshots, audit activity, and estimated API quota accounting
- Profile, notification, password, appearance, and server-side API readiness screens
- Responsive Android-friendly interface with accessible touch targets, reduced-motion support, loading/empty/error states, and no frontend framework runtime

## Stack

| Layer | Technology |
|---|---|
| UI | Semantic HTML5, modular ES JavaScript, responsive CSS |
| API | Node.js 20+, Express 5 |
| Data | MongoDB / Mongoose |
| Auth | Server sessions, bcrypt, CSRF protection, Google OAuth 2.0 |
| YouTube | `googleapis` / YouTube Data API v3 |
| Security | Helmet CSP, HttpOnly cookies, rate limits, AES-256-GCM token encryption, input validation |
| Runtime | Docker-ready, graceful shutdown, health check, structured Pino logs |

## Project structure

```text
mihad-ai/
├── public/
│   ├── index.html                 # Application workspace
│   ├── login.html                 # Login and registration
│   └── assets/
│       ├── css/styles.css         # Complete mobile-first design system
│       ├── img/logo.svg
│       └── js/                    # API client, UI helpers, icons, app modules
├── src/
│   ├── config/                    # Environment, DB, Google, logging
│   ├── middleware/                # Auth, CSRF, validation, errors, multipart
│   ├── models/                    # User, channel, upload, activity, quota
│   ├── routes/                    # Auth, YouTube, dashboard, tools, settings
│   ├── services/                  # OAuth/API, encryption, AI, SEO, quota, cleanup
│   └── utils/
├── storage/tmp/                   # Retained upload files (gitignored)
├── tests/
├── Dockerfile
├── .env.example
└── server.js
```

## Local setup

### Prerequisites

- Node.js 20 or newer
- MongoDB 6+ (local or managed)
- A Google Cloud project with YouTube Data API v3 enabled

### Install and run

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`. Before channel connection, configure the Google variables described below.

Generate production secrets:

```bash
openssl rand -base64 48       # SESSION_SECRET
openssl rand -base64 32       # TOKEN_ENCRYPTION_KEY
```

## Google Cloud and OAuth configuration

1. Create or select a project in Google Cloud Console.
2. Enable **YouTube Data API v3**.
3. Configure the OAuth consent screen with accurate product, homepage, privacy policy, and terms URLs.
4. Create an **OAuth client ID → Web application**.
5. Add an exact authorized redirect URI:
   - Local: `http://localhost:3000/api/youtube/oauth/callback`
   - Production: `https://your-domain.example/api/youtube/oauth/callback`
6. Put the client ID, client secret, and exact redirect URI in `.env`.
7. Create a separate YouTube Data API key for public URL analysis. Restrict it to the YouTube Data API and, where supported by the deployment architecture, the production server's IP/network. The key is used only server-side.
8. Complete Google's OAuth verification before broad public use. The requested YouTube scopes can require review. Do not publish an unverified app beyond Google's permitted test-user limits.

Requested scopes:

```text
https://www.googleapis.com/auth/youtube.upload
https://www.googleapis.com/auth/youtube.force-ssl
openid
email
```

OAuth uses a short-lived session state value, offline access, encrypted token storage, and Google token refresh events. Disconnecting a channel calls Google's revocation endpoint and removes the encrypted local record.

## Environment variables

See [`.env.example`](./.env.example) for every variable.

| Variable | Required in production | Purpose |
|---|---:|---|
| `MONGODB_URI` | Yes | Application and session database |
| `SESSION_SECRET` | Yes | Session-cookie signing secret |
| `TOKEN_ENCRYPTION_KEY` | Yes | 32-byte base64 key for OAuth tokens |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth web client |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Yes | Exact registered OAuth callback |
| `YOUTUBE_API_KEY` | For URL Analyzer | Server-only public Data API key |
| `AI_API_KEY` | No | OpenAI-compatible generation provider |
| `AI_BASE_URL` / `AI_MODEL` | No | Provider endpoint and model |
| `YOUTUBE_DAILY_QUOTA` | No | UI quota ceiling, default 10,000 |
| `MAX_VIDEO_SIZE_MB` | No | Multipart video limit |
| `ALLOWED_ORIGINS` | Yes | Comma-separated browser origins |

Never commit `.env`. Rotate secrets after any suspected exposure.

## Upload pipeline

1. The browser displays network transfer progress with `XMLHttpRequest.upload`.
2. Multer validates file count, type, and configured size before writing a randomized temporary path.
3. The API validates channel ownership, title, privacy, schedule, and retained file metadata.
4. A MongoDB upload job is created before processing.
5. A worker atomically claims the queued job so two instances cannot publish it twice.
6. The selected channel's encrypted OAuth tokens are decrypted only server-side, and Google handles access-token refresh.
7. The video is inserted, followed by optional thumbnail and playlist operations.
8. Successful temporary files are removed. Failed files remain for the configured retry window.
9. On restart, stale jobs are recovered and re-queued.

For multiple production instances, mount `storage/tmp` on shared persistent encrypted storage, or replace the local storage adapter with object storage. Without shared storage, route upload jobs to a single worker instance. YouTube uploads are expensive (approximately 1,600 quota units), so set deployment timeouts accordingly.

### Scheduling rule

YouTube requires a scheduled video to be uploaded as `private` with a future `publishAt`; Mihad AI therefore accepts scheduling only when **Public** is selected as the final visibility and requires at least 15 minutes of lead time.

## Security decisions

- API keys and OAuth tokens never appear in frontend bundles or JSON responses.
- OAuth access/refresh tokens are encrypted with AES-256-GCM at rest.
- All state-changing browser requests require a session-bound CSRF token.
- Session cookies are HttpOnly, SameSite=Lax, and Secure in production.
- Auth endpoints are rate-limited; passwords use bcrypt with cost 12.
- Helmet sets a restrictive CSP and other defensive headers.
- Mongoose filters are sanitized; route payloads have explicit size and shape limits.
- Every channel-scoped query includes the signed-in user's ID.
- Bulk editing first retrieves every requested video and verifies `snippet.channelId` against the selected authorized channel.
- Logs redact authorization headers and token/password fields.
- Activity records provide a six-month operational audit trail.

Before launch, add your legal URLs, a password-reset email workflow, backups, secret rotation, alerting, and a documented account-deletion/data-retention flow.

## Quota behavior

The app records estimated units for API calls it makes. Costs include uploads, updates, thumbnail operations, and playlist inserts. This meter is operational guidance only; **Google Cloud Console is the source of truth**, especially if the same Cloud project is used by other services.

## Deployment

### Docker

```bash
docker build -t mihad-ai .
docker run --rm -p 3000:3000 --env-file .env \
  -v mihad-upload-cache:/app/storage/tmp mihad-ai
```

Place the app behind a TLS reverse proxy, set `APP_URL` and `GOOGLE_REDIRECT_URI` to HTTPS URLs, set `TRUST_PROXY=1`, and use a managed MongoDB deployment with TLS and backups.

### Health check

```text
GET /health
```

A healthy process returns JSON and reports whether the database is connected.

## Tests

```bash
npm test
npm run check
```

## Main API routes

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `GET /api/youtube/oauth/start`, `GET /api/youtube/oauth/callback`
- `GET /api/youtube/channels`, channel sync/remove/playlists/videos routes
- `POST /api/youtube/uploads`, upload history and retry routes
- `POST /api/youtube/bulk-update`
- `POST /api/youtube/analyze`
- `POST /api/tools/seo/analyze`, `POST /api/tools/ai/generate`
- `GET /api/dashboard`, `GET /api/dashboard/api-status`
- Profile, password, and preference routes under `/api/settings`

## YouTube policy posture

This project is intentionally designed around official APIs and explicit user authorization. Product copy should not imply affiliation with or endorsement by YouTube or Google. Keep the OAuth consent screen, Privacy Policy, data-retention statement, and actual application behavior synchronized. Review the current YouTube API Services Terms of Service and Developer Policies before each production release.
