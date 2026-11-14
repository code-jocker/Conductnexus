# ConductNexus API reference

The REST API serves the web app and the native Android/iOS app. An interactive OpenAPI
document is always available from the running server:

- Swagger UI: `GET /api/docs`
- OpenAPI 3 JSON: `GET /api/docs.json`

This file documents conventions and the endpoints clients depend on most. When the two
disagree, the OpenAPI document is authoritative.

---

## Base URL and versioning

| Environment | Base URL |
| --- | --- |
| Local | `http://localhost:4000/api/v1` |
| Render | `https://<service>.onrender.com/api/v1` |

All endpoints are versioned through the path (`/api/v1`) and return JSON. Requests with a
body must send `Content-Type: application/json` unless they are multipart uploads.

## Response envelope

```json
{ "success": true, "data": { }, "meta": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 } }
```

```json
{ "success": false, "error": { "message": "Human readable reason", "details": { } } }
```

| Status | Meaning |
| --- | --- |
| 200 / 201 | Success |
| 400 | Invalid state (e.g. reviewing a closed incident) |
| 401 | Missing/expired credentials, revoked session |
| 403 | Authenticated but the role lacks the permission |
| 404 | Resource not found or not visible to this user |
| 409 | Conflict (duplicate key, stale balance version) |
| 422 | Request validation failed; `error.details` lists fields |
| 429 | Rate limit exceeded |
| 500 | Unexpected server error; reference the request id in logs |

Paginated list endpoints accept `page` (default 1) and `pageSize` (default 20, max 100) and
return `items` plus `meta`. Search filters use `q`; date filters use `from` / `to` (ISO or
`YYYY-MM-DD`).

## Authentication

Access tokens are short-lived JWTs (`ACCESS_TOKEN_TTL`, default 15 minutes). Refresh tokens
rotate on every use.

### Web

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | Sets the refresh token in an HttpOnly `cn_refresh` cookie |
| POST | `/auth/google` | Firebase ID token exchange |
| POST | `/auth/refresh` | Reads the cookie, sets a new one |
| POST | `/auth/logout` | Revokes the current session |
| POST | `/auth/logout-all` | Revokes every session for the user |

### Native (Android / iOS)

Native clients cannot rely on cookies, so these endpoints return the refresh token in the
response body. The app stores it in the platform secure store.

| Method | Path | Body |
| --- | --- | --- |
| POST | `/auth/native/login` | `{ email, password, device: { deviceId, deviceName, platform, appVersion } }` |
| POST | `/auth/native/google` | `{ idToken, device }` |
| POST | `/auth/native/refresh` | `{ refreshToken, device }` — returns a rotated pair |
| POST | `/auth/native/logout` | `{ refreshToken }` |

Every native login creates a session document with device metadata. Sessions are cached for
20 seconds on the API and revoking one takes effect within that window.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/auth/sessions` | List the caller's active devices (`current` flag included) |
| DELETE | `/auth/sessions/:id` | Revoke one of your sessions |
| POST | `/auth/logout-others` | Revoke every session except the current one |
| GET | `/users/:id/sessions` | Administrator view of a user's devices |
| DELETE | `/users/:id/sessions/:sessionId` | Administrator revocation |
| POST | `/auth/push-token` | Register an Expo push token for the current device |
| DELETE | `/auth/push-token` | Remove the device token on sign-out |
| GET | `/auth/me` | Current user, roles, permissions and setup state |
| POST | `/auth/change-password` | Requires the current password |
| POST | `/auth/forgot-password` | Sends a reset code/link |
| POST | `/auth/reset-password` | Consumes the code/link |
| POST | `/auth/verify-email` | Consumes the verification code |
| POST | `/auth/resend-verification` | Re-sends the verification code |
| GET | `/auth/setup-status` | Whether first-run setup is complete |
| POST | `/auth/setup` | One-time initial school and admin creation |

Send the access token as `Authorization: Bearer <token>` on every other request.

## Authorization

Permissions are granular strings such as `incidents.review`, `marks.deduct`,
`safeguarding.view` or `reports.view`. Roles are seeded (`ADMIN`, `HEADTEACHER`,
`DEPUTY_DISCIPLINE`, `DOS`, `TEACHER`, `PATRON`, `MATRON`, `SECRETARY`, `IT`, `LIBRARIAN`,
`BURSAR`, `PARENT`) and can be adjusted per user via `/users/:id/permissions`.

The API enforces two domain rules regardless of role:

1. **Independent review** — a user cannot review, approve or reject an incident they
   reported. Bulk review enforces this per incident.
2. **Student visibility** — access requires `students.view_all`, a matching assigned
   class/dormitory, or a guardian link (`portal.view_children`).

## Idempotency and offline sync

Mutating endpoints accept an `Idempotency-Key` header; the first response is replayed for
repeat requests with the same key. Incident creation additionally accepts
`clientSubmissionId` in the body so an offline draft can be retried safely.

### Offline sync contract

```http
POST /sync/incidents
Authorization: Bearer <token>
Content-Type: application/json

{
  "drafts": [
    {
      "clientSubmissionId": "local-1770000000000-ab12",
      "studentId": "665f…",
      "offenceId": "665f…",
      "description": "Used a phone during evening prep.",
      "location": "Study hall",
      "occurredAt": "2026-11-14T18:40:00.000Z",
      "safeguardingFlag": false,
      "witnesses": [{ "name": "A. Uwase", "statement": "Optional" }]
    }
  ]
}
```

The response reports a per-draft verdict (`synced`, `duplicate`, `rejected`, `error`) with
the server incident id or number. Clients keep the local draft until a non-retryable verdict
is returned. `GET /sync/time` returns server time so devices can detect clock drift.

## Endpoint groups

| Group | Representative paths | Key permissions |
| --- | --- | --- |
| Setup & health | `/setup-status`, `/health`, `/system/health` | public / `system.monitor` |
| Users & roles | `/users`, `/users/:id/roles`, `/permissions-catalog` | `users.view`, `users.manage` |
| Structure | `/academic-years`, `/terms`, `/classes`, `/streams`, `/dormitories`, `/structure/options` | `classes.view`, `academic_years.manage`, `terms.manage` |
| Students | `/students`, `/students/:id/profile`, `/students/:id/ledger`, `/students/:id/history`, `/students/import`, `/students/export` | `students.view*`, `students.update`, `students.import` |
| Promotions | `/promotions`, `/promotions/:id/approve`, `/promotions/:id/execute` | `students.promote*` |
| Discipline | `/offences`, `/incidents`, `/discipline/ledger`, `/discipline/deduct`, `/discipline/reward`, `/discipline/adjustments`, `/discipline/transactions/:id/reverse` | `offences.*`, `incidents.*`, `marks.*` |
| Risk & support | `/analytics/dashboard`, `/watchlist`, `/interventions`, `/followups`, `/recognition` | `risk.view`, `interventions.*`, `followups.*` |
| Safeguarding | `/safeguarding/cases`, `/safeguarding/cases/:id/evidence`, `/safeguarding/cases/:id/access-log` | `safeguarding.*` (restricted) |
| Investigations | `/investigations`, `/investigations/:id/findings`, `/investigations/:id/decision` | `investigations.*` |
| Appeals | `/appeals`, `/appeals/:id/decide` | `appeals.view`, `appeals.decide` |
| Parents & portal | `/parents`, `/parents/:id/consent`, `/portal/children`, `/portal/consent`, `/portal/data-requests` | `parents.*`, `portal.view_children` |
| Communications | `/notifications`, `/notifications/queue`, `/notifications/queue/process`, `/letters`, `/letters/:id/pdf`, `/letter-templates`, `/whatsapp/*`, `/communications/send` | `notifications.*`, `letters.*`, `whatsapp.manage` |
| Approvals | `/approvals`, `/approvals/:id/approve`, `/approvals/:id/reject`, `/approvals/pending/count` | each approval names its own `requiredPermission` (e.g. `marks.adjust.approve`, `incidents.review`, `letters.approve`) |
| Reports | `/reports/:kind`, `/reports/:kind/export` | `reports.view`, `reports.export` |
| Governance | `/policies`, `/meetings`, `/calendar`, `/evidence` | `policies.*`, `meetings.*`, `evidence.*` |
| Admin | `/settings`, `/backups`, `/backups/:id/restore-test`, `/audit-logs`, `/system/errors`, `/system/queue-failures`, `/system/ledger-health`, `/data-protection/*` | `settings.manage`, `backups.manage`, `audit.view` |
| Clients | `/auth/native/*`, `/auth/sessions`, `/auth/push-token`, `/sync/*`, `/portal/*` | as above |

Report kinds: `term`, `year-end`, `high-risk`, `class`, `teacher-activity`, `communication`.

## Incident workflow

```
draft → submitted → under_review → approved | rejected
                              ↘ escalated → approved | rejected
approved/rejected → closed (post-decision)
```

| Method | Path | Permission | Behaviour |
| --- | --- | --- | --- |
| POST | `/incidents` | `incidents.create` | Creates a draft; no marks move |
| PATCH | `/incidents/:id` | `incidents.update` | Edits a draft (reporter or permitted staff) |
| POST | `/incidents/:id/submit` | `incidents.submit` | Enters independent review |
| POST | `/incidents/:id/review` | `incidents.review` | `{ decision: approve\|reject\|request_info, comments }`; approval posts the ledger entry |
| POST | `/incidents/bulk-review` | `incidents.review` | `{ ids: [1–50], decision, comments? }`; returns per-id verdicts, `reviewed` and `failed` counts |
| POST | `/incidents/:id/close` | `incidents.close` | Closes after the decision with a note |

Parent notification status (`pending`, `sent`, `failed`, `not_required`) is tracked per
incident and respects guardian consent, opt-outs and quiet hours.

## Conduct ledger

Each student starts a term with the configured allocation (default 40). Approved movements
write immutable rows containing `previousBalance`, `change`, `newBalance` and
`balanceVersion`. Nothing is edited in place; corrections are compensating entries that
need their own approval.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/students/:id/ledger` | `marks.view` | Term ledger and summary |
| GET | `/discipline/ledger` | `marks.view` | Ledger for one student and term |
| POST | `/discipline/deduct` | `marks.deduct` | Direct deduction where policy allows; idempotent |
| POST | `/discipline/reward` | `marks.reward` | Adds marks with a reason |
| POST | `/discipline/adjustments` | `marks.adjust.request` | Requests a change; high-impact values require headteacher approval |
| POST | `/discipline/adjustments/:id/decide` | `marks.adjust.approve` | Approves or rejects the request |
| POST | `/discipline/transactions/:id/reverse` | `marks.reverse` | Posts a compensating entry |
| GET | `/discipline/ledger/reconciliation` | `reports.view` | Term integrity check |

### Reconciliation response

```json
{
  "term": { "id": "…", "name": "Term 2", "number": 2 },
  "studentsChecked": 412,
  "studentsMatched": 412,
  "transactionsChecked": 1290,
  "issues": [
    {
      "studentId": "…",
      "studentName": "Test Learner",
      "studentRef": "STD-0001",
      "ledgerId": "…",
      "kind": "balance_drift",
      "detail": "Ledger ends at 36 but the student record holds 38."
    }
  ],
  "healthy": false,
  "generatedAt": "2026-11-14T12:00:00.000Z"
}
```

Issue kinds: `broken_chain`, `math_mismatch`, `balance_drift`, `negative_balance`,
`duplicate_deduction`. The report never repairs data; it identifies the exact ledger row
that needs audit follow-up.

## Parent portal

Portal endpoints only expose children linked to the authenticated guardian and honour
per-channel consent.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/portal/children` | Linked children with conduct summary |
| GET | `/portal/children/:id` | Conduct transactions, incidents, letters, meetings, recognition, risk history |
| GET/PATCH | `/portal/consent` | Read or update `whatsapp`, `sms`, `email`, `inApp` consent |
| POST | `/portal/data-requests` | Data-protection access/correction request |

## Rate limits

| Scope | Default |
| --- | --- |
| General API | 400 requests / minute / IP |
| Authentication endpoints | 20 requests / 15 minutes / IP |
| Password reset | 6 requests / 15 minutes / IP |

Limits are defined in `backend/src/middleware/error.ts` and return `429` with standard
`RateLimit-*` headers.

## Websocket

Socket.IO is served on the same origin as the API. Clients authenticate with the access
token and join a user room to receive notification events
(`notification:new`, `incident:updated`, queue status). Websocket delivery is optional —
clients must still work from polling.

## Client helpers

- Web: `frontend/src/lib/api.ts` injects the bearer token and performs a single-flight
  refresh on `401`.
- Mobile: `mobile/src/api/client.ts` mirrors that behaviour and persists the rotated refresh
  token in SecureStore.

---

See [`SECURITY_AND_PRIVACY.md`](SECURITY_AND_PRIVACY.md) for token handling and data
protection controls, and [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for environment
configuration.
