# Lanternline Handshake Desk

A shared desk for the compliance teams of two licensed crypto exchanges (Neris Digital in Vilnius time, Kallang
Exchange in Singapore time). It decides each withdrawal's Travel Rule path, sends the data to the receiving exchange
(a signed network message or a private data request page by mail), holds the funds until the answer, takes in signed
messages byte for byte, bills message usage each business month through Kill Bill and produces the regulator's
monthly file. The public directory lists jurisdictions, their rules and listed exchanges.

## Run

`run.json` is the run manifest:

- install: `npm ci` (from the committed `package-lock.json`)
- build: `npm run build` (type-checks with `tsc` in strict mode, then bundles the server and the screens with esbuild into `dist/`)
- serve: `node dist/server.js` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173)

At start the server waits for PostgreSQL, applies the schema and the exact seed data idempotently (an empty
database comes up fully seeded), creates the MinIO bucket if it is missing (retrying in the background while MinIO
is unreachable) and runs its timed work every two seconds. `GET /api/health` answers `{"status":"ok"}`.

## Configuration (read once, in `src/server/config.ts`)

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | every record: members, sessions, cases, counterparties, messages, months, keys |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | original messages (`<slug>/messages/<id>`) and licence certificates (`<slug>/certificates/<id>`) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | one account per workspace (`lanternline-<slug>`), one invoice per closed month |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP) | data request page mails and month-closed mails |
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |
| `APP_PUBLIC_URL` | — | public base for mail links and the sitemap (default `http://localhost:<port>`) |
| `ANSWER_WINDOW_SECONDS` (3600), `REVIEW_CLAIM_SECONDS` (900), `DATA_REQUEST_PAGE_SECONDS` (86400), `RETENTION_SECONDS` (157680000), `PARTNER_RATE_WINDOW_SECONDS` (60), `REGULATOR_FILE_RATE_WINDOW_SECONDS` (600), `SESSION_SECONDS` (28800) | — | timers |

No credential is stored in the source or sent to the browser. Passwords are scrypt hashes; session tokens and
partner keys are kept only as SHA-256 digests.

## Seeded staff

Every seeded member's password is `Lantern-Desk-2027!`: `officer@neris.example`, `analyst@neris.example`,
`ops@neris.example`, `finance@neris.example`, `support@neris.example`, and the same five at `kallang.example`.
