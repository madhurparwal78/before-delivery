# Tinework

Tinework is a public gallery of parametric 3D parts written in Tine, Gimbrel Works' small part language. Visitors open a shared bracket, clip or jig, set its named dimensions while the solid rebuilds in a WebGL viewport, check it against a printer, mill or laser cutter, and share the exact configuration as an address. Authors publish parts, keep immutable revisions, compare two revisions by the material added and removed, replay a revision on the build tape, fork from an operation, restore an earlier revision, download ZIP or TAR archives, and run review rooms until the required reviewers approve.

## Run

`run.json` holds the three commands:

- install: `npm ci`
- build: `npm run build` (type-checks, then bundles the server to `dist/server.mjs` and the browser app to `dist/public`)
- serve: `npm run start` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173)

Node 22 is required. The app creates its schema, seed data and bucket objects on serve.

## Services and environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | every record, Tine source text, idempotency records, event outbox |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | stored solids, thumbnails, sources, archives |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit | verification and invitation mail |
| `VALKEY_URL`, `VALKEY_KEY_PREFIX` | Valkey | live updates between processes, evaluation cancel handles, pre-flight counters, evaluator delay |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | none | listen port and the base of links in mail |
| `EVAL_DEBOUNCE_MS`, `SLOW_EVAL_NOTICE_MS`, `EVAL_TIMEOUT_MS`, `VERIFY_TOKEN_TTL_SECONDS`, `IDEMPOTENCY_TTL_SECONDS`, `OUTBOX_RETENTION_SECONDS` | none | time rules |
| `PREFLIGHT_SIGNED_OUT_LIMIT`, `REQUIRED_APPROVALS`, `COMMENT_MAX_CHARS` | none | business limits |

Only the values in `GET /api/config` reach the browser. Seed users (password `bench-seed-2026`): `ines@gimbrel.test`, `tomasz@gimbrel.test`, `priya@gimbrel.test`.
