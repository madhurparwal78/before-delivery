# Linewright

Linewright is a browser game where players build a stick-figure hero in a live 3D builder (or upload
their own glTF 2.0 humanoid), draw weapons freehand that turn into solid 3D tubes, play a solo story
chapter by chapter, and gather up to three friends for co-op stories. The server checks every upload
against a versioned rulebook, runs every game session on a fixed 20-tick-per-second step, decides every
countdown and keeps realtime streams consistent across dropped connections and restarts. Every screen,
message and email is in English, 日本語 or Español.

## Running it

The commands live in `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` (uses `package-lock.json`) |
| build | `npm run build` (bundles the server and the browser client into `dist/`) |
| serve | `npm run start` (foreground; binds `0.0.0.0` on `APP_PUBLIC_PORT`) |

`GET /api/health` answers `{"status":"ok"}` once Postgres is reachable. The app starts and stays healthy
while mail or object storage is down, and recovers without a restart when they come back.

## Configuration

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | Postgres | system of record; tables and seed data are created at every start if missing |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | uploaded model originals and thumbnails under `models/<account id>/<model id>/` |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP, no auth) | verification and password-reset emails |
| `APP_PUBLIC_URL` | — | links in emails and the same-origin check |
| `APP_PUBLIC_PORT` | — | listening port (default 4173) |
| `REJOIN_GRACE_SECONDS` | — | rejoin grace after a dropped co-op connection (default 120) |
| `MAIL_LINK_TTL_SECONDS` | — | lifetime of email links (default 1800) |

Secrets are read at start and never sent to the browser.

## Seed accounts

Eight verified, mutually friendly accounts (`aiko@linewright.test` … `haru@linewright.test`, passwords
`paper-lantern-01` … `paper-lantern-08`) are inserted on first start, each with one equipped hero.
