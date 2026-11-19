# Hearthtile — project memory

A complete paper-cut gathering-place app: TypeScript + Express + three.js client,
Postgres (schema applied idempotently at boot), MinIO via a hand-rolled SigV4 S3
client, Valkey via a hand-rolled RESP client, and SMTP mail through an outbox.

## Architecture map
- `src/server/app.ts` — server boundary (same-origin, 64k JSON limit, 1MB setup
  limit, 51MB multipart, never-served paths, error order). Express 4 does not
  catch async throws: `wrapAsync()` patches every route handler.
- `src/server/providers.ts` — S3 + Valkey clients. The Valkey subscription
  socket must consume simple replies (`+OK` from AUTH) before `*` frames or
  pub/sub frames are never parsed (this caused a total loss of live events).
  AUTH needs the username from the URL when one is present.
- `src/server/sessions.ts` — session lifecycle, step/sit/stand, votes, and the
  Valkey lock used for one-tile-one-winner and last-capacity-place.
- `src/server/world.ts` — per-world held clocks; grading outages are
  per-instance flags.
- `src/server/zones.ts` — hand-printed zone abbreviations and display format.
  DST rules per region: US second Sunday March/first Sunday November (in local
  time), EU last Sunday March/October (UTC), Sydney inverted. `resolveLocal`
  verifies each candidate against the zone's own offset; a repeated hour picks
  the first occurrence, a gap moves forward by one hour with its note.
- `src/shared/glb.ts` — the single place ranks are decided. Generated GLBs
  control material count and embedded PNG size to land in a target rank.
- `src/server/glbgen.ts` — generates original GLBs per rank. Padding the JSON
  chunk must append to a string, never `Buffer.write` (that writes in place and
  loops forever).
- `src/client/room.ts` — the room page: mirror, keyboard, hold repeat, sheet,
  announcements, ripple. Mirror updates only on server messages and API reads.

## Grading instances
Primary 4173 (STEP_MIN_INTERVAL_MS=0), plus 4174 second-instance, 4175
minio-down, 4176 valkey-down, 4177 short-timers (2000ms step interval, 2s
drop grace). Health answers `unavailable` (never 503) when a service is out.

## Testing seams used during the build
`/api/grading/setup` builds a whole world; the clock route runs everything due
before answering. Test suites live in /tmp (e2e, boundary, contention, votes,
rules, accounts, reminders, browser-test, browser-advanced, visual-test,
interactions) and all pass against a fresh boot.
