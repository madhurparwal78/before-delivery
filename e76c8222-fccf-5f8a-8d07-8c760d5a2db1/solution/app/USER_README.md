# Fernhollow Access Seatweaver

Seatweaver is the dispatch desk for Fernhollow Access, an agency that books freelance ASL
interpreters into medical, legal, education and community assignments.

- **Requesters** (clinics, courts, school districts) draft and submit requests, attach prep
  material, watch seat status and cancel after seeing the charge.
- **Dispatch coordinators** fill seats on the dispatch board by dragging a thread from an
  interpreter chip to a request card. The four gates (credential, valid on date, schedule with a
  30-minute travel buffer, consumer preference) are checked on hover and again on the server
  when the offer is created.
- **Interpreters** answer offers from an emailed single-use link, keep credentials and scans
  current and submit signed timesheets.
- **Deaf consumers** record preferred and blocked interpreters.
- **The billing lead** approves timesheets, maintains hourly rates and reads each organisation's
  Kill Bill invoices.

Every account is seeded; sign in with a seeded email and the shared demo passcode
`weave-demo-2026` (for example `rowan@fernhollow.test`, coordinator).

## Running

`run.json` holds the three commands, run from the app directory:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks server and client, bundles the client with esbuild into `dist/`) |
| serve | `node dist/server/main.js` |

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (4173 when unset) and serves the client and
`/api` from that one port. `GET /api/health` answers `{"status":"ok"}` once PostgreSQL is
reachable and the schema is applied; until then it answers 503 `{"status":"starting"}` while the
server keeps retrying. The schema is applied on every start, and the seed data is inserted only
into an empty database. Several instances may share the same services: background work (offer
expiry, the mail outbox, credential warnings) takes row locks so nothing is sent twice.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | system of record, mail outbox, sessions, idempotency keys |
| `SMTP_HOST`, `SMTP_PORT` | SMTP server (messages land in Mailpit) | delivers the outbox |
| `MAILPIT_URL` | Mailpit | only probed for the mail status |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | one account per requester organisation, external charges, invoice reads |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3) | prep files, credential scans, signed timesheet PDFs |
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |
| `APP_PUBLIC_URL` | — | origin used in emailed offer links (default `http://localhost:<port>`) |

All of these are read once at start in `server/config.ts`. None of the service values is sent
to the browser, written into a response or put in an email.

When Kill Bill is unreachable, approvals, charged late cancellations and invoice reads answer
`billing_unavailable` and change nothing; everything else keeps working. When mail is
unreachable, actions still succeed and their emails wait in the outbox until the server can
deliver them. When MinIO is unreachable, uploads and approvals answer `storage_unavailable`.

## Layout

- `server/` — the Node.js HTTP server (`node:http`), domain rules (`server/domain/`), routes,
  and the clients for SMTP, Kill Bill and S3.
- `client/` — the browser app in TypeScript, bundled by esbuild; fonts are self-hosted.
- `shared/` — types and time helpers used by both sides.
