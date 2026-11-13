# Cutline Jury Desk

A juried web and digital design prize desk for a founder who runs the program alone. Studios create accounts, draft
entries with case-study images, pay the entry fee in Kill Bill and follow their entry through the rounds. Jurors
declare conflicts and score blind entries on Craft, Clarity, Idea and Story. The program director screens entries,
builds conflict-free panels, opens and closes rounds into normalised standings with a cobalt shortlist cut, confirms
results and publishes them at an embargo time. Visitors browse past winners in the gallery and watch the live
leaderboard reveal each category with The Cut Shuffle.

## Run it

`run.json` holds the three commands, run from this directory:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs the pinned toolchain and libraries from `package-lock.json` |
| build | `npm run build` | type-checks the TypeScript, then bundles `dist/server.cjs` and `dist/public/` |
| serve | `npm run start` | runs `node dist/server.cjs` in the foreground on `0.0.0.0` |

The server listens at once and answers `GET /api/health` with `200 {"status":"ok"}` once the Postgres schema and seed
data are applied (`503 {"status":"starting"}` until then; it retries the database every 2 seconds). Kill Bill, MinIO
and Mailpit may be down at start: each action that needs one tries it afresh with a 5-second timeout and answers that
provider's 503 if it is unreachable.

## Environment

Every value is read from the environment; nothing is hard-coded or sent to the browser.

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | the system of record: accounts, sessions, programs, entries, ballots, results, the email queue and the audit trail |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | studio accounts, entry-fee invoices, PURCHASE payments and REFUNDs |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3 API) | re-encoded case-study images (`entries/<entry id>/<asset id>.png|.jpg`) and jury packets (`rounds/<round id>/jury-packet.json`) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP) | receipts, jury invitations, refund and results emails, sent from `MAIL_FROM` |
| `APP_PUBLIC_PORT` | — | the port to listen on (default 4173) |

## Seeded accounts

The director (`director@cutline.example`), four studios and six jurors from the brief's seed data, with the open
program "Cutline Open Call" and the published Cutline Annual 2025 and 2024 programs.
