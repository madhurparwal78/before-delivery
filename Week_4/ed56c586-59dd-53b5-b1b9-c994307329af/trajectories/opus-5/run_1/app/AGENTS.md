# Ottoline Rask Selected Builds — repository notes

A visitor-facing hiring portfolio for the invented developer Ottoline Rask, trading as
Quillfern Works. Everything on the site (people, clients, reviews, figures, timeline)
is fictional and labelled as illustrative.

## Shape of the project

- TypeScript on Node 22, **no production dependencies**. `esbuild` and `typescript`
  are dev-only. The server, the SMTP client and the AWS Signature Version 4 object
  store client are all written here on the standard library.
- `src/shared/*` holds every rule both sides need: seed data, the filter and its
  canonical address form, the neighbour rule, the counter figure, the callout
  stepping, the scroll lines, the media manifest and the enquiry rules and state
  machine. Never duplicate one of these in `src/client` or `src/server`.
- `src/server/*` renders the three pages as strings, serves `/media/<key>` and the
  API, stores the 42 procedural artwork objects and sends the enquiry email.
- `src/client/*` is plain DOM code, one module per area, wired in `client/main.ts`.
- `src/styles/site.css` is the whole stylesheet. Colours are plain hex only (IF-06).

## Build and run

```
npm ci          # install
npm run build   # typecheck (strict, no any) then esbuild server, client and css
npm start       # node dist/server.js on 0.0.0.0:4173 (APP_PUBLIC_PORT)
```

Services come from the environment only: `S3_*`, `SMTP_HOST`, `SMTP_PORT`,
`MAIL_FROM`, `GRADING_KEY`, `MEDIA_PROBE_SECONDS`, `MAIL_TIMEOUT_SECONDS`. Nothing
is hard-coded and none of it reaches the browser.

## Behaviour that is easy to break

- **Page clock.** Only five things use page timers: the intro end (1,800 ms), the
  role rotation (2,500 ms), the counters (16 ms ticks to 1,500 ms), the callout
  stepping (150 ms) and the media re-check (5,000 ms). Everything else is either an
  instant state change or CSS/Web Animations motion.
- **Scroll rules** run on `scroll` and `resize` only, never on observers. They are
  registered with `onScrollOrResize` and all fire through `runScrollRules`.
- **`[hidden] { display: none !important }`** is load-bearing: without it a
  `display: flex` rule re-exposes a closed panel to Tab.
- **Accessible names** are computed with spaces between block-level children. Keep
  inline elements inline inside a control (`.milestone-year`), or the name gains a
  stray space.
- **Arrival placement runs twice** (`arrive()` in `client/main.ts`): the browser's own
  fragment handling moves scroll and clears focus when loading finishes, so the
  arrival is placed again on `load`.
- **`history.scrollRestoration = 'manual'`** — the page places every arrival itself.
- **Addresses keep literal commas**: `URLSearchParams` encodes them, so
  `addressOf` in `client/jumps.ts` writes `%2C` back as `,`.
- **Callout regions** are percentages of the frame's padding box, so the preview and
  quick-look stages use `outline`, never `border`.
- **Disabling a focused button blurs it.** Read `document.activeElement` before
  changing `disabled` (reviews, quick look).
- The gallery return finds the project it should focus from `history.state.returnSlug`
  (set when leaving by a card link) or from the case-study referrer.

## Verification

Checks were run with Playwright and axe-core from `/tmp/verify` (not part of the
repo): the journeys, the published tab order, the clock-exact timings, the layouts at
375/768/1024/1280, axe on every page and viewport, and `media-late` / `mail-late`
copies driven through a TCP proxy that starts after the app. A paused page clock must
be installed *before* `goto` (`clock.install({time}); clock.pauseAt(time)`), otherwise
the fake clock keeps ticking in real time and timing assertions drift.
