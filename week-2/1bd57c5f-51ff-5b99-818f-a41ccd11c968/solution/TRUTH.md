# TRUTH — Plumb & Pencil Snaglight

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flow)

### 1. Set up a job (DP-06)
- Start: seed firm Larchmere Renovation Co.; owner `dana@larchmere.example` / `paper-plan-2026` (brief: Seed data).
- Sign in at `/signin` (heading `Sign in`, fields Email, Password, `button "Sign in"`) → `/jobs`, heading `Your jobs`, rows for `Hale kitchen and bath` and `Oduya basement` with stage `Active` and `16% verified` / `0% verified` (brief: Screens; Seed data example).
- `button "New job"` → `dialog "New job"` (fades in 0.18 s) with Job name, Address, Time zone (a native select of every IANA name; typing a name jumps to it: decided — "searchable list" without a library) → `button "Create job"` → Activity `Job created.`; the app opens the new job on its Setup tab (decided: the next step of the journey is the plan).
- Setup tab: `button "Upload plan"` opens the hidden file input labelled "Upload plan" → `PUT /api/jobs/{id}/plan` → Activity `Plan uploaded.`; plan revision 1 stored at `jobs/<job id>/plan/<object id>.<ext>` (`<ext>` from the detected type, `png` here) with metadata stripped; `plan_url` becomes `/api/jobs/<id>/plan`, `plan_revision` 1; `table "Plan revisions"` lists it (brief: API, Services).
- `button "Add room"` → `dialog "Add room"` with Room name and Corners (`4,5; 52,5; 52,30; 40,30; 40,47; 4,47` is the L-shaped Kitchen) → `button "Save room"` → Activity `Room saved.`; each percent ÷ 100 sent as the outline; the server stores the corners and answers bounds and anchor (0.28, 0.26). A pantry `30,10; 50,10; 50,20; 30,20` inside the Kitchen → `alert "There is a problem"` with a link per field error and `Rooms can't overlap.` under "Corners"; three corners → a free-text outline message under "Corners" (brief: Interactions — Adding a room; Feedback states; Room outlines).
- People & visits: `button "Add person"` → `dialog "Add person"` (Name, Email, Phone, Role [Lead carpenter/Trade/Homeowner], Trade, Initial password) → `button "Add"` → Activity `Person added.`; a new email creates an account with a salted scrypt hash.
- End state: Postgres holds the job, owner membership, rooms, members; MinIO holds one plan object. The new homeowner signs in and sees only that job; opening another family's job shows `We can't find that page.` + `link "Back to your jobs"`.

### 2. Walk a room by keyboard (DP-11)
- Lead opens a job with rooms. Tab order: top bar → tabs → House access region (trades only, when shown) → quick add field → `combobox "Quick add room"` → `combobox "Show room"`, `combobox "Show status"`, `combobox "Show trade"` → bulk controls (`button "Check off <k> shown"`, `combobox "Assign shown to"`, `button "Assign <k> shown"`) → conflict groups under `region "Needs a decision"` when present → rows in list order (inside a selected row, its buttons then its details controls) → plan pins in number order → `Fit plan` (brief: Interactions — Tab order on the Punch list).
- Type in `Quick add item`, Enter → row appears at once in its room (optimistic) → server answers → Activity `Item <n> saved.`; focus stays in the cleared field.
- Focus the row, `P` → crosshair (`[data-crosshair]`) at the room's anchor (the widest segment of the horizontal centre line, its midpoint); readout in `status "Pin placement"`: `Placing pin for item <n>: <x>% across, <y>% down.`; arrows move 1%, Shift+arrows 5%, clamped to 0–100%; Enter → `PATCH pin` → `Pin dropped for item <n> in <room>.`; a refused pin keeps the crosshair and shows `Drop the pin inside a room on the plan.`; Escape cancels and returns focus to the row (brief: Keyboard pin placement).
- Details `combobox "Trade"` → saves on change → `Item <n> saved.` and the row label shows the trade; `button "Check off item <n>"` → `Item <n>: Verified.`
- Then `P` on the verified crew item, Shift+→ ×7, Enter → `Pin dropped for item <n> in Primary bath.`; the row moves to the Primary bath group under the same number, both groups' `<v> of <t> verified` and both plan labels change, and the owner's laptop shows it within 2 s through the event stream.
- End state: item row in Postgres with number, room, trade, pin; an assignment notice queued for each active member of the trade; one `item` event (and a `counts` event when counts changed) per commit in the job's event log.

### 3. Walk a basement offline (DP-22)
- Connection lost → `status "Connection"` reads `You're offline. Changes are saved on this phone and will sync when you reconnect.`
- Adds, edits, check-offs and notes apply on screen at once, queue in localStorage (`snaglight:queue:<email>:<job>`) and each changed row reads `Waiting to sync`; photo inputs are disabled with `Photos need a connection.`; owner setup controls are disabled. A reload offline reopens the job from the service-worker shell and the cached snapshot with the queue applied (brief: Interactions — Offline).
- Reconnect (the `online` event, or within 5 s by the retry timer) → `POST /sync` with the queued ops in order → Activity `Sync complete: <synced> synced, <conflicts> to review.` Accepted changes settle; a rejected check-off reverts to the server's status and the row shows `Not saved: <message>` (e.g. `Not saved: Waiting on the trade's completion photo.`) until the next change to that row; a title edited on both sides lands under `region "Needs a decision"` with `<name> set <value text>` lines and `Keep <value text>` buttons; choosing one → `Conflict resolved.` and the group disappears for everyone within 2 s through the event stream (the 15 s refresh is only the fallback) (brief: Interactions — Live updates).
- End state: `sync_operations` holds every applied/conflict op with its content; replaying the same op_ids answers `duplicate` and creates nothing.

### 4. A trade's visit day (DP-31)
- Owner schedules the electrician (`dialog "Schedule visit"`, job-local times) and assigns an item → Mailpit receives `Snaglight: new item on <job name>` with `Item <n>: <title>`, `Room: <room>`, `Sign in to see the details: <APP_PUBLIC_URL>/signin` and no codes, address, cost note, notes or phone (brief: Services).
- Electrician sees only electrical items. `region "House access"` → `Show access codes` → Lockbox, Alarm, Garage, House note and `Codes visible until <HH:MM>` (job-local visit end); the page removes the codes at that moment. Outside the window the region shows `Access codes show from 30 minutes before your next site visit.` and `Next visit: <YYYY-MM-DD HH:MM>`.
- Completion photo → row text `Photo uploading` until stored → `Photo saved.` → `Mark item <n> done` → `Item <n>: Ready for check.`; the lead verifies → `Item <n>: Verified.`; the owner's `table "Code reveals"` lists the electrician.

### 5. The homeowner follows along (DP-40)
- Homeowner on a phone: quick add in the Hall → `Item <n> saved.`; room headings show `<verified> of <total> verified`; empty rooms read `No items in this room yet.`; tapping a row opens the plan sheet framed on its room with its pin (no tether); notes shown are `everyone` only; no cost notes or codes.
- From 18:00 job-local, once per local day, a summary `Snaglight: walkthrough summary for <job name>, <YYYY-MM-DD>` with `<p>% verified (<v> of <t> items)`, one line per room `<room>: <verified> of <total> verified`, one line per tomorrow occurrence `Visit <YYYY-MM-DD> <HH:MM> to <HH:MM>: <trade label>` (or `No site visits tomorrow`), one line per changed item `Item <n>: <title> — <status label>` (or `Item <n>: <title> — Removed`), and the sign-in link `Sign in to see the details: <APP_PUBLIC_URL>/signin` (brief: Services; Business rules — Daily walkthrough summary).

### 6. Offboard a trade after a lost phone (DP-34)
- Owner: People & visits → `button "End role for <name>"` → `dialog "End role"` → `button "End role"` → `Role ended for <name>.`; the member's visits are deleted and every request to the job answers 403 `role_ended`.
- The tiler's open tab: within 15 s the refresh is refused → codes cleared → `Your access to this job has ended.` + `link "Back to your jobs"`.
- Owner changes password at `/account` → `Password changed. Every other session is signed out.`; the lost phone's next refresh gets 401 → sign-in screen with `You've been signed out.`; the laptop stays signed in.

### 7. Close out (DP-42)
- Owner: `Start walkthrough` → `Walkthrough started.`; stage label `Walkthrough`. Remaining items verified. `Close out job` → `dialog "Close out job"` → `Close out` → `Job closed out.`; stage `Closed out`; no stage buttons, no quick add, no row actions.
- Unverified items → the dialog shows `Every item must be verified before close-out.` and the job stays in walkthrough.
- End state: every plan and photo object under `jobs/<id>/` deleted from MinIO, then their records; `plan_url` null; every write answers 409 `job_closed`.

### 8. Document a defect (DP-25)
- Lead selects an item → `Add defect photo` → row reads `Photo uploading` → `Photo saved.` and the thumbnail appears in `list "Photos"`. The stored PNG/JPEG/WebP has EXIF, XMP, IPTC, comments and PNG text chunks removed. The homeowner sees the same photo.
- Storage unreachable → Activity `Storage is unreachable; nothing was saved. Try again shortly.`, no thumbnail, no record.

### 9. Edit a note together (DP-53)
- Lead (offline) opens `Edit note`, types `Fix tile grout`, `Save note` → queued `edit_note` op (base = the rev the editor opened at, one edit from the longest common start and end in code points); the row reads `Waiting to sync`.
- Owner (online) edits the same note to `Fix tile today` → `Note updated.`
- Reconnect → both screens show the character-model merge: `Fix tile today grout` when the owner's member id sorts before the lead's, else `Fix tile grout today` (brief: Character model, worked example).
- Lead `Undo my edit` → `Edit undone.`, body `Fix tile today`; owner `Undo my edit` → `Fix tile`. History kinds create, edit, edit, undo, undo; replaying the sync body answers `duplicate` and adds no revision.

### 10. Book a recurring visit (DP-56)
- `dialog "Schedule visit"`: Person, Starts, Ends (job-local), Repeats `Weekly` with `Mon`–`Fri` checked, Ends `On date`, End date thirteen days after the start, the dates spanning a clock change (brief: every weekday morning for two weeks; a `Daily` series with Ends `After count` works the same way) → `Visit scheduled.`; `table "Site visits"` lists one row per occurrence at the same local time, across a clock change too (each date's own offset).
- `Cancel visit on <starts>` → `Visit cancelled.`, row status `Cancelled`; the trade's `next_visit` skips it; the summary's visit lines omit it.
- The electrician's phone clock is 5 hours off: `Show access codes` still shows the codes and `Codes visible until <HH:MM>` from the server's `visible_until`; the codes go when the server's time passes it (judged from the reply's Date header, counted down in a worker).

### 11. Revise the plan (DP-59)
- Setup → `Upload revision` → `dialog "Upload plan revision"`: Revision image, Reference points `10,10 > 14,14; 90,10 > 86,14; 10,90 > 14,86`, each `<room> corners` prefilled and edited → `Plan revision 2 uploaded: <moved> pins moved, 1 need review.`
- Pins map through the exact affine transform, rounded to 0.0001 halves up, and re-file by the new outlines; a pin landing in the Kitchen notch is cleared and reads `Pin needs review`; the header shows `1 pins need review`.
- A queued phone pin stamped with revision 1 maps through revision 2 before merging and applies with no conflict. Collinear points → `Pick three reference points that are not in a line.` under Reference points and nothing changes.

### 12. Review costs (DP-62)
- Details Quantity `2.5`, Unit cost `0.05` → `Line total $0.12` (half to even).
- Costs tab: `Change order description`, `Change order amount` → `Add change order` → `Change order added.`; `Approve <description>` → `Change order approved.`; Contingency percent `10.00` → `Save contingency` → `Contingency saved.` The lead's open Costs tab updates in place from the `costs` event: `Total $<x>`.
- A lead's offline unit-cost change from null → `0.07` lands under `Needs a decision` as `Item <n>: Unit cost`. `GET /costs?as_of=<change order created_at>` reproduces the earlier total.

### 13. Bulk-check a room (DP-65)
- Lead: Show room `Kitchen`, Show status `Open`, Assign shown to `Tile` → `Assign 2 shown` → `2 items assigned to Tile.`; the tiler gets one notice per item.
- Show room `Hall` → `Check off 2 shown` with a blocked item → `alert "Nothing changed"` with `Item <n>: Finish the items this one is waiting on first.` and Activity `Not saved: None of the items changed.`; nothing changes, no email, no event.
- Owner reopens a verified blocker → `Item <n>: Open.`; its ready-for-check or verified dependents go back to open everywhere within 2 s.

### 14. Two devices stay in step (DP-68)
- Owner moves a pin into Laundry → the homeowner's row moves group and both count texts change within 2 s.
- The homeowner's tab goes offline while the owner deletes an item and edits a note; on reconnect the stream resumes from the last sequence number (or a `reset` reloads) and the list equals a fresh load.
- The lead's half-typed `Add a note` text survives every incoming event and refresh.

## Palette (hex values the build uses)

| Role | Hex | Source |
|---|---|---|
| ground (paper) | `#F3EEE3` | brief: Visual design — warm off-white paper; decided: hue 41°, lightness 92% |
| sheet (plan sheet, dialogs, Activity) | `#FBF8F2` | decided: lighter paper layer instead of a shadow |
| ink (graphite) | `#24262A` | brief: near-black graphite ink |
| ink-muted | `#55585E` | decided: secondary text, 6.2:1 on ground |
| rule (hairlines) | `#CDC5B4` | brief: single hairline rules |
| rule-strong (control edges) | `#8B8574` | decided: 3.2:1 for WCAG 1.4.11 |
| blueprint | `#2C5A85` | brief: outlines, tether, selected-row bar, links |
| blueprint wash (selected row) | `#DDE6EE` | brief: pale blueprint wash |
| grid | `#2C5A85` at 16% stroke opacity, 24px cells | brief: faint grid of small squares |
| safety orange — fills (pins, crosshair) | `#F06A1D` with a 1.5px ink edge | brief: safety orange for pins and the crosshair; decided: the ink edge gives 3:1 |
| safety orange — thin lines (every focus ring, the reduced-motion ring) | `#C2470C`, 3px | brief: every focus ring and the reduced-motion ring in safety orange; decided: the same orange role in its deeper tone so a 3px line meets 3:1 (WCAG 1.4.11) on paper |
| done green | `#1E6A3B` (white check) | brief: deep green for verified status and check-mark pins |
| offline banner | `color-mix(#F06A1D 12%, #F3EEE3)` | decided |
| errors | ink text + 4px blueprint left rule | brief: Errors |

## Type

| Use | Face | Size | Source |
|---|---|---|---|
| h1 screen titles | Archivo 700, `font-stretch: 75%`, uppercase, `letter-spacing: 0.06em` | 28.8px | brief: Type (about twice body) |
| h2 room and section headings | same | 24px | brief: about 1.5× body; one fifth above h3 |
| h3 dialog titles | Archivo 600 | 20px | decided: one fifth below h2 |
| body | IBM Plex Sans 400/500/600 | 16px / 1.5 | brief: Type |
| numbers (item numbers, counts, %, times, readouts, codes) | IBM Plex Mono 500, tabular-nums | inherit | brief: mono numerals |

All faces are self-hosted woff2 from the Fontsource packages under SIL OFL 1.1 (brief: Fonts).

## Space and layout per viewport

| Viewport | Layout | Source |
|---|---|---|
| Costs tab | ≥ 1024: Cost by room and Cost by trade side by side above the totals; < 1024: one column | brief: Screens and layout |
| ≥ 1024 (1280×800) | list pane `2fr` (40%) left, plan pane `3fr` right; the page scrolls the list while the top bar and job header stay put and the plan pane stays beside the list at the remaining height (sticky); Activity strip fixed under the list (40% wide) on the Punch list tab, full width on other tabs | brief: Punch list layout |
| 768–1023 (768×1024) | list full width minus a 56px rail; rail button `Show plan` (`aria-expanded` false); expanded panel covers 50%→(100% − rail) | brief: Punch list layout |
| < 768 (375×812) | list full width; fixed bottom bar `Show plan`; plan in `dialog "Plan"` 76% of the height; `Close plan` in the sheet's footer bar, the same spot as `Show plan` | brief: sheet ≥ three fifths; decided: thumb reach |
| all | rows ≥ 56px, every target ≥ 44×44px; 4px spacing unit; no horizontal scrolling | brief: Density |

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| selected row wash (`background-color`) and bar (`opacity`) | selection | 180ms | `cubic-bezier(0.22, 1, 0.36, 1)` | end state at once | brief: Row highlight |
| row hover wash | pointer hover | none (instant) | — | same | brief: Row highlight |
| plan pan/zoom (`--tx`, `--ty`, `--zoom` via WAAPI) | row/pin selection with plan visible (`Fit plan` jumps to the whole plan at once, no animation) | 420ms | same | jump to the framed room | brief: Room tether 1; Motion and effects (no other motion) |
| tether line (`stroke-dashoffset`, `<line data-tether="n">`) | after the pan ends | 320ms | same | not drawn; `Pinned in <room>` on the row | brief: Room tether 2 |
| pin pulse (`scale` 1 → 1.25 → 1, one iteration) | when the line arrives | 320ms | same | static 3px orange ring | brief: Room tether 3 |
| tablet rail panel (`transform: translateX`) | Show plan toggle | 320ms in and out | same | end state at once | brief: Rail and sheet |
| phone sheet (rises from the bottom edge: its top edge climbs from the bottom of the screen to 76% height on open and drops back the same way on close; the `Close plan` footer stays put) | open / close | 320ms in and out | same | end state at once | brief: Rail and sheet — the phone sheet rises from the bottom and leaves the same way; decided: the close control must not move under a finger |
| dialogs (`opacity`) | open | 180ms; closing instant | same | end state at once | brief: Dialogs |

Nothing else moves: no spinners, shimmer, loops or idle motion (brief: Motion and effects).

## States per async action

| Action | Pending | Success (Activity) | Error |
|---|---|---|---|
| Sign in | button disabled + busy, text `Saving` | goes to Your jobs | catalogue message under the form |
| Change password | `Saving` | `Password changed. Every other session is signed out.` | summary + field messages |
| Create job | `Saving` | `Job created.` | summary + field messages |
| Upload plan | `Saving` | `Plan uploaded.` | catalogue message |
| Add room | `Saving` | `Room saved.` | summary + field messages |
| Add person | `Saving` | `Person added.` | catalogue or field messages |
| End role | `Saving` | `Role ended for <name>.` | catalogue message |
| Schedule visit | `Saving` | `Visit scheduled.` | summary + field messages |
| Save access card | `Saving` | `Access card saved.` | summary + field messages |
| Show access codes | `Saving` | codes appear; trade adds `Codes visible until <HH:MM>` | catalogue message in the region (+ `Next visit: …`) |
| Quick add / edit | `Saving` | `Item <n> saved.` | `Not saved: <message>` |
| Drop a pin | `Saving` | `Pin dropped for item <n> in <room>.` | `Drop the pin inside a room on the plan.`, crosshair kept |
| Item action | `Saving` | `Item <n>: <status label>.` | `Not saved: <message>` |
| Post a note | `Saving` | `Note posted.` | `Not saved: <message>` |
| Photo upload | row `Photo uploading` | `Photo saved.` | catalogue message, no thumbnail |
| Remove photo | `Saving` | `Photo removed.` | catalogue message |
| Resolve conflict | `Saving` | `Conflict resolved.` | catalogue message |
| Start walkthrough | `Saving` | `Walkthrough started.` | catalogue message |
| Close out | `Saving` | `Job closed out.` | catalogue message in the dialog |
| Offline sync | rows `Waiting to sync` | `Sync complete: <synced> synced, <conflicts> to review.` | rows revert with `Not saved: <message>` |
| Delete visit | `Saving` | `Visit deleted.` (decided: the brief prints no copy) | catalogue message |
| Upload revision | `Saving` | `Plan revision <n> uploaded: <moved> pins moved, <review> need review.` | field messages, or the catalogue message |
| Move visit | `Saving` | `Visit moved.` | field messages or catalogue message |
| Cancel visit occurrence | `Saving` | `Visit cancelled.` | catalogue message |
| Waits on | `Saving` | `Item <n> saved.` | `Not saved: <message>` (the cycle message when it applies) |
| Bulk check-off / assign | `Saving` | `<k> items checked off.` / `<k> items assigned to <trade label>.` | `alert "Nothing changed"` + `Not saved: None of the items changed.` |
| Delete item | `Saving` | `Item <n> deleted.`; focus to the next row or the quick add field | `Not saved: <message>`; the row stays |
| Save note edit | `Saving` | `Note updated.` | `Not saved: <message>`; the editor keeps the draft |
| Undo / redo my edit | `Saving` | `Edit undone.` / `Edit redone.` | `Not saved: <message>` |
| Save contingency | `Saving` | `Contingency saved.` | field messages |
| Add change order | `Saving` | `Change order added.` | field messages |
| Approve change order | `Saving` | `Change order approved.` | catalogue message |

## Server rules (decided where the brief is silent)

- Online edits use `PATCH` (replace); only queued offline work uses `/sync` (merge) — brief: Offline merge.
- An online quick add, item field edit, item action, pin, note post or note edit (the five sync operation types) that fails for lack of network joins the offline queue (decided: wifi without internet behaves like no signal). Deletes, photos, Waits on, bulk actions, undo/redo and Costs controls never queue: a network failure leaves them unsaved with a message (brief: Interactions — Offline; Deleting an item — no offline delete).
- The owner's access-card form fills only after `Show access codes`, since every read is a logged reveal (decided: brief Access codes).
- The job list orders newest first by creation time (brief: API).
- Outbox entries are claimed with `FOR UPDATE SKIP LOCKED` and a 5-minute lease; the sender runs on each change and every 10 s (brief: at least every 30 s).
- The daily summary check runs every 10 s (brief: at least every 30 s).
- Rows not yet numbered by the server (added offline, or an optimistic quick-add row whose save has not returned) show `new` where `<n>` goes: in the number column, in the accessible name `Item new: <title>`, and in the row's button and dialog names; the real number replaces it once the server assigns one, on save or on sync (brief: "a placeholder of your choice").
- Events take their sequence numbers under the job's event head row, locked last in each transaction, so numbers follow commit order with no gaps; `NOTIFY` wakes streams on every process, with a 1 s poll behind it (brief: within 2 s).
- A commit emits one `counts` event when it changed the counts, and one `costs` event when it changed any figure of the Costs object for now (brief: Business rules — Event stream); decided: "changed" is judged against the last emitted snapshot, in any scope.
- An item outside the caller's scope (another trade's item, or a no-trade item for a trade) answers 404 on every endpoint before the role is checked; on an endpoint the role may never use, an item in scope answers 403 (brief: API — error precedence puts not visible (404) before forbidden (403); out of scope means another trade's item).
- Note revisions record the job member id of the editor for the tie-break, so a person's own characters never sort after them.

## Media and licences

| File | Source | Licence |
|---|---|---|
| `app/seed/plans/hale.png` (1500×1000) | drawn for this app (SVG rendered in Chromium) | original |
| `app/seed/plans/oduya.png` (1500×1000) | drawn for this app | original |
| `app/public/favicon.svg` | drawn for this app | original |
| Archivo, IBM Plex Sans, IBM Plex Mono woff2 | Fontsource npm packages | SIL OFL 1.1 |
| icons | lucide-react | ISC |
