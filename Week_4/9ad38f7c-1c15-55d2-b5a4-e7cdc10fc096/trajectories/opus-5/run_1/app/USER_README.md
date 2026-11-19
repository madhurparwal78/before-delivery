# Downtime: Strange & Unusual Activity

A free five-day defensive security capture-the-flag event site for NightWard.
The event page lives at `/downtime` and the JSON interface under `/api`, both on
one origin.

## Running it

```sh
# installs into /app/.venv
python3.12 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
# serves on 0.0.0.0, on the port in APP_PUBLIC_PORT (4173 by default)
.venv/bin/python -m server --host 0.0.0.0 --port ${APP_PUBLIC_PORT:-4173}
```

The commands are also in `/app/run.json` as `install`, `build` and `serve`. Each
instance creates its schema and writes the baseline seed itself at start, so no
manual step is needed and several instances may start together against one
database.

## Settings

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | none, required |
| `APP_PUBLIC_PORT` | listen port | `4173` |
| `SIGN_IN_LOCK_SECONDS` | how long an email is locked out of sign-in after ten failures in a row | `900` (fifteen minutes) |

`SIGN_IN_LOCK_SECONDS` is read at start. Ten failed sign-ins in a row for one
email answer `429 too_many_attempts` with a `Retry-After` header until the lock
time has passed, whichever instance the attempts reach.

## Seeded logins

Every seeded person, team and company is invented. **Every seeded user's password
is `deku-demo-pw-2026`.**

| Email | Display name | Team | Role |
|---|---|---|---|
| `captain@example.com` | Rowan Vale | Lantern Watch | captain, two scenarios solved |
| `teammate@example.com` | Imani Frost | Lantern Watch | member, no completions |
| `solo@example.com` | Theo Marsh | none | teamless player |
| `coldledger@example.com` | Mara Quill | Cold Ledger | captain of a finished team, certificate ready |
| `sasha@example.com` | Sasha Reyes | Grey Static | captain of a full twenty-member team |
| `quiethours@example.com` | Noor Ashby | Quiet Hours | captain, five scenarios solved |
| `boneorchard@example.com` | Ilya Brandt | Bone Orchard | captain |
| `nullharbor@example.com` | Dana Okafor | Null Harbor | captain of a nineteen-member team, one place free |
| `palesignal@example.com` | Kit Moreau | Pale Signal | captain |
| `atticlights@example.com` | June Haldane | Attic Lights | captain |
| `mothlight@example.com` | Ezra Pike | Moth Light | captain |
| `cryptkeys@example.com` | Lena Sorel | Crypt Keys | captain |
| `staticchoir@example.com` | Omar Fenn | Static Choir | captain |
| `graveshift@example.com` | Pia Lund | Grave Shift | captain |
| `nightledger@example.com` | Cal Rook | Night Ledger | captain |
| `hollowport@example.com` | Bea Strand | Hollow Port | captain |
| `dustindex@example.com` | Ivo Lark | Dust Index | captain, no points |
| `lastlamp@example.com` | Rhea Doyle | Last Lamp | captain, no points |

Grey Static also holds `greystatic01@example.com` to `greystatic19@example.com`,
and Null Harbor holds `nullharbor01@example.com` to `nullharbor18@example.com`.
All of them use the same password.

Seeded invite codes: `LANTERN1` (Lantern Watch), `COLDLEDG` (Cold Ledger),
`GREYSTAT` (Grey Static, full), `NULLHARB` (Null Harbor, one place free),
`QUIETHRS`, `BONEORCH`, `PALESIGN`, `ATTICLIT`, `MOTHLITE`, `CRYPTKEY`,
`STATICCH`, `GRAVESHF`, `NIGHTLDG`, `HOLLOWPT`, `DUSTINDX`, `LASTLAMP`. A
captain's "New invite code" or any member removal replaces a team's code.

## Scenario flags, for trying the site out

| # | Scenario | Points | Flag |
|---|---|---|---|
| 01 | Repossessed | 500 | `flag{nine_alerts_one_build}` |
| 02 | Quiet As The Grave | 500 | `flag{hypothesis_held}` |
| 03 | Deadmen Tell No Logs | 500 | `flag{irregularities_logged}` |
| 04 | Handbook For The Recently Compromised | 60 | `flag{timeline_rebuilt}` |
| 05 | The Waiting Room | 80 | `flag{payment_run_traced}` |
| 06 | Day-O | 90 | `flag{payload_unpacked}` |
| 07 | Strange & Unusual Activity | 100 | `flag{dns_whispers}` |
| 08 | Dead Endpoint | 120 | `flag{gallery_restored}` |

The webinar bonus flag is `flag{comfort_zone_exit}` and is worth two raffle
tickets, once per player. Only each flag's SHA-256 is stored, and no endpoint
ever returns a flag.

Five wrong flags in a row from one player on one scenario lock that player out of
that scenario for sixty seconds.

## Checks

`/app/tests` holds the checks. They need a running instance and, for the browser
suites, Playwright outside the application. `tests/full.sh` resets the database,
starts one instance and runs every suite; `tests/cluster_checks.py` starts extra
instances and takes the database away and gives it back.
