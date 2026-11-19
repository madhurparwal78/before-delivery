# Lockset Custody Desk

Lockset is where a small professional office keeps the logins its staff share. Each vault holds the logins for
one area of work; every reveal and edit goes into an append-only audit trail. Joiners, movers and leavers are
handled here (a leaver loses sign-in at once), shared logins can have a rotation worked out in the office's own
time zone (America/Chicago), security rules take force at a future office midnight, and billing changes only
when Kill Bill confirms them. The first office is Brannock & Lyle, an invented accounting practice in Omaha.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, bundles the server to `dist/server.js` and the client to `dist/public`) |
| serve | `node dist/server.js` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

The app applies its Postgres schema on every start and seeds the Brannock & Lyle office on the first start with an
empty database. Keycloak, Kill Bill and the breach feed may be down at boot; each is picked up when it answers.
`GET /api/health` answers `{"status":"ok"}` once the schema is applied.

## Environment

| Variable | Default | Talks to |
|---|---|---|
| `DATABASE_URL` | required | Postgres, the only datastore |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | required | Keycloak (staff sign-in; users are administered through the `app` client's service account) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | required | Kill Bill (per-seat annual subscription on this office's account) |
| `WIREMOCK_URL` | required | the breach-exposure feed (only five-character SHA-1 prefixes are sent) |
| `OFFICE_KEY` | `bl` | prefix of this office's Keycloak users and Kill Bill account (2 to 8 lowercase letters) |
| `LOCKSET_SECRET_KEY` | derived from `AUTH_CLIENT_SECRET` | 64 hex characters; encrypts login secrets at rest |
| `LOCKSET_CLOCK_START` | real time | ISO 8601 instant the server clock starts from, then runs forward in real time |
| `REVEAL_SESSION_SECONDS` | `28800` | reveal session limit (also ends at the next 19:00 office time) |
| `BREACH_CHECK_SECONDS` | `60` | interval between breach checks |
| `SIGN_IN_LOCK_SECONDS` | `900` | sign-in lockout window and duration |
| `APP_PUBLIC_PORT` | `4173` | listen port |

## Sign in

Seeded people share the password `KeysKept-2026`: `marta` (office manager), `graham` (managing partner),
`deandra`, `desmond`, `theo`, `sam`, `samantha` (staff accountants) and `priya` (outside bookkeeper).
