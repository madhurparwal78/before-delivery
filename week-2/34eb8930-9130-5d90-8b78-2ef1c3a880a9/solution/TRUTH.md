# TRUTH — Quillmere Drafts golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (start state → actions → visible and recorded end state)

1. **Set up a proposal** (brief: Journeys 1). Signed out at `/sign-in` → sign in as ines@quillmere.test →
   `/` with Recent and My proposals → type in Search proposals (Search results replace the lists,
   announcement "<n> proposals" a third of a second after typing stops) → New proposal (Title, Client,
   Create; button reads "Creating") → `/d/<id>` → Share → add Tomas as Editor, Dana as Viewer, Priya as
   Commenter with "Set an end time" (announcement "Shared with <name> as <Role>" each). End: People with
   access lists all three with role and email, Priya "Until <date and time>"; `shares` rows active;
   three `shared` notices; each grantee's open home gains the row without a reload (`lists_changed`).
2. **Co-write live** (Journeys 2). Two editors type; each keystroke is applied locally at once and sent
   as an op frame; the server transforms it past later revisions and fans it out; remote carets show
   name labels; word count updates; save status Saving → All changes saved after the `saved` frame for
   the latest revision. Recorded: one `ops` row per revision, body object `documents/<id>.json` at that
   revision. Outage: status "Not saved" plus alert banner "Your latest edits are not saved. Quillmere
   can't reach storage and is retrying."; edits still reach other screens.
3. **Suggest and comment** (Journeys 3). Suggesting mode inserts (underlined, author colour), deletes
   (struck, text kept) and replacements (delete+insert pair) become credited `suggestions` rows with
   cards "Insert “…”", "Delete “…”", "Replace “a” with “b”". A Commenter's text inside another
   suggestion is a separate suggestion. Comments with @mentions create `mention` notices.
   Replace all in Suggesting creates one replacement per match ("Suggested <n> replacements").
4. **Settle the cards** (Journeys 4). Accept/Reject buttons, Enter on a focused card, Alt+Shift+Arrow
   cycling, Accept all/Reject all alertdialogs naming the count. First decision wins inside the
   per-proposal queue; later ones answer `applied:false` with the winning status, no error on screen.
5. **Change a role mid-session** (Journeys 5). Owner sets Access for Tomas to Commenter → Tomas's
   editor gets `role_changed` {role, mode:"suggesting"}, radio Suggesting checked, Editing disabled,
   announcement "Your access changed to Commenter. You're now suggesting."; next keystroke is a suggestion.
6. **End a review** (Journeys 6). Expiry sweep every 200 ms on the server clock marks the share
   `expired` and sends `access_ended` {reason:"expired"}; removal sends "removed"; deletion removes the
   body object, then rows, then sends "deleted" to every open tab. Screens: heading "This proposal is
   no longer available" with the reason alert and "Back to documents".
7. **Review from the keyboard** (Journeys 7). Outline listbox (Up/Down/Home/End/Enter), card cycle,
   native radio group, find dialog (Ctrl+F, count, Match i of n, Tab trapped, Escape returns focus).
8. **Review on a phone** (Journeys 8). Toolbar menu, numbered marker chips, Comments and suggestions
   bottom sheet, 44 px targets, no sideways scroll.

## Palette (decided values in the brief's roles; brief: Visual design)

| Role | Hex |
|---|---|
| desk (warm light stone) | #E4DDD0 (deep #D8CFBF) |
| sheet (warm off-white) | #FCFAF5 |
| ink | #24201B, muted #5A5248 |
| spruce (actions incl. the filled Share button, links, focus, checked radio) | #1F5A48 |
| brick (alerts, storage banner) | #A23B2A |
| author colours: deep spruce / plum / slate blue / ochre / rust / indigo / magenta | #1F5A48 / #7A2E63 / #3F5A8A / #7A5000 / #A2461C / #3B3C9A / #A3216F (all ≥ 5.9:1 on the sheet; decided: AA as the brief requires) |

## Type, space, layout

- Headings Newsreader 600; body Source Serif 4 400/700, 1.125rem, line height 1.55; steps ×1.2
  (1.125 → 1.35 → 1.62 → 1.944 → 2.333rem); measure 68ch (brief: Type).
- Chrome in `all-small-caps` (brief: Type). The editor menu bar stays one row at ≥ 1200 px: with three or more people here each chip shows initials and role, the name kept as visually hidden text; idle chips keep full colour with a dashed ring plus the word Idle (decided: AA on chips, brief: Author colours). Focus 2 px solid spruce, offset 2 px (brief: Targets and focus).
- ≥ 1200 px: outline rail 184 px | page ≤ 680 px | margin 300 px, gaps 28 px (decided: fits 1280).
  768–1199: page | margin 252 px, Outline button opens a panel over the left edge.
  < 768: single column, Toolbar menu button, bottom sheet, marker chips, 44 px controls (brief: Layouts by width).
- Cards: left 28 px inside the margin, 8 px stacking gap, tether 1 px (2 px focused) in author colour (brief: Motion).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| card `translate` −24 px, tether stroke 2 px, wash: the author hue at oklch lightness .93 (chroma ×.4) → .87 (chroma ×.6), so warm hues stay a tint, not beige | card focus | 200 ms | cubic-bezier(.2,.8,.2,1) | applied at once |
| accepted insertion `color` author → ink | card_closed accepted | 250 ms | same | ink at once |
| settled card `height`/`opacity` → 0; cards below `transform` FLIP glide, tethers redrawn each frame | card_closed | 333 ms after 250 ms | same | removed at once, jump |
| new card `opacity` | card added | 200 ms (@starting-style) | same | none |
| bottom sheet `transform` | open / close | 333 ms | same | none |
| button `background-color` | hover / press | 120 ms | ease | none |
Reflow moves cards and tethers in the same frame with no animation (brief: Reflow).

## States per async action (brief: Feedback states)

Sign in "Signing in" / 401 alert "That email and password don't match."; Create "Creating" / 422
field messages; Add person "Adding" / 409 "This person already has access."; Delete "Deleting" / 503
alert "Quillmere can't reach storage, so the proposal wasn't deleted. Try again in a minute."; Accept
all "Accepting" / Reject all "Rejecting"; Post "Posting"; announcements exactly as the brief's table.
Connection lost: alert "Connection lost. Reconnecting.", page read-only until rejoin.

## Decided behaviour where the brief is silent

- Decisions and replace all reach screens as an `op` frame (editing-mode deletes, possibly empty) sent
  to every joined socket, then `card_closed`; every revision produces one op frame (decided: other
  screens must converge on the text a decision changes).
- Typing inside another author's suggestion creates a separate insertion suggestion credited to the
  typist, and leaves the other suggestion's credit intact; in editing mode, typed text never becomes
  part of a suggestion's credit (brief: Business rules, Suggestions). Made concrete (decided: a range
  is one `{"at","length"}`, so these keep each person's text under their own credit):
  - Suggesting mode: the typist's text is its own insertion suggestion nested in the other one,
    which stays one suggestion with its id, author and card. Accepting or rejecting the other
    suggestion acts on its author's text only; the nested open suggestion's text is left for its
    own card. Accepting the nested suggestion keeps its text as plain text (brief: Business rules,
    Suggestions, "Accepting an insertion keeps its text as plain text"): it counts in the word
    count, and the other suggestion is split around it exactly as in Editing mode below, so
    rejecting either part later never removes the accepted text. Accept all settles a suggestion
    before any suggestion typed inside it, so it never splits a card it is settling.
  - Editing mode: the other suggestion is split at the typing point, so the direct text is outside
    every suggestion's range. It keeps its id for the part before the typed text (for a
    replacement's struck half, the part after, so its struck and inserted halves stay together);
    the rest becomes a sibling suggestion credited to the same author with its own card. Rejecting
    either part never removes the Editor's text.
- Bold, italic and underline extend when typing right after marked text; links do not (decided:
  common editor behaviour).
- Server replays each other person's last caret right after `joined` (decided: carets moved before a
  page joined must still show, DP-12).
- While anyone has a proposal open, the server keeps serving its live body. When nobody has it open,
  opening it (snapshot or join) reads its object and rebuilds the body from that object plus the ops
  recorded after it; if that object is needed and storage is unreachable, the snapshot answers 503
  `storage_unavailable` (brief: Rebuilding a proposal). A proposal nobody has open stays in memory only
  to keep retrying its pending write (brief: Failures), never to serve a later open (decided).

## Breakpoints

767.98 px and 1199.98 px media queries only (brief: these widths are exact).

## Media and licences

Newsreader and Source Serif 4 (OFL-1.1, Fontsource 5.3.0 / 5.3.1), Lucide path data (ISC), favicon and
quill drawing (original). Listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`.
