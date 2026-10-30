# Tallow Cover — repository notes

Attendance and leave service for UK residential care homes. Python server (Flask +
asyncpg + gunicorn), vanilla ES-module browser app, Postgres + MinIO + Mailpit.

## Layout

- `run.json` — install / build / serve manifest.
- `tallow_cover/` — the server.
  - `config.py` env only; `db.py` pool + `transaction()`; `schema.sql`; `seed.py`.
  - `timeutil.py` Europe/London business time, shift windows, display formats.
  - `errors.py` the single error catalogue; `bodies.py` published body keys.
  - `domain/` one module per rule family (floors, roster/on-duty, leave, attendance,
    accrual, sickness, preview, idempotency, audit, timesheet).
  - `projections.py` the role projections; `records.py` record loaders.
  - `api/` blueprints; `app.py` boundary + static; `workers.py` sweeps.
  - `static/` the browser app (no build step; `build` only byte-compiles Python).
- `THIRD_PARTY_NOTICES.md` — shipped packages and both typefaces.

## Traps found the hard way

- **Aware datetime subtraction with the same `tzinfo` gives the wall-clock
  difference, not real elapsed time.** All instants are therefore held in UTC
  (`timeutil.london_wall_clock`) and only converted to Europe/London for display.
  Without this a 22:00–08:00 night reads 10 hours across every clock change.
- **The driver is asyncpg, not pg8000**, because pg8000 pulls in `scramp`, which
  is MIT-0 and so outside the licence list in the brief's working rules. asyncpg
  is Apache-2.0 with no dependencies. `db.py` runs one asyncio loop in its own
  thread; `asyncpg.create_pool` must be constructed *inside* that loop, and
  `pool.acquire()` is an awaitable rather than a coroutine.
- `db.py` rewrites this codebase's `%s` placeholders to asyncpg's `$1, $2, …`
  and translates `UniqueViolationError` into `db.Unique`.
- `email.policy.SMTP.clone(max_line_length=None)` breaks `set_content`; use a
  large `max_line_length` (998) instead to keep Subject on one line.
- The brief's worked example for Tom Achebe prints `remaining_hours` 160.00
  after the return; the stated rule (`cost = hours − sickness_hours`) gives
  152.00, and the code follows the rule.
- Idempotency relies on the `idempotency_records` unique index inside the
  work's own transaction, so a concurrent twin blocks and then replays.
- Per-person punch serialisation is `SELECT … FROM people … FOR UPDATE`;
  approval serialisation is `SELECT … FROM units … FOR UPDATE`.

## Local testing

The services are reachable as `postgres`, `mailpit`, `minio` from `/app`.
`python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`, then
`.venv/bin/python -m tallow_cover`. Delete `.venv` before finishing: the
manifest recreates it and its interpreter symlinks point outside `/app`.
