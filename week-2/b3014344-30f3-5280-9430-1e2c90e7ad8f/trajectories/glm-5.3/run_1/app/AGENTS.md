# Pampero Ledger — repository notes

Pampero Build Co.'s storefront and client ledger: a one-person web studio in
Buenos Aires that quotes in USD or ARS, locks the price at acceptance, bills
deposits and launch balances (or monthly care plans) through Kill Bill, and
shares brand files and deliverables through a portal.

## Stack

- Node.js 22, strict TypeScript, no `any`.
- Server: `node:http` with a hand-rolled router (`src/server/http.ts`). No web
  framework. Sessions live in Postgres (`pampero_session` cookie, HttpOnly,
  SameSite=Lax; scrypt password hashes).
- Money: exact BigInt minor units (`src/server/money.ts`). The deposit split
  (`splitDeposit`), the money format, proration, transitions, the price in
  effect, the refund cap and the upload allowlist are each decided in exactly
  one module.
- Client: `src/client/main.ts` (esbuild bundle) + `app.css` + a three.js
  procedural 3D stage (`src/client/scene.ts`). No external hosts; fonts ship
  from `@fontsource` packages.

## Build and run

`run.json` drives everything: `npm ci`, `npm run build` (tsc + esbuild client
bundle + font copy), `npm start` (binds 0.0.0.0 on `APP_PUBLIC_PORT`, default
4173). Schema, billing catalog, CMS collection and seed data apply on serve,
idempotently, and retry while a service is down.

## Services and the facts learned against them

- **Kill Bill 0.24.21** (tenant `gfkit-dev`). Catalog upload is
  `POST /1.0/kb/catalog/xml` with `Content-Type: text/xml`. The per-tenant
  catalog XML uses `<catalogName>`, `<changePolicyCase>/<policy>`,
  `<changeAlignmentCase>/<alignment>`, `<cancelPolicyCase>/<policy>`,
  `<createAlignmentCase>/<alignment>`, `<billingAlignmentCase>/<alignment>`
  (billing alignment enum is only ACCOUNT/BUNDLE/SUBSCRIPTION),
  `<price><currency>USD</currency><value>149.00</value></price>` and
  `<priceLists><defaultPriceList name="DEFAULT">`. Validate drafts against
  `POST /1.0/kb/catalog/xml/validate` — its errors are far more precise than
  the 400 from the upload.
  - Account: external key `pampero-<account id>`, `AUTO_PAY_OFF` control tag
    (`POST /accounts/{id}/tags` with `["00000000-0000-0000-0000-000000000001"]`),
    one default `__EXTERNAL_PAYMENT__` payment method.
  - Build invoices: `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=true`
    with an array of `{description, amount, currency}` items.
  - Payments: authorize at `POST /accounts/{id}/payments?paymentMethodId=…`
    and capture at `POST /payments/{id}?paymentMethodId=…`; a REFUND goes to
    `POST /payments/{id}/refunds`. Purchases never link to an invoice, so
    after every capture settle the invoice with
    `POST /invoices/{id}/payments` carrying `targetInvoiceId`, `accountId`,
    `currency`, `paymentExternalKey` and `transactions[0]` — without
    `targetInvoiceId` it answers 204 "nothing to pay for".
  - Subscriptions take native `priceOverrides`
    (`[{planName, phaseName: "<plan>-evergreen", phaseType: "EVERGREEN",
    recurringPrice}]`); the plan becomes `<plan>-N`. Backdate with
    `?entitlementDate=…&billingDate=…` (ISO) — a same-day seed must omit the
    date so the subscription starts now, or it stays PENDING.
  - Plan change (IMMEDIATE): the change invoice holds REPAIR_ADJ (credit,
    calendar-day proration that matches days-left/days-in-period) plus the
    prorated RECURRING item; a negative total turns into account credit
    (CBA_ADJ) automatically.
  - Pause: `PUT /bundles/{id}/pause?requestedDate=YYYY-MM-DD`. Resume only
    drops a *scheduled* pause when requested at the pause's own date;
    resuming at an earlier date is a silent no-op.
  - End-of-term cancel: `DELETE /subscriptions/{id}?entitlementPolicy=END_OF_TERM&billingPolicy=END_OF_TERM&useRequestedDateForBilling=true`
    — the subscription stays ACTIVE with `cancelledDate`/`billingEndDate` at
    the charged-through date, so pending_cancel is derived from those.
  - Account CBA: `GET /accounts/{id}?accountWithBalanceAndCBA=true`. Credits
    (`POST /1.0/kb/credits?autoCommit=true`) auto-apply to open invoices.
  - `GET /1.0/healthcheck` answers 500 with healthy content while the tenant
    bus settles; treat 500 as up there.
- **PocketBase** (CMS `entries` collection): admin auth is
  `POST /api/admins/auth-with-password` with `{"identity","password"}`.
  `/api/collections` lists are paginated `{items:[…]}` — do not treat the
  response as an array.
- **MinIO**: plain SigV4 single-shot PUT/GET/HEAD/DELETE works for everything
  ≤ 10 MB; no multipart needed.
- **Mailpit**: SMTP on 1025; `HELO` then `MAIL FROM`/`RCPT TO`/`DATA`.

## Domain rules to keep in one place

- `domain.ts`: plans, the 40/60 deposit split (`splitDeposit`), order and plan
  transitions.
- `money.ts`: the money format (USD `1,999.99`, ARS `2.350.617,28`) and
  amount strings.
- `pricing.ts`: the price in effect.
- `plans.ts`: care proration (whole Buenos Aires days left in the period).
- `cards.ts`: card validation and the simulated decline by last four.
- `files.ts`: the upload allowlist (content sniffing, SVG script rules).
- `api-orders.ts`: `withIdempotency` — only 2xx is stored, replays carry
  `Idempotent-Replayed: true`, mismatched bodies 409.
- `pay.ts`: the all-or-nothing Pay — lock, authorize, folder, ledger write,
  capture, then commit; any failure voids the authorization and the invoice.

## Gotchas learned the hard way

- `JSON.stringify` throws on BigInt — never put an `Amount` object in an API
  response; serialize with `amountToString`.
- Kill Bill's subscription `chargedThroughDate` moves forward when the next
  period is invoiced in advance; the open renewal is the invoice with a
  balance, not the one before charged-through.
- Bundle resume before the pause's date does nothing (see above).
- `pg` is CommonJS: `import pg from 'pg'; const { Pool } = pg;`.
- The 409-on-conflict semantics for concurrent Pays rely on
  `FOR UPDATE NOWAIT` (`tryLockOrder`) and error code `55P03`.
- Dunning attempts are claimed atomically
  (`UPDATE … WHERE attempted_at IS NULL RETURNING`) so several processes never
  double-charge or double-notify.
- Contractors lose a project the moment it closes: the projects list filters
  `closed_at IS NULL` for them, and `loadVisibleProject` answers
  `access_ended` for the project, its files and links issued earlier.
- `DUNNING_DAY_SECONDS` shrinks the dunning clock for testing the whole
  retry/cancel cycle without waiting real days.

## Testing helpers (scratch, not shipped)

- `/tmp/scratch/api-test.py` — end-to-end API suite (82 checks).
- `/tmp/scratch/page-test.py` — SSR page suite (24 checks).
- `/tmp/scratch/reset.py` — wipe the ledger, the seeded billing accounts and
  the CMS entries for a clean reseed.
