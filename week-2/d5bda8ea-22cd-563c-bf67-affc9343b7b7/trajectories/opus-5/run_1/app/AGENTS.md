# Mela — repository notes

Mela is a Flask + Jinja + PostgreSQL event platform. `run.json` is the only entry
point: `install` builds `.venv`, `build` is empty, `serve` runs gunicorn
(`--preload`, gthread) on `0.0.0.0:${APP_PUBLIC_PORT:-4173}`.

## Layout

| Path | Holds |
|---|---|
| `app.py` | WSGI entry (`app = create_app()`) |
| `mela/__init__.py` | app factory, error handlers, cache and origin guards |
| `mela/config.py` | environment settings, `STARTED_AT` (shared through `--preload`) |
| `mela/db.py` | small connection pool, readiness keeper, `DatabaseUnavailable` |
| `mela/schema.sql`, `mela/seed.py` | idempotent schema and seed (advisory-locked) |
| `mela/domain.py` | rules needing no database: card state, queue ordinal, safe `next`, countdown wording, capacity checks |
| `mela/store.py` | reads and the event object (address privacy lives in `event_json`) |
| `mela/registrations.py` | serialized register / cancel / host decision / promotion / access-code limit |
| `mela/messages.py` | the one send-once (`Idempotency-Key`) decision |
| `mela/validation.py` | strict body check and field rules |
| `mela/api.py`, `mela/pages.py` | the JSON API and the server-rendered pages |
| `mela/templates/_card.html` | one Registration card template for every state |
| `mela/static/js/mela.js` | Alpine components, countdown, cover scatter, confetti, toasts |

## Things that bite

* Every `/api` handler opens `db.transaction()` **first**, so the outage 503 wins
  over body-size, auth and validation errors (API error precedence).
* `registrations.register` and friends *return* refusals instead of raising, so the
  surrounding transaction still commits the access-code failure it counted.
* Queue order uses `clock_timestamp()`, not `now()`: `now()` is the transaction
  start time and can order rows against the event lock order.
* Alpine's `$el` inside a method is the element the expression came from. Use
  `$root` for component-wide queries.
* `[hidden]` needs `display: none !important` because flex/grid rules out-specify
  the UA stylesheet; the card renders every state and hides the inactive ones.
* Inline field errors must live **outside** `<label>`, otherwise they join the
  control's accessible name. Form fields use `<label for>` + `id`.
* No `Content-Security-Policy` header: it blocks `page.addScriptTag`, which
  accessibility tooling uses. Pages reference no other origin anyway.

## Working locally

* `DATABASE_URL` is already set; never start a database.
* Reset the data: drop the tables and call `mela.db.apply_schema_and_seed()`.
