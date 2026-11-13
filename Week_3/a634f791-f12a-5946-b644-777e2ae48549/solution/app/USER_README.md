# Northfall Reference Desk

Northfall's customer reference programme as one web product: the public reference library (English
at `/`, Finnish under `/fi`) and the private desk at `/desk`, where references are drafted, ordered,
previewed and published and a steward records each customer's clearance window.

## Running it

`run.json` holds the commands:

- install: `python3 -m venv .venv`, then `.venv/bin/pip install --only-binary=:all: -r requirements.txt`,
  each attempt bounded to 210 s and retried up to five times so a stalled download cannot hang the install
- build: none
- serve: `.venv/bin/gunicorn` on `0.0.0.0:${APP_PUBLIC_PORT:-4173}` (production server, foreground)

The app creates its schema and the seed on start; `GET /api/health` answers `503 {"status":"starting"}`
until Postgres answers, then `200 {"status":"ok"}`.

## Settings

| Variable | Use |
|---|---|
| `DATABASE_URL` | the Postgres database: every record, including desk sessions |
| `APP_PUBLIC_PORT` | the port to listen on (default 4173) |
| `APP_PUBLIC_URL` | the public origin, used for preview links and the social preview image |

The one backing service is Postgres. No other datastore, cache or third-party service is used.

## Desk accounts

Email: curator@example.com
Password: deku-demo-pw-2026
Role: curator in northfall

Email: steward@example.com
Password: deku-demo-pw-2026
Role: steward in northfall

Email: curator.westhall@example.com
Password: deku-demo-pw-2026
Role: curator in westhall

A curator drafts, edits, orders, publishes, retires and makes preview links. A steward does all of
that and also records clearance windows and deletes enquiries.
