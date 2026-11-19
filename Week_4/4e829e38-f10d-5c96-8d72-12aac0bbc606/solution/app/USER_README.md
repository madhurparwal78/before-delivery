# Everyweek

Everyweek is a rule-driven work hub for small crews that run the same routines week after week. A coordinator builds projects with sections, custom and formula fields and automation rules. Team members work in list, board and timeline views with a live inbox. Goals roll up from the work underneath, workload is checked against each person's daily capacity, a public intake form turns requests into tasks, and approvers decide from their inbox. One TypeScript app serves the pages, the API and the live channel.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (bundles the server into `dist/server.js` and the browser app into `dist/public`) |
| serve | `npm start` (foreground, `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173) |

Sign in with the seeded coordinator `noor@everyweek.example` and password `weekly-demo-1`. The team code `LARDER-2026` joins the seeded team. The public sample form is `/f/supply-request`.

## Services

| Service | What it holds | Settings read from the environment |
|---|---|---|
| postgres | every record, the clock, claim rows, live-event notifications | `DATABASE_URL` |
| minio (S3) | attachments at `attachments/<task>/<attachment>/<name>` and project downloads at `exports/<project>/<file>.csv` or `.json` | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| mailpit (SMTP) | sign-up verification codes and digest mail | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |

Several copies of the app may run against one database. They start one at a time, share the schema and claim their work in the database, so a rule, a repeat or a digest happens once.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `APP_PUBLIC_PORT` | 4173 | listen port |
| `EVERYWEEK_GRADING` | unset | `1` turns on `/grading/seed` and `/grading/clock` (each needs the header `X-Everyweek-Grading: 1`) |
| `EVERYWEEK_RULE_MAX_DEPTH` | 3 | deepest level at which a rule may run |
| `EVERYWEEK_RULE_RUNS_PER_MINUTE` | 60 | rule runs per project per UTC minute |
| `EVERYWEEK_FORMULA_MAX_CHARS` | 200 | longest formula |
| `EVERYWEEK_FORMULA_MAX_STEPS` | 500 | evaluation steps per task per formula |
| `EVERYWEEK_DIGEST_WINDOW_MIN` | 60 | digest window in minutes |
| `EVERYWEEK_HOLD_TIMEOUT_MS` | 30000 | edit hold and presence lifetime |
| `EVERYWEEK_UPLOAD_MAX_BYTES` | 1048576 | largest attachment |
| `EVERYWEEK_PAGE_SIZE` | 50 | tasks per API page |
| `EVERYWEEK_MOVE_MS` | 320 | move animation length |
| `EVERYWEEK_PROGRESS_MS` | 400 | progress bar animation length |
| `EVERYWEEK_TOAST_MS` | 4000 | toast lifetime |

If the object store is unreachable the app still starts: health answers `{"status":"unavailable"}` and only attachments and downloads fail, with the published messages.
