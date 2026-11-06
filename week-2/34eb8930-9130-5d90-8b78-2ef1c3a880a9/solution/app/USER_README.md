# Quillmere Drafts

A live proposal editor for a one-person grant-writing consultancy and the reviewers at its client
nonprofits. The consultant drafts proposals on one paper-like page, shares each one person by person
as Editor, Commenter or Viewer (optionally until an end time), and everyone with access writes,
suggests, comments and settles changes together in real time. The server enforces every role on
every HTTP call and socket frame, and decides access end times on its own clock.

## Run it

`run.json` holds the three commands the deployment uses:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the lockfile |
| build | `npm run build` | type-checks (TypeScript strict), bundles the server to `dist/server.js` and the browser app, CSS and fonts to `dist/public/` |
| serve | `npm run start` | `node dist/server.js` in the foreground on `0.0.0.0:$APP_PUBLIC_PORT` |

On every serve the app applies its schema and seed data to PostgreSQL (idempotently) and writes any
missing seed body objects to the bucket. `GET /api/health` answers `{"status":"ok"}` once the
database is reachable (it retries every 2 seconds and answers 503 `{"status":"starting"}` until then),
even when storage is unreachable.

Seeded people sign in with their email and the password `quillmere-demo-2026`
(for example `ines@quillmere.test`, the consultant).

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL: people, sessions, proposals, shares, the ordered operation log, suggestions, comments, decisions, modes, Recent entries, notices, presence |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO-compatible object storage: one body object per proposal at `documents/<id>.json` (signed SigV4 requests; the bucket is provided and never created) |
| `APP_PUBLIC_PORT` | listening port (default 4173) |
| `PRESENCE_IDLE_SECONDS` | seconds without input before a person's caret label hides (1–3600, default 60) |

Credentials are read once at start (`src/server/config.ts`), never logged and never sent to the browser.

## Services

- **PostgreSQL** is the system of record.
- **Object storage** holds each proposal's saved body. A body write starts within a second of a
  change; a write that fails or takes longer than 5 seconds is reported as `save_failed` and retried
  every 5 seconds. "All changes saved" appears only after storage confirms the latest revision.
