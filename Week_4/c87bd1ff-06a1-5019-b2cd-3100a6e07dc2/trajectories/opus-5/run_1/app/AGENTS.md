# Gavelhouse — repository notes

Gavelhouse is the online saleroom of Harrow & Gilt Auctioneers: a Go server
with a TypeScript browser front end, PostgreSQL as the system of record and
Keycloak for sign-in.

## Running it

```
npm ci --prefix web && go mod download      # install
npm run build --prefix web && go build -o bin/gavelhouse .   # build
bin/gavelhouse                              # serve, on APP_PUBLIC_PORT (4173)
```

`run.json` holds those three commands. The front-end build writes
`internal/httpapi/assets/`, which the Go binary embeds, so **the front end
must be built before the Go build**.

## Layout

| Path | What lives there |
|---|---|
| `main.go` | config, database wait, realm bootstrap, timed-event loop, HTTP server |
| `internal/config` | every service address, credential and duration, read at start |
| `internal/domain` | the rules with no database: increments, the price-and-leader rule, money, state machines, notice and field wording |
| `internal/saleroom` | the system of record: schema, seed, every transition, the change feed |
| `internal/keycloak` | authorization-code flow and the client's service-account admin calls |
| `internal/httpapi` | JSON API, sign-in routes, live socket, page shell and bootstrap data |
| `web/src` | the browser front end, bundled by esbuild into one script and one stylesheet |

## Rules that live in exactly one place

- **Price and leader**: `domain.Replay`. Bids, removals, closes, offers and
  statements all read a lot's standing from it and nowhere else.
- **Timed events**: `Saleroom.settle`. Lot closes (with their invoices and
  statements), offer expiries, invoice defaults and closing-soon notices. It
  runs both from the 250 ms background loop and inside every request that
  reads or bids on a lot, so no response ever reports a lot past its close as
  open.
- **Money**: `domain.Cents`, integer cents throughout. Premium, VAT and
  commission each round half up once.
- **Error shape**: `httpapi.writeError` / `httpapi.fail`.
- **Lot projections**: `internal/saleroom/lots.go`. Four exact key sets —
  public, bidder, consignor, staff. No bidder-facing projection carries a
  reserve, another bidder's maximum or a name.

## Things worth remembering

- The database server's clock is the only clock. Every transaction reads
  `now()`; the browser never decides a lot's status, price or time.
- Per-bidder serialisation uses `pg_advisory_xact_lock(hashtext(person_id))`,
  so two bids sent together are decided one at a time and the spending limit
  holds.
- The change feed is the `events` table plus `pg_notify`, so every app process
  serving the same database tells its own sockets.
- Seed people carry `sub = 'seed:<username>'` until they first sign in, when
  they are matched by username and bound to their Keycloak subject.
- The Hammer Numeral draws the outgoing digit with a `::before` pseudo-element
  (`data-from`), so the price's text always reads the server's confirmed
  figure while the digits roll.
- The not-found, not-your-desk and both sign-in pages are written by the
  server (`httpapi.staticBody`), so they are complete in the first response
  with the right status code.
- The catalogue endpoint answers with the published keys only; the page's own
  first response adds each lot's history for DP-15.

## Verifying

The browser and API suites used while building this live outside the
repository, under `/opt/verify` (`all.sh` resets the database, starts the
server with suitable durations and runs each suite). They are not shipped.
