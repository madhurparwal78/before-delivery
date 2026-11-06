# TRUTH — Clapstick

The brief made concrete. `brief: <section>` is copied from `instruction.md`; `decided: <why>` is where the brief is silent.

## Journeys

1. **From script file to timed reel** (brief: Journeys). Signed in on a new job. Choose a file on Script: preview with row numbers and reasons, nothing saved. `Save` makes one frame per new row. Board: upload drawings per file, each row `Stored` only after MinIO confirmed. Reorder by Alt+arrows, Move buttons or drag. Reel: `[` and `]` trim. End: `data-part="target"` reads `exact`.
2. **A cut goes to a producer** (brief: Journeys). Lines per market; Cues: combobox, licence bought only after `POST /v2/licences` answers 201. Make cut. `Preview film` posts `/v1/renders` once per cut and settings; the server polls every 5 s; Ready after size, SHA-256 and MinIO. `Send review page`: mail in the producer's language with `APP_PUBLIC_URL` + `/r/<token>`.
3. **A producer answers from a phone** (brief: Journeys). Tap places a pin, sheet opens, `Add note`, name once on Send, `Send notes` once by `sendKey`. The Notes screen shows it within 5 s and announces it.
4. **Notes become a signed-off cut** (brief: Journeys). Notes marked; next cut; positions read against the newest cut; `Ask for sign-off`; typed name folds to the held name; one sign-off under the job's row lock; history `signedOff`.
5. **Calls across clock changes** (brief: Journeys). Wall time resolved in the producer's town; `call.ics` with stable UID, SEQUENCE up on move, METHOD:CANCEL on cancel.
6. **Delivery and fee letter** (brief: Journeys). Gotenberg first, then three MinIO puts, then the row; any failure removes what was written. Letter: three milestones, tax half up on each.
7. **Closing a client** (brief: Journeys). `closesAt` = start + wait; reads `erasing` from that instant; erasure lists and deletes from MinIO first, then the rows; `erased` keeps one entry.
8. **A visitor finds the work** (brief: Journeys). Wipe, reel filter in URL, accordions in URL, Copy address, enquiry: 202 with thanks, one mail to the artist.

## Palette

ground `#FFFFFF`, surface `#EFEFF0`, ink `#17171A`, muted `#5C5C64`, accent `#C8102E`, band `#0E0E10` (brief: Colour names the roles; decided: exact values meeting AA, see DESIGN.md).

## Type, space, layout

Libre Franklin 700 capitals for headings, Source Serif 4 body and tabular figures (brief: Type). Each heading step 1.25 times the last (brief: Type). Arabic glyphs fall back to Noto Naskh Arabic (decided: the Arabic copy must not print as boxes).
No text under 16 px (decided: the scale starts at the body size). The slant's run is 0.325 x the shape's height, 18 degrees at every scale (brief: Direction). The hero bar runs to the right and bottom viewport edges; the header stays clear of it (brief: Hero, cropped by the viewport; decided: ink nav on red would miss AA).
375: one column, fixed bottom bar. 768: one or two columns. 1100: rail, inline filters, week grid, three work columns (brief: Layouts). Hero half and half with a 12 px gap; band 56 px, 40 px at 375 (brief: Hero).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| heading line | page placed | 320 ms, each 80 ms after the last (brief) | `cubic-bezier(.2,.7,.2,1)` (decided: quick then soft) | shows at once |
| route wipe | public route change | 320 + 320 ms (brief) | same | none |
| reel filter | radio change | 320 ms (brief) | same | at once |
| client strip | always | 64 s, paused when hovered or focused (brief) | linear | stopped |
| accordion | press | 320 ms (brief) | same | at once |
| underline, header, menus, tips | hover, focus, scroll | 160 ms (brief) | same | at once |
| dialogs, sheets | open, close | 320 ms (brief) | same | at once |
| board frames | move | 320 ms (brief) | same | at once |
| trim | `[`, `]` | 160 ms (brief) | same | at once |
| rate change | radio | widths and numerals 320 ms, playhead 640 ms (brief) | same | at once |

## States per async action

Button reads `Working…` with `aria-disabled`; success announces its copy; refusal announces its copy and fills `region "Problems"` (brief: Feedback states, SR11).

## Breakpoints

320, 375, 768, 1100, 1280 (brief: Browser support, Layouts).

## Media and licences

No files: drawings come from `src/shared/drawing.ts` (decided: twelve procedural pencil scenes, so no job's frames repeat; brief: DP-56). Fonts OFL-1.1 (brief: IF-07; assets.json).

## Decided details

- Client-side router with `history.state` memories for scroll and row focus (decided: Back must restore both, SR22).
- The drawing path takes `?cut=<n>` for a cut's kept drawing (decided: only published endpoints exist).
- The session cookie is named `session` (decided: brief names none).
- Fee letter scope may be empty (decided: the brief publishes no copy refusing it).
- `Save letter` sits under Scope, and the letter's state sits above the sending controls (decided: saving comes before sending). With no letter the state line reads `No letter saved yet.`.
