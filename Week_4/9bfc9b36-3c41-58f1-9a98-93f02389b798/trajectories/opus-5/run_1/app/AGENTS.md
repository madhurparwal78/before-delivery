# Boltrope — repository notes

A loft workbench for one sailmaker. TypeScript on Node 22, no framework on either side.

## Layout

- `run.json` — run manifest (`run-manifest-v1`).
- `src/` — server (CommonJS, `tsconfig.json`), entry `src/server.ts`.
- `src/shared/` — modules shared with the browser bundle (`copy.ts`, `units.ts`). No Node APIs here.
- `web/` — browser bundle (`tsconfig.browser.json`), bundled by esbuild to `dist/public/app.js`.
- `public/fonts/` — self-hosted Red Hat Display / Red Hat Text woff2 (OFL-1.1).

## Single-place domain rules

| Rule | Module |
|---|---|
| unit conversion, rounding, screen grouping | `src/shared/units.ts` |
| every published copy string | `src/shared/copy.ts` |
| inch + feet-and-inches parsing, unit-slip guard | `src/domain/inches.ts` |
| exact rounding of surds for the construction | `src/domain/surd.ts` |
| sail areas and `basis` | `src/domain/areas.ts` |
| crosscut panel construction | `src/domain/panels.ts` |
| first fit, overlap, clamping | `src/domain/nest.ts` |
| drawing transitions and step derivation | `src/domain/transitions.ts` |
| refusal ladder | `src/http/errors.ts` |
| owner projection | `src/domain/projection.ts` |
| ledger pairing, totals, cursors | `src/domain/ledger.ts`, `src/domain/cursor.ts` |
| CSV neutralisation | `src/domain/csv.ts` |
| cut-sheet render + store confirmation | `src/domain/cutsheet.ts`, `src/services/store.ts` |
| sail account figures | `src/domain/sailaccount.ts` |
| tape standing | `src/domain/standing.ts` |
| loft working days | `src/domain/workdays.ts` |

## Shape of the server

- `src/server.ts` binds the port, then keeps retrying Postgres and Keycloak on a
  2 s ticker, reconciles seeded realm users every 15 s and retries every
  `pending_store` drawing every 5 s. A failure is never cached.
- `src/http/router.ts` is the only request pipeline: address/method table first,
  then 413, 415, the caller, then the handler. `src/http/respond.ts` owns the
  header set, so every 404 is byte-identical.
- `src/api/routes.ts` is the whole published surface.

## Verified worked examples

- Panel construction reproduces BR-0191 (14 panels), BR-0132 (9) and BR-0141 (10) exactly.
- First fit reproduces both published tables (BR-0132 on R-02; BR-0141 on R-14 giving
  `used_mm` 3165, tail 35, panel sum 4 244 266 mm²).
- All 3300 panels over every seeded boat × cloth × rule set are convex, so the
  separating-axis overlap test is exact.
- Seed: 375 710 200 mm² on hand (375.71 m² / 4 044.11 ft²), ledger sum 0,
  reconciliation difference 0, 1200 ledger lines, 70 cut sheets, 0 pending_store
  after boot, B-11 P flagged Remeasure due 2026-11-05.
- BR-0071's sail account: charge 138 235, tax 27 647, total 165 882, deposit 66 353.
- Standing reproduces the seeded table exactly, ranks and streaks included.
- Confirm cut on BR-0132 over R-02 posts the three published pairs and makes
  offcut O-09 of 7 872 mm at lot L-2602.

## Environment

`DATABASE_URL`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`,
`AUTH_CLIENT_SECRET`, `S3_*`, `CLAIM_HOLD_SECONDS`, `OWNER_*`. Port 4173 or `APP_PUBLIC_PORT`.
