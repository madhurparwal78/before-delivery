# Longseat — repository memory

Carpooling web app for long trips between eight invented towns. TypeScript
end to end, PostgreSQL as source of truth, Valkey for fast state, MinIO for
files, Mailpit for every email.

## Layout

- `server/domain/` — the rules, each decided in exactly one place:
  `route.ts` (stop times, price range, segment price), `seats.ts` (seat
  freedom, lowest-numbered seats, request deadline, booking cutoff),
  `refunds.ts` (refund tiers, free-cancel window), `states.ts` (booking
  transitions), `ratings.ts` (rating window), `time.ts` (Brussels time),
  `model.ts` (queries + wallet labels).
- `server/http/` — `errors.ts` (the one error catalogue and shape),
  `api.ts` (precedence pipeline), `routes/` (auth, rides, bookings, threads,
  files, grading), `live.ts` (the event stream).
- `server/services/` — Valkey RESP client, S3 SigV4 client (header names are
  lowercased in the canonical request — MinIO rejects mixed case), SMTP
  client, outbox mailer, seeded scene renderer, PNG writer.
- `client/` — no framework: `lib/els.ts` builds real DOM nodes, pages render
  once and update by targeted edits.

## Gotchas learned the hard way

- `pg` returns BIGINT as a string. `server/db/schema.ts` installs a global
  type parser turning int8 into numbers — every epoch-ms column depends on it.
- SigV4 canonical headers must be lowercase; a `Content-Type` header breaks
  the signature otherwise.
- The grading clock offset lives in PostgreSQL (`clock_offset`), is shared by
  every instance and never goes backwards. Tests that advance it change the
  demo data's "today"; use far-future departures in test rides.
- `router.go(path, query, replace, silent)` with `silent: true` updates the
  URL without re-rendering the page (search and tabs use it, or the page
  loops).
- Playwright: `context.addCookies([{ name, value, domain, path }])` is the
  reliable way to set a grading session; `document.cookie` in a fresh context
  is not. Synthetic `TouchEvent`s need the touch in `touches` on `touchstart`
  and in `changedTouches` on `touchend`.

## Verification

The API suites and browser journeys live in `/tmp/pwtest/*.cjs` (Playwright,
Chromium headless shell) and `/tmp/api-*.mjs`. They pass 160 browser checks
and 20 API checks against the seeded demo network.
