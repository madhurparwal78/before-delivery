# Lanternfold Rooms

A shared infinite canvas for freelance facilitators who run paid remote workshops. The facilitator builds a
board from a template, sets the client fee and shares one join link. Participants join without an account,
write private notes in timed silent rounds, then everyone sees the face-down reveal, clusters the notes and
spends a fixed budget of dots. Closing the workshop stores the recap files (board PDF, one PNG per frame, the
notes CSV), raises the sponsor's invoice in Kill Bill and emails the recap the same day. Facilitators pick a
Free, Studio or Agency plan, mirrored from Kill Bill.

## Running it

`run.json` holds the three commands; nothing else is needed.

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (compiles the server with `tsc`, type-checks the client and bundles it with Vite into `dist/client`) |
| serve | `node dist/server/server/main.js` (binds `0.0.0.0` on `APP_PUBLIC_PORT`) |

On every start the server applies its schema and the seed data to Postgres idempotently, then serves the API,
the live stream and the built client from one process. Every instance also runs the background worker (queued
invites, recap attempts, the billing refresh, trash purge and queued image deletions), coordinated through
Postgres leases, so any number of identical instances can run over the same services.

Seeded facilitators: Juno Marlowe (`juno@lanternfold.test`, Europe/Lisbon, Studio) and Odile Brack
(`odile@lanternfold.test`, America/Toronto, Free). Their passwords are in the product brief.

## Environment

| Variable | Default | Used for |
|---|---|---|
| `DATABASE_URL` | required | Postgres: all application state, sessions, the operation log, counters, the billing mirror |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | required | MinIO: image stickies and recap files |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | required | Mailpit (SMTP): invites and recap emails |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | required | Kill Bill: the plan catalog, facilitator subscriptions and invoices, sponsor invoices |
| `INSTANCE_ID` | `a` | reported by `/api/health` |
| `PUBLIC_BASE_URL` | `http://localhost:<port>` | join links and recap links |
| `JOIN_LINK_GRACE_SECONDS` | 86400 | join link expiry after the scheduled end |
| `DELIVERY_RETRY_SECONDS` | 15 | background worker interval |
| `PAYMENT_GRACE_SECONDS` | 604800 | past due to read-only |
| `TRASH_PURGE_SECONDS` | 2592000 | how long a trashed frame can be restored |
| `SIGNIN_WINDOW_SECONDS` | 900 | sign-in failure rate-limit window |
| `APP_PUBLIC_PORT` | 4173 | listening port |

No credential or service address is compiled into the code or sent to the browser. Storage, mail or Kill Bill
may be unreachable at boot or later: the board keeps working, dependent work is queued with its reason and
finishes on its own once the service returns. `GET /api/health` reports each dependency's state.
