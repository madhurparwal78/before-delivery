# Plainwork

A professional network for people who work for a living. Members keep a profile, grow a network by request and acceptance,
post to a home feed, react, comment and repost, message their connections live, endorse skills and apply to jobs whose
hiring stages are published. Recruiters and company page admins run company pages and move applications through their
stages. Nothing is ranked: every order is a published rule. The viewer's degree to a person is the largest thing on that
person's profile.

## Run

`run.json` holds the commands:

- install: `npm ci`
- build: `npm run build` (compiles the TypeScript server with `tsc` and the React client with Vite)
- serve: `npm run start` (`node dist/server/index.js`, in the foreground)

The server binds `0.0.0.0` on `APP_PUBLIC_PORT`, else `PORT`, else 4173. It applies the schema at every start, creates the
demo data on first start against an empty database, and serves the API, the live event stream (`GET /api/live`) and the client.

## Environment

| Variable | Service / use |
|---|---|
| `DATABASE_URL` | PostgreSQL: every record and the business clock |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: profile photos, post photos, PDF resumes |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit: sign-up code, connection and message notices |
| `GRADING_KEY` | secret for the `/api/grading/*` routes (none set: they answer 404) |
| `APP_PUBLIC_PORT`, `PORT` | listening port |
| `PLAINWORK_START_AT` | business clock start (ISO 8601 UTC; default real time) |
| `PLAINWORK_TIME_ZONE` | IANA zone for shown dates (default `UTC`) |
| `PLAINWORK_INVITE_COOLDOWN_SECONDS` | wait after a withdrawn request (default 1814400) |
| `PLAINWORK_WEEKLY_INVITES` | requests per 604,800 seconds (default 100) |
| `PLAINWORK_POST_MAX_CHARS` | post limit in code points (default 3000) |
| `PLAINWORK_SEE_MORE_CHARS` | see-more cut (default 210) |
| `PLAINWORK_EDIT_WINDOW_SECONDS` | post edit window (default 3600) |
| `PLAINWORK_TYPING_TIMEOUT_MS` | typing status lifetime (default 5000) |
| `PLAINWORK_MAX_SKILLS` | skills per profile (default 50) |
| `PLAINWORK_PHOTO_MAX_BYTES` | photo upload limit (default 5000000) |
| `PLAINWORK_RESUME_MAX_BYTES` | resume upload limit (default 2000000) |
| `PLAINWORK_FEED_PAGE_SIZE` | feed entries per page (default 10) |

The browser learns only the published limits, time zone and clock instant, from `GET /api/config`. Fonts (Funnel Display and
Funnel Sans, SIL OFL 1.1) are bundled files; the page makes requests to its own origin only.

## Demo members

Ines Okafor-Vale (`ines@demo.plainwork.example`), Theo Marchetti, Priya Dunmore and Wen Halloran, all with the shared
demo password published in the product brief's seed-data section.
