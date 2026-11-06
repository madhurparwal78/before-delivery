# Lanternline Handshake Desk — project notes

## Layout
- `src/server/` — Node 22 HTTP server (no framework): API, static pages, sweep timer.
- `src/client/` — browser app (no framework): History router, screens, dialogs/menus/sheets.
- `src/shared/` — exact-decimal money, screen formats, Unicode helpers (both sides).
- `build.mjs` — esbuild bundles `src/server/main.ts` → `dist/server/server.js` and
  `src/client/main.ts` → `dist/server/static/client-main.mjs`; `npm run build` first typechecks
  with `tsc --noEmit`.
- `run.json` — `install: npm ci`, `build: npm run build`, `serve: node dist/server.js`.

## Domain rules each live in exactly one place
- Path decision at creation: `src/server/api/cases.ts` (createCase), in the published order.
- Case state machine refusals: each endpoint checks its own state; the legal transitions are
  listed in `src/server/domain/track.ts` comments and the API rows.
- Fiat value rounding (half up to the cent, exact decimals, never float): `src/shared/decimal.ts`.
- Name normalisation and match/partial: `src/server/domain/names.ts`.
- LEI check digits: `src/server/domain/names.ts` (isValidLei).
- Signature check (HMAC-SHA256 over `t.` + raw bytes): `src/server/api/messages.ts`.
- Tier pricing: `src/server/domain/fees.ts` (unit prices in ten-thousandths of the currency).
- The handshake track: `src/server/domain/track.ts` (server computes; client renders verbatim).
- Regulator CSV: `src/server/domain/csv.ts`.
- Error shape and precedence ladder: `src/server/api/errors.ts` + route table in
  `src/server/api/route-table.ts` (auth → 404/410 → 403 → 413 → 415 → 400 → 409 → 422 → 503).

## Services
- PostgreSQL via `pg` (no ORM); schema and seed apply idempotently at boot (`domain/schema.ts`).
- MinIO via a hand-rolled SigV4 REST client (`services/s3.ts`); messages and certificates.
- Kill Bill REST under `/1.0/kb`: accounts `POST /accounts`, charges
  `POST /invoices/charges/{accountId}?autoCommit=true` (returns items, invoiceId).
- Mailpit via a small SMTP client (`services/smtp.ts`); dot-stuffing included.

## Client notes
- One breakpoint: 1120 px (CSS `@media (max-width: 1119.5px)`).
- Motion: only 160/320/640 ms (CSS vars --t-fast/--t-state/--t-travel); reduced motion ends at once.
- Panels (`client/panels.ts`): focus first control, Tab wraps, Escape restores focus, closed =
  hidden and inert (page inert while open), reopening during closing keeps the panel open.
- Session-mid-work: `client/state.ts` stash (sessionStorage) + `registerDialogOpener`/`reopenDialog`
  restore the route, the open dialog and the typed values after signing in again.
- Polling: `startPolling` every 5 s; `renderRoute` stops all pollers and closes panels on navigation.
- The track is updated in place (`client/track.ts` createTrack/update) so the token glide and ring
  fill run as browser transitions, never from script.

## Verify quickly
- `npx tsc -p tsconfig.json --noEmit` (server), client tsconfig in /tmp or include both.
- `node build.mjs && node dist/server/server.js` then `curl localhost:4173/api/health`.
- Smoke tests used during the build live in /tmp/smoke*.py (Playwright chromium is installed).
