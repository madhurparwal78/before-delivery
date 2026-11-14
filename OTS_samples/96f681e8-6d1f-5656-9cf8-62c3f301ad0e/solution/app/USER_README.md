# Yardline: Marlowe Yard Padel Club

Yardline is the booking desk the club runs for itself. Players hold a court for a fixed time and pay, split a
booking four ways under the organiser's card guarantee, join open matches at their level and see their credits.
The front desk checks players in and marks no-shows, coaches book weekly lesson blocks, and the manager announces
price changes, sets the cancellation rule and reads utilisation.

## Run it

`run.json` holds the three commands:

- install: `go mod download && npm ci`
- build: `npm run build && go build -o yardline .`
- serve: `./yardline` (foreground, listens on `0.0.0.0` and `APP_PUBLIC_PORT`, default 4173)

`GET /api/health` answers 200 `{"status":"ok"}` once PostgreSQL and Keycloak are reached. The schema is applied on
every start and the seed is written only into an empty database. Seeded users share the password `Yardline-Court-7`.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | all state |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | Keycloak | sign-in, token checks, roles and seeded users |
| `WIREMOCK_URL` | Courtpay payment provider | authorisations, captures, charges, voids |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit | every email |
| `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD` | ntfy | every push |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | this server | listener, share links, sign-in return address |
| `HOLD_SECONDS` (600), `MATCH_CUTOFF_SECONDS` (7200), `FREE_CANCEL_SECONDS` (86400), `SHARE_SETTLE_SECONDS` (21600), `AUTH_REFRESH_SECONDS` (518400) | | club timing |
| `SLOT_STEP_MINUTES` (30), `OPENING_HOURS` (`08:00-23:00`), `NOTICE_RETRY_SECONDS` (`30,120,600,3600`) | | slots and notice retries |
