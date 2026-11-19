# Roundbook

Roundbook is the day-to-day workspace for a small-animal clinic: the appointment calendar, the waiting room, the ward board with
its Kennel beacon, consult notes with files, invoices, batch-tracked stock and vaccination reminders, on one server clock and one
live feed. Pet owners use a public booking page at `/book/<clinic slug>`.

## Run it

`run.json` holds the three commands the verifier uses:

```
install: npm ci
build:   npm run build      (tsc for the server, Vite for the browser app)
serve:   npm start          (foreground, 0.0.0.0, port APP_PUBLIC_PORT, default 4173)
```

## Environment (read once, in `server/config.ts`; never sent to the browser)

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres, the system of record |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit: every outbound email |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: every patient file and exported PDF (the bucket must exist) |
| `GRADING_TOKEN` | the two grading routes; absent means they answer 404 |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | listen port; absolute links in emails and seed login links |
| `SLOT_MINUTES`, `LATE_MINUTES`, `TREATMENT_GRACE_MINUTES`, `ADMISSION_LINGER_HOURS`, `BOOKING_LEAD_MINUTES`, `BOOKING_HORIZON_DAYS`, `REMINDER_LEAD_DAYS`, `REMINDER_HOUR`, `UNDO_SECONDS`, `WAIT_TICK_SECONDS`, `UPLOAD_MAX_MB`, `BOOKING_RATE_PER_MINUTE`, `VAT_PERCENT`, `IDEMPOTENCY_KEY_HOURS` | the settings of the brief, with its defaults |

On first start with an empty database the app creates the two clinics of the brief's seed data. Staff sign in with the seeded
emails and the password `roundbook-demo-1`.

## Layout

`server/` the API, services and the ticker for everything the clock causes; `web/` the React app; `shared/` roles, permissions, error
codes and clinic-time helpers used by both.
