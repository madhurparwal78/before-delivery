# Wringbench

Hosted data transformation workbench. Recipes bake entirely in a dedicated in-page worker;
the server stores and relays but never bakes.

## Layout

- `shared/` — the single source of truth shared by browser and server:
  - `catalogue.ts` — all 34 operations with arguments, defaults, validation (the ONLY place an operation is defined)
  - `protocol.ts` — API request/response types
  - `text.ts` — line counting, span/suggestion detection, base64url, date/ttl helpers
- `src/` — browser app (React + TypeScript):
  - `worker/` — the bake engine: `bake.ts` (operations), `runner.ts` (Fork/Merge, breakpoints, Step mode)
  - `lib/` — state model (`use-workbench.ts`), API client, share-link codec
  - `workbench/` — the four-pane workbench; `pages/` — Library, history, import, team, auth, snapshot
- `server/` — Express app: routes in `server/routes/`, domain rules in `server/recipes.ts`,
  `server/compare.ts`, `server/wringline.ts`, `server/live.ts`

## Commands

- `npm run build` — type-check, build the client with Vite, compile the server, copy assets
- `npm start` — serve the built app (`build/server/server/server.js`)
- `node scripts/test-bake.mjs` — the 65 worked-example checks for the operation catalogue
- `node scripts/test-api.mjs` — 50 end-to-end API checks (needs the server running and services up)

## Domain rules decided in exactly one place

- version conflict check: `insertVersion` in `server/recipes.ts`
- snapshot status from the server clock: `statusOf` in `server/routes/snapshots.ts`
- line counting: `countLines` in `shared/text.ts`
- span offset rules: `mapSpan` in `src/lib/app-state.ts`
- compare matching: `compareVersions` in `server/compare.ts`
- Wring Line matching: `parseWringLine` in `server/wringline.ts`
- team cap: `teamFull` in `server/routes/teams.ts`

## Notes

- Express 4 does not catch rejected promises from async handlers: every route is wrapped
  in `handle()` from `server/errors.ts`. New routes must use it too.
- Every API error flows through `sendError` with the published body and precedence.
- `pino` is intentionally not used; logging is `console` only.
