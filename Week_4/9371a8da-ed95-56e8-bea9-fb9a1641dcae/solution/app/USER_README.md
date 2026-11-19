# Quillwork Labs Marginalia

Marginalia is a shared writing desk for research labs working on LaTeX papers, grant proposals and
dissertations. Each project holds several source files. Suggested edits, comment threads tied to exact
passages, a numbered revision ledger with named labels, and citation checks all live next to the source,
and every person sees and does only what their project role (owner, editor, reviewer, viewer) allows.
Committee members read drafts through an expiring read-only share link.

## Running it

The app runs only through `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` (installs from the lockfile) |
| build | `npm run build` (type-checks, then bundles the server to `dist/server.mjs` and the browser app to `dist/public/`) |
| serve | `npm run start` (foreground; binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

On every serve the app applies its PostgreSQL schema under an advisory lock and writes the seed data into an
empty database only, so several instances may start against one database at once. `GET /api/health`
answers `{"status":"ok"}` as soon as the server listens, whether or not a backing service is reachable;
the app keeps retrying PostgreSQL every few seconds until it connects.

## Services

| Service | What it holds |
|---|---|
| PostgreSQL | workspaces, users, sessions, projects, memberships, every revision of every text file, asset records, suggestions, threads, comments, ledger entries, labels, citation reports, stored save answers, invites, share links, export records and mention emails with their state and next due time |
| MinIO (S3) | uploaded figures and `.bib` originals at `projects/<projectId>/assets/<fileId>`, export zips at `projects/<projectId>/exports/<exportId>.zip` |
| Mailpit (SMTP) | collaborator invitations (sent before the invite is recorded) and @mention notifications (recorded in PostgreSQL with the comment; the posting instance tries at once, then any instance on the database claims a due one only after its own SMTP connection opens, sends it once, and retries failures 10 seconds later) |

Storage and mail calls keep no remembered failure: each call tries the service afresh, so the app recovers
on its own when a service returns.

## Environment

| Variable | Used for | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | required |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO object storage (signed S3 requests) | required (`S3_FORCE_PATH_STYLE` defaults to `true`) |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit | required |
| `MAIL_FROM` | From line of every email | `Marginalia <no-reply@marginalia.test>` |
| `APP_BASE_URL` | origin used in emailed links and share links | `http://localhost:<port>` |
| `APP_PUBLIC_PORT` | listening port | `4173` |
| `INVITE_TTL_SECONDS` | invite lifetime | `604800` |
| `INVITE_WINDOW_SECONDS` | window of the 10-invitation allowance | `3600` |
| `IDEMPOTENCY_TTL_SECONDS` | lifetime of stored save answers | `86400` |
| `MENTION_RETRY_SECONDS` | how long a mention email stays pending before it is dropped | `600` |
| `SHARE_LINK_TTL_SECONDS` | share link lifetime | `2592000` |

All of these are read once at start in `src/server/config.ts`; none is sent to the browser.

## Seeded accounts

| Person | Email | Password |
|---|---|---|
| Ilse Varga (Varga Lab owner) | ilse.varga@varga-lab.test | quill-owner-2026 |
| Noor Haddad | noor.haddad@varga-lab.test | quill-student-2026 |
| Kenji Arai | kenji.arai@partner-uni.test | quill-review-2026 |
| Marta Osei | marta.osei@varga-lab.test | quill-viewer-2026 |
| Sune Lindqvist (Lindqvist Lab owner) | sune.lindqvist@lindqvist-lab.test | quill-other-2026 |
| Ada Moreau | ada.moreau@lindqvist-lab.test | quill-neighbour-2026 |

## Layout of the source

- `src/shared/` — wire shapes and the anchor rules (used by both server and browser).
- `src/server/` — the Node HTTP server: boundary checks and routing (`main.ts`), one module per domain
  area (files, uploads, review, history, citations, exports, members, share links, mail, storage).
- `src/client/` — the Preact browser app.
- `public/fonts/` — self-hosted Newsreader, IBM Plex Sans and IBM Plex Mono.
