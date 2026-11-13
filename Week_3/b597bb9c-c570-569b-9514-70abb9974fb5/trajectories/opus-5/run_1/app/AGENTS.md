# Gatecut — repository notes

A browser video editor for a freelance editor who cuts for agencies. Everything
sits on whole frames; the app never decodes pictures and draws every layer as a
coloured box at its computed position.

## Running it

- `/app/run.json` holds the only commands: `npm ci`, `npm run build`, `npm run start`.
- The server binds `0.0.0.0:${APP_PUBLIC_PORT:-4173}`. `GET /api/health` answers
  200 `{"status":"ok"}` even while MinIO, RabbitMQ or SMTP is unreachable.
- Every service URL, credential and tunable is read in `src/server/config.ts`.
  Nothing from there reaches the browser, except a presigned manifest link.

## Shape of the source

| Path | What lives there |
| --- | --- |
| `src/domain/` | the rules, shared by server and browser: `rate.ts` (the rounding rule, frame rates, timecode), `layers.ts` (keyframe curves, the layer box), `timeline-state.ts` + `ops-*.ts` (overlap, stops, ripple, groups, locks), `srt.ts`, `media-header.ts`, `manifest.ts`, `errors.ts` (the one copy table), `api-error.ts`, `validate.ts` |
| `src/server/` | `index.ts` (the one boundary: routing, body limits, error precedence), `routes/*`, `repo/*` (Postgres reads and the single op path), `services/*` (MinIO over SigV4, Valkey, RabbitMQ, SMTP), `live.ts` (one socket per page), `exports.ts` (the export worker), `allowance.ts`, `seed.ts` |
| `src/client/` | `main.ts` (router), `shell.ts` (band, Notices, allowance), `pages/*`, `stage.ts`, `sheet.ts` (procedural frames), `dialog.ts`, `dom.ts` |
| `scripts/build.mjs` | esbuild: server bundle, browser bundle, CSS with the two self-hosted fonts |

## Rules that live in exactly one place

- **The rounding rule and timecode**: `src/domain/rate.ts`. All arithmetic is
  exact (BigInt rationals), never floating point.
- **Keyframe interpolation and the layer box**: `src/domain/layers.ts`, used by
  the frame endpoint, the stage, the Inspector and the Frame Loupe.
- **Overlap, stops, ripple, groups, locked rows**: `src/domain/ops-clips.ts` and
  `timeline-state.ts`. Every op goes through `runOp` in `ops-apply.ts`, which
  diffs a cloned state to produce `changes`/`removed`/`touched`.
- **Saving an op, the version and the concurrency winner**: `src/server/repo/ops.ts`
  (`performOp`). No endpoint changes timeline state outside it.
- **Error shape and copy**: `src/domain/errors.ts` + `api-error.ts`; the one
  response builder is `sendError` in `src/server/http.ts`.
- **Allowance taking**: `src/server/allowance.ts` with a Valkey Lua script.

## Seed data facts worth remembering

- Eight projects, 28 markers (the contact sheet has 28 frames).
- `quayside` and `orchard-lane` are seeded in seconds and upgraded once at start
  (`src/server/repo/upgrade.ts`): `qs-c2` becomes start 309, source 51→238;
  `ol-c1` source 101→1539, end 1438; markers 0/719/1439.
- MP4 stand-ins carry a `free` box holding the media id, so two files with the
  same header still have different checksums (one entry per checksum).
- Harbour Light's locked `hl-music` row makes most ripple and restore refusals
  easy to reproduce; `hl-c1` and `hl-c5` are grouped, so nudging either is
  refused with `group_blocked` while the Picture row is packed.

## Testing notes

- There is no test runner in the repository. Probes were driven with `curl` and
  Playwright scripts under `/tmp` during development.
- **This container's headless Chromium (ARM64) kills the renderer whenever any
  editable form control is inserted after the first paint.** Pages that build
  their controls in the first render (sign-in, project list, library, profile,
  the project page) are fine; the review page renders its fields after its first
  fetch and so cannot be opened in this browser. That is an environment bug, not
  app behaviour — check the review surface through `GET /api/review/{token}`,
  `POST …/comments` and `POST …/approve` instead.
- Handy helpers used while building: a reset script that drops the `public`
  schema and the `gatecut:*` Valkey keys, then restarts the server; the app
  re-applies its schema and re-seeds an empty database on every start.
