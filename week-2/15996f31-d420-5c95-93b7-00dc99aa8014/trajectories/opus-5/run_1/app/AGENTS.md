# Swarmline Bloom Desk — working notes

A season desk for an almond pollination broker. PostgreSQL is the system of
record; Kill Bill holds grower invoices and payments, Mailpit receives every
email and MinIO stores frame photos and signed report PDFs.

## Layout

```
run.json                 install / build / serve manifest
src/shared/              code used by both the server and the browser
src/server/
  config.ts              every service URL and credential, read at start
  schema.ts              the whole schema, applied idempotently on serve
  readiness.ts           health answers 503 until PostgreSQL connects
  http/                  one error shape, one precedence order, the router
  domain/                rules, figures, transitions, allocation, ids
  data/                  queries, seed, visibility, idempotency, file links
  services/              Kill Bill, SMTP, MinIO (SigV4), PDF, emails
  views/                 the published field lists, nothing more
  routes/                one module per resource
  workers/               email outbox, queued settlements, billing reconcile
src/client/              the desk, drop detail and inspection sheet
```

## Rules that live in exactly one place

| Rule | Module |
| --- | --- |
| Block strength, tier, payable, payouts, deposit | `server/domain/figures.ts` with `server/domain/rules.ts` |
| Order, drop and inspection-link transitions | `server/domain/transitions.ts` |
| Largest-remainder settlement split | `server/domain/allocation.ts` |
| Pacific calendar date of an instant | `shared/pacific.ts` |
| The last-hive commit check | `POST /api/orders/:id/drops`, serialised by `lockOrder` |
| Error bodies and precedence | `server/http/errors.ts`, `server/http/router.ts` |
| Money and date text for people | `shared/format.ts`, `shared/pacific.ts` |

## Things learned the hard way

- **Kill Bill auto-pays invoices** when the account carries a *default* payment
  method. Grower accounts are therefore created with **no payment method**, so
  an invoice stays unpaid until the broker settles. Settling pays the stored
  balance invoice through `POST /1.0/kb/invoices/{id}/payments?externalPayment=true`
  with `paymentExternalKey = settle-<order id>`; a repeat of that key answers
  204 and records no second payment.
- **A failing instance must not hold a queue lease.** The queued-settlement
  worker releases its row (`next_attempt_at = now()`) as soon as billing proves
  unreachable, otherwise an instance with a broken `KILLBILL_URL` starves the
  healthy one for ever. The email outbox does the same.
- **The `content-type` header must not be lowercased**, because the multipart
  boundary is case sensitive and Chromium's boundaries are mixed case.
- **CSP blocks `style` attributes.** Set styles through the CSSOM
  (`element.style.x = …`), which CSP allows.
- **The odometer keeps only the current digit in each column at rest** and
  builds the 0–9 strip only while a column travels, so the readout's text is
  the plain figure whenever a test reads it.
- **Oversized bodies are drained, not destroyed**, or the 413 cannot be
  written back to the client.
- The server clock in this environment reads 2026, so the seeded 2027 orders
  are in the future and the seeded 2026 order is in the past.
- **Kill Bill outlives a database reset.** Grower accounts are keyed by the
  grower id and settlement payments by `settle-<order id>`, so re-settling a
  *seeded* order after wiping PostgreSQL meets a key Kill Bill already holds
  and answers 204 without a second payment. Clear a dev tenant by voiding the
  unpaid invoices of `grw_harlan` and `grw_mendota` before a fresh run.

## Running it

```
npm ci && npm run build && npm start      # port 4173, or APP_PUBLIC_PORT
```

`GET /api/health` answers `{"status":"ok"}` once PostgreSQL is reachable and
`503 {"status":"starting"}` before that. Kill Bill, Mailpit and MinIO may be
unreachable at boot or later; the server starts and stays healthy either way.
