# ConductNexus — Feature Completion Matrix

Status reflects **verified source inspection**, not documentation claims.
`IMPLEMENTED` = backend + frontend wired and typechecked.
`TESTED` = covered by an executed automated test.

---

## Core platform

| Feature | Backend | Web | Mobile | Tests | Status |
|---|---|---|---|---|---|
| Authentication (JWT access + refresh, rotation) | Yes | Yes | Yes | Yes | TESTED |
| Email 2FA on sensitive login | Yes | Yes | Partial | Yes | TESTED |
| Password reset / forgot password | Yes | Yes | Yes | Yes | TESTED |
| RBAC — 12 roles, 100+ permissions | Yes | Yes | Partial | Partial | IMPLEMENTED |
| Record-level student visibility | Yes | Yes | Partial | Partial | IMPLEMENTED |
| Audit logging | Yes | Yes | No | Partial | IMPLEMENTED |
| Session management + revocation | Yes | Yes | Yes | Partial | IMPLEMENTED |
| Account lockout / brute-force protection | Yes | n/a | n/a | No | IMPLEMENTED |

## Students and lifecycle

| Feature | Backend | Web | Mobile | Tests | Status |
|---|---|---|---|---|---|
| Student registration (full field set) | Yes | Yes | No | Yes | IMPLEMENTED |
| Student search / filter / paginate | Yes | Yes | Yes | Yes | IMPLEMENTED |
| Student profile (overview, discipline, risk, documents) | Yes | Yes | Partial | Partial | IMPLEMENTED |
| Photograph upload / update | Yes | Yes | No | No | IMPLEMENTED |
| Lifecycle: admit / promote / transfer / withdraw / graduate / expel | Yes | Yes | No | Partial | IMPLEMENTED |
| Archive / restore | Yes | Yes | No | Yes | TESTED |
| Bulk CSV/Excel import with preview + duplicate detection | Yes | Yes | No | No | IMPLEMENTED |
| Bulk export | Yes | Yes | No | No | IMPLEMENTED |

## Discipline engine

| Feature | Backend | Web | Mobile | Tests | Status |
|---|---|---|---|---|---|
| Configurable starting conduct balance | Yes | Yes | n/a | Yes | TESTED |
| Permanent ledger, append-only | Yes | Yes | n/a | Yes | TESTED |
| Deduction / reward / adjustment / reversal | Yes | Yes | No | Yes | TESTED |
| Term open / close balances | Yes | Partial | n/a | Partial | IMPLEMENTED |
| Approval-based deduction (separation of duties) | Yes | Yes | No | Yes | TESTED |
| Ledger reconciliation | Yes | Yes | n/a | Yes | TESTED |
| Bulk deduct / reward (class, stream, dormitory, school, selection) | Yes | Partial | No | Yes | TESTED |
| Bulk exclusion with recorded reason | Yes | Partial | No | Yes | TESTED |
| Idempotent bulk apply | Yes | n/a | n/a | Yes | TESTED |
| Bulk preview with impact + eligibility | Yes | Partial | No | Yes | TESTED |

## Incidents

| Feature | Backend | Web | Mobile | Tests | Status |
|---|---|---|---|---|---|
| Incident creation with full field set | Yes | Yes | Yes | Yes | TESTED |
| Configurable offences / categories | Yes | Yes | n/a | Yes | TESTED |
| Incident workflow (draft → resolved → archived) | Yes | Yes | Partial | Yes | TESTED |
| Rejection / reopening / authorized reversal | Yes | Yes | No | Partial | IMPLEMENTED |
| Evidence upload (type + size validated) | Yes | Yes | Partial | Partial | IMPLEMENTED |
| Drafts (offline, web) | Yes | Yes | Yes | Partial | IMPLEMENTED |

## Risk, support, welfare

| Feature | Backend | Web | Mobile | Tests | Status |
|---|---|---|---|---|---|
| Risk engine with explainable bands | Yes | Yes | No | Partial | IMPLEMENTED |
| Interventions / behaviour plans | Yes | Yes | No | Partial | IMPLEMENTED |
| Follow-ups with due dates + assignment | Yes | Yes | Yes | Partial | IMPLEMENTED |
| Safeguarding cases | Yes | Yes | No | Partial | IMPLEMENTED |
| Counselling records | Partial | Partial | No | No | IMPLEMENTED |

## Investigations, appeals, evidence

| Feature | Backend | Web | Mobile | Tests | Status |
|---|---|---|---|---|---|
| Investigations (assign, evidence, findings, close) | Yes | Yes | No | Partial | IMPLEMENTED |
| Appeals (submit, review, decide) | Yes | Yes | No | Partial | IMPLEMENTED |
| Evidence access control + download audit | Yes | Yes | No | Partial | IMPLEMENTED |

## Communications

| Feature | Backend | Web | Mobile | Tests | Status |
|---|---|---|---|---|---|
| In-app notifications + Socket.IO | Yes | Yes | Yes | Partial | IMPLEMENTED |
| Parent WhatsApp messaging (consent-aware) | Yes | Yes | n/a | Yes | TESTED |
| Quiet hours, retry, dead-letter queue | Yes | Yes | n/a | Partial | IMPLEMENTED |
| Email + SMS providers | Yes | Yes | n/a | No | IMPLEMENTED |
| **Bilingual template library — 30 types × EN/RW** | Yes | Yes | n/a | Yes | TESTED |
| **Placeholder validation before send** | Yes | Yes | n/a | Yes | TESTED |
| Template categories / preview / restore / duplicate / versioning | Yes | Yes | n/a | Yes | TESTED |
| Push notifications (Expo/FCM) | Partial | Partial | Partial | No | IMPLEMENTED |
| Notification preferences (per channel, per category) | Yes (API) | Yes (API) | No | Partial | IMPLEMENTED |
| Notification priority + grouped inbox | Yes | Yes | No | No | IMPLEMENTED |
| Device token registry | Partial | Partial | Partial | No | IMPLEMENTED |

## Letters and documents

| Feature | Backend | Web | Mobile | Tests | Status |
|---|---|---|---|---|---|
| Letter creation with approval workflow | Yes | Yes | No | Partial | IMPLEMENTED |
| **9 official letter types, bilingual** | Yes | Yes | n/a | Yes | TESTED |
| A4 PDF with school identity + stamp placeholder | Yes | Yes | n/a | Partial | IMPLEMENTED |
| Letter numbering, history, download audit | Yes | Yes | n/a | Partial | IMPLEMENTED |

## Operations

| Feature | Backend | Web | Mobile | Tests | Status |
|---|---|---|---|---|---|
| Academic years / terms / classes / streams / dormitories | Yes | Yes | No | Partial | IMPLEMENTED |
| Promotions | Yes | Yes | No | Partial | IMPLEMENTED |
| Meetings | Yes | Yes | Yes | Partial | IMPLEMENTED |
| Policies | Yes | Yes | No | Partial | IMPLEMENTED |
| Reports + analytics | Yes | Yes | No | Partial | IMPLEMENTED |
| Report export (PDF/XLSX/CSV) | Partial | Partial | No | No | IMPLEMENTED |
| Backup + restore | Yes | Partial | n/a | No | IMPLEMENTED |
| Monitoring / health | Yes | Yes | n/a | No | IMPLEMENTED |
| Offline sync (idempotent, conflict-aware) | Yes | Yes | Yes | Partial | IMPLEMENTED |

## Role dashboards (web)

Every figure comes from `GET /analytics/dashboard`, which scopes each query to
the caller's permissions. `frontend/src/lib/roleDashboards.ts` selects the
leading metrics and visible widgets per role; it never synthesizes data.

| Role | Web dashboard | Mobile | Tests | Status |
|---|---|---|---|---|
| ADMIN | Yes | Role home | Partial | IMPLEMENTED |
| HEADTEACHER | Yes | Role home | Partial | IMPLEMENTED |
| DEPUTY_DISCIPLINE | Yes | Role home | Partial | IMPLEMENTED |
| TEACHER | Yes | Role home | Partial | IMPLEMENTED |
| IT | Yes | Role home | Partial | IMPLEMENTED |
| PATRON | Yes | Role home | Partial | IMPLEMENTED |
| MATRON | Yes | Role home | Partial | IMPLEMENTED |
| BURSAR | Yes | Role home | Partial | IMPLEMENTED |
| DOS | Yes | Role home | Partial | IMPLEMENTED |
| LIBRARIAN | Yes | Role home | Partial | IMPLEMENTED |
| SECRETARY | Yes | Role home | Partial | IMPLEMENTED |
| PARENT | Yes | n/a (separate parent app) | Partial | IMPLEMENTED |
| Authorization matrix (12 roles x protected endpoints) | Yes | n/a | Yes | TESTED |

## Mobile (Expo)

| Feature | Screen | Tests | Status |
|---|---|---|---|
| Role-specific home for all 12 roles | `mobile/src/roleDashboards.ts` + `app/(staff)/index.tsx` | No runner | IMPLEMENTED |
| Approvals review (approve / reject / request info) | `app/(staff)/tasks.tsx` | No runner | IMPLEMENTED |
| Read-only reports (6 kinds, `reports.view`) | `app/reports.tsx` | No runner | IMPLEMENTED |
| Offline drafts + conflict resolution | `app/drafts.tsx`, `src/offline/*` | No runner | IMPLEMENTED |
| Sessions, biometrics, privacy, notifications | `app/sessions.tsx` etc. | No runner | IMPLEMENTED |

No test runner is configured for the mobile package (`package.json` has
`typecheck` and `lint` only), so every mobile row is verified by typecheck
rather than by an executed test.

## Known gaps

| Gap | Severity | Ref |
|---|---|---|
| ~~Approval timeline readable by any authenticated user~~ | ~~CRITICAL~~ | audit C1 — FIXED |
| ~~School-wide ledger aggregate not caller-scoped~~ | ~~CRITICAL~~ | audit C2 — FIXED |
| Approval routes lacked route-level guards | HIGH | audit H1 — FIXED |
| ~~No CI pipeline~~ | ~~HIGH~~ | audit H3 — FIXED (.github/workflows/ci.yml) |
| ~~No versioned migrations~~ | ~~MEDIUM~~ | audit M4 — FIXED (src/migrations/, 
pm run migrate) |
| ~~No notification preference model~~ | ~~MEDIUM~~ | audit M5 — FIXED (NotificationPreference, PUT /notifications/preferences) |
| ~~Mobile has no role-differentiated home~~ | ~~MEDIUM~~ | audit M1 — FIXED (mobile/src/roleDashboards.ts) |
| Counselling records partial | MEDIUM | — |
