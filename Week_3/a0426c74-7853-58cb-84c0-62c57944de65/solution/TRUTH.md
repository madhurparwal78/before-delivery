# TRUTH — Plotfold golden

Ground truth of the reference app. Every value says where it came from: `brief: <section>` (copied verbatim from `instruction.md`)
or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent). Colours and type are in `DESIGN.md`; this file
restates the hex values the build uses.

## Services and provider records

- PostgreSQL (`DATABASE_URL`): users, sessions, folders, roles, drawings, the per-drawing operation log in server order (op id, base revision, group, author, command), entity history, per-person undo/redo stacks, layers, layer states, blocks, dimension styles, constraints, parameters, xrefs, underlay records, sheets, viewports, version records and cached snapshots, markups, issues, RFIs, review steps and stamps, link records, export jobs, parsed imports. brief: Services.
- MinIO (`S3_*`, one bucket): `underlays/<drawing id>/<sha256>.png|.jpg`, `imports/<drawing id>/<sha256>.plot.txt` (byte for byte, before parsing), `versions/<sheet id>/<n>.json` and `.svg`, `exports/<drawing id>/<job id>.plot.txt|.svg`. brief: Services.
- Health: `GET /api/health` → 200 `{"status":"ok"}` when MinIO answers, `{"status":"unavailable"}` when it does not; never 503; MinIO checked afresh each request with a 2 s limit. brief: Deployment.

## Journeys (ideal end-to-end flows)

1. **Draft from the keyboard** (brief: Journeys 1). Start: empty drawing `Plot plan`, focus in `textbox "Command"`, prompt `Ready. Type a command.`. Type `L`, Space → prompt `LINE: from point`; `0,0` Enter → `LINE: to point (Enter ends, U steps back)`; `@10,0` Enter; `@10<90` Enter (third point at 10,10); `U` Enter steps back one point; Enter ends (prompt `Ready. Type a command.`); empty Enter repeats `LINE: from point`; Escape → `Cancelled.`. End: one line L1 from 0,0 to 10,0 in PostgreSQL (revision 1), announcement `Line L1 added`, row `Line L1, layer 0, from 0,0 to 10,0, length 10`, focus in Command after every step.
2. **Draw with a colleague** (brief: Journeys 2). Two sessions open the same drawing; both appear in `list "People here"` (colours 1, 2); A's pointer near a line end with Snap on resolves `data-snap-kind="endpoint"` over a nearer midpoint; A draws with Ortho, selects with a window, drags a grip; B sees A's named crosshair (`data-colour`, `data-x`, `data-y`) and the new geometry through one live `ops` message with announcement `<A> changed 1 entity`.
3. **Shape and annotate** (brief: Journeys 3). TRIM/EXTEND/FILLET/CHAMFER/OFFSET/MIRROR/ARRAY each one undo step; dimension values and hatch areas recompute on both screens; deleting a hatch boundary line makes `data-associative="false"` with the toast `Hatch <h>: boundary broken. It no longer follows its edges.`; one Ctrl+Z restores `true`.
4. **Lay out and publish** (brief: Journeys 4). `New sheet` (A3), two viewports 1:50 and 1:20, title block fields; `Publish sheet` → `Publishing…`, then `Published version 1.` only after both MinIO objects exist; with storage down: `File storage is unavailable. Nothing was published. Try again in a moment.` (HTTP 503 `storage_unavailable`, no version row, number unused); after recovery the retry succeeds without a restart.
5. **Edit apart, merge in order** (brief: Journeys 5). Both sessions `Work offline`; edits queue in localStorage (`You're working offline. <n> changes waiting.`); reconnect A then B; server order decides by the Conflict rules table; B sees `Back online: <n> changes sent, <k> conflicts.` and toasts; A's Ctrl+Z skips the overridden change with `Can't undo: <B> changed L1 after you.`; the next Ctrl+Z restores the erase.
6. **Compare and review** (brief: Journeys 6). Review of version 2: `Compare` → `v1`/`v2`, `Added <a>, removed <r>, changed <c>` (xref reload counted), slider 50 → ArrowLeft 49 (`49% newer version`), flagged markups carry `data-flag="geometry-changed"`; `Approve` adds `Approved by <user> at <YYYY-MM-DD HH:MM> UTC`; publishing version 3 voids the pending review (`Review voided: version 3 replaced this one.`).
7. **Field question** (brief: Journeys 7). Phone 375x812 on `/versions/<id>`: pinch/pan, tap → `dialog "New issue"` → pin `data-issue-pin`; `Create RFI` → `dialog "New RFI"` → `Send RFI`; desktop sees `article "RFI: <question>"` `With <addressee>` live, answers, ball returns (`With <reviewer>`); manager revokes the role → phone shows `You no longer have access to this drawing.` live.
8. **Bring in and find** (brief: Journeys 8). `Import` → `dialog "Import preview"` → file with errors lists `Line <n>: …` entries (max 20); corrected file shows `Adds <n> entities, <l> layers, <b> blocks.` and renames `<old> renamed <new>`; `Merge` is one `IMPORT` group (one undo). With 1500+ lines the page keeps ≤ `PLOT_DOM_CEILING` entity elements (+ selected), snaps/Find/Entities reach off-screen entities.

## Rules restated with their source

- Revision +1 per operation; stale base more than `PLOT_OP_WINDOW` behind → 409 `stale_base` "This change is too old. Reload the drawing and try again."; replay by `op_id` returns the stored result; group all-or-nothing. brief: Business rules (Operations).
- Error order: too_large, cross_origin, unauthenticated, rate_limited, not_found, other 403 in table order, stale_base then other 409s, wrong_type, quota_exceeded, invalid, storage_unavailable, parse_failed. brief: API (Error order).
- Conflict rules, per-person undo, presence (lowest free colour 1–8, removal `PLOT_PRESENCE_TIMEOUT_MS` after socket close on the server clock), roles live, view links (`PLOT_LINK_TTL_MS`), reviews (`PLOT_REVIEW_TTL_MS`), exports (20 % steps every `PLOT_EXPORT_STEP_MS`, written after the 4th step, failed at 80). brief: Business rules.
- `block_define` always also creates one insert of the block at the base point (also when redefining). decided: the reference tests remove the extra insert after a redefinition, the brief says "The picked entities become one insert of it at the base point".
- Version `replaced_by` carries the replacing version's id; the UI shows `Replaced by version <n>`. decided: brief prints only the sentence.
- Offline "changes" count operations. decided: brief: "A conflict is a queued operation whose result is rebased, dropped or redirected."
- `GET /api/folders/<id>/roles` (addressee list), `xref_sources` on the folder drawing listing, `view` and `seq` on the drawing document and the underlay bytes route `GET /api/drawings/<id>/underlays/<underlay id>` are additive. decided: the UI needs them and the brief's lists are not exclusive.
- `GET /api/drawings/<id>` lists entities grouped by handle letter (L, then P, C...), each group in handle number order. decided: the brief gives the entity list a handle-number order only on screen; the reference tests read the document in listing order.
- Sheet `Publish sheet` is rendered but disabled on the Model layout (it publishes the active sheet). Markup tools (`Cloud`, `Arrow`, `Text`) open `dialog "New markup"` with typed corners and a note. decided: the brief names the tools but not how a markup is placed.
- Passwords are stored as scrypt N = 2^14, r = 8, p = 1 with a random salt per password. Each sign-in attempt is counted when it arrives, before the password check, over a rolling 60 s window per username. decided: brief: Accounts gives "per username per minute"; the hash cost is low enough that a full minute's allowance is checked within that minute.
- An unexpected server fault (a dependency failing in a way the rules do not name) answers with a published code: 503 `storage_unavailable` `The server could not complete that request. Try again in a moment.` decided: brief: "Every API error uses the one published body shape and code list"; 503 is the published code for a service that did not confirm.
- Undo of a delete restores a layer, block, style or parameter at the end of its list rather than its old position. decided: only entities, constraints, dimension links and hatch links are specified as restored exactly.
- The `rate_limited` count for operations is taken right after the session check, before the drawing lookup, the role check and the parse, so `rate_limited` comes before `not_found` and every 403. It counts the entries of the request's `ops` list (one for undo, redo or a body without a list), replays included. brief: API (Error order) 4 before 5; counting unit decided.

## Palette roles (hex used by the build)

ground `#0f1110`, surface `#181b19`, line `#2c312e` (decorative), line-control `#6b786f`, ink `#ebe6da`, ink-bright `#faf6ec`, muted `#8e9c92`, accent (sage) `#a3bd9e`, on-accent `#0f1110`; presence 1–8 `#a3bd9e #e3b866 #82b6dc #e28fa8 #ab9fe3 #b8d56e #ea8c72 #d8c79d`; layer colours white `#ebe6da`, red `#ec6f62`, yellow `#e8cb55`, green `#4fcf7c`, cyan `#4fc3d8`, blue `#6f95f2`, magenta `#d77fd0`, grey `#a6a6a6`. Roles brief: Visual design; hex decided (DESIGN.md).

## Type, space, layout per viewport

- Funnel Display 600 for `Plotfold` and `Folders` only (`clamp(38.82px, 8vw, 55.9px)`), Funnel Sans 400/600 13px / 18px for everything else; each heading step one fifth larger. brief: Visual design; sizes decided.
- Square corners everywhere; 4px spacing unit; controls ≥ 44 px on phone and tablet. brief: Visual design; decided.
- Phone < 768: drawing fills the viewport, `textbox "Command"` one line along the bottom, `button "Panels"` top right → `dialog "Panel"` ≤ 60 % height with `tab "Issues"`, `tab "Markups"`, `tab "Versions"` (opens on Issues). Tablet 768–1279: drawing on top full width, command bar under it, `tablist "Panels"` with a tab per panel, Entities active. Desk ≥ 1280: left column Entities over Layers, centre drawing + command bar, right column Properties, Parameters, Xrefs, Versions, Issues, Markups, all open. brief: Screens and layout.
- No screen scrolls sideways at 375x812, 768x1024, 1280x800 (except published strips). brief: Screens and layout.

## Motion

| Animation id | Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|---|
| `zoom-all` | the drawing's view group inside `region "Drawing"` | ZOOMALL | 320 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` (decided: starts quickly, eases to rest) | none created; data attributes final at once |
| `compare-swipe` | the swipe divider | key press on `slider "Compare swipe"` | 120 ms | same | none created |
| `sheet-pin` | a new issue pin | pin placed | 200 ms, scale 0.8 → 1 | same | none created |
| `toast-enter` | a new toast | toast appears | 120 ms, opacity 0 → 1 and translateY(-6px) → 0 | same | none created |

All other effects (hover brighten, pressed darken, lit landing frame) change at once with no transition. brief: Motion and effects.

## States per async action

| Action | Pending | Success | Field error | Outage |
|---|---|---|---|---|
| Publish | `Publishing…` | `Published version <n>.` | — | `File storage is unavailable. Nothing was published. Try again in a moment.` |
| Underlay | `Uploading…` | `Underlay attached.` | `That image is larger than <max> bytes.` / `Underlays must be PNG or JPEG images.` / `This drawing's underlays would pass <quota> bytes.` | `File storage is unavailable. Nothing was added. Try again in a moment.` |
| Import | `Reading file…` | `Imported <n> entities.` | `That file is larger than <max> bytes.` / `That isn't a Plotfold drawing text file.` / line errors | the underlay outage text |
| Export | `Export started.` + `progressbar "Export"` | `Export ready.` + `link "Download export"` | — | `Export failed: file storage is unavailable.` + `button "Retry export"` |

brief: Feedback states. Sign-in/register errors: `Wrong username or password.`, `Too many sign-ins. Wait a minute and try again.`, `Use 3 to 24 lower-case letters, digits or underscores.`, `Use at least 8 characters.`, `That username is taken.` brief: Feedback states.

## Breakpoints

375x812 phone, 768x1024 tablet, 1280x800 desk; 390x844 also phone. brief: Screens and layout.

## Media and licences

No photographs or illustrations are fetched. Landing sheet frames, folder thumbnails, empty frames, icons and all drawing marks are drawn in code (`original`). Fonts: Funnel Display 600 and Funnel Sans 400/600 latin woff2 from Fontsource (SIL OFL 1.1), listed in `app/assets.json` and `THIRD_PARTY_NOTICES.md` with the full OFL texts. Production packages: pg, ws, react, react-dom and their transitive dependencies (MIT/ISC).
