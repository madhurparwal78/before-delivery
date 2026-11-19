# Wardhouse Software Lockset Custody Desk

Lockset Custody Desk is where a small professional office keeps the logins its staff share. Each vault holds the logins for one area of work, and every reveal and edit goes into an audit trail. Joiners, movers and leavers are all handled here, and a leaver loses sign-in at once. Any shared login can have a scheduled rotation, worked out in the office's own time zone. Security rules take force at a future office midnight. Billing changes only when the billing provider confirms them. The first office is Brannock & Lyle, an invented 26-person accounting practice in Omaha.

Lockset uses four backend services:
- Keycloak holds every staff sign-in. Its realm is shared with other offices.
- Kill Bill runs the per-seat annual subscription. Its tenant is shared with other offices.
- Postgres is the only system of record.
- WireMock stands in for an external breach-exposure feed.

Out of scope: browser extensions, autofill, mobile apps, email or text notifications, more than one office per running instance, single sign-on other than the Keycloak password sign-in described here, payment collection, and any datastore other than Postgres.

## Problem and users

Brannock & Lyle keeps its shared logins in a spreadsheet: the payroll provider, two bank portals, the federal e-file account, the website host and the practice-management suite. The office manager looks after that spreadsheet on top of the real job. When a staff accountant leaves, nobody can say who still knows the bank password. Rotations are promised every quarter and then forgotten. A rule like "16-character minimum on the Banking vault from 1 January" only works if someone remembers it on the day, and existing tools apply a rule the moment it is saved. Business password managers assume an IT department with a directory and a security log system. So the managing partner pays per seat, and the office manager still offboards people by hand. Lockset is built for an office manager who is also the office's reluctant IT administrator.

- **Office manager** (daily): keeps every shared vendor login scoped, rotated on schedule and taken away from leavers, without becoming a full-time IT admin.
- **Managing partner** (weekly): sees what the office is exposed to, signs security rules and quarterly access reviews, and pays for exactly the seats in use.
- **Staff accountant** (daily): reveals and copies the logins their work needs, and only those, including while travelling to client sites.
- **Outside bookkeeper** (weekly): uses the payroll and bank logins during a contracted engagement term that ends on its own.

The device clock may be wrong. Every time-dependent state on screen comes from the server.

## Journeys

1. **Reveal on the road.** Deandra Okafor, a staff accountant, starts signed out on a phone at a client site.
   - She signs in and lands on her first visible vault.
   - She opens Vendor portals and reveals the EFIN account. Twenty seconds later she reveals the Practice admin and copies it. She then opens the Turn dialog for a login and starts typing a new password.
   - The first secret hides on its own and is announced. Her dialog stays open with her typing intact, and the second secret stays shown until its own thirty seconds are up.
   - Back at the office, the office manager takes Banking off her access. Within five seconds her open phone page loses the Banking folder and any Banking secret on screen, and she reads that her Banking access ended. She stays signed in.
   - At the office's evening cut-off the server ends her reveal session, and her next reveal shows the session-ended screen.
2. **A joiner arrives.** The office starts with the seeded people and seats. The managing partner has the Billing screen open on a tablet.
   - The office manager adds a new staff accountant with two vaults. A nervous double submit still makes one person. The person appears on People at once, with a seat cell that reads waiting on billing until Kill Bill confirms the seat.
   - On the tablet, the seat count rises by one in place, with no reload. The quarter's open access review gains the joiner's lines, and its progress line updates in place.
3. **A leaver goes late in the evening.** Theo Vasquez starts active, holding Banking, Hosting and Office.
   - Late in the evening, Omaha time, the office manager confirms Theo's leave through the confirmation dialog.
   - Theo's Keycloak sign-in is switched off and his scopes are gone. A reveal from his still-open browser is refused.
   - Every login in his three vaults gets a turn due two office business days later, counted in Omaha. The audit entries fall on the Omaha day, and his undecided review lines close as removed by the scope change.
   - The managing partner opens that evening's audit sheet from a link carrying the day in its address and pages through it with `More entries`, reading every entry once.
4. **A rule that waits for midnight.** A 16-character Banking rule starts signed and waiting for the next 1 January.
   - The office manager edits a new Payroll draft while the managing partner has it open. The managing partner's signature on the version they opened is refused and the stub reloads; they sign the fresh version.
   - The managing partner drags the night ruler with a finger on the tablet across the coming office midnights.
   - The Banking lockset cylinder stays upright until the 1 January night, then turns a quarter turn. The pending stub changes from "Takes force" to "In force from", and the out-of-policy count rises to the server's figure. Dragging back reverses every change.
   - When the real office midnight passes with the page open, the cylinder turns by itself and the desk announces that the Banking rule is now in force.
5. **A rotation across the clock change.** The First Prairie Bank business portal starts on a 90-day rotation at 02:30 office time.
   - The office manager moves the rotation calendar to March; the month is in the address. The spring-forward run shows at 03:00 with a note that it moved, and the next run is back at 02:30.
   - The office manager double-clicks `Save schedule` for a new rotation at 01:30 on the November fall-back Sunday. One schedule is filed and the calendar shows the run once.
6. **The quarterly access review, by keyboard.** The current quarter's review starts open (or overdue), with one line per person and vault.
   - The office manager works every line from the keyboard. After each decision, focus moves to the next undecided line and the progress line reads the new count.
   - Removing a line goes through a confirmation dialog that holds focus, and the scope is taken away at once.
   - On the tablet, the managing partner tabs to `Sign off review` and signs off.
7. **Exposure and outages.** The health report starts listing exposed passwords and breached vendor sites from the feed.
   - The office manager flicks the Office day picker back over several days while answers are slow; the report always ends on the last day picked.
   - The breach feed goes down. The health report shows the outage band and keeps the last good check time. When the feed comes back, the next check succeeds with no restart.
8. **The old spreadsheet and a rebrand.** The legacy file starts on the office manager's Windows desktop, saved by Excel as "Passwords FINAL v3.csv". Its "Who knows it" column says things like "Dee", "D. Okafor", "Okafor, D." and "Sam".
   - The office manager uploads it. Lockset reads the bytes exactly as Excel wrote them and shows the file's short name. Rejected rows give a short reason and never repeat a password.
   - Each name either matches one person by the published order or is held for a choice. Importing the file again files nothing new.
   - The payroll provider then rebrands, and the office manager renames the vendor. Every slip, rotation and review line shows the new name with the old one as "formerly". Older audit entries keep the old name.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Landing drawer hero** The landing page is the teal tabbed-folder-stack hero described in Visual design, with the published headline, sentence, five folders and `Open the drawer` button.
- **DP-02 — Keycloak sign-in** A person signs in with their handle and Keycloak password, and Lockset starts a server session or refuses with the published sign-in errors, including the DP-69 lockout.
- **DP-03 — Reveal session limit** The server ends each reveal session at the limit stated in Business rules and refuses every later request with the session-ended error, whatever the page or device clock shows.
- **DP-04 — Reveal and copy audited** Revealing or copying a login returns its secret only to a person whose vault is visible to them now, and writes one audit entry recording the rule in force at that instant.
- **DP-05 — Leeway refusal** A login that has been out of policy beyond the leeway in Business rules cannot be revealed or copied until it is turned.
- **DP-06 — Reveal on the road journey** A staff accountant on a phone signs in, reveals and copies two logins, and opens the Turn dialog, and each secret hides on its own timer with the published copy and announcements.
- **DP-07 — Folder-stack drawer journey** The office manager opens the drawer, moves between vault folders by tab and keyboard, files a new vault, and files a new login in it, each visible at once.
- **DP-08 — Server-scoped vault visibility** Every vault list, vault, login and as-of answer includes only what the server decides the caller may see now, and other vaults answer as not found.
- **DP-09 — Empty vault** A vault with no logins shows the empty folder with the published empty-state copy.
- **DP-10 — Logins on file** Vaults, vendors and logins are created and stored in Postgres with the login secret encrypted at rest, as qualified in Services.
- **DP-11 — Forward records on rename** Renaming a vendor or vault writes a forward record and shows the new name with the formerly text on every current surface, while past audit entries keep the old name.
- **DP-12 — Rebrand journey** The office manager renames the payroll vendor, then sees the new name with the old one on vault slips, the rotation calendar and review lines, with the audit trail unchanged.
- **DP-13 — Append-only audit trail** Every state change Lockset makes writes the entries listed for it in the Business rules audit table, each with a published action name and a commit-ordered seq, and no endpoint edits or removes entries.
- **DP-14 — Audit day in office time** Audit entries are bucketed by their America/Chicago office day and listed one office day at a time.
- **DP-15 — Back of the drawer footer** For the office manager and managing partner, the newest ten audit entries of the office day form the footer on desk screens, uncovered from behind the content as the page scrolls to its end, and the full sheet pages on with `More entries`.
- **DP-16 — Joiner on record** Adding a joiner creates the person in Postgres and an enabled Keycloak user with a complete profile, as qualified for outside bookkeepers in Business rules.
- **DP-17 — Joiner seat in Kill Bill** A joiner's seat is a new Kill Bill seat subscription on this office's account, and the joiner counts as seated only after Kill Bill confirms it.
- **DP-18 — Joiner journey** The office manager adds a joiner and sees the person at once, with the seat cell waiting on billing until billing confirms it.
- **DP-19 — Leaver loses access at once** Confirming a leave disables the person's Keycloak user, ends their Keycloak and Lockset sessions, and removes every vault scope in one action, so their old browser is refused.
- **DP-20 — Turns due after scope loss** Whenever a person loses a vault scope, each login in that vault gets a turn due two office business days later, counted in office time and written to the audit trail with who confirmed it.
- **DP-21 — Leaver seat release** A leaver's seat is cancelled in Kill Bill by the published proration rule, and the seat count drops only when Kill Bill confirms it.
- **DP-22 — Idempotent people changes** Joiner, leave and import requests honour the Idempotency-Key header with the published replay and conflict rules, and of simultaneous leave confirmations exactly one wins.
- **DP-23 — Leaver journey** The office manager confirms a leaver through the confirmation dialog and sees the published success copy, the turns due and the seat state.
- **DP-24 — Mover scope changes** Changing a person's role or vaults takes effect at once on the server, as qualified in Business rules, and the office manager cannot edit their own record.
- **DP-25 — Travel windows** During a travel window, the server withholds from that person every vault marked off when travelling, from the start office minute to the end office minute.
- **DP-26 — Engagement term** An outside bookkeeper can sign in and see their vaults only within the engagement term, which ends on its last day as stated in Business rules.
- **DP-27 — Open pages follow the server** An open page drops vaults within five seconds of a server-decided access boundary and never shows them again from its own clock.
- **DP-28 — Travel journey** A staff accountant sets a travel window and, when it opens, sees their open drawer change with the published announcement.
- **DP-29 — Rule lifecycle** Rules move from drafted to scheduled to in force to superseded only along the published edges, and each illegal edge is refused with its published code in the published order.
- **DP-30 — Rule in force by office midnight** The server decides once, from effective-dated rules in office time, which rule is in force at any instant, and checks each secret edit against the rule in force at the moment of the edit.
- **DP-31 — Out-of-policy flag** Each login's out-of-policy flag and leeway end come from the rule in force, so two people looking at the same login see the same values.
- **DP-32 — Rule signing journey** The office manager drafts a rule and the managing partner signs the version they opened, and the rule then sits on a perforated pending stub with the published takes-force copy.
- **DP-33 — As-of drawer** For any of the next 60 office midnights, the server answers which rule is in force in each vault, what the stub text is, and how many logins are out of policy.
- **DP-34 — Night ruler control** The night ruler is a slider over the next 60 office midnights, each labelled with its date and offset, moved by pointer drag, arrow keys, Home and End.
- **DP-35 — Lockset cylinders and stubs** Each vault tab's lockset cylinder, each pending stub and the out-of-policy count show the server's as-of answer for the chosen night in both drag directions, with the published motion.
- **DP-36 — Midnight push** When the server clock crosses an office midnight at which rules take force, an open drawer turns the affected cylinders in drawer order and announces each one, within five seconds.
- **DP-37 — Night ruler journey** The office manager scrubs the ruler forward and back across a pending rule's night, and the cylinders, stubs and counts follow the server's answer.
- **DP-38 — Rotation schedule across DST** Rotation runs keep their office wall-clock time, and spring-forward and fall-back nights follow the published rule.
- **DP-39 — Rotation states** Turns move from scheduled to due to overdue to turned by the published office-time rules, and each run becomes due exactly once.
- **DP-40 — Rotation calendar journey** The office manager schedules a rotation and finds it on the rotation calendar's office-day rows, with moved runs marked.
- **DP-41 — Quarterly review calendar** A quarterly access review opens on the first office business day of each quarter and becomes overdue after the published number of office business days.
- **DP-42 — Review decisions and sign-off** The office manager keeps a line at once or removes it through the confirmation dialog, and removal revokes the scope at once; each line is decided once, lines also close or open with scope changes as in DP-72, and only the managing partner signs off, once every line is decided.
- **DP-43 — Review journey** The office manager decides every review line from the keyboard and the managing partner signs off the review, with the published status and progress copy at each step.
- **DP-44 — Billing from Kill Bill** Seat count, next invoice and licence term end shown anywhere equal Kill Bill's confirmed subscription state on this office's own account.
- **DP-45 — Waiting on billing** When Kill Bill is unreachable, seat changes are kept as waiting on billing, never counted, and retried without a restart, and the billing outage copy is shown.
- **DP-46 — Billing review journey** The managing partner reviews seats, next invoice, licence term end and waiting changes on a tablet, and sees them change in place when billing confirms a joiner.
- **DP-47 — Breach range lookup** Password exposure checks send only the five-character hash prefix with the `Add-Padding: true` header to the breach feed, and read the published range and breached-domain responses, ignoring padding rows.
- **DP-48 — Daily health report** The health report is grouped by office day and shows exposure, vendor breaches, out-of-policy logins and turns due from the latest good check.
- **DP-49 — Feed outage and recovery** When the breach feed is unreachable, the health report shows the published outage copy with the last good check time, and the next check after the feed returns succeeds with no restart.
- **DP-50 — Health journey** The office manager opens the health report and runs a check, sees an outage band while the feed is down, and sees a successful check once it returns.
- **DP-51 — Import matching order** Each name in an imported row matches an existing person by email, then exact full name, then unique alias, using the published comparison, and import never creates people.
- **DP-52 — Held rows** A row with an unmatched or ambiguous name is held and shows its candidates, and it files its login only after the office manager has chosen for every held name.
- **DP-53 — Re-import creates nothing** Importing the same file again creates no people, vendors or logins, and reports already-filed rows as already on file.
- **DP-54 — Import journey** The office manager uploads the Excel-saved legacy spreadsheet, reads the row outcomes under the file's short name, and resolves held names on screen.
- **DP-55 — Published layouts** At 375x812, 768x1024 and 1280x800, every desk screen shows its published layout and element order with no horizontal page overflow.
- **DP-56 — Teal-on-paper working screens** Every working screen keeps the filing-drawer look in one teal ink on paper tones, as described in Visual design.
- **DP-57 — Motion and reduced motion** Each published motion has its stated meaning and timing, nothing loops for decoration, and reduced motion replaces movement with instant changes in the same order.
- **DP-58 — Keyboard and announcements** Every public control can be reached and operated by keyboard in the published order, dialogs trap focus and return it, and announcements use the named live regions with the published copy.
- **DP-59 — Health, boot and boundary** The app starts and answers its health check with any of Keycloak, Kill Bill or the breach feed down, and enforces the same-origin, size and serving limits in Server boundary.
- **DP-60 — Secrets and config wiring** Service URLs and credentials come only from the published environment variables, and secrets and full hashes never leave the server, as the source shows.
- **DP-61 — Independent hide timers** Each revealed login hides 30 seconds after its own latest reveal and announces it, without hiding another slip early, closing an open dialog, wiping typed text or clearing `Desk alert`.
- **DP-62 — Paged audit sheet** The audit API pages one office day by opaque keyset cursor with a capped limit, and following the cursors returns every entry committed before the first page exactly once, even while new entries are written.
- **DP-63 — Keyboard review decisions** Review decisions work entirely from the keyboard: focus moves to the next undecided line after each decision, and the Remove confirmation traps focus and returns it, as qualified in Feedback states.
- **DP-64 — Spreadsheet read as bytes** Imports are uploaded as the file's bytes and read by the published BOM, line-end and quoting rules, files that are not UTF-8 are refused with the published copy, and each file is filed under the last segment of its path.
- **DP-65 — Back folders and closed menu inert** Folders behind the open one expose only their tab and the closed `Menu` exposes no links, so their contents are neither focusable nor in the accessibility tree at any viewport.
- **DP-66 — Landing routes** Sign-in lands on a safe `next` route the role may open, or else on the first visible vault; a signed-out desk visit carries `next` to sign-in, and filing a vault lands on its route with focus on its heading.
- **DP-67 — Touch night ruler** The night ruler handle follows mouse, touch and pen drags with a hit area of at least 44 by 44 pixels, snaps to office midnights, and never scrolls the page while dragging, also under reduced motion.
- **DP-68 — Billing figures update in place** Open Billing and People screens update seats, next invoice, licence term end, the waiting list and seat cells in place within five seconds of Kill Bill's confirmation, keeping scroll position, focus and any open dialog.
- **DP-69 — Sign-in lockout** Five failed sign-ins for one handle within the lock window lock that handle with `429 sign_in_locked`, `Retry-After` and the published reopen stamp, and handles not on record answer identically, as qualified in Business rules.
- **DP-70 — Published fields only** Every write body accepts only the keys its endpoint publishes, and any other key or a wrongly typed published key answers 422 on that key and changes nothing.
- **DP-71 — Versioned rule edits** Every rule carries a version that edits and signatures must send, a stale version answers `409 rule_changed` in the published order, and of simultaneous edits exactly one wins.
- **DP-72 — Review lines follow scope changes** While a review is open or overdue, lost scopes close their undecided lines as removed by scope change and new scopes add undecided lines, and open review pages update their lines and progress in place within five seconds without moving focus.
- **DP-73 — Import never echoes a secret** Rejected import rows carry only the published reasons in the published check order, and no import response, error body, audit detail or log line contains a Password cell.
- **DP-74 — One office per account and prefix** Seats, next invoice and licence term end count only the Kill Bill account whose external key is the office key, and sign-in and People consider only this office's Keycloak users, although the tenant and realm are shared with other offices.
- **DP-75 — Day and month in the address** The audit day and the rotation calendar month live in the address, so reload, deep links, Back and Forward restore them, and a missing or invalid value is replaced by office today or the current office month.
- **DP-76 — Latest office day wins** The health report always ends on the last office day picked, whatever order answers arrive in, and overlapping breach checks share one run.
- **DP-77 — One rotation per login** Simultaneous schedules for one login create exactly one schedule and one audit entry, a schedule change replaces only future runs, and `Save schedule` files once however often it is pressed.
- **DP-78 — One joiner per handle** Simultaneous joiners with one handle or email create exactly one person, one Keycloak user, one Kill Bill seat bundle and one audit entry.
- **DP-79 — Dropped vault leaves the open page** A mover change or review removal that drops a vault removes that folder, its revealed secrets and any open Turn dialog on it from the person's open page within five seconds, with the published alert, while their session stays alive.

## Frontend

### Screens and layout (DP-01, DP-06, DP-07, DP-09, DP-15, DP-40, DP-46, DP-55, DP-65, DP-75)

These routes are all served by the app:

| Route | Who | Screen |
|---|---|---|
| `/` | everyone | Landing hero |
| `/sign-in` | signed out | Sign-in slip |
| `/desk` | all roles | The drawer: night ruler and pending rules (office manager and managing partner only), then the vault folders |
| `/desk/vaults/<vault id>` | all roles | The drawer with that vault's folder open |
| `/rotations?month=YYYY-MM` | office manager, managing partner | Rotation calendar for that office month |
| `/reviews` | office manager, managing partner | Access reviews |
| `/people` | office manager, managing partner | People and their access |
| `/travel` | staff accountant, outside bookkeeper | My travel windows |
| `/billing` | office manager, managing partner | Seats and invoice |
| `/health` | office manager, managing partner | Health report |
| `/import` | office manager | Spreadsheet import |
| `/audit?day=YYYY-MM-DD` | office manager, managing partner | Full audit trail for that office day |

"Desk routes" means every route in this table except `/` and `/sign-in`. Any path not in the table shows the not-found screen, and so does a route the person's role does not have. A signed-out visit to a desk route follows the landing rule in Business rules. The `month` and `day` address values follow the address rule in Business rules.

**Desk shell.** A top bar holds:
- the Wardhouse wordmark
- the `Desk` navigation, showing only the links the role has
- the signed-in person's name
- the server's office clock, shown as an office stamp
- `Sign out`

At 375 the navigation collapses behind the `Menu` button. At 768 and 1280 it is always shown.

**The drawer (`/desk`).** At every viewport, the document order is the list below. At 768 and 375 the on-screen order, top to bottom, is the same. The 1280 bullet further down gives the on-screen arrangement at that width.
1. the top bar
2. the "Lockset turns at midnight" region with the night ruler (office manager and managing partner only)
3. the "Pending rules" region (office manager and managing partner only)
4. the vault tablist
5. the open folder
6. the footer (office manager and managing partner only)

Every vault is a full-width coloured folder band with one trapezoid tab. The bands stack at a fixed step, with each folder starting one tab-height below the one before it. The front folder is open and its slips run past the bottom of the screen. Folders behind the front one are tabs only: their slips are not in the page at all (DP-65 rules in Feedback states).

- At **1280x800**:
  - The folder stack is 86% of the viewport width and aligned left.
  - The "Pending rules" region is a stub rail fixed at the right edge. It stays in view while the page scrolls.
  - Staff accountants and outside bookkeepers have no Pending rules region, no stubs and no out-of-policy count line, so their folder stack takes the full width.
  - On screen, the left column reads top to bottom: the top bar, the vault tab stack, the "Lockset turns at midnight" region lying along the top edge of the open (front) folder directly below the tab stack, the open folder's contents, then the footer. The stub rail is a right-hand column beside them, with its top level with the top of the tab stack.
  - Login slips sit one per row, in four ledger columns: name, held by, next turn, health.
- At **768x1024**: the folder stack is full width, the pending rules sit in a row of stubs directly under the night ruler, and slips sit in two columns.
- At **375x812**:
  - Folders are full width, with tabs staggered left, centre and right in turn at the narrower step.
  - There is no fixed rail. The pending rules form a single column of stubs under the night ruler, in normal page flow.
  - Each slip has two lines: name and health on the first, held by and next turn on the second.
  - The night ruler scrolls sideways inside its own region. The page never scrolls sideways.

**Vault folder.** It opens with a level 2 heading holding the vault name, followed by the formerly text if the vault was renamed. Below the heading come:
- the rule in force, as "At least `<n>` characters"
- the slips
- the office manager's `Add login` and `Rename vault` controls

An empty vault shows an empty folder with the empty-state copy from Feedback states.

**Rotation calendar (`/rotations`).** A folder whose rows are office days. There is one row for each calendar day of the chosen month, labelled with the office date and the offset in effect at that day's midnight. Each row lists that day's runs and turns due.
- At 1280 and 768, rows are full width, with runs laid out across them.
- At 375, each run sits on its own line under the day label.

**Access reviews (`/reviews`).** The current review is an open folder, with a level 2 heading `<quarter> access review` (`<quarter>` looks like `Q4 2026`), then the review's status line, then its progress line. Each review line is one slip. Past reviews sit below as closed tabs. Slips are laid out one per row at 1280, in two columns at 768 and in one column at 375.

**People (`/people`).** A ledger of people showing name, role, status and seat cell. Row actions follow the name. At 375 each person is a two-line slip.

**My travel (`/travel`).** The signed-in person's travel windows, newest first, with `Add travel window`.

**Billing (`/billing`).** One paper slip showing seats in use, next invoice and licence term end, followed by the list of changes waiting on billing. At 768 the figures sit in two columns above the waiting list. At 375 everything is in one column.

**Health report (`/health`).** A folder headed `Health report` with the line `Report for <office date> (America/Chicago)`. It shows, in order:
1. the last good check, as an office stamp
2. five counts: exposed, vendor breached, out of policy, turns due, turns overdue
3. the logins whose health is anything other than sound

The `Office day` picker opens past office days.

**Import (`/import`).** A paper slip form with the file field, followed by a ledger of row outcomes headed by the stored file name. Held rows show their choice controls inline.

**Audit (`/audit`) and the back of the drawer.**
- The full audit trail is a long paper sheet with an office-day picker. It lists that day's entries oldest first, showing office time, actor, action and the subject's name as recorded. It loads the first page and then `More entries`, as described in Interactions.
- On every desk route, the office manager's and managing partner's page footer is the back of the drawer. It is the same sheet, showing the newest ten entries of the current office day under the heading `Back of the drawer`. It sits behind the page content and is uncovered as the content scrolls up off it at the end of the page.
- Staff accountants and outside bookkeepers get no footer and no audit sheet.

**Session-ended and not-found screens.** Each is a single paper slip in the open-folder position, showing its heading from Feedback states and a link: `Sign in` on the session-ended screen, `Drawer` on the not-found screen.

**Loading.** While the drawer or a folder loads, only the folder tab shows, with its band still unfilled.

No screen scrolls sideways at any of the three viewports.

### Public screens and controls (DP-02, DP-06, DP-07, DP-18, DP-23, DP-28, DP-32, DP-34, DP-40, DP-43, DP-46, DP-50, DP-54, DP-58, DP-63, DP-65, DP-68, DP-72)

Only these roles and names are public. Everything else is free.

| Where | Role and accessible name | Visible copy / notes |
|---|---|---|
| Landing | `heading` level 1 `KEYS KEPT HERE` | the headline |
| Landing | `link "Open the drawer"` | goes to `/desk` |
| Landing, top bar | `link "Sign in"` | goes to `/sign-in` |
| Landing | `list "Drawer folders"` with five `listitem` | Payroll, Banking, Hosting, Vendor portals, Office |
| Sign in | text field labelled `Username` | the person's handle |
| Sign in | password field labelled `Password` | |
| Sign in | `button "Sign in"` | |
| Desk shell | `navigation "Desk"` | links `Drawer`, `Rotations`, `Reviews`, `People`, `Billing`, `Health`, `Import`, `Audit`, `My travel`, each shown only to the roles in the route table |
| Desk shell at 375 | `button "Menu"` | toggles the navigation; exposes its expanded state |
| Desk shell | `button "Sign out"` | |
| Desk shell | `status` named `Desk status` | polite live region |
| Desk shell | `alert` named `Desk alert` | assertive live region for refusals |
| Drawer | `region "Lockset turns at midnight"` | office manager and managing partner only |
| Drawer | `slider "Night ruler"` | value 1 to 60; value text as in Interactions |
| Drawer | `region "Pending rules"` with `list "Pending rules"` | one `listitem` per stub; also holds the out-of-policy count line; office manager and managing partner only |
| Drawer | `tablist "Vaults"` with one `tab` per vault, named by the vault name | |
| Drawer tab | `img` named `<vault> lock: rule pending` or `<vault> lock: rule in force` | the lockset cylinder; office manager and managing partner only |
| Drawer | `tabpanel` named by the vault name | the open folder, and the only tabpanel in the page |
| Open folder | `heading` level 2 with the vault's display name | focus target after filing a vault, and after a dropped vault closes a Turn dialog |
| Open folder | `list "Logins in <vault>"`, one `listitem` per login | |
| Login slip | `button "Reveal <label>"`, `button "Copy <label>"`, `button "Hide <label>"` | `Hide` replaces `Reveal` while the secret is shown; `<label>` is the login's label |
| Login slip | `button "Turn <label>"` | office manager, and staff accountants in their own vaults |
| Turn dialog | `dialog "Turn <label>"` with password field `New password`, `button "Save new password"`, `button "Cancel"` | |
| Open folder | `button "Add login"` → `dialog "Add login"` with `combobox "Vendor"`, fields `Login for`, `Username`, `Password`, `button "File login"` | office manager |
| Drawer | `button "New vault"` → `dialog "New vault"` with field `Vault name`, `checkbox "Off when travelling"`, `button "File vault"` | office manager |
| Open folder | `button "Rename vault"` → `dialog "Rename vault"` with field `New name`, `button "Save name"` | office manager |
| Login slip | `button "Rename vendor <vendor>"` → `dialog "Rename vendor"` with field `New name`, `button "Save name"` | office manager |
| Pending rules | `button "New rule"` → `dialog "New rule"` with `combobox "Vault"`, `spinbutton "Minimum length"`, date field `Takes force on`, `button "Save draft"` | office manager, managing partner |
| Pending stub | `button "Sign rule"` | managing partner, drafts only |
| Pending stub | `button "Edit rule"` → `dialog "Edit rule"` with the New rule fields and `button "Save rule"` | drafts and scheduled rules |
| Rotations | `heading` level 1 `Rotation calendar`; `button "Previous month"`, `button "Next month"` | |
| Rotations | `list "Office days"`, one `listitem` per day | |
| Rotations | `button "Schedule rotation"` → `dialog "Schedule rotation"` with `combobox "Login"`, `spinbutton "Every (days)"`, time field `Office time`, date field `First run on`, `button "Save schedule"` | office manager |
| Reviews | `heading` level 1 `Access reviews`; `region "<quarter> access review"` holding `heading` level 2 `<quarter> access review`, the status line and `status "Review progress"` | the progress copy is in Feedback states |
| Review line | `button "Keep <person> on <vault>"`, `button "Remove <person> from <vault>"` | office manager, undecided lines; a decided line shows `Kept` or `Removed` instead |
| Remove confirmation | `dialog "Remove <person> from <vault>"` with text `Their access to <vault> ends now.`, then `button "Remove access"`, `button "Cancel"` in that order | |
| Reviews | `button "Sign off review"` | managing partner |
| Reviews | `tablist "Past reviews"`, one `tab` per past review named by its quarter | |
| People | `heading` level 1 `People`; `table "People"` | seat cell copy as in Feedback states |
| People | `button "Add joiner"` → `dialog "Add joiner"` with fields `Full name`, `Email`, `Handle`, `combobox "Role"`, `Aliases`, one `checkbox` per vault named by the vault name, `Initial password`, `Term starts on`, `Term ends on`, `button "Add to the office"` | office manager |
| People row | `button "Change access for <name>"` → `dialog "Change access"` with `combobox "Role"`, vault checkboxes, `Aliases`, `Term ends on`, `button "Save access"` | office manager |
| People row | `button "Leave for <name>"` → `dialog "Confirm leaver"` with `button "Confirm leave"`, `button "Cancel"` in that order | office manager |
| People row, My travel | `button "Travel for <name>"` / `button "Add travel window"` → `dialog "Travel window"` with fields `Starts`, `Ends`, `button "Save travel window"` | |
| Billing | `heading` level 1 `Billing`; `list "Waiting on billing"` | |
| Health | `heading` level 1 `Health report`; `button "Check now"`; date field `Office day` | |
| Import | `heading` level 1 `Import a spreadsheet`; file field `Spreadsheet file`; `button "Import rows"`; `table "Import rows"` | |
| Held name | `combobox "Who is <text>?"` listing every candidate plus `Not on record`; `button "Save choice"` | `<text>` is the name as written in the file |
| Audit | `heading` level 1 `Audit trail`; date field `Office day`; `table "Audit entries"`; `button "More entries"` | `More entries` shows only while a next page exists |
| Footer | `contentinfo` with `heading` level 2 `Back of the drawer` | office manager and managing partner only |
| Outage | `alert` band | the one inverted band; copy from Feedback states |

Combobox options and list-field formats:
- `Role` options read `Office manager`, `Managing partner`, `Staff accountant` and `Outside bookkeeper`, in that order. Their values are `office_manager`, `managing_partner`, `staff_accountant` and `outside_bookkeeper`.
- `Vendor` options read each vendor's display name, in vendor list order. The display name is `<name>`, or `<name> (formerly <old name>)` after a rename.
- `Vault` options read each vault's display name, formed the same way, in drawer order.
- `Login` options read `<label> (<vendor name>)` with the vendor's current name, for example `Business portal (First Prairie Bank)`. They are in drawer order, then slip order.
- `Who is <text>?` options read each candidate's full name in the row's candidate order, with `Not on record` last.
- `Aliases` is one text field holding names separated by commas.

### Interactions (DP-06, DP-07, DP-27, DP-34, DP-35, DP-37, DP-58, DP-62, DP-67, DP-75, DP-76, DP-77, DP-79)

- **Sign in.** Submitting the form posts the handle, the password and any `next` value from the address bar. On success the browser goes to the `landing` route in the response. A refusal (including the lockout) shows its copy in `Desk alert` and keeps focus in the Username field.
- **Opening a folder.**
  - Clicking or tapping a tab, or pressing Enter or Space on it, brings that folder forward and changes the address to `/desk/vaults/<vault id>`. Reloading that address shows the same folder open.
  - The tablist is a single Tab stop. Left and Right arrows move between tabs, and Home and End go to the first and last tab. Moving focus does not open a folder; only Enter or Space does.
- **Reveal.**
  - `Reveal <label>` asks the server. While the request is pending, the button reads `Revealing`.
  - On success, the secret appears in the slip in tabular figures and `Hide <label>` takes the place of the reveal button. When it hides is set in Feedback states.
  - `Copy <label>` asks the server, puts the returned secret on the clipboard, and announces it.
  - Refusals follow Feedback states.
- **Dialogs.**
  - A dialog opens with focus on its first field, or on its first button if it has no fields.
  - Tab and Shift+Tab cycle inside the dialog, and everything behind it is inert.
  - Escape or `Cancel` closes the dialog and returns focus to the control that opened it.
  - Submitting with errors keeps the dialog open, shows each field's message under that field, and moves focus to the first field in error.
  - Every submit button sends one request at a time. While its request is pending it shows its pending copy, and further clicks or Enter presses send nothing. For example, a double click on `Save schedule` sends one request.
- **Night ruler, keyboard.**
  - The slider holds the next 60 office midnights, from tomorrow's midnight (value 1) to the one 60 days ahead (value 60). Each mark shows `<office date>` and the offset in effect at that midnight.
  - The handle's value text is `<office date> <year>, 00:00 <offset>`, for example `Fri 1 Jan 2027, 00:00 CST`.
  - Right or Up moves one midnight later and Left or Down one midnight earlier, one per press. Home goes to value 1 and End to value 60.
- **Night ruler, pointer (mouse, touch and pen).**
  - Pressing on the handle captures the pointer, and the handle follows it while it moves. On release the handle snaps to the nearest midnight.
  - The handle's hit area is at least 44 by 44 pixels.
  - While the handle is held, a sideways drag changes only the value. Neither the ruler region nor the page scrolls.
  - At 375, a sideways swipe on the ruler track away from the handle scrolls the ruler region sideways and does not change the value. Up and down swipes anywhere on the ruler scroll the page.
  - The same applies under reduced motion.
- **Night ruler, as-of answers.** Each change of night asks the server for its as-of answer. The cylinders, stubs and count follow the answer for the night chosen at that moment. An answer for a night that is no longer chosen is discarded, so fast drags in either direction always end on the chosen night's answer.
- **Pending rules.**
  - The `Pending rules` list holds every stub in the as-of answer for the chosen night, then one stub per drafted rule from the vaults' `pending_rules`.
  - Within each group, stubs follow the drawer order of their vault, then `effective_on`.
  - `Edit rule` appears on draft and scheduled stubs. `Sign rule` appears on draft stubs, for the managing partner only.
  - Stub text always comes from the server: the as-of `text` for as-of stubs, and `stub_text` for drafts.
  - `Edit rule` and `Sign rule` send the `version` the stub was loaded with. On `409 rule_changed`, `Desk alert` shows its copy, the stubs reload from the server, and an open `Edit rule` dialog stays open with its typed values.
- **Access reviews.**
  - `Keep <person> on <vault>` decides the line at once.
  - `Remove <person> from <vault>` opens its confirmation dialog. `Remove access` decides the line; `Cancel` or Escape closes the dialog without deciding.
  - Where focus goes after each step is set in Feedback states.
  - In `Past reviews`, Left and Right arrows move between tabs, and Enter or Space opens one.
- **Audit sheet.**
  - `/audit` loads the address's office day oldest first, 50 entries per page.
  - `More entries` adds the next page below the entries already shown, without reloading those or moving the scroll position. Focus moves to the first newly added entry row.
  - While the next page loads, the button reads `Loading`. The button is gone once there is no next page.
  - Changing `Office day` pushes a new address `/audit?day=<date>` and starts again from the first page. Back and Forward show the earlier or later day, from its first page.
- **Rotation calendar.** `Previous month`, `Next month` and any other month change push a new address `/rotations?month=<YYYY-MM>`. Back and Forward restore the earlier or later month. Day labels and offsets come from the server's calendar answer.
- **Health report day.** Each change of `Office day` asks for that day's report. An answer for a day that is no longer chosen is discarded, so the `Report for` line, the counts and the list always show the last day picked. When `Check now` finishes while a past day is shown, the picker moves to office today and today's report shows.
- **Scroll.** The audit sheet in the footer is uncovered as the content scrolls up off it, and covered again when scrolling back.
- **Live server pushes.** The open page listens to the server's event stream:
  - `rule-in-force`: turns that vault's cylinder and updates the stub and count.
  - `access-changed`: reloads the vault list and removes folders that are no longer visible, with every revealed secret and any open Turn dialog in them. If the open folder was removed, the first remaining folder opens. The change is announced as Feedback states sets out for its cause.
  - `session-ended`: shows the session-ended screen.
  - `billing-changed` and `seat-confirmed`: update the Billing and People screens in place, as Feedback states describes.
  - `review-changed`: reloads that review's lines and progress in place, as Feedback states describes.
  - `check-finished`: reloads the Health panel if it is shown.

  The page never decides any of these from the device clock.
- **Menu at 375.** `Menu` opens the navigation over the top of the drawer. Escape or choosing a link closes it and returns focus to `Menu`.
- **Tab order on the drawer.** Top bar links, `Menu` (at 375), `Sign out`, night ruler, `New rule` and stub buttons, the vault tablist, `New vault`, the open folder's controls in slip order, then the footer.

### Visual design (DP-01, DP-56)

The direction is **page-is-the-object**: the product is the office's key-custody file drawer, and every screen is part of that drawer.

- **Typefaces.**
  - Funnel Display in bold capitals for the hero headline and folder headings. Funnel Sans for everything else.
  - Dates, times, counts and amounts use Funnel Sans tabular figures, with the office time zone written beside them.
  - Each heading step is about a third larger than the one below it, so a level 1 heading is roughly two and a third times body size.
- **Colour roles.**
  - The ground is a pale paper with a faint green cast. The surface is a soft sage tint one step darker.
  - The ink is a deep teal, and it is the only text colour anywhere. There is no black and no grey, and even error copy is teal on paper.
  - The muted role is a lighter mid teal, used for secondary text and as one of the folder band colours.
  - The accent is the same deep teal, used for solid buttons and the outage band. Text on accent is the paper colour.
  - All text meets WCAG 2.2 AA contrast against what it sits on.
- **Hero.**
  - The landing ground is the solid deep teal field, edge to edge.
  - The top row has the Wardhouse wordmark centred and `Sign in` far right, both in paper colour.
  - The headline `KEYS KEPT HERE` is in Funnel Display bold capitals. It is very large: about a tenth of the viewport width, never smaller than roughly six times body text and never larger than about ten times.
  - Under it is a single sentence: `One drawer for every login the office shares, who holds it, and when it turns.`
  - Below are five folders: Payroll, Banking, Hosting, Vendor portals, Office. They alternate paper, surface and muted teal, and each tab sits at its own horizontal position.
  - The front folder is open and carries `Open the drawer` as a solid deep teal button. The button's top corners are cut at the same slant as the folder tabs.
- **Folders.** Every vault is a filled folder band with one trapezoid tab with slanted sides. It is never an outlined box. Bands alternate paper, surface and muted teal down the stack, at a fixed step.
- **Working screens.**
  - Logins are filled paper slips inside the open folder, set in ledger columns. Slips are separated by narrow gaps of surface colour, not by lines.
  - The rotation calendar is a folder whose rows are office days.
  - Pending rules are perforated tear-off stubs clipped to the folder edge, with a row of small round dots along the tear edge.
  - Forms are paper slips, and their submit button has the tab-cut top corners.
  - Empty vaults show an empty folder.
  - Outages and refusals use the one inverted band: teal filled with paper-coloured type, across the top of the open folder.
  - The audit trail is a long paper sheet at the back of the drawer.
  - Density is comfortable: one slip line is a little over twice the height of body text. Controls are at least 44 px in both directions.
- **Nothing extra.** No outlined cards, line rules, monospace labels, index numbering, glass or blur, or photography. No shadows apart from the slight overlap of stacked folders.

### Motion and effects (DP-35, DP-36, DP-57)

All motion starts quickly and settles softly.

- **Folder brought forward.** The chosen folder rises to the front and the previous one drops back, in about half a second.
- **Tab hover and focus.** The tab lifts slightly, in about a third of a second. Keyboard focus shows a visible focus ring in deep teal.
- **Slip unfolds on reveal.** The line holding the revealed secret opens downward in about a third of a second, and closes the same way on hide.
- **Outage band.** When an outage starts, the band slides down from the folder's top edge in about a third of a second. When it ends, the band slides back up.
- **Signature: "Lockset turns at midnight".**
  - Each vault tab carries a small drawn lockset cylinder.
  - When the server's as-of answer says the vault's pending rule is in force on the chosen night, or the vault has no pending rule, the cylinder makes a quarter turn clockwise, from upright to across, over about half a second. When the chosen night moves back before the rule's night, it turns back by the same path.
  - At the same moment, the perforated stub's text changes from the takes-force copy to the in-force copy (Feedback states).
  - The out-of-policy count counts up or down to the server's figure over just under a second.
  - When the real server clock crosses an office midnight with the page open, the affected cylinders turn one after another in drawer order, each a quarter of a second after the last, and each turn is announced.
  - The display always ends on the server's state for the chosen night, whichever way the ruler was dragged.
- **Loading.** The folder tab shows alone, with its band unfilled, until content arrives. There is no spinner.
- **No decorative loops.** Nothing moves unless one of the events above caused it.
- **Reduced motion.** When the system asks for reduced motion:
  - Cylinders snap between upright and across with no rotation.
  - Counts change in one step.
  - Folders and slips appear in place, and the outage band appears without sliding.
  - The stub text and the live-region announcements still change in the same order, and every control stays operable by keyboard, mouse and touch.

### Feedback states (DP-03, DP-05, DP-09, DP-18, DP-23, DP-28, DP-32, DP-36, DP-45, DP-49, DP-52, DP-58, DP-61, DP-63, DP-64, DP-65, DP-68, DP-69, DP-71, DP-72, DP-79)

Polite announcements go to `status "Desk status"` and refusals go to `alert "Desk alert"`. Copy is printed character for character, with straight apostrophes. Placeholders are defined in Business rules (office formats) or right here.

| Action / state | Pending | Success (Desk status) | Refusal or outage |
|---|---|---|---|
| Drawer or folder load | tab alone, band unfilled; `Opening the drawer` | — | — |
| Sign in | button reads `Signing in` | — | 401 bad credentials: `That username and password don't match.`; 401 disabled: `This sign-in is switched off. Ask the office manager.`; 429 locked: `Too many tries. Sign-in for this username reopens at <office stamp>.`, where `<office stamp>` is the instant the lock ends; 503: `Sign-in is unavailable right now. Try again in a minute.` |
| Reveal | `Revealing` | `<label> revealed.` | 423: `This login is past its 14-day leeway. Turn it before revealing.` |
| Copy | — | `<label> copied.` | the same 423 copy |
| A revealed slip hides on its own | — | `<label> hidden.` | — |
| Any request after the session reaches its time limit or the 19:00 cut-off (`401 session_ended`) | — | — | session-ended screen: heading `Your reveal session has ended`, text `Sign in again to reveal logins.` |
| Any request after a leave, a term end or a disabled sign-in (`401 signed_out`) | — | — | the page goes to the sign-in screen, as set in Business rules (Sessions) |
| Turn a login | `Saving` | `<label> turned.` | field message under `New password`: `<vault> needs at least <n> characters.`, where `<n>` is from the rule in force at that instant |
| File vault / login | `Filing` | `<name> filed.` | 422 alert `Check the highlighted fields.` |
| Rename vault or vendor | `Saving` | `Renamed to <new name>.` | 422 alert `Check the highlighted fields.` |
| Empty vault | — | in the folder: `Nothing filed here yet.` | — |
| New or edited rule | `Saving` | `Rule saved as a draft.` | 409 `rule_changed` alert `This rule changed since you opened it. Reload it and try again.`; other 409 or 422 alert `Check the highlighted fields.`; for an effective date that is today or in the past, the field message `Pick a date after today.` |
| Sign rule | `Signing` | `Rule signed. Takes force 00:00 <offset>, <office date>.` | 409 `rule_changed`: the rule-changed copy above; any other 409 alert `This rule can't be signed now.` |
| Pending stub text | — | before the rule's night: `Takes force 00:00 <offset>, <office date>`; on and after it: `In force from 00:00 <offset>, <office date>` | — |
| Draft stub text | — | `Draft, waiting for the managing partner's signature: at least <n> characters from 00:00 <offset>, <office date>` (does not change with the night ruler) | — |
| Out-of-policy count line | — | `<count> logins out of policy on this night` | — |
| Midnight push | — | `<vault> rule now in force.` (for example `Banking rule now in force.`) | — |
| Add joiner | `Adding` | seat confirmed: `<name> joined. Seat confirmed by billing.`; seat waiting: `<name> joined. Their seat is waiting on billing.` | 503 from Keycloak: the sign-in 503 copy |
| Confirm leave | `Confirming` | `<name> has left. <count> logins are due to turn by <office date>.` | 409 alert `<name> has already left.` |
| Billing confirms later | — | `Billing confirmed <name>'s seat.` / `Billing released <name>'s seat.` | — |
| People seat cell | — | `Seat confirmed`, `Waiting on billing`, `Release waiting on billing`, `Released` for seat `confirmed`, `waiting_on_billing`, `release_waiting`, `released` | — |
| Billing unreachable | — | — | band: `Billing can't be reached. Seat changes wait here and are not counted until billing confirms them.`; each waiting change labelled `Waiting on billing` |
| Travel window | `Saving` | `Travel window saved.` | — |
| A travel window opens or a term boundary passes (`access-changed` with cause `boundary`) | — | `Your access changed. Some vaults are no longer shown.` | — |
| The office manager drops a vault from the person (`access-changed` with cause `change`) | — | — | alert `Your access to <vault> ended.`, where `<vault>` is the dropped vault names in drawer order, joined by `, ` with ` and ` before the last (for example `Payroll and Banking`) |
| Review decision | — | `<person> kept on <vault>. <decided> of <total> lines decided.` / `<person> removed from <vault>. <decided> of <total> lines decided.` | 409 alert `This line is already decided.` |
| Review progress line (`status "Review progress"`) | — | `<decided> of <total> lines decided`, where `<decided>` counts lines that are kept or removed and `<total>` counts all lines | — |
| Sign off review | `Signing off` | `Review signed off.` | 409 alert `Decide every line before signing off.` |
| Review status line | — | `Open`, `Overdue`, `Signed off` | — |
| Schedule rotation | `Saving` | `Rotation scheduled. Next turn <office stamp>.` | 409 `rotation_exists` alert `This login already has a rotation.`; 422 alert `Check the highlighted fields.` |
| Moved run on calendar | — | `Moved from <HH:MM>: the clocks skip that hour.` | — |
| Check now | `Checking the breach feed` | `Breach check finished at <office stamp>.` | band: `The breach feed can't be reached. Showing the last good check from <office stamp>.`; if no check has succeeded yet: `The breach feed can't be reached. No check has succeeded yet.` |
| Import | `Importing` | `<created> filed, <matched> already on file, <held> held for your choice, <rejected> rejected.` | 413 alert `That file is too large to import.`; 422 alert `Check the highlighted fields.` with one field message under `Spreadsheet file` (next row) |
| Import field messages | — | — | `file_base64` not valid base64: `The file could not be read.`; not UTF-8, or contains a NUL byte: `Save the spreadsheet as UTF-8 CSV and try again.`; wrong header row: `The first row must be the Lockset column headings.`; more than 2,000 rows: `Import at most 2,000 rows at a time.`; `filename` empty or too long after cutting: `Give the file a name of 1 to 120 characters.` |
| Held name | — | row outcome `Held for your choice`; after saving: `Choice saved.` | — |
| More entries | button reads `Loading` | — | — |
| Not found | — | heading `Nothing in this drawer` | — |

After a rename, current names display as `<new name> (formerly <old name>)`.

**Reveal slips and their timers (DP-61).**
- Every revealed slip has its own hide timer. It runs for 30 seconds from that slip's latest successful reveal.
- Revealing or copying another login never restarts or cancels it, and neither does `Copy <label>` on the same slip.
- Revealing again after a hide starts a fresh 30 seconds.
- When a slip hides on its own, `Desk status` announces the hidden copy above. If focus was on that slip's `Hide <label>`, focus moves to its `Reveal <label>`. Otherwise focus does not move.
- A hide timer firing never closes, resets or takes focus out of an open dialog. Text typed into `New password` is kept, and the caret stays in the field.
- Opening another folder hides every revealed secret in the folder being left. Secret text is removed from the page whenever its slip is hidden.
- Messages in `Desk status` and `Desk alert` stay until the next message in that region replaces them. Nothing clears them on a timer.

**A dropped vault on an open page (DP-79).** This is a server-decided boundary, not a hide timer, so the timer rules above are unchanged. Within five seconds of the change:
- the dropped folder's tab, its slips and every revealed secret of that vault are gone from the page
- an open `Turn` dialog for a login in that vault closes, with no secret or typed text left in the page, and focus goes to the open folder's level 2 heading
- `Desk alert` shows the dropped-vault copy
- the person stays signed in, and other folders' revealed slips and timers carry on untouched

**What closed and back panels expose (DP-65).**
- Only the open folder's contents exist in the page. A folder behind the front one contributes only its `tab`: none of its slips, buttons or text are focusable, visible or in the accessibility tree.
- At 375, while `Menu` is closed, the navigation links are absent from the accessibility tree and the tab order, and `Menu` reports itself as collapsed.
- An open dialog makes everything behind it inert.
- Moving something off-screen does not count as hiding it.

**Focus after review decisions (DP-63, DP-72).**
- Review lines are listed in People order (seed order, then join order), and within each person in drawer order of the vault. A line added mid-quarter takes its place in that order.
- After any decision, the decided line's buttons are replaced by its decision text. Focus then moves to the `Keep` button of the next undecided line in line order, wrapping to the first undecided line.
- When no line is left undecided, focus moves to the review region's level 2 heading.
- `Cancel` or Escape in the Remove confirmation returns focus to the `Remove <person> from <vault>` button that opened it.
- After `Review signed off.`, focus moves to the review's status line, which then reads `Signed off`.
- A `review-changed` update redraws the lines and the progress line in place and never moves focus, unless the focused line itself was closed by a scope change. Focus then moves to the next undecided line by the rule above. An open Remove confirmation for a line closed by a scope change closes, and focus follows the same rule.

**Live billing and seat figures (DP-68).** The server sends `billing-changed` and `seat-confirmed` to every open page of the office manager and managing partner.
- An open Billing screen updates seats, next invoice, licence term end and the waiting list in place within five seconds of Kill Bill's confirmation, with no navigation or reload.
- An open People screen updates that person's seat cell in place, adding their row if it is not shown yet.
- Scroll position and focus are kept, and an open dialog stays open with its typed values.

## Backend

### API (DP-02 to DP-05, DP-08, DP-10, DP-11, DP-13, DP-14, DP-16, DP-17, DP-19 to DP-22, DP-24 to DP-26, DP-29 to DP-31, DP-33, DP-38, DP-39, DP-41, DP-42, DP-44, DP-45, DP-47 to DP-49, DP-51 to DP-53, DP-59, DP-62, DP-64, DP-66, DP-69 to DP-79)

General conventions:
- All endpoints are under the app origin.
- Requests and responses use `application/json; charset=utf-8`, except the event stream. A write with any other content type answers `415`.
- Times in responses are UTC ISO 8601 with `Z`. Office dates are `YYYY-MM-DD`. Office local date-times in requests are `YYYY-MM-DDTHH:MM` with no offset, read in office time.
- Authentication is the `lockset_session` cookie (HttpOnly, SameSite=Lax), set by `POST /api/sessions`.
- Each write row below lists its whole body. Those keys are its published keys; `?` marks an optional key.

**One error shape.** Every error is `{"error":{"code":"<code>","message":"<sentence>"}}`. A `422` has code `invalid` and adds `"fields":{"<field>":"<message>"}`. Where Feedback states or Business rules prints copy for a refusal or field, the message equals that copy. Otherwise messages are short sentences of your choosing.

**One precedence order for the whole API.** Endpoint rows below list only their own extra errors.
1. `403 cross_origin`
2. `413 too_large`
3. `415 unsupported_media_type`
4. `429 sign_in_locked` (sign-in only)
5. `401 signed_out` or `401 session_ended`
6. An idempotent replay returns its stored response here, before any later check.
7. `404 not_found` (unknown, or not visible to the caller)
8. `403 forbidden` (the caller's role may not do this)
9. `409` state conflicts, in the order an endpoint lists them
10. `422 invalid`
11. `423 turn_required`
12. `503` dependency unreachable

Roles: OM office manager, MP managing partner, SA staff accountant, OB outside bookkeeper.

**Sessions and clock**
- `POST /api/sessions` `{"username":"<handle>","password":"...","next":"<path>"?}` → `201 {"person":<person>,"session_ends_at":"<UTC>","landing":"<path>"}` and sets the cookie. `landing` follows the landing rule in Business rules. Errors: `429 sign_in_locked` with a `Retry-After` header, `401 bad_credentials`, `401 account_disabled`, `503 sign_in_unavailable`.
- `DELETE /api/sessions` → `204`, and clears the cookie.
- `GET /api/me` → `200 {"person":<person>,"session_ends_at":"<UTC>"}`.
- `GET /api/clock` (no auth) → `200 {"now":"<UTC>","office_date":"YYYY-MM-DD","office_time":"HH:MM","offset":"CST|CDT","time_zone":"America/Chicago"}`.
- `GET /api/health` (no auth) → `200 {"status":"ok"}`.

**People**
- `<person>` = `{"id","full_name","email","handle","role":"office_manager|managing_partner|staff_accountant|outside_bookkeeper","aliases":[...],"status":"invited|active|travelling|on_term|left","vault_ids":[...],"term":{"starts_on","ends_on"}|null,"travel":[{"id","starts_at","ends_at"}],"seat":"confirmed|waiting_on_billing|release_waiting|released","left_at":"<UTC>"|null}`. `starts_at` and `ends_at` are office local `YYYY-MM-DDTHH:MM`.
- `GET /api/people` (OM, MP) → `200 {"people":[<person>...]}`, in seed order, then join order. SA and OB get `403 forbidden`.
- `POST /api/people` (OM, honours `Idempotency-Key`) `{"full_name","email","handle","role","aliases":[],"vault_ids":[],"initial_password","term":{"starts_on","ends_on"}|null}` → `201 <person>`, with `seat` `confirmed` or `waiting_on_billing`.
  - `422` on `full_name`: 2 to 80 characters.
  - `422` on `email`: valid, and unique among people.
  - `422` on `handle`: 2 to 20 characters, a lowercase letter followed by lowercase letters, digits or hyphens, and never used before in this office.
  - `422` on `role`.
  - `422` on `aliases`: at most 5, each 1 to 30 characters.
  - `422` on `vault_ids`: must exist.
  - `422` on `initial_password`: 12 to 64 characters.
  - `422` on `term`: required for an outside bookkeeper and refused for other roles; `ends_on` must be on or after `starts_on` and on or after office today.
  - `503 sign_in_unavailable` when Keycloak cannot be reached. Nothing is created.
- `PATCH /api/people/<id>` (OM) `{"role"?,"vault_ids"?,"aliases"?,"term_ends_on"?}` → `200 <person>`. Errors: `409 own_record` for the caller's own record, `409 already_left`, `422` as for POST, and `422` on `term` when the change makes the person an outside bookkeeper without `term_ends_on`.
- `POST /api/people/<id>/leave` (OM, honours `Idempotency-Key`) `{"confirm":true}` → `200 {"person":<person>,"turns_due":[{"credential_id","label","due_by":"YYYY-MM-DD"}],"seat":"released|release_waiting"}`. Errors: `409 own_record`, `409 already_left`, `422` when `confirm` is not `true`, and `503 sign_in_unavailable` when Keycloak cannot be reached (nothing changes).
- `POST /api/people/<id>/travel` (OM, or the person themselves) `{"starts_at","ends_at"}` → `201 {"id","starts_at","ends_at"}`. `422` unless `starts_at` is before `ends_at`, `ends_at` is in the future, and the window is at most 60 days long.
- `DELETE /api/people/<id>/travel/<travel id>` (OM, or the person) → `204`. `409 travel_started` once the window has started.

**Vaults, vendors, logins**
- `<vault>` = `{"id","name","formerly":"<old name>"|null,"off_when_travelling":bool,"rule_in_force":{"id","min_length","effective_on"},"pending_rules":[<rule>],"credential_count":n}`.
  - `pending_rules` lists that vault's rules in state `drafted` or `scheduled`, ordered by `effective_on` and then by creation.
  - `pending_rules` is always an empty list for staff accountants and outside bookkeepers.
- `<credential>` = `{"id","vault_id","vendor":{"id","name","domain","formerly"},"label","username","held_by":[{"person_id","name","left":bool}],"next_turn":{"office_date","office_time","offset"}|null,"health":"sound|out_of_policy|exposed|vendor_breached|not_checked","out_of_policy":bool,"out_of_policy_since":"YYYY-MM-DD"|null,"leeway_ends_at":"<UTC>"|null,"rule_id","last_turned_on":"YYYY-MM-DD"}`. A credential response never contains the secret.
- `GET /api/vaults` → `200 {"vaults":[<vault>...]}`: only the vaults the caller may see now, in drawer order.
- `GET /api/vaults/<id>` → `200 {"vault":<vault>,"credentials":[<credential>...]}`.
- `POST /api/vaults` (OM) `{"name","off_when_travelling":bool}` → `201 <vault>`. `422` on `name`: 2 to 40 characters, unique ignoring case. A new vault takes the Vendor portals default rule: in force, minimum 12, effective office today.
- `PATCH /api/vaults/<id>` (OM) `{"name"?,"off_when_travelling"?}` → `200 <vault>`.
- `GET /api/vendors` → `200 {"vendors":[{"id","name","domain","formerly","renames":[{"old","new","by","at"}]}]}`.
- `POST /api/vendors` (OM) `{"name","domain"}` → `201`. `PATCH /api/vendors/<id>` (OM) `{"name"?,"domain"?}` → `200`. `422` on `name` (2 to 60 characters) and on `domain` (a host name, unique).
- `POST /api/credentials` (OM) `{"vault_id","vendor_id","label","username","secret"}` → `201 <credential>`. `422` on:
  - `label`: 1 to 60 characters
  - `username`: 1 to 120 characters
  - `secret`: 1 to 128 characters and at least the in-force minimum
  - a duplicate of an existing login with the same vault, vendor and username
- `GET /api/credentials/<id>` → `200 <credential>`.
- `PUT /api/credentials/<id>/secret` (OM, or SA in a vault visible to them now) `{"secret"}` → `200 <credential>`. `422` on field `secret`, with the turn message from Feedback states.
- `POST /api/credentials/<id>/reveal` and `POST /api/credentials/<id>/copy` (empty body `{}`) → `200 {"credential_id","secret","rule_id","audit_id"}`. Extra error: `423 turn_required`.

**Rules**
- `<rule>` = `{"id","vault_id","min_length","effective_on","state":"drafted|scheduled|in_force|superseded","version":n,"drafted_by","signed_by"|null,"stub_text"|null}`.
- `GET /api/rules?vault_id=<id>` (OM, MP) → `200 {"rules":[<rule>...]}`.
- `GET /api/rules/<id>` (OM, MP) → `200 <rule>`.
- `POST /api/rules` (OM, MP) `{"vault_id","min_length","effective_on"}` → `201 <rule>` in `drafted`, version 1. `422` on `min_length` (whole number from 8 to 64) and on `effective_on` (after office today).
- `PATCH /api/rules/<id>` (OM, MP) `{"version","min_length"?,"effective_on"?}` → `200 <rule>`. 409s in this order: `rule_in_force`, `rule_superseded`, `rule_changed`. Then `422` as for POST and on `version`.
- `POST /api/rules/<id>/sign` (MP only) `{"version"}` → `200 <rule>` in `scheduled`. 409s in this order: `rule_in_force` (the rule is in force), `rule_superseded` (the rule is superseded), `not_a_draft` (the rule is scheduled), `rule_changed`, `effective_date_passed`, `rule_date_taken`. Then `422` on `version`.
- The version rules are in Business rules (Rule versions).

**As-of drawer**
- `GET /api/as-of?night=YYYY-MM-DD` (OM, MP) → `200 {"night","offset","starts_at":"<UTC>","out_of_policy_count":n,"vaults":[{"vault_id","name","rule_in_force":{"id","min_length","effective_on"},"cylinder":"pending|in_force","stubs":[{"rule_id","version","min_length","text","in_force":bool}],"out_of_policy_count":n}]}`. `422` on field `night` unless it is one of the next 60 office midnights.

**Rotations**
- `POST /api/rotations` (OM) `{"credential_id","interval_days","at_time":"HH:MM","first_run_on":"YYYY-MM-DD"}` → `201 {"id","credential_id","interval_days","at_time","first_run_on","next_runs":[<run>×6]}`, where `<run>` = `{"office_date","office_time","offset","at":"<UTC>","shifted":bool}`.
  - `409 rotation_exists` if the login already has a schedule.
  - `422` on `interval_days` (whole number from 1 to 365), on `at_time`, and on `first_run_on` (office today or later, with the first run's instant in the future).
- `PATCH /api/rotations/<id>` (OM), same fields, all required → `200`, same shape.
- `GET /api/rotations/<id>` → `200`, same shape.
- `GET /api/rotations/calendar?month=YYYY-MM` (OM, MP) → `200 {"month","days":[{"office_date","offset","entries":[{"turn_id"|null,"rotation_id"|null,"credential_id","label","vendor":{"name","formerly"},"kind":"scheduled|scope_loss","office_time"|null,"offset","at"|null,"shifted":bool,"due_by":"YYYY-MM-DD","state":"scheduled|due|overdue|turned"}]}]}`.
  - `month` defaults to the current office month. `422` on `month` when it is not a valid `YYYY-MM`.
  - There is one day for each calendar day of the month.
  - Scheduled runs sit on their run date, with `turn_id` null until the run becomes due. Scope-loss turns sit on their due-by date.

**Access reviews**
- `GET /api/reviews` (OM, MP) → `200 {"reviews":[{"id","quarter":"Q4 2026","opened_on","overdue_from","status":"open|overdue|signed_off","signed_off_by"|null}]}`, newest first.
- `GET /api/reviews/<id>` → `200 {...,"decided":n,"total":n,"lines":[{"id","person_id","person_name","vault_id","vault_name","vault_formerly","vendors":[{"name","formerly"}],"decision":"undecided|kept|removed","decided_by"|null,"decided_via":"review|scope_change"|null}]}`, with lines in the line order from Feedback states.
- `POST /api/reviews/<id>/lines/<line id>` (OM) `{"decision":"keep|remove"}` → `200 <line>`. 409s: `review_signed_off`, `line_decided`.
- `POST /api/reviews/<id>/sign-off` (MP only, empty body `{}`) → `200`. 409s: `review_signed_off`, `lines_undecided`.

**Billing**
- `GET /api/billing` (OM, MP) → `200 {"reachable":true,"seats":n,"seat_price":"48.00","currency":"USD","next_invoice":{"date","amount":"<dollars with two decimals>"},"licence_term_ends_on","waiting":[{"person_id","name","change":"add|release","since":"<UTC>"}]}`.
- When Kill Bill cannot be reached, the answer is still `200`, with `"reachable":false`, with `seats`, `next_invoice` and `licence_term_ends_on` all `null`, and with `waiting` still listed.

**Health report**
- `GET /api/health-report?day=YYYY-MM-DD` (OM, MP; `day` defaults to office today) → `200 {"office_date","feed":"ok|unreachable","last_good_check_at":"<UTC>"|null,"counts":{"exposed","vendor_breached","out_of_policy","turns_due","turns_overdue"},"credentials":[<credential> whose health is not sound]}`. `422` on `day` when it is not a valid date or is after office today.
- `POST /api/health-report/checks` (OM, empty body `{}`) → `200` with today's report after a check, or `503 breach_feed_unreachable` with the outage copy.

**Imports**
- `POST /api/imports` (OM, honours `Idempotency-Key`) `{"filename":"<name as chosen, possibly with a path>","file_base64":"<the file's bytes in standard base64>"}` → `201 {"id","filename","counts":{"created","matched","held","rejected"},"rows":[{"row":n,"outcome":"created|matched|held|rejected","credential_id"|null,"reason"|null,"names":[{"text","match":"email|full_name|alias|chosen|not_on_record"|null,"person_id"|null,"held":"no_match|ambiguous"|null,"candidates":[{"person_id","full_name"}]}]}]}`.
  - `filename` in the response is the cut name.
  - `file_base64` uses the standard base64 alphabet with `=` padding. Any other character, including whitespace, makes it invalid.
  - The page sends the file's bytes exactly as read from disk. It never decodes them as text first.
  - `422` on `file_base64`: not valid base64; not UTF-8 or containing a NUL byte; a wrong header row; more than 2,000 non-blank records.
  - `422` on `filename`: empty, or longer than 120 characters after cutting.
  - The field messages are the import field messages in Feedback states.
- `GET /api/imports/<id>` → `200`, same shape.
- `POST /api/imports/<id>/rows/<row>/choice` (OM) `{"text","person_id":"<id>"|null}` → `200` with the row. Errors: `409 row_not_held`, and `422` if `text` is not one of the row's held names or `person_id` is not one of its candidates.

**Audit**
- `GET /api/audit?day=YYYY-MM-DD&order=oldest|newest&limit=<n>&after=<cursor>` (OM, MP) → `200 {"office_day","order","entries":[{"id","seq","at","office_day","office_time","offset","actor":{"person_id","name"}|{"system":"Lockset"},"action","subject":{"kind","id","name"},"details":{}}],"next_cursor":"<opaque string>"|null}`.
  - `day` defaults to office today, and `order` to `oldest`.
  - `limit` is a whole number from 1 to 100 inclusive, and defaults to 50.
  - `seq` is a whole number, unique across the office. A higher `seq` was committed after every entry with a lower one.
  - Entries are the chosen office day's entries, sorted by `seq` in the chosen direction.
  - `next_cursor` is `null` when no further entry exists at the time of the response.
  - `422` on `day` (not a valid date), `order` (not one of the two values), `limit` (out of range or not a whole number) and `after` (a cursor that cannot be decoded, or one issued for another `day` or `order`).
- **Paging guarantee.** Paging continues from the last `seq` returned, never by position. Following the cursors from a first page returns every entry of that day committed before the first page was requested, exactly once. Entries committed while paging in `oldest` order appear on later pages, and they never cause a repeat or a skip, even when many entries share one millisecond of `at`.
- Any `POST`, `PUT`, `PATCH` or `DELETE` on `/api/audit` or below → `405 method_not_allowed`.

**Event stream**
- `GET /api/events` → `text/event-stream` for the signed-in person. Events and their JSON data:
  - `rule-in-force` `{"vault_id","rule_id","name"}`
  - `access-changed` `{"vault_ids":[visible now],"ended":[{"vault_id","name"}],"cause":"change|boundary"}`; `cause` is `change` when the office manager's mover change or review removal dropped the vaults, and `boundary` when a travel window or term boundary did
  - `session-ended` `{}`
  - `billing-changed` `{}`
  - `check-finished` `{"feed":"ok|unreachable"}`
  - `review-opened` `{"review_id"}`
  - `review-changed` `{"review_id"}`
  - `seat-confirmed` `{"person_id","name","change":"add|release"}`

**Idempotency.**
- A request carrying `Idempotency-Key` (1 to 100 visible characters) is remembered for 24 hours, per person and endpoint.
- A replay with the same key and the same body returns the stored status and body, and changes nothing.
- The same key with a different body answers `409 idempotency_conflict`.

### Business rules (DP-03, DP-05, DP-08, DP-11, DP-13, DP-14, DP-16, DP-17, DP-19 to DP-22, DP-24 to DP-27, DP-29 to DP-31, DP-33, DP-35, DP-36, DP-38, DP-39, DP-41, DP-42, DP-44, DP-45, DP-48, DP-51 to DP-53, DP-64, DP-66, DP-69 to DP-79)

**Office time.** The office time zone is America/Chicago. Every due date, day bucket, report day, review date, default audit day, default calendar month and office midnight is computed there, never in UTC or the browser's zone. An office midnight is 00:00 office time. Office business days are Monday to Friday. The offset is `CST` or `CDT`, whichever is in effect at that instant.

Display formats:
- `<office date>` is the three-letter weekday, the day without a leading zero and the three-letter month, for example `Fri 1 Jan`.
- `<office stamp>` is `<office date>, HH:MM <offset>` in 24-hour time, for example `Thu 5 Nov, 14:05 CST`.
- `<offset>` in stub copy is the offset in effect at that midnight.
- `<count>`, `<n>`, `<decided>` and `<total>` are whole numbers. Dollar amounts have two decimals.

**Server clock.** Every time decision uses the server clock. If `LOCKSET_CLOCK_START` is set (an ISO 8601 instant with offset), the server clock starts at that instant when the process starts and then runs forward in real time. Otherwise the server clock is the real time.

**Local times that do not exist or repeat.**
- A local office time skipped by spring-forward moves to the first valid minute after it. For example, 02:30 on the March change night becomes 03:00 CDT and is marked `shifted`.
- A local time repeated by fall-back means its first occurrence, in CDT, and happens only once.
- These rules apply to rotations, travel windows and every other office local time in requests.

**Published fields only.**
- Every `POST`, `PUT` and `PATCH` body accepts only the keys its API row lists. Any other key answers `422 invalid` with that key in `fields` and the message `Lockset does not accept this field.`, and nothing changes. For example, `held_by`, `status`, `state`, `last_turned_on`, `out_of_policy_since`, `health`, `seat`, `signed_by`, `left_at`, `formerly` and `id` are refused wherever the row does not list them, and so is `secret` on a vault or vendor body.
- A published key with the wrong JSON type answers `422` on that key.
- The precedence order still applies. For example, an extra key on the office manager's own record answers `409 own_record`.

**Sign-in lockout.**
- A failed sign-in is an answer of `401 bad_credentials`. Five failed sign-ins for one handle within `SIGN_IN_LOCK_SECONDS` of server clock (default 900 seconds, that is 15 minutes) lock that handle for `SIGN_IN_LOCK_SECONDS` from the fifth failure.
- While the lock lasts, every sign-in for that handle answers `429 sign_in_locked`, even with the right password, with the lockout copy from Feedback states and a `Retry-After` header holding the whole seconds left until the lock ends, rounded up.
- Handles that are not on record are counted and locked the same way, and every answer for them (status, headers other than date, and body) is the same as for a handle on record, so nothing reveals which handles exist.
- A successful sign-in before the lock resets that handle's count.
- Counts and locks are kept in Postgres. Keycloak's own brute-force settings are not changed. Lockouts write no audit entries.

**Landing routes.**
- **After sign-in**, the person lands on `next` when the sign-in request carried a safe one. A safe `next`:
  - starts with exactly one `/` and contains no `\`
  - has a path part equal to a desk route their role may open, or to `/desk/vaults/<id>` for a vault visible to them now

  Anything else is ignored, for example `//evil.example`, `https://evil.example/desk`, or `/billing` for a staff accountant. Without a safe `next`, the person lands on `/desk/vaults/<first visible vault id>` in drawer order, or on `/desk` when no vault is visible to them.
- **Signed-out visits.** A signed-out visit to any desk route goes to `/sign-in?next=<that path, URL-encoded>`.
- **Session ended.** The session-ended screen's `Sign in` link carries `next` for the route that was open.
- **Filing a vault** lands on `/desk/vaults/<new id>` with that folder open and focus on its level 2 heading.
- **Filing a login** keeps the address and moves focus to the new slip's `Reveal <label>` button.
- Reloading or opening any of these addresses shows the same screen.

**Day and month in the address.**
- `/audit?day=YYYY-MM-DD` and `/rotations?month=YYYY-MM` carry the chosen office day and month. Reloading or deep-linking shows the same day (from its first page) or month.
- A missing or invalid value (for example `?month=2027-13`) shows office today or the current office month, and the address is replaced, without a new history entry, with that value. Office today and the office month come from the server clock, never the browser's date.

**Roles and visibility.**
- The office manager and managing partner see every vault. A staff accountant or outside bookkeeper sees only the vaults in their scopes, with these exceptions:
  - A vault marked off when travelling is withheld from a person while one of their travel windows is open, from its start office minute up to its end office minute.
  - An outside bookkeeper sees nothing outside the engagement term.
  - A person who has left sees nothing.
- Staff accountants and outside bookkeepers never receive rules, as-of answers, pending stubs, out-of-policy count lines or the audit sheet.
- A vault that is not visible answers `404 not_found` on every endpoint, including reveal, copy and turning its logins.
- Visibility is decided only on the server, at the moment of each request.

**Person states.**
- A person is `invited` until their first sign-in, then `active`.
- They show `travelling` while one of their travel windows is open, and `on_term` while an outside bookkeeper's term is running.
- `left` is final. It follows a confirmed leave or the end of a term.
- When several states apply, the first in this order wins: left, travelling, on_term, invited, active.
- A person who has left cannot be changed, given travel windows, or left again (`409 already_left`).
- Handles are never reused.
- The office manager cannot change or leave their own record (`409 own_record`).

**Joiners.** Of simultaneous joiner requests with the same handle or the same email, with no `Idempotency-Key` or with different keys, exactly one answers `201` and the rest answer `422` on `handle` (or on `email`). Afterwards exactly one Lockset person, one Keycloak user `<office key>.<handle>`, one Kill Bill bundle `<office key>-seat-<handle>` and one `person_join` entry exist.

**Movers.** A `PATCH` to a person's role or vaults applies on that person's next request:
- every dropped vault answers `404 not_found` to them from the change on, and `access-changed` with cause `change` reaches their open pages within five seconds
- their session stays alive; a mover change never ends a session or sends `session-ended`
- a change to `managing_partner` or `office_manager` grants every vault at once
- a change to `outside_bookkeeper` needs `term_ends_on`, and the term starts on office today

**Sessions.**
- A Lockset session starts at sign-in. It ends at whichever comes first:
  - `REVEAL_SESSION_SECONDS` after it started (default 28,800 seconds, that is 8 hours)
  - the next 19:00 office time after it started
- `session_ended` covers only these two time limits. When a session reaches either one, the server sends `session-ended` within five seconds. Every later request with that cookie answers `401 session_ended`, and the page shows the session-ended screen.
- These answer `401 signed_out`: a session ended by a leave or by the end of an engagement term, a session belonging to a person whose Keycloak user is disabled, a request with no cookie, and a request with an unknown cookie. This holds even if the session's time limit has also passed.
- An open page that receives `401 signed_out` goes to `/sign-in?next=<the open route, URL-encoded>` and keeps no secret on screen. It never shows the session-ended screen for a `401 signed_out`.

**Engagement term.** An outside bookkeeper's Keycloak user is enabled from 00:00 office time on `term.starts_on`. Their scopes end at 23:59 office time on `term.ends_on`, and from 23:59:00 they see nothing. At that instant the server records them as left, with the actor `Lockset`, and all the leave effects below follow.

**Leave.** Confirming a leave, or reaching the end of a term, does all of the following in one action:
- disables the person's Keycloak user and ends their Keycloak sessions
- ends every Lockset session they hold, so from then on their cookie answers `401 signed_out` (never `401 session_ended`)
- removes every vault scope
- sends `access-changed` to their open pages
- marks their `held_by` entries as `left`
- requests the seat release
- writes the audit entries listed for a leave in the audit table

Of two simultaneous confirmations, exactly one answers `200` and the other `409 already_left`.

**Scope loss and turns due.**
- Whenever a person loses a vault scope, Lockset creates one `scope_loss` turn for every login in that vault. A scope is lost when:
  - a person leaves (for the office manager or managing partner, this covers every vault)
  - an engagement term ends
  - a mover change drops a vault
  - a review line is removed
- The turn's `due_by` is the second office business day after the office date on which the scope was lost. For example, a leave confirmed at 23:40 office time on a Thursday is due by the following Monday.
- The turn is `due` at once.

**Rotations.**
- A login has at most one schedule. Of any number of simultaneous `POST /api/rotations` for one login, exactly one answers `201` and the rest `409 rotation_exists`, and exactly one `rotation_schedule` entry is written.
- A schedule's runs fall at `at_time` office time on `first_run_on` plus whole multiples of `interval_days`. They keep that wall-clock time across DST by the rule above. The calendar shows one entry per run date.
- `next_runs` lists the next six runs from now.
- A run is `scheduled` until its instant. It then becomes `due` and gets its turn, exactly once, and writes one `rotation_due` entry. This holds on a fall-back night too.
- `PATCH /api/rotations/<id>` replaces future runs only. Turns already `due` or `overdue` keep their `turn_id` and state, and a new run never repeats an instant that already has a turn.
- A run's `due_by` is the second office business day after its office date.
- A due turn becomes `overdue` at the office midnight after its `due_by`.
- Saving a new secret for a login moves every due and overdue turn of that login to `turned`, sets `held_by` to just the person who saved it, and sets `last_turned_on` to office today.
- A login's `next_turn` is its earliest open turn or scheduled run.

**Rules.** Each rule sets a minimum secret length for one vault, from 00:00 office time on its `effective_on`.
- `drafted` → `scheduled` happens only through the managing partner's signature. A signature on a rule that is not drafted answers by its state: an in-force rule `409 rule_in_force`, a superseded rule `409 rule_superseded`, and a scheduled rule `409 not_a_draft`. After the state and version checks, it is refused with:
  - `409 effective_date_passed` if `effective_on` is not after office today
  - `409 rule_date_taken` if another scheduled rule for that vault has the same date
- Drafted and scheduled rules may be edited. Editing a scheduled rule returns it to `drafted`, so it must be signed again.
- `scheduled` → `in_force` happens only when the server clock reaches 00:00 office time on `effective_on`, never earlier. At that instant the vault's previous in-force rule becomes `superseded`.
- In-force and superseded rules cannot be edited (`409 rule_in_force`, `409 rule_superseded`). A change to an in-force rule is made as a new rule.
- A rule saved for a past date or for today is refused with the `effective_on` field error.
- A rule's `stub_text` depends on its state:
  - `drafted`: the draft stub copy (Feedback states)
  - `scheduled`: the takes-force copy
  - `in_force`, during the office day it took force: the in-force copy
  - otherwise: `null`
- Drafts never appear in `/api/as-of` stubs. They never move a cylinder and never change an out-of-policy count.
- The rule in force at any instant is the in-force or scheduled rule for that vault with the latest `effective_on` on or before that instant's office date. It is decided once on the server, so every surface and every person sees the same rule.
- A secret saved at an instant must meet the rule in force at that instant. Each reveal or copy records the rule in force when it happened.

**Rule versions.**
- Every rule's `version` starts at 1 and rises by exactly one on every edit and every signature. Taking force does not change it.
- An edit or signature whose `version` is a whole number but not the rule's current version answers `409 rule_changed`, with the message `This rule changed since you opened it. Reload it and try again.`, at its place in the API's 409 order.
- A missing or non-whole `version` skips the `rule_changed` check, runs the remaining 409 checks, and then answers `422` on `version`.
- Of simultaneous edits sending the same version, exactly one answers `200` and the rest `409 rule_changed`; exactly one `rule_edit` entry is written. Of simultaneous signatures sending the same version, exactly one answers `200` and the rest `409 not_a_draft`.

**Out of policy and leeway.**
- A login is out of policy when its secret is shorter than the minimum of the rule in force.
- `out_of_policy_since` is the office date it first fell out of policy under that rule: the rule's effective date, or the import date for an imported secret.
- `leeway_ends_at` is 00:00 office time fourteen office days after that date. From that instant, reveal and copy answer `423 turn_required` until the login is turned.

**As-of answers.** For a chosen night N (00:00 office time on date N):
- Each vault's `rule_in_force` is the rule that would be in force at N, among in-force and scheduled rules.
- `cylinder` is `pending` when a scheduled rule of that vault has `effective_on` after N, and `in_force` otherwise.
- Each scheduled rule, and each rule that took force during the current office day, has a stub. Its `text` is the takes-force copy when N is before its `effective_on`, and the in-force copy otherwise.
- A vault's `out_of_policy_count` counts its logins whose current secret is shorter than the minimum at N. The top-level count is the sum across vaults.

**Midnight push.** Within five seconds after an office midnight at which one or more rules take force, the server sends one `rule-in-force` event per vault, in drawer order.

**Access reviews.**
- A review for each calendar quarter opens at 00:00 office time on that quarter's first office business day.
- It opens with one line for each pair of a non-left staff accountant or outside bookkeeper and a vault in their scopes.
- It becomes `overdue` at 00:00 office time on the eleventh office business day, counting the opening day as the first.
- Each line is decided once, as keep or remove, with `decided_via` `review`. Removal revokes the scope at once. A second decision answers `409 line_decided`. Of simultaneous decisions, the first wins.
- While the review is `open` or `overdue`, lines follow scope changes:
  - when a staff accountant or outside bookkeeper loses a scope by a mover change, a leave or a term end, that pair's undecided line becomes `removed` with `decided_by` null and `decided_via` `scope_change`
  - when a staff accountant or outside bookkeeper gains a scope by joining or by a mover change, an undecided line for that pair is added at its line-order position, unless the pair already has an undecided line
  - the server sends `review-changed` to every open page of the office manager and managing partner within five seconds of any line change
- Only the managing partner signs off, and only when no line is undecided, including lines added mid-quarter (`409 lines_undecided`). A signed-off review is final and never changes.

**Seats and billing.** Every person who has not left holds one seat. A seat counts only once Kill Bill confirms it. Lockset never counts a seat ahead of that confirmation.

Published proration rule:
- A joiner's seat is a new annual seat subscription, invoiced in full for its first year from the day Kill Bill accepts it.
- A leaver's seat ends at once, with no refund. Billing runs to the date already paid, and the seat never renews.

Derived figures, all from Kill Bill and only from the account whose external key is `OFFICE_KEY`. Subscriptions on any other account in the shared tenant are never counted.
- `seats` is the number of ACTIVE seat subscriptions on the office account.
- `next_invoice.date` and `licence_term_ends_on` are the earliest `chargedThroughDate` among those subscriptions.
- `next_invoice.amount` is the seat price times the number of active seats with that date.
- A confirmed new seat always raises `seats` by one. It changes `next_invoice` and `licence_term_ends_on` only when its `chargedThroughDate` is the earliest among the active seats, or ties with it.

Changes Kill Bill has not yet confirmed:
- An unconfirmed change is `waiting_on_billing` (an add) or `release_waiting` (a release). It is listed as waiting and never counted.
- Lockset asks Kill Bill within the request that caused the change and waits up to 5 seconds for Kill Bill to report the subscription confirmed. If it is not confirmed by then (or Kill Bill is unreachable), the request still succeeds and the change is recorded as waiting. Lockset then re-checks every waiting change every 2 seconds without a restart.
- A retry first looks up the bundle by its external key and never creates a second subscription for one seat.
- A release for a seat whose purchase is still waiting is sent right after the purchase is confirmed, so it uses Kill Bill's confirmed dates.
- Each confirmation sends `billing-changed` and `seat-confirmed` within five seconds of the moment Kill Bill reports it confirmed. The 2-second re-check interval supports this bound. A confirmation reached inside the request's 5-second wait sends them with that request's answer.

**Health.**
- Lockset runs a breach check at start, then every `BREACH_CHECK_SECONDS` (default 60 seconds), and also on `Check now`.
- Checks never overlap. A check requested while another is running (scheduled or manual) waits for that run and answers with its result.
- A login's `health` is the first that applies in this order:
  1. `exposed`: its password's hash suffix is in the range answer with a count above zero
  2. `vendor_breached`: its vendor's domain is in the breached-domain list
  3. `out_of_policy`
  4. `sound`

  Before the first good check, it is `not_checked`.
- Each good check stores a snapshot for the office day it ran in: every login's health and the five report counts, taken at the check instant.
  - `exposed` and `vendor_breached` count logins with that health.
  - `out_of_policy` counts logins whose out-of-policy flag is true, whatever their health.
  - `turns_due` counts open turns in state `due`, and `turns_overdue` counts open turns in state `overdue`.
- The report for a past day returns the snapshot of the last good check that ran in that office day. Today's report uses the latest good check overall.
- An office day with no good check returns `200` with `last_good_check_at` null, all five counts 0 and an empty `credentials` list.
- `feed` is `ok` when the most recent check attempt succeeded and `unreachable` when it failed. It is the same on every day's report.

**Reading an import file.** The uploaded bytes are read in this order:
1. Decode the base64.
2. Refuse bytes that are not valid UTF-8 or that contain a NUL byte.
3. Drop one leading UTF-8 byte order mark, if present.
4. Split into records and fields under these rules:
   - Fields are separated by commas.
   - A record ends at LF or at CRLF outside quotes. The last record may have no line end.
   - A field that begins with a double quote is quoted and runs to its closing quote. Inside it, commas and line breaks (LF or CRLF, kept exactly as written) are part of the value, and `""` stands for one double quote.
5. The first record must be exactly `Vault,Login for,Website,Username,Password,Who knows it,Last changed`.
6. Skip blank records: an empty line, or a record whose fields are all empty.
7. Number the rest: `row` is the 1-based number of each non-blank record after the header. At most 2,000 such records are allowed.

Import file names:
- The filename is cut to the part after its last `/` or `\`, and control characters are removed. The result must be 1 to 120 characters, both limits included.
- The cut name is what is stored and shown. For example, `D:\Office\marta\Desktop\Passwords FINAL v3.csv` becomes `Passwords FINAL v3.csv`.

**Import row checks.** Each row is checked in this order, and the first failure rejects it with exactly this `reason`:
1. `Unknown vault`: the first field does not equal an existing vault name, ignoring case
2. `Wrong number of columns`: the record has a field count other than 7
3. `Password must be 1 to 128 characters`
4. `Login for must be 1 to 60 characters`
5. `Website must be a domain or URL`: no host name can be read from it
6. `Username must be 1 to 120 characters`
7. `Last changed must be M/D/YYYY`: not empty and not a real date in that form

No other reason exists. No import response, held-name answer, error body, audit `details` or log line ever contains any Password cell, whether the row was filed, held, rejected or malformed. `import_row` details are exactly `{"row","outcome","reason"}`.

**Import fields.**
- `Website` is a domain or URL. Its host, lowercased and without a leading `www.`, matches a vendor by domain. If no vendor matches, a vendor is created with that host as both name and domain.
- `Who knows it` holds names separated by `;` or `/`. A comma inside a quoted cell is part of a name.
- `Last changed` becomes `last_turned_on`, which is office today when the field is empty.

**Import matching.**
- Each name is trimmed and compared ignoring case and repeated spaces, against every person on record, including people who have left. The comparisons run in this order:
  1. equal to a person's email
  2. equal to a person's full name
  3. equal to exactly one person's alias
- A name that matches none of these is held as `no_match`. A name whose alias matches two or more people is held as `ambiguous`.
- Candidates, in People order:
  - for `ambiguous`: the people who share the alias
  - for `no_match`: everyone whose full name shares a word with the name, ignoring punctuation
- A row's login is identified by vault, vendor domain and username, ignoring case.
  - If that login already exists, the row is `matched`, whatever its `Who knows it` says. Its names are not evaluated, `names` is empty, and nothing is created or overwritten. No name is ever held for an existing login.
  - Otherwise, a row with no held names creates the login with the matched people as `held_by`, and its outcome is `created`.
  - A row with any held name creates nothing (`held`) until every held name has a choice. It then becomes `created`, or `matched` if the login exists by then. A choice never changes the `held_by` of a login that already exists.
- Import never creates people.
- Re-running the same bytes, even at the same time as the first run, creates no people, vendors or logins. So does the same content saved with or without a byte order mark, or with LF instead of CRLF line ends.
- Each row writes one `import_row` entry.

**Renames.** Renaming a vault or vendor writes a forward record of the old value, the new value, who made the change and when. Every current surface shows the new name with `formerly` set to the name just before. Past audit entries keep `subject.name` as it was when they were written.

**Audit.**
- Every state change Lockset makes writes the entries listed for it in the audit table below. Each entry carries its `seq`, its office day and time, and the subject's name at that moment.
- These write no entries: signing in, signing out, a first sign-in, a failed sign-in or lockout, a travel window opening or closing, and breach checks.
- Details:
  - `reveal` and `copy` details carry `rule_id`.
  - `person_leave` details carry `confirmed_by` and the `turns_due`.
  - `turn_due` details carry `confirmed_by` when a person confirmed the change that caused it.
  - `review_decision` details carry `decided_via`.

Action names:
- logins and vaults: `reveal`, `copy`, `secret_edit`, `credential_create`, `vault_create`, `vault_change`, `vault_rename`, `vendor_create`, `vendor_change`, `vendor_rename`
- people: `person_join`, `person_change`, `person_leave`, `term_start`, `term_end`, `travel_set`, `travel_cancel`, `scope_removed`
- rules: `rule_draft`, `rule_edit`, `rule_sign`, `rule_in_force`, `rule_superseded`
- rotations and turns: `rotation_schedule`, `rotation_change`, `rotation_due`, `rotation_overdue`, `turn_due`, `turn_done`
- reviews: `review_open`, `review_overdue`, `review_decision`, `review_line_added`, `review_sign_off`
- imports: `import_row`, `import_choice`
- seats: `seat_waiting`, `seat_confirmed`, `seat_released`

Audit table. Each row is one cause, and "per" means one entry for each item. The actor is the signed-in person, or `Lockset` for timed events.

| Cause | Entries written |
|---|---|
| Reveal, copy | 1 `reveal` or 1 `copy`, subject the login |
| Save a new secret | 1 `secret_edit`, subject the login, then 1 `turn_done` per open turn moved to turned, subject the login |
| Create vault | 1 `vault_create` |
| Change vault | 1 `vault_rename` if the name changed and 1 `vault_change` if the flag changed (both, if both changed) |
| Create vendor | 1 `vendor_create` |
| Change vendor | 1 `vendor_rename` if the name changed and 1 `vendor_change` if the domain changed |
| Create login | 1 `credential_create` |
| Add joiner | 1 `person_join`; then 1 `review_line_added` per review line added; then 1 `seat_waiting` only if billing does not confirm the seat at once; then 1 `seat_confirmed` when it is confirmed. For an outside bookkeeper, also 1 `term_start` at 00:00 on `starts_on`, or at creation if that has already passed |
| Change a person's access | 1 `person_change`, then for each vault dropped 1 `scope_removed` (subject the person), 1 `review_decision` per review line closed by the change, and for each login in it 1 `turn_due`; then 1 `review_line_added` per review line added |
| Confirm a leave | 1 `person_leave`; then for each vault removed 1 `scope_removed`, 1 `review_decision` per review line closed, and for each turn created 1 `turn_due`; then 1 `seat_waiting` only if the release is not confirmed at once; then 1 `seat_released` when it is confirmed |
| End of an engagement term | the same as a leave, with 1 `term_end` in place of `person_leave` |
| Add or cancel a travel window | 1 `travel_set` or 1 `travel_cancel` |
| Draft, edit or sign a rule | 1 `rule_draft`, 1 `rule_edit` or 1 `rule_sign`, subject the vault |
| A rule takes force | 1 `rule_in_force` for the rule and 1 `rule_superseded` for the rule it replaces, subject the vault |
| Schedule or change a rotation | 1 `rotation_schedule` or 1 `rotation_change`, subject the login |
| A scheduled run becomes due | 1 `rotation_due`, subject the login |
| Any open turn becomes overdue | 1 `rotation_overdue`, subject the login |
| A review opens or becomes overdue | 1 `review_open` or 1 `review_overdue` |
| Decide a review line | 1 `review_decision`; for a removal, also the `scope_removed` and `turn_due` entries as for a mover change |
| Sign off a review | 1 `review_sign_off` |
| Import row | 1 `import_row` for every row, whatever its outcome; for a created login, also 1 `credential_create`, plus 1 `vendor_create` if its vendor was created |
| Held-name choice | 1 `import_choice`; if the choice makes the row create its login, also 1 `credential_create` (and 1 `vendor_create` if needed) |
| Billing confirms a change later | 1 `seat_confirmed` or 1 `seat_released` |

### Services (DP-10, DP-16, DP-17, DP-19, DP-21, DP-44, DP-45, DP-47, DP-49, DP-59, DP-60, DP-74, DP-76, DP-78)

**Keycloak** (`KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`). Lockset administers users in the realm through the `app` client's service account. The realm is shared with other offices.
- Each person is a Keycloak user with all of these set (Keycloak refuses password sign-in for an incomplete profile, so every field is required):
  - username `<office key>.<handle>`
  - first name: the first word of the full name
  - last name: the rest of the full name, or the first word again if there is only one word
  - email `<office key>.<handle>@people.lockset.example`, marked verified
  - a non-temporary password
- `<office key>` is `OFFICE_KEY`, default `bl`: 2 to 8 lowercase letters.
- Only users whose username starts with `<office key>.` belong to this office. Sign-in and People never consider any other user. A handle that is on record only in another office answers `401 bad_credentials`. Handles are unique per office, so the same handle may exist in every office.
- Sign-in checks `<office key>.<handle>` and the password through the `app` client's password grant. An "account disabled" answer maps to `401 account_disabled`.
- Users are created enabled. An outside bookkeeper's user is enabled only within the engagement term.
- A Keycloak "user already exists" answer during a joiner race is a lost race (`422` on `handle`), never a `503`, and never leaves a second user.
- A leave or the end of a term disables the user and ends its sessions.
- On every start, Lockset creates any seeded user that is missing and leaves existing users unchanged.
- If Keycloak cannot be reached, sign-in, joining and leaving answer `503 sign_in_unavailable` and change nothing. Seeding retries every 30 seconds.

**Kill Bill** (`KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`). The tenant is shared with other offices.
- On start, and whenever Kill Bill is reachable, Lockset makes sure that:
  - the tenant catalog has plan `lockset-seat-annual`: product `Lockset-Seat`, BASE category, USD 48.00 per year, billed annually in advance, no trial. A catalog already holding that plan, uploaded by another office, is not an error and does not block billing.
  - there is an account with external key `<office key>`, name `Brannock & Lyle` and currency USD
- Each seat is one subscription on that plan, in its own bundle with bundle external key `<office key>-seat-<handle>`, on the office account.
- A purchase is confirmed when Kill Bill reports the subscription ACTIVE with a `chargedThroughDate`.
- A release cancels that subscription, with the entitlement ending immediately and billing ending at the end of the paid term. It is confirmed when Kill Bill reports the subscription CANCELLED with `billingEndDate` equal to its `chargedThroughDate`.
- When Kill Bill is unreachable, the waiting rules in Business rules apply, `GET /api/billing` reports `reachable:false`, and the Billing and People screens show the billing outage band.

**Postgres** (`DATABASE_URL`).
- Postgres is the only system of record. Lockset applies its schema on every start without losing data.
- Login secrets are stored only in encrypted form. The key comes from `LOCKSET_SECRET_KEY` (64 hexadecimal characters) or, when that is unset, is derived from `AUTH_CLIENT_SECRET`.
- The key is never stored in Postgres. No Postgres column holds a plaintext secret, an imported Password cell in plain text, or a full password hash.

**Breach-exposure feed** (WireMock at `WIREMOCK_URL`; the feed and all its data are invented).
- Lockset computes the SHA-1 of each secret in memory, in uppercase hexadecimal, and sends only the first five characters. No full hash, suffix or secret appears in any request path, query, header or body.
- `GET <WIREMOCK_URL>/v1/range/<PREFIX>`, where `<PREFIX>` is five uppercase hexadecimal characters, sent with the request header `Add-Padding: true`, returns `200 {"results":[{"suffix":"<35 uppercase hex>","count":<whole number>}]}`. Suffixes match ignoring case. Rows with `count` 0 are padding and are ignored. The feed answers range requests without that header with a non-200 status, which fails the check.
- `GET <WIREMOCK_URL>/v1/breached-domains` returns `200 {"domains":[{"domain","title","breached_on":"YYYY-MM-DD","data_classes":[...]}]}`.
- Baseline answers:
  - Prefix `5BAA6` returns suffix `1E4C9B93F3F0682250B6CF8331B7EE68FD8` with count 3861493, plus the padding row suffix `00000000000000000000000000000000000` with count 0.
  - Every other prefix returns only that padding row.
  - The breached-domain list holds `gridhaven.example`, titled `Gridhaven Hosting control panel`, breached on 2026-08-19, with data classes `Email addresses` and `Passwords`.
- Any connection failure, any timeout over five seconds, or any answer other than 200 makes the check fail:
  - the feed is `unreachable` and the last good check is kept
  - the outage band copy shows
  - `POST /api/health-report/checks` answers `503 breach_feed_unreachable`

  The next scheduled or manual check after the feed returns succeeds, with no restart.

### Seed data (DP-06, DP-07, DP-12, DP-23, DP-32, DP-37, DP-40, DP-43, DP-46, DP-50, DP-54)

Every person, business, vendor and domain here is invented. On the first start with an empty database, Lockset seeds the records below. `T` is the office date at that first start. The audit trail starts empty.

**People.** Every seeded person counts as having signed in, and every Keycloak password is `KeysKept-2026`. Emails are at `brannocklyle.example`.

| Full name | Handle | Email | Role | Aliases | Vaults |
|---|---|---|---|---|---|
| Marta Lindqvist | marta | marta.lindqvist@ | office_manager | Marta | all |
| Graham Brannock | graham | graham.brannock@ | managing_partner | Graham | all |
| Deandra Okafor | deandra | deandra.okafor@ | staff_accountant | Dee, Deandra | Payroll, Banking, Vendor portals |
| Desmond Okafor | desmond | desmond.okafor@ | staff_accountant | Des, Desmond | Vendor portals, Office |
| Theo Vasquez | theo | theo.vasquez@ | staff_accountant | Theo | Banking, Hosting, Office |
| Sam Whitfield | sam | sam.whitfield@ | staff_accountant | Sam | Hosting, Vendor portals |
| Samantha Lyle | samantha | samantha.lyle@ | staff_accountant | Sam, Samantha | Payroll, Vendor portals |
| Priya Raman | priya | priya.raman@ | outside_bookkeeper | Priya | Payroll, Banking |

Priya's term runs from `T` minus 30 days to `T` plus 60 days. Every seeded person holds a seat. For example, with the seed data at start the Billing screen shows 8 seats at $48.00 and a next invoice of $384.00.

**Vaults**, in drawer order:
1. Payroll: off when travelling; rule in force minimum 14.
2. Banking: off when travelling; rule in force minimum 12.
3. Hosting: minimum 12.
4. Vendor portals: minimum 12.
5. Office: minimum 10.

Rules:
- The in-force rules for Payroll, Banking, Hosting and Vendor portals took effect on 2025-01-01.
- Office has two rules: minimum 8 from 2025-01-01, superseded by minimum 10 from `T` minus 20 days.
- A scheduled Banking rule, minimum 16, takes force on the first 1 January after `T`. Its version is 2.
- Every other seeded rule has version 2 as well. Every seeded rule was drafted by Marta Lindqvist and signed by Graham Brannock.

**Vendors.**

| Vendor | Domain |
|---|---|
| Paystride Payroll | paystride.example |
| First Prairie Bank | firstprairie.example |
| Missouri Valley Credit Union | mvcu.example |
| E-File Gateway | efilegateway.example |
| Gridhaven Hosting | gridhaven.example |
| Tallyroom Practice Suite | tallyroom.example |
| Inkwell Printers | inkwell.example |

**Logins.** Every login's `last_turned_on` is `T` minus 40 days.

| Vault | Vendor | Label | Username | Secret | Held by |
|---|---|---|---|---|---|
| Payroll | Paystride Payroll | Payroll admin | payroll@brannocklyle.example | `Tw9-harbor-quill-58` | Deandra Okafor, Priya Raman |
| Banking | First Prairie Bank | Business portal | bl-treasury | `Prairie-wind-7731` | Deandra Okafor, Theo Vasquez |
| Banking | Missouri Valley Credit Union | Operating account | brannocklyle | `Ledger-oak-221` | Theo Vasquez |
| Banking | First Prairie Bank | Payroll funding | bl-payroll-fund | `Cornfield-tax-90` | Deandra Okafor, Priya Raman |
| Banking | Missouri Valley Credit Union | Card admin | bl-cards | `Silo-river-3344` | Theo Vasquez |
| Hosting | Gridhaven Hosting | Website host | webmaster@brannocklyle.example | `Gh-stack-plum-8812` | Sam Whitfield |
| Vendor portals | E-File Gateway | EFIN account | bl-efile | `Efile-maple-2020!` | Deandra Okafor, Samantha Lyle |
| Vendor portals | Tallyroom Practice Suite | Practice admin | marta.lindqvist | `Tally-room-door-41` | Marta Lindqvist |
| Office | Inkwell Printers | Front desk printer admin | admin | `password` | Desmond Okafor, Theo Vasquez |

Consequences, for example with the seed data at start:
- With the baseline feed, the printer admin is `exposed` and the website host is `vendor_breached`.
- Operating account and Card admin fall out of policy on the Banking rule's night, so the Banking as-of count for that night is 2.
- Front desk printer admin has 8 characters, under the Office minimum of 10, so it has been out of policy since `T` minus 20 days and its leeway ended 6 days before `T`.
  - Revealing or copying it answers `423`.
  - Every night's top-level as-of count includes it, so the top-level count on the Banking rule's night is 3.

**Rotations.**
- Business portal: every 90 days at 02:30, first run on the first second Sunday of March after `T` (a spring-forward night).
- Website host: every 28 days at 01:30, first run on the first first Sunday of November after `T` (a fall-back night).
- Payroll admin: every 30 days at 09:00, first run on `T` plus 3 days.

**Open turns.** Two `scope_loss` turns are open at the start. They have no rotation behind them and no audit entries, and they are exempt from the two-business-day computation.
- Operating account: `due_by` `T` minus 7 days, state `overdue`.
- Card admin: `due_by` `T`, state `due`. It becomes `overdue` at the next office midnight.

**Review.** The review for the quarter containing `T`, opened on that quarter's first office business day. It has one undecided line for each staff accountant or bookkeeper and each vault they hold in the people table, 14 lines in all, so its progress line reads `0 of 14 lines decided`.

**Legacy file.** The import journey uses a file like this (invented). Excel saves it with a leading byte order mark and CRLF line ends:

```
Vault,Login for,Website,Username,Password,Who knows it,Last changed
Banking,Business portal,https://www.firstprairie.example,bl-treasury,Prairie-wind-7731,Dee / Theo,3/2/2026
Payroll,Payroll tax filings,paystride.example,bl-payroll-tax,Tax-filing-9921,D. Okafor,1/15/2026
Hosting,DNS registrar,dnsharbor.example,bl-dns,Harbor-dns-2025,Sam,
Office,Guest Wi-Fi admin,inkwell.example,wifi-admin,Guest-wifi-0099,theo.vasquez@brannocklyle.example; Priya Raman,6/30/2026
Archive,Old fax portal,faxly.example,bl-fax,fax12345,Marta,
```

With the seed data, the five rows come out as follows:

| Row | Outcome | Why |
|---|---|---|
| 1 | `matched` | the login already exists, so its names are not evaluated |
| 2 | `held` | the login is new and `D. Okafor` has no match; the candidates are Deandra and Desmond Okafor |
| 3 | `held` | `Sam` is ambiguous |
| 4 | `created` | both names match, and vendor Inkwell Printers matches by domain |
| 5 | `rejected` | `Unknown vault` |

## Technical requirements

### Deployment (DP-59, DP-74)

The runtime is Node.js 22 with npm. `/app/run.json` holds string commands for `install`, `build` and `serve`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- `GET /api/health` answers HTTP 200 `{"status":"ok"}` once the Postgres schema is applied, whatever the state of Keycloak, Kill Bill or the breach feed.
- One built app may run as several instances at once. Each instance has its own `DATABASE_URL`, `OFFICE_KEY` and Lockset settings, and all of them share the same Keycloak realm and Kill Bill tenant. Each instance is one office and never counts or lists another office's users, accounts or subscriptions.

### Configuration and secrets (DP-60)

These are read at start, never hard-coded and never sent to the browser:
- Postgres: `DATABASE_URL`
- Keycloak: `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`
- Kill Bill: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- Breach feed: `WIREMOCK_URL`
- Lockset settings, with defaults given in Business rules and Services: `OFFICE_KEY`, `LOCKSET_SECRET_KEY`, `LOCKSET_CLOCK_START`, `REVEAL_SESSION_SECONDS`, `BREACH_CHECK_SECONDS`, `SIGN_IN_LOCK_SECONDS`

### Server boundary (DP-08, DP-27, DP-59, DP-73)

- **Same origin only.** The browser talks only to the app origin. Keycloak, Kill Bill, Postgres and the feed are called only by the server. A write whose `Origin` header names another origin answers `403 cross_origin`.
- **Body sizes.** A request body may be up to 16,384 bytes, except for `POST /api/imports`, which may be up to 1,000,000 bytes. A body of exactly the limit is accepted, and a larger one answers `413 too_large`.
- **What is served.** The server serves only the built client assets and the API. It never serves source files, source maps, `run.json`, environment files, the lockfile, or anything else outside the built assets. An unknown `/api` path answers `404 not_found` as JSON.
- **Secrets.** Secrets appear only in reveal and copy responses. They never appear in logs, audit details, error bodies or any other response. Error bodies never carry stack traces, SQL, file paths or library names.
- **Unreachable dependencies at boot.** If Keycloak, Kill Bill or the feed is unreachable at boot, the app still starts and answers health. It picks each service up when that service answers, with no restart.
- **Time decisions.** Every time-dependent decision is made on the server and published in responses or events. The browser only renders it.

### Browser support and performance (DP-55, DP-57)

Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch. On the seed data:
- The drawer is usable within three seconds of navigation.
- An as-of answer arrives within one second.
- Server pushes arrive within five seconds of the event they report.

## Working rules

- IF-01: `/app/run.json` is valid JSON with `"_schema":"run-manifest-v1"` and string `install`, `build` and `serve` commands, and those commands alone are enough to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package with its licence, plus the Funnel Display and Funnel Sans fonts. Shipped packages are the production dependency tree given by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (same definition as IF-02) and every font uses one of these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, OFL-1.1.
- IF-04: Postgres is the only datastore. No SQLite, files, Valkey or other store holds application records, sign-in counts or locks.
- IF-05: The app serves its own fonts and all client assets, and no page loads anything from another origin.
- IF-06: Application source is TypeScript, and a committed `package-lock.json` pins the dependency tree.
- IF-07: The provided dev service definitions and their credentials are left unchanged, and Keycloak's realm brute-force settings are not changed.

## Engineering standards

- The code is strict TypeScript, with no `any` in domain code and no suppressed type errors.
- Names in the code match this brief's domain terms: vault, login, rule in force, version, turn, scope, leaver, mover, office midnight, seat, slip, cursor, lockout.
- Each domain rule is decided in exactly one place in the source: office-time conversion and the DST rule, rule-in-force resolution, visibility, rule and turn transitions with the version check, review-line changes, seat derivation from the office account, landing-route choice, audit paging, sign-in lockout, and import reading, row checks and matching.
- No abstraction has only one implementation, and no feature goes beyond this brief.
- There is no dead, commented-out or unreachable code, and there are no defensive checks for states the rules make impossible.
- Every API error uses the one published error shape, built in one place, and every write body is checked against its published keys in one place.
- Calls to Keycloak, Kill Bill and the breach feed carry explicit timeouts, and their failures map to the published outage behaviour.
- Each revealed slip owns its own hide timer, no timer callback touches dialogs, form fields or the live regions' other messages, and responses for a day, night or month no longer chosen are discarded.
