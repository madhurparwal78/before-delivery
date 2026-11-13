# Cupfold — repository notes

Cupfold is a bracket desk for one volunteer running a local competition: single elimination,
double elimination, round robin and Swiss, with self-reported scores, confirmations, disputes and
the Shutter trace edit preview. One TypeScript app: a Node server and a browser client.

## Layout

| Path | What lives there |
| --- | --- |
| `run.json` | The run manifest (`install`, `build`, `serve`). |
| `src/shared/` | Types, copy strings, card grammar and the current-round rule used by both sides. |
| `src/server/` | HTTP server, routing, auth, storage, live channel, deadline loop. |
| `src/server/domain/` | One module per domain rule (see below). |
| `src/server/routes/` | Request shapes only; every rule is decided in `domain/`. |
| `src/client/` | Browser client: state, live socket, screens, dialogs, Shutter trace. |
| `assets/fonts/` | The bundled Geist and Geist Mono variable fonts (OFL-1.1). |
| `scripts/build.mjs` | `tsc` for the server, esbuild for the client, asset copy. |
| `scripts/notices.mjs` | Regenerates `THIRD_PARTY_NOTICES.md` from the production tree. |

## Where each rule is decided

- Seed placement, bracket size and the structure of all four formats: `domain/structure.ts`.
- Bye settling, advancement, announcements, finishing, overdue and deadlines: `domain/engine.ts`.
- Match state transitions, who may act, version checks and the edit commit: `domain/play.ts`.
- The Shutter trace dependent set and reset order: `domain/dependents.ts`.
- Tiebreak orders and `Decided by`: `domain/standings.ts`.
- Swiss pairing and the bye: `domain/swiss.ts`.
- Final placements: `domain/placements.ts`.
- The roster format: `domain/roster.ts`.
- Card names and history rows: `src/shared/cards.ts`. Every published sentence: `src/shared/copy.ts`.
- The current round (used by the server for `current_round` and by the client for focus and
  scrolling): `src/shared/current.ts`.

## Conventions

- Every error leaves through `AppError` in `src/server/errors.ts`; the status comes from the code.
- Every tournament write runs through `withTournament` (`src/server/work.ts`), which locks the
  tournament row, collects live messages in an `Outbox` and publishes them after the commit.
- Server time is `clock.now()` (real time plus the grading offset). Nothing reads `Date.now()`
  directly for a deadline.
- The client never recomputes a domain answer; it renders what the API and the live channel say.

## Environment

`DATABASE_URL`, the six `S3_*` variables, `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`, `CUPFOLD_GRADING`
and the `CUPFOLD_*` timers. The schema is applied idempotently at every start.

## Checking changes

```sh
npm run typecheck      # strict, no unused locals
npm run build          # server + client
npm run start          # serves on APP_PUBLIC_PORT (4173 by default)
curl localhost:4173/api/health
```

With `CUPFOLD_GRADING=1`, `POST /api/grading/seed`, `/api/grading/session` and `/api/grading/clock`
set up tournaments, sign a browser in and move server time.
