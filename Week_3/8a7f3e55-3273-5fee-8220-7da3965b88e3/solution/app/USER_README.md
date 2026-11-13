# Relayline

Relayline is the dispatch and billing desk of Tandem Hands Collective, a regional American Sign Language interpreting
agency. Coordinators turn booking requests into fully covered solo or team assignments, interpreters claim open work and
collect prep materials, client requesters book and cancel with the charge shown up front, and the billing manager turns
finished and late-cancelled work into invoices that match each contract and reconcile with Kill Bill.

One Node.js 22 (TypeScript) server serves the web app and its JSON API from one origin. Postgres holds every record; mail goes
to an SMTP server (Mailpit in development); invoice charges are posted to and read back from Kill Bill; prep files live in an
S3-compatible bucket (MinIO in development).

## Run it

`run.json` holds the three commands:

```
install: npm ci
build:   npm run build      (compiles the server with tsc and builds the front end with Vite into dist/)
serve:   npm run start      (foreground; binds 0.0.0.0 on APP_PUBLIC_PORT, default 4173)
```

The server applies its schema and seed at start (idempotently, under an advisory lock, so several processes may start
together). If Postgres is not reachable yet it retries every few seconds. If Kill Bill, the mail server or the bucket is
down it still starts and recovers each on its own.

Seeded accounts all use the password `relayline-demo-2026`; for example `dana.okafor@tandemhands.example` (coordinator),
`morgan.ellis@tandemhands.example` (billing manager), `lena.torres@riverbend.example` (requester) and
`jordan.reyes@interpreters.example` (interpreter).

## Environment

| Variable | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | Postgres | connection string |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP) | where and as whom mail is sent |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | account, charge and invoice-item calls |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO / S3 | prep material objects under `prep/<booking id>/<key>` |
| `APP_PUBLIC_PORT` | the app | listen port (default 4173) |
| `OPEN_CALL_LEAD_MINUTES` (1440) | the app | an open call closes this many elapsed minutes before the start |
| `PREP_ACCESS_GRACE_MINUTES` (4320) | the app | prep access grace after an assignment ends |
| `PREP_LINK_TTL_SECONDS` (300) | the app | lifetime of a prep download link |

No URL, credential or key is written in source, and none is sent to the browser.

## Layout of the source

- `server/` the API (`routes/`), domain rules (`rules/`), service clients (`services/`), schema and seed.
- `shared/` the API types and the money formatter used by server and browser.
- `web/` the React front end and its styles; fonts are bundled from `web/fonts/`.
