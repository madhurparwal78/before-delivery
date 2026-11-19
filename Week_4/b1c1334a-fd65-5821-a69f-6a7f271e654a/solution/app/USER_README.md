# Tallyframe

Tallyframe is a self-hosted relational spreadsheet for small operations teams. A document holds
typed tables (Text, Decimal, Date, Bool, Reference and Formula columns), summary tables and
per-person row access. Every edit, paste, rename, undo and redo recalculates every dependent cell
on the server in the same request, and the browser plays the Settle roll over the cells that
changed, in dependency order. Owners share documents by email invite and export CSV files that are
stored in object storage and verified before every download.

## Running it

`run.json` holds the three commands:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the lockfile's packages |
| build | `npm run build` | type-checks the server and client with strict TypeScript, compiles the server to `dist/server`, bundles the client to `dist/client` |
| serve | `npm run start` | runs `node dist/server/main.js` in the foreground; no build step |

The server listens on `0.0.0.0` at `APP_PUBLIC_PORT`. `GET /api/health` answers `{"status":"ok"}` as
soon as the process listens, whatever the state of its services. On its first start against an
empty database it creates the schema and the seed accounts and the Harbour Lane Ops document;
several instances may start together against one database.

Seeded accounts (password `ledger-demo-2026`): mara@, dev@, priya@, sam@ and jonah@harbourlane.test.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres, the single store of record (accounts, sessions, documents, cells, history, undo stacks, shares, export records, idempotency keys) |
| `SMTP_HOST`, `SMTP_PORT` | the SMTP server invites are sent through (Mailpit in development); a fresh connection per message, 5 s limit |
| `MAIL_FROM` | the invite's From line, used as given |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | object storage (MinIO) for CSV exports, signed with AWS Signature Version 4; 10 s per call |
| `APP_PUBLIC_PORT` | the listening port (default 4173) |
| `APP_PUBLIC_URL` | the origin used in invite links and accepted as a same-site Origin (default `http://localhost:<port>`) |
| `IDEMPOTENCY_TTL_SECONDS` | how long a commit's Idempotency-Key is remembered (default 86400) |

Credentials are read only from these variables and never reach the browser.

## Services

- **Postgres** holds all state. While it is unreachable every route but health answers
  `503 database_unavailable`, and the app recovers when it returns.
- **Mailpit (SMTP)** receives one invite per share action or Resend. When mail is down a share is
  saved as Not sent and Resend sends it later.
- **MinIO (S3)** stores every export at `exports/<document id>/<export id>.csv`. An export is Ready
  only after the stored object's size and SHA-256 are read back and match.
