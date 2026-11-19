# Lowfield Console — repository notes

Live speech recognition console. Three backing services only: Postgres (system of
record), MinIO (audio and transcript artifacts), Kill Bill (one account and usage
subscription per organisation).

## Layout

- `src/shared/` — rules and copy used by both server and browser: the text-limit
  rule (`text.ts`), billable seconds, cost and display formats (`billing.ts`),
  confidence bands (`confidence.ts`), every published string (`copy.ts`).
- `src/server/domain/` — one place per domain rule: `spectrum.ts` (real FFT and
  `SpectrumStream`), `sidecar.ts` (WebVTT), `transcript.ts` (word layout and word
  error rate), `quota.ts` (UTC period and derivation), `audio.ts` (WAV, tone
  fixture, procedural synthesis), `idempotency.ts` (replay and conflict).
- `src/server/engine.ts` — the only writer of session state. Runners carry audio
  through the recognizer, close sessions once, and drive quota halts.
- `src/server/routes/`, `src/server/ws/listen.ts` — endpoints. The dispatcher in
  `index.ts` enforces 413/415 and same-origin before any handler runs.
- `src/web/` — vanilla TypeScript. Screens patch their DOM in place so the open
  segment inspector keeps its draft, caret and focus.

## Things that are easy to get wrong

- **Error precedence** (413/415 → 401 → 404 → 403 → idempotency → 409/429 → 422 →
  503) is enforced by where checks sit: body limits in the dispatcher, visibility
  before role, state conflicts before validation.
- **The event stream** sends the `segment` event as a bare segment object and the
  `quota` event as a bare quota object. A stream opened on an already-ended
  session stays open so later `correction` events still reach every view; a stream
  ends only after the final state of a session that ended while it was open.
  Because of that an open detail page never reaches network idle — use
  `waitUntil: 'domcontentloaded'` in browser tests, not `networkidle`.
- **The readback strip** is drawn with `gl.scissor` + `gl.clear` so bar columns and
  lit heights are exact pixels. The canvas drawing buffer must stay equal to its
  displayed size, with `preserveDrawingBuffer: true`.
- **Status regions must never be `display: none`**, or they leave the accessibility
  tree and their published names cannot be found.
- Quota figures always come from `projectUsage` (derived from stored sessions), so
  every surface reports the same number.

## Development

- `scripts/dev-restart.sh` rebuilds and restarts the server on port 4173.
- Browser tests live outside the repository (`/tmp/webtest`) and drive the real
  services; the outage tests put a stoppable TCP proxy in front of MinIO and Kill
  Bill and run a second instance against it.
- `npx tsc --noEmit` must stay clean; unused locals and parameters are errors.
