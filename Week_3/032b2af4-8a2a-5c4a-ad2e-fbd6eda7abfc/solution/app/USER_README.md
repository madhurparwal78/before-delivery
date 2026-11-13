# Pacely

Pacely is an athlete training network. Athletes upload the GPX file their watch recorded; the server parses it into an
activity with exact distance, moving and elapsed time, pace, kilometre splits, best efforts and elevation gain, matches it
against segments, ranks it on leaderboards with personal records and crowns, and posts it to followers' feeds for kudos
and comments. Monthly challenges, weekly stats and a music-backed year recap fill up as athletes train. The public face
is a marketing site (home, features, maps, challenges, subscription, family, student, team plans, about, what's new).

## Seeded logins

All four share the password `deku-demo-pw-2026`.

| Email | Athlete | Notes |
|---|---|---|
| `ava@example.com` | Ava Brooks | subscriber on the individual plan, public |
| `leo@example.com` | Leo Park | public |
| `mia@example.com` | Mia Chen | private account |
| `sam@example.com` | Sam Ortiz | public |

## Running it

The commands live in `run.json`:

- `install`: `python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt`
- `build`: byte-compiles the package and creates the reserved `.browser_screenshots/` and `.downloads/` directories
- `serve`: `.venv/bin/python -m pacely` (uvicorn in the foreground on `0.0.0.0`)

The schema and seed data are applied on start and are idempotent. Wait for `GET /api/health` to answer `200`.

## Environment variables

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (the only datastore) |
| `APP_PUBLIC_PORT` | listen port, default 4173 |
| `APP_PUBLIC_URL` | the public address the app answers at, default `http://127.0.0.1:<port>` |

## Layout

`pacely/` is the Python package (routes, schema, GPX parsing, visibility, leaderboard), `static/` the CSS and ES modules,
`assets/` the media served at `/assets/<file>` and listed with licences in `assets.json`. The running app never writes under
`/app`.
