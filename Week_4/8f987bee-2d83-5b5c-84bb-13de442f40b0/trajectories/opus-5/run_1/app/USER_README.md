# Wayline — seeded logins

Open the app, press **Sign in** and use one of the seeded Lumen Freight accounts below. Every
seeded user shares the same password.

**Password for every seeded login:** `deku-demo-pw-2026`

| Email | Name | Role | What they can do |
|---|---|---|---|
| `admin@example.com` | Priya Natarajan | admin | Everything an editor can, plus members, the plan and the audit log |
| `editor@example.com` | Marco Bell | editor | Sources, destinations, connections, Builder projects, syncs, cancels and resets |
| `viewer@example.com` | Dana Okafor | viewer | Reads every record in the workspace, changes nothing |

A second workspace, Outpost Data, is seeded to show that workspaces stay apart. Its admin is
`outsider@example.com` with the same password.

## A first walk through

1. Sign in as `editor@example.com`.
2. On **Connections**, open "Shop Orders to Warehouse" and press **Sync now**. Watch the live log
   and the job history.
3. When the job reads Succeeded, open **Destinations** and then `shop_orders` to page through the
   185 records the sync landed.
4. Press **New connection** to walk the four-step wizard, or open **Builder** to describe an HTTP
   source against the sandbox at `/mock-api/v1/invoices` (its key is `sandbox-key-2026`).

Sign-up is closed: new people join only through an admin's invitation on **Members**.
