# Spindrift Rooms — project notes

Single-artist AI installation studio commissioning app. TypeScript on Node 22, Express 5, pg, no other runtime deps.

## Layout

- `server/` — API + domain. `domain/` holds each rule in exactly one place: `money.ts` (tax rounding + the largest-remainder splitting rule), `state-machine.ts` (commission transitions), `placement.ts` (snapping/overlap/door clearance), `dates.ts` (venue-local day edges, due dates, DST), `ssrf.ts` (reference-image address check).
- `server/routes/` — one router per area (briefs, venues, commissions, files+renders, holds, payments, funders, misc, callbacks, auth, events).
- `server/worker.ts` — durable job runner. Jobs live in the `jobs` table, claimed with `FOR UPDATE SKIP LOCKED` plus a 30s lease; failures retry every 10s.
- `client/` — SPA emitted as native ES modules (no bundler); `tsc` emits per-file into `dist/client/assets/app`.
- `public/` — shell html, stylesheet, favicon.

## Provider quirks found at run time (verified by probing)

- **Kill Bill 0.24**: catalog upload via `POST /1.0/kb/catalog/simplePlan` (not `/catalog/simple`); external-charge invoices via `POST /invoices/charges/{accountId}?autoCommit=true`; payments via `POST /invoices/{id}/payments?externalPayment=true` with `accountId`+`targetInvoiceId` in the body; subscriptions via `POST /subscriptions` then `GET /subscriptions?externalKey=` which answers a **single object**, not an array. `/healthcheck` 404s — use `GET /tenants?apiKey=` as the probe.
- **WireMock render provider**: single stub `POST /v1/renders` → 202, never posts callbacks itself. The worker drives the job forward by posting the provider's own signed callbacks to `/api/render-callbacks`, so signature/timestamp/event-id/PNG verification all run on the real path.
- **ntfy**: titles contain em dashes which cannot travel in an HTTP header; publish with `PUT /<topic>?title=…&tags=…` and a plain-text body.
- **Svix**: create the app (`uid client-<user id>`) before the endpoint or `msg create` 404s; attempts list is `GET /app/{uid}/msg/{eventId}/attempt`.
- **pg**: install v8 (`pg@8.23.1`); v3 has no `Pool` on its default export.

## Key invariants

- Exactly one winner per venue day: unique partial index `holds (venue_id, date) WHERE state='held'`; the loser's transaction aborts and the free days are read after rollback (`DayTaken`).
- `paid`/`stored`/`ready` are only ever set from provider confirmations.
- Amounts split by largest remainder; the ledger always sums to the quote total.
- Sign-in is browser-bound: the OIDC attempt cookie must match the callback state, one use only.
