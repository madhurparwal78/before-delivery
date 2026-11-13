# Gloamwork Shot Rig — repository notes

## What this is
The studio site, client portal and Shot Rig for Gloamwork, built to the brief in the task
description. TypeScript throughout; `dist/` is build output only.

## Layout
- `src/shared/` — contracts used by both sides: `errors.ts` (every published code and copy),
  `money.ts` (currency table, conversion, VAT, milestone split, display format),
  `domain.ts` (shot order, milestones, states, view shapes), `format.ts` (readouts, dates,
  FX and pay-by lines), `decimal.ts` (exact rationals for dimensions).
- `src/server/domain/` — one place per domain rule: `glb.ts` (GLB acceptance, dequantization,
  bounding box), `states.ts` (transitions and guards), `fx.ts` (rate in effect),
  `quote.ts` (quote build and the title rule), `refunds.ts` (allocation),
  `invoices.ts` (payable, voidable, overdue), `cards.ts`, `intake.ts`, `landing.ts`, `signin.ts`.
- `src/server/db/` — Postgres schema and repositories. `src/server/services/` — one client per
  backing service. `src/server/app/` — the business flows (billing, review, intake, measure,
  outbox worker, seeds, status). `src/server/serialise.ts` turns rows into the published view shapes;
  `src/server/routes/` + `src/server/views/` — HTTP and SSR.
- `src/client/` — `core.ts` (api, dialogs, tween, forms), `chrome.ts` (nav, search, outage,
  marquee), `scenes.ts` (all WebGL scenes through one shared renderer blitted per canvas),
  `rig.ts`, `home.ts`, `pages.ts`, `main.ts`.

## Environment facts worth remembering
- PocketBase here is the 0.22-era API: admin auth at `/api/admins/auth-with-password`, and
  collections are created with a `schema` array whose `json` fields need `options.maxSize`.
- Kill Bill: health is `/1.0/healthcheck` (not under `/kb`). `POST /1.0/kb/invoices/{id}/payments`
  takes no top-level `transactionExternalKey`, and may answer 200 with an empty body, so the
  payment is then re-read by its external key. Account invoice lists need
  `includeVoidedInvoices=true` and do not carry items, so each invoice is re-read for its items.
  Account blocking states are read from `GET /1.0/kb/accounts/{id}/block`.
- MinIO/S3 access is hand-rolled SigV4 with `UNSIGNED-PAYLOAD`; uploads stream through
  multipart uploads so nothing lands on local disk, and a refusal aborts the upload.
- SMTP and the Gotenberg/Meilisearch/ntfy calls are plain `fetch`/sockets; no SDKs.
- `[hidden]` needs `display: none !important` in this stylesheet because component rules set
  `display: flex` and would otherwise win.

## Working with it
- `npm run build` then `npm run start` serves on port 4173.
- `node scripts/run-ts.mjs <entry.ts>` bundles and runs a TypeScript entry against the live
  services; `scripts/e2e.ts` is the end-to-end API check and must stay green.
- `npx tsc --noEmit` is strict and has `noUnusedLocals`, which is the main guard against dead code.
