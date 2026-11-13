# Rampwright — repository notes

A browser bench for physics tutors: 3D scenes in SI units, a deterministic fixed-step run,
checkpoints, published labs, read-only links and live co-editing.

## Running it

- `npm ci` · `npm run build` · `npm run serve` (the three commands in `/app/run.json`).
- Serves on `APP_PUBLIC_PORT` (default 4173), one process for the API, the built frontend and the
  public pages. `GET /api/health` answers 200 even when Postgres, MinIO, Valkey or mail is down.
- Every service URL and credential is read from the environment in `src/server/config.ts`. Nothing
  is hard-coded and nothing reaches the browser.

## Layout

```
src/shared/   domain rules used by both sides (one place per rule)
  canonical.ts  canonical JSON          sha256.ts    pure-TS SHA-256
  dmath.ts      deterministic sin/cos   sim.ts       fixed step + state hash
  params.ts     ranges + unit entry     readouts.ts  derived readout formulas
  scene.ts      document, ops, field keys            bundle.ts  lab bundle + exposed keys
  uploads.ts    type sniffing + extent rule          states.ts  invite/scene state machines
  safeReturn.ts safe-return rule        copy.ts      every piece of user-facing copy
src/server/   http.ts (routing, body limits), routes/*, locks.ts (leases, fences, presence),
              mailer.ts (outbox, exactly-once), s3.ts, valkey.ts, smtp.ts, seed.ts
src/client/   screens/*, editor/* (session.ts holds autosave, leases, presence, the run loop),
              gl/* (own WebGL renderer: primitives only), app.css
```

## Things worth remembering

- The state hash must match between browser and server, so the simulation only uses `+ - * /` and
  `Math.sqrt`; `dsin`/`dcos` are Taylor kernels in `shared/dmath.ts`. Never call `Math.sin` from
  `shared/sim.ts` or `shared/readouts.ts`.
- `PATCH /api/scenes/:sid` order: replay → lock store reachable → missing object → fence →
  restore barrier → revision overlap → validation. Changed field keys per revision live in
  `revisions.changed_keys`.
- Leases live in Valkey as JSON under `rw:lock:<sceneId>:<objectId>` with a separate fence counter;
  a tab's leases are released when its live channel closes.
- The live channel polls Postgres and Valkey once a second and sends `revision`, `presence`,
  `role` and `status` events only when something changed.
- Mail: every message is written to `outbox` in the same step as the action, then sent at once;
  the worker claims rows with `for update skip locked`, so delivery is exactly once.

## Local checks

- `npx tsc --noEmit` typechecks server, shared and client.
- Browser checks were run with Playwright (`chromium`) against `http://localhost:4173`.
- The dev database is shared: after poking at it by hand, reset with
  `drop schema public cascade; create schema public;` and restart so the seed runs again.
