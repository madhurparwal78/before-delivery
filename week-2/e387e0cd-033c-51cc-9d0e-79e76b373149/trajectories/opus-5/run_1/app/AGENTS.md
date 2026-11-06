# Lanternline Handshake Desk

A Travel Rule handshake desk for two licensed crypto exchanges, Neris Digital
(Europe/Vilnius, EUR) and Kallang Exchange (Asia/Singapore, SGD). TypeScript on
Node 22, no web framework, no client framework.

## Running it

```
npm ci
npm run build          # tsc server + tsc client + ESM import fixer + asset copy
node dist/server/server.js
```

The server binds `0.0.0.0:4173` (or `APP_PUBLIC_PORT`) and serves the API, every
page and every asset from that one origin. It waits for PostgreSQL, applies the
schema and the seed idempotently, then starts. MinIO and Kill Bill may be
unreachable at boot: the server starts anyway, retries in the background and
answers their actions with the published `503`.

## Layout

```
src/shared/     isomorphic: decimal, assets, business time, screen formats, published copy
src/server/
  config.ts     every credential, URL and timer read from the environment
  domain/       the one place each domain rule is decided
  db/           schema, seed data, idempotent seed
  http/         error ladder, route runtime, sessions, multipart, validation
  store/        data access and the case engine
  api/          route definitions, one module per endpoint group
  services/     MinIO (own SigV4), Kill Bill, SMTP (own tiny client)
  web/          HTML shell, page matcher, sitemap
  worker.ts     answer windows and retention erasure, every 5 seconds
src/client/     router, screens, ui components, no framework
assets/         app.css, fonts.css and the self-hosted woff2 files
```

## Where each rule lives

| Rule | Place |
|---|---|
| path decision, case state machine, handshake track | `src/server/domain/case.ts` |
| fiat value rounding and every exact amount | `src/shared/decimal.ts` |
| name normalisation and the name check | `src/server/domain/names.ts` |
| LEI check digits | `src/server/domain/lei.ts` |
| message signature | `src/server/domain/signature.ts` |
| tier pricing | `src/server/domain/fees.ts` |
| spreadsheet import outcomes | `src/server/domain/importsheet.ts` |
| regulator CSV writing and neutralisation | `src/server/domain/csv.ts` |
| masking for support agents | `src/server/domain/masking.ts` |
| certificate type sniffing and GPS removal | `src/server/domain/image.ts` |
| the one error-precedence ladder | `src/server/http/runtime.ts` (`runSpec`) |
| every published string | `src/shared/copy.ts` |

Screens render the server's result. The client never recomputes a status, a
countdown's end or a disabled button, and never reads the device clock for
anything but formatting an absolute instant.

## Conventions worth remembering

- Money and crypto amounts are BigInt scaled integers; nothing passes through a
  binary float, including the Kill Bill charge bodies, which are built as raw
  JSON so the amounts stay exact.
- All business dates and months are stored as `text`, all instants as
  `timestamptz`, so nothing is re-parsed in a local zone.
- Client modules are emitted as native ES modules; `scripts/fix-esm.mjs` adds the
  `.js` extensions that the browser needs, so the TypeScript sources keep plain
  specifiers and the server build stays CommonJS.
- Dialogs and sheets are absent from the document when closed, which is what
  makes them hidden and inert at every viewport. A pending close is cancelled
  when the panel is reopened.
- One breakpoint governs every layout: 1120 px. `.wide-only` and `.narrow-only`
  switch the two instances of a panel so only one is ever in the accessibility
  tree.
- Motion uses exactly 160, 320 and 640 ms, declared in CSS only, and the
  reduced-motion media query turns every transition and animation off.

## Checking it

An automated WCAG 2.2 AA pass (axe-core), a sideways-overflow check, a 44 px
control-size check and a motion-duration check all run clean on every screen at
375x812, 768x1024, 1024x768 and 1280x800, with each screen's dialog or sheet both
closed and open.
