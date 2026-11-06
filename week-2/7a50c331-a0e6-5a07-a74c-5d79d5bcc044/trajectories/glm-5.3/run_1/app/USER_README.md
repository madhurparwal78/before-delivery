# Tessel sign-in

Every seeded account uses the password `deku-demo-pw-2026`. It is benchmark
fixture data, not a secret.

## Northwind Labs (plan: ship)

| Email | Role |
|---|---|
| `northwind.owner@example.com` | owner |
| `northwind.editor@example.com` | editor |
| `northwind.viewer@example.com` | viewer |

Northwind Labs owns the database `launch_brain`, ready from the start, holding
the four seeded sources `kickoff-notes`, `reorg-memo`, `billing-standup` and
`launch-retro` with their eight facts in the collection `default`.

## Acme Ops (plan: scale)

| Email | Role |
|---|---|
| `acme.owner@example.com` | owner |

Acme Ops owns its own database, also named `launch_brain`, holding the one
seeded source `acme-plan`.

## Signing in

- The console lives at `/console`; signing in lands you there.
- Sign in through `/login`, or through the API with
  `POST /api/auth/login` returning a bearer token.
- API keys carry the role `editor` or `viewer` only, and are created by an
  owner in Settings, API keys.
