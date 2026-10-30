# Clearhouse — working notes

Fenwick Science Centre's clearance desk. Python 3.12-compatible Flask app
(runs on 3.11 too), Postgres as the only system of record, Keycloak for staff
identity. `run.json` holds install/build/serve; `app:app` is the WSGI entry.

## Layout

| Path | Holds |
|---|---|
| `app.py` | the WSGI entry (`create_app`) |
| `clearhouse/web.py` | app factory, the request gate (refusal order steps 1 to 5), error shape, boot threads |
| `clearhouse/api.py` | every `/api` route, in refusal order per endpoint |
| `clearhouse/views.py` | server-rendered pages and the template filters |
| `clearhouse/auth.py` | the app's own sessions, the sign-in sequence, `next` sanitising |
| `clearhouse/identity.py` | Keycloak exchange, realm registration, the status monitor |
| `clearhouse/db.py` | schema, the small connection pool, `tx()`, the boot sequence |
| `clearhouse/seed.py` | the six accounts, 20,000 objects, 24 pieces with their histories |
| `clearhouse/domain/` | one module per decision area |
| `templates/`, `static/` | server-rendered HTML, the app's own stylesheet and script |

## Where each rule is decided, once

- **State table** `domain/states.py` (`STEPS`): from-states, to-state, roles,
  owner-only, reason, day. The rail, the API and the refusals all read it.
- **Refusal order** `web.py` `gate()` for steps 1 to 5 and 7's size/type
  checks, then `domain/guard.py` (`may_act`, `published_fields`,
  `body_object`) and `domain/pieces.py` (`check_version`, `transition`).
- **Another maker's draft** `domain/guard.py` `visible_sql()`; every query that
  can name a piece adds it (`pieces.visible`, `pieces.queue`, `audit.trail`).
- **Budget** `domain/budget.py`: `committed_cents`, `check_clear`, `adjust`,
  `reset`, all under `pg_advisory_xact_lock(quarter)`.
- **Cleared-today count** `domain/budget.py` `cleared_today()`.
- **Spreadsheet-safe export** `domain/audit.py` `csv_field()`.
- **Needs my decision** `domain/pieces.py` `NEEDS`.
- **Catalogue walk and duplicate score** `domain/catalogue.py` (`WALK_KEY`,
  `score`, signed cursors).

## Things worth remembering

- Two writes against one version: every write takes `select … for update` on
  the piece first, so exactly one lands and the other is refused as stale.
- A booking race is settled by `insert … on conflict (day) do nothing`.
- `md5(seed:shuffle_rank)` is the walk order. A plain multiplier does not
  reorder for small seeds, which is why the key is a hash.
- Flagged duplicates are objects sharing `cutout_id` (seeded as 60 pairs in
  ids 101 to 220); `mask_b` is the weaker look-alike family (score 41 to 84).
- The browser keeps no state. After a write the page reloads with
  `#said=<message>` so the `Desk updates` announcement survives the reload.
- A successful sign-in deletes that email's rows in `login_failures`; that is
  the only place anything is deleted besides sessions, reviews and
  acknowledgements on revision, and schedule rows when a day is freed.
- `pg8000` is used rather than `psycopg` because its licence (BSD-3-Clause) is
  on the allowed list; `psycopg` declares `LGPL-3.0-only`.

## Checking it

- `python -m gunicorn -b 0.0.0.0:4173 -w 2 --threads 4 app:app`
- Rule-level checks and browser checks were run from `/tmp` during the build
  (API refusal order, concurrency, budget races, identity outage, Playwright
  journeys). They are deliberately not shipped in `/app`.
