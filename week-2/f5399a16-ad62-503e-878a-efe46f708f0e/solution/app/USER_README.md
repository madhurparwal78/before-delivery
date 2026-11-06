# Clapstick

The one working desk of an independent storyboard artist: script file to timed reel, private review pages for producers, sign-off,
calls across clock changes, delivery files and fee letters.

## Run it

`run.json` holds the commands:

- install: `npm ci`
- build: `npm run build`
- serve: `npm run serve` (foreground, `0.0.0.0`, port from `APP_PUBLIC_PORT`)

Health: `GET /api/health` answers `{"status":"ok"}`. Type check: `npm run check`.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | everything the desk keeps, the job history and the pending mail |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | frames, attachments, films, package files, fee letter PDFs |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit | all mail, through the pending mail table |
| `WIREMOCK_URL` | WireMock | Hollowreed Music and Quaymill Render |
| `GOTENBERG_URL` | Gotenberg | boards PDF and fee letter PDF |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | this app | the port it binds and the base of addresses in mail |

Timers, in seconds, with their defaults: `SESSION_SECONDS` 28800, `UNDO_SECONDS` 10, `CUE_CACHE_SECONDS` 300, `REVIEW_PAGE_SECONDS`,
`SIGN_OFF_PAGE_SECONDS` and `FEE_PAGE_SECONDS` 1209600, `REMINDER_AFTER_SECONDS` 604800, `ENQUIRY_RATE_WINDOW_SECONDS`,
`REVIEW_LINK_RATE_WINDOW_SECONDS` and `FILE_RATE_WINDOW_SECONDS` 3600, `CLOSURE_WAIT_SECONDS` 2592000.

## Sign-ins on a fresh copy

`noor@noorbakkerboards.example` and `theo@noorbakkerboards.example`, password `desk-pass-2027`.
