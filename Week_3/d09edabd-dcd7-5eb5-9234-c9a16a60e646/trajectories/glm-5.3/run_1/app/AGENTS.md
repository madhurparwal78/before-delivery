# Keyway Bench — engineering notes

Escape-room design bench app. TypeScript throughout; Node 22, npm.

## Layout

- `run.json` — run manifest (`npm ci` / `npm run build` / `npm run serve`).
- `src/shared/` — the one implementation of every domain rule, used by server and browser:
  - `units.ts` (mm → metres / feet-inches-sixteenths), `chain.ts` (chain order, longest run,
    loop detection, auto-fire), `playtest-state.ts` (legal state machine), `copy.ts` (published copy), `types.ts`.
- `src/server/` — Express app. `main.ts` wires middleware; `api.ts` holds all routes;
  `freeze.ts` (all-or-nothing freeze), `locks.ts` (Valkey lock winner), `debrief.ts`,
  `mailer-queue.ts` (retry every 10 s, 3 attempts), `migrate.ts` + `schema.sql` (idempotent seed).
- `src/frontend/` — React app. `editor.tsx` (state + save queue), `chrome.tsx` (floating clusters,
  scene tree), `picker.tsx`, `sheets.tsx`, `tester.tsx`, `public.tsx`, `pack.tsx`, `stage3d.ts` (own WebGL renderer).
- `public/` — self-hosted fonts (Inter, JetBrains Mono), Lucide icons, workshop-dark CSS.
- `tests/` — `api_test.py` (138 checks), `frontend_test.py` (20), `frontend_deep_test.py` (32),
  `outage_test.py`. Python + Playwright (`pip install playwright && playwright install chromium`).

## Hard-won lessons (keep these!)

- **node-redis v4**: a client that subscribes refuses all other commands. Use one connection for
  commands and a separate one for pub/sub (`valkey.ts`). The subscribe callback signature is
  `(message, channel)` — not `(channel, message)` — mixing them up silently sends the channel name.
- **node-redis reconnect**: never return `false` from `reconnectStrategy` (it disables reconnection
  forever and breaks the "pick up within 10 s without restart" rule). Commands queue forever while
  disconnected — wrap every command in `guard()` so they fail fast as `503 live_unavailable`.
- **pg returns jsonb and arrays already parsed** — never `JSON.parse` a jsonb column value;
  pass arrays directly (never `JSON.stringify` an array for a `text[]` param... except when the
  column type needs it; see `restore`).
- **Raw pg rows are snake_case** — convert through `placementJson`/`nodeJson` before serialising
  snapshots or version copies, or every length in the build pack becomes undefined.
- **Express 4 does not catch async errors** — every route goes through `route()` in `http.ts`.
- **python `CookieJar` is falsy when empty** (`__len__`) — `jar or CookieJar()` throws cookies away.
- Empty-body POSTs: parse JSON only when `content-length > 0` or chunked, else express throws.
- Node ids in tests: the picker grid moves by columns (4 desktop / 2 phone) per ArrowDown.

## Running locally

```bash
npm ci && npm run build
npm run serve            # :4173 (APP_PUBLIC_PORT)
# second instance against the same services:
APP_PUBLIC_PORT=4174 INSTANCE_NAME=b npm run serve
```

Health: `GET /api/health` → `{"status":"ok","instance":...,"services":{...}}`.
Seed logins: `mara@lanternlane.test` / `keyway-owner-1` (owner), `tobi@lanternlane.test` /
`keyway-codesign-1` (co-designer), `ines@brasskey.test` / `keyway-other-1` (other workspace).
