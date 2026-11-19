# Nightroll — repository notes

Property management app for small inns (10–20 rooms). Node.js + TypeScript, served on 0.0.0.0:4173.

## Architecture
- `src/server/` — Express API (CommonJS output). Modules: `stays.ts` (create/quote/link), `stayActions.ts` (get/patch/move/check-in/out/cancel), `folios.ts`, `invoices.ts` (close/email/pdf), `close.ts` (end-of-day), `reports.ts`, `rooms.ts` (status rules), `guests.ts` (merge), `checkin.ts` (link/photo/complete), `grading.ts` (setup/clock), `pricing.ts` (single source of nightly price/tax maths), `dates.ts` (all hotel-clock time rules), `serialize.ts` (API shapes with explicit allow-lists), `live.ts` (SSE hub), `db.ts` (pg pool + migrations), `seed.ts`.
- `src/client/` — vanilla TS ES modules served from `dist/public/assets`. `desk.ts` owns the timeline, keyboard model (N/M/I/O/arrows/Enter/Escape), pickup/drop, tally rail and the Night Close Sweep. `stayPanel.ts`, `newStay.ts`, `folio.ts`, `board.ts`, `guests.ts`, `rates.ts`, `reports.ts`, `checkin.ts`.
- Build: `npm run build` runs both tsconfigs then copies `src/public` to `dist/public`. `run.json` manifest drives install/build/serve.

## Domain rules to preserve
- All amounts are integer cents; rounding is half-up, once, per night. Tax percent × 100 = basis points (8.75% = 875 bps).
- A hotel's clock: `hotels.clock_fixed_at` holds the grading-set instant; otherwise real time. Never read the browser clock.
- 04:00 local opens the close; `localInstantOn` converts a zone wall-clock time to an instant by iterating the offset (handles DST).
- Availability checks lock the room row (`SELECT ... FOR UPDATE`) so two clerks cannot both take the last free night.
- Invoice numbers are reserved inside the folio-close transaction; a failed render rolls back so no number is consumed.
- `checkin_tokens.mail_sent` distinguishes an emailed link from one whose send failed (state `not_sent`).

## Testing (from /tmp, against a running server)
`test-flow.py`, `test-flow2.py`, `final-test.py` (API), `browser-test.py`…`browser-test4.py` (Playwright), `outage-test.py` + `recovery-test.py` (dead providers via a second copy on PORT=4599), `pdf-test.py`, `photo-test.py`. Grading key header: `X-Grading-Key: nightroll-grading-5c1e7a`.

## Gotchas found
- Express 4 drops rejected promises from bare async handlers: wrap with `route()` (errors.ts).
- pg returns DATE columns as Date objects unless `setTypeParser(DATE)` forces strings — set in db.ts.
- Snake_case SQL columns must be aliased to camelCase when building domain rows.
- Playwright's Mailpit API returns `To[].Address` (capitalised).
- Timeline stay blocks absolutely overlap their cells; click blocks at a small offset.
