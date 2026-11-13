# Malhar Key-On

A direct-retail showroom for the (invented) Malhar motorcycle brand. Riders learn
the machine in a scroll-built 3D showroom, see the live on-road price and stock for
one of four hub cities, lock a price against a real unit for about two days, book a
test ride, and choose a delivery day or wait in line for a full one. Hub hosts run
the day sheet, confirm or withdraw held units and count stock.

## Stack

- Node.js 22, TypeScript (strict), no runtime framework on the server side
  (`node:http` only). Three.js on the client for the procedurally built motorcycle.
- Postgres is the source of truth; Valkey is the shared hold ledger and live fan-out;
  Gotenberg renders Price Sheet PDFs; ntfy sends phone notices.

## Layout

- `src/server/` - the whole backend: `clock.ts` (the one app clock and every IST
  conversion), `money.ts`, `errors.ts` (the one shared error builder), `domain.ts`
  (every business rule in one place), `db.ts`, `ledger.ts`, `store.ts`, `sweep.ts`
  (the 10-second repair and due-instant sweep), `rides.ts`, `hub.ts`, `sheet.ts`,
  `notices.ts`, `api.ts` (the one router), `pages.ts`, `main.ts`, `testclock.ts`.
- `src/client/` - `core.ts` (money display, the status region, the live stream
  client, identity polling), `machine.ts` (the procedural three.js build),
  `showroom.ts` (the stage, probe and key-on), `testride.ts`, `garage.ts`,
  `hub.ts`, `auth.ts` (the shared sign-in dialog).
- `public/` - bundled client scripts, `app.css`, bundled fonts, chapter elevations.
- `scripts/build.js` - type-checks the server then bundles each page's client.

## Commands

```sh
npm ci          # install
npm run build   # tsc + esbuild bundles
npm run start   # serve on 0.0.0.0:$APP_PUBLIC_PORT (default 4173)
```

Configuration comes from the environment: `DATABASE_URL`, `VALKEY_URL`,
`VALKEY_PREFIX`, `GOTENBERG_URL`, `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`,
`SEED_RIDER_PASSWORD`, `SEED_HOST_PASSWORD`, `APP_TEST_CLOCK`. Seed passwords are
never hard-coded; when unset the seeded people exist but cannot sign in.

## Domain invariants worth remembering

- Money is integer paise everywhere; display adds Indian grouping at the edge.
- All time rules read one app clock, in IST, persisted in Postgres so both server
  copies agree. The browser's clock is never trusted for anything.
- A hold's ledger score is its expiry on the app clock, or infinity once a delivery
  day is set; no ledger key has a time to live.
- A stock count pauses lock claims only at that hub; rides, delivery days and
  releases keep working.
- The sweep is the only repair path: ghost holds, damaged keys and expired locks
  all settle there, without a restart.

## Testing notes

`APP_TEST_CLOCK=1` enables `POST /api/test/clock` and `POST /api/test/reset` for
the verifier. Smoke tests for the API live in `/tmp/smoke*.py` during development;
they are not part of the shipped app.
