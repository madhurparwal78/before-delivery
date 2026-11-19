# Mullion — repository notes

Mullion is a hosted visual editor for CSS grid layouts. TypeScript on Node 22, served from one
port: pages, API and live WebSockets. Postgres is the system of record; Valkey carries presence
and the live fan-out only.

## Layout of the source

```
src/shared/   domain rules used by both the server and the browser
src/server/   HTTP server, API, server-rendered pages, WebSockets, Postgres, Valkey
src/client/   the editor, the view page, the library and the sign-in pages
scripts/      verification scripts (plain node, no extra dependencies)
build.mjs     esbuild: server -> dist/server/index.cjs, client -> dist/client/app.js + styles.css
```

Each domain rule is decided in exactly one place in `src/shared` and both sides import it:

| Rule | Module |
| --- | --- |
| Track sizes and their canonical form | `trackSize.ts` |
| Area name, rename, overlap, extend, clear | `area.ts` |
| Scope access, track add and remove, reading order | `grid.ts` |
| Generated CSS and HTML | `generate.ts` |
| Reading CSS back, with line-numbered errors | `parseCss.ts` |
| Applying a change and inverting it for undo | `changes.ts` |
| Conflict targets and how the notice names them | `conflict.ts` |
| Announcement copy for every change | `announce.ts` |
| Version differences | `diff.ts` |
| Starter templates | `templates.ts` |

## Things worth remembering

- **Resolved widths come from the preview.** `PreviewPane.resolvedColumns()` reads
  `getComputedStyle(.layout).gridTemplateColumns` inside the preview iframe, so the readouts are
  the browser's own used values. The frame's document sets `overflow: hidden` so a scrollbar can
  never narrow the grid.
- **Scope in effect is derived, never stored.** The editor keeps only `previewWidth`; the selected
  breakpoint tab and the canvas scope follow from it, and selecting a tab moves the width.
- **Area blocks are absolutely positioned over the cells** and glide with a CSS transition. A
  `ResizeObserver` re-places them after a pane is shown or the window resizes, but it stands back
  while a glide is running.
- **Dialogs are native `<dialog>` elements** opened with `showModal`. `keepFocusInside` adds the
  explicit Tab wrapping the brief asks for, because browsers differ on where Tab lands at the end
  of the dialog.
- **Header controls live inside the grid**, so `Canvas.onKeyDown` ignores any key event whose
  target is not a gridcell; otherwise Enter in a size field would open "Name area".
- **Size and gap fields commit on Enter and on blur**, so each keeps the last value it attempted
  and never sends the same change twice.
- **Undo history is per designer, per layout, in server memory** (`src/server/layouts.ts`). The
  change log in Postgres stores each change with the target set that decided its conflicts, which
  is also what names the target in the conflict notice.
- **Nothing is forwarded locally on a change**: the server publishes to Valkey and the subscriber
  fans out. That is why an unreachable Valkey pauses live delivery without any extra code path.
- **No limit, URL or key reaches the browser.** The page shell embeds only the page name, the
  signed-in username and the layout object.

## Verifying

```
npm run build
node scripts/check-domain.mjs   # generated code, track sizes, CSS reading, diffs (no server)
node scripts/check-api.mjs      # the whole API against a running server on 127.0.0.1:4173
```

`check-domain.mjs` bundles `src/shared` with esbuild into a temporary module and calls it
directly, so it needs no running server and no database.

Browser journeys were checked with Playwright (Chromium) during development, covering the
keyboard build, track sizing, the CSS round trip, the Breakpoint Fold, co-editing and conflicts,
version restore, the developer view link, phone editing with reduced motion, and the Valkey
outage (a second copy started with an unreachable `VALKEY_URL` on another port). Playwright is
not a dependency of the app.
