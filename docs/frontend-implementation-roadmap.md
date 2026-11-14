# ConductNexus Frontend Implementation Roadmap

This roadmap turns the transformation plan into phases that preserve the existing ConductNexus monorepo. Each phase ships working screens backed by real endpoints, with loading, empty, error and success states.

## Phase 1 — Audit and shared design system

- Audit complete in `docs/frontend-audit.md`.
- Reuse existing `components/ui.tsx` primitives; add only what is genuinely shared (asset preview, import preview, permission matrix cells).
- Keep navy/indigo + ochre tokens and written status labels alongside colour.

## Phase 2 — Application shell and dashboards

- Permission-aware sidebar groups: Workspace, Students, Discipline, Conduct, Student Support, Attendance, Parents, Documents, Reports, Administration, System.
- Global search (`/search`) across students, incidents, letters and cases, filtered by permission.
- Command palette (Ctrl/Cmd+K) that navigates only to permitted routes.
- Notification centre and My Tasks pages fed by existing notification/task endpoints.
- Role dashboards: administrator, discipline officer, teacher/class teacher, headteacher, DOS, patron/matron, parent. Every number comes from the API; class teachers see their assigned classes and students.

## Phase 3 — Student management

- Directory: sorting, page size, card/table views, saved filters, column visibility, bulk selection and export.
- Full CRUD: detail route, validated create wizard, edit every field, explicit soft delete (archive) with confirmation and restore.
- Import wizard: CSV, XLSX and pasted text; delimiter detection; column mapping; duplicate/error highlighting; dry-run validation; commit summary.
- Extensible model: `customFields` and direct contact details editable without code changes.
- Profile: identity card, overview metrics, and tabs for personal, academic, guardians, discipline, ledger, risk, interventions, attendance, boarding, investigations, sanctions, appeals, letters, communication, documents, lifecycle and activity.

## Phase 4 — Discipline and evidence

- Guided recording: multi-student selection, explicit offence category/rule, duplicate warning, witnesses, evidence upload, immediate action, draft/submit.
- Incident directory with period/status/class/severity filters and review/approval columns.
- Case page: summary, involved students, evidence gallery, witnesses, investigation, review decisions, ledger entries, sanctions, notifications, appeals, audit timeline, action panel.
- Evidence workspace: case header, primary preview with thumbnails, video/image/total/validated stats, all-assets table, validation summary, findings, notes/activity, add-evidence and download-all.

## Phase 5 — Conduct and approvals

- Ledger workspace with term summaries, opening/closing balances, transaction table, individual transaction view, related incident, reversal details, statements, print/export and correction requests.
- Central Approval Centre filtered by type and permission, with details, evidence, history, impact preview, decision reason and request-changes.
- Bulk approval only where policy allows; serious cases stay individual.

## Phase 6 — Risk and support

- Risk dashboard with distribution, escalations, overdue assessments and improvement trends.
- Watchlist with reason, factors, officer, review date and actions.
- Support centre: interventions, counselling referrals/sessions (confidential), mentoring assignments, behaviour improvement plans and follow-up tracking.

## Phase 7 — Attendance and boarding

- Backend: attendance sessions and records, bulk marking, corrections, analytics and alert thresholds; dormitory roll call and leave requests.
- Frontend: class register, date/session selection, present/absent/late/excused with reasons, dorm roll call, leave approvals, analytics and student attendance tab.

## Phase 8 — Parents and communications

- Parent dashboard: children, balances, incidents, attendance, letters, meetings, acknowledgements.
- Communication centre: composer, templates, channel selection, preview, queue, failed messages, retry, delivery reports, per-student history.
- Broadcast to all/selected parents, scoped by school/class/stream and consent.
- Kinyarwanda and English templates with language selection; every parent message carries the portal link.

## Phase 9 — Letters and documents

- Template library (admission, meeting, warning, discipline, improvement, hearing, suspension, reinstatement, transfer, withdrawal, expulsion, graduation, clearance, good conduct) in English and Kinyarwanda.
- Workflow: select student, template, verified data, edit permitted fields, preview, approval, PDF, send/print, acknowledgement, store in profile.
- Document centre with categories, previews, expiry and restricted access.

## Phase 10 — Academic administration and promotion

- Class/stream/dormitory/room/year/term administration, class-teacher and patron/matron assignment, occupancy and discipline summaries.
- Promotion workspace: individual/bulk/class promotion, stream transfer, repetition, finalist and graduation, validation, preview, approval, batch status and history.

## Phase 11 — Reports and administration

- Report centre categories (students, discipline, conduct, risk, support, attendance, boarding, parents, academic, governance) with filters, CSV/PDF/print and timestamps.
- User management with automatic role assignment, permission matrix, audit filters/export and settings.

## Phase 12 — Responsive, accessibility and production

- Responsive tables and card layouts; keyboard navigation; accessible labels and non-colour status text.
- Email two-factor authentication, approval routing, durable object storage, reliable background jobs, observability and CI checks.
- End-to-end verification on desktop and mobile widths; no feature marked complete without a working backend path.

## Verification per phase

1. Typecheck and production build for `frontend/` (and `backend/` where APIs change).
2. Run backend tests; add integration tests for new endpoints and parser tests for import.
3. Verify each role's navigation and API denials.
4. Confirm loading, empty, error and success states.
5. Update `docs/API_REFERENCE.md` and `CHANGELOG.md` when contracts change.
