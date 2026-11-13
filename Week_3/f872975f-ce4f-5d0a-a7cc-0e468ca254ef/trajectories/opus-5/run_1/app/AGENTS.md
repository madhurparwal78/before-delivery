# Kerfwell Rack — repository notes

Single-board stock for a reclaimed timber yard. TypeScript throughout: a plain Node HTTP
server and a hand-rolled client bundle, with PostgreSQL, MinIO and Kill Bill as the only
external services.

## Running it

```
npm ci          # install (uses the committed lockfile)
npm run build   # tsc for the server, tsc + esbuild for the client, assets copied to dist/public
npm run start   # applies the schema and the seed, then serves on APP_PUBLIC_PORT (4173)
npm run notices # regenerates THIRD_PARTY_NOTICES.md and checks every licence
```

`/app/run.json` holds those three commands. Everything the app needs comes from the
environment variables listed in the brief's Configuration and secrets section.

## Shape of the source

- `src/shared/` — rules both sides need: `geometry.ts` (piece status, cuts, take, offcut,
  clear runs, verdict), `money.ts` (volume, board feet, price, invoice lines),
  `units.ts` (millimetre and inch conversion and display), `constants.ts`.
- `src/server/domain/` — one place per domain rule: `boards.ts`, `fit.ts`, `holds.ts`
  (claim, expiry), `lineage.ts`, `ledger.ts`, `rates.ts` (version in force),
  `layoutfile.ts` (migration and byte-exact serialisation), `validate.ts`, `ticketpdf.ts`.
- `src/server/routes/` — one file per area; `routes/index.ts` holds the route table and the
  matcher. `main.ts` applies the boundary checks in the published precedence order and then
  calls the route.
- `src/server/services/` — `s3.ts` (hand-rolled SigV4), `killbill.ts`, `image.ts`
  (JPEG/PNG decode, EXIF orientation, resize), `pdf.ts` (flat text PDF), `health.ts`.
- `src/client/` — `main.ts` boots, `router.ts` and `shell.ts` frame the pages,
  `pages/*.ts` render them, `strip.ts` draws every SVG strip and elevation,
  `layoutstate.ts` holds the chips, snap marks and the undo history.

## Things worth remembering

- **Error precedence** lives in `main.ts` (boundary, session) and then inside each handler,
  which checks `not_found`, `forbidden`, 409s, content and provider outcomes in that order.
  Hold and purchase handlers peek at the 409 conditions read-only before validating content,
  then take the real atomic claim, so the reported error always follows the published order.
- **Concurrency** is decided in PostgreSQL: a partial unique index on live holds per board,
  `SELECT ... FOR UPDATE` on boards and holds, and `pg_advisory_xact_lock` keyed on a
  lineage root, a ticket id or a maker's billing account.
- **Hold expiry** is settled inside the same locked step as every claim, cancel and purchase,
  and a sweep (`releaseExpiredHolds`) runs before reads and on a 5-second timer.
- **Layout files** are stored as the exact JSON text, not as `jsonb`, because the published
  key order and byte-identical round trip matter.
- **Accessible names**: controls are paired with their own `<label for>` (see `labelled` in
  `dom.ts`). Never wrap a `select` in a label — the selected option leaks into the name.
  Never use `text-transform` on published copy: it changes the rendered and accessible text.
- `[hidden] { display: none !important }` is needed because the `button` rule sets
  `display: inline-flex`, which would otherwise beat the user-agent `[hidden]` rule.
- Background refreshes (service notices, hold refreshes, stock refreshes) update text,
  badges and paused states **in place**. Rebuilding those nodes would move focus and break
  the "open work survives notices" rule.
- The client holds a readable `kerfwell_signed_in` marker cookie beside the HttpOnly session
  cookie, so a signed-out visitor never fires a 401 session probe. It carries no credential.

## Local checks used while building

There is no `ps`/`pkill` in this image; find the server through `/proc` to restart it.
A throwaway HTTP proxy in front of Kill Bill is handy for testing outage and recovery
behaviour without touching the real service.
