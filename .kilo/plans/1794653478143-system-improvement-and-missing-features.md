# ConductNexus — Master Implementation Plan (Combined Scope)

> Consolidated from all user prompts in this session and grounded in the current codebase. Full, implementation-oriented scope is captured in `prompt.md` (repo root). This plan defines phased, file-level execution while preserving existing architecture, data, auth, RBAC/API compatibility, and ledger integrity.

## 0. Baseline and invariants (must hold throughout)

- **Upgrade in place:** no rebuild/replace of backend, DB, auth, or working features. Reuse existing models/routes/services (esp. students, incidents, ledger, comms, RBAC). Do not duplicate discipline/ledger rules in clients. No fake production records/statistics.
- **Ledger integrity:** **no auto-deduction on incident report.** Every deduction/reward requires authorized decision and traceable per-student ledger transaction. Corrections only via authorized compensating reversals (append-only). Never edit/delete finalized ledger entries.
- **Security:** backend enforces authorization/final decisions; RBAC, consent, idempotency, audit logging everywhere sensitive. Protect safeguarding/counselling/evidence with restricted access and access logging.
- **Ops reality:** Render ephemeral disk + single-instance WhatsApp (`README.md`, `docs/DEPLOYMENT_GUIDE.md`) → durable storage and worker/session strategy required for production.
- **Repo state:** pre-existing modified/untracked files present — keep all changes scoped; do not overwrite unrelated work.

## 1. Current-state anchors (reuse/extend)

| Area | Key files |
|---|---|
| Roles/permissions/RBAC | `backend/src/shared/roles.ts`, `permissions.ts`, `services/rbac.service.ts`, `services/seed.service.ts` |
| Students/guardians/structure | `backend/src/models/school.ts`, `routes/students.routes.ts`, `services/academic.service.ts`, `frontend/src/pages/Students.tsx`, `StudentProfile.tsx`, `components/ImportStudents*` |
| Discipline/ledger/incidents | `backend/src/models/discipline.ts`, `services/incidents.service.ts`, `ledger.service.ts`, `risk.service.ts`, `routes/discipline.routes.ts`, `frontend/src/pages/IncidentNew.tsx`, `IncidentDetail.tsx`, `Incidents.tsx` |
| Evidence | `backend/src/models/governance.ts`, `routes/evidence.routes.ts`, `frontend` evidence/incident pages |
| Comms/templates/WhatsApp/queue | `backend/src/models/communications.ts`, `services/communication.service.ts`, `sms.service.ts`, `notification.service.ts`, `routes/communications.routes.ts`, `frontend/src/pages/Communications.tsx`, `server.ts` (Socket.IO) |
| Auth/sessions/2FA target | `backend/src/models/core.ts`, `routes/auth.routes.ts`, `services/auth.service.ts`, `session.service.ts`, `config/env.ts`, `frontend/src/lib/auth.tsx`, login flows |
| Frontend shell/routing/api | `frontend/src/App.tsx`, `components/layout/AppShell.tsx`, `lib/api.ts`, `types.ts`, `pages/Dashboard.tsx`, `pages/*` |
| Mobile | `mobile/app/**`, `mobile/src/**` (parity/offline/push) |
| Deploy/config/docs | `firebase.json`, `render.yaml`, `backend/.env.example`, `docs/*`, `README.md`, `CHANGELOG.md` |

## 2. Target scope (from `prompt.md`)

1. **Students:** full CRUD (detail/create/edit/soft-delete+undo), bulk import (CSV/XLSX/pasted text with newline/comma/tab/semicolon parsing), preview + column mapping + duplicate/error highlighting + fix-before-commit + summary, extensible data model/custom fields without per-field code changes, client+server validation, empty/loading/error states, persistence, tests for import parsing and CRUD.
2. **Evidence:** attach on incident record and to existing incidents, store/link, show in Evidence with related incident, support pasted images, downloadable (authorized), preserve hashing/access logging/classification/restricted rules.
3. **Incidents & bulk ops:** fully designed incident workspace (guided/quick record, drafts, duplicates, evidence/witness/action, timeline/status/review/actions), group/multi-student incidents with per-student traceable cases, authorized bulk deduct and bulk reward for whole class/stream with preview/approval/per-student audited ledger entries/idempotency/partial-failure reporting; **no deduction on report**.
4. **Roles/approvals/seeding/dashboards:** add/ensure `Patron`, `Matron` end-to-end; enforce: teachers record but require approval from Dean of Discipline or Headteacher; Headteacher approves letter-to-parent actions; `DEPUTY_DISCIPLINE` approves mark deductions (plus separation of duties); seed missing roles/users idempotently/safely; auto-assign roles on user creation; role-based dashboards for all roles incl. teacher/class-teacher class/student management.
5. **Comms & parent portal:** Kinyarwanda message/letter templates, every parent message includes parent-portal link, broadcast to all parents (consent-aware/auditable), parent portal shows authorized linked-child details only.
6. **2FA:** email-based 2FA (code to provided email + verify), secure (hashed/expiring/limited/rate-limited, audited), integrated with web/mobile auth without breaking sessions.
7. **Frontend transformation:** audit then phased implementation of shell, role dashboards, global search/tasks/notifications, full student profile/tabs, discipline/ledger/approvals/risk/support/attendance/boarding/parents/comms/letters/academic/reports/admin, responsive+a11y+states+performance — reusing existing APIs/components; document (don’t simulate) missing backend contracts.
8. **Production & release:** durable storage, job/queue/WA reliability, hardening/observability, tests+reconciliation, docs, commit/push to GitHub, deploy frontend to Firebase, provide Render backend hosting steps.

## 3. Phased execution plan

### Phase 0 — Audit, ADRs, and implementation contracts (no behavior regressions)
- **Code/docs audit:** confirm actual behavior/gaps for each scope item against anchors above; produce `docs/frontend-audit.md` and `docs/frontend-implementation-roadmap.md` (audit-first per spec).
- **ADRs (record decisions before risky changes):**
  - D1 Delivery sequencing: **(A) hardening-first → domain → experience → release (recommended)** vs domain-first/bounded subset.
  - D2 Group-incident model: parent incident + linked per-student cases (recommended for per-student ledger/approval/audit traceability) vs extension — define schema/refs/idempotency keys.
  - D3 Bulk decision model: approval object(s), atomicity/idempotency, per-student outcomes, partial-failure/rollback-reporting for class/stream deduct-reward.
  - D4 Channel policy: hardened WhatsApp-only queue/comms vs governed multi-channel; chat scope if added (operator/consented guardians recommended).
  - D5 Durable storage & workers: object storage for evidence/backups, signed URLs, WA session persistence, queue/backup/reconciliation/report jobs on Render.
  - D6 2FA: enrollment/mandatory scope, OTP lifetime/attempts, recovery/backup method.
  - D7 Kinyarwanda: authoritative translations and default templates/messages.
  - D8 Attendance/boarding/support backend: implement now vs document required API contracts and defer (no simulation).
- **Contracts:** define/confirm API, permission, audit-event, and migration/backfill contracts per workstream; update `docs/API_REFERENCE.md` plan notes.

### Phase 1 — Foundations and hardening (enables safe domain work)
- **Durable storage (D5):** abstract evidence/backup storage (S3-compatible) with signed access, checksums/integrity, MIME/size controls, migration from `storage/`/local; update `evidence.routes.ts`, backup services, env (`backend/.env.example`), deploy docs.
- **Jobs/reliability:** idempotent/retryable workers for queue processing, backups, reconciliation, scheduled reports, WA supervision; health/lag signals; align `server.ts`/services with topology.
- **Security/observability:** permission-matrix and IDOR/separation-of-duty tests, config guards, structured logging/metrics hooks, rate limits for sensitive flows.
- **Ledger safeguards:** verify/strengthen scheduled reconciliation, reversal/adjustment UX & linkage, term-vs-current clarity — no behavior change that permits auto-deduct or mutable posted entries (`ledger.service.ts`, `discipline.routes.ts`, UI).

### Phase 2 — Identity, RBAC, approvals, and seeding
- **Roles/permissions:** ensure `Patron`, `Matron` and any missing roles/permissions are correctly defined and mapped (`shared/roles.ts`, `permissions.ts`); keep backward-compatible.
- **Approval policy (backend-authoritative):** encode rules — teacher-recorded incidents require approval from Dean of Discipline or Headteacher; Headteacher approves letter-to-parent actions; `DEPUTY_DISCIPLINE` approves mark deductions; enforce separation of duties and high-impact escalation. Update `incidents.service.ts`, approvals utilities/routes, letter/issue flows, permission checks, and UI states (`IncidentDetail`, approvals, letters/comms pages).
- **Seeding & user creation:** idempotent, safe seeds for missing roles/users/defaults/templates (no fake prod data) in `seed.service.ts`/scripts; auto role assignment on user creation (`users` routes/services + UI) per policy.
- **Role dashboards/navigation:** role-aware dashboard data and navigation/guards (`Dashboard.tsx`, `AppShell.tsx`, routing, backend dashboard/analytics endpoints) including teacher/class-teacher scoped management.

### Phase 3 — Email 2FA (auth)
- **Backend:** OTP issuance/verification (hashed, expiring, attempt-limited, rate-limited), challenge state, audited events, SMTP delivery via existing env; integrate into `auth.routes.ts`/`auth.service.ts`/`session.service.ts` and user/session models without breaking existing login/refresh/native flows.
- **Frontend/mobile:** login + verify-code UX, error/empty/loading states, recovery path per D6; update `frontend/src/lib/auth.tsx`, login pages, `mobile` auth flows.
- **Tests:** unit/integration for OTP lifecycle, rate limits, session issuance only post-verify.

### Phase 4 — Students: CRUD, extensibility, and bulk import
- **Model/API:** extend/reuse `school.ts` for extensible attributes/custom fields and any missing editable fields compatibly; ensure soft-delete/archive/restore/undo semantics and full read/edit coverage in `students.routes.ts`/services with validation and audit.
- **Import:** robust parser for CSV, `.xlsx`, and pasted text (newline/comma/tab/semicolon), column detection, mapping, duplicate/error detection, preview, fix-before-commit, dry-run/commit summary (imported/skipped + reasons). Reuse/extend `POST /students/import` and `ImportStudents`/Students UI.
- **UI:** validated create/edit/detail forms, custom-fields editing without code changes per field, empty/loading/error states, persistence. Extend `Students.tsx`, `StudentProfile.tsx`, `lib/api.ts`, types.
- **Tests:** import parsing matrix and CRUD flow tests (client/server as feasible).

### Phase 5 — Evidence and incident workspace
- **Evidence:** support upload on create and to existing incidents (incl. pasted images), linkage to incident and Evidence views, authorized download, integrity/access logging/classification preserved. Extend `evidence.routes.ts`, governance models, `IncidentNew.tsx`, `IncidentDetail.tsx`, evidence pages/components.
- **Incident UX/workflow:** fully designed incident pages — guided record, multi-student selection, drafts, duplicate detection, witnesses/immediate action, timeline/history, filters/actions, review/decision states reflecting approval rules; reuse `incidents.service.ts`/`discipline.routes.ts`.
- **Tests:** evidence attach/link/download and incident create/submit/review flows.

### Phase 6 — Group incidents and bulk deduct/reward (ledger-critical)
- **Data model (per D2):** implement parent/shared incident context with per-student case records linked for traceability; idempotent creation keys.
- **Bulk operations (per D3):** class/stream (and selected group) deduct and reward with preview, explicit authorization/approval, **per-student audited ledger transactions**, idempotency keys, and partial-failure reporting — never auto-deduct on report. Reuse/extend `ledger.service.ts`, `incidents.service.ts`, `discipline.routes.ts`, approvals, and UI.
- **Reconciliation & verification:** prove no duplicate deductions, correct balances/compensations, and full audit trail (`GET /discipline/ledger/reconciliation`, targeted tests).

### Phase 7 — Communications, templates, and parent portal
- **Templates:** add/seed Kinyarwanda message and letter templates (per D7) in `communications.ts` models/seeds and template management; rendering/variable validation.
- **Messaging:** inject parent-portal link into parent messages; implement consent-aware/auditable **broadcast to all parents** (scoped filters, delivery tracking) via `communication.service.ts`/routes/UI.
- **Channel/queue:** apply D4 (harden WhatsApp-only or governed multi-channel) with observability, retries/dead-letter triage, opt-outs/consent; update `Communications.tsx` and queue views.
- **Parent portal:** ensure authorized, linked-child-only views include relevant updates; no restricted data leakage. Reuse portal routes/pages.

### Phase 8 — Frontend transformation (phased per audit/roadmap)
- Implement per `docs/frontend-implementation-roadmap.md`: **Phase A** shell/layout/nav/role guards/search/tasks/notifications + shared design system/components; **Phase B** role dashboards (real data); **Phase C** student directory/register/profile/tabs/actions; **Phase D** incidents/cases/ledger/approvals; **Phase E** risk/support; **Phase F** parent portal/comms/letters/documents; **Phase G** academic/promotions; **Phase H** reports/admin/audit/settings; **Phase I** attendance/boarding if in-scope else document contracts (D8). Enforce responsive/a11y, loading/empty/error, pagination, lazy tabs, typed API handling, permission-aware UI.
- Preserve `App.tsx`, `AppShell.tsx`, `lib/*` patterns; extend feature folders/components incrementally.

### Phase 9 — Verification, documentation, and release
- **Automated checks:** `npm run typecheck`, `npm test`, frontend build, mobile build/typecheck as applicable; run added tests (import parsing, CRUD, permissions/approvals, ledger/idempotency, 2FA, comms). Fix failures.
- **Integrity/security validation:** reconciliation clean, no report-time deductions, idempotent bulk/group ops, evidence access controls, consent enforcement, 2FA/session behavior, role/approval rules (teacher→Dean/Headteacher for incidents, Headteacher for letters, `DEPUTY_DISCIPLINE` for deductions).
- **Docs:** update `docs/API_REFERENCE.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/DEPLOYMENT_GUIDE.md`, `README.md`, `CHANGELOG.md`; include audit/roadmap docs.
- **Release ops (when executing):** commit/push to GitHub (no secrets/session/prod data); deploy frontend to Firebase (`firebase.json`); document Render backend hosting steps (service/web+worker as needed, env vars from `backend/.env.example`, persistent storage/WA session, MongoDB, SMTP, CORS/socket, health checks). List files added/changed and exact run/verify steps.

## 4. Per-feature implementation checklist (apply to every slice)

- Compatible model/migration/backfill (ledger append-only/compensating).
- Service/API with validation, RBAC, consent, idempotency, audit.
- Web (and mobile where in scope) UI with loading/empty/error states and offline/sync considerations.
- Docs/runbooks/seeds updated; automated tests added; staging/verification evidence.

## 5. Risks and mitigations

- **Ledger/approval correctness:** enforce in services, per-student transactions, idempotency, reconciliation tests.  
- **Uncommitted baseline changes:** scope diffs carefully; avoid touching unrelated files.  
- **WhatsApp/ephemeral storage:** resolve D4/D5 before relying on comms/evidence durability in production.  
- **Scope size:** execute by phases with ADR gates; do not mark incomplete backend-dependent UI as functional.

## 6. Material open decisions (resolve to proceed safely)

1. **D1 Delivery sequencing** (recommended: A, hardening-first).  
2. **D2 Group-incident data model** (recommended: parent + per-student cases).  
3. **D3 Bulk deduct/reward approval & idempotency model.**  
4. **D4 Channel policy and chat scope** (recommended: WhatsApp-only hardened; operator/consented guardians if chat).  
5. **D5 Durable storage/worker topology on Render.**  
6. **D6 2FA enrollment/recovery policy.**  
7. **D7 Kinyarwanda authoritative text/defaults.**  
8. **D8 Attendance/boarding/support in-scope now vs contract-only.**  

**Recommended default to start implementation:** D1=A, D2=parent+per-student cases, D4=WhatsApp-only hardened, D5=S3-compatible storage + persistent WA session volume + dedicated worker(s) as feasible, D8=deliver contracts/docs for unbuilt attendance/boarding/support backends while implementing all explicitly requested student/incident/evidence/roles/comms/2FA/deploy items.
