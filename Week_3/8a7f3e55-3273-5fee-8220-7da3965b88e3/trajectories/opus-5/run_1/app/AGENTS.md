# Relayline — repository notes

Dispatch and billing desk for Tandem Hands Collective (ASL interpreting agency).
TypeScript everywhere: `src/server` (Node http server + API), `src/web` (React front end),
`src/shared` (API types used by both).

## Commands

- `npm run build` → `vite build` (to `dist/web`) then `tsc -p tsconfig.server.json` (to `dist/server`).
- `npm run start` → `node dist/server/server/index.js`, binds `0.0.0.0:${APP_PUBLIC_PORT:-4173}`.
- `npm run typecheck` → both projects, `noUnusedLocals` and `exactOptionalPropertyTypes` on.

## Domain rule locations (one place each)

| Rule | File |
|---|---|
| Agency wall-clock resolution, DST gaps and repeats | `src/server/domain/time.ts` |
| Team seat rule, status from seats, open-call close instant | `src/server/domain/booking-rules.ts` |
| Qualification by credential and setting | `src/server/domain/qualification.ts` |
| Rotation plan, turns, gaps, coverage | `src/server/domain/rotation.ts` |
| Contract rate selection and line arithmetic | `src/server/domain/billing.ts` |
| Late-cancellation cutoff and quote | `src/server/domain/cancellation.ts` |
| Code-point text lengths | `src/server/domain/text.ts` |
| Display name and RFC 5987 download name | `src/server/domain/prep-names.ts` |
| Accepted file kinds from bytes | `src/server/domain/file-kind.ts` |
| Idempotency key claiming | `src/server/http/idempotency.ts` |
| Line sync state | `src/server/workers/billing-sync.ts` |

## Service notes

- **Kill Bill** invoice items only come back with **both** `withItems=true` *and*
  `includeInvoiceComponents=true`. Without the second parameter `items` is always `[]`,
  which silently breaks read-back and causes repeated postings.
- Charge posting: `POST /1.0/kb/invoices/charges/{accountId}?autoCommit=true` with a JSON
  array body. Account lookup by `externalKey`; creation answers 409 when it already exists.
- **MinIO** is driven by a hand-written SigV4 client in `src/server/services/s3.ts`
  (path-style addressing, no AWS SDK).
- **Mailpit** HTTP API at `$MAILPIT_URL/api/v1/messages` is handy for checking the queue.

## Front-end conventions

- A control's accessible name must be exactly its label, so every form control uses
  `components/Field.tsx` (explicit `label for` plus `aria-describedby` for hints) rather than
  a wrapping `<label>`, which would fold hints and messages into the name.
- `api.ts` owns the session-ended resume rule and the action/refetch ordering counter
  (`noteActionFinished`, `refetchToken`, `tokenIsFresh`); `hooks.ts` owns the ten-second
  refetch that discards stale responses.
- Live-region announcements are generation-stamped in `live.tsx`: each one empties both
  regions first, so a later announcement has to cancel the earlier deferred write.
- Weave motion is CSS driven. `weave-enter` uses `animation-fill-mode: backwards` so the
  animation leaves `getAnimations()` once it settles; the collapse veils use `forwards`
  because their elements are removed as soon as the plan settles.

## Local development

- `ps`/`pkill` are not installed in this image. Find the server with
  `for p in /proc/[0-9]*; do grep -qa dist/server/server/index.js $p/cmdline && echo ${p#/proc/}; done`.
- Manual API testing leaves rows in Postgres, charges in Kill Bill, objects in MinIO and
  messages in Mailpit. Clean all four before finishing a session, otherwise a fresh run can
  adopt a stale Kill Bill charge whose description starts with a reused line reference.
  Kill Bill invoices cannot be deleted; void them with
  `PUT /1.0/kb/invoices/{invoiceId}/voidInvoice`, which also hides their items from the
  read-back query.
- A second process with broken dependencies is a good outage test:
  `APP_PUBLIC_PORT=4174 KILLBILL_URL=http://127.0.0.1:9 S3_ENDPOINT=http://127.0.0.1:9
  SMTP_HOST=127.0.0.1 SMTP_PORT=9 node dist/server/server/index.js`.
