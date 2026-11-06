# Pain de Lune Loafline

Loafline is the shop and back room of Pain de Lune, a one-person cold-process soap studio, in Canadian
English and Canadian French.

- **Shoppers** watch a cured batch drop on `/`, scroll the wire through the loaf, hold up to two bars,
  confirm their email with a one-time code on `/checkout` and pay.
- **Subscribers** start a Trio on `/subscribe` and skip, swap, change cadence, pause, resume or cancel it
  from `/account`.
- **Staff** sign in at `/studio`: the maker logs, cuts, schedules and withdraws loaves; the packing
  helper marks today's orders shipped; the finance assistant refunds, credits, reconciles each Toronto
  month against Kill Bill and resends failed notices. Every money action is in the append-only audit.

## Run it

`run.json` holds the three commands, run from this folder with Node.js 22:

| Step | Command | Needs services |
|---|---|---|
| install | `npm ci` | no |
| build | `npm run build` (TypeScript server to `dist/server`, client bundle and fonts to `dist/public`) | no |
| serve | `npm run start` (binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) | PostgreSQL (waited for, retried every 2 s); Kill Bill and mail may be down |

On start the server applies the schema and seed data idempotently, so an empty database comes up
seeded (three batches, three staff accounts). `GET /api/health` answers `{"status":"ok"}` as soon as it
serves, even while Kill Bill or the mail server is unreachable; `GET /api/status` reports both.

The backing services (PostgreSQL, Mailpit, Kill Bill) come from the environment's provided development
compose file, which the app neither ships nor changes.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | all shop data (the only datastore) |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | accounts, the Trio catalog, invoices, payments, refunds, item adjustments, blocking states, credits |
| `SMTP_HOST`, `SMTP_PORT` | SMTP (Mailpit) | every customer email, sent from the outbox without auth or TLS |
| `MAIL_FROM` | SMTP | the From line |
| `MAILPIT_URL` | — | read by nothing; mail goes over SMTP only |
| `APP_PUBLIC_PORT` | — | listening port, default 4173 |
| `HOLD_TTL_SECONDS` | — | hold lifetime, default 600 (10 to 3,600) |
| `STEPUP_CODE_TTL_SECONDS` | — | one-time code lifetime, default 300 |
| `STEPUP_LOCK_SECONDS` | — | lock-out after five wrong codes, default 900 |
| `STEPUP_RATE_LIMIT`, `STEPUP_RATE_WINDOW_SECONDS` | — | code requests per email per rolling window, default 3 per 600 s |
| `SUBSCRIPTION_LOCK_HOURS` | — | changes lock this many hours before a bill date, default 48 |
| `SESSION_SECRET` | — | signs the session cookies; random per start when unset |

No credential is ever sent to the browser, an API body or an email.

## How money moves

Every Kill Bill account gets the `AUTO_PAY_OFF` and `AUTO_INVOICING_DRAFT` tags and the external payment
method. A drop order is one draft invoice (one charge per bar, a shipping charge, one tax item per tax
line), committed and paid by one purchase keyed by the order number. A Trio's draft invoice gets its
tax items, is committed (Kill Bill applies any account credit) and the rest is paid with the key
`<subscription>-<date>`. Refunds adjust each invoice item by its allocated amount. Amounts are whole
cents everywhere and become decimal strings only in Kill Bill request bodies and on screen.
