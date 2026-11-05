# Opaline Bench Days

A live, two-day composite-layering masterclass: booking site, bench hold
engine, and registrar/front-desk/content-desk surfaces.

## Commands

- `npm ci` — install (the run manifest's install step).
- `npm run build` — build the client bundle into `dist/public` and transpile
  the server into `dist/server` (`scripts/build.mjs`).
- `npm run start` — serve `dist/server/main.js` on `0.0.0.0:4173`
  (or `APP_PUBLIC_PORT`).

Every service URL and credential comes from the environment (see
`src/server/config.ts`): Kill Bill, Postgres, MinIO, Mailpit, PocketBase, the
hold and offer windows, and the optional frozen venue clock
`BENCH_DAYS_NOW`.

## Architecture

- `src/server/` — the API. One express app; every error uses the one error
  shape from `errors.ts`. `ledger.ts` is the single ledger computation;
  `locks.ts` holds the advisory-lock keys shared by every app process;
  `payments.ts` and `killbill.ts` guard every money move behind
  idempotent external keys; `jobs.ts` claims all background work in the
  database (hold and offer expiry, reminders, mail queue, receipt retries).
- `src/client/` — one ES-module bundle, no framework. `lab.ts` owns the
  bench map, holds and checkout; `scene.ts` is the procedural 3D lab
  (three.js); under reduced motion or without WebGL the scene is not
  rendered and the flat labelled plan carries every interaction.
- Content lives in PocketBase (collections seeded on every serve); the
  public site reads it live on each request.

## Development scripts (not part of the shipped app)

`scripts/reset.js` truncates the local development database for the test
suites; `scripts/test-*.sh|py` cover the API journeys, outage recovery,
cross-process races, reminders and the browser screens (Playwright).
