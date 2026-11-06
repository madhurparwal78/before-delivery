# Railside — repository notes

Booking and billing for one shared commercial kitchen (Brigade & Bench Commissary).
TypeScript on Node 22, four backing services: Postgres, Kill Bill, Mailpit, MinIO.

## Layout

- `src/shared/` — modules used by **both** server and browser. `kitchenTime.ts` (America/Chicago,
  DST gaps and repeats), `pricing.ts` (the single hour-price definition), `format.ts`
  (`<hours>`, money), `copy.ts` (every published string), `types.ts` (API DTOs).
- `src/server/` — `domain/` (one rule per module), `http/` (boundary, precedence, routing),
  `services/` (Kill Bill, SMTP, MinIO, PDF), `routes/`, `jobs/`.
- `src/client/` — vanilla TS, direct DOM control (needed so the 15-second refresh can keep
  dialogs, drafts, focus and the countdown untouched).
- `scripts/bundle.ts` — esbuild bundle + static asset copy, compiled by `tsconfig.server.json`.

Build: `tsc -p tsconfig.server.json && tsc -p tsconfig.client.json && node dist/scripts/bundle.js`.
Serve: `node dist/src/server/index.js`.

## Verified service facts (learned the hard way)

- **Postgres 16.4**, user `gf_app` may `CREATE EXTENSION btree_gist` and use exclusion
  constraints. `gen_random_uuid()` is built in. DB starts empty.
  - The `date` OID (1082) type parser is overridden in `db.ts` so kitchen dates stay strings
    and never pass through a JS `Date` in the process's zone.
- **Kill Bill** tenant `gfkit-dev` already exists.
  - `Location` headers **end with a trailing slash** on some resources (payments) — strip it.
  - Catalog upload `POST /1.0/kb/catalog/xml` requires `Content-Type: text/xml`
    (`application/xml` answers 415).
  - `POST /1.0/kb/subscriptions?callCompletion=true` answers **408** even though the
    subscription is created — do not use `callCompletion`.
  - A duplicate subscription `externalKey` answers **500**, so the `shelf-<renter>-<n>`
    ordinal must really increment.
  - Accounts need a default `__EXTERNAL_PAYMENT__` payment method before a PURCHASE works.
- **MinIO**: bucket `gf-dev`. Hand-rolled SigV4 (no AWS SDK). Path-style. Unsigned GET
  answers 403, so the bucket is private as required.
- **Mailpit**: SMTP on `mailpit:1025`, no auth, no TLS. Hand-rolled SMTP client; base64
  bodies keep the en dash intact.

## Lock ordering (do not reorder without re-running the stress test)

Postgres deadlocked under concurrent claims until the lock order was made
consistent. Two rules hold the whole app together:

1. **Booking creation takes the renter's hour lock before inserting any booking
   row.** Inserting a booking takes a `FOR KEY SHARE` lock on its renter row
   (the foreign key), so taking the stronger `FOR UPDATE` afterwards let two
   claims by one renter deadlock: each held key-share and waited for the other's
   exclusion-constraint row.
2. **Every single-booking change locks the booking row first, then the renter's
   hours** (`cancel`, `release`, `check-out`, `expireDueHolds`, maintenance
   displacement). Creation is the only place that takes the renter lock first,
   and it never locks an existing booking row afterwards, so there is no cycle.

The balance check still happens *after* the occupancy inserts, so a colliding
claim answers `slot_conflict` before `insufficient_hours`, as the precedence
order requires.

`/tmp/t_stress.py` style check: 9 concurrent claimants (3 sessions per renter,
so a renter races itself) over 14 rounds must give exactly one 201 and the rest
`slot_conflict`, with no server errors.

## Browser-side gotchas already fixed

- A `.btn { display: inline-flex }` rule beats the UA `[hidden] { display: none }`,
  so `[hidden] { display: none !important }` is declared once near the top of
  `app.css`. Without it, hidden buttons stay visible and focusable.
- The rails are rebuilt on every render, so sweep listeners are **delegated on
  the rails container** and look the live track up by `data-track`. Capturing a
  track element made pointer sweeps measure a detached node.
- A station's hangar height is set from its deepest ticket, otherwise tall
  tickets overflow onto the next station's rail and swallow its clicks.
- `.rail__row` carries the 44px height, not `.rail`; the rail's 2px bottom
  border otherwise ate 2px of every cell.
- The ruler is clipped (`overflow: hidden`) from 768px up, because the `24:00`
  label would otherwise widen the page past the rail.

## Dependency policy

Production tree is **`pg` only** (plus its own deps) — `npm audit` reports 0 vulnerabilities.
`nodemailer` was removed deliberately (long advisory list) in favour of `src/server/services/smtp.ts`.
Fonts (`@fontsource/*`) and `lucide-static` are devDependencies whose files are copied into
the bundle at build time; they are listed in `THIRD_PARTY_NOTICES.md` as bundled fonts/icons.

## Verification

Everything was checked against the live services, not mocks. Last full run:
**636 assertions, 0 failures.**

- API (348): auth and role precedence, cross-renter 404s, board, pricing,
  conflicts, series, cancellation cutoffs, shift check-in/out and overage,
  maintenance displacement, documents and review states, applications,
  adjustments, DST (autumn 150/300-minute cases, spring gap with the exact
  message, wall clock kept across a change), compliance links and share privacy,
  statements, shelf subscriptions including a cancellation made directly in
  Kill Bill, notifications, the server boundary and never-served paths,
  hold expiry, billing/storage/mail down, recovery with **no restart**, and a
  concurrency stress test.
- Browser (288, Playwright/Chromium): role landings and guards, every published
  role and accessible name, the pointer and keyboard sweep, holds, confirm,
  release, cancel, repeat weekly, conflict notch and stop copy, the three
  responsive bands plus their edges with no page-level horizontal overflow,
  the phone drawer, reduced motion, refresh preservation, displacement told in
  place, pack availability re-checked in place, purchases, uploads, statements,
  the operator flows and the public share page.

A unit of work that failed is worth keeping: an unhandled promise rejection
appeared only when a session ended under a running refresh loop. Background work
now goes through `inBackground()` in `src/client/api.ts`, and a 401 from any
call other than the `/api/me` probe sends the user back to sign in.

## Checked pricing examples (all pass)

Convection oven 1 21:00–23:00 = 90 min; 21:45–22:15 = 23 min; Deck oven 05:00–07:00 = 180 min;
Convection oven 1 autumn-change 00:00–04:00 = 150 min (300 elapsed); 60-quart mixer same = 300 min;
Deck oven 10:00–12:00 = 240 min.
