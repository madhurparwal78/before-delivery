# Wayline Data Pipeline Console

Wayline copies data from business systems into a warehouse and shows every sync live. The console has a connector
catalog, sources and destinations, connections with streams, sync modes and schedules, a job history with live logs,
a Builder for an HTTP source, members with roles, and a hash-chained audit log. A public marketing site sits beside it.

## Seeded logins

Every seeded user signs in at `/login` with the password `deku-demo-pw-2026`.

| Workspace | Name | Email | Role |
|---|---|---|---|
| Lumen Freight | Priya Natarajan | admin@example.com | admin |
| Lumen Freight | Marco Bell | editor@example.com | editor |
| Lumen Freight | Dana Okafor | viewer@example.com | viewer |
| Outpost Data | Sasha Reyes | outsider@example.com | admin |

The Builder's sandbox API key is `sandbox-key-2026`.

## Running it

The commands are in `run.json`:

- install: `python3 -m venv .venv && .venv/bin/pip install --no-cache-dir -r requirements.txt && npm ci --no-audit --no-fund`
- build: `npm run build` (the Vite client, a server bundle used once to prerender the marketing pages, then the prerender)
- serve: `.venv/bin/uvicorn server.main:app --host 0.0.0.0 --port ${APP_PUBLIC_PORT:-4173} --no-access-log`

On every start the server creates its schema, seeds once (a recorded seed run is never repeated), fails any job a
previous run left active as `interrupted`, and only then answers `GET /api/health` with 200. While PostgreSQL is
unreachable it answers 503 and retries every two seconds.

## Configuration

| Variable | Use |
|---|---|
| `DATABASE_URL` | the PostgreSQL connection (the only datastore; warehouse tables live in `warehouse_<destination id>` schemas) |
| `APP_PUBLIC_PORT` | the listening port (default 4173) |
| `APP_PUBLIC_URL` | the app's public address |
| `WAYLINE_LOCKOUT_SECONDS` | sign-in lockout period, default 900 |
| `WAYLINE_INVITE_TTL_SECONDS` | invitation lifetime, default 604800 |
| `WAYLINE_IDEMPOTENCY_TTL_SECONDS` | idempotency key lifetime, default 86400 |

The app talks to no service other than that PostgreSQL database.
