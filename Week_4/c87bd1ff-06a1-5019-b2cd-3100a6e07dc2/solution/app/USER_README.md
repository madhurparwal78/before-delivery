# Gavelhouse

Gavelhouse is the online saleroom of Harrow & Gilt Auctioneers, a small Rotterdam auction house. Each week it runs one timed sale of about 120 lots of vintage wristwatches and film cameras.

- **Bidders** register, wait for an admin to approve a spending limit, watch lots, set maximum bids and pay their invoices.
- **Consignors** offer items, follow their results without ever seeing who bid, answer second-chance choices and read locked seller statements.
- **The specialist, cashier and admin** run the sale from their own desks.

It is a Go server with a TypeScript browser front end. All data lives in PostgreSQL and people sign in through Keycloak (OpenID Connect). Live updates and notices stay inside the app: every page holds one live socket.

## Run it

`run.json` holds the three commands:

- install: `npm ci --prefix web && go mod download`
- build: `npm run build --prefix web && go build -o bin/gavelhouse .`
- serve: `bin/gavelhouse` (listens on `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173)

`GET /api/health` answers `{"status":"ok"}` whenever the server is running.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL, the system of record (the schema and seed data are applied at every start) |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM` | Keycloak back channel: token exchange, realm roles and seed users |
| `AUTH_ISSUER_URL` | Where the browser is sent to sign in |
| `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | The OpenID Connect client (also its service account for the Keycloak admin API) |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | Listen port; the public origin used for the sign-in callback |
| `LOT_GAP_SECONDS` (60), `SOFT_CLOSE_SECONDS` (120), `PAYMENT_DUE_SECONDS` (259200), `OFFER_SECONDS` (86400), `WATCH_NOTICE_SECONDS` (300) | The sale's timing rules |

No credential or service URL is written into source or sent to the browser.

## Where things are

- `*.go`: the server, one file per part of the domain (bids, closing, offers, invoices, statements, desks, live socket).
- `schema.sql`: the PostgreSQL schema, applied idempotently at start.
- `web/`: the TypeScript front end (Preact, strict mode), bundled by esbuild into `web/dist`, which the Go binary embeds.
