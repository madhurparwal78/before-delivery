# Afterglass — repository notes

Afterglass is a browser VJ studio: a layer tree, GLSL layers, a node graph, a beat-locked timeline,
sandboxed scripts, uploaded models and textures, live co-editing, published show versions and
exports. TypeScript everywhere, Node 22, no framework on the server.

## Layout

```
run.json              install / build / serve manifest (npm ci, npm run build, npm run start)
scripts/build.mjs     esbuild: server bundle, browser bundle, fonts, static files, stylesheet
src/shared/           domain terms shared by the server and the browser
  domain.ts           ticks, bars:beats, value ranges, copy strings, property labels
  defaults.ts         layer kind defaults (props, material, output buses)
  types.ts            set document, ops, assets, show versions
src/server/
  index.ts            boot, route table, static serving
  http.ts             router, body limits, origin check, replies
  errors.ts           the one API error shape
  config.ts           environment only; never hard-coded, never sent to the browser
  db.ts               pg pool, idempotent schema, withTransaction
  storage.ts          minimal SigV4 MinIO client (put/head/get/delete, putAndConfirm)
  collab.ts           Valkey: lock leases, presence, pub/sub, health
  events.ts           SSE hub, fan-out through Valkey
  api/                one module per endpoint group
  domain/             op engine (ops.ts) and its appliers, documents, bundles, activity
src/web/
  store.ts            editor state, op queue wiring, stage loop, locks, presence
  opqueue.ts          offline queue in localStorage, replayed in order exactly once
  document.ts         client-side op application (mirrors the server)
  graph.ts            node graph evaluation, key interpolation
  sandbox.ts          script sandbox (no page, storage or network access)
  gl/                 WebGL2 renderer, geometry, GLB parser, matrices
  components/         shell, panels, dock editors, pages
```

## Rules that live in exactly one place

- Value ranges and their messages: `src/shared/domain.ts` + `src/server/domain/validate.ts`.
- Layer kind defaults: `src/shared/defaults.ts`.
- bars:beats and seconds: `barsBeats` / `playheadReadout` in `src/shared/domain.ts`.
- Stale-version check: `checkBaseVersion` in `src/server/domain/version.ts`.
- Op commit (op row + gapless sequence + version bump in one transaction): `commitOp` in
  `src/server/domain/ops.ts`; every op type goes through it.
- Lock lease grant/renew/release: `src/server/collab.ts`.
- Live pointer moves: `movePointer` in `src/server/api/shows.ts`.
- Dependents count: `dependentsBySet` in `src/server/domain/document.ts`.

## Working locally

```
npm ci && npm run build && npm run start      # port 4173, or APP_PUBLIC_PORT
curl localhost:4173/api/health
```

Services come from the environment: `DATABASE_URL`, `S3_*`, `VALKEY_URL`. The schema is applied on
every start. To see the degraded-service behaviour, start a second instance with unreachable
`S3_ENDPOINT` / `VALKEY_URL` on another port rather than touching the provided service config.

## Verification notes

- `npm run typecheck` runs the server and browser TypeScript projects separately
  (`tsconfig.server.json`, `tsconfig.web.json`); the browser project has no Node types.
- Browser journeys were checked with Playwright Chromium using
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` so WebGL2 works headless.
- The canvas carries `data-frame` and `data-gizmo-x|y|z`; they are written imperatively from the
  stage loop, not through React state, so playback stays at display frame rate.
