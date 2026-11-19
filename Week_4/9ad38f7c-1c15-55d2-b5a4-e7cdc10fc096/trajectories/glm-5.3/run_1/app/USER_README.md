# NightWard Downtime — Strange & Unusual Activity

The event site for Downtime, NightWard's free, five-day defensive security CTF.

## Running

```sh
.venv/bin/python -m server --host 0.0.0.0 --port ${APP_PUBLIC_PORT:-4173}
```

The app reads these environment variables at start:

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_PUBLIC_PORT` | listen port, default `4173` |
| `SIGN_IN_LOCK_SECONDS` | sign-in lock time in whole seconds, default `900` |

Pages are served on the same origin as the JSON interface: the event page at
`/downtime`, the team room at `/downtime/team`, a scenario at
`/downtime/scenarios/<slug>`, the certificate at `/downtime/certificate`, and
the account pages at `/signup` and `/login`.

## Seeded logins

Every seeded account uses the password **`deku-demo-pw-2026`**. Emails are
lower-case.

| Email | Display name | Team |
|---|---|---|
| `captain@example.com` | Rowan Vale | Lantern Watch (captain) |
| `teammate@example.com` | Imani Frost | Lantern Watch |
| `solo@example.com` | Theo Marsh | none |
| `coldledger@example.com` | Mara Quill | Cold Ledger (captain, finished all eight) |
| `greystatic@example.com` | Sasha Reyes | Grey Static (captain, team full) |
| `greystatic01@example.com` … `greystatic19@example.com` | Grey Static Player 01 … 19 | Grey Static |
| `nullharbor@example.com` | Dana Okafor | Null Harbor (captain, one place free) |
| `nullharbor01@example.com` … `nullharbor18@example.com` | Null Harbor Player 01 … 18 | Null Harbor |
| `quiethours@example.com` | Noor Ashby | Quiet Hours (captain) |
| `boneorchard@example.com` | Ilya Brandt | Bone Orchard (captain) |
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

The webinar flag is shared during the webinar. No seeded player has claimed the
webinar bonus.

## Sign-in lock

After ten failed sign-ins in a row for one email, further sign-ins for that
email answer `429 too_many_attempts` for `SIGN_IN_LOCK_SECONDS` seconds. The
default is fifteen minutes (`900`). Set the variable to change it.
