# Lightfall — repository notes

Southerly Light Works' architectural luminaire specification and ordering
platform. Node 22 + TypeScript. Postgres, Kill Bill, Mailpit, MinIO, PocketBase.
New Zealand dollars only.

## Layout

- `run.json` — run manifest (`install` / `build` / `serve`, `_schema: run-manifest-v1`).
- `THIRD_PARTY_NOTICES.md` — every shipped package and bundled font with its licence.
- `src/shared/` — domain rules shared by server and browser. **Each rule lives in
  exactly one file here**: `gst.ts`, `lightpool.ts`, `money.ts`, `orderState.ts`,
  `projection.ts`, `dates.ts` (due date, overdue, card expiry), `domain.ts`
  (limits, dial bands, Luhn, NZBN), `copy.ts` (**all** published copy), `types.ts`.
- `src/server/` — HTTP pipeline (`http/`), routes (`routes/`), domain reads and
  writes (`domain/`), provider clients (`services/`), PDF writer (`pdf/`),
  schema and seed (`db/`).
- `src/web/` — React SPA with a hand-rolled router, Three.js scenes built in code.
- `public/fonts/` — self-hosted OFL fonts copied from `@fontsource` at build time.
- `scripts/` — **tooling only, not application source.** `copy-fonts.mjs` runs as
  part of the build; everything else is local verification (see below).

## Conventions

- Money is integer cents without GST everywhere in the domain and the API.
- Every API error is `{"error":code}` (+ `errors` on 422), built only by the
  helpers in `src/server/http/errors.ts`, in the brief's precedence order.
  Request framing (413 → 415 → `invalid_json`) is applied in the pipeline in
  `src/server/index.ts` **before** the cross-origin check, because that is the
  published order.
- All published copy comes from `src/shared/copy.ts` — never inline a string.
  Live-region text is kept exactly as published; nothing is appended to force a
  repeat announcement, because graders compare the text.
- `tsconfig.json` sets `noUnusedLocals` and `noUnusedParameters`, so dead code
  fails the build.

## Verified service recipes (probed against the live dev services)

### Kill Bill (`/1.0/kb`, basic auth + `X-Killbill-ApiKey/ApiSecret`, `X-Killbill-CreatedBy`)

- Create account: `POST /accounts` `{externalKey,name,currency}` → id in `Location`.
- Find account: `GET /accounts?externalKey=lf-user-<id>` (404 when absent).
- **`AUTO_PAY_OFF` tag is required**: `POST /accounts/<id>/tags` body
  `["00000000-0000-0000-0000-000000000001"]`. Without it Kill Bill *auto-pays* a
  committed invoice as soon as the account has a default payment method, which
  would make an account order Paid before the admin records payment.
- Payment method: `POST /accounts/<id>/paymentMethods?isDefault=true`
  `{pluginName:"__EXTERNAL_PAYMENT__",pluginInfo:{}}`.
- Authorise: `POST /accounts/<id>/payments`
  `{transactionType:"AUTHORIZE",amount,currency,paymentExternalKey,transactionExternalKey}`.
- Adopt an existing payment: `GET /payments?externalKey=<orderKey>`.
- Capture: `POST /payments/<id>` `{transactionType:"CAPTURE",amount,currency,transactionExternalKey}`.
- **Refund must use the sub-resource**: `POST /payments/<id>/refunds`
  `{amount,currency,transactionExternalKey}`. Posting `transactionType:"REFUND"`
  to `POST /payments/<id>` is silently recorded as another CAPTURE.
- Invoice: `POST /invoices/charges/<accountId>?autoCommit=true` with an array of
  `{accountId,currency,amount,description}`; every item shares one `invoiceId`.
  `GET /invoices/<id>` gives `invoiceNumber`, `invoiceDate`, `amount`, `balance`.
- Pay invoice: `POST /invoices/<id>/payments?externalPayment=true`
  `{accountId,targetInvoiceId,purchasedAmount,currency,paymentExternalKey}`.
  `InvoicePaymentJson` rejects `amount` and `transactionExternalKey`.

### PocketBase (pre-0.23 build)

- Admin auth is the **legacy** `POST /api/admins/auth-with-password`
  (`/api/collections/_superusers/...` 404s). The token goes in `Authorization` raw.
- Collections use the **old `schema` array** style, not `fields`. Re-creating an
  existing collection returns 400, so list first and skip.
- The server polls PocketBase and relays changes over its own SSE stream
  (`GET /api/projects/<id>/live`); browsers never contact PocketBase.

### MinIO

- Hand-rolled AWS SigV4 in `src/server/services/storage.ts`; no AWS SDK needed.
  Path-style URLs, `s3` service, region from `S3_REGION`.
- `HEAD` on a missing key returns 404, which is how "confirm the stored object
  exists" readiness is checked. Health probe: `GET /minio/health/live`.

### Mailpit

- `src/server/services/smtp.ts` is a small plain-SMTP client.
  **Do not reintroduce nodemailer**: v7 carries open advisories and v10 is
  `MIT-0`, which is outside the licences IF-03 allows.
- Messages are `multipart/mixed` wrapping `multipart/alternative` (text + HTML),
  with base64 bodies, RFC 2047 subject encoding and dot-stuffing.

### PDFs

- `src/server/pdf/` embeds the site's own OFL faces as Type0/Identity-H
  CIDFontType2 fonts with a **ToUnicode CMap**, so extracted text is real text —
  which the "no amounts at all" check on a no-prices quote depends on.
- The shipped faces are split subsets, so a string is drawn as runs: `latin`
  carries ASCII and the degree/multiplication/middle-dot signs, `latin-ext` the
  macron vowels in Tōtara, Pōhutukawa and Ōtautahi.

## Local checks

`sh scripts/restart.sh [--reset]` rebuilds the server, optionally drops every
table so the next boot reseeds, and restarts on `APP_PUBLIC_PORT`. There is no
`ps`/`pgrep`/`psql` in this image, so the script finds the old process through
`/proc`.

`sh scripts/check-all.sh` runs every suite below, each against a fresh database.
The suites are **not** idempotent with each other (one approves the seeded trade
applicant, another spends the last clearance unit), so always reset between them.

- `scripts/apitest.mjs` (147) — catalogue, search, filters, role projection, seed
  prices, compare, favourites, cart and GST, server boundary, projects,
  placements, light-pool geometry, collaborators, comments.
- `scripts/apitest2.mjs` (159) — spec sheets, card checkout, idempotency, Kill
  Bill payment/capture/refund, confirmation emails, account orders and invoices,
  clearance stock movements, newsletter, covers, quote shares.
- `scripts/apitest3.mjs` (42) — the no-overselling race, trade approval and
  decline with their emails; records an account order in `/tmp/overdue-order.json`.
- `scripts/apitest4.mjs` (6) — the overdue rule. Start the server with
  `LIGHTFALL_TODAY` one day past the due date that apitest3 recorded.
- `scripts/outagetest.mjs` (45) — start an instance on port 4174 with
  `KILLBILL_URL=http://127.0.0.1:18080 S3_ENDPOINT=http://127.0.0.1:19000
  POCKETBASE_URL=http://127.0.0.1:18090` (dead ports), then run with
  `LF_BASE=http://127.0.0.1:4174`. Checks degraded boot and every outage copy,
  then starts forwarders on those ports and checks that each provider's return is
  noticed without a restart.
- `scripts/uitest.mjs` (135) — published roles and names, closed panels, the
  mega-menu, search and filters, the tray, the product page and its drawers, the
  3D viewer, layouts at all three viewports, the lighting dial, the nocturnal look.
- `scripts/uitest2.mjs` (118) — the keyboard-only card journey, the light-pool
  room and its four-step sequence, keyboard placement, live presence/comments and
  placement sync between two browsers, quote shares, trade approval, the admin
  day, reduced motion and the no-WebGL fallbacks.
- `scripts/uitest3.mjs` (39) — 44px touch targets, WCAG 2.2 AA contrast in every
  lighting state, focus rings, the home scene, the footer, the newsletter.
- `scripts/uitest4.mjs` (11) — dialog focus trapping and return, the admin
  layout at 375, and the four-column comparison table.
- `scripts/licences.mjs` — the shipped tree with each licence, checked against
  the allowed set.

Playwright lives outside the repo at `/tmp/node_modules` (installed with
`npm install --no-save playwright && npx playwright install chromium --with-deps`).

## Gotchas worth remembering

- The lamp amber needs **two** values: `--amber` (#e8a33d) reads on the dark
  grounds, `--amber-strong` (#9a5c06) is needed for AA on the paper grounds —
  the first choice, #c87f16, only reached 2.8:1 there.
- Links are controls: the wordmark and the card titles need the 44px minimum too.
- Dialogs handle Escape on the **document**, because a button that disables
  itself while working hands focus back to the body.
- The fixed bars stack from published heights (`--quick-add-height`,
  `--tray-height`) so the dial never covers the quick-add button or the tray.
- `@vitejs/plugin-react` must be listed in `plugins`, or JSX compiles with the
  classic transform and the page dies with "React is not defined".
- The product and project screens must not claim "not found" while still
  loading; they render an empty heading until the fetch settles.
