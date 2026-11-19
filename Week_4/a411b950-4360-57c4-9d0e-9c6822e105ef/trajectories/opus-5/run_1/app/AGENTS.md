# Earshot — repository notes

Kettlehole Audio Earshot: a scroll-driven 3D portfolio corridor plus a booking console for one
freelance game audio operator. Node 22 + TypeScript, no framework.

## Layout

```
run.json                 install / build / serve commands (run-manifest-v1)
scripts/build.ts         esbuild: server bundle, three client bundles, CSS, fonts, HTML shells
src/shared/              domain rules used by both server and browser
  money.ts               cents, the 30/20/20/30 split, money and share formatting
  dates.ts               operator-time-zone formatting, business date and month
  projectStatus.ts       layers, credit labels, visibility, project moves
  enquiryStatus.ts       pipeline states, legal moves, read-time status (TS and SQL)
src/server/
  config.ts              every service URL and credential, read from the environment
  errors.ts              the one error shape: {error, message, ...extras}
  db/                    pool, schema statements, seed data, code-synthesized seed stems
  domain/                server-only rules: text, audio sniffing, cursor, csv, link status, writable fields
  http/                  router (error precedence), body limits, static and page serving
  repo/                  projects, enquiries, months, pacing, idempotency, settings
  routes/                public journey, listen, enquiries, proposals, console*
  services/              storage (hand-rolled S3 SigV4), smtp, mime, emails, killbill, mail queue, auth
src/client/
  journey/               sound gate, WebGL corridor, Web Audio engine, stations, brief form
  proposal/              producer proposal page
  console/               operator console views
  shared/                dom, api, icons, wall-time conversion
```

## Rules that live in exactly one place

- milestone split and money formatting: `src/shared/money.ts`
- date, month and business-date formatting: `src/shared/dates.ts`
- read-time enquiry status: `src/shared/enquiryStatus.ts` (`readTimeStatus` and `READ_TIME_STATUS_SQL`)
- project visibility: `src/shared/projectStatus.ts` (`isPublicallyVisible` and `PUBLICLY_VISIBLE_SQL`)
- link status: `src/server/domain/linkStatus.ts`
- writable field lists: `src/server/domain/writable.ts`
- CSV neutralisation: `src/server/domain/csv.ts`
- a month's claimed count and openness: `src/server/repo/months.ts`
- proposal-email cancellation: `CANCELLED_SQL` in `src/server/services/mail.ts`
- paging cursor: `src/server/domain/cursor.ts`

## Service notes

- **Kill Bill**: accounts carry the `AUTO_PAY_OFF` control tag so committed invoices are not
  paid automatically; the deposit is paid explicitly through
  `POST /1.0/kb/accounts/{id}/payments` with `controlPluginName=__INVOICE_PAYMENT_CONTROL_PLUGIN__`
  and `pluginProperty=IPCD_INVOICE_ID=<invoice>`, which is the only route that honours our
  transaction external key and still settles the invoice.
- **MinIO**: signed by hand (SigV4) in `services/storage.ts`; present objects are remembered for
  ten seconds, failures never are.
- **SMTP**: hand-rolled client so the queue can send the stored message bytes unchanged.
- **PostgreSQL**: holds sessions, idempotency records, pacing counts and the mail queue, so
  several instances share them. Cursors are HMAC-signed with a key kept in `settings`.
- The operator's time zone reaches the browser through a `meta[name="earshot-time-zone"]` tag
  that the page shell fills in at request time.

## Working on this

- `npm run typecheck` before building; `npm run build` then `npm start`.
- The server binds `APP_PUBLIC_PORT` (default 4173) and the origin check compares against
  `APP_PUBLIC_URL`, so browse the app on `127.0.0.1` when that is what the variable says.
- Seed data is applied once per record through the `seed_marker` table, so records the operator
  changed or withdrew are never recreated.
