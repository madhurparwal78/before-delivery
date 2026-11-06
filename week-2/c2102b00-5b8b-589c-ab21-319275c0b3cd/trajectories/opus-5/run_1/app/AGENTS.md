# Tally Split — repository notes

Buying-club split-case app for Tare & Tally. TypeScript on Node 22, one SQLite file,
three providers (Kill Bill, Mailpit SMTP, MinIO). Run only through `/app/run.json`.

## Layout

- `src/server` — HTTP server, API, domain rules, providers.
  - `domain/` holds each rule in exactly one place: `clubTime`, `cycleState`, `lines`,
    `shares`, `credit`, `shorts`, `pickupWindow`, `amount`, `cycleName`, `uploads`, `ledgerOrder`.
  - `http/` holds the error shape, session, idempotent replay and the route table.
  - `services/` holds the multi-step flows: cycle field validation, close.
  - `store.ts` is the only place SQL meets the domain.
- `src/client` — vanilla TypeScript SPA.
  - `pages/` one file per screen; `caseBlock.ts` holds the member case block and its
    fill-the-case sequence; `memberCycle.ts` owns the line-version gate and rail/tab layout.
  - `crate/` holds the Three.js crate: `model.ts` derives the whole picture from a line,
    `view.ts` owns the document's single WebGL context and the one frame gate,
    `gl.ts` builds the scene, `still.ts` draws the WebGL-free fallback.
- `src/shared` — API types and money formatting used by both sides.
- `scripts/build.mjs` — type check, bundle server and client, copy fonts.
- `scripts/notices.mjs` — regenerates `THIRD_PARTY_NOTICES.md` from the production tree.

## Working with it

- `npm run build` runs `tsc --noEmit` first, so a type error fails the build.
- `npm start` serves `dist` on `APP_PUBLIC_PORT` (4173) and creates `data/tally.db` with
  the seed on first start. Delete `data/` for a fresh seed.
- Several processes may share one database file; writes go through `writeTx`
  (BEGIN IMMEDIATE, 5s busy timeout, 503 `database_busy` when still blocked).

## Environment notes learned here

- Kill Bill: amounts may be sent as decimal strings; `GET /1.0/kb/payments?externalKey=`
  answers 404 when no payment exists; external charges are posted with
  `POST /1.0/kb/invoices/charges/<account>?autoCommit=true` and answer 200.
- Kill Bill's `invoice_items.description` column cannot hold four-byte characters
  (emoji). Close posts the exact description first and falls back to the same text
  without astral characters when the provider refuses it, matching either form when
  deciding what is already posted.
- Mailpit lives at `mailpit:1025` (SMTP) and `mailpit:8025` (HTTP API, handy for checks).
- MinIO is reached with hand-rolled SigV4 in `providers/storage.ts`; bucket `S3_BUCKET`
  already exists and is never created by the app.

## Checking behaviour by hand

- Several server processes can run side by side for concurrency checks, each with its own
  port and provider settings, e.g.
  `APP_PUBLIC_PORT=4174 node dist/server/index.js` and
  `APP_PUBLIC_PORT=4175 KILLBILL_URL=http://127.0.0.1:9 node dist/server/index.js`
  for an outage copy. There is no `ps` or `pkill` in this image; find server processes by
  scanning `/proc/*/cmdline`.
- Mailpit's HTTP API (`http://mailpit:8025/api/v1/messages`) shows decoded subjects and
  bodies; MinIO can be listed with `curl --aws-sigv4 "aws:amz:us-east-1:s3"`.
- Kill Bill keeps its data between runs, so idempotency keys in throwaway scripts should
  carry a random suffix.

## Conventions

- Money is integer cents end to end; formatting happens only at display and email time.
- Published copy lives in `src/client/copy.ts`; server field errors deliberately use the
  same published wording so screens can print them unchanged.
- The crate never draws unless its picture signature changes (`CrateView.requestDraw`).
