# Dotgain by Coldset Works

Dotgain is an all-or-nothing crowdfunding service for small-press print runs. A creator sets the goal to the
printer's minimum run, adds open and limited reward tiers with shipping priced by zone (domestic, Europe, rest of
world) and launches. Backers' cards are held when they pledge and charged only if the campaign reaches its goal by
its deadline; otherwise every hold is released. Failed collections get a fix window with emailed fix links, every
captured pledge gets a PDF statement, and the creator gets a settlement sheet exact to the penny.

## Running it

`run.json` is the manifest:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (TypeScript for the server, esbuild for the browser bundle and stylesheet) |
| serve | `npm run start` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

On start the server waits for Postgres (retrying every 2 seconds), applies its schema idempotently, inserts the
seed records once, and then listens. `GET /api/health` answers `{"status":"ok"}` once it listens; `GET /api/status`
reports each other service as `up` or `down`.

## Environment

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | every record: people, campaigns, tiers, media rows, pledges and history, idempotency keys, notices, documents |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | one account per backer; AUTHORIZE, CAPTURE and VOID per pledge |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP) | every notice email, sent from `MAIL_FROM` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | campaign images, statements and settlement sheets (private objects) |
| `GOTENBERG_URL` | Gotenberg | rendering statements and settlement sheets from HTML |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | — | listening port; the base of links in emails (fix links) |
| `MIN_CAMPAIGN_SECONDS`, `FINAL_WINDOW_SECONDS`, `FIX_WINDOW_SECONDS`, `FIX_NOTICE_SECONDS` | — | campaign length floor (1 day), final window (1 day), fix window (7 days), fix notice interval (2 days) |

No credential or service URL is sent to the browser; the browser talks only to the app's own origin.

## Test cards

The payment setup is a test environment: `4242 4242 4242 4242` authorises and captures, `4000 0000 0000 0002` is
declined, `4000 0000 0000 0341` authorises but fails every capture. Only the last four digits are stored.

## Seed people

Mara Quillfeather and Ines Calloway (creators), Tobias Ferrante and Wren Adeyemi (backers), with the keys printed in
the product brief. Paste a key into "Your details" (Studio → New campaign) to use that identity.
