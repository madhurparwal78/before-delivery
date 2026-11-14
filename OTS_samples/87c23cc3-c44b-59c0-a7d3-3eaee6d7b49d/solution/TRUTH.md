# TRUTH — Pinewick Labs Joinery (golden)

Every value says where it came from: `brief: <section>` (copied from instruction.md) or `decided: <why>` (the brief is silent; the
reason ties it to the brief's intent). DESIGN.md holds the full token tables; this file is the behaviour and the numbers a checker
can compare against.

## Journeys: start state, actions, visible and provider-recorded end state

1. **Type a schema** (brief: Journeys 1). Start: signed-in owner, empty project (`POST /api/projects`, empty text). Actions: focus
   `textbox "Schema text"`, type two entities and a link with only the keyboard (Tab inserts two spaces; Enter adds a newline,
   nothing auto-closes). Visible: each entity appears on the diagram within the parse delay of typing its closing `}` (fade and
   grow 300 ms, `data-motion="enter"`, rows 40 ms apart); the connector draws (400 ms) when the link line parses; `status "Save
   state"` goes `Saving...` then `All changes saved`. PostgreSQL: `projects.text` holds the typed text, `edit_log` one row per
   accepted edit. Reload: same text and diagram; the project is on `/projects`.
2. **Shape the diagram** (brief: Journeys 2). Start: four entities. Arrow keys move an entity one grid step (Shift: five), a drag
   snaps to the grid; Group selected writes one `group "<name>" { ... }` block at the end of the text; Colour changes only the
   layout; dragging from a column handle onto another column writes exactly one `link a.b >- c.d` line after the owning entity
   block and its link lines, typed at 35 ms per character. Moving and colouring leave `text` and `revision` untouched. PostgreSQL:
   `projects.layout` holds positions and colours. Everything survives a reload.
3. **Export DDL** (brief: Journeys 3). Export chip opens `region "Export DDL"` (docks over the right third on desktop); the
   preview follows typing (computed in the browser from the last valid parse with the shared exporter); Save export writes the
   object, reads its size and SHA-256 back, and only then shows `link "Download <slug>-<dialect>.sql"`. MinIO holds
   `exports/<project id>/<export id>-postgresql.sql` and `...-mysql.sql`; the MySQL file lists each lossy lowering as `-- note:`.
4. **Import legacy DDL** (brief: Journeys 4). Paste a PostgreSQL dump, Merge by table name. One unsupported statement answers 422
   `import_failed` with `Line <l>, column <c>: Unsupported statement: <WORDS>`, the dialog lists it under `list "Import errors"`, and
   nothing changes (no revision, no object in MinIO). After removing it the report lists every statement (`Line <l>: table <name>
   added|merged`, skipped, ambiguous), the diagram shows merged entities without duplicates, and `Download original DDL` returns the
   submitted bytes exactly. Repeating the import changes nothing (`changed:false`).
5. **Share and take back** (brief: Journeys 5). Owner creates a view link and an emailed edit link (Mailpit receives the invitation
   only after the SMTP server accepts it). The editor joins and edits live; a link viewer watches read-only. Downgrading the editor
   answers 403 `read_only` on their next write and pushes `Your access changed to view only.`; turning off the view link pushes
   `The owner turned off this link.`; reload gives the 404 not-found page.
6. **Versions** (brief: Journeys 6). Save named versions (gapless numbers from 1), compare two (`Version <a> to version <b>: <n>
   added, <n> removed, <n> changed` plus one line per entity), restore an earlier one: text, positions and colours return as a new
   numbered version `Restored from version <N>`, and every open copy updates live without reload.
7. **Read on a phone** (brief: Journeys 7). 375x812: Text and Diagram tabs (arrow keys move focus, Enter selects), one finger pans,
   two fingers pinch-zoom around their midpoint within 25 to 200 percent (status `Zoom <n>%`), a tap on an entity opens its detail
   sheet rising from the bottom (about the lower two thirds). Reduced motion: entities appear in place with no animation.

## Palette (roles and hex used by the build)

ground #FFFFFF, ink #333333, muted #5F646C (decided: inventory #6B6F76 darkened for AA on the tinted panel), chrome #1F2229, button
#373C44 (hover #23272E), deep accent #0A40B4, accent #1F6FE5, editor pane #1E1F22, dark canvas #3B3E45, toolbar #26282D (chip
#33363D, hover #3F434B), tinted panel #F1F6FE with edge #C9DBF5, card border #E3E5E8, error red #D32F2F (decided: AA with white bold
text), layout colours slate #64748B, blue #3B6FE0, violet #7C6FD0, green #3A8532, amber #E39B2B, red #D94141. Source: brief: Colour
roles for the roles; decided: seed inventory values for the hex.

## Type

Noto Sans 400/600/700 (all interface text, headings included), JetBrains Mono 400/500/700 (text pane, DDL preview, error lines,
column types), both self-hosted woff2 under OFL-1.1 (brief: Type). Body 16px/1.7; heading scale x1.125 per step (18, 20.25, 22.8,
25.6, 28.8, 32.4); hero headline 32.4px (28.8 below 768px) about twice the body; card titles 20.25px; eyebrows 14px semibold sentence
case in accent blue; nothing below 12px (brief: Type; decided: OVERRIDES minimum).

## Space, layout per viewport (brief: Screens and layout)

| Viewport | Layout |
|---|---|
| 375x812 phone (<768) | one column, 20px side margins; strip wraps to two lines (48px); nav = wordmark + `button "Menu"` (`dialog "Menu"` sheet); workspace = tabs Text / Diagram (exactly one pane visible; owners and editors start on Text, link viewers on Diagram); card grid 1 column; dialect strip and toolbar scroll sideways inside themselves; export panel fills the workspace; templates panel opens above the text pane; tap targets 44px |
| 768x1024 tablet (768 to 1023) | full nav; text pane above the diagram; card grid 2 columns; feature rows text first; tap targets 44px |
| 1280x800 desktop (>=1024) | full nav; text pane left (about two fifths), diagram right; export panel over the right third; templates panel a 260px dark column far left; card grid 3 columns; container 1000px, editor screen full-bleed; controls >=24px |

Strip 31px (48px wrapped) over nav 48px, both pinned at every scroll position (brief: Screens; prd: inventory § Layout system).

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| entity node | parse adds an entity (typed, remote, import, restore) | 300 ms opacity 0 to 1, scale 0.96 to 1; `data-motion="enter"` until done | cubic-bezier(0.4,0,0.2,1) | appears in place, no `data-motion`, no animation | brief: Entity entrance |
| column rows | same | 200 ms each, delay 40 ms x index | same | none | brief: Entity entrance |
| connector | link becomes valid | 400 ms stroke-dashoffset, `data-motion="draw"` | ease-out | fully drawn | brief: Connector draw |
| endpoint rows | after draw | 600 ms tint of accent, `data-flash="true"` | ease-out | static highlight for 600 ms | brief: Connector draw; Reduced motion |
| write-back typing | drawn link accepted | 35 ms per character, editor read-only while typing, caret at end of line | timer | whole line in one step | brief: Write-back typing |
| arrange glide | Arrange | 350 ms entity transform, connectors follow, `data-motion="move"` | same | jumps | brief: Arrange glide |
| hero demo | 25% of sample in view | 3 caret blinks (350 ms each), then 35 ms per character, 300 ms pause per line, about 6.3 s total | timer | final text and diagram at once | brief: Hero demo |
| dialogs | open | 180 ms fade; phone sheets 250 ms rise | same | none | brief: Dialogs and sheets |
| nav and toolbar menus | open | 150 ms fade plus 4px rise, caret flips | same | none | brief: Hover and press feedback |
| links, nav items, pills, chips | hover | 150 ms colour; chevron slides 3px | same | kept (about a seventh of a second) | brief: Hover and press feedback |
| primary buttons, feature cards | hover/press | 330 ms darken and shadow / lift; sink 1px while pressed | same | kept | brief: Hover and press feedback |

Nothing loops anywhere; no spinners (brief: No loops).

## States per async action (copy verbatim from brief: Feedback states)

| Action | Pending | Success | Failure |
|---|---|---|---|
| Request sign-in code | `Sending code...` (button label and `status "Sign-in status"`) | `We sent a code to <email>.` | 422 field errors + `Check these fields:` alert; mail down: alert `We couldn't send a code because mail is down. Try again in a minute.` |
| Save version | `Saving...` | `Version <n> saved.` | field errors |
| Restore | `Restoring version <n>...` | `Restored version <n> as version <m>.` | n/a |
| Save export | `Saving export...` | `<dialect> export saved. Download is ready.` | API message; storage down: `Export storage is unavailable. Your diagram is safe and still saving; try the export again shortly.` |
| Import | `Importing...` | `Imported <a> new and <m> merged entities. <s> statements skipped, <x> ambiguous.` or `Nothing changed: the text already matches this DDL.` | `The import was not applied. Fix the lines below and try again.` + `list "Import errors"`; storage down: `Import storage is unavailable, so nothing was imported. Your diagram is safe; try again shortly.` |
| Create link | `Creating link...` / `Sending invitation...` | `<Access> link created.` / `Invitation sent to <email>.` | mail down: `The invitation to <email> could not be sent because mail is down. The link works; send it again later.` |
| Edit saved to server | `Saving...` | `All changes saved` | transport or 5xx: `Changes not saved yet. Retrying...` (every 3 s); conflict: alert `<name> changed <unit> first. Your edit was not saved and the text now shows the latest version.` |

## Breakpoints

375/767 phone, 768/1023 tablet, 1024/1280 desktop; the only layout switches (brief: Screens and layout).

## Business rules the build implements (brief: Business rules)

Mortise grammar, closed message list and error recovery (`src/shared/mortise.ts`); canonical printing and write-back
(`canonical.ts`); next free cell = 14 x (k mod 8), 12 x floor(k / 8) (`layout.ts`); unit merge and conflict naming (`units.ts`);
export order, quoting, lowering notes, 63/64 identifier limits with SHA-256 shortening (`export.ts`); DDL import subset, report,
merge and replace (`server/ddl.ts`, `importing.ts`); versions gapless under a row lock; shares, rotation, revoke, expiry and
member roles with immediate effect; presence in process memory with the timeout sweep; error order 401, 404, 403, 409, 422, 413,
429, 503 on every route (`server/errors.ts` builds every body).

## Media and licences

No fetched media. Fonts: Noto Sans and JetBrains Mono (Fontsource 5.3.0, latin subset, OFL-1.1) in `app/fonts`, listed in
`app/assets.json` with SHA-256. Icons: Lucide (ISC) inline SVG through `lucide-react`. The logo tile, the four feature-row windows,
the six card icons and the empty-state badge are drawn in code for this app (licence `original`, no separate files). Packages: MIT,
ISC, Apache-2.0 only (`THIRD_PARTY_NOTICES.md`).
