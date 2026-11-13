# Fennick Instruments Stowdeck

Stowdeck is a private reference library for one independent product designer. Each reference is a photographed object with its
source, maker, year, true size, materials, finish and a measured colour swatch. The designer finds references in seconds,
orders them as a reel, plays the reel one object at a time on a laptop, and prints exactly that reel as an A4 or US Letter
contact sheet. There are no accounts and no sign-in.

## Run it

`run.json` declares the three commands:

| Step | Command |
|---|---|
| install | `npm ci --include=dev` |
| build | `npm run build` (compiles the server, computes the Landing demo swatches, builds the browser bundle) |
| serve | `npm run start` (foreground, listens on `0.0.0.0`, port `APP_PUBLIC_PORT` or 4173) |

`GET /api/health` answers `{"status":"ok"}` as soon as the server listens, whatever state the backing services are in. The
schema, the search index settings and the seed data are applied idempotently every time the app serves.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | system of record: references, reels, sheets, settings, picks, idempotency, recorded search updates |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | byte-exact originals, display crops, rendered contact-sheet PDFs |
| `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, `MEILISEARCH_INDEX` (optional, default `references`) | Meilisearch | full-text and filtered search |
| `GOTENBERG_URL` | Gotenberg | renders each contact sheet from one self-contained HTML page |
| `APP_PUBLIC_PORT` (optional, default 4173) | none | listen port |
| `STOWDECK_TRASH_RETENTION_SECONDS` (optional, default 2592000) | none | restore window |
| `STOWDECK_NOW` (optional) | none | an ISO 8601 UTC instant at which the server clock stands still |

Several copies of the app may serve the same database, bucket and index at once; every single-winner rule is decided by the
shared database. If search, storage or printing is unreachable the app still starts, shows a banner and recovers on its own.
