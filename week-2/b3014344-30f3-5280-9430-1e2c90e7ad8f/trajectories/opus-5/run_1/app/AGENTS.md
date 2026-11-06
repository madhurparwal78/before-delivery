# Pampero Ledger — repository notes

Storefront and client ledger for Pampero Build Co.: a scroll-driven public site, a client
portal and a studio console, on Postgres, Kill Bill, MinIO, Mailpit and PocketBase.

## Running it

```
npm ci && npm run build && npm start      # serves 0.0.0.0:4173 (APP_PUBLIC_PORT)
npx tsc -p tsconfig.json --noEmit         # server + shared typecheck
npx tsc -p tsconfig.client.json --noEmit  # client + shared typecheck
```

`npm run build` compiles the server with `tsc`, bundles `src/client` with esbuild into
`dist/public/assets` and copies the woff2 fonts into `dist/public/fonts`. Schema, Kill Bill
catalog, the PocketBase collection and the seed data are applied on serve, idempotently, by the
setup loop in `src/server/index.ts`; it retries every 15 seconds while a service is down.

## Layout

- `src/shared` — money (integer minor units), plan catalog, exact published copy. Bundled into
  both the server and the browser so a figure is formatted in exactly one place.
- `src/server/domain` — the rules: prices in effect, quotes and the 40/60 split, order state
  machine, access and visibility, upload allowlist, cards, idempotency, care plan status,
  billing flows (pay, refund, invoice classification).
- `src/server/services` — Kill Bill, MinIO (own SigV4), SMTP (own minimal client), PocketBase.
- `src/server/api` + `src/server/pages` — JSON routes and server-rendered pages, both dispatched
  by `src/server/router.ts` from `src/server/index.ts`.
- `src/server/workers` — mail queue, invoice discovery and PDFs, dunning attempts.
- `src/client` — progressive enhancement only: the fold-line quote sheet, checkout, plan page,
  uploads, studio console, three.js scene (loaded as a separate chunk).

## Things worth remembering

- Kill Bill list endpoints need `includeInvoiceComponents=true` or amounts come back as 0.
- Kill Bill keeps payment external keys for good, so a retried Pay asks
  `freePaymentExternalKey` for `<order id>-deposit`, then `-retry1`, and so on.
- A care plan's status is derived from Kill Bill's own subscription events and invoice balances
  (`src/server/domain/plan.ts`); the ledger only remembers dunning attempts.
- Read-committed snapshots: after `select … for update` on a payment, refund totals are summed
  in a *second* statement, otherwise concurrent refunds each see a stale sum.
- Worker loops are jittered so two processes sharing the ledger cannot lock into the same
  polling phase and starve each other.
- Seeding PB-0006 (a paused plan) turns `AUTO_INVOICING_OFF` on while the back-dated
  subscription and its pause are created, then generates invoices once.
