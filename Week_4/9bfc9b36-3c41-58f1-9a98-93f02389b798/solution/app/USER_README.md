# Boltrope

A loft workbench for one sailmaker. Boltrope turns the rig figures a yacht owner measures with a tape into a sail drawing, computes the drawing's areas and crosscut panel geometry on the server, nests the panels onto real rolls and offcuts of sailcloth (one mill lot per sail), keeps a paired cloth ledger that always equals the shelf, keeps a sail account in exact pence, and issues a stored cut sheet that the sailmaker can let an owner see and later withdraw.

Three roles use it: the sailmaker (`/loft`), the loft hand (`/floor`) and the yacht owner (`/owner`).

## Run it

`run.json` holds the three commands:

- install: `npm ci`
- build: `npm run build` (type-checks the server and the browser source with strict settings, then bundles both)
- serve: `node dist/server.js` (foreground; binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173)

`GET /api/health` answers 200 `{"status":"ok"}` once Postgres and Keycloak answer. The schema and the seed are applied on serve, exactly once per database, under a database-wide lock, so several instances may start together on one empty database.

## Services and environment variables

| Service | Variables | What it holds |
|---|---|---|
| Postgres | `DATABASE_URL` | the system of record: accounts, boats, measurements, drawings, stock, claims, ledger (`ledger_line`), audit (`audit_trail`), rate counts, idempotency records |
| Keycloak | `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | realm users and the three realm roles; the app signs users in with the password grant and checks bearer tokens against the realm keys |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | cut sheets (`cut-sheets/<drawing>/<sha256>.svg`) and tape photographs (`tape-photos/<boat>/<measurement>/<sha256>.jpg|png`) |

Product settings, all optional: `CLAIM_HOLD_SECONDS` (1200), `OWNER_SUBMISSION_LIMIT` (10), `OWNER_SHEET_FETCH_LIMIT` (30), `OWNER_RATE_WINDOW_SECONDS` (3600), `APP_PUBLIC_PORT` (4173).

The browser never talks to a service directly: every call goes to this server's same-origin `/api`.

## Where things live

- `src/shared`: unit conversion and rounding, the area formulae, crosscut panel construction, overlap and first-fit, all published copy, route patterns and wire types.
- `src/server`: the HTTP pipeline, the endpoint table, the domain modules, the schema and the seed.
- `src/client`: the React single-page app and its stylesheet.
- `public/fonts`: Red Hat Display and Red Hat Text (SIL OFL 1.1), self-hosted.
