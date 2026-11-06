# Northpier inquiry desk

The public site and new-business desk of Northpier Studio. Visitors browse eight case studies, send a project
inquiry from `/start` and follow it on a private status page. The studio works the inquiry queue at `/studio`.

## Seeded studio accounts

| Name | Email | Role | Password |
|---|---|---|---|
| Sana Holm | `sana@example.com` | `lead` | `deku-demo-pw-2026` |
| Ole Berg | `ole@example.com` | `associate` | `deku-demo-pw-2026` |

The fixture status link of `NP-Q7LD4V` is `/inquiry/seed-npq7ld4v-status-link`
(for example `http://127.0.0.1:4173/inquiry/seed-npq7ld4v-status-link`).

## Running

`run.json` holds the commands:

- install: `python3 -m venv .venv && .venv/bin/pip install ... -r requirements.txt`
- build: none
- serve: `.venv/bin/python serve.py` — gunicorn on `0.0.0.0:$APP_PUBLIC_PORT`, in the foreground.

The schema is applied and the seed written on every start (the seed only once). `GET /api/health` answers
`{"status":"ok"}` once both are in place and PostgreSQL answers, and `503 {"status":"unavailable"}` before.

## Environment

| Variable | Use |
|---|---|
| `DATABASE_URL` | PostgreSQL: every record, session, key, sign-in attempt and the email outbox |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit SMTP (default `mailpit`, `1025`); every email leaves through the outbox |
| `APP_PUBLIC_URL` | origin used in status links and the same-origin check |
| `APP_PUBLIC_PORT` | listening port (default `4173`) |
| `NP_FLOOD_WINDOW_SECONDS` | inquiry window for the five-an-hour limit (default 3600) |
| `NP_IDEMPOTENCY_TTL_SECONDS` | Idempotency-Key lifetime (default 86400) |
| `NP_REOPEN_WINDOW_SECONDS` | reopen window after a decline (default 2592000) |
| `NP_SIGNIN_WINDOW_SECONDS` | sign-in limit window (default 900) |

The app talks to PostgreSQL and the SMTP server only.
