# Pilot Light Co. Hearthshift

Hearthshift books, bills and keeps compliance for shared commercial kitchens. Renters claim exact
station time by sweeping an arc around a 24-hour station dial, pay from a prepaid hour pack or by
card, and keep their liability certificate and food-handler card on file. Front-desk leads check
renters in and out at the counter and bill overruns and cleaning fees. Kitchen managers read the
day's totals, run utilisation reports, schedule cancellation policy and hand inspectors a read-only
compliance binder link.

## Screens

| Path | Who | What |
|---|---|---|
| `/` | everyone | sign in with a seeded email and password (`hearth-demo-2026`) |
| `/board` | renters, front desk, managers | the station day dial, the Checkout panel and the ticket rail |
| `/tickets` | renters | every booking as a printed ticket, with invoice, terms and actions |
| `/pack` | renters | hour-pack balance, purchase and ledger |
| `/documents` | renters | certificate and food-handler card uploads |
| `/counter` | front desk, managers | today's bookings with check-in, overrun, check-out, cleaning fee and settle |
| `/manage` | managers | site totals, renter search, utilisation and CSV, cancellation policy, binder links |
| `/binder/<token>` | anyone with the link | the inspector's read-only compliance binder and its PDF |

## Running it

`run.json` holds the three commands:

```sh
npm ci --include=dev   # install from the lockfile (build tools included)
npm run build   # type-check (strict), bundle the server with esbuild, build the browser app with Vite
npm run start   # serve on 0.0.0.0:$APP_PUBLIC_PORT (default 4173)
```

`npm run start` applies the schema and seed data idempotently on every start, then serves. Health:
`GET /api/health` answers `{"status":"ok"}`; `GET /api/status` reports whether billing and mail are
reachable and how many emails are queued.

The server and the browser app are both bundled at build time, so nothing in `node_modules` is
loaded at run time; `THIRD_PARTY_NOTICES.md` lists every package compiled into `dist/`.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | Postgres | system of record: users, sites, holds, bookings, ledger, policies, outbox, idempotency keys |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | renter accounts, pack purchases, card time payments, deposits, overrun and cleaning fees, refunds |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | renter documents (`renters/<renter>/documents/<document>`) and binder PDFs (`sites/<site>/binders/<link>.pdf`) in a private bucket |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit | every outgoing email, plain text, From `MAIL_FROM` |
| `APP_PUBLIC_PORT` | — | listening port, default 4173 |
| `HOLD_TTL_SECONDS` | — | hold lifetime, default 600 |
| `BINDER_LINK_TTL_SECONDS` | — | binder link lifetime, default 604800 |
| `SESSION_SECRET` | — | optional; signs the `hs_session` cookie. When absent a random secret is generated at start (sessions then end on restart) |

`MAILPIT_URL` may be present and is not used. Credentials are read on the server only and never
reach the browser.

## When a service is down

The app starts and serves with Kill Bill or Mailpit unreachable and re-checks both every five
seconds. While billing is unreachable every card action answers `503 billing_unavailable` and
changes nothing; pack-only bookings, check-in and check-out still work. While mail is unreachable
every email waits in the Postgres outbox and is delivered exactly once when mail returns. Hold
expiry, unpaid cutoffs and expiry reminders run inside the serving process from Postgres state.
