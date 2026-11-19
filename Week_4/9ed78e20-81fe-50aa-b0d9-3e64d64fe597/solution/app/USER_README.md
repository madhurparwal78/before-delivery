# Aldermoor Labs Open Record

The public research record and governed staff console for Aldermoor Labs. Visitors read numbered theses, model evidence and generated samples, filter and search the newsroom and the whole record, read the record as it stood at an earlier moment, find open roles, and apply with a PDF and follow a named stage without an account. Staff review content, sign responsible-release records, schedule London embargoes, run requisitions, govern expiring access, verify the tamper-evident audit chain and retry dead background jobs.

## Run

Use Node.js 22. Execute the `run.json` commands from the app directory:

```
npm ci --include=dev --cache /tmp/aldermoor-npm-cache
npm run build
npm run start
```

The build checks strict TypeScript, bundles server and browser code, copies the local OFL font files and writes the asset manifest and dependency notices. Serving applies the schema and seed data idempotently (several instances may start together), probes storage and mail, then listens on `0.0.0.0`. `GET /api/health` answers `{"status":"ok"}` once the schema is applied; `GET /api/ready` reports database, storage and mail as up or down. If the database is unreachable at boot the server retries every 2 seconds. Storage and mail may be unreachable at boot; the platform serves and recovers on its own.

Several identical instances may run against one database. Sessions, rate-limit counts, sign-in lockouts, idempotency keys, embargoes, job leases and the search index all live in PostgreSQL.

## Services

- **PostgreSQL** (`DATABASE_URL`): the only system of record.
- **MinIO** (`S3_*`): private bucket for generated samples (`samples/...`) and résumés (`resumes/...`).
- **SMTP** (`SMTP_HOST`, `SMTP_PORT`; Mailpit in development): every outgoing email, sent from a database outbox of `mail` jobs.

## Environment

| Variable | Purpose | Default |
|---|---|---|
| DATABASE_URL | PostgreSQL connection | none |
| S3_ENDPOINT, S3_REGION, S3_BUCKET | Object storage endpoint, signing region and private bucket | none |
| S3_FORCE_PATH_STYLE | `true` for path-style bucket addressing | none |
| S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY | Storage credentials; the secret also derives the key that encrypts live tracking links at rest | none |
| SMTP_HOST, SMTP_PORT | Mail server | none |
| MAIL_FROM | Sender | `Aldermoor Open Record <record@aldermoor.example>` |
| APP_PUBLIC_PORT | Listen port | 4173 |
| PUBLIC_BASE_URL | Absolute origin in emailed links, the feed and the sitemap | `http://localhost:<port>` |
| OUTBOX_RETRY_SECONDS | Job retry interval | 10 |
| OUTBOX_RETRY_MAX_SECONDS | Longest refusal backoff | 60 |
| JOB_MAX_ATTEMPTS | Refusals before a job is dead | 5 |
| APPLICATION_RETENTION_SECONDS | Seconds after a requisition closes before candidate data is erased | 15552000 |
| RESEND_WINDOW_SECONDS | Rolling window for at most three tracking-link re-sends per email | 3600 |
| SESSION_TTL_SECONDS | Console session lifetime | 43200 |
| SIGNIN_LOCKOUT_SECONDS | First sign-in lockout; later locks double up to eight times | 30 |
| IDEMPOTENCY_TTL_SECONDS | How long a stored Idempotency-Key response is replayed | 86400 |
| RATE_LIMIT_PUBLIC_PER_MINUTE, RATE_LIMIT_CANDIDATE_PER_MINUTE, RATE_LIMIT_SIGNIN_PER_MINUTE, RATE_LIMIT_CONSOLE_WRITES_PER_MINUTE | Bucket limits per 60-second window | 600, 60, 20, 120 |
| TRUST_FORWARDED_FOR | `true` to key client limits by the leftmost `X-Forwarded-For` address | false |

Credentials are read only from the environment and never reach the browser. Public responses never set cookies; sign-in alone sets the HttpOnly, SameSite Strict console session. Active grants are read on every console request.

## Seed and media

Seed staff, grants, rows, models, posts, benefits and roles follow the brief. Seed staff sign in with the shared password given in the brief's Seed data; the source stores only its salted scrypt digest. Samples are synthesised in `src/media.ts`; any missing at start are queued as `sample_upload` jobs. The same module generates a PDF fixture in memory. No copied images, audio or documents are bundled.

## Integrity

Versioned records change only under a quoted `If-Match` version, written conditionally in the database. Releases and linked announcements commit together with their publication history and search entries. The audit table is append-only, enforced by a database trigger, and each entry is hash-chained to the previous one; `GET /api/console/audit/verify` recomputes the chain. Background jobs are claimed with leases and `FOR UPDATE SKIP LOCKED`, retried with backoff, and dead-lettered after repeated refusals.
