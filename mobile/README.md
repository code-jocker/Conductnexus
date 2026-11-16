# ConductNexus Mobile

Native Android and iOS client for the ConductNexus discipline platform, built with Expo SDK 58 and Expo Router. It uses the same backend and MongoDB database as the web console, so one set of offence rules, conduct ledger entries and approvals applies everywhere.

## What it covers

- Password and Google sign-in against `/auth/native/*` endpoints (access token in memory, refresh token in the device keychain/keystore).
- Optional biometric unlock, session and device management, remote sign-out.
- Staff dashboard, incident list and detail, independent review actions, approval queue.
- Incident reporting with offline drafts in SQLite and idempotent sync (`clientSubmissionId`).
- Student profile, conduct balance, ledger, incidents, risk, interventions and guardians.
- Guardian portal: children, conduct and ledger, incidents, letters, meetings, recognition, communication consent and data protection requests.
- Push notifications through Expo, with consent-aware and safeguarding-safe previews enforced by the server.

## Requirements

- Node.js 20+ (tested on 24), npm.
- An Expo account for EAS builds, and a physical device (push and biometrics do not work in simulators).
- The backend running and reachable from the device (same Wi-Fi for a local machine, or the Render URL).

## Setup

```bash
cd mobile
npm install
cp .env.example .env
```

Edit `.env`:

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Backend base URL including `/api/v1`, e.g. `https://your-service.onrender.com/api/v1`. Use your computer's LAN IP instead of `localhost` for a physical Android device. |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | EAS project id, required for push tokens. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google OAuth web client id (the Firebase/Google console web client). |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google OAuth iOS client id. |
| `EXPO_PUBLIC_FIREBASE_*` | Firebase web app config used to exchange Google credentials for an ID token. |

```bash
npm start          # Expo dev server (Expo Go for UI-only work)
npm run typecheck
npm run android    # development build on a connected Android device
npm run ios        # development build on a connected iOS device (macOS)
```

## Push notifications

1. Create the EAS project: `eas init` (or set `extra.eas.projectId` in `app.json`).
2. Set the same id in `EXPO_PUBLIC_EAS_PROJECT_ID`.
3. Optionally set `EXPO_ACCESS_TOKEN` in the backend environment to use Expo's authenticated push channel.
4. Build a development build (`npm run eas:build:android` / `ios`). Expo Go cannot receive remote push notifications.
5. The token is registered automatically after sign-in; revoking the session removes it server-side.

## Google sign-in

The mobile app obtains a Google ID token with `expo-auth-session` and exchanges it with Firebase (`signInWithCredential`), then sends the Firebase ID token to `/auth/native/google`. Configure the bundle id `com.conductnexus.app` and the Android package in the Google console, and enable Google in Firebase Authentication.

## Offline behaviour

Drafts are stored in SQLite (`conductnexus.db`, table `incident_drafts`) on native devices. On web, `expo-sqlite` sync APIs are not available without cross-origin isolation, so the app stores drafts in browser local storage instead to avoid runtime crashes. Sync occurs when you submit, pull-to-refresh the drafts screen, or tap Sync. The backend deduplicates by `clientSubmissionId`, so a retry never creates a second incident. Safeguarding flags travel with the draft.

## Build and release

```bash
eas build --platform android --profile preview
eas build --platform ios --profile preview
eas submit --platform android --profile preview
```

Update `app.json` (`version`, `android.versionCode`, `ios.buildNumber`) for each release. App identity: `com.conductnexus.app`. Icons and splash assets live in `assets/` and use the same navy/indigo and orange palette as the web console.

## Structure

```
app/
  (auth)/        login, forgotten password
  (staff)/       home, incidents, students, tasks, more
  (parent)/      children, meetings, notices, account
  incident/      detail and new report
  student/       staff student profile
  child/         guardian child profile
  sessions.tsx   device and session management
  drafts.tsx     offline draft queue
  privacy.tsx    privacy summary
src/
  api/           axios client, endpoints, types
  auth/          provider, storage, biometrics, Google/Firebase
  notifications/ push registration and route mapping
  offline/       SQLite draft store and sync
  components/    shared UI
  theme/         light/dark palette
```

## Notes and limits

- The mobile client deliberately does not include administration screens (users, settings, bulk imports, backups, report exports). Use the web console for those.
- Evidence upload and letter PDFs are web-only in this release; incident evidence attachments are displayed but not uploaded from mobile.
- Push previews for safeguarding cases are generic by design; details require signing in.
- Never commit `.env`, Firebase service accounts, keystore files or `google-services.json` to the public repository.

## Footer

Powered by Shyaka clever prince a.k.a Code jocker
