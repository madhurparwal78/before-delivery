# Stillhour

A scroll story of the hour before sleep (21:00 to 22:00) that ends in a wind-down planner. Save a
bedtime and the rituals that lead up to it, confirm by email, and get one reminder each night when
your hour starts, in your own time zone.

## Run it

Needs Node 22, a PostgreSQL database and an SMTP server (Mailpit works).

```bash
npm ci
npm run build
DATABASE_URL=<postgres connection string> SMTP_HOST=<smtp host> SMTP_PORT=<smtp port> MAIL_FROM='Stillhour <goodnight@stillhour.example>' npm run start
```

The server listens on `0.0.0.0:${APP_PUBLIC_PORT:-4173}`. `GET /api/health` answers
`{"status":"ok"}`. The schema is applied automatically when the database is first reachable; the
server keeps running (and the story keeps working) while it is not.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required for saving) |
| `SMTP_HOST`, `SMTP_PORT` | mail server for confirmation, sign-in and reminder emails |
| `MAIL_FROM` | the From of every email (`Stillhour <goodnight@stillhour.example>`) |
| `APP_PUBLIC_PORT` | port to listen on (default 4173) |
| `STILLHOUR_PUBLIC_ORIGIN` | origin used in emailed links (default `http://localhost:<port>`) |
| `STILLHOUR_TEST_CLOCK` | `1` enables `PUT/DELETE /api/test/clock` for testing time rules |

It talks to two services only: PostgreSQL (the only system of record) and the SMTP server, through an
outbox table that retries every 10 seconds while mail is unreachable.

## Pages

| Path | What |
|---|---|
| `/` | the story; chapter six is the planner |
| `/manage` | sign in with an emailed link; change, pause, share or delete your hour |
| `/p/<token>` | a read-only shared hour |
| `/signin?token=…` | where emailed links land |
| `/privacy` | what is kept and how to delete it |

## Using it

1. Press **Begin the hour** (or **Begin in silence**) once loading finishes. The sound switch in the
   top bar turns the ambient sound on or off at any time.
2. Scroll. The clock in the top bar follows you from 21:00 to 22:00.
3. In **Build your hour**, add the rituals you want. They are kept in the page address.
4. In **Plan your Stillhour**, set your bedtime, check your time zone, adjust minutes (at most 60
   in total), add a note and your email, then **Save my hour**.
5. Open the confirmation link in your email. From then on you get one email when your hour starts.

With reduced motion set in your system, the story keeps every chapter and control but drops smooth
scrolling, the sideways section, letter effects and autoplaying clips.

## Development

`npm run typecheck` checks types; `npm run check` type-checks and builds. Media is regenerated with the scripts in
`scripts/media/` (they need ffmpeg and Python; the build does not).
