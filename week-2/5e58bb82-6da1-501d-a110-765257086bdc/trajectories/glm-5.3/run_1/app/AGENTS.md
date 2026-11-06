# Swathdeck — agent notes

Swathdeck is the browser console for small coastal survey contractors running two to four uncrewed survey boats. It is built to the Fathomwright brief (DP-01…DP-92): three panes of TypeScript, no runtime requests beyond its own origin.

## Layout

- `run.json` — install/build/serve manifest (`npm ci` → `npm run build` → `npm run start`).
- `src/server/` — Node 22 HTTP server, strict TypeScript:
  - `config.ts` env; `db.ts` schema + idempotent seed; `http.ts` body reading and the one error shape; `auth.ts` sessions, sign-in limit, safe-return.
  - `domain.ts` every derivation rule in one place: line-plan derivation (W, S, mainscheme chords, crossline k, duration), coverage grid, swath rule, link state, crossline agreement, infill geometry, holiday qualification.
  - `core.ts` mission/line/alert state machines, alert history, coverage + holiday recompute (bulk SQL writes).
  - `ingest.ts` fix application (thruster hours, breaches, lost spells); `infill.ts` eligibility and the lost-vessel move.
  - `handlers-*.ts` one module per endpoint family; `api.ts` routing plus the deferred response — the response is recorded during the request transaction and sent only after it commits.
  - `storage.ts` S3/MinIO; `mail.ts` Mailpit/SMTP with the Postgres outbox.
- `src/browser/` — typed SPA, no framework: `main.ts` routing and guarded live refresh, `state.ts` polling/store/banners/idle timer, `chart.ts` procedural canvas chart with the holiday lens, `screens-*.ts` one file per screen family, `dom.ts` h() helper and modal focus traps.
- `public/` — index.html, app.css, bundled fonts (Newsreader, IBM Plex Sans, IBM Plex Mono, all OFL).
- `fonts/` — the source TTFs copied into `public/fonts` by the build.

## Rules worth remembering

- Responses are sent after the transaction commits (`DeferredResponse` in api.ts). Never call `res.end` inside a handler before the commit — a client must never see uncommitted state, and duplicate-fix races are settled with savepoints.
- Screens render from a fresh store: `renderRoute` awaits `refreshCommon` after painting the shell, and the live refresh re-renders only when the data signature changed, patching vessel cards and alert cards in place so focus never moves.
- Never build DOM off-screen and append it after an await — a child fetch will resolve against a detached element (this bit the vessel detail once).
- Coverage is recomputed once per ingest request, not per fix, with bulk `unnest` inserts; holiday cells and depths go the same way.
- The seed's two principal surveyors are the only handover peers (u-ira, u-wren); there is no users-list endpoint in the brief.

## Verifying

The workspace test scripts (kept outside `/app`) cover the brief end to end: sign-in limits, plan derivation against the seed examples (13 lines + X01 for Calderhaven, 7 + two crosslines for Saltmere), ingest and coverage, holidays and infill (including the move off a lost vessel), re-runs and supersession, holds, geofence changes, handovers, completion with the canonical report bytes and the report-ready emails, client isolation, resumable uploads, storage-outage 503s, and escalation. Run each against a freshly seeded database.
