# Pennywasher Works

Community repair guides built on uploaded 3D models. Readers scroll a repair while the model comes apart step by step and the parts cost counts up. Authors bind named parts to a binary glTF (.glb) file, write numbered steps, keep versions, co-edit live and answer questions. Forkers adapt a public guide and keep credit; embedders place one guide on their own page.

## Run

`run.json` holds the commands: `npm ci`, `npm run build`, `npm run serve`. The server listens on `0.0.0.0` and `APP_PUBLIC_PORT` (default 4173). `GET /api/health` is the health path.

## Environment

| Variable | Service or meaning |
|---|---|
| `DATABASE_URL` | Postgres: every record and search |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: model files at `models/<modelId>.glb` |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit: the confirmation message |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | port and the public origin used in the confirmation link |
| `GRADING_ROUTES` | `on` enables `POST /api/grading/world` |
| `MODEL_MAX_BYTES`, `MODEL_MAX_PARTS` | upload limits (20000000, 64) |
| `QUESTION_LIMIT`, `QUESTION_WINDOW_SECONDS`, `SIGNIN_LIMIT`, `SIGNIN_WINDOW_SECONDS`, `RESEND_LIMIT`, `RESEND_WINDOW_SECONDS` | rate limits |
| `CONFIRM_TOKEN_TTL_SECONDS`, `PRESENCE_GRACE_SECONDS` | confirmation token life, presence grace |
| `GUIDE_TITLE_MAX`, `STEP_TITLE_MAX`, `STEP_TEXT_MAX`, `CALLOUT_TEXT_MAX`, `PART_NAME_MAX`, `QUESTION_TEXT_MAX`, `ANSWER_TEXT_MAX`, `TAG_TEXT_MAX`, `GUIDE_TAG_MAX`, `GUIDE_STEP_MAX`, `STEP_CALLOUT_MAX` | text and count limits |
| `SEARCH_QUERY_MAX`, `SEARCH_TAG_MAX`, `SEARCH_DB_TIMEOUT_MS`, `PAGE_SIZE_DEFAULT`, `PAGE_SIZE_MAX` | search and paging |

The seeded account is Odile Brandt, `odile@pennywasher.example`, password `workshop-bench-41`.
