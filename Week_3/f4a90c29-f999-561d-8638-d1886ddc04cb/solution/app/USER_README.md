# Wren Calendar

One shared team calendar for a 14-person strategy consultancy with offices in New York, London and Auckland.
Times stay exact across every clock change, every open screen agrees within a second, and every notice appears
inside the product. Nothing is emailed.

## What it does

- Week, Day, Month, Custom days and Schedule views, drag to move, resize and create, Alt-arrow keys, single-key shortcuts.
- Repeating events (daily, weekly, monthly by day or nth or last weekday, yearly) with This event, This and following
  events and All events edits, exceptions, trash and restore.
- Invitations, answers, proposed times, out of office and focus time that decline automatically, find a time, search.
- Guest switches, shared links, share levels, recorded zone rules with warnings and Move.
- A printed week (PDF through Gotenberg, stored in MinIO) and iCalendar export and import (stored in MinIO).
- Reminders and snooze on the server clock.

## Run it

`run.json` holds the three commands:

- install: `go mod download && npm ci`
- build: `npm run build && go build -o bin/server .`
- serve: `./bin/server` (foreground; binds `0.0.0.0` and `APP_PUBLIC_PORT`, default 4173)

Everyone signs in with a seeded email (`<first name>@sundialwren.example`) and the passcode given in the brief's seed data.

## Environment variables

| Variable | Used for |
|---|---|
| `APP_PUBLIC_PORT` | listening port, default 4173 |
| `DATABASE_URL` | Postgres: every record, sessions and the change log |
| `GOTENBERG_URL` | Gotenberg: renders the printed week to PDF |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: printed PDFs and iCalendar files |
| `TRASH_RETENTION_SECONDS` | trash retention, default 2592000 |
| `SHARE_LINK_TTL_SECONDS` | shared link lifetime, default 2592000 |
| `CLOCK_START`, `CLOCK_RATE` | rehearsal clock: an RFC 3339 start instant and server seconds per real second |

A service that is down at boot does not stop the app: Postgres is retried every second (health answers 503 until it is
ready), Gotenberg and MinIO are tried again on every attempt.
