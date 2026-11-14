# Eight Worlds — repository notes

Public site for the fictional Vellum Orbit Studio. Node 22 + TypeScript, no framework.

## Layout
- `src/shared/` — code used by both server and browser: content types, domain rules (`rules.ts`: gallery matching/counts, price counts, enquiry field rules, budgets), routes and query parsing (`routes.ts`), HTML renderers (`render.ts`, string templates used for SSR and client re-render).
- `src/server/` — `main.ts` boot, `server.ts` routing (404 → 405 → 415 → 413 → 400 → 422 order), `db.ts` schema + seed (advisory lock), `enquiries.ts` (replay, per-submission queue, limit, intake hand-off and intake state changes), `fileStore.ts` (hand-written S3 SigV4 client for MinIO), `files.ts` + `islands.ts` + `geometry.ts` (procedural GLB islands and SVG gallery images, uploaded when missing, retried every 10 s).
- `src/client/` — `router.ts` (SPA navigation, page controllers, world enter/leave intents), `stage.ts` (ring state machine: active world, yaw turns, camera flights, emblem angle, data attributes, scroll/drag/swipe/rail), `scene.ts` (three.js renderer), `camera.ts` (poses + easing), `focus.ts` (clear-zone scroll rule, tab trap), `menu.ts`, `pages/*`.
- `static/app.css` — the only stylesheet; fonts are copied from `@fontsource/*` (dev deps) by `build.mjs` using `fonts.mjs`.

## Commands
- `npm ci && npm run build && npm start` (see `run.json`). Build runs `tsc --noEmit` first.
- Server listens on `APP_PUBLIC_PORT` (4173). Env vars are listed in `src/server/config.ts`.

## Gotchas
- Generated scene/media files are only uploaded when missing; after changing `islands.ts` delete `scenes/*` keys from the bucket to regenerate.
- The client does not re-render `main` on the initial load (SSR markup is identical); it only mounts behaviour.
- All animation uses `requestAnimationFrame` + `performance.now()` so a paused Playwright clock controls it.
- Closed menu dialog carries `aria-hidden` + `inert` so role queries for `Menu` stay unambiguous.
- Browser testing used Playwright installed outside the repo (`/tmp/pw`), Chromium with `--use-angle=swiftshader` for WebGL.
