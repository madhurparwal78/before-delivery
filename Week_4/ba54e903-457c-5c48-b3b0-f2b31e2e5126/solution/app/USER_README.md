# Community Hub

Community Hub is a real-time community messaging product for friend groups, gaming crews and fan
communities. Visitors browse a marketing site, a searchable directory of published communities, a weekly
trending-games chart, a listening room and a safety library without an account. Members sign up, join
communities, post live channel messages, react, reply in threads, mention each other, search history, share
images and video, hold a paid membership tier and moderate through ranked roles, channel overwrites,
time-outs and bans. Any number of instances may serve the product at once, all sharing one PostgreSQL
database. Email goes through the Mailpit mail service.

## Seeded logins

Every seeded account uses the password `deku-demo-pw-2026`, starts on the free tier and has a confirmed
email address.

| Email | Username | Display name |
|---|---|---|
| `member@example.com` | `novapike` | Nova Pike |
| `member.ronin@example.com` | `roninvale` | Ronin Vale |
| `member.quiet@example.com` | `quietfern` | Quiet Fern |
| `outsider@example.com` | `wesharbor` | Wes Harbor |

`novapike` owns Aurora Collective, `roninvale` owns Ronin Guild, and `wesharbor` belongs to no community.

## Run it

The manifest is `run.json`, run from the app root:

- install: `python3 -m venv .venv && .venv/bin/pip install --no-cache-dir -r requirements.txt`, then creates the empty `.browser_screenshots/` and `.downloads/` folders
- build: `true`
- serve: `.venv/bin/python -m gunicorn -c gunicorn.conf.py app:app` (production server, foreground)

On every start the app creates any missing tables and seeds the data once; concurrent starts leave one copy.

## Environment

| Variable | Use |
|---|---|
| `APP_PUBLIC_URL` | the public origin; confirmation links start with it and it is an accepted origin |
| `APP_PUBLIC_PORT` | the public port of the primary instance (default 4173) |
| `PORT` | the port this instance listens on; wins over `APP_PUBLIC_PORT` |
| `DATABASE_URL` | the PostgreSQL connection (every table, uploaded file and queued email lives there) |
| `SMTP_HOST`, `SMTP_PORT` | the Mailpit mail service |
| `MAIL_FROM` | sender of every email |
| `LOGIN_LOCKOUT_SECONDS` | sign-in lockout period, default 900 |
| `EMAIL_TOKEN_TTL_SECONDS` | confirmation token lifetime, default 86400 |
| `MESSAGE_NONCE_TTL_SECONDS` | message retry window, default 600 |
| `IDEMPOTENCY_KEY_TTL_SECONDS` | checkout replay window, default 86400 |
| `SUPPORT_WINDOW_SECONDS` | support request limit window, default 3600 |

Services: PostgreSQL (data, media bytes, outgoing email queue, live events) and Mailpit (SMTP delivery).
