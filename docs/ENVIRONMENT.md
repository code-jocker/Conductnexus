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
| `SMTP_PASS` | `''` | no | |
| `MAIL_FROM` | `ConductNexus <no-reply@conductnexus.rw>` | no | Envelope sender. |

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