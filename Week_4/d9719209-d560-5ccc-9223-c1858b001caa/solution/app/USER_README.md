# Moothall

Communities for hobby and interest groups: sign up with an email address, confirm it, join communities, post text and image posts, vote, reply in nested threads that update live, and moderate in public (removals with reasons, locks, pins, a public mod log). A site admin works the illegal-content report queue and suspends accounts.

## Run

`run.json` holds the three commands, run in order from this directory:

1. `npm ci`
2. `npm run build` (type-checks the server and the browser app with `strict`, then bundles the browser app)
3. `npm run start` (listens on `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173; applies the schema and seed on start)

## Services and environment variables

| Service | Variables |
|---|---|
| Postgres (source of truth) | `DATABASE_URL` |
| MinIO / S3 (images) | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit (SMTP) | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Valkey (live events, replay stream, rate counters) | `VALKEY_URL`, `VALKEY_KEY_PREFIX` (default `mh:`) |
| App | `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`, `GRADING_KEY` (enables the grading routes when set) |

Timers and limits, each with its default: `VOTE_RATE_LIMIT` 60, `POST_RATE_LIMIT` 20, `LOGIN_LOCKOUT_ATTEMPTS` 5, `LOGIN_LOCKOUT_SECONDS` 900, `VERIFY_LINK_TTL_SECONDS` 86400, `VERIFY_RESEND_LIMIT` 3, `VERIFY_RESEND_WINDOW_SECONDS` 3600, `RESET_LINK_TTL_SECONDS` 1800, `REPORT_DEADLINE_SECONDS` 86400, `ARCHIVE_AFTER_DAYS` 183, `COMMUNITY_MIN_ACCOUNT_AGE_DAYS` 7, `COMMENT_EDIT_WINDOW_SECONDS` 900, `LOCK_HOUR_SECONDS` 3600, `MOD_2FA_MEMBER_THRESHOLD` 1000, `MAX_IMAGE_BYTES` 20000000.

## Seed

On first start the app seeds three communities (`fieldnotes`, `brasswork`, `quietbuilds`), four accounts and six posts when `fieldnotes` does not exist yet. Seed passwords are listed in the product brief.
