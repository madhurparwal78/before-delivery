# Corvo — repository notes

Corvo is a treasury wallet console plus its public marketing site, in Node 22
ESM with PostgreSQL as the only backing service.

## Layout

- `server.js` — HTTP server, boot (schema + seed with retry), page routing entry, expiry sweep.
- `lib/` — domain rules, each decided in one place:
  - `core.js` — amounts (exact BigInt base units; never Number), ids, timestamps, tx hash, wallet address.
  - `address.js` — address shape and EIP-55 checksum (keccak-256 via js-sha3).
  - `text.js` — NFC, code-point length, control-character refusal, case folding.
  - `policy.js` — the five policy steps and rolling aggregations.
  - `policy-validate.js` — the policy grammar and its check order.
  - `intents.js` — transfer/batch body checks, execution, ledger pairs, expiry, reservations.
  - `audit.js` — audit chain hash, signed event signatures, verification.
  - `seed.js`, `schema.js` — idempotent schema and one-shot seed under a transactional advisory lock.
- `api/` — request pipeline (precedence, envelope, idempotency) and route tables.
- `pages/` — server-rendered HTML for public and console pages, plus `assets/`.

## Conventions

- Every amount is a BigInt of base units from request to response; `numeric` in Postgres.
- Every write is one transaction that locks the rows it reads and allocates audit
  and signed seq inside it.
- Policy denials commit their audit and signed events before the refusal is thrown.
- Run the full suite with `sh tests/run-all.sh` (needs a live server DB).
