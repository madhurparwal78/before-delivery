# Halyard Hall Seatwise

The box office for Halyard Hall, a 900-seat concert hall. Fans choose exact seats on a horseshoe seat map
(with the Sightline wedge showing each seat's angle and distance to the stage), hold them for a short time and
pay one itemised total; join a sold-out tier's waitlist and accept offers in join order; and exchange or refund
tickets from My tickets, which stays live in every open tab. The venue owner signs in with a passcode,
publishes performances in venue time (America/Chicago), watches seats remaining live and reconciles every
order against its Kill Bill payment and its receipt in the outbox.

## Running it

`run.json` holds the commands; run them from this directory:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the packages in `package-lock.json` |
| build | `npm run build` | type-checks and compiles the server to `dist/node`, bundles the browser app to `dist/client` |
| serve | `npm run start` | runs `node dist/node/server/main.js` in the foreground on `0.0.0.0:$APP_PUBLIC_PORT` |

`GET /api/health` answers `503 {"status":"starting"}` until the database schema and seed data are in place,
then `200 {"status":"ok"}`. The schema and seed data are applied at every start and are safe to apply again.

## Environment

Every value is read from the environment once, at start (`src/server/config.ts`); none is sent to the browser.

| Variable | Used for | Default |
|---|---|---|
| `DATABASE_URL` | Postgres, the only datastore (seats, holds, orders, tickets, waitlist, offers, idempotency keys, outbox) | required |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: one account per fan email, purchases, exchange top-ups and refunds | required |
| `SMTP_HOST`, `SMTP_PORT` | the SMTP server (Mailpit) that receives every e-mail | required |
| `MAIL_FROM` | sender of every e-mail | `Halyard Hall Box Office <boxoffice@halyardhall.example>` |
| `APP_PUBLIC_PORT` | port to listen on | `4173` |
| `APP_PUBLIC_URL` | public base address used in offer e-mail links | required |
| `HOLD_SECONDS` | hold length | `600` |
| `OFFER_SECONDS` | waitlist offer window | `900` |

## Services

- **Postgres** (`DATABASE_URL`): all state. Several copies of the server can share one database: seat changes run
  under row locks, idempotency keys and the outbox are claimed in the database, and every copy hears every
  change through Postgres `LISTEN`/`NOTIFY` and pushes it to its open pages over a same-origin WebSocket
  (`/api/events`).
- **Kill Bill** (`KILLBILL_URL`): payments, exchange top-ups and refunds. If it cannot be reached, checkout
  answers `503 payments_unavailable` and nothing is sold.
- **Mailpit over SMTP** (`SMTP_HOST`:`SMTP_PORT`): receipts, offers, exchange and refund confirmations. Every
  e-mail is recorded in the outbox first; while mail is down it stays queued and any running copy sends it
  once mail answers again.

The owner passcode is seeded as `brass-rail-1897`.
