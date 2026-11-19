# Pinbyte Switchyard

A visual automation builder for multi-member workspaces. A team drafts an automation on a step canvas, test-runs it on
sample data, publishes it as a numbered version, watches every run live, cancels runs that are asleep in a wait step and
replays failed runs from a chosen step.

One TypeScript server (Node 22) serves the API, the live stream and the built React app, and runs the automation engine.
It uses three services and nothing else: Postgres (all state), MinIO (JSON exports and imported files) and Mailpit (real
SMTP: sign-up confirmations, member invites and every send-email step).

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (compiles the server and bundles the browser app into `dist/`) |
| serve | `npm start` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

The schema is created idempotently when the server starts. The seed (four people, two workspaces, the `Orders` and
`Followups` tables and the `Order intake` automation) is created only when absent. Sign in as
`imara@fulfilment.example` with password `switchyard-demo-1`.

## Environment

| Variable | Service or use | Default |
|---|---|---|
| `DATABASE_URL` | Postgres | none (required) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (exports under `exports/<workspace>/<automation>/v<n>.json`, imports under `imports/<workspace>/<import>.json`) | none (required) |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit (SMTP) | none (required) |
| `MAILPIT_URL` | accepted for deployment parity; the app talks SMTP only | n/a |
| `MAIL_FROM` | From of every email | `Pinbyte Switchyard <runs@switchyard.example>` |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | port bound (also the instance identity) and the address in emailed links | `4173`, `http://127.0.0.1:<port>` |
| `GRADING_KEY` | guards the grading setup and clock routes | `gk-switchyard-4c9e27b1` |
| `WORKSPACE_TIME_ZONE` | zone of schedules and of every displayed time | `America/New_York` |
| `RETRY_COUNT`, `RETRY_DELAY_SECONDS` | retries after a failed attempt and the delay between attempts (workspace seconds) | `2`, `30` |
| `STEP_LIMIT` | step executions one run may make | `40` |
| `WAIT_MAX_SECONDS` | longest wait step | `86400` |
| `WEBHOOK_BODY_LIMIT_BYTES` | webhook body limit | `4096` |
| `IDEMPOTENCY_WINDOW_SECONDS` | how long a webhook key is remembered (workspace seconds) | `600` |
| `EDIT_HOLD_SECONDS` | how long a save holds a step against other members | `20` |
| `SCHEDULE_TICK_SECONDS` | real seconds between checks for due timers | `1` |
| `CANVAS_BREAKPOINT_PX` | width below which the canvas becomes a step list (the only knob besides the zone that reaches the browser) | `720` |

Time rules (waits, retries, schedules, idempotency windows, edit holds, run timestamps) follow a per-workspace clock: machine
time plus a stored offset that only the grading clock route moves. The browser never decides any of it.
