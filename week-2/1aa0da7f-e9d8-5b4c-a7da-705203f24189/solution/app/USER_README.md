# Wardline

Wardline is a digital evidence custody and disclosure system for public-interest investigations units. It holds sealed exhibits in need-to-know compartments, burns redactions into new derivative files, separates release sign-off from the people who assembled a release, shares signed-off material through scoped links, and keeps a hash-chained ledger an auditor can verify in their own browser without trusting the server.

## Running it

`run.json` is the manifest:

| Step | Command |
|---|---|
| Install | `python3 -m venv .venv && .venv/bin/python -m pip install --no-input -r requirements.txt` |
| Build | `.venv/bin/python -m compileall -q wardline` |
| Serve | `.venv/bin/python -m wardline` (foreground, on `0.0.0.0`) |

Schema and seed data apply themselves, idempotently, on every start. Several copies may run against one database and bucket. A storage or mail relay that is down at boot does not stop the server; `GET /api/health` answers 503 only until the database first answers.

Every seeded person signs in with the published seed password and authenticator secret in the product brief.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | Records, ledger, outbox | PostgreSQL |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | File bytes; the bucket is created if missing | MinIO |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Notices, sent from the outbox by a background worker | Mailpit SMTP relay |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | Listening port (default 4173) and the app's own origin | |
| `LOCKOUT_SECONDS`, `STEP_UP_TTL_SECONDS`, `SESSION_TTL_SECONDS`, `SESSION_IDLE_SECONDS`, `BREAK_GLASS_SECONDS` | Timers; defaults 300, 300, 43200, 3600, 3600 | |

Local temporary files hold only uploads and renders in flight; they are unlinked as soon as the request ends. Nothing durable lives on local disk.
