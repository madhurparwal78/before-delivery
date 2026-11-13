# Squallglass — repository notes

Browser lane-defence strategy game for the fictional harbour of Orrel Sound. TypeScript, Node.js,
PostgreSQL + MinIO + Meilisearch. No other persistent services.

## Layout

- `src/shared/` — pure, dependency-free domain core shared by browser and server.
  - `constants.ts` is the single source for seed data, device/creature stats, limits and ruleset.
  - `simulation.ts` is the one simulation implementation: tick order, command legality, ledger
    transfers, log reproduction, frame windows and Lantern Cast forecasts.
  - `canonical.ts` is canonical JSON (key sort by UTF-16 code units, integer-only numbers).
  - `format.ts` owns milli-charge, tick (`mm:ss.SSS`) and tenths-percent conversions.
- `src/server/` — HTTP boundary (`http.ts`), route table (`api/routes.ts`), staged validation
  (`validation.ts`), error registry (`errors.ts`), persistence (`db.ts`, `store.ts`), providers
  (`objects.ts` SigV4 for MinIO, `search.ts` for Meilisearch), verification pipeline
  (`verification.ts`), rankings (`rankings.ts`), season days (`season.ts`), published transition
  tables (`transitions.ts`) and the Rules payload (`rulesResponse.ts`).
- `src/client/` — vanilla TypeScript SPA. `shell.ts` holds state and navigation; `board.ts` is the
  harbour chart (one roving tab stop, pan/zoom, trace layer); `layout.ts` reorders the document so
  reading order matches visual order at 1280/768/375; `views/` holds the screens.
- `public/` — `index.html`, `styles.css` and locally bundled OFL fonts.

## Invariants worth remembering

- Every domain rule lives in exactly one place. Ranking and transition decisions stay on the server.
- Frames are pre-command states; `applyCommandsPhase` then `resolveAfterCommands` produces the next
  frame. Live play, forecasts, replay and verification all use that same pair.
- Acceptance requires writing, re-reading and digest-checking the MinIO definition and evidence
  objects, then simulating from tick zero. Claims are ignored.
- Validation runs in stages (types, depth, forbidden characters, ranges, cross-field, aggregate) and
  only the first failing stage is reported.
- Service environment reads are explicit; no `??`/`||` fallbacks on them.

## Local development

```
npm ci && npm run build && npm run start      # serves on 0.0.0.0:4173 (APP_PUBLIC_PORT)
npx tsc --noEmit                              # typecheck, with unused-symbol detection enabled
```

A second process can share the same providers: `APP_PUBLIC_PORT=4174 node dist/server/main.js`.
Pointing `S3_ENDPOINT` or `MEILISEARCH_URL` at a dead address is a convenient way to exercise the
pending-verification and discovery-outage paths.
