# Pellory Works Rulehouse

Rulehouse is a brand rulebook and logo-usage grant desk. Each deployment runs one brand; this one runs the invented brand Quenby & Co.

- **Public readers** learn the brand from six published chapters (Logo, Colour, Typography, Iconography, Motion, Voice) and operate their live figures: the weight slider, the palette wheel with its swatch table, the motion timeline and the curve editor. The home page assembles the chapter mosaic as you scroll.
- **Employees, agency partners and press contacts** sign in, find assets in the library and download sized renditions through short-lived signed links.
- **Agency partners** request one named use of one asset (or one logo variant), cite rule identifiers, upload proofs and watch the request move live.
- **Reviewers** (brand and legal) work a deadline-ordered queue and decide in stages, attaching conditions; the owner releases, restricts and retires assets, publishes chapter versions, revokes grants, invites people and verifies the audit chain; authors draft chapter versions.

## Run

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (esbuild bundles the server to `dist/server.js` and the browser app to `dist/public`) |
| serve | `node dist/server.js` (foreground, binds `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173) |

Node 22 or newer. The server applies its schema on every start and loads the demo dataset when the database has no principal. `GET /api/health` answers `{"status":"ok"}`, or `{"status":"unavailable"}` while MinIO is unreachable.

## Services

| Service | Used for | Variables |
|---|---|---|
| PostgreSQL | system of record, the app clock, the mail outbox, the audit chain; LISTEN/NOTIFY drives the live channel | `DATABASE_URL` |
| MinIO (S3 API) | masters, sized derivatives and proof uploads in one private bucket | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit (SMTP) | every notice the product sends | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL`, `S3_*`, `SMTP_HOST`, `MAIL_FROM` | required | the services above |
| `SMTP_PORT` | 1025 | Mailpit SMTP port |
| `APP_PUBLIC_PORT` | 4173 | listening port |
| `APP_PUBLIC_URL` | `http://127.0.0.1:<port>` | origin used in mailed links and the same-origin check |
| `GRADING_KEY` | none | value of the `X-Grading-Key` header the reset, seed, clock and tamper routes need; unset means those routes answer not found |
| `APP_START_AT` | `2026-03-02T09:00:00+01:00` | the app clock when the database is first created and after a reset |
| `APP_TIME_ZONE` | `Europe/Berlin` | zone of every business date and time |
| `DOWNLOAD_LINK_TTL_SECONDS` | 300 | lifetime of a signed download link |
| `LINK_SIGNING_SECRET` | random per boot | signs download links |
| `DEADLINE_HOURS_STANDARD` / `_EXTENDED` / `_LEGAL` | 24 / 48 / 72 | review window by application tier |
| `DEADLINE_WARNING_PERCENT` | 75 | warning mail at this share of the window |
| `EXPIRY_CEILING_MULTIPLIER` | 2 | a request expires at this multiple of the window |
| `PROOF_MAX_BYTES` | 5242880 | proof upload ceiling |
| `WEIGHT_ANNOUNCE_DELAY_MS` | 300 | delay of the weight slider announcement |
| `SUBMIT_DEDUP_SECONDS` | 10 | idempotent replay window of a request submission |
| `INVITE_TTL_HOURS` | 72 | lifetime of an invitation link |
| `SESSION_COOKIE_NAME` | `rulehouse_session` | name of the HttpOnly session cookie |

Only `today`, `now`, `timeZone`, `weightAnnounceDelayMs` and the caller's own engagement dates reach the browser, through `GET /api/me` and the values embedded in each page.

## Demo accounts

Every seeded password is `rulehouse-demo-1`: `olu@quenby.example` (owner), `bea@quenby.example` and `cai@quenby.example` (brand reviewers), `leo@quenby.example` (legal reviewer), `ari@quenby.example` (author), `emi@quenby.example` (employee), `ana@studiolumen.example`, `finn@fathom.example`, `bram@brightwell.example` (agency partners), `pia@morningledger.example` (press contact).
