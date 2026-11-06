# Rostara attendance desk

Rostara is the internal desk where Kestrel Works puts attendance records right.
Employees raise corrections against their own days, managers decide the ones their
current direct reports raised, and people operations keeps the policy and the trail.

The desk is reached at `APP_PUBLIC_URL`, which defaults to <http://127.0.0.1:4173>.

## Signing in

Every account is seeded. There is no signup, no password reset and no invitation.
All sixteen seeded people share the same password:

```
deku-demo-pw-2026
```

| Work address | Name | Role | Reports to | Active |
| --- | --- | --- | --- | --- |
| `admin@example.com` | Priya Sahni | People operations | nobody | yes |
| `manager@example.com` | Dara Finch | Manager | Priya Sahni | yes |
| `manager2@example.com` | Omar Vance | Manager | Priya Sahni | yes |
| `manager3@example.com` | Lena Roth | Manager | Priya Sahni | yes |
| `employee@example.com` | Iris Calder | Employee | Dara Finch | yes |
| `employee2@example.com` | Tomas Berg | Employee | Dara Finch | yes |
| `employee3@example.com` | Nadia Kerr | Employee | Dara Finch | yes |
| `employee4@example.com` | Felix Arno | Employee | Dara Finch | yes |
| `employee5@example.com` | Suri Patel | Employee | Omar Vance | yes |
| `employee6@example.com` | Jonas Vale | Employee | Omar Vance | yes |
| `employee7@example.com` | Mira Okoye | Employee | Omar Vance | yes |
| `employee8@example.com` | Ravi Setu | Employee | Omar Vance | yes |
| `employee9@example.com` | Clara Mendt | Employee | Lena Roth | yes |
| `employee10@example.com` | Bo Lindqvist | Employee | Lena Roth | yes |
| `employee11@example.com` | Ayaan Qureshi | Employee | Lena Roth | yes |
| `employee12@example.com` | Greta Solis | Employee | Lena Roth | no |

Greta Solis is deactivated, so her correct password is refused in exactly the same
way as an unknown address or a wrong password. Five refused attempts for one address
lock that address for a while.

A work address matches in its folded form, so `EMPLOYEE@EXAMPLE.COM` and its
full-width spelling both sign Iris Calder in. A look-alike address written with a
letter from another alphabet is a different address and is refused.

## What each role may do

- **Employee.** Raises corrections against their own days at `/requests/new`, reads and
  withdraws only their own requests.
- **Manager.** Raises their own corrections the same way, decides the requests their
  current direct reports raised, reads `/calendar` for those reports and shares a
  report's month. Never decides their own request.
- **People operations** (`admin@example.com`). Reads every request, the whole trail and
  every person's contact details, saves new policy versions at `/policy`, exports and
  checks the trail and shares anyone's month. Never approves or rejects anything.

## Where to start

- `/requests` — the queue, scoped to your role. Narrow it by state, correction type,
  person or month, search reason text, sort and page. The address bar carries all of it.
- `/requests/<id>` — one request in full: what the clock recorded, what is claimed and
  that day's leave. A manager decides it here; the raiser withdraws it here.
- `/requests/new` — a draft row at the head of the queue.
- `/calendar` — the month for your reports, with a shared read-only month link.
- `/policy` — the correction policy, its version history, the whole trail and its
  download.

Kestrel Works keeps the time of its home office, `Europe/London`. Every day is a
business date there and every claimed time is a business wall-clock time.

## Running the desk

| Step | Command |
| --- | --- |
| Install | `npm ci` |
| Build | `npm run build` |
| Serve | `node build/server.js` |

The desk reads its locations and credentials from the environment: `DATABASE_URL`,
`AUTH_ISSUER_URL`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_CLIENT_ID`,
`AUTH_CLIENT_SECRET`, `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`, `SIGN_IN_WINDOW_SECONDS`,
`SIGN_IN_LOCKOUT_SECONDS`, `SESSION_IDLE_SECONDS`, `SESSION_MAX_SECONDS`,
`SHARE_LINK_TTL_SECONDS`, `SHARE_LINK_MINTS`, `SHARE_LINK_MINT_WINDOW_MINUTES` and the
optional `EMPLOYER_SEEDED_ON`.

`GET /api/health` answers 200 once the schema, the seed and the realm accounts are all
in place, and 503 with a flag for each while the desk is still starting. The desk
starts even when postgres or the realm is down, and recovers without a restart.
