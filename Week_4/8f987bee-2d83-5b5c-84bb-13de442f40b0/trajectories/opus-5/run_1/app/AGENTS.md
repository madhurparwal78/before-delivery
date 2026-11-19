# Wayline — repository notes

Wayline is a data pipeline console: a FastAPI server on `server:app` serving a React (Vite) single
page application and a JSON interface under `/api`, with every record in the provided PostgreSQL
database.

## Layout

| Path | What lives there |
|---|---|
| `server.py` | the entry point grading serves (`.venv/bin/uvicorn server:app`) |
| `backend/boundary.py` | the ASGI layer deciding request identity, size, type, 404, 405 and the 503 while the database is away |
| `backend/published.py` | the one list of published paths, their methods and the page routes |
| `backend/db.py` | the asyncpg pool and the readiness loop that creates the schema, seeds and recovers |
| `backend/sync.py` | job creation, the source snapshot, the all-or-nothing commit, cancellation, restart recovery, live events |
| `backend/connections.py`, `backend/scheduling.py`, `backend/cron.py`, `backend/plans.py` | connection validation, versions, next runs, cron and plan limits |
| `backend/warehouse.py` | one stored table per warehouse table in `warehouse_<destination id>` schemas, generations, record paging |
| `backend/routes/*.py` | one module per area of the interface |
| `frontend/src/marketing`, `frontend/src/console`, `frontend/src/auth` | the pages |
| `frontend/src/lib` | the API client, session, formats, idempotency keys, the wizard draft, sounds |
| `scripts/*.py` | development checks (not shipped behaviour) |

## Build and run

- `npm run build` runs the client build, the SSR build into `dist-ssr`, then
  `scripts/prerender.mjs`, which writes `dist/prerender.json`. The server injects each route's
  fragment into `dist/index.html`, so every marketing route carries its headline in the first
  response.
- `scripts/serve_control.py restart` stops and starts the production server during development.
- `scripts/reset_db.py` drops the schemas, the way grading provisions a fresh database.

## Development checks

Run them against a running server, after `reset_db.py` where a clean state matters:

| Script | Covers |
|---|---|
| `scripts/api_check.py` | roles, isolation, input rules, methods, versions, members, plans, sources, builder, idempotency, lockout, return addresses |
| `scripts/api_check2.py` | sync modes, schema policies, snapshots, simultaneous requests, paging cursors, next runs, secrets, fifty event streams |
| `scripts/recovery_check.py` | live events, restart recovery, the audit chain |
| `scripts/env_check.py` | short invitation and key lifetimes, and the database outage behaviour, on their own servers |
| `scripts/seed_check.py` | the exact first-start state and edits surviving a restart |
| `scripts/ui_check.py`, `scripts/ui_check2.py` | the judged browser journeys, the wizard draft, the honest switch, the chime |
| `scripts/layout_check.py`, `scripts/contrast_check.py`, `scripts/axe_check.py`, `scripts/final_check.py` | breakpoints, touch targets, reduced motion, contrast, WCAG, server-rendered headlines |

## Things worth remembering

- Status copy is compared character for character, so never put `text-transform: uppercase` on a
  published copy string. Buttons and navigation may be uppercase because role and text matching is
  case-insensitive; status regions, table headers and comparison cells are not.
- Two controls must never share an accessible name on one page: the preference switches live only
  in the console top bar, and `/app/settings` shares the top bar's "Settings status" region.
- Keep every file world-readable (`chmod -R a+rX /app`); grading runs as an unprivileged user.
- asyncpg, not psycopg, because the licence list in the brief excludes LGPL.
