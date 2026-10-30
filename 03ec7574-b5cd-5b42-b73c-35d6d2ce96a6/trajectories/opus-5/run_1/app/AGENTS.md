# Corvo — repository notes

Corvo is a treasury wallet console (public marketing site plus signed-in console) written in
plain JavaScript on Node 22. PostgreSQL at `DATABASE_URL` is the only backing service, and
`pg` is the only runtime dependency.

## Layout

| Path | Holds |
|---|---|
| `src/server.js` | HTTP server, body limits, dispatch, boot loop, expiry sweep |
| `src/config.js` | the four environment variables |
| `src/db/pool.js` | pool, `withTransaction`, `lockOrganization` (taken first by every write) |
| `src/db/schema.js` | idempotent DDL |
| `src/db/seed.js` | the pinned seed, written once under an advisory lock |
| `src/db/repo.js` | row loaders and the one place rows become API shapes |
| `src/domain/*` | amounts, addresses and EIP-55, keccak, text limits, policy grammar and evaluation, aggregations, intent transitions and execution, audit chain, signed events, credentials |
| `src/http/*` | envelope, error table, credential and role gates, idempotency, cursors, validation |
| `src/api/*` | one module per route group; handlers are transport-free services |
| `src/web/*` | server-rendered pages, the console action layer, data loaders, stylesheet |
| `src/client/*` | the per-page progressive-enhancement scripts served from `/assets` |
| `scripts/build.js` | writes `dist/assets` from `src/web/css.js` and `src/client` |

## Rules that live in exactly one place

- amount parsing and display: `src/domain/amounts.js`
- address derivation, EIP-55 and tx hashes: `src/domain/address.js`
- text normalisation, code point limits and case folding: `src/domain/text.js`
- policy grammar and the five evaluation steps: `src/domain/policy.js`
- rolling aggregation values: `src/domain/aggregations.js`
- the request-to-decision path: `src/domain/decide.js`
- intent creation, execution, expiry and reservations: `src/domain/treasury.js`
- audit hashing and event signing: `src/domain/audit.js`
- error codes, statuses and messages: `src/http/errors.js`
- console copy (toasts, result lines): `src/web/messages.js`

Pages and API routes call the same service functions: `src/web/actions.js` builds a context
and calls the handlers in `src/api/*`, so the browser and the API share every rule.

## Working notes

- Every write runs in one transaction that starts with `lockOrganization`, which orders writes
  per organization and keeps the audit `seq` and signed `seq` gapless.
- No amount passes through a JavaScript `Number`; amounts are `BigInt` and `numeric` columns.
- The console is cookie-authenticated (`corvo_session`); the API takes bearer tokens and API
  keys. No token is ever written into a page.
- Console forms post to their own page with `__action`; with scripts they post the same body
  with `X-Corvo-Enhanced: 1` and get JSON back.

## Local checks

```sh
node scripts/build.js      # writes dist/assets
node src/server.js         # serve on APP_PUBLIC_PORT (4173)
curl -s localhost:4173/api/health
```

To start from the pinned seed again, drop every table and restart `serve`; the seed only
writes into an empty database.
