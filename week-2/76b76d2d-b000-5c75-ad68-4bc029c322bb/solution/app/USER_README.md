# Halide Box Office

The bilingual (French-first) box office, membership desk and finance console of the Halide Film
Society. Patrons browse the season programme on a scroll-driven lens-iris stage, hold and buy
reserved seats, join or change a membership tier, add a supporter uplift and give memberships.
Group organisers book blocks of 10 to 40 seats with an exact cost split. Door staff check tickets
in, programmers schedule seasons, and finance officers refund, issue goodwill credit, answer
enquiries and reconcile each Toronto business day against Kill Bill.

## Run it

`run.json` holds the three commands, run from the app directory:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the lockfile |
| build | `npm run build` | type-checks all TypeScript, bundles the server to `dist/server.js` and the browser app, styles and fonts to `dist/public/` |
| serve | `npm run serve` | starts the server in the foreground on `0.0.0.0:$APP_PUBLIC_PORT` |

On start the server applies the Postgres schema (and the seed, on an empty database), uploads the
membership catalogue to Kill Bill if it is missing, and starts the mail outbox worker and the
billing and mail probes. `GET /api/health` answers `{"status":"starting"}` (503) until the schema
is ready and `{"status":"ok"}` afterwards, even while Kill Bill or mail are down.

## Configuration

| Variable | Used for | Default |
|---|---|---|
| `DATABASE_URL` | Postgres (everything that is not money of record) | required |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD` | Kill Bill server and basic auth | required |
| `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill tenant | required |
| `SMTP_HOST`, `SMTP_PORT` | SMTP server (Mailpit) for every email, no auth | required |
| `MAIL_FROM` | sender address | `Halide Box Office <billetterie@halide.example>` |
| `APP_PUBLIC_PORT` | listen port | `4173` |
| `APP_PUBLIC_URL` | absolute base for links in emails | `http://localhost:<APP_PUBLIC_PORT>` |
| `HOLD_TTL_SECONDS` | seat hold lifetime (1–3600) | `480` |
| `STEPUP_CODE_TTL_SECONDS` | emailed code lifetime (1–3600) | `600` |
| `STEPUP_VALID_SECONDS` | verification lifetime (1–3600) | `600` |
| `STEPUP_LOCKOUT_SECONDS` | lockout and send-limit window (1–86400) | `900` |

## Services

- **Kill Bill** — system of record for money: one CAD account per patron (`A-…`) or guest
  (`guest-<email>`), one invoice per booking or gift (external charges and tax items, credit applied
  by Kill Bill, the remainder paid by one PURCHASE through `__EXTERNAL_PAYMENT__`), refunds, account
  credits (goodwill, re-credit) and membership subscriptions on the `<tier>-annual`,
  `<tier>-monthly` and `<tier>-gift` plans.
- **Mailpit over SMTP** — every transactional email, delivered from a Postgres outbox, oldest first,
  retried after 5, 15, 45 and then every 60 seconds, up to 20 attempts.
- **Postgres** — venues, seasons, screenings, holds, bookings, tickets, accounts, sessions,
  idempotency keys, step-up state, the outbox, enquiries, `credit_ledger` and the append-only
  `audit_log`.

## Seeded staff accounts

`finance@halide.example`, `door@halide.example` and `programmer@halide.example` (passwords in the
brief) open the matching section of `/<locale>/staff`.
