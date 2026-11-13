# Halation Studio — repository notes

Halation Studio is a browser editor for layered 2D and 3D hero scenes with
numbered, immutable publishing. One TypeScript server serves the API, the
single-page app, the embed pages and the live WebSocket channel.

## Layout

```
run.json                 install / build / serve manifest
scripts/build.mjs         esbuild: dist/server.js and dist/public/app.js
src/shared/               domain rules shared by server and browser
src/server/               HTTP API, PostgreSQL, MinIO, SMTP, WebSocket hub
src/client/               app shell, landing, projects, editor, embed
src/client/static/app.css the whole stylesheet
scripts/*-suite.mjs       verification suites (see below)
```

## Where each domain rule lives (one place each)

| Rule | File |
| --- | --- |
| Property table, ranges, steps, field names, overridability | `src/shared/properties.ts` |
| Number, time, date and colour formatting | `src/shared/format.ts` |
| Every refusal and status text | `src/shared/messages.ts` |
| Easing presets, spring integration | `src/shared/easing.ts` |
| Transforms, camera projection, primitives | `src/shared/math3d.ts` |
| Halation Block outline font | `src/shared/font.ts` |
| Text and SVG extrusion, bounds, triangle counts | `src/shared/extrusion.ts` |
| glTF subset parsing, refusal order, clip sampling | `src/shared/gltf.ts` |
| Seeded particles and formations | `src/shared/particles.ts` |
| Fixed-step cloth | `src/shared/cloth.ts` |
| 2D compositing, gradients, per-pixel effects, Sample | `src/shared/raster.ts` |
| Value resolution, readouts, draw order (one evaluator) | `src/shared/evaluator.ts` |
| Document defaults, export completeness, import refusals | `src/shared/scene-doc.ts` |
| Error shape and body limits | `src/server/http.ts` |
| Sign-in, visibility and role order | `src/server/access.ts` |
| Change application and undo inverses | `src/server/ops.ts` |
| Publish unit of work, rollback, gapless numbers | `src/server/publish.ts` |
| Outbox and exactly-once sending | `src/server/mail.ts`, `src/server/smtp.ts` |

## Decisions worth remembering

- Scene and layer ids are unique **per project** (`PRIMARY KEY (project_id, id)`),
  because an import keeps the ids from the file it came from.
- Every editor edit is written locally, queued for `AUTOSAVE_MS`, sent as one
  `ops` request with its own `opId`, then the document is reloaded from the
  server so collaborators converge.
- Undo stores a typed inverse per change; structural changes store the scene's
  layer set, so an undone delete returns keyframes, overrides and bindings.
- Locks are taken by the `ops` route itself, so the person who last edited a
  layer holds it until they deselect it or `LOCK_TIMEOUT_SECONDS` passes.
- Held and locked layers keep their fields reachable so the server's published
  refusal text is what the person sees.
- The camera fields show when the fixed `Camera` row is selected, which also
  keeps `Position X` and `Camera position X` from colliding on one screen.
- The signed-in person ships with the page bootstrap, so a signed-out visit
  makes no failing request.
- The stage draws 2D layers on a 2D canvas and 3D layers through WebGL2 when a
  context exists, falling back to the same projection on the 2D canvas.

## Verification suites

Start the app (`npm run build && node dist/server.js`) and run:

```
GRADING_KEY=… node scripts/api-suite.mjs       # API, roles, publishing, import
GRADING_KEY=… node scripts/formula-suite.mjs   # compositing, easing, clips, geometry
GRADING_KEY=… node scripts/ui-check.mjs        # landing, editor, viewports, keyboard
GRADING_KEY=… node scripts/ui-stage.mjs        # gizmo, tilt, orbit, drag reorder, presets
GRADING_KEY=… node scripts/ui-collab.mjs       # presence, locks, invites, embed swap
GRADING_KEY=… node scripts/outage-suite.mjs    # needs copies on 4175 (no storage) and 4176 (no mail)
```

The UI suites use Playwright from `/tmp/node_modules`; install it there with
`npm i playwright && npx playwright install --with-deps chromium` if it is
missing. The outage suite expects two extra copies:

```
APP_PUBLIC_PORT=4175 S3_ENDPOINT=http://192.0.2.1:9000 node dist/server.js
APP_PUBLIC_PORT=4176 SMTP_HOST=192.0.2.1 node dist/server.js
```
