# Hushfoot — repository notes

A browser game of family wildlife photography across five invented islands. TypeScript throughout,
Node's own `http` server, Postgres, MinIO and Mailpit, three.js bundled from npm.

## Shape of the code

| Path | What lives there |
|---|---|
| `src/shared/` | Domain rules shared by server and browser: island grids, the creature table, the route rule, the frame rule, the score, the world clock, the movement rule and path finding, the error catalogue, every published string with a live value. |
| `src/server/` | Config from the environment, Postgres layer, MinIO and Mailpit adapters, the router, the live stream, `domain/` for each aggregate, `routes/` for the API and the HTML pages, `views/` for server-rendered HTML. |
| `src/client/` | One bundle, dispatched by `main.ts` on the page named in the `#bootstrap` JSON. `play.ts` and `panels.ts` carry the play page; `scene.ts` is the three.js world; `guide.ts` is Wump on the title screen. |
| `src/public/` | `app.css`, copied into `dist/public` at build time with the Albert Sans `woff2` files. |

Each domain rule is decided in exactly one place:

- route rule — `src/shared/route.ts`
- frame rule and subject order — `src/shared/frame.ts`
- score — `src/shared/score.ts`
- world clock, dusk and rain — `src/shared/clock.ts`
- movement, jumps and the shortest path — `src/shared/movement.ts`
- album pages and stamps — `src/server/domain/albums.ts`
- film ledger pairs — `src/server/domain/film.ts`

## Running it

```
npm ci && npm run build && npm run start      # binds 0.0.0.0:4173, honours APP_PUBLIC_PORT
npm run typecheck                             # strict, with unused locals and parameters
```

`GRADING_ROUTES=on` adds `POST /api/grading/world` and `POST /api/grading/clock`.

## Things worth remembering

- **Page time.** Everything the browser animates or delays runs on `requestAnimationFrame`,
  `performance.now`, `setTimeout` or `setInterval`, so a paused page clock freezes it. There is no
  service worker and no Web Worker. Live changes are applied inside the `EventSource` message
  handler, never on a page timer.
- **Fixed steps.** `Walker` in `src/shared/movement.ts` advances in 100 ms steps. A key counts as
  held for a step when it went down before the step's moment and came up at or after it, which
  `Holds` in `src/client/steps.ts` records. Holding for N × 100 ms always gives N steps.
- **Photo pipeline.** `keepPhoto` opens one transaction, locks the player row, checks film, waits
  for MinIO to confirm the object, then writes the photo, the album change, the film pair and the
  live events together.
- **Request keys.** `withRequestKey` in `routes/api.ts` replays a stored answer before any other
  check, then runs the published pre-checks, and only then treats other content under the same key
  as a conflict. Photos report `shot_key_reused`, notes and postcards `request_key_reused`.
- **Live stream.** `GET /api/live` polls the `events` table and the world row, so a change made on
  one instance reaches pages served by another. It never holds a transaction between pushes.
- **Rendering cost.** The scene skips its draw call when reduced motion is on and nothing moved, so
  two captures a second apart are identical. The gallery hall redraws only when the visitor's pose
  changes. Software rendering in a test container runs at a few frames a second otherwise.
- **The play page has no site header**, because the published Tab order starts at
  `Skip to the text world` and then `World view`.
- **Figures** (`data-figure`) are hidden from assistive technology; the announcements carry the
  values. `countTo` guarantees a value strictly between at 300 ms and the exact final text at 600 ms.

## Verification notes

Deterministic movement, path and jump behaviour is easiest to check by bundling
`src/shared/movement.ts` with esbuild and stepping the `Walker` by hand, rather than through a
browser whose frame rate drifts under software rendering.
