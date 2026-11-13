# Elevens

A fantasy football game for one ten-club national league, played over 36
gameweeks. The server decides every rule; the browser renders the server's
results and never recomputes them.

## Running it

```
npm ci
npm run build
npm run start      # binds 0.0.0.0 on APP_PUBLIC_PORT, or 4173
```

`GET /api/health` answers as soon as the server is serving, even while MinIO or
PocketBase is unreachable. The run manifest is `run.json`.

Environment read at start: `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`,
`S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`,
`APP_PUBLIC_PORT`. Nothing is hard-coded and nothing reaches the browser.

## Shape of the source

```
src/shared/      types, published copy, money in whole tenths, league time
src/server/
  config.ts      every environment value, read once
  db.ts          pg pool, transactions, advisory locks
  schema.sql     the whole schema, applied idempotently at boot
  bootstrap.ts   schema, seed data, PocketBase collection, operator account
  domain/        the rules, each decided in exactly one place
  game/          the rules joined to Postgres, MinIO, PocketBase and the socket
  services/      PocketBase, MinIO (hand-rolled SigV4), the WebSocket registry
  http/          error shape, request boundary, router, idempotency
  routes/        one file per area, plus the route table in routes/index.ts
src/client/
  state.tsx      session, gameweek, squad, draft, notices and the live socket
  live.tsx       the named polite live regions
  components/    pitch, ledger rail, standings, dialogs, the points relay
  screens/       one file per screen
```

### Where each rule lives

| Rule | File |
|---|---|
| Squad rules | `server/domain/squadRules.ts` |
| Shape, captain and armband rules, default lineup, eleven order | `server/domain/lineup.ts` |
| Selling price, budget, formatting | `shared/money.ts` |
| Free transfers and hits | `server/domain/hits.ts` |
| Scoring table and team multipliers | `server/domain/scoring.ts` |
| Auto-subs and the captain fallback | `server/domain/autosubs.ts` |
| Chip refusals and chip states | `server/domain/chips.ts` |
| Standings order | `server/domain/standings.ts` |
| Gameweek states and the deadline | `server/game/gameweeks.ts` |
| Seed data | `server/domain/seed.ts` |

### Things worth knowing

* Money is whole tenths of a million everywhere (`*_tenths`), formatted only at
  display by `formatMillions`.
* A gameweek's **effective status** (`game/gameweeks.ts`) is what the server
  stands behind at this instant, even before the 250 ms ticker commits the
  change. Every manager write and every price run checks it.
* The deadline lock runs in one transaction, takes `for update` on each squad so
  a change accepted a moment earlier is wholly inside the locked team, then
  queues snapshots and notices. Snapshot writes and PocketBase writes catch up
  from Postgres, so an outage never blocks the lock.
* Free transfers come from the **latest** `manager_gameweeks` row, which is how a
  deadline's addition shows up at once while the gameweek is still locked.
* The browser never decides the gameweek status. The server pushes it over one
  same-origin WebSocket at `/live`; that path is not part of the public API.
* The points relay lives in `client/components/relay.ts`. Four stages, strictly
  in order, always ending on the server's values; reduced motion takes the same
  final values with a static badge.

## Checking a change

There is no test runner in the repository. The flows were verified against the
live services with throwaway scripts: sign-up, squad rules, picks, transfers with
hits and idempotency, chips including the Free Hit revert, the deadline lock,
snapshots and receipts, match events and scoring, close with auto-subs, price
runs, mini leagues, the request boundary, and the three viewports in Chromium.
Re-create them under `/tmp` rather than committing them, and remember that a
lock test has to wait for a real deadline (publish fixtures about 91 minutes
out, which puts the deadline a minute away).
