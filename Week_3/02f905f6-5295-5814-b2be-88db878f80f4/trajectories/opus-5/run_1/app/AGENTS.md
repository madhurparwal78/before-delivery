# Shelfmark — repository notes

Shelfmark is the firing desk for Brickfield Lane Clayhouse: greenware intake,
shelf-by-shelf kiln packing, the cool-down clock, pickup and shelf-damage
settlement. Node 22 + TypeScript, Postgres and MinIO for state, Kill Bill for
money, Mailpit for email.

## Layout

```
run.json                 install / build / serve commands (the only entry point)
src/shared/              types, labels and the placement rules the browser and
                         server both decide with (one rule, one place)
src/server/env.ts        every service URL and credential, read from the environment
src/server/db/           pool, schema SQL and the idempotent seed
src/server/domain/       measuring, fee arithmetic, schedule, load fill, statuses
src/server/repo/         SQL for users, catalog, pieces, firings, photos, damage, outbox
src/server/services/     MinIO, Kill Bill, SMTP (hand-rolled), messages, accounts
src/server/flows/        intake (photo → charge → receipt), unload, pickup clock
src/server/http/         router with the error precedence, idempotency store, errors
src/server/routes/       one module per area, each exporting `Route[]`
src/web/                 React app: screens/, components/, api.ts, styles.css
scripts/notices.mjs      regenerates THIRD_PARTY_NOTICES.md
scripts/dev-restart.sh   restarts a normal instance (4173) and a fast-clock one (4174)
```

## Where each rule lives

| Rule | File |
| --- | --- |
| Rounding sides, plate floor, size limits, cubic inches | `src/server/domain/measure.ts` |
| Fee arithmetic with its single rounding step, rate-set validation | `src/server/domain/fee.ts` |
| Footprint geometry and the seven placement checks, in order | `src/shared/placement.ts` |
| Layer height and fill percent | `src/server/domain/load.ts` |
| Firing hours, schedule, the cool-down decision | `src/server/domain/schedule.ts` |
| Piece status machine and what unloading does | `src/server/domain/pieceStatus.ts` |
| Status labels, cone order, cone glyph posture | `src/shared/labels.ts` |
| Error shape and precedence | `src/server/http/errors.ts`, `src/server/http/router.ts` |

Sizes are held in half-inch units and geometry in quarter-inch units, so every
coordinate, radius and distance is a whole number. Money is integer cents; fees
are worked out with `BigInt` and rounded once, half-up.

## Running and testing

```
npm ci && npm run build && npm start          # serves on APP_PUBLIC_PORT or 4173
./scripts/dev-restart.sh                      # 4173 normal, 4174 with 1 s studio hours
node scripts/notices.mjs                      # after any dependency change
npx tsc --noEmit                              # required to pass
```

A second instance with `FIRING_HOUR_SECONDS=1 PICKUP_DAY_SECONDS=1` makes the
cool-down and pickup clocks observable in seconds. Instances sharing
`DATABASE_URL` and `S3_BUCKET` share all state.

Postgres can be emptied for a fresh-seed check by dropping the app tables and
`piece_number_seq`; the seed and schema are re-applied at every serve behind an
advisory lock. Kill Bill accounts outlive a Postgres reset, so balances carry
over between runs — assert on changes, not absolute amounts.

## Things worth remembering

* `button "Place"` is a substring of `button "Placed Piece 0402"`; the Placement
  panel and the shelf drawing are separate regions so scoped queries stay
  unambiguous.
* A tracking token dies on revoke, replace or collection; the tracking view
  carries nothing but the piece number, status and pickup shelf.
* A 5xx is never stored against an `Idempotency-Key`, so a retry runs again.
* Intake sends its receipt before the piece exists; every other email goes
  through the `outbox` table and is retried every 10 seconds.
* The browser never decides when a kiln is cool: the board only enables Unload
  after a refresh reports `unloadable`.
