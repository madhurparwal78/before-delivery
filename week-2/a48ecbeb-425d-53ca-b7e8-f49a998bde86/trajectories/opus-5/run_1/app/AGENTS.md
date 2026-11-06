# Ceibo Shop & Cellar

An online shop and back office for a Canadian brand of organic sparkling yerba
mate. Node 22, TypeScript end to end, React on the client, no framework on the
server.

## Running it

`/app/run.json` is the only published way to start the app:

```
npm ci        # install
npm run build # tsc for the server, vite for the client
npm run start # node dist/server/index.js, binds 0.0.0.0:$APP_PUBLIC_PORT
```

`GET /api/health` answers `{"status":"ok"}` even when every service is down.
Several processes may run at once against the same services; every piece of
scheduled work is claimed in Postgres first, so each runs exactly once.

## Layout

| Path | What lives there |
|---|---|
| `shared/` | Domain rules used by both sides: the quote arithmetic, the refund split, order transitions, subscription change legality, the change cutoff, the dunning schedule, the seed catalogue and every published copy string. |
| `server/domain/` | Server-only rules: card validation and the test cards, postal codes, multipart and file sniffing. |
| `server/db/` | Postgres: schema, seed, and one repository per aggregate (cart and holds, stock ledger, orders and refunds, subscriptions, attempt keys, sessions, outbox). |
| `server/services/` | The five service clients: Kill Bill, PocketBase, MinIO (hand-signed SigV4), SMTP, plus the health registry and the PDF writer. |
| `server/app/` | The flows: checkout, renewals, dunning, refunds, subscription changes, documents, emails, the live feed. |
| `server/routes/` | One file per API group; each exports an array of `Route`. |
| `server/http/` | The router, the single error shape and static file serving. |
| `server/jobs/` | The scheduler: hold expiry, renewals, dunning steps, confirmations, the outbox, upcoming-renewal emails. |
| `client/src/` | React app: `state/` (shop store, flights, viewport, reduced motion), `components/`, `pages/`, `office/`, `styles/`. |

## Rules that live in exactly one place

- Quote arithmetic — `shared/quote.ts` (`buildQuote`). Worked examples from the
  brief all match.
- Refund allocation — `shared/refundSplit.ts` (`splitRefund`), largest remainder
  over line goods, line deposit, shipping, tax, in that order.
- Order transitions — `shared/orderStatus.ts`.
- Subscription change legality, the change cutoff and the dunning schedule —
  `shared/subscription.ts`.
- Ledger identities — `server/db/ledger.ts`. `reserved` is `reserved` events
  less `released` events, so the ledger is the only source of stock truth.
- Every published sentence — `shared/copy.ts`. Never write copy inline.

## Service notes worth keeping

- **Kill Bill** 0.24.21 at `/1.0/kb`. Health is `/1.0/healthcheck` (not under
  `/kb`). Each customer's account carries `AUTO_PAY_OFF` and
  `AUTO_INVOICING_DRAFT`, so a box invoice is raised as DRAFT; the server adds
  the deposit, shipping and tax charges, commits it, then pays it. A payment's
  external key is `<database>/<order number>`.
- A blocking state's effective date comes from the **`requestedDate` query
  parameter**; `effectiveDate` in the body is ignored. States with the same
  effective date apply in the order they were added, which is how a resume
  cancels a pause that has not started.
- `GET /1.0/kb/accounts/{id}/block` reads blocking states, and they cover every
  subscription on the account, so always filter by `blockedId`.
- This instance is **not** in Kill Bill test mode, so `POST /1.0/kb/test/clock`
  answers 500. `GET` on it still works and is the tenant clock the app reads.
  To raise a renewal invoice by hand, `POST /1.0/kb/invoices?accountId=…&targetDate=…`.
- **PocketBase** is pre-0.23: authenticate at `/api/admins/auth-with-password`
  and collections use the `schema` array. `scope` on `reviews` and
  `stock_levels` is the database name, so processes sharing PocketBase stay apart.
- **MinIO** is reached with a hand-written SigV4 signer in
  `server/services/files.ts`; no AWS SDK ships.
- **Mail** is a small SMTP conversation in `server/services/smtp.ts`. Everything
  goes through the Postgres outbox first, so a mail outage never fails a request.

## Gotchas found the hard way

- `transaction()` only turns *connection* failures into `503 store_unavailable`;
  whatever the callback throws passes through unchanged. Without that, a Kill
  Bill outage looked like a database outage.
- Reads taken inside a transaction must be given the transaction
  (`findOrder(number, tx)`); the pool is a different connection and cannot see
  uncommitted rows.
- React 19 removed the global `JSX` namespace: components return `ReactElement`.
- The cart drawer closes on a route change only, never on a countdown tick; the
  shop store's `openCart`/`closeCart` are stable callbacks for that reason.
- `networkidle` never settles in this app because of the `/api/live` stream; use
  `domcontentloaded` plus an explicit wait in browser checks.
