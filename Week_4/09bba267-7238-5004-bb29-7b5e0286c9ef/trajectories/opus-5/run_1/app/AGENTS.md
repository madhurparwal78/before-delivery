# Halyard Hall Seatwise — working notes

Box office for one 900-seat hall: seat map, server-decided holds, payments in Kill Bill, waitlist
offers, exchanges and refunds, owner pages. Node 22 + TypeScript, Postgres as the only datastore.

## Layout

- `src/shared` — rules both sides need: `hall.ts` (seats, labels, sightline geometry), `money.ts`
  (seat fee, order fee, refund amount, formatting), `venueTime.ts` (America/Chicago labels and
  wall-time parsing), `copy.ts` (exact announcement, notice and validation text), `api.ts` (types).
- `src/server` — `http/` (boundary, cookies, idempotency, routes), `domain/` (seats, cart, orders,
  purchase, exchange, refund, waitlist, payments, `rules.ts`), `services/` (Kill Bill, SMTP,
  outbox, message bodies), `live.ts` (change feed + SSE), `sweeper.ts`, `seed.ts`, `schema.ts`.
- `src/client` — React, hand-rolled router; `components/SeatMap.tsx` draws the SVG grid, the stage
  and the sightline wedge; `lib/wedge.ts` animates it; `pages/` holds one file per screen.

## Decisions worth remembering

- Postgres `now()` is the only clock for holds, offers, sales and the change cutoff, so several
  copies of the server agree. The browser only counts down from the seconds the server reported.
- `src/server/domain/rules.ts` holds the SQL for sales open, changes open and the effective seat
  state. Nothing else writes those conditions.
- `freeSeat` in `domain/seats.ts` is the only place that decides whether a freed seat goes back on
  sale or to the next waiting entry (and sends the offer email).
- Seats keep `pending_order_id` while Kill Bill is answering, which keeps the sweeper from
  releasing a seat mid-payment; offers use the same column.
- Idempotency records are rows in `idempotency_records`; 200/201/402 are stored, everything else is
  deleted so the key can be retried. A repeat waits for the first request by polling the row.
- Live updates: every mutation inserts rows into `change_feed`; one poller per server process reads
  new topics every 400 ms and pushes `event: changed` to the SSE subscribers of `/api/events`.
- The seat map is one SVG. Seats are `<g role="gridcell">` with a transparent hit rect, so the
  gridcell's on-screen centre is exactly the wedge apex (the 2 px rule in DP-08).
- Mail goes through a small SMTP client in `services/smtp.ts` (no dependency, keeps the licence
  list short). The outbox pump claims a message with a session advisory lock, so one copy sends it.

## Checking the work

- `sh scripts/check-all.sh 8 12` — clears the database, builds, serves with HOLD_SECONDS=8 and
  OFFER_SECONDS=12, then runs the Playwright suite and the API, waitlist and outage scripts. The
  browser checks of expiry need those short windows; much shorter than 8 and the buy flow of a
  test can outlive its own hold.
- `sh scripts/serve.sh [hold] [offer]` — restart the built server for ad-hoc checks.
- `npx tsx scripts/shots.ts` — screenshots of the main screens in /tmp.
- The outage script starts extra copies of the server with Kill Bill or SMTP pointed at a dead
  port; it stops other copies first, so run it last.
