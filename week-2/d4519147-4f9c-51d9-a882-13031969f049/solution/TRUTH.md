# TRUTH — Plumbline Labs Scopewright golden

The brief made concrete. `brief:` values are copied verbatim from `instruction.md`; `decided:` values fill silence in
the brief's intent.

## Journeys (ideal end-to-end flow)

1. **Engineer redraws a data flow from the keyboard** (brief: Journeys 1). Start: Ravi signed in on Account data
   flows (`/d/5c0f3e2a-…4e01/p/5c0f3e2a-…4e12`), view 100% at canvas 0,0. Tab to `Add API service`, Enter: a 144×72
   `API service` shape centred on the canvas pane and snapped to 24 (at 1280×800: x 288, y 336), selected and focused.
   Shift+Arrow nudges 24 units; crossing the CDE edge plays the boundary tally and announces
   `API service moved into Cardholder Data Environment. 4 systems, 5 crossings.` C, Tab to Card vault, Enter:
   `Connected API service to Card vault.` (closest ports e→w, elbow route). Enter on the connector focuses the
   inspector `Label`; typing + Enter stores it and returns focus. Space / Shift+Space / Ctrl+G groups with Payment
   API; Shift+Space Settlement batch; Alt+Shift+Left aligns left edges (group rigid); Ctrl+] announces
   `2 shapes brought forward.`; Ctrl+D then Ctrl+Z. Saves chain one at a time with the returned version (never a
   409 from its own saves); after reload the tallies equal the server's derived values.
2. **Engineer moves systems and zones across the boundary** (brief: Journeys 2). Dragging Fraud screening by
   (288, −144) units drops it at 888,456 inside the CDE; Risk score reroutes as an elbow inside the zone; tally plays;
   announcement `Fraud screening moved into Cardholder Data Environment. 4 systems, 4 crossings.`; Lee (viewer) sees
   the same tallies and chevrons. Undo plays the sequence in reverse and announces
   `Fraud screening moved out of Cardholder Data Environment. 3 systems, 5 crossings.` Shift+Right on Connected-to
   systems moves it to x 72 carrying Checkout web app and Admin workstation; no member set or crossing count changes
   (markers move, nothing announced). A second Shift+Right would touch the CDE: refused whole, `Zones can't overlap.`
3. **Compliance lead shares by keyboard** (brief: Journeys 3). Share dialog: `Email`, `Role`, `Send invitation`,
   then rows. The 10-second refresh updates rows in place (keyed by share id) without touching typed text, role,
   errors, an open confirm or focus. Sending creates an `invited` share, queues the mail in the same transaction and
   delivers it at once (Mailpit receives `You have been invited to a diagram on Scopewright`). ArrowDown on
   `Role for jo…` sends one PATCH and announces `Access updated for <email>.`; Jo's next save is 403 → downgrade
   banner, `Read only`, Add disabled, no further saves; Jo receives exactly one access-changed notice. `Remove access`
   opens on `Cancel`; Escape returns focus to the row's Remove button. Audit lists `share.invited`, `share.accepted`,
   `share.role_changed`.
4. **Assessor reviews on a tablet** (brief: Journeys 4). Signed-out deep link → `/signin?next=%2Fd%2F…` → after sign
   in, the same address. One finger pans; two fingers zoom about the midpoint (25–400%). Inspector drawer lists
   `Systems in Cardholder Data Environment` (3) and five flow items ending `, entering`/`, leaving`. Files dialog links
   go to `/api/diagrams/…/files/png` or `/imports/…/original` → 303 → `/api/downloads/<token>` (bound to Lee, 60 s,
   attachment). Another merchant's id shows `Diagram not found` with HTTP 404.
5. **Engineer imports a legacy diagram** (brief: Journeys 5). `Importing legacy-scope.xml...`, button
   `Importing...` disabled; on 201 the dialog closes, tab `Imported legacy-scope.xml` is added, selected and focused,
   the address changes, `Imported legacy-scope.xml as a new page.` Original bytes at `imports/<d>/<i>/original` with
   sha256 shown in Files. A file with `&#x6A;avascript:` in an href → 422 `unsafe_file`; error under the file input
   (its description), focus back on the input, nothing stored.
6. **Dated export set** (brief: Journeys 6). Create export adds a `Preparing` row; on 201 the row becomes `Ready`
   with three files (size in bytes, lowercase sha256) and `Download PNG/SVG/JSON`; `Export ready.` announced. With
   storage down: edits save, banner `File storage is unavailable. …`, export answers 503 and the list shows `Failed`
   with `Export failed. File storage did not confirm the files.`
7. **Session ends mid-edit** (brief: Journeys 7). An expired session answers 401 `session_expired`; the editor keeps
   the request (page body / Idempotency-Key / file bytes) and opens `Sign in to continue` on `Password`. Timers never
   close it or clear it; failures show in its `alert`, lockout included. On success each kept request is resent once
   with the new CSRF token. Password change ends every session and issues a new one to the tab that made it.
8. **Invitation while mail is down** (brief: Journeys 8). Double-click Send: one share (`Sending...` disables the
   button), row `Not yet delivered`. Every instance retries queued mail every 5 s (claim lease 60 s, `FOR UPDATE
   SKIP LOCKED`); once delivered the row turns `Invited` in place and `Invitation delivered to <email>.` is announced
   once.

## Palette (brief: Visual design, Exports)

| Role | Hex |
|---|---|
| paper ground | #F3F0E8 (243,240,232) |
| ink | #16202E (22,32,46) |
| scope red (CDE only) | #C8323F (200,50,63) |
| teal connectors | #2B6F77 (43,111,119) |
| hairline (decided) | #BFB7A8 |
| ink-muted (decided) | #4A5361 |
| dot grid (decided) | #C2B9A8 |

## Type, space, layout

- Type (brief: Type): IBM Plex Sans Condensed 600 headings (h1 24, h2 20, h3 16.7 px), IBM Plex Sans 400/600 body
  14 px, IBM Plex Mono tabular numerals. Self-hosted woff2.
- Space (brief: Density): 8 px rhythm, controls ≥ 44×44, 1 px hairlines, no shadows.
- 1280×800 (≥1200): 56 px top bar; 240 px library rail | canvas | 300 px inspector (brief: Editor layouts); the canvas
  fills all remaining space (brief: Screens and layout, Canvas). 768×1024 (768–1199): two-row top bar (decided), 208 px rail, canvas, inspector as a 360 px
  full-height drawer from `Inspector`. 375×812 (<768): top bar (icon link, title, save state, Files/Share icons) +
  scrolling tab strip; canvas filling the whole space between the page strip and the bottom toolbar (brief: Editor
  layouts); bottom toolbar Shapes/Inspector/Undo/Redo/Save; library = 60% bottom sheet; inspector = full-screen
  drawer; no zoom controls, Zoom level or Import rendered. At every size the Announcements status line takes no
  layout space: it overlays the canvas foot, passes pointer and touch input through, and is transparent while empty
  (decided: the brief requires the region in the editor and a canvas that fills all remaining space).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| connector morph | qualifying edit | 200 ms | ease-out cubic | redraw at once |
| new crossing markers | after morph | 35 ms apart (≤12 staggered), 120 ms pop | ease-out cubic | all at once |
| removed markers | during marker step | max(150 ms, stagger) fade | linear | gone at once |
| tally digits | after markers | 320 ms roll | ease-out cubic | switch at once |
| undo/redo | — | roll → markers (right-to-left) → morph | — | at once |
| dialogs / drawer / sheet | open | 240 ms fade / slide | ease-out cubic | appear at once |

All graded motion runs on `requestAnimationFrame` + `performance.now()` (decided: follows the page clock). The
announcement is placed when the sequence ends (≤ 1.025 s), or immediately under reduced motion.

## States per async action

| Action | Pending | Success | Errors | Outage |
|---|---|---|---|---|
| page save | `Saving...` | `Saved` | `Not saved` + generic or conflict banner | edits still save |
| export | `Preparing` row | `Ready` + `Export ready.` | — | 503 → `Failed` row + storage banner |
| import | `Importing <file>...` / `Importing...` | `Imported <file> as a new page.` | too large / wrong type / unsafe / invalid copy under the input | storage banner, dialog open |
| share send | `Sending...` | `Invitation created for <email>.` | email field errors | `Not yet delivered` |
| password change | button disabled | `Password changed. Your other sessions were signed out.` | field errors | lockout `alert` |

## Server decisions

- brief: Invitation tokens and limits: each token carries at least 128 random bits, encoded as base64url; only its
  SHA-256 is stored, and the raw token appears in no database column, audit event or server output, only in the email
  and the link.
- decided (how the token is made, so any instance can deliver a queued invitation, brief: Queued mail): the token is
  the base64url HMAC-SHA256 of a fresh 256-bit random seed under a key derived from the deployment's environment
  secrets. The share row holds the token's SHA-256 and, until delivery, the seed; no column holds the token. The seed
  is erased when the invitation is delivered, accepted or withdrawn.
- decided: diagram deletion is a soft delete (`deleted_at`) so audit events stay append-only.
- decided: the export PNG is an 8-bit palette raster drawn row by row; text is omitted (brief: "Text in the PNG is
  optional").
- decided: malformed JSON answers 422 `validation` with `fields.body` at the validation step.

## Media and licences

Fonts IBM Plex (OFL-1.1, Fontsource 5.3.0). Icons, empty-state drawings, favicon: original inline SVG. No photos.
