# Tinework — repository notes

A parametric parts gallery written in Tine, Gimbrel Works' small part language. One
TypeScript app serves the pages and the API; PostgreSQL, MinIO, Mailpit and Valkey are
the only datastores.

## Running it

```
npm ci          # install
npm run build   # tsc (server) + tsc --noEmit (client) + esbuild bundle + assets
npm start       # serve on APP_PUBLIC_PORT (4173)
```

`/app/run.json` holds those three commands. `GET /api/health` answers
`{"status":"ok"}` once the schema and seed data are in place; it answers
`{"status":"unavailable","storage":"down"}` while MinIO is unreachable and 503
`{"status":"unavailable","database":"down"}` until PostgreSQL connects.

## Layout

| Path | What lives there |
|---|---|
| `src/shared` | House rules shared by both sides: `numbers.ts` (H1 grammar, H2 rounding and rendering), `order.ts` (H3 code-point order, email folding, grapheme counts), `canonical.ts` (Tinework canonical JSON), `rawjson.ts` (a JSON reader that keeps each scalar's source text), `pose.ts`, `labels.ts` |
| `src/tine` | The language: `parse.ts`, `manifest.ts` (derived step and precision), `evaluate.ts` (solid, diagnostics, build tape, fork truncation), `solid.ts` (volume, box, faces, walls), `preflight.ts`, `digest.ts` |
| `src/server` | `index.ts` (router, boundary, static files), `db.ts` (schema), `bootstrap.ts` (seed), `parts.ts` (revision writes, outbox), `records.ts` (reads and JSON shapes), `storage.ts` (SigV4 S3 client), `archive.ts`, `thumbnail.ts`, `compare.ts` (voxels), `evaluations.ts`, `events.ts` (SSE), `bus.ts` (Valkey), `idempotency.ts` (H8), `values.ts` (H1 channel checks), `smtp.ts`, `pages.ts` (HTML shells), `routes/*` |
| `src/client` | `main.ts` (route dispatch), `viewport.ts` (+ `gl.ts`, `mesh.ts`) for the WebGL scene and the painted epoch, `params.ts` (dimension controls), `findings.ts`, `tape.ts`, `values.ts` (display, config addresses), `ui.ts` (dialogs, banners, live stream), `pages/*` |
| `public` | `app.css` and, after a build, the two bundled font files |

## Decisions worth remembering

- **One place per rule.** The number grammar is checked on request text in
  `values.ts#checkNumberGrammar` before any body number is read; every rounding and
  every displayed number goes through `shared/numbers.ts`; every order through
  `shared/order.ts`; canonical JSON through `shared/canonical.ts`.
- **Revisions are sparse.** A revision stores only the values a save sent; evaluation
  resolves them against the source defaults (`resolveValues`). The part page therefore
  compares *resolved* values when it decides whether the tape belongs to the loaded
  revision.
- **The controls share one values object.** `ParameterControls` keeps a reference, so
  resets mutate that object in place (`setValues`) instead of rebinding it.
- **Configuration addresses are built by hand**, never with `URLSearchParams`, so that
  `=` and `,` stay literal in `?config=width=72.5,holeDia=6`.
- **Storage confirmation before the row.** `storeRevisionObjects` writes the source,
  every distinct tape solid and its thumbnail, then reads each back with HEAD; only then
  does `commitRevision` write the revision, its tape, the part head, the outbox event and
  the room effects in one transaction.
- **Events.** Outbox rows are written in the change's transaction; their `id` is the SSE
  event id. The relay publishes committed rows on `<prefix>part:<slug>`; subscriptions are
  claimed on the Valkey connection's `ready` event (claiming them earlier silently fails).
  `Last-Event-ID` replays from the outbox, filtered by the stream's audience.
- **The hero part** `hero-cable-clip` is public but `listed = false`, so the gallery and
  its counts skip it while the home hero can still evaluate it.
- **Storage-dependent controls** keep focus and carry `aria-disabled="true"`; activating
  them shows the outage copy and sends nothing. Playwright's `click()` refuses such
  buttons — drive them with focus plus Enter.

## Verifying

The published worked examples are the best smoke test: `twin-hole-plate` at defaults is
`18 885.84 mm³`, `60 × 40 × 8 mm`, 8 faces, with the canonical solid
`{"ops":[{"d":40,"h":8,"op":"box","w":60},{"dia":5,"op":"hole","x":-20,"y":0},{"dia":5,"op":"hole","x":20,"y":0}]}`;
`peg-rail` r1's tape has N = 10 with operation 10 at `+1.70 cm³`; `jig-fence-block` on
`Three-axis mill` gives two Blocking then two Advisory findings with `Confidence: Low`
and `$40–$60 each` at quantity 1 for `twin-hole-plate`.
