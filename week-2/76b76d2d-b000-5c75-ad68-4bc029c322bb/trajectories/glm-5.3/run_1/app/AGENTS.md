# Halide Box Office — project memory

## Stack and run
- Node 22 + TypeScript (strict). Server compiled with `tsc` into `dist/`, browser bundled with esbuild (`src/main-client.ts` → `dist/assets/app.js`).
- `npm run build` = `node --experimental-strip-types scripts/build.mts` (strip-types runs `.mts` as ESM). `npm run serve` = `node dist/server/main.js`. Port: `APP_PUBLIC_PORT` (default 4173).
- Typechecks: `npm run check` (server tsconfig + scripts tsconfig + `/tmp/tsconfig-browser.json` pattern for `src/`).

## Environment (this workspace)
- Kill Bill: `http://killbill:8080`, basic auth `admin`/`password` + `X-Killbill-ApiKey: gfkit-dev` / `X-Killbill-ApiSecret: gfkit-dev-secret`. Health: `GET /1.0/healthcheck` (no `/kb/`).
- Mailpit SMTP: `mailpit:1025`; API `http://mailpit:8025`.
- Postgres: `DATABASE_URL` in env (no psql client in container; use `/app/node_modules/pg` from a `.cjs` script for ad-hoc DB access).

## Kill Bill API learnings (learned by probing, not documented well)
- Auth: EVERY endpoint needs basic auth AND the tenant API key headers.
- Charge invoices: `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=true`, body = ARRAY of items with `itemType` (not `type`). Response is an array; GET the invoice individually for real amounts (the list endpoint returns 0.0 amounts).
- Payments: `POST /1.0/kb/invoices/{id}/payments?externalPayment=true&controlPluginName=__EXTERNAL_PAYMENT__` body `{accountId,targetInvoiceId,purchasedAmount,currency}`. Usually 201+Location; sometimes 204 with no Location — poll `GET /1.0/kb/invoices/{id}/payments` for the payment id.
- Refunds: `POST /1.0/kb/invoicePayments/{id}/refunds` — DO NOT pass `externalPayment=true` (it records a CREDIT transaction on a NEW payment instead of a REFUND on the payment).
- Credits: `POST /1.0/kb/credits?autoCommit=true` (array of CREDIT_ADJ items) → auto-creates CBA; CBA auto-applies to later invoices as CBA_ADJ items. Voiding a charge invoice releases its consumed CBA; voiding a credit invoice does NOT remove the CBA (compensate credits with a balancing charge via `reverseCredit`).
- Catalog: `POST /1.0/kb/catalog/xml` (Content-Type `text/xml`), validated via `/catalog/xml/validate`. Element order: effectiveDate, catalogName, currencies, products (name attr), rules (default cases), plans (name attr; finalPhase type attr; FIXEDTERM = duration+fixed/fixedPrice), priceLists (defaultPriceList). FIXEDTERM gift plans bill 0.00 for 12 months.
- Subscription invoices appear asynchronously (~0.5–2s); poll `GET /accounts/{id}/invoices` for a newer invoice number.
- Express 5 gotcha: no inline route regex (`/:locale(en|fr)`); use plain params and validate in the handler.

## Key invariants implemented (each decided in ONE place)
- Per-line tax (`gstFor`/`qstFor` in `server/domain/model.ts`), cost split (`costSplit`), season state derivation (`seasonTimeDerived`), refund cutoff, check-in window (`server/domain/model.ts`), hold liveness (`booking.ts`), step-up requirement (`stepup.ts`), safe paths (`domain/safepath.ts`), locale rule (`http/errors.ts requestLocale`), retry ladder (`outbox.ts retryDelaySeconds`).
- Money is integer cents everywhere; Kill Bill amounts convert only at the API boundary.
- Bookings are committed together with the Kill Bill payment inside one Postgres transaction (holds row locked first); failures void/refund the KB invoice as compensation.
- `kb_accounts` registry table lists every account the app created — reconciliation sums KB transactions over it.
