# Notification configuration

## Channels

| Channel | Implementation | Configuration |
|---|---|---|
| In-app | `Notification` collection + Socket.IO `notification:new` | Always on. |
| Push | `services/push.service.ts` → Expo push | `EXPO_ACCESS_TOKEN` for production. |
| Email | Nodemailer | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. |
| WhatsApp | `whatsapp-web.js` | `ENABLE_WHATSAPP=true`; session under `WHATSAPP_SESSION`. |
| SMS | Africa's Talking | `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID`, `AT_SMS_URL`. |

Email, WhatsApp and SMS are sent through the durable `MessageQueue` collection by
a worker that runs every 60 seconds, so a provider outage does not lose a
notification.

## Templates

Templates are stored per language: a row keyed `X` (English) and `X_rw`
(Kinyarwanda). `services/communication.service.ts` selects `_rw` when
`settings.academic.language === 'rw'`, falling back to `X`.

- **Notification templates** — 21 types, bilingual (`NOTIFICATION_TEMPLATE_LIBRARY`).
- **Letter templates** — 9 types, bilingual (`LETTER_TEMPLATE_LIBRARY`).

Placeholders are validated before send. Because `renderTemplate` substitutes
markers during rendering, validation compares the template's *declared*
placeholders against the variables supplied — not the rendered text. A send with
an unresolved placeholder is refused instead of delivering `{{name}}` to a parent.

Edit templates in the web console under Communications. Every save writes an
audit entry describing which fields changed, and each version is retained.

## Priority

`priorityOf(type)` in `services/notification.service.ts` derives a level from the
notification type so no producer has to remember to set it:

| Type prefix | Priority |
|---|---|
| `safeguarding` | critical |
| `incident`, `risk` | high |
| `approval`, `appeal` | high |
| `communication`, `system` | low |
| everything else | normal |

The inbox is ranked critical → high → normal → low, then newest first. Ranking is
done with an explicit aggregation stage because sorting the label alphabetically
would put `normal` above `critical`.

## Grouping

`GET /api/v1/notifications` returns `meta.groups`: one bucket per category
(the leading segment of `type`), each with `count` and `unread`. A client can
render one section per kind of event without parsing types itself.

## User preferences

`PUT /api/v1/notifications/preferences` accepts
`{ updates: [{ channel, category, enabled }] }`.

- Channels: `push`, `email`, `sms`, `whatsapp`.
- Categories: `incident`, `approval`, `safeguarding`, `letter`, `meeting`,
  `risk`, `appeal`, `communication`, `system`.
- A missing row means **enabled** — preferences are opt-out.
- Muting a channel only suppresses that channel. The in-app record is always
  written, so a muted push can never hide an accountable event.
- `DELETE /api/v1/notifications/preferences` resets to defaults.

Currently `notifyUsers` enforces the `push` channel. Email, SMS and WhatsApp are
parent-facing and go through `queueParentMessage`, which is consent-aware; the
preference rows for those channels are stored and returned but not yet consulted
by the queue path.

## Privacy rules

- Safeguarding pushes never show the title or body on a lock screen; they read
  "You have a new confidential update. Sign in to view it."
- Any payload with `data.sensitive === true` gets the same treatment.
- Parent WhatsApp messages use the school's configured language.

## Troubleshooting

| Symptom | Check |
|---|---|
| Nothing in the queue | `SMTP_*` / `ENABLE_WHATSAPP` / `AT_*` are set; worker interval is 60s. |
| Queue growing | `GET /api/v1/admin/system` → `queue.counts` and `deadLetters`. |
| Messages stuck in `failed` | `POST /api/v1/notifications/queue/:id/retry`, or `npm run purge:queue` for non-WhatsApp dead letters. |
| Push not delivered | `EXPO_ACCESS_TOKEN` set; token is a valid `ExpoPushToken[...]`; the recipient has not muted push for that category. |
| `DeviceNotRegistered` | The token is cleared automatically; the device must sign in again. |