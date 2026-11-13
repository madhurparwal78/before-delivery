# Holmgarth Aftercare Fittings Desk — working notes

## Environment facts (verified 2026-11-05)

Services are provided and reachable by hostname; all settings come from the environment:

| Service | Address | Notes |
|---|---|---|
| Postgres | `postgres:5432` (`DATABASE_URL`) | db `gf_dev`, user `gf_app` |
| MinIO | `minio:9000` (`S3_*`) | bucket `gf-dev`, path style |
| Kill Bill | `killbill:8080` | tenant apiKey `gfkit-dev` exists |
| Mailpit | SMTP `mailpit:1025`, API `mailpit:8025` | |
| WireMock (carrier) | `wiremock:8080` | stubs already match the brief |

System clock: 2026-11-05 UTC. `APP_PUBLIC_PORT=4173`, `APP_PUBLIC_URL=http://127.0.0.1:4173`.

## WireMock carrier (already stubbed, do not change — IF-05)

`GET /v1/carriage/quote?weight_g&longest_side_mm&postcode_area` returns the published
bands. Verified: default `S2`/395, `longest_side_mm>=1000` → `L1`/2450, `HS` → 500,
`KW` → 200 with body `not json`. `ZE` delays 2.5 s (usable), `IV` delays 5 s (times out
against the 4 s wait).

## Kill Bill call sequence (verified end to end)

Auth on every call: basic `admin:password` plus headers `X-Killbill-ApiKey: gfkit-dev`,
`X-Killbill-ApiSecret: gfkit-dev-secret`, `X-Killbill-CreatedBy`. Amounts are **decimal
pounds**, so convert to and from integer pence at the boundary.

1. Account — `POST /1.0/kb/accounts` `{name, externalKey, currency:"GBP"}` → 201 with the
   id in `Location`. Find an existing one with `GET /1.0/kb/accounts?externalKey=<ref>`.
2. Invoice — `POST /1.0/kb/invoices/charges/<accountId>?autoCommit=true` with an **array**
   of items; every item in one call lands on one invoice. Items use `description` for the
   published `Part <part number> × <quantity>` and `Carriage band <band>` lines.
3. Read back — `GET /1.0/kb/invoices/<id>?withItems=true` → `amount`, `balance`, `status`,
   `items[].amount`. The brief's worked example reproduces exactly: 0.38 + 3.95 = 4.33.
4. Payment — `POST /1.0/kb/invoices/<id>/payments?externalPayment=true`
   `{accountId, purchasedAmount, currency}` → 201, `Location` holds the **payment** id.
   `GET /1.0/kb/payments/<id>` shows a `PURCHASE` `SUCCESS` transaction.
5. Refund — `POST /1.0/kb/payments/<id>/refunds` `{amount, currency}` → 201, adds a
   `REFUND` `SUCCESS` transaction.
6. Void — `PUT /1.0/kb/invoices/<id>/voidInvoice` → 204, invoice `status` becomes `VOID`
   and the account balance returns to 0.

## Conventions for this build

* Every amount shown, stored in a note or emailed is read back from Kill Bill (DP-60).
* Shared state (sessions, locks, rate windows, idempotency, notice queue) lives only in
  Postgres (IF-04); nothing is cached in process between requests.
* Each domain rule is decided in exactly one module under `src/domain/`.

## Source layout

```
src/
  config.ts          every service address, credential and desk setting, read once at start
  server.ts          entry point; starts and serves whatever is down
  domain/            one module per domain rule (see below)
  shared/            code both the server pages and the browser use
  db/                schema, seed, pool, and one repository per area
  services/          storage (SigV4), billing (Kill Bill), carrier, smtp, mailpit, notices
  http/              error shape, request reading, router with the published precedence
  api/               route table, claim actions, owner actions, upkeep, view builders
  ui/                page routes, shell, claim slip, Lucide icons
  client/            browser code: dom, fan, owner, operator, share
  assets/styles.css  the assembly-booklet look
```

Each domain rule lives in exactly one module:

| Rule | Module |
|---|---|
| state transitions and what each move allows | `domain/state.ts` |
| the aftercare term and the ruling | `domain/ruling.ts` |
| the deciding edition | `domain/editions.ts` |
| the quote figures and rounding | `domain/quote-figures.ts` |
| the dispatch promise | `domain/dispatch-promise.ts` |
| the photo type check | `domain/photos.ts` |
| model name matching | `domain/model-match.ts` |
| the London calendar and "at or after a closing instant is outside" | `domain/time.ts` |
| answering a reference the caller may not have | `http/errors.ts` (`unknownReference`) |

`shared/copy.ts` owns every published string in both languages. Pages render each
translatable node with `data-en`/`data-pl` beside it, and the browser swaps those
attributes, so the server is the only author of copy and the switch cannot drift.

## Verified behaviour

A harness in `/tmp/chk` drives the desk against the real services. **432 checks pass**,
each one reading the service that owns the truth:

| Suite | Checks | Covers |
|---|---|---|
| `journey.mjs` | 116 | the eight journeys, cross-surface agreement with Kill Bill, MinIO, Mailpit and Postgres |
| `edges.mjs` | 44 | re-quote revisions, the paid refund, the state machine, share links, carrier outcomes, photo bytes, validation |
| `copies.mjs` | 53 | every service down, recovery without a restart, and the frozen-clock and zero-setting copies |
| `notices.mjs` | 7 | notices waiting through a mail outage and sent exactly once |
| `browser.mjs` | 137 | fan attributes and on-screen geometry, keyboard, the fallback list, the language switch, layouts, dialogs |
| `ui-journey.mjs` | 61 | the journeys driven through the screens, with the address bar moving on its own |
| `share-refresh.mjs` | 14 | the share page layout and its in-place refresh |

### Kill Bill details worth remembering

* `GET /1.0/kb/accounts/<id>/invoices` **hides voided invoices**; pass
  `includeVoidedInvoices=true` to see them.
* That listing does not carry item amounts: read each invoice with
  `GET /1.0/kb/invoices/<id>?withItems=true` for `amount` and `items[].amount`.

### Bugs found and fixed while checking

1. **`setClaimState` had its SQL parameters reversed**, so `WHERE reference = $1` compared
   the reference against the new state and a quoted claim never left `identified`. Re-read
   every `UPDATE ... WHERE` parameter list when adding a query.
2. **Fan parts covered each other.** With a 96x56 box and a 48 px gap, part k's centre sat
   inside part k+1's box, so some parts could never be clicked. The box is now the 44 px
   tap target, which keeps every centre clear on all three axes at both gaps, and the
   callout and shape are `pointer-events: none`.

### Running the harness

```
node /tmp/chk/reset.mjs          # clears claims and restores the seeded bins
node /tmp/chk/journey.mjs        # and the other suites
```

`reset.mjs` is a test convenience only; the desk itself seeds only when the catalogue is
empty. The copies suite isolates each frozen-clock copy in its own Postgres schema,
because the dev user may not create databases.
