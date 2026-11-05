# Opaline Bench Days — repository notes

Booking and event-operations site for a two-day, 24-seat composite masterclass.
TypeScript end to end: a plain `node:http` server and a React browser bundle,
both built with esbuild.

## Layout

```
run.json              install / build / serve manifest
scripts/build.mjs     esbuild: server bundle, client bundle, stylesheet, fonts
assets/fonts/         the two self-hosted woff2 faces
src/shared/           pure rules used by both sides (benches, prices, money,
                      hands-on share, copy, event facts, API types)
src/server/
  config.ts           every service URL and credential, read from the environment
  http/               boundary, router, request context, one error shape
  db/                 pool and locks, idempotent schema, accounts, reservations
  domain/             the business rules, one per file
  services/           Kill Bill, MinIO (hand-rolled SigV4), SMTP, PocketBase, PDF
  routes/             one file per surface
  workers/            claimed background sweeps
src/client/           store, public chapters, lab scene, staff screens
```

## Where each rule lives (one place each)

| Rule | File |
| --- | --- |
| Venue-local date and every calendar boundary | `src/server/domain/venue.ts` |
| Ledger count, bench states, Atelier cap | `src/server/domain/ledger.ts` |
| Reservation state machine | `src/server/domain/reservationState.ts` |
| Refund schedule and newest-first split | `src/server/domain/refundSchedule.ts` |
| Upgrade split | `src/server/domain/upgradeSplit.ts` |
| Hands-on share (shared with the browser) | `src/shared/handsOnShare.ts` |
| Certificate eligibility and numbering | `src/server/domain/certificate.ts` |
| Prices and the upgrade difference | `src/shared/prices.ts` |
| Error shape and precedence | `src/server/http/errors.ts`, `src/server/http/app.ts` |

## Concurrency

* Every claim on a bench or an Atelier place runs inside `withLedgerLock`
  (a Postgres advisory transaction lock), so exactly one of N simultaneous
  claims wins across every app process.
* `sweepLedger` releases lapsed holds and offers and hands the freed benches to
  the waitlist in the same atomic step, so Atelier never flickers out of
  sold-out while a bench passes from an expired hold to an offer.
* Reads call `sweepIfDue`, which only takes the lock when something has lapsed.
* Agenda writes use `withAgendaLock`; certificate numbers use
  `withCertificateLock` and are committed together with the stored PDF, so a
  storage failure uses no number.
* Background work is claimed in Postgres: mail rows move to `sending` with
  `for update skip locked`, reminders are claimed by an `insert … returning`,
  and receipt retries take `withWorkClaim`.

## Kill Bill notes (0.24.x)

* `POST /1.0/kb/invoices/{id}/payments` ignores the transaction external key in
  this version. Purchases therefore go through
  `POST /1.0/kb/accounts/{id}/payments` with
  `controlPluginName=__INVOICE_PAYMENT_CONTROL_PLUGIN__` and
  `pluginProperty=IPCD_INVOICE_ID=<invoiceId>`, which honours both the payment
  and the transaction external key and still records an invoice payment.
* Refunds with invoice-item adjustments go to
  `POST /1.0/kb/invoicePayments/{paymentId}/refunds` with `isAdjusted` and
  `adjustments`.
* The tenant healthcheck at `/1.0/kb/healthcheck` answers 401; reachability is
  probed with the platform healthcheck at `/1.0/healthcheck`.
* Before charging or refunding, the external key is looked up and a confirmed
  transaction is reused, so a retry never charges twice.
* Kill Bill pays a committed invoice by itself when the account carries a
  default payment method, which produced a second charge under a key we do not
  control. Each buyer account therefore gets the `AUTO_PAY_OFF` control tag
  (`00000000-0000-0000-0000-000000000001`), which keeps the external payment
  method as the default while leaving this app the only payer.
* `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=true` returns before the
  invoice is committed on Kill Bill's bus, and the control plugin aborts a
  purchase against an uncommitted invoice, so the invoice is read back until it
  is `COMMITTED` with a balance to pay.

## PocketBase notes

The provided instance speaks the pre-0.23 API: admin sign-in at
`/api/admins/auth-with-password` and collections carrying a `schema` array.

## Local checks

`npm run build` type-checks with `tsc --noEmit` and then bundles.
`npm run start` serves on port 4173 (or `APP_PUBLIC_PORT`).
`GET /api/health` answers before any dependency is reachable.
