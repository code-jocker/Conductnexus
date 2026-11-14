# ConductNexus — Cross-Platform Repository Audit

Date: 2026-11-14
Repository: `code-jocker/Conductnexus`
Local root: `D:\Displine management system`

This document records what the repository actually contains before the
cross-platform work started. It is the factual baseline for the
implementation plan; nothing here is aspirational.

## 1. Monorepo shape (as found)

```
/
├── backend/          Node + Express + TypeScript (ESM), MongoDB/Mongoose
├── frontend/         React 18 + TypeScript + Vite 6 + Tailwind 3.4
├── firebase.json     Firebase Hosting → frontend/dist, SPA rewrite
├── render.yaml       Render web service → backend
├── package.json      Root scripts: install:all, dev, build, test, seed, setup, start
└── README.md
```

There is no npm workspace and no `mobile/` or `packages/` directory yet.
Adding a workspace must not break the Render/Firebase build paths.

## 2. Backend

### 2.1 Runtime and libraries

- Express 4, TypeScript, ESM (`tsc` → `dist`, start `node dist/server.js`).
- Mongoose 8 / MongoDB.
- Zod validation, Helmet, CORS allow-list, rate limits, Multer uploads.
- JWT access tokens, rotating hashed refresh tokens.
- Firebase Admin / Google ID-token verification.
- Socket.IO, node-cron workers, Pino logging.
- Swagger UI, Vitest + Supertest.
- WhatsApp via `whatsapp-web.js` + Puppeteer (live-verified for +250793946732).

### 2.2 Routes (mount: `/api/v1`)

| Mount | Purpose |
| --- | --- |
| `/auth` | setup-status, setup, login, google, refresh (cookie), logout, logout-all, me, change-password, verify-email, resend-verification, forgot-password, reset-password |
| `/users` | users, roles, permissions, overrides, sessions |
| `/structure` | academic years, terms, classes, streams, dormitories |
| `/students` | list, export, import, register, profile, history, ledger, status, promote |
| `/parents` | guardians, guardian links, consent, communication |
| `/discipline` | offences, incidents, submit, review, close, ledger, deduct, reward, reverse, adjustments, at-risk count |
| `/approvals` | approval queue (adjustments, letters, appeals, safeguarding) |
| `/risk` | assessments, watchlist, interventions, follow-ups |
| `/safeguarding` | cases, access control, follow-ups, auditor view |
| `/investigations`, `/appeals`, `/evidence` | due-process workflows |
| `/policies`, `/meetings` | policy documents, meetings and minutes |
| `/communications`, `/notifications`, `/letters`, `/templates` | queue, WhatsApp, email, letters, templates |
| `/reports` | summaries, exports, PDF |
| `/admin` | audit, monitoring, backups, data protection, errors |
| `/portal` | parent portal (children, conduct, notices, meetings) |
| `/sync` | `GET /sync/time`, `POST /sync/incidents` (idempotent offline sync) |
| `/health`, `/api/v1/health` | liveness + DB check |

### 2.3 Domain models

`core.ts` — User, Session, Role, Permission, RolePermission, UserRole,
UserPermissionOverride, MailMessage, IdempotencyKey, Settings.
`school.ts` — Stream, Class, Dormitory, AcademicYear, Term, Student,
Parent, GuardianLink.
`discipline.ts` — Offence, Policy, Incident, DisciplineLedger,
AdjustmentRequest, Approval, RiskAssessment.
`governance.ts` — AuditLog, SafeguardingCase, Investigation, Appeal,
Evidence, DataRequest, DataBreach, AccessLog, BackupRecord, ErrorLog,
SyncLog.
`communications.ts` — LetterTemplate, Letter, NotificationTemplate,
Notification, MessageQueue, WhatsappSession, CalendarEvent, Meeting.
`support.ts` — Intervention, FollowUp, Recognition, RecognitionPlan,
WatchlistEntry.

### 2.4 Authentication facts (current)

- Access JWT payload is `{ sub, typ: 'access' }`, TTL 15m.
- Refresh token is a random 48-byte value; only its SHA-256 hash is
  stored in `Session`. Browser refresh is an HttpOnly cookie
  (`cn_refresh`, path `/api/v1/auth`, `sameSite=none` in production).
- `Session` fields today: `userId`, `tokenHash`, `expiresAt`,
  `revokedAt?`, `replacedByHash?`, `ip?`, `userAgent?`, timestamps.
- Refresh rotation revokes the old session and detects reuse (revokes
  all sessions). There is no device id, platform, app version or push
  token on the session.
- `authenticate` verifies the access token and loads the RBAC context;
  it does **not** re-check whether the session/device was revoked.
- RBAC is granular permission strings; `requirePermission`,
  `requireAllPermissions`, `requireRole` middleware exist.

### 2.5 Discipline invariants (current)

- `DisciplineLedger` is append-only with `type`, `points`, `balanceBefore`,
  `balanceAfter`, `reference`, `actor`, `reason`, idempotency support.
- Incidents move through draft → submitted → under_review → escalated →
  approved/rejected; independent review is enforced (reporter cannot
  review own incident).
- Offline sync deduplicates on `clientSubmissionId` and writes `SyncLog`.
- Risk engine derives from incidents; `RiskAssessment` persists results.

## 3. Frontend (web)

- React 18, Vite 6, TypeScript, React Router 6, TanStack Query 5,
  Tailwind, Recharts, Lucide.
- Auth context + axios client; refresh handled through the HttpOnly
  cookie; Socket.IO client for live updates.
- Pages: Dashboard, Students, StudentProfile, Incidents, IncidentNew,
  IncidentDetail, Drafts (offline), Approvals, Risk, Safeguarding,
  Investigations, Appeals, Evidence, Policies, Meetings, Communications,
  Reports, Structure, Users, DataProtection, Audit, Monitoring, Settings,
  Portal, Profile, auth screens, 404.
- Offline drafts live in `localStorage` (`cn_offline_drafts`) via
  `src/lib/offline.ts`; a Drafts page syncs them through `/sync/incidents`.
- `vite.config.ts` proxies `/api` and `/socket.io` to :4000 in dev and
  manual-chunks react/data/charts/realtime/firebase.
- **No PWA**: no manifest, no service worker, no install/update prompt,
  no offline fallback, and drafts are localStorage rather than IndexedDB.
- Responsive work exists but was not audited per breakpoint in this pass.

## 4. Mobile

No mobile application exists. There is no Expo project, no native auth
flow, no SecureStore/SQLite usage and no push notification integration.

## 5. Deployment facts

- Frontend: Firebase Hosting project `e-visitors-d4830`, `frontend/dist`,
  SPA rewrite, long-cache assets, no-cache index, security headers.
- Backend: Render `conductnexus-api`, rootDir `backend`, health check
  `/api/v1/health`, CORS allow-list for the Firebase domains, WhatsApp
  disabled in `render.yaml` (`ENABLE_WHATSAPP=false`).

## 6. Gap summary against the two prompts

### Must be added for cross-platform

1. Native session/device support: device metadata on sessions, `sid`
   claim in access tokens, revocation enforcement, native
   login/refresh/logout, session list/revoke, push-token registration.
2. Expo application (`mobile/`) with Expo Router, SecureStore refresh
   tokens, SQLite offline drafts, notifications, camera/pickers,
   biometrics, staff and parent navigation, role-aware screens.
3. Web PWA: manifest, icons, service worker, app-shell caching, offline
   fallback, install/update prompt, network indicator, IndexedDB drafts.
4. Shared contracts/validation so web and mobile cannot drift.

### Known partial/incomplete areas from the production audit

- Historical term balances vs current balance labelling.
- Ledger transaction usage/reconciliation and integrity report.
- Queue lease recovery and dead-letter visibility.
- Evidence upload hardening and access auditing.
- Detention/suspension/counselling/improvement-plan and attendance
  modules are not present as first-class models.
- Backup restore verification.
- Device-level session revocation and push delivery do not exist.

## 7. Constraint checklist carried into implementation

- Do not migrate MongoDB to Firestore.
- Do not duplicate discipline rules in clients; backend stays authoritative.
- No secrets in git or logs; tokens never in AsyncStorage or logs.
- Keep the established navy/indigo + orange palette.
- Keep footer text: `Powered by Shyaka clever prince a.k.a Code jocker`.
- Never commit WhatsApp session files.
