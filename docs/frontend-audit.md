# ConductNexus Frontend Audit

Audit date: 2026-11-14. Scope: `frontend/` (React 18 + TypeScript + Vite), its API client, auth/permission handling, and the backend contracts it consumes. This document records what exists, what is partial, and what is missing before the transformation phases begin.

## 1. Stack and conventions

- React 18, TypeScript, Vite 6, React Router 6, TanStack Query 5, Tailwind 3.4, Recharts, Lucide, Axios.
- Design tokens live in `frontend/tailwind.config.js`: `navy`, `brand` (indigo), `ochre` (orange), `cyan.accent`, `canvas`, `line`, plus risk/status colours. These are the established ConductNexus palette and must not be replaced.
- Shared UI primitives live in `frontend/src/components/ui.tsx` (`Button`, `Card`, `Field`, `Input`, `Select`, `Textarea`, `Modal`, `Tabs`, `Badge`, `StatusBadge`, `RiskBadge`, `Pagination`, `EmptyState`, `Alert`, `SearchInput`, `Checkbox`, `StatCard`, skeletons).
- API access is centralised in `frontend/src/lib/api.ts` (token refresh, envelope unwrapping, CSV download helper). Hooks live in `frontend/src/lib/hooks.ts`.
- Permission checks use `useAuth().has(permission)`; the backend remains the authority.

## 2. Application shell

| Area | State | Notes |
| --- | --- | --- |
| Sidebar grouped by responsibility | Present, partial | Groups exist but not every plan module is represented (attendance, support centre, letters, parent directory). |
| Permission-aware navigation | Present | Items gate on permissions, but some modules are only reachable from detail pages. |
| Top header | Present | Contains search trigger/notifications/profile; academic year and term display is limited. |
| Global search | Partial | Student search exists inside incident recording; no cross-entity search page. |
| Notification centre | Partial | Socket/notification plumbing exists; no consolidated centre page. |
| My Tasks | Missing | No aggregated task inbox. |
| Breadcrumbs | Missing | Pages use back links instead. |
| Command palette | Missing | No keyboard shortcut layer. |
| Error boundary / session timeout warning | Partial | API 401 refresh exists; no user-facing session warning. |

## 3. Dashboards

`frontend/src/pages/Dashboard.tsx` renders a statistics-driven dashboard from `GET /dashboard`. It is not role-specific beyond what the API returns. Class teachers cannot yet see a scoped "my class" workspace. Parent users use `Portal.tsx` rather than a dedicated dashboard route.

## 4. Students

| Feature | State | Notes |
| --- | --- | --- |
| Directory table, search, class/risk/status filters, pagination | Present | `Students.tsx`. |
| Sorting, page size, card view, saved filters, column visibility, bulk selection | Missing | Fixed page size 20, single table view. |
| Registration wizard | Present | Five-step modal with guardians and validation. |
| Edit / lifecycle / archive / restore | Present | `StudentProfile.tsx` edit modal and lifecycle actions (archive/restore are soft delete/undo). |
| Explicit delete with confirmation | Partial | Only lifecycle archive; no delete affordance in the directory. |
| Bulk import | Partial | Backend `POST /students/import` accepts pre-parsed rows only; no CSV/XLSX/paste UI, mapping, duplicate preview or summary. |
| Custom fields | Missing | Student schema is fixed. |
| Profile tabs | Partial | Overview, personal, academic, guardians, discipline, ledger, risk, interventions, documents, history, activity; attendance, sanctions, letters, communication and boarding tabs are not first-class. |

## 5. Incidents and evidence

| Feature | State | Notes |
| --- | --- | --- |
| Quick recording | Partial | Single student, witnesses, safeguarding flag, offline drafts; no multi-student selection, duplicate warning or evidence attachment. |
| Directory filters and bulk review | Present | Class/status filters and independent bulk review. |
| Case detail page | Partial | Review/actions exist; evidence gallery, sanction block, notification and appeal history are thin. |
| Evidence upload | Present | `POST /evidence` multipart, links to incidents and adds `incident.evidenceIds`. |
| Evidence workspace | Partial | `Evidence.tsx` is a flat table; no case header, previews, validation summary, notes or download-all. |

## 6. Conduct ledger and approvals

- Ledger is displayed inside the student profile and reports. There is no standalone ledger workspace with term summaries, statements and correction requests.
- `Approvals.tsx` lists approval documents and decides through the backend `requiredPermission`. The approval list supports the main types but lacks request-change and impact preview.

## 7. Risk and support

- `Risk.tsx` covers watchlist and assessments. Interventions, follow-ups and recognition are shown in the student profile.
- No dedicated support centre for counselling, mentoring or behaviour improvement plans.

## 8. Attendance and boarding

- No attendance models, API, or screens. Backend statuses and register capture must be built before UI. Dormitory roll call and leave management are also absent.

## 9. Parent portal and communications

- `Portal.tsx` shows linked children, balance, incidents, letters and meetings.
- `Communications.tsx` exposes queue and templates but not composer, failed-message triage, delivery reports or broadcast to all parents.
- Messages are WhatsApp-only; SMS infrastructure exists but is not surfaced as policy-compliant fallback.
- No Kinyarwanda template content or language selection.
- Parent messages do not include a portal link.

## 10. Letters and documents

- Letter templates, PDF generation, approval and issue endpoints exist. The frontend has no dedicated letters workspace or template editor; letters appear in the student profile/portal.
- Student documents support upload/delete but no categories, previews, expiration tracking or version history.

## 11. Academic administration and promotion

- `Structure.tsx` manages classes, streams, dormitories, years and terms. Rooms are not modelled.
- `Promotions.tsx` exists; end-to-end preview/approval/batch status/history needs completion.

## 12. Reports and administration

- `Reports.tsx` has report kinds, CSV export and ledger integrity. It does not yet expose attendance/boarding/parent categories.
- `Users.tsx` manages accounts and roles; creation currently requires explicit roles.
- No visual permission matrix; `Audit.tsx` lists logs with limited filters/export.

## 13. Priority gaps

1. Student import wizard, custom fields, explicit soft delete/restore, and directory usability.
2. Evidence capture during recording, a proper evidence workspace, and download-all.
3. Role dashboards including class-teacher scope, global search, My Tasks and notification centre.
4. Central approval routing (teacher/patron/matron submissions, deduction vs letter approvers).
5. Communication composer, broadcast, Kinyarwanda templates and portal links.
6. Attendance and boarding end-to-end; support centre; letters/documents workspaces.
7. Email two-factor authentication and production hardening (storage, jobs, observability).

## 14. Constraints preserved

- No new frontend framework; no fake statistics; no duplicated backend business rules.
- Ledger records remain immutable; corrections go through reversal/adjustment workflows.
- Sensitive records stay behind backend authorisation; the UI only hides what the API already restricts.
