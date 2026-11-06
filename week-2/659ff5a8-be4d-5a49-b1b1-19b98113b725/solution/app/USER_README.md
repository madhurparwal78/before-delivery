# Conecount Paddock

A club workspace for grassroots autocross. One event goes from driver registration through check-in with a
signed waiver, the work-station rota, keyboard timing entry, live raw, class and indexed standings, a server-timed
protest window and an immutable corrections log, to signed final results that are published as a PDF and emailed to
drivers. Each region's club has its own workspace; the founder operator onboards new clubs.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (compiles the server with `tsc`, bundles the screens with Vite) |
| serve | `npm run start` (foreground; binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

The server applies its schema and seed on every start, so a cold database is ready as soon as
`GET /api/health` answers `{"status":"ok"}`. If Postgres is not reachable at start it retries for 60 seconds. The PDF
renderer, object storage and mail server may be down at start: only the actions that need them fail.

Seeded accounts (password `conecount-2026`): operator `ops@pylonworks.test`; Ridgeline chair `chair@ridgeline.test`,
timing `timing@ridgeline.test`, workers `workers@ridgeline.test`, drivers `avery@ridgeline.test` and others; Tidewater
chair `chair@tidewater.test`.

## Environment

Every value is read once, at start, in `server/config.ts`. None is returned by a route or sent to the browser.

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | system of record | Postgres |
| `GOTENBERG_URL` | waiver and results PDFs | Gotenberg |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | stored PDFs, written once | MinIO |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | every email (sender defaults to `Conecount Paddock <paddock@pylonworks.test>`) | Mailpit |
| `PROTEST_WINDOW_SECONDS` | length of the protest window (default 1800) | none |
| `APP_PUBLIC_PORT` | listening port (default 4173) | none |
| `APP_PUBLIC_URL` | base of the links in emails (default `http://localhost:<port>`) | none |

## Where things are

- `server/` the API (Hono), domain rules, services (PDF, storage, SMTP) and the seed.
- `shared/` rules both sides call: the indexed-time formula, rank-change text, event and run states, time zones.
- `client/` the React screens, the cone-to-rank settle (`client/settle.ts`), styles and self-hosted fonts.
