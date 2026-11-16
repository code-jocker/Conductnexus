# Production deployment

The reference deployment is `render.yaml` (Render, Node 22, MongoDB Atlas). The
same steps apply to any Node host that can run a long-lived process and reach
MongoDB.

## Prerequisites

- Node.js 22 (matches `render.yaml`'s `NODE_VERSION`).
- MongoDB 6 or newer, reachable from the API host. Atlas tier M0 or above.
- A value for every variable in [ENVIRONMENT.md](ENVIRONMENT.md).

## First deployment

```bash
git clone <repo>
cd backend
npm ci
npm run build          # tsc -> dist/
npm run migrate        # apply versioned migrations
npm run seed           # roles, permissions, school defaults, first admin
npm start              # node dist/server.js
```

`npm run seed` is idempotent (`$setOnInsert` throughout): re-running it never
deletes or overwrites records an administrator has since edited. Legacy template
rows are upgraded exactly once.

`npm run migrate` must run before `npm start` on a fresh database. It is safe to
run on every deploy — already-applied migrations are skipped, and a migration
that was edited after being applied aborts the run instead of silently changing
the schema.

## Health and readiness

| Endpoint | Use |
|---|---|
| `GET /api/v1/health` | Liveness plus database reachability. Point the platform's health check here. |
| `GET /api/v1/admin/system/health` | Full operational snapshot: database stats, worker state, queue depth, backups, integrations. Requires `system.monitor`. |

## Reverse proxy and TLS

- Terminate TLS at the proxy (Render, Nginx, Caddy).
- Set `APP_URL` to the public HTTPS origin and list the same origin in
  `CORS_ORIGIN` — the web console is served separately, so include both origins.
- The app sets `helmet`, per-route rate limits, and a 400-request-per-minute
  global limiter. No proxy tuning is required beyond forwarding `X-Forwarded-*`.

## Background workers

`npm start` also runs the message-queue worker (every 60 seconds), the backup
schedule, and the optional WhatsApp worker. A single instance is assumed.

- Run **one** instance. The queue claims messages with a lease, so a second
  replica is safe for sending, but the WhatsApp worker is single-session and must
  not be duplicated.
- Scale by increasing the queue interval, not by adding replicas.

## CI

`.github/workflows/ci.yml` runs on push, pull request and manual dispatch:

1. `npm ci` for the root, backend, frontend and mobile workspaces.
2. `npm run typecheck` — backend, web and mobile.
3. `npm test` — backend suite against a `mongo:7` service container.
4. `npm --prefix frontend run build`.

Nothing reaches `main` with a type error, a failing test or a broken web build.

## Rollback

```bash
npm run migrate:status        # confirm which migrations are applied
git checkout <previous-sha>
npm --prefix backend run build
npm start
```

Migrations are forward-only by design: `down()` exists on the migration module
type but is never run automatically. Roll back by deploying previous application
code, not by reversing the schema.