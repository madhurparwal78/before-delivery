# Plumtide Venue — repository notes

A hosted exchange for small members-only trading venues. One deployment serves many venues; no
venue ever sees another's data.

## Running it

```
npm ci          # install (uses the committed lockfile)
npm run build   # esbuild bundles dist/server.js and dist/assets/app.js, copies public/
node dist/server.js
```

`/app/run.json` is the run manifest. The server binds `0.0.0.0:4173` or `APP_PUBLIC_PORT`. Schema,
Keycloak roles and groups, the Kill Bill catalog and overdue configuration and the seed are all
applied idempotently on `serve`, each retried every 10 seconds if its provider is unreachable.

Useful checks: `npm run typecheck`, `node scripts/notices.mjs` (regenerates
`THIRD_PARTY_NOTICES.md` and fails on a non-permissive licence).

## Where each rule lives

Each domain rule is decided in exactly one place:

| Rule | File |
| --- | --- |
| Fee rounding, money formatting | `src/server/domain/money.ts` |
| Hold formulas, collateral, maintenance, equity, reductions | `src/server/domain/holds.ts` |
| Book side and price mapping, the event mirror | `src/server/domain/book.ts` |
| Market and order state machines | `src/server/domain/transitions.ts` |
| Ranges and field validation | `src/server/domain/validate.ts` |
| Matching, fills, positions, liquidation, settlement | `src/server/domain/engine.ts` |
| Journal entries and account names | `src/server/domain/ledger.ts` |
| Overdue state to plan state, plan to rate | `src/server/domain/plans.ts` |
| Venue month and time-zone arithmetic | `src/server/domain/time.ts` |
| Error precedence, role and venue checks | `src/server/http/router.ts` |
| Published copy, word for word | `src/client/copy.ts` |

## Things worth knowing

- **Ledger.** Every balance change is one `journal_entries` row whose `journal_legs` sum to zero.
  `postEntry` moves `member_balances` by the same legs, so a member's balances always equal the sum
  of their legs and a venue's legs always sum to zero. Verify with the queries in
  `docs` section below.
- **Kill Bill overdue state.** `GET /accounts/{id}/overdue` returns the state Kill Bill's
  notification queue last *applied*, which in this deployment lags (the test clock is disabled).
  `killbill.overdueState` therefore takes the more severe of that persisted state and the state
  Kill Bill's own uploaded overdue configuration gives for Kill Bill's current unpaid invoice count.
  Both inputs are Kill Bill's; the app never decides a renewal failed by itself.
- **Fill ordering.** `fills.sequence` is a `bigserial`. `filled_at` defaults to `clock_timestamp()`
  rather than `now()`, because every fill of one incoming order shares a transaction and `now()`
  would give them all the same timestamp and an unstable order.
- **Svix signature headers.** This Svix server signs with `svix-id`, `svix-timestamp` and
  `svix-signature`; the `webhook-*` names are Svix's whitelabel-header option, a server setting the
  app does not control.
- **Keycloak.** The realm's user profile requires a first and last name, so `ensureUser` always
  sends both; otherwise the password grant answers `Account is not fully set up`. The `app` client
  accepts any redirect URI, so the callback URI is derived from the request's own origin.
- **Grid overflow.** Every grid uses `minmax(0, 1fr)` and grid children get `min-width: 0`; with
  plain `1fr` the long market title pushed the market detail wider than a 375 px viewport.
- **`overflow-x: clip`, not `hidden`.** Fields clip the cropped stickers with `clip` so the viewport
  stays the scrollport and the market detail's sticky orbit keeps working.

## Checking the ledger

```sql
-- no entry may be unbalanced
select e.id, e.kind, sum(l.amount_cents)
from journal_entries e join journal_legs l on l.entry_id = e.id
group by e.id, e.kind having sum(l.amount_cents) <> 0;

-- every venue's legs sum to zero
select venue_id, sum(amount_cents) from journal_legs group by venue_id;
```

## Seed expectations

With the seed at start: Ana 68,106 available / 31,894 held, Bo 80,517 / 19,483,
Pell 45,477 / 4,523. The RAIN book is bids 34 (150) and 30 (80), asks 37 (200) and 40 (100).
Harbor totals are 5 members, 6 open orders and 400,000 cents of deposits.
All seeded passwords are `plumtide-demo-26`.
