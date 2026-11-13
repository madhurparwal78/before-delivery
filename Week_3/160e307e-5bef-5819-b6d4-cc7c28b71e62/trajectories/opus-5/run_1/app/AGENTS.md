# Due Coin — repository notes

Carrom singles, refereed in the open. One TypeScript server plus its browser client,
PostgreSQL as the only datastore, Mailpit for magic sign-in links.

## Layout

```
run.json                 install / build / serve manifest
build.mjs                typecheck, then esbuild server + client + CSS + fonts
src/shared/              the one place each domain rule lives (browser and server both import it)
  geometry.ts            board, pockets, pieces, baselines, opening layout, aim maths
  physics.ts             dc-model-1: fixed step, exact-time collisions, pocket capture
  laws.ts                placement legality, return spots, the laws of a shot, board scoring
  shot.ts                playShot: dc-model-1 then the laws; intent validation; aim guide
  rating.ts chalk.ts     Glicko-2; chalk award rules
  catalogue.ts names.ts queue.ts room.ts types.ts
src/server/              env, db, http boundary, match engine, rooms, queue, shop, grading, ws
src/client/              router, screens, procedural SVG board, match controller
```

## Invariants worth keeping

- **One rules module.** `src/shared` holds every domain rule. `src/server/match.ts`,
  `src/server/local.ts` and `src/client/localgame.ts` all call the same `playShot` and
  `ruleShot`. Never copy a constant or a ruling out of `src/shared`.
- **The board renders exactly 740 mm per side.** `src/client/board.ts` uses
  `viewBox="-370 -370 740 740"`, so screen pixels convert straight to board millimetres.
  Touch drags depend on this.
- **Positions are rounded to one decimal when committed.** The simulation rounds its final
  positions, so a replayed shot log is byte-identical.
- **The server alone decides time.** Pages count down from `turnRemainingMs`,
  `reconnectRemainingMs` and `expiresInMs`; they never compare a server time with the
  device clock.
- **Only `GET /api/config` reaches the browser with timer values.** No credential, address
  or grading key is ever bundled.
- **Error precedence** is implemented in `src/server/index.ts` (`onRequest`) in the
  published order: cross-origin, grading key, body size and type, database, not found,
  forbidden, rate limit, idempotent replay, client outdated, state conflicts, validation.

## Running locally

```
npm ci && npm run build && npm run start      # port 4173, or APP_PUBLIC_PORT
```

Extra copies used while checking behaviour:

```
SHOT_TIMER_SECONDS=4 RECONNECT_SECONDS=6 BAND_WIDEN_SECONDS=2 ROOM_EXPIRY_SECONDS=6 \
REMATCH_SECONDS=6 TOSS_SEED=0 APP_PUBLIC_PORT=4273 npm run start   # short timers
DATABASE_URL=postgresql://nope@127.0.0.1:1/none APP_PUBLIC_PORT=4373 npm run start
SMTP_HOST=127.0.0.1 SMTP_PORT=1 APP_PUBLIC_PORT=4473 npm run start
```

## Verified against the published set-ups

- A coin at (330, 330) at 300 mm/s into `se` is pocketed; a striker alone at aim 180 and
  power 1.0 never passes 349.35 and ends on the board; the aim guide reports `w5` at
  offset 0.0 and `cushion` at offset -200.0.
- Glicko-2: two new players become 1662.31 / 1337.69 (RD 290.32); 1520/120 beating
  1600/100 gives 1563.84 (114.63) and 1569.20 (97.20).
- Board scoring: a covered queen with 4 opponent coins left at 10 points scores
  `7 points: 4 coins left + 3 for the queen`; the same at 22 scores `4 points: 4 coins left`.
