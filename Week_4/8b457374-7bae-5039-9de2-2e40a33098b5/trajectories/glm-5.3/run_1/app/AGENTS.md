# Dotgain

Coldset Works' all-or-nothing crowdfunding app for small-press print runs.

## Architecture

- Node 22 + TypeScript (strict), serving on `0.0.0.0:4173` from `dist/server/main.js`.
- `run.json`: `npm ci` / `npm run build` / `npm run start`.
- Data: Postgres only. Objects: MinIO (`S3_*`). Card holds: Kill Bill. Email: SMTP (Mailpit). PDFs: Gotenberg.
- Frontend: plain ES modules built by esbuild into `public/js`, one halftone-teal design system (`public/css/dotgain.css`), Jost font files in `public/fonts`.

## Kill Bill quirks discovered by probing (important)

- AUTHORIZE: `POST /1.0/kb/accounts/{accountId}/payments?paymentMethodId={pm}` — 201 with **empty body**; the payment id comes from the `Location` header; verify by `GET /payments/{pid}`.
- CAPTURE: `POST /1.0/kb/payments/{pid}` (the `transactionType` body field is ignored — this endpoint always captures).
- **VOID: `DELETE /1.0/kb/payments/{pid}`** with body `{"transactionExternalKey","currency"}` — the usual `/voids` subresource is not deployed in this environment (404). Verify the VOID transaction by reading the payment.
- Account/payment-method creation races answer 500 (SQL duplicate); always read back before deciding failure.
- The `__EXTERNAL_PAYMENT__` plugin always returns SUCCESS, so the test cards (`4242…`, `…0002`, `…0341`) are simulated by the app: declines never reach Kill Bill, and the capture-failing card never records a capture.

## Notes

- `resolveLocalDeadline` (server/clock.ts) resolves a wall-clock deadline in the campaign's IANA zone; skipped local times are rejected, ambiguous ones take the earlier instant.
- Every pledge state transition is a SQL statement guarded by its own status predicate (see server/states.ts).
- The seeded 1,550-pence Reading-copy example must yield fees 78/67/1,405 — `feesForAmount` in shared/money.ts is the single implementation.
