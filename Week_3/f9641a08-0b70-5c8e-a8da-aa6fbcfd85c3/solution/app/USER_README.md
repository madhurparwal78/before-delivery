# Roam House Atelier

The online store and operations dashboard for Roam House, an independent maker of suitcases, backpacks, totes, wallets
and small travel goods. One TypeScript server serves the storefront, the staff area at `/admin` and the JSON API.

## What it does

- Shoppers browse the collections, filter and sort them (the address holds the state), compare up to three bags,
  check whether a carry-on fits an airline's cabin frame in the Gate Gauge, hold and buy, follow delivery, cancel,
  return or exchange, send a bag back from its travel trial and claim warranty with photo evidence.
- Operations managers run the catalogue, stock, images, promotions, gift card ledgers and fulfilment, and read the
  dashboard figures and CSV exports. Support agents decide returns, exchanges, trial returns and warranty claims.
- Holds, windows, refunds and claim status are decided on the server and shown the same way in every session.

## Run it

`run.json` holds the three commands the host runs from this folder:

```
install: npm ci
build:   npm run build      (type-checks, builds the browser app, bundles the server into dist/server.cjs)
serve:   npm run start      (node dist/server.cjs, foreground, 0.0.0.0 on APP_PUBLIC_PORT, default 4173)
```

The server waits up to 60 seconds for PostgreSQL, applies its schema and seed data (safe to repeat and safe from two
copies at once) and starts. If Meilisearch, MinIO or the mail server is unreachable it still starts: browsing falls
back to a database listing, uploads answer `storage_unavailable`, and email waits and is retried.

## Environment

| Variable | Service or use |
|---|---|
| `DATABASE_URL` | PostgreSQL: every record, the stock ledger, holds, the gift card ledger, the live-event sequence |
| `MEILISEARCH_URL`, `MEILISEARCH_API_KEY` | Meilisearch: the `products` index (search, suggestions, filter counts) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: product images and warranty evidence |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit SMTP: customer email |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | Listen port and the site's own origin (writes from any other origin are refused) |
| `GRADING_TOKEN` | When set, enables `POST /api/grading/setup` (header `X-Grading-Token`); when unset the route does not exist |
| `RESERVATION_TTL_SECONDS` (600), `RETURN_WINDOW_DAYS` (30), `TRIAL_WINDOW_DAYS` (30) | Hold length and the return and trial windows |
| `WARRANTY_YEARS_LUGGAGE` (3), `WARRANTY_YEARS_BAGS` (2), `WARRANTY_YEARS_ACCESSORIES` (1) | Warranty cover |
| `LOW_STOCK_THRESHOLD` (3), `TAX_RATE_PERCENT` (18), `FREE_SHIPPING_MINIMUM` (5000) | Stock badge, tax and free shipping |
| `UPLOAD_MAX_BYTES` (5000000), `COMPARE_MAX` (3), `PAGE_SIZE` (12) | Upload limit, comparison size, results per page |
| `CART_UNDO_SECONDS` (6), `TOAST_SECONDS` (5) | Page timers, delivered through `GET /api/config` |

Nothing else is read from the environment; no credential is logged or sent to the browser.

## Layout of the source

- `src/server`: the HTTP layer (`http.ts`, `routes.ts`), one module per rule or service (`totals.ts`, `fit.ts`, `stock.ts`,
  `machines.ts`, `windows.ts`, `idempotency.ts`, `live.ts`, `search.ts`, `indexer.ts`, `storage.ts`, `mail.ts`) and `schema.sql`.
- `src/web`: the React app (pages, components, `styles`), `src/shared`: the wire types and display formatting both sides use.
- `public/fonts`: the self-hosted Schibsted Grotesk variable font (SIL OFL 1.1). Nothing is loaded from another origin.

## Seeded accounts

| Name | Email | Role |
|---|---|---|
| Asha Menon | asha@roamhouse.example | customer |
| Dev Raman | dev@roamhouse.example | customer |
| Priya Kulkarni | ops@roamhouse.example | operations |
| Tomas Ferreira | support@roamhouse.example | support |
