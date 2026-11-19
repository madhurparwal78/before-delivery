# Fio Contado Desk — working notes

A desk for one independent life-cycle assessor: supplier facts in, exact figures out,
and a public product passport.

## Layout

```
run.json                  install / build / serve manifest
scripts/build.mjs         esbuild: server bundle, client bundle, css, fonts
scripts/notices.mjs       regenerates THIRD_PARTY_NOTICES.md from the production tree
src/assets/fonts/         Sora, Noto Sans, Noto Sans Arabic + OFL texts (bundled, never fetched)
src/server/
  config.ts               every credential and address, read from the environment
  ids.ts                  opaque ids, unguessable tokens, scrypt passwords
  pages.ts                document routes (status, lang and dir set before any script)
  work.ts                 the 2-second ticker: mail, reminders, label erasure, deletions
  domain/                 the one place each rule lives
    decimal.ts            exact decimals (decimal.js, precision 60, half up)
    display.ts            the display rule, mass, shares, differences
    time.ts               Europe/Lisbon business time and every town's wall clock
    numbers.ts            the local number rule per language, megajoule conversion
    text.ts               the folding table, character counting, the GTIN check digit
    copy.ts               every published line of copy, in one place
    factors.ts            measures, stages, units, the twelve material names
    footprint.ts          the footprint sum, data quality, scenarios, Try one garment
  db/                     schema, idempotent seed, pool
  http/                   one error shape, one precedence ladder, the router, multipart
  services/               MinIO (own SigV4), SMTP (own client), WireMock, Gotenberg
  store/                  reads, published shapes, guards, rate limits, results
  api/                    endpoint handlers, one file per group
  views/                  server-rendered HTML for every screen
src/client/               the behaviour layer over the server-rendered DOM
```

## How the frontend works

* Every screen is server-rendered. The client never builds a screen from scratch:
  it fetches the same address and **morphs** `main` and the dialog container
  (`src/client/morph.ts`). That keeps element identity, so strata transition
  rather than being replaced, focus survives, and every figure stays
  server-formatted (SR14).
* An open dialog carries `data-keep`, so a refresh never touches what was typed.
* State that belongs in the address (styles filters, the open question, Try one
  garment, scenario changes) is pushed with `history` and then morphed in.
* Motion only ever uses 160, 320 and 640 ms, plus 64 s for one pass of the label
  strip. The CSS holds no other duration.
* `[hidden] { display: none !important }` is load-bearing: dialogs, sheets and the
  intro all set `display` themselves.

## Running it

```
npm ci && npm run build && npm start      # binds 0.0.0.0:4173
node scripts/notices.mjs                  # after any dependency change
npx tsc --noEmit                          # strict typecheck
```

Helpful while developing: `/tmp/reset.sh` drops the schema so the next serve
re-applies the schema and the seed to an empty database.

## Things worth remembering

* Seeded figures are the brief's worked example: Harbour Tee climate `2.20 kg CO₂e`
  with shares 45.7 / 20.9 / 3.8 / 29.1 / 0.6, water `1,140 L`, fossil `25.7 MJ`
  (hotspot Use), land use `0.0112 points` with Making `3.15 × 10⁻⁴`.
* Seeded visits land on the Friday before and the Monday after the next Lisbon
  clock change, so the Lisbon diary moves while the Izmir wall time stays 07:20.
* Edition 2026.2 is only ever read from the rows kept with a seeded result; the
  library is never asked for it.
* A move with an old `baseVersion` answers 412 even when its line is at the end —
  the one exception to the precedence ladder.
