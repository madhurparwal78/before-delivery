# Ivo Kastrel — Studio

A personal site and private studio for a fictional solo creative developer.
Python (Flask) renders every page; plain JavaScript improves them in the browser;
PostgreSQL is the only backing service.

## Accounts

The studio has exactly one owner account:

- Email: `owner@example.com`
- Password: `deku-demo-pw-2026`

Sign in at `/studio/login`. There is no signup.

## Configuration

Read from the environment at start (never written into the source):

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection URL | required |
| `APP_PUBLIC_PORT` | port to answer on | `4173` |
| `APP_PUBLIC_URL` | the app's public address | — |
| `SIGN_IN_LOCKOUT_WINDOW_SECONDS` | sign-in lockout window | `900` |
| `SESSION_LIFETIME_SECONDS` | session lifetime | `43200` |

## Running

- `install`: `pip install --no-cache-dir -r requirements.txt`
- `serve`: `python -m gunicorn --workers 3 --bind 0.0.0.0:${APP_PUBLIC_PORT:-4173} app:app`

`serve` starts a production server with several worker processes, binds
`0.0.0.0`, creates the schema and loads the seed once (guarded), and keeps
retrying the database if it is unreachable.

## Structure

- `app.py` — routes, API, authorization, error precedence
- `db.py` — schema, guarded seed, connections
- `rules.py` — domain rules, each decided once
- `visuals.py` — deterministic generated visuals
- `templates/`, `static/` — server-rendered pages and progressive JavaScript
