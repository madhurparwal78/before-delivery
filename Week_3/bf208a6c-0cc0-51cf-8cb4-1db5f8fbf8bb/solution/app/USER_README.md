# Pinsheet

Pinsheet is a self-hosted live post board service. An owner builds a board laid out in columns or rows. Members add posts (a title, some text and an optional image or file); everyone on the board sees new posts, moves, likes, votes and comments live. The owner decides who can read the board, invites contributors and moderators by email, can hold posts for approval, shares a read-only embed, presents a slideshow and exports CSV.

Records live in Postgres and attachments in MinIO. Sign-up codes and invites go out over SMTP; moderator pushes go through ntfy.

## Run it

`run.json` holds the three commands, run in this order from the app folder:

1. `npm ci` (install from `package-lock.json`)
2. `npm run build` (type-checks, bundles the server to `dist/server.js` and the interface to `dist/public`)
3. `npm run start` (serves on `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173)

`GET /api/health` answers `{"status":"ok"}` when Postgres, storage, mail and push all answer, and `{"status":"unavailable"}` when storage, mail or push does not. The app starts even when those three are unreachable; it waits for Postgres, retrying every second.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | all records, the event log |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | attachments under `boards/<board id>/posts/<post id>/<attachment id>` |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP) | sign-up codes and invites |
| `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD` | ntfy | one push per held post, topic `pinsheet-approvals-<board id>` |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | the app | listening port (default 4173); `APP_PUBLIC_URL` is required and is the base for links in mail |
| `GRADING_KEY` | the app | enables `POST /api/grading/fixture` when set; without it the route answers 404 |
| `UPLOAD_MAX_BYTES` | the app | largest attachment (default 5000000) |
| `VERIFY_CODE_TTL_SECONDS` | the app | sign-up code lifetime (default 900) |
| `INVITE_TTL_SECONDS` | the app | invite lifetime (default 604800) |

Nothing is hard-coded: every service URL and credential is read from the environment at start and never sent to the browser.

## Demo data

At start the app makes sure the demo account `demo@pinsheet.test` (password `pinsheet-demo-1`) and its public board `Field day` exist; running it again changes nothing. The landing page shows that board's twelve frames.
