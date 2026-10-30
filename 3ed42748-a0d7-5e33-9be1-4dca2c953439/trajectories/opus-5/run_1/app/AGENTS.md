# Parcel Moon — repository notes

A courier game on Bramble, by Kitefold. Node 22, TypeScript everywhere, Postgres for all game
state, MinIO for postcard images, Mailpit for every email. No other datastore.

## Running it

```
npm install      # install
npm run build    # build (esbuild: server bundle, three client bundles, CSS, fonts)
npm run start    # serve on APP_PUBLIC_PORT (default 4173)
npm run typecheck
```

`run.json` holds the same three commands under `install`, `build` and `serve`.

Every service credential and URL comes from the environment and never reaches the browser:
`DATABASE_URL`, `S3_*`, `SMTP_*`, `MAIL_FROM`, `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`,
`POSTBOX_KEY_TTL_SECONDS`, `RUSH_HOLD_SECONDS`, `POSTCARD_MAIL_WINDOW_SECONDS`.

## Where each domain rule lives

Each rule is decided in exactly one place. When changing behaviour, change it there.

| Rule | File |
| --- | --- |
| Error shape, codes, statuses | `src/server/http/errors.ts` |
| Error precedence, role refusals | `src/server/http/app.ts` |
| Own origins, body limits, content types, cookies | `src/server/http/boundary.ts` |
| Published request fields, positions | `src/server/domain/requestFields.ts` |
| Arc and bearing maths | `src/shared/geo.ts` |
| Display-name folding, NFC, counting | `src/shared/displayNames.ts` |
| Accepted return paths | `src/shared/returnPaths.ts` |
| Time zones, board date, studio wall time | `src/shared/studioClock.ts` |
| Mission fields, lifecycle, versions, revisions | `src/server/domain/missions.ts` |
| Board posting, rush rows, rush count, holds | `src/server/domain/board.ts` |
| Open-parcel check, repeats, acceptances | `src/server/domain/parcels.ts` |
| Ticket storing, waiting and replay | `src/server/domain/tickets.ts` |
| Ledger pairing, balance, history paging | `src/server/domain/ledger.ts` |
| Heartbeats, emote window, presence listing | `src/server/domain/presence.ts` |
| Mute, unmute, rename, audit snapshots | `src/server/domain/moderation.ts` |
| Postbox keys, guest save merge | `src/server/domain/postboxKeys.ts` |
| PNG chunk walk and inflated size | `src/server/domain/png.ts` |
| Postcard records, mail slots, clean-up | `src/server/domain/postcards.ts` |
| Sessions and rotation | `src/server/domain/sessions.ts` |
| Camera rigs and clearance | `src/client/game/world/cameras.ts` |
| Thread phases, reduced motion, attributes | `src/client/game/scene.ts` |
| Presence entries matched to drawn figures | `src/client/game/figures.ts` |
| Console URL and the editor | `src/client/console/main.ts` |
| Every line of feedback copy | `src/client/game/copy.ts` |

## Things worth remembering

- Ticket replays use a Postgres advisory transaction lock keyed by courier, namespace and
  ticket, so simultaneous repeats queue and answer identically. Only a success is stored.
- `acceptances.answer` and `tickets.response` are `json`, not `jsonb`, so replays come back
  byte for byte.
- Expiry is judged from the request's own `now`, never from a background job. A lapsed rush
  hold is materialised in the transaction of the next claim.
- The ribbon must come out at exactly `rgb(31, 127, 122)`; nothing else in the world may be
  within 24 of it on each channel. The `tidewater` satchel is deliberately far from it.
- Outline shells keep the original winding and are drawn with `gl.FRONT` culled. Reversing both
  makes the shell cover the shape.
- `[hidden]` needs `display: none !important` because the overlay classes set `display`.
- Headless Chromium with software WebGL runs this scene at roughly 23 frames a second.

## Checks that have been run

Browser checks use `playwright-core` with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`. They cover the camera
rigs, the clear zone at three viewports, the ribbon pixels beside the door, the rush lapse,
reduced motion changing mid-walk, hidden-page resumption, the console's URL and focus rules,
photo mode and the moderation drawer.
