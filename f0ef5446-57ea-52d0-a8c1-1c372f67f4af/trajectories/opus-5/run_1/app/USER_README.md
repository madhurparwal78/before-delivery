# Relayo marketing site and partner program

Relayo is a business-to-business AI meeting assistant. This app serves the public marketing
site, takes partner applications, and gives the partner team a queue to decide them in.

## Running it

The app is installed and run through `/app/run.json`:

```
install   python3 -m venv .venv && .venv/bin/python -m pip install --no-cache-dir -r requirements.txt
build     .venv/bin/python -m compileall -q server
serve     .venv/bin/python -m server
```

It listens on `0.0.0.0:4173`, or on `APP_PUBLIC_PORT` when that variable is set.
`GET /api/health` answers `{"status":"ok"}` once the schema, the seeded corpus and the seeded
accounts are in place, and `{"status":"starting"}` with 503 before that.

Every service URL and credential is read from the environment: `DATABASE_URL`, `KEYCLOAK_URL`,
`KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `SMTP_HOST`,
`SMTP_PORT`, `MAIL_FROM`, `APP_PUBLIC_PORT`, `IDEMPOTENCY_KEY_TTL_SECONDS` and
`LOGIN_FAILURE_WINDOW_SECONDS`.

## Signing in

Both accounts are seeded into Keycloak on every start and use the password
`deku-demo-pw-2026`, which is benchmark fixture data, not a secret.

| Email | Realm role | What they can do |
|---|---|---|
| `reviewer@example.com` | `partner-reviewer` | Read the application queue at `/review`, open an application and approve or reject it once |
| `analyst@example.com` | none | Sign in and sign out; the queue answers 403 and `/review` shows the no-access message |

Sign in at `/review`. Five failed sign-ins for one email within the failure window lock that
email for the rest of the window, and the page counts the wait down.

## What to look at

- `/` — the opening statement, the before/during/after story, the use-case carousel.
- `/integrations`, `/blog`, `/press` — filtered lists whose view lives in the address.
- `/partner-program` — the thirteen-field application form.
- `/review` — staff sign-in and the partner application queue.

Applications are stored in PostgreSQL, each applicant gets exactly one receipt email, and each
decision records exactly one outcome email. Mail is delivered to Mailpit in the background and
retried on a published backoff if the mail service is down.
