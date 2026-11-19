# Switchyard

A service desk for a one-person IT provider: request catalog, incidents and problems, response promises (SLAs) timed in the
organisation's business hours, a service map that shows who an outage takes down, change approval with board votes,
on-call escalation, a visual workflow designer, and promotion of configuration from a test workspace to the live one.
One Node process serves the interface, the JSON API and one live WebSocket channel. Records and configuration live in
Postgres; every file (attachments, imports, exports, configuration set files) lives in S3-compatible storage (MinIO).

## Run it

`run.json` holds the three commands the deployer runs:

```
install: npm ci
build:   npm run build      (bundles the server to dist/server.js and the interface to dist/client)
serve:   node dist/server.js
```

The server binds `0.0.0.0` on port `4173` or `APP_PUBLIC_PORT`. The schema is applied on every start and the seed data is
inserted only when the database is empty. `GET /api/health` answers `{"status":"ok"}` when Postgres and storage are
reachable and `{"status":"unavailable"}` when only storage is down. `docker-compose.yaml` is the provided development
configuration for Postgres and MinIO and is left unchanged.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres connection (system of record) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO / S3 storage |
| `APP_PUBLIC_PORT` | listen port (default 4173) |
| `GRADING_KEY`, `BUSINESS_TIME_ZONE`, `ONCALL_ACK_MINUTES`, `WAIT_STEP_UNIT_SECONDS`, `PRESENCE_TIMEOUT_SECONDS`, `WORKFLOW_LOOP_LIMIT`, `BUSINESS_RULE_DEPTH_LIMIT`, `ASSIGNMENT_CAPACITY`, `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_QUOTA_BYTES`, `WRITE_RATE_LIMIT_PER_MINUTE`, `LOGIN_RATE_LIMIT_PER_MINUTE`, `LIST_PAGE_SIZE`, `LIVE_SETTLE_MS`, `STORAGE_RETRY_SECONDS`, `EXPORT_BATCH_ROWS`, `MAJOR_PROPOSAL_SERVICES`, `MAJOR_PROPOSAL_INCIDENTS` | runtime settings with the defaults documented in the product brief |

Database and storage credentials are read only from the environment, never sent to the browser.

## Accounts (seed)

Sign in with a seeded username; the password is `<username>-yard-2026`. `oona` is the operator, `teodor` and `bastian`
are technicians, `ruth` and `kofi` are requesters, `ana`, `dev` and `jonas` are department approvers, `mae` and `hugo` are
department managers.

## Source map

`src/server` holds the API, the expression interpreter (`src/shared/expression.ts`), the SLA engine, the scheduler and
the storage client; `src/client` holds the React interface; `src/shared` holds code both sides use (screens and roles,
field metadata, the expression language and filter text).
