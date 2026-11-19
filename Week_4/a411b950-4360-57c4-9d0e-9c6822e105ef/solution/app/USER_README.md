# Earshot by Kettlehole Audio

Earshot is the portfolio and booking product of one freelance game sound designer and composer.

- **Journey** (`/`): audio directors pass a sound gate and scroll through a 3D corridor of project
  stations. At each station the intensity rises from 0 to 100 and the bed, pulse, lead and stinger
  layers of the project's adaptive score come in one by one. The corridor ends with the brief form.
- **Private listening** (`/listen/<token>`): one NDA station behind a read-only link that stops
  working at its expiry, or at once when the operator revokes or regenerates it.
- **Proposal page** (`/p/<token>`): a producer reviews the 30/20/20/30 milestone split, accepts to
  hold a production month (Kill Bill raises the deposit invoice) and pays the deposit.
- **Console** (`/console`): the operator signs in to manage projects and stems, listening links,
  enquiries with private triage, proposals, production months, milestone invoices and the time zone.

## Running it

`run.json` holds the three commands the deploy uses:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks server and browser code, compiles the server, bundles the front end with Vite) |
| serve | `node dist/server/server/main.js` (foreground, binds `0.0.0.0`) |

The server applies its schema and seed data on every start (idempotently) and keeps running when a
service is down: health always answers, and the other endpoints answer 503 until the service returns.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | every record, rate-limit counts, idempotency records and the mail queue | PostgreSQL |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | stems and brief attachments (private bucket, bytes served through the app) | MinIO |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | every outbound email (`MAIL_FROM` is the From mailbox) | SMTP server (Mailpit in grading) |
| `MAIL_RETRY_SECONDS` | how often queued emails are retried (default 10) | SMTP server |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | accounts, invoices and payments | Kill Bill |
| `APP_PUBLIC_PORT` | listening port (default 4173) | — |
| `APP_PUBLIC_URL` | the app's own origin and the links written into emails (default `http://localhost:<port>`) | — |
| `PROPOSAL_LINK_TTL_SECONDS` | proposal accept-link lifetime (default 1,209,600) | — |
| `ENQUIRY_LIMIT_PER_SENDER`, `ENQUIRY_LIMIT_PER_IP`, `ENQUIRY_RATE_WINDOW_SECONDS` | brief pacing (defaults 3, 200, 600); instances count only briefs saved under the same three values | PostgreSQL |

No credential or service URL is hard-coded or sent to the browser.

## Seeded operator

Email `operator@kettlehole.example`, password `ladder-console-2026`.
