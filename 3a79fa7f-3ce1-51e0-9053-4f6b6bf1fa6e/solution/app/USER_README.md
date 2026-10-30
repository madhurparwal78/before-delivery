# Tern Foils Build and Checkout

The storefront and order system of Tern Foils: a five-question fit quiz, a live 3D configurator for three
electric hydrofoil boards with a ride-time estimate from battery, wing, speed gear and rider weight, saved and
shared builds, monthly financing, a capped cart with discount codes, checkout to six countries with exact
shipping, dangerous goods fees, Canadian tax by postal code and ship and arrival dates, demo-day bookings,
trade-ins, protection plans, board registration and warranty, callbacks, support cases, order tracking, and a
staff console.

## Run it

The commands live in `run.json` and run from the app root:

| Step | Command |
|---|---|
| install | `npm ci --no-audit --no-fund` |
| build | `npm run build` (type-checks the TypeScript in strict mode, then bundles `dist/server.js` and `dist/public/`) |
| serve | `node dist/server.js` (foreground, production build) |

The server listens on `0.0.0.0` at `APP_PUBLIC_PORT` (4173 when unset). `GET /api/health` answers 503
`{"status":"starting"}` until PostgreSQL holds the schema and seed rows (created idempotently at every start,
retried every 2 seconds), then 200 `{"status":"ok"}`. Kill Bill or Mailpit being down never blocks start-up.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL, the only datastore: every record, the stock, the notice outbox |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit over SMTP for the six notices |
| `MAIL_FROM` | sender of every notice |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: one account per customer, one itemised external-charge invoice per order (merchandise, shipping, dangerous goods, tax), every item adjusted to zero on cancellation |
| `APP_PUBLIC_URL` | links in email (password reset) |
| `APP_PUBLIC_PORT` | listening port, 4173 when unset |
| `CLOCK_CONTROL` | `enabled` turns on `PUT`/`DELETE /api/_clock` to set and clear the server clock |

No value has a default except the port, and none of them reaches the browser.

## Staff logins (seeded)

| Email | Password | Role |
|---|---|---|
| `staff@ternfoils.com` | `StaffPass2026` | admin |
| `dealer@ternfoils.com` | `DealerPass2026` | dealer |
| `support@ternfoils.com` | `SupportPass2026` | support |

Customers sign up at `/signup`. Staff sign in at `/login` and work in `/staff`: admin sees Trade-ins, Demo days,
Orders and Outbox; dealer sees Demo days; support sees Trade-ins and Outbox.

## Discount codes

`FLYFIRST` (10 percent of the accessory subtotal) and `CHARGE25` ($25.00 off an accessory subtotal of $100.00
or more), at most two per cart.
