# Plumbline — Marrow Hall Interiors

Plumbline is the delivery workspace of Marrow Hall Interiors: stage gates, the drawing register, sealed tenders, levelling, variations, certificates and retention, shop drawings, the Intent seam site walk, finishes, case studies and project enquiries, all in one place with clients and contractors.

## Running

```sh
npm ci          # install
npm run build   # typecheck and build server + browser bundle
npm start       # serve on 0.0.0.0:4173 (or APP_PUBLIC_PORT)
```

`run.json` holds these three commands (`install`, `build`, `serve`). On every start the schema and seed data are applied without duplicating anything, and missing seed files are rewritten to the bucket when storage is reachable.

Every seeded member signs in with the password `Marrow-Hall-2026`.

## Environment variables

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. |
| `S3_ENDPOINT` | S3-compatible (MinIO) endpoint. |
| `S3_REGION` | Bucket region. |
| `S3_BUCKET` | Bucket name. |
| `S3_FORCE_PATH_STYLE` | `true` for path-style addressing. |
| `S3_ACCESS_KEY_ID` | Bucket access key. |
| `S3_SECRET_ACCESS_KEY` | Bucket secret key. |
| `KILLBILL_URL` | Kill Bill base URL. |
| `KILLBILL_USERNAME` | Kill Bill basic-auth username. |
| `KILLBILL_PASSWORD` | Kill Bill basic-auth password. |
| `KILLBILL_API_KEY` | Kill Bill tenant API key (X-Killbill-ApiKey). |
| `KILLBILL_API_SECRET` | Kill Bill tenant API secret (X-Killbill-ApiSecret). |
| `SMTP_HOST` | Mail host (Mailpit). |
| `SMTP_PORT` | Mail port. |
| `APP_PUBLIC_PORT` | Serve port; defaults to 4173. |
| `APP_BASE_URL` | Origin for emailed links; defaults to `http://localhost:<port>`. |
| `TENDER_LINK_TTL_SECONDS` | Tender sign-in link lifetime; default 1800. |
| `INVITATION_TTL_SECONDS` | Invitation lifetime; default 604800. |
| `SESSION_IDLE_TIMEOUT_SECONDS` | Session idle timeout; default 43200. |
| `ENQUIRY_RATE_WINDOW_SECONDS` | Enquiry rate-limit window; default 3600. |

`MAILPIT_URL` is for tests only; the app does not read it.
