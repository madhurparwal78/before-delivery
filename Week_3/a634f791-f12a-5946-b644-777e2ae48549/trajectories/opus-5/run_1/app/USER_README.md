# Northfall Reference Desk

The public reference library and the private desk where it is written, both served
from one origin. The pages are at `/` and under `/fi`; the API is under `/api`.

## Running it

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/gunicorn --config gunicorn.conf.py wsgi:app
```

The app reads three settings and nothing else: `DATABASE_URL`, `APP_PUBLIC_PORT`
(4173 by default) and `APP_PUBLIC_URL`. It creates its schema and applies its seed
on first boot with no manual step, and waits for Postgres if it is not there yet.

## Seeded desk accounts

Sign in at `/desk`.

Email: curator@example.com
Password: deku-demo-pw-2026
Role: curator in northfall

Email: steward@example.com
Password: deku-demo-pw-2026
Role: steward in northfall

Email: curator.westhall@example.com
Password: deku-demo-pw-2026
Role: curator in westhall

A curator writes, orders, previews, publishes and retires references, and reads
the enquiry queue. A steward does all of that and also records clearance windows
and deletes enquiries. The `westhall` programme is stored alongside `northfall`
but is never served at this origin; its account is there to show that the desk
keeps the two apart.

## What you can look at

- `/` the home page, with the promise line and the featured strip.
- `/references` the numbered library, filtered by sector from the address.
- `/references/<slug>` one reference, with its result figures and quote.
- `/programme`, `/story`, `/notes` the reading routes.
- `/contact` the reference managers and the enquiry form.
- `/fi/...` the same routes in Finnish.
- `/desk` the private desk, in English only.
- `GET /api/health` answers `{"status":"ok"}` once the store is ready.

## The service clock

Every reading of now is the system instant plus `service_clock.offset_seconds`,
read fresh for each request. It is the rehearsal clock for date rollovers and is
changed only in the database:

```sql
UPDATE service_clock SET offset_seconds = 86400 WHERE id = 1;
```

No HTTP route reads it out or sets it.
