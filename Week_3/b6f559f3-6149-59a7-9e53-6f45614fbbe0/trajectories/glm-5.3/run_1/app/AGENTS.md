# Halation Studio — repository notes

## What this is

Halation Studio is a browser editor for layered, interactive 2D and 3D hero
scenes. One TypeScript server (`src/server`) serves the API, the WebSocket hub
and the built client; the domain rules (`src/domain`) are shared verbatim by
the server and the client.

## Layout

- `src/domain` — the published rules, decided once and reused everywhere:
  `kinds.ts` (types), `props.ts` (property table + defaults), `format.ts`
  (number/time formatting), `copy.ts` (every published string), `easing.ts`,
  `math3d.ts` (transforms + projection), `font.ts` (Halation Block glyphs),
  `extrusion.ts`, `particles.ts`, `cloth.ts`, `gltf.ts`, `composite.ts`
  (2D compositing + Sample), `evaluate.ts` (the one evaluator), `changes.ts`
  (apply/invert changes for undo).
- `src/server` — config, schema, clock, errors, S3 client (SigV4, no SDK),
  mailer (outbox + SMTP), hub, store, validate, readouts, seed, routes.
- `src/client` — `main.ts` (router), `landing.ts`, `screens.ts`,
  `editor.ts`, `invite.ts`, `embed.ts`, `followlight.ts`, `stage.ts`
  (WebGL2 + 2D fallback), `meshes.ts`, `dom.ts`, `styles.css`.
- `scripts/` — the API test suites; all of them reseed and can be run in any
  order while the server is up:
  - `smoke.mjs` — sessions, visibility, ops/undo, publish, embed, invites,
    imports, trash (58 checks)
  - `worked.mjs` — every published worked example through `/inspect`
    (34 checks)
  - `upload.mjs` — image/SVG/model uploads and every refusal (16 checks)
  - `outage.mjs` — storage and mail outage behaviours; expects a second
    server copy on :4599 with a bad `S3_ENDPOINT` and one on :4601 with a
    bad `SMTP_HOST` (15 checks)

## Commands

```
npm ci          # install from the lockfile
npm run build    # tsc for the server + esbuild for the client
npm run serve    # node dist/server/server/main.js (port 4173)
node scripts/smoke.mjs
```

The build writes ESM to `dist/server` and fixes the extensionless relative
imports that `tsc` emits; the client bundle lands in `dist/public`.

## Things that bit us, worth remembering

- `pg` and `ws` are CommonJS: import them as a namespace (`import * as ws`)
  or use the default import (`import pg`), never a named import.
- JSON string parameters going into `jsonb` columns need an explicit
  `::jsonb` cast in the SQL.
- `scenes.id` is only unique per project: the primary key is
  `(project_id, id)`, because an import keeps the document's scene and layer
  ids and a re-import of the same export must not collide.
- The particle lifetime rule: a particle born at step `b` is removed once
  `k >= b + round(lifetime*60)`, checked after the movement of that step.
- `lookAt` stores the basis along the rows of a column-major matrix; writing
  the axes into columns gives subtly wrong projections that still pass the
  axis-aligned worked examples but break the orbit ones.
- Mail accumulates in Mailpit between test runs; the suites clear it first
  or the counts drift.
