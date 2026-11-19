# Slatehall by Corbel & Slate

Slatehall is a live 3D classroom in the browser for independent teachers of adult learners. A teacher arranges a
classroom from ready-made pieces, loads each week's lesson as slide images and 3D models, and runs the session live
(seats, board, raised hands, polls, breakout tables with a Bell Return, spotlight and a room lock). Afterwards the
teacher reads an attendance sheet and a session summary. Learners join with a class code and a display name, take a
seat, follow the board, take part, and review the slides after class.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, then bundles the server to `dist/server.js` and the browser app to `dist/client/`) |
| serve | `npm start` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

Health: `GET /api/health` answers `200 {"status":"ok"}`, or `200 {"status":"unavailable"}` while Valkey or MinIO
cannot be reached. Every response carries `X-Slatehall-Instance`.

## Backing services

| Service | Used for | Settings |
|---|---|---|
| Postgres | the durable record: accounts, sign-in sessions, worlds and clocks, classes, rooms, lessons, file records, sessions, attendance, polls, breakouts, chat, summaries | `DATABASE_URL` |
| MinIO | every lesson file, byte for byte, under `lessons/<lessonId>/<fileId>` | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Valkey | the live bus keeping app instances in step: seats, slide, hands, poll counts, flags, breakouts, presence, and the `sh:events` channel | `VALKEY_URL` |

The app starts and serves with Valkey or MinIO unreachable, reports `unavailable` on health, and recovers on its own.

## Environment

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL`, `S3_*`, `VALKEY_URL` | service connections (above) | none |
| `GRADING_KEY` | key for the grading routes; unset means those routes answer 404 | none |
| `INSTANCE_NAME` | name of this instance, sent in `X-Slatehall-Instance` | `a` |
| `APP_PUBLIC_PORT` | listen port | `4173` |
| `TZ` | process zone (the server decides class times in each class's own zone) | `UTC` |
| `BREAKOUT_SECONDS` | length of a breakout round | `480` |
| `BREAKOUT_WARNING_SECONDS` | warning edge before the deadline | `30` |
| `BREAKOUT_EXTEND_SECONDS` | what Add 2 minutes adds | `120` |
| `LATE_AFTER_MINUTES` | late edge after the local start | `5` |
| `LEFT_EARLY_MINUTES` | left-early edge before the local end | `10` |
| `RECONNECT_GRACE_SECONDS` | reconnect grace | `90` |
| `SLIDE_MAX_BYTES` | largest slide, inclusive | `5000000` |
| `MODEL_MAX_BYTES` | largest model, inclusive | `10000000` |
| `SLIDES_MAX_PER_LESSON` | most slides in a lesson, inclusive | `40` |
| `CHAT_MAX_CHARS` | longest table chat message, inclusive | `300` |

## Using it

- Teachers sign up at `/sign-up` (email, password of 10 or more characters, name), create a class at `/classes`, arrange
  its room (arrow keys, Enter to place, Delete to remove), add a lesson with slides (PNG or JPEG) and a glTF binary model,
  mark it ready, schedule a session, then open, start and end it from the classroom page.
- Learners go to `/join`, enter the class code and a name, take a seat (arrow keys and Enter, or tap) and follow along.
  After the class ends, a learner who attended can step through the slides at `/review/<sessionId>`.
- Classroom keys: arrows move the seat cursor, Enter takes the seat, `H` raises or lowers a hand, `C` opens table chat,
  `1`-`6` answer the open poll; for teachers `PageDown`/`PageUp` change slide, `T` takes the next hand, `S` spotlights the
  learner under the cursor.
