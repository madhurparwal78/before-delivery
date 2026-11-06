# Kiln Desk

Kiln Desk is the firing desk for community pottery studios that share electric kilns and charge
members by the volume of each piece. Every studio is its own tenant with three roles:

- **Member potters** log a piece with a photo and its dimensions, see an exact bisque and glaze
  quote, prepay firing credit and follow the piece's passport until they collect it.
- **Kiln techs** check pieces onto the bisque and glaze racks, build loads in the stack elevation
  planner (drag a ticket onto a deck, or use the keyboard Place piece and Move piece dialogs),
  fire, cool and unload them with an outcome per piece, and record collection.
- **Studio owners** schedule firing rates from a chosen date, set the pickup window and the daily
  storage fee, invite staff and members, deactivate and reactivate members, watch the backlog and
  the month's revenue, read the daily firing log, close finished months, export the monthly
  statement, issue refunds and credit adjustments and mark overdue pieces uncollected.

Studios are seeded; every seeded password is the one printed in the brief (for example studio
`ember-lane`, `rowan@ember-lane.example` as owner, `ines@ember-lane.example` as kiln tech,
`priya@ember-lane.example` as member).

## Running it

`run.json` holds the three commands, run from this folder:

| Step | Command |
| --- | --- |
| install | `npm ci` |
| build | `npm run build` (esbuild bundles the server to `dist/server.js` and the browser app to `dist/public`) |
| serve | `npm run start` (foreground, binds `0.0.0.0:$APP_PUBLIC_PORT`) |

On every start the app applies its schema and, when the database is empty, the seed data; several
instances may start against one database at once. `GET /api/health` answers 503
`{"status":"starting"}` until Postgres answers and the schema is in place (it retries every 2
seconds), then 200 `{"status":"ok"}`. Kill Bill and MinIO may be down at start; the features that
need them recover on their own.

## Configuration

Every value is read from the environment in `src/server/config.ts`; none is sent to the browser.

| Variable | Service | Default |
| --- | --- | --- |
| `DATABASE_URL` | Postgres, the system of record | required |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD` | Kill Bill, every payment and refund | required |
| `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | the Kill Bill tenant shared by all studios | required |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE` | MinIO, the private intake-photo bucket | required |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO credentials | required |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit (SMTP) for invites, receipts, ready and reminder emails | required |
| `MAIL_FROM` | sender of every email | required |
| `APP_PUBLIC_PORT` | the HTTP port | 4173 |
| `APP_CLOCK_START` | an ISO 8601 UTC instant the app clock starts from | the system clock |
| `SESSION_TTL_SECONDS` | session lifetime | 43200 |
| `INVITE_TTL_SECONDS` | invite link lifetime | 604800 |
| `SIGNIN_LOCK_SECONDS` | sign-in lock after 5 failures | 900 |
| `BILLING_RETRY_SECONDS` | how often the settler retries pending billing work (at most 60) | 15 |
| `REMINDER_SWEEP_SECONDS` | how often pickup reminders and storage days are swept (at most 60) | 60 |

## What talks to what

- **Postgres** holds studios and their storage-fee history, people, sessions, sign-in attempts,
  invites, pieces and their history, rate schedules, kilns, loads, decks, placements, charges, the
  paired ledger, stored idempotent responses, pack purchases and attempts, sent reminders, storage
  days and closed months with their stored statements. Live updates travel between instances
  over Postgres `LISTEN`/`NOTIFY` and reach browsers as server-sent events on `/api/events`.
- **Kill Bill** gets one account per member (`kd-<member id>`) with a card and a credit payment
  method, one PURCHASE per credit pack, per settled firing fee and per settled storage day, and one
  REFUND per refund. When it is unreachable or slow, unloads still succeed with charges pending,
  and a background settler on every instance finishes pending charges, purchases and refunds
  exactly once.
- **MinIO** stores intake photos under `studios/<studio>/pieces/<piece>/<uuid>.<ext>` in a private
  bucket; browsers only reach them through `GET /api/pieces/{id}/photo`.
- **Mailpit** receives every email over plain SMTP from `MAIL_FROM`.
