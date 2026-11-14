# Niner Hall Runup Bay

A browser-based aerodrome control exercise for small flight-training and air traffic control schools. An instructor sets up
a school and classes, imports fictional airfields, builds timed traffic and runs a live exercise from a console. Two
students work the Ground and Tower positions on electronic flight-strip boards with typed clearances, and every run ends in
a scored debrief and a lasting training record. It is a training simulation, never for real air traffic control.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, bundles the server to `dist/server.js` and the browser app to `dist/public`) |
| serve | `npm run start` (runs `node dist/server.js` in the foreground on `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173) |

The schema is applied on every start, so an empty database is migrated by serving.

## Services

| Service | What it holds | Environment |
|---|---|---|
| Postgres | schools, members, aerodromes, scenarios, sessions, the sim clock, strips, the log, scores | `DATABASE_URL` |
| MinIO | imported layout files (`layouts/<aerodrome>/original.json`) and exported reports (`reports/<session>/report.csv`, `report.pdf`) | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit (SMTP) | verification, invitation and report notice mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |

`MAILPIT_URL` names the Mailpit inbox API; the app itself sends through SMTP only.

## Configuration

Every value is read once, in `src/server/config.ts`, from the environment.

| Variable | Default | Meaning |
|---|---|---|
| `APP_PUBLIC_PORT` | 4173 | listen port |
| `APP_PUBLIC_URL` | `http://127.0.0.1:<port>` | absolute links in mail |
| `GRADING_KEY` | unset | enables the grading routes when set; they answer 404 without the key |
| `SIM_CLOCK` | `wall` | `wall` ticks at the session speed; `stepped` moves only through the grading clock route |
| `APP_TODAY` | unset | today (`YYYY-MM-DD`) for every date rule; unset means the current date in `APP_TIME_ZONE` |
| `APP_TIME_ZONE` | `UTC` | IANA zone name |
| `PUSH_SECONDS` | 30 | pushback to `ready` |
| `LINEUP_SECONDS` | 20 | holding point to `lined-up` |
| `TAKEOFF_ROLL_SECONDS` | 30 | takeoff clearance to `airborne` |
| `LANDING_ROLL_SECONDS` | 40 | touchdown to `vacated` |
| `CROSS_SECONDS` | 30 | runway crossing |
| `HANDOFF_OFFER_SECONDS` | 60 | life of a handoff offer |
| `ARRIVAL_PROTECT_SECONDS` | 120 | R3 window before an arrival's threshold time |
| `GO_AROUND_SECONDS` | 300 | new `Due` after a go-around |
| `READBACK_CORRECT_SECONDS` | 15 | time allowed for a `NEGATIVE` |
| `READBACK_ERROR_EVERY` | 5 | default readback error interval, 0 = never |
| `SIM_SEED_OFFSET` | 0 | added to every scenario seed |
| `SLOT_TOLERANCE_SECONDS` | 300 | slot tolerance before slot delay counts |
| `WIND_CHANGE_DELAY_SECONDS` | 120 | delay before a wind change moves the runway in use |
| `SEAT_GRACE_SECONDS` | 120 | wall seconds a disconnected seat is held |
| `INVITE_TTL_HOURS` | 168 | invitation life |
| `VERIFY_TTL_HOURS` | 24 | verification link life |
| `COMMANDS_PER_MINUTE` | 120 | per seat, wall clock |
| `LAYOUT_MAX_BYTES` | 200000 | layout upload limit |

## Using it

1. Sign up, open the emailed link, sign in, create a school and a class.
2. Invite students from the class page; they join from the mailed link.
3. Import a layout under Aerodromes (or use the built-in Wrenfield and Kestrel Down), build a scenario, assign it.
4. Start the exercise from the class page. Students take the Ground and Tower seats; the instructor runs the console.
5. When the exercise ends everyone is offered the debrief: score, breakdown, timeline, a replay slider and CSV and PDF reports.

The browser app registers no service worker and loads nothing from another host.
