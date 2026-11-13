# Strikeproof

Strikeproof is a browser typing-speed test whose every result is a proof. The server issues each test as a ticket holding the
exact text; the browser sends the full keystroke log; the server replays that log under the published rules before the run can
reach history or a board. Typists can watch the same replay on their certificate, second by second, and race friends in private
rooms.

## Run it

`run.json` holds the three commands:

- install: `npm ci`
- build: `npm run build` (type-checks, bundles the server to `dist/server.mjs` and the client to `dist/public`)
- serve: `npm run start` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173)

Health: `GET /api/health` answers `200 {"status":"ok"}` once the schema is applied.

## Services

- PostgreSQL (`DATABASE_URL`): the only datastore. The schema is applied idempotently at every start.
- An SMTP server that Mailpit captures (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`): verification and password-reset mail only.

## Environment

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | required |
| `SMTP_HOST`, `SMTP_PORT` | mail server | host required, port 1025 |
| `MAIL_FROM` | From line | required |
| `APP_PUBLIC_URL` | absolute base for mailed links | required |
| `APP_PUBLIC_PORT` | listen port | 4173 |
| `GRADING_KEY` | key for the two grading routes | `holloway-grading-key` |
| `TEXT_SEED` | generator base seed | 4242 |
| `TICKET_TTL_SECONDS` | ticket lifetime | 1800 |
| `MAX_LOG_EVENTS` | log entry limit | 12000 |
| `MAX_TEST_MS` | highest allowed keystroke time | 125000 |
| `FAST_INTERVAL_MS` | impossible-gap threshold | 10 |
| `MAX_EXTRA_LETTERS` | extra letters per word | 10 |
| `FOCUS_WARNING_MS` | focus warning delay | 1000 |
| `RACE_WORDS` | race length in words | 15 |
| `RACE_COUNTDOWN_SECONDS` | countdown length | 3 |
| `RACE_REJOIN_SECONDS` | rejoin and lobby release window | 30 |
| `RACE_TIME_LIMIT_SECONDS` | race cut-off after Go | 120 |
| `VERIFY_TTL_SECONDS` | verification link lifetime | 86400 |
| `RESET_TTL_SECONDS` | reset link lifetime | 3600 |
| `MAIL_RETRY_SECONDS` | mail retry gap | 30 |

Nothing here is sent to the browser except the four limits published by `GET /api/config`.

## Layout

- `shared/`: the typing engine, the texts and the wire types, used by both the browser and the server
- `server/`: HTTP, accounts, mail, tickets, run checks, boards, race rooms, the live channel
- `client/`: the Preact app, styles and bundled fonts
