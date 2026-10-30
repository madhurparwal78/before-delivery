# Relay Bench

Relay Bench is a live coding room for freelance coding mentors and their learners. Mentor and learners open
the same project in the browser. One person at a time holds the baton and may type, and the server enforces
it. Anyone in the room can save named checkpoints, restore them later and undo the latest restore. Mentors
invite and remove learners, import starter or homework zips through a reviewed plan, and share a single
checkpoint with a parent or peer through a read-only reviewer link.

## Running it

Everything is in `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` (from the lockfile) |
| build | `npm run build` (TypeScript server to `dist/server`, browser bundle to `dist/client`) |
| serve | `node dist/server/main.js` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

The schema is applied every time the server starts, so a new empty database is ready on first boot. Health:
`GET /api/health` answers `200 {"status":"ok"}` whenever the process runs, even with storage or mail down.

## Services

| Service | Used for | Variables |
|---|---|---|
| Postgres | accounts, sign-in sessions, projects, memberships, sessions and the driver, files and revisions, the edit log, checkpoint records, import plans, reviewer links, idempotency keys, the mail outbox and the audit trail | `DATABASE_URL` |
| MinIO (S3 API) | checkpoint blobs `projects/<project>/blobs/<sha256>`, manifests `projects/<project>/checkpoints/<checkpoint>/manifest.json`, quarantined zips `quarantine/<import>.zip` | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit (SMTP) | sign-in, invite and reviewer emails | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |

## Other settings

| Variable | Meaning | Default |
|---|---|---|
| `APP_PUBLIC_PORT` | port to listen on | `4173` |
| `APP_PUBLIC_URL` | base for links in emails and reviewer URLs | `http://localhost:<port>` |
| `MAGIC_LINK_TTL_SECONDS` | sign-in and invite link life | `900` |
| `REVIEWER_LINK_HOUR_SECONDS` | length of one reviewer-link hour | `3600` |
| `CHECKPOINT_UPLOAD_DEADLINE_SECONDS` | a checkpoint still pending this long after its save fails | `86400` |
| `IMPORT_PLAN_TTL_SECONDS` | life of an import plan and its quarantined zip | `3600` |

`MAILPIT_URL` exists for tooling; the app does not read it. Credentials are read once at start and are never
logged or sent to the browser.

## Background work

Each instance runs small loops that need no restart: pending checkpoint uploads are retried every 3 seconds
until saved or past their deadline, queued invite and reviewer emails are retried every 5 seconds, expired
import plans are swept every 2 seconds, and storage objects scheduled by an account erasure are deleted. Each
item is claimed with a row lock, so several instances sharing one database never send an email twice or upload
a checkpoint twice.

## Outages

- Storage unreachable: editing, the baton, sessions, invites and sign-in carry on. Checkpoint saves answer
  `202 pending_upload` and finish on their own when storage returns; checkpoint reads, restores, imports,
  reviewer views and erasure answer `503 storage_unavailable`.
- Mail unreachable: sign-in requests answer `503 mail_unavailable` and are never sent later; invites and
  reviewer links succeed with `email_status: "queued"` and are delivered once mail returns.
