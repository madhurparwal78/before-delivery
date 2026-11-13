# Undersign

Undersign is a document e-signing app for small teams, made by Wickmoor Paper Co. A sender uploads a PDF, places signature, initials, date and text fields on its pages, routes the document to recipients in a set order and watches the status change live. Recipients need no account: each signs or declines from an emailed link. When the last recipient signs, Undersign seals the completed PDF with an appended certificate page, stores it, and keeps a hash-chained audit trail. The completed PDF is a tamper-evident record, not a certificate-based digital signature.

It is TypeScript on Node.js for both server and browser and talks to exactly three services: PostgreSQL (every record), MinIO object storage (originals, completed PDFs and template originals) and Mailpit over SMTP (every email).

## Run it

`run.json` holds the three commands the deployment runs from the app directory:

```
install: npm ci
build:   npm run build      (compiles the server with tsc, type-checks and bundles the client with Vite)
serve:   npm run start      (node dist/server/server/index.js, in the foreground)
```

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (4173 by default). `GET /api/health` answers `{"status":"ok"}`. The schema is applied on every start and is safe when two instances start together. If PostgreSQL is unreachable the server retries for 60 seconds and then exits with a non-zero code; if MinIO or Mailpit is unreachable it still starts, shows the matching service notice, holds invitations and keeps retrying.

## Environment variables

| Variable | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | connection string |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | object storage address, bucket and credentials (the bucket is created if missing) |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit | where every email is sent |
| `MAIL_FROM` | Mailpit | sender address, default `Undersign <sign@wickmoor.example>` |
| `APP_PUBLIC_URL` | none | the origin used for every link in an email |
| `APP_PUBLIC_PORT` | none | listening port, default 4173 |
| `GRADING_KEY` | none | enables `POST /api/grading/setup` and `GET /api/grading/samples/<name>` when the request carries the same value in `X-Grading-Key` |
| `LINK_TTL_SECONDS` | none | signing link lifetime, default 1209600 (14 days) |
| `REMINDER_COOLDOWN_SECONDS` | none | one reminder per document per this long, default 86400 |
| `MAIL_RETRY_SECONDS` | none | earliest retry of a held email, default 30 |
| `SEAL_RETRY_SECONDS` | none | earliest retry of a failed seal, default 30 |

Nothing is written to local files, and none of these values is sent to the browser.

## Using it

Sign in at `/sign-in`. Documents (`/documents`) lists the team's documents with filter tabs; uploading a PDF opens its draft. In the editor, add signers, place fields by dragging a field button onto a page, by tapping it then the page, or from the keyboard (Enter or Space), then set each field's signer, required flag and label in Field properties. Send for signing emails signer 1 only; each next signer is invited when the one before signs. Signers open their link at `/sign/<token>`, walk the highlighted fields with Next, adopt a typed or drawn signature and press Finish and sign, or decline with a reason. Owners manage roles at `/team` and shared templates at `/templates`. Every document has an Audit trail page.
