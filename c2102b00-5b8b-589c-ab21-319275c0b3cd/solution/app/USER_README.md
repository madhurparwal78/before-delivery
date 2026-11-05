# Tally Split

Tally Split runs a neighbourhood bulk-food buying club's weekly cycle. The coordinator opens a
cycle from the distributor's case list, member households top up prepaid credit and pledge units
toward split cases until cutoff, the coordinator resolves the cases that did not fill, places the
order, records short shipments and closes the cycle with every balance exact to the cent. A
breakdown volunteer packs each household's bag from a phone checklist. Each case on a member's page
is a unit grid beside a small 3D kraft-paper crate, drawn with Three.js (`three`, bundled and served
from the app itself) that fills as households pledge, shuts with a lid and stamp when the case seals
and turns by drag, keys or the `TURN` strip. Without WebGL it shows a still drawing of the same crate.

## Running it

The app runs only through `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (strict TypeScript check, then esbuild bundles `dist/server.js` and the browser client) |
| serve | `npm run start` (`node dist/server.js`, foreground, `0.0.0.0:$APP_PUBLIC_PORT`) |

`GET /api/health` answers `{"status":"ok"}` whether or not the services are reachable. Node.js 22.13
or later is required (the server uses the built-in `node:sqlite`).

On first start the server creates the SQLite database at `TALLY_DB_PATH` and loads the seed
(club, people and access codes, households, case list and the open Cycle 44). Several server
processes may share one database file.

## Environment

| Variable | Default | Used for |
|---|---|---|
| `APP_PUBLIC_PORT` | `4173` | HTTP port |
| `TALLY_DB_PATH` | `data/tally.db` | the SQLite file; its folder is created if missing |
| `TALLY_KB_KEY_PREFIX` | `tally` | Kill Bill account external keys `<prefix>-<household code>` |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | — | **Kill Bill**: household accounts, top-up purchases, cycle-close external charges |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | — | **Mailpit (SMTP)**: short-shipment notices and pickup receipts |
| `MAIL_RETRY_SECONDS` | `30` | retry interval for queued mail (1 to 300) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | **MinIO (S3)**: the distributor invoice PDF and the packing-slip photo |

Credentials are read once at start, never logged and never sent to the browser.

## Who signs in

| Role | Home | Access code |
|---|---|---|
| Coordinator | `/coordinator` | `COORD-2718` |
| Breakdown volunteer | `/breakdown` | `VOL-3141` |
| Member households | `/` | `HOME-1001` to `HOME-1006` |

## When a service is down

- Kill Bill unreachable: top-ups and close answer 503 `payments_paused`, members see the
  payments-paused banner, pledges keep working.
- SMTP unreachable: mail stays queued with its failed attempts counted and the coordinator sees the
  mail-queued banner; it sends when the endpoint is back.
- MinIO unreachable: uploads and downloads answer 503 `storage_unavailable` and nothing is recorded.
