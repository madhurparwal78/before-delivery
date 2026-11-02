# Relayo marketing site and partner program

Public marketing site for Relayo (home, five agent pages, integrations directory, resources, careers,
press room, blog), the partner application form, and the staff review queue at `/review`.

## Seeded staff accounts

| Email | Keycloak realm role | Password |
|---|---|---|
| `reviewer@example.com` | `partner-reviewer` | `deku-demo-pw-2026` |
| `analyst@example.com` | none | `deku-demo-pw-2026` |

The password is benchmark fixture data. The app creates both accounts (and the role) on start if they are
missing, gives the reviewer the role and keeps it off the analyst.

## Running

`run.json` holds the three commands, run from this directory:

- install: `python3 -m venv .venv && .venv/bin/python -m pip install --no-cache-dir -r requirements.txt`
- build: `.venv/bin/python -m compileall -q relayo`
- serve: `.venv/bin/gunicorn --config gunicorn.conf.py relayo.app:application` (production server, one
  process with 32 threads, listening on `0.0.0.0:$APP_PUBLIC_PORT`, default 4173)

`GET /api/health` answers 503 `{"status":"starting"}` until the schema, the seeded corpus and the two
accounts are in place, then 200 `{"status":"ok"}`. Unreachable PostgreSQL or Keycloak at boot is retried
every 3 seconds. The outbound-email deliverer runs inside the served process.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | every record: applications, outbound emails, sign-in failures, Idempotency-Keys, ended sessions, public content | PostgreSQL |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM` | admin API: seeding, live role mappings, ending the signed-out session | Keycloak |
| `AUTH_ISSUER_URL` | token and introspection endpoints | Keycloak |
| `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | the confidential `app` client and its service account | Keycloak |
| `SMTP_HOST`, `SMTP_PORT` | email delivery | Mailpit |
| `MAIL_FROM` | sender of every email | Mailpit |
| `APP_PUBLIC_PORT` | listening port (default 4173) | — |
| `IDEMPOTENCY_KEY_TTL_SECONDS` | Idempotency-Key lifetime (default 86400) | PostgreSQL clock |
| `LOGIN_FAILURE_WINDOW_SECONDS` | sign-in failure window (default 300) | PostgreSQL clock |

No credential reaches the browser.

## Layout

- `relayo/app.py` WSGI entry; `relayo/api.py` the published API surface; `relayo/pages.py` pages and media files
- `relayo/validation.py` limits, counting rule, unsupported characters, option lists
- `relayo/applications.py`, `relayo/idempotency.py`, `relayo/reply_due.py`, `relayo/outbound.py`
- `relayo/keycloak.py` staff token and role checks, sign-out, seeding; `relayo/sign_in.py` sign-in failure limit
- `relayo/public.py` publication moment, list order, cursors, list tags; `relayo/media.py` icons and covers
- `relayo/templates/`, `relayo/static/` (one stylesheet, one script, self-hosted fonts, original SVG art)
