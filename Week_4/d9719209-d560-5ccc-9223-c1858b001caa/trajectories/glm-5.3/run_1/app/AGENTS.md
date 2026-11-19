# Moothall — repository memory

Larkspur Signal Co.'s community web app, built in TypeScript on Node.js 22 with
exactly four backend services: Postgres (source of truth), MinIO (images),
Mailpit (SMTP sink) and Valkey (live fan-out, replay stream, rate counters).

## Layout

- `run.json` — install/build/serve manifest (IF-01). `serve` is
  `node dist/server.js`, which applies the schema and seed idempotently before
  reporting healthy.
- `src/server/` — the API server (strict TS, NodeNext modules, ESM output).
  `server.ts` boots and routes; `routes/` holds the endpoint modules;
  `imaging.ts` is the pure-JS image pipeline; `views.ts` holds the published
  projections; `domain.ts` the hot-rank/cursor/display rules.
- `src/client/` — the browser app, compiled separately with `tsconfig.client.json`
  (DOM lib) into `public/assets/`. `app.ts` is the entry point; `pages/` one
  module per screen.
- `public/assets/` — app.js/app.css plus the OFL fonts (Bricolage Grotesque,
  Atkinson Hyperlegible, Atkinson Hyperlegible Mono) and `fonts/OFL.txt`.

## Hard-won facts

- Valkey auth: the dev URL is `redis://user:pass@host:port/db`. AUTH needs BOTH
  the username and password (`AUTH app gfkit-dev`), not the password alone.
- The subscription connection must be a raw socket: pub/sub frames are push
  data, and sharing the reply queue corrupts command responses.
- `@jsquash/webp` in Node: the auto-init calls `fetch` for its WASM, which
  fails. Read `codec/{enc,dec}/*.wasm` from disk, `WebAssembly.compile` them,
  and pass them to `init` from `@jsquash/webp/encode.js` / `decode.js`.
  Imports need the explicit `.js` extension under NodeNext.
- sharp was replaced on purpose: its prebuilt libvips binaries
  (`@img/sharp-libvips-*`) are LGPL-3.0, which IF-03 forbids. The pure-JS
  pipeline is jpeg-js (JPEG decode), pngjs (PNG decode) and @jsquash/webp
  (libwebp WASM, BSD/Apache), plus a box-filter resampler that never upscales.
- Native form validation blocks submit events: every client form needs
  `novalidate` so our own field errors and focus moves work (DP-01).
- A suspended account's stale cookie: API calls answer 403 SUSPENDED (remember
  revoked tokens in `revoked_sessions`), but HTML pages must still serve and
  clear the cookie, so the open tab can show the signed-out state.
- SSE account events: the publish call must carry `account:<id>` in `topics`,
  or the stream's topic filter drops them.
- Timed locks: `views.ts` `isLocked()` is the one place that decides whether a
  lock is still active, and a 1-second sweeper in `server.ts` flips expired
  locks and emits `post-state` within 3 seconds, writing no mod log entry.

## Testing

The environment runs at `http://127.0.0.1:4173` with seeded data
(`moothall-seed-2026` passwords, admin `larkspur_admin` with TOTP secret
`JBSWY3DPEHPK3PXP`). Playwright lives in /tmp (not a project dependency).
Reset test damage before a run:
`UPDATE accounts SET suspended=false; DELETE FROM revoked_sessions;`
and clear `failed_count`/`locked_until` after lockout tests.
