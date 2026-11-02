# Relayo repository notes

Python ASGI app serving the Relayo marketing site, the partner application intake and the
reviewer queue. PostgreSQL, Keycloak and Mailpit are the only backing services.

## Layout

- `server/app.py` — ASGI entry, routing for pages, `/static`, `/media` and `/api`, start-up
  schema and seeding, the private no-store rule.
- `server/api.py` — the published API surface and the one check order every endpoint follows.
- `server/validation.py`, `server/textrules.py` — field limits, option lists, the counting rule
  and the unsupported-character rule.
- `server/applications.py`, `server/idempotency.py`, `server/signin.py` — single-winner work:
  one applicant per work email, one processing per Idempotency-Key, one decision, the sign-in
  failure limit.
- `server/content.py` — publication moment, list order, cursors, list tags, media lookups.
- `server/emails.py` — recording, wording, the recipient display name and delivery with backoff.
- `server/replydue.py` — 16 Europe/Berlin business hours and the holiday list.
- `server/auth.py` + `server/staff.py` — Keycloak sign-in, introspection, role checks, sign-out,
  seeding, and tokens that stay dead after their account was disabled.
- `server/pages.py` + `server/templates/` + `server/static/` — server-rendered pages and the
  scripts for lists, the partner form and the reviewer page.

## Conventions worth keeping

- Each domain rule lives in exactly one module and is reused everywhere.
- Every error answer is built through `server/errors.py`.
- The display name travels as RFC 2047 encoded words inside a quoted string; Mailpit decodes a
  parsed name exactly once, so this is the form that round-trips applicant text.
- Page data reaches the browser through `#page-data`, escaped by `pages._json_block`.
- Run the server with `.venv/bin/python -m server`; it listens on `APP_PUBLIC_PORT` or 4173.
