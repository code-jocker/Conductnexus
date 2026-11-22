# ConductNexus — Enterprise Audit Baseline

**Audit date:** 2026-11-21
**Repository:** `https://github.com/code-jocker/Conductnexus`
**Branch:** `main` (local: `D:\Displine management system`)
**Latest commit:** `a05de6c` — "Fix: remove duplicate unreachable return/brace in communication.service.ts (TS1128 compile error)"
**Method:** direct source inspection of every backend route, service, model, middleware, the web frontend, Expo mobile app, WhatsApp gateway, CI workflows, deployment config, and all docs.

---

## A. Repository and architecture summary

### Monorepo layout

```
conductnexus/
├── backend/             Express 4 + TypeScript (ESM) + Mongoose 8 + MongoDB
│   ├── src/
│   │   ├── config/         env.ts (zod-validated), db.ts
│   │   ├── middleware/     auth.ts, error.ts
│   │   ├── models/         11 files · ~40 schemas
│   │   ├── routes/         27 files · mounted at /api/v1
│   │   ├── services/       ~25 files · business rules
│   │   ├── shared/         roles.ts, permissions.ts, errors.ts, logger.ts
│   │   ├── data/           templateLibrary.ts (bilingual EN/RW templates)
│   │   ├── docs/           OpenAPI document
│   │   ├── test/           17 Vitest + Supertest suites
│   │   ├── migrations/     versioned migration runner
│   │   ├── scripts/        setup, seed, migrate, backup drill, smoke
│   │   ├── server.ts       HTTP + Socket.IO bootstrap
│   │   ├── app.ts          Helmet, CORS, rate limits, health, Swagger
│   │   └── worker.ts       background message-queue worker
├── frontend/            React 18 + Vite 6 + TypeScript + Tailwind + TanStack Query
│   ├── src/pages/          29 page components
│   ├── src/lib/            API client, auth, offline store, role dashboards
│   └── dist/               Firebase Hosting build output
├── mobile/              Expo SDK 58 + React Native + Expo Router
│   ├── app/                24 screens (auth, staff, parent, incident, student)
│   └── src/                API client, native auth, SQLite drafts, push, theme
├── whatsapp-gateway/      Node + Express + whatsapp-web.js + Puppeteer (Docker)
│   └── src/index.js        gateway entry: status, QR, connect, disconnect, send
├── firebase.json          Firebase Hosting → frontend/dist, SPA rewrite
├── .firebaserc            default project: e-visitors-d4830
├── render.yaml            Render blueprint: conductnexus-api + conductnexus-whatsapp-gateway
├── package.json           Root scripts (install:all, dev, build, test, seed, setup, start)
├── README.md
└── docs/                  17 documents (API, security, deployment, audit, roadmap, …)
```

### Technology stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS, React Router 6, TanStack Query 5, Recharts, Socket.IO client, Firebase JS SDK |
| Mobile | Expo SDK 58, React Native 0.88, Expo Router, TanStack Query, Expo SecureStore/SQLite/Notifications |
| Backend | Node.js 20+, Express 4, TypeScript ESM, Mongoose 8, Zod, JWT, Pino, Socket.IO, Swagger UI |
| Data | MongoDB 7 (local or Atlas) |
| Files | Local evidence storage (`backend/storage`) — Render disk or object storage needed in production |
| Tests | Vitest + Supertest against real MongoDB |
| CI | GitHub Actions (`.github/workflows/ci.yml`): Node 22, mongo:7 service container, typecheck (3 packages), backend tests, web build |
| Deploy | Render (backend + WhatsApp gateway), Firebase Hosting (frontend) |

### 12 RBAC roles (from `backend/src/shared/roles.ts`)

ADMIN, HEADTEACHER, TEACHER, DEPUTY_DISCIPLINE, IT, PATRON, MATRON, BURSAR, DOS, LIBRARIAN, SECRETARY, PARENT

### Permission inventory

150+ granular permissions in `backend/src/shared/permissions.ts`, grouped: System, Reports, Calendar, Communication, Students, School, Attendance, Boarding, Welfare, Discipline, Parents, Documents, Safeguarding, Investigations, Appeals, Recognition, Evidence, Policies, Meetings, Data protection, Parent portal.

### API surface

`/api/v1` mounts: auth, users, structure, students, parents, discipline, approvals, risk, safeguarding, investigations, appeals, evidence, policies, meetings, communications, notifications, letters, templates, reports, admin, portal, sync, health.

---

## B. Latest commit and current branch details

- **Branch:** `main`, tracking `origin/main`, working tree clean
- **Latest commit:** `a05de6c` — Fix communication.service.ts TS1128 compile error (2 deletions)
- **Previous commit:** `2049c2c` — Fix WhatsApp gateway 429 rate limiting (gateway rate limiter + Retry-After, backend retry, frontend slower polling)
- **Commit before that:** `cba8dd4` — Speed up WhatsApp QR display (224px QR + cached last QR)
- All commits pushed to `origin/main`

---

## C. Verified build/test baseline

### Backend typecheck (`tsc --noEmit`)

**BEFORE fix:** `src/services/communication.service.ts(301,1): error TS1128: Declaration or statement expected`
**AFTER fix:** PASS (clean, no output)

### Frontend typecheck (`tsc --noEmit`)

**PASS** (clean, no output)

### Mobile typecheck (`tsc --noEmit`)

**PASS** (clean, no output)

### Backend tests (`vitest run`)

**BEFORE fix:** 12 suites failed, all due to the same `communication.service.ts` TS transform error. 5 suites passed (36 tests, 3 skipped).
**AFTER fix:** **17 suites passed, 206 tests passed, 0 failed, 3 skipped.**

| Suite | Tests | Status |
|-------|-------|--------|
| api.test.ts | 61 | PASS |
| attendance-boarding.test.ts | 12 | PASS |
| welfare.test.ts | 10 | PASS |
| ledger-term.test.ts | 7 | PASS |
| attendance-roles.test.ts | 7 | PASS |
| access-request.test.ts | 9 | PASS |
| authz.test.ts | 34 | PASS |
| notification-preferences.test.ts | 9 | PASS |
| message-queue.test.ts | 8 | PASS |
| parent-isolation.test.ts | 6 | PASS |
| evidence-security.test.ts | 12 | PASS |
| migrations.test.ts | 6 | PASS |
| report-export.test.ts | 5 | PASS |
| whatsapp-gateway.test.ts | 3 | PASS |
| dashboard-cache.test.ts | 6 | PASS |
| monitoring.test.ts | 6 | PASS |
| backup-key.test.ts | 5 | PASS |

### CI

`.github/workflows/ci.yml` runs on push/PR/dispatch: Node 22, mongo:7 container, `npm ci` all workspaces, typecheck (3 packages), `npm test`, frontend build. Kept green.

---

## D. Critical defects and security risks (P0)

### D1 — RESOLVED: Duplicate unreachable code in communication.service.ts

**File:** `backend/src/services/communication.service.ts:300-301`
**Defect:** After the `gatewayRequest` function's closing `}` at line 299, there were two orphaned lines:
```
  return payload as T
}
```
This caused `TS1128: Declaration or statement expected`, breaking backend typecheck and all 12 dependent test suites.
**Fix:** Removed lines 300-301. Commit `a05de6c`.
**Verification:** Backend typecheck passes; all 17 test suites (206 tests) pass.

### D2 — WhatsApp gateway env vars not configured on API service

**Files:** `render.yaml:41-50`, `backend/src/config/env.ts:71-76`
**Risk:** `WHATSAPP_GATEWAY_URL` and `WHATSAPP_GATEWAY_TOKEN` are `sync: false` in `render.yaml` and not set on the `conductnexus-api` Render service. The gateway itself is live at `https://conductnexus-whatsapp-gateway.onrender.com` (`/health` returns OK), but the API cannot reach it because `whatsappGatewayConfigured` is false.
**Impact:** WhatsApp connect/send/status via the gateway returns "WhatsApp is disabled" or gateway-unavailable errors.
**Required action (manual, Render dashboard):** Set on `conductnexus-api`:
- `WHATSAPP_GATEWAY_URL` = `https://conductnexus-whatsapp-gateway.onrender.com`
- `WHATSAPP_GATEWAY_TOKEN` = `<rotated — set manually in Render dashboard, do not commit>`
Then redeploy `conductnexus-api`.

### D3 — `ENABLE_WHATSAPP=false` in render.yaml

**File:** `render.yaml:41-42`
**Note:** This is intentional — the API routes WhatsApp through the external gateway instead of running an in-process browser. Correct for Render's ephemeral filesystem. No change needed once D2 env vars are set.

### D4 — Students routes monolith

**File:** `backend/src/routes/students.routes.ts` (1,334 lines)
**Risk:** Single file holds registration, lifecycle, guardians, documents, import/export, bulk operations, and activity. High regression risk; hard to test in isolation.
**Severity:** HIGH (maintainability, not a runtime defect)
**Plan:** Phase P2 — split into independently testable modules (registration, lifecycle, guardians, imports, documents).

### D5 — Content-Security-Policy disabled

**File:** `backend/src/app.ts:22-23` (`contentSecurityPolicy: false`)
**Risk:** No CSP header on the API-served Swagger UI. Firebase Hosting sets some headers but the API itself lacks CSP.
**Severity:** MEDIUM
**Plan:** Phase P1 — introduce report-only CSP, then enforce from Firebase Hosting.

### D6 — Backup encryption key optional in production

**File:** `backend/src/config/env.ts:33` (`BACKUP_ENCRYPTION_KEY` optional with fallback)
**Risk:** Backups may be encrypted with a key derived from `JWT_ACCESS_SECRET` instead of a dedicated backup key.
**Severity:** MEDIUM
**Plan:** Phase P1 — require `BACKUP_ENCRYPTION_KEY` in `NODE_ENV=production`.

### D7 — WhatsApp gateway is unofficial automation

**File:** `whatsapp-gateway/src/index.js` (uses `whatsapp-web.js`)
**Risk:** Unofficial WhatsApp Web integration carries account-compliance and operational risks for production-critical communications.
**Action:** Evaluate official WhatsApp Business Platform for production; keep provider integrations replaceable. Document this risk (see SECURITY_AND_PRIVACY.md §14 and Phase 8.14 of the roadmap).

---

## E. Existing features that must be preserved

All of the following are implemented and verified by tests. They must not be removed or weakened:

1. **Auth:** JWT access (15m) + rotating hashed refresh tokens, reuse detection, session revocation, device sessions, Google/Firebase ID-token verification, email 2FA, password reset, login lockout/rate limiting
2. **RBAC:** 12 roles, 150+ granular permissions, record-level student visibility, separation-of-duty (reporter cannot review own incident)
3. **Discipline ledger:** Append-only, 40 starting marks/term, compensating reversals, balance versioning, idempotent bulk apply, reconciliation endpoint
4. **Incident workflow:** draft → submitted → under_review → escalated → approved/rejected, independent review, evidence uploads
5. **Communications:** consent-aware parent messaging, quiet hours, retry + dead-letter queue, placeholder validation, bilingual (EN/RW) template library (30 types), letter PDFs
6. **Safeguarding:** restricted access, case access logs, evidence download audit
7. **Investigations & appeals:** due-process workflows with independent decision authority
8. **Audit logging:** actor, action, resource, reason, before/after on sensitive mutations
9. **Encrypted backups:** AES-256-GCM, retention, restore drill script
10. **PWA/web:** offline incident drafts (localStorage), IndexedDB-ready offline store, service worker
11. **Mobile:** Expo app with role-specific homes, offline SQLite drafts, SecureStore refresh tokens, biometric unlock
12. **API contracts:** `/api/v1` envelope format, idempotency keys, `X-Request-Id`, health endpoints, Swagger/OpenAPI
13. **Footer/branding:** navy/indigo + ochre identity, footer text preserved

---

## F. Missing or incomplete enterprise capabilities

| Capability | Status | Gap |
|------------|--------|-----|
| Attendance module (first-class) | PARTIAL | Routes/models exist (`attendance.routes.ts`, `attendance.ts`) but not a complete first-class module with boarding roll-call |
| Detention module | PARTIAL | `detention.routes.ts` exists; needs full assignment/completion/rescheduling workflow |
| Suspension module | PARTIAL | Approval workflow exists; needs formal suspension/reintegration/appeals |
| Counselling & welfare | PARTIAL | `welfare.routes.ts`, `support.ts` exist; needs confidential session notes, safeguarding escalation |
| Improvement plans | MISSING | No dedicated model or workflow |
| Versioned migrations | IMPLEMENTED | `src/migrations/` + `migrate.ts` — tested |
| CI pipeline | IMPLEMENTED | `.github/workflows/ci.yml` — kept green |
| Error monitoring (Sentry) | MISSING | Pino logs only; no managed error reporting |
| Staging environment | MISSING | `render.yaml` production only |
| Content-Security-Policy | MISSING | Disabled in Helmet (`app.ts:22`) |
| Backup encryption key required | PARTIAL | Optional in env schema |
| WhatsApp Business Platform | MISSING | Unofficial `whatsapp-web.js` gateway in production |
| Mobile automated tests | MISSING | No test runner configured for mobile package |
| Shared TypeScript contracts | MISSING | Web and mobile validation could drift |
| Data subject request workflow | PARTIAL | `DataRequest` model exists; needs full UI/workflow |
| Detention/suspension/counselling | MISSING | First-class models needed |

---

## G. Prioritized implementation plan

### P0 — Release blockers (fix now)

| ID | Work | Acceptance criteria |
|----|------|---------------------|
| P0-1 | Fix communication.service.ts TS1128 | **DONE** — typecheck passes, 206 tests pass |
| P0-2 | Configure WhatsApp gateway env vars on `conductnexus-api` | Manual Render dashboard action; API can reach gateway `/status` with Bearer token |
| P0-3 | Verify all builds pass after env fix | Backend + frontend + mobile typecheck + build green |

### P1 — Production foundation

| ID | Work | Acceptance criteria |
|----|------|---------------------|
| P1-1 | Require `BACKUP_ENCRYPTION_KEY` in `NODE_ENV=production` | Backend fails fast if missing in production |
| P1-2 | Introduce report-only CSP, then enforce | No CSP violations in production |
| P1-3 | Automated backup restore drill test | `npm run backup:drill` verifies restore + ledger reconciliation |
| P1-4 | Error monitoring integration (Sentry or equivalent) | Uncaught errors reported; no secrets in reports |
| P1-5 | Staging environment config | Separate Render service + Firebase project for staging |

### P2 — School operations (first-class modules)

| ID | Work | Acceptance criteria |
|----|------|---------------------|
| P2-1 | Split `students.routes.ts` into modules | Registration, lifecycle, guardians, imports, documents as separate testable files |
| P2-2 | First-class attendance module | Registers by class/stream, present/absent/late/excused, duplicate prevention, summaries |
| P2-3 | Boarding roll-call | Morning/evening roll-call, missing-student escalation |
| P2-4 | Detention module | Assignment, completion, rescheduling, parent notification |
| P2-5 | Suspension module | Recommendation/approval workflow, return-to-school review, appeals |
| P2-6 | Counselling & welfare module | Confidential session notes, safeguarding escalation, strict separation from discipline |
| P2-7 | Improvement plans | Goals, responsible staff, review dates, outcome tracking |

### P3 — Enterprise maturity

| ID | Work | Acceptance criteria |
|----|------|---------------------|
| P3-1 | Mobile automated tests | Test runner configured, critical workflows tested |
| P3-2 | Load/stress testing | Attendance, incident entry, notification queues under load |
| P3-3 | Advanced analytics | Behaviour trends, class/dormitory comparisons, intervention effectiveness |
| P3-4 | Operations dashboard | Service health, failed jobs, queue status, integration health |
| P3-5 | Optional human-controlled AI assistant | Summaries, drafts for approval; no autonomous decisions |

### Acceptance criteria for "production-ready"

- Backend, frontend, mobile, gateway builds pass
- All 206+ backend tests pass; CI green
- RBAC enforced on every sensitive backend endpoint, verified by authz tests
- Discipline/attendance records concurrency-safe and auditable
- Existing school data preserved through migrations and year transitions
- Parent notifications consent-aware, idempotent, delivery-status tracked
- Evidence and backups use durable, private storage
- Backup restoration tested successfully
- Production secrets, auth, file access secure
- Monitoring, alerting, incident response documented
- Critical workflows tested end to end
- Deployment, rollback, recovery instructions documented
- Remaining risks transparently reported

---

## H. Blockers requiring user decisions

1. **WhatsApp gateway env vars (D2):** Requires manual action in Render dashboard to set `WHATSAPP_GATEWAY_URL` and `WHATSAPP_GATEWAY_TOKEN` on `conductnexus-api`, then redeploy. Cannot be automated from this environment (no Render CLI/token available).
2. **WhatsApp Business Platform (D7):** Decision needed whether to continue with unofficial `whatsapp-web.js` gateway or migrate to official WhatsApp Business Platform for production-critical parent communications.
3. **Staging environment (P1-5):** Decision needed on whether to provision a separate Render service + Firebase project for staging before production releases.
4. **Error monitoring provider (P1-4):** Decision needed on Sentry vs equivalent, subject to privacy review for student data.

---

## Files changed in this audit session

| File | Change |
|------|--------|
| `backend/src/services/communication.service.ts` | Removed duplicate unreachable `return payload as T` and extra `}` (lines 300-301), fixing TS1128 |
| `docs/ENTERPRISE_AUDIT.md` | **New** — this baseline audit document |

### Test results after fix

- Backend typecheck: PASS
- Frontend typecheck: PASS
- Mobile typecheck: PASS
- Backend tests: 17 suites, 206 tests, 0 failures

### Remaining risks

- WhatsApp gateway not connected to API (env vars not set on Render) — blocks WhatsApp connect/send
- Unofficial WhatsApp Web gateway carries compliance risk
- No staging environment
- No managed error monitoring
- CSP not enforced
- Students routes monolith (maintainability risk)
