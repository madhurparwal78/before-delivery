# Passboard — repository notes

Passboard is a booking, compliance and billing desk for one shared-use
commercial kitchen (Halsted Street Kitchen, `America/Chicago`). It was built
from the product brief in this repo; there is no git history.

## Layout

- `run.json` — the run manifest (`npm ci` / `npm run build` / `npm start`).
- `server/` — the API server, strict TypeScript, compiled by
  `tsconfig.server.json` to `dist-server/` (ESM, `.js` import extensions are
  required in the source for NodeNext resolution).
- `client/` — the React browser app, built by Vite into `dist/`
  (entry `client/index.html`, output `assets/app.js` + root `styles.css`).
- `shared/` — domain types, constants and rules used by BOTH server and
  browser (cost split, clock math, CSV neutralising). A domain rule must have
  exactly one home here or in one server module.
- `scripts/` — verification harnesses (see below).
- `client/public/fonts/` — the self-hosted Big Shoulders Display and
  Public Sans woff2 files (OFL-1.1, copied from @fontsource).

## The one server clock

`server/clock.ts` owns every notion of now: it starts from `PASSBOARD_NOW`
and advances in real time. No business rule may read `Date.now()` directly —
only `kitchenNow()` / `nowEpochMillis()`. Holds, expiry warnings, the booking
window, the cancellation cutoff, check-in windows, packet expiry and
completion all read it. The browser keeps the server's now as an offset
measured at each board fetch and never uses its own clock for a decision.

## Decisions made once, reused everywhere

- Station-cell collision: `lockStationDate` + `cellsAreFree` in `server/db.ts`
  (an advisory xact lock on station|date, then overlap checks against live
  holds and non-cancelled bookings, tails included). Every placement, resize
  and confirm goes through it — exactly one winner per 15-minute cell.
- Cost split / cancellation fee: `shared/rules.ts` `costSplit` and
  `lateCancellationFeeCents` — the browser's live paint tag, the hold preview,
  confirmation and the fee all reuse them.
- Cancellation cutoff: `server/domain.ts` `freeCancelUntil` (same kitchen
  wall-clock two calendar days before the start).
- Document coverage: `coverageDocument` (any one approved document of the
  right kind whose expiry date is on or after the booking date).
- CSV neutralising: `shared/rules.ts` `csvField`/`neutraliseCell`.

## Outbound effects

Emails (SMTP to Mailpit) and Kill Bill records are queued in PostgreSQL and
flushed by the 10-second sweep in `server/services.ts`; a dependency outage
never fails the action that triggered the effect. Emails dedupe on a business
key (`booking-confirmed:<id>` etc.) and document warnings also record their
threshold in `document_warnings`.

## Kill Bill

The client in `server/killbill.ts` probes both context paths (`/v1/...` and
`/killbill/v1/...`) and remembers which answers. Accounts are keyed by the
member id (for example `mbr-rosa`). During development the provided Kill Bill
container never finished deploying, so the up-path was verified against
`scripts/mock-killbill.mjs` (accounts, external charges, invoice payments,
credits, invoice reads) — see `scripts/billing-up-test.py`.

## Verification harnesses (all pass against the real services)

- `scripts/ui-smoke.py` — browser: sign in, board, pointer painting, hold,
  confirm, keyboard painting (Shift+Arrow, Enter, Escape), cancel, 375/768/
  1280 viewports with no sideways page scroll.
- `scripts/ui-screens.py` — browser: every role screen, review approve,
  visibility rules (no other member's business names).
- `scripts/ui-packet.py` — browser: the public packet page and the invalid
  token copy (HTTP 404).
- `scripts/concurrency-test.py` — simultaneous holds on one cell (one winner),
  concurrent cancels, tail-clash collisions.
- `scripts/expiry-test.py` — the hold expiry edge on a copy with
  `PASSBOARD_HOLD_SECONDS=5` (needs its own port).
- `scripts/billing-up-test.py` — the billing-up journey (needs
  `scripts/mock-killbill.mjs` when the real Kill Bill is unreachable).
- `scripts/generate-notices.mjs` — regenerates `THIRD_PARTY_NOTICES.md` from
  `npm ls --omit=dev --all --json` and fails on a disallowed licence.

## Gotchas learned here

- Kill Bill's Tomcat in this environment serves at the ROOT context (404 on
  `/killbill/v1/...`); hence the context probing.
- Express 5 does not parse cookies by default; `server/http.ts` reads the
  `Cookie` header directly. `res.cookie` handles the Set-Cookie side.
- The idempotency middleware captures the raw body once and stores it on
  `req.rawBody`; every body reader reuses it, so requests are read exactly
  once. Never `req.destroy()` on an over-limit body — drain instead so the
  413 can be answered.
- A DELETE or bodyless POST carries no content-type; the 415 middleware must
  only reject when a content-type header is present and wrong.
- All React hooks in a component must run before any early return (React
  error #310 otherwise).
