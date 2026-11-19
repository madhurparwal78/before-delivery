# Fernsquare — repository notes

A private, deterministic data availability sandbox (Orrin Fieldworks). One Node 22
process serves the API, the browser bundle, the simulation clock, the mail sender
and the WebSocket hub. Services: PostgreSQL (system of record), MinIO (byte store),
Mailpit (mail sink). Nothing else is used or contacted.

## Layout

```
src/shared/   domain rules used by the server and the browser alike
src/server/   http server, routes, domain services, seed, clock engine
src/client/   vanilla TypeScript SPA (no framework), bundled by esbuild
scripts/      build-client.mjs plus the scratch verification scripts
```

`npm run build` = `tsc` (server) + esbuild (client) + copies `schema.sql` and the
static files into `dist/`. `node dist/server/index.js` serves on `APP_PUBLIC_PORT`.

## One place per rule

Each published domain rule lives in exactly one module under `src/shared`, and the
browser imports the same module rather than restating the rule:

| Rule | Module |
|---|---|
| SHA-256 (pure TS, so the browser can hash synchronously) | `shared/sha256.ts` |
| GF(2^8) arithmetic and Lagrange weights | `shared/gf256.ts` |
| Share format, share counts, max blob bytes | `shared/shares.ts` |
| Square layout, erasure extension, quadrants, withheld region | `shared/square.ts` |
| NMT leaves/inner nodes, range proofs, binary Merkle root | `shared/nmt.ts` |
| Row roots, column roots, data root | `shared/commitments.ts` |
| Namespace inclusion/absence proofs and verification | `shared/proofs.ts` |
| mulberry32 sample sequence, confidence, the 99% threshold | `shared/sampling.ts` |
| Gas, fee, FERN parsing | `shared/fees.ts` |
| Amount, percentage, date and time formatting | `shared/format.ts` |
| Reward split | `shared/rewards.ts` |
| Quorum, veto and pass rule | `shared/governance.ts` |
| Namespace format and reserved ranges | `shared/namespace.ts` |
| Live event shapes and announcement copy | `shared/live.ts` |

## Decisions worth remembering

- **Clock.** `server/domain/engine.ts` owns the clock. `advanceTo(target)` finds the
  earliest due event at or before the target, runs every event of that instant in the
  published order (unbonding releases, proposal period ends, block production,
  light-node samples, fraud checks), each inside one transaction at its own instant,
  then repeats. Dueness is derived from state, never from a watermark, so nothing can
  run twice. `CLOCK_MODE=realtime` ticks `advanceTo` every 200 ms and persists the
  clock; `manual` moves only through `POST /api/grading/clock`.
- **Rewards start with block 6.** The seed drives the same engine with
  `advanceTo(target, false)` so the history blocks 1–5 pay no rewards, exactly as the
  brief states. Live production always pays.
- **Seed history is real history.** `buildSeed` inserts genesis state, then
  interleaves blob submissions with `advanceTo(blockTime(h))`, so blocks, samples,
  rejections and the fraud proof come from the production code paths. It advances to
  block 5's fraud-check instant so every published check has run, then sets the clock
  back to block 5's time (`10:01:15` Berlin). Genesis allocations are sized last so
  the published liquid balances hold exactly.
- **Blob bytes live in PostgreSQL as well as MinIO.** PostgreSQL is the system of
  record, so squares, roots and proofs still render while MinIO is unreachable. The
  seed and block production park objects they could not write in `pending_objects`
  and a 2-second flusher writes them once storage answers.
- **Holds are not ledger entries.** `transactions.held_ufern` carries the reserved
  amount of a pending write; available balance = balance − holds. At inclusion the
  hold is released first, then the rule is re-checked, then the fee is charged.
- **Ledger.** Every movement is two rows under one `pair_id`; a person's balance is
  the sum of their `member:<id>` rows. Movements between `bonded:*` and `unbonding`
  (unbonding started, redelegation) do not touch a member account, so they appear in
  the workspace-wide ledger rather than in one person's table.
- **Live channel.** `server/live.ts` queues events raised inside a transaction and
  flushes them after the commit (`emitEvent` / `flushEvents`), so no page ever sees an
  event before it is durable.
- **Client re-render.** Live events re-render the current page. `main.ts` captures and
  restores form values, checked radios, focus and scroll first, so a block arriving
  mid-typing never throws away input.
- **Accessible names.** Several published roles (`article "Lay out"`, spotlight
  panels, pills that carry an arrow glyph) need an explicit `aria-label`, because an
  article has no name from content and the arrow would otherwise land in the name.
- **Hit targets.** Radio inputs are stretched invisibly over their whole pill and
  table links are `inline-flex` with a 44 px minimum, so every control a test touches
  is at least 44 × 44 px.

## Verification scripts

Run against a live server (`node dist/server/index.js`) with the project's env:

```
node scripts/check-domain.mjs    # every worked example in the brief
node scripts/check-api.mjs       # seed state, error order, journeys, ledger invariants
node scripts/check-extras.mjs    # body limits, mail recipients, reset
node scripts/check-outage.mjs down   # with S3_ENDPOINT pointing at a dead address
node scripts/check-outage.mjs up <workspaceId> <session>   # after storage returns
node scripts/check-ui.mjs        # Playwright: screens, ARIA, motion, live updates
```

`check-ui.mjs` imports Playwright from `/tmp/node_modules` (installed ad hoc for
verification); it is not a shipped dependency. `check-api.mjs` and `check-ui.mjs`
re-seed between phases, so every id and session changes — read them from the seed
response rather than caching them.
