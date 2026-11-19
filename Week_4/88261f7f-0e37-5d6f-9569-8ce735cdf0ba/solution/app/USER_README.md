# Tallybell Nightroll

A front desk and property management system for owner-operated inns of 10 to 20 rooms. One account holds the room timeline,
folios, the housekeeper's phone board and the end-of-day close, and they agree to the cent.

## What it does

- **Owner, front desk:** a ruled night timeline with a fixed key-rack column; create, move, check in, check out and cancel stays
  (by keyboard: `N`, `M`, `I`, `O`, Enter, arrows, Escape); folios with payments, reversals, splits and numbered PDF invoices;
  guest records and merges. The owner also sets rates and tax rates, reads occupancy, average daily rate and revenue per
  available room, and runs the close (Night Close Sweep).
- **Housekeeper:** a phone board showing each room's number, status and the dates of the stay holding the business date, nothing else.
- **Arriving guest:** an emailed link opens a one-column page to upload an ID photo and complete check-in. No account.

## Run it

`run.json` holds the commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-check, then bundle the server and the client with esbuild) |
| serve | `npm run start` (`node dist/server.js`, foreground, `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173) |

The schema and the first-start seed are applied on serve, under a Postgres advisory lock, so several copies may start together.
The seed creates `The Larkspur Inn` (owner, two front desk users, one housekeeper, 14 rooms, eight stays) and `Quarry Lane Rooms`.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | all hotel data, sessions, closed-day figures, live fan-out (`LISTEN/NOTIFY`) | Postgres |
| `GOTENBERG_URL` | invoice PDF render (`/forms/chromium/convert/html`) | Gotenberg |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | invoice PDFs and ID photos in a private bucket | MinIO |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | check-in links and invoice emails | Mailpit |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | listen port; base of the check-in link (the request's origin when unset) | none |
| `GRADING_KEY` | header value for the two grading routes (they answer 404 without it) | none |
| `HOTEL_TIME_ZONE_DEFAULT` (default `America/Chicago`), `CHECKIN_LINK_TTL_SECONDS` (259200), `ID_PHOTO_MAX_BYTES` (5000000), `LIVE_MAX_DELAY_MS` (2000) | hotel and link rules | none |

Providers are read on every call; the app boots with any of them unreachable and recovers without a restart. `GET /api/health`
always answers 200 with `{"status":"ok"}` or `{"status":"unavailable"}`.

## Layout of the source

`server/` (HTTP, rules, providers), `shared/` (money, split, dates, notices and API types used by both sides),
`src/` (React screens), `scripts/build.mjs`.
