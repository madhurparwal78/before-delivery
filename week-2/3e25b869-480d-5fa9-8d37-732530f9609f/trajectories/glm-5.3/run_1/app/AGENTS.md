# AGENTS.md — Pain de Lune Loafline

## Commands

- Install: `npm ci`
- Build (server + client): `npm run build` (outputs `dist-server/main.js` and `dist/`)
- Serve: `npm run start` → listens on 0.0.0.0:$APP_PUBLIC_PORT (default 4173)
- Typecheck: `npm run typecheck`

## Services

- PostgreSQL (`DATABASE_URL`): all shop data. Schema + seed re-apply idempotently on every boot (`src-server/db/schema.ts`); an empty database comes up seeded (batches B-0412…B-0414, three staff members, counters).
- Kill Bill (`KILLBILL_*`): system of record for money. Verified against this tenant's API: `POST /1.0/kb/invoices/charges/{accountId}` (draft external charges), `POST /1.0/kb/invoices/taxes/{accountId}`, `PUT /invoices/{id}/commitInvoice` (CBA auto-applies at commit — drop orders delete the CBA item to charge in full), `POST /invoices/{id}/payments?externalPayment=true` (201 or 204; resolve the payment by external key afterwards), `POST /invoicePayments/{paymentId}/refunds` (do NOT pass externalPayment — otherwise the refund lands as a standalone CREDIT payment instead of a REFUND transaction), `POST /1.0/kb/credits?autoCommit=true`, `POST /1.0/kb/subscriptions` (`{accountId, externalKey, planName}`), blocking states via `POST /subscriptions/{id}/block?requestedDate=…` (Kill Bill keeps the FIRST blocking state per state name — duplicates are ignored), plan changes via `PUT /subscriptions/{id}` with `requestedDate`, undo via `PUT /subscriptions/{id}/undoChangePlan`, cancel via `DELETE /subscriptions/{id}` with END_OF_TERM policies.
- The trio catalog is ensured at boot and every 10s until it exists: `trio-monthly`, `trio-bimestrial`, `trio-quarterly`, $29.04 pre-tax, no trial.
- SMTP (`SMTP_HOST`/`SMTP_PORT`, no auth, no TLS): every customer email is a notice (`notices` table), delivered oldest-first with retries at 5/15/45s and a 4-attempt ceiling; a failed notice can be resent once. Message-ID `<notice-key@paindelune.example>`.

## Architecture notes

- Server: Node 22 + `node:http`, TypeScript bundled by esbuild (`packages: external` — pg is required from node_modules at runtime). Client: Preact + Vite (also builds the native esbuild/rollup binaries via vite's own postinstall).
- Every API error flows through `ApiError` → one published error body (`core/http.ts`); allowed body keys per route are declared once and both reject extra keys (dotted paths, 422) and read accepted values (`checkShape`).
- Money is integer cents everywhere; the single rounding rule is `applyRate` in `core/money.ts`. Refund allocation lives only in `domain/refunds.ts`.
- Sessions: HMAC-signed tokens stored in `sessions`; when `SESSION_SECRET` is unset a fresh secret is generated at start, so server restarts invalidate sessions (per the brief).
- Test flakiness to remember: Mailpit's search returns the newest message per address; the outbox kicks delivery within ~100ms of a notice being queued, so code emails arrive quickly.
