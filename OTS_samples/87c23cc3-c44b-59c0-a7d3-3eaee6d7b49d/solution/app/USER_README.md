# Pinewick Labs Joinery

Joinery is a schema design studio where the text comes first. You write tables in Mortise, a small text language, and an
entity diagram builds itself next to the text. Drawing a link on the diagram types one matching line into the text and leaves
every other character as it was. Joinery exports PostgreSQL or MySQL DDL that is identical byte for byte each time, imports
existing DDL with a per-statement report, keeps numbered versions, and lets several people edit one schema live through
view and edit links that the owner can take back at any time.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks in strict mode, then bundles the server and the browser app with esbuild) |
| serve | `npm run start` (`node dist/server.js`, in the foreground on `0.0.0.0` and `APP_PUBLIC_PORT`, default 4173) |

One server process serves the built frontend, the API and the WebSocket live channel. It needs Node 22.

## Services and environment

The server reads every setting from the environment in `src/server/config.ts`. Nothing is hard-coded and no credential is sent to
the browser; the page receives only the parse delay, the time zone name, the signed-in person and the service status.

| Service | Used for | Variables |
|---|---|---|
| PostgreSQL | accounts, sessions, sign-in codes, projects, the server-ordered edit log, layouts, versions, shares, memberships, export and import records | `DATABASE_URL` |
| MinIO (S3, path style when `S3_FORCE_PATH_STYLE=true`) | exported DDL files (`exports/<project>/<id>-<dialect>.sql`) and the original bytes of imported DDL (`imports/<project>/<id>.sql`) | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit (plain SMTP) | sign-in codes and share invitations | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |

Other variables: `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` (used in invitation links; defaults to `http://localhost:<port>`),
`JOINERY_GRADING_KEY` (empty disables the setup route), `JOINERY_PARSE_DELAY_MS` (150), `JOINERY_LIVE_MAX_DELAY_MS` (1000),
`JOINERY_PRESENCE_TIMEOUT_SECONDS` (30), `JOINERY_CODE_TTL_SECONDS` (600), `JOINERY_SHARE_TTL_SECONDS` (604800),
`JOINERY_EXPORT_LINK_TTL_SECONDS` (300), `JOINERY_EXPORT_RATE_LIMIT` (10), `JOINERY_TEXT_LIMIT_BYTES` (200000),
`JOINERY_ENTITY_LIMIT` (200), `JOINERY_STATEMENT_LIMIT` (1000), `JOINERY_NESTING_LIMIT` (32), `JOINERY_TIME_ZONE` (UTC).

If PostgreSQL, MinIO or Mailpit is down at boot or later, the server keeps serving. Health answers `{"status":"unavailable"}` and
the status strip names what is paused; the schema is applied again, and storage and mail work again, as soon as the service
returns, without a restart.

## Layout of the source

| Folder | Holds |
|---|---|
| `src/shared` | the rules both sides use: the Mortise parser and messages, canonical printing, next-free-cell placement, unit merging, export lowering, time formatting, templates |
| `src/server` | HTTP routes, PostgreSQL, object storage (signed requests), SMTP, the live channel, the DDL importer |
| `src/client` | React pages, the project store (edit sync, live channel), the code editor, the diagram, dialogs and panels |
| `fonts` | self-hosted Noto Sans and JetBrains Mono (OFL-1.1) |
