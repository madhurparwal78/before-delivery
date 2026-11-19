# Quarkyard — working notes

## Product
One-person after-school STEM business studio (3D Workshop, Circuit Bench, Block Lab).
Students join with class code + nickname (no email/password). Educator watches live via roster + Glancet.

## Environment / run
- `run.json`: `npm ci` → `npm run build` → `node dist/server.js`, port 4173.
- Postgres (DATABASE_URL), MinIO (S3_*), Mailpit (SMTP_*) from env; see `src/server/config.ts`.
- Manifold wasm/js is **vendored** at `vendor/manifold/` (Apache-2.0) — do NOT re-add manifold-3d to
  package.json; its dev chain pulls sharp (LGPL) into node_modules.
- Fira Sans TTFs live in `assets-src/fonts/` (OFL-1.1) and are copied into `dist/public/assets/fonts`
  by the build. UI icons are original inline SVGs; no icon files ship.

## Layout
- `src/server/*` — HTTP server, routes (single `routes.ts`), SigV4 MinIO client (`storage.ts`),
  SMTP client (`mail.ts`), SSE hub (`stream.ts`), grading clock (`clock.ts`).
- `src/client/*` — preact SPA. Pages under `pages/`, editors (3D/circuit/blocks) under `editors/`,
  Glancet in `viewers/glancet.tsx`, MNA circuit solver in `circuitSolver.ts`.
- `src/worker/*` — two Web Workers bundled to `dist/public/assets/{geometryWorker,exportWorker}.js`;
  they load `/assets/wasm/manifold.wasm`.
- `src/shared/*` — domain rules shared by client and server (nickname rules, classroom state
  derivation, export file naming, snapshot shapes).

## Domain rules — single sources of truth
- Classroom state from server time: `src/shared/classroomState.ts` `deriveClassroomState`.
- Nickname normalisation/validation/collision key: `src/shared/util.ts`.
- Export file name pattern: `src/shared/exportName.ts`.
- LED status thresholds (lit ≤ 20 mA, broken > 20 mA): `src/client/circuitSolver.ts`.
- Revision rule (storage-confirmed, gapless, stale 409): `src/server/routes.ts` PUT /api/projects/:id.

## Testing scripts (not part of the product)
- `scripts/smoke.mjs` — 112 API checks (run against a live server; seeds first).
- `scripts/stream-smoke.mjs` — SSE event delivery checks.
- `scripts/outage-smoke.mjs` — storage-down behaviour (also works with storage up).
- `scripts/e2e.mjs`, `scripts/e2e2.mjs` — Playwright browser suites; require playwright-core
  in a sibling dir and the headless shell at /tmp/pw (harness-only; not shipped).

## Gotchas learned
- `String.replaceAll` with a regex requires the `g` flag (or use `replace`).
- Manifold: `await Module({locateFile})` then `mod.setup()`; cylinder/sphere radii must be scaled
  so the 64-segment mesh volume equals the exact π formula (see workers).
- esbuild bundling manifold for the browser needs a stub for `node:module` (build script plugin).
- S3 SigV4 canonical query must be sorted and URI-encoded; amzDate format is `YYYYMMDDTHHMMSSZ`.
- Editors: the editor kind comes from the loaded project, not the URL query, or a circuit snapshot
  crashes the 3D Workshop.
- Dialog focus rules: Remove/Rename success land focus elsewhere than the opener
  (`useDialogA11yWithLanding`); the classroom h1 must NOT auto-focus on every render.
