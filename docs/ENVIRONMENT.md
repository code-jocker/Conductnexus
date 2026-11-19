# Environment variables

Every variable read by the backend, in the order they appear in
`backend/src/config/env.ts`. Anything marked **required** prevents the process
from starting when it is missing or malformed.

## Core

| Variable | Default | Required | Notes |
|---|---|---|---|
| `NODE_ENV` | `development` | no | `development`, `test` or `production`. Drives the backup-key policy and error verbosity. |
| `PORT` | `4000` | no | HTTP port for the API and the Socket.IO server. |
| `APP_URL` | `http://localhost:5173` | no | Absolute base URL used in generated links (letters, reset emails). |
| `CORS_ORIGIN` | `http://localhost:5173` | no | Comma-separated list of allowed browser origins. |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/conductnexus` | no | Connection string. Tests use `TEST_MONGODB_URI`, falling back to `...conductnexus_test`. |

## Authentication

| Variable | Default | Required | Notes |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | — | **yes** | Minimum 16 characters. Signs access tokens. |
| `ACCESS_TOKEN_TTL` | `15m` | no | Access-token lifetime. |
| `REFRESH_TOKEN_TTL_DAYS` | `14` | no | Refresh-token lifetime in days. |
| `FIREBASE_PROJECT_ID` | `''` | no | Enables Google sign-in and the demo auth pages. |

## Mail

| Variable | Default | Required | Notes |
|---|---|---|---|
| `SMTP_HOST` | `''` | no | Empty disables outbound email. |
| `SMTP_PORT` | `587` | no | |
| `SMTP_SECURE` | — | no | `true` for implicit TLS (usually port 465). |
| `SMTP_USER` | `''` | no | |
| `SMTP_PASS` | `''` | no | For Gmail, use a 16-character App Password, not the account password. |
| `MAIL_FROM` | derived | no | Envelope sender, `Name <email>` form. When empty it becomes `ConductNexus <MAILJET_SENDER>`, then `ConductNexus <GMAIL_USER>`, then the no-reply address. Gmail requires it to match the authenticated account. |
| `MAILJET_API_KEY` | `''` | no | Mailjet API key. With `MAILJET_API_SECRET` this enables the Mailjet Send API v3.1, which takes precedence over Gmail OAuth2 and SMTP. |
| `MAILJET_API_SECRET` | `''` | no | Mailjet secret key (the password half of the Basic auth pair). |
| `MAILJET_SENDER` | `''` | no | Sending address; must be validated under Mailjet → Senders & Domains, otherwise Mailjet rejects the message. |
| `GMAIL_USER` | `''` | no | Gmail account address. Setting all four `GMAIL_*` values enables OAuth2 delivery, which takes precedence over `SMTP_*`. |
| `GMAIL_CLIENT_ID` | `''` | no | Google Cloud OAuth client ID. |
| `GMAIL_CLIENT_SECRET` | `''` | no | Google Cloud OAuth client secret. |
| `GMAIL_REFRESH_TOKEN` | `''` | no | Refresh token authorised for `https://mail.google.com/`. |
| `TWO_FACTOR_RESEND_SECONDS` | `60` | no | Minimum gap between new sign-in codes (30–300). |

### Mailjet (send API)

1. In Mailjet → Senders & Domains, add and verify the sending address (or
   authenticate its domain). An unverified sender is rejected.
2. Set `MAILJET_API_KEY` and `MAILJET_API_SECRET` (Account → API key
   management) and `MAILJET_SENDER=<verified address>`.
3. Verify with `npm run mail:test -- you@example.com`.

Mailjet is preferred over Gmail OAuth2 and SMTP whenever both keys are set.
Rejections are recorded on the `MailMessage` row and logged as
`Mailjet rejected the message: ...`.

### Gmail delivery for verification and two-factor codes

A Google API key cannot send Gmail; the Gmail API needs delegated user
credentials. Use either:1. **App password (quickest):** turn on 2-Step Verification for the account,
   create an App Password, then set `SMTP_HOST=smtp.gmail.com`,
   `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=<address>` and
   `SMTP_PASS=<16-character app password>`.
2. **OAuth2 (preferred):** create an OAuth client in Google Cloud Console,
   authorise it once with the `https://mail.google.com/` scope, and set
   `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` and
   `GMAIL_REFRESH_TOKEN`.

Two-factor codes are sent from whichever address is configured above. Users
can collect the code by email or, when their profile has a phone number and
WhatsApp is linked, by WhatsApp. Do not enable *Require two-factor
authentication* in Settings → Security until one of these channels is working.

## Backups

| Variable | Default | Required | Notes |
|---|---|---|---|
| `BACKUP_ENCRYPTION_KEY` | `''` | **yes in production** | At least 32 characters. A 64-character hex value is used directly; any other strong value is stretched with SHA-256. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `BACKUP_SCHEDULE` | `0 2 * * *` | no | Cron expression for the nightly backup. |
| `BACKUP_RETENTION_DAYS` | `30` | no | How long backup files are kept. |

## WhatsApp (Africa's Talking and WhatsApp Web)

| Variable | Default | Required | Notes |
|---|---|---|---|
| `ENABLE_WHATSAPP` | — | no | `true` starts the WhatsApp worker. |
| `WHATSAPP_SESSION` | `conductnexus` | no | Session directory name. |
| `WHATSAPP_EXECUTABLE_PATH` | `''` | no | Custom Chromium path for the WhatsApp client. |
| `WHATSAPP_RESOLVER_IP` | `''` | no | Custom DNS resolver when the host blocks WhatsApp. |
| `WHATSAPP_PAIR_PHONE` | `''` | no | Phone number used for pairing. |

## SMS (Africa's Talking)

| Variable | Default | Required | Notes |
|---|---|---|---|
| `AT_USERNAME` | `''` | no | Set together with `AT_API_KEY` to enable SMS. |
| `AT_API_KEY` | `''` | no | |
| `AT_SENDER_ID` | `''` | no | Alphanumeric sender ID. |
| `AT_SMS_URL` | `''` | no | Override for the messaging endpoint. |

## Push, uploads and seeding

| Variable | Default | Required | Notes |
|---|---|---|---|
| `EXPO_ACCESS_TOKEN` | `''` | no | Required for production push to Expo. |
| `UPLOAD_DIR` | `storage/evidence` | no | Where evidence uploads are stored. |
| `ERROR_REPORTING_PROVIDER` | `log` | no | Only `log` ships. Any other value aborts startup rather than reporting nowhere; register a custom `ErrorReporter` with `setReporter()` first. |

## First-run seeding

| Variable | Default | Required | Notes |
|---|---|---|---|
| `ADMIN_EMAIL` | `''` | no | Creates the first administrator when `npm run seed` runs. |
| `ADMIN_PASSWORD` | `''` | no | Must satisfy the password policy. |
| `ADMIN_NAME` | `System Administrator` | no | |
| `SCHOOL_NAME` | `''` | no | Seeds the school profile. |

## Mobile

The Expo app reads `EXPO_PUBLIC_API_URL` (client-side only, not the backend). It
defaults to `http://localhost:4000/api/v1`; set it to the deployed API base URL
before building a release.