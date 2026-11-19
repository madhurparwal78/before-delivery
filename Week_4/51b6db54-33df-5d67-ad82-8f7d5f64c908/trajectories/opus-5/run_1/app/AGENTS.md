# Celmate — repository notes

Collaborative pixel art workspace. Node 22, TypeScript everywhere, Postgres +
MinIO + Mailpit as the only services.

## Layout

- `src/shared` — the published rules, shared by server and browser: `draw.ts`
  (line, brush, shapes, fill, dither, mirror, pixel perfect), `composite.ts`
  (integer compositing and `rh`), `selection.ts`, `tags.ts`, `edges.ts`,
  `sheet.ts`, `commands.ts`, `format.ts`, `sha256.ts`. Each rule lives in exactly
  one place; never copy one into a route or a panel.
- `src/server` — HTTP server with no framework. `index.ts` routes and serves
  `dist/web`; `ops.ts` sequences every sprite operation; `sprite.ts` reads sprite
  state; `routes/*` hold the API; `jobs.ts` renders exports; `storage.ts` is a
  small SigV4 S3 client; `mail.ts` is an SMTP client over a Postgres outbox.
- `src/web` — vanilla TypeScript. `workspace/` holds the stage, panels and
  dialogs; `pages/` the other screens; `styles.css` the whole visual language.
- `scripts/build.mjs` — esbuild for both bundles; `dist/` is the served output.

## Rules worth remembering

- Every sprite operation goes through `spriteTransaction` → `recordOperation`,
  which bumps `sprites.seq` under a row lock and queues live events that publish
  after the commit.
- Undo is server-side per person per sprite: operations carry a `patch` and a
  `stack_state` of `active`, `undone` or `dropped`.
- The browser recomputes the composite and its SHA-256 locally from the same
  shared code, so `data-composite-hash` always matches the pixel route.
- Live updates use one SSE hub (`live.ts`) filtered by sprite, project, person,
  share token or job.
- The business clock lives in Postgres (`clock` table) and is read through
  `clock.ts`; no server-side rule reads the wall clock directly.
- Lists that rebuild (frames, layers, palette, tilemap) must keep keyboard focus:
  use `keepingFocus` from `web/dom.ts`.

## Running

```
npm ci && npm run build && npm run serve   # port from APP_PUBLIC_PORT, else PORT, else 4173
npm run typecheck
```

A first start with no people generates the demo project (`src/server/demo.ts`),
which is deterministic — never add randomness there.
