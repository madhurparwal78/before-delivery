# Corbel Draft

Corbel Draft is a browser-based 2D drafting and drawing-review app. A drafter draws plans from a command
line (aliases, typed coordinates, object snaps, layers, blocks, text, dimensions), keeps drawings in a cloud
file browser, issues PDF and DXF sheets, and shares capability links. Reviewers open a link on a laptop or
phone, measure the live drawing and mark it up on a trace overlay that never touches the base geometry.

It is one TypeScript service (Node 22) that serves the built web app and its JSON API on a single origin.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, then bundles the server to `dist/server.js` and the web app to `dist/client`) |
| serve | `node dist/server.js` (foreground; binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

`GET /api/health` answers `{"status":"ok"}` when all four providers answer and `{"status":"unavailable"}`
otherwise. The app starts and serves pages with any of Valkey, MinIO or Mailpit unreachable, retries each
every few seconds and recovers without a restart.

## Providers and environment

| Provider | Used for | Variables |
|---|---|---|
| Postgres | accounts, drawings, objects, layers, versions, traces, issues, share links, exports, templates | `DATABASE_URL` |
| MinIO (S3) | uploaded DXF files and every exported PDF and DXF | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit (SMTP) | confirmation, invite, quote and trace-submitted email | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Valkey | live sync and presence | `VALKEY_URL` |

Other settings: `APP_PUBLIC_URL` (links in email; falls back to `http://localhost:<port>`), `APP_PUBLIC_PORT`,
`CORBEL_GRADING` (`off` disables the grading routes), and the limits `VERIFY_LINK_SECONDS` (86400),
`SIGNIN_MAX_FAILURES` (5), `SIGNIN_LOCK_SECONDS` (900), `INVITE_COOLDOWN_SECONDS` (60),
`PRESENCE_IDLE_SECONDS` (120), `UPLOAD_MAX_BYTES` (5000000), `TRIAL_DAYS` (30).

No credential is hard-coded or sent to the browser. The app keeps no state on the local file system.
