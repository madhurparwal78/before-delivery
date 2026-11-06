# Saltreach — repository notes

Browser village builder on tidal salt flats. The server decides everything; the
browser sends intents only. Node.js 22 + TypeScript, PostgreSQL as the only
datastore, Mailpit for mail.

## Layout

```
run.json                 install / build / serve commands (run-manifest-v1)
src/shared/              imported by both sides: types, catalog, battle sim, field messages
src/server/              HTTP boundary, domain rules, routes, mail
src/client/              screens, panels, island renderers, Wake dial
dist/                    tsc output (dist/server, dist/shared) and vite output (dist/client)
```

- `src/shared/sim.ts` holds the battle rules once. The server resolves raids with
  it and the browser replays with it, so per-tick hashes match (DP-33, DP-82).
- `src/server/http/server.ts` applies the published error precedence in one
  place. `src/server/http/errors.ts` builds every error body.
- Each domain rule lives in exactly one module: storage caps, free builders,
  housing and the training schedule in `domain/village.ts`; raid states, loot,
  trophies, shields and cooldowns in `domain/raids.ts`; local day and week
  boundaries in `domain/localtime.ts`; reward clocks in `domain/rewards.ts`;
  clan roles and succession in `domain/clans.ts`.
- Balances are always the sum of the island's ledger rows; corrections are new
  pairs. The tide (world account) side of a pair has a null `village_id`.

## Running locally

```
npm ci && npm run build && npm run start      # serves on APP_PUBLIC_PORT (4173)
```

The schema and seed data are applied idempotently on every start and whenever
the database comes back, so an empty database needs no extra step.

## Conventions worth keeping

- Advisory locks are taken through `takeLock` / `takeIslandLocks`; island locks
  are always taken in ascending village id order, so no two requests deadlock.
- Throttles count in their own transaction (`domain/throttle.ts`) so a refused
  or failed request still leaves the right number of hits.
- The client polls once a second (`store.pollOnce`) to meet the two second live
  bound; there is no server push channel.
- Accessible names and data attributes in `src/client` are part of the contract.
  Changing a role, name or `data-*` attribute breaks the published surface.
- Live copy goes through `regions.ts`: notices to `status` "Tide notices",
  errors to `alert` "Tide alerts". Copy lives in `copy.ts` only.

## Verifying

Useful scratch scripts were kept outside the repository during development:
API conformance, browser journeys (Playwright), outage copies and clock copies.
When re-testing, remember the sign-in throttle (5 per email per 60 s) — tests
that sign in repeatedly as one islander will start seeing `rate_limited`.
