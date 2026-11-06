# Rostara attendance desk — repository notes

An internal desk for fixing attendance records at Kestrel Works (invented
employer, business time `Europe/London`). Node 22, Fastify, React Router 7 in
framework mode (SSR), postgres, Keycloak.

## Layout

- `run.json` — install/build/serve manifest. `npm ci`, `npm run build`,
  `node build/server.js` (binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173).
- `src/domain/` — pure domain rules, reused by both the API and the UI loaders:
  `time.js` (business dates, claimed-time conversion, DST rules),
  `text.js` (address folding, grapheme clusters), `audit.js` (canonical
  string + hash), `csv.js` (formula neutralising + quoting), `errors.js`.
- `src/db/` — `pg.js` (pool, `run()`, transactions), `schema.sql` (all nine
  relations plus `desk_session`; rules make `audit_event` unmodifiable),
  `seed.js` (idempotent, advisory-lock guarded, one transaction).
- `src/server/` — `server.js` (Fastify: /assets/*, /api dispatch, React Router
  catch-all), `api.js`/`api2.js` (endpoint handlers in the brief's published
  order), `rules.js` (scope, window, caps, claim checks, queue query),
  `sessions.js`, `people.js`, `calendar.js`, `keycloak.js`, `readiness.js`
  (health flags, retry loop), `config.js`.
- `app/` — React Router application (root, routes, components, one stylesheet).
  Server-only data access lives in `app/lib/data.server.js`; route loaders
  import it with `await import(...)` so the client bundle never sees `pg`.

## Things that bit us

- `pg`'s node driver returns `bigint` columns as strings: convert with
  `Number(...)` before they reach JSON.
- `run(client, sql, params)` in `src/db/pg.js` returns rows for both a client
  and the pool; `query()` returns rows, `client.query()` returns a result —
  do not mix the shapes.
- Audit entry hashes are computed over the whole-second instant that postgres
  stores: truncate milliseconds before hashing and inserting.
- `claimedInstant` resolves wall-clock times in `Europe/London`; a time that
  occurs twice takes the earlier instant, and times that never occur (clocks
  forward) are refused.
- Lockout: the refusal that brings the count to five is itself a 401 and
  starts the lock; the next attempt answers 429.
- A session ended by signing out counts as no session at all (401 `Sign in to
  continue.`); expiry and deactivation answer the ended-session wording.

## Verification

- `scripts/api-test.mjs` (87 checks) and `scripts/rule-test.mjs` (35 checks)
  run against a freshly seeded database; they mutate it, so reset
  (`DROP SCHEMA public CASCADE; CREATE SCHEMA public`) and restart the desk
  first. `scripts/restart.sh` restarts the built server.
- Seeded password for every account: `deku-demo-pw-2026` (see USER_README.md).
