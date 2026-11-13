# Quirewell Stand Desk

The working desk of the orchestra's music library. Librarians build each concert programme
(works, string count, the conductor's cuts on each work's bar map), record copies on hand, file
marked-part scans, publish a folder to each seated player and track rental sets back to the
publisher. Section principals confirm cuts and file their section's bowing masters. Players open
their own folder on a phone or tablet.

## Running it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (Vite builds the client into `dist/client`, `tsc` the server into `dist/server`) |
| serve | `npm run start` (`node dist/server/server/main.js`, foreground, `0.0.0.0:$APP_PUBLIC_PORT`) |

On start the server applies its schema to Postgres and, when the database is empty, writes the
seed records (every seeded person signs in with the passcode `stand-desk-26`). Until Postgres
answers, `GET /api/health` returns `503 {"status":"starting"}`; afterwards `200 {"status":"ok"}`.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres, the system of record |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO, "the score store", which holds every uploaded scan (the bucket must already exist) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit over SMTP: folder notices and return reminders |
| `APP_PUBLIC_PORT` | listening port, default 4173 |
| `REMINDER_SWEEP_SECONDS` | reminder and retry sweep interval, 1 to 60, default 30 |

None of these values reach the browser. With the score store or mail unreachable the app still
starts: uploads answer 503, notices and reminders stay queued and are retried, and the screens
show the outage banners.

## Services

- **Postgres**: people, sessions, programmes, works, bar maps, cuts, marks, holdings, scan
  catalogue rows, notices, rental sets, check-in counts, reminders and idempotency records.
- **MinIO**: one object per filed scan at `scans/<programme>/<work>/<part>/<scan id>`.
- **Mailpit (SMTP)**: plain-text UTF-8 messages, one recipient each.
