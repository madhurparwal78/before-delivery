# Lacquer — repository notes

Lacquer is the operations app of Marrow & Lark Motor House: bays, belongings, care rounds,
paint jobs with a coat stack, invoices through Kill Bill, releases and an owner portal.

## Running it

- `npm ci`, `npm run build`, `npm run start` — the three commands in `/app/run.json`.
- The server binds `0.0.0.0:4173` (or `APP_PUBLIC_PORT`) and applies the schema and the seed
  at every start. The seed is written only into an empty database.
- Every credential, URL and timer comes from the environment (see `src/server/config.ts`).
  Nothing is hard-coded, logged or sent to the browser.

## Shape of the code

| Area | Where |
| --- | --- |
| Rules shared by server and browser | `src/shared` (money, units, zurich, panels, stages, coat stack, job and release states, bay fit, return address) |
| HTTP core (one error shape and precedence) | `src/server/http` |
| Domain reads and decisions | `src/server/domain` |
| API routes | `src/server/routes` |
| Providers (Postgres, MinIO, Kill Bill, SMTP) | `src/server/db.ts`, `src/server/providers` |
| Queue and recovery | `src/server/queue.ts` |
| Browser app | `src/client` (screens, components, `lib` for api/session/hooks/router) |

Each domain rule lives in one place: bay fit in `shared/bays.ts`, job moves in
`shared/jobstates.ts`, release moves in `shared/releasestates.ts`, money in `shared/money.ts`,
units in `shared/units.ts`, Zurich dates in `shared/zurich.ts`, bands and layers in
`shared/coatstack.ts`, the return address in `shared/returnaddress.ts`, start-up status in
`server/domain/startup.ts`, the owner projection in `server/domain/projection.ts`.

## Things worth remembering

- Money and readings are exact: bigints scaled by 100 (CHF, quantities, bar) or whole µm/km.
  Kill Bill numbers are parsed with `JSON.parse`'s source access so amounts never pass
  through binary floating point.
- Cross-process rules use Postgres advisory locks inside a transaction:
  `car:<id>`, `job:<id>`, `invoice:<id>`, `release:<id>`, plus unique indexes for one car per
  bay and one open release per car and per slot.
- Idempotency records are reserved before the handler runs and deleted when it fails, so a
  failed attempt may be retried with the same key on any process.
- The session cookie carries no Max-Age: the server, not the browser, decides expiry, so an
  expired session answers `session_expired` and the screen opens Sign in again in place.
- Status regions and dialogs are rendered through portals into `#status-layer` and
  `#dialog-layer`, so a dialog can make `#app-shell` inert while status regions still reach
  assistive technology. Empty status regions stay in the accessibility tree (no `display:none`).
- Re-reads only replace data state; dialogs live at screen level so a row that moves or
  disappears never unmounts an open dialog.
- The queue worker ticks every 2 seconds and gates a subscription cancellation on the
  charged-through date, which keeps the order account → subscription → first invoice →
  cancellation.
- A bay subscription is keyed `<prefix>car-<car id>` and reused. When Kill Bill reports that
  key as cancelled — a car taken in again after a release — the next stay gets its own
  `-stay-<n>` key, so a new stay is billed again.

## Checking a change

There is no test runner in the repository. Ad-hoc checks used during development:

- API journeys with `fetch` against a running server (sign in as the seeded users, password
  `lacquer-demo-2026`).
- Browser checks with Playwright (`npx playwright install chromium` plus
  `npx playwright install-deps chromium`), driving the published roles and names.
- `npm run typecheck` runs both TypeScript projects.
