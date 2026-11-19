# Roundbook — repository notes

Roundbook is the clinic workspace described in the Larchmere Veterinary Systems brief:
one server clock, one live feed, and one place per domain rule.

## Layout

- `src/server` — Express app on Node 22. `main.ts` wires the routers, static files and the
  SPA fallback; `routes/` holds one file per area; `domain/` holds the rules that must live
  in exactly one place (appointments, ward, money, stock, booking).
- `src/web` — React app bundled by esbuild into `dist/public/app.js`. `app.tsx` is the shell
  and router, `ui.tsx` the design system (dialogs, pills, beacons, motion attributes),
  `screens/` one file per screen.
- `static/app.css` — the whole stylesheet (palette, type, three viewport layouts).
- `scripts/build.mjs` — tsc for the server, tsc --noEmit for the web types, esbuild bundle,
  font and static copy. `scripts/notices.mjs` regenerates `THIRD_PARTY_NOTICES.md`.

## Rules that live in one place

| Rule | File |
| --- | --- |
| clinic time, DST, server clock | `src/server/clock.ts` |
| appointment transitions, lateness, slot conflicts | `src/server/domain/appointments.ts` |
| dose schedule, due and overdue, beacons | `src/server/domain/ward.ts` |
| per-line money rounding | `src/server/domain/money.ts` |
| batch expiry, first-expiry-first-out, low stock | `src/server/domain/stock.ts` |
| online booking window, owner text | `src/server/domain/booking.ts` |
| reminder send moment | `src/server/ticker.ts` |
| error order, status and copy | `src/server/errors.ts` + `src/server/http.ts` |
| role checks and the safe landing path | `src/server/auth.ts` |

## Working notes

- The server clock lives in `server_clock` and is set by `POST /api/grading/clock`; every
  time-dependent state is decided from it, never from the browser.
- `GET /api/appointments` returns the day's slot boundaries so the browser never works out
  an instant itself.
- The live feed has one publisher (`src/server/live.ts`). Server-started announcements
  (overdue, low stock) are deferred a few milliseconds so the acting window's own
  announcement is appended first.
- A storage-outage instance is just the same build with an unreachable `S3_ENDPOINT` and its
  own database (a separate `search_path` works for local checks).
