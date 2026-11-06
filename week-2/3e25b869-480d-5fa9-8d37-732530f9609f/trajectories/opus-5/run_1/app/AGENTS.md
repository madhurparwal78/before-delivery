# Loafline — Pain de Lune shop (repo memory)

## Environment
- Services reachable by hostname: `postgres:5432`, `killbill:8080`, `mailpit` (SMTP 1025, HTTP 8025).
- System clock in this sandbox is **2026-10-30** (matches the brief's examples).
- Kill Bill tenant already exists for `KILLBILL_API_KEY`; catalog starts empty.

## Kill Bill recipes verified by probing (0.24-style API)
All calls need basic auth + `X-Killbill-ApiKey` / `X-Killbill-ApiSecret` / `X-Killbill-CreatedBy`.

- **Catalog upload**: `POST /1.0/kb/catalog/xml`, `Content-Type: text/xml`. The phase must wrap the
  billing period in `<recurring>`: `<finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration>
  <recurring><billingPeriod>MONTHLY</billingPeriod><recurringPrice>…</recurringPrice></recurring></finalPhase>`.
  Without the `<recurring>` wrapper the server answers 400 "Invalid catalog".
- **Account**: `POST /1.0/kb/accounts`; look up by `GET /1.0/kb/accounts?externalKey=<email>`.
- **Default payment method**: `POST /1.0/kb/accounts/{id}/paymentMethods?isDefault=true`
  with `{"pluginName":"__EXTERNAL_PAYMENT__","pluginInfo":{}}`.
- **Tags matter.** A committed invoice is auto-paid with Kill Bill-generated external keys unless the
  account carries `AUTO_PAY_OFF` (`00000000-0000-0000-0000-000000000001`). Recurring invoices are
  auto-committed unless the account carries `AUTO_INVOICING_DRAFT` (`…-000000000008`). Both tags are
  set on every account so the app owns the payment external keys and can add tax items.
- **Drop order**: `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=false` (array of items, all land
  on one DRAFT invoice) → `POST /1.0/kb/invoices/taxes/{accountId}?autoCommit=false` with
  `invoiceId` on each item (itemType `TAX`) → `PUT /1.0/kb/invoices/{invoiceId}/commitInvoice`.
- **Payment with both external keys**: `POST /1.0/kb/accounts/{accountId}/payments`
  `?controlPluginName=__INVOICE_PAYMENT_CONTROL_PLUGIN__&pluginProperty=IPCD_INVOICE_ID%3D<invoiceId>`
  body `{"transactionType":"PURCHASE","amount":…,"currency":"CAD","paymentExternalKey":…,"transactionExternalKey":…}`.
  `POST /1.0/kb/invoices/{id}/payments` ignores the transaction external key, so it is not used.
- **Refund with item adjustments**: `POST /1.0/kb/invoicePayments/{paymentId}/refunds`
  `{"paymentId":…,"amount":…,"currency":"CAD","isAdjusted":true,"adjustments":[{"invoiceItemId":…,"amount":…}]}`.
- **Account credit**: `POST /1.0/kb/credits?autoCommit=true` with a **list** of
  `{"accountId":…,"amount":…,"currency":"CAD","description":"Goodwill CR-…"}`. Credit becomes CBA and
  Kill Bill applies it automatically when the draft subscription invoice is committed.
- **Subscription**: `POST /1.0/kb/subscriptions?callCompletion=true&timeoutSec=…`
  `{"accountId":…,"externalKey":"SUB-…","planName":"trio-monthly"}`.
- **Blocking state**: `POST /1.0/kb/subscriptions/{id}/block?requestedDate=<ISO instant>`
  with `{"stateName":…,"service":"loafline","isBlockBilling":…,"isBlockEntitlement":false,"isBlockChange":false}`.
  The `effectiveDate` **body** field is ignored — the date must go in the `requestedDate` query param.
- **Plan change (dated)**: `PUT /1.0/kb/subscriptions/{id}?requestedDate=YYYY-MM-DD` `{"planName":…}`.
  Undo a pending change with `PUT /1.0/kb/subscriptions/{id}/undoChangePlan`.
- **Cancel (dated)**: `DELETE /1.0/kb/subscriptions/{id}?requestedDate=YYYY-MM-DD&useRequestedDateForBilling=true`
  — stops entitlement and billing on that date with no repair credit.

## Layout
- `src/shared` — copy, formatting and types used by both server and browser.
- `src/server` — HTTP, routes, domain rules, Kill Bill / SMTP / outbox services.
- `src/client` — browser app (vanilla TS) including the WebGL loaf.
- `scripts/build.mjs` — esbuild bundle for both sides plus font/asset copy.

## Conventions
- Every domain rule lives in exactly one module under `src/server/domain`.
- Request bodies are declared once per route as a shape built from `src/server/http/body.ts`
  readers; the same declaration rejects unknown keys and reads the accepted ones.
- All money is integer cents end to end (`src/shared/money.ts`).
- JSONB does not keep key order, so every stored document is rebuilt through
  `src/server/repo/normalize.ts` before it leaves the API. The idempotency response column is `json`
  (not `jsonb`) for the same reason.
- The browser app never re-renders a page to show new data. Every live string is registered with
  `bind()` in `src/client/ui.ts`; `refresh()` rewrites them in place, which is what keeps the loaf
  figure from moving when the language changes and keeps focus where the user left it.

## Loaf scene notes
- The camera is orthographic with a 14° downward pitch and no perspective. That is deliberate: at
  yaw 0 every side face is exactly edge-on, so a sold bar's gap shows only the page's ground colour,
  which is what DP-14 measures. A perspective camera would leak neighbouring side faces into the gap.
- `data-bar-spans` is computed analytically from the same projection the shader uses
  (`project()` in `src/client/loaf/geometry.ts`), never read back from pixels.
- Fraunces ships no tabular figures, so `@font-face` "PDL Figures" maps U+0030–0039 to Instrument
  Sans and headings list it first.

## Verifying locally
- `appstart`/`appkill` (written to `/usr/local/bin` during development) start and stop the server.
- `/tmp/reset-all.sh` wipes the app schema, the Kill Bill tenant's business data and Mailpit.
- Outage paths are exercised by running a second instance behind killable TCP proxies
  (`/tmp/proxy.mjs`, `/tmp/outage.sh`) rather than by stopping the shared containers.
