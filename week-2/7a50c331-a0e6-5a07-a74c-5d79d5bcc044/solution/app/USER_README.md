# Tessel — user guide

Tessel is a graph database console for software agents and the teams who run them. Members sign in,
provision isolated context databases, ingest sources whose declared facts carry the moment they became
true, watch every write in a numbered write log until a compaction folds it into a new index
generation, and ask questions two ways: an exact keyword search and a small read-only graph language
that answers as of any past moment. Owners run members, API keys, the plan, the usage bill and the
audit log. The public site at `/` sells the product and prices it; `/contact` reaches sales.

## Seeded accounts

Every seeded account uses the password `deku-demo-pw-2026`. Two-step sign-in is off for all of them.

| Organization | Plan | Email | Role | Password |
|---|---|---|---|---|
| Northwind Labs | ship | northwind.owner@example.com | owner | deku-demo-pw-2026 |
| Northwind Labs | ship | northwind.editor@example.com | editor | deku-demo-pw-2026 |
| Northwind Labs | ship | northwind.viewer@example.com | viewer | deku-demo-pw-2026 |
| Acme Ops | scale | acme.owner@example.com | owner | deku-demo-pw-2026 |

Both organizations own a database named `launch_brain` (Northwind's holds the four Atlas launch sources).
Sign in at `/login`. The API takes the token from `POST /api/auth/login` (or an API key) as
`Authorization: Bearer <token>`; every `/api/v2` call also sends `API-Version: 2`.

## Running it

`run.json` is the only start path, run from the app root:

- install: `python3 -m venv --clear .venv && .venv/bin/pip install ... -r requirements.txt`
- build: `.venv/bin/python -m compileall -q tessel`
- serve: `.venv/bin/python -m tessel` (uvicorn in production mode on `0.0.0.0:$APP_PUBLIC_PORT`)

On every start the server waits for PostgreSQL, applies its schema and the idempotent seed, then serves.
`GET /api/health` answers `200` once PostgreSQL is reachable.

## Environment and services

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL: every record (members, sessions, keys, databases, sources, facts, write log, audit, jobs) |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit's SMTP sink: every notice (member added, plan changed, key rotated or revoked, export ready, password reset) |
| `MAIL_FROM` | the From line of every message |
| `APP_PUBLIC_URL` | the address written into password reset links |
| `APP_PUBLIC_PORT` | the port the server binds on `0.0.0.0` |

The star count on the public header comes from the saved code host answer in
`fixtures/code-host-repo.json`; Tessel never calls a public code host.
