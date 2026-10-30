# Orrery Studio

Orrery Studio is a browser workspace where brand and product-marketing teams build interactive 3D scenes,
review them and publish them. Every change is an attributed operation in an append-only log that can be
undone per author, rewound on a timeline and restored. Versions move through review and approval to a
scheduled publish by the server's clock; every embed traces back to an exact saved version. People and
outside agent tokens work under one permission table, one lock per object and one undo model.

## Run it

`run.json` holds the three commands:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly what `package-lock.json` records |
| build | `npm run build` | type-checks every TypeScript source (strict) and bundles `dist/server.js` and the browser app into `dist/public/` |
| serve | `npm run start` | runs `node dist/server.js` in the foreground on `0.0.0.0` |

On every serve the server applies the PostgreSQL schema and the seed (only what is absent), then listens.
It starts while PocketBase, MinIO, Kill Bill or Mailpit is down and sets each up (PocketBase collections,
the Kill Bill catalog, the seeded comment threads) as soon as it answers. `GET /api/health` answers
`{"status":"ok"}` once PostgreSQL is reachable and the schema is applied.

## Environment

| Variable | Service | Used for |
|---|---|---|
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |
| `APP_PUBLIC_URL` | — | links in emails and the accepted `Origin` (default `http://localhost:<port>`) |
| `DATABASE_URL` | PostgreSQL | workspaces, members, sessions, agent tokens, scenes, the operation log, versions, review links, idempotency records, the webhook ledger, the audit trail, the mail outbox |
| `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` | PocketBase | `presence`, `object_locks` and `comments` collections |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | version snapshots and thumbnails, uploaded assets, published payloads, export bundles, invoice PDFs, all under `ws/<workspaceId>/` |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | catalog, one account per workspace, subscriptions, invoices, payments, refunds, chargebacks |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit | invitations, receipts, refunds, dunning notices, schedule and publish notices, token expiry warnings |
| `TRIAL_LENGTH_SECONDS`, `DUNNING_DAY_SECONDS`, `TOKEN_WARNING_LEAD_SECONDS` | — | the trial length, the dunning day and the token warning lead (defaults 1,209,600, 86,400 and 86,400) |

Service credentials are read only from the environment and never reach the browser.

## Seeded sign-in

Two workspaces are seeded: Kestrel Audio (`mara@kestrel.test` owner, `theo@kestrel.test` admin,
`priya@kestrel.test` billing manager, `jun@kestrel.test` and `sol@kestrel.test` editors,
`ines@kestrel.test` viewer) and Fernhall Furniture (`ezra@fernhall.test` owner, `lena@fernhall.test` editor,
`ravi@fernhall.test` viewer). Every seeded member signs in with `orrery-demo-2026`.

## Screens

Public: home (`/`), pricing (`/pricing`), start trial (`/signup`), sign in (`/login`), invitation
(`/invite/<token>`), review copy (`/review/<token>`) and embed (`/embed/<embedId>`). Signed in: dashboard,
scenes and the editor, members, agents, audit, billing and settings under `/app`.
