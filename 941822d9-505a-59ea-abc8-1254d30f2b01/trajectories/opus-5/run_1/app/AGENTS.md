# Credwell — repository notes

Credwell is the course platform of Sorrel & Pike Learning: nurses earn contact-hour
certificates, hospitals buy seat packs and co-pay tuition, and the nurse planner runs
courses, cohorts, refunds and certificates. One TypeScript process serves the API and
the built frontend from the same origin.

## Layout

```
run.json                 install / build / serve manifest
src/server/
  config.ts              every URL and credential, read from the environment
  domain/                the rules, each decided in exactly one place
  data/                  queries and JSON views, one module per aggregate
  services/              Kill Bill, S3 (hand-rolled SigV4), SMTP, PDF, sealing, mailer
  http/                  error shape, precedence pipeline, router, sessions, statics
  routes/                one module per API area
src/web/                 React app: lib/, components/, screens/
public/fonts/            self-hosted Newsreader and Public Sans woff2
```

## Where each rule lives

| Rule | Module |
|---|---|
| coverage policy in effect, share split | `domain/coverage.ts` |
| awarded-hours rounding, progress percent | `domain/contactHours.ts` |
| cohort close instant, provider dates | `domain/providerTime.ts` |
| refund amount and split | `domain/refund.ts` |
| current certificate version, state, serial, object keys | `domain/certificate.ts` |
| every expiry comparison, share-link state | `domain/expiry.ts` |
| ledger movements and pack balance | `domain/seatLedger.ts` |
| course edges and edit permissions | `domain/courseLifecycle.ts` |
| private-field allow-list for certificate copies | `domain/certificateCopy.ts` |
| CSV neutralisation and quoting | `domain/csv.ts` |
| money in whole cents | `domain/money.ts` |
| error shape, accepted fields | `http/errors.ts` |
| precedence order (405 → boundary → 401 → 404 → 403 → preconditions → 409 → 422 → 503) | `http/server.ts` plus each route |

## Services

- **Postgres** is the system of record; the schema and seed are applied idempotently at
  every start (`db/schema.ts`, `db/seed.ts`). Seed ids are deterministic (uuid v5).
- **Kill Bill** holds every payment and refund; each write sends
  `X-Killbill-CreatedBy: credwell:<user id>`.
- **MinIO** holds certificate PDFs and completion exports; SigV4 is signed by hand in
  `services/storage.ts`.
- **Mailpit** receives the outbox; `services/smtp.ts` is a small hand-rolled SMTP client
  (nodemailer is MIT-0, which the licence allow-list does not include).

## Gotchas

- `npm ls --omit=dev` lists `pg-native` as an optional peer of `pg`; it is not installed
  and not shipped, and is noted in `THIRD_PARTY_NOTICES.md`.
- The seal press must only play when the enrolment is loaded and the session flag set by
  the evaluation submit is present; the `Seal` is rendered only once both are known.
- Dialogs render through a portal and mark `[data-inert-when-dialog]` layers inert, so
  the feedback regions sit outside those layers and stay announceable.
- Column order is swapped in the DOM (not with CSS `order`) so reading, tab and visual
  order agree at every viewport.
