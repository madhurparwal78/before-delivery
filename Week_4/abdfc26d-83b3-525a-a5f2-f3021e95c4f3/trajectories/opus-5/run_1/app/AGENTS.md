# Phosphene Yard — repository notes

A studio and marketplace for numbered editions of live generative pieces.
Brightmoss Works is the platform operator. See the product brief for the
authoritative requirements (DP-01 … DP-60, IF-01 … IF-06).

## Layout

```
src/server/      TypeScript backend (Express), compiled to dist/server
  config.ts      every service URL, credential and timer, read from the environment
  errors.ts      the one ApiError type that produces the single error body
  db/            schema, idempotent seed, original seed shaders, pool helpers
  domain/        one place per rule: vat, split, ledger, sequences, states,
                 holds, editions, renderCost, billingToken
  providers/     one client per provider: killbill, aiRenderProvider, storage,
                 gotenberg, mailer (own SMTP), queue (RabbitMQ)
  services/      use cases: pieces, renders, orders, billing, invoices, refunds,
                 plans, statements, outbox, downloads, documents, probes
  http/          boundary (body limits, content types), idempotency, respond, app
  routes/        api.ts (the whole API) and auth.ts (PKCE)
src/shared/      types, copy strings, money formatting, plan definitions
src/client/      React + Vite frontend, compiled to dist/client
  lib/           api, router, session, hooks, shaderCanvas (WebGL), useEditionHold
  components/    StudioHeader, LiveCanvas, EditionLens, PixelPanel, CheckoutSheet …
  screens/       Landing, Gallery, PiecePage, Studio, Editor/, Library, Console
  public/fonts/  self-hosted OFL fonts (Archivo, Unbounded, Hanken Grotesk, JetBrains Mono)
```

## Rules that live in exactly one place

Change these only in the file named, never in a second copy.

| Rule | File |
| --- | --- |
| VAT rate table and rounding | `src/server/domain/vat.ts` |
| Sale split and refund reversal allocation | `src/server/domain/split.ts` |
| Credit ledger movements (two balanced rows) | `src/server/domain/ledger.ts` |
| Invoice and credit-note sequences | `src/server/domain/sequences.ts` |
| Every state machine's legal moves | `src/server/domain/states.ts` |
| Hold expiry and nearest free edition | `src/server/domain/holds.ts` |
| Edition seed hash and `uSeed` | `src/server/domain/editions.ts` |
| Render credit cost | `src/server/domain/renderCost.ts` |
| Kill Bill callback token | `src/server/domain/billingToken.ts` |
| Plan prices, names and credits | `src/shared/plans.ts` |
| User-facing copy | `src/shared/copy.ts` |

## Environment learned from this deployment

- Postgres 16, `gen_random_uuid()` built in. The app user **cannot** create
  databases, but it can create schemas — extra instances are isolated with
  `?options=-c search_path=<schema>`.
- Keycloak ignores an explicit `id` on user creation, so the seed resolves each
  seeded user's id from Keycloak at boot, then seeds Postgres.
- The `app` client accepts any redirect URI and allows direct access grants
  (handy for API tests), but its service account **cannot list clients**.
- Kill Bill: the catalog upload needs `Content-Type: text/xml` (not
  `application/xml`). Account invoice lists omit amounts and items — read each
  invoice with `?withItems=true`. Subscription invoices are auto-paid when a
  default payment method exists; external charges are not, so the app pays them.
- WireMock is pre-stubbed with the brief's baseline answers and its `__admin`
  API is password-protected; do not rely on it.
- The container clock is set to 2026, so October 2026 is closable.
- `ps`, `pkill` and `psql` are **not** installed. Match processes through
  `/proc/*/cmdline`.

## Design decisions worth keeping

- `fragment_source` is owner-only, so public canvases (hero, cards, piece page,
  library thumbnails) run `src/client/lib/pieceShader.ts` — the app's own
  procedural thin-film field, coloured by each piece's public uniforms and its
  edition seed. Only the editor compiles the piece's own shader and prints the
  validator log.
- Render retries happen inline in the queue consumer, so the only state is the
  attempt counter in Postgres and the unacknowledged RabbitMQ delivery.
- A queued outbox message is claimed by its writing instance in the same
  transaction, so the writer always makes the first attempt and the ≥15 s wait
  before the next one is observable.
- Presigned links carry `Content-Disposition: attachment`, so a download starts
  rather than opening inline.
- Radios are 44 px chips whose native input fills the face, keeping touch
  targets honest.

## Verifying

`npm run build` then `npm start`. Health is `GET /api/health`.

The throwaway harness used during development lived in `/tmp/chk` (not
committed): API suites per area, Playwright UI suites at the three published
viewports, plus scripts that boot extra instances with a broken dependency
(provider, Gotenberg, Kill Bill, mail, storage) each on its own schema, bucket
and render queue. Reset between suites — the journeys publish, buy and refund
real data. Note that running eight instances at once makes Kill Bill slow enough
to answer `503 payments_unavailable`, which is correct behaviour, not a defect.
