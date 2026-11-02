# Ceibo Shop & Cellar

The online shop and back office for Ceibo, a small Canadian brand of organic sparkling yerba mate.

- **Shoppers** build a 12-can crate (mixed or one flavour) on `/box`, watch each can fly into its slot,
  see an exact total for their province (discount, untaxed deposit, shipping and GST/HST/PST/QST),
  and pay once at `/checkout` with a published test card.
- **Subscribers** manage auto-delivery at `/account/subscriptions/<id>`: pause, resume, skip, swap
  flavours, cancel at end of term, and update the card to recover a failed renewal.
- **Retailers** find the five nearest stockists at `/stockists` and apply at `/stockists/apply`.
- **Staff** use `/office`: the paid-orders queue, stock ledger, search, order detail with refunds,
  and (owner) the dashboard, settings, retailer applications and review moderation.

## Run it

`run.json` holds the three commands the platform runs:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (compiles the server with `tsc` and the browser app with Vite into `dist/`) |
| serve | `npm run start` (`node dist/server/main.js`, binds `0.0.0.0:$APP_PUBLIC_PORT`) |

`GET /api/health` answers `{"status":"ok"}` as soon as the server listens, even while a backing
service is down; the server keeps retrying each service in the background and creates its schema,
collections, catalogue and seed records when they are missing.

## Environment

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | orders, order lines, refunds, stock ledger, crates and holds, provinces and flavours, idempotency keys, change requests, dunning, sessions, email outbox, applications, stockists |
| `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` | PocketBase | customer and staff accounts, saved addresses, reviews, `stock_levels`; its realtime feed drives `GET /api/live` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | invoice and packing-slip PDFs, retailer licence files |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | accounts, payments, subscriptions and plans, invoices, blocking states, refunds, the tenant test clock |
| `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM` | Mailpit | every email (sent over SMTP; `MAILPIT_URL` is probed for the service status) |
| `APP_PUBLIC_PORT` (default 4173), `APP_PUBLIC_URL` | the app | listen port; absolute links in emails |
| `HOLD_SECONDS` (900), `DUNNING_DAY_SECONDS` (86400), `CHANGE_CUTOFF_HOURS` (48) | the app | crate hold window, dunning day length, subscription change cutoff |

No credential is sent to the browser or written to a log. Several processes may share one
database: all scheduled work (hold expiry, renewal charging, dunning steps, change and refund
confirmation, upcoming-renewal notices, the email outbox) is claimed in Postgres first, so each
piece runs once.

## Seed accounts

| Email | Role |
|---|---|
| `owner@ceibo.test` | owner |
| `pack@ceibo.test` | fulfilment |
| `help@ceibo.test` | support |
| `camille@example.test`, `jordan@example.test` | customers |

Test cards: `4242 4242 4242 4242` approves, `4000 0000 0000 0002` declines, `4000 0000 0000 0341`
approves only in the request that enters it.
