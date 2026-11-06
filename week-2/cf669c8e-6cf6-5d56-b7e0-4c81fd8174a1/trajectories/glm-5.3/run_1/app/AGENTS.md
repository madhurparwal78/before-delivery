# Ommezwaai Feeler — repository notes

Storefront for city riders replacing 50cc petrol scooters with electric ones.
Sells bolt-in retrofit kits and built e-mopeds, proving fit in millimetres
before taking a deposit.

## Running

- `run.json` drives the runtime: `install` (`npm install`), `build` (`node build.mjs`), `serve` (`node dist/server/main.js`).
- The server binds 0.0.0.0 on `APP_PUBLIC_PORT` (default 4173). `GET /api/health` answers as soon as it listens.
- All provider credentials come from the environment: `DATABASE_URL`, `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`, `KILLBILL_CALLBACK_ORIGIN`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `WIREMOCK_URL`. Time settings: `HOLD_SECONDS`, `SESSION_SECONDS`, `SHOP_CLOCK_START`, `SHOP_CLOCK_RATE`.
- Kill Bill's notification callback is registered at start and in the background until it succeeds; the secret lives in PostgreSQL (`shop_secrets`), so instances sharing the database are one shop.

## Layout

- `src/server` — TypeScript server: `api.ts` (routes), `domain/` (money, fit, quotes, payments, refunds, lifecycle, rides — each domain rule decided in exactly one file), `services/` (Kill Bill, WireMock registry, Mailpit), `store.ts` (schema + idempotent seed).
- `src/client` — Preact SPA: `configurator.tsx`, `screens.tsx` (orders/checkout/dialogs), `screens2.tsx` (bikes, rides, desk, auth, story), `scene.ts` (three.js scene), `still.ts` (no-WebGL drawing), `shared.ts` (provider banners).
- `build.mjs` bundles client to `dist/public` and server to `dist/server`.

## Conventions

- Money is integer cents; geometry integer tenths of a millimetre; verdicts never use floats.
- Shared state (sessions, idempotency, holds, notification records, mail records) lives only in PostgreSQL; coordination uses `pg_advisory_xact_lock`.
- Failures use the one error shape `{"error":"<code>"}` or `422 {"errors":{...}}`.
- Provider quirks learned here: Kill Bill answers the tenant-scoped routes with `X-Killbill-ApiKey`/`X-Killbill-ApiSecret` headers (plus basic auth), and purchase/refund POSTs return an empty body with the payment id in the `Location` header — the client re-reads the payment to adopt the transaction. A purchase with an existing successful `transactionExternalKey` answers 400 code 7030; the client adopts the existing transaction.
