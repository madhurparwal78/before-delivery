# Strongroom Ledger — repository notes

A private breach-exposure vault: holdings graded by editable rules, breaches turned into
an ordered recovery plan, and a masked read-only view for one trusted contact.
Keycloak handles every sign-in; Postgres is the only system of record, clock and
change channel.

## Layout

```
run.json                 install / build / serve (run-manifest-v1)
requirements.txt         asyncpg, starlette, uvicorn, httpx
app/
  __main__.py            serve: uvicorn on APP_PUBLIC_PORT (4173)
  web.py                 screens, sign-in routes, API mount, static files, 404s
  pages.py               server-rendered shells and the published static pages
  auth.py                /auth/login, /auth/callback, /auth/logout
  sessions.py            Caller resolution, idle expiry, return-path check, provisioning
  state.py               AppState: database, realm client, background work
  db.py                  fixed-size pool, schema install, LISTEN fan-out, notify
  schema.sql             every table and constraint
  seed.py                seeded accounts, vaults A and B
  identity.py            Keycloak: OIDC code flow, admin user/session calls
  grants.py              grant status, remaining time, scope, projections
  store.py               loading a vault view, pruning done marks
  validate.py            field checks and the published field messages
  errors.py              the one error shape and its codes
  domain/                kinds, grading, exposure, steps, masking, projection, query
  api/                   base dispatcher (error precedence) + one module per resource
  static/                css, js (screens + components), self-hosted fonts
tests/                   development checks, not part of the shipped app
```

## Decisions worth remembering

- **One computation.** `domain/exposure.compute()` produces grading, affected holdings,
  merged person-level steps, step order, score and band. Every surface calls it, so the
  previews and the stored state cannot disagree.
- **Step identity.** Steps are derived, never stored. A holding-level step is
  `h.<holding id>.<kind>.<number>`; a person-level step is `p.<vault id>.<slug>`. Only
  done marks are stored, and `store.prune_done_marks` drops any whose step has left the
  vault, in the same transaction as the write.
- **Error precedence** lives in `api/base.endpoint`: boundary, 401, access_ended, scoped
  id 404, owner_only, idempotent replay, then the handler's 409 / 503 / 422.
- **Concurrency** is enforced by the database: unique `(vault_id, company_key, data_kind)`
  for holdings, `unique(owner_account_id)` for one vault per account, the idempotency
  primary key, and a `select ... for update` on the vault row where a count or a single
  active grant has to hold (rules limit, grant create, step toggles).
- **Grant and realm.** The grant row is won inside the transaction before the realm call;
  a realm failure rolls the row back and answers 503, so a loser never touches the realm.
- **Live events** are `pg_notify` payloads of `{vault_id, type, id}` sent in the writing
  transaction. One shared listening connection fans out to in-process queues, so a
  stream holds no database resources and closing it releases everything at once.
- **The clock** is always Postgres (`now()`, `current_date`). The browser shows
  `remaining_seconds` from the server and never counts down.
- **The browser** keeps only a one-use draft in session storage (expired-session saves).

## Running

```sh
./devserver.sh          # start or restart on APP_PUBLIC_PORT, log in /tmp/server.log
./devserver.sh stop
./tests/reset.sh        # empty the database and the realm's test users, then restart
./tests/run.sh          # every check, each against a fresh seed
```

The browser checks need `npm install @playwright/test` and
`npx playwright install --with-deps chromium` inside `tests/`.

Checks: `api_check.py` (routes, validation, worked examples), `concurrency_check.py`
(races, live streams, resource release), `auth_check.py` (sign-in binding, provisioning,
return paths, scope, isolation), `outage_check.py` (realm unreachable),
`timing_check.py` (grant expiry, idle sessions; needs `GRANT_HOUR_SECONDS=1
SESSION_IDLE_SECONDS=20`), `ui.spec.js`, `ui2.spec.js`, `draft.spec.js` (needs
`SESSION_IDLE_SECONDS=20`).

## Environment

`DATABASE_URL`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`,
`AUTH_CLIENT_SECRET`, `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`, `GRANT_HOUR_SECONDS`,
`SESSION_IDLE_SECONDS`, `SIGNIN_PENDING_SECONDS`.

The realm's user profile requires a last name, so every account the app creates sets
one; without it Keycloak would stop the sign-in with a profile screen.
