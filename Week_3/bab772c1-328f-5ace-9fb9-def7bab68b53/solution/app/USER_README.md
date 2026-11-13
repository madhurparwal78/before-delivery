# Perilune Ledger

Rebuild lunar flights from raw telemetry captures. The author console stores and parses passes, draws a procedural lunar ground track, replays server-computed frames, searches transcript lines, pins events with private notes, marks landmarks and compares a reference ephemeris. Expiring replay links give readers public data and original downloads. Changes are hash-chained, streamed across instances and sent as signed webhooks; parse outcomes send phone push alerts.

Use Node.js 22 and npm. Run the commands in `run.json` from the application directory:

```
npm ci
npm run build
npm run start
```

The foreground server binds `0.0.0.0`, port `APP_PUBLIC_PORT` (default 4173), and serves `/api/health`. Postgres must be reachable at boot. The other services can recover without restarting. The schema and demo seed are idempotent. No files or application state are stored on local disk at runtime.

Configuration is read once from the environment. Supply all service variables; there are no credential or URL defaults:

| Service | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Meilisearch | `MEILISEARCH_URL`, `MEILISEARCH_API_KEY` |
| RabbitMQ | `AMQP_URL` |
| Ephemeris HTTP API | `WIREMOCK_URL` |
| Gotenberg PDF renderer | `GOTENBERG_URL` |
| Valkey | `VALKEY_URL` |
| Kill Bill | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` |
| Svix | `SVIX_URL`, `SVIX_API_KEY` |
| ntfy | `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD` |
| Application | `APP_PUBLIC_PORT` (optional, 4173), `APP_PUBLIC_URL` (optional public origin), `DEPENDENCY_RETRY_SECONDS` (optional, 5) |

When `APP_PUBLIC_URL` is absent, share links use the request origin and push alerts omit their click URL. Run multiple instances with the same backing services for shared records, queues, rate limits, reader counts and change delivery. Every instance consumes the parse and webhook queues. All fonts and browser assets are bundled and served from this origin. The dossier sends those same font files to Gotenberg.

Original downloads support checksums, conditional requests and single byte ranges. Public replay responses never contain private notes. Audit entries can be downloaded and verified through the author API. Svix's accepted event-id alphabet requires a dot transport separator between mission id and version; the outbox retains the brief's colon separator.
