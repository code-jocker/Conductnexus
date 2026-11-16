# Mobile build and release

The mobile client is an Expo SDK 57 / React Native 0.86 app under `mobile/`.
It talks to the same API as the web console and shares its permission model.

## Prerequisites

```bash
npm ci --prefix mobile
npm --prefix mobile run typecheck
```

There is no test runner configured for `mobile/` — `package.json` exposes
`typecheck`, `lint` and `start` only. Mobile changes are verified by typecheck
and by manual QA, so treat any mobile row in
[FEATURE_COMPLETION_MATRIX.md](FEATURE_COMPLETION_MATRIX.md) as typechecked, not
test-covered.

## Configuration

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | API base URL. Defaults to `http://localhost:4000/api/v1`. Must be the deployed HTTPS origin for a release build. |

Set it in `mobile/.env` (never commit real secrets; Expo `EXPO_PUBLIC_*` values
are embedded in the client bundle).

## Local development

```bash
npm --prefix mobile start          # Expo dev server
npm --prefix mobile run android    # Android emulator or device
npm --prefix mobile run ios        # iOS simulator (macOS only)
```

For a physical device, point `EXPO_PUBLIC_API_URL` at your machine's LAN IP, not
`localhost`, and allow that origin in the backend's `CORS_ORIGIN`.

## Pre-release checklist

1. `npm --prefix mobile run typecheck` is clean.
2. `EXPO_PUBLIC_API_URL` points at the production API.
3. Sign in as each of the twelve roles and confirm the home screen renders the
   right leading metrics (see [DASHBOARD_ACCESS.md](DASHBOARD_ACCESS.md)).
4. Offline: enable airplane mode, save a draft, restore connectivity, confirm it
   syncs exactly once.
5. A rejected or conflicted draft shows the server's reason with **Retry as new**
   and **Discard** actions.
6. Push: sign in on a device, trigger a notification, confirm the payload. A
   safeguarding notification must not preview on the lock screen.
7. Sign out and confirm offline drafts survive (they are local by design).

## Builds

```bash
npx expo prebuild                 # generate native projects if needed
npx expo export --platform all    # static export for a web/PWA check
eas build --platform android --profile production
eas build --platform ios --profile production
```

`eas.json` is not committed; add one before the first store submission:

```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "production": {
      "channel": "production",
      "env": { "EXPO_PUBLIC_API_URL": "https://<api-host>/api/v1" }
    }
  },
  "submit": { "production": {} }
}
```

## OTA updates

```bash
eas update --branch production --message "describe the change"
```

An OTA update can change JavaScript and assets but not native modules. A new
Expo SDK or a new native dependency requires a store build.

## Release notes

Record the API version the build was tested against. A build pointed at an older
API will silently render empty widgets because the dashboard payload's `extra`
blocks are additive.