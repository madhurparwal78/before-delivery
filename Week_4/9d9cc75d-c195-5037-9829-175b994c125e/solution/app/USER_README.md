# Lozenge

Lozenge is a browser workbook for anyone who keeps numbers in a spreadsheet. You upload CSV files, relate two tables with one
left join, build charts by placing fields on shelves with a pointer or the keyboard, write calculations in a small published
language (level-of-detail expressions and table calculations included), build dashboards and link them with actions, and publish
workbooks to private projects where row-level security holds on every mark, total, filter list and export. Sources refresh as
scheduled extract snapshots, threshold alerts land in an in-app inbox, and sheets and dashboards export as PDF, PNG and crosstab CSV.
All data, including the bundled Fernhollow Tea sample, is invented.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (bundles the server and the browser app with esbuild into `dist/`) |
| serve | `npm run serve` (one Node 22 process, foreground, `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

The server serves the API under `/api` and the browser app from one origin. `GET /api/health` answers 200 `{"status":"ok"}`
(`"unavailable"` while object storage is unreachable) and 503 `{"status":"starting"}` until PostgreSQL answers.

## Services

| Service | What it holds |
|---|---|
| PostgreSQL | every record: accounts, sessions, projects, sources, fields, workbooks, sheets, dashboards, schedules, alerts, inbox items, export jobs and the extract snapshot rows queries run against. The schema is applied idempotently at every start. |
| MinIO (S3) | every uploaded file (`uploads/<source id>/<table>/<sha256>.csv`), images (`images/<id>`) and exported file (`exports/<job id>.<pdf,png,csv>`). The bucket is created only if it is missing. |

## Environment

Read once at start; none is logged or sent to the browser (the browser gets the published limits from `GET /api/config`).

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | required |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO access | required |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | listen port and public address | 4173 |
| `LOZ_GRADING` | `1` turns the `/api/grading/*` routes on (404 otherwise) | unset |
| `LOZ_FORMULA_MAX_CHARS`, `LOZ_FORMULA_MAX_DEPTH` | formula length and nesting limits | 2000, 16 |
| `LOZ_MARK_MAX`, `LOZ_QUERY_WORK_MAX`, `LOZ_QUERY_BUDGET_MS` | view limits: marks, work steps, time | 2000, 5000000, 5000 |
| `LOZ_ROW_MAX`, `LOZ_CSV_MAX_BYTES` | upload limits | 50000, 20000000 |
| `LOZ_FORMULA_DEBOUNCE_MS` | formula check debounce on page timers | 300 |
| `LOZ_STALE_MS` | an extract is stale this long after its last success | 7200000 |
| `LOZ_EXPORT_STEP_MS` | pause between export job states | 200 |
| `LOZ_SSE_HEARTBEAT_MS` | server-event heartbeat | 15000 |
| `LOZ_LOGIN_RATE`, `LOZ_FORMULA_RATE`, `LOZ_QUERY_RATE` | per minute: sign-ins per username, formula checks per user, queries per user | 10, 120, 600 |

## First steps

Register on `/signin` (Create account), create a project, upload `orders.csv` and `stockists.csv` on the upload page, relate the tables on
`Stockist ID`, then create a workbook and build a sheet. Published workbooks and dashboards are opened by project members by role: viewer,
explorer or creator.
