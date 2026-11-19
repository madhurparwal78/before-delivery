# Wardhouse Lockset — repository notes

Lockset is the Brannock & Lyle key-custody file drawer: a TypeScript app on Node 22 that keeps
the office's shared logins, their rules, rotations, reviews, seats and audit trail.

## Running it

`run.json` holds the only commands needed:

```
install: npm ci
build:   npm run build      # tsc -p tsconfig.server.json && vite build
serve:   node dist/server/index.js
```

The server binds `0.0.0.0:4173` (or `APP_PUBLIC_PORT`) and serves the API plus the built client
from `dist/client`. `GET /api/health` answers once the Postgres schema is applied, whatever the
state of Keycloak, Kill Bill or the breach feed.

## Layout

```
src/server/
  officeTime.ts     America/Chicago, the DST rule, business days, every published date format
  clock.ts          the server clock (LOCKSET_CLOCK_START shifts it)
  http.ts           the router, the one request pipeline and the published error precedence
  fields.ts         the one check of a write body against its endpoint's published keys
  errors.ts         the one published error shape
  copy.ts           published copy the server sends
  audit.ts          append-only entries with a commit-ordered seq, and keyset paging
  auth.ts           sessions, the two 401s, the sign-in lockout
  events.ts         the server-sent event hub
  domain/           visibility, rules, turns, reviews, seats, imports, landing, health
  routes/           one file per group of published endpoints
  seed.ts           the first-start seed; ensureSeededUsers/Seats retry without a restart
  scheduler.ts      every timed transition, swept once a second
src/client/
  App.tsx           routing and the two 401 outcomes
  components/       one file per published screen
  styles.css        the teal-on-paper filing-drawer look
```

## Rules worth remembering

- Each domain rule lives in exactly one place. Office-time conversion and the DST rule are in
  `officeTime.ts`; rule-in-force resolution in `domain/rules.ts`; visibility in
  `domain/visibility.ts`; import reading, row checks and matching in `domain/imports.ts`;
  the landing-route choice in `domain/landing.ts`; audit paging in `audit.ts`.
- `date` columns are read back as plain `YYYY-MM-DD` strings (a `pg` type parser in `db.ts`),
  so no office date is ever shifted by the process time zone.
- Audit `seq` comes from a single counter row updated inside the writing transaction, which is
  what makes a higher `seq` mean "committed later".
- Secrets are sealed with AES-256-GCM in `secretStore.ts` and appear only in reveal and copy
  responses. SHA-1 hashes are computed in memory; only the five-character prefix is ever sent.

## Service notes learned the hard way

- Kill Bill's `GET /1.0/kb/bundles?externalKey=` cannot see a cancelled bundle, so seats are
  always looked up through the office account's bundle list. That also keeps every figure to
  the one account whose external key is `OFFICE_KEY`.
- A seat purchase sends only `bundleExternalKey`, never a subscription `externalKey`, so a
  retired key never blocks a later bundle.
- The Kill Bill catalog lists plans under `products[].plans[]`; re-uploading an identical
  catalog version is refused, so the plan check has to read that path.
- Keycloak's service account here can manage users but cannot list clients; that is expected.
- WireMock already serves the baseline breach feed; no stubs need uploading.

## Checking a change

```
npm run typecheck
npm run build
node dist/server/index.js
```

To replay a timed event, start the server with a shifted clock, for example
`LOCKSET_CLOCK_START="2026-12-31T23:58:30-06:00"`, after dropping the schema so the seed runs
again. Reset with `drop schema public cascade; create schema public;` and restart.
