# TRUTH — Kinfold golden

The intended behaviour of the app, made concrete. Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## 1. Journeys, end to end

### J1. Ruth sets up the week (brief: Journeys 1)
- Start: Ruth Hale (workspace admin of "Hale family", admin of both boards) is signed out at 1280x800; Sam has "Weekly care" open in another browser. (brief: Journeys 1)
- `/signin` shows `heading level 1 "Sign in to Kinfold"`; she types `ruth@kinfold.test` / `Kinfold-ruth-2026`; the button reads `Signing in…`, then the browser goes to the reply's `redirectTo` (`/`), which goes to the first board by name visible to the whole workspace: "Weekly care", under the masthead `Margaret Hale`. (brief: Screens, Feedback states)
- The empty "Waiting on others" list shows `Nothing here yet. Add a card when something needs doing.` She presses `Add a card to Waiting on others`, types "Collect blood pressure cuff", Enter: the card is created (`POST /api/lists/<id>/cards` with an `Idempotency-Key`), `Added Collect blood pressure cuff to Waiting on others.` is announced, the list count reads `1 card`, the field stays open. (brief: Interactions Add a card)
- `New board` (drawer, workspace admins) opens `dialog "New board"` with "Only board members" selected; "Paperwork for Mum" + `Create board` (button reads `Creating…`): the dialog closes, the browser adds a history entry for `/boards/<newBoardId>`, the drawer link is `aria-current="page"`, the board area shows `This board has no lists yet. Add a list to get started.` and focus is on `Add a list`. Reload shows the same. `Add a list` reveals `New list name`; "Paperwork" + Enter creates it, hides the field and focuses `Add a card to Paperwork`. (brief: Landing after creating)
- Back on "Weekly care", `Board settings` opens the dialog; the `Add a person` picker offers only Theo Marsh (candidates come from the API); `Add to board` adds him as Member; `Role for Theo Marsh` → `Observer` sends exactly `{"role":"observer"}`; a request with any other key is refused with 422 on that key. (brief: Journeys 1, API Published request keys)
- "Money and house" from the drawer; Sam's role → Observer.
- End: Sam's open "Weekly care" shows the new card and the new count with no reload (live event `card.created`). The permission log (`Account` → `Permission log`, `/workspaces/<id>/permission-log`) shows attributed entries: Ruth as the new board's admin (`board.member_added`, before `none`, after `admin`), Theo's addition and role change, Sam's role change on "Money and house". (brief: Journeys 1, Business rules Permission log)

### J2. Sam moves a refill by keyboard (brief: Journeys 2)
- Start: Sam (member) on "Weekly care" 1280x800; Priya has the same board open. He focuses `Refill lisinopril`, presses Space (`Picked up Refill lisinopril in Inbox, position 1 of 3. Use the arrow keys to move, Space to drop, Escape to cancel.`), Right (`Refill lisinopril is over Pharmacy, position 1 of 4.`), Down (`… position 2 of 4.`), Space: one `POST /api/cards/<id>/move`, then `Moved Refill lisinopril to Pharmacy, position 2 of 4.` with positions and totals from the reply. (brief: Announcements)
- Priya's browser: the card glides from Inbox to Pharmacy in 320 ms carrying Sam's colour (clay) and the chip `SH` for 2 s, fading over the last 0.4 s, gone 2.5 s after the event; both browsers show the new list counts. (brief: Motion 4)
- `Move to…` gives the same list and position through the Move card dialog. (brief: Move to…)
- Sam cannot see the private "Memory clinic results"; lifting "Dental cleaning" and Up, Space gives `position 1 of 2`; Ruth's board shows position 1 of 3 before "Ride to cardiology on Thursday". (brief: Journeys 2, DP-16)
- `Mark done` then `Archive` on "Pick up eye drops": counts and sentences follow the server; after Archive focus lands on the card that took its place. (brief: Status from the actions menu)
- On the phone (375x812) he adds "Ask for the 50% copay card"; typing `re`, pausing, finishing `refill` — the reply for `re` is never painted; `50%` finds only the copay card. (brief: Search rules)

### J3. Two siblings grab the same card (brief: Journeys 3)
- Both open "Weekly care" with "Pick up eye drops" at version 1. Each moves it to a different list at once; exactly one write wins (per-board lock, version check). Priya's browser loses: the reply is 409 `stale` with the card, `changedBy` and `change: "moved"`; the card glides back to the server's place in 320 ms; `Sam Hale moved Pick up eye drops first. It's back in Aide visits, position 1 of 3.` is announced and added to Notices; her board adopts the reply's card and version. Space, Right, Space succeeds first time. Both browsers agree; every list's positions are 1..N. (brief: Interactions Optimistic move)

### J4. Dolores reads Tuesday's visit (brief: Journeys 4)
- Ruth signed out on the kitchen tablet after opening "Move metformin to mail order" and searching "discuss"; Dolores (observer) signs in on the same tablet (768x1024, Pacific/Honolulu, reduced motion). Back shows nothing of Ruth's board, search or notes (sign-out reloads to `/signin`, clears the store, and a signed-out flag sends Back to plain `/signin`). (brief: Sign out)
- She sees two lists side by side, picks the tab "Aide visits", opens "Tuesday visit": a read-only dialog (title, labels, due date, owner, checklist as disabled checkboxes; no notes, attachments, privacy, delete or phone numbers), `Close` focused. Her drawer counts only cards she may see (10 open). (brief: Card dialog)
- Ruth sets "Tuesday visit" due today and moves "Friday visit" to "Waiting on others": the label comes from the server's `dueState` in the workspace time zone; "Friday visit" jumps into place (no animation) with Ruth's chip and a still 2 px outline for 2 s, and `Ruth Hale moved Friday visit to Waiting on others, position 1 of 1.` is announced. (brief: Reduced motion)

### J5. Ruth attaches a discharge sheet (brief: Journeys 5)
- A PNG labelled as PDF is refused (415, nothing stored): `<filename> isn't a PDF, JPEG or PNG.` Then `Entlassung Müller "final".pdf`: the row `Uploading Entlassung Müller "final".pdf…` shows a progress bar; the attachment appears (link + `Remove …`) only after MinIO confirms the stored size; `Attached Entlassung Müller "final".pdf.` is announced. The download returns identical bytes with `Content-Disposition: attachment; filename="Entlassung M_ller _final_.pdf"; filename*=UTF-8''Entlassung%20M%C3%BCller%20%22final%22.pdf`, `X-Content-Type-Options: nosniff`. With storage down: the banner `Attachments are unavailable right now. Cards, moves and checklists still work.`, upload fails `Couldn't attach <filename>. Attachments are unavailable right now.`, moves and checklists still work. (brief: Attachments, Feedback states)

### J6. Ruth's week away, and access that ends at once (brief: Journeys 6)
- Phone 375x812: tabs found by name; `Dental cleaning` opens at `/cards/<id>` (history entry); Back closes to Appointments with focus on the card; reload keeps Appointments (`?list=<listId>`).
- Sam (made workspace admin) drags "Renew home insurance" while Ruth makes it private to herself and Priya: his move answers 404, the card leaves his board, the move is not applied, `Renew home insurance is no longer shared with you.` is announced and added to Notices; the permission log shows `Private card` for it.
- Sam changes his password (`Changing…`, `Password changed. Every other session is now signed out.`), his phone stays signed in, his other sessions end. Ruth demotes Sam to Observer on "Weekly care" and removes Dolores: Sam's open dialog becomes read-only within 2 s with `Your access to this board is now Observer.`; Dolores's board shows `We couldn't find that board`; the laptop's next request is 401 → `/signin?next=%2Fcards%2F<id>`; signing in reopens the card; an off-site `next` lands on `/`. (brief: Journeys 6, Business rules)

### J7. Live updates pause honestly (brief: Journeys 7)
- Priya on the instance whose relay is unreachable: banner `Live updates are paused. Your changes still save, but others' changes won't appear until live updates are back.` Her moves save and announce with the server's counts. A minute re-read or the relay returning never wipes her draft, notices or selected list. When Valkey returns the stream sends `live.resumed`, the banner clears, `Live updates are back.` is announced and the board re-reads itself.

## 2. Palette (decided hex values for the brief's roles; brief: Visual design)
| Role | Hex | Why |
|---|---|---|
| oat ground | `#EEE6D6` | brief: warm oat, no gradients (hsl 41°/41%/88.6%) |
| cream surfaces | `#FBF7EC` (columns, dialogs, menus), `#FFFDF7` (cards) | brief: cream for list columns, dialogs and cards |
| ink | `#2A251E` | brief: deep warm near-black; 14.2:1 on cream |
| muted | `#5B5244` | decided: 7.2:1 on cream for counts and hints |
| hairline | `#D8CDB4` | brief: hairline rule |
| control border | `#857A5E` | decided: 3:1 non-text on cream and oat |
| sage | `#3B5B40` | brief: deep sage for primary actions, links, selected tab, focus ring; 7.1:1 |
| brick | `#9E2F1C` | brief: only `Overdue`, field errors, destructive actions; 6.8:1 on cream |
| mover sage / clay / plum / ochre / slate / rose | `#45694A` / `#9A4A2C` / `#6D3A62` / `#80570C` / `#3C5670` / `#A03650` | brief: six mover colours ≥ 3:1 against cream, cream initials ≥ 4.5:1 (measured 5.8–8.1) |

## 3. Type (brief: Type)
Literata 600 (variable, self-hosted) for the masthead 31/36 px (h1), board name 25/32 (h2) and list headings 20/28 (h3), each step ×1.25; Atkinson Hyperlegible 400/700 for everything else at 16/24 px minimum. decided: phone masthead 25 px so "Margaret Hale" fits beside the Boards and Account buttons.

## 4. Space and layout (brief: Screens and layout; decided where silent)
- All spacing is a multiple of 4 px; controls ≥ 44 × 44 px; focus ring 2 px sage, offset 2 px.
- 1280x800: top bar (masthead, search, Account), 200 px drawer with each board's `<n> open` count right-aligned on the link's row, current board 700 and the rest 400 (decided: board names wrap less and the drawer keeps an even rhythm), five list columns side by side inside the viewport (no tablist), `Add a list` after the last column as a 96 px column with a `+` over the visible words `Add a list`, outlined like every other outlined button (solid 1 px `#857A5E`, 6 px radius, cream) because the dashed outline is kept for the lift placeholder (decided: the action is named on sight while the columns keep their width); list column = h3 in a box two display lines tall with the name at its foot so every rule and count line up from 768 px up, hairline rule, count text, cards, `Add a card to <list>`. Card face: 1 px hairline on all four sides at rest; the title spans the card's full width, then one wrapping meta row in the order labels, due label, Done mark, progress, lock, owner chip, mover chip, with `Actions for <title>` pinned to the row's end (decided: titles wrap less in ~200 px columns and the Actions buttons line up down a column). Dialog footers: hairline rule, 16 px above the buttons, 24 px below and at the sides (decided: the dialog's own 24 px edge).
- 768x1024: drawer visible, `tablist "Lists"` (tabs 12 px side padding, all five on one row; a strip too narrow for its tabs wraps them onto another row rather than clipping one — decided: no tab is ever cut off), two neighbouring lists (the last pairs with the one before), `Add a list` beside the tabs.
- 375x812: `button "Boards"` (`aria-expanded`) opens a sheet dialog; `tablist "Lists"` above one list filling the width; card dialog fills the screen.
- No width scrolls the page sideways; the lists row scrolls inside the board area.
- Observer card dialog: read-only checkboxes keep the 2 px control border (`#857A5E`) at full opacity with ink text (decided: the aide's main view on a kitchen tablet); the first control focused on open (`Close`) shows the 2 px sage ring even after a pointer open.

## 5. Motion table (brief: Motion and effects)
| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| lifted card | Space / drag > 4 px | 140 ms (`scale(1.03)`, shadow) | cubic-bezier(0.2,0.8,0.2,1) | dashed placeholder at once, nothing scales |
| destination slot (pointer drag) | target changes | 180 ms height | same | no transition |
| drop | Space/Enter/release | 180 ms | same | none |
| own move reply (drop or Move card dialog) | server accepts | none when the reply keeps the optimistic order (decided: the card already settled at once, so the same card must not move twice); 320 ms glide only for cards the server placed elsewhere | same | jump |
| hand-off glide | remote move event | 320 ms WAAPI on the card item, FLIP from its current on-screen place; a later event retargets from where it is | same | card jumps |
| mover chip + 4 px left-edge tint (in the mover token) | remote move | 2000 ms full, 400 ms fade, removed at 2500 ms; per-card timer restarts for a later mover | linear | chip + still 2 px outline 2000 ms, no fade |
| stale snap-back | stale reply | 320 ms | same | jump |
| dialogs, menus, sheet | open | 160 ms fade and 4 px settle | same | none |
| upload bar | uploading | 1200 ms repeating (the only loop) | linear | static text |

## 6. States per async action (brief: Feedback states)
Sign in `Signing in…` / `That email and password don't match.` (alert, `next` kept); 401 anywhere → `/signin?next=<path>` (plain `/signin` for `/`) with `You've been signed out. Sign in again to continue.` (status); Change password `Changing…` / success / field errors; Create board `Creating…` / `Give the board a name.` / `Keep the name to 60 characters or fewer.`; Add a list and Create card disable their field until the reply, with the published messages; Save card `Saving…`, stale → stale sentence, 403 → `You can no longer edit this card.`, 404 → no-longer-shared; Move or status settle at once; Checklist checkbox disabled until the reply; Upload row `Uploading <filename>…`, errors as published; Download failure → Notices; Delete `Deleting…`, 503 → `Couldn't delete while attachments are unavailable. Try again shortly.`; role change, removal, visibility disable the item until the reply, last admin → `A board needs at least one admin.`; unexpected → `Something went wrong. Try again.` in Notices.

## 7. Server truths (brief: API, Business rules, Services)
Error precedence: boundary (413, 415, cross_origin) → 401 → 405 → idempotent replay → 404 → 403 → 409 → 422 → 503. One 404 body for every reason. A change and its permission-log entry commit in one transaction. Cards carry versions; any stale write is refused whole; of N same-version writes one wins (board-level advisory lock). Ranks are dense 1..N per list. Search is literal, Unicode case-insensitive, 2–100 code points, ≤ 50 results plus `total`. Streams: relay events for card/list/board changes shaped per recipient; access and session changes re-checked against PostgreSQL every second so a stream closes within 2 s even with the relay down.

## 8. Media and licences
No photographs. Inline SVG line icons and the larkspur sprig and favicon are drawn for this app (licence: original). Fonts: Literata (OFL-1.1, © 2017 The Literata Project Authors), Atkinson Hyperlegible 400/700 (OFL-1.1, © 2020 Braille Institute of America, Inc.), self-hosted woff2 listed in `app/assets.json`. Production packages: pg, ioredis, react, react-dom and their trees, all MIT, ISC or Apache-2.0 (see `THIRD_PARTY_NOTICES.md`).
