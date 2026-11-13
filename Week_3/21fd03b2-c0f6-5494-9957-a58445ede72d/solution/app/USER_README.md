# Rampwright

Rampwright is a browser workspace for independent physics tutors. Tutors build 3D physics scenes in
real SI units (ramps, pendulums, launchers, crates and imported GLB/glTF models), run them on a
deterministic fixed-step bench (1/120 s per step, identical state hash on every device and on the
server), save checkpoints, and publish a scene as a public lab that students open without an
account. Co-tutors edit the same scene at once with presence, live cursors and object locks;
viewers and read-only project links can read and run scenes but never change them.

## Run it

`run.json` holds the commands:

- install: `npm ci`
- build: `npm run build` (type-checks, builds the browser bundle and the server bundle into `dist/`)
- serve: `npm run serve` (foreground; binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173)

One process serves the API (`/api`), the built frontend and the public pages. `GET /api/health`
answers 200 even when a backing service is down; `GET /api/status` reports `locks`, `storage` and
`mail`.

## Environment

| Variable | Service / use |
|---|---|
| `DATABASE_URL` | Postgres: accounts, workspaces, projects, scenes, revisions, checkpoints, activity, links, labs, mail outbox |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: asset originals, checkpoint snapshots, lab bundles |
| `VALKEY_URL` | Valkey: presence, live cursors, object-lock leases |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP): invite, role-change, share and publish emails |
| `APP_PUBLIC_URL` | origin used in every emailed and displayed link |
| `APP_PUBLIC_PORT` | listening port (default 4173) |
| `LOCK_TTL_SECONDS`, `PRESENCE_TTL_SECONDS`, `INVITE_TTL_SECONDS`, `SHARE_LINK_TTL_SECONDS` | lease, presence, invite and read-only link lifetimes (defaults 30, 20, 604800, 2592000) |

The app keeps no state anywhere else. The schema is applied idempotently and the seed accounts are
created once on every serve.
