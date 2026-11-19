# Spanwise — repository notes

Spanwise is a corridor vegetation-clearance delivery workspace. Contractor staff
upload a corridor's reality mesh, terrain pyramid and flight track, record
encroaching canopy against tower-to-tower chainage, and send a frozen findings
set to the utility forester through an emailed review link.

## Layout

| Path | What lives there |
| --- | --- |
| `src/shared` | Code both sides use: geodesy, corridor geometry, number formats, published copy |
| `src/server` | Express app, domain rules, services, fixtures, routes |
| `src/web` | React app: sign-in, corridor list, workspace, review page, Cesium scene |
| `public/fonts` | Self-hosted woff2 fonts and their OFL licence texts |
| `scripts/notices.mjs` | Regenerates `THIRD_PARTY_NOTICES.md` and audits shipped licences |

## Where each domain rule is decided

Each rule lives in exactly one place. Change it there, nowhere else.

| Rule | Place |
| --- | --- |
| Chainage, offset, span and the centreline | `src/shared/corridor.ts` |
| Clearance and Violation/Clear status | `deriveClearance` in `src/shared/corridor.ts` |
| ECEF and geodesics (float64, never rounded) | `src/shared/geodesy.ts` |
| CZML parsing, coverage merging, interpolation | `src/server/domain/flight.ts` |
| Findings-set transitions | `assertTransition` in `src/server/domain/sets.ts` |
| Frozen counts, evidence pack, link minting | `submitSet` in `src/server/domain/sets.ts` |
| Link liveness and expiry | `linkStatus` in `src/server/domain/sets.ts` |
| Email state (queued/sent) | `src/server/services/mail.ts` |
| Label assignment | `createFinding` in `src/server/domain/findings.ts` |
| Terrain-level ordering | `reResolveTerrain` in `src/server/domain/findings.ts` |
| Storage confirmation | `storeAssetFile` in `src/server/domain/assets.ts` |
| Overdue | `isOverdue` in `src/server/domain/corridors.ts` |
| The error shape and precedence order | `src/server/errors.ts` and `defineRoute` in `src/server/http.ts` |
| Which flight answer is current on the page | `useCorridorView` in `src/web/lib/useCorridorView.ts` |
| Every published string | `src/shared/copy.ts` |
| Every number format | `src/shared/format.ts` |

## Things that are easy to get wrong

- **Terrain levels.** `CorridorGlobe.terrainSample` only counts tiles whose
  `terrainData` was not created by upsampling. Cesium happily renders upsampled
  tiles at levels deeper than the pyramid; sending those would refine findings
  against data that never loaded.
- **Idempotent replays** are stored as text, not `jsonb`, so a replay returns
  the first response byte for byte. `jsonb` reorders keys.
- **The evidence pack is written inside the submit transaction**, after the row
  update, so a storage outage rolls the whole submit back.
- **Fixtures are deterministic.** Terrain, glb and CZML bytes must hash the same
  on every boot or the seeded manifests stop matching.
- **Blocked ports.** Node's fetch refuses some ports (4190 among them) with
  "bad port". Pick another when running a second app process.

## Running locally

```sh
npm ci
npm run build          # tsc for the server, vite for the browser bundle
npm start              # serves the built frontend and /api on one origin
npm run notices        # regenerates THIRD_PARTY_NOTICES.md and audits licences
npm run typecheck
```

The database and bucket must already exist; either may be empty. The schema is
applied and the seed inserted on every start, and only missing rows are added.
Seeded assets stay `pending` until their generated fixture files are written to
object storage and confirmed, so the first boot against an empty bucket takes a
few seconds longer.
