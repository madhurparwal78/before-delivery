# Hangline — repository notes

Shared 3D exhibition planner for Ashgrove Museum (brief: Northlight Works Hangline).

## Layout

```
run.json                 install / build / serve commands
src/shared/              types, published copy, unit conversion and length formats
src/server/
  index.ts               http server, request pipeline, static and page routes
  config.ts              every service URL and credential, read from the environment
  time.ts                museum time zone, publish time, open-day counting
  db/                    pg pool, schema SQL, idempotent seed
  domain/                hang rules, lux, transitions, placements, objects, photos, preview, events
  http/                  the one error shape, result writing, idempotency records
  routes/api.ts          the whole API surface as one route table
  services/              MinIO (hand-rolled SigV4), SMTP client, PNG encoder, status probes, mailer
  pages/html.ts          staff shell and server-rendered lender preview page
src/client/
  state/store.tsx        all app state, polling, actions, announcements
  state/focus.ts         the published focus target for every action
  components/            header/banners, rail, scene, ledger, inspector, dialogs, register, record
  lender.tsx             lender preview scene island
public/fonts/            Instrument Serif and Hanken Grotesk (OFL-1.1), served from this origin
```

## Rules that live in exactly one place

- hang rules: `src/server/domain/hangRules.ts`
- placement lifecycle and who may move: `src/server/domain/transitions.ts`
- lux-hours and lux status: `src/server/domain/lux.ts`
- unit conversion and length display: `src/shared/units.ts`
- undo window (10 s, server clock): `UNDO_WINDOW_SECONDS` in `domain/placementService.ts`
- publish time and preview transitions: `domain/previewService.ts`
- event writing (one per change, seq from a locked counter row): `domain/events.ts`
- published copy and sentences: `src/shared/copy.ts`
- focus after each action: `src/client/state/focus.ts`

## Working on this repo

- `npm run build` runs `tsc -b` (server and client project references), `vite build`, then esbuild for
  the server bundle. The server reads the Vite manifest **at start**, so restart it after a build.
- The seed and schema are applied on every start and after any database outage
  (`ensureDatabaseReady`). An empty database fills itself.
- `PREVIEW_PUBLISH_DELAY_SECONDS=20` makes the preview publish 20 s after scheduling, which is how
  the publish, email and withdrawal paths were exercised.
- Scene state is written imperatively onto `region "Gallery scene"` (`data-camera-*`,
  `data-hang-line`, `data-transitioning`); React never renders those attributes, so they survive
  re-renders.
- Work markers are DOM overlays projected from the three.js camera (or from the flat SVG layout when
  WebGL is missing), which is what makes the lux overlay and the flat drawing agree.

## Gotchas found while building

- `SELECT ... FOR UPDATE` re-reads the updated row but keeps the previously joined rows, so the
  claim holder's name has to be read after the lock (`getPlacementById` locks, then selects).
- A dropped Postgres socket reaches a checked-out client as an `error` event; `withClient` listens
  for it and releases the client as broken, otherwise the process exits.
- Vite puts shared CSS on the common chunk, so the HTML shell walks the manifest imports to collect
  stylesheets.
