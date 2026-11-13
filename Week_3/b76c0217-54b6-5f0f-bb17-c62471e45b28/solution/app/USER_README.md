# Galley

Galley, from Sorts & Quoins, is a hosted documentation platform for small software teams. A team writes markdown pages
that can use six components, arranges them in a sidebar of tabs and groups, imports an OpenAPI file to generate API
reference pages, previews drafts, and publishes a public docs site. Publishing is refused while an internal link, an
anchor or a component is broken. Renaming a page files one redirect and rewrites the links that point to the page.

One TypeScript app serves the signed-in editor (`/app`) and the public reader site (`/docs/<site>`) on one port.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, then bundles the server to `dist/server.js` and the browser code to `dist/public`) |
| serve | `node dist/server.js` (foreground, binds `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173) |

`GET /api/health` answers `{"status":"ok"}` once the server is listening. If Postgres is unreachable at start the server
retries for 60 seconds and then exits with a non-zero status. MinIO and Mailpit may be down at start: the app starts and
shows the outage behaviour.

On first start, when the database has no teams, the app creates the demo workspace: team `Quire Labs`, site `quire`
(versions `v1` and `v2`), and the three people `ines@quire.test`, `dara@quire.test` and `lev@quire.test` (owner, editor
and viewer). The demo versions are published when file storage is reachable.

## Services and environment variables

All configuration is read once, in `src/server/config.ts`. Nothing is sent to the browser.

| Service | Variables |
|---|---|
| Postgres (everything Galley keeps) | `DATABASE_URL` |
| MinIO (published snapshots, imported OpenAPI files exactly as uploaded, uploaded images) | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit (team invite mail, over SMTP) | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| App | `APP_PUBLIC_PORT` (default 4173), `APP_PUBLIC_URL` (origin used in mailed links), `GRADING_ROUTES` (`on` enables the seed and outage routes; anything else leaves them not found) |
| Timers (milliseconds) | `INVITE_TTL_MS` (604800000), `MAIL_RETRY_MS` (60000), `PREVIEW_LINK_TTL_MS` (259200000), `PRESENCE_TIMEOUT_MS` (30000) |

`MAILPIT_URL` is provisioned next to the SMTP settings but the app only sends mail over SMTP, so it does not read it.

## What is where

- `src/server/domain/` holds the rules, each in one place: `markdown.ts` (page source and the six components),
  `render.ts`, `gate.ts` (publish problems and their order), `redirects.ts` (collapse, loops, rewrites), `publish.ts`
  (status transitions, idempotency, concurrency), `search.ts`, `analytics.ts`, `openapi.ts`.
- `src/server/http.ts` is the one request pipeline: body limits and media types, authentication, resource lookup, role,
  origin rule, then the handler; every failure is rendered by `errors.ts` in the one error shape.
- `src/client/reader/` enhances the server-rendered reader page; `src/client/app/` is the editor (Preact).
- Fonts (Source Serif 4, IBM Plex Sans, IBM Plex Mono; SIL OFL 1.1) are files in `assets/fonts`, served locally.
