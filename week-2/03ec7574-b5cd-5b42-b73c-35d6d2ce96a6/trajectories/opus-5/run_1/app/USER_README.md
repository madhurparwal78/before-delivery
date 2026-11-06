# Corvo — seeded accounts

Every seeded account uses the password `deku-demo-pw-2026`.

Sign in at `/login`. The console lives under `/console`.

## Northwind Treasury (app id `app_nw7k2m9q4x1z`)

| Email | Name | Role |
|---|---|---|
| `nw.owner@example.com` | Nadia Owens | `owner` |
| `nw.operator@example.com` | Omar Patel | `operator` |
| `nw.approver1@example.com` | Ada Byrne | `approver` |
| `nw.approver2@example.com` | Ben Okoro | `approver` |
| `nw.auditor@example.com` | Uma Diaz | `auditor` |

## Acme Payroll (app id `app_ac3p8r5t6v2w`)

| Email | Name | Role |
|---|---|---|
| `acme.owner@example.com` | Jordan Lee | `owner` |

## What the seed holds

- Northwind wallets: `Operating USDC` (250000 USDC, policy `Operating limits`, quorum
  `Finance quorum`, approval floor 10000), `Payroll USDC` (40000 USDC, floor 25000) and
  `Gas reserve` (12.5 ETH).
- One executed transfer of 3500 USDC and one waiting transfer of 12000 USDC with a single
  approval recorded, so Operating USDC starts at balance 250000, reserved 12000 and
  available 238000.
- Acme Payroll holds one wallet, `Acme Operating` (9000 USDC).

## Running it

The run manifest `run.json` names the commands: `npm ci --omit=dev`, then `npm run build`,
then `npm start`. `npm start` applies the schema, writes the seed into an empty database and
listens on `APP_PUBLIC_PORT` (4173 by default). `GET /api/health` answers
`{"status":"ok"}` once the schema and seed are ready.

API callers send `Authorization: Bearer <token>` and `X-Corvo-Org: <app id>`, where the token
comes from `POST /api/v1/auth/login`.
