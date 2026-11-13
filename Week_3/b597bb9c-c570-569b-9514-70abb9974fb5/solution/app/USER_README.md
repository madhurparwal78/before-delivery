# Gatecut

Gatecut is a browser editor for a freelance video editor who cuts for agency teams. The owner uploads rushes, cuts on a
multi-row timeline, names cuts, shares review links with the client and exports cut manifests. Editors cut alongside
the owner, producers pin notes and approve, and the client reviews from a link on a phone or laptop. Gatecut works only
on exact frame data: every clip, caption, keyframe and note pin sits on a whole frame, and it never decodes pictures.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (the browser bundle with Vite, then the server bundle with esbuild) |
| serve | `npm run start` (`node dist/server.js`, in the foreground on `0.0.0.0`) |

The server listens on `APP_PUBLIC_PORT` (default 4173). `GET /api/health` answers `{"status":"ok"}` as soon as the server
accepts connections, even while MinIO, RabbitMQ or SMTP is unreachable. The schema is applied idempotently at every start
and the database is seeded only when it is empty.

## Environment

Every value is read once, in `server/config.ts`. None of them reaches the browser; the only storage address the browser
sees is a presigned manifest link.

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | all records, the op log, the outbox, uploads and exports |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | upload chunks, library files and export manifests |
| `VALKEY_URL` | Valkey | allowance counters, waveform peaks and read-token request windows |
| `AMQP_URL` | RabbitMQ | the durable export queue |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP | grouped mention mail and export-finished mail |
| `APP_PUBLIC_URL` | app | review-link and mail addresses |
| `APP_PUBLIC_PORT` | app | listening port, default 4173 |
| `MAIL_GROUP_SECONDS` (60), `OUTBOX_RETRY_SECONDS` (10), `MANIFEST_LINK_SECONDS` (900) | app | mail window, outbox retry and manifest link lifetime |
| `EXPORT_QUEUE` (`gatecut.exports`), `EXPORT_STEP_MS` (400) | RabbitMQ | the queue this instance publishes to and consumes from, and the length of one export step |
| `EXPORT_MINUTE_ALLOWANCE` (600), `STORAGE_ALLOWANCE_BYTES` (100000000000) | Valkey | the monthly export minutes and the storage allowance |

## Seeded people

Seeded accounts sign in with email and password; the owner is `noor@gatecut.example`. There is no self-service sign-up.

## Layout of the source

- `shared/`: the rules the browser and the server both use (the rounding rule, timecode, keyframe curves, layer boxes, copy).
- `server/`: HTTP boundary, op engine (`server/timeline/`), services (`s3.ts`, `kv.ts`, `queue.ts`, `smtp.ts`) and the seed.
- `web/`: the React interface.
- `scripts/`: build tooling (`build-server.mjs`, `notices.mjs`).
