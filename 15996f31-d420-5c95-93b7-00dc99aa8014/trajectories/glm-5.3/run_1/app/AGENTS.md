# Bloom Desk — repository notes

Swarmline Bloom Desk is an almond pollination season desk: the broker drafts
grower hive orders per orchard block, beekeepers commit and deliver truckloads,
an inspector counts frames of bees through one emailed link, and the broker
settles the orchard. PostgreSQL is the system of record; Kill Bill issues
grower invoices and records payments, Mailpit receives every email, and MinIO
stores frame photos and the signed report PDF.

## Layout

- `run.json` — install/build/serve manifest.
- `src/server/` — the Express 5 app, TypeScript, strict. `domain/` holds every
  domain rule in exactly one place (states, tier, allocation, Pacific dates);
  `api/` holds the routes, the serializers (published field lists, exactly)
  and the idempotency helper; `services/` holds the Kill Bill client, the
  SMTP outbox, MinIO storage and the dependency-free PDF writer.
- `src/client/` — the vanilla TypeScript browser app: `desk.ts` (rail, plat
  map, ledger), `dialogs.ts`, `drop.ts`, `inspect.ts`, `odometer.ts` (the
  Frame Odometer), `ui.ts` (DOM helpers, live regions, dialogs),
  `format.ts` (the one set of people-facing formats).
- `src/public/` — the HTML shell, the bundled fonts and Lucide icons.
- `scripts/notices.mjs` — regenerates `THIRD_PARTY_NOTICES.md` and refuses any
  licence outside MIT, ISC, BSD-2/3-Clause, Apache-2.0 and 0BSD.
- `tests/` — the Playwright journeys and accessibility specs, and the parallel
  commit-race check. They expect a freshly seeded app on port 4173.

## Running

```sh
npm ci            # install
npm run build     # type-check then bundle server and client into dist/
npm start         # serve on APP_PUBLIC_PORT (default 4173)
```

Every service URL and credential is read from the environment at start; the
only defaults are `APP_BASE_URL`, `INSPECTION_LINK_TTL_SECONDS` (259200) and
`FILE_URL_TTL_SECONDS` (300). The schema and seed are applied idempotently on
every serve under an advisory lock, so several instances may share one
PostgreSQL.

## Testing

`npm test` runs the domain unit checks (the published largest-remainder example
among them). With the app running on port 4173 and Mailpit reachable for the
inspection link flow, `npm run test:api` checks signing and settling
idempotency, the error precedence and the parallel commit race, and
`npm run test:e2e` walks all seven journeys and then the keyboard, drawer,
viewport and reduced-motion checks. The journeys need a freshly seeded
database (drop and recreate the schema, then restart — the seed only runs
while the database is empty), so run the journeys first and the API checks
after: those leave extra orders behind.
