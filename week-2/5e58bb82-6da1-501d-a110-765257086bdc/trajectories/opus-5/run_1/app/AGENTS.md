# Swathdeck — repository notes

Survey-fleet console for Fathomwright Survey Works. Node 22 + TypeScript, no framework.

## Layout

- `run.json` — run manifest (`npm ci` / `npm run build` / `npm run start`).
- `scripts/build.mjs` — esbuild: server bundle (ESM, deps external) + client bundle + fonts/css/html copy.
- `src/shared/` — types, published copy strings, number rounding, unit conversion (used by server and client).
- `src/server/domain/` — one module per domain rule (see "One decision per rule" below).
- `src/server/` — db, storage (hand-rolled S3 SigV4), mail (hand-rolled SMTP), http, routes.
- `src/client/` — vanilla TS SPA.

## Environment (dev services)

`postgres:5432` (gf_dev), `minio:9000` (bucket `gf-dev`), `mailpit:1025`. All read from env in `src/server/config.ts`.

## Verified facts

- Plan derivation matches both published seed examples exactly:
  - Calderhaven North Basin: W 40, S 32, 13 lines of 300 m, X01 (5000,8150)→(5400,8150), 2930 s.
  - Saltmere Approach Channel: W 24, S 18, 7 lines of 600 m, X01 @ N2200, X02 @ N2400 (120 m), 3440 s.
- Seed is idempotent by id; re-running leaves 23 lines total (14 + 9).
- `pg` is CommonJS: import the default export (`import pg from 'pg'`), not named `Pool`.
- Production dependency tree is `pg` only, all MIT/ISC. Fonts come from `@fontsource/*` (OFL-1.1)
  as dev dependencies and are copied into `dist/public/fonts` at build time.
- MinIO accepts `x-amz-checksum-sha256`, so storage verifies the bytes itself.

## Development verification

Four walk-through suites live in `scripts/`. They are development tooling, not part
of the app, and each one expects a freshly seeded database.

| Suite | Needs a browser | Covers |
|---|---|---|
| `smoke.mjs` | no | Sign-in, landing and safe return, attempt limit, permissions, plan derivation, assignments, launch, ingest, coverage, CSV, breach alerts, uploads, client scope, flags, boundary, a full mission through to its report bytes and report email |
| `browser.mjs` | yes | Published screens, regions, roles and copy; breakpoints; planner keyboard flow, address mirror and undo; line plan and vessel pickers; launch list; client review; console; coverage grid; history and flags |
| `field.mjs` | yes | Infill queueing and ordering, weather hold, geofence change, handover, line re-run, link-lost alerts, abandoned and resumable uploads, and a second instance booted against dead storage and mail |
| `live.mjs` | yes | Live board updates, one-per-excursion breach cards, acknowledgement attribution, infill from the console, slipway upload, offline queue |

To run them:

```sh
npm install --no-save playwright@1.49.0   # browser suites only; keep it out of package.json
node scripts/smoke.mjs                    # with the app serving on APP_PUBLIC_URL
```

`playwright` is deliberately **not** a dependency, so `npm ci` stays small and never
downloads a browser. Chromium is launched with `{ channel: 'chromium' }` because the
headless-shell build is not present in this image.

The second instance used by `field.mjs` gets its own database through
`?options=-c%20search_path%3Ddowntest`; the `=` inside the value must be
percent-encoded or libpq silently ignores the option and the instance shares the
main schema.

Last full run: 221 + 186 + 100 + 53 = 560 checks, all passing, each suite from a
clean database.

## One decision per rule

| Rule | Module |
|---|---|
| Line plan + crossline derivation | `domain/plan.ts` (`derivePlan`) |
| Link state | `domain/linkState.ts` |
| Swath rule, coverage grid, covered length, crossline agreement, strips, holiday groups | `domain/coverage.ts` |
| Holiday label matching | `domain/holidayLabels.ts` |
| Mission/line/alert transitions + history entry | `domain/transitions.ts` |
| Infill eligibility, nearest vessel, infill geometry | `domain/infill.ts` |
| Overdue check | `domain/overdue.ts` |
| Safe-return + landing | `domain/landing.ts` |
| Sign-in attempt limit | `domain/signInLimit.ts` |
| Client projection | `domain/projection.ts` |
| Counters, mission state composition | `state.ts` |
| API error shape | `errors.ts` |
