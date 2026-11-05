# Turnstone Studio — Ashgrove Mesh Works

Self-hosted shop and publishing desk for one independent 3D model author. Server-rendered HTML pages with vanilla TypeScript client modules, a Node.js/PostgreSQL backend, and five providers: PostgreSQL (source of truth), MinIO (files), Kill Bill (billing), Mailpit (mail), Meilisearch (catalogue index).

## Commands

- `npm run build` — compile TypeScript (`strict`) to `dist/` and copy fonts + styles to `dist/client/`.
- `npm start` — serve on `0.0.0.0:4173` (or `APP_PUBLIC_PORT`).
- `run.json` holds the install/build/serve manifest.

## Architecture map

- `src/config.ts` — every environment value is read here at start; nothing is hard-coded.
- `src/server.ts` — HTTP kernel: route table, published error precedence, body limits, origin check, intervals for the queue ticker, index reconciler, email flusher, provider health checks and the Kill Bill plan poller (10 s).
- `src/domain/` — the single decision places:
  - `money.ts` — the one money computation (integer cents, half-up at the cent).
  - `plans.ts` — plan entitlements and prices.
  - `states.ts` — legal state moves and roles.
  - `models.ts` — visibility filter for derived surfaces (`indexedEligible`), within-plan ranking (`recomputeReadOnly`), transitions, quota cycle.
  - `commerce.ts` — checkout, edition claim (advisory lock), refunds, upgrade chain.
  - `idempotency.ts` — idempotent replay (byte-for-byte, 409 on body change).
  - `access.ts` — who may see what: public access, embeds, unlocks, media rules.
- `src/queue/runner.ts` — the five ordered stages with the retry schedule; provider outages wait and resume without a restart.
- `src/providers/` — MinIO (`storage.ts`), Meilisearch (`search.ts`), Kill Bill (`billing.ts`), Mailpit (`mail.ts`), plus availability tracking that drives banners and 503s.
- `src/geometry/` — GLB parse/build, STL (mm, Z-up), software preview rasteriser, PNG writer, ZIP/package checks.
- `src/pages/` — server-side rendering for every screen; `src/client/` — per-page client modules (no framework).
- `src/seed/seed.ts` — idempotent seed: users, plan setup, 10 named models + 40 fillers, collections, tokens, demo read key.

## Provider notes learned from this environment

- Kill Bill 0.24: tenant headers `X-Killbill-ApiKey`/`X-Killbill-ApiSecret` + basic auth + `X-Killbill-CreatedBy` on writes. External charge: `POST /invoices/charges/{accountId}?autoCommit=true` (body items need a 36-char `invoiceItemId` UUID). Payment: `POST /accounts/{id}/payments?paymentMethodId=…` with plugin `__EXTERNAL_PAYMENT__`. Plan change: `PUT /subscriptions/{id}?billingPolicy=IMMEDIATE|END_OF_TERM`. The invoice LIST endpoint shows empty items; GET each invoice by id. Catalog upload: `POST /catalog/xml` with `Content-Type: text/xml`.
- Meilisearch: facet distributions must request the document attribute name (`licences`, `formats`), not the query-param name (`licence`, `format`).
- Postgres: `pg_advisory_xact_lock(modelId)` serialises edition claims.

## Conventions

- Every API error goes through `ApiError` in `src/errors.ts` — the published shape with English copy.
- No `any`, no ignored type errors, no dead code. Nothing is built beyond the brief.
- Tests during development used Playwright (installed at /tmp, not a project dependency).
