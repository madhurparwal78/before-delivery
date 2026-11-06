# Clearhouse

Clearhouse is the Fenwick Science Centre's clearance desk. Makers draft small interactive exhibit
pieces from cut-out objects in a 20000-object catalogue; a licence reviewer and a different
accessibility reviewer check each piece; a clearance lead clears it against the quarter budget,
books it onto one day, publishes it and can withdraw it; an auditor reads everything and exports
the audit trail. Visitors see published pieces on the public wall (`/wall`) and each piece's plaque.

## Seeded accounts

Every account signs in with the passphrase `deku-demo-pw-2026`.

| Email | Name | Role |
|---|---|---|
| `rosa.aldridge@example.com` | Rosa Aldridge | maker |
| `tobias.lund@example.com` | Tobias Lund | maker |
| `priya.raman@example.com` | Priya Raman | licence_reviewer |
| `dan.whitlock@example.com` | Dan Whitlock | access_reviewer |
| `halima.osei@example.com` | Halima Osei | lead |
| `gregor.pyne@example.com` | Gregor Pyne | auditor |

## Running it

The commands are in `run.json`:

- install: `python3 -m venv .venv && .venv/bin/pip install … -r requirements.txt` (every production
  package is pinned in `requirements.txt`);
- build: none;
- serve: `.venv/bin/gunicorn -c gunicorn.conf.py`, a production server in the foreground on
  `0.0.0.0:$APP_PUBLIC_PORT` (default 4173).

On every start the app waits for postgres, creates its tables if missing and runs its seed, which
only inserts rows whose natural key is absent. `GET /api/health` answers once that is done.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | the `postgres` database, the only datastore (pieces, reviews, sessions, lockout counts, preferences, audit trail) |
| `AUTH_ISSUER_URL` (or `KEYCLOAK_URL` + `KEYCLOAK_REALM`) | the Keycloak realm that holds staff identities |
| `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | the confidential client used for the server-side password exchange |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | where the app listens, and the return address used when registering seeded accounts |
| `LOGIN_LOCKOUT_SECONDS` | optional lockout window, default 900 |

## Services

- **Postgres** is the system of record.
- **Keycloak**: sign-in exchanges the email and passphrase with the realm server-side and the app
  issues its own opaque session (stored hashed in postgres, sent as an HTTP-only cookie or a bearer
  token). The realm starts empty; on the first successful contact after start, and after any outage,
  the app registers any missing seeded account through the realm's own self-registration form. While
  Keycloak is unreachable the app keeps serving, health reports `"identity": "down"` and sign-in
  answers 503 without counting toward lockout.
