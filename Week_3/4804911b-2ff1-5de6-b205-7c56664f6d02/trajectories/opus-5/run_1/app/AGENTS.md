# Interval — repository notes

Interval is the public brand site and pack-price record of Vasant Talkies Drinks. TypeScript
throughout: a Node 22 server in `src/server` and a vanilla TypeScript client in `src/client`,
both built by `scripts/build.mjs` (esbuild) into `dist`.

## Running it

```
npm ci        # install
npm run build # dist/server + dist/public
npm run serve # binds 0.0.0.0:4173, honours APP_PUBLIC_PORT
```

`GET /api/health` is the health check. Every dependency address comes from the environment
(`src/server/config.ts`); nothing is hard-coded and nothing is sent to the browser.
`INTERVAL_TEST_CLOCK=on` is the only switch that adds endpoints (`/api/test/clock`).

## Where the rules live

Each rule is decided in exactly one place, and every surface calls it:

| Rule | File |
|---|---|
| The one price decision (printed MRP, sticker, retail, story batch, counts) | `src/server/domain/price.ts` (`PriceBook`) |
| Asia/Kolkata calendar arithmetic | `src/server/domain/dates.ts` |
| Paise arithmetic, unit sale price, sugar, sticker ceiling | `src/server/domain/money.ts` |
| Publish checks, revision order, rate continuity, run-out rule, preview rows | `src/server/domain/rules.ts` |
| Delivery state from Svix attempts | `src/server/domain/delivery.ts` |
| Endpoint address rules | `src/server/domain/endpointAddress.ts` |
| Price sheet CSV | `src/server/domain/priceSheetCsv.ts` |
| Sheet parsing and row resolution | `src/server/sheets/parse.ts`, `src/server/sheets/resolve.ts` |
| Published sentences | `src/server/domain/sentences.ts`, `src/client/copy.ts` |
| Pack geometry, scrub formulas, sticker flight | `src/client/stage/geometry.ts` |

The API error shape comes only from `ApiError` in `src/server/domain/errors.ts`.

## Services

Postgres is the system of record (`src/server/db`). Work goes through a Postgres outbox
(`src/server/services/outbox.ts`) to the durable RabbitMQ queue `interval.<copyId>.work`, with
`interval.<copyId>.dead` for broken jobs; the workers are in `src/server/services/workers.ts`
and read current Postgres state, never the job body. Svix, Gotenberg, Meilisearch and MinIO are
called over their own REST APIs with short timeouts; MinIO requests are signed with a small
SigV4 implementation in `src/server/services/storage.ts`. Each provider's reachability lives in
`src/server/services/state.ts`, which every outage sentence derives from.

`copyId` is random hexadecimal written once at first seed, and it prefixes the queues, the
Meilisearch index `interval_<copyId>_packs` and every object key.

## Client notes

- `data-batch` belongs to the stage element. Client hooks must not reuse a stage attribute name:
  the batch field uses `data-batch-input` for exactly that reason.
- The pinned stage relies on `position: sticky`, so `html`/`body` use `overflow-x: clip`
  (`hidden` would make them scroll containers and break the pin).
- The sticker's tilt is applied in aspect-corrected panel coordinates so it lands as 4 degrees
  on screen.
- The home page reads the address's pack before the heavier catalogue loads, so nothing later
  overrides the latest input.

## Testing

Browser checks were run with a system Chromium via puppeteer from a scratch directory outside
the repository, so no browser tooling is a dependency here.
