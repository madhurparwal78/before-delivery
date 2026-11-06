# Ivo Kastrel Casebook — working notes

A Flask app rendering a cinematic personal site plus a private owner studio,
over PostgreSQL only. Served by gunicorn with three workers.

## Shape of the code

| Module | Holds |
|---|---|
| `app.py` | WSGI entry point: `app = create_app()` |
| `ivo/__init__.py` | app factory, the one error-to-answer mapping, the apostrophe-preserving Jinja `finalize` |
| `ivo/config.py` | every environment read (`DATABASE_URL`, lockout window, session lifetime) |
| `ivo/db.py` | connection pool, schema, the guarded seed, `transaction()`, `confirm_store()` |
| `ivo/seed.py` | the one seed load; all content is invented |
| `ivo/errors.py` | `ApiError` plus every refusal reason string, and `json_refusal` |
| `ivo/fields.py` | field limits, the editable-field list, every field message |
| `ivo/catalogue.py` | catalogue order, ordinals/totals/neighbours, the publish rule, case writes |
| `ivo/accounts.py` | sign-in, the lockout rule, sessions |
| `ivo/journal.py` | the journal business-day rule |
| `ivo/inquiries.py` | inquiry validation, duplicate window, guarded resolve |
| `ivo/api.py` | the published JSON surface |
| `ivo/pages.py` | the server-rendered pages |
| `ivo/visuals.py` | generated SVG; nothing is stored or shipped as a file |
| `ivo/copy.py` | the site's pinned copy |

Each domain rule lives in exactly one place: the publish rule
(`catalogue.publish_blockers`), the catalogue order with its derived values
(`catalogue.CATALOGUE_ORDER` / `published_catalogue` / `neighbours`), the
editable-field list (`fields.EDITABLE_FIELDS`), the lockout
(`accounts.lock_state`), the journal day (`journal.PUBLIC_CLAUSE`) and the
duplicate window (`inquiries.DUPLICATE_WINDOW_SECONDS`). The studio script
derives its editable list from the editor form rather than restating it.

## Things that bit, and why the code looks the way it does

- **`CREATE TABLE IF NOT EXISTS` is not concurrency-safe.** Two workers booting
  at once raced on PostgreSQL's catalogue and one died with a `UniqueViolation`
  on `pg_class`. `Database.prepare()` therefore takes the advisory lock
  *before* the schema statements, not just before the seed.
- **Status and alert regions must never be `display: none` while empty.** They
  are published contracts (`status "Inquiry status"`, `alert "Studio errors"`);
  hiding them drops them from the accessibility tree so role queries cannot
  find them. Only their margins wait for content.
- **`Markup.replace()` escapes its arguments.** The Jinja `finalize` that keeps
  literal apostrophes has to go through `str(escape(value))` first.
- **A shared button rule can override a later `display: none`.** The `Menu`
  button needs its `display: none` *after* the shared button block.
- **`feedback.clear(form)` only clears field marks.** The studio keeps one
  error summary outside the editor form, so each caller clears its own region.
- **Pages answer 503 during an outage**, including the ones that read no
  records, via `pages.require_store()`.
- **sessionStorage is per tab.** The intro-cover flag is a browsing-session
  flag, so a new tab legitimately replays the cover; the motion choice uses
  localStorage because it must survive a new tab.
- **Percent-encoded addresses** are caught in `before_request` from `RAW_URI`,
  because Werkzeug decodes the path before matching.

## Running and checking

```
sh /tmp/finalise.sh          # reset the store and start from run.json
```

Verification scripts used while building (not shipped):

| Script | Covers |
|---|---|
| `/tmp/check_api.py` | the JSON surface, precedence, concurrency |
| `/tmp/check_html.py` | delivered HTML, copy, metadata, chrome |
| `/tmp/check_auth.py` | lockout and session lifetime (needs short env windows) |
| `/tmp/check_lifecycle.py` | seed-once, restart persistence, journal day |
| `/tmp/check_outage.py` | database outage and recovery (uses `/tmp/pgproxy.py`) |
| `/tmp/btest/a11y.mjs` | axe WCAG 2.2 AA on seven pages |
| `/tmp/btest/layout.mjs` | viewports, colour, type, the five loops, motion |
| `/tmp/btest/journeys.mjs` | every journey end to end in a browser |

The seeded owner is `owner@example.com` / `deku-demo-pw-2026` (fixture data,
stored only as a salted PBKDF2 hash).
