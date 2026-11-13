# Holdfast Register

The equity register of Tidecraft Robotics. Each person who holds equity follows their own part of the register:
option holders their grants, vesting, offers and exercises; leavers their exercise window; investors their holdings and
tender offers; board members the grants waiting for their vote; the founder admin the cap table, securities ledger,
option pool, valuations, grants, tender offers and round scenarios.

Every deadline is decided on the server's date and clock (Pacific time), never on the person's device.

## Run it

`run.json` holds the three commands:

```
install: npm ci
build:   npm run build      (strict type check, then esbuild bundles the server and the browser app)
serve:   npm run start      (node dist/server.js, in the foreground)
```

The server listens on `0.0.0.0` and `APP_PUBLIC_PORT` (default 4173). `GET /api/health` answers `{"status":"ok"}` while the process is serving,
even when a dependency is unreachable. The schema and seed are applied on every start and change nothing once the register is seeded.
Seeded logins use the password `Tidecraft-demo-2026` (for example `mara@tidecraft.example`, `juniper@tidecraft.example`).

## Environment (read once, in `src/server/config.ts`)

| Variable | Meaning | Service |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string; the register of record | PostgreSQL |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the document vault where agreements, exercise notices and tender NDAs are sealed | MinIO |
| `WIREMOCK_URL` | Quillon Pay, which collects exercise money | WireMock |
| `OFFER_WINDOW_SECONDS` | how long an offer lasts (default 2592000) | none |
| `LEAVER_WINDOW_SECONDS` | how long a leaver may exercise (default 7776000) | none |
| `OFFER_WARNING_SECONDS` | how long before expiry the offer warning shows (default 86400) | none |
| `LEAVER_WARNINGS_SECONDS` | comma-separated warning times before the window end (default 2592000,604800,86400) | none |
| `APP_PUBLIC_PORT` | port to listen on (default 4173) | none |

None of these values is ever sent to the browser.

## What it keeps

PostgreSQL holds people, sessions, grants and votes, valuations, orders with their idempotency keys, tenders and submissions,
the securities ledger, drafts, document records and the live events the page's one WebSocket replays after a drop.
The vault holds the sealed text of each signed document, written once and never replaced. Quillon Pay holds the payment records.

## Layout of the source

`src/server` (domain rules: `vesting.ts`, `ownership.ts`, `allocation.ts`, `scenario.ts`, `decimal.ts`; state machines in `grants.ts`, `exercises.ts`, `tenders.ts`),
`src/client` (pages and shared parts), `src/shared` (types and display formats), `public` (fonts and photographs).
