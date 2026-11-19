# NightWard Downtime: Strange & Unusual Activity

The event site for Downtime, NightWard's free five-day defensive security CTF. Visitors read the event page,
the scenario trail, the FAQ and the live leaderboard. Players sign up, form or join a team with an invite code,
submit flags for eight scenarios, earn raffle tickets, claim the webinar bonus and collect a certificate once
their team has solved everything. Captains remove members and issue new invite codes.

Pages are served at `/downtime` (event page), `/downtime/team`, `/downtime/scenarios/<slug>`,
`/downtime/certificate`, `/signup`, `/login`, `/` and the platform pages; the JSON interface lives under `/api`
on the same origin.

## Run it

`run.json` holds the three commands, run from this directory:

| Step | Command |
|---|---|
| install | `python3 -m venv .venv && .venv/bin/python -m pip install --require-hashes -r requirements.txt` |
| build | `.venv/bin/python -m compileall -q downtime` |
| serve | `.venv/bin/python -m downtime` (uvicorn in the foreground on `0.0.0.0:$APP_PUBLIC_PORT`) |

Each instance creates the schema and seeds the baseline itself on start, inside one transaction under a
PostgreSQL advisory lock, so several instances can start together against one database.

## Settings

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string; the only backing service | required |
| `APP_PUBLIC_PORT` | listen port | `4173` |
| `SIGN_IN_LOCK_SECONDS` | how long an email stays locked out of sign-in after ten failed attempts in a row | `900` |

The app talks only to the PostgreSQL database at `DATABASE_URL`. Sessions, throttles, locks and live events
all live there; live updates travel through PostgreSQL `LISTEN`/`NOTIFY`.

## Seeded logins

Every seeded account uses the password `deku-demo-pw-2026`.

| Email | Name | Team |
|---|---|---|
| `captain@example.com` | Rowan Vale | Lantern Watch (captain) |
| `teammate@example.com` | Imani Frost | Lantern Watch |
| `coldledger@example.com` | Mara Quill | Cold Ledger (captain, all eight solved) |
| `sasha@example.com` | Sasha Reyes | Grey Static (captain, team full at 20) |
| `quiethours@example.com` | Noor Ashby | Quiet Hours (captain) |
| `boneorchard@example.com` | Ilya Brandt | Bone Orchard (captain) |
| `nullharbor@example.com` | Dana Okafor | Null Harbor (captain, one place free) |
| `palesignal@example.com` | Kit Moreau | Pale Signal (captain) |
| `atticlights@example.com` | June Haldane | Attic Lights (captain) |
| `mothlight@example.com` | Ezra Pike | Moth Light (captain) |
| `cryptkeys@example.com` | Lena Sorel | Crypt Keys (captain) |
| `staticchoir@example.com` | Omar Fenn | Static Choir (captain) |
| `graveshift@example.com` | Pia Lund | Grave Shift (captain) |
| `nightledger@example.com` | Cal Rook | Night Ledger (captain) |
| `hollowport@example.com` | Bea Strand | Hollow Port (captain) |
| `dustindex@example.com` | Ivo Lark | Dust Index (captain) |
| `lastlamp@example.com` | Rhea Doyle | Last Lamp (captain) |
| `greystatic01@example.com` … `greystatic19@example.com` | Grey Static Player 01 … 19 | Grey Static |
| `nullharbor01@example.com` … `nullharbor18@example.com` | Null Harbor Player 01 … 18 | Null Harbor |
| `solo@example.com` | Theo Marsh | no team |
