# Vireo Pace — repository notes

A public brand site for Alder Quay Laboratories' Vireo Pace drink stick. One
story page of seven chapters, interview pages, a store page and three
information pages. TypeScript on Node 22, served from one origin.

## Running it

```
npm ci          # install
npm run build   # typecheck, then bundle the server, the client and the styles
npm run start   # serve on APP_PUBLIC_PORT (4173 by default)
```

`run.json` holds the same three commands for the harness.

Environment, read once at start in `src/server/config.ts`:
`DATABASE_URL`, `GOTENBERG_URL`, `GRADING_KEY` (no default: without it the
grading route answers the unknown-path 404) and `APP_PUBLIC_PORT`.

## Shape of the code

```
src/shared/   domain rules used by both sides (no content, no DOM, no Node)
src/server/   http server, pages, api, Postgres store, Gotenberg sheet, seed
src/client/   the browser bundle: one module per chapter plus small helpers
src/styles/   site.css and the self-hosted @font-face rules
public/fonts/ the two SIL OFL font families as latin WOFF2 subsets
checks/       developer checks of the published API contract
```

Build: `build.mjs` runs `tsc --noEmit` first, then esbuild three times
(server bundle, client bundle, stylesheet) and copies the fonts into
`dist/public/assets`. `pg` is CommonJS, so the server bundle carries a
`createRequire` banner.

## Where each domain rule lives (one place each)

| Rule | File |
| --- | --- |
| Chapter ids, order and stop numbers | `src/shared/chapters.ts` |
| Scenario order, modes, swipe neighbours | `src/shared/scenarios.ts` |
| Progress → panel, progress → stage, track offset | `src/shared/progress.ts` |
| Yen and milligram formatting, derived product text, the not-a-medicine notice, the edition line | `src/shared/format.ts` |
| Announcements and every fixed interface string | `src/shared/messages.ts` |
| Grading body shape rules | `src/shared/validate.ts` |
| Current chapter, hash, chapter jumps, menu dialog | `src/client/navigation.ts` |
| Latest-choice-wins and the mode memory | `src/client/story-meridian.ts` |
| Product sheet text and its order | `src/server/sheet.ts` |

The Product chapter, the store page and the product sheet all build their
facts from the stored record through `src/shared/format.ts`.

## Content

Postgres holds one row (`content_record`) with the edition, the product, the
interviews, the scenarios and the fixed site copy. The app creates the table
and stores the starting content of `src/server/seed.ts` on every start, and
keeps whatever is already there.

The fixed site copy is server-rendered from that row. The product, the
interviews and the scenarios are never written into the HTML or the client
bundle: the browser reads them through `/api/content`,
`/api/interviews/<slug>` and `/api/scenarios/<id>`.

Interview page titles are the one exception the brief asks for: the server
reads the name so that `<name> | Vireo Pace interviews` and the 404 status are
right on the first byte.

## Things that are easy to get wrong

- The About and Oxygen & Energy chapters are held in view only at 768 px and
  wider **and** without reduced motion. Their heights (`300vh`, `500vh`), the
  header height and the heading clearance live in `site.css`; the progress
  maths reads the real element height, so it never drifts from the CSS.
- A chapter jump scrolls to the region's own top. Every chapter's content
  starts 104 px down, which keeps the heading clear of the 64 px header.
- `ChapterNavigation` holds the current chapter for one second after a jump by
  link, so a smooth scroll cannot flicker the hash through the chapters it
  passes.
- The hash is only rewritten when the chapter actually changes; rewriting it on
  every scroll event trips the browser's history throttle.
- The Meridian's radios and the address follow a choice at once, but
  `data-mode`, `data-scenario`, the stage colour, the picture and the copy only
  change when the answer for the **latest** choice arrives.
- The scenario announcement uses the freshly fetched record, while the stop
  names keep what the page loaded. That is what makes a scenario published
  mid-visit show its new title on an open page.
- The focus ring uses `:focus`, not `:focus-visible`, because the brief asks
  for a ring whenever a control has focus.
- Only files found under `dist/public/assets` are ever served, so no source,
  manifest or package file can be reached.

## Checks

With the site serving and `GRADING_KEY` set:

```
bash checks/api.sh        # the published API contract, error order and boundary
python3 checks/grading.py # the grading shape rules and the product sheet text
```

`checks/grading.py` needs `pdftotext` (poppler-utils) to read the sheet.
