# Bellroll — agent notes

Keel & Bell Music's rent-to-own school instrument rental app (Bellroll).
Node.js 22 + TypeScript, PostgreSQL, Kill Bill, MinIO (S3), Mailpit (SMTP).
The browser animates with the Motion library and draws the contract sheet's
instrument model with three.js.

## Layout

- `run.json` — install / build / serve manifest (`npm ci`, `npm run build`,
  `npm run start`).
- `src/server` — the API server: config, one server clock (`clock.ts`), the
  time-zone helpers (`tz.ts`), the schema and seed (`schema.ts`, `seed.ts`),
  domain rules (`domain/`), service clients (`services/`), and the API
  routes (`api/`). `src/server/main.ts` is the entry point.
- `src/client` — the SPA: router (`router.ts`), API client with the server
  clock estimate (`api.ts`), screens (`screens/`), the Buyout Rail and the
  three.js instrument model (`components/`), dialog and motion helpers
  (`ui/`).
- `public/fonts` — bundled fonts (Fraunces, IBM Plex Sans / Condensed / Mono),
  referenced from `src/client/styles.css` and emitted into `dist/client` by
  esbuild.
- `dist` — generated build output (never edit).

## Key invariants

- All money is integer cents; the one rounding rule (half up) lives in
  `src/server/domain/money.ts` (`roundDiv`).
- Every server time rule reads the one clock (`src/server/clock.ts`);
  `BELLROLL_CLOCK_START` pins it. Store time zone: America/Chicago.
- Contract IDs come from the `contract_id_seq` sequence (C-1004, C-1005, …).
- Money actions run inside one transaction per contract, guarded by a
  Postgres advisory lock; idempotency rows commit with the action, and 503
  answers roll the marker back.
- Kill Bill accounts and subscriptions are always looked up by external key
  first (`<contract id>`, `<contract id>-rental`) and reused; charges and
  refunds are looked up by transaction external key first (adoption).
- Signing links: only the newest token works; used links answer 410
  `link_used`, expired ones 410 `link_expired`, older/revoked ones 404
  `link_not_found`.

## Environment quirks learned here

- Kill Bill needs `X-Killbill-CreatedBy` on POST /1.0/kb/tenants, and the
  catalog upload requires `Content-Type: text/xml` (`application/xml` is
  rejected with 415).
- Payments are created on `POST /1.0/kb/accounts/{id}/payments` with
  `transactionType: "PURCHASE"` and the `__EXTERNAL_PAYMENT__` plugin.
- Subscriptions are created on the root `POST /1.0/kb/subscriptions` with
  `bundleExternalKey`/`externalKey` (the account-scoped path does not exist).
- `pg_advisory_*` calls need an explicit `::bigint` cast for JS BigInt
  parameters.
- The test tenant (Kill Bill key `gfkit-dev`) is shared with the verifier;
  lookup-and-reuse semantics make leftover accounts and cancelled
  subscriptions from earlier runs harmless by design.
