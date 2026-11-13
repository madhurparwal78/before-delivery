# Overlap — repository notes

Overlap is one TypeScript web app: a Node server and a browser client that let friends
solve one crossword grid together from different places. Postgres is the system of record;
MinIO holds uploaded puzzle originals and one solve record per finished game.

## Running it

```
npm ci          # install
npm run build   # tsc --noEmit, then esbuild bundles the server and the client
npm run serve   # node dist/server.js, binds 0.0.0.0 on APP_PUBLIC_PORT (default 4173)
```

`/app/run.json` holds those three commands. Every tunable comes from the environment
(see `src/server/config.ts`); nothing is hard-coded and no credential reaches the browser.

Useful during development:

```
node scripts/run-ts.mjs <entry.ts>   # bundle a TypeScript entry and run it once
node scripts/notices.mjs             # regenerate THIRD_PARTY_NOTICES.md and check licences
```

## Layout

```
src/shared/     rules both sides share: grid numbering, clue references, auto-advance,
                builder text and problems, time formatting, copy strings, API types
src/server/     http server, routes, game engine, live connections, storage, fixtures
src/client/     router and pages, the room session and view, dialogs, builder, replay
public/         index.html and the bundled Albert Sans fonts
```

## Where each domain rule lives (one place each)

| Rule | Source |
| --- | --- |
| Numbering and words | `src/shared/grid.ts` |
| Auto-advance (all three variants) and the starting clue | `src/shared/autoadvance.ts` |
| Clue references and linked clues | `src/shared/references.ts` |
| Builder text, file name and problems | `src/shared/builder.ts` |
| Time and date formatting, grapheme counting | `src/shared/text.ts` |
| Published copy | `src/shared/copy.ts` |
| Overlap text format parsing and its checking order | `src/server/domain/format.ts` |
| Display names | `src/server/domain/names.ts` |
| Writes: sequencing, solve test, autocheck, race claim, Clear word protection | `src/server/games/engine.ts` |
| Timer segments | `src/server/games/timer.ts` + `elapsedMs` in `games/state.ts` |
| Link access check, codes, joining, teams | `src/server/games/service.ts` |
| Error shape, codes and statuses | `src/server/errors.ts` |
| Error precedence | the order of checks in each route and in `engine.applyWrite` |
| Replay step application | `src/client/ui/replay.ts` |

## Things worth remembering

- Writes for one game are serialized by `withGameLock` in `games/engine.ts`, and every
  broadcast comes from the stored result, never from the request.
- The client shows its own letter at once and keeps the previous square in `pending`;
  an `error` frame carrying that `client_op_id` puts the server's value back.
- The room rebuilds its DOM only on a layout change (phone < 768 ≤ tablet < 1200 ≤ desk);
  live messages patch squares, tiles and the timer in place so menus, dialogs and the
  rebus editor keep their drafts and focus.
- Every client timer is a page timer (`pageInterval` in `src/client/state.ts`).
- The share link uses `APP_PUBLIC_URL`, passed to the page through the
  `overlap-public-url` meta tag that `serveFile` fills in for `index.html`.
- Library puzzles live as real `.overlap.txt` fixtures in `src/server/fixtures/` and are
  parsed by the same parser as uploads; `seedLibrary` creates them if they are missing.
