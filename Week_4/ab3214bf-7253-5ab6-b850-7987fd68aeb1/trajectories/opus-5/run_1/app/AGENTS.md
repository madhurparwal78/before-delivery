# Hourproof Settlement Desk — repository notes

Hour-by-hour reconciliation of metered electricity against granular
certificates, with registry cancellation, an independent verifier's review and a
signed, publicly checkable PDF attestation.

## Running it

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # install
.venv/bin/python -m hourproof                                        # serve
```

Serves on `0.0.0.0:4173` (`APP_PUBLIC_PORT`), health at `GET /api/health`.
Boot waits for PostgreSQL, applies `hourproof/schema.sql` idempotently, seeds an
empty database once, then starts the registry-polling and seal-retry threads.
Every other dependency (WireMock, Gotenberg, MinIO) may be down at boot.

Configuration comes only from the environment: `DATABASE_URL`, `WIREMOCK_URL`,
`GOTENBERG_URL`, `S3_*`, plus `SETTLEMENT_CLOCK_START` (default
`2026-11-09T12:00:00Z`) and `REVIEW_SECONDS` (default 864000).

## Layout

```
hourproof/
  __main__.py      gunicorn boot (1 worker, gthread) and the serve entry point
  app.py           Flask app: blueprints, body-size guard, SPA shell, public PDF
  api/             request plumbing (__init__.py) and the four route modules
  domain/          the rules: timeline, units, repair, spread, allocation,
                   scores, lots, sample, review, opinion, residual, attestation,
                   states, numbers
  engine.py        allocation + ledger application, grid factors, lazy timeouts
  store.py         every SQL read and write
  views.py         the JSON shapes the API publishes
  sealing.py       signing and the three-part seal
  corrections.py   late corrections and the restatement chain
  workers.py       registry confirmation polling, held-seal retries
  seed.py          the invented seed data
  static/          the whole front end (no build step): css, js, fonts
```

Each domain rule lives in exactly one place. Window state transitions are in
`domain/states.py`; scores in `domain/scores.py`; gap repair in
`domain/repair.py`; the spread weights in `domain/spread.py`; lot status,
cancel-by and battery round-trip in `domain/lots.py`; the greedy allocation,
bundle ranges and digest in `domain/allocation.py`.

## Facts worth keeping

- All energy is integer watt-hours; scores are integer basis points rounded half
  up; nothing on a watt-hour, gram or basis-point path touches a float.
- Bundle ranges are lifetime counters above 2^53, so they travel as JSON strings
  and the browser formats them digit by digit (`format.js: commaDigits`).
- The settlement clock starts at `SETTLEMENT_CLOCK_START` when the process
  starts and advances in real time; every screen state comes from `server_now`
  or a `*_seconds_left` field, never from the device clock.
- A review timeout is applied lazily on read inside a row lock, so simultaneous
  reads raise the revision exactly once.
- Scores are computed at read from hours and bundles; they are never stored.
- `lines` holds live lines only; a Rejected line keeps its row so its range is
  never allocated again, and it is left out of every count.
- The front end keeps DOM nodes alive and updates them in place (wall cells,
  merit rows, sampled hours) so live refreshes never move focus.
- Reset the database in development with
  `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` then restart; the seed
  reapplies on the next boot.

## Seeded accounts

Password for all: `hourproof-demo-1`.
`anouk@verhoeven.example` and `joris@verhoeven.example` (analysts),
`mirthe@verhoeven.example` (lead), `vera@aldermoor.example` and
`bram@brightlock.example` (verifiers).
