# TRUTH — Corbel Draft golden

Ground truth of the reference app. Every value says where it came from: `brief: <section>` (copied from
`instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flows)

### 1. Start an account (DP-01..05)
1. Visitor on `/` chooses `Start drafting` -> `/signup` (brief: Landing, Pages).
2. Fills `form "Create account"` (Name, Email, Password, Studio time zone default `UTC`) with the keyboard; `Creating account…` shows while pending (brief: Account). Empty submit shows `Enter your name (1 to 80 characters).`, `Enter a valid email address.`, `Use at least 10 characters.` under the fields; a taken address shows `An account with this email already exists.`.
3. Result: `/check-inbox` heading `Check your inbox`, `We sent a confirmation link to <email>.`. Mailpit holds one message, subject `Confirm your Corbel Draft account`, body `<public URL>/verify/<token>` (brief: Services). Postgres: `users` unverified, one `verify_links` row. If SMTP does not accept: `Confirmation email not sent. Mail is unavailable; try again shortly.` with `Send a new link`.
4. `/verify/<token>`: `Your email is confirmed.` + `Sign in`. After `VERIFY_LINK_SECONDS` (default 86400 s) on the server clock: `This confirmation link has expired.`; a newer link replaces older ones: `This confirmation link was replaced by a newer one.`; unknown: `This confirmation link is not valid.`.
5. `/signin`: wrong credentials -> `Email or password is incorrect.`; unconfirmed -> `Confirm your email address first. We sent a link to <email>.` + `Resend link`; after 5 consecutive failures (default) the address is locked for 900 s: `Too many attempts. Try again in <m> minutes.` (m = remaining minutes rounded up; 1 -> `1 minute.`).
6. Signs in -> `/drawings` with an empty My Drawings, `No drawings yet. Start one with New Drawing or Upload.`, `status "Trial"` `30 days left in your trial` (days counted in studio-zone calendar days from the confirmation date; `Your trial has ended` at studio midnight of day 30), `Welcome back, <first name>`.
7. `Get Pro for $12/month` opens `dialog "Corbel Draft Pro"` (`$12.00 per month. We'll email you a quote; there is nothing to pay here.`); `Email me a quote` shows `Sending quote…` then `Quote sent to <email>` only after Mailpit accepts; Mailpit has `Your Corbel Draft Pro quote` with `$12.00 per month`, `Q-<YYYYMMDD>-0001` and the studio date; no payment field exists.

### 2. Organise files (DP-06..09)
Signed-in drafter on `/drawings`: `New Folder` inserts an inline row (`New folder` selected); Enter creates it (Postgres `folders`), a duplicate name shows `A folder named "<name>" already exists.`; `Upload...` of a `.dxf` shows `Uploading <name>…`, then `Stored` once MinIO holds `drawings/<id>/v1.dxf` byte for byte; the same name again adds `v2.dxf` and shows `<name> updated to version 2.` plus `Imported <n> objects; skipped <k> unsupported objects.`; `Version history` lists `Version <n> · <date-time> · <actor> · <size>` and `Restore version 1` stores `v3.dxf` with identical bytes (`Version 1 restored as version 3.`). A phone signed in to the same account sees new folders, files and the Recent order within 2 s without reload (Valkey `account:<user id>` channel).

### 3. Draft an outline by keyboard (DP-10..13)
Blank drawing: `L`, `0,0`, `@6000,0`, `@0,4200`, `@-6000,0`, `C` saves four lines in one LINE command (one version, one Activity entry `LINE · 4 objects created`); `O` 200 offsets each wall inward; `TR` trims the eight corner tails; `REC` from the Ribbon adds a rectangle. `U`/`REDO` replay per actor (`Undo: RECTANG`, `Redo: RECTANG`); Activity lists each command; the API holds the exact inner outline (200,200 to 5800,4000).

### 4. Organise and annotate the studio plan (DP-14..32)
Seeded studio plan: properties edit in place (`End X` -> `Length`/`Angle` update), layers added/renamed/frozen/locked/unlocked from the Layers grid with the published announcements, a door inserted on the snapped wall midpoint (`Block Door 900 inserted at 3000.00, 0.00.`), walls dimensioned (`Dimension added: 6000.00`), Units to Meters reformats every value in place in every tab (stored geometry unchanged).

### 5. Issue a sheet (DP-33..38)
`Layout1` tab (`PAPER`, `1:50`), `Ctrl+P` opens the Export dialog; `PDF` of `Layout1` shows `Plan A-Layout1-1.pdf · Rendering…` then `· Ready` only after MinIO confirms `exports/<drawing id>/<export id>.pdf` (size matches), announcement `Export ready: Plan A-Layout1-1.pdf`. `Title block revisions` adds `Revision B` effective tomorrow; the first sheet keeps `REVISION A` byte for byte; an export on the next studio day shows `REVISION B` and its note.

### 6. Review on a phone (DP-39..42)
Drafter shares with a `Can mark up` link (Mailpit invite: subject `<drafter> shared "Plan A.dxf" with you`, URL, `Can mark up`, `Does not expire`). Reviewer opens `/s/<token>` on a 375x812 phone (`Mark-up only`), starts a trace, taps out a revision cloud with `RC`, adds a `T` comment, submits. Drafter's open tab announces `Trace "<name>" submitted by <reviewer>`, Mailpit has `Trace "<name>" submitted on Plan A.dxf`, the trace plays back (strokes draw in under 1 s), the base drawing version and objects are unchanged, the comment is Issue `#1`.

### 7. Edit together (DP-43..47)
Drafter and an `Can edit` collaborator both open the plan; one moves a wall; the other sees `Changed <handle>` redraw over 0.9 s with grips held 1.2 s; `Synced · v<n>` matches in both; stale edits open `alertdialog "Edit conflict"`; an idle collaborator shows `<name> · Away` after `PRESENCE_IDLE_SECONDS` (120) on the server clock.

### 8. Control a link (DP-48..52)
View link with expiry date: `Expires <MMM D, YYYY>, 11:59 PM (<IANA zone>)`; recipient measures with `DI` (`Distance = 6000.00, ... (millimeters)`) and every edit is refused (`This drawing is view-only.`, API 403 `view_only`); at 23:59:59 studio time the open tab turns into `This link has expired.`; revoking another link turns its tab into `This link was revoked by the owner.`.

## Palette roles (brief: Visual design > Colour roles; hexes: decided from `seed-reference/inventory.md`)

| Role | Hex |
|---|---|
| Ground | #000000 |
| Surface (charcoal) | #3C3C3C; deep #262626 (decided: second charcoal step for dense editor panels) |
| Ink | #FFFFFF |
| Muted ink | #CCCCCC |
| Line | #8C8C8C |
| Link accent / focus ring | #5BC8F5 |
| Vertex accent | #E8114F |
| Canvas | #1E2733 |
| Glyph colours | #2F67A6 (blue), #F2B428 (yellow) |

## Type (brief: Type; sizes decided from the inventory)
Fira Sans only, self-hosted woff2 (400 body, 500 labels/buttons, 700 headlines, 800 `CORBEL`). Hero headline 64px/70px (44px/52px at 375), h2 34px, h3 27px, h4 22px, body 14px/21px, tabular figures everywhere (`font-variant-numeric: tabular-nums`).

## Space and layout per viewport (brief: Screens and layout)
- 1280x800: landing container 80vw starting at 10vw, hero 45/55 split; dashboard sidebar | table | Welcome; editor panel about a fifth, canvas fills the rest.
- 768x1024: hero stacks, band keeps three columns, splits stack media first; dashboard Welcome drops below the table; editor Ribbon wraps to two rows, active panel overlays the canvas's left edge (closes with Escape or a second tab click).
- 375x812: one column with 11vw side margins; stacked full-width hero buttons; band in rows; header icon only; dashboard sidebar in `dialog "Files menu"`, table Name + Date Modified only; editor `File actions` menu, `Tools` and `Panels` bottom sheets, command line fixed above the keyboard.
- No horizontal scroll at 375, 768 or 1280.

## Motion table (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Hero wireframe path | page load | 0.9 s, 0.04 s stagger per path | cubic-bezier(0.22,1,0.36,1) (decided: fast start, gentle settle) | fully drawn on first paint |
| Endpoint grip | its path completes | 0.16 s scale 0->1 | same | shown |
| Constellations | first scroll into view, once | 0.9 s per line, 0.04 s stagger | same | fully drawn |
| Sticky header in | hero buttons' bottom edge crosses viewport top | 0.2 s, opacity + translateY(-8px->0) | settling | appears at once |
| Sticky header out | buttons return | 0.15 s | accelerating | disappears at once |
| `Changed <handle>` | change from another tab/person | 0.9 s, 0.04 s stagger per object | draw-in easing | shown at once |
| `Grip <handle>` | with the change | pop 0.16 s, hold 1.2 s, fade 0.2 s, removed | draw-in easing | shown 1.2 s then removed |
| `Trace stroke <handle>` | opening a submitted trace | 0.5 s each, 0.04 s stagger (last starts by 0.4 s beyond 10 strokes) | draw-in easing | all shown at once |
| Buttons/links | hover, press | 0.15 s | ease | none |
| Drafting demo | `Play drafting demo`, once | about 4 s (decided) | ease-in-out | final frame |

## States per async action (brief: Pending, success, error and outage per async action)

| Action | Pending | Success | Error | Outage |
|---|---|---|---|---|
| Create account | `Creating account…` | Check-inbox page | field errors | `Confirmation email not sent. Mail is unavailable; try again shortly.` |
| Sign in | `Signing in…` | `/drawings` | refusals in the form `alert` | n/a |
| Send a new link | button disabled | `A new link is on its way to <email>.` | n/a | mail copy |
| Email me a quote | `Sending quote…` | `Quote sent to <email>` | n/a | `Quote not sent. Mail is unavailable; try again shortly.` |
| New Folder | row dimmed | row stays | folder errors | n/a |
| Upload | `Uploading <name>…` | `Stored`, update/import copy | type/size errors | `Upload failed: file storage is unavailable.` |
| Restore version | button disabled | `Version <n> restored as version <m>.` | n/a | storage copy |
| Base edit | `Syncing…` | `Synced · v<n>` | `alertdialog "Edit conflict"` / `Conflict · v<n>` | `Live sync paused` |
| Export | `Rendering…` | `Ready` + download link | n/a | `Failed` + `Export failed: file storage is unavailable.` |
| Send invite | `Sending invite…` | `Invite sent to <email>` | field errors, cooldown | `Invite not sent. Mail is unavailable; try again shortly.` |
| Submit trace | `Submitting…` | `Submitted`, `Notice sent` | n/a | `Notice not sent` |
| DIST | prompt | DIST line + announcement | `Invalid point.` | link page on expiry/revocation |

## Breakpoints
375 (phone), 768 (tablet), 1280 (desktop); landing container rules start at 1024 (decided: inventory 10vw/80vw system).

## Media and licences
Everything is drawn in code (SVG/CSS/HTML): roof shell wireframe, three-device preview, capability icons, demo, editor preview, slab backdrop, constellations, document glyph, logo, empty-state sketches (licence `original`). Icons: Lucide (`lucide-react`, ISC). Font: Fira Sans (`@fontsource/fira-sans`, OFL-1.1, woff2 files listed in `assets.json`). No photographs, no video, no audio.
