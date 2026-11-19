# Mothlight — repository notes

Visual bookmarking app: pins on boards, collaborators, undo windows, a server business
clock and a live channel. One TypeScript app: Node 22 server plus a vanilla TypeScript
browser client. Services: Postgres (every record), MinIO (image files), Mailpit (email).

## Layout

- `run.json` — install / build / serve commands (`run-manifest-v1`).
- `build.mjs` — esbuild bundles `src/server/main.ts` → `dist/server.js` and
  `src/client/main.ts` → `dist/public/app.js`, copies `index.html`, `styles.css` and the
  TikTok Sans woff2 files.
- `src/shared/` — rules both sides use: `masonry.ts` (placement), `text.ts` (tags, source
  host, query words), `time.ts` (relative time), `copy.ts` (count and toast strings),
  `types.ts` (API shapes).
- `src/server/` — `http.ts` (router, body limits, session cookie), `errors.ts` (one error
  shape), `clock.ts` (business clock), `db.ts` (pool, idempotent schema), `storage.ts`
  (SigV4 S3 client), `images.ts` (sharp), `mail.ts` (plain SMTP), `live.ts` (WebSocket hub
  plus Postgres LISTEN/NOTIFY so two instances agree), `domain/` (visibility, pins,
  boards, operations/undo, seed), `routes/`.
- `src/client/` — `core.ts` (state, api, announcements, toasts, times), `grid.ts`
  (masonry grid, keyboard, selection, drag), `exhibit.ts` (pin view and Lamp-carry),
  `dialogs.ts`, `prints.ts` (procedural SVG), `views/`.

## Rules that live in exactly one place

- Board visibility and roles: `src/server/domain/visibility.ts`.
- Masonry placement: `src/shared/masonry.ts` (worked examples in the brief verified).
- Relative time: `src/shared/time.ts`.
- Tags, source host, search words: `src/shared/text.ts`.
- Credit line (`saved_from`): `savedFrom` in `src/server/domain/pins.ts`.
- Error order: `src/server/errors.ts` plus the order the route handlers run checks in
  (401 → 404 → 403 → 415 → 413 → 409 → 410 → 422 → 503).
- Undo deadline and bulk operations: `src/server/domain/operations.ts`.

## Operational notes

- The business clock lives in `business_clock` (base instant + real reference) and is
  moved by `POST /api/grading/clock` (needs `X-Grading-Key`).
- Pins are never hard deleted: `state` goes `draft → live → deleted → gone`, so saves can
  still credit a removed original. Boards are soft deleted (`deleted_at`) for the same
  reason; memberships are kept only to answer the credit-line rule.
- Live messages are published as compact notices over `pg_notify` and rebuilt from the
  database on every instance, so a second server on the same database delivers them too.
- Demo content (Wren Hollis, Odile Marsh) is created once on a database with no people.

## Checking the app

`npm run build` runs `tsc --noEmit` first. A scratch Playwright harness (not committed)
was used for browser checks; the API can be exercised with `curl` plus the grading seed
route.
