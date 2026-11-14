# Nightform

Nightform, by Mothlight Works, is an online form builder for people who collect sign-ups, orders, applications and feedback on their own.
Owners build multi-page forms with branching, calculated fields written in a small published formula language, earlier answers inserted
into later wording and checks that compare one answer with another. A Lit path view shows which pages and questions a respondent with given
trial answers will see. Respondents fill forms on a phone, tablet or desktop, fix errors from a linked summary, save part-way and resume on
another device from an emailed link, and get an email copy of what they sent. Owners publish numbered editions, set a closing time and a
response limit, edit drafts live with invited co-editors, watch a live summary and export CSV.

One logic engine on the server decides visibility, page order, calculated values, insertions, checks, closing and limits; the browser only
shows what the server sends.

## Run

`run.json` holds the three commands:

    npm ci
    npm run build
    npm run start        # serves on 0.0.0.0:$APP_PUBLIC_PORT (default 4173)

`GET /api/health` answers `{"status":"ok"}` as soon as the process runs; `GET /api/services` reports Postgres, Valkey, MinIO and Mailpit as up or down.
An unreachable Valkey, MinIO or Mailpit never stops the app; an unreachable Postgres is retried until it answers.

## Services (the app uses these four and nothing else)

| Service | What it holds | Variables |
|---|---|---|
| Postgres | accounts, sessions, forms, drafts, numbered editions, responses, tokens, idempotency records, the response-limit row, the grading clock, export records, the durable mail outbox | `DATABASE_URL` |
| Valkey | the per-form change sequence, live fan-out and presence, rate-limit counters | `VALKEY_URL` |
| MinIO | file answers and CSV exports | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit | every email (resume link, email copy, invitation) | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |

## Other environment variables

| Variable | Meaning |
|---|---|
| `APP_PUBLIC_PORT` | port to listen on (default 4173) |
| `APP_BASE_URL` | origin used in emailed links; falls back to `APP_PUBLIC_URL`, then `http://localhost:<port>` |
| `APP_TZ` | time zone for every server time rule and display |
| `GRADING_KEY` | enables the published grading routes (`/api/grading/seed`, `/api/grading/clock`); unset means they answer 404 |
| `RESUME_TTL_HOURS` | resume window in hours after the last save |
| `INVITE_TTL_HOURS` | invitation link lifetime in hours |
| `SHUFFLE_SEED` | seed of the shuffled option order |
| `UPLOAD_MAX_BYTES` | largest allowed file in bytes (inclusive) |
| `RESUME_EMAIL_PER_HOUR` | resume emails per IP per clock hour |
| `SUBMIT_PER_MINUTE` | submits per IP per clock minute |
| `FORMULA_MAX_CHARS` | longest allowed formula in characters (inclusive) |
| `FORMULA_MAX_DEPTH` | deepest allowed bracket nesting (inclusive) |
| `EXPORT_LINK_TTL_MINUTES` | export link lifetime in minutes |

Every value is read once at start (`src/server/config.ts`) and none is sent to the browser. Live updates use the one WebSocket at `/ws` on the same port.
