# Furrowbook by Tilth & Tally

Furrowbook is an offline-first spreadsheet workbook for crop field-trial stations. Field technicians
record plot readings in a familiar grid, even with no signal: every edit is kept in the browser and
synced, exactly once, to one ordered record of edits on the server. Clashing edits become named
conflicts in each member's conflict tray. The server works out every computed value from that
record, with the same formula engine the browser uses. Trial leads build analysis sheets and charts,
import last season's `.xlsx` or `.csv`, and close seasons on a cutoff in station time. Data managers
manage members, save and restore versions, export clean `.xlsx` and `.csv` files, and share
read-only, expiring links with sponsors.

## Running it

The app is started only through `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (server with `tsc`, browser app with Vite into `dist/client`) |
| serve | `npm run start` (one Node.js 22 process on `0.0.0.0:$APP_PUBLIC_PORT`, default 4173) |

On every serve the server waits for PostgreSQL (retrying every 2 seconds), applies its schema and the
seed data idempotently, then listens. `GET /api/health` answers `{"status":"ok"}` from then on, whether
or not object storage or mail are up. Several instances may run against the same services.

## Environment

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | stations, members, sessions, invites, workbooks, the op record, request keys, conflicts, versions, exports, share links, the mail queue |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible object storage (MinIO) | import originals, version snapshots, export files (bucket must already exist) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP mail sink | invites, export-ready notices, season-closed notices |
| `APP_PUBLIC_PORT` | — | the port to listen on |

All of them are read once at start in `src/server/config.ts`; none reaches the browser.

## Seed accounts

Every seeded member's password is `tally-field-2026`: Priya Raman (data manager), Tomás Herrera (trial
lead), Dana Okafor and Lee Vance (technicians) and Sam Ito (viewer) at Ridgeback Research Station;
Wren Castillo, Noor Haddad and Jo Mbeki at Coldwater Extension Farm.

## Outages

With object storage down, sign-in, editing and sync keep working; imports, versions, restores and
downloads answer 503, and exports wait and finish on their own when storage returns. With mail down,
messages stay queued and send within 30 seconds of mail returning. A banner under the top bar says
what is affected.
