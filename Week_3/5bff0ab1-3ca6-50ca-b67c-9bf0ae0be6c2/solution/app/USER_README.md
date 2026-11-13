# Malhar Key-On

A direct-retail showroom for Malhar motorcycles. A rider learns the machine in a scroll-built 3D showroom, reads the live on-road
price and stock at one of four hub cities, locks a price against a real unit for about two days, books a test ride and picks a
delivery day (or waits in line for a full one). Hub hosts count stock, confirm or withdraw held units and run the day sheet. Family
members open a shared link signed out. No money changes hands in this product.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` |
| serve | `npm run start` (Node.js 22, foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

The schema, the seed data and the ledger keys are applied idempotently every time a copy starts. Two copies can run against one
Postgres and one ledger prefix at once.

## Environment

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | source of truth: riders, sessions, locks, rides, delivery days, the app clock, sequence numbers, PDFs, notices |
| `VALKEY_URL`, `VALKEY_PREFIX` (default `malhar`) | Valkey | the hold ledger and the live fan-out; every key and channel lives under the prefix |
| `GOTENBERG_URL` | Gotenberg | Price Sheet PDFs |
| `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD` | ntfy | phone notices |
| `SEED_RIDER_PASSWORD`, `SEED_HOST_PASSWORD` | none | passwords of the seeded riders and hub hosts (unset: those people exist but cannot sign in) |
| `APP_PUBLIC_PORT` | none | listening port |
| `APP_TEST_CLOCK` | none | `1` enables `POST /api/test/clock` and `POST /api/test/reset` |

None of these reach the browser.
