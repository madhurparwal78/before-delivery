# Twinrow

Twinrow is a shared web workspace for people who write their own knitting and crochet patterns. One chart is the
single source of truth: the server checks each row's stitch arithmetic, writes the instructions from the chart, reads
typed instructions back into the chart, and lets two designers edit together while testers work a saved version row by
row on their phones.

## Run it

`run.json` holds the three commands the deployer runs, in this order:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (Vite builds the React client, esbuild bundles the server to `dist/server/main.js`) |
| serve | `node dist/server/main.js` (foreground, binds `0.0.0.0`) |

The server applies its database schema idempotently every time it starts. `GET /api/health` answers `200 {"status":"ok"}`
even when Valkey is unreachable; Postgres is required.

## Services

| Service | What it holds | Variables |
|---|---|---|
| Postgres | accounts, sessions, patterns, cells, repeat boxes, versions, testers, counters, notes, invitations | `DATABASE_URL` |
| Mailpit (SMTP) | all mail: verification, invitations, note notices | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Valkey | presence, live edit broadcasts, the shared row counter | `VALKEY_URL` |

## Environment

Required: `DATABASE_URL`, `VALKEY_URL`, `SMTP_HOST`, `MAIL_FROM`.
Optional with defaults: `SMTP_PORT` (1025), `APP_PUBLIC_PORT` (4173), `APP_PUBLIC_URL` (used for links in mail),
`GRADING_KEY` (enables the key-gated setup routes; unset means they answer 404), `MAILPIT_URL` (observer only, unused by the app),
`APP_TODAY` (a `YYYY-MM-DD` date shown as today), `APP_TIME_ZONE` (IANA name, default `UTC`).

Limits, all whole numbers: `MAX_CHART_ROWS` (120), `MAX_CHART_COLS` (80), `MAX_COLOURS` (6), `COLOURS_PER_ROW` (2),
`MAX_FLOAT` (5), `UNDO_DEPTH` (100), `NOTE_MAX_CHARS` (500), `EDITS_PER_MINUTE` (600), `SHEET_LINES_PER_PAGE` (40),
`NOTICE_SECONDS` (6), `ROW_MOTION_MS` (200), `PRESENCE_TTL_SECONDS` (30), `INVITE_TTL_HOURS` (168), `VERIFY_TTL_HOURS` (24).
`GET /api/config` publishes them.

## Pages

`/` your patterns, `/signup`, `/signin`, `/verify`, `/invite/<token>`, `/settings`, `/patterns/<id>` (designer),
`/patterns/<id>/compare`, `/follow/<id>` (tester), `/p/<id>` (published page and PDF sheet).
