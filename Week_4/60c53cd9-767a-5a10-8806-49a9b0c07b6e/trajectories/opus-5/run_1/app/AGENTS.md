# Highwater Unit Finder — repository notes

Orrin & Vale Developments' unit finder for the 38-storey Highwater tower.
Postgres is the source of truth, MinIO stores the tower models, textures and
view photographs, and Meilisearch answers faceted search.

## Running it

```
npm ci          # install
npm run build   # esbuild: dist/server.js and dist/public/*
node dist/server.js
```

`/app/run.json` holds those three commands. The server binds `0.0.0.0` on
`APP_PUBLIC_PORT` (default 4173) and answers `GET /api/health`.

Every service URL, credential, clock and timing setting is read from the
environment in `src/server/config.ts`. The only configuration the browser is
given is the sales-office zone, inlined as `#hw-display` so the server and the
browser format times by the same rule.

## Layout

```
src/shared    domain rules both sides share: unit shape and seed prices,
              derived area and price figures, bearing-to-facing, sales-office
              time, status and chip copy, search input bounds, error catalogue
src/server    config, app clock, Postgres schema and seeding, the one error
              shape, the lapse check, holds, prices, bands, photos, search,
              storage (hand-rolled SigV4), media tokens, routes, pages
src/client    router, landing, finder (filters, tower, results, detail, holds),
              hold page, shared page, console, three.js stage, floor grid
```

## Rules that live in exactly one place

- unit and hold state transitions: `src/server/domain/{holds,bands,prices}.ts`
- the lapse check every read and write applies: `src/server/domain/lapse.ts`
- derived figures and the facing label: `src/shared/derived.ts`
- hold attempts, cooldown and the search limit: `src/server/domain/limits.ts`
- search input bounds and the `q` rule: `src/shared/searchInput.ts`
- the available count: `src/server/domain/units.ts`
- sales-office time and its AEDT/AEST choice: `src/shared/salesOfficeTime.ts`
- the error shape and its precedence: `src/server/errors.ts`, `http/router.ts`

## Things worth knowing

- Bearings are derived once from the generated floor-plate models' `window-<stack>`
  nodes (`assets/glb.ts`), not from a table of numbers.
- Idempotent hold responses are stored as their exact body text, so a replay is
  byte-identical.
- Concurrency is decided by Postgres: partial unique indexes for one active hold
  per unit and per buyer, `for update` on the unit row for every write that
  touches it, and version-guarded price updates.
- The tower cells are a real ARIA grid of DOM elements positioned over the 3D
  canvas, so hover, focus, keyboard stepping and the floor-grid fallback all use
  one implementation.
- Seeded view photographs are rendered procedurally at start, uploaded if
  missing, and confirmed against the stored object's size and MD5 ETag.
