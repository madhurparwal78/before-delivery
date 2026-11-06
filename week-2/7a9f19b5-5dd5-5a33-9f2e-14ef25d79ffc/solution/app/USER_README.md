# Lightfall

Lightfall is Southerly Light Works' platform for specifying and ordering its architectural luminaires in New
Zealand. Shoppers browse a 3D catalogue, pick the exact variant of a fitting (finish, beam angle, colour
temperature), compare up to four, save favourites and buy by card. Approved trade buyers see trade prices, build
projects with quantities, place fittings in a 3D light-pool room that shows each pool of light at the project's
ceiling height, collaborate live, share quotes as PDFs at a chosen price display, and order on monthly account.
Southerly staff approve trade applications, dispatch and refund orders, record trade payments, look after
clearance stock and watch service health.

## Running it

The commands are in `run.json`:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the lockfile |
| build | `npm run build` | type-checks the server and browser code, compiles the server to `dist/node`, bundles the browser app to `dist/client` |
| serve | `npm run start` | runs `node dist/node/server/index.js` in the foreground on `0.0.0.0:$APP_PUBLIC_PORT` |

On every start the server applies its Postgres schema and seed data (idempotent, safe for two instances at
once), then answers `GET /api/health` with `{"status":"ok"}`. It starts even when Kill Bill, MinIO or
PocketBase are unreachable and reconnects on its own when they return.

Node.js 22 LTS or later is required.

## Configuration

Every value is read from the environment at start (`src/server/config.ts`); none is sent to the browser.

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | system of record: catalogue, accounts, sessions, carts and orders, stock movements, projects, placements, shares, newsletter, idempotency records | Postgres |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD` | Kill Bill API and its admin credentials | Kill Bill |
| `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | the Kill Bill tenant | Kill Bill |
| `SMTP_HOST`, `SMTP_PORT` | outgoing mail (order confirmations, trade decisions, quote shares, newsletter confirmation) | Mailpit |
| `MAIL_FROM` | the From address of every message | Mailpit |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | private bucket for project covers, spec sheets and quote PDFs | MinIO |
| `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` | live presence, comments and placement sync (`lf_presence`, `lf_comments`, `lf_placements`) | PocketBase |
| `APP_PUBLIC_PORT` | listening port (default 4173) | — |
| `APP_PUBLIC_URL` | the app's own origin: links in emails and the same-origin check | — |
| `LIGHTFALL_TODAY` | optional `YYYY-MM-DD` that replaces today's Pacific/Auckland date for invoice dates, due dates, overdue and card expiry | — |

## Notes

- Card payments use Kill Bill's built-in external payment plugin and the published test cards:
  `4000 0000 0000 0002` is declined, any other 16-digit number that passes the Luhn check is approved.
  Only the last four digits are stored.
- Kill Bill accounts are tagged `AUTO_PAY_OFF` so account invoices wait for "Record payment".
- Seeded accounts and their passwords are listed in the brief's Seed data section; every person and business
  in the seed is invented.
- `THIRD_PARTY_NOTICES.md` lists every package and bundled font with its licence; `assets.json` lists every
  binary asset.
