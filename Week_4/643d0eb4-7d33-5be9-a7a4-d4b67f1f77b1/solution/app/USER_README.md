# Keystone Tables

The governed table workspace Northbank Mutual runs for its insurance operations group. Three departments (`claims`,
`underwriting`, `actuarial`) keep typed reporting tables in one workspace. Every amendment is recorded in an
append-only, hash-chained change log or refused; a steward locks a table for a reporting period and publishes frozen
snapshots; a reader never reaches a row of a department they hold no role in.

## Run it

`run.json` names the three commands. From the app root:

```
python3 -m venv .venv && .venv/bin/pip install --no-cache-dir -r requirements.txt   # install
.venv/bin/python -m keystone.build                                                  # build
.venv/bin/python -m keystone                                                        # serve (foreground)
```

The server listens on `0.0.0.0:$APP_PUBLIC_PORT` (4173 by default). On every start it applies `keystone/schema.sql`
and an idempotent seed, so a restart adds nothing.

## Environment

| Variable | Meaning |
|---|---|
| `APP_PUBLIC_PORT` | the port to listen on (default `4173`) |
| `APP_PUBLIC_URL` | the public origin of the app |
| `DATABASE_URL` | the PostgreSQL connection string; the only service the app talks to |

## Seeded accounts

Every account signs in with the password `deku-demo-pw-2026`.

| Email | Role | Department |
|---|---|---|
| `steward.claims@example.com` | steward | claims |
| `editor.claims@example.com` | editor | claims |
| `analyst.claims@example.com` | analyst | claims |
| `viewer.claims@example.com` | viewer | claims |
| `steward.underwriting@example.com` | steward | underwriting |
| `editor.underwriting@example.com` | editor | underwriting (and viewer on actuarial) |
| `steward.actuarial@example.com` | steward | actuarial |
| `analyst.actuarial@example.com` | analyst | actuarial |

## Addresses

Public: `/`, `/plans`, `/enquiry`, `/community`, `/developers`, `/login`, `/signup`. Console (signed in):
`/console/tables`, `/console/tables/{slug}`, `/console/tables/{slug}/log`, `/console/snapshots`, `/console/requests`,
`/console/account`, `/console/administration` (stewards). The JSON interface is under `/api` on the same origin;
`GET /api/health` answers `200` once the app is ready.
