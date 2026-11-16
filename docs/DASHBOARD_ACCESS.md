# Dashboard access matrix

The web dashboard is role-specific. `frontend/src/lib/roleDashboards.ts` selects
the leading metrics, quick actions and visible widgets for the caller's primary
role; the mobile home mirrors it in `mobile/src/roleDashboards.ts`. Both consume
the same permission-scoped `GET /api/v1/analytics/dashboard` payload, so a role
never sees a figure it is not authorized to read.

The backend picks the primary role using `PRIMARY_ORDER`
(`ADMIN`, `HEADTEACHER`, `DEPUTY_DISCIPLINE`, `DOS`, `TEACHER`, `PATRON`,
`MATRON`, `SECRETARY`, `IT`, `LIBRARIAN`, `BURSAR`, `PARENT`), and returns
`role`, `roleLabel` and a permission-gated `extra` block. A user holding several
roles sees one workspace at a time.

## Role → workspace

| Role | Leads with | Widgets | Quick actions |
|---|---|---|---|
| ADMIN | Active users, roles, students, open incidents | Users, trend, recent incidents, audit, queue, WhatsApp, notifications | Users, structure, audit, settings |
| HEADTEACHER | Students, pending approvals, high/critical risk, investigations | Approvals, risk, trend, safeguarding, investigations, appeals, incidents, high-risk, class averages, letters | Approvals, risk, safeguarding, reports |
| DEPUTY_DISCIPLINE | Awaiting review, pending approvals, risk, open interventions | Approvals, trend, incidents, high-risk, risk, follow-ups, letters, queue | Record incident, approvals, bulk discipline, reports |
| TEACHER | Students visible, incidents reported, awaiting review, follow-ups | Recent incidents, follow-ups, high-risk, recognition | Record incident, my students, drafts |
| IT | Active users, queued messages, failed messages, unread | Queue, WhatsApp, audit, users, notifications | Monitoring, audit, WhatsApp, settings |
| PATRON | Students, risk, open interventions, follow-ups | High-risk, follow-ups, incidents, recognition, meetings | Risk, record observation, meetings |
| MATRON | Students, risk, follow-ups, interventions | High-risk, follow-ups, incidents, meetings | Welfare concerns, record concern, meetings |
| BURSAR | Students, incidents, parents, letters | Letters, notifications | Students, communication, letters |
| DOS | Students, open incidents, risk, interventions | Trend, class averages, incidents, high-risk, risk, follow-ups | Reports, promotions, risk |
| LIBRARIAN | Students, incidents reported, open incidents, recognition | Recent incidents | Record incident, find student |
| SECRETARY | Meetings, letters, parents, unread | Meetings, letters, parents, notifications | Meetings, letters, calendar |
| PARENT | Children, unread, meetings, letters | Letters, meetings, notifications | Open parent portal, meetings |

## Data each role can reach

These are the effective limits, enforced by query scoping — not by hiding UI.

| Capability | ADMIN | HEAD | DEPUTY | DOS | TEACHER | PATRON | MATRON | BURSAR | IT | LIBRARIAN | SECRETARY | PARENT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| All students | Yes | Yes | Yes | Yes | Assigned | Assigned | Assigned | Authorized fields | No | Assigned | No | Own children |
| Record incident | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | No | Yes | No | No |
| Review incident | Yes | Yes | Yes | Yes | No | No | No | No | No | No | No | No |
| Approve adjustment | Yes | Yes | Yes | No | No | No | No | No | No | No | No | No |
| Bulk discipline | Yes | Yes | Yes | No | No | No | No | No | No | No | No | No |
| Reports | Yes | Yes | Yes | Yes | No | No | No | No | No | No | Yes | No |
| Users and roles | Yes | No | Yes | No | No | No | No | No | No | No | No | No |
| Audit logs | Yes | Yes | No | No | No | No | No | No | Yes | No | No | No |
| Safeguarding cases | No | Yes | Yes | No | Report only | Yes | Create only | No | No | No | No | No |

`ADMIN` deliberately excludes `safeguarding.*` — the authorization matrix test
asserts this, so an accidental grant fails CI.

## Notification and approval surfaces

- **Approvals**: only roles holding at least one of `marks.adjust.approve`,
  `incidents.review`, `letters.approve`, `safeguarding.escalate`,
  `students.promote.approve` or `investigations.decide` can list or count them.
  Each record is then filtered by its own `requiredPermission`.
- **Reports**: `reports.view` (HEADTEACHER, DEPUTY, DOS, SECRETARY, ADMIN).
  Mobile shows a locked state rather than an empty page when the role lacks it.
- **Templates and letters**: `templates.manage` and `letters.view` /
  `letters.approve`.

## Verifying access

```bash
npm --prefix backend test        # includes test/authz.test.ts
```

The matrix test creates one user per role and asserts, for eight protected
endpoints and all twelve roles, that an unpermitted role receives 403 and a
permitted role reaches the handler.