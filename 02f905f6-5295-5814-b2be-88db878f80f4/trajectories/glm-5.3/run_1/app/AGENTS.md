# Shelfmark — Brickfield Lane Clayhouse

Shelfmark is the firing desk for Brickfield Lane Clayhouse: member piece
intake with live fee quotes, a true-scale kiln load board, firing lifecycle
with server-decided cool-downs, guest counter drop-offs with private tracking
links, pickup shelf management, damage settlement, and rates/profile admin.

## Layout

- `server/` — TypeScript server (Node 22, ESM). Entry `server/main.ts`.
  - `config.ts` — all environment config; no credential is hard-coded.
  - `db.ts` — schema + idempotent seed (advisory-lock guarded).
  - `rules.ts` — measuring, fee arithmetic (exact decimals, one rounding step),
    cone ordering, fill percent, firing schedule. Each rule lives once here.
  - `geometry.ts` — shelf circle, posts, footprint overlap/edge rules.
  - `store.ts` — Postgres data access, piece/firing views, sweeps.
  - `killbill.ts` — Kill Bill client (accounts, external charges, void, payments).
    Owed = the sum of per-invoice balances read back fresh.
  - `storage.ts` — MinIO (photos stored byte-for-byte, confirmed by read-back).
  - `mail.ts` — raw SMTP client for Mailpit (minimal EHLO/MAIL/RCPT/DATA/QUIT).
  - `routes.ts` — every API endpoint; single error shape; idempotency keys.
  - `main.ts` — boot, server boundary, static serving (dist-web only),
    background sweeps (firing status 3s, outbox 10s).
- `web/` — React (Vite) browser app. Screens under `web/screens/`.
  - `api.ts` — typed fetch client; `shared.tsx` — cone glyph, status chips.
  - `styles.css` — bisque ground / umber ink / terracotta accent tokens,
    Fraunces + IBM Plex Sans + IBM Plex Mono via @fontsource (bundled).
- `dist-web/`, `dist-server/` — build outputs (git-ignored concerns aside).
- `run.json` — `npm ci` / `npm run build` / `npm run start`.
- `THIRD_PARTY_NOTICES.md` — every shipped prod package + bundled fonts.

## Key behaviours

- Studio time is America/Chicago; every time-dependent status is computed
  server-side. `FIRING_HOUR_SECONDS` and `PICKUP_DAY_SECONDS` scale the clocks.
- The fee is exact-decimal: cm÷2.54 → round up each side to 0.5 in → plate
  height floor 1.5 in → one half-up rounding to cents → order minimum.
- Placement refusals run in order: stage, clay, cone, height, edge, post,
  overlap — in `routes.ts` `checkPlacement`, previewed client-side on the board.
- Intakes are all-or-nothing: photo (storage read-back), charge (Kill Bill),
  receipt (SMTP) — a receipt failure voids the invoice; 503 names the step.
- Emails to guests and members: receipts inline; ready notices, reminders and
  new-link emails go through the Postgres outbox (exactly-once via UNIQUE key).

## Dev commands

- `npm run typecheck` — `tsc --noEmit` over server + web + vite config.
- `npm run build` — vite build then tsc server emit.
- Services: Postgres, Kill Bill (0.24, `/1.0/kb`, external payment method via
  `POST /invoices/{id}/payments?externalPayment=true`), MinIO, Mailpit SMTP 1025.
