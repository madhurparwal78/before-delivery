# Tallwind

Tallwind is a business banking cockpit with a public marketing site. Signed-in users watch each checking and
savings account's balance, available balance and live transaction feed; save recipients; send ACH, wire,
real-time and check payments (large ones wait for one or two approvers); settle invoices; draw on a venture
credit line; move money between their own accounts; and download monthly statements.

## Seeded logins

Every seeded user has the password `deku-demo-pw-2026`.

| Email | Role | Company |
|---|---|---|
| owner@example.com | owner | Larkspur Studio |
| admin@example.com | admin | Larkspur Studio |
| member@example.com | member | Larkspur Studio |
| outsider@example.com | owner | Outpost Goods |

## Run it

The run manifest is `run.json`:

- install: `npm ci`
- build: `npm run build` (type-checks the TypeScript, bundles the browser code, copies static files to `dist/public`)
- serve: `exec node dist/server/main.js` (foreground, binds `0.0.0.0`)

The server starts even while the database is unreachable (health answers 503) and writes its schema and starting
data the moment the database first answers.

## Environment variables

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (the only datastore) | none |
| `APP_PUBLIC_PORT` | listening port | 4173 |
| `APP_PUBLIC_URL` | public address | none |
| `APP_NOW` | ISO 8601 UTC instant the business clock starts at; it then advances in real time | system clock |
| `LOGIN_LOCKOUT_WINDOW_SECONDS` | sign-in lockout window | 900 |
| `INQUIRY_RATE_WINDOW_SECONDS` | sales inquiry rate window | 600 |
| `FX_QUOTE_TTL_SECONDS` | currency quote lifetime | 600 |

## Services

PostgreSQL through `DATABASE_URL`. No other datastore, queue, mail transport or third-party service is used.
