# Northcoil Works Rimewire

Rimewire is a team messenger for commercial refrigeration and HVAC contractors. Dispatchers,
field technicians, crew leads and operations managers talk in job channels and threads, send
gauge and nameplate photos (stored cleaned of camera metadata), and see exactly who received
and read each version of an edited message. Operations managers invite and remove people and
manage channel membership; dispatchers schedule start-of-shift bulletins in business time; a
morning email lists the mentions still waiting for an answer.

## Running it

`run.json` holds the three commands the deployment runs, in order:

| Step | Command |
|---|---|
| install | `npm ci` (uses `package-lock.json`) |
| build | `npm run build` (type-checks the server and browser code, compiles the server to `dist/server`, bundles the browser app to `dist/web`) |
| serve | `node dist/server/main.js` (foreground; binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

On every serve the app creates its PostgreSQL schema and the seed data where they are missing.
It starts even when MinIO or Mailpit is unreachable and reports them `down` on
`GET /api/health`. Node.js 22 is required.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL, the system of record (people, channels, messages, versions, receipts, pins, mentions, scheduled posts, email bookkeeping, the removal queue and the live event log) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: every photo original and thumbnail, under `attachments/<workspace_id>/<message_id>/<attachment_id>/` |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit over SMTP: invite emails and the morning mention digest |
| `MAIL_FROM` | The From line of every email |
| `MAILPIT_URL` | Read nowhere; the app only talks SMTP |
| `APP_PUBLIC_PORT` | Listening port (default 4173) |
| `APP_PUBLIC_URL` | Base of the links in emails (default `http://localhost:<port>`) |
| `EDIT_WINDOW_SECONDS` | How long a message stays editable (default 86400) |
| `MENTION_UNANSWERED_SECONDS` | Age before an unanswered mention joins the digest (default 1800) |
| `DIGEST_INTERVAL_SECONDS` | When set, digests run every window of this many seconds instead of 07:00 business time |
| `EVENT_RETENTION_SECONDS` | How long live events stay replayable (default 600) |
| `APP_CLOCK_OFFSET_SECONDS` | Shifts the app clock from the host clock (default 0) |

Service URLs and credentials are read once at start, never logged and never sent to the browser.

## Services

- **PostgreSQL** holds all records and the queues; counts, badges and the send rate are always
  computed from stored rows.
- **MinIO** stores photos privately; the browser reaches them only through
  `/api/attachments/<id>` and `/api/attachments/<id>/thumb`, which check channel membership.
- **Mailpit** receives the invite emails and the daily digest at 07:00 in each workspace's
  business time zone.
