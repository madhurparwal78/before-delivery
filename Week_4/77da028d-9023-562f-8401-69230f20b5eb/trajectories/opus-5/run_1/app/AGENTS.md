# Darkframe — repository notes

A backyard deep-sky imaging workspace: tonight's plan, the session log, the
hours-owed ledger and the calibration library, behind one public port.

## Running it

```
.venv/bin/python -m darkframe_build      # copies web/ and vendor/ into static/
.venv/bin/python -m darkframe_serve      # starts all four services
```

`run.json` holds the `install`, `build` and `serve` commands. `serve` starts
four operating-system processes: the gateway on `APP_PUBLIC_PORT` (4173) bound
to `0.0.0.0`, and the sky engine (+100), ledger (+200) and push dispatcher
(+300) bound to `127.0.0.1`. Each internal service answers
`GET /internal/health` on its own port; the gateway never exposes `/internal`.

Seed workspace keys: `dfk_ines_7c41a9e2` (Ines Okafor, Cambridge) and
`dfk_tomasz_3e8b52d0` (Tomasz Brandt, Granada).

## Where each rule lives

Every domain rule is decided in exactly one module under `darkframe/domain/`:

| Rule | Module |
|---|---|
| noon rule, observing dates, clock-change wall times | `timeutil.py` |
| Sun, Moon, sidereal time, precession, parallax | `astro.py` |
| astronomical night, night minutes, night hours | `night.py` |
| horizon mask bins, position status | `horizon.py` |
| sky-clear, staleness | `conditions.py` |
| filter windows, Moon minima, filter order | `filters.py` |
| usable minutes, verdict, best, clear window, plan body | `verdict.py` |
| paired ledger movements | `paired_ledger.py` |
| project, session and calibration state machines | `states.py` |
| calibration ages, matching, refusal message | `calibration.py` |
| new moons and reminder occurrences | `newmoon.py` |
| push titles and messages | `pushtext.py` |
| every rounding rule, the share grid | `rounding.py` |

The duration format and the verdict-card copy live in the browser
(`web/js/format.js`, `web/js/verdictcard.js`, `web/js/copy.js`), because only
the browser prints them.

## Service boundaries

- **gateway** (`darkframe/gateway/`) owns schema `gateway` and stores only
  workspace keys (hashed). It authenticates, enforces the body, content-type
  and same-origin limits, stamps `X-Request-Id`, serves `static/`, answers
  `/api/health`, and proxies every other `/api` route to one internal service
  (`ROUTE_SERVICES` in `gateway/app.py`). After a successful mutating call to
  the ledger it asks the sky engine to re-evaluate.
- **sky-engine** (`darkframe/sky_engine/`) owns schema `sky_engine`: the site,
  the 72-bin horizon mask, plan targets, hourly conditions, verdict history,
  the reminder settings and the durable `verdict_outbox`. Its background
  evaluator re-evaluates marked imagers every second and sweeps every imager
  every minute, writing verdict and reminder rows to the outbox.
- **ledger** (`darkframe/ledger_svc/`) owns schema `ledger`: projects, ledger
  entries, sessions, batches, frames, calibration sets and versions, edit
  locks, idempotency keys and share links. It reads site facts from the sky
  engine over HTTP.
- **push-dispatcher** (`darkframe/push_dispatcher/`) owns schema
  `push_dispatcher`. Its one allowed cross-schema read is claiming rows of
  `sky_engine.verdict_outbox`; claiming and push creation happen in one
  transaction, so no row is lost.

## Error precedence

The published order is 413, 415, 401, 404, idempotent replay, 409, 422. Routes
that would otherwise validate fields before a state guard pass a validator
callback into the store function, so the 409 is raised first — see
`add_batch`, `amend_session`, `start_session`, `save_notes`, `create_session`
and `set_allotment`.

## Dependencies

Only `starlette`, `uvicorn`, `asyncpg` and `h11`. `httpx` and `psycopg` are
deliberately avoided: `certifi` is MPL-2.0 and `psycopg` is LGPL, neither of
which the licence rule allows. The HTTP client in `httpclient.py` and the S3
client in `objectstore.py` are small because of that. three.js and the Sora
variable fonts are vendored in `vendor/` and served from `/vendor/`.

## Verifying changes

Chromium for Playwright needs `playwright install-deps chromium`. The useful
manual checks are: the API surface and bodies, the eight journeys in a browser
at 375/768/1280 with touch and reduced-motion variants, and the outage paths
(ntfy, MinIO and PostgreSQL unreachable). Reset state with

```
.venv/bin/python -c "import asyncio,asyncpg,os
async def m():
    c=await asyncpg.connect(os.environ['DATABASE_URL'])
    for s in ('gateway','sky_engine','ledger','push_dispatcher'):
        await c.execute(f'drop schema if exists {s} cascade')
    await c.close()
asyncio.run(m())"
```

## Things that surprised us

- `vw` includes the scrollbar, so the Plan screen's dome keeps its 44–48% of
  the window width while the centre column is laid out in client pixels; the
  rail and right-column widths are chosen so the dome's centre lands within
  40 pixels of the window centre at every width from 1200 up.
- The night time bar owns the very bottom of a phone screen and navigation
  sits above it, so `--timebar-h` is measured by the Plan screen and read by
  the shell's navigation rule.
- The plan screen repaints in place rather than re-rendering, because a
  refresh must never close an open dialog or replace typed values.
