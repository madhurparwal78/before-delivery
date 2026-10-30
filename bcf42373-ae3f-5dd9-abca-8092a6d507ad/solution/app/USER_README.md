# Ivo Kastrel Casebook

The personal site and private studio of Ivo Kastrel, an invented solo creative developer: a cinematic home page
in eight chapters, a case study catalogue with a discipline filter, a journal, a wall of recognitions and a project
inquiry form. Behind it, the studio at `/studio` lets the one owner create, edit, publish, unpublish and delete
case studies and work through the inquiry inbox.

## Owner sign-in

- Email: `owner@example.com`
- Password: `deku-demo-pw-2026`

Sign in at `/studio/login`. This is seeded fixture data, stored only as a salted hash.

## Running it

The commands live in `run.json`:

| Step | Command |
|---|---|
| install | `python3 -m venv .venv && .venv/bin/python -m pip install --no-cache-dir --disable-pip-version-check -r requirements.txt` |
| build | (none) |
| serve | `.venv/bin/python -m gunicorn --workers 3 --worker-class gthread --threads 4 --graceful-timeout 5 --bind 0.0.0.0:${APP_PUBLIC_PORT:-4173} app:app` |

On start the app creates its schema and, into a database that has never been seeded, the seed data. Several
workers can start at once; the seed lands exactly once. `GET /api/health` answers `{"status":"ok"}` once the app
and its database are ready, and `{"status":"unavailable"}` (503) while PostgreSQL is unreachable; the app keeps
retrying and recovers on its own.

## Environment

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection URL (required), read once at start |
| `APP_PUBLIC_PORT` | port to answer on (4173 when unset) |
| `APP_PUBLIC_URL` | the app's public address (every link the app writes is relative, so it is not needed) |
| `SIGN_IN_LOCKOUT_WINDOW_SECONDS` | sign-in lockout window (900 when unset) |
| `SESSION_LIFETIME_SECONDS` | studio session lifetime (43,200 when unset) |

## Services

PostgreSQL is the only backing service and the only store: eight tables (`accounts`, `sessions`,
`sign_in_attempts`, `case_studies`, `journal_entries`, `recognitions`, `figures`, `inquiries`). No cache, queue,
file store or email sending.
