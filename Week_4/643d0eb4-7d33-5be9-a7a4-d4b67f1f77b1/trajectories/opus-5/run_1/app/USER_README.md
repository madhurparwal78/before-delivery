# Keystone Tables

The governed table workspace Northbank Mutual runs for its insurance operations group.

Five public addresses explain the product, `/login` carries sign in and sign up, and `/console`
carries the signed in workspace.

| Address | Public | Purpose |
|---|---|---|
| `/` | yes | the landing page and its proof band |
| `/plans` | yes | the plan matrix and the allowance table |
| `/enquiry` | yes | the qualified sales enquiry form |
| `/community` | yes | the community page and its newsletter form |
| `/developers` | yes | the developer interface reference |
| `/login` | yes | sign in, and the link to sign up |
| `/console` | no | the signed in workspace and the steward console |

## Seeded accounts

Every seeded account shares the demonstration password `deku-demo-pw-2026`.

| Email | Role | Department | Password |
|---|---|---|---|
| `steward.claims@example.com` | `steward` | `claims` | `deku-demo-pw-2026` |
| `editor.claims@example.com` | `editor` | `claims` | `deku-demo-pw-2026` |
| `analyst.claims@example.com` | `analyst` | `claims` | `deku-demo-pw-2026` |
| `viewer.claims@example.com` | `viewer` | `claims` | `deku-demo-pw-2026` |
| `steward.underwriting@example.com` | `steward` | `underwriting` | `deku-demo-pw-2026` |
| `editor.underwriting@example.com` | `editor` | `underwriting` | `deku-demo-pw-2026` |
| `steward.actuarial@example.com` | `steward` | `actuarial` | `deku-demo-pw-2026` |
| `analyst.actuarial@example.com` | `analyst` | `actuarial` | `deku-demo-pw-2026` |

`editor.underwriting@example.com` also holds a `viewer` role on `actuarial`, left behind by the
seeded approved access request.

## Seeded tables

| Table slug | Department | Seeded state |
|---|---|---|
| `claims-intake` | `claims` | `2400` rows, exactly four fifths of the `starter` row allowance |
| `claims-reserves` | `claims` | `40` rows, locked for `2026-Q2`, with `2026-Q1` and `2026-Q2` snapshots |
| `underwriting-risk` | `underwriting` | a working table below its allowance |
| `actuarial-triangles` | `actuarial` | a working table, with `2026-B1` and `2026-B2` snapshots |
| `actuarial-exposure` | `actuarial` | the high-volume table, exactly `4000` rows |

## Running it

- `npm install`
- `npm run build`
- `node src/server.js`

The app reads `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` and `DATABASE_URL` from the environment, applies
its schema and its seed on every start without duplicating a row, and answers `GET /api/health`
with `200` once it is ready.
