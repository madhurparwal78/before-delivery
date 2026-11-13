# Fairline — repository notes

Fairline is a browser workspace for preparing orchestral scores. A composer, a copyist and
section players edit one score live. The server owns engraving, so every client draws the same
system breaks.

## Running it

| Step | Command |
| --- | --- |
| Install | `npm ci` |
| Build | `npm run build` |
| Serve | `npm run start` (binds `0.0.0.0:${APP_PUBLIC_PORT:-4173}`) |
| Typecheck | `npm run typecheck` |

`run.json` is the run manifest and holds only `_schema`, `install`, `build` and `serve`.

`npm run build` does four things: bundles the server with esbuild, bundles the AudioWorklet
clock, builds the browser app with Vite, copies `assets/fonts` into `dist/assets` (for the
server's embedded part pages) and `dist/client/fonts` (for the browser), then regenerates
`THIRD_PARTY_NOTICES.md` and fails if a shipped package falls outside the licence allowlist.

## Services

Everything is read from the environment (`src/server/config.ts`); no credential is in source
and none reaches the browser.

- **Postgres** (`DATABASE_URL`) is the source of truth: operation log, snapshots, collaborators,
  holds, parts, banks, staves. The schema is applied idempotently at every start.
- **MinIO** (`S3_*`) holds sample banks, engraved part pages and part PDFs. The S3 client is a
  small SigV4 signer in `src/server/services/s3.ts`, so there is no AWS SDK in the tree.
- **Valkey** (`VALKEY_URL`) carries the per-score broadcast channel and the presence hash.
  `broadcast.publish` falls back to delivering on this instance alone when Valkey is down.
- **Gotenberg** (`GOTENBERG_URL`) turns the stored part pages into the part PDF.

The app boots and serves the editor with any of MinIO, Valkey or Gotenberg unreachable, and
each feature recovers by itself.

## Where each rule lives

Every domain rule is decided in exactly one place:

| Rule | File |
| --- | --- |
| Insert ordering, field winner, barline split, ticks, spellings | `src/shared/music.ts` and `src/shared/crdt.ts` |
| Text allowlist and the 200-character limit | `src/shared/text.ts` |
| Score caps (64 staves, 2,000 measures) | `src/shared/music.ts` constants, applied in the routes and `store/ops.ts` |
| Operation throttle (120 per 10 s) | `src/server/store/throttle.ts` |
| Part lifecycle transitions | the `LIFECYCLE` table in `src/server/store/parts.ts` |
| Sample bank checks | `src/server/store/banks.ts` |
| Error shape, codes and precedence | `src/server/errors.ts` |
| Engraving layout, system breaks and pages | `src/server/engrave/engrave.ts` |

## Engraving and fonts

Notation is server-made SVG drawn with Bravura glyphs. `assets/fonts/bravura-subset.woff2` is a
subset of Bravura holding only the glyphs Fairline draws; `src/shared/bravura-metrics.ts` is the
matching advance-width table taken from the Bravura SMuFL metadata.

- The engraving endpoint returns lean per-system SVG that names `font-family="Bravura"`; the
  browser already has the font from `/fonts/`.
- Stored part pages (`pages/<n>.svg`) embed every font as a data URL, so the same file renders
  identically in a plain viewer and in Gotenberg's Chromium.
- The Helix textures inject the same Bravura data URL into the SVG before rasterising, because
  an SVG loaded through `<img>` cannot reach an external font.

To change the glyph set, re-run the subset with `pyftsubset` over the Bravura OTF and regenerate
the metrics table.

## Client model

`src/client/score-state.ts` hydrates a `VoiceDocument` per staff and voice from the server's
ordered events, then applies local edits at once and queues the operation batches (250 ms
window, 50 ops per request, never re-stamped on retry). On 429 the queue waits out `Retry-After`
and announces the countdown in the Sync queue region.

Presence and holds come only from the server; the client never expires an entry by its own clock.

## Testing notes

There is no committed test suite. During development the app was exercised with throwaway
scripts that drive the real services:

- API, boundary, caps, history, throttle and invite flows over `fetch`.
- Live sessions over `ws`: hold races, convergence order, presence expiry, removal.
- Degraded instances started on another port with `S3_ENDPOINT`, `GOTENBERG_URL` or
  `VALKEY_URL` pointed at a dead address.
- Playwright against the three viewports for the published roles, names and copy.

To reset the seed data, delete every row from `scores` (everything cascades) and restart the
server; `seedIfMissing` recreates `sc-tidewater`.

## Seat links

| Who | Link |
| --- | --- |
| Mara Lindqvist, composer | `/s/seat-composer-7f3a` |
| Jun Okafor, copyist | `/s/seat-copyist-2c9e` |
| Inès Varga, oboe | `/s/seat-oboe-5b1d` |
| Theo Brandt, violin I | `/s/seat-violin1-8e4f` |
| Ruth Abara, viola (invited) | `/i/inv-viola-3a6c` |
