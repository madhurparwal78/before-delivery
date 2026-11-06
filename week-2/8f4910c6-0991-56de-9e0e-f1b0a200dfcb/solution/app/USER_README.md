# Rungboard — Vesper & Rowe Talent

Rungboard is the booking and casting workspace of Vesper & Rowe Talent (an invented agency with offices in
Toronto and Vancouver). One web app with a JSON API:

- **Public site** — boards of talent (`/boards`), profiles, a cast tray and a four-step cast request,
  private casting packages (`/p/<token>`) that a casting director reviews on a phone, the new-face
  application (`/apply`) and the guardian consent page for minors (`/consent/<token>`).
- **Workspace** (`/workspace/...`, email and password) — the availability board where bookers place, rank,
  challenge, release and confirm options; bookings with exact fee lines; usage licences; the paired ledger
  and monthly talent statements; packages; new-face applications; the roster with import, export, withdraw,
  restore and erase; members and invitations, rate cards and office closure dates; each talent's own
  calendar and statements.

## Running it

`run.json` holds the commands the platform runs:

| Step | Command |
|---|---|
| install | `npm ci` (from `package-lock.json`) |
| build | `npm run build` (esbuild bundles `src/server` to `dist/server.mjs` and `src/client` to `dist/public`) |
| serve | `npm run start` (`node dist/server.mjs`, foreground) |

The server listens on `0.0.0.0:4173`, or on `APP_PUBLIC_PORT`. `GET /api/health` answers
`200 {"status":"ok"}` once PostgreSQL is reachable and start-up (schema, seed, seed photos) has finished,
and `503 {"status":"starting"}` before that. Several copies may start together against one database:
start-up takes a PostgreSQL advisory lock, and the sweep and mail delivery claim rows with
`FOR UPDATE SKIP LOCKED`, so each effect happens once.

## Configuration

Every value is read from the environment in `src/server/config.ts` and never sent to the browser.

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL — the system of record (talent, options, bookings, ledger, licences, packages, applications, sessions, idempotency keys, rate-limit counters, mail outbox) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO bucket for photos (`portfolio/…`, `applications/…`), package ZIPs (`packages/<id>/photos.zip`) and statement CSVs (`statements/<talentId>/<YYYY-MM>.csv`) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill — one CAD account per client, draft invoices at confirm, commits at Issue invoice, committed licence renewals, credits for reversed bookings |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Outgoing mail (Mailpit in development); every email passes through the PostgreSQL outbox |
| `APP_BASE_URL` | Optional base for links in emails and feeds; defaults to `http://127.0.0.1:<port>` |
| `APP_PUBLIC_PORT` | Optional listening port (default 4173) |
| `OPTION_CHALLENGE_SECONDS` | Answer window for a challenged 1st option (default 14400) |
| `PACKAGE_LINK_TTL_SECONDS` | Lifetime of a casting package link (default 1209600) |
| `CONSENT_LINK_TTL_SECONDS` | Lifetime of a guardian consent link (default 604800) |
| `SESSION_TTL_SECONDS` | Lifetime of a workspace session (default 28800) |

When Kill Bill or MinIO is unreachable the server still starts and stays healthy; only the actions that
need that service answer `503 billing_unavailable` or `503 storage_unavailable`, and nothing is recorded.

## Seed

On an empty database the app seeds the invented members (password `Rungboard-2027`), the four clients,
twenty talent with three portrait illustrations each, the `2026 standard` rate card, the published office
closure dates, and a few relative records for the screens (options for Ines Okoro, three licences, an
advance and one submitted application).
