# Fenwick Science Centre Clearhouse

Build Clearhouse, the internal clearance desk where Fenwick Science Centre staff check every small interactive exhibit before it reaches the centre's public wall. Makers draft pieces that reuse cut-out objects from a catalogue of 20000 public domain objects. Two different reviewers check each piece, one for licensing and one for accessibility. A clearance lead clears the piece against a quarter budget, books it onto one calendar day, publishes it and can later withdraw it. An auditor reads all of it without being able to change anything. Visitors see published pieces on a public wall, and each piece has a plaque that names its sources. Every decision is stored in the `postgres` database the environment provides. Staff identity comes from the Keycloak identity provider the environment provides. The app exchanges credentials server-side and issues its own sessions, which it also stores in `postgres`. Out of scope: signup, password reset, invitations, email, notifications, payments, comments, realtime channels, any other datastore, and any request from the browser to another host.

## Problem and users

The centre lets staff build small interactive exhibit pieces from cut-out objects in a large source catalogue. Every object carries a licence name, a licence address and an attributed artist. Putting an object on a public wall without the right to reuse it is the mistake that costs an institution money and trust. So does putting up a piece that a keyboard user or a colour-blind visitor cannot use. Today these checks happen in hallway conversations and spreadsheets, and nobody can later prove who checked what. For the centre, the clearance itself is the product. It must record, permanently and unchangeably:

- who submitted a piece;
- who checked its licensing;
- who checked its accessibility;
- who cleared it;
- which day it was featured;
- who took it down, and why.

The five staff roles and their goals:

- **Maker** (weekly): draft an exhibit piece, cite catalogue objects for it, and submit it for clearance. Revise it when it comes back.
- **Licence reviewer** (daily): confirm that every cited object is licensed for reuse, and acknowledge every flagged look-alike duplicate before passing.
- **Accessibility reviewer** (daily): confirm that a piece works by keyboard and for people who cannot tell its colours apart. They must be able to do the whole review by keyboard themselves.
- **Clearance lead** (daily): clear a piece or return it, book a cleared piece onto a free day, publish it, and withdraw it with a reason, all without overspending the quarter budget.
- **Auditor** (monthly): read every staff surface and the audit trail and export the trail, without being able to change anything.

Visitors are anonymous and see only the public wall and the plaques.

## Journeys

1. **Submit a piece.** *Start:* Rosa Aldridge, a maker, is signed in on the queue.
   - She presses `New piece`, types a title and a summary, and saves.
   - She opens the picker with `Add object`, cites four objects from the catalogue, and presses `Submit for clearance`.

   *End:* the piece's state chip reads `submitted`, it has left her `Needs my decision` list, and it now appears in both reviewers' `Needs my decision` lists.
2. **Review it twice.** *Start:* Priya Raman, a licence reviewer, finds Rosa's `submitted` piece in her `Needs my decision` list and opens it.
   - She presses `Start review`, and the piece moves to `in_review`.
   - She follows a cited object's `View` link, finds a look-alike marked as a possible duplicate, and presses `Acknowledge`.
   - She returns to the piece and records the licence review as passed. A decision stamp lands on the piece.
   - Dan Whitlock, the accessibility reviewer, opens the piece from his `Needs my decision` list and does his whole review by keyboard: he tabs to `Record accessibility review`, chooses `Pass` in the dialog, saves, and focus returns to the desk.

   *End:* both review marks read `Passed`, and the piece is in Halima Osei's `Needs my decision` list.
3. **Clear, book and publish.** *Start:* the identity provider was briefly down this morning. Halima, the clearance lead, saw the honest outage message on the sign-in page. She signs in once the provider is back, and nobody restarted the desk.
   - She opens the twice-passed piece and presses `Clear for the wall`. The committed total on `/budget` rises by the piece's fee.
   - On `/schedule` she activates a free day and picks the piece.
   - Once that day arrives, she presses `Publish now`.

   *End:* the piece's card is on `/wall`, its plaque lists every source, and the public count of pieces cleared today has risen by one.
4. **Return, revise and review again.** *Start:* a piece is in review.
   - Halima presses `Return for changes` and types a reason.
   - Rosa presses `Revise`, and the piece is back in `draft` with both review marks reading `Not yet`.
   - Rosa resubmits. Priya must acknowledge the flagged duplicates again before her licence review can pass.

   *End:* the audit trail shows every step of both rounds.
5. **Withdraw.** *Start:* a piece is on the wall.
   - Halima presses `Withdraw` and gives a reason.

   *End:*
   - The card has left `/wall`, and the plaque answers the not-found page.
   - The booked day is free again.
   - One new audit row carries the reason.
   - The public count of pieces cleared today has not moved.
6. **Audit a month.** *Start:* Gregor Pyne, the auditor, is signed in.
   - He opens a piece by its address and reads everything on it. The page offers him no action.
   - He filters `/audit` to one piece and presses `Export CSV`.

   *End:* he has a spreadsheet-safe file of exactly the filtered rows, and nothing he did changed any stored record.
7. **Keep makers' drafts private.** *Start:* Rosa is signed in. Tobias Lund, another maker, has a draft with a history.
   - Rosa can reach Tobias's draft by no route: not its address, not the queue counts, not the audit trail, not the export.

   *End:* to Rosa, that draft does not exist. When Tobias submits it, Rosa can see it like any other piece.

**Information architecture.** The queue is the centre of the staff side. Every piece is reached from it, and the piece desk is where state changes. The catalogue is the supply side. The schedule, the budget and the audit trail show what clearing a piece costs in days, money and accountability. The wall and the plaque are the public side, and they show only published pieces.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Deployment and health** The app serves from its run manifest on `0.0.0.0` at `APP_PUBLIC_PORT`, answers `GET /api/health` with `200` and the health body the API section defines, including its `identity` key, and answers every page and API route whatever host name the request carries.
- **DP-02 — Server-rendered surfaces** Every staff surface and both public surfaces answer their own address with their headings, copy and data already in the first HTML response, and every staff route opened without a session redirects to `/login`.
- **DP-03 — Sign in** `POST /api/auth/login` exchanges a seeded work email and passphrase with the identity provider server-side and returns the app's own opaque `access_token`, and `GET /api/auth/me` answers `{ id, email, name, role }` with the role the seed gave that account.
- **DP-04 — Sign out** `Sign out` and `POST /api/auth/logout` end the session server-side, so the revoked token is refused on every later read and write.
- **DP-05 — Credential refusal and lockout** Every failed sign-in gets the same status and byte-identical body whether or not the email belongs to an account, and the fifth failure for one trimmed, lower-cased email within the lockout window locks that email out, as qualified in Business rules.
- **DP-06 — Sign-in redirects** A staff route opened without a session redirects to `/login?next=<PATH>`, `next` is honoured only for a same-origin path beginning with a single `/`, and the public wall and plaque never redirect.
- **DP-07 — Role permissions and draft privacy** Every write is checked server-side against the role table and refused with `403` when the role may not act, every signed-in role reads every staff surface, and a maker naming another maker's draft on any route gets `404`.
- **DP-08 — Auditor read-only** An `auditor` opens every piece by its id but is refused every write with `403`, its own preferences being the one exception, and no refused write changes anything stored.
- **DP-09 — Own-piece rule** The account that created a piece may not record either review on it, clear it or publish it, refused with `403` and the own-piece message, and the refusal writes nothing.
- **DP-10 — Second-reviewer rule** The account that recorded a piece's licence review may not record its accessibility review, refused with `403` and the second-reviewer message, while a different accessibility reviewer may.
- **DP-11 — Citation checks** Submitting a piece that cites no object, or cites an unusable object, is refused on `object_ids` with one line per offending object naming one of the three pinned reasons.
- **DP-12 — Duplicate acknowledgement** A licence review cannot pass while any flagged duplicate of a cited object is unacknowledged in the current review round, and each acknowledgement is stored once with who made it, for which piece and when.
- **DP-13 — Legal steps** A piece moves only along the rows of the state table, each successful step raising `version` and appending exactly one audit entry, with `Import pack` as the one stated exception that creates pieces directly in a state.
- **DP-14 — Illegal steps** Any step or `action` value outside the state table is refused with `409` and the illegal-step message, leaving the piece and the audit trail unchanged.
- **DP-15 — Revision resets the round** Revising a piece back to `draft` is the owning maker's step alone and discards both review records and every duplicate acknowledgement for that piece, so the next round starts from nothing.
- **DP-16 — Version conflicts** A write carrying a stale `version` answers `409` with the current piece, and two decisions sent from one version, including a licence and an accessibility review at the same moment, end in exactly one success and one conflict.
- **DP-17 — Field rules** Titles, summaries, fees and reasons outside their ranges are refused on their field and store nothing, and every money value is held as a whole number of cents.
- **DP-18 — Clearance queue** `/` lists every piece this account may see with its state chip and both review marks, counts the nine states over those pieces, searches, sorts, pages at the account's `Rows per page` and states the result line.
- **DP-19 — Needs my decision** The `Needs my decision` filter answers each role exactly the pieces Business rules gives it to decide, and nothing for an auditor.
- **DP-20 — Decision rail** The piece desk offers only the actions this account may take from this state, leaving every other action absent rather than disabled, and `New piece` is rendered only for a maker.
- **DP-21 — Catalogue walk** `GET /api/objects` pages by cursor against a seed so a full walk returns every matching object exactly once before it reports `wrap`, the same seed and cursor always rebuild the same board, and a new seed only reorders it.
- **DP-22 — Catalogue board** `/catalogue` draws each object at its own stored proportions between 48 and 220 pixels on its longer side, as a control named by its title that lifts and reveals its artist and licence on hover or focus.
- **DP-23 — Duplicate check** `GET /api/objects/{id}/similar` scores each pair from 0 to 100, the same in both directions and on every call, ordered highest first then by ascending id, and the object detail lists those objects below its record.
- **DP-24 — Featured schedule** At most one piece holds any UTC calendar day even when two bookings arrive at once, a taken day is refused with `409` and a past day is refused, as Business rules sets out.
- **DP-25 — Plaque visitor count** A plaque raises its booked day's visitor count by one the first time it is opened in a browsing session, and the schedule's `Today` panel states that count.
- **DP-26 — Public wall** `/wall` needs no session and shows only published pieces, most recently published first, as cards linking to `/wall/<PIECE_ID>`, which answers 404 unless that piece is published.
- **DP-27 — Plaque** The plaque gives each cited object's title, artist, licence name and licence address under `Sources`, the maker under `Credits`, and ends with the cleared line naming the date and the lead.
- **DP-28 — Committed budget** Committed is the summed fee of every piece in `cleared`, `scheduled` or `published` whose `cleared_at` falls in the quarter, and a clear that would take committed above the budget is refused with `409` naming the exact overspend, even when two clears arrive at once.
- **DP-29 — Fee adjustment and reset** A lead adjusts a fee through the number field, the `x10`, `x100` and `x1,000` buttons and `Apply`, and `Reset quarter` asks for confirmation before returning every fee in the quarter to its submitted value, neither ever taking committed above the budget.
- **DP-30 — Audit trail** The trail is append-only, filters by piece, actor, to-state and date range, pages at the account's `Rows per page`, and `Export CSV` downloads the filtered rows quoted and made spreadsheet-safe as the CSV rules state.
- **DP-31 — Preferences** Each account's `Rows per page`, `Date display` and `High contrast` default to 50, `relative` and off, save at once into one row per account, and survive signing out and back in.
- **DP-32 — Clearance pack** `Export pack` returns every piece as one document, and `Import pack` applies a clean pack completely or refuses a bad one with its pinned message while writing nothing at all.
- **DP-33 — Persistence** Every piece, review, acknowledgement, booking, fee, session and audit entry lives in `postgres` and survives a reload, a restart and the seed path running again unchanged.
- **DP-34 — Responsive layout** The queue becomes stacked cards at or below 600 pixels, the wall steps from one to four columns at 600, 800 and 1300 pixels, the queue shows `Fee` and `Updated` above 1000 pixels, and nothing scrolls horizontally from 320 pixels up.
- **DP-35 — Accessibility** Pages meet WCAG 2.2 AA, a whole review including its dialog can be done by keyboard alone with a visible focus ring on every control, dialogs trap focus, close on `Escape` and return focus, every drawn cut-out and icon-only control carries its published name, and no status rests on colour alone.
- **DP-36 — Motion** The decision stamp and the wall card entry are browser-native animations with the timings Motion and effects gives, and under the reduced-motion setting both become instant with all content kept.
- **DP-37 — Self-contained build** The app ships its own stylesheet with no utility-class framework or fingerprint, draws every picture, links nowhere off-site, and its pages make no browser or asset request to another host.
- **DP-38 — Public chrome** The public pages carry the tagline, the footer line and the count of pieces whose first clearing fell on the current UTC day, which never moves on an unschedule or a withdrawal.
- **DP-39 — List failures** A list whose request fails shows the list-failure message with a `Try again` control while the rest of the page keeps working.
- **DP-40 — Surface copy** Every pinned label, empty-state sentence, count line and pager line appears on the surface this brief places it on.
- **DP-41 — Paper and sheets** The light field is a near-white paper neutral with every card, panel and dialog on pure white above it, near-black ink for primary text and a mid cool neutral for secondary text.
- **DP-42 — Colour by meaning** One mid blue means press here, one green means passed or cleared, one light vivid orange means waiting or flagged and fields the `Shuffle` button, one red means refused or failed, and a warm cream field is reserved for pieces on the public wall.
- **DP-43 — Two type roles** Interface labels, table text and prose use a plain system sans, and every identifier, count, money amount and timestamp uses a system monospace with tabular numerals.
- **DP-44 — Staff header** Every staff page carries one white header bar above a hairline with `Clearhouse` linking to `/` beside the centre's name, the five surface links, the signed-in name, a role chip and `Sign out`.
- **DP-45 — Density and composition** The queue is a dense comparison table beside a narrow sidebar, the wall is generous with large cards and wide gutters, and the plaque is one narrow reading column.
- **DP-46 — Drawn pictures and icons** Every cut-out and cover is drawn by the app from stored records, and every icon is a thin unfilled line drawing from one set.
- **DP-47 — High contrast** The `High contrast` preference keeps the same light layout while deepening hairlines, well edges, secondary text and status tints.
- **DP-48 — Designed empty and placeholder states** Empty lists show their pinned sentence where the rows or cards would stand, and loading lists show grey placeholders shaped like the rows or cards they await.
- **DP-49 — Identity outage** While the identity provider is unreachable the app still starts and stays healthy, sign-in answers `503` without counting toward lockout, existing sessions keep working, and sign-in recovers with no restart once the provider returns.
- **DP-50 — Only published fields** A JSON write body carrying any key outside its endpoint's published fields is refused with `400` on the first such key and stores nothing, the clearance pack excepted.
- **DP-51 — Refusal order** A request with several faults is answered by the first failing check in the one published refusal order.

## Frontend

### Screens and layout (DP-02, DP-06, DP-18, DP-20, DP-22, DP-23, DP-24, DP-26, DP-27, DP-29, DP-30, DP-31, DP-32, DP-34, DP-44, DP-45)

| Route | Purpose | Who |
|---|---|---|
| `/login` | sign in | anonymous |
| `/` | the clearance queue | any signed-in role |
| `/pieces/<PIECE_ID>` | the piece desk and its decision rail | any signed-in role that may see the piece |
| `/catalogue` | the source catalogue board | any signed-in role |
| `/catalogue/<OBJECT_ID>` | one object and its duplicate check | any signed-in role |
| `/schedule` | the featured schedule | any signed-in role |
| `/budget` | the quarter budget | any signed-in role |
| `/audit` | the append-only trail | any signed-in role |
| `/settings` | preferences, and the pack for a lead | any signed-in role |
| `/wall` | the public exhibit wall | anyone |
| `/wall/<PIECE_ID>` | one published piece's plaque | anyone |
| any other path | the not-found page, status 404 | anyone |

**Entry and redirects.** Authentication is checked before an identifier is looked up. A staff route opened without a session redirects to `/login?next=<PATH>`, even when its identifier names nothing stored. After sign-in the person returns to that path. A signed-in person opening `/login` is redirected to `/`. Once signed in, an address naming nothing this account may see answers the not-found page. A maker opening another maker's draft gets the same not-found page. The public wall and the plaque never redirect.

**Sign in.** `/login` is one white card centred on the paper field. It holds `Work email`, `Passphrase` and `Sign in`, with an error summary above the fields when there is something to report. `Sign out` ends the session and lands on `/wall`. A session survives a reload.

**The clearance queue.**

- *Rows.* `/` opens straight onto the pieces. Each row carries, in this order:
  - the title, linking to `/pieces/<PIECE_ID>`;
  - the maker's name;
  - the state chip;
  - the licence review mark;
  - the accessibility review mark;
  - the fee;
  - when the piece was last updated.

  A review mark is the word `Passed`, `Failed` or `Not yet` beside a check, cross or dash icon.
- *Sidebar.* A narrow sidebar lists the nine states in the fixed order `draft`, `submitted`, `in_review`, `changes_requested`, `cleared`, `scheduled`, `published`, `withdrawn`, `rejected`, each with its count. Below them are the toggles `Only mine` and `Needs my decision`.
- *Header.* The queue's own header carries `Sort by` and the result line. For a maker it also carries `New piece` at the top right.
- *New piece.* Pressing `New piece` opens the piece desk on an unsaved piece with the title, summary and fee ready to type. The piece is stored in `draft` once a valid title and summary are saved, and from then on the desk addresses it at `/pieces/<PIECE_ID>`.

**The piece desk.** Two columns.

- *Main column*, in order:
  - the title and state chip;
  - the maker's name;
  - the summary;
  - the cited objects as a board of cut-outs;
  - the two reviews, each with its result, reviewer, reason and its decision stamp once recorded;
  - the piece's own audit history, newest first.
- *Cited objects.* Each shows its title, artist and licence name, and a `View` link to `/catalogue/<OBJECT_ID>?piece=<PIECE_ID>`. A cited object with a flagged duplicate carries the words `Possible duplicate` beside a flag icon. Once acknowledged in this round, it carries `Duplicate acknowledged by <NAME>` instead.
- *Decision rail.* The right column holds the actions this account may take on this piece from this state, and nothing else. For an auditor the rail reads `Read only` and holds no action.
- *Editing.* While the piece is a draft and the signed-in maker owns it, the title, summary and fee are editable fields with `Save draft`, and `Add object` opens the object picker.

**The source catalogue.**

- *Header.* The count line, `Shuffle` and the licence filter.
- *Board.* The cut-outs.
- *Pager.* Below the board: `Previous`, `Next` and the showing line.
- *Address.* The address carries `?seed=<SEED>&cursor=<CURSOR>`, so opening that address again rebuilds the same board in the same order.
- *Board placement.* Each object sits in a box whose proportions equal its stored `width` over `height`, scaled so the longer side is no more than 220 pixels and no less than 48 pixels. It is never stretched. Placement is deterministic:
  1. Sort the page's objects by descending box area, keeping catalogue order for ties.
  2. Place each object into the column that is currently shortest, the leftmost on a tie, with a 16 pixel gutter.
- *Blocked licences.* An object whose licence is not on the allowed list is drawn as an empty edged box with a lock icon and the words `Licence not cleared for reuse`. It cannot be opened from the board or offered by the picker.

**The object detail.**

- *Record.* `/catalogue/<OBJECT_ID>` shows the object large beside its record: `Title`, `Artist`, `Licence`, `Licence address`, `Source page`, `Description`, `Extract`, and its size as `<WIDTH> by <HEIGHT>`. A field the catalogue does not carry reads `Not recorded`. The licence address and source page are plain text, never links.
- *Similar objects.* Below the record is a list of similar objects, each with its score. Those scoring at least the duplicate threshold carry the words `Possible duplicate`.
- *Acknowledge.* A flagged duplicate carries `Acknowledge` only when all of these hold:
  - the `?piece=` context names a piece in `in_review` that cites this object;
  - the signed-in account is a licence reviewer who may see that piece.

  Pressing it acknowledges the duplicate for exactly that piece. A context that does not meet these conditions is ignored, never answered with 404.

**The featured schedule.** One month as a grid of seven-column day cells, with `Previous month` and `Next month`. The current UTC day carries the word `Today`. A booked cell shows the piece's title. For a lead, activating a free day from today onward opens the `Book a day` dialog listing every `cleared` piece with its title, maker and fee. Choosing one books it. Activating a booked day as a lead offers `Unschedule`. A `Today` panel beside the grid, or above it on narrow screens, shows today's featured piece and its visitor line.

**The public wall and the plaque.**

- *Wall.* `/wall` shows published pieces as a grid of cream cards. Each card carries the drawn cover, the title, the maker's name and the published date, and links to the plaque.
- *Plaque.* `/wall/<PIECE_ID>` is a single narrow reading column on cream, holding in order:
  - the published date;
  - the title;
  - the summary;
  - the cover;
  - `Sources`, with one entry per cited object giving its title, artist, licence name and licence address as plain text;
  - `Credits`, with the maker's name;
  - the cleared line.

  The sources are read from the catalogue when the page is opened, so a corrected attribution shows here corrected.

**The clearance budget.**

- *Totals.* `/budget` shows the quarter label and three figures: `Budget`, `Committed` and `Remaining`.
- *Table.* The columns are `Piece`, `Maker`, `State` and `Fee`, with one row per piece whose `cleared_at` falls in the quarter.
- *Lead controls.* For a lead each row adds a number field labelled `Amount for <TITLE>`, the buttons `x10`, `x100` and `x1,000`, and `Apply`. Below the table is `Reset quarter`.

**The audit trail.**

- *Columns.* `/audit` lists entries newest first with the columns `When`, `Piece`, `Actor` (name and role), `From`, `To` and `Reason`. `When` is a UTC timestamp to the second.
- *Filters.* Filters for piece, actor, to-state, `From date` and `Until date` combine with one another.
- *Paging and export.* The list pages at `Rows per page`, and `Export CSV` downloads the currently filtered rows.

**Settings.** `/settings` holds `Rows per page`, `Date display` and `High contrast`, each saving at once. For a lead it adds `Export pack` and an `Import pack` file chooser.

**The staff header.** One white bar above a hairline, holding from left to right:

- `Clearhouse`, linking to `/`, with `Fenwick Science Centre` beside it;
- on the queue and the catalogue only, the search well;
- the links `Queue`, `Catalogue`, `Schedule`, `Budget` and `Audit`;
- the signed-in name;
- the role as a chip;
- `Sign out`.

The current link is underlined and marked as the current page.

**The public header.** A quieter bar carrying the product name, the tagline and the cleared-today line. The footer carries only the footer line.

**Per viewport.**

- *375 by 812:*
  - The queue is one stacked card per piece, carrying the title, maker, state and both review marks.
  - The sidebar folds behind `Filters`.
  - The header's surface links wrap onto a second line.
  - The desk's rail moves below the main column as a full-width stack of actions.
  - The schedule becomes one scrolling column of days.
  - The catalogue board and the wall use one column.
- *768 by 1024:*
  - The queue is a table beside a narrow sidebar, without `Fee` and `Updated`.
  - The catalogue board and the wall use two columns.
  - The desk keeps two columns with a narrower rail.
- *1280 by 800:*
  - The queue table shows `Fee` and `Updated`.
  - The wall uses three columns.
  - The catalogue board uses as many columns as fit, at least four.
- *Breakpoints overall:*
  - The wall uses one column up to 600 pixels, two up to 800, three up to 1300, and four above 1300.
  - The queue shows `Fee` and `Updated` above 1000 pixels.
  - Nothing scrolls horizontally at any width from 320 pixels up.
  - The app declares a responsive viewport (`width=device-width`).

### Public screens and controls (DP-18, DP-20, DP-22, DP-35, DP-38, DP-40, DP-44)

Accessible names are exact. A control a role may not use is absent, not disabled. The `Needs my decision` toggle is the one exception: it stays visible and disabled for an auditor.

| Surface | Role and accessible name | Visible copy |
|---|---|---|
| `/login` | textbox `Work email` | `Work email` |
| `/login` | textbox `Passphrase` (password field) | `Passphrase` |
| `/login` | button `Sign in` | `Sign in` |
| any form | `alert` error summary | heading `There is a problem`, then one link per message |
| staff pages | `status` region `Desk updates` | the announcements from Feedback states |
| staff header | link `Clearhouse` | `Clearhouse` beside `Fenwick Science Centre` |
| staff header | links `Queue`, `Catalogue`, `Schedule`, `Budget`, `Audit` | same |
| staff header | button `Sign out` | `Sign out` |
| `/` | searchbox `Search pieces` | placeholder `Title or maker` |
| `/` | combobox `Sort by` | options `Newest first`, `Oldest first`, `Title A to Z`, `Fee high to low` |
| `/` | checkboxes `Only mine`, `Needs my decision` | same |
| `/` | button `New piece` (maker only) | `New piece` |
| `/` | button `Filters` (narrow layout) | `Filters` |
| `/` | result line | `<N> of <TOTAL> pieces` |
| `/` | button `Clear filters` | `Clear filters` |
| `/` | navigation `Pages` with links `Previous page`, `Next page` | same |
| every search well | icon-only button `Clear search` | cross icon, tooltip `Clear search` |
| `/pieces/<PIECE_ID>` | rail buttons `Submit for clearance`, `Start review`, `Record licence review`, `Record accessibility review`, `Clear for the wall`, `Return for changes`, `Reject`, `Schedule`, `Publish now`, `Unschedule`, `Withdraw`, `Revise` | same |
| `/pieces/<PIECE_ID>` | textboxes `Title`, `Summary`, `Fee in dollars`; button `Save draft` | same |
| `/pieces/<PIECE_ID>` | button `Add object`; each cited object's link `View <OBJECT_TITLE>` | `Add object`, `View` |
| `/pieces/<PIECE_ID>` | icon-only link `Next in queue` | arrow icon, tooltip `Next in queue`, present when the account's `Needs my decision` list holds a later piece |
| `/pieces/<PIECE_ID>` | auditor rail | `Read only` |
| review dialog | dialog `Record licence review` or `Record accessibility review`; radio group `Result` with `Pass`, `Fail`; textbox `Reason`; buttons `Save review`, `Cancel`; icon-only button `Close` | same |
| reason dialog | dialog `Return for changes`, `Reject` or `Withdraw`; textbox `Reason`; buttons `Confirm`, `Cancel`; icon-only button `Close` | same |
| schedule dialog | dialog `Book a day`; textbox `Day` (from the desk) or a list of piece buttons named by title (from the grid); buttons `Confirm`, `Cancel` | same |
| object picker | dialog `Add object`, holding a catalogue board and `Done` | same |
| decision stamp | `img` named `Licence review passed`, `Licence review failed`, `Accessibility review passed` or `Accessibility review failed` | the word `Passed` with a check, or `Failed` with a cross |
| `/catalogue` | searchbox `Search objects`; button `Shuffle`; combobox `Licence` with `All licences`, `CC0`, `Public domain`, `CC BY 4.0`, `CC BY-SA 4.0` | count line `<N> objects in the catalogue` |
| `/catalogue` | each usable cut-out: link named by the object's title, containing a drawn `img` named by the same title | caption = title |
| `/catalogue` | each blocked cut-out: `img` named `<OBJECT_TITLE>, licence not cleared for reuse` | `Licence not cleared for reuse` |
| `/catalogue` | buttons `Previous`, `Next`; once wrapped, `Next` is replaced by `End of catalogue` | showing line `Showing <FIRST> to <LAST> of <TOTAL>` |
| `/catalogue/<OBJECT_ID>` | list `Similar objects`; button `Acknowledge <DUPLICATE_TITLE>` | `Acknowledge`, `Possible duplicate`, `Duplicate acknowledged by <NAME>` |
| `/schedule` | buttons `Previous month`, `Next month`; grid named `<MONTH> <YEAR>`; each day a gridcell button named `<DATE>` plus `, free` or `, <TITLE>` | `Today` |
| `/schedule` | region `Today` | visitor line `<N> visitors opened this piece`, singular `1 visitor opened this piece` |
| `/budget` | heading `<YEAR> Q<N>`; per lead row: spinbutton `Amount for <TITLE>`, buttons `x10`, `x100`, `x1,000`, `Apply` | figures `Budget`, `Committed`, `Remaining` |
| `/budget` | button `Reset quarter`; alertdialog `Reset every fee this quarter?` with `Reset fees`, `Cancel` | same |
| `/audit` | filters `Piece`, `Actor`, `To state`, `From date`, `Until date`; link `Export CSV` | same |
| `/settings` | combobox `Rows per page` (25, 50, 100); radio group `Date display` (`Relative`, `Absolute`); switch `High contrast`; button `Export pack`; file input `Import pack` | same |
| any list | text plus button `Try again` | list-failure message from Feedback states |
| public header | tagline | `Small exhibits, cleared for the floor` |
| public header | cleared-today line | `<N> pieces cleared today`; when N is 1, `1 piece cleared today` |
| public footer | footer line | `Every piece here names its sources` |
| `/wall` | list `Published pieces`, each card a link named by the piece title | published date, maker |
| plaque | headings `Sources`, `Credits`; cleared line | `Cleared <DATE> by <LEAD_NAME>` |
| not-found page | heading `That page is not here`; link `Back to the wall` | `It may have been withdrawn, or the address may be wrong.` |

Every drawn cover beside its own title is decorative and has no accessible name, so the title is not announced twice. In copy, `<DATE>` is a UTC day written `YYYY-MM-DD`. The `Date display` preference changes only how `When` and `Updated` read on staff tables: `relative` reads like `3 hours ago`, and `absolute` shows the UTC timestamp.

### Interactions (DP-19, DP-21, DP-22, DP-25, DP-29, DP-35)

**Writes and versions.** Every write from the desk, the schedule and the budget sends the piece version the page rendered.

**Queue.**

- Typing in `Search pieces` narrows the rows from the second character onward to titles or maker names containing the text, ignoring case.
- `Sort by` reorders the rows.
- Both update the list without a full page load, and the result line is announced.
- `Clear filters` empties the search and both toggles.

**Catalogue.**

- `Shuffle` picks a new whole-number seed from 1 to 2147483647, returns to the start of the walk and redraws the board.
- `Next` follows the returned cursor.
- `Previous` returns to the page before it in the same walk and is disabled on the first page.
- Hovering or focusing a cut-out lifts it slightly and reveals a strip beneath it naming the artist and the licence.

**Object picker.**

- `Add object` opens the picker on the catalogue board.
- Pressing a cut-out cites it and appends it to the piece's board.
- `Done` closes the picker.

**Keyboard path through a review.**

1. Tab reaches each control in reading order: the header, then the main column, then the rail.
2. Enter or Space on `Record accessibility review` opens its dialog. Focus moves to the first `Result` radio.
3. Arrow keys switch between `Pass` and `Fail`.
4. Tab reaches `Reason`, `Save review`, `Cancel` and `Close`, then wraps back to the first radio. Focus never leaves the open dialog.
5. Enter on `Save review` saves the review.
6. On `Escape`, `Cancel` or `Close`, the dialog closes without saving.

**Focus after a dialog.**

- After a cancelled dialog, focus returns to the control that opened it.
- After a saved dialog, focus returns to the opener if it still exists. Otherwise it moves to the piece's title heading.

The same rules hold for every dialog in the app.

**Focus ring.** Every focusable control shows a focus ring at least two pixels thick in the action blue, separated from the control by a thin white gap. The ring is never removed, and a control with focus is never hidden behind another layer.

**Touch.** Every control is at least 44 by 44 pixels. Hover-only reveals also appear on focus and on tap.

**Plaque visits.** The first view of a plaque in a browser sets a cookie that records the piece. A later view from the same browser does not raise the visitor count. A view from a fresh browser does.

**Reset quarter.** `Reset quarter` opens its alertdialog and changes nothing until `Reset fees` is pressed.

**Multipliers.** A multiplier button multiplies the typed amount in its row. `Apply` then adds that amount, in dollars, to the fee.

### Visual design (DP-41, DP-42, DP-43, DP-45, DP-46, DP-47)

**Direction.** A quiet museum back office whose only colourful things are the exhibits. A reviewer should see at a glance down the queue which pieces are waiting on them and what has been decided. Each screen has one obvious next action.

**Paper and ink.** The page field is a near-white paper neutral. Every card, panel and dialog sits on pure white above it, so surfaces read as separate sheets with only a pale cool hairline between them.

- Primary text is a near-black ink.
- Secondary text, column labels and captions are a mid cool neutral.
- A lighter neutral appears only on disabled or decorative text, never on the only copy carrying a meaning.
- The edge of an interactive well is one step stronger than a hairline.

**Colour by meaning.**

| Colour | Means | Rule |
|---|---|---|
| One mid blue | press here | Used for primary actions, links, the selected row and the focus ring. It is the only colour that means press here. Its pressed state is one step deeper. |
| One green | passed or cleared | Appears nowhere else. |
| One light, vivid orange | waiting on a second review, or a flagged duplicate | Also the field behind `Shuffle`, with dark ink text on it. |
| One red | refused or failed | Sits over a pale red field for an error summary. |
| One warm cream | reached the public wall | Reserved for the wall cards and the plaque, so a published exhibit reads like a museum label. |

Every status also carries its word and its icon, so nothing depends on telling colours apart.

**Type.** There are two type roles:

- a plain system sans for labels, table text and prose;
- a system monospace with tabular numerals for every identifier, count, money amount and timestamp, so columns of figures line up.

Page headings are about one and a half times body size, and section headings about one and a quarter times. Weight, not size, carries most of the emphasis.

**Density.** The queue is dense, with tight rows and a narrow sidebar, because its job is comparison. The wall is generous, with large cards and wide gutters, because its job is display. The plaque is one narrow reading column.

**High contrast.** The `High contrast` preference keeps the same light layout and makes these changes:

- hairlines and well edges deepen toward the ink;
- secondary text moves close to primary text;
- every status tint deepens.

Nothing moves, nothing is added and nothing is removed.

**Contrast.** Text meets WCAG 2.2 AA in both modes: at least 4.5 to 1, or 3 to 1 for large text. Control edges, focus rings and status icons reach at least 3 to 1 against their field.

**Pictures.** All pictures are drawn, never fetched.

- A cut-out is a rounded shape in the object's own proportions, filled with a flat tone chosen from its id, with its title as a centred caption.
- A piece's cover is a wide panel carrying the titles of its first three cited objects.

**Icons.** One set of thin unfilled line drawings, each on its own square drawing area at one stroke weight: shuffle, caret, chevron, reviewer, arrow-next, search, check, cross, dash, flag and lock. The caret marks a closed disclosure and turns half a turn when the disclosure opens. No icon carries a status without its word beside it.

### Motion and effects (DP-36)

Motion only ever shows that something changed. There are two moments worth watching. Every other change is a brief response.

**The clearance stamp (signature).** When a reviewer saves a review, the stamp appears on that review's slot of the piece desk.

1. It starts at about one and a half times its final size, fully transparent and turned slightly.
2. In about a fifth of a second it drops to just below its final size and becomes fully opaque.
3. It then springs back to its exact final size and angle.

The whole landing takes between a quarter and three fifths of a second. The stamp stays in place afterwards and is drawn still, without animating, on every later visit. The motion runs on time from the moment of saving and is not linked to scrolling.

**Wall card entry.** When `/wall` loads, the cards rise a short distance and fade in, one after another in reading order. Each card takes about a quarter of a second. Each starts less than a tenth of a second after the one before. Cards after the twelfth start together with the twelfth.

**Brief responses.**

| What changes | Response | Timing |
|---|---|---|
| Hovering or focusing a cut-out | lifts it and reveals its strip | about a tenth of a second |
| A dialog opening | fades in and grows from slightly smaller | under a quarter of a second |
| A dialog closing | fades out | under a quarter of a second |
| A pressed button | deepens | about a tenth of a second |
| The caret | turns | about a fifth of a second |

**Technique and loops.** Every motion is a browser-native style-sheet animation or Web Animations call, never a script timer redrawing each frame. There are no decorative loops: no spinners, no shimmer on placeholders and no pulsing badges.

**Reduced motion.** When the operating system's reduce-motion setting is on:

- the stamp appears at its final size at once;
- the cards appear in place at once;
- the hover lift becomes a change of edge colour only;
- dialogs and the caret switch instantly.

All content stays.

### Feedback states (DP-35, DP-39, DP-40, DP-48, DP-49)

Every announcement goes to the `status` region `Desk updates`. On `/login`, the error summary takes this role. Every refusal from the server is shown in an `alert` at the top of the current panel, holding the server's `message` word for word. A field refusal also:

- marks that field invalid;
- describes the field with the message;
- lists the message in the error summary, linked to the field.

**Writes.**

| Async action | Pending | Success announcement |
|---|---|---|
| Sign in | button reads `Signing in…` and is disabled | lands on the target page |
| Save draft | button reads `Saving…`; region says `Saving` | `Draft saved` |
| Cite or remove objects | region says `Saving` | `<N> objects cited` |
| Any state step, including booking and unscheduling | pressed control reads `Saving…` | `<TITLE> moved to <STATE>` |
| Record a review | `Save review` reads `Saving…` | `<KIND> review recorded as <RESULT>`, where KIND is `Licence` or `Accessibility` and RESULT is `passed` or `failed`; the stamp lands |
| Acknowledge | button reads `Saving…` | `Duplicate acknowledged` |
| Apply a fee | `Apply` reads `Saving…` | `Fee for <TITLE> is now <AMOUNT>` |
| Reset quarter | `Reset fees` reads `Saving…` | `Every fee this quarter is back to its submitted value` |
| Save a preference | none | `Preferences saved` |
| Import pack | file input disabled | `Imported <N> pieces` |
| Export pack or CSV | none | the browser download starts |

**Stale versions.** A stale-version refusal adds a `Reload piece` button to its alert. Pressing it re-renders the panel with the current piece.

**Lost connection.** A write that gets no response at all shows `The desk could not be reached. Your change was not saved`.

**Identity outage.** During an identity outage, `/login` still renders, and its error summary shows the sign-in outage message from Business rules. Every other page works as usual for a signed-in person.

**Lists.**

- *Loading.* While a list is loading after first paint (a queue filter, a catalogue page, a similar-objects list, an audit page), grey placeholders shaped like its rows or cards stand where the data will be. The list is marked busy until the data arrives.
- *Failed load.* A list whose request fails shows `Could not load that list` and `Try again` in its place. The rest of the page keeps working.

**Empty states.**

| List | Sentence |
|---|---|
| Queue with no pieces | `Nothing is waiting. Submitted pieces appear here` |
| Filtered queue | `No pieces match that search` |
| Catalogue search | `No objects match that search` (the typed text is kept) |
| Similar objects, when nothing scores above 40 | `No similar objects found` |
| Wall | `Nothing is on the wall yet` |
| Today panel | `No piece is featured today` |
| Audit with nothing matching | `No entries match these filters` |

## Backend

### API (DP-01, DP-03, DP-04, DP-21, DP-23, DP-30, DP-32, DP-49, DP-50)

**Format.** The JSON API is served on the app's own origin under `/api`. Responses are `application/json; charset=utf-8`, except the CSV export.

**Error bodies.** Every error body has one shape: `{ "error": { "message": "<TEXT>" } }`, with `"field": "<FIELD>"` added when one field is at fault. A stale-version refusal also carries the current piece under a top-level `current` key. Statuses and messages for refusals belong to Business rules. Rows below name only their success response and their own extra shapes.

**Published fields.** The request fields listed for a write are its published fields. Any other key is refused as Business rules sets out.

**Identifiers.** Piece and object ids are positive whole numbers. Account ids are strings.

| Endpoint | Request (published fields) | Success |
|---|---|---|
| `GET /api/health` | none | `200 { "status": "ok", "ok": true, "identity": "up" }`, with `identity` either `up` or `down` |
| `POST /api/auth/login` | `{ email, password }` | `200 { "access_token": "<TOKEN>" }`, and the same token set as an HTTP-only, same-site session cookie |
| `POST /api/auth/logout` | none | `204` |
| `GET /api/auth/me` | none | `200 { id, email, name, role }` |
| `GET /api/pieces` | query `state`, `mine`, `needs`, `q`, `sort` (`newest`, `oldest`, `title`, `fee`), `page` (from 1) | `200 { rows, counts, total, page, rows_per_page }` |
| `POST /api/pieces` | `{ title, summary, fee_cents }` | `201` the piece |
| `GET /api/pieces/{id}` | none | `200` the piece plus `objects`, `reviews`, `duplicate_acks` and `audit` (newest first) |
| `PATCH /api/pieces/{id}` | `{ version, title?, summary?, fee_cents? }` | `200` the piece |
| `PUT /api/pieces/{id}/objects` | `{ version, object_ids }` | `200 { piece, objects }`, with objects in the given order |
| `POST /api/pieces/{id}/transition` | `{ version, action, reason?, day? }` | `200` the piece |
| `POST /api/pieces/{id}/reviews` | `{ version, kind, result, reason? }` | `201 { id, piece_id, kind, result, reason, reviewer_id, created_at, piece }` |
| `POST /api/pieces/{id}/duplicate-acks` | `{ object_id, duplicate_object_id }` | `201 { piece_id, object_id, duplicate_object_id, acknowledged_by, acknowledged_at }` |
| `GET /api/objects` | query `cursor`, `limit` (1 to 60, default 60; a larger value is clamped to 60), `seed` (1 to 2147483647, default 1), `q`, `license` | `200 { objects, nextCursor, wrap, total }` |
| `GET /api/objects/{id}` | none | `200` the object |
| `GET /api/objects/{id}/similar` | query `limit` (1 to 50, default 20), `offset` (from 0) | `200 { id, offset, results }`, each result `{ object, score }`, listing only scores above 40 |
| `GET /api/schedule` | query `month` as `YYYY-MM`, default the current UTC month | `200 [ { day, piece: { id, title, state }, view_count } ]` |
| `PUT /api/schedule/{day}` | `{ piece_id, version? }` | `200 { day, piece_id, view_count }` |
| `DELETE /api/schedule/{day}` | query `version` optional | `204` |
| `GET /api/budget` | query `quarter` as `YYYY-QN`, default the current UTC quarter | `200 { quarter, budget_cents, committed_cents, remaining_cents, rows }` |
| `PATCH /api/budget/{quarter}` | `{ piece_id, delta_cents, version? }`, or `{ reset }` alone with `reset` true | `200` the budget shape |
| `GET /api/audit` | query `piece`, `actor`, `to`, `from`, `until` (UTC days), `page` | `200 { rows, total, page, rows_per_page }` |
| `GET /api/audit/export` | the same filters, no paging | `200 text/csv; charset=utf-8`, an attachment named `clearhouse-audit.csv` |
| `GET /api/pack` | none | `200` the pack document |
| `POST /api/pack` | the pack document | `201 { "imported": <N> }` |
| `GET /api/preferences` | none | `200 { rows_per_page, date_display, high_contrast }` |
| `PUT /api/preferences` | `{ rows_per_page?, date_display?, high_contrast? }` | `200` the stored preferences |

**Shapes.**

- *Piece.* `{ id, title, summary, fee_cents, submitted_fee_cents, state, owner: { id, name }, version, created_at, updated_at, cleared_at, published_at, licence_review, accessibility_review }`. Each review field is `"pass"`, `"fail"` or `null`.
- *Queue row.* The piece without `summary`. `counts` is keyed by all nine states.
- *Audit row.* `{ id, piece_id, piece_title, from_state, to_state, reason, actor: { id, name, role }, created_at }`.
- *Budget row.* `{ id, title, owner_name, state, fee_cents, version }`.
- *Object.* Carries every field the `objects` table stores.
- *Times.* Every timestamp is UTC ISO 8601 ending in `Z`.

**Authentication.** A session is presented as `Authorization: Bearer <TOKEN>` or as the session cookie.

**Catalogue cursors.** `GET /api/objects` with no `cursor` starts the walk. Each response's `nextCursor` is an opaque string that continues it. The page that holds the walk's final object carries `"wrap": true`, and its `nextCursor` returns to the start. Every earlier page carries `"wrap": false`. `total` counts the objects that match `q` and `license`. `q` of two or more characters matches the title or the artist, ignoring case.

**Transition actions.** `action` takes exactly these values: `submit`, `start_review`, `clear`, `reject`, `revise`, `schedule`, `unschedule`, `publish`, `withdraw`, `return_for_changes`. Only steps that need a reason read `reason`. Only `schedule` reads `day`. Elsewhere both are ignored. `PUT /api/schedule/{day}` is the `schedule` step and `DELETE /api/schedule/{day}` is the `unschedule` step. Each has exactly the same rules, version raise and single audit entry as its action.

**The clearance pack document.**

```
{
  "meta": { "saveVersion": "1", "name": string, "author": string,
            "created": number, "updated": number, "uuid": string },
  "config": { "quarter": string, "budget_cents": number },
  "pieces": [ { "title": string, "summary": string, "fee_cents": number,
                "state": string, "object_ids": [number] } ]
}
```

On export:

- `meta.author` is the exporting account's name;
- `created` and `updated` are the export moment in milliseconds since 1970 UTC;
- `uuid` is new for each export;
- `config` carries the current quarter and its budget.

**The audit CSV.** The first line is `when,piece_id,piece_title,actor,role,from_state,to_state,reason`, followed by one line per entry, newest first. Every line ends with a carriage return and a line feed. The file is UTF-8 with no byte-order mark. Each field is prepared in this order:

1. A field whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with a single quote `'`.
2. A field that now contains a comma, a double quote, a carriage return or a line feed is wrapped in double quotes, with each embedded double quote doubled.

The stored text, the JSON API and the pages always show the original, unprefixed text.

### Business rules (DP-05, DP-07 to DP-19, DP-21, DP-23 to DP-25, DP-28 to DP-32, DP-38, DP-49, DP-50, DP-51)

**Roles.**

| Role | May write |
|---|---|
| `maker` | create a piece; while it is its own draft, edit its title, summary and fee and replace its cited objects; submit it; revise it |
| `licence_reviewer` | start a review; acknowledge a flagged duplicate; record the licence review |
| `access_reviewer` | start a review; record the accessibility review |
| `lead` | clear, return for changes, reject, schedule, unschedule, publish, withdraw; adjust a fee; reset the quarter; export and import the pack |
| `auditor` | its own preferences only |

Every role may save its own preferences.

**Visibility.**

- Every signed-in role reads every staff surface and every piece, with one exception: a maker never sees a piece in `draft` owned by another account.
- For a maker, such a piece answers `404` with `Not found` on every route that names it by id, whether in the path or in the body. `/pieces/<PIECE_ID>` shows the not-found page.
- It is missing from `GET /api/pieces` `rows`, `counts` and `total`.
- Its audit entries are missing from `GET /api/audit` rows and `total`, and from the CSV export.
- A filter naming it returns no rows rather than `404`.
- When the piece leaves `draft` it becomes visible again. When it is revised back to `draft` it is hidden again.
- An auditor reads every piece by its id and is offered no action.

**Refusal order.** Every request is checked in this order. The first check that fails answers the request, stores nothing and appends nothing.

1. A body larger than its limit: `413` with `That request is too large`. The limit is 1,000,000 bytes for `POST /api/pack` and 65,536 bytes for every other request. A body of exactly the limit is accepted.
2. A path the app does not serve: `404` with `Not found`, with or without a session. A served path with a method it does not offer answers `405` with `That cannot be done here`. This is how any attempt to change or delete an audit entry ends.
3. A write carrying an `Origin` header whose host and port differ from the request's own `Host`: `403` with `Cross-site requests are refused`. A write with no `Origin` header passes.
4. A write body that is not `application/json`: `415` with `Send JSON`.
5. A missing, unknown or revoked session on any `/api` route other than `GET /api/health` and `POST /api/auth/login`: `401` with `Sign in first`.
6. An id in the path or body that names nothing this account may see: `404` with `Not found`.
7. A body that is not a JSON object: `400` with `Send a JSON object`. A body key that is not a published field of this endpoint: `400` with field `<KEY>` and message `<KEY> cannot be set here`. When several keys are unpublished, the first in the body's own order is named. The pack document is exempt from this key check. Its own checks follow under The clearance pack.
8. An auditor making any write other than its own preferences: `403` with `Your role may not do that`.
9. The own-piece rule. The account that created a piece may not record either review on it, clear it or publish it, whatever role it holds: `403` with `You cannot review your own piece`.
10. The second-reviewer rule. The account that recorded a piece's licence review may not record its accessibility review: `403` with `A second reviewer is required`.
11. Any other write the role table does not give this role, including a maker acting on a piece it does not own: `403` with `Your role may not do that`.
12. A missing `version` where it is required: `400` with field `version` and `A version is required`.
13. A `version` that is not the stored one: `409` with `This piece changed while you were deciding. Reload and try again`, plus the current piece under `current`.
14. A step the state table does not allow from the current state, or an unknown `action`: `409` with `That is not a legal step from <STATE>`, where `<STATE>` is the stored state.
15. Field rules: `400` naming the field.
16. Rule-specific refusals, with the statuses given in the rules below.

**Sign in.** Login is checked in this order. Checks 1 to 4 of the refusal order come first, then check 7 on the body, then:

1. A blank `email` is refused with `400` and field `email`, `Enter your work email`. A blank `password` is refused with `400` and field `password`, `Enter your passphrase`. Neither counts toward lockout.
2. The email is normalised by trimming surrounding spaces and lower-casing. If five failures for that normalised email have been counted within the lockout window, the attempt answers `429` with `Too many attempts, wait 15 minutes`, however correct the passphrase. The window is `LOGIN_LOCKOUT_SECONDS` seconds, defaulting to 900. The message stays the same whatever the window. A refused attempt at this step adds nothing and does not extend the window.
3. If the identity provider cannot be reached within 10 seconds, the attempt answers `503` with `Sign-in is unavailable right now. Try again shortly`. It counts nothing.
4. If the provider rejects the credentials, or accepts them for an identity that is not a seeded account, the attempt answers `401` with `Email or passphrase is not recognised` and counts one failure.

The provider is contacted for every attempt that reaches step 3, whether or not the email is known. A wrong passphrase for a known email and any passphrase for an unknown email therefore get the same status and a byte-identical body. Lockout behaves identically for both. For example, `  Rosa.Aldridge@EXAMPLE.com ` signs in as Rosa and counts toward Rosa's window. A successful sign-in clears that email's count. A `next` value is followed only when it is a same-origin path beginning with a single `/`. Any other value sends the person to `/`.

**Sessions.** A session is the app's own opaque token, stored in `postgres`. It lasts until signed out. It is never checked against the identity provider again, so an identity outage never ends a session.

**Fields.**

| Field | Rule | Refusal message |
|---|---|---|
| Title | 1 to 80 characters after trimming | `A title of 1 to 80 characters is required` |
| Title | unique, ignoring case, among pieces that are not `rejected` | `A piece named <TITLE> already exists` |
| Summary | 20 to 600 characters after trimming | `A summary of 20 to 600 characters is required` |
| `fee_cents` | a whole number from 0 to 500000 | `A fee must be between $0.00 and $5,000.00` |
| Reason (a failed review, a return, a reject or a withdrawal) | 10 to 400 characters after trimming | `A reason of 10 to 400 characters is required` |
| `object_ids` | names only stored objects, at most 40, each once | `Unknown object <ID>`, `Cite at most 40 objects` or `Each object may be cited once` |
| `kind` | `licence` or `accessibility` | `Kind must be licence or accessibility` |
| `result` | `pass` or `fail` | `Result must be pass or fail` |
| `day` | written `YYYY-MM-DD` | `Use a day written as YYYY-MM-DD` |
| `day` | today or later | `Pick today or a later date` |

A reason is stored exactly as sent.

**Usable objects.** The allowed licences are exactly `CC0`, `Public domain`, `CC BY 4.0` and `CC BY-SA 4.0`. An object is usable only when:

- its licence is allowed;
- its artist is non-empty after trimming;
- its licence address is present.

A draft may cite unusable objects, so these refusals are reachable at submission:

- Submitting a piece that cites nothing is refused with `400`, field `object_ids`, and `Cite at least one object`.
- Submitting a piece that cites any unusable object is refused with `400`, field `object_ids`, message `Some cited objects cannot be used`, and a `lines` array inside `error`. The array holds one `<OBJECT_TITLE>: <REASON>` per offending object, in citation order. The reason is the first that applies of `Licence is not on the allowed list`, `No artist is attributed` and `No licence address is recorded`.

**The state machine.** A piece is always in exactly one of the nine states. These are the only legal steps.

| From | Step | To | Who | Also required (rule-specific refusal) |
|---|---|---|---|---|
| `draft` | Submit for clearance | `submitted` | the owning maker | the citation checks; sets `submitted_fee_cents` to the fee |
| `submitted` | Start review | `in_review` | either reviewer | none |
| `in_review` | Record licence review, passed | `in_review` | licence_reviewer | no licence review yet (`409` `That review is already recorded`); every flagged duplicate acknowledged this round (`409` `Acknowledge every flagged duplicate first`) |
| `in_review` | Record accessibility review, passed | `in_review` | access_reviewer | no accessibility review yet (`409` `That review is already recorded`) |
| `in_review` | Record either review, failed | `changes_requested` | the matching reviewer | a reason |
| `in_review` | Clear for the wall | `cleared` | lead | both reviews recorded and passed (`409` `Both reviews must pass before clearing`); the fee fits the budget |
| `in_review` or `changes_requested` | Return for changes | `changes_requested` | lead | a reason |
| `in_review` or `changes_requested` | Reject | `rejected` | lead | a reason |
| `changes_requested` or `withdrawn` | Revise | `draft` | the owning maker | discards both reviews and every duplicate acknowledgement of the piece |
| `cleared` | Schedule | `scheduled` | lead | a day that is today or later and free |
| `scheduled` | Unschedule | `cleared` | lead | frees the day |
| `scheduled` | Publish now | `published` | lead | the booked day is today or earlier (`409` `<DATE> has not arrived yet`); sets `published_at` |
| `published` | Withdraw | `withdrawn` | lead | a reason; frees the day |

**State effects.**

- `rejected` is final.
- Clearing sets `cleared_at` only if it is empty. It is never rewritten.
- Every successful step raises `version` by one and appends exactly one audit entry with the actor, the from-state, the to-state and the reason. A passed review is a step from `in_review` to `in_review`.
- `PATCH /api/pieces/{id}` and `PUT …/objects` are allowed only while the piece is in `draft`. They raise `version` and append nothing.
- Two writes sent against one stored version end with exactly one stored and the other refused as stale. This includes a licence review and an accessibility review sent at the same moment.

**Version rules by write.**

- `version` is required on `PATCH /api/pieces/{id}`, `PUT …/objects`, `…/transition` and `…/reviews`.
- It is optional on both schedule endpoints and on a single-fee budget adjustment. When supplied it is checked. When omitted, the write applies to the version stored at that moment.
- `{ reset: true }` carries no version and raises the version of every piece whose fee it changes.

**Duplicate acknowledgements.**

- A similar object scoring 85 or above is a flagged duplicate.
- An acknowledgement is legal only while the piece is in `in_review`. Otherwise it answers `409` with the illegal-step message.
- `object_id` must be cited by the piece. Otherwise it answers `400` with field `object_id` and `That object is not cited by this piece`.
- `duplicate_object_id` must be a flagged duplicate of it. Otherwise it answers `400` with field `duplicate_object_id` and `That object is not a flagged duplicate`.
- Repeating an acknowledgement that already exists for the same piece, object and duplicate answers `409` with `That duplicate is already acknowledged` and writes nothing.
- An acknowledgement never raises `version` and is not an audit entry.
- Revising the piece back to `draft` deletes its acknowledgements together with both reviews, so the next licence review must acknowledge every flagged duplicate again.

**Needs my decision.** A piece in `submitted` waits on whichever reviewer presses `Start review`, so it appears in both reviewers' lists until one of them starts its review. Each role's list holds exactly these pieces:

| Role | Matches |
|---|---|
| Licence reviewer | every piece in `submitted` it does not own, plus every piece in `in_review` it does not own that has no licence review |
| Accessibility reviewer | every piece in `submitted` it does not own, plus every piece in `in_review` it does not own that has no accessibility review and whose licence review it did not record |
| Lead | pieces in `in_review` with both reviews passed, plus every piece in `cleared` and `scheduled` |
| Maker | its own pieces in `draft` and `changes_requested` |
| Auditor | nothing |

**The queue.**

- `counts` covers every piece this account may see and ignores every filter.
- `total` counts the rows matching the current filters.
- Rows page at the account's `Rows per page`. A page past the end returns no rows.

**The catalogue walk.** For any fixed seed and filter:

- following `nextCursor` from the start returns every matching object exactly once before `wrap` is reported;
- the same seed and cursor always return the same objects in the same order;
- a different seed changes the order but never the set.

A cursor the app did not issue answers `400` with field `cursor` and `That cursor is not valid`.

**The duplicate check.** A pair's score is a whole number from 0 to 100. It is the same in both directions and on every call. Results are ordered by score, highest first, then by ascending id.

**The schedule.**

- Days are UTC calendar days, and exactly one piece may hold a day.
- Booking a taken day answers `409` with `<DATE> already has a featured piece`. This holds when two bookings for different pieces arrive at once: exactly one succeeds, never a `5xx`. The loser stays `cleared` with its version unchanged and no audit entry.
- `DELETE` on a day with no booking answers `404`.
- Unscheduling or withdrawing frees the day.
- A booked day's `view_count` rises by one the first time that piece's plaque is opened in a browsing session.
- A published piece with no booked day gains no visits.

**The budget.**

*Quarters and committed.*

- A piece belongs to the quarter in which its `cleared_at` falls. It stays there whatever happens later. A piece with no `cleared_at` is in no quarter.
- Committed is the summed fee of the quarter's pieces in `cleared`, `scheduled` or `published`. Remaining is budget less committed.
- A quarter with no stored row has a budget of 500000 cents.

*Money.*

- Money is whole cents in storage.
- It is shown as `$` with comma thousands and exactly two decimals, which is the form of every `<AMOUNT>`.
- No total is ever produced by adding displayed text.

*Clearing and fee changes.*

- A clear that would take committed above the budget answers `409` with `Clearing this piece would exceed the quarter budget by <AMOUNT>`, where `<AMOUNT>` is the exact overspend against the committed total at that moment.
- Every write that can change a quarter's committed total is decided as though it arrived after the others: a clear, a fee adjustment, a reset and an import. Two clears that each fit alone but not together therefore end in one success and one refusal naming the overspend against the winner's total. Committed never exceeds the budget.
- A fee adjustment adds `delta_cents` to the fee of a piece whose `cleared_at` falls in the path's quarter. A piece outside that quarter answers `400` with field `piece_id` and `That piece does not count against this quarter`. A result outside 0 to 500000 answers with the fee range message.
- An adjustment that would take committed above the budget answers `409` with `Adjusting this fee would exceed the quarter budget by <AMOUNT>`.
- A reset returns every fee in the quarter to `submitted_fee_cents`. If that would take committed above the budget, it answers `409` with `Resetting would exceed the quarter budget by <AMOUNT>`.
- Each changed fee raises that piece's version and appends one audit entry. Its from-state and to-state are both the current state, and its reason is `Fee changed from <AMOUNT> to <AMOUNT>`.

**The cleared-today count.** `<N>` on the public header is the number of pieces whose `cleared_at` falls on the current UTC day. It is computed when the page is requested, so a reload reflects every decision already committed. Because `cleared_at` is set once:

- a clear raises the count;
- an unschedule never raises it;
- a withdrawal never lowers it;
- an import that sets `cleared_at` raises it.

**The audit trail.** It is append-only. No surface and no endpoint updates or deletes an entry, and a refused write appends nothing.

**Preferences.** There is one row per account.

| Preference | Allowed values | Default | Refusal message |
|---|---|---|---|
| `rows_per_page` | 25, 50 or 100 | 50 | `Rows per page must be 25, 50 or 100` |
| `date_display` | `relative` or `absolute` | `relative` | `Date display must be relative or absolute` |
| `high_contrast` | true or false | false | `High contrast must be true or false` |

`rows_per_page` sets how many rows the queue and the audit trail show per page.

**The clearance pack.**

*Refusals.* An import is checked in the order below. The first failure answers `400` and writes nothing at all. `<N>` is the entry's position, counting from 1.

1. `Pack version <VALUE> is not supported` when `meta.saveVersion` is not `1`.
2. `Pack is missing <KEY>`, where `<KEY>` is the dotted path, for example `meta.name` or `pieces.2.title`.
3. For each entry in order:
   - `Fee out of range in piece <N>` for a fee outside 0 to 500000;
   - `Piece <N> has an invalid <KEY>` for a title, summary, state or `object_ids` that fails its rule;
   - `Unknown object <ID> in piece <N>` for an object id that names nothing stored;
   - `A piece named <TITLE> already exists` for a title that matches a stored piece or another entry, ignoring case.
4. `Pack would exceed the quarter budget by <AMOUNT>` when the entries in `cleared`, `scheduled` or `published` would take the current quarter's committed total above its budget.

*Applying.* A clean pack applies completely in one go. Each entry becomes a new piece created directly in its named state, and no existing piece changes. In pack order:

- `owner_id` is the maker whose name or email equals `meta.author`, ignoring case, otherwise the maker created first.
- `version` is 1, `submitted_fee_cents` equals `fee_cents`, and `created_at` and `updated_at` are the import moment.
- `cleared_at` is the import moment for `cleared`, `scheduled`, `published` and `withdrawn`, and empty otherwise.
- `published_at` is the import moment for `published` and `withdrawn`, and empty otherwise.
- No reviews and no acknowledgements are created.
- A `scheduled` entry is booked on the earliest free UTC day from today onward. No other entry holds a day.
- Each piece gets one audit entry with the importing lead as actor, an empty from-state, its state as to-state, and the reason `Imported from pack <NAME>`, where the name is `meta.name`. That lead and `cleared_at` fill the plaque's cleared line.

*Round trip.* An export imported into an empty deployment reproduces every piece's title, summary, fee, state and cited objects.

### Services (DP-03, DP-33, DP-49)

**Postgres** at `DATABASE_URL` is the system of record. The app creates its tables and runs its seed on every start, idempotently. All timestamps are UTC. The tables hold:

| Table | Columns and constraints |
|---|---|
| `accounts` | `id`, `email` (unique, ignoring case), `name`, `role`, `created_at` |
| `sessions` | the app's own session tokens, each with its account and creation time; revoked on sign-out |
| `login_failures` | failed sign-ins per normalised email, with their times |
| `objects` | `id`, `title`, `image_title`, `page_url`, `article_url`, `description`, `extract`, `license`, `license_url`, `artist`, `image_desc_url`, `width`, `height`, `cutout_id`, `mask_w`, `mask_h`, `mask_b`, `shuffle_rank` |
| `pieces` | `id`, `title`, `summary`, `fee_cents`, `submitted_fee_cents`, `state`, `owner_id`, `version`, `created_at`, `updated_at`, `published_at`, `cleared_at` |
| `piece_objects` | `piece_id`, `object_id`, `position`; each pair at most once |
| `reviews` | `id`, `piece_id`, `kind`, `reviewer_id`, `result`, `reason`, `created_at`; at most one per piece and kind |
| `duplicate_acks` | `piece_id`, `object_id`, `duplicate_object_id`, `acknowledged_by`, `acknowledged_at`; each triple at most once |
| `schedule_slots` | `day` (unique), `piece_id` (unique), `view_count` |
| `budgets` | `quarter` (`<YEAR>-Q<N>`), `budget_cents` |
| `audit_entries` | `id`, `piece_id`, `actor_id`, `from_state`, `to_state`, `reason`, `created_at`; never updated, never deleted |
| `preferences` | `account_id`, `rows_per_page`, `date_display`, `high_contrast` |

Nothing is ever deleted except sessions on sign-out, reviews and acknowledgements on revision, and schedule rows when a day is freed.

**Keycloak** at `AUTH_ISSUER_URL`, with the confidential client in `AUTH_CLIENT_ID` and `AUTH_CLIENT_SECRET`, holds the staff identities.

- *Sign-in.* The app exchanges the email and passphrase with the provider server-side. It looks the role up in `accounts` from the identity the exchange returns, never from anything the browser sends. It then issues its own session. The provider's tokens never reach the browser.
- *Registering accounts.* The realm starts empty and allows self-registration, and the app holds no administrator credential for it. On the first successful contact after start, and again on the first successful contact after any period in which the provider was unreachable, the app makes sure every seeded account exists in the realm. It registers any missing account through the realm's own registration flow, using the seeded email, name and passphrase.
- *When the provider is down:*
  - start-up never waits on it or fails because of it;
  - `GET /api/health` still answers `200`, with `identity` set to `down`;
  - sign-in answers the sign-in outage refusal and counts nothing toward lockout;
  - existing sessions, every staff page and API, the wall and the plaque keep working;
  - `/login` renders and shows the outage message.
- *Status checks.* `identity` reflects a contact attempt made no more than 10 seconds before the health response, and the health response itself comes within 2 seconds.
- *Recovery.* When the provider returns, `identity` reads `up` and seeded sign-ins succeed within 60 seconds, with no restart, including when the realm came back empty.

### Seed data (DP-03, DP-11, DP-12, DP-19, DP-24, DP-28, DP-33)

Every seeded person, object and piece is invented.

**Accounts.** Six accounts, each with the passphrase `deku-demo-pw-2026`:

| Email | Name | Role |
|---|---|---|
| `rosa.aldridge@example.com` | Rosa Aldridge | maker |
| `tobias.lund@example.com` | Tobias Lund | maker |
| `priya.raman@example.com` | Priya Raman | licence_reviewer |
| `dan.whitlock@example.com` | Dan Whitlock | access_reviewer |
| `halima.osei@example.com` | Halima Osei | lead |
| `gregor.pyne@example.com` | Gregor Pyne | auditor |

Rosa is the maker created first.

**Catalogue.** Exactly 20000 objects, with ids 1 to 20000.

- Every title is unique.
- `width` and `height` are whole numbers from 40 to 4000.
- Every object whose id is a multiple of 20 carries the licence `All rights reserved`, which is exactly 5 percent of the catalogue. Every other object carries one of the four allowed licences.
- Objects whose id leaves remainder 7 when divided by 1000 have an empty artist.
- Objects whose id leaves remainder 13 when divided by 1000 have no licence address.
- At least 50 pairs score 85 or above, and objects 101 and 102 are one such pair. Every other field is filled in.

**Budget.** One budget row for the current UTC quarter, at 500000 cents.

**Pieces.** Exactly 24 pieces.

- Every piece has a fee and a `submitted_fee_cents` of 2000 cents.
- Every piece in `cleared`, `scheduled`, `published` or `withdrawn` has `cleared_at` at 00:00:00 UTC on the first day of the current quarter. A fresh deployment therefore commits 18000 cents and has 482000 remaining.
- Every piece except Prism Path cites one to four usable objects.
- Orbit Wheel cites object 101 and is the only seeded piece that cites an object with a flagged duplicate.
- In the table, "today" is the UTC day of the first start.

| Title | Owner | State | Notes |
|---|---|---|---|
| Tide Clock | Tobias | draft | history: submitted, review started by Priya, licence review failed by Priya with a reason, revised by Tobias |
| Lever Lab | Rosa | draft | |
| Prism Path | Rosa | draft | cites nothing |
| Echo Chamber | Rosa | submitted | |
| Seed Sorter | Rosa | submitted | |
| Wind Tunnel Mini | Tobias | submitted | |
| Magnet Maze | Rosa | in_review | licence review passed by Priya |
| Orbit Wheel | Rosa | in_review | no reviews; cites object 101 |
| Pulse Lamp | Tobias | in_review | licence passed by Priya, accessibility passed by Dan |
| Gear Garden | Tobias | in_review | no reviews |
| Shadow Clock | Rosa | in_review | no reviews |
| Ripple Tank | Rosa | changes_requested | licence review failed by Priya |
| Bubble Bench | Tobias | changes_requested | accessibility review failed by Dan |
| Colour Mixer | Rosa | cleared | |
| Pendulum Row | Rosa | cleared | |
| Sound Stairs | Tobias | cleared | |
| Fossil Rubbing | Rosa | scheduled | booked three days after today |
| Cloud Jar | Tobias | scheduled | booked five days after today |
| Star Finder | Rosa | scheduled | booked seven days after today |
| Water Wheel | Rosa | published | booked today |
| Bee Dance | Tobias | published | booked the day before today |
| Lens Bench | Rosa | published | booked two days before today |
| Kite Frame | Rosa | withdrawn | no booked day |
| Glow Worms | Tobias | rejected | |

- Every seeded piece carries the audit entries for the steps that brought it to its state, each acted by the matching seeded account, with Halima for every lead step.
- Each published piece's `published_at` is 09:00 UTC on its booked day.
- No seeded reason begins with `=`, `+`, `-`, `@`, a tab or a carriage return.
- No preferences rows exist at start.
- Seeding is idempotent. A restart never duplicates rows and never removes or alters anything that has been changed.

## Technical requirements

### Deployment (DP-01, DP-02)

**Runtime and manifest.** Python 3.12 is available. Include `/app/run.json` with `"_schema":"run-manifest-v1"` and the string commands `install`, `build` and `serve`. The following is an example only:

```json
{"_schema":"run-manifest-v1","install":"pip install --retries 5 --timeout 120 -r requirements.txt","build":"","serve":"python -m gunicorn -b 0.0.0.0:${APP_PUBLIC_PORT:-4173} -w 4 app:app"}
```

**How grading runs it.** Grading copies `/app`, then runs install, build and serve as an unprivileged user with freshly provisioned credentials.

- `serve` stays in the foreground: no daemon, no `nohup` and no trailing `&`.
- It runs a production server, never a development server.
- It binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, which is 4173 inside the container. The public address is in `APP_PUBLIC_URL`.

**Start-up.** The app creates its schema and runs its seed on start with no manual step. `GET /api/health` answers `200` with the API section's health body once the schema and seed are in place.

**Rendering.** Every page answers `text/html` with its headings, copy and data rendered on the server. Script only updates parts of the page that change after it has loaded.

### Configuration and secrets (DP-03, DP-37, DP-49)

Read these at start, never hard-code them, and never send them to the browser:

| Variable | Holds |
|---|---|
| `DATABASE_URL` | the `postgres` database |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL` | the identity provider and its realm |
| `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | the confidential client |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | where the app is served |
| `LOGIN_LOCKOUT_SECONDS` | optional; the lockout window in seconds, defaulting to 900 |

Values differ when graded. Both backing services are already running. Never download, install or start a copy of either.

### Server boundary (DP-01, DP-37, DP-49, DP-51)

**Origin and host.**

- The API serves its own origin only and sends no cross-origin allowance headers.
- Cross-site writes, request size limits and content types are refused as the refusal order states.
- Every page and route answers the same whatever host name the request carries, including `localhost`, the address in `APP_PUBLIC_URL` and a service name containing an underscore.

**What the server never serves.** It never serves its source files, its run manifest, environment values or any credential, and no response body, header or page carries a secret.

**Start-up with dependencies down.** An unreachable identity provider at boot never stops the app from starting or answering health, and the app recovers as Services sets out. If `postgres` is not yet reachable, the app keeps retrying, and health answers only once the database is ready.

**Backing services.** The only backing services are `postgres` and the identity provider. Never introduce another database, cache, queue, file store or vendor. Every piece, review, acknowledgement, booking, fee, session, lockout count, preference and audit entry lives in `postgres`. None of it lives in memory, in browser storage or in a file.

### Browser support and performance (DP-34, DP-37)

**Browsers and widths.** Target current Chromium at 375 by 812, 768 by 1024 and 1280 by 800, and every width from 320 pixels up.

**Assets.** Every script, style, font and picture comes from this deployment. Pages make no request to any other host and contain no off-site link. There are no analytics, font hosts, icon services or image hosts. The stylesheet is the app's own, with no utility-class framework, bundle fingerprint or third-party version string in the markup.

**Speed.**

- The queue, the wall and the catalogue each return their first HTML response within two seconds on a local deployment with the seeded data.
- The catalogue never sends the whole catalogue to the browser.
- A single API request answers within five seconds.

## Working rules

- **IF-01** `/app/run.json` is valid JSON carrying `"_schema":"run-manifest-v1"` and string `install`, `build` and a non-empty foreground `serve`.
- **IF-02** `/app/USER_README.md` lists the six seeded emails, their roles and the passphrase `deku-demo-pw-2026`.
- **IF-03** Empty `.browser_screenshots/` and `.downloads/` directories exist at the app root.
- **IF-04** `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its licence. Shipped packages means the production dependency tree: everything the `install` command installs, including transitive dependencies (the lockfile's non-dev group), and no test or development tool.
- **IF-05** Every shipped package carries one of MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0, MPL-2.0 or LGPL-3.0-or-later.
- **IF-06** No shipped package is a client for any datastore other than PostgreSQL, and the app writes no database file of its own.
- **IF-07** The provided service configuration and the realm's client settings are left untouched.

## Engineering standards

- The code is idiomatic Python 3.12, and names for states, roles, actions and money match the terms used in this brief.
- Each domain rule is decided in exactly one place in the source: the transition table, the refusal order, visibility of another maker's draft, the budget check, the cleared-today count and spreadsheet-safe export.
- Every refusal is produced through one error shape, and no handler builds its own variant.
- Money is whole cents from storage to response. It is formatted only where it is displayed.
- No abstraction has a single implementation, and no defensive check guards a state the rules make impossible.
- There is no dead, commented-out or unreachable code, and no feature, endpoint or screen beyond this brief.
- Each write is applied as one unit together with its audit entry, so a refused or failed write leaves nothing behind.
