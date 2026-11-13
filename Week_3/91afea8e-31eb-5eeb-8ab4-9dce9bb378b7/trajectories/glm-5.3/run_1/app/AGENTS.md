# Chauraha Bazaar — agent notes

Multi-seller marketplace on five backing services. TypeScript throughout; the only
JavaScript is build output and the small `scripts/*.mjs` tool configuration.

## Layout

- `src/server/` — the app: one origin serving pages and `/api`.
  - `main.ts` — HTTP pipeline with the one published error-precedence order, static
    serving, and the deny-list for source/env/manifest paths.
  - `api_catalog.ts`, `api_auth.ts`, `api_cart.ts`, `api_orders.ts`,
    `api_seller.ts`, `api_support.ts` — route modules, one per area.
  - `domain.ts` — every domain decision in exactly one place: unit price, delivery
    promise, EMI plans, offer ranking, settlement arithmetic, prorated refunds.
  - `quote.ts` — the single cart→quote engine (lines, parcels, tax split, COD).
  - `killbill.ts` — payment of record. Purchases are recorded as an external-charge
    invoice + commit + `externalPayment=true` purchase; refunds via
    `/payments/{id}/refunds`. Account lookup uses `/accounts/search/{key}` — the
    `byExternalKey` GET path 404s on this Kill Bill build.
  - `errors.ts` — every published copy, character for character, plus the one error
    shape builder.
- `src/client/` — browser app (no framework; DOM modules compiled by `scripts/build-client.mjs`).
- `public/assets/` — stylesheet, bundled Lucide icons, WOFF2 fonts.
- `scripts/` — build tooling (`build.mjs`, `build-client.mjs`, `icons.mjs`,
  `notices.mjs`) and `e2e.mjs` (Playwright journeys). `crackcode.mjs` is a local test
  helper that recovers the OTP from the DB; never ship logic from it into the app.

## Conventions that matter

- Money is integer paise in `*_paise` fields. Rounding is half-up, once, at the end
  of each value's calculation (`money.ts`).
- Postgres `date` columns arrive as `Date`; use `dateOnly()` before publishing.
- API error precedence: body size → foreign Origin → rate limit → signed out →
  role → idempotent replay → ownership 404 → state conflict → validation.
- `pending_signins` and `sessions` deliberately carry no FK to `shoppers`: sellers
  sign in with ids from the `sellers` table on the same session rules.
- Cookies: `chauraha_pending` (10 min), `chauraha_session`, `chauraha_access` —
  all HttpOnly, SameSite=Lax, Path=/.

## Local verification

```bash
npm ci && npm run build && npm run start   # serves 0.0.0.0:4173
node scripts/e2e.mjs                        # 20 browser checks
node scripts/notices.mjs                    # regenerates THIRD_PARTY_NOTICES.md
```

Provider credentials come from the environment; nothing is hard-coded. With Kill
Bill, MinIO, Meilisearch or WireMock down, the app still boots and each feature
shows its published outage behaviour.
