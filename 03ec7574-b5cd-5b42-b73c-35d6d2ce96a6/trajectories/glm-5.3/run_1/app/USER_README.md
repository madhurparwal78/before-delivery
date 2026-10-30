# Corvo — seeded accounts

Every seeded account uses the same password: **`deku-demo-pw-2026`**

## Northwind Treasury (app id `app_nw7k2m9q4x1z`)

| Member | Email | Role |
|---|---|---|
| Nadia Owens | `nw.owner@example.com` | owner |
| Omar Patel | `nw.operator@example.com` | operator |
| Ada Byrne | `nw.approver1@example.com` | approver |
| Ben Okoro | `nw.approver2@example.com` | approver |
| Uma Diaz | `nw.auditor@example.com` | auditor |

## Acme Payroll (app id `app_ac3p8r5t6v2w`)

| Member | Email | Role |
|---|---|---|
| Jordan Lee | `acme.owner@example.com` | owner |

Sign in at `/login`, then work from the console at `/console`. Every API
request (except sign in, contact and health) also sends the caller's
organization app id in the `X-Corvo-Org` header.
