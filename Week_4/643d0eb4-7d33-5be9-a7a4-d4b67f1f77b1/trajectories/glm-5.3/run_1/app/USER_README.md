# Keystone Tables — user guide

Keystone Tables is the governed reporting workspace Northbank Mutual runs for its insurance
operations group. Three departments — `claims`, `underwriting` and `actuarial` — keep their
reporting tables here, and every read, write and snapshot is governed by the role a signed in
account holds on that one department.

## Seeded accounts

Every seeded account shares the demonstration password:

```
deku-demo-pw-2026
```

| Email | Role | Department |
|---|---|---|
| `steward.claims@example.com` | steward | claims |
| `editor.claims@example.com` | editor | claims |
| `analyst.claims@example.com` | analyst | claims |
| `viewer.claims@example.com` | viewer | claims |
| `steward.underwriting@example.com` | steward | underwriting |
| `editor.underwriting@example.com` | editor | underwriting |
| `steward.actuarial@example.com` | steward | actuarial |
| `analyst.actuarial@example.com` | analyst | actuarial |

`editor.underwriting@example.com` also holds a `viewer` role on `actuarial`, granted by an approved
access request.

## Signing in

1. Open `/login`.
2. Enter the work email and the password above.
3. Choose `Sign in`. The console opens at `/console/tables`.

Five refused sign in attempts for one work email inside fifteen minutes throttle that email for
fifteen minutes; the answer is `429` with a `Retry-After` header.

## The public pages

- `/` — the landing page.
- `/plans` — the plan matrix: four tiers, their allowances, and a yearly/monthly toggle.
- `/enquiry` — the qualified sales enquiry form.
- `/community` — the community page and the newsletter form.
- `/developers` — the developer interface reference.
- `/login` — sign in, and the link to sign up.

## The console

- `/console/tables` — every table the account may read.
- `/console/tables/{slug}` — one table, its rows, and the `Edit row` dialogs.
- `/console/tables/{slug}/views/{view}` — one saved view.
- `/console/tables/{slug}/log` — the append-only change log of one table.
- `/console/snapshots` — published snapshots, and the `Publish snapshot` dialog.
- `/console/requests` — access requests, and the `Decide request` dialog.
- `/console/account` — the account, its department, its tier and its role grants.
- `/console/administration` — the steward administration console (stewards only).

## Roles

| Role | Reads rows | Amends rows | Manages views | Decides requests |
|---|---|---|---|---|
| viewer | yes | no | no | no |
| analyst | yes | no | yes | no |
| editor | yes | yes | yes | no |
| steward | yes | yes | yes | yes |

A role is granted per account per department, never globally, and there is no account that reaches
every department.
