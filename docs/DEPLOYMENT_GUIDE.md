# Deployment guide

How to take ConductNexus from this repository to production: MongoDB Atlas, the API on
Render, the web/PWA on Firebase Hosting, and the native apps through EAS.

The checked-in `render.yaml` and `firebase.json` already encode most of the configuration
described here.

---

## 1. Prerequisites

| Item | Purpose |
| --- | --- |
| GitHub repository | `code-jocker/Conductnexus` — Render and EAS build from it |
| MongoDB Atlas cluster | Database (M7+ locally for development, Atlas for production) |
| Render account | API hosting with a persistent disk for uploads/backups |
| Firebase project | Hosting for the web app (`e-visitors-d4830`) and Google Sign-In |
| Expo account | EAS builds for Android/iOS (optional until you ship native apps) |
| Domain / HTTPS | Required for secure cookies, PWA installability and push |

Node.js **20+** (22 LTS recommended) is used on Render via `NODE_VERSION`.

---

## 2. Environment variables

### Backend (`backend/.env`, Render environment)

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` on Render |
| `PORT` | yes | Render injects it |
| `APP_URL` | yes | Public web origin, e.g. `https://e-visitors-d4830.web.app` |
| `CORS_ORIGIN` | yes | Comma-separated allowed origins — include the Firebase domains |
| `MONGODB_URI` | yes | Atlas SRV URI with URL-encoded password |
| `JWT_ACCESS_SECRET` | yes | ≥ 16 chars; Render can generate it |
| `ACCESS_TOKEN_TTL` | no | Default `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | no | Default `14` |
| `FIREBASE_PROJECT_ID` | for Google sign-in | Must match the frontend project |
| `SMTP_*`, `MAIL_FROM` | for email | Verification, reset, letters |
| `BACKUP_ENCRYPTION_KEY` | for backups | 64 hex characters — store outside Git |
| `BACKUP_SCHEDULE` | no | Cron, default `0 2 * * *` |
| `BACKUP_RETENTION_DAYS` | no | Default `30` |
| `ENABLE_WHATSAPP` | no | Requires Chromium/Edge on the host; keep `false` on free tiers |
| `WHATSAPP_PAIR_PHONE` | no | Digits with country code for pairing-code linking |
| `EXPO_ACCESS_TOKEN` | for push | Only if Expo enhanced push security is enabled |
| `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` | for SMS | SMS stays off until enabled in Settings |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SCHOOL_NAME` | first run only | Used by `npm run setup` |

Never put these values in the repository or in chat.

### Web (`frontend/.env.production`)

| Variable | Example |
| --- | --- |
| `VITE_API_URL` | `https://conductnexus-api.onrender.com/api/v1` |
| `VITE_SOCKET_URL` | `https://conductnexus-api.onrender.com` |
| `VITE_FIREBASE_*` | Public Firebase web config |
| `VITE_SCHOOL_NAME` | `ConductNexus` |

### Mobile (`mobile/.env`)

| Variable | Example |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | `https://conductnexus-api.onrender.com/api/v1` |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | From `eas init` |
| `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` | Google OAuth client ids |
| `EXPO_PUBLIC_FIREBASE_*` | Same Firebase project as the backend |

`mobile/README.md` covers emulator hosts (`10.0.2.2`), LAN testing and store builds.

---

## 3. Database

1. Create an Atlas cluster and a database user with read/write access.
2. Network access: allow Render egress. Free Render services do not have static egress IPs,
   so either allow `0.0.0.0/0` (with strong credentials and TLS) or upgrade for static IPs.
3. Use a replica set URI (Atlas default) — the ledger relies on transactional behaviour
   and retries on write conflicts (`balanceVersion`).
4. Set `MONGODB_URI` in Render, including `retryWrites=true&w=majority`.

### First-run initialization

Either:

- Open the web app and complete the setup wizard, or
- Run `npm run setup` with `ADMIN_*` variables set against the production database.

This seeds roles, offences, templates, classes, streams, dormitories and the active term.
Do not run `seed:demo` in production — it refuses when `NODE_ENV=production`.

---

## 4. API on Render

`render.yaml` defines the service:

```yaml
rootDir: backend
buildCommand: npm ci && npm run build
startCommand: npm start
healthCheckPath: /api/v1/health
```

Steps:

1. Create a new Blueprint/Web Service from the repository.
2. Apply `render.yaml`, then fill the `sync: false` variables in the dashboard.
3. Add a **persistent disk** mounted at `backend/storage` (evidence) and
   `backend/backups`, or move evidence to object storage before scaling past one instance.
4. Deploy and confirm `GET /api/v1/health` returns healthy.
5. Open `https://<service>.onrender.com/api/docs` to confirm the API is live.

### Workers and schedules

- Communication queue processing runs on an interval inside the API process and recovers
  abandoned `sending` leases automatically (crash-safe). A manual "Process now" action
  exists at `POST /notifications/queue/process`.
- Backup schedules use node-cron. Free Render instances sleep; use an always-on instance or
  a Render Cron Job that calls the backup action.
- Only run **one** API instance against a WhatsApp session. WhatsApp session files must live
  on the persistent disk and must never be committed.

### Health endpoints

| Endpoint | Purpose |
| --- | --- |
| `/api/v1/health` | Liveness and database ping |
| `/api/v1/system/health` | Detailed health for operators |
| `/api/v1/system/queue-failures` | Queue problems |
| `/api/v1/system/ledger-health` | Ledger integrity summary |
| `/api/v1/discipline/ledger/reconciliation` | Full per-term reconciliation (`reports.view`) |

---

## 5. Web on Firebase Hosting

```bash
cd frontend
# point the build at Render
echo "VITE_API_URL=https://conductnexus-api.onrender.com/api/v1" > .env.production
echo "VITE_SOCKET_URL=https://conductnexus-api.onrender.com" >> .env.production

npm run build
cd ..
npx firebase deploy --only hosting --project e-visitors-d4830
```

`firebase.json` provides:

- SPA rewrite to `index.html`
- Long-lived immutable caching for hashed assets
- `no-cache` for `index.html`, `sw.js` and `manifest.webmanifest` so PWA updates roll out
- `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and `Permissions-Policy`

Add the Firebase domain(s) to `CORS_ORIGIN` before testing sign-in.

### PWA verification after deploy

1. Open the site over HTTPS, sign in, then use the browser's install action.
2. DevTools → Application → Service Workers: `sw.js` is **activated**.
3. DevTools → Application → Cache Storage: `conductnexus-v1-shell` contains `/`,
   `index.html`, `offline.html`, the manifest and icons.
4. Enable "Offline" and reload: the offline page or cached shell appears; API calls fail
   gracefully and the app shows the offline banner.
5. Deploy a new build and reload: the update banner appears; applying it reloads once.

---

## 6. Native apps (Android / iOS)

```bash
cd mobile
npm install
npx expo start          # development
npx eas build --platform android --profile preview
npx eas build --platform ios --profile preview
```

Requirements:

- EAS project id in `EXPO_PUBLIC_EAS_PROJECT_ID`
- Google OAuth client ids for Google sign-in (web client id is required)
- Firebase web config for the same project
- Push: `expo-notifications` credentials configured in EAS; optionally set
  `EXPO_ACCESS_TOKEN` on the API
- iOS builds require an Apple Developer account; Android requires a signing key

Before submitting:

- Set `EXPO_PUBLIC_API_URL` to the production API.
- Verify sign-in, incident draft + offline sync, parent portal, session revocation and push.
- Update the privacy policy URL in the store listing to your hosted policy.

---

## 7. Backups and restore drills

1. Set `BACKUP_ENCRYPTION_KEY` (64 hex chars) and keep a copy in a password manager.
2. Confirm scheduled backups appear under **Settings → Backups**.
3. Run `POST /backups/:id/restore-test` on a schedule — it verifies the archive can be
   decrypted and parsed without touching production data.
4. For a real restore, stop writes, restore, then run ledger reconciliation and spot-check
   recent incidents, messages and audit logs.
5. Backups contain personal data: download only to a managed machine and delete afterwards.

---

## 8. Release checklist

- [ ] `npm test` (23 tests) passes against MongoDB
- [ ] `npm run typecheck` passes for backend, frontend and mobile
- [ ] Backend and frontend builds succeed
- [ ] `JWT_ACCESS_SECRET` and `BACKUP_ENCRYPTION_KEY` are strong and unique
- [ ] `CORS_ORIGIN` lists only real production origins
- [ ] No `.env`, service account files, WhatsApp sessions or storage folders are committed
- [ ] Health, docs and login work on the deployed API
- [ ] PWA install, offline fallback and update flow verified over HTTPS
- [ ] Test accounts removed or deactivated; real admin uses a school email
- [ ] Push/SMS/WhatsApp channels tested with one real guardian before term start
- [ ] Reconciliation report is healthy after the first week of use

---

## 9. Rollback

- **Web**: redeploy the previous build (`firebase hosting:releases:list`, then roll back or
  re-deploy the earlier commit).
- **API**: redeploy the previous Render commit. Database migrations are additive; keep them
  backwards compatible for one release.
- **Mobile**: submit a new build; native stores do not allow rollback, so stage releases.
- **Data**: restore from the last verified backup only after exporting the current state and
  recording the incident in the breach/audit module.

---

## 10. Troubleshooting quick reference

| Symptom | Check |
| --- | --- |
| Frontend "Cannot reach the server" | `VITE_API_URL`, API health, `CORS_ORIGIN` exact match |
| 401 after 15 minutes | HTTPS + `NODE_ENV=production` so the refresh cookie is `SameSite=None; Secure` |
| Google button says not configured | `VITE_FIREBASE_*` values and a rebuild |
| PWA does not update | `sw.js` must be served with `no-cache`; verify `firebase.json` headers |
| WhatsApp disconnects after deploy | Session directory not on a persistent disk, or multiple instances sharing one session |
| Push not received | Expo token registered (`/auth/push-token`), EAS credentials valid, `EXPO_ACCESS_TOKEN` if enhanced security |
| Ledger reconciliation issues | Do not edit rows; post a compensating adjustment via approvals, then re-run reconciliation |

---

See [`SECURITY_AND_PRIVACY.md`](SECURITY_AND_PRIVACY.md) before go-live and
[`API_REFERENCE.md`](API_REFERENCE.md) for endpoint details.
