# Quillmoor Reserve

A permissioned money market for a small protocol operations team. Each listed asset (QUSD, MBTC, METH) has one
single-sided liquidity pool that funds swaps at posted prices, variable-rate borrowing and collateralised lending with
liquidations. Every movement settles on one internal double-entry ledger in exact integer minor units. Prices come from
an external price oracle that the server polls; a risk steward can override it with a manual post.

Members choose who they act as (no passwords): risk steward, liquidity provider, borrower, trader or liquidator. The
browser opens a bearer-token session through `POST /api/sessions` and keeps the token in local storage. Open any view
with `?actor=<actor_id>`, for example `/steward?actor=stw-ines`; the parameter is removed from the URL once the session
is open.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci --include=dev` (the build needs TypeScript and Vite) |
| build | `npm run build` (type-checks server and browser with strict TypeScript, bundles the browser app) |
| serve | `node dist/server/server/main.js` (foreground, binds `0.0.0.0`) |

Node.js 22 LTS. On first start against an empty database the server applies the schema and seed exactly once, even when
several servers start together; `GET /api/health` answers `{"status":"ok"}` once Postgres is reachable and the schema
is applied, and `503 {"status":"starting"}` while it retries every 2 seconds.

## Services

| Service | What it does here |
|---|---|
| Postgres | the system of record: ledger, pools, positions, prices, sessions, retry keys, the notice queue, the event outbox and the PDF render queue; also settles every contest between server processes |
| MinIO | settlement statements (`statements/<kind>/<id>.json`, `.txt`, `.pdf`) and price evidence (`evidence/prices/<id>.json`); the bucket is created when missing |
| Mailpit | margin and liquidation notices over SMTP |
| WireMock | the invented third-party price oracle, polled for every asset |
| Svix | integrator webhooks: one message per settlement and position state change, application `quillmoor-reserve` |
| Gotenberg | renders each statement to PDF |

## Environment

| Variable | Used for | Required |
|---|---|---|
| `DATABASE_URL` | Postgres connection | yes |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | yes |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit and the From line of every notice | yes |
| `WIREMOCK_URL` | base URL of the price oracle | yes |
| `ORACLE_PATH_PREFIX` | path prefix of this instance's feeds, for example `/short` | no (empty) |
| `ORACLE_POLL_SECONDS` | oracle poll interval | no (2) |
| `SVIX_URL`, `SVIX_API_KEY` | Svix server and token | yes |
| `GOTENBERG_URL` | PDF renderer | yes |
| `DESK_TIME_ZONE` | IANA zone of the desk | no (`America/St_Johns`) |
| `GRACE_SECONDS` | grace period before liquidation | no (300) |
| `STALENESS_SECONDS` | price staleness limit | no (3600) |
| `QUOTE_TTL_SECONDS` | firm quote lifetime | no (30) |
| `APP_PUBLIC_PORT` | listening port | no (4173) |

Every value is read once at start in `src/server/config.ts` and never sent to the browser. A missing required variable
(or an invalid zone or seconds value) stops the server with a message naming it.

## Outages

- Object storage unreachable: draws, liquidity withdrawals, liquidations and manual price posts are refused with
  `statement_store_unavailable` and nothing changes; oracle readings read `evidence_unavailable`; receipts read Pending
  statement; everything else works.
- Mail unreachable: notices stay queued (the position page says so) and are delivered once mail returns.
- PDF renderer unreachable: settlements still commit and read Pending statement; the render stays queued and any
  process renders it once.
- Svix unreachable: events stay on the outbox and receipts read Webhook queued; they are sent in order afterwards.
- Oracle unreachable, slow, malformed, behind or moving more than 60%: the last good price holds and the price rail
  shows the matching line.
- Database unreachable: requests answer 503 `ledger_unavailable`; the server reconnects by itself.
