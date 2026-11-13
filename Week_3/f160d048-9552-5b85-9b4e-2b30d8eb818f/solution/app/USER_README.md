# Candour Bench

Candour Bench is a website where laboratory and biotech bench technicians share anonymous workplace reviews, pay reports and
interview notes, and search and apply for lab jobs. A member's first approved post unlocks the full pay and review detail for
every lab. A pay range appears only once enough approved reports exist that no one person can be picked out. Volunteer
moderators work one shared live queue. Verified employer teams answer reviews in public and move applicants through a hiring
pipeline that candidates can watch change.

It is one TypeScript web server (Node.js 22) that serves the API, the live event stream and the built React client.

## Run it

`run.json` holds the three commands:

- install: `npm ci` (lockfile only)
- build: `npm run build` (Vite builds the client into `dist/client`, esbuild bundles the server into `dist/server.cjs`)
- serve: `node dist/server.cjs` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173)

`GET /api/health` and `GET /health` answer `{"status":"ok"}`, `{"status":"unavailable"}` while Meilisearch or MinIO is
unreachable, and `503 {"status":"starting"}` until PostgreSQL connects. The app applies its schema and seed data idempotently on
every start.

## Services and environment

Every address, credential, timer and limit is read once at start in `src/server/config.ts`. Nothing but `TOAST_SECONDS`,
`MIN_PAY_REPORTS` and `SEARCH_PAGE_SIZE` reaches the browser.

| Service | Used for | Variables |
|---|---|---|
| PostgreSQL | System of record: members, posts, moderation, jobs, applications, channels, outbox, search-sync queue, live event log, server clock | `DATABASE_URL` |
| Meilisearch | Job search and company search (indexes `jobs` and `companies`) | `MEILISEARCH_URL`, `MEILISEARCH_API_KEY` |
| MinIO | Resume PDFs (`resumes/<id>.pdf`) and employer marks (`marks/<company id>.png`) | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit | Every email, sent through an outbox | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `MAILPIT_URL` |

Application: `APP_PUBLIC_URL`, `APP_PUBLIC_PORT`, `GRADING_TOKEN` (the grading routes answer 404 without it), `FOUNDER_EMAIL` and
`FOUNDER_PASSWORD` (create the founder when none exists).

Timers and limits, with defaults: `EDIT_WINDOW_MINUTES` 15, `EMAIL_CODE_TTL_SECONDS` 600, `EMAIL_LINK_TTL_SECONDS` 3600,
`ALERT_BATCH_SECONDS` 300, `MIN_PAY_REPORTS` 5 (2 to 50), `REVIEWS_PER_COMPANY_PER_YEAR` 1, `RESUME_MAX_BYTES` 5242880,
`UPLOAD_RATE_PER_MINUTE` 5, `CLAIM_LAPSE_SECONDS` 600, `APPLY_KEY_TTL_SECONDS` 86400, `LIVE_REPLAY_LIMIT` 500, `TOAST_SECONDS` 5,
`SEARCH_PAGE_SIZE` 20, `OUTBOX_RETRY_SECONDS` 30.

## Layout

- `src/shared/`: reference values, the one error table, field rules and API types used by both sides.
- `src/server/`: `http/` (listener, the single error-precedence pipeline), `domain/` (state machines, derived values, anonymity),
  `services/` (search, storage, SMTP, outbox, live stream), `routes/`.
- `src/client/`: the React single-page client (own router, announcer, toast, live stream), `styles/`, `pages/`, `components/`.
- `public/fonts/`: Literata (OFL-1.1), self-hosted.
