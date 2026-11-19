# Lanternfold Rooms — repository notes

Shared infinite canvas for freelance facilitators running paid remote workshops.
Full product brief lives outside the repo; these notes capture environment and
integration facts that are expensive to rediscover.

## Layout

- `src/shared/` — types shared by server and client (type-only, no runtime logic).
- `src/server/` — Node HTTP server.
  - `domain/` — one module per domain rule. Each rule in the brief is decided in exactly
    one place here (state edges, entitlements, schedule resolution, bare-address rule,
    accepted board-write keys, per-role views, counts, dot ledger, CSV cell rule,
    rate-limit classes, image rules).
  - `db/` — pool, idempotent schema, idempotent seed.
  - `http/` — request context, boundary checks, rate limits, operation replay.
  - `board/` — repository, permissions, live event bus.
  - `services/` — S3, SMTP, Kill Bill (each hand-rolled, no SDK).
  - `recap/` — PDF, PNG, CSV writers and the recap pipeline.
- `src/client/` — React + Vite single-page client.
- `scripts/vendor-assets.mjs` — copies fonts/icons out of devDependencies and converts
  WOFF to TTF for PDF embedding. Runs as the first build step.

## Build and run

- `npm run build` → vendor assets, `vite build` (to `dist/client`), `tsc` (to `dist/server`).
- `npm start` → `node dist/server/main.js`, binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173).
- `/app/run.json` is the run manifest (`run-manifest-v1`).

## Dependency policy (IF-02 / IF-03)

Shipped packages must be MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD.
Checked with `npm ls --omit=dev --all --json`. Production tree is deliberately tiny:
only `pg`, `react`, `react-dom` and their transitive deps.

Packages deliberately **rejected**, do not reintroduce:

- `pdfkit` — pulls `pako` (`MIT AND Zlib`) and `png-js` (no licence field). PDF is
  hand-written in `src/server/recap/pdf.ts` instead.
- `nodemailer` — published as `MIT-0`, which is not literally in the allowed list.
  SMTP is hand-written in `src/server/services/smtp.ts`.
- `@aws-sdk/client-s3` — Apache-2.0 and legal, but ~80 extra packages to enumerate in
  the notices. S3 SigV4 is hand-written in `src/server/services/s3.ts`.

Fonts and icons come from devDependencies (`@fontsource/*`, `lucide-static`), are
vendored into the build, and are listed separately in `THIRD_PARTY_NOTICES.md`
(fonts as `OFL-1.1`, Lucide as ISC).

## Services in this environment

| Service | Address | Notes |
|---|---|---|
| Postgres | `postgres:5432` db `gf_dev` | 16.4. Sole source of truth for app state. |
| MinIO | `minio:9000` bucket `gf-dev` | Path-style addressing. |
| Mailpit | SMTP `mailpit:1025`, UI/API `mailpit:8025` | No auth, no TLS. |
| Kill Bill | `killbill:8080` | Tenant `gfkit-dev` already exists. Clock is at 2026-10-30. |

`psql` is **not** installed; query Postgres through Node (`pg`).

## Kill Bill API facts learned the hard way

Standard headers on every call:
`-u admin:password`, `X-Killbill-ApiKey`, `X-Killbill-ApiSecret`,
`X-Killbill-CreatedBy`, `Content-Type: application/json`, `Accept: application/json`.

1. **Catalog upload** — `POST /1.0/kb/catalog/xml` needs `Content-Type: text/xml`
   (`application/xml` answers 415).
2. **`changePolicyCase` child order is fixed by the XSD** and a wrong order fails with the
   opaque `CatalogApiException code 2080 "Invalid catalog for tenant"`. The sequence is
   `phaseType, fromProduct, fromProductCategory, fromBillingPeriod, fromPriceList,
   toProduct, toProductCategory, toBillingPeriod, toPriceList, policy`.
3. **Subscription create** — `POST /1.0/kb/subscriptions` must **not** carry
   `productCategory` when `planName` is set ("should not be set when planName is specified").
   Use `?callCompletion=true&callTimeoutSec=…` so invoices exist when the call returns.
4. **The account invoice list under-reports.**
   `GET /accounts/{id}/invoices` returns `amount: 0.0` and `items: null` even with
   `withItems=true`. Always take the ids from the list and then
   `GET /invoices/{id}?withItems=true` for real amounts. This bit twice.
5. **Plan change** — `PUT /1.0/kb/subscriptions/{id}` with `{"planName":…}` returns 204.
   The catalog's change policy decides immediate vs end-of-term; do not pass a policy.
   - Immediate upgrade produces the prorated invoice automatically, e.g. studio-monthly →
     agency-monthly on day 0 gives one invoice of `35.00` (`RECURRING +59.00`,
     `REPAIR_ADJ -24.00`).
   - A scheduled change appears as a **future `CHANGE` event** in the subscription's
     `events[]`, with `chargedThroughDate` as its effective date. A new change replaces it.
6. **Overdue payments** — add control tag `AUTO_PAY_OFF`
   (`00000000-0000-0000-0000-000000000001`) via `POST /accounts/{id}/tags` with a JSON
   array of tag definition ids. Invoices raised afterwards keep a balance.
7. **Explicit payment** — `POST /1.0/kb/invoices/{invoiceId}/payments` with body
   `{"targetInvoiceId":…,"accountId":…,"purchasedAmount":<number>}`.
   Do **not** send `transactionType` (the `InvoicePaymentJson` shape rejects it).
   Leaves the `AUTO_PAY_OFF` tag in place, as the brief requires.
8. **Sponsor invoice** — `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=true` with a
   JSON **array** of `{accountId, amount, currency, description}`. Returns 200 with the
   created items, including `invoiceId`. Non-ASCII descriptions round-trip fine.
9. Invoice **numbers are global per tenant**, not per account.
10. Amounts are JSON numbers; convert to exact decimal strings at this boundary only.

## Recap file writers (hand-rolled)

- `src/server/recap/truetype.ts` parses only what is needed: `head.unitsPerEm`, `maxp.numGlyphs`,
  `hhea`/`hmtx` advances, and a Unicode `cmap` (format 4 and 12), plus glyph outlines for the PNGs.
- `src/server/recap/pdf.ts` writes a PDF with **uncompressed** content streams and ToUnicode
  CMaps (the brief allows uncompressed or FlateDecode-alone; uncompressed avoids any filter
  question), fonts embedded as `CIDFontType2` + `Identity-H` + `/CIDToGIDMap /Identity`, and
  text shown with `Tj`. Verified with `pypdf`: text extracts exactly, including
  `Ação às 9h – Zoë`, and metadata holds only `/Title` and `/Author`.
- Fonts for the PDF come from `assets/fonts/*.ttf`, produced at build time by
  `scripts/vendor-assets.mjs` inflating the `@fontsource` **WOFF1** files (a WOFF1 is just a
  zlib-deflated sfnt, so `node:zlib` is enough; no font package ships TTF).
  The `latin` subset covers Latin-1 plus general punctuation, which includes every character
  in the brief's sample text.
- `pip install pypdf` is available in this sandbox for checking extraction.

## Error order

`src/server/http/pipeline.ts` is the single place the API's global error order is enforced:
boundary → 401 → 429 → 404 → 403 (`preflight`) → operation replay → 402 → handler
(409 → 422 → entitlement → 503). Two ordering traps, both fixed, both easy to reintroduce:

- **409 before 422.** A transition must check the state edge *before* validating
  `durationSeconds`/`dotBudget`, so an illegal edge answers `illegal_transition` rather than a
  field error. `readTransitionSettings` is therefore called only after the edge is accepted.
- **403 before 402.** Role checks that belong at step 5 go in a route's `preflight` hook, not
  in the handler, because the handler runs after the payment check.

## Bugs worth not repeating

- `closed → archived` is a **legal** edge. Rejecting every transition out of a terminal status
  breaks Archive. The rule is: check legality first; an *illegal* edge out of `closed`/`archived`
  answers `workshop_closed`, any other illegal edge answers `illegal_transition`.
- Postgres cannot deduce a parameter's type when the same `$n` is used as both a value and a
  comparison operand; cast it (`$8::bigint`).
- `hiddenCount` counts **every** unrevealed note in a frame, including the viewer's own. It is
  not "notes you cannot read".

## Verifying

`scripts/dev.sh {start|stop|restart} [instance] [port]` controls a built instance.
`ps`, `pkill` and `psql` are **not** available; the script finds processes through `/proc`,
and Postgres is reached through Node.

Browser checks need Chromium's system libraries (`apt-get install libnss3 libatk1.0-0
libatk-bridge2.0-0 libgbm1 libasound2 libcups2 libpango-1.0-0 libcairo2 …`); Playwright itself
is installed **outside** `/app` so it never enters the shipped dependency tree.

Ad-hoc verification scripts live outside the repository (IF-07 allows JavaScript only as tool
configuration or build output, so every file in `/app` is TypeScript).

When re-running checks, remember that **Mailpit accumulates** across runs and the seeded
facilitator has a 20-workshop cap — give test data a per-run unique suffix, and reset the
database to the three seeded workshops afterwards.

## Gotchas

- The `file_editor` `create` command fails if the parent directory does not exist; `mkdir -p`
  first.
- Heredocs echo noisily in this terminal; prefer `file_editor` for anything long.
