# Corbel Draft — repository memory

## What this is
A browser-based 2D drafting and drawing-review app (TypeScript on Node 22, single service).
Postgres (system of record), MinIO (bytes via S3 REST with AWS SigV4 signing), Mailpit
(raw SMTP client over `node:net`), Valkey (RESP client over `node:net`).

## Build and run
- `run.json`: `npm ci` / `npm run build` / `node dist/server/main.js`, port 4173.
- `npm run build` = `tsc -p tsconfig.json` (server + shared → `dist/server`, `dist/shared`) then
  `node scripts/build-client.mjs` (esbuild React client → `dist/client`, copies brand/, fonts/,
  reference.html, shortcuts.html).
- Source layout: `src/server` (API + domain), `src/client` (React), `src/shared` (copy, formats,
  command aliases, types used by both sides).

## Hard-won lessons
- **Redis bulk strings count BYTES.** The RESP parser must work on Buffers, not decoded
  strings: activity text contains `·` (U+00B7, 2 UTF-8 bytes), and a string-based parser wedges
  forever waiting for bytes already consumed. See `src/server/providers/valkey.ts` `parseReply`.
- **Redis AUTH may need a username**: `redis://user:pass@host` → `AUTH user pass`.
- **Pub/sub needs its own connection**: a socket in subscribe mode rejects PUBLISH/PING.
  One CommandConnection + one SubscriptionConnection; `boot` carries the channel list for
  reconnects; never unsubscribe channels on SSE client churn (race: close can arrive after a new
  subscribe for the same drawing).
- **Postgres `on` is a keyword**: the layers table column is `is_on`, aliased `as "on"` in reads.
- **View fitting chicken-and-egg**: the editor's canvas-wrap div must exist in the DOM before
  `drawing` state is ready, or the fit effect can never measure. Keep a persistent canvas-wrap
  in the loading tree.
- React effect cleanup: a `setTimeout` returned from `useEffect` gets cleared when deps change
  on the next render; use refs for one-shot delayed transitions (sticky header hide).
- LINE `C` closes back to the chain's ORIGIN point (kept on `RunningCommand.origin`), and each
  segment commits as its own LINE command.
- Trial pushes: re-evaluate every second; push whenever the computed state differs from the last
  pushed key (no "first-sight seeding" skip — a set grading clock must be seen as a change).
  `PUT clock` calls `forgetTrialState`.
- Email: dot-stuff the body then append the terminator `\r\n.\r\n` separately — stuffing the
  final `.` breaks the DATA terminator (Mailpit never sees the end).
- SMTP multi-line replies: only `ddd␣` ends a reply; skip `ddd-` continuation lines.

## E2E testing
Playwright suites live outside the repo in `/tmp/e2e` (e2e.mjs, e2e2.mjs, e2e3.mjs; 82 checks:
landing, account journeys, files, editor keyboard drafting, layers, traces, links, exports,
clock rules). Browser: `npx playwright-core install chromium-headless-shell` +
`install-deps chromium-headless-shell`. Grading workspaces make sessions cheap for tests.
