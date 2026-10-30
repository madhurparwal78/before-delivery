# Plumbline — Marrow Hall Interiors

Plumbline is the delivery workspace of Marrow Hall Interiors. It runs commercial
interiors rollouts: stage gates and stage-fee invoicing, the drawing register and
transmittals, sealed tendering and levelling, variations, payment certificates
and retention, shop-drawing reviews on a Hong Kong working-day clock, the Intent
seam for site walks, the finishes schedule, and the public case-study site with
project enquiries.

## Running it

`/app/run.json` holds the three commands:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `npm ci` installs from `package-lock.json`.
- `npm run build` compiles the server with `tsc` and the browser bundle with Vite.
- `npm run start` serves on `0.0.0.0:4173`, or on `APP_PUBLIC_PORT` when that is set.

`GET /api/health` answers `200 {"status":"ok"}` once Postgres is reachable and the
schema is applied, and `503 {"status":"starting"}` until then. The schema and the
seed are applied on every serve, never only at build, and are safe when several
copies of the app start at the same moment.

## Signing in

Every seeded member's password is `Marrow-Hall-2026`.

| Role | Email |
| --- | --- |
| Studio director | avery.tsang@marrowhall.example |
| Project lead | jordan.lim@marrowhall.example |
| Project lead | casey.wong@marrowhall.example |
| Designer | rin.mok@marrowhall.example |
| Designer | sam.teo@marrowhall.example |
| Studio finance | morgan.ho@marrowhall.example |
| Client approver, Kestrel Tea House | dana.cheung@kestreltea.example |
| Client approver, Kestrel Tea House | quinn.yeo@kestreltea.example |
| Client approver, Northvane Optics | robin.chan@northvane.example |
| Contractor, Harbourline Fit-Out Ltd | ash.kwok@harbourline.example |
| Contractor, Tideway Joinery Pte Ltd | kai.ng@tideway.example |
| Contractor, Granite Pier Builders | lee.fong@granitepier.example |

## Environment variables

Every credential and setting is read from the environment at start. Nothing is
hard-coded, logged or sent to the browser.

### Postgres

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. All workspace state lives here. |

### MinIO, the S3-compatible bucket

| Variable | Required | Meaning |
| --- | --- | --- |
| `S3_ENDPOINT` | yes | Bucket endpoint, for example `http://minio:9000`. |
| `S3_REGION` | no (`us-east-1`) | Region used when signing requests. |
| `S3_BUCKET` | yes | Bucket that holds sheets, transmittals, shop drawings, renders and site photos. |
| `S3_FORCE_PATH_STYLE` | no (`true`) | `false` switches to virtual-host addressing. |
| `S3_ACCESS_KEY_ID` | yes | Access key. |
| `S3_SECRET_ACCESS_KEY` | yes | Secret key. |

### Kill Bill

| Variable | Required | Meaning |
| --- | --- | --- |
| `KILLBILL_URL` | yes | Kill Bill base URL. |
| `KILLBILL_USERNAME` | yes | Basic auth user. |
| `KILLBILL_PASSWORD` | yes | Basic auth password. |
| `KILLBILL_API_KEY` | yes | Tenant key. |
| `KILLBILL_API_SECRET` | yes | Tenant secret. |

### Mail

| Variable | Required | Meaning |
| --- | --- | --- |
| `SMTP_HOST` | yes | SMTP host. Every message goes out over SMTP. |
| `SMTP_PORT` | no (`1025`) | SMTP port. |

### App

| Variable | Required | Meaning |
| --- | --- | --- |
| `APP_PUBLIC_PORT` | no (`4173`) | Port the server binds on `0.0.0.0`. |
| `APP_BASE_URL` | no (`http://localhost:<port>`) | Origin used for emailed invitation, tender sign-in and case-study preview links. |

### Timing

| Variable | Required | Meaning |
| --- | --- | --- |
| `TENDER_LINK_TTL_SECONDS` | no (`1800`) | How long a tender sign-in link lasts. |
| `INVITATION_TTL_SECONDS` | no (`604800`) | How long an invitation lasts. |
| `SESSION_IDLE_TIMEOUT_SECONDS` | no (`43200`) | Idle time before a session ends. |
| `ENQUIRY_RATE_WINDOW_SECONDS` | no (`3600`) | Window for the three-enquiries-per-address limit. |

`MAILPIT_URL` is only for tests. The app never reads it.

## When a dependency is unreachable

- **Postgres at boot:** the server keeps retrying every two seconds and health answers `503 {"status":"starting"}`.
- **Kill Bill:** a stage sign-off answers `503 billing_unavailable`, the stage stays requested, and no sign-off, invoice or receipt is recorded.
- **MinIO:** uploads, transmittals and file downloads answer `503 storage_unavailable`, and no register row, revision, transmittal, shop drawing, render or photo record is created.
- **The mail server:** messages wait in the outbox and are retried every ten seconds. The action that caused them still succeeds.

## Where things live

| Path | What it holds |
| --- | --- |
| `src/shared` | Vocabulary, formatting and field-error copy used by both the server and the browser. |
| `src/server/domain` | One module per domain rule: money, revision lettering, levelling, retention, the store split, the review clock, the defects end date, state transitions, CSV and the finishes matching rules. |
| `src/server/services` | Kill Bill, SMTP, the bucket, file signatures, image handling, ZIP, iCalendar and the procedural artwork. |
| `src/server/routes` | The published API routes. |
| `src/client` | The browser app: screens, panels, the Intent seam and the design system. |
