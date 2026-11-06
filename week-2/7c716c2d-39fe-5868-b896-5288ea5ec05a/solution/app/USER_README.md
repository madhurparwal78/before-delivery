# Tallyroom Workspace

One workspace for a small product company: issues and two-week cycles counted on the company's own
working-day calendar (the Crease ribbon folds weekends and holidays away), team chat with channels,
threads and an inbox, versioned shared docs, a live office floor plan with rooms you join or knock on,
and per-seat billing. One sign-in and one member list cover all of it, and every open page receives
changes through one live event stream.

## Run it

The commands are in `run.json`:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs the locked dependencies |
| build | `npm run build` | type-checks all TypeScript (`tsc --noEmit`), bundles the server to `dist/server.js` and the browser app to `dist/public/` |
| serve | `npm start` | serves the app and the API on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173) |

On every start the app applies its schema idempotently, loads the seed workspaces into an empty
database, creates the storage bucket if it is missing and registers the seat catalog, accounts and
subscriptions with Kill Bill. Each of these is retried in the background until the service answers;
`GET /api/health` answers `{"status":"ok"}` from the first moment, whatever is down.

Seeded people all use the password `tally-demo-1` (for example `ana@kereru.test`, the owner of
Kereru Labs, and `hal@halyard.test`, the owner of Halyard Works).

## Services

| Service | Used for | Environment |
|---|---|---|
| Postgres | system of record: people, sessions, issues, chat, docs, rooms, knocks, invites, calendar saves, finished-cycle records, idempotency records, the mail outbox, the attachment deletion queue and the event log | `DATABASE_URL` |
| Mailpit (SMTP) | every email (invites, mentions, the 08:00 digest), sent from the outbox | `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM` |
| Kill Bill | one account and one per-seat subscription per workspace; the subscription's `seats` custom field is the seat limit | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` |
| MinIO (S3 API) | attachment files, stored before their row is written | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |

## Other settings

| Variable | Default | Meaning |
|---|---|---|
| `APP_PUBLIC_PORT` | 4173 | listening port |
| `APP_PUBLIC_URL` | (required) | the address written into email bodies |
| `INVITE_TTL_SECONDS` | 604800 | an invite expires this long after it is sent |
| `KNOCK_TTL_SECONDS` | 60 | a knock waits this long before it expires |
| `PRESENCE_AWAY_SECONDS` | 600 | a person in a room turns away after this long without activity |
| `STREAM_GRACE_SECONDS` | 60 | a person leaves their room this long after their last event stream closes |
| `OUTBOX_RETRY_SECONDS` | 30 | wait between delivery attempts while SMTP fails |
| `IDEMPOTENCY_TTL_SECONDS` | 86400 | how long an `Idempotency-Key` replays its first answer |
| `SERVER_CLOCK_START` | unset | an ISO 8601 instant the server's now equals at process start, then advances in real time; unset means the process clock |

Credentials are read only from the environment and never reach the browser. Several copies of the
app may share one database and the same services: outbox rows are claimed with `SKIP LOCKED`, events
are ordered by a per-workspace lock, and each copy delivers every stored event to its own streams.
