# Twohouse

Twohouse is a private workspace for two separated parents who share one child under a parenting plan.
The planning parent creates a household, enters the plan once and invites the other parent. The server
derives who has the child on every night of the year and why, and the Calendar shows the year as two
colour fields: mint for the planning parent, pink for the other. Swap requests and cost reimbursements run
through bounded decisions with server-kept deadlines; either parent can produce a year record PDF and the
planning parent can share a read-only handover page.

## Run it

`run.json` holds the three commands (Node.js 22):

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (compiles the server with `tsc`, bundles the browser app with esbuild; writes nothing to any service) |
| serve | `node dist/server.js` (foreground, `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173) |

`GET /api/health` answers `{"status":"ok"}` once the schema is applied. Start-up applies the schema and the
three invented seed households idempotently, under a database advisory lock, so several processes may start
together on one database.

## Environment

Everything is read once at start in `src/config.ts`.

| Variable | Meaning | Service |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Postgres |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | where notices go and who they are from | Mailpit |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | receipts and year-record PDFs | MinIO |
| `GOTENBERG_URL` | renders the year-record HTML to PDF | Gotenberg |
| `APP_PUBLIC_PORT` | listening port (default 4173) | — |
| `APP_PUBLIC_URL` | origin for links and the `Origin` check (default `http://localhost:<port>`) | — |
| `ANSWER_WINDOW_SECONDS` | how long a sent request can be answered (default 172800) | — |
| `REMINDER_LEAD_SECONDS` | how long before the deadline the one reminder goes (default 21600) | — |
| `INVITE_TTL_SECONDS` | how long an invite link works (default 604800) | — |

No credential is sent to the browser or written to a log line. The app keeps state only in Postgres and
MinIO.

## Sign in with the seed households

`Maple & Fern` (robin@maple-fern.test / `Hollow-Robin-2026`, sam@maple-fern.test / `Hollow-Sam-2026`),
`Birch Lane` and `Cedar Court`: see the brief's seed table for the rest.
