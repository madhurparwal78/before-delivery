# Roam House Atelier — repository notes

One TypeScript server that renders the storefront and staff dashboard and serves the JSON API.
State lives in PostgreSQL. Storefront search runs on Meilisearch, files go to MinIO, email goes
over SMTP to Mailpit. No other datastore or service is used.

## Layout

- `src/server.ts` — boot (wait for PostgreSQL, apply schema, seed, start workers), HTTP entry,
  server-boundary checks (405, 413, 415, cross-origin) and the one error shape.
- `src/http/` — router, request context and session, body and multipart parsing, responses,
  validation helpers (`FieldErrors` keeps the first copy per field).
- `src/domain/` — one place per domain rule:
  - `rules.ts` — stock badge, save percent, cabin-fit verdict, totals, every status machine,
    windows, hold timing, card outcomes, refund shares.
  - `stock.ts` — the movement ledger (two balanced entries per movement).
  - `cart.ts`, `holds.ts`, `orders.ts`, `cases.ts`, `transitions.ts`, `discounts.ts`,
    `giftcards.ts`, `notify.ts`, `audit.ts`, `idempotency.ts`, `events.ts`.
  - `catalogue.ts` + `search-query.ts` — product documents, facet counts and the database
    fallback listing.
- `src/api/` — route handlers grouped by area. `src/views/` — server-rendered HTML.
- `client/` — browser TypeScript compiled to ES modules, served from `/assets/client/`.
- `public/styles.css` — the editorial report look (42% axis, breakpoints at 640 and 1024).

## Things that bite

- `document.body` carries `data-page` and `data-checkout-step`. Never query bare
  `[data-page]` or `[data-step]` from the client; body would match. Pagination links use
  `data-page-to`, checkout sections are matched with `main [data-step]`.
- Addresses keep literal commas: always pass `URLSearchParams.toString()` through
  `.replace(/%2C/g, ',')` before pushing history.
- Client ES modules must import with the `.js` extension (`./core.js`), otherwise the browser
  asks for an extensionless path and gets a 404.
- Reduced motion rewrites every `data-motion-ms` to `0` and `data-state` jumps to its end value.
- The live stream is a shared sequence in `counters` + `live_events`; SSE clients poll that table
  so every copy of the app streams every event.
- Order placement is one transaction: commit stock, capture payment, spend the gift card, count
  the code, create the order, then hand the mail to SMTP. The transaction commits only after the
  mail server accepts, so a mail failure answers `email_unavailable` and keeps the hold.

## Checking it

```
npm ci && npm run build && npm run start
```

`GET /api/health` answers `{"status":"ok"}` when Meilisearch and MinIO are both reachable and
`{"status":"unavailable"}` otherwise. `POST /api/grading/setup` needs `X-Grading-Token` to equal
`GRADING_TOKEN`; without it the path answers 404 like any unknown path.
