# Long Rail Headstring — repository notes

Server-refereed 8-ball pool for the mobile web. TypeScript on Node 22, Postgres as the only
store, Kill Bill for Cash packs, Mailpit for the two published mails.

## Layout

- `src/shared/` — domain shared by server and browser: published copy (`copy.ts`), tiers and
  catalogue (`catalog.ts`), the referee (`referee.ts`), the shot simulator (`physics.ts`), table
  geometry and the loupe prediction (`table-geometry.ts`), viewer-resolved announcements
  (`view.ts`).
- `src/server/` — HTTP boundary (`http.ts`, `main.ts`), Postgres access (`db.ts`, `schema.sql`),
  ledger pairs (`ledger.ts`), live tables and settlement (`tables.ts`), SSE fan-out (`events.ts`),
  routes under `routes/`, providers under `services/`.
- `src/client/` — hand-rolled SPA: router and shell (`main.ts`), table component
  (`table-view.ts`, `table-canvas.ts`), offline practice and tutorial (`local-game.ts`), screens
  under `screens/`.
- `public/` — shell, stylesheet, manifest, bundled fonts. `scripts/build.mjs` bundles with esbuild
  into `dist/`.

## Rules of the house

- Every domain rule lives in exactly one place. Fouls, groups, turns and wins are decided only in
  `src/shared/referee.ts`; practice and the tutorial call the same function in the browser, while
  online tables call it on the server.
- Every movement of value is two ledger lines sharing a `pairId` (`src/server/ledger.ts`). Wallet
  balances are kept equal to the sum of their lines inside the same transaction.
- Published copy is never inlined in a screen; it comes from `src/shared/copy.ts`.
- Clocks are the server's: `shotClockSeconds` and `reconnectSeconds` arrive over SSE at least once
  a second and the browser never computes them.
- Scripted (grading) tables place the next scripted first ball on the starting aim line so the
  loupe, guideline and receipt read sensibly.

## Working with it

- `npm run build` then `npm start` (port 4173, honours `APP_PUBLIC_PORT`). Schema and seed are
  applied idempotently on serve.
- `npm run typecheck` runs `tsc --noEmit` in strict mode; keep it clean.
- Grading routes live at `/api/grading/*` and need the `X-Grading-Key` header.
- Outage behaviour can be exercised by starting extra instances with a bad `DATABASE_URL`,
  `SMTP_HOST` or `KILLBILL_URL` on another `APP_PUBLIC_PORT`.
