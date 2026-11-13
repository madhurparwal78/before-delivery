# Ourlet Consignment Desk

The back office and public shop window of Atelier Ourlet, a consignment boutique in Brussels. Staff take pieces in, sell at the till, look after holds and appointments, run the monthly payout with its SEPA bank file, and read the sales book. Consignors use a private page and a public appointment page. Shoppers browse the public rail and hold pieces to try on in the shop.

## Run it

The commands are in `run.json`:

- install: `npm ci`
- build: `npm run build`
- serve: `npm run start`, in the foreground on `0.0.0.0` and `APP_PUBLIC_PORT`

The schema and starting data are applied on first start to an empty database. Sign-in details for the seeded members are in the brief's seed table.

## Environment

| Variable | Default | Talks to |
|---|---|---|
| `DATABASE_URL` | required | Postgres, the shop's record |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | required | MinIO: photos and bank files |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | required | Mailpit: every mail the shop sends |
| `APP_PUBLIC_PORT` | 4173 | the port the server binds |
| `APP_PUBLIC_URL` | `http://localhost:<port>` | the start of addresses in mails |
| `SESSION_SECONDS` | 43200 | session length |
| `HOLD_SECONDS` | 7200 | hold length |
| `PORTAL_PAGE_SECONDS` | 1209600 | consignor page address lifetime |
| `APPOINTMENT_RATE_WINDOW_SECONDS` | 3600 | booking limit window |
| `BOOK_FILE_RATE_WINDOW_SECONDS` | 3600 | sales book download limit window |

`MAILPIT_URL` is part of the environment but the app does not read it: it sends over SMTP. Postgres is retried for up to 60 seconds at boot; the app starts without MinIO or Mailpit and refuses only the actions that need them.
