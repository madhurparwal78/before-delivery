# TRUTH — Tallyroom Workspace (golden)

The brief made concrete. `brief: <section>` = copied from `instruction.md`; `decided: <why>` = the
brief is silent and the choice follows its intent.

## Journeys (ideal end-to-end flow)

### 1. Owner sets the working calendar (DP-06, DP-07, DP-10, DP-64, DP-76)
- Start: Ana (owner, Kereru Labs) at `/settings`; Ben has `/cycle/<n>` open in a browser set to a European zone. (brief: Journeys 1)
- `form "Working calendar"` shows `Pacific/Auckland` in `combobox "Time zone"`, `checkbox "Monday"`–`"Friday"` checked, Saturday/Sunday unchecked, two `button "Remove holiday <date>"` rows (Fri 25 Dec, Mon 28 Dec). (brief: Seed data)
- She types a date and name; the form now differs from the loaded calendar, so the 10-second workspace refreshes leave every field, and focus, as they are. (brief: Workspace refresh)
- Add holiday puts the typed date and name on the form's list unchecked; Save calendar sends the whole form and the server judges every field. A failed save announces `Calendar not saved: <n> problems.` (or `1 problem.`) and shows `region "Calendar errors"` above the form with one `link` per entry in `fields`, in form order; a link moves focus to its field, each failing field has `aria-invalid` and `aria-describedby`, and an error clears when its field changes. A good save: Announcements `Saving calendar` → `Calendar saved.`; the list shows three holidays. (brief: Calendar errors, Feedback states)
- Server: a new `calendar_saves` row effective from the workspace's local today (zone before the save); days before today keep the calendar in effect on them, so finished cycles and the current cycle's past days are unchanged. (brief: Effective from today)
- Ben's page: its refresh sees a changed calendar → refetches the cycle → the ribbon redraws already folded with the new crease; `Today: <date>` is the server's Auckland date, never the browser's. No navigation. (brief: Workspace refresh, DP-07)

### 2. Member triages by keyboard (DP-15, DP-16, DP-62)
- `/issues?project=<Kiln id>`; reload keeps filter and rows; `issue` events from other people update rows in place. Tab enters the list (filters, then the selected row); J/K move across status groups; S opens `listbox "Status"` (legal next statuses in status order, focus on first); Down+Enter → `POST /api/issues/<key>/transition` → `<key> moved to In progress.`; A opens `listbox "Assignee"` (`Unassigned`, then people who can see the project, A–Z) → `PATCH` → `<key> assigned to <name>.`; focus returns to the row that had it, even when the row moves to another status group. (brief: Interactions)

### 3. Member plans the cycle on the crease ribbon (DP-17–DP-21, DP-69)
- `/cycle`: the detail shows first below 768. Columns of equal width (`14 days`); 200 ms later the uncounted days narrow to 8 px creases with vertical short dates (labels of neighbouring creases staggered) while working columns widen (330 ms); at the fold end the counter reads `10 working days` and the burndown line is revealed (330 ms). (brief: Crease cycle)
- Clicking/Enter/Space on a crease unfolds it to working-column width with `Not counted`, the reason (holiday name, `Weekend`, `Non-working day`) and any clock-change copy; blur or a click elsewhere folds it. One open at a time. Burndown circles stay centred on their working-day groups, folded or unfolded. (brief: Crease ribbon)
- Dragging a chip (pointer; long-press on touch) from the ribbon or `group "Unplaced"` onto a weekend crease: the chip moves at once to its target, the crease it was dropped on, while the request is pending; `PATCH due_date=<crease date>` → server snaps → on success the chip settles in the column of the stored date and `Due date moved to <date>, the next working day.` is announced; a failed save (network/5xx) returns the chip and announces `Due date not saved.`, focus staying on the chip. Shift+Right/Left step a focused chip by working day. (brief: Issue chips)

### 4. Member catches up in chat (DP-22–DP-27, DP-63, DP-72)
- Empty channel shows `No messages in #random yet.`; send shows an `article` `Sending` at once with a fresh idempotency key, composer clears; Elin's two tabs get `unread` events within 2 s (`#random, 1 unread`, `Inbox, 1 unread`); one mention email is queued to the outbox then delivered to Mailpit. Reading in one tab clears both tabs. A stream event or refetch carrying the article's `client_key` settles an article in `Sending`; while an article shows `Not sent.` a stored copy adds nothing. A lost response shows `Not sent.` + `button "Retry send"`; retry reuses the first Idempotency-Key, so the message appears once. (brief: Journeys 4, Sending messages)

### 5. Two members edit one spec (DP-28–DP-30, DP-65)
- `PUT /api/docs/<id>` with `base_version`; an outdated base gets 412 `version_conflict` + `current`; the editor opens `dialog "Newer version saved"` and `status "Doc status"` reads `<name> saved version <n> while you were editing. Keep mine or load theirs?`; Keep mine re-saves the exact textarea text on the newer version (`Saved version <n>.`); Load theirs loads it (`Loaded version <n> from <name>.`). Text is stored byte for byte; limits count code points. An unedited body is sent unchanged; in an edited one each untouched line keeps its original ending and a typed or changed line ends with a line feed, also for Keep mine. `button "Version history"` opens `dialog "Version history"` with `button "Restore version <n>"` for each older version, newest first; a restore sends the open base version, makes a new byte-equal version and announces `Restored version <n> as version <m>.`; on a conflict `dialog "Newer version saved"` opens. Guests read only. A session lost with unsaved edits keeps title, body, base version, doc id and person id in session storage and lands on `/sign-in?next=/docs/<doc id>`; the same person gets them back with `Your unsaved changes were restored.`, anyone else never sees them. (brief: Docs, Unsaved doc edit after a lost session)

### 6. Guest joins and works on Kiln (DP-31–DP-34, DP-36–DP-39, DP-41, DP-44)
- Ana's `form "Invite"`: email, `radio "Guest"`, which shows one `checkbox "<project name>"` per project and one `checkbox "#<channel>"` per channel, all at once (brief: Settings people; a guest may name only projects, only channels, or both — brief: Invites and seats, "at least one project or channel"); she checks `checkbox "Kiln"` and `checkbox "#kiln-review"`, `Send invite` → `Invite created for <email>.`; the outbox holds one invite email with no token, naming Ana and Kereru Labs and `APP_PUBLIC_URL`.
- Contractor: `/create-account` → `/invitations` (`button "Join Kereru Labs"`) → `/welcome` (`Welcome to Kereru Labs`, `link "Go to Issues"`) → `/issues` with `All projects`, `Kiln` only.
- Upload on a Kiln issue: `Uploading <name>` + `progressbar "Upload progress"` → MinIO PUT at `kereru/<id>/<safe name>` → row → `Attached <name>.`; a member downloads it with `Content-Disposition: attachment; filename="<fallback>"; filename*=UTF-8''<encoded>`, `nosniff`, octet-stream for active types.
- Ben joins the empty Review Room directly; `button "Knock on Review Room"` shows below the plan and the guest's room button moves focus to it → `status "Knock status"` `Waiting`; Ben gets `dialog "Knock at Review Room"` (`<name> is at the door.`) → Let in → both floor plans show `Review Room, 2 inside`.

### 7. Owner changes seats (DP-45–DP-47, DP-71)
- `<active> of <limit> seats used, <pending> pending`, `Monthly total: $<limit×8.00>`; Update seats (aria-disabled while pending) → `Confirming with billing` (old figures stay) → Kill Bill `seats` field written + read back → `Seat limit is now <n>.`; a request for the current limit clears any schedule with the same copy.
- A reduction reads `chargedThroughDate`, writes `seats_scheduled` = `<n>@<date>`, reads it back → `Seat limit stays at <limit> until <date>, then <n>.`, shown again after a reload; limit and total stay; the first read on or after that date writes `seats`, removes `seats_scheduled` and adopts the value; with no charged-through date the call answers `billing_unavailable` and nothing changes.
- Below active → `You have <active> people in this workspace. Remove someone before lowering seats below that.`; a direct Kill Bill change of `seats` or `seats_scheduled` is adopted within 10 s (the last confirmed limit and its age live in Postgres, shared by copies; invite sends and acceptances always re-read); Kill Bill down → `Seat limit not changed. It stays at <limit>.` in `status "Billing status"`, the notice `Billing unavailable. Your seat limit stays at <limit> until billing is back.`, the limit stays, and the typed count and status survive every refresh.

### 8. Owner works through a mail outage (DP-48, DP-49, DP-67)
- Invites and the mention are created; outbox rows stay unsent; owner sees `Mail delayed: <n> messages waiting to send.`; revoking an invite deletes its held row in the same transaction, the notice drops by one; when SMTP returns the sender (retry every `OUTBOX_RETRY_SECONDS`, rows claimed `FOR UPDATE SKIP LOCKED`) delivers each held row once; the revoked invite's mail never goes out.

## Decided contract details
- Instants are whole seconds with the workspace offset (decided: expiry edges compare exactly with the published value).
- Burndown chart scale: 140px tall, one circle per entry placed from the measured centre of its working-day group (decided: the brief pins the horizontal position only).
- Invite object adds `owner_name`; Issue object adds `updated_at` and `assignee_name` (`<name> (removed)` for a removed person); `GET /api/members?project=<id>` narrows to people who can see that project (decided: the outcome screens, the title block and the assignee picker need these and no other endpoint gives them).
- Presence activity = every heartbeat and every request the person makes with their session, the page's timed polls included; a person turns `away` only after `PRESENCE_AWAY_SECONDS` with neither (brief: Typing and presence).
- A stored due date that a later calendar change made uncounted keeps its chip on that day's crease; the tray holds only chips with no due date or one outside the cycle's days (brief: Cycle, Due dates).
- Knock dialogs pick up waiting knocks once when a page opens inside a private room; later knocks arrive on the stream (decided: a person who walks into a room does not inherit knocks addressed to the people who left it).
- Kill Bill catalog uploads use a random effective time on 2020-01-01 (decided: copies uploading at the same moment create separate valid versions instead of a duplicate-date catalog Kill Bill cannot load).

## Palette (decided values in the brief's roles)
| Role | Hex | Source |
|---|---|---|
| paper ground | `#F5F1E8` | brief: warm paper off-white |
| paper-sunk (hover/selected) | `#ECE6DA` | decided |
| ink | `#1E2923` | brief: graphite with a faint green cast |
| ink-muted | `#56605A` | decided (5.8:1) |
| rule | `#D6CDBE` | brief: light warm grey hairlines |
| rule-strong (control edges) | `#7E7566` | decided (3:1 non-text) |
| drafting blue | `#1D4FA8` | brief: current cycle mark, focus ring, own presence mark only |
| signal | `#A83A14` | brief: errors, expired, not sent, notices |
| signal-wash | `#F3E2D7` | decided: notice ground |

## Type
IBM Plex Sans Condensed 500/600 (headings, title blocks, cycle header, room names in capitals), IBM Plex Sans 400/600 body 14px/1.45, IBM Plex Mono 400/500 tabular for keys, dates, times, counts, amounts; headings 16.8 / 20.2 / 24.2px (one-fifth steps). (brief: Type)

## Space and layout per viewport
- ≥1280: 76px icon rail (`navigation "Modules"` vertical) | list 360px | detail; title block absolute top-right; sheet content starts below it. (brief: Layout per published viewport)
- 768–1279: modules as one row on top; list 320px + detail. (brief)
- <768: one pane. Issues, Chat and Docs show the list first; Cycle, Office, Settings and Account show the detail first; a record route shows the detail. `button "Back"`, bottom tab bar 64px fixed inside the viewport; ribbon columns fluid so all fit at 375; the pane not shown is `display:none`. Opening an item moves focus to the sheet's title; Back returns it to the row that opened it. (brief)
- Compact rows separated by 1px rules, no cards/shadows; controls ≥44×44 except ribbon creases (8px wide, ≥44px tall) and chips (column wide, ≥24px). (brief: Density)

## Motion
| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| detail sheet, thread | record opens / closes | 200 ms translateX(24px)+opacity, reversed on exit | `cubic-bezier(.16,1,.3,1)` | instant |
| dialogs, pickers | open / close | 160 ms opacity + translateY(-4px), reversed on exit | same | instant |
| notices | appear / clear | 200 ms translateY(-100%), reversed on exit | same | instant |
| hover / press | pointer | 90 ms background / 60 ms 1px translateY | same | none |
| chip | move / failed move | 200 ms transform glide | same | instant |
| crease fold | cycle opens | 200 ms delay, 330 ms width | same | rendered folded, `10 working days` at once |
| crease unfold/fold | click/Enter/Space/blur | 160 ms width | same | instant swap |
| burndown | after fold | 330 ms reveal (clip scaleX) | same | drawn in place |
| calendar redraw | refresh sees a change | no replay | — | — |
(brief: Motion and effects, "All motion starts quickly and settles softly": every row uses one ease-out curve)

## States per async action
All copy is the brief's Feedback states table verbatim: sign-in (`Signing in`, `That email and password don't match.`), create account (`Creating account`, `An account with that email already exists.`), calendar (`Saving calendar`, `Calendar saved.`, field errors), issues (`<key> created.`, `<key> moved to …`, `can't move from … to …`, open sub-issues), assign, due date (`Due date set to …`, `Due date moved to …, the next working day.`, `Due date not saved.`), messages (`Sending`, `Not sent.`, `Messages can be up to 4000 characters.`), empty states (`No messages in #<channel> yet.`, `You're all caught up.`, `No invitations for <email>.`), typing, docs, uploads, knocks, invites, seats, the four service notices.

## Breakpoints
768 and 1280 only. (brief)

## Media and licences
- IBM Plex Sans / Sans Condensed / Mono WOFF2 (latin, latin-ext), vendored from Fontsource 5.1.0 into `app/src/client/fonts/`, OFL-1.1, listed in `app/assets.json`.
- Lucide icons via `lucide-react` 0.460.0 (ISC), inline SVG.
- The blank-sheet mark, floor plan, ribbon and burndown are drawn in code (original).
