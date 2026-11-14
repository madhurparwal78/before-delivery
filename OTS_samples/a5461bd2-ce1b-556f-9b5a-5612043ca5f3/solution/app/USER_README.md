# Vellum Orbit Studio, Eight Worlds

The public website of Vellum Orbit Studio, a fictional branding and digital design studio in Kochi. Visitors walk a ring
of eight 3D brand worlds, read each world's case study, filter the work, compare six services and an illustrative price
list, and send a four-step project enquiry. Every client, person, price and contact detail is invented.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, then bundles the browser app and the server with esbuild) |
| serve | `npm run start` (foreground; binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

Node.js 22 and TypeScript. The server applies its schema on every start, stores the starting content once, and stores any
missing scene model or gallery image in MinIO as soon as the file store answers.

## Environment

| Variable | Meaning | Service |
|---|---|---|
| `DATABASE_URL` | Postgres connection | Postgres: content, enquiries, intake state |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO connection and private bucket | MinIO: `scenes/<slug>/world.glb`, `media/<slug>/<n>.svg` |
| `WIREMOCK_URL` | address of the project-intake service | WireMock stand-in: `POST /v1/intake/enquiries` |
| `GRADING_KEY` | key for `GET /api/grading/enquiries` (header `X-Grading-Key`) | none |
| `WORK_PAGE_SIZE` | gallery page size (default 6) | |
| `ENQUIRY_LIMIT` | enquiries per email in the window (default 3) | |
| `ENQUIRY_WINDOW_SECONDS` | length of the limit window (default 600) | |
| `INTAKE_TIMEOUT_MS` | intake request timeout (default 5000) | |
| `APP_PUBLIC_PORT` | serving port (default 4173) | |

Only the enquiry limit and window reach the browser. No credential or address is hard-coded.

## Layout

- `src/shared`: domain rules used by both sides (active world, gallery matching and counts, price counts, enquiry fields, routes).
- `src/server`: HTTP server, API, Postgres, file store, intake hand-off, procedural scene models and gallery images.
- `src/client`: the React app, the stage controller and the Three.js scene.
- `public/fonts`: the ten font families (SIL OFL 1.1).
