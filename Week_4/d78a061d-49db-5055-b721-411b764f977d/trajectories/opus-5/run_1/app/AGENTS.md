# Linewright — repository notes

Browser game: build a stick-figure hero, draw a weapon that becomes a 3D object,
play one solo story and two co-op stories with friends, entirely in English,
日本語 or Español.

## Running it

```
npm ci          # install (run.json: install)
npm run build   # server bundle + client bundle + fonts + icon sprite (run.json: build)
npm run start   # serves API, realtime socket and built assets on APP_PUBLIC_PORT (run.json: serve)
npm run typecheck
node scripts/notices.mjs   # regenerates THIRD_PARTY_NOTICES.md from the prod tree
```

`GET /api/health` answers 200 only once Postgres is connected; the app boots and
stays healthy while MinIO or the SMTP server is unreachable.

## Layout

- `src/shared` — code both sides use: the three translation sources
  (`i18n/{en,ja,es}.ts`), constants, types, grapheme counting, the pose
  degree↔radian rounding and the drawing-plane coordinate mapping.
- `src/server` — HTTP server (`index.ts`), route table (`routes/index.ts`),
  one error shape (`errors.ts`), locale resolution (`locale.ts`), page routing
  and the HTML shell (`pages.ts`), schema and seed (`db.ts`, `seed.ts`).
  - `domain/` — hero validation, weapon stat formulas, party state machine,
    progress and checkpoints.
  - `models/` — GLB reader, rulebook `2026.11-r1`, R04 triangle count, image
    sizes, PNG thumbnail renderer.
  - `sessions/engine.ts` — the authoritative 20-tick world, drops, grace, seats.
  - `realtime/` — WebSocket hub, event streams with persisted seq, the
    Postgres LISTEN/NOTIFY bus that lets several copies share one database.
  - `storage/s3.ts` — small SigV4 client for MinIO. `mail/` — small SMTP client.
- `src/client` — SPA shell (`main.ts`), one module per screen under `screens/`,
  three.js scene under `scene/`, chat panel, realtime client, `app.css`.

## Rules that live in exactly one place

| Rule | Where |
| --- | --- |
| Locale resolution | `src/server/locale.ts` |
| Weapon stats, limits, vertex count | `src/server/domain/weapon.ts` |
| Rulebook checks | `src/server/models/rulebook.ts` (+ `triangles.ts` for R04) |
| Degrees ↔ stored radians | `src/shared/pose.ts` |
| Drawing-plane pixels ↔ metres | `src/shared/plane.ts` |
| Tick step, grace, seats in session | `src/server/sessions/engine.ts` |
| Party transitions, leader succession, ready check | `src/server/domain/party.ts` |
| Chat rate limit | `src/server/chat.ts` |
| Upload state machine, all-or-nothing delete | `src/server/routes/models.ts` |
| Page routing (404 vs sign-in redirect) | `src/server/pages.ts` + `index.ts` |
| Latest drawing revision wins | `src/client/screens/forge.ts` |

## Things worth remembering

- The realtime hub attaches its socket listeners **before** any await, otherwise
  a client that sends `hello`/`join_session` on open loses those frames.
- Ping liveness counts missed pings per connection on one interval. Never pair a
  per-ping `setTimeout` with the interval: the two race and close healthy
  connections, which looks like players dropping every few seconds.
- A chat message is its own stream event: its `seq` comes from the channel's
  counter and the event is published with that seq (never a second allocation).
- Session state is written every tick, so a resumed session never replays a tick.
- Live regions must stay in the accessibility tree while empty — do not hide
  them with `:empty { display: none }`.
- The forge keeps the drawing plane in the DOM after `socketed` (invisible, not
  `hidden`) so its scene-state attributes stay readable.
- Outgoing chat messages sit in a queue keyed by client message ID; entries are
  removed by identity, never by position.
- Seed accounts: `aiko|mateo|robin|sol|kenji|noa|lucia|haru@linewright.test`
  with passwords `paper-lantern-01` … `-08`. Locales: aiko/kenji/haru `ja`,
  mateo/lucia `es`, the rest `en`.
