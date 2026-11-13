# Sightline — Halden Reading Room

Sightline is the paid online exhibition of the Halden Reading Room: eight chapters on the history
of machine thought, each opening as a 3D shard sculpture that resolves into its numeral and title
from one viewpoint. Visitors walk the chapters, use four live exhibits (a spring sculpture, a rule
engine, a perceptron and a word-neighbours explorer), keep a saved path and bookmarks, and book
timed guided sessions. Supporters join a monthly plan in EUR, GBP, USD or JPY, change or cancel it,
donate, settle an overdue charge and download receipts. Curators move chapters and timeline events
through draft, review, scheduled, published and withdrawn, and upload media with transcripts. The
box-office and membership manager runs sessions, refunds orders, watches dunning, schedules price
changes and reconciles the ledger against Kill Bill per currency.

## Running it

TypeScript on Node.js 22 with npm. The commands are in `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (server with `tsc`, browser with Vite into `dist/`) |
| serve | `npm run start` (`node dist/server/main.js`, foreground) |

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173) and answers `GET /api/health` with
`{"status":"ok"}` as soon as it listens. On every start it applies its PostgreSQL schema and seed,
the PocketBase collections and the Kill Bill catalog, idempotently; a service that is down at boot
is retried in the background and picked up without a restart. Several instances may share one
database, bucket, PocketBase and Kill Bill tenant.

## Services and environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | archive, sessions and bookings, orders ledger, refunds, notes, sign-in sessions, idempotency records, card classes, mail queue, dunning state, staff action record |
| `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` | PocketBase | accounts (`users`), `saved_paths`, `bookmarks`, `preferences` |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | price catalog, accounts, subscriptions, invoices, payments, refunds |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP) | every outbound email, queued in PostgreSQL and delivered once |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | media (`media/<id>/<file>`) and receipt PDFs (`receipts/<number>.pdf`), served only by presigned links |
| `APP_PUBLIC_PORT` | — | listening port, default 4173 |
| `APP_PUBLIC_URL` | — | base of links in emails, default `http://localhost:<port>` |
| `DUNNING_RETRY_SECONDS` | — | automatic retry spacing after a declined membership charge, default 259200 |
| `MEDIA_LINK_SECONDS` | — | lifetime of presigned media and receipt links, default 300 |

Every value is read from the environment at start; nothing is hard-coded and no credential or
service URL reaches the browser. The browser talks only to the app origin and follows presigned
storage links.

## Seeded staff

Curators Ines Varela and Priya Okonkwo, lead curator Tomas Reiland and manager Marta Solberg
(`@halden.test`), plus visitors Ada Brennan and Kenji Arai (`@visitor.test`), all with the
password `Halden-demo-2026`. There is no staff self-registration.

## Sandbox cards

No real card processor is used. `4000 0000 0000 0002` is always declined; `4000 0000 0000 0341`
is approved on a person's first charge and declined after; every other Luhn-valid 16-digit number
is approved. Only the last four digits and the outcome class are ever stored.
