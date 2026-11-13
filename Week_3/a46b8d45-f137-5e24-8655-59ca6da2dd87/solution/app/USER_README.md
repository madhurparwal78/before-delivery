# Holmgarth Aftercare Fittings Desk

The web desk for Holmgarth Aftercare, a one-person business that finds, prices and posts replacement numbered parts for flat-pack wardrobes, sofa frames, bed frames and shelving units.

- **Owners** (phone, no account, English or Polish) name the piece, pull its assembly diagram apart until the broken part stands clear (the fitting fan), add 1 to 4 damage photos, confirm the claim from an email and follow it through one share link.
- **The operator** signs in, identifies each claimed part and rules whether it is inside aftercare, quotes it from the catalogue plus the carrier's charge, records the owner's bank transfer, dispatches it with a dispatch note, and can decline, refund, close or erase. Weekly they import the supplier parts file and publish dated aftercare editions.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, bundles the server to `dist/server.js` and the browser code to `dist/public`) |
| serve | `node dist/server.js` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

Health check: `GET /api/health` answers `200 {"status":"ok"}` whether or not the services are reachable. The schema is applied on start and again as soon as Postgres answers; seed data loads only when the catalogue is empty. Seeded operator: `operator@holmgarth.example` (password in the brief's seed data).

## Services and settings (all read from the environment at start)

| Service | Variables | Used for |
|---|---|---|
| Postgres | `DATABASE_URL` | every record and all shared state (claims, sessions, locks, rate windows, idempotency records, notice queue, decided counts) |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | damage photos at `claims/<reference>/photos/<n>` and dispatch notes at `claims/<reference>/dispatch-note.html` |
| Kill Bill | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | the only billing record: accounts, invoices, payments, refunds |
| Mailpit | `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM` | every email (SMTP) and the message deletion used by erasure (HTTP API) |
| Carrier pricing (WireMock) | `WIREMOCK_URL` | carriage bands and charges |
| Desk | `APP_PUBLIC_URL`, `APP_PUBLIC_PORT` | base for emailed links; listening port |

Desk settings (`0` is a real value, never replaced by its default): `AFTERCARE_STANDARD_MONTHS` (24), `AFTERCARE_CLUB_MONTHS` (36), `AFTERCARE_TERM_SECONDS_OVERRIDE` (unset), `CONFIRM_LINK_TTL_SECONDS` (1800), `DISPATCH_CUTOFF_LOCAL` (`14:00`), `REFERENCE_LOCK_SECONDS` (900), `PARTS_RATE_LIMIT_PER_MINUTE` (60), `OPERATOR_SESSION_SECONDS` (43200), `DESK_CLOCK_FROZEN_AT` (unset, an ISO 8601 UTC instant that is "now" for every decision).

## Layout of the source

`src/server` (Node `http`, one route table, one error builder), `src/shared` (copy, formats and API types used by both sides), `src/client` (Preact pages, the fitting fan, the dialog), `public/fonts` (bundled typefaces). All source is TypeScript. See `THIRD_PARTY_NOTICES.md` for every package, typeface and icon with its licence.
