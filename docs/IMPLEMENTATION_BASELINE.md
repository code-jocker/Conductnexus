# ConductNexus — Implementation Baseline

Date: 2026-11-14
Companion: `docs/CROSS_PLATFORM_REPOSITORY_AUDIT.md`

Status legend: **Complete** (UI → API → DB → tests/verified), **Partial**
(some layer missing or unverified), **Absent**.

## 1. Core platform

| Capability | Status | Notes |
| --- | --- | --- |
| Auth: password, refresh rotation, reuse detection, lockout | Complete | Browser cookie refresh; verified locally |
| Auth: Google/Firebase ID token | Complete | Server-side verification; requires Firebase clients |
| RBAC: roles, permissions, overrides | Complete | Granular permission strings |
| Audit log | Complete | Actor, action, resource, reason, before/after |
| Setup wizard + demo seed | Complete | Counter sync fix applied for student IDs |
| Settings (school, discipline, comms) | Complete | Per-school configuration |
| Health, monitoring, error log | Complete | `/health`, admin monitoring |
| Backups | Partial | Scheduled records exist; restore drill not verified |

## 2. School structure and students

| Capability | Status | Notes |
| --- | --- | --- |
| Academic years, terms, classes, streams, dormitories | Complete | Structure routes |
| Student registration, IDs, status, promotion | Complete | Unique-ID allocation fixed |
| Student profile, history, ledger view | Complete | Web profile page |
| CSV import/export | Complete | Backend endpoints |
| Guardian records and links (consent-aware) | Complete | Consent gating on communications |
| Parent portal (web) | Complete | Children, conduct, notices, meetings |
| Attendance module | Absent | No first-class attendance model |

## 3. Discipline

| Capability | Status | Notes |
| --- | --- | --- |
| Offence catalogue and policies | Complete | |
| Incident report / submit / review / reject / info request | Complete | Reporter cannot review own incident |
| Independent approval and high-impact escalation | Complete | Headteacher escalation |
| Conduct ledger (append-only, compensating reversals) | Complete | Idempotency + balance snapshots |
| Historical term balance reporting | Partial | Must derive from term-scoped ledger events |
| Adjustment requests and approvals | Complete | |
| Rewards/recognition | Complete | Recognition, plans |
| Risk engine and watchlist | Complete | Incident-derived; explainability fields |
| Interventions and follow-ups | Complete | |
| Detention, suspension, counselling, improvement plans | Absent | Only interventions/follow-ups exist |
| Bulk review of incidents | Absent | No bulk endpoint/UI |
| Evidence, investigations, appeals | Complete | Upload + access audit |
| Safeguarding cases and restricted access | Complete | Stronger permissions, access logs |
| Letters, templates, PDF | Complete | |
| Meetings and minutes | Complete | |
| Reports and exports | Complete | Summary + PDF |
| Offline incident drafts (web) | Partial | localStorage only; no IndexedDB |
| Offline sync endpoint | Complete | Idempotent, per-item results |

## 4. Communications

| Capability | Status | Notes |
| --- | --- | --- |
| Notification queue with consent checks | Complete | |
| Email delivery + queue | Complete | SMTP credentials required |
| WhatsApp (QR and phone pairing) | Complete | Live-verified; session must not be committed |
| Push notifications (mobile/Web Push) | Absent | No push tokens or Expo push service |
| Letter delivery tracking | Complete | Status timeline |

## 5. Cross-platform gaps

| Capability | Status |
| --- | --- |
| Native session metadata (device, platform, app version) | Absent |
| Session/device listing and revocation | Partial (users routes) / no device attribution |
| Access-token session revocation enforcement | Absent |
| Native login/refresh/logout API | Absent |
| Expo mobile application | Absent |
| SecureStore refresh tokens | Absent |
| SQLite offline drafts and sync queue | Absent |
| Biometric unlock | Absent |
| Native Google Sign-In | Absent |
| Push token registration + Expo push delivery | Absent |
| PWA manifest/service worker/install/update | Absent |
| IndexedDB offline storage | Absent |
| Shared TypeScript contracts/validation package | Absent |

## 6. Features that must be preserved

- Existing web routes and UI, auth context, API client and Socket.IO.
- Browser HttpOnly refresh-cookie flow.
- MongoDB schema and all existing collections.
- Ledger append-only semantics and independent review.
- Consent-aware parent communications.
- Firebase Hosting and Render deployment configuration.
- Footer string and colour tokens.

## 7. Verification commands (baseline)

```
npm run build            # backend tsc + frontend vite build
npm test                 # backend Vitest + Supertest
npm run seed:demo        # demo data + counter sync
```

Run these after each phase; record real output in the final handover.
