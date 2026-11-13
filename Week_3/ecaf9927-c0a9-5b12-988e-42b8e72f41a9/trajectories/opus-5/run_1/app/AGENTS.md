# Kerfline Bench — repository notes

Browser CAD workspace for Halyard Instrument Works: sketches with a real constraint
solver, extrudes with real CSG, parts with confirmed mass properties, nested assemblies
and a rolled-up bill of materials.

## Running it

```
npm ci && npm run build && npm run start
```

`run.json` holds the same three commands. The server reads `DATABASE_URL`, the `S3_*`
variables and `APP_PUBLIC_PORT` from the environment; nothing is hard-coded.

Useful during development:

- `npm run typecheck` — strict TypeScript over server and browser sources.
- Reset to first-boot state: drop and recreate the `public` schema, then restart.

## Layout

```
src/shared/   units + dimension grammar, API types, 2D profile detection (both sides use these)
src/server/   http boundary, routes, solver, geometry, repositories, domain rules, seed
src/client/   state, actions and rendering for the single workspace screen
static/       index.html, styles.css, bundled woff2 fonts
```

Each domain rule lives in exactly one place:

| Rule | File |
| --- | --- |
| Part body states and the save pipeline | `src/server/domain/partSave.ts` |
| Slack, rank, point freedoms, redundancy | `src/server/solver/sketch.ts` + `solver/linalg.ts` |
| Conflict naming for a refused constraint | `src/server/solver/conflicts.ts` |
| Unit conversion and the input grammar | `src/shared/units.ts` |
| BOM rollup, tree rows, cycle check | `src/server/domain/assemblies.ts` |
| Revision check | `src/server/domain/revision.ts` |
| Idempotency replay | `src/server/domain/idempotency.ts` |
| Error shapes and refusal messages | `src/server/errors.ts` |

## Things worth knowing

- **Faceting and exact figures.** Full circles are tessellated with an area-preserving
  radius (`areaPreservingRadius` in `src/shared/profile.ts`), so faceted volumes match the
  closed-form figures to full precision — Base Plate reads `74286.73 mm³` exactly as the
  brief says. Arc vertices stay on the true arc so shared endpoints match exactly.
  `CIRCLE_SEGMENTS = 512` keeps surface areas within about 1e-5 relative.
- **The solver** orthogonalises constraint equations in creation order in one pass
  (`decompose`), which yields the rank (hence slack), the row-space basis (hence point
  freedoms), the redundant constraints and the minimum-norm Gauss-Newton step together.
- **Unsatisfiable means refused.** A constraint is accepted whenever some placement
  satisfies every constraint; redundancy is a rank question, not a refusal.
- **Boot is serialised** with one Postgres advisory lock covering the schema, the seed and
  the seed body write, so several processes can start against one database.
- **Storage is optional at boot.** With MinIO down the server still starts, parts end
  `not_stored`, and assemblies keep their last confirmed figures.
- **The canvas** draws sketches as SVG in two layers: visible strokes, then invisible
  44 px target groups that carry `role="button"`. Keeping the targets separate stops a
  circle's bounding box from being centred on the centre point inside it.
- **Ring motion then count.** `animateSlack` resizes rings from the previous freedoms
  (`state.ringsFrom`) before the readout counts, so nothing may re-render in between;
  background checks only re-render when the storage status actually changes.
