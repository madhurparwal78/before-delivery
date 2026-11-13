# Spindrift Rooms — repository notes

Commissioning desk for one installation-art studio. TypeScript on Node 22,
Express API plus a Vite/React client, with nine external services.

## Shape of the repository

```
run.json                 install / build / serve manifest (run-manifest-v1)
src/shared/              rules and copy both sides read
  seed.ts                venues, prices, pieces, plans, seeded accounts
  money.ts               tax rounding, quote, the one splitting rule
  placement.ts           footprint geometry and the placement checks
  states.ts              the commission transition table
  venue-time.ts          venue-local dates, DST-correct day bounds, due dates
  copy.ts                every published string
src/server/
  env.ts                 all credentials, read from the environment
  db/schema.sql          applied idempotently on every start
  domain/                commissions, billing, payments, holds, transitions,
                         documents, notifications, access, safe-fetch
  services/              one client per external service
  jobs/                  durable job table, workers, Postgres event bus
  routes/                the API
src/client/
  stage/renderer.ts      the WebGL venue stage (custom shaders)
  lib/                   api, typing engine, app context, shapes
  routes/, components/   screens and shared controls
```

## Rules that live in exactly one place

| Rule | Where |
| --- | --- |
| Tax rounding and quote lines | `shared/money.ts` `taxOn`, `computeQuote` |
| The splitting rule (basis points, largest remainder) | `shared/money.ts` `splitByBasisPoints` |
| Commission transitions and their actors | `shared/states.ts` `TRANSITIONS` |
| Placement checks and their messages | `shared/placement.ts` `validateLayout` |
| Venue-local instants (day bounds, due dates, quote validity) | `shared/venue-time.ts` |
| Outbound address safety | `server/domain/safe-fetch.ts` |
| Published strings | `shared/copy.ts` |

`shared/copy.ts` uses **straight** apostrophes; in-word ones are escaped as
`\'` inside single-quoted strings. Do not "tidy" them into curly quotes, and do
not add `text-transform` to anything carrying published copy — it changes what
`innerText` and the accessible name report.

## Things learned about the services

- **Kill Bill** auto-pays a committed invoice when the account has a default
  payment method, so every payer account carries the `AUTO_PAY_OFF` control tag
  (`00000000-0000-0000-0000-000000000001`). Payments are then explicit.
- The invoice-payments endpoint ignores `transactions[].transactionExternalKey`.
  To control the key, post to
  `/1.0/kb/accounts/{id}/payments?controlPluginName=__INVOICE_PAYMENT_CONTROL_PLUGIN__&pluginProperty=IPCD_INVOICE_ID=<invoice>`.
  Look a payment up again with `GET /1.0/kb/payments?externalKey=<key>`.
- A plan change takes `billingPolicy=IMMEDIATE` **or** `requestedDate`, never
  both. The proration invoice appears on Kill Bill's own bus about two seconds
  later, so `waitForInvoiceAfter` polls for it.
- `POST /1.0/kb/catalog/xml` needs `Content-Type: text/xml`.
- Listing invoices needs `includeInvoiceComponents=true` to return items.
- `/1.0/kb/healthcheck` answers 401/404 here; `/1.0/kb/nodesInfo` is the probe.
- **Keycloak** refuses brackets in `firstName`/`lastName`
  (`error-person-name-invalid-character`), so accounts hold the plain person
  name and the app keeps the published display name in `app_users.name`.
  The service account has `manage-realm` and `manage-users` but no client
  scopes, so listing clients returns an empty array.
- **ntfy** titles carry em dashes, which an HTTP header cannot hold; alerts are
  published as JSON to `POST /` with `{topic,title,message,tags}`.
- **MinIO** is reached with hand-rolled SigV4 in `services/s3.ts`; the bucket
  probe is `HEAD /<bucket>` with an empty key.
- **Svix** attempt status is numeric: `0` success, `1` pending, `2` fail.
- **WireMock** is pre-stubbed for `POST /v1/renders` and its admin API is
  closed, so nothing needs registering.

## Conventions

- Every API failure leaves through `http/errors.ts`, in the published
  precedence order (413, 401, 404, 403, idempotent replay, 409, 422, 503).
- Paid, stored, ready and delivered states are written only from a provider's
  answer. Never set them optimistically.
- Anything with an outside effect (email, PDF, render submission, preview
  storage, crew alert, CRM event) is a row in `jobs`, created in the same
  transaction as the change, with a `dedupe_key` naming its effect.
- Ids in request bodies are resolved through `domain/access.ts`, which answers
  404 for anything outside the caller's reach.
- `tsconfig.json` runs with `strict`, `noUnusedLocals` and
  `noUnusedParameters`; both projects must typecheck clean.

## Checks worth remembering

- The brief's worked example (Camera-reactive wall, Standard, Night-mode
  lighting at Halsted Works Hall) is the money fixture: subtotal 2,390,000, tax
  244,975, total 2,634,975; funder tax parts 122,487 / 61,244 / 61,244; sponsor
  A owes 658,744; the client's deposit is 526,995. Those figures only hold with
  funders at 5000 / 2500 / 2500 — with a sole lead funder the deposit is
  1,053,990.
- Amounts are integer cents: 2,634,975 renders as `$26,349.75`.
- A Chicago day that springs forward lasts 23 hours and one that falls back
  lasts 25; `endOfDay` is the next date's local midnight.

## Running it

`npm ci`, `npm run build`, `npm run start`. The server binds `0.0.0.0` on
`APP_PUBLIC_PORT` (4173 by default) and answers `GET /api/health` even while
every dependency is down; schema, realm, catalog and bucket setup retry on
their own until they succeed.
