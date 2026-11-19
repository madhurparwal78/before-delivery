# Rushes

Rushes is a reference-curation workspace for in-house design teams at groups that own several brands.
Each brand has a sealed workspace with a masonry wall of images and clips. Designers pluck exact frames
out of clips as stills that keep their source clip and timecode, order references into clusters for
presentations, send a cluster to a freelancer through an expiring review link, and schedule its public
release. Public clusters appear on Explore and reach followers in a plain-text digest. Design ops leads
assign pro seats and upgrade each brand's plan, which Kill Bill holds.

## Running it

The commands are in `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, then bundles the server to `dist/server.js` and the client to `dist/client/assets`) |
| serve | `node dist/server.js` |

`serve` applies the Postgres schema and seed data on every start (once per database), listens on
`0.0.0.0` and answers `GET /api/health` with `{"status":"ok"}` whatever state the other services are in.
Several instances may run at once against the same services.

Every seeded account signs in with the password `rushes-demo-2026`, for example `juno@northvale.example`
(designer) or `mara@halden.example` (design ops lead).

## Environment

| Variable | Used for |
|---|---|
| `APP_PUBLIC_PORT` | listening port (default 4173) |
| `APP_PUBLIC_URL` | public base of links in emails (default `http://localhost:<port>`) |
| `DATABASE_URL` | Postgres: every record, sessions, seat assignments, review-comment counts, idempotency records, digests |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: uploaded images and clips and plucked stills under `references/<workspace>/<reference id>.<ext>` |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: the catalog, one account and seat subscription per workspace, the plan read and upgrades |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP (captured by Mailpit): invites, review links, plan receipts and follower digests |

No credential reaches the browser, an API answer or an email. When storage, mail or billing is
unreachable the app keeps serving and reports the outage on each affected action; every call tries the
service afresh, so it recovers without a restart.
