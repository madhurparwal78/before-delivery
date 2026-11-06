# Farshore Buckets

An S3-compatible object store for small app studios. Each bucket picks the regions that hold its
objects; every object shows which regions hold its current version and how long each copy took to
arrive. One origin serves:

- the marketing page (`/`);
- the multi-tenant web console (`/console`, sign-in at `/signin` with the two-step code step, invites at
  `/invite/<token>`);
- each user's account page (`/account`: two-step sign-in, sessions, password);
- the operator console (`/ops`);
- the JSON API (`/api`), the S3 API (`/s3`, path style, SigV4) and share links (`/l/<token>`).

## Run

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (esbuild bundles `src/server` to `dist/server.js` and `src/client` to `dist/public/assets/`) |
| serve | `node dist/server.js` — binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173) |

On every start the server applies its Postgres schema, seed data and Kill Bill catalog idempotently.
Several Farshore processes may share one Kill Bill tenant and upload the catalog at the same moment;
when Kill Bill reports that it can no longer read the tenant's catalog, the server deletes it and
uploads the Farshore catalog once more.
`GET /api/health` answers `{"status":"ok"}` as soon as it listens, even while a dependency is down;
the dependencies are retried in the background.

Seeded accounts (password `farshore-demo-26`): `mara@lanternfish.test` (owner),
`theo@lanternfish.test` (developer), `priya@lanternfish.test` (viewer), `jun@paperkite.test`,
`sol@paperkite.test`, `ada@tidepool.test`, and the operator `operator@farshore.test`. Jun is enrolled in
two-step sign-in with the authenticator secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` and the recovery codes
`kite1-jun01` … `kite1-jun10`.

Object bytes reach MinIO only as AES-256-GCM ciphertext under each version's own data key; data keys
are stored in Postgres wrapped under the workspace key of one generation (HKDF over the sealing key).
Every workspace has a SHA-256 hash-chained audit trail in the `audit_entries` table.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | every record: workspaces, members, keys, buckets, versions, replicas, links, webhooks, usage | Postgres |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | object bytes under `regions/<region>/<bucket>/<version>` and staged parts under `uploads/<upload>/<part>` | MinIO |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | catalog, one account and subscription per workspace, hourly usage records | Kill Bill |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | invites, key created and rotated notices, two-step and password notices, threshold alerts, suspension and dead-delivery emails | Mailpit (SMTP) |
| `APP_PUBLIC_PORT` | listen port (default 4173) | — |
| `FARSHORE_SECRET_KEY` | seals access-key, webhook and two-step secrets and derives the workspace keys; when unset a key is generated into `.farshore-sealing-key` in the working directory | — |
| `FARSHORE_INVITE_TTL_SECONDS` (259200), `FARSHORE_SIGNIN_WINDOW_SECONDS` (900), `FARSHORE_BILLING_SYNC_SECONDS` (60), `FARSHORE_IDEMPOTENCY_TTL_SECONDS` (86400), `FARSHORE_DAY_SECONDS` (86400), `FARSHORE_LIFECYCLE_SWEEP_SECONDS` (60), `FARSHORE_WEBHOOK_BACKOFF_SECONDS` (10), `FARSHORE_UNDO_SECONDS` (30), `FARSHORE_TWO_STEP_PENDING_SECONDS` (300), `FARSHORE_STEP_UP_SECONDS` (300), `FARSHORE_SESSION_IDLE_SECONDS` (1800), `FARSHORE_SESSION_LIFETIME_SECONDS` (43200), `FARSHORE_KEY_ROTATION_OVERLAP_SECONDS` (86400) | timing rules (defaults in brackets) | — |

No other datastore is used. Background workers (replication, lifecycle sweeps, webhook delivery,
mail outbox, billing sync) run inside the server process and coordinate through Postgres row locks,
so several processes may share one database.
