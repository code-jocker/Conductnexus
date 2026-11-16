# ConductNexus — Complete Repository Audit

**Audit date:** 2026-11-15
**Repository:** `https://github.com/code-jocker/Conductnexus`
**Method:** direct source inspection of the working tree (not documentation review).
**Scope:** every backend route, service, model, the web frontend, and the Expo mobile app.

Every finding below cites `file:line`. Where a claim could not be verified by reading
code, it is marked **UNVERIFIED** rather than asserted.

---

## 1. Repository structure (actual)

```
.
├── backend/        TypeScript · Express · Mongoose · Socket.IO
│   └── src/
│       ├── config/        env.ts (zod-validated), db.ts
│       ├── middleware/    auth.ts, error.ts, http.ts
│       ├── models/        7 files · 30+ schemas
│       ├── routes/        22 files · 1 shared helpers.ts
│       ├── services/      23 files
│       ├── shared/        roles.ts, permissions.ts, logger.ts, refs.ts, errors.ts
│       ├── data/          templateLibrary.ts (bilingual template library)
│       ├── test/          api.test.ts (single suite) · env.setup.ts
│       ├── worker.ts      background job process
│       └── server.ts      HTTP + Socket.IO bootstrap
├── frontend/       React 19 · Vite · TypeScript · Tailwind · TanStack Query · React Router · Recharts
│   └── src/pages/         29 page components
├── mobile/         Expo · Expo Router · TypeScript
│   ├── app/              24 screens (auth / staff / parent / student / incident)
│   └── src/              api client, auth, push, offline db + sync, theme
└── docs/           7 existing documents
```

### Size (measured)

| Area | Files | Lines |
|---|---|---|
| Backend `src` | 52 | 18,545 |
| Frontend `src` | — | 17,478 |
| Mobile `src` + `app` | 37 | 5,384 |

### Backend inventory

- **Models (7):** `core.ts` (426), `school.ts` (325), `discipline.ts` (485), `governance.ts` (416), `communications.ts` (401), `support.ts` (147), `promotion.ts` (106).
- **Routes (22):** `students` (1334), `communications` (850), `discipline` (680), `auth` (599), `users` (494), `risk` (476), `structure` (439), `admin` (438), `promotions` (445), `meetings` (365), `investigations` (332), `safeguarding` (312), `parents` (291), `evidence` (230), `appeals` (220), `portal` (217), `policies` (156), `approvals` (128), `reports` (116), `sync` (78).
- **Services (23):** `auth` (647), `communication` (530), `ledger` (370), `incidents` (367), `seed` (354), `reports` (298), `analytics` (259), `bulk` (254), `letters` (247), `backup` (179), `rbac` (166), `risk` (157), `adjustments` (152), `session` (143), `approvals` (138), `monitoring` (138), `email` (136), `push` (94), `audit` (89), `sms` (84), `notification` (91), `academic` (24), `approvals.util` (17).

### Mobile screens (24)

`(auth)/login`, `(auth)/forgot-password`, `(parent)/index|meetings|notices|account`,
`(staff)/index|students|incidents|tasks|more`, `student/[id]`, `child/[id]`,
`incident/new`, `incident/[id]`, `drafts`, `notifications`, `profile`, `sessions`, `privacy`.

---

## 2. What is genuinely implemented

Verified by reading the implementation, not the docs.

| Capability | Evidence |
|---|---|
| JWT auth with access + refresh, rotation, device sessions | `services/auth.service.ts`, `services/session.service.ts` |
| RBAC with 12 seeded roles and 100+ granular permissions | `shared/roles.ts`, `shared/permissions.ts`, `services/rbac.service.ts` |
| Record-level student visibility (`visibleStudentQuery`) | `services/rbac.service.ts` |
| Permanent discipline ledger with reversal-as-new-transaction | `services/ledger.service.ts` |
| Approval workflow with separation of duties + role requirement | `services/approvals.service.ts:22-28` |
| Bulk discipline (class / stream / dormitory / school / selection) | `services/bulk.service.ts`, `routes/discipline.routes.ts` |
| Idempotent bulk apply via `clientReference` | `services/bulk.service.ts` |
| Incident lifecycle + linkage to ledger | `services/incidents.service.ts` |
| Consent-aware parent messaging with quiet hours + retry + dead letter | `services/communication.service.ts` |
| Bilingual (EN/RW) notification + letter template library, 30 types | `data/templateLibrary.ts` |
| Placeholder validation — refuses to send unresolved placeholders | `services/communication.service.ts:118` |
| A4 bilingual PDF letters with school identity + stamp placeholder | `services/letters.service.ts` |
| Risk engine, investigations, appeals, evidence, safeguarding, meetings | `services/risk.service.ts`, `routes/*.routes.ts` |
| Offline incident sync with idempotency + conflict detection | `routes/sync.routes.ts:40-45` |
| PWA / mobile push registration | `services/push.service.ts`, `mobile/src/notifications/push.ts` |
| Rate limiting (global, auth, forgot-password, 2FA) | `middleware/error.ts:9-33` |
| Helmet + CORS allowlist + central error handler | `app.ts:20-39`, `app.ts:84-85` |
| Swagger/OpenAPI at `/api/docs` | `app.ts:80` |
| Encrypted backups with retention | `services/backup.service.ts` |
| Audit logging on sensitive mutations | `services/audit.service.ts` |

**This is a substantial, real codebase.** It is not a UI shell.

---

## 3. Findings by severity

### CRITICAL

#### C1 — Any authenticated user can read any approval's full audit timeline — **FIXED**
`routes/approvals.routes.ts:104-126`

Was:

```ts
router.get('/approvals/:id/timeline', asyncHandler(async (req, res) => {
  const approval = await Approval.findById(req.params.id).lean()
  if (!approval) throw ApiError.notFound('Approval not found')
  ...
```

There was **no permission check and no record-level check**. Compare the sibling route
`GET /approvals/:id` (`approvals.routes.ts:64`) which does verify
`permissions.has(approval.requiredPermission)` and `requestedBy`.

Impact: a `PARENT` or `LIBRARIAN` token could enumerate approval IDs and read the audit
trail (actor names, actions, reasons) of any disciplinary approval in the school.

**Status:** fixed — the same guard as `GET /approvals/:id` now applies, and the fix is
covered by an executed test (`api.test.ts`, "denies an unrelated user the audit timeline
of someone else's approval": parent 403, requester 200).

#### C2 — School-wide ledger aggregate was not scoped to the caller — **FIXED**
`services/analytics.service.ts:79-83`

```ts
DisciplineLedger.aggregate([
  { $match: { createdAt: { $gte: since14 } } },
  ...
```

Every other query in `dashboardFor` was scoped by `studentFilter` / `incidentFilter`
(`analytics.service.ts:32-33`), but this one matched **all** ledger rows school-wide.
A `TEACHER` therefore received a school-wide deduction trend derived from students
they were not assigned to.

**Status:** fixed — added `ledgerScopeFor(ctx)`, which returns no restriction for
school-wide viewers and otherwise resolves the caller's visible student IDs and
matches `studentId: { $in: [...] }`.

### HIGH

#### H1 — `approvals.routes.ts` has no route-level permission guard — **FIXED**
7 routes, 0 `requirePermission(...)` calls (measured).

**Resolution:** all 7 routes are now guarded — `APPROVAL_PERMISSIONS` on the list/count endpoints and a `loadApproval` record-level guard (authorizes against each approval's own `requiredPermission`, or its requester) on every `/approvals/:id*` route. Verified by `test/authz.test.ts`.

`POST /approvals/:id/approve|reject|request-info` are safe because
`decideApproval` re-checks permission + role + self-approval
(`services/approvals.service.ts:22-28`). The list endpoint filters by permission
(`approvals.routes.ts:25`). Only the timeline route (C1) is genuinely exposed.

Severity is HIGH rather than CRITICAL because the service layer holds the line — but
this is a fragile pattern: any new route added to this file inherits no default
protection.

#### H2 — `students.routes.ts` is a 1,334-line monolith
Single file holding registration, lifecycle, guardians, documents, import/export,
bulk operations and activity. High regression risk; hard to test in isolation.

#### H3 — No CI pipeline — **FIXED**
No `.github/workflows` exists at the repository root (verified). Nothing prevents a
type error, a failing test, or a secret from reaching `main`.

**Resolution:** `.github/workflows/ci.yml` runs on push, PR and manual dispatch: Node 22, a `mongo:7` service container, `npm ci` for all four workspaces, `npm run typecheck` (backend + web + mobile), `npm test`, and the web production build. The mobile `package-lock.json` also carried 18 version-less optional-dependency entries that made `npm ci` fail with `Invalid Version`; those were regenerated and `npm ci --dry-run` now passes for every workspace.

#### H4 — Test suite is a single file covering happy paths
`backend/src/test/api.test.ts` — 56 tests in one file. Present and passing, but:

- no authorization matrix across the 12 roles,
- no partial-failure test for bulk processing,
- no test that a teacher cannot read an unassigned student's record via direct API,
- no test for the offline sync conflict path (`routes/sync.routes.ts:63`).

### MEDIUM

#### M1 — Mobile has no dedicated role dashboard
`mobile/app/(staff)/index.tsx` renders one shared staff home regardless of role.
The 12-role differentiation exists on web only.

#### M2 — Web dashboard is role-*aware* but not role-*specific*
`pages/Dashboard.tsx:56` branches only on `isParent`; every staff role sees the same
layout. The backend already computes `primaryRole` (`analytics.service.ts:31`) and
permission-gates `extra` (`analytics.service.ts:111-157`), so the data is there — the
presentation is not.

#### M3 — Mobile screen coverage is thinner than web
24 mobile screens vs 29 web pages. No mobile equivalents for: Promotions, Reports,
Risk, Safeguarding, Investigations, Appeals, Evidence, Structure, Users, Audit,
Monitoring, Policies, Data Protection, Approvals.

#### M4 — No automated migration framework
Schema changes rely on Mongoose defaults plus idempotent seed upserts
(`services/seed.service.ts`). There is no versioned migration runner; a rename or a
backfill has no safe home.

#### M5 — `notification.service.ts` is in-app only
In-app notifications and Socket.IO emission are implemented; web push / FCM delivery
depends on `services/push.service.ts` plus `EXPO_ACCESS_TOKEN` and
`FIREBASE_PROJECT_ID`, both optional and unset by default. Correctly treated as
"not configured" rather than faked — but the notification *preferences* and *device
token* models described in the brief do not exist yet.

### LOW

#### L1 — `titleCase()` used on enum values in the template list
`pages/Communications.tsx` renders `titleCase(t.channel)` — cosmetic only.

#### L2 — Mixed date formatting
`letters.service.ts` formats `en-RW`; the frontend uses `formatDate`. Inconsistent
locale output across PDF and UI.

#### L3 — `docs/` contains two overlapping audit documents
`CROSS_PLATFORM_REPOSITORY_AUDIT.md` and `frontend-audit.md` predate this audit and
are not referenced by code.

---

## 4. Security posture

| Control | Status | Evidence |
|---|---|---|
| Password hashing | Implemented | `services/auth.service.ts` (`hashPassword`) |
| Helmet security headers | Implemented | `app.ts:20-26` |
| CORS allowlist (env-driven) | Implemented | `app.ts:27-38` |
| Global + auth + 2FA + forgot-password rate limits | Implemented | `middleware/error.ts:9-33` |
| JWT access (15m) + refresh rotation | Implemented | `config/env.ts`, `services/session.service.ts` |
| Email 2FA on sensitive login | Implemented | `services/auth.service.ts` |
| RBAC at module + action level | Implemented | `middleware/auth.ts`, `shared/permissions.ts` |
| Record-level scoping | Implemented (one gap: C2) | `services/rbac.service.ts` |
| Evidence type + size validation | Implemented | `routes/evidence.routes.ts:34-43` |
| Evidence not statically served | Implemented (no `express.static` anywhere) | verified |
| Evidence download audit | Implemented | `routes/evidence.routes.ts:201` |
| Secrets not in frontend bundle | Verified — all secrets via `import.meta.env.VITE_*` are public-by-design only | `config/env.ts` |
| Audit log on sensitive mutations | Implemented | `services/audit.service.ts` |
| Encrypted backups | Implemented | `services/backup.service.ts` |
| Backup encryption key enforced in production | **Gap** — `BACKUP_ENCRYPTION_KEY` is optional (`config/env.ts`) |

---

## 5. Data integrity

| Control | Status | Evidence |
|---|---|---|
| Ledger is append-only; reversals are new transactions | Implemented | `services/ledger.service.ts` |
| No direct balance writes outside the ledger | Implemented | balance updated inside `postTransaction` |
| Idempotency on bulk apply | Implemented | `services/bulk.service.ts` (`clientReference`) |
| Idempotency on offline sync | Implemented | `routes/sync.routes.ts:40-45` |
| Unique indexes on natural keys | Implemented | model schemas |
| Reconciliation endpoint | Implemented | `routes/discipline.routes.ts` |
| Versioned migrations | **Missing** (M4) | — |
| Automated DB backup verification | **UNVERIFIED** — restore is not tested automatically | `services/backup.service.ts` |

---

## 6. Performance

- Indexes present on hot query fields (status, nextAttemptAt, studentId, userId+readAt+createdAt).
- `analytics.service.ts:89-97` runs **N+1** class-average aggregations (one aggregate per class, up to 8). Acceptable at 8, but it is a sequential `Promise.all` over per-class pipelines — should be a single `$group` pipeline.
- `students.routes.ts` list endpoint uses pagination (`parsePagination`) — good.
- No response caching layer; dashboard recomputes on every request.

---

## 7. Production readiness

| Requirement | Status |
|---|---|
| Backend builds | Yes |
| Frontend builds | Yes |
| Mobile typechecks | Yes |
| Tests pass | Yes (56) |
| CI gate | **No** (H3) |
| Migration strategy | **No** (M4) |
| Error monitoring (Sentry etc.) | **No** — only structured pino logs |
| Health check endpoint | Present (`/api/v1/health`) |
| Backup restore drill | **Not automated** |
| Staging environment config | **Absent** — `render.yaml` only |

---

## 8. Recommended order of work

1. **C1** — close the approval-timeline authorization hole (one-line fix + test).
2. **C2** — scope the ledger aggregate.
3. **H3** — add CI (typecheck + test + build on PR).
4. **H1** — add route-level guards to `approvals.routes.ts`.
5. **H4** — authorization matrix tests for all 12 roles.
6. **M2** — role-specific dashboards on web (backend already supplies the data).
7. **M1/M3** — mobile role dashboards and screen parity.
8. **M4** — versioned migration runner.
9. **M5** — notification preferences + device token models.

See `CONDUCTNEXUS_IMPLEMENTATION_ROADMAP.md` for the phased plan and
`FEATURE_COMPLETION_MATRIX.md` for per-module status.
