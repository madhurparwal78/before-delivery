# Halide Box Office — repository notes

Bilingual (French-first) box office for a Montréal repertory cinema. Node 22 + TypeScript only.
Three backing services and no others: Kill Bill (money of record), SMTP/Mailpit (all email),
Postgres (everything else).

## Layout

```
run.json              run manifest (install / build / serve)
build.ts              esbuild build, run with node --experimental-strip-types
src/shared/           code used by server and browser (strings, money, domain constants)
src/server/           HTTP server, API, views, services, repositories
src/client/           browser bundle (iris stage, seat map, checkout, staff console)
dist/                 build output: server.js and public/ assets
```

* `src/shared/strings.ts` is the single bilingual dictionary. `t(key, locale, args)` supports
  `*_cents` money args, `@other_key` nested lookups and `{en, fr}` object args. Every copy string
  is written with ASCII `'` and normalised to U+2019 at module load.
* Views render `data-i18n` / `data-i18n-aria` / `data-i18n-args` attributes so the browser can
  switch language in place without reloading (`src/client/i18n.ts`).

## Where each domain rule lives (one place each)

| Rule | Module |
|---|---|
| per-line GST/QST, credit applied, group cost split | `src/server/domain/pricing.ts` |
| Toronto wall-clock ↔ instant, DST gap/overlap, business day | `src/server/domain/time.ts` |
| season state derivation and legal transitions | `src/server/domain/seasons.ts` |
| fare allowances and defaults | `src/server/domain/fares.ts` |
| hold liveness, seat claims, quotes | `src/server/service/holds.ts` |
| refund cutoff | `src/server/service/refunds.ts` |
| check-in window | `src/server/service/door.ts` |
| step-up requirement and limits | `src/server/service/stepup.ts`, `service/membership.ts` |
| safe-path check | `src/server/http/safepath.ts` |
| locale rule | `src/server/http/context.ts` (`resolveLocale`) |
| outbox retry schedule | `src/server/mail/outbox.ts` (`retryDelaySeconds`) |
| billing outage guard | `src/server/service/guard.ts` |

## Kill Bill notes (0.24, verified against the live tenant)

* Catalogue upload: `POST /1.0/kb/catalog/xml` with `text/xml`; checked at serve and retried
  every 5 s until the plans appear in `GET /1.0/kb/catalog`.
* Booking/gift invoices: `POST /1.0/kb/invoices/charges/{account}?autoCommit=false` →
  `POST /1.0/kb/invoices/taxes/{account}?autoCommit=false` (needs `invoiceId` in each item) →
  `PUT /1.0/kb/invoices/{id}/commitInvoice`. Account credit (CBA) is applied automatically on
  commit, so the invoice balance is the amount to charge.
* Payment: `POST /1.0/kb/invoices/{id}/payments?externalPayment=false` with
  `{accountId, targetInvoiceId, purchasedAmount}` creates one PURCHASE.
* Subscription invoices are auto-paid by Kill Bill, and invoicing is asynchronous: poll for a new
  invoice id (`waitForNewInvoice`) for a few seconds after join/change.
* `GET /1.0/kb/accounts/{id}/invoices` returns zeroed summaries; always re-fetch each invoice by id
  with `?withItems=true`.
* Account credit balance: `GET /1.0/kb/accounts/{id}?accountWithBalanceAndCBA=true` → `accountCBA`.

## Conventions

* Money is integer cents everywhere; only the Kill Bill boundary converts to decimals.
* Seat claims are decided by one `INSERT … ON CONFLICT … WHERE sold = false AND expires_at <= now()`
  statement, so last-seat races and double check-ins are settled in the database.
* Checkout and refunds hold a `SELECT … FOR UPDATE` row lock across their Kill Bill calls so a
  booking can never be paid or refunded twice.
* `audit_log` and `credit_ledger` have triggers that refuse UPDATE and DELETE.
* Mail is written to the `outbox` table in the same commit as its business event; each instance
  (identified by `APP_PUBLIC_PORT`) only delivers messages it enqueued, strictly oldest first.

## Working locally

```
npm ci && npm run build && npm run serve      # serves on APP_PUBLIC_PORT (4173)
curl -s localhost:4173/api/health
```

Seeded sign-ins are listed in the brief (finance/door/programmer plus two patrons). The seed is
re-applied whenever the `seasons` table is empty, and seasons are positioned relative to the seed
date, so screenings stay in the future.
