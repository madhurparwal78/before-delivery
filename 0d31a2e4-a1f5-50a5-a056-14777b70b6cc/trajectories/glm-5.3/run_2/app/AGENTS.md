# Pratfall Cup — build and run notes

Pratfall Cup is a browser party-royale game: sign up, verify, friend, party,
queue into a 12-player lobby, race through a server-authoritative fixed-tick
3D elimination match, then scrub any round's photo-finish tick by tick.

## Run

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}
```

`run.json` holds the manifest. `npm run build` compiles the TypeScript server
(`tsc -p tsconfig.server.json`, output in `dist/server`) and bundles the
browser app with Vite (output in `dist/client`). `npm start` serves
everything from port 4173 (`APP_PUBLIC_PORT` overrides). `GET /api/health`
answers `{"status":"ok"}` once PostgreSQL is connected and the schema applied.

## Services

- PostgreSQL at `DATABASE_URL` is the only datastore: accounts, sessions,
  link tokens, friendships, blocks, parties, invites, lobbies, seats,
  matches, rounds (seed, starters, slots, last tick), per-round results,
  every effective input and forfeit event, chat messages. The schema is
  applied idempotently at serve time; seed data (17 players, the friendships
  the brief lists, and finished match 1 with its simulated rounds) is seeded
  idempotently at serve time.
- Mailpit at `SMTP_HOST`:`SMTP_PORT` receives verification and reset mail. A
  fresh SMTP connection per send decides unreachability within 5 seconds.

## Layout

- `src/server` — the Node service: `sim/` is the shared fixed-tick
  simulation (the live rounds, the frames endpoint, the photo-finish
  re-simulation and `POST /api/simulate` all call the same `simulateRound`),
  `api/` holds the HTTP routes and the WebSocket hub, `db/` the data access,
  `auth.ts` hashing and tokens, `mail.ts` the SMTP client.
- `src/client` — the React browser app: `store.ts` is the single state tree,
  `rail/stage/match/dock/photo/pages.tsx` are the shell's regions,
  `three/scene.ts` the low-poly WebGL scenes, `ui.tsx` the bean, icons and
  dialog panel.
- `public/assets` — the stylesheet and the self-hosted OFL fonts
  (Bricolage Grotesque, Atkinson Hyperlegible, and Atkinson Hyperlegible
  Mono, a tabular-digit rebuild of Atkinson used for every number).

## Concurrency rules

Every cross-process race (seating parties into lobbies, crossed friend
requests, cancel against placement, concurrent link issuance) is decided by
PostgreSQL: serializable transactions with `FOR UPDATE` row locks in
`api/matchmaker.ts`, retrying serializable transactions in `api/friends.ts`
and `api/parties.ts`, and single-use tokens that a newer link of the same
kind marks invalid in `api/accounts.ts`.

## Checks used while building

- `node dist/server/simtest.js` — the simulation's published guarantees
  (forward finishes under 40 s / 30 s, idle survival falls within 30 s,
  right-hold falls within 5 s, determinism, slot counts, last-tick markers).
- The WebSocket input window is ±10 ticks around the latest simulated tick;
  effective inputs are stored per tick and player before a round resolves.
