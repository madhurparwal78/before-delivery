# Ferrule & Pell Linewell

Linewell is a browser diagram editor for small groups who draw together. Several people edit one
diagram at once and see each other's cursors. Connectors stay bound to the ports of the shapes they
join and are rerouted by the server around other shapes. Edits made offline or after a session ends
are queued in the browser and replayed. Owners invite editors and viewers by email, restore earlier
versions, and export clean PNG or SVG images of the visible layers.

It is one TypeScript app: a Node server (HTTP and the live socket on one port) and a Preact browser
client bundled by esbuild.

## Run

`run.json` holds the three commands, run in order from this directory:

| Step | Command |
|---|---|
| install | `npm ci` (from the lockfile) |
| build | `npm run build` (bundles `dist/server.js` and `dist/client/`) |
| serve | `npm run start` (foreground, binds `0.0.0.0`) |

On every start the server applies its Postgres schema idempotently, so it starts against an empty or
an existing database, and two instances can start together. `GET /api/health` answers
`{"status":"ok"}`. If MinIO or Mailpit is unreachable at start, the server still starts; exports and
email recover when the service returns.

## Environment

| Variable | Used for |
|---|---|
| `APP_PUBLIC_PORT` | Listening port (default 4173) |
| `APP_PUBLIC_URL` | Base of the links in invitation and mention email |
| `DATABASE_URL` | Postgres: accounts, sessions, diagrams, every operation, members, invites, comments, versions, export records |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO object storage for rendered exports (`exports/<diagramId>/<exportId>.<png|svg>`) |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit SMTP for invitation and mention email |
| `MAILPIT_URL` | Mailpit web address; the app delivers over SMTP, so it needs only `SMTP_HOST` and `SMTP_PORT` |
| `MAIL_FROM` | The From line, e.g. `Linewell <hello@linewell.test>` |
| `GRADING_ROUTES` | `on` enables `POST /api/grading/seed` and `POST /api/grading/save-outage`; anything else answers 404 |
| `PRESENCE_TIMEOUT_MS` | Socket liveness timeout (default 30000) |
| `VERSION_INTERVAL_MS` | Automatic version interval after the first uncovered operation (default 300000) |
| `INVITE_TTL_MS` | Invite lifetime after it was created or last resent (default 604800000) |

No value from the environment is sent to the browser.

## Services

- **Postgres** is the source of truth; operations are applied one at a time per diagram and given
  server sequence numbers.
- **MinIO** keeps the rendered exports; an export becomes ready only once storage confirms the object.
- **Mailpit** receives one message per invite, resend or mention, each with exactly one recipient.
