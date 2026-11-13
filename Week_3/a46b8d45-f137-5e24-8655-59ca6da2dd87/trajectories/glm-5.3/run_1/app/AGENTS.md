# Holmgarth Aftercare Fittings Desk — repository notes

## What this is

A one-person aftercare desk for replacement flat-pack furniture parts, built to the
published brief. TypeScript server (Node.js, no framework) plus a TypeScript browser
app bundled by esbuild. `/app/run.json` is the run manifest: `npm install`,
`npm run build` (which typechecks both halves then bundles), `node dist/server.js`.

## Architecture

- `src/server/` — the desk. One file per concern:
  - `clock.ts` — the Europe/London calendar (Olson transition table, 1996–2035),
    `DESK_CLOCK_FROZEN_AT`, London dates, calendar-month arithmetic. Every date
    decision in the desk goes through here; nothing else reads `Date.now()` for
    domain purposes (the frozen clock is `desk.now()`).
  - `domain.ts` — the single source for each domain rule: state machine, aftercare
    term and ruling, deciding edition, quote figures and rounding, dispatch
    promise, photo type check, model name matching, the before-close rule, and the
    unknown-reference rule.
  - `errors.ts` — the one error shape and the published English copy.
  - `db.ts` — the Postgres schema (idempotent) and seed data; the `claims` table is
    the published shape the checker reads.
  - `store.ts` — all Postgres access. Rows are camelized on read
    (`camelizeRow`); date columns are turned into `YYYY-MM-DD` strings.
  - `services/` — Kill Bill (invoices, external payments, refunds, voids; every
    figure shown is read back from it), MinIO (photos, dispatch notes), Mailpit
    (SMTP send plus the erase-mail API), the carrier (WireMock).
  - `api/public.ts`, `api/operator.ts` — the endpoints. All-or-nothing claim
    start, idempotency records in Postgres, the notice queue pump (10 s tick).
- `src/browser/` — the SPA. `app.ts` holds the owner pages and the router;
  `workspace.ts` the operator pages, both dialogs, imports and editions;
  `fan.ts` the exploded fitting fan (attributes, glide, bracket shortcut);
  `strings.ts` every owner string in English and Polish.

## Things that bit during the build (do not repeat)

- **pg returns snake_case rows.** Anything read through `Store.query` directly is a
  raw row; go through `getClaim`/`getPart`/… or camelise by hand. The confirm
  handler once read `confirmBy` off a raw row and every link looked lapsed.
- **`throw opsWrongState(...)` throws a plain object**, which the error catch never
  recognises. Always `throwApi(opsWrongState(...))`.
- **Kill Bill**: `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=true` with
  `[{accountId, itemType: 'EXTERNAL_CHARGE', amount, currency, quantity}]` is how
  an invoice is made; the payment endpoint answers 201 with an **empty body**, so
  the payment id must be read back from `GET …/invoices/{id}/payments`.
  `accountBalance` needs `?accountWithBalance=true`. The tenant API key headers
  must include `X-Killbill-CreatedBy`.
- **Mailpit** deletes messages with `DELETE /api/v1/messages` and a JSON body
  `{"IDs": [...]}` — there is no per-id DELETE path.
- **nodemailer 6.9.3+ is MIT-0**, which is not in the allowed licence list; the
  pin is 6.9.2 (the last plain MIT release) so `THIRD_PARTY_NOTICES.md` stays true.
- **Overlapping fan parts**: parts stack at low separation by design, so pointer
  clicks hit the topmost part. Withdrawn parts have `pointer-events: none` on
  their decorative shape; tests should select parts by keyboard (focus + Enter),
  which is also the operator's published path.

## Test scripts

`scripts/` drives the desk against the live services (they are the only judge of
truth). Each file passes standalone, on a shared database, in this order:
`journey.py`, `journey2.py` (declines, refund, lock, erasure, imports, editions,
rate), `rehearsal.py` (frozen clocks, TTL, cutoff, zero settings), `outages.py`,
`recovery.py` (also byte-equality), `edges.py`, `roles.py`, `agreements.py`,
`fan_dialog.py`, then the browser ones: `browser_check.py`, `polish_check.py`,
`browser_journey.py`. Reset with `DROP SCHEMA public CASCADE; CREATE SCHEMA public`
and empty Mailpit before a clean run; the desk re-seeds when the catalogue is empty.
Browser journeys need `pip install playwright && python3 -m playwright install chromium`.
Wait a beat (~400 ms) after `wait_for_url` before reading a status region: the
URL changes the moment navigation starts, and the region is re-rendered after.
