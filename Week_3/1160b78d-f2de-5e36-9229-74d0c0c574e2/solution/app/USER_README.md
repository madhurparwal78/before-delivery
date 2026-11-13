# Switchlamp

Switchlamp is the on-call and incident desk of Tarecross Software. Responders, leads and admins sign in to hold the pager, keep every hour of the rota covered and set up the firm's services. Stakeholders read a public status page without signing in.

What it does:

- Accepts monitoring events through RabbitMQ and groups them into incidents and alerts by dedup key.
- Walks escalation policies on the server clock and pages the holder of each level by in-app notice and by mail.
- Keeps schedules with layers and overrides, and computes the final schedule for a range and a zone.
- Lets people acknowledge, snooze, reassign, merge, split and resolve incidents, and keep notes on them.
- Publishes status updates, maintenance windows and the public status page.
- Runs analytics jobs and keeps webhook subscriptions, API keys and roles.

## Run it

`run.json` holds the three steps:

| Step | Command | What it does |
| --- | --- | --- |
| install | `go mod download && npm ci` | Downloads the Go modules and the npm packages (Preact, htm and the three fonts) from their lockfiles. Nothing else is fetched at any time. |
| build | `node scripts/prepare.mjs && go run ./cmd/plates && go build -o bin/server .` | Copies the browser modules and fonts into `web/`, draws the three plates `web/img/dusk.jpg`, `web/img/night.jpg` and `web/img/signin.jpg` with the seeded procedural renderer, then builds the server. |
| serve | `./bin/server` | Runs in the foreground on `0.0.0.0:4173`, or on the port in `APP_PUBLIC_PORT`. |

The server embeds `web/`, so the build step must run before `go build`. It needs Go 1.27 and Node 22. Run `node scripts/assets.mjs` after a build to refresh `assets.json`, and `node scripts/notices.mjs` after the install step to refresh `THIRD_PARTY_NOTICES.md`.

`GET /api/health` answers 200 when the server is ready and 503 `{"status":"starting"}` while Postgres is unreachable. The server retries Postgres every 5 seconds.

## Environment

Every value is read once at start and is never sent to the browser.

| Variable | Used for | Default |
| --- | --- | --- |
| `DATABASE_URL` | Postgres, the system of record. Required. | none |
| `AMQP_URL` | RabbitMQ, the durable queue `switchlamp.<instance>.events` and its dead-letter queue. | none |
| `VALKEY_URL` | Valkey, the shared rate counter and cached responses. | none |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit, the SMTP receiver for notification and status mail. | none |
| `WIREMOCK_URL` | The outside webhook receiver; webhooks are posted to this base URL plus the subscribed path. | none |
| `MAIL_FROM` | Sender of the mail. | `Switchlamp <pager@tarecross.example>` |
| `APP_PUBLIC_URL` | Builds the links in mail. When unset, the origin of the request on the serving port is used. | none |
| `APP_PUBLIC_PORT` | Port the server listens on. | `4173` |
| `SWITCHLAMP_INSTANCE` | Names this copy's queues and Valkey keys, so copies with separate databases never read each other's work. | `main` |

`MAILPIT_URL`, named in the brief as the address of the mail receiver, is not read by the server; mail leaves by SMTP only.

The signing secret for acknowledge links and tokens is generated on first start and kept in Postgres.

## Files

| Path | Content |
| --- | --- |
| `web/` | The pages' scripts and styles, plus the files the build writes: `web/vendor/*.mjs`, `web/fonts/*.woff2` and `web/img/*.jpg`. |
| `cmd/plates/` | The seeded procedural renderer of the plates; it uses only the Go standard library. |
| `scripts/` | `prepare.mjs` (build), `assets.mjs` and `notices.mjs` (bookkeeping). |
| `assets.json` | Source, licence and sha256 of every binary asset. |
| `THIRD_PARTY_NOTICES.md` | Name, version, licence and copyright of every shipped package and font. |
