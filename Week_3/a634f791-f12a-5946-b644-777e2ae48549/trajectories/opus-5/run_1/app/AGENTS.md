# Northfall reference programme — working notes

A Flask app serving the public reference library (English and Finnish) and the
private desk from one origin, with Postgres as the only backing service.

## Shape of the code

```
wsgi.py                  the WSGI entry point
gunicorn.conf.py         the production server configuration
northfall/
  config.py              the three settings, read at start and nowhere else
  db.py                  the pool, the outage signal, schema + seed once
  schema.sql             the nine entities plus desk_session and seed_marker
  seed.py                the seed, applied once per database
  http.py                the two refusal shapes, body reading, the request store
  strings.py             the published wording, one table per language
  domain/
    clock.py             the service clock and the Helsinki date
    references.py        the live set, the state, the ordinal run, the rollover
    slugs.py             slug derivation, slug history, the Finnish order
    fields.py            the editable-field list, field rules, the clearance void
    previews.py          preview links and elapsed-time expiry
    accounts.py          password hashing and sessions
  api/                   public reads, enquiries, sign in, the desk
  pages/                 the served pages, their chrome and their content
  templates/             Jinja templates
  static/                css, js, fonts, img
tools/                   developer checks, not part of the served product
```

## Rules that live in exactly one place

- **Now** — `domain/clock.py`. System instant plus `service_clock.offset_seconds`,
  read fresh per request, held to the whole second. Nothing else asks for the time.
- **The live set and the reference state** — `domain/references.state_of` and
  `is_live`. Published, not retired, window contains today in Europe/Helsinki.
- **The ordinal run** — `domain/references.renumber` and `place`. `ensure_run`
  catches the run up when the Helsinki date moves, under one advisory lock.
- **The slug** — `domain/slugs.slugify`, `claim_slug`, `rename`.
- **The role check** — `api/support.desk_account` and `require_steward`, always
  from the stored account behind the session.
- **The clearance void** — `domain/fields.voids_clearance`.
- **The editable fields** — `domain/fields.EDITABLE` and `validate`.
- **Refusals** — `http.Refusal` plus the error handlers in `northfall/__init__.py`.
- **Finnish wording** — `strings.FI`.
- **Desk focus targets** — the `focusKey` calls in `static/js/desk.js`.

## Concurrency

Every write that can move the ordinal run takes `pg_advisory_xact_lock(WRITE_LOCK)`
first (`store(write=True)`), then catches up the run, then writes, then renumbers.
Reads take the lock only when the Helsinki date has moved since
`service_clock.last_rollover_date`. One lock, taken in one order, so no deadlock.

## Gotchas learned here

- Jinja resolves `t.copy` to `dict.copy`, the method. String keys must not clash
  with dict attribute names; the copy-button key is therefore `copy_label`.
- `?sector=` with an empty value means no filter, but `?sector=%00` is a value
  that matches nothing. Strip NUL from the *echo*, never from the comparison.
- A hostile path (NUL, lone surrogate) must be refused before it reaches SQL;
  `before_request` in `northfall/__init__.py` does that in one place.
- The skip link must translate fully clear of the fixed header when it is not
  focused, or axe's target-size rule reports the wordmark as obscured.
- `urllib` follows 308 redirects in Python 3.11; developer checks use an opener
  with redirects disabled.

## Developer checks

Start the app (`sh tools/serve.sh`) and run, after `tools/reset_store.py`:

```
PYTHONPATH=/app .venv/bin/python tools/check_api.py
PYTHONPATH=/app .venv/bin/python tools/check_rules.py
```

`tools/reset_store.py` drops every table so the next boot seeds again.
`tools/make_images.py` redraws every served image.
