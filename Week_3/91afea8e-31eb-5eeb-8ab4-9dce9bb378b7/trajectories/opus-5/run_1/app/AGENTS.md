# Chauraha Bazaar — working notes

A multi-seller marketplace. One cart becomes one shipment per seller. Every rupee, unit,
pincode and promise date is decided on the server and shown the same way to shopper, seller
and support agent.

## Shape of the repository

```
run.json                 install / build / serve manifest
assets/lexend.ttf        font embedded in generated PDFs
public/fonts/*.woff2     bundled web fonts
src/shared/              copy, wire types, money and date formatting (used by both sides)
src/server/
  main.ts                http server: pages, /api, /art, /photos, background passes
  config.ts              every env variable, read once
  schema.ts, seed.ts     schema and seed, applied idempotently on each serve
  db.ts                  pool, transaction, advisory locks
  http/                  router (error precedence), errors, rate limits, validation
  domain/                money, tax, coupon, promise, cod, emi, settlement, transitions, offers
  quote.ts               the one cart quote computation
  payments.ts            legs, refund routing, provider polling, settlement postings
  documents.ts           invoice and label PDFs, written once
  repo.ts, views.ts      shared reads and the shipment projections
  services/              killbill, storage (SigV4), search (meilisearch), provider (wiremock), pdf
  api/                   route modules, one per area
src/web/                 React SPA: router, state, pages, components, effects
```

## Decisions worth remembering

- **One place per rule.** The tax split, coupon allocation, delivery promise, COD eligibility,
  EMI plan, settlement line and each state transition each live in exactly one module under
  `src/server/domain/`. The cart, checkout, invoice and statement all read from `quote.ts`
  or those modules; nothing recomputes money on its own.
- **Error precedence** is enforced once in `src/server/http/router.ts` (`dispatchApi`):
  413 → 403 cross-site → 429 → 401 → 403 role → idempotent replay → 404 → 409 → 422.
- **Published copy** lives only in `src/shared/messages.ts`; the server builds error bodies
  from it and the browser renders the same strings.
- **Money** is integer paise everywhere. `roundDiv` is half-up and applied once per value.
- **Sessions**: `chauraha_pending` (password step), `chauraha_session` (refresh) and
  `chauraha_access` (short lived). All HttpOnly, SameSite=Lax, Path=/. The pending cookie
  reaches only the verify and resend routes.
- **Idempotency** records live in Postgres, including stored failures, so replays answer the
  same thing. Stock is claimed with one conditional decrement inside the checkout
  transaction, so exactly as many concurrent checkouts succeed as there are units.
- **Providers**: Kill Bill records one PURCHASE per leg (external key `<order id>-<leg>`),
  MinIO stores documents under `invoices/`, `labels/`, `listings/`, `sellers/`, Meilisearch
  indexes live listings, and WireMock stands in for SMS, UPI and net banking. Every outage
  has a published behaviour; background passes every 5 seconds catch up, coordinated by
  Postgres advisory locks.
- **Search** uses one `multi-search` call: the hit page plus one query per facet group with
  that group's own filter removed, so facet counts cover the other filters. Keyset cursors
  page everything except relevance-with-a-query.
- **PDFs** are produced by a small writer in `services/pdf.ts` that embeds Lexend as a
  CIDFontType2, so invoice text (including the rupee sign) is selectable and extractable.
- **Frontend**: a hand-rolled history router; `/search` keeps all state in the address bar;
  `api.ts` refreshes the access cookie once and replays on `signed_out`; the Rupee Reel keeps
  the server's total as its accessible text while the digits animate.

## Running it here

```
npm ci && npm run build && npm start      # serves 0.0.0.0:4173
curl localhost:4173/api/health            # {"status":"ok"} once the schema is applied
```

Several instances may share one Postgres: pass `APP_PUBLIC_PORT` to move the port.

## Testing tips found useful

- Sign-in codes go to WireMock, whose admin API is closed here. For local end-to-end tests,
  read `auth_codes.code_hash` and look the 6-digit code up in a precomputed SHA-256 table.
- `DELETE FROM code_sends` between scripted sign-ins, or the three-sends-per-window limit
  (correctly) answers 429 `too_many_codes`.
- Outage behaviour is easiest to exercise by starting a second instance with a dead URL, for
  example `MEILISEARCH_URL=http://127.0.0.1:9 APP_PUBLIC_PORT=4174 node dist/server/main.js`.
