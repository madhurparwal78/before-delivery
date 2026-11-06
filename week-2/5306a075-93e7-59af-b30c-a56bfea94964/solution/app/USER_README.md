# Loomwise Evidence Desk

Evidence Desk is a web workspace for B2B product teams. Teams collect customer feedback in an inbox,
highlight the exact sentences customers said, link those quotes to features as insights, rank features
against weighted objectives, plan releases on a roadmap board, and send each customer who asked for a
feature one "You asked, we shipped" email when it ships. A shared, read-only public roadmap opens from
revocable share links.

## Run it

The commands live in `run.json` and are the only way the app is installed, built and started:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly what `package-lock.json` pins |
| build | `npm run build` | type-checks server and client (TypeScript, strict) and bundles the client with Vite into `dist/` |
| serve | `npm run start` | starts the server in the foreground on `0.0.0.0:$APP_PUBLIC_PORT` (4173 when unset) |

`GET /api/health` answers `{"status":"ok"}` once the server accepts requests, also while object storage or
mail is unreachable. At boot the server waits for PostgreSQL (retrying every 2 seconds), applies its schema
idempotently and inserts the seed data when the database holds no workspace.

Seeded members (password `evidence-desk-2026`): `hop@tallyrun.example` (head of product),
`pm@tallyrun.example` and `pm2@tallyrun.example` (product managers), `csm@tallyrun.example` (customer
success); `hop@quarrylabs.example` and `pm@quarrylabs.example` in the second workspace.

## Configuration

Every value is read from the environment once, in `src/server/config.ts`; none reaches the browser.

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | the system of record: workspaces, members, sessions, notes, insights, scores, releases, share links, outbox, idempotency keys, pending attachment bytes, pending object deletions, audit trail |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible object storage (MinIO) | note attachments under `notes/<noteId>/`, frozen release scopes under `releases/<releaseId>/scope-v<n>.json` |
| `SMTP_HOST`, `SMTP_PORT` | SMTP mail sink (Mailpit) | delivery of outbox emails (invitations, "You asked, we shipped") |
| `MAIL_FROM` | — | From header of every email; defaults to `Loomwise Evidence Desk <updates@loomwise.example>` |
| `APP_PUBLIC_PORT` | — | listening port, default 4173 |
| `APP_BASE_URL` | — | base of share-link and invitation URLs, default `http://localhost:<port>` |
| `ATTACHMENT_RETRY_SECONDS` | — | how often pending uploads and pending object deletions are retried (1–60, default 10) |
| `OUTBOX_RETRY_SECONDS` | — | how often unsent emails are retried (1–60, default 10) |
| `INVITE_TTL_SECONDS` | — | invitation lifetime, default 604800 |
| `SESSION_IDLE_SECONDS` | — | idle session lifetime, default 43200 |

## Outages

- Object storage down: notes still save; a valid attachment is kept in PostgreSQL and shows "Pending
  upload" until any running instance uploads it; freezing a release answers 503 and changes nothing.
- Mail down: shipping and inviting still succeed; emails wait in the outbox and are sent by whichever
  instance can reach SMTP. Each outbox row reaches the sink at most once.

Several instances may share one database: background work is claimed row by row inside the transaction
that performs it.
