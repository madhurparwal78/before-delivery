# Boltrope project notes

## Environment
- Postgres, Keycloak (realm `gf-dev`, client `app`), MinIO reachable by hostname from /app.
- `app` Keycloak client has realm-management `manage-users` (service account) — user CRUD needs no master admin.
- Keycloak realm requires firstName/lastName on users, else password grant fails with "Account is not fully set up".
- Password grant needs `scope=openid email profile` for the `email` claim.

## Build
- `npm run build` = tsc + copies `src/server/schema.sql` to `dist/server/` (schema.sql is read at boot via import.meta.url).
- Serve: `node dist/server/boot-main.js` (run.json's serve). Port 4173 (APP_PUBLIC_PORT).

## Domain facts (verified against the brief's worked examples)
- Panel construction, areas, inch/feet-inches conversion and first-fit tuck all match: BR-0132 panels, BR-0141 panels 1/3/9/10, `38' 1 1/2"` → 11621, money 1382.35 etc.
- Overlap test: touching edges allowed; probes (vertices, edge midpoints, triangle centroids) must skip boundary points of the other outline.
- Standing table reproduces: Maren 27/22/1/1/18 True tape, etc.
- Seed: 9 accounts, 24 stock, 1200 ledger lines, 122 submissions, 240 drawings (after boot: 0 pending_store, 70 issued).

## Gotchas
- `nextCode` sequences live in the DB; codes are zero-padded (B-13, BR-0241, R-17, O-09, S-0123, G-0061, A-10).
- Route order matters: register `/api/stock/summary` before `/api/stock/:code`.
- Express mounts at `/api` — use `req.baseUrl + req.path` for full path matching.
