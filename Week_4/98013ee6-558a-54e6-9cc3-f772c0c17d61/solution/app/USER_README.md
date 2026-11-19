# Mothlight

Mothlight is a visual bookmarking site: people save images as pins on boards (public, secret or shared with
collaborators), and every pin keeps its source link, alt text and a credit to the person who first pinned it.

One TypeScript app: a Node 22 server (plain `node:http` plus `ws`) and a React client built by Vite. It talks to three services:

| Service | Used for | Variables |
|---|---|---|
| Postgres | every record, every order, undo windows, invites, the business clock, search, live fan-out (`LISTEN`/`NOTIFY`) | `DATABASE_URL` |
| MinIO (S3) | image files (`images/<image id>/original.<png|jpg>` and `w236`, `w474`, `w736`) | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit (SMTP) | sign-up codes, board invites, join notices | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |

## Run

`/app/run.json` holds the commands: `npm ci`, `npm run build`, `npm run start`.
The server binds `0.0.0.0` on `APP_PUBLIC_PORT`, else `PORT`, else 4173. `GET /api/health` answers 200 with
`{"status":"ok"}`, or `{"status":"unavailable"}` while object storage is unreachable.

## Other variables

| Variable | Meaning | Default |
|---|---|---|
| `APP_PUBLIC_URL` | base of links in emails | `http://localhost:<port>` |
| `GRADING_KEY` | key for the grading routes (`X-Grading-Key`); unset means they answer 404 | unset |
| `MOTHLIGHT_START_AT` | business clock start (ISO 8601 UTC) | real time |
| `MOTHLIGHT_TIME_ZONE` | IANA zone for shown dates | `UTC` |
| `MOTHLIGHT_UNDO_SECONDS` | undo window | 30 |
| `MOTHLIGHT_INVITE_TTL_SECONDS` | invite lifetime | 604800 |
| `MOTHLIGHT_IMAGE_MAX_BYTES` | largest upload | 10000000 |
| `MOTHLIGHT_IMAGE_MAX_PIXELS` | most pixels (width × height) | 40000000 |
| `MOTHLIGHT_TITLE_MAX`, `MOTHLIGHT_DESCRIPTION_MAX`, `MOTHLIGHT_COMMENT_MAX`, `MOTHLIGHT_BOARD_NAME_MAX` | text limits in code points | 100, 500, 500, 50 |

## Demo content

The first start on a database with no people creates the demo collectors `wren@demo.mothlight.example` and
`odile@demo.mothlight.example` (password `mothlight-demo-2027`), their boards `Night studies` and `Fern room`, and twelve generated prints.

## Notes

* Images are processed in the app process with `sharp` (pinned): turned upright, metadata removed, display widths 236, 474 and 736 generated.
* The browser loads only the app's own files and `/media/...` responses; no credential ever reaches it.
* `THIRD_PARTY_NOTICES.md` lists every package and the TikTok Sans font files with their licences.
