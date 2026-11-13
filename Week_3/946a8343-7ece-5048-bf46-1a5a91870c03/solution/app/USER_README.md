# Spurline

Spurline is a self-contained code forge in the browser: groups and projects, a content-addressed repository you edit in the
built-in editor or through the commit API, merge requests with threaded line review, suggestions, code owners, versions and
stacked requests, a merge train that tests each request as one combined commit, a simulated delivery pipeline, protected
deployments with rollback, and issues, epics, milestones and boards linked to code through closing keywords.

## Run

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, then bundles the server to `dist/server.js` and the browser app to `dist/public`) |
| serve | `node dist/server.js` (foreground, `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173) |

Health check: `GET /api/health` answers `{"status":"ok"}`, `{"status":"unavailable"}` (file storage unreachable) or
`{"status":"starting"}` (Postgres not reachable yet). On an empty database the app creates a demo instance
(users `asha`, `tomas`, `rin`, `odile`, password `spurline-demo-1`).

## Services

| Service | Used for | Variables |
|---|---|---|
| Postgres | system of record | `DATABASE_URL` |
| MinIO (S3 API) | large files, artifacts, caches, sealed logs, reports, project exports | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |

The server starts listening even when a service is down and recovers without a restart.

## Settings (all optional)

`APP_PUBLIC_PORT` (4173), `SPUR_GRADING` (`1` enables the grading routes and the controllable server clock),
`SPUR_INLINE_MAX_BYTES` (65536), `SPUR_FILE_MAX_BYTES` (5000000), `SPUR_PARALLEL_LIMIT` (4), `SPUR_RETRY_MAX` (2),
`SPUR_JOB_TIMEOUT_MS` (3600000), `SPUR_ARTIFACT_TTL_MS` (604800000), `SPUR_CACHE_TTL_MS` (1209600000),
`SPUR_AUTO_STOP_MS` (86400000), `SPUR_DEPLOY_APPROVAL_MS` (86400000), `SPUR_RETARGET_LIMIT` (4), `SPUR_TRAIN_MAX` (20),
`SPUR_PRESENCE_TIMEOUT_MS` (15000), `SPUR_EXPORT_STEP_MS` (400), `SPUR_EXPORT_MAX_BYTES` (50000000),
`SPUR_WEBHOOK_RETRY_MS` (60000,300000,900000), `SPUR_WEBHOOK_ALLOW` (empty), `SPUR_SSE_HEARTBEAT_MS` (15000),
`SPUR_WRITE_RATE` (600 writes per user per minute), `SPUR_LOGIN_RATE` (10 sign-ins per username per minute),
`SPUR_TOAST_MS` (5000).
