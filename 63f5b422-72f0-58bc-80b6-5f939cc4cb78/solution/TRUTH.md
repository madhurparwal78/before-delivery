# TRUTH — Oarlock Works Plinth (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Owner sets up a workspace** — brief: Journeys 1.
   Start `/signup` (gridded ground, one card). Submit empty → `alert` "There is a problem" listing
   `Enter a name.`, `Enter an email address like name@example.org.`, `Use 10 or more characters.`
   as links that focus their fields (brief: Feedback states). Valid submit → `/` (`Workspaces`) →
   `Workspace name` + `Create workspace` → `/w/<id>/edit` on `Home` (seed: page `Home`/`home`, tokens
   `ink` black, `paper` white, `space-md` 16 px, `size-xl` 40 px, collection `Entries`; brief: Seed data).
   `Share` opens `dialog` "Share <workspace>": Email + Role + `Send invite` → `Invitation sent to <email>.`
   twice; `Members` lists two `Invited` rows; Escape returns focus to `Share`.
   Provider: two `invitations` rows (pending), one Mailpit message per invitee with subject
   `<owner> invited you to <workspace> as an editor|a viewer` and the link alone on one line.
2. **Editor builds a page** — brief: Journeys 2. On an empty Home at 1280×800: `A` → menu
   `Add component` (focus on `Section`) → Enter → `Added Section 1.`, focus on its row; Enter selects;
   `A`, ↓, Enter → `Stack 1`; `A`, ↓↓, Enter → `Heading 1`. Drag `Button` from the menu onto the
   section (indicator `#drop-indicator` names parent/index). Alt+↑/↓/←/→ move and re-nest with
   `Moved <name> to position <n> of <total> in <parent>.`; refused moves say `Can't move <name> there.`;
   F2 renames; Delete opens `Delete <name>?` and `Deleted <name>.`. Provider: one operation per
   edit in `operations` (seq in arrival order); canvas, Navigator and `GET .../document` agree.
3. **Breakpoints in the Cascade Fan** — brief: Journeys 3, Motion and effects. Heading selected on
   Desktop, `F` → `data-fan` opening→open over 420 ms; pips per row. Desktop font-size 48px →
   `font-size changed on Desktop. Inherited by Tablet and Phone. Kept override on no other breakpoint.`,
   Tablet and Phone frames ripple 160 ms. Tablet 28px → Phone inherits. Clear Tablet →
   `font-size on Tablet now inherits 48px.`. Escape → closes from current progress, focus on the
   heading's row. Stored overrides equal computed sizes in each frame.
4. **Two editors** — brief: Journeys 4. Each sees the other's avatar (`<name>, editing`) and
   `#cursor-<userId>` pointer within 1 s. A colour token edit updates both canvases. Same heading
   colour at once: the later `seq` wins everywhere; the loser hears
   `<name> set color to <value> at the same time. Their value was kept.`. Open menus, comboboxes,
   dialogs, typing and the Fan stay as they are.
5. **Reuse blocks and content** — brief: Journeys 5. `Create shared component` turns the footer
   into a component and its first linked instance; `Insert shared component` places it on another
   page; one edit updates both (one `seq`) with `Updated 2 instances of <component>.`;
   `Detach instance` keeps content and ids. A collection list repeats its template per entry, in
   entry order; script markup in rich text is removed with its text kept.
6. **Upload and publish** — brief: Journeys 6. `Uploading photo.png.` → `Uploaded photo.png.`
   (written to MinIO and read back first). `Place image` requires `Alt text`; focal sliders step 5
   (Shift 1, Home 0, End 100). `Publish now` → `Publishing Home.` → `Published Home at <url>.`,
   address `?page=<id>&panel=publish`, focus `#publish-state` = `Live`. Storage down: banner
   `File storage is unavailable. Your edits are safe; uploads and publishing are paused.`,
   `Couldn't publish Home. Nothing changed on the live page.`, `Try publishing again` appears;
   editing continues. Storage back → retry publishes. Owner `Unpublish` → `Unpublished Home.`,
   public address answers `This page isn't published.` (404).
7. **Viewer comments** — brief: Journeys 7. Invite link `/invites/<token>` → canvas in comment
   mode (`Comment mode. Ask <owner> for edit access.`). Select node, `M`, type `@<editor email> …`,
   `Post comment` → `Comment posted on <node>.`, focus on the thread's `Reply`. The editor sees the
   pin live; Mailpit holds `<viewer> mentioned you on <page>`. Phone: comments in a bottom sheet.
8. **Restore, then a visitor** — brief: Journeys 8. History lists
   `<version> · <author> · d Mon yyyy, HH:mm UTC`; a version opens at
   `?version=<id>&page=<id>` with `Previewing <version>. Restore it or go back to the latest.`;
   `Restore this version` → `Restoring <version>.` → every session hears
   `<name> restored <version>.`; undo reverts the restore exactly. A visitor at 375×812 reads the
   page without sideways scroll and opens `Menu`.

## Palette (hex the build uses)

| Role | Hex | Source |
|---|---|---|
| paper ground | `#F5F0E6` | brief: Visual design (warm off-white); hex decided: low-chroma warm |
| grid line (every 8 px) | `#E6DFD0` | brief: Visual design (barely darker than the paper) |
| ink | `#1D1B18` | brief: Visual design (near-black ink) |
| muted ink | `#5A544A` | decided: AA on stone (5.8:1) |
| stone panels | `#E8E1D3` | brief: Visual design (slightly darker warm stone grey) |
| hairline | `#CBBFA9` | brief: Visual design (single hairline) |
| frame / drafting film | `#FFFFFF` / `#FFFDF8` | decided: the page being built lies on the table |
| cobalt (selection, focus, current breakpoint, primary) | `#1D4ED8` | brief: Visual design |
| burnt orange (overridden pips, override dot only) | `#B8460B` | brief: Visual design |

## Type

| Use | Family | Size | Source |
|---|---|---|---|
| headings | Space Grotesk 500/700 | steps ×1.2 | brief: Visual design |
| body | IBM Plex Sans 400/500/600 | 13 px chrome, 16 px account screens | brief: Visual design; sizes decided (compact) |
| every px, rem, token value, seq, timestamp | IBM Plex Mono 400/500 | 11.5–12 px | brief: Visual design |
| published node defaults | heading Space Grotesk 700 h1 2.074rem / h2 1.728rem / h3 1.44rem; text 1rem/1.5 | | decided: same 1.2 ratio |

## Space and layout per viewport

| Width | Layout | Source |
|---|---|---|
| ≥ 1280 | top bar; Navigator 264 px | canvas | style panel 304 px; sheets over the style column | brief: Screens and layout |
| 768–1279 | Navigator drawer (starts closed, `inert` when closed); style panel docked under the canvas at full width; sheets full-height right | brief: Screens and layout |
| < 768 | Phone frame only, bottom toolbar `Preview tools` (Comments, Pages, Publish status), 44×44 targets | brief: Screens and layout |
| frames | 1280 / 768 / 375 px layout widths, scaled to fit, inside `#canvas` | brief: How Plinth is checked |
| spacing | 4 px unit on an 8 px rhythm; rows 28 px | decided: matches the grid, compact |

## Motion

| Element | Trigger | Duration | Easing | Reduced motion | Source |
|---|---|---|---|---|---|
| Cascade Fan | `F` / `Fan` | 420 ms (Phone starts 90 ms later), reverses from progress | fast start, soft settle (cubic out) | opens/closes in one frame; Updated tag | brief: Motion and effects |
| ripple | style set/clear with the Fan open | 160 ms `data-ripple` | out | none; `[data-updated-tag]` | brief: Motion and effects |
| pip pulse | kept override | 160 ms `data-pulse` | out | none | brief: Motion and effects |
| style panel | `Style panel` | 200 ms `data-motion`/`data-progress` | cubic out | jumps to end | brief: Motion and effects |
| published Menu | `Menu` | 200 ms | cubic out | jumps to end | brief: Motion and effects |
| toast | own notice | appears at once, hides after 4,000 ms | — | same | brief: Motion and effects |
| drawer, dialogs, sheets | open/close | instant | — | same | brief: Motion and effects |

## States per async action

| Action | Pending | Success | Failure | Source |
|---|---|---|---|---|
| upload | `Uploading <file>.`, input `aria-busy` | `Uploaded <file>.` | `Only PNG, JPEG or WebP images can be uploaded.` / `That image is over 5,000,000 bytes.` / `Couldn't upload <file>. File storage is unavailable.` + banner | brief: Feedback states |
| publish | `Publishing <page>.`, buttons `aria-busy` | `Published <page> at <url>.` | `Couldn't publish <page>. Nothing changed on the live page.` + banner + `Try publishing again` | brief: Feedback states |
| restore | `Restoring <version>.` | `<name> restored <version>.` (every session) | API message | brief: Feedback states |
| invitation | — | `Invitation sent to <email>.` | `Couldn't send the invitation. Try again in a moment.` | brief: Feedback states |

## Breakpoints

Desktop ≥ 1280 px, Tablet 768–1279 px, Phone ≤ 767 px; inheritance runs Desktop → Tablet → Phone;
published media queries `(min-width:1280px)`, `(min-width:768px) and (max-width:1279.98px)`,
`(max-width:767.98px)` (brief: Breakpoints).

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Space Grotesk 500/700, IBM Plex Sans 400/500/600, IBM Plex Mono 400/500 (woff2) | OFL-1.1 | Fontsource 5.3.0 (`app/assets.json`) |
| Lucide icon path data (inline SVG) | ISC | lucide-static 1.66.0 |
| drafting-square empty state, Plinth mark, grid | original | drawn in code |

## Disputes recorded

- `set_token` lists a field `kind`, which collides with the operation's own `kind`; the build
  derives the token kind from the value (a number with `unit` is a size token, a string a colour
  token) — brief: Business rules, Operations table.
