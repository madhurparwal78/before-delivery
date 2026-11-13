# Kerfline Bench

Halyard Instrument Works' browser workspace where a solo hardware founder sketches 2D profiles, constrains them until they are fully held, extrudes and combines them into parts, and rolls parts, purchased fasteners and nested assemblies up into a bill of materials in millimetres or inches. One invited contract engineer can refine sketches and save parts.

## Run it

`run.json` declares the three steps:

- install: `npm ci` (from `package-lock.json`)
- build: `npm run build` (type-checks, then bundles the server and the browser app into `dist/`)
- serve: `npm run start` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173)

Sign in with a seeded member: `ines@ostra-lighting.example` (founder) or `teo@lindqvist-eng.example` (engineer); the passwords are the ones the brief lists.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres: members, sessions, parts, sketches, constraints, revisions, features, materials, assemblies, confirmed figures, idempotency records. The schema is applied on every start; the seed is created once. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: one object per stored part build at `bodies/<part id>/build-<build>.json`. The bucket must already exist. |
| `APP_PUBLIC_PORT` | Listening port (default 4173). |

The app uses no other datastore. When Postgres is down the server waits and `GET /api/health` answers 503 `{"status":"starting"}`; when storage is down the server starts normally and parts are marked Not stored until a save reaches storage.

## Layout of the source

- `src/server`: HTTP boundary, routes, services (parts, sketches, features, assemblies, bill of materials), the constraint solver and the Manifold-based body kernel.
- `src/shared`: what the browser and server must agree on: API types, the length input grammar and unit conversion, constraint reference rules, profile extraction.
- `src/client`: the React workspace (feature tree, properties, sketch canvas, still body views, command strip).
