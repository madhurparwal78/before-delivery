# Interline Desk

A translation management desk for one independent localization engineer. It holds each client project's keys, a branch-aware
working copy per feature branch, one translation memory per project, AI drafts routed per target language, MQM scores, review
by invited client reviewers, and publishing of approved locale files to the client's Git repository. Everything persists in
Postgres; uploaded originals, import snapshots and published bundles live in MinIO (S3 API); signed webhooks go out through Svix.

First boot against an empty database seeds the demo desk: sign in as `robin@marlowquill.example` with the demo password from the
product brief. Reviewers are invited from a project's settings and sign in with the access key shown once.

## Run it

`run.json` holds the commands:

- install: `go mod download && npm ci`
- build: `npm run build && CGO_ENABLED=0 go build -o bin/interline-desk .` (the TypeScript front end is bundled with esbuild and embedded in the Go binary)
- serve: `./bin/interline-desk` (binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173; `GET /api/health` answers `{"status":"ok"}`)

## Environment

| Variable | Used for |
|---|---|
| `APP_PUBLIC_PORT` | listen port (default 4173) |
| `DATABASE_URL` | Postgres connection string |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (path-style; the bucket is created on first write if missing) |
| `SVIX_URL`, `SVIX_API_KEY` | Svix webhook service |
| `WIREMOCK_URL` | stand-in for the Git host and AI engine |
| `GIT_HOST_URL`, `AI_ENGINE_URL` | optional overrides; each falls back to `WIREMOCK_URL` |
| `ASSIGNMENT_TTL_SECONDS` (172800), `CONFLICT_HOLD_SECONDS` (300), `AUDIT_RETENTION_SECONDS` (15811200), `WEBHOOK_RETRY_SECONDS` (10) | time rules, whole seconds |

No credential or service URL is hard-coded or sent to the browser.
