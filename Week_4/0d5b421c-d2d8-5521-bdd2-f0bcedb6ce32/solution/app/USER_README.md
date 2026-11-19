# Saffron & Slate Tables

The booking site for Saffron & Slate, a 64-cover restaurant in Lisbon.

- **Guests** choose a party, a date and a time in Lisbon time, pick a real table on the drawn floor plan and hold it for
  five minutes while they decide. A deposit (€15 a guest) is taken through Kill Bill only for parties of 5 or more and at
  Chef's Counter. A guest cancels from the emailed manage link and learns before confirming whether the deposit comes back
  (full refund at least 24 hours before the table, otherwise kept). On a full evening a guest joins the waitlist and is
  emailed an offer when a fitting table frees up.
- **The host** runs tonight's floor from one live plan at `/host`: holds, bookings, offers and seated tables change
  without reloading. The host seats and clears tables, marks no-shows and seats walk-ins.

Pages: `/` (rooms), `/book`, `/waitlist`, `/offer/<token>`, `/manage/<token>`, `/host/sign-in`, `/host`. The API is under `/api`.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (browser app with Vite, server with `tsc`) |
| serve | `npm run start` (Node.js 22, foreground, `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

`GET /api/health` answers `{"status":"ok"}` once the server is up, even while Kill Bill or Valkey is down. The schema and seed
data are applied to Postgres idempotently on every start. The server waits up to 60 seconds for Postgres and exits non-zero
if it never answers.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | system of record: rooms, tables, holds, bookings, offers, waitlist, host sessions, emails, payments | Postgres |
| `VALKEY_URL`, `VALKEY_KEY_PREFIX` | claims on tables and offers, the replayable live-event stream | Valkey |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | deposits (PURCHASE) and refunds (REFUND) | Kill Bill |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | confirmation, cancellation, offer and lapsed emails | Mailpit |
| `HOLD_SECONDS` (300), `OFFER_SECONDS` (900) | how long a hold and an offer last | |
| `APP_CLOCK_CONTROL` | `1` enables `PUT /api/clock`, which sets the server's now for every rule | |
| `APP_PUBLIC_PORT` (4173), `APP_PUBLIC_URL` | listen port; the base of the links in emails and manage URLs | |

No credential or service address is sent to the browser.

## Host sign-in

Seeded host: `host@saffronslate.example` (see the brief for the password). The password is stored only as a salted hash.
