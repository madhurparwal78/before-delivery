# Spoorline

Spoorline is a log search and observability console. Teams send it newline-delimited events, test ingest pipelines before events go through them, keep events in data streams that roll over into numbered generations and age into an archive tier, search them with a published query language and a published score, alert on grouped rules, follow an alert into a case and a trace, and read error budgets per service objective. Every rule and formula is published on `/rules` with a worked example.

It is one TypeScript web app: a Node server plus a browser client. Postgres holds events, the term index the app builds itself and all product state. MinIO stores uploaded files byte for byte and the segment of every archived generation.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type check, then the server bundle and the client bundle into `dist/`) |
| serve | `npm run start` (runs `node dist/server.js` in the foreground) |

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173) and applies its schema and start seed every time it serves. It retries Postgres every second for up to 60 seconds, then exits with a non-zero status. Unreachable storage at boot does not stop it; `GET /api/health` answers `{"status":"unavailable"}` until storage answers.

Seed accounts (password `spoorline-demo-1`): `ines` (admin of `ops`), `tomas` (editor of `ops`, zone `America/New_York`), `ruth` (viewer of `ops`), `wren` (admin of `harbor`).

## Environment

| Variable | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | Postgres | connection string |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | object storage for uploads (`uploads/<space>/<sha256>.ndjson`) and archived segments (`segments/<space>/<stream>/<generation>.ndjson`) |
| `APP_PUBLIC_PORT` | | listening port |
| `SPOOR_GRADING` | | `1` turns on the grading routes and the standing-still server clock |
| `SPOOR_CHECK_INTERVAL_MS`, `SPOOR_LIFECYCLE_INTERVAL_MS` | | how often rule checks and lifecycle steps run (not under grading) |
| `SPOOR_PENDING_CHECKS`, `SPOOR_FLAP_CHANGES`, `SPOOR_FLAP_CHECKS` | | alert state machine settings |
| `SPOOR_SNAPSHOT_TTL_MS`, `SPOOR_PAGE_SIZE`, `SPOOR_RESULT_WINDOW` | | snapshots, paging and the result window |
| `SPOOR_TAIL_BUFFER`, `SPOOR_TAIL_RATE`, `SPOOR_SSE_HEARTBEAT_MS` | | live tail and event stream settings |
| `SPOOR_QUERY_MAX_LEN`, `SPOOR_QUERY_MAX_DEPTH`, `SPOOR_QUERY_WORK_MAX`, `SPOOR_QUERY_BUDGET_MS` | | query limits and work budget |
| `SPOOR_UPLOAD_MAX_BYTES`, `SPOOR_UPLOAD_PROGRESS_LINES`, `SPOOR_UPLOAD_RATE` | | uploads |
| `SPOOR_LOGIN_RATE`, `SPOOR_SEARCH_RATE` | | per-minute rate limits |
| `SPOOR_TRACE_MAX_SPANS` | | spans allowed in one trace |

Every credential is read from the environment and never sent to the browser.

## Layout

`src/server` is the Node server (routes, search, ingest, lifecycle, alerts), `src/shared` holds the rules both sides use (time zones, display format, the generation timeline sentence), and `src/client` is the React client. Fonts (Inter and JetBrains Mono, SIL Open Font License 1.1) are bundled in `src/client/fonts`.
