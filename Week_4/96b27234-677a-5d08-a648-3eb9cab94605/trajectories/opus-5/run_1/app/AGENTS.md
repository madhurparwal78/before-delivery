# Hearthtile — repository notes

Hearthtile is a browser gathering place: paper-cut 3D rooms walked tile by tile, proximity chat,
safety tools, communities and scheduled gatherings. TypeScript on Node 22, no framework.

## Shape of the code

```
src/server/        HTTP, WebSockets, domain rules, service clients
  domain/          one place per rule: layout.ts (tiles/steps), earshot.ts, ranks.ts, glb.ts,
                   glbgen.ts, visibility.ts, votes.ts, gatherings.ts, zones.ts
  routes/          thin handlers; refusal texts live beside the rule they guard
  services/        valkey.ts, storage.ts (own SigV4 S3 client), mail.ts (own SMTP client), outage.ts
  sessions.ts      session lifecycle, stepping, sitting, chat, mirror projection
  voting.ts        removal votes;  duework.ts  votes/departures/reminders that fall due
  sockets.ts       /ws/me and /ws/sessions/<id> fan-out, projected per viewer
  seed.ts          invented seed data, applied once when all services are reachable
src/client/        vanilla DOM single-page app; pages/ one module per screen
  room/            scene.ts (three.js), sheet.ts, ripple.ts
src/shared/        zone table shared by server and client
public/            index.html, styles.css, bundled app.js (built by esbuild from dist/client)
```

Build: `npm run build` → `tsc` into `dist/`, then esbuild bundles `dist/client/main.js` into
`public/app.js`. Serve: `npm run start` (`dist/server/main.js`), binds `0.0.0.0:4173`.

## Decisions worth remembering

- **Four services only.** Postgres holds every lasting record; MinIO holds model bytes at
  `assets/<assetId>/v<version>.glb`; Valkey holds presence, tile claims, place claims and the
  cross-instance channels; Mailpit receives mail from the `mail_outbox` table.
- **Tile and place claims** run as Lua scripts in Valkey (`claimTile`, `claimPlace`) that seed
  themselves from a Postgres snapshot when the key is missing, so one tile has one winner across
  instances even after Valkey restarts.
- **World clocks** live in `worlds.held_now`; every server time rule reads `worldNow(worldId)`.
  `POST /api/grading/clock` sets it and then runs all due work before answering.
- **Outages** are simulated through the same code path as real failures: `services/outage.ts`
  flags make the Valkey and S3 clients throw `ServiceDownError`.
- **Error order** (401 → 404 → 409 → 422 → 429) is applied inside each handler; anything the
  caller may not open answers 404, never 403.
- **The browser never recomputes a server decision.** Statuses, ranks, recipients and vote
  outcomes come from the API; the page only renders them. Distances used for `N`/`M` and the
  nearby announcement are drawn from the mirror tiles the server published.
- **Page timers only.** Hold repeat, announcement spacing, ripple growth, sheet exit and socket
  reconnect use `setTimeout`, never `requestAnimationFrame`, so a paused page clock controls them.
  The 3D scene renders synchronously on every state change.
- Two additions beyond the endpoint list were needed to render published controls faithfully:
  `GET /api/safety` (so `dialog "Person actions"` can show Block/Unblock and Mute/Unmute) and a
  `measureRanks` field on upload/version payloads (so `table "Measures"` can show each measure's
  own rank without recomputing a server decision).

## Verifying changes

With the services up:

```
npm run build && node dist/server/main.js
```

Ad-hoc suites used during development live outside the repository (`/tmp/verify`): API checks with
`fetch` and browser checks with Playwright (layouts at 375x812, 768x1024 and 1280x800, keyboard
walking, sheet behaviour, ripple timing on a paused clock, reduced motion, two-instance mirrors).
Extra instances for cross-instance work: `APP_PUBLIC_PORT=4174 INSTANCE_NAME=b`, and
`STEP_MIN_INTERVAL_MS=2000 DROP_GRACE_SECONDS=2` for pacing and grace.
