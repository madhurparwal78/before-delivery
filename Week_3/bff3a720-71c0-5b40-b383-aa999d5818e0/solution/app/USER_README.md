# Longseat

Longseat is a carpooling network for long trips between eight invented towns. A driver publishes a trip with its
stopovers, seats and a price per seat. Passengers find a seat for the whole route or for one stretch of it, pay from a
simulated wallet, message the driver, cancel under a rule shown before they confirm, and rate the trip afterwards.
The founder checks uploaded ID documents and watches the email queue and the state of bookings.

PostgreSQL is the source of truth. Valkey keeps seat holds, request deadlines, presence and rate counters.
MinIO stores profile photos and ID documents. Mailpit receives every email the app sends.

## Run it

`run.json` holds the three commands (a clean install from the lockfile, the build, then the foreground server):

```
npm ci
npm run build
npm run start
```

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173), applies its schema on start and writes the demo
network once when the database has no members. `GET /health` answers `{"status":"ok"}` when PostgreSQL, Valkey,
MinIO and Mailpit are reachable and `{"status":"unavailable"}` otherwise.

Demo members sign in with a code sent to Mailpit: `founder@longseat.test` (founder), `mara@longseat.test` and
`idris@longseat.test` (verified drivers), `lune@longseat.test` and `tobin@longseat.test` (passengers).

## Environment

| Variable | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | connection string |
| `VALKEY_URL` | Valkey | connection string |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | object storage |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `MAILPIT_URL` | Mailpit | outgoing mail and health |
| `GRADING_TOKEN` | app | enables `POST /api/grading/setup` and `/api/grading/clock` for the header `X-Grading-Token` |
| `APP_PUBLIC_PORT` | app | listen port |
| `SEAT_HOLD_SECONDS`, `REQUEST_EXPIRY_HOURS`, `REQUEST_CUTOFF_MINUTES`, `BOOKING_CUTOFF_MINUTES`, `REFUND_FULL_HOURS`, `REFUND_HALF_HOURS`, `REFUND_HALF_PERCENT`, `FREE_CANCEL_SHIFT_MINUTES`, `RATING_WINDOW_DAYS`, `MESSAGE_RATE_PER_MINUTE`, `REQUEST_RATE_PER_HOUR`, `SIGNIN_CODE_RATE_PER_HOUR`, `EMAIL_CODE_TTL_SECONDS`, `PHOTO_MAX_BYTES`, `ID_DOC_MAX_BYTES`, `PRICE_MIN_PER_KM_CENTS`, `PRICE_MAX_PER_KM_CENTS`, `MAX_STOPOVERS`, `AVERAGE_SPEED_KMH`, `TOAST_SECONDS`, `SEARCH_DEBOUNCE_MS` | app | timers and limits, each with the default of the brief |

Only `TOAST_SECONDS` and `SEARCH_DEBOUNCE_MS` reach the browser. No credential or service URL does.

## Layout

- `src/shared/` rules used by both sides once: towns and distances, money and segment price, Brussels time, seat freedom.
- `src/server/` configuration, the one server clock, PostgreSQL, Valkey, MinIO and SMTP clients, domain rules, services, routes.
- `src/client/` the React single-page app and the seeded plate renderer.
- `public/fonts/` STIX Two Text (SIL OFL 1.1), self-hosted.
