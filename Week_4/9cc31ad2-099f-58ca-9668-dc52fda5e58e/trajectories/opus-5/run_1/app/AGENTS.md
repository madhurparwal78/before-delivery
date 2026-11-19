# Kerbline — repository notes

Browser racing game. One Node process serves the built client, the JSON API and the
WebSocket. Postgres holds every committed value, MinIO holds replay objects, Mailpit
receives sign-in links.

## Layout

- `src/shared/` — the domain decided once and used by both sides:
  - `catalogue.ts` cars, layouts, upgrade prices, events, lap and step limits;
  - `race-model.ts` the deterministic step, the reference driver, AI cars, ranking;
  - `replay-file.ts` the replay file rules (strict JSON parser with duplicate-key,
    depth and literal checks);
  - `payouts.ts` every payout and points amount; `format.ts` display formats;
  - `next-path.ts` the next-address rule.
- `src/server/` — `main.ts` (http + ws + static), `api.ts` (route table), `db.ts`
  (pool, schema, `withPlayerLock`), `verify.ts` (finish pipeline), `garage.ts`,
  `runs.ts`, `boards.ts`, `championship.ts`, `lobbies.ts`, `auth.ts`, `ledger.ts`,
  `idempotency.ts`, `storage.ts` (SigV4 by hand), `mail.ts` (SMTP by hand).
- `src/client/` — React, tiny custom router (`router.tsx`), external stores
  (`store.ts`), pages in `pages/`, WebGL in `gl.ts` + `components/CarView.tsx` +
  `components/RaceView.tsx`, all copy in `copy.ts`.

## Rules that live in exactly one place

- per-player serialisation: `withPlayerLock` in `src/server/db.ts`;
- balance = sum of wallet entries: `balanceOf` in `src/server/ledger.ts`;
- replay judging order: `judgeReplay` in `src/server/verify.ts`;
- league completion, unlocks and the finals reward: `recordEventPoints`;
- purchase attempt and idempotency key lifetime: the dialog state in
  `pages/Garage.tsx` and `pages/Dealer.tsx`;
- which board response may render: the `requestToken` guard in `pages/Boards.tsx`;
- held balance pushes and the sweep's balance step: the `BalanceStore` in `store.ts`.

## Working with it

- `npm run build` builds the server (tsc) and the client (vite). `npm start` serves
  `dist/client` plus the API on `APP_PUBLIC_PORT` (4173 by default).
- Schema is applied idempotently at boot; an empty database works.
- Avoid `text-transform: uppercase` on any element carrying published copy: test
  helpers read transformed text.
- Grading routes exist only when `GRADING_ROUTES=on`.
