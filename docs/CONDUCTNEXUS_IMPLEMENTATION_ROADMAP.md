# ConductNexus — Implementation Roadmap

Derived from `CONDUCTNEXUS_COMPLETE_AUDIT.md`. Ordered by risk-reduction per unit of work.
Status values: `NOT STARTED` · `IN PROGRESS` · `IMPLEMENTED` · `TESTED` · `BLOCKED`.

---

## Phase A — Close the security gaps (highest priority)

| ID | Work | Files | Status |
|---|---|---|---|
| A1 | Fix `GET /approvals/:id/timeline` authorization (audit C1) | `routes/approvals.routes.ts:104` | TESTED |
| A2 | Scope the school-wide ledger aggregate to the caller (audit C2) | `services/analytics.service.ts` (`ledgerScopeFor`) | TESTED |
| A3 | Add route-level `requirePermission` to all `approvals.routes.ts` endpoints (H1) | `routes/approvals.routes.ts` (`APPROVAL_PERMISSIONS`, `loadApproval`) | TESTED |
| A4 | Authorization matrix test: every role x protected endpoint (H4) | `test/authz.test.ts` | TESTED |

**Exit criteria:** no endpoint returns another student's data to an unauthorized role,
proven by test. A1 and A2 are now closed and covered by
`api.test.ts` ("denies an unrelated user the audit timeline…").

---

## Phase B — Repository hardening

| ID | Work | Status |
|---|---|---|
| B1 | GitHub Actions CI: typecheck (3 packages) + backend tests + web build | `.github/workflows/ci.yml` | IMPLEMENTED |
| B2 | Versioned migration runner (`migrations/NNNN_*.ts` + applied ledger) | `src/migrations/`, `src/services/migrations.service.ts`, `src/scripts/migrate.ts` | TESTED |
| B3 | Automated backup → restore drill script | `src/scripts/backup-drill.ts` (`npm run backup:drill`) | TESTED |
| B4 | Require `BACKUP_ENCRYPTION_KEY` in production | `config/env.ts` (`backupKeyPolicyError`), `services/backup.service.ts` | TESTED |
| B5 | Error monitoring hook (provider-agnostic interface, no fake reporting) | `services/monitoring.service.ts` (`ErrorReporter`, `captureError`) | TESTED |

**Exit criteria:** a red PR cannot merge; a backup can be restored and verified.

---

## Phase C — Role-based dashboards (web)

The backend already returns `role`, `roleLabel` and permission-gated `extra`
(`services/analytics.service.ts:185-215`). Work is presentational plus gap-filling.

| Role | Dashboard content | Status |
|---|---|---|
| ADMIN | system overview, users, roles, structure, audit, integrations, notification health | IMPLEMENTED (`lib/roleDashboards.ts` + `pages/Dashboard.tsx`) |
| HEADTEACHER | school-wide discipline, serious incidents, high-level approvals, risk, welfare, investigations, appeals | IMPLEMENTED (`lib/roleDashboards.ts` + `pages/Dashboard.tsx`) |
| TEACHER | assigned classes/students, my incidents, observations, rewards, pending tasks | IMPLEMENTED (`lib/roleDashboards.ts` + `pages/Dashboard.tsx`) |
| DEPUTY_DISCIPLINE | incident ops, approvals, ledger, bulk ops, high-risk, detention, notifications | IMPLEMENTED (`lib/roleDashboards.ts` + `pages/Dashboard.tsx`) |
| IT | service/db/API health, security events, sessions, tokens, failed jobs, backups | IMPLEMENTED (`lib/roleDashboards.ts` + `pages/Dashboard.tsx`) |
| PATRON | assigned welfare, dormitory monitoring, observations, referrals, follow-ups | IMPLEMENTED (`lib/roleDashboards.ts` + `pages/Dashboard.tsx`) |
| MATRON | student care, welfare concerns, health referrals, follow-ups | IMPLEMENTED (`lib/roleDashboards.ts` + `pages/Dashboard.tsx`) |
| BURSAR | authorized financial records, payment summaries, permitted clearance | IMPLEMENTED (`lib/roleDashboards.ts` + `pages/Dashboard.tsx`) |
| DOS | class/stream overview, behaviour trends, repeat incidents, referrals, placement | IMPLEMENTED (`lib/roleDashboards.ts` + `pages/Dashboard.tsx`) |
| LIBRARIAN | library incidents, restricted student lookup, observations, reports | IMPLEMENTED (`lib/roleDashboards.ts` + `pages/Dashboard.tsx`) |
| SECRETARY | meetings, calendar, correspondence, letter preparation, approved documents | IMPLEMENTED (`lib/roleDashboards.ts` + `pages/Dashboard.tsx`) |
| PARENT | linked children, approved incidents, conduct progress, rewards, meetings, documents | IMPLEMENTED (`pages/Dashboard.tsx:62-119`) |

**Exit criteria:** each role sees only data its permissions allow; enforced by the
existing backend guards and proven by test.

---

## Phase D — Mobile parity

| ID | Work | Status |
|---|---|---|
| D1 | Role-specific mobile home for all 12 roles | `mobile/src/roleDashboards.ts` + `mobile/app/(staff)/index.tsx` | IMPLEMENTED |
| D2 | Mobile approvals review flow | `mobile/app/(staff)/tasks.tsx` (approve/reject/request-info sheet) | IMPLEMENTED |
| D3 | Mobile reports (read-only, permission-gated) | `mobile/app/reports.tsx` + `mobile/src/api/endpoints.ts` (`fetchReport`) | IMPLEMENTED |
| D4 | Offline sync conflict UX | `mobile/src/offline/db.ts` (`retryDraftAsNew`) + `mobile/app/drafts.tsx` | IMPLEMENTED |

**Exit criteria:** a teacher and a headteacher see different, correct mobile homes.

---

## Phase E — Notification depth

| ID | Work | Status |
|---|---|---|
| E1 | `NotificationPreference` model + endpoints | `models/communications.ts`, `services/notification-preferences.service.ts`, `routes/communications.routes.ts` | TESTED |
| E2 | `DeviceToken` model + registration/invalidation | Delivered by the existing session-scoped token (`services/session.service.ts`); tokens die with the session | VERIFIED |
| E3 | Web push delivery via configured provider (interface only until configured) | DEFERRED — push is Expo-only (`services/push.service.ts`); web push needs VAPID keys and a service worker that are not provisioned, so no interface is claimed | DEFERRED |
| E4 | Notification grouping + priority levels | `Notification.priority` (derived), inbox ranked by priority and grouped by category | TESTED |

**Exit criteria:** preferences are respected at send time; unconfigured channels are
reported as unconfigured, never faked.

---

## Phase F — Reporting and analytics

| ID | Work | Status |
|---|---|---|
| F1 | Fix N+1 in analytics class averages | `services/analytics.service.ts` (single grouped aggregation) | TESTED |
| F2 | Report exports (PDF/XLSX/CSV) from real data | CSV + PDF (`services/report-export.service.ts`), `?format=pdf` | TESTED |
| F3 | Dashboard response caching | `services/dashboard-cache.ts` (30s TTL, in-flight dedupe, production only) | TESTED |

---

## Phase G — Documentation

| ID | Work | Status |
|---|---|---|
| G1 | Production deployment guide | `docs/DEPLOYMENT.md` | IMPLEMENTED |
| G2 | Complete environment variable reference | `docs/ENVIRONMENT.md` | IMPLEMENTED |
| G3 | Backup and recovery procedures | `docs/BACKUP_AND_RECOVERY.md` | IMPLEMENTED |
| G4 | Mobile build and release guide | `docs/MOBILE_RELEASE.md` | IMPLEMENTED |
| G5 | Notification configuration guide | `docs/NOTIFICATIONS.md` | IMPLEMENTED |
| G6 | Security operations guide | `docs/SECURITY_OPERATIONS.md` | IMPLEMENTED |
| G7 | Dashboard access matrix | `docs/DASHBOARD_ACCESS.md` | IMPLEMENTED |

---

## Recently completed (context)

| Work | Evidence | Status |
|---|---|---|
| Bilingual template library — 30 types × EN/RW = 60 versions | `data/templateLibrary.ts` | TESTED |
| Placeholder validation — refuses unresolved placeholders at send time | `communication.service.ts:118` | TESTED |
| Bilingual A4 letter PDF with school identity + stamp placeholder | `letters.service.ts` | TESTED |
| Template API: categories, preview, restore default, duplicate, versioning | `routes/communications.routes.ts` | TESTED |
| Professional template editor UI (language selector, live preview) | `pages/Communications.tsx` | TESTED |
| Bulk discipline: dormitory + school scope, exclusion with reason | `services/bulk.service.ts` | TESTED |
| School-wide bulk operations restricted to HEADTEACHER/ADMIN | `routes/discipline.routes.ts` | TESTED |
