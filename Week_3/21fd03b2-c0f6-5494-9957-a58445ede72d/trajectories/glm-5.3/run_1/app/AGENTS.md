# Rampwright (Tarn & Tally Bench Works) — repository notes

## What this is
A browser workspace for physics tutors: 3D physics scenes in real SI units, deterministic
fixed-step simulation (1/120 s), checkpoints, published labs, live co-editing with locks
and presence. Stack: TypeScript on Node 22, Express, Postgres (DATABASE_URL), MinIO
(S3_*), Valkey (VALKEY_URL), Mailpit (SMTP_*). One process serves API + built frontend
on port 4173 (`APP_PUBLIC_PORT`).

## Layout
- `run.json` — install/build/serve manifest (`npm ci`, `npm run build`, `npm run serve`).
- `src/bench/` — domain shared by browser and server (the ONLY place for each rule):
  `canonical.ts` (canonical JSON + shortest numbers), `sim.ts` (fixed step, state bodies),
  `hash.ts` (sha256 via WebCrypto, shared by both), `scene.ts` (document, params, ranges),
  `units.ts` (parameter entry: kg/g/lb, m/cm/mm/in/ft, deg/rad), `readouts.ts`
  (derived readout formulas), `uploads.ts` (byte-signature kind detection, glTF
  self-containment, node-transform extent rule), `ops.ts` (revision conflict footprints),
  `rules.ts` (safe-return path), `copy.ts` (ALL user-facing copy, exact strings),
  `activity.ts` (action phrases).
- `src/server/` — Express app split by area: `routes.ts` (auth/workspaces/invites/activity/
  projects/scenes/status), `routes-editor.ts` (PATCH/verify/locks/presence/LIVE SSE/assets/
  checkpoints/publish/share-links), `routes-public.ts` (labs + read-only view links),
  `shared.ts` (session, role loading, SSE channel registry), `scenes.ts` (revision
  footprints + op application), `locks.ts` (Valkey leases/fences/presence), `storage.ts`
  (MinIO with 503 outage mapping), `mail.ts` (outbox: exactly-once delivery), `seed.ts`
  (idempotent seed), `schema.ts` (idempotent DDL).
- `src/client/` — no framework; `main.ts` mounts per route from `router.ts`.
  `editor.ts` + `editor-panels.ts` + `editor-assets.ts` + `editor-util.ts` are the editor
  (EditorState class; panels move between floating/docked/phone containers in
  `applyLayout()`), `lab.ts` the public lab, `view.ts` read-only links, `screens-basic.ts`
  everything else, `render.ts` a small raw-WebGL renderer (no three.js), `ui.ts` the
  bench chrome CSS + element helpers, `copy.ts` strings come from `src/bench/copy.ts`.

## Things that bit us (do not regress)
- The browser bundle must NOT include node-only banners (`node:module` require shim is
  server-only in `build.mjs`); index.html loads `/main.js` with `type="module"`.
- State hash: positions/velocities must be rounded to 6 decimals in BOTH the browser
  (`stepStateFor` in editor-util.ts) and the server (`stepState` in sim.ts) or hashes
  diverge. Step-0 parity does not catch it; step N>0 does.
- Seeded scene documents must list objects sorted by id (canonical JSON requires it).
- `applyAttrs` style objects must use `el.style.setProperty(kebab(name), value)` — direct
  index assignment on CSSStyleDeclaration throws in Chromium.
- Editor panels physically move between three containers (floating/docked/phone sheet) on
  resize; simply toggling `display` hides them because they live in the wrong container.
- Keydown handlers on re-rendered DOM are lost; bind once to the persistent panel body.
- Field inputs must not `stopPropagation()` on Ctrl/Cmd keys (Ctrl+K palette).
- CSS specificity: `.chip.publish-chip { min-height: 26px }` beats a media-query
  `.chip { min-height: 44px }`; phone touch sizing needs the compound selector too.

## Testing
- `/tmp/run-with-fresh-db.sh <test.py>` truncates the DB, restarts the server (re-seeds),
  then runs a Playwright test.
- `api_test.py` (86 checks), `browser_test.py` (120), `browser_test2.py` (42: collab,
  demotion, paging, layouts, reduced motion, focus trap), `outage_test.py` (16: boots a
  second instance on :4199 with unreachable Valkey/MinIO/SMTP).
- Seed users: Ines Okafor (owner), Tomas Reyes (editor), Priya Lund (viewer),
  Dana Whitcombe (other workspace). Passwords in `src/server/seed.ts`.
