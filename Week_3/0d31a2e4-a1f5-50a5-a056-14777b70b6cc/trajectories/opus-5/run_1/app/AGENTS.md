# Pratfall Cup — repository notes

Browser party-royale for squads of two to four. One origin, one build, one region.
Node 22 + TypeScript everywhere, PostgreSQL as the only datastore, Mailpit for account mail.

## Layout

```
src/shared/      domain rules shared by server and browser
  rounds.ts      round kinds, names, labels, slot counts, time limits, tick rate
  hue.ts         the bean hue rule
  sim/course.ts  deterministic course generation from a round's seed
  sim/engine.ts  the fixed-tick 3D simulation (live rounds, frames and /api/simulate)
  sim/ranking.ts rank order and slots-left, used by the engine and the live HUD
src/server/      http router, routes, services, ws hub, schema, seed
src/client/      React app: lib (store, api, copy, voice), components, pages, three
public/fonts     self-hosted OFL fonts
```

Build: `npm run build` compiles the server with `tsc` into `dist/server` and the browser
app with Vite into `dist/client`. `npm start` serves both from one port (4173 or
`APP_PUBLIC_PORT`).

## Rules that live in exactly one place

- Bean hue: `shared/hue.ts` (`hueForUserId`), used by the API, SVG beans and 3D meshes.
- Round names, kind labels, slot counts, time limits: `shared/rounds.ts`.
- Simulation, qualification, falls, forfeits: `shared/sim/engine.ts`.
- Rank order and slots left: `shared/sim/ranking.ts`.
- Error shape: `server/errors.ts` (`AppError`, `fail.*`, `validationFailed`,
  `invalidTransition`). No endpoint builds its own shape.
- Party and lobby state machines: `server/services/parties.ts`,
  `server/services/matchmaking.ts`. Both decide through PostgreSQL row locks so the
  rules hold across server processes.
- Feedback copy: `client/lib/copy.ts`.

## Things worth remembering

- The live match loop (`server/services/matchrunner.ts`) applies the effective inputs for
  the current tick, stores them, then steps. Replays re-run the same engine from the
  stored seed, inputs and forfeits, so frames and stored results always agree.
- Course knocks are tuned so a bean can never be thrown off the side of a linear course
  and a bumper cannot trap it: a bumper hit grants a short immunity window.
- The photo-finish reads frames from the server; the browser only interpolates between
  the positions it was given.
- Presence lives in memory (`server/ws/hub.ts`): a player is connected while their
  heartbeats are fresher than 15 seconds.
- Voice is a WebRTC mesh with `iceServers: []` (host candidates only). The server only
  relays signalling between party members who are both in voice.

## Checking the app

A server must be running (`npm start`) with PostgreSQL and Mailpit reachable. The seeded
players all use the password `Bounce-Seed-2026` and the email `<handle>@wobblewell.test`.
`GET /api/health` reports `{"status":"ok"}` once the schema is applied.
