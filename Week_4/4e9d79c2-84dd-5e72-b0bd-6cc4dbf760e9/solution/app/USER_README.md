# Wayticket

Wayticket is the working desk of one independent coach-hire arranger. It holds the public site and quote form, the private bid page, the private quote page, statements brought in from a file, the duty ribbon, the phone run sheet, documents and aftercare.

## Running it

`run.json` is the only way the app is installed, built and served:

- install: `npm ci`
- build: `npm run build`
- serve: `npm run serve` (foreground, on `0.0.0.0` and `APP_PUBLIC_PORT`)

Schema and seed apply themselves on serve. Only Postgres is needed to boot; every other service gives its published outage answer when it is down.

## Sign in

Seeded desks: `maria@merrowfield.example` and `tomasz@zielinski-hire.example`. Their passwords are in the brief's seed data.

## Environment

| Variable | Service or use |
|---|---|
| `DATABASE_URL` | Postgres, every desk's data |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO, uploads and PDFs |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit, outgoing mail |
| `WIREMOCK_URL` | Address, routing, flight, bank holiday and directory providers |
| `GOTENBERG_URL` | PDF rendering |
| `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD` | Driver pushes |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | Where the app listens and the base of links in mail |
| `PUBLIC_DESK_EMAIL` | The desk public requests feed (default `maria@merrowfield.example`) |
| `ENQUIRY_RATE_WINDOW_SECONDS` | Request limit window (3600) |
| `BID_WINDOW_SECONDS` | Bid window (172800) |
| `QUOTE_VALID_SECONDS` | When set, a quote ends that many seconds after sending |
| `FILE_RATE_WINDOW_SECONDS` | Download limit window (3600) |
| `CLOSURE_WAIT_SECONDS` | Wait before a closed customer is erased (604800) |
| `HOLIDAY_CACHE_SECONDS` | How often bank holidays are read per desk (86400) |
| `DAILY_RUN_AT` | `09:00` by default, or `any` for every 2 seconds |
| `SESSION_SECONDS` | Session length (43200) |

Text inside panels is inset by `--inset` (5vw) in `public/app.css`.
