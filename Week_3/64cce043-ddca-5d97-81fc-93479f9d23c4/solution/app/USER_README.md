# Hollowmere Strongroom Ledger

A private vault for one person. The owner records which companies hold which kinds of their personal data,
grades every holding with grading rules they edit and order, and logs breaches by the kinds of data exposed.
The server works out the exposure score, its band, the affected holdings and an ordered list of next steps,
counting person-level steps (such as a credit-bureau fraud alert) once. The owner can give one trusted contact
a masked, read-only view, limited to chosen levels, that ends at a time the server sets.

## Run it

Commands come from `run.json` (run them from this directory):

| Step | Command |
|---|---|
| install | `python3 -m venv .venv && .venv/bin/python -m pip install --no-cache-dir -r requirements.txt` |
| build | `.venv/bin/python -m compileall -q strongroom` |
| serve | `.venv/bin/python -m strongroom` |

`serve` binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173), creates the schema and seed in Postgres at start
(safe to repeat), and answers `GET /api/health` with `{"status":"ok"}` once the database is reachable, or 503
`{"status":"starting"}` while it retries every 2 seconds. It starts normally when Keycloak is unreachable.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | The Postgres database: system of record, the clock for grants, dates and idle sessions, and the `strongroom_events` notification channel. Every connection is named `strongroom`. |
| `KEYCLOAK_URL` | The Keycloak server, for the token endpoint and the admin API (users, credentials, sessions). |
| `KEYCLOAK_REALM` | The realm everyone signs in to. |
| `AUTH_ISSUER_URL` | The realm's issuer; the browser is sent to its authorization endpoint. |
| `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | The confidential client; its service account administers the realm's users. |
| `APP_PUBLIC_PORT` | The listening port (default 4173). |
| `APP_PUBLIC_URL` | When set, the origin used for `<origin>/auth/callback`; otherwise the request's host. |
| `GRANT_HOUR_SECONDS` | Length of one grant hour (default 3600). |
| `SESSION_IDLE_SECONDS` | Idle time after which a session ends (default 1800). |
| `SIGNIN_PENDING_SECONDS` | Lifetime of a pending sign-in (default 600). |

None of these reach the browser.

## Services

- **Keycloak**: every sign-in (authorization code flow with PKCE and a nonce), the trusted contact's account
  (created with a one-time temporary password), password changes, and ending realm sessions on revoke, narrow
  and password change. The app never changes the realm's settings, clients or roles.
- **Postgres**: accounts' vaults, sessions, pending sign-ins, holdings, rules, breaches, done marks,
  idempotency keys and grants; live change events travel as `pg_notify` on `strongroom_events`.

## Seeded accounts

| Email | Password | Role |
|---|---|---|
| `ada.marsh@example.com` | `Strongroom-Owner-1` | owner of vault A |
| `teodor.vance@example.com` | `Strongroom-Owner-2` | owner of vault B |
| `ines.marsh@example.com` | `Strongroom-Contact-1` | trusted contact of vault A |
