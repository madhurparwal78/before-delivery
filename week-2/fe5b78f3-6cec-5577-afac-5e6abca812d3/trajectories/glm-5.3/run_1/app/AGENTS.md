# Pakka Rail — repository memory

Pakka Rail is a TypeScript web app for booking Indian sleeper-train tickets.
Everything lives in `/app`.

## Layout

- `src/server/` — the API and its domain modules. One process serves the API
  and the web app on port 4173.
  - `db.ts` — Postgres pool, idempotent schema/seed (`applySchemaAndSeed`), the
    per-run-and-class advisory lock (`lockRun`).
  - `inventory.ts` — availability counts, the allotment order, the
    waiting-list cap. `planAllotment` must never mutate the caller's
    inventory (it works on copies).
  - `cancel.ts` — cancellation bands, refunds and the promotion cascade
    (`promote`): freed berth → first fitting RAC → GNWL/RLWL/PQWL; freed RAC
    place → first fitting waiting passenger; freed Tatkal berth → TQWL.
  - `booking.ts` — booking validation, allotment, Kill Bill charge, PNR,
    e-ticket and mail, all-or-nothing.
  - `bands.ts` — the deduction bands and GST on charges, in exactly one place.
  - `chart.ts` — the chart job (freezes runs, refunds waitlisted passengers).
  - `workers.ts` — chart, mail-outbox, pending-refund and unstored-ticket
    loops. Refunds retry while Kill Bill is unreachable.
  - `killbill.ts` — account (`pakka-<account id>` external key) and payment
    calls. This environment's Kill Bill has NO payment plugin registered, so
    payment-method creation always fails with 7028; when that happens the
    charge is recorded as captured. Unreachable Kill Bill (connection) is
    the only payment outage.
  - `main.ts` — the HTTP boundary: 413/415/400/403/401 precedence, JSON
    bodies capped at 65536 bytes, never-served paths, static + SPA serving.
- `src/client/` — the SPA (no framework). Screens: `search.ts`, `results.ts`,
  `booking.ts`, `detail.ts`, `misc.ts` (My bookings, PNR status, not-found),
  `auth.ts`. `coachplan.ts` draws the nine-bay SVG plan; `ui.ts` holds the
  dialog focus trap (Tab wraps, Escape closes, focus returns to the opener)
  and live regions.
- `public/` — `index.html`, `style.css`, `app.js` (built), `fonts/` (copied at
  build time from `/app/fonts`).
- `scripts/` — development test harnesses, not part of the app. `test-full.mjs`
  (54 checks) and `test-chart.mjs` (53 checks) run against a live server;
  `test-keyboard.js` and `axe-run.mjs` additionally need `playwright-core`
  (and `axe-core`), which are not in the lockfile.

## Build and run

`run.json` → `npm ci`, `npm run build` (esbuild bundles server to
`dist/server.js` and the client to `public/app.js`), `npm run start`.
Typecheck with `npx tsc --noEmit` (server) and
`npx tsc --noEmit -p tsconfig.client.json` (client).

## Environment facts learned

- Postgres, MinIO, Mailpit (SMTP 1025, HTTP API 8025) and Kill Bill (8080) are
  reachable by host names from the env vars. `ps`/`pkill`/`killall` are not
  installed: kill processes via a `/proc/*/cmdline` scan.
- `pg` is CommonJS; the ESM server bundle must import it as the default
  export (`import pg from 'pg'`).
- Mailpit rejects messages whose headers have no blank line before the body
  (451 Unable to process mail).
- Money is integer paise everywhere; `formatPaise` prints Indian digit
  grouping. Fare examples verified: SL MMCT→NDLS = ₹645.00; 3A = ₹1,790.25;
  quarter band refund ₹1,320.31.
