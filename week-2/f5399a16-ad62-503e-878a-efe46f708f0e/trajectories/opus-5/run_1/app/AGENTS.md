# Clapstick

One desk for an independent storyboard artist: frames, the Slate strip, cuts,
private producer pages, calls in local wall time, delivery files and fee letters.

## Running it

| What | How |
|---|---|
| Install | `npm ci` |
| Build | `npm run build` (esbuild bundles, then `tsc --noEmit`) |
| Serve | `npm run serve` (`dist/server.js`, binds `0.0.0.0` on `APP_PUBLIC_PORT`) |
| Health | `GET /api/health` answers `{"status":"ok"}` |

`run.json` holds the same three commands under `"_schema":"run-manifest-v1"`.

Every service address and credential is read from the environment in
`src/server/config.ts` and never reaches the browser.

## Shape of the source

```
src/domain/      pure rules shared by the server and the browser
src/server/      http core, api modules, infra clients, seed, workers
src/client/      the browser app: dom patcher, shell, screens
public/fonts/    the OFL-1.1 fonts the app ships
scripts/         build, font vendoring and notices
```

### Where each rule lives, once

| Rule | File |
|---|---|
| Exact arithmetic (half up, rationals) | `src/domain/rational.ts` |
| Timecode, real seconds, rate conversion, reading time | `src/domain/timecode.ts` |
| The folding table (search, typed names, the edit decision list) | `src/domain/folding.ts` |
| Wall clock, zones, clock changes, printed dates and times | `src/domain/time.ts` |
| Money, milestones and tax | `src/domain/money.ts` |
| Ad-ID, suggested lengths, line geometry, licence state, differences | `src/domain/rules.ts` |
| Published copy of the desk | `src/domain/copy.ts` |
| Published copy of the private pages, in four languages | `src/domain/privateCopy.ts` |
| Delivery file formats | `src/domain/delivery.ts`, `src/domain/csv.ts`, `src/domain/ics.ts` |
| Screen addresses and headings | `src/domain/screens.ts` |

### The precedence ladder

`src/server/main.ts` walks it in one place: route, size, rate limit, origin,
authentication; the handler then does resource, content type, JSON, fields,
state and stale. `src/server/http.ts` holds the one error shape.

An upload route reads its file **before** authentication, so a file over its
limit answers 413 with no session.

### The browser app

`src/client/dom.ts` is a keyed patcher: a refresh updates existing elements in
place, so focus, scroll, selection and open dialogs survive, and moved elements
keep their identity for FLIP motion in `src/client/motion.ts`. Only the
durations 160, 320, 640 ms and the 64 s client strip exist.

Screens register themselves with `registerScreen` in `src/client/app.ts`;
dialogs and sheets register with `registerSurface` in `src/client/shell.ts`
(a name match, or a prefix match such as `Edit frame`).

## Things learnt the hard way

- This box has no `ps`, `pkill` or `xxd`. Read `/proc/<pid>/cmdline` to find the
  running server.
- Postgres `text` cannot hold `\u0000`, so cache keys must not use it as a
  separator.
- `axe-core` clamps an off-screen element's probe point into the viewport, so
  text below the fold can be judged against whatever is on screen there. Keep a
  screen's text inside the viewport at 375x812 or give it a solid background.
- A left offset such as `left: -200vw` on a visually hidden link becomes real
  sideways scroll under `dir="rtl"`. Use the clip-path pattern instead.
- The seeded calls land on Fri 12 Mar 2027 and Mon 15 Mar 2027 while the clock
  reads late 2026, which matches the worked examples in the brief.

## Checking it by hand

`scripts/` holds walks used while building, all against a copy serving on
`http://127.0.0.1:4173`:

| Script | What it walks |
|---|---|
| `smoke.mjs` | the whole API, from signing in to the fee letter |
| `windows.mjs` | the undo window, sessions, closing a client and the ladder |
| `formats.mjs` | the edit decision list, shot list and both PDFs |
| `outages.mjs` | the MinIO-down and Gotenberg-down copies |
| `restart.mjs` | stops a running copy, since this box has no `pkill` |

Browser walks were run with Playwright and axe-core installed ad hoc; neither
is a dependency, so `npm ci` stays quick.
