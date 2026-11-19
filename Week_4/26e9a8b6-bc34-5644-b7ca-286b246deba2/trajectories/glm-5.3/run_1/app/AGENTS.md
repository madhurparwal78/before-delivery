# Pennywasher Works — repository notes

Community repair guides on an uploaded .glb model. TypeScript on Node, Postgres for
records, MinIO for models, Mailpit for the confirmation message. Port 4173.

## Build and run

- `run.json` drives the platform: `npm ci`, `npm run build`, `npm run serve`.
- The build (`scripts/build.mjs`) generates the three sample .glb files from simple
  solids, bundles the client (three.js included, minified iife) and the server (cjs,
  schema embedded), and copies the bundled fonts and `src/client/app.css` into
  `public/assets/`.
- `src/client/app.css` is the single source of the stylesheet; the build copies it.
  Do not edit `public/` by hand — it is generated.

## Where the rules live

- `src/shared/` runs in both the browser and the server:
  - `glb.ts` owns every .glb container and part check (byte limit, container,
    outside files, part limit) in the published order. The browser checks on drop
    and the server re-checks on upload; both call these functions only.
  - `working.ts` owns field paths, their value shapes, and the running parts cost
    (a part counts once, at its fitted step).
  - `cost.ts` owns cost text (`€1,234.50`, yen without decimals) and the signed
    difference.
  - `copy.ts` is the only place interface copy is written. Screens import from it,
    so wording cannot drift between pages.
  - `limits.ts` reads every limit from the environment with the published defaults.
- `src/server/domain.ts` decides guide state transitions, visibility and the
  publish checks, in their published order.
- `src/server/compare.ts` owns the version compare JSON and the word diff.
- `src/client/screens/reader.ts` owns the published scroll mapping, the settled
  position of a step and the stage keys.

## Things that bit us

- Inside a `db.tx`, queries through the pool (Store's `this.db`) do not see the
  transaction's uncommitted rows. Pass the `PoolClient` for anything that must read
  back what the transaction just wrote (`workingJsonTx`, `likeCountTx`,
  `questionByIdTx`), and always send the HTTP response after the transaction
  resolves, never inside the callback.
- glTF chunk lengths in the container header include the chunk padding. The JSON
  chunk is padded with 0x20 to a multiple of four and the BIN chunk with zeros.
- three.js needs real hex colours; CSS variables do not parse in `THREE.Color`.
- The editor's stage needs an explicit height, or the canvas grows its parent on
  every resize observation and the page never settles.
- Live SSE events re-render the editor; keep focus and uncommitted text across a
  refresh (`refreshWorking` restores focus by accessible name) and skip renders
  when nothing changed (presence uses a signature).

## Testing

- `tests/browser.spec.ts`, `tests/stills-sound.spec.ts`, `tests/editor-model.spec.ts`,
  `tests/editor-live.spec.ts` run under Playwright against a running server
  (`npx playwright test`). Playwright is a dev-only install and is not in the
  lockfile.
- `tests/api/*.mjs` are plain Node scripts that exercise the API and the limits,
  including Mailpit message delivery. Run each with `node tests/api/<name>.mjs`.

## Data notes

- The seed is idempotent and guarded by an advisory lock; two instances starting
  at once both come up. The seeded coffee-grinder guide's version 3 is published,
  and the compare of versions 1 to 3 must give the published diff exactly.
- Each grading world stores its own copies of the sample models in MinIO, so a
  `storage-down` instance (which cannot create worlds) still shows worlds made on
  the primary.
- The grading route only exists with `GRADING_ROUTES=on`.
