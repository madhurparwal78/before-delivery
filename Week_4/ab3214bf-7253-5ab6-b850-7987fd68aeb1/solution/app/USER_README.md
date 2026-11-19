# Hourproof Settlement Desk

Hourproof Settlement Desk turns one calendar month of metered electricity and granular certificates into an exact
hour-by-hour reconciliation, gets the certificates cancelled, hands a verifier a drawn sample to test and sign, and ends in a
signed PDF attestation anyone can check on a public page. It serves four people: the energy analyst, the independent
verifier, the group sustainability lead and the statement reader.

## Run it

`run.json` holds the three commands:

- install: creates `.venv` inside the app and installs `requirements.txt` into it (five attempts, binary wheels only);
- build: nothing to build (`true`);
- serve: `.venv/bin/python -m hourproof`, in the foreground on `0.0.0.0` and `APP_PUBLIC_PORT` (default 4173).

`GET /api/health` is the health check. The server waits for PostgreSQL at boot; every other service may be down and is
picked up again when it returns.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL: all records, the ledger (`ledger_entries`), sessions, signing keys, grid factors |
| `WIREMOCK_URL` | certificate registry, meter data hub and grid-factor feed (invented data) |
| `GOTENBERG_URL` | renders the attestation PDF |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: the only copy of each issued PDF |
| `APP_PUBLIC_PORT` | listening port (default 4173) |
| `SETTLEMENT_CLOCK_START` | the settlement clock's start (default `2026-11-09T12:00:00Z`) |
| `REVIEW_SECONDS` | length of a review in seconds (default 864000) |

Credentials are read only from the environment and never reach the browser.

## Signing in

The seed (applied once, on the first serve against an empty database) creates five invented users with the password
`hourproof-demo-1`: two analysts (`anouk@verhoeven.example`, `joris@verhoeven.example`), a lead (`mirthe@verhoeven.example`)
and two verifiers (`vera@aldermoor.example`, `bram@brightlock.example`). Analysts land on `/windows`, verifiers on
`/review`, the lead on `/group`. The public check page is `/check`.

On that first serve the seeded Cancelled and Sealed windows (`ein-2026-08`, `rtm-2026-03`) send their lines to the
certificate registry and read Cancelled once it confirms them; `rtm-2026-03` is then signed and sealed as
`HP-2026-03-RTM-1`. If the registry is unreachable at boot this finishes by itself once it answers.
