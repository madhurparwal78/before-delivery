# Tallwind — repository notes

Tallwind is a business banking cockpit and its marketing site. Node.js serves
both the pages and the JSON API from one origin; PostgreSQL holds every row.

## Layout

| Path | What lives there |
|---|---|
| `server/index.js` | the HTTP server: body cap, content-type gate, static files, page shell |
| `server/api/` | the published API surface (`index.js` holds the route table) |
| `server/lib/` | one module per domain rule (see below) |
| `public/` | the browser app: no build step, native ES modules |
| `public/js/pages/` | marketing pages and the two page bundles the router imports |
| `public/js/cockpit/` | the cockpit shell and its pages |

## Where each rule is defined once

| Rule | Module |
|---|---|
| business clock (`APP_NOW`) | `server/lib/clock.js` |
| New York calendar, midnights, end-of-day | `server/lib/nytime.js` |
| Federal Reserve business days | `server/lib/fedcal.js` |
| cutoffs, thresholds, settlement preview, approval expiry | `server/lib/settlement.js` |
| text, code-point lengths, amounts, ABA checksum, id form | `server/lib/validate.js` |
| error shape and precedence | `server/lib/errors.js`, `server/api/index.js` |
| available balance, tenancy, serialisers | `server/lib/domain.js` |
| hold release and expiry | `server/lib/holds.js` |
| posting a payment | `server/lib/payments_core.js` |
| audit chain | `server/lib/audit.js` |
| idempotency | `server/lib/idempotency.js` |
| CSV neutralisation | `server/lib/csv.js` |
| dollar input, money and date formatting | `public/js/format.js` |
| safe `next`, routing, status announcements | `public/js/router.js`, `public/js/status.js` |
| cockpit breakpoints | `public/js/cockpit/shell.js` (`layout()`) |
| literal search and latest-answer-wins | `public/js/cockpit/search.js` |

## Things worth knowing

- Every write locks its company row first (`db.lockCompany`), so all decisions
  about one company's money are serialised by the database and never deadlock.
  Reads that must agree with themselves use `db.readSnapshot`
  (`REPEATABLE READ READ ONLY`).
- The pool is capped at 10 connections. Streams never hold one: a single
  poller (`server/lib/stream.js`) reads new transactions for every open stream.
- A browser allows only a handful of connections per host, so one cockpit tab
  holds the stream (a lease in `localStorage`) and passes each event to its
  sister tabs over a `BroadcastChannel` (`public/js/cockpit/data.js`).
- A pending button uses `aria-disabled`, never the `disabled` attribute: a
  disabled control loses focus to the page body, which the Approvals and feed
  focus rules forbid (`setBusy`/`clearBusy` in `public/js/dom.js`).
- A row that is already in the right place is never re-inserted (`placeAfter`),
  because moving a node blurs whatever inside it had focus.
- `[hidden]` is forced to `display: none` in the stylesheet; several components
  set `display` themselves, which would otherwise override it.
- Seeds are written the first moment the database answers, dated from the
  business clock at that moment, so a server started before its database still
  seeds correctly.

## Running locally

```sh
npm ci --omit=dev
npm run start          # reads DATABASE_URL, APP_PUBLIC_PORT, APP_NOW
curl localhost:4173/api/health
```

Seeded logins are listed in `USER_README.md`.
