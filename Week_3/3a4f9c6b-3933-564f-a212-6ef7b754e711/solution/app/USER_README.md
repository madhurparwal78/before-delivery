# Keelson

Keelson, by Tideline Works, is a promotion control plane for GitOps continuous delivery. Platform teams
use it to move release bundles from dev to staging and on to regional prod clusters. It applies sync
windows (judged in each cluster's time zone), versioned freeze policies, release-manager approvals that
expire, freeze breaks with a recorded reason, and exact rollback. Each cluster's own sync agent reports
per-resource health back to Keelson, and Keelson never talks to Kubernetes itself.

The JSON API (`/api/...`) and the workspace are served from one port. The workspace has these screens:
`/sign-in`, `/projects/<slug>` (stage graph, ledger strip, evidence column),
`/projects/<slug>/windows` (sync windows and freeze policy) and `/approvals/<token>` (the link sent in
approval-requested messages).

## Run it

The commands come from `run.json`:

```sh
npm ci          # install from package-lock.json
npm run build   # type-check, build the client into dist/client, compile the server into dist/server
npm run start   # node dist/server/main.js: serves on 0.0.0.0:$APP_PUBLIC_PORT (default 4173)
```

At every start the server applies the schema and the seed data, without duplicating anything that is
already there. Until Postgres answers, `GET /api/health` returns 503 `{"status":"starting"}` and the server
tries again every 2 seconds. If object storage or mail is unreachable, the server still starts and answers
200 `{"status":"ok"}`. Uploads and notices wait in Postgres and are delivered once each when the service
returns.

Every seeded person signs in with the password `keelson-demo-2026`. The seeded people are Ines Okafor,
Tomás Reyes, Mei Lindqvist, Hana Sato, Olu Adeyemi, Kofi Brandt, Ravi Castell and June Park, each at
`<first>.<last>@keelson.test`.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | The system of record: every record, sessions, request keys, the stage lock, health rows, append-only history and the delivery queues |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | Bundle objects (`bundles/<project>/<digest>.json`) and numbered evidence snapshots (`evidence/<project>/<promotion>/<nnn>.json`) |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit | Plain-text notices from `Keelson <keelson@tideline.test>` |
| `APP_PUBLIC_PORT` | — | Listening port (default 4173) |
| `APP_PUBLIC_URL` | — | Base of the links in messages (default `http://localhost:<port>`) |
| `KEELSON_APPROVAL_TTL_SECONDS` | — | Approval request and approval lifetime (default 14400) |
| `KEELSON_SESSION_TTL_SECONDS` | — | Session lifetime (default 43200) |
| `KEELSON_REQUEST_KEY_TTL_SECONDS` | — | How long a `Request-Key` replay is kept (default 86400) |

No credential, endpoint or bucket name is written into the source or sent to the browser.
