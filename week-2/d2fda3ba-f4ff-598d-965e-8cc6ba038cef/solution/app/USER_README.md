# Tidewrack Cairn

Cairn is a local-first notebook of linked Markdown notes for independent investigators. The
notebook is free and works in the browser without an account: notes live in the browser's
IndexedDB and keep working with the network off. Two paid add-ons extend it:

- **Sync** carries end-to-end encrypted revisions of a case vault between your devices and a
  research partner's. Notes are encrypted in the browser (Web Crypto AES-GCM with a vault key
  wrapped by a PBKDF2-SHA-256 passphrase key); the server stores only ciphertext and hashes.
- **Publish** turns a bounded slice of the case into a public dossier. You draw the boundary on
  the Exposure Ring; the server recomputes it and nothing outside it reaches the published site.

The founder-operator console is at `/ops` (seeded operator account `ops@tidewrack.example`).

## Running it

`run.json` holds the three commands the deployment runs from this directory:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the lockfile |
| build | `npm run build` | type-checks, then bundles the server, browser app, service worker and dossier reader into `dist/` |
| serve | `npm run start` | runs `node dist/server.mjs` in the foreground on `0.0.0.0:$APP_PUBLIC_PORT` |

On every start the server applies its PostgreSQL schema, uploads the Kill Bill catalog when the
tenant has none and creates the seed accounts, all idempotently. Health: `GET /api/health`.

## Services and environment

| Variable | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | system of record (accounts, devices, vault membership, wrapped key envelopes, revision log, dossiers, entitlement cache, email outbox, sweeps) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | encrypted revision blobs (`vault-blobs/`), published dossiers (`publish/`), draft previews (`preview/`) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | the `cairn-sync-monthly` and `cairn-publish-monthly` subscriptions |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit (SMTP) | device approval, invite and Publish warning emails from `Cairn <no-reply@cairn.example>` |
| `APP_PUBLIC_PORT` | server | listen port (default 4173) |
| `APP_PUBLIC_URL` | server | absolute base for email links and sitemaps (default `http://localhost:<port>`) |
| `CAIRN_DEVICE_APPROVAL_TTL_SECONDS` | server | approval link lifetime (default 1800) |
| `CAIRN_INVITE_TTL_SECONDS` | server | invite link lifetime (default 604800) |
| `CAIRN_PREVIEW_TTL_SECONDS` | server | preview link lifetime (default 259200) |
| `CAIRN_IDEMPOTENCY_TTL_SECONDS` | server | how long push and restore keys are kept (default 86400) |
| `CAIRN_SYNC_GRACE_SECONDS` | server | when set, Sync stays writable this long after the period end instead of 7 calendar days |
| `CAIRN_PUBLISH_RETENTION_SECONDS` | server | when set, takedown comes this long after the Publish period end instead of 14 calendar days |
| `CAIRN_PUBLISH_WARNING_LEAD_SECONDS` | server | when set, the warning goes out this long before takedown instead of 3 calendar days |
| `CAIRN_SWEEP_INTERVAL_SECONDS` | server | how often the lapse sweep runs (1 to 60, default 30) |

If MinIO, Kill Bill or SMTP is unreachable the server still starts and stays healthy: storage
actions answer `503 storage_unavailable`, plan changes `503 billing_unavailable` (entitlement
falls back to the last known plan), and emails wait in the outbox for the sweep to retry.
