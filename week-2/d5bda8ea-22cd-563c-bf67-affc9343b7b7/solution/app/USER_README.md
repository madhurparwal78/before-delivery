# Mela Events

Mela is a free public event platform for small community hosts: run clubs, book circles, board-game
evenings and firework watch parties. Each event has its own themed page with a Registration card;
visitors discover events by city and category, members follow community calendars and join guest lists
that the host approves. A street address stays private until the host lets a guest in, and no event ever
takes more approved guests than its capacity.

## Seeded logins

Every seeded account uses the password `deku-demo-pw-2026`.

| Email | Name | Role |
|---|---|---|
| `host@example.com` | Noor Kapoor | hosts all fifteen seeded events |
| `guest@example.com` | Ravi Menon | guest |
| `guest2@example.com` | Lena Ortiz | guest |

The private fireworks evening at `/fireworx` takes the access code `GLOW-2026`.

## Running it

`run.json` is the only way Mela starts:

- `install`: `python3 -m venv --clear .venv && .venv/bin/pip install ... -r requirements.txt` (every package pinned)
- `build`: nothing to build
- `serve`: `.venv/bin/python -m gunicorn --config gunicorn.conf.py --bind 0.0.0.0:${APP_PUBLIC_PORT:-4173} app:app`
  (gunicorn in the foreground, three workers with eight threads each)

The server listens before the database is reachable. `GET /api/health` answers `{"status": "unavailable"}`
until PostgreSQL answers and the schema and seed are applied, then `{"status": "ok", "started_at": ...}`.

## Configuration

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | the PostgreSQL connection URL (the only backing service) |
| `APP_PUBLIC_PORT` | the listening port (default `4173`) |
| `MELA_ACCESS_CODE_WINDOW_SECONDS` | optional access-code lockout window in seconds (default `900`) |
| `MELA_IDEMPOTENCY_RETENTION_SECONDS` | optional time a contact or report `Idempotency-Key` is remembered (default `86400`) |

## Services

Mela talks only to PostgreSQL at `DATABASE_URL`. It applies its schema and seed when it first reaches the
database, under an advisory lock, so any number of instances can start together. Alpine.js is served from
the app's own origin; pages contact no other host.
