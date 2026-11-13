# Ebbstone Marine Slackwater

Slackwater runs tidal-window planning, the pilot rota, boarding-ladder reports and tariff billing
for the harbour pilot station at Port Ansell.

- **Duty dispatchers** (`/board`) turn agent orders into committed tidal windows on the Keel
  Section, a to-scale long section of the channel, and assign the next rested pilot in turn.
- **Harbour pilots** (`/pilot`) see their next job and its clearances on a phone, confirm pilot
  away, boarding and completion, and file ladder reports with photos.
- **Port agents** (`/orders`) order and amend pilot moves for their own agency's vessels with live
  clearances and a tariff estimate, and read their own moves, reports, exports and invoices.
- **The accounts clerk** (`/accounts`) publishes tariff revisions, reviews charges, exports moves
  and issues invoices that Kill Bill confirms.

All accounts are seeded and sign in with `Slackwater-2026` (`dispatch1@ebbstone.example`,
`dispatch2@ebbstone.example`, `accounts@ebbstone.example`, `agent@corvane.example`,
`agent@tidewell.example`, `p01@ebbstone.example` … `p10@ebbstone.example`).

## Running it

The commands come from `run.json` (Node.js 22 with npm):

```sh
npm ci           # install from the lockfile
npm run build    # bundle the server and the browser client into dist/
npm run serve    # serve on 0.0.0.0:$APP_PUBLIC_PORT (default 4173), in the foreground
```

`GET /api/health` answers `{"status":"ok"}` whatever the state of the providers. The app starts
with any provider unreachable, reports that service as down, and recovers without a restart.

Each serving instance keeps its own embedded store (SQLite, built into Node.js) at
`data/store-<port>.sqlite` under the app directory, created and seeded on first serve.

## Environment

| Variable | Used for |
|---|---|
| `APP_PUBLIC_PORT` | Listening port (default 4173) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: agency accounts (external key = agency code, CAD), DRAFT invoices of external charges, invoice commit and balance |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: ladder photos at `ladder-photos/<photo id>` and pilot cards at `pilot-cards/<vessel id>/<card id>.pdf`; the bucket is created private if absent |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit: order, assignment, amendment, cancellation, withdrawal and ladder notices |
| `DETENTION_UNIT_SECONDS` | Optional length of a detention half hour in seconds (default 1800) |

Credentials are read only from the environment and never reach the browser. Pending steps
(charge posting, invoice commit, notices) are retried every few seconds and run exactly once
when their provider is reachable.
