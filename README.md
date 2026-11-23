# ConductNexus

**School conduct & discipline management platform** — conduct marks, incident workflow, safeguarding, parent communication, reporting and compliance for Rwandan secondary schools.

- Web app (Firebase Hosting): `https://e-visitors-d4830.web.app`
- API (Render): `https://conductnexus-api.onrender.com` — see [Deployment](#deployment)
- API docs (Swagger): `/api/docs` · OpenAPI JSON: `/api/docs.json`

---

## Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Quick start](#quick-start)
4. [Configuration](#configuration)
5. [Scripts](#scripts)
6. [Demo accounts](#demo-accounts)
7. [Roles](#roles)
8. [How the conduct ledger works](#how-the-conduct-ledger-works)
9. [API](#api)
10. [Testing](#testing)
11. [Deployment](#deployment)
12. [Maintenance without a developer](#maintenance-without-a-developer)
13. [Data protection (Rwanda)](#data-protection-rwanda)
14. [Security notes](#security-notes)
15. [Troubleshooting](#troubleshooting)
16. [Cross-platform apps](#cross-platform-apps)
17. [Documentation](#documentation)

---

## Features

### Core discipline
- Students, guardians, classes, streams, dormitories, academic years and terms.
- Configurable offence catalogue with deduction scales, severity, evidence and approval rules.
- Incident workflow: draft → submitted → under review → approved / rejected / escalated, with **independent review** (a reporter cannot review or approve their own incident).
- Immutable conduct ledger starting at **40 marks per term**, with compensating entries, reversals and balance versioning. Marks never drift.
- Approvals queue, bulk reviews and reason-required decisions.
- Risk engine (low / medium / high / critical), blacklist and watchlist, interventions, follow-ups and recognition.
- Letters and PDFs from editable templates (warning, meeting, hearing, suspension, expulsion, conduct report), plus WhatsApp / email / in-app notifications with consent and opt-out handling.
- Reports and analytics with CSV/PDF export.

### Extended governance
- Safeguarding cases with restricted access, secure evidence uploads and escalation.
- Formal investigations with evidence, findings and decisions.
- Appeals with independent decision authority and deadline tracking.
- Recognition and positive behaviour records.
- Staff assignments (class teacher, dormitory patron/matron, case owner).
- Policy versioning with publication and acknowledgement tracking.
- Meetings, minutes and action items.
- Rwanda Law No. 058/2021 data-protection tools: consent, retention, subject requests, breach register and export.
- Encrypted backups, restore, health/monitoring, audit trail, real-time notifications (Socket.IO), offline draft recovery, English/Kinyarwanda and Africa/Kigali localization.
- Parent portal (consent-gated) showing only linked children.

### Experience
- Mobile-first layouts: card lists on phones, full tables on desktop.
- Installable PWA: web manifest, app-shell service worker, offline fallback page, in-app install and update prompts.
- Offline-first incident drafting on web (IndexedDB) and mobile (SQLite) with idempotent sync over `clientSubmissionId`.
- Native Android and iOS apps (Expo / React Native) sharing the same API and discipline rules — staff workflow plus consent-gated parent portal.
- Light/dark themes with the ConductNexus navy/indigo + ochre identity.
- Route-level code splitting, accessible navigation and keyboard-friendly tables.
- Google Sign-In (Firebase), email verification and password reset codes/links.

---

## Architecture

```
conductnexus/
├─ backend/                 Express + TypeScript + MongoDB API
│  ├─ src/
│  │  ├─ config/            env, database, startup
│  │  ├─ models/            Mongoose models (core, school, discipline, communications, governance, support)
│  │  ├─ routes/            REST modules mounted at /api/v1
│  │  ├─ services/          business rules: ledger, incidents, risk, RBAC, comms, backups…
│  │  ├─ middleware/        auth, validation, rate limits, errors
│  │  ├─ shared/            permissions, role seeds, errors, logger, http helpers
│  │  ├─ docs/              OpenAPI 3 document
│  │  └─ scripts/           setup, seed, demo seed, admin recovery
│  └─ vitest.config.ts
├─ frontend/                React 18 + Vite + Tailwind SPA (installable PWA)
│  ├─ public/               manifest, service worker, offline fallback, icons
│  └─ src/
│     ├─ pages/             dashboard, incidents, students, safeguarding, settings…
│     ├─ components/        layout, UI primitives, charts, PWA banners
│     ├─ lib/               API client, auth context, Firebase, offline store, types, utils
│     └─ styles/
├─ mobile/                  Expo / React Native app (Android + iOS)
│  ├─ app/                  Expo Router routes: (auth), (staff), (parent), incident, student…
│  └─ src/                  API client, native auth, SQLite drafts, push, theme
├─ docs/                    API reference, security & privacy, deployment guide
├─ firebase.json            Firebase Hosting (SPA rewrites, caching, headers)
├─ .firebaserc              default project: e-visitors-d4830
└─ render.yaml              Render blueprint for the API
```

**Stack**

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS 3, React Router 6, TanStack Query 5, Recharts, Socket.IO client, Firebase JS SDK |
| Mobile | Expo SDK 58, React Native 0.88, Expo Router, TanStack Query, Expo SecureStore / SQLite / Notifications |
| Backend | Node.js 20+, Express 4, TypeScript (ESM), Mongoose 8, Zod, JWT, Pino, Socket.IO, Swagger UI |
| Data | MongoDB 7 (local or Atlas) |
| Files | Local evidence storage (`backend/storage`) — use a Render disk or object storage in production |
| Tests | Vitest + Supertest against a real MongoDB test database |

---

## Quick start

### Requirements
- Node.js **20+** (tested on 22/24)
- MongoDB **7+** locally, or a MongoDB Atlas connection string
- npm 10+

### 1. Install

```bash
npm run install:all
```

### 2. Configure

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Put it in `backend/.env` as `JWT_ACCESS_SECRET`. Set `MONGODB_URI` if your MongoDB is not on the default local port.

Windows PowerShell equivalent: `Copy-Item backend/.env.example backend/.env`.

### 3. Run

```bash
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000
- Swagger: http://localhost:4000/api/docs

On a fresh database the app opens the **first-run setup wizard**, which creates the school profile, the admin account, roles, offences, templates, classes, streams, dormitories and the active academic year/terms.

### 4. Or seed from the command line

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD` and optionally `SCHOOL_NAME` in `backend/.env`, then:

```bash
npm run setup
```

For a full demo dataset (24 students, guardians, incidents, interventions):

```bash
npm run seed:demo
```

Demo seeding refuses to run with `NODE_ENV=production`.

---

## Configuration

### Backend (`backend/.env`)

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | yes | `development` / `test` / `production` |
| `PORT` | no | API port (default `4000`; Render sets `10000`) |
| `APP_URL` | yes | Public web app URL used in email links |
| `CORS_ORIGIN` | yes | Comma-separated allowed origins (add the Firebase Hosting domains) |
| `MONGODB_URI` | yes | MongoDB / Atlas connection string |
| `JWT_ACCESS_SECRET` | yes | ≥16 chars; use 48 random bytes |
| `ACCESS_TOKEN_TTL` | no | Access token lifetime (default `15m`) |
| `REFRESH_TOKEN_TTL_DAYS` | no | Refresh session lifetime (default `14`) |
| `FIREBASE_PROJECT_ID` | for Google | Firebase project ID (`e-visitors-d4830`) |
| `SMTP_*`, `MAIL_FROM` | no | Email delivery; without SMTP the dev outbox is used |
| `BACKUP_ENCRYPTION_KEY` | no | 64 hex chars; falls back to a key derived from the JWT secret |
| `BACKUP_SCHEDULE` | no | Cron expression (default `0 2 * * *`) |
| `BACKUP_RETENTION_DAYS` | no | Backup retention (default `30`) |
| `ENABLE_WHATSAPP`, `WHATSAPP_SESSION` | no | Optional WhatsApp worker |
| `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` | no | Africa's Talking SMS gateway. SMS is only sent when an administrator enables it in **Settings → Communications**; WhatsApp remains the default channel. |
| `UPLOAD_DIR` | no | Evidence directory (default `storage/evidence`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | no | Only used by `npm run setup` / `npm run seed` |

### Frontend (`frontend/.env`)

| Variable | Description |
| --- | --- |
| `VITE_API_URL` | `/api/v1` in development (Vite proxy); the full API URL in production |
| `VITE_SOCKET_URL` | API origin for Socket.IO in production (empty = same origin) |
| `VITE_FIREBASE_API_KEY` | Firebase web config |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase web config |
| `VITE_FIREBASE_PROJECT_ID` | Firebase web config |
| `VITE_FIREBASE_APP_ID` | Firebase web config |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase web config |
| `VITE_FIREBASE_STORAGE_BUCKET` | Optional, for future storage features |

Firebase web keys are public client identifiers, not server secrets. **Never commit** `backend/.env`, `frontend/.env`, service-account JSON or `BACKUP_ENCRYPTION_KEY`.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API + web dev servers together |
| `npm run build` | Type-check and build both apps |
| `npm start` | Run the built API (`backend/dist/server.js`) |
| `npm test` | Backend integration tests (requires MongoDB on `127.0.0.1:27017`) |
| `npm run setup` | Seed RBAC + school defaults + admin from env |
| `npm run seed` | Base seed without creating a demo admin |
| `npm run seed:demo` | Full demo dataset (development only) |
| `npm --prefix backend run recover-admin` | Recover or reset the administrator account |
| `npm --prefix backend run worker` | Standalone message-queue worker |
| `firebase deploy --only hosting` | Publish `frontend/dist` to Firebase Hosting |

---

## Demo accounts

Available after `npm run seed:demo`. Password for all: **`Demo@2026!`**

| Role | Email |
| --- | --- |
| Administrator | `admin@conductnexus.rw` |
| Headteacher | `headteacher@conductnexus.rw` |
| Teacher | `teacher@conductnexus.rw` |
| Parent (portal) | `parent@conductnexus.rw` |

Change or remove demo accounts before real use. Demo 1–8 students have guardians; the parent account is linked to the first two.

---

## Roles

| Role | Scope |
| --- | --- |
| **Administrator** | System configuration, users, structure, audit and operations — deliberately excluded from safeguarding decisions, appeal/investigation decisions and confidential meeting notes |
| **Headteacher** | School-wide oversight, serious-case approval, appeals and investigations decisions, data protection |
| **Teacher** | Record and submit incidents for assigned students; view own reports |
| **Deputy Headteacher — Discipline** | Central discipline operations, reviews, escalations, risk and interventions |
| **IT Officer** | Technical administration, monitoring, integration health |
| **Patron** | Student support, counselling, recognition and follow-ups |
| **Matron** | Boarding/dormitory welfare and incidents |
| **Bursar** | Limited student lookup; no discipline decisions |
| **Dean of Studies** | Academic coordination and conduct visibility |
| **Librarian** | Library incidents and basic student lookup |
| **Secretary** | Records, parent contacts, letters |
| **Parent / Guardian** | Portal access to consent-approved linked children only |

Permissions are granular (`incidents.review`, `marks.adjust.approve`, `safeguarding.evidence.view`, …) and enforced server-side. Administrators can adjust effective roles from **Users**; the permission catalogue lives in `backend/src/shared/permissions.ts`.

Separation-of-duty rules to preserve:
- Reporters cannot review/approve their own incidents.
- Serious sanctions require approval independent of the reporter.
- Safeguarding evidence and meeting notes are restricted even from Administrators.
- Appeal and investigation decisions sit with the Headteacher.

---

## How the conduct ledger works

1. Every student receives an initial allocation of the term's starting marks (default **40**) when enrolled.
2. An approved deduction or reward writes an **immutable ledger entry** with the balance before/after and a `balanceVersion`.
3. Corrections never edit history: a reversal or adjustment creates a **compensating entry** and requires its own approval.
4. Balances are per term; academic-year and historical views are derived from the ledger.
5. Risk level is recalculated after approved movements and surfaced on dashboards, student profiles and reports.

This design makes every mark auditable and prevents silent edits.

---

## API

- Base path: `/api/v1`
- Envelope: `{ "success": true, "data": …, "meta": … }` / `{ "success": false, "error": { "message", "details" } }`
- Auth: `Authorization: Bearer <accessToken>`; web refresh token in an HttpOnly cookie at `/api/v1/auth`. Native apps use `/api/v1/auth/native/*` with the refresh token in the response body (stored in the device secure store).
- Interactive docs: `/api/docs` · Machine-readable: `/api/docs.json`
- Health: `/api/v1/health`
- Idempotency: mutating endpoints accept `Idempotency-Key`; incident drafts use `clientSubmissionId` for offline sync.
- Integrity: `GET /api/v1/discipline/ledger/reconciliation` (permission `reports.view`) verifies every ledger chain, balance and duplicate deduction for a term.
- Batch review: `POST /api/v1/incidents/bulk-review` (permission `incidents.review`) reviews 1–50 incidents and still enforces independent review per incident.

Key groups: `auth`, `users`, `structure`, `students`, `discipline` (offences/incidents/marks), `risk`, `parents`, `communications` (queue, letters, templates), `approvals`, `safeguarding`, `investigations`, `appeals`, `evidence`, `policies`, `meetings`, `reports`, `portal`, `sync`, `admin` (settings, backups, audit, monitoring).

Full endpoint reference: [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md).

---

## Testing

```bash
# MongoDB must be running locally
npm test
```

The suite uses `conductnexus_test` and covers health/OpenAPI, authentication failures, RBAC denials, the incident lifecycle, self-review prevention, ledger balances, ledger reconciliation (including a deliberately corrupted row), bulk review with independent-review enforcement, native sessions, device revocation and refresh-token reuse detection. **23 tests** run against a real MongoDB.

Type-check all three apps:

```bash
npm --prefix backend run typecheck
npm --prefix frontend run typecheck
npm --prefix mobile run typecheck
```

---

## Deployment

### 0. Prerequisites
- GitHub repo: `https://github.com/code-jocker/Conductnexus`
- Firebase project: `e-visitors-d4830` (display name **Conduct-nexus**)
- MongoDB Atlas cluster (free tier is fine)
- Render account

### 1. MongoDB Atlas
1. Create a cluster and a database user with read/write access.
2. Allow network access from Render (`0.0.0.0/0`, or Render's static egress IPs).
3. Copy the SRV URI:
   `mongodb+srv://<user>:<password>@<cluster>/conductnexus?retryWrites=true&w=majority`

### 2. Backend on Render
**Blueprint (recommended):** Render Dashboard → **New → Blueprint** → select this repo. `render.yaml` creates the `conductnexus-api` service, sets the build/start commands and prompts for `MONGODB_URI`.

**Manual:** New Web Service → repo → root directory `backend` → build `npm ci && npm run build` → start `npm start` → health check `/api/v1/health`.

Environment (production):

```
NODE_ENV=production
MONGODB_URI=mongodb+srv://…
JWT_ACCESS_SECRET=<48 random bytes>
APP_URL=https://e-visitors-d4830.web.app
CORS_ORIGIN=https://e-visitors-d4830.web.app,https://e-visitors-d4830.firebaseapp.com
FIREBASE_PROJECT_ID=e-visitors-d4830
```

Optional: SMTP settings, `BACKUP_ENCRYPTION_KEY` (64 hex chars), `ADMIN_EMAIL`/`ADMIN_PASSWORD` for CLI seeding.

Notes:
- The service URL is `https://<service-name>.onrender.com`. If you rename it, update `CORS_ORIGIN` **and** rebuild the frontend with the new API URL.
- Render's free tier sleeps when idle; the first request can take ~50 s. In-process cron jobs (backups) only run while the service is awake — use a Render Cron Job or a paid always-on instance for reliable scheduled backups.
- The filesystem is ephemeral on free/standard services without a disk. Evidence uploads and local backup files are lost on redeploy/restart. Attach a Render disk (paid) or use external object storage for evidence in production.

First admin on a fresh database: open the deployed web app and complete the **setup wizard** (it creates the admin, roles, offences, templates and structure). Alternatively set `ADMIN_EMAIL`/`ADMIN_PASSWORD` and run `npm run seed` in the Render shell.

### 3. Frontend on Firebase Hosting
Firebase CLI is already configured for project `e-visitors-d4830` via `.firebaserc`.

```bash
# 1. Point the build at the Render API
cat > frontend/.env.production <<'EOF'
VITE_API_URL=https://conductnexus-api.onrender.com/api/v1
VITE_SOCKET_URL=https://conductnexus-api.onrender.com
VITE_FIREBASE_API_KEY=<web config>
VITE_FIREBASE_AUTH_DOMAIN=e-visitors-d4830.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=e-visitors-d4830
VITE_FIREBASE_APP_ID=<web app id>
VITE_FIREBASE_MESSAGING_SENDER_ID=<sender id>
VITE_FIREBASE_STORAGE_BUCKET=e-visitors-d4830.firebasestorage.app
EOF

# 2. Build and publish
npm --prefix frontend run build
firebase deploy --only hosting
```

`frontend/.env.production` is git-ignored. The same Firebase values already live in `frontend/.env` for local Google Sign-In.

Firebase console steps for Google Sign-In:
1. **Authentication → Sign-in method → Google → Enable**.
2. **Authentication → Settings → Authorized domains**: add `localhost` (already default) and `e-visitors-d4830.web.app` / `e-visitors-d4830.firebaseapp.com`.
3. Ensure the API has `FIREBASE_PROJECT_ID=e-visitors-d4830`.

The backend verifies Firebase ID tokens against Google's public certificates — no service-account key is required.

### 4. Post-deploy checklist
- [ ] `https://<api>/api/v1/health` returns `status: ok`
- [ ] Setup wizard completed; admin can sign in
- [ ] Google Sign-In works; a new Google user sees “not linked” until an admin assigns a role
- [ ] `CORS_ORIGIN` contains the exact frontend origin (scheme + host, no trailing slash)
- [ ] Demo accounts removed or passwords changed
- [ ] Backups scheduled and a test restore performed
- [ ] SMTP/WhatsApp configured if parent messaging is required
- [ ] Privacy notice contact details updated in **Data protection** and `/privacy`

---

## Maintenance without a developer

Everything routine is in the UI:

- **Settings** — school profile, academic year/term, starting marks, grading thresholds, risk rules, communication defaults, backup schedule/retention, branding.
- **Structure** — classes, streams, dormitories, calendar.
- **Users** — create staff, assign roles, deactivate accounts, resend verification.
- **Offences** — add/edit offences and deduction values (changes never rewrite historical ledger entries).
- **Templates** — letter and notification wording with placeholders.
- **Policies** — publish a new version; acknowledgements are tracked.
- **Data protection** — consent, retention, subject requests, breach register, export.
- **Monitoring** — database, queue, backup and integration health.
- **Audit** — filter every sensitive action by actor, resource and date.

Backups are encrypted, checksummed, retained per policy and restorable from **Settings → Backups**. Test a restore before relying on them.

---

## Data protection (Rwanda)

Designed around **Law No. 058/2021 of 13/10/2021 on personal data and privacy**:

- Documented lawful basis and purpose limitation for student and guardian data.
- Data minimisation and role-based access, including stricter handling of safeguarding and health-related notes.
- Consent and channel preferences for guardian communication, with opt-out respected by the queue.
- Retention rules, subject access/correction/erasure workflows and export.
- Breach register with severity, containment and notification tracking.
- Access auditing for sensitive records.
- Encryption in transit and at rest at the infrastructure layer; encrypted backups.
- Public privacy notice at `/privacy` (update the school name, DPO contact and retention periods before go-live).

The school remains the data controller; conduct records are official education records and are not erased while a legal/regulatory retention obligation applies.

---

## Security notes

- Access tokens are short-lived (15 min); refresh tokens are random, hashed in the database and **rotated on every use** with reuse detection.
- Passwords use bcrypt; login lockout and rate limiting protect against brute force.
- All inputs are validated with Zod at the boundary.
- Helmet, strict CORS allow-list, body-size limits and file-type/size checks on evidence uploads.
- Every sensitive mutation writes an audit record (actor, IP, user agent, before/after).
- Production cookies are `HttpOnly`, `Secure`, `SameSite=None` (required because Firebase Hosting and Render are different sites).
- Never commit `.env` files, Firebase service accounts, SMTP passwords or backup keys. Rotate any credential that has been shared in chat or screenshots.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Invalid environment configuration` on boot | A required variable is missing/invalid — read the printed field errors (`JWT_ACCESS_SECRET` ≥ 16 chars) |
| Frontend shows “Cannot reach the server” | Check `VITE_API_URL`, API health, and that `CORS_ORIGIN` matches the browser origin exactly |
| 401 after 15 minutes in production | Refresh cookie is cross-site; ensure the API is HTTPS and `NODE_ENV=production` (`SameSite=None`) |
| Google button says not configured | Fill the `VITE_FIREBASE_*` values and rebuild |
| Google sign-in succeeds but no access | The Google account has no role yet — an administrator must assign one in **Users** |
| Mongo connection timeout on Render | Allow Render egress in Atlas Network Access and verify the SRV URI/password encoding |
| PDF/letter download fails | Check API logs and evidence/storage permissions |
| Backups missing | Free Render instances sleep; schedule a Render Cron Job or use an always-on instance |
| Demo seed refused | It is disabled when `NODE_ENV=production` — run locally or in a development service |
| Reset the admin | `npm --prefix backend run recover-admin` with database access |

---

## Cross-platform apps

One backend, one MongoDB database and one set of discipline rules serve three clients.

### Web (desktop, tablet, phone browsers)

- Responsive SPA at `/` with card layouts below `md` and full tables above.
- Installable PWA: open the site in Chrome/Edge/Safari and use the in-app **Install** prompt (or browser menu → *Install app*). `manifest.webmanifest` and `sw.js` are served with revalidation headers from `firebase.json`.
- Offline behaviour: the app shell is cached; navigations fall back to `offline.html` when the network is unavailable. Incident drafts are stored in IndexedDB and sync when connectivity returns.
- Updates: when a new service worker is detected the app shows a banner; applying it activates the new worker and reloads once.

### Native Android + iOS (`mobile/`)

- Expo SDK 58 / React Native with Expo Router. Staff tabs: Home, Incidents, Students, Tasks, More. Parent tabs: Children, Meetings, Notices, Account.
- Native sessions (`/api/v1/auth/native/*`): refresh tokens live in SecureStore, every session is a device record that can be revoked, and biometric unlock is optional.
- Offline drafts in SQLite with idempotent sync; safeguarding flags survive offline.
- Expo push notifications bound to the signed-in device; permissions mirror the web (reporter cannot review their own incident, consent-aware parent messaging).
- Setup, environment variables, EAS builds and store submission: [`mobile/README.md`](mobile/README.md).

---

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) | Endpoint groups, auth flows, envelopes, pagination, idempotency, offline sync |
| [`docs/SECURITY_AND_PRIVACY.md`](docs/SECURITY_AND_PRIVACY.md) | Threat model, RBAC, session security, secrets, Rwanda data-protection controls |
| [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) | Atlas, Render, Firebase Hosting, PWA headers, mobile builds, backups and rollback |
| [`mobile/README.md`](mobile/README.md) | Expo app setup, environment, push, builds |
| [`docs/CROSS_PLATFORM_REPOSITORY_AUDIT.md`](docs/CROSS_PLATFORM_REPOSITORY_AUDIT.md) | Production-readiness audit and gap analysis |

---

<p align="center"><strong>ConductNexus</strong> — discipline with due process, dignity and data protection.</p>

<p align="center">Powered by Shyaka clever prince a.k.a Code jocker</p>
#   t r i g g e r   r e d e p l o y  
 