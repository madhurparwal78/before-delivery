# Hushline — repository memory

Fernwick Software's Hushline: a support messenger for a solo indie game developer.

## Architecture

- **Runtime**: Node.js 22, npm, TypeScript strict (`tsconfig.json` has `"strict": true`), no plain JS in application source.
- **Build**: `node build.mjs` (referenced by `npm run build` in `/app/run.json`). It runs `tsc --noEmit`, bundles the server with esbuild to `dist/server/main.js`, bundles the client to `dist/client/app.js`, copies CSS to `public/assets/`, and writes `public/index.html`.
- **Serve**: `npm start` → `node dist/server/main.js`, binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173).
- **Schema**: `/app/db/schema.sql`, applied on every start; `src/server/migrate.ts` seeds only when the `games` table is empty. `schemaPath()` resolves relative to `process.cwd()` first and then relative to the bundled file, so the server works from `/app` and from `dist`.

## One-decision modules

Each domain rule lives in exactly one module and every route/screen uses that decision:

- `src/server/domain.ts` — deny-over-grant permission (`decide`, `effectivePermissions`)
- `src/server/threadStates.ts` — thread transitions
- `src/server/bucket.ts` — token-bucket arithmetic
- `src/server/idempotency.ts` — replay and conflict
- `src/server/events.ts` — event verification order
- `src/server/purchases.ts` — refund ledger and purchase status
- `src/server/sanitiser.ts` — sanitiser removal
- `src/server/linkChecks.ts` — address classing, preview fetch
- `src/server/amounts.ts` — amount formatting
- `src/server/receiptLookup.ts` — receipt comparison and paged lookup
- `src/server/inbox.ts` — inbox ordering and cursors
- `src/server/files.ts` — upload type detection, filename cleaning, download header
- `src/client/formatting.ts` — display formatting allowlist

## Conventions that bit us

- **Microsecond timestamps**: `toISOString()` truncates to milliseconds while Postgres keeps microseconds. Inbox cursors must carry the exact `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US')` value, and the sort key must `COALESCE(t.last_player_message_at, 'infinity')` so null-timestamp rows join the walk.
- **`inert` blocks hit testing**: putting `inert` on the thread list to keep a closed drawer out of the tab order also stops pointer events at every viewport. Only set it while the drawer overlay is closed on narrow viewports, and remove it on wide viewports.
- **CSP nonce**: `public/index.html` is a template; `serveIndex` injects a fresh nonce into the `<script>` tag on every response and holds that nonce for the response headers via the context's `holdNonce`.
- **Sanitiser spans**: removed spans mark only the killed character range — the offsets are in `before` coordinates and `end` is exclusive.
- **Ordering rule ids**: seeded rules use fixed ids (`rule-juno-1` … `rule-juno-6`); tests that delete and re-add a rule change its id.
- **Streams**: `/api/stream` and the forensics streams hold no Postgres connection each. All live frames fan out through `src/server/live.ts`. Pre-warm the thread-topic cache (`registerThreadTopic`) so a frame published right after subscribe is delivered, not dropped.

## Verification

`/tmp` holds Playwright probes (`pjourney.py`, `pphone.py`, `prules.py`, `phostile.py`, `ptamper.py`, `plive.py`, `poutage*.py`, `pteam.py`, `pwalk.py`, `perrors.py`, `pfinal*.py`) and API probes (`eventtest.py`, `widgettest*.py`, `stafftest.py`, `authtest.py`, `linktest.py`, `attachtest*.py`, `preplay.py`, `pstats.py`). Reset the database with `/tmp/resetdb.js` and restart the server to reseed.
