# Tallow Cover

Attendance and leave for the Hollins Vale Care homes. Care workers clock in and out of rostered
shifts, request leave and report sickness; bank carers claim open cover and watch holiday accrue;
unit managers work the approval queue with a live staffing strip for every shift's safe-staffing
floor; group HR admins set floors and leave policy, correct attendance, close pay periods and
export payroll timesheets.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `python3 -m venv .venv && .venv/bin/pip install --no-cache-dir -r requirements.txt` |
| build | `.venv/bin/python -m compileall -q tallow_cover` |
| serve | `.venv/bin/python -m tallow_cover` (foreground, `0.0.0.0`, port `APP_PUBLIC_PORT` or 4173) |

On every serve the app applies its schema and, when the database has no homes, seeds the brief's
homes, people, floors, policy and rota. Sign in with any seeded email
(`<first>.<last>@hollinsvale.example`) and the password `cover-demo-2026`.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres, the system of record |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit (SMTP); every email goes through the outbox |
| `MAIL_FROM` | sender of every email (default `Tallow Cover <cover@tallow.example>`) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the private MinIO bucket for fit notes and timesheet exports |
| `APP_PUBLIC_PORT` | listening port (default 4173) |
| `ESCALATION_AFTER_SECONDS` | how long a request stays submitted before it escalates (default 172800) |
| `SESSION_TTL_SECONDS` | session lifetime (default 43200) |
| `IDEMPOTENCY_TTL_SECONDS` | how long punch and cover-claim Idempotency-Keys are kept after their success (default 86400) |

No other variable is read. Credentials never reach the browser.

## Services

- **Postgres** holds every record, the email outbox and uploads still waiting for storage.
- **Mailpit** receives decision, cover, cancellation and escalation emails. If it is down, actions
  still succeed and emails wait in the outbox; a background loop retries every second.
- **MinIO** keeps fit notes and exports privately; downloads use 60-second signed links. If it is
  down, uploads and exports succeed with `storage: pending` and are stored within seconds of it
  returning. `GET /api/health` reports `mail` and `storage` as `up` or `down`.
