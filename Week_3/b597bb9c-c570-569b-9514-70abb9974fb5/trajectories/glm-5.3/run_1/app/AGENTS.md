# Gatecut

Fennbright Works Gatecut — a browser editor for a freelance video editor.
Everything sits on exact whole-frame data; the app never decodes pictures.

## Layout

- `src/shared/` — the domain core shared by server and browser: the rounding
  rule (`rational.ts`, `frames.ts`), keyframe interpolation (`keyframes.ts`),
  the one error copy table (`errors.ts`) and the record shapes (`types.ts`).
- `src/server/` — the API, the op engine and the services.
  - `ops-core.ts` is the pure op engine: every timeline change applies there.
  - `ops-service.ts` is the one op path: transactions, version order,
    conflict detection, undo/redo.
  - `routes-*.ts` are the API surface; no route changes timeline state
    outside the op path.
  - `media-judge.ts` decides files by their MP4/WAV/PNG headers alone.
  - `srt.ts` parses and writes SRT; `db.ts` applies the schema idempotently.
- `src/client/` — the browser app: pages in `pages/`, the API client in
  `api.ts`, screen copy in `ui.ts`.
- `tools/` — build and test scripts only; the server and browser never
  import from here.
- `assets/` — the Work Sans and Sometype Mono variable fonts, both OFL-1.1,
  subset from the Google Fonts upstream with pyftsubset.

## Build and run

`run.json` drives everything: `npm install`, `npm run build` (esbuild bundles
the server and the browser client into `dist/`), `npm start`. The server
binds 0.0.0.0 on `APP_PUBLIC_PORT` (default 4173) and answers
`GET /api/health` with `{"status":"ok"}` even when MinIO, RabbitMQ or SMTP
is unreachable — the boot never blocks on those services.

## Things that bit us

- Postgres `NUMERIC` columns arrive as strings. Every read goes through
  `Number()` before any arithmetic (`timeline.ts`, `ops-service.ts`), or the
  length rule concatenates text instead of adding.
- MP4 boxes are big-endian; WAV RIFF fields are little-endian. The judge has
  two readers and must not mix them up.
- The `tkhd` width sits at box start + 84 (header 8, version+flags 4, then
  72 bytes of fields) and is 16.16 fixed point.
- The allowance take must rebuild the month counter from Postgres when the
  key is missing, or a fresh counter starts from zero and forgets the
  seeded opening minutes.
- A replayed `op_id` returns its first response; remember it after the op.
- The v1 read API's cursors encode the position after the last item, and the
  list handlers must actually filter by it — otherwise paging repeats items.

## Testing

`tools/smoke*.ts` are end-to-end suites against a running server on 4173
(each expects a freshly seeded database; `tools/wipe-db.mjs` resets Postgres
and the counters). `tools/smoke5.ts` expects a second instance on 4299 with
`S3_ENDPOINT` and `AMQP_URL` pointed at unreachable hosts.
