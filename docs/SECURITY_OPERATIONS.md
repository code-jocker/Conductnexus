# Security operations

Operational guide for the controls already implemented in the codebase. Anything
described as absent is absent — this document does not claim coverage that does
not exist.

## Authentication and sessions

- Access tokens are short-lived JWTs (`ACCESS_TOKEN_TTL`, default 15m); refresh
  tokens are stored hashed and bound to a session.
- Sessions are revocable per device (`GET/DELETE /api/v1/auth/sessions`,
  `POST /api/v1/auth/logout-others`). Push tokens live on the session, so
  revoking a session also stops its push delivery.
- Optional TOTP-free email two-factor: `POST /api/v1/auth/2fa/enable` then
  `/api/v1/auth/2fa/verify`. Challenges expire and lock after repeated failures.
- Biometric unlock is available in the mobile app (`src/auth/storage`).

## Authorization model

Three layers, all enforced server-side:

1. **Route guards** — `requirePermission(...)` on every protected route.
2. **Record guards** — approval routes authorize against each approval's own
   `requiredPermission` (or its requester) via `loadApproval`.
3. **Query scoping** — `visibleStudentQuery` in `services/rbac.service.ts`
   constrains every student read to the caller's assignment.

The authoritative role → permission map is `backend/src/shared/roles.ts`. The
authorization matrix test (`test/authz.test.ts`) derives every expected cell from
that map, so a drifted route or role fails CI.

Separation of duties is enforced, not advisory: a bulk deduction requires both
`marks.deduct` and `marks.adjust.approve`; a bulk reward requires `marks.reward`;
school-wide bulk scope is limited to `HEADTEACHER` and `ADMIN`.

## Ledger integrity

Conduct balances change only through approved incidents and audited adjustments.
Every change writes a `DisciplineLedger` entry and an `AuditLog` entry with actor,
roles, before/after and request id. Bulk operations record their scope, preview
and applied counts.

## Audit trail

`AuditLog` records sign-in, permission change, approval decision, bulk operation,
letter issue, backup and template change. Read it with `GET /api/v1/audit-logs`
(requires `audit.view`). `AuditLog` and `ErrorLog` are excluded from backups
because they are operational, not academic, data.

## Rate limiting

| Limiter | Window | Limit |
|---|---|---|
| Global | 60s | 400 requests |
| Sign-in | 15 min | 20 attempts |
| Forgot password | 15 min | 6 requests |
| Two-factor | 15 min | 10 attempts |

## Error monitoring

`services/monitoring.service.ts` defines an `ErrorReporter` interface with a
structured-log default. `captureError` is called from the Express error handler
for every 5xx and from `unhandledRejection` / `uncaughtException`.

To attach a provider, register it before the server starts:

```ts
import { setReporter } from './services/monitoring.service.js'
setReporter({ name: 'my-provider', capture: ({ error, context }) => mySdk.captureException(error, context) })
```

Naming an unknown provider in `ERROR_REPORTING_PROVIDER` aborts startup — a typo
must not look like "monitoring is enabled".

## Notification privacy

- Safeguarding notifications are never previewed on a lock screen: the push title
  and body are replaced with a generic message.
- Users control delivery per channel and per category
  (`PUT /api/v1/notifications/preferences`). Muting a channel never removes the
  in-app record.
- Parent WhatsApp messages are consent-aware and use the school's language
  setting; a message whose template has unresolved placeholders is refused rather
  than sent with markers in the text.

## Known gaps

| Gap | Status |
|---|---|
| No field-level encryption for data at rest beyond MongoDB's own | Open |
| No SIEM integration; audit logs are read through the API | Open |
| No automated dependency-update policy (Dependabot/Renovate) | Open |
| No penetration test on record | Open |
| Session fixation and token-reuse detection are session-revocation only | Open |

Report a suspected vulnerability privately to the school's system owner before
opening a public issue.