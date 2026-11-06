# Rostara Attendance Desk

Rostara is the internal desk where Kestrel Works (an invented employer on `Europe/London` business time) fixes
attendance records. Employees raise corrections against their own days, managers approve or reject their direct
reports' corrections (an approval rewrites that day's attendance), and people operations versions the correction
policy, reads and exports the whole trail and checks that its hash chain is intact. Managers and people operations can
share a read-only view of one person's month through a link (`/share/<token>`) that expires, can be revoked and dies
when it is replaced.

## Sign in

Open the desk at `APP_PUBLIC_URL` (the server listens on `APP_PUBLIC_PORT`, 4173 by default) and sign in at `/login`. Every seeded account
uses the shared password `deku-demo-pw-2026`.

| Work address | Name | Role | Password |
|---|---|---|---|
| admin@example.com | Priya Sahni | People operations | deku-demo-pw-2026 |
| manager@example.com | Dara Finch | Manager | deku-demo-pw-2026 |
| manager2@example.com | Omar Vance | Manager | deku-demo-pw-2026 |
| manager3@example.com | Lena Roth | Manager | deku-demo-pw-2026 |
| employee@example.com | Iris Calder | Employee (reports to Dara Finch) | deku-demo-pw-2026 |
| employee2@example.com | Tomas Berg | Employee (reports to Dara Finch) | deku-demo-pw-2026 |
| employee3@example.com | Nadia Kerr | Employee (reports to Dara Finch) | deku-demo-pw-2026 |
| employee4@example.com | Felix Arno | Employee (reports to Dara Finch) | deku-demo-pw-2026 |
| employee5@example.com | Suri Patel | Employee (reports to Omar Vance) | deku-demo-pw-2026 |
| employee6@example.com | Jonas Vale | Employee (reports to Omar Vance) | deku-demo-pw-2026 |
| employee7@example.com | Mira Okoye | Employee (reports to Omar Vance) | deku-demo-pw-2026 |
| employee8@example.com | Ravi Setu | Employee (reports to Omar Vance) | deku-demo-pw-2026 |
| employee9@example.com | Clara Mendt | Employee (reports to Lena Roth) | deku-demo-pw-2026 |
| employee10@example.com | Bo Lindqvist | Employee (reports to Lena Roth) | deku-demo-pw-2026 |
| employee11@example.com | Ayaan Qureshi | Employee (reports to Lena Roth) | deku-demo-pw-2026 |
| employee12@example.com | Greta Solis | Employee, deactivated (sign-in is refused) | deku-demo-pw-2026 |

## Run it

The commands are in `run.json`:

- install: `npm ci --package-lock-only=false` (a plain `npm ci` from the lockfile)
- build: `npm run build` (the React Router production build)
- serve: `NODE_ENV=production node server.mjs` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`)

On start the desk creates its schema, seeds the first state once (guarded across processes), and makes sure every
seeded account exists in the Keycloak realm. `GET /api/health` answers 200 once all three are in place and 503 with
the `schema`, `seeded` and `realm` flags until then. Postgres and the realm are retried every two seconds; neither
being down stops the server.

## Services and configuration

| Variable | Used for |
|---|---|
| `DATABASE_URL` | postgres, the only store (people, attendance, leave, requests, policy, trail, shared links, sessions, sign-in attempts) |
| `AUTH_ISSUER_URL`, `KEYCLOAK_URL`, `KEYCLOAK_REALM` | the Keycloak realm that checks every password |
| `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | the desk's confidential client (password grant and account self-registration) |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | where the desk listens and is reached (default 4173) |
| `SIGN_IN_WINDOW_SECONDS`, `SIGN_IN_LOCKOUT_SECONDS` | sign-in lockout window and length (default 900 each) |
| `SESSION_IDLE_SECONDS`, `SESSION_MAX_SECONDS` | session idle and absolute limits (default 1800 and 43200) |
| `SHARE_LINK_TTL_SECONDS` | how long a shared month link works (default 604800) |
| `SHARE_LINK_MINTS`, `SHARE_LINK_MINT_WINDOW_MINUTES` | the per-minter mint throttle (default 10 mints in 15 minutes) |
| `EMPLOYER_SEEDED_ON` | optional `YYYY-MM-DD` used only when seeding first runs |

The desk keeps no password: the realm alone checks them. Desk sessions are its own, stored in postgres; every sign-in
issues a new session and ends any session the request presented. Work addresses are compared in their folded form
(NFKC, then lower case). Phone numbers and private notes are read only by people operations, on a request's detail.
