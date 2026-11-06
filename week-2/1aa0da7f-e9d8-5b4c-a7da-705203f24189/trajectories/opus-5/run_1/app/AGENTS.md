# Wardline — repository notes

Digital evidence custody and disclosure: compartments, sealed exhibits,
burned-in redaction, separated release sign-off and a hash-chained ledger an
auditor verifies in their own browser.

## Running it

```
python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m wardline          # binds 0.0.0.0:4173, honours APP_PUBLIC_PORT
```

`run.json` holds the same three commands. Schema and seed are applied on every
start and are idempotent; several copies may run against one database and
bucket. `GET /api/health` answers `{"status":"starting"}` until the database
first answers, then `{"status":"ok"}`.

Every service address and credential is read from the environment
(`DATABASE_URL`, `S3_*`, `SMTP_*`, `MAIL_FROM`, `APP_PUBLIC_*`, timers).

## Layout

| Path | What lives there |
|---|---|
| `wardline/app.py` | ASGI dispatch, static and shell serving, lifespan |
| `wardline/http.py` | Routing, request shape, context, denial writing |
| `wardline/errors.py` | The one error catalogue |
| `wardline/validation.py` | Field rules and the published refusal copy |
| `wardline/rules.py` | Roles, scopes, exhibit and release transitions |
| `wardline/access.py` | Grant lookup and every access refusal |
| `wardline/ledger.py` | Canonical form, digests, serialised appends |
| `wardline/api_*.py` | Endpoints by area (platform, access, exhibits, releases, files, ledger) |
| `wardline/media.py` | Sniffing, displayed-page geometry, PNG and PDF writers, find-text |
| `wardline/seed.py` | The published people, compartments, exhibits and releases |
| `wardline/workers.py` | Status checks, mail delivery, sweeps, background seeding |
| `wardline/static/*.js` | Browser modules: shell, screens, canonical form, chain rule |

## Decisions worth remembering

- **One place per rule.** Transitions live in `rules.py`, access refusals in
  `access.py`, the canonical digest in `ledger.py` (server) and `canon.js`
  (browser), the Breaks rule in `chain.js`, shared by the walk and the lattice.
- **Refusals must outlive their transaction.** A failed sign-in or step-up
  records its count (and any lockout entry) in a transaction that commits, and
  the error is raised afterwards: see `auth._open_session`. Raising inside the
  transaction would roll the count back.
- **Denials** are written by `http.write_denial` from the error handler, with
  the offending id passed on `ApiError(target=...)`.
- **Cross-process serialisation** uses PostgreSQL advisory locks
  (`db.take_lock`): one key per ledger, compartment, exhibit, release, link and
  idempotency key.
- **Ledger protection** revokes UPDATE/DELETE/TRUNCATE from every login and
  installs refusing triggers on each start (`db.protect_ledger`). Keep a `%%`
  in LIKE patterns passed through psycopg2.
- **Streaming** registration and downloads are async handlers
  (`api_files.py`); everything else is a sync handler run in the threadpool.
  `TimedStream` drops `content-length` and closes a transfer stalled for 30
  seconds.
- **Exactly one `[data-figure]` per screen.** The compartment docket renders
  its count without that attribute when the exhibit or release owns the figure.
- **Custody timeline geometry.** The spacer after the stops is sized from the
  scroller's own client height so the scroll range is exactly
  `(entries - 1) * 64`.

## Checking it

Helper scripts used during development live in `/tmp` (not committed):
`restart.sh`, `reset.sh` (drops the schema and reseeds), `t_intake.py`,
`t_release.py`, `t_core.py`, `t_media.py`, `t_edge.py`, `t_outage.py` (API,
run with `/app/.venv/bin/python`) and `t_ui.py`, `t_ui2.py`, `t_banner.py`
(Playwright, run with the system `python3`). There is no `ps`/`pkill` in this
image: scan `/proc` to find the server process.
