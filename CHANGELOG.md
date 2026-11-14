# Changelog

All notable changes to ConductNexus. Versions follow [Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-11-14

Additions from the master implementation plan: bulk discipline operations, email 2FA and
Kinyarwanda parent communications.

### Added

**Bulk deduct / reward (`/discipline/bulk/*`)**
- Preview and apply deductions or rewards across a class, stream, or explicit student
  selection, with per-student projected balances and skip reasons.
- Per-student audited ledger entries linked by a `bulkOperationId`; idempotent via the
  `Idempotency-Key` header and a per-operation unique index; partial-failure reporting
  (`applied`/`skipped`/`failed`) and a `BulkOperation` audit record.
- Deductions require both `marks.deduct` and `marks.adjust.approve` (separation of duties);
  no deduction is ever applied on report.

**Email two-factor authentication**
- Per-user enrolment (`/auth/2fa/enroll|confirm|disable|status`) with hashed, expiring
  (10 min), attempt-limited (5) and rate-limited codes; challenge tokens issued after
  password login and verified via `/auth/2fa/verify` (web) and `/auth/native/2fa/verify`
  (native). Web login and mobile sign-in show a code-entry step; sessions are only issued
  after verification.

**Kinyarwanda parent communications**
- Kinyarwanda notification templates (`*_rw`) selected automatically when the school
  language is `rw`, with English fallback.
- Every parent (WhatsApp) message now includes the parent-portal link.

### Changed
- Discipline ledger indexes corrected so bulk deductions (no `incidentId`) no longer collide
  on the incident-deduction unique index; the index now only covers incident-linked
  deductions.

## [1.1.0] — 2026-11-14

Cross-platform release: the same backend and discipline rules now serve the web app, an
installable PWA and native Android/iOS apps.

### Added

**Native apps (`mobile/`)**
- Expo SDK 58 app with Expo Router, staff and parent experiences.
- Native authentication (`/auth/native/login|google|refresh|logout`) with rotating refresh
  tokens stored in SecureStore and revocable device sessions.
- Biometric unlock, device management screen and push-token registration.
- Staff workflows: dashboard, incident list and detail, independent review, new incident
  with student/offence pickers, student profile, approvals/notices, offline drafts.
- Parent portal: children, conduct ledger, incidents, letters, meetings, recognition,
  consent switches and data-protection requests.
- SQLite offline incident drafts with idempotent sync and safeguarding flags preserved.
- Session revocation, change password, privacy screen and exact product footer.

**PWA and offline web**
- Web app manifest, hand-written service worker with app-shell caching and an offline
  fallback page; install and update prompts.
- Cache headers for `sw.js` and the manifest in `firebase.json`.
- Offline incident drafts moved to IndexedDB with automatic migration from localStorage.

**Production hardening**
- Ledger reconciliation report (`GET /discipline/ledger/reconciliation`) verifying chains,
  balances, negative balances and duplicate deductions per term.
- Bulk incident review (`POST /incidents/bulk-review`) with per-incident verdicts while
  enforcing independent review.
- Reports UI gains a **Ledger integrity** tab.
- Incidents UI gains multi-select bulk approve/reject with per-incident result feedback.
- Communication queue recovers abandoned `sending` leases after a worker crash.
- Offline sync accepts `safeguardingFlag` and witnesses from web and mobile drafts.

**Documentation**
- `docs/API_REFERENCE.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/DEPLOYMENT_GUIDE.md`.
- `mobile/README.md` with environment, push, Google sign-in and EAS release steps.
- README cross-platform and documentation sections.

### Changed
- Parent portal incidents now expose the offence deduction value and deduction state.
- Approvals entry points in the mobile app gate on the permissions approvals actually use
  (`marks.adjust.approve`, `incidents.review`, `letters.approve`, `students.promote.approve`).
- Root scripts install and type-check all three applications.

### Fixed
- TypeScript errors across the mobile app (tab icon colors, unused imports, offence code
  typing, indexed access).
- Safeguarding flag was dropped when an offline draft synced.
- Portal `deductionApplied` is a boolean; the deduction amount is exposed separately.

### Security
- `.gitignore` now excludes WhatsApp session artifacts and Expo build directories.

### Tests
- Backend suite extended to **23 tests**: reconciliation (including a deliberately
  corrupted row), bulk review with self-review prevention, native sessions and refresh-token
  reuse detection.

---

## [1.0.0] — Initial release

Web platform with conduct ledger, incident workflow, independent review, risk engine,
safeguarding, investigations, appeals, parent communications, letters/PDFs, reporting,
Rwanda data-protection tools, audit trail, backups and monitoring.
