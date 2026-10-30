# Saltprint Desk

Saltprint Desk is the licensing desk of the Saltprint Picture Co-operative. Member photographers upload
embargoed photo essays with co-credits and split shares; newsroom picture desks browse the contact sheet,
step through essays, shortlist frames, claim time-boxed exclusive windows or buy standard licences, and
download originals while a licence runs. The co-op's desk editor reviews submissions and handles
withdrawals and legal takedowns; the treasurer schedules commission rates, runs monthly royalty
statements and records payouts. Every time is entered, judged and shown in co-op time (America/Chicago).

Everyone signs in with a seeded account (password `darkroom-proof-26`), for example
`ada@contributors.saltprint.example` (contributor), `priya@harbor-light.example` (picture editor),
`june@harbor-light.example` (licensing manager), `ines@saltprint.example` (desk editor) and
`bram@saltprint.example` (treasurer).

## Running it

`run.json` holds the three commands:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the versions in `package-lock.json` |
| build | `npm run build` | type-checks (`tsc --noEmit`) and bundles the server, the image worker and the browser app into `dist/` |
| serve | `npm run start` | runs `node dist/server.js` in the foreground on `0.0.0.0` |

The server answers `GET /api/health` with `{"status":"ok"}` as soon as the port is open, whatever the
state of the services. It applies the schema and seed data to the database on every serve (idempotently,
under an advisory lock, so several instances can share one database) and draws the seeded halftone frames
into storage in the background.

## Environment

| Variable | Service | Use |
|---|---|---|
| `APP_PUBLIC_PORT` | app | listening port (default 4173) |
| `APP_CLOCK_CONTROL` | app | `on` enables `PUT /api/clock`, which moves the shared server clock |
| `DATABASE_URL` | Postgres | system of record: people, sessions, essays, frames, credits, follows, shortlists, licences, idempotency keys, rates, statements, payouts, the clock offset and the outbound mail queue |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | originals, derivatives, grant records and the legal-hold prefix in one private bucket; signed grant links for downloads |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | newsroom accounts and one external charge per licence; contributor accounts and one CREDIT payment per payout |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP) | receipts, expiry warnings, embargo-lift alerts and takedown notices, one message per recipient |

None of these values is logged or sent to the browser.

## Outages

The app starts and serves with any provider unreachable. Licence requests made while billing is down are
held as pending invoice until their hold deadline and activate on their own when billing returns; payouts
and email wait in the database and are completed by whichever instance can reach the provider first.
