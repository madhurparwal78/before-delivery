# Keyway Bench — repository notes

Tumbler & Pin Co. Keyway Bench: a browser 3D bench where escape-room owners lay a
room out in millimetres, wire its puzzle chain, run remote playtests and freeze a
build pack for the carpenter.

## Running it

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (typecheck, then esbuild for server and client) |
| serve | `node dist/server.js` (binds `0.0.0.0:${APP_PUBLIC_PORT:-4173}`) |

`/app/run.json` holds those three commands. `scripts/notices.mjs` regenerates
`THIRD_PARTY_NOTICES.md` from the production dependency tree.

Services come from the environment only: `DATABASE_URL`, the `S3_*` variables,
`VALKEY_URL`, `SMTP_HOST`/`SMTP_PORT`/`MAIL_FROM`, `APP_PUBLIC_URL`,
`APP_PUBLIC_PORT`, `PLAYTEST_DURATION_SECONDS`, `HINT_COOLDOWN_SECONDS`,
`LOCK_TTL_SECONDS`, `INSTANCE_NAME`.

## Layout

```
src/shared/    units, chain order and figures, published copy, types, starter rooms
src/server/    config, errors, http, domain/, repo/, routes/, services/
src/client/    main router, api, queue, live, stage/, views/ (editor, tester, pack, public)
scripts/       build.mjs, notices.mjs
```

## Where each domain rule lives (one place each)

| Rule | File |
|---|---|
| millimetres → metres / feet and sixteenths | `src/shared/units.ts` |
| chain order, longest run, loop check | `src/shared/chain.ts` |
| chain figures (solved, total, longestRun, props) | `src/server/repo/rooms.ts` (`chainFigures`) |
| playtest transitions, clock, cooldown, solving | `src/server/domain/playtest.ts` |
| session ending, broadcast, debrief email | `src/server/domain/endings.ts` |
| lock winner, presence, pub/sub | `src/server/services/live.ts` |
| version numbering, superseding, all-or-nothing freeze | `src/server/domain/versions.ts` |
| error shape and precedence | `src/server/errors.ts`, `src/server/index.ts` (`handleApi`) |
| download headers | `src/server/domain/download.ts` |
| published copy strings | `src/shared/copy.ts` |

Both the editor Inspector and the build-pack page read `shared/units.ts`, so a
length reads identically on both.

## Things worth remembering

- The precedence order is applied in one place: `handleApi` reads the body first
  (413), then checks the origin, then the handler runs auth → 404 → 403 → replay
  → conflict → validation → 503.
- Freeze holds the room row with `select ... for update`, writes MinIO objects
  first, then the rows; a failure deletes the written objects and answers 503.
- One active session per room is enforced by the partial unique index
  `playtests_one_active`, so simultaneous attempts give exactly one winner.
- Op-Id replays live in `room_changes` (unique per workspace); the same id used
  for a different room, placement or endpoint answers `op_id_reused`.
- Boot never awaits a service probe: a slow DNS failure must not delay the
  5-second retry loop (DP-07).
- The client never serves file-like unknown paths from the SPA shell; they 404,
  so no source file or manifest is ever reachable.
- `prefers-reduced-motion` is handled both in CSS (animation durations) and in
  the stage (the dolly is replaced by a cut).
