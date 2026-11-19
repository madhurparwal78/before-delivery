# Duefield

Duefield is a sales tax filing calendar for a one-person bookkeeping practice. The bookkeeper registers each client in
the states where it collects tax, gives each registration a filing frequency and reads every return's real deadline in
that state's own time zone. They move returns from not started to filed, file extensions and amendments, get reminders
and produce a PDF filing packet for each filed return. Each client's owner signs in, usually on a phone, to approve or
send back the figures the bookkeeper prepared. The bookkeeper enters every amount; Duefield never calculates one. Every
state rule, rate, holiday list, person and business in it is invented.

## Run it

`run.json` holds the three commands the deployment runs, in the app directory:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (Vite builds the browser app, esbuild bundles the server) |
| serve | `npm run start` (foreground, binds `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173) |

The server applies its database schema every time it starts. If Postgres is not reachable yet it keeps retrying every two
seconds and serves as soon as it connects. If mail or the PDF service is unreachable at start it still serves, shows the
service notice and recovers without a restart.

## Environment

| Variable | Meaning | Service |
|---|---|---|
| `DATABASE_URL` | Postgres connection: every record, session and packet PDF | Postgres |
| `SMTP_HOST`, `SMTP_PORT` | SMTP server for reminders and notices | Mailpit |
| `MAIL_FROM` | From line of every message (default `Duefield <reminders@duefield.test>`) | Mailpit |
| `GOTENBERG_URL` | HTTP API that renders the packet HTML to PDF | Gotenberg |
| `GRADING_KEY` | Enables the two grading routes (they answer 404 without the key) | none |
| `SERVICE_RETRY_SECONDS` | Seconds between service checks and retries of waiting work (default 30) | none |
| `SESSION_TTL_SECONDS` | Session lifetime in seconds (default 604800) | none |
| `APP_PUBLIC_PORT` | Listening port (default 4173) | none |
| `APP_PUBLIC_URL` | Optional; the origin used for links in mail (default `http://localhost:<port>`) | none |

None of these reach the browser.

## Screens

Bookkeeper: `/today`, `/catalogue`, `/month/<yyyy>-<mm>`, `/year/<yyyy>`, `/clients`, `/states`, `/settings`,
`/returns/<id>`. Client owner: `/home` and `/returns/<id>` for their own client only. `/sign-up` creates a practice with
the six-state catalogue; `/sign-in` signs anyone in.

## Notes

- Fonts (Tilt Warp, Plus Jakarta Sans) and icons are bundled; the browser makes no request to another origin.
- Postgres is the only datastore. Packet PDFs are stored in Postgres as numbered revisions.
- Third-party licences are listed in `THIRD_PARTY_NOTICES.md`.
