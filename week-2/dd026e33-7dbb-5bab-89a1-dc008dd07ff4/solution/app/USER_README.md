# Lacquer

Lacquer is the operations app of Marrow & Lark Motor House, a collector-car care house in Zurich.

- **Staff** check cars in and out with a signed condition report, assign climate-controlled bays,
  keep the belongings log, work the care round, estimate and run paint jobs with film-build readings
  for each panel, invoice the work, record owners' bank transfers and book releases.
- **Owners** use the portal to see their own cars, photos, paint progress and invoices, approve
  estimates and request releases.

Every date and time is shown in Europe/Zurich. Money is CHF with 8.1 % VAT and five-centime rounding.

## Running it

`run.json` holds the three commands (Node.js 22 and npm):

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the lockfile |
| build | `npm run build` | builds the browser bundle (Vite) into `dist/client` and compiles the server (TypeScript) into `dist/server` |
| serve | `npm run start` | runs `node dist/server/server/main.js` in the foreground on `0.0.0.0` |

On start the server applies its schema to the Postgres database and, when the database is empty,
writes the seed (users, bays, cars, belongings and jobs). It then listens and answers
`GET /api/health` with `{"status":"ok"}`. If MinIO, Kill Bill or the mail server is unreachable it
still starts; queued provider effects are retried in the background and applied once the service
answers. Several processes may serve one database at once.

`npm run typecheck` type-checks the server and the browser source.

Seeded users all have the password `lacquer-demo-2026`: `ines@marrowlark.test` (concierge),
`tomas@marrowlark.test` and `luca@marrowlark.test` (care technicians), `odile@marrowlark.test`
(workshop lead), `rafael@marrowlark.test` (house manager), `henrietta@owners.test` and
`kenji@owners.test` (owners).

## Environment

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | the system of record: users, sessions, cars, bays, belongings, reports and photo metadata, care entries, jobs, invoices (last confirmed balances), transfers, releases, idempotency records and the queue of provider effects |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO (S3 API) | signed condition reports and photos in the private bucket |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | owner accounts, monthly bay subscriptions, workshop invoices, their balances and bank transfers (external payments) |
| `KILLBILL_KEY_PREFIX` (optional) | Kill Bill | prefix for every external key (`<prefix>-owner-<id>`, `<prefix>-car-<id>`, `<prefix>-transfer-<id>`) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP) | the estimate, release-booked, invoice-issued and released emails to owners |
| `SESSION_LIFETIME_SECONDS` (default 43200) | — | fixed lifetime of every session |
| `STARTUP_OVERDUE_SECONDS` (default 2592000) | — | when a scheduled car's start-up becomes overdue |
| `ESTIMATE_EXPIRY_SECONDS` (default 1209600) | — | how long a sent estimate can be answered |
| `APP_PUBLIC_URL` | — | links in emails |
| `APP_PUBLIC_PORT` (default 4173) | — | the listening port |

None of these values reaches the browser, a log line or a response. The browser only ever talks to
the app's own origin; fonts and icons ship with the app.

## Layout of the source

- `src/server/` — the HTTP pipeline (`http.ts`, one error shape in `errors.ts`), domain modules
  (`cars`, `bays`, `belongings`, `uploads`, `care`, `jobs`, `coatstack`, `invoices`, `releases`,
  `board`), provider clients (`storage`, `killbill`, `mail`) and the Postgres queue (`queue.ts`).
- `src/client/` — the React screens for staff and the owner portal.
- `src/shared/` — rules both sides use once: Zurich dates, unit conversion, decimal rounding, the
  return-address rule, domain vocabulary and API types.
