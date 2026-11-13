# Seam — repository notes

Seam is a puzzle house by Maison Neuf: 9x9 puzzles at four levels, a daily
challenge with streaks, a live daily leaderboard and live duels. One TypeScript
Node server, one browser client, Postgres for storage, Valkey for live state and
Mailpit for email.

## Layout

```
run.json                 install / build / serve manifest
src/shared/              rule code used by both the client and the server
  puzzles.ts             the 19 published fixtures (never generated)
  board.ts               cell names, peers, board strings
  engine.ts              Game: enter, note, erase, undo, redo, hint, second chance
  replay.ts              move-log parsing and the published check order
  score.ts               the score formula and the MM:SS / H:MM:SS format
  daily.ts               day states and streaks
  leaderboard.ts         ranking with shared ranks
  highlight.ts           the data-highlight tokens
  messages.ts            every published sentence, M01 to M61
  dates.ts               plain-date arithmetic and the daily-k mapping
  api.ts                 the API and WebSocket shapes
src/server/              http, routes, duels, sockets, services
src/client/              shell, pages, board view, hem thread, number pad
public/fonts/            Gloock and Rethink Sans, served from our own origin
```

## Rules live in exactly one place

- Move, mistake, hint-choice and second-chance rules: `shared/engine.ts`.
  The browser board and the server's replay both drive the same `Game` class.
- The finish check order: `shared/replay.ts`.
- Score: `shared/score.ts`. Streaks and day states: `shared/daily.ts`.
  Ranking: `shared/leaderboard.ts`.
- The on-day decision uses the server clock in `DAILY_TZ` only
  (`server/clock.ts`), never the browser.

## Build and run

- `npm run build` typechecks, builds the client with Vite into `dist/client`
  and bundles the server with esbuild into `dist/server/index.js`.
- `npm run start` serves HTTP, the built client and `/ws` on `APP_PUBLIC_PORT`
  (4173 by default).
- The server listens even when a dependency is unreachable and retries every
  three seconds; `GET /api/health` reports what is down.

## Things that are easy to get wrong

- The client sends the whole move log on every move; the server replays it and
  its numbers win. A finish counts once, and an identical resend returns the
  stored result.
- A lost game is *open* while its second chance is unused. Closing it (because
  the second chance was spent, or a newer game at that level started) is what
  turns it into a finished game with the result `Lost`.
- `data-remaining` on a pad digit counts givens, hints and correct entries only.
  A disabled pad button still accepts its key.
- Animations must be real browser animations (`element.animate`) so that
  `document.getAnimations()` sees them, and every timer must use the page's own
  `setTimeout` / `performance.now` so a faked clock moves it.
- Repeating the same announcement clears `#announcer` and sets it again on the
  next animation frame.
- Duel rooms live in memory for their boards and in Valkey for the published
  keys (`seam:room:*`, `seam:presence:*`, `seam:joins:*`, `seam:leaderboard:*`).
  The second seat is taken with `HSETNX`, so exactly one joiner wins a race.
- A WebSocket's session is read *before* the handshake completes, otherwise the
  first client message is lost.
