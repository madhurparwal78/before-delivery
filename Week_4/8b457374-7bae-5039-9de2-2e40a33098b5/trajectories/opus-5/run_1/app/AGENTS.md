# Dotgain — repository notes

All-or-nothing crowdfunding for small-press print runs. Node 22 + TypeScript, no web
framework. Postgres, Kill Bill, Mailpit (SMTP), MinIO and Gotenberg are the only
external services.

## Layout

```
run.json              install / build / serve manifest
build.mjs             esbuild: bundles the server and the browser app (tool config, not app source)
public/               styles.css and the self-hosted Jost woff2 files, copied into dist/public
src/shared/           code both sides use: money, countries and zones, copy strings, DTO types
src/server/
  config.ts           every env value, read once at start
  data/               Postgres access, schema DDL, seed
  domain/             the rules: fees, pledge amount, percent, timezone, cards, transitions, validation
  http/               router, body limits, one error shape, static assets, the server itself
  operations/         application flows: pledge create/change/cancel, collection, fix, documents
  render/             statement and settlement HTML, and the seed cover PNG encoder
  routes/             one file per API area
  services/           Kill Bill, SMTP, MinIO (hand-rolled SigV4), Gotenberg, the status registry
  views.ts            row -> DTO assembly
src/client/           vanilla TypeScript app: router, api, ui/ components, pages/
```

## Rules that live in exactly one place

- Pledge amount: `src/server/domain/pledgeAmount.ts` (`breakdownFor`, `percentOf`).
- Fees: `src/server/domain/fees.ts` (`feesFor`), half-up in whole pence.
- Campaign and pledge transitions and their rejections: `src/server/domain/transitions.ts`.
  The counting and claiming state sets are exported from there as SQL literal lists, so
  the data layer never restates them.
- Writing a pledge state change (plus its history row): `movePledge` in `data/pledges.ts`.
- Error responses: `ApiError` in `http/errors.ts`; the browser reads only that shape.
- Published copy: `src/shared/copy.ts`.

## Decisions worth remembering

- **nodemailer is MIT-0**, which the licence policy (IF-03) does not allow, so SMTP is
  hand-rolled over `node:net` in `services/mail.ts`. The S3 client is hand-rolled SigV4
  for the same reason (keeping the shipped tree to `pg` and its 13 transitive deps).
- **Kill Bill verbs**: AUTHORIZE is `POST /1.0/kb/accounts/{id}/payments`; CAPTURE is
  `POST /1.0/kb/payments/{id}`; VOID is `DELETE /1.0/kb/payments/{id}`. Posting a body
  with `transactionType: VOID` silently performs a capture, so do not do that.
- **Test cards are simulated in the app**, never by the plugin: a declined card never
  reaches Kill Bill, and a capture-failing card is marked errored without a CAPTURE
  call. That keeps "a declined attempt leaves no successful AUTHORIZE" true.
- **Per-campaign serialisation** is an in-process async mutex (`operations/locks.ts`)
  wrapping every pledge create, change and cancel. It is what makes the last-copy race
  and the final-window guard correct. Each app copy owns its own database.
- **The one-confirmed-pledge index** covers only `authorised`, `captured` and `errored`.
  A change briefly holds an `authorising` replacement next to the hold it is releasing,
  and the pair is swapped inside one transaction with the void written **first**,
  because partial unique indexes are checked per statement, not at commit.
- **`UTC` is a valid IANA name that `Intl.supportedValuesOf('timeZone')` omits**, so
  `isTimeZone` asks ICU directly instead of consulting that list.
- **Full-bleed bands** measure against `--viewport-width` (set from
  `document.documentElement.clientWidth`), not `100vw`, so a scrollbar never causes
  sideways scrolling.
- **The pinned pledge column** needs a stretched grid item as its containing block and
  a sticky `top` computed from its measured height; a `bottom` inset does the opposite
  of what a tall sidebar needs, and an ancestor with `overflow: clip` disables sticky.
- **PDF headings are not uppercased in CSS**, because the extracted text must read
  `Dotgain backer statement` and `Dotgain settlement sheet` exactly.

## Working on it

```
npm run typecheck     # both tsconfigs, strict, no any in domain code
npm run build         # esbuild server + client into dist/
npm run start         # serves on APP_PUBLIC_PORT (4173)
```

The schema is applied on every start and the seed is inserted only when the campaigns
table is empty. To start over in development, drop and recreate the `public` schema and
restart; the seed covers are regenerated and re-uploaded to MinIO.
