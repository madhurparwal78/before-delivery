# Quarkyard

Hollowbrook Maker Co. Quarkyard is a browser maker studio for one-person after-school STEM businesses. An Educator runs
classrooms; children join with a class code and a nickname (no email, no password) and build in three editors:

- **3D Workshop**: solid and hole shapes, grouping, align, workplane, undo, printable STL/OBJ/SVG exports.
- **Circuit Bench**: batteries, LEDs, resistors and switches with a live simulation and SVG wiring-diagram export.
- **Block Lab**: block programs that build 3D objects, stepped one block at a time.

The instructor watches every Student's work live from a roster, follows one child in the docked **Glancet** viewer, hands in
the classroom at the server's hand-in time, and downloads hand-in files. Personal makers use the editors at home with a
verified email. All rendering, solid/hole geometry, circuit solving, block running and file building happen in the browser.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, builds the client with Vite and bundles the server with esbuild into `dist/`) |
| serve | `node dist/server.js` (foreground; listens on `0.0.0.0` at `APP_PUBLIC_PORT`, default 4173) |

Schema creation runs on every start and is safe to repeat.

## Environment variables (read once at start)

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | accounts, sessions, classrooms, rosters, projects, revisions, exports, idempotency keys, join attempts | Postgres |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | project snapshots (`projects/<id>/rev-<n>.json`) and export files (`exports/<owner>/<export>/<file>`) | MinIO |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | verification emails | Mailpit |
| `APP_PUBLIC_PORT` | listening port (default 4173) | |
| `APP_PUBLIC_URL` | origin used in emailed links and the same-origin check | |
| `GRADING_TOKEN` | token for the grading seed, session and clock routes (default `qy-grading-local`) | |
| `QY_AUTOSAVE_MS` 1500, `QY_BLOCKS_STEP_MS` 400, `QY_SIM_TICK_MS` 100, `QY_TOAST_MS` 4000, `QY_GLANCET_FADE_MS` 150 | timers served to the browser by `GET /api/config` | |
| `QY_JOIN_RATE_LIMIT` 5, `QY_VERIFY_TTL_SECONDS` 86400 | join-code attempt limit per minute; verification link lifetime | |

No credential, token or address except the five timer values is ever sent to the browser.

## Notes

- `GET /api/health` answers `{"status":"ok"}` when Postgres and storage both answer within 2 seconds.
- Third-party packages and the vendored Manifold geometry library are listed in `THIRD_PARTY_NOTICES.md`.
