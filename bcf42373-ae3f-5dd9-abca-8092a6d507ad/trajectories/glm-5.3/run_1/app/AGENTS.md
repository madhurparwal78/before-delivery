# Ivo Kastrel site and studio — engineering notes

A Python (Flask) server renders every page; plain JavaScript in `/app/static/app.js`
progressively improves them; PostgreSQL is the only backing service.

## Layout

- `app.py` — routes, API, authorization, the one refusal builder and the error precedence
- `db.py` — schema, guarded seed (advisory lock + `studio_flags` marker), scrypt hashing, pool
- `rules.py` — every domain rule decided once (limits, editable fields, lockout constants,
  duplicate window, slug/email/phone shapes)
- `visuals.py` — deterministic generated visuals derived from stored fields
- `templates/` — server-rendered pages, readable with scripting off
- `tests_api.py`, `tests_browser.py`, `tests_a11y.py` — black-box verification suites

## Domain rules, one place each (DP-76)

| Rule | Where |
|---|---|
| publish rule (summary + outcome required) | `app.publish_blank_errors` |
| catalogue order, ordinals, totals, neighbours | `app.published_order` + `app.case_place` |
| editable-field list | `rules.EDITABLE_FIELDS` |
| sign-in lockout | `app.refused_refusals` (counts stored rows against the database clock) |
| journal business-day rule | `app.is_journal_public` / `db.auckland_today` |
| duplicate-inquiry window | `api_create_inquiry` (advisory lock on `hashtext(email + message)`) |

## Time and concurrency

- All clocks are the database's (`statement_timestamp()`); never a naive local time.
- `Pacific/Auckland` is the only business time zone (`AT TIME ZONE` in SQL).
- Concurrent publishes/resolves are guarded by `UPDATE ... WHERE published = FALSE` /
  `WHERE status = 'new'`; concurrent creates by the unique slug constraint.
- Concurrent identical inquiries are serialized by an advisory lock, then checked
  inside one transaction, so exactly one row lands.

## Gotchas learned here

- Jinja caches templates in production; restart the workers after template edits.
- `psycopg` needs a one-element tuple for a single `%s` parameter.
- Gunicorn sets `RAW_URI`; the percent-encoded-address 404 gate reads it (DP-14).
- Slug validation must accept digits: `str.islower()` is False for digits.
- A rotated/scaled footer causes sideways scroll; tilt a gradient instead.
- Split-word reveals must keep `color` unchanged (opacity 0.1 fails contrast audits);
  blur + translate is enough for the rise-out-of-blur effect.
- The studio editor button reads `Save draft` in create mode: keep it sentence case.

## Verification

With the server running on 4173: `python tests_api.py`, `python tests_browser.py`
(needs Playwright chromium), `python tests_a11y.py` (fetches axe-core).
Reset the database by dropping the eight tables plus `studio_flags`; the next
start re-creates the schema and seeds exactly once.

## Owner account (benchmark fixture)

`owner@example.com` / `deku-demo-pw-2026` — seeded, hashed like any password.
