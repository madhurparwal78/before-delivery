# Gloamwork Shot Rig

The website and client workspace of Gloamwork, a one-person CGI studio. Prospective clients browse a live 3D
studio site, start a project, upload their product GLB (plus STEP and PDF references), confirm its real-world
scale on a plinth, build a shot list around their own model while the quote recalculates, and pay a 40% deposit
in EUR, GBP, USD or JPY. Reviewers accept or revise look-dev and final stills from an emailed review link;
finance contacts pay milestone invoices; the founder runs the studio from `/studio`.

## Run it

`run.json` holds the three commands the deployment runs, in order:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the lockfile |
| build | `npm run build` | type-checks and compiles the server (`tsc`) and bundles the browser app (`vite build`) into `dist/` |
| serve | `npm run start` | `node dist/server/main.js`, in the foreground, on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173) |

The server answers `GET /api/health` with `{"status":"ok"}` as soon as it listens, even if a backing service is
down. On every start it applies its Postgres schema and seeds, creates its PocketBase collections and seed
records, its RabbitMQ queues and its Meilisearch index, idempotently, retrying until each service is reachable.

## Environment

Every value is read once at start (`src/server/config.ts`); none reaches the browser.

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | brands, contacts, sessions, sign-in codes, engagements, quotes, rates, intake records, measurements, stills, review links, idempotency keys, invoices, ledger, outbox |
| `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` | PocketBase | case studies, services (shot titles and prices), team, insights, marquee |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | intake files (`intake/<engagement>/<file>.<ext>`) and stills (`stills/<engagement>/<milestone>/<still>.<ext>`) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | one account per brand, external-charge invoices, card payments, refunds, voids, overdue blocking states |
| `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM` | Mailpit | every email (sign-in codes, receipts, invoices, notices, review links, refunds); `MAIL_FROM` defaults to `Gloamwork Studio <studio@gloamwork.test>` |
| `AMQP_URL` | RabbitMQ | the durable `intake.measure` queue and `intake.measure.dead` |
| `GOTENBERG_URL` | Gotenberg | receipt and invoice PDFs |
| `MEILISEARCH_URL`, `MEILISEARCH_API_KEY` | Meilisearch | the `studio_content` search index |
| `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD` | ntfy | founder push alerts on the `gloamwork-studio` topic |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | — | listening port; the public origin used in emailed links |
| `SIGNIN_CODE_TTL_SECONDS` (600), `SIGNIN_CODE_WINDOW_SECONDS` (900), `REVIEW_LINK_TTL_SECONDS` (1209600), `OVERDUE_AFTER_SECONDS` (1209600), `IDEMPOTENCY_KEY_TTL_SECONDS` (86400) | — | timers, in whole seconds |

## Using it

- Studio site: `/` (search, case studies at `/work/<slug>`), start a project at `/start`.
- Clients sign in at `/sign-in` with an emailed six-digit code; `/account` lists their engagements; each
  engagement has its page (`/account/engagements/<id>`) and its Shot Rig (`/rig/<id>`).
- Reviewers open `/review/<token>` from their email.
- The founder signs in at `/studio` with the studio password.
- Test cards: `4242 4242 4242 4242` approves, `4000 0000 0000 0002` is declined.
