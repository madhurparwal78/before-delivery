# Quire

A personal commonplace workspace. One owner, one workspace, three devices.

## Build and run

- `run.json` drives the install/build/serve cycle: `npm ci`, `npm run build`,
  `node dist/server/main.js`.
- The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173).
- Everything durable lives in PostgreSQL (`DATABASE_URL`) and MinIO
  (`S3_*`); the schema and the seed workspace apply idempotently at boot.
- Never change the provided PostgreSQL/MinIO dev service configuration.

## Layout

- `src/shared/` — the domain rules shared by the server and the browser:
  the rich text allowlist, edit text, op transform with its conflict cases,
  the word diff, the query language, the search ranking and the command
  score, the upload sniffing, the theme tokens, the home-clock helpers and
  the safe return address. Each of these has exactly one home here.
- `src/server/` — the API, the share surface, the live sync event log, the
  S3 client and the block engine. `schema.ts` holds the DDL (kept as a
  template so the build needs no file copying).
- `src/client/` — the browser app, compiled to `dist/public/assets` with
  `tsconfig.client.json`. Static shells and styles live in `public/`.
- `tests/` — development suites, not shipped: shared-module unit tests
  (`npm run test:shared`), the API smoke test, browser suites (Playwright)
  and the lockout/outage tests. `tests/run-all.sh` runs everything against
  fresh databases.

## Conventions that matter

- Every domain rule named in the brief has a single home in the source;
  callers import that home instead of re-implementing.
- Block edits are op lists against a base version; the server merges in
  commit order and refuses only the published conflict cases, and the
  browser rebases incoming events with the same shared transform.
- Backlink counts come from the stored link edges only; the count updates
  in the same transaction as the edge change.
- Today is decided by the workspace home clock, never by UTC or the device
  clock.
- Every state-changing request except sign-in carries `X-CSRF-Token`.
- Colours come only from the five theme tokens on the root element.
- All motion timings and physical constants live in
  `src/client/constants.ts`.
