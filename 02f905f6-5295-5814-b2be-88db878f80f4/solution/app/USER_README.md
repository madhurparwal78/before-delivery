# Shelfmark

Shelfmark is the firing desk for Brickfield Lane Clayhouse, a community clay studio. It follows every
piece of greenware from the intake bench to the pickup shelf:

- **Members** log a piece from a phone with a photo and its sizes, see the per-cubic-inch fee live,
  accept and get charged, and follow their pieces and balance.
- **The kiln tech** packs each firing shelf by shelf on a true-scale drawing that refuses overlaps,
  overhangs, layers that are too tall and clay or cone mistakes; starts the firing; unloads once the
  server says the kiln has cooled; logs guest drop-offs at the counter and marks pieces collected.
- **The owner** sets dated rate sets and kiln profiles, sees what every account owes (read from
  Kill Bill), records counter payments and settles shelf-damage reports against the intake photo.
- **Guests** follow a drop-off through a private tracking link, without an account.

## Running it

The app is started only through `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (esbuild bundles the server to `dist/server.mjs` and the browser app to `dist/public/assets/`) |
| serve | `node dist/server.mjs` (foreground, binds `0.0.0.0`) |

Type-check with `npx tsc --noEmit`. The schema and seed (people, clays, kilns, profiles, the first rate
set) are applied at every serve, under a Postgres advisory lock so several instances can start together.
`GET /api/health` answers `503 {"status":"starting"}` until Postgres is reachable and migrated, then
`200 {"status":"ok"}`.

## Configuration

Every service URL and credential comes from the environment; none is sent to the browser.

| Variable | Used for |
|---|---|
| `APP_PUBLIC_PORT` | port to listen on (4173 when unset) |
| `APP_PUBLIC_URL` | base of guest tracking links |
| `DATABASE_URL` | Postgres, the system of record |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: every photo, stored as uploaded at `photos/<photo_id>` |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: accounts, firing and shelf-damage charges, payments, balances |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit over SMTP: receipts, ready notices, pickup reminders, new tracking links |
| `FIRING_HOUR_SECONDS` | length of one studio hour for firing schedules (3600 when unset) |
| `PICKUP_DAY_SECONDS` | length of one studio day for the pickup clock (86400 when unset) |

## Services

- **Postgres** holds people, sessions, pieces, firings, placements, history, damage reports, tracking
  links, the mail outbox and idempotency keys. Nothing else is stored locally.
- **MinIO** holds every intake and unload photo byte for byte with its original content type. A photo
  counts as attached only after the server has read back the stored object's size.
- **Kill Bill** holds every charge and balance. Members have accounts `member-<member number>`,
  created at start (when reachable) or on first need; each guest drop-off gets `guest-<piece number>`.
  Each intake or drop-off is one external charge (one invoice), voided if the receipt cannot be sent.
  Guest payment is a PURCHASE for the invoice's full balance with Kill Bill's built-in external payment
  method. A member's counter payment is one PURCHASE for the account's whole balance, applied to the
  account as credit so it settles every open invoice at once.
- **Mailpit** receives receipts during intake (the piece exists only after the mail server accepts
  the receipt); ready notices, reminders and new-link emails go through an outbox in Postgres that is
  retried every 10 seconds and sent once even with several instances.

When Kill Bill, MinIO or Mailpit is unreachable the app still starts; each feature that needs the
missing service answers with that service's 503 and the screens show the outage copy.
