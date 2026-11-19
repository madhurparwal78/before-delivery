# Tailboard

Tailboard is the compliance board of the continuing-airworthiness office at Fenwick Regional Airways. Each
airworthiness directive and service bulletin becomes one tracked thread per affected aircraft. The board shows
when each thread is due (calendar date or flight-hours threshold, whichever comes first), who holds the work card,
who inspected and countersigned it, and which revision of the directive it was signed under. When a directive is
revised, the affected column splices to the new revision in place.

Roles: compliance planner, licensed inspector, certifying engineer, records clerk and regulator auditor. People
sign in with the seeded accounts only.

## Running it

The commands come from `run.json`:

| Step | Command |
|---|---|
| install | `python3 -m venv --clear --copies .venv && .venv/bin/python -m pip install --no-cache-dir -r requirements.txt` |
| build | `.venv/bin/python -m compileall -q tailboard` |
| serve | `.venv/bin/python -m tailboard.serve` (foreground, binds `0.0.0.0`) |

Every start applies the schema and the seed data to Postgres idempotently. `GET /api/health` answers
`{"status":"ok"}` once the app can serve. With MinIO or Mailpit unreachable the app still starts and serves.
Uploads answer `storage_unavailable`, while notices and compliance packs wait in their queues and go out by
themselves, retried at most every 10 seconds, once the service is back.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres, the system of record (directives, threads, signatures, notices, packs, audit, sessions) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO, the store for directive PDFs, inspection evidence and compliance packs (private, content-addressed keys) |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit, the outgoing mail sink for pack emails and staff notices |
| `MAIL_FROM` | Sender of every message |
| `APP_PUBLIC_PORT` | Listening port (default 4173) |
| `APP_PUBLIC_URL` | Base of the pack download link in pack emails |
| `NOTICE_HOLD_SECONDS` | How long staff notices wait before sending (default 30, 0 to 600) |
| `TAILBOARD_CLOCK_START` | Optional ISO 8601 UTC instant the server clock starts from |

Credentials and service URLs are read from the environment only, and are never logged or sent to the browser.
The base time zone is Europe/London.

## Services

- **Postgres**: supersession, claims and sign-offs commit in single transactions. Live board changes go out
  through `LISTEN/NOTIFY` to the server-sent event stream at `/api/events`.
- **MinIO**: `directives/<sha256>.pdf`, `evidence/<sha256>.<ext>` and `packs/<sha256>.pdf|csv`.
- **Mailpit**: compliance packs are sent to the authority mailbox, with the manifest attached, and staff notices
  (card revision, countersignature request, succession) are sent after their hold.
