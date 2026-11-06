# Plinth by Oarlock Works

Plinth is a collaborative visual website builder. Everyone in a workspace edits the same page
live: they place components on the canvas and in the Navigator, style them with design tokens and
breakpoint overrides, reuse shared components, bind one content collection, upload images,
comment, restore earlier versions and publish pages as fixed snapshots to a public address. The
Cascade Fan (press `F` with an element selected) shows which style values are set on Desktop,
inherited by Tablet and Phone, or overridden there.

## Running it

`run.json` holds the three commands:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly what `package-lock.json` pins |
| build | `npm run build` | type-checks, bundles the server to `dist/server.js` and the browser client to `dist/public/` |
| serve | `node dist/server.js` | one process in the foreground: API, WebSocket, editor, fonts and public pages on one port |

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (4173 when unset), applies its database schema
on every start, and answers `GET /api/health` with `{"status":"ok"}`. If Postgres is
unreachable it retries for 60 seconds, then exits non-zero. If MinIO or Mailpit is unreachable it
starts normally; uploads and publishing then answer `storage_unavailable` and invitations
`mail_unavailable`.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | every stored record: accounts, sessions, workspaces, documents, operations, undo stacks, versions, comments, images, publish records, idempotency keys | Postgres |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | uploaded images (`images/<workspaceId>/<imageId>`), snapshots (`snapshots/<pageId>/<publishId>.html`) and their copied images; the bucket must already exist | MinIO |
| `SMTP_HOST`, `SMTP_PORT` | invitation and mention mail | Mailpit (SMTP) |
| `MAIL_FROM` | the From line, `Plinth <hello@plinth.test>` | Mailpit |
| `APP_PUBLIC_URL` | the origin in mail links and live addresses (default `http://localhost:<port>`) | — |
| `APP_PUBLIC_PORT` | listening port (default 4173) | — |
| `GRADING_ROUTES` | `on` enables `/api/grading/seed` and `/api/grading/storage-outage`; anything else answers 404 | — |
| `PRESENCE_TIMEOUT_MS` | how long a live connection may go without a heartbeat before it leaves presence (default 30000); the server pings every second | — |

`MAILPIT_URL` belongs to Mailpit's web API; Plinth only speaks SMTP to Mailpit and does not read it.
No credential is ever sent to the browser, and the browser loads nothing from another origin.

## Using it

1. Sign up at `/signup`, create a workspace and land in the editor on its `Home` page.
2. Press `A` (or `Add`) to insert components, drag them from the Add menu onto the canvas, and
   reorder them in the Navigator with Alt+Arrow keys. F2 renames, Ctrl+D duplicates, Delete asks
   first, Ctrl+Z / Ctrl+Shift+Z undo and redo your own changes.
3. Choose a breakpoint (Alt+1/2/3) and edit style rows; Tablet and Phone inherit from above until
   they hold their own override. `F` opens the Cascade Fan.
4. Share invites people by email as editors or viewers. Viewers comment (`M`) and resolve their
   own threads.
5. Publish writes a snapshot to `/p/<workspace>/<page>`; later edits show as
   `Live, with unpublished changes` until you publish again.
