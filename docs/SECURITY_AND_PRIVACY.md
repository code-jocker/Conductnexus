# Security and privacy

ConductNexus handles minors' disciplinary and safeguarding records, so security and privacy
are treated as product requirements rather than add-ons. This document describes the
controls that exist in the repository and the operational rules that must hold in production.

---

## 1. Threat model

| Asset | Primary threats | Mitigation |
| --- | --- | --- |
| Conduct and safeguarding records | Unauthorized staff access, over-broad roles | Granular RBAC, student scope checks, safeguarding-only permissions |
| Parent portal data | Cross-family data leakage | Guardian-link filtering, consent gate, no direct student enumeration |
| Credentials | Phishing, credential stuffing, token theft | bcrypt hashing, rate limits, short access tokens, rotating refresh tokens, secure-store storage on mobile |
| Integrity of marks | Silent edits, self-approval, duplicate deductions | Immutable ledger, independent review, reconciliation report, idempotency |
| Outbound messages | Contacting non-consenting guardians | Per-channel consent, quiet hours, opt-out, retry limits |
| Secrets and backups | Leakage through Git, logs, disk | `.gitignore` rules, encrypted backups, environment variables, no secret logging |
| WhatsApp session | Account takeover if committed/exfiltrated | Session artifacts ignored by Git, never exported |

---

## 2. Authentication

- Passwords are hashed with **bcrypt (cost 12)**. Plaintext is never stored or logged.
- Access tokens are JWTs with a 15-minute default lifetime (`ACCESS_TOKEN_TTL`).
- Refresh tokens rotate on every use and are stored **hashed** server-side; reuse of an old
  token revokes the whole token family and the session.
- Every sign-in creates a session record with device metadata. A 20-second in-memory cache
  bounds revocation latency without a database round trip on every request.
- Web refresh tokens use the HttpOnly `cn_refresh` cookie (`SameSite=None; Secure` in
  production). Native refresh tokens are returned in the response body and stored in
  **Expo SecureStore** (Keychain / Keystore) — never in AsyncStorage.
- Google Sign-In exchanges a Firebase ID token. Accounts without a role cannot access data
  until an administrator assigns one.
- Email verification, password reset and first-run setup are rate-limited and single-use.

### Session controls

- Users can list their devices (`/auth/sessions`) and revoke any device.
- Administrators can revoke any user's sessions (`DELETE /users/:id/sessions/:sessionId`).
- Changing a password revokes other sessions.
- Push tokens are removed on sign-out so a lost device stops receiving notices.

---

## 3. Authorization

- Permissions are strings (`incidents.review`, `marks.deduct`, `safeguarding.view`, …)
  attached to seeded roles and optionally per user.
- Student visibility is decided by `students.view_all`, an assigned class/dormitory, or a
  guardian link. Every student-scoped route calls this check (not just the list view).
- **Independent review**: the reporter of an incident cannot review it, including through
  bulk review. Letters and high-impact adjustments also name their own approval permission.
- Safeguarding data requires `safeguarding.view`; evidence requires a further permission
  and every access is written to a case access log.
- Parents see only children linked to their guardian record through `/portal/*`.
- The API returns `403` for missing permissions and `404` where revealing existence would
  itself leak information.

### Role guidance

| Role | Intended scope |
| --- | --- |
| `ADMIN` | Full platform administration (all permissions except explicitly restricted ones) |
| `HEADTEACHER` | Leadership oversight, reviews, approvals, safeguarding |
| `DEPUTY_DISCIPLINE` | Day-to-day discipline operations and reviews |
| `DOS` | Academic/conduct coordination |
| `TEACHER` | Record incidents for assigned students, follow-ups, recognition |
| `PATRON` / `MATRON` | Assigned students, safeguarding reports, support plans |
| `SECRETARY` / `BURSAR` / `LIBRARIAN` | Minimal, task-specific access |
| `IT` | Infrastructure, integrations and monitoring (no discipline decisions) |
| `PARENT` | Linked children only |

Review role assignments after staff changes and before every term.

---

## 4. Application security

- **Helmet** sets security headers; `X-Frame-Options: DENY`, `nosniff` and a restrictive
  `Referrer-Policy` are also set by Firebase Hosting.
- **CORS** is an explicit allowlist from `CORS_ORIGIN`. Wildcards are intended only for
  local development.
- **Rate limits**: 400 requests/minute/IP overall, 20 sign-in attempts/15 minutes, and
  6 password-reset requests/15 minutes.
- **Input validation** uses Zod schemas per route; unknown fields are rejected where
  strictness matters. Mongo ObjectIds are validated before queries.
- **Uploads** use Multer with type/size limits. Evidence files are served through
  permission-checked download routes, not by public static paths.
- **Request ids** (`X-Request-Id`) are attached to every request and included in error logs
  so a user-visible error can be traced without exposing internals.
- Error responses never include stack traces or database details in production.
- Idempotency keys prevent duplicate ledger postings and duplicate offline submissions.

### Known hardening to schedule

- Content-Security-Policy is currently disabled in Helmet because the Swagger UI and
  Firebase scripts need allowances. Set a reporting-only CSP first, then enforce it from
  Firebase Hosting once all script sources are enumerated.
- Consider a managed secrets store (Render environment groups) rather than dashboard-only
  variables as the team grows.

---

## 5. Secrets and repository hygiene

Never commit:

- `.env` files or any credential list
- `BACKUP_ENCRYPTION_KEY`, `JWT_ACCESS_SECRET`, SMTP/AT/Expo credentials
- service-account JSON files
- `backend/.wwebjs_cache/` or `backend/.wwebjs_auth/` (WhatsApp linked-device credentials)
- `backend/storage/` evidence or `backend/backups/` archives
- Firebase private keys — only the public client config belongs in `VITE_FIREBASE_*`

`.gitignore` blocks these paths. The public GitHub repository must remain safe to share.
If a secret is ever committed, rotate it immediately; deleting the commit is not enough.

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 6. Data protection (Rwanda Law No. 058/2021)

| Requirement | Implementation |
| --- | --- |
| Lawful basis and transparency | Consent records per guardian and per channel; published policies with versioning and acknowledgements |
| Purpose limitation | Discipline, safeguarding and communication modules only; no third-party analytics on student data |
| Data minimisation | Portal exposes only linked children; safeguarding fields are permission-gated |
| Accuracy | Immutable ledger plus compensating entries and an integrity report |
| Storage limitation | Configurable retention (data-protection tools) and backup retention (`BACKUP_RETENTION_DAYS`) |
| Data subject rights | `/data-protection/requests` and `/portal/data-requests` for access/correction; export endpoints |
| Security safeguards | RBAC, encryption of backups (AES-256-GCM), audit trail, session revocation |
| Breach notification | Breach register under `/data-protection/breaches` with severity and timeline |
| Records of processing | Audit log for sensitive reads/writes and case access logs |

### Retention defaults

- Conduct ledger and incident history: retained for the configured school retention period
  (default multi-year, required for progression and appeals).
- Backup archives: `BACKUP_RETENTION_DAYS` (default 30).
- Audit logs: retained according to the data-protection settings; export before purging.
- Message queue: failed/dead-letter messages are kept for troubleshooting until manually
  purged; message bodies may contain guardian contact details.

Deleting a student record does not delete their ledger history immediately; archive or
anonymise according to the school's retention policy and record the decision in the
data-protection module.

---

## 7. Safeguarding access

- Safeguarding cases are excluded from general incident lists for users without
  `safeguarding.view`.
- Evidence downloads and case views are logged with actor, time and IP.
- Referrals and escalation decisions are audit-logged.
- Do not export safeguarding data to personal devices; use the web console on a managed
  machine.

---

## 8. Client security

### Web (PWA)

- Access token is kept in memory/local storage for the session; the refresh token is
  HttpOnly and not readable by JavaScript.
- The service worker caches only the app shell and static assets — **never API responses
  containing student data**.
- Offline incident drafts are stored in IndexedDB on that browser profile and are removed
  after a successful sync. Shared or public computers should not be used to draft incidents.
- Install the app only from the official hosting origin.

### Native

- Refresh tokens and biometric preference live in SecureStore.
- SQLite drafts live in the app sandbox and are deleted after sync.
- Optional biometric unlock gates reopening the app; it does not replace server-side
  authorization.
- Lost devices: revoke the device from **Settings → Sessions** (web) or **More → Devices**
  (mobile), which invalidates its refresh token immediately.

---

## 9. Backups and recovery

- Backups are encrypted with AES-256-GCM using `BACKUP_ENCRYPTION_KEY`.
- Keep the key outside the repository and outside the same storage account as the backups.
- Test restores with `POST /backups/:id/restore-test` before relying on a backup.
- After restoring, run `GET /discipline/ledger/reconciliation` to confirm ledger integrity.
- Backups contain personal data: restrict download access (`backups.manage`) and delete
  local copies after verification.

---

## 10. Logging and monitoring

- Pino structured logs include request id, route, status and duration. Secrets, tokens and
  password fields are redacted.
- Error logs are available to `system.monitor` users at `/system/errors`.
- Queue failures, dead letters and ledger health are exposed on the Monitoring page.
- Alerts should be configured for: repeated 5xx, dead-letter growth, backup failures,
  ledger reconciliation issues and unusual sign-in volumes.

---

## 11. Incident response checklist

1. Contain: revoke affected sessions, disable the account, rotate exposed secrets.
2. Assess: use the audit log and case access logs to determine what was accessed.
3. Record: open a breach entry with severity, affected data and timeline.
4. Notify: follow the school's legal advice and the regulator's timelines.
5. Recover: restore from a verified backup if integrity was affected; re-run reconciliation.
6. Review: document the root cause and add a regression test or control.

---

## 12. Reporting a vulnerability

Do not open a public GitHub issue for security problems. Contact the maintainer privately
with reproduction steps and impact. Please allow time for a fix before disclosure.

---

See [`API_REFERENCE.md`](API_REFERENCE.md) for authentication endpoints and
[`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for production configuration.
