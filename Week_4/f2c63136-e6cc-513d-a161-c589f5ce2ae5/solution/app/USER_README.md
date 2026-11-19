# Ridgestack

Code review and merge governance for stacks of changes: a repository of plain-text files, the review of
each change, merge rules (approvals, code owners, required checks) and a merge queue in one place.
When a lower change in a stack gets a new revision every change above it is restacked file by file,
approvals survive when the approved diff did not move, and every queue removal records its reason.

## Run it

`run.json` declares the three commands: `npm ci`, `npm run build`, `npm run start`. The build bundles the
server and the browser app into `dist/`; start serves on `0.0.0.0` and `APP_PUBLIC_PORT` (4173 when unset).
The server creates its own tables and objects idempotently at start and seeds the demo organisations
(`harbor`, `tidepool`; password `ridgestack-seed-1` for the seeded users).

## Environment

| Variable | Service / use |
|---|---|
| `DATABASE_URL` | Postgres: every record and the mail outbox |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: file contents (`objects/<sha256>`) and archive exports (`archives/<repo id>/<revision>.zip`) |
| `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL` | Mailpit: delivery of the outbox, readiness |
| `APP_PUBLIC_URL`, `APP_PUBLIC_PORT` | links in mail, listening port |
| `GRADING_KEY` | guards `/api/grading/*` (default in the configuration module) |
| `WORKSPACE_TIME_ZONE`, `CHECK_TIMEOUT_SECONDS`, `QUEUE_STEP_SECONDS`, `DIFF_CONTEXT_LINES`, `PUSH_SIZE_LIMIT_BYTES`, `DIFF_BREAKPOINT_PX`, `LIVE_UPDATE_DELAY_MS`, `MAIL_FROM` | published settings with their defaults |

Browser live updates use one WebSocket per open change or queue page.
