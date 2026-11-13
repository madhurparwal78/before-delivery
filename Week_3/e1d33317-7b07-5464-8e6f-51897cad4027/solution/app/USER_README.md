# Fairline

Fairline is a browser workspace for preparing orchestral scores. A composer, a freelance copyist and section
players edit one score live; notes typed by different people merge without locks. Every system break comes from
the server's engraving (Bravura glyphs in server-made SVG). Each instrument's part can be extracted as a print
PDF, and the composer can hear the score with their own sample banks.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, builds the browser app with Vite and bundles the server with esbuild) |
| serve | `npm run start` (`node dist/server.mjs`, foreground, binds `0.0.0.0`) |

The app serves the browser app, the API and the live WebSocket from one origin on `APP_PUBLIC_PORT` (default 4173).
`GET /api/health` answers `{"status":"ok"}` as soon as the server listens, even while MinIO, Valkey or Gotenberg
are unreachable. Open `/s/<seatToken>` to join a score; the seed score `sc-tidewater` has its seat links in the brief.

## Environment

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | Postgres | operation log, snapshots, collaborators, holds, parts, banks, operation throttle counts |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | sample banks, engraved part pages, PDF parts |
| `VALKEY_URL` | Valkey | live broadcasts and the presence hash |
| `GOTENBERG_URL` | Gotenberg | turns engraved part pages into PDFs |
| `APP_PUBLIC_PORT` | n/a | listen port (default 4173) |
| `AWARENESS_TTL_SECONDS` | n/a | presence window (default 15) |
| `PDF_RETRY_SECONDS` | n/a | retry interval for parts waiting on the renderer (default 30) |

No value is written into source or sent to the browser.

## Layout

- `src/shared`: notation arithmetic, the replicated voice model, the text allowlist and wire types (server and browser).
- `src/server`: HTTP boundary, routes, operation recording, holds, presence, parts, banks, engraver.
- `src/client`: React workspace, keyboard editor, WebGL Helix view, Web Audio playback.
