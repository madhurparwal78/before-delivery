# Overcall — repository notes

Overcall is a cricket scoring and league app: one TypeScript app server with a
browser client, backed by Postgres, Valkey, MinIO and Mailpit.

## Layout

| Path | What it holds |
| --- | --- |
| `src/shared/` | Types, published messages and formats, and the two law predicates the client needs (`laws.ts`) |
| `src/server/engine.ts` | The laws engine: replays one innings' ball log |
| `src/server/match.ts` | Match-level replay (innings plans, status, result, breaks) and the state/scorecard builders |
| `src/server/scoring.ts` | The six scoring operations with every refusal |
| `src/server/stats.ts` | Team history, points tables, net run rate, careers |
| `src/server/api.ts` | The JSON API |
| `src/server/routes.ts`, `pages.ts` | Server-rendered pages and their bootstrap data |
| `src/server/ws.ts`, `pen.ts`, `live.ts` | The live connection, the pen and publishing |
| `src/server/grading.ts` | `POST /api/grading/seed` and `/clock` |
| `src/client/` | Browser modules: `stateview.ts` renders every scoreboard part and the ball tick |
| `public/` | Stylesheet and the two self-hosted fonts |

## Rules that live in exactly one place

- Delivery accounting, strike, free hit, over end, innings end, all out:
  `src/server/engine.ts` (`replayInnings`).
- Wicket permission and delivery legality: `src/shared/laws.ts` (the server
  decides, the client only disables controls with the same predicate).
- Results, targets, breaks, super-over plans: `src/server/match.ts`.
- Points, net run rate, careers: `src/server/stats.ts`.
- Every published sentence and number format: `src/shared/messages.ts`.

Every derived figure comes from replaying the ball log; the browser renders only
what the server sends.

## Working on it

- Build: `npm run build` (server then client, both `tsc`). Serve:
  `npm run start`. `/app/run.json` holds the same three commands.
- The client is plain ES modules compiled by `tsc` and served from
  `dist/client`; imports therefore end in `.js`.
- Scoring calls need the `X-Pen` header. A page gets a pen by opening `/ws` and
  sending `{"type":"score","match":"<id>"}`; the pen lives in Valkey under
  `pen:<match id>` with a `PEN_GRACE_MS` expiry that the server renews while the
  socket is open.
- Tests (and manual checks) build state through `POST /api/grading/seed` with
  the `X-Grading-Key` header, then add the returned `session` as the
  `oc_session` cookie.
- Outage behaviour is exercised by starting a second instance with a service
  address pointing at a closed port, for example
  `VALKEY_URL=http://127.0.0.1:9 APP_PUBLIC_PORT=4175 node dist/server/index.js`.
  An unreachable service may be configured with an `http://` scheme, so the
  Valkey URL and SMTP host are normalised before use.
- Viewer pages delay every live state by `LIVE_DELAY_MS` using page timers, so
  browser checks need a paused clock (`page.clock.install()` plus
  `page.clock.pauseAt(...)`) before advancing time.
