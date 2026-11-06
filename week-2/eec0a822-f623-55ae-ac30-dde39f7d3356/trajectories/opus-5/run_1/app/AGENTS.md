# Tidewright

An operations workspace for crewed solar-electric catamaran charters: selling weeks
(holds, deposits, invoices), planning passages within the battery reserve, keeping a
lawful crew rota, booking berths and shore power, running ship's stores, keeping the
energy log and collecting the guest manifest.

## Running it

```
npm ci      # install
npm run build   # bundles the server and the browser app into dist/
npm start       # serves on APP_PUBLIC_PORT, 4173 otherwise
```

`run.json` names those three commands. `npm run typecheck` runs `tsc --noEmit`.

Every service URL, credential and timer is read from the environment at start
(`src/server/config.ts`); none is written in the source.

## Shape of the code

```
src/shared/     code both sides use: display formats, published copy, zones,
                roles and the country list
src/server/
  config.ts     every environment variable, read once at start
  db.ts         the pg pool, query helpers and the advisory lock
  schema.ts     the schema, applied idempotently at every start
  seed.ts       the seed data, inserted once into an empty database
  auth.ts       session loading and the role gate
  records.ts    yacht, crew and workspace lookups with the crew-member limit
  sweep.ts      timed work: hold lapses and move-ups, page endings, erasure
  domain/       one module per domain rule (see below)
  routes/       one module per API area, plus the HTML page routes
  services/     Postgres-free edges: MinIO, Kill Bill, SMTP, images, passwords
  http/         the router, the one error shape and the multipart reader
src/client/
  lib/          router, dialogs and sheets, strips, forms, motion, views
  screens/      one module per published screen
src/styles/     the chart-paper stylesheet
```

## Where each domain rule lives

Each rule is decided in exactly one place:

| Rule | Module |
|---|---|
| Hold transitions, week status, the single live winner | `server/domain/holds.ts` |
| Charter pricing and its rounding | `server/domain/pricing.ts` + `money.ts` |
| Passage energy, distances and the reserve | `server/domain/passage.ts` |
| Rota slots and the four rest rules | `server/domain/rota.ts` |
| Berth fit and night fees | `server/domain/berths.ts` |
| Private page lifetime | `server/domain/pages.ts` |
| Energy log parsing | `server/domain/energy.ts` |
| Charter weeks and seasons | `server/domain/weeks.ts` |
| Roles and navigation | `shared/roles.ts` |
| Display formats | `shared/format.ts` + `shared/copy.ts` |

The planner mirrors the energy rule in `client/screens/passages.ts` so the figures move
with the sliders; the server stays the authority once a passage is saved.

## Things worth knowing

- Money is integer minor units and exact decimals end to end. `pg` returns `numeric`,
  `int8` and `date` as strings so no amount or measurement meets a float.
- Measurements are stored in whole centimetres, so berth fit compares integers.
- Every status the browser shows comes from a server decision; no client code compares
  the device clock to a server instant.
- Concurrency is settled in Postgres: `pg_advisory_xact_lock` per week, berth, slot,
  store item and rota, plus a unique partial index on the live hold of a week.
- Closed dialogs and sheets are removed from the DOM, so they are hidden and inert by
  construction. Reopening one during its exit cancels the exit timer.
- The sweep in `sweep.ts` runs every 5 seconds, inside the published 10-second window.
