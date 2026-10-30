# Kinora Video Studio

Kinora is an AI video studio for creators and small teams. The public site explains the studio
and its credit plans; the signed-in studio is where a member writes a prompt, picks a model, a
length and a shape, and starts a generation that is paid for in credits from one shared
workspace balance.

The app is reachable at `APP_PUBLIC_URL` (the server listens on `0.0.0.0:$APP_PUBLIC_PORT`).

## Seeded accounts

**Every seeded account uses the password `deku-demo-pw-2026`.**

| Email | Password | Name | Role | Workspace |
|---|---|---|---|---|
| `owner@example.com` | `deku-demo-pw-2026` | Mara Quinn | Owner | Northlight Studio (Team plan, 13,664 credits) |
| `member@example.com` | `deku-demo-pw-2026` | Theo Park | Member | Northlight Studio (Team plan, same shared balance) |
| `creator@example.com` | `deku-demo-pw-2026` | Ines Duarte | Owner | Ines Duarte's workspace (Standard plan, 595 credits) |

Sign in at `/login`. Anyone can create a new owner account at `/signup`; a member account is only
created by accepting a team invitation.

## What to try

1. **Pricing** — `/pricing` opens on Individual and Yearly. Flip "Yearly billing" to see Standard
   at `$15` /month, flip it back for `$12` with `$15` struck through.
2. **Sign up and generate** — press "Start Free", create an account, and you land on `/studio`
   with 125 credits. Write a prompt, choose Vela 4.5 and "10 seconds" (the cost line reads
   "This will use 120 credits") and press "Generate". The balance drops to 5 credits at once and
   the card renders to Ready within half a minute.
3. **Cancel for a full refund** — sign in as `creator@example.com`, start a 5 second Vela 4 Turbo
   generation (30 credits) and press "Cancel" while it is rendering. The toast reads
   "Cancelled. 30 credits returned." and `/studio/credits` shows "Refund +30" above "Generation -30".
4. **Invite a teammate** — sign in as `owner@example.com`, open Team, press "Invite teammate".
   The invitation arrives as real email in Mailpit; following the link and pressing "Join team"
   adds one seat of 6,900 credits to the shared balance.
5. **Enterprise enquiry** — `/enterprise-contact` sends one email to `sales@example.com` and one
   acknowledgement to the address on the form.

## Credits

Credits are whole numbers and one balance is shared by every member of a workspace.
Vela 4.5 costs 12 credits a second, Vela 4 Turbo 6 credits a second and Vela Image 4 8 credits an
image. A generation is charged exactly once (a repeated `Idempotency-Key` never charges twice),
the balance never goes below zero, and cancelling a Queued or Rendering generation returns its
full cost exactly once.

## Running it

```
npm install     # install
npm run build   # production build (browser app, SSR bundle and server)
node dist/server/server/main.js   # serve
```

The same three commands are in `/app/run.json`. The app reads `DATABASE_URL`, `SMTP_HOST`,
`SMTP_PORT`, `APP_PUBLIC_URL` and `APP_PUBLIC_PORT` from the environment, creates its schema and
seeds the three accounts above on first start. Seeding is idempotent: restarting adds nothing.

`GET /api/health` answers 200 once the app can reach PostgreSQL.
