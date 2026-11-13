# Quillmoor Reserve — repository notes

A permissioned money market: one single-sided pool per asset funding swaps,
variable-rate lending and collateralised borrowing with liquidations, all
settled on one internal double-entry ledger.

## Running it

```
npm ci && npm run build && node dist/server.js     # as /app/run.json states
```

Everything is read from the environment (see `src/config.ts`); there is no
literal fallback for any service URL or credential, and the server exits
non-zero naming the variable when one is missing.

Development helpers (not part of the app):

```
sh scripts/reset.sh [ENV=value ...]   # rebuild, reseed, restart on 4173
sh scripts/checkall.sh                # typecheck, format, licences, server suites
node scripts/serverctl.mjs stop       # stop by scanning /proc (no pkill here)
```

## Layout

| Path | What lives there |
|---|---|
| `src/domain/` | Pure rules: desk formats, desk time, pool figures, interest, position state, quotes, oracle conversion, shock ruler. No I/O. |
| `src/ledger/` | Postings, legs and the balance reads every pool figure derives from. |
| `src/market/` | Accrual, prices, positions, settlements, statements, notices, outbox. |
| `src/http/` | Problem details, boundary checks, router, sessions, retry keys, validation. |
| `src/api/` | One file per endpoint group; route tables are exported and composed in `src/server.ts`. |
| `src/web/` | The browser app (vanilla TypeScript, no framework). |
| `tests/` | Server suites (no extra dependencies). `tests/ui/` needs Playwright. |

`src/domain` is imported by both the server and the browser, which is how a
rule such as the desk formats stays decided in exactly one place.

## Things that cost time to rediscover

- **Node's ICU gives `GMT-3:30`, not `NST`.** `timeZoneName: 'short'` only
  yields the IANA abbreviation under `en-CA`. `src/domain/desktime.ts` tries a
  list of locales and falls back to the offset form.
- **Debts accrue from the moment of seeding.** The brief's "positions at
  start" table is the state at the seeding instant only. Assert exact seed
  figures in `tests/seed.mts` (which reseeds first); elsewhere compare against
  what the server reports now, or allow a second of drift.
- **`hidden` loses to `display`.** Grid and flex rules override the attribute,
  so `styles.css` carries `[hidden] { display: none !important }`. Without it
  the Retry button, the Grace ends row and the dialog all show.
- **Disabling a focused button drops focus to the body.** `whilePending()` in
  `src/web/parts/fields.ts` restores it, because focus never moves on success.
- **WireMock's admin API is locked (401)** and its configuration is not ours to
  change. `scripts/stuboracle.mjs` is a controllable stand-in: point an
  instance at it with `WIREMOCK_URL=http://127.0.0.1:8099`.
- **A single fill can never clear a whole debt** at a 5,000 bps close factor,
  since max repay is at most half the debt. The "releases the remaining
  collateral" branch is reachable only through the write-off path.
- **Two price posts in the same second** are indistinguishable by `posted_at`
  alone, so `price_posts.seq_no` breaks the tie and `assets.current_price_post_id`
  names the price in force outright.
- **A position is paused while *either* of its assets is stale**, so reopening
  one market is not enough to let a draw through.
- **`npm ci` installs devDependencies**, and Playwright's postinstall downloads
  browsers. It is deliberately not in `package.json`; install it on demand:
  `npm i --no-save playwright && npx playwright install --with-deps chromium`.

## Invariants worth re-checking after any change

- Every asset nets to zero in `GET /api/ledger/totals` after any sequence.
- Pool figures are recomputed from balances, never stored as counters.
- `settlement.committed` is sequenced before `position.state_changed` within
  one transaction; sequences count from 1 per position with no gaps.
- Statement objects are written inside the transaction; a storage failure
  rolls everything back and removes what was written.
