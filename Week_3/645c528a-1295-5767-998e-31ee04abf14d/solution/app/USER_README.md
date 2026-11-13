# Long Rail Headstring

Headstring is an online 8-ball game for the mobile web: server-refereed Coin tables, friends, clubs, 8-player tournaments, a cosmetic shop and offline practice against an AI. It opens from a link with no install.

## Run it

`run.json` holds the three commands:

- install: `npm ci`
- build: `npm run build`
- serve: `npm start` (binds `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173)

The schema and seed are applied on serve. The app boots with any service unreachable. `GET /api/health` reports `ok` only when all three services answer.

## Environment

| Variable | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | Postgres | The only store |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | One-off PURCHASE payments for Cash packs |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit | Verification mail and Cash receipt |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | app | Listen port, and the origin in mailed and invite links |
| `GRADING_KEY` | app | Turns the grading routes on when set |
| `SHOT_CLOCK_SECONDS`, `RECONNECT_GRACE_SECONDS`, `TOURNAMENT_WINDOW_SECONDS`, `READY_CHECK_SECONDS`, `INVITE_TTL_SECONDS` | app | Time settings, default 30, 30, 300, 30, 900 |

`MAILPIT_URL` is for inspection only and the app does not read it.
