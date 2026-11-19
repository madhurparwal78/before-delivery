# Wayticket — repository notes

Wayticket is the working desk of one independent coach-hire arranger: a public site and quote form, the
private bid, quote and run-sheet pages, and the signed-in desk screens behind them.

## Running it

- `npm ci`, `npm run build`, `npm run serve` — the three commands named in `/app/run.json`.
- The server binds `0.0.0.0:4173` (`APP_PUBLIC_PORT`). `GET /api/health` answers `{"status":"ok"}`.
- Schema and seed apply on serve, idempotently: the seed is written only when the `desks` table is empty.
- Only Postgres is needed to boot. MinIO, Gotenberg, ntfy, SMTP and WireMock are reached per action and
  each outage has its own published answer.

## Layout

| Place | What lives there |
|---|---|
| `src/domain` | the rules, free of HTTP and SQL: UK time, money in pennies, the fewest-vehicles plan, seats, drivers' hours, allocation and cancellation, statement reading, published strings |
| `src/server/data` | one module per aggregate (hires, enquiries, operators, bids, runs, payments, documents, customers, passengers, rates, holidays, ledger) |
| `src/server/routes` | the published endpoints, one module per workflow, assembled in `src/server/index.ts` |
| `src/server/render` | server-rendered HTML for every page: public site, quote form, desk screens, private pages |
| `src/server/providers` | MinIO (own SigV4 signer), Gotenberg, ntfy, SMTP, and the five WireMock APIs |
| `src/client` | the browser bundle: dialogs, the five-second refresh, the Journey ticket, desk actions, the run sheet queue |

## Rules worth knowing before editing

- **One place per rule.** Money lives in `domain/money.ts`; deposits and VAT in `domain/vehicles.ts`;
  allocation, cancellation bands and waiting charges in `domain/payments.ts`; breaches in `domain/hours.ts`.
  Nothing else recomputes them.
- **Money is pennies.** Integers only; `moneyString` and `moneyLabel` print them.
- **Time is Europe/London, decided on the server** at each read or press. `domain/time.ts` reads wall times
  through `Intl`, so the missing hour answers no instant and the repeated hour answers two.
- **Desks are kept apart** by composite keys `(desk_id, id)` on every table, so another desk's identifier
  simply finds nothing.
- **The ladder** lives in `routes/router.ts` and `http.ts`: size before rate limit, rate limit before origin,
  origin before authentication, and each handler then raises unknown, content type, validation, state, stale.
- **Pages are rendered on the server.** The client refreshes a screen by fetching the same address with
  `x-wayticket-refresh: 1` and morphing `#main`, so focus, open dialogs and typed values stay.
- **Motion** runs through `play()` in `src/client/dom.ts` at 160, 320 or 640 ms and nowhere else.

## Checking work

- `npx tsc -p tsconfig.json --noEmit` type-checks the server and the domain.
- `npm run build` also regenerates `THIRD_PARTY_NOTICES.md` and refuses a licence outside the allowed list.
- The seeded desk signs in as `maria@merrowfield.example` / `Merrowfield-Desk-2027`; the second desk
  (`tomasz@zielinski-hire.example` / `Zielinski-Desk-2027`) exists only to prove the desks never meet.
