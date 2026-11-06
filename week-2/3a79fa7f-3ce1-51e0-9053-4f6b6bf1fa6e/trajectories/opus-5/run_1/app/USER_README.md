# Tern Foils

The storefront, configurator and order system for Tern Foils, a family maker of electric hydrofoil boards.

## Running it

| Step | Command |
| --- | --- |
| Install | `npm ci` |
| Build | `npm run build` |
| Serve | `node dist/server.js` |

The server listens on `0.0.0.0` at `APP_PUBLIC_PORT` (4173 when unset) and serves every page and the JSON API
from one origin. `GET /api/health` answers `{"status":"ok"}` once the schema and seed rows are in place.

## Seeded staff logins

Staff are seeded and never self-registered. They sign in at `/login` and work in `/staff`.

| Email | Password | Role | Tabs in `/staff` |
| --- | --- | --- | --- |
| `staff@ternfoils.com` | `StaffPass2026` | admin | Trade-ins, Demo days, Orders, Outbox |
| `dealer@ternfoils.com` | `DealerPass2026` | dealer | Demo days |
| `support@ternfoils.com` | `SupportPass2026` | support | Trade-ins, Outbox |

No customers are seeded. Create one at `/signup`.

## Services

Every service URL and credential is read from the environment and is never sent to the browser.

- `DATABASE_URL` — the PostgreSQL database, which holds every record. Tables and seed rows are created
  idempotently on every start, on an empty or an existing database.
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` — the mail server the notice outbox sends to.
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` —
  billing, where each placed order records one itemised external-charge invoice.
- `APP_PUBLIC_URL` — the origin used for links in email.
- `CLOCK_CONTROL` — set it to `enabled` to expose `PUT` and `DELETE /api/_clock`, which set and clear the
  instant every time rule reads. Otherwise both paths answer 404.

Kill Bill or the mail server being unreachable never blocks start-up or health. A notice that cannot be sent
waits in the outbox as pending and is retried; a billing outage refuses the order with 503 and changes nothing.

## Where to start

- `/` the storefront, `/boards` the lineup, `/parts` and `/foil-boards` the shop pages.
- `/match` the five-question fit quiz, `/build` the configurator with the 3D board viewer.
- `/cart`, `/checkout`, `/account` and `/account/orders/<number>`.
- `/locations` demo stations and demo days, `/events` upcoming events, `/callback` to book a call.
- `/track`, `/support`, `/trade-in`, `/shipping`, `/protection`, `/faq`, `/partners`.
- `/staff` the staff console.
