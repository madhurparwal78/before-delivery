# Pampero Ledger

The storefront and client ledger of Pampero Build Co., a one-person web design-and-build studio in
Buenos Aires. Prospects explore the studio's work on a scroll-driven 3D home page, compare three plans
in US dollars or Argentine pesos and buy one; clients pay a 40% deposit and a launch balance or run a
monthly care plan, share files with the studio and its contractors in a portal, and download invoice
PDFs. The studio owner runs orders, peso prices, refunds, credits, contractor assignments and CMS
entries from the studio console at `/studio`.

## Run

`run.json` holds the three commands:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the lockfile |
| build | `npm run build` | type-checks, bundles the browser app (Vite) and the server (esbuild) into `dist/` |
| serve | `npm run start` | `node dist/server/main.js`, listening on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173) |

On serve the app applies its Postgres schema, uploads the Kill Bill catalog if the tenant has none,
creates the PocketBase `entries` collection and seeds the demo data, each step idempotent and retried
while its service is down. `GET /api/health` answers at once and reports each service as `up` or `down`.

## Environment

| Variable | Service |
|---|---|
| `DATABASE_URL` | Postgres: the order and project ledger, sessions, mail queue |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: billing accounts, invoices, payments, care-plan subscriptions |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: portal folders, brand assets, deliverables, invoice PDFs |
| `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` | PocketBase: case studies and journal posts |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP): receipts, invoice, dunning, refund, credit and invite emails |
| `APP_PUBLIC_URL` | the base of links in emails |
| `APP_PUBLIC_PORT` | the port to listen on (default 4173) |
| `DUNNING_DAY_SECONDS` (86400), `DOWNLOAD_LINK_SECONDS` (60), `PREVIEW_TTL_SECONDS` (600), `INVITE_TTL_SECONDS` (604800) | durations, in seconds |

## Notes

- Cards are simulated: `4242 4242 4242 4242` approves, `4000 0000 0000 0002` declines; only the last
  four digits are kept.
- Kill Bill stores each invoice item and payment transaction in a `decimal(15,9)` column, so a peso
  amount of 1,000,000 or more is recorded as several items or transactions that sum exactly to it.
- Several app processes may share one database: row locks and unique keys keep every email, PDF,
  dunning attempt and seed step to exactly once.
