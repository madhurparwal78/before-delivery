# Haldvik Subsea Pensight

Pensight is the inspection console of a one-person ROV inspection business. A live 3D twin of each net pen sits at the
centre of the console. Pen Unwrap lays the net wall flat into a chart measured in metres, the server computes every
position, area, fouling cover and pen grade, dive clearance comes from a marine forecast provider, a findings copilot
points the camera at defects and proposes repairs, and the farm manager reads a revocable, expiring, read-only report link.

## Run it

`run.json` holds the three commands:

- install: `cargo fetch --locked && npm ci --prefix web`
- build: `npm run build --prefix web && cargo build --release --locked`
- serve: `./target/release/pensight` (foreground; binds `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173)

The server serves the built frontend (`web/dist`), the API under `/api` and the report link pages under `/r/<token>`.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres: records, history, dives, imports, revisions, links |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: stills, sonar captures, original import files, report packs |
| `VALKEY_URL` | Valkey: device heartbeats, defect edit locks, the `pensight:events` live-update channel |
| `WIREMOCK_URL` | the marine forecast provider and the chat-completion provider (plain HTTP) |
| `APP_PUBLIC_PORT` | listening port (default 4173) |
| `APP_PUBLIC_URL` | optional: absolute report-link URLs and the app's own origin for the cross-site write check |

No credential reaches the browser. The providers are never contacted at boot; an outage there only affects clearance and the copilot.
