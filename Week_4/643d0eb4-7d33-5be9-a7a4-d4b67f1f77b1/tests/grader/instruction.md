# Keystone Tables

Build the governed table workspace Northbank Mutual runs for its insurance operations group.

Northbank Mutual reports from tables, not from documents. Three departments keep their reporting
tables in one workspace: `claims`, `underwriting` and `actuarial`. Each table is a named
collection of rows over typed columns, it belongs to exactly one department, it carries an
entitlement tier, and it keeps an append-only change log of every amendment anybody ever made to
it. A steward closes a table for a reporting period, publishes a frozen read-only snapshot of it,
and decides the access requests other departments raise.

The whole point of the product is that the controls hold. A reader never reaches a row belonging
to a department they hold no role in. A locked table refuses every amendment and says which period
locked it. A published snapshot keeps the rows it held at publication. The plan matrix on the
public pages and the refusal the console returns read the same allowance out of the same grant
table, so they can never quote different numbers.

## Problem and users

Keystone Tables is a governed reporting workspace with a public marketing surface in front of it
and a signed in console behind it. Five public addresses explain and sell the product; two more
carry sign in and the workspace itself.

The product goals, in priority order, and the order matters when two of them pull apart:

1. A reader never sees a row belonging to a department they hold no role in.
2. An amendment is either recorded in the change log or refused; never neither.
3. A locked table refuses every amendment and names the period that locked it.
4. A published snapshot keeps the rows it held when it was published.
5. An allowance refusal names the tier and the allowance that ran out.

Everything else in this brief serves those five. Where a convenience would weaken one of them, the
goal wins and the convenience goes.

A role is granted per account per department, never globally. One account holds different roles in
different departments, and holds no role at all in a department it has no business with.

| Role | Reads rows | Amends rows | Manages views | Decides requests |
|---|---|---|---|---|
| viewer | yes | no | no | no |
| analyst | yes | no | yes | no |
| editor | yes | yes | yes | no |
| steward | yes | yes | yes | yes |

- A **viewer** reads rows, saved views, the change log and the published snapshots of its
  department, and changes nothing.
- An **analyst** also creates, amends and deletes saved views, including shared ones, and still
  amends no row.
- An **editor** also amends rows: creates them, updates them and deletes them.
- A **steward** also locks a table for a reporting period, publishes a snapshot, and approves or
  declines an access request raised against its own department.

There is no global administrator and no account that reaches every department. A steward of
`claims` is an ordinary stranger to `actuarial` until a steward of `actuarial` grants it a role.

## Journeys

**Sign up, sign in and the account.** Sign up takes a work email, a display name, a department and
a password, and refuses an email already recorded without revealing that it exists. Sign in takes
the work email and the password, and refuses a wrong pair with one message naming neither which
half was wrong. A sign up creates no role grant at all, not even on the department it names, and
opens no session, so the new account signs in afterwards and reaches a department only through an
approved access request. A session carries the account it belongs to and nothing a grant decides, so
every request reads its role grants from the store. Sign out ends the session and returns the reader
to the landing page. The account page states the display name, the work email, the department, the
tier recorded against the account and every role grant the account holds.

**Amending a row.** An editor or a steward opens a table and amends one row. The write boundary
checks the role, then the lock, then the allowance, then the column type, in that order, and the
first failure is the one reported, so a reader is told the one thing that stopped them rather than
all of them. A success writes one change log entry per amended column and flashes the row in the
affirm colour. A refusal leaves the row unchanged, writes no entry, and states the reason.

**Managing a saved view.** An analyst, an editor or a steward creates a view over a table, adds
filters and sorts, and chooses whether it stays private to its owner or is shared with the
department. A shared view counts against the tier's shared view allowance, and the one past the
allowance is refused naming the tier, the allowance and the count.

**Requesting and deciding access.** An account raises a request for a role on a department it
holds no role in. A steward of that department reads the request on the requests page and approves
or declines it with a reason, and the requesting account cannot be that steward. An approval
creates the role grant, and the account reaches the department on its next read.

**Closing a period.** A steward locks the table for the reporting period, which refuses every
further amendment and shows the lock banner naming the period. The steward then publishes the
snapshot for that period, which freezes the rows as they stand. Unlocking afterwards restores
amendment to the live table and changes no snapshot row.

**Billing, enquiry and subscribe.** A tier control on the plan matrix carries the reader into sign
up with the chosen tier recorded against the new account. A complete sales enquiry is recorded and
confirmed against its work email. A newsletter subscribe records a new address once and answers a
repeat as success without a second row.

**Definition of done.** A stranger opens the landing page, reads the four claims and the four
roles, crosses to the plan matrix, and reads the same four allowances twice: once on the four cards
in grant order, once in the comparison table below them, with the yearly and monthly toggle
changing the period word and no number. They open the enquiry page, submit it with a malformed work
email, and see the refusal inline beside the control with what they typed still in it. They open
the community page, read the founder note, subscribe twice with one address, and are thanked both
times while only one row is recorded. They open the developer interface reference and read which
role each address needs.

An editor of `claims` signs in, amends a row, and sees it flash in the affirm colour with one
change log entry per amended column sharing one recorded moment. They put a decimal into an
integer column and are refused by the write boundary, with the column caption and the wanted type
named and the row unchanged. They open the table seeded at exactly four fifths of its row allowance
and see the caution notice stating the count and the allowance; they fill it to the allowance and the
next row is refused naming the tier, the allowance and the count, with no change log entry added.

A steward of `claims` locks that table for a named reporting period. Every amendment is then
refused naming the period, and the lock banner carries the refuse colour and the same period. The
steward publishes the snapshot for the period, unlocks the table, amends a row, and the published
snapshot's rows are unchanged. A second snapshot for the same period is refused.

An analyst of `claims` builds a shared view with a contains filter on a text column and a sort on
a date column, and is never offered contains on an integer column or greater than on a flag
column. Two tied rows keep their insertion order every time the view is opened.

An account of `underwriting` reaches no `claims` row, view, change log entry or snapshot at any
address, and gets a refusal page naming the department rather than a redirect. It raises a request
for an `analyst` role on `claims`, cannot decide that request itself, and a repeat request is
refused while the first is open. A steward of `claims` approves it with a reason, and the account
reads `claims` rows on its next read. The change log ordinals are contiguous from one in every
table throughout, and no address scrolls sideways at mobile, tablet or desktop.

## Mandatory requirements

- **DP-01 — Deployment and readiness** The app serves pages and the `/api` prefix on one origin at `APP_PUBLIC_URL` and `GET /api/health` answers `200` once it is ready.
- **DP-02 — Public addresses answer** Each of `/`, `/plans`, `/enquiry`, `/community`, `/developers` and `/login` answers `200` with a non-empty page to a reader with no session.
- **DP-03 — Deterministic seed** The store holds exactly the seeded departments, tiers, accounts, role grants, tables, snapshots and requests in Seed data, once, and a re-read finds the same counts.
- **DP-04 — PostgreSQL holds every record** Every record lives in the PostgreSQL collections named in Store shape, and each seeded collection carries its rows there.
- **DP-05 — Tier grant table** `GET /api/tiers` answers a top-level array of the four tiers in grant order carrying exactly the allowances in the grant table.
- **DP-06 — One source for every allowance** The plan page states each tier's row allowance twice, and every figure it states equals the stored grant row the console refuses from.
- **DP-07 — Plan matrix page** `/plans` shows the four tiers as cards in grant order with a yearly and monthly toggle, then the same tiers again in a comparison table.
- **DP-08 — Department boundary on reads** An account with no role on a department is refused that department's rows, views, change log and snapshots at every address.
- **DP-09 — Refusal pages name the department** A refusal for a department the reader holds no role in names that department and is a page with a client-error status, never a redirect.
- **DP-10 — Roles granted per department** Role grants are stored per account per department, and an approved request leaves its grant in the store.
- **DP-11 — Bearer auth and open addresses** Every closed API address answers `401` without a session, while the open addresses answer without one.
- **DP-12 — Typed values at the write boundary** A decimal into an integer column, a string past 500 characters, a value outside a choice list and a non-member flag value are each refused `422` with nothing written.
- **DP-13 — Wrong-type refusal shape** A wrong-type refusal carries a reason and the field, names the column caption, and leaves the row exactly as it was.
- **DP-14 — One log entry per amended column** A successful update writes one change log entry per amended column, sharing one recorded moment and each carrying its own before and after value.
- **DP-15 — Contiguous log ordinals** Change log ordinals are contiguous from one within each table and never repeat or restart.
- **DP-16 — Contiguous column positions** Column positions are contiguous from one, and removing a column closes the gap.
- **DP-17 — Append-only change log** A log entry survives the deletion of its row and the removal of its column, every role on the department reads the log, and no role amends it.
- **DP-18 — Change log page** The change log answers newest first, at most twenty entries a page, and its console page lists the entries newest first.
- **DP-19 — Locked table refuses amendment** Every amendment of a locked table is refused naming the locking period, writes no log entry, and the table page shows the period in its lock banner.
- **DP-20 — Unlock writes nothing** Unlocking a table restores amendment and writes no change log entry, and the lock can be applied again.
- **DP-21 — Write boundary order** The write boundary checks role, then lock, then allowance, then type, and reports the first failure.
- **DP-22 — Frozen snapshots** A snapshot answers a frozen copy of its rows that a later amendment of the live table never changes, and its address refuses every amendment.
- **DP-23 — Snapshot retention** A snapshot older than its tier's retention is unreachable while the retained one answers.
- **DP-24 — Uniqueness and missing tables** A second snapshot for a published period is refused `409`, and a table slug that does not exist answers `404`.
- **DP-25 — Row allowance refusal** A table answer states its tier, its row allowance and its row count from the grant table, and a refused row write adds no log entry.
- **DP-26 — Allowance notice** A table at or above four fifths of its row allowance (a row count of at least 0.8 times the allowance) shows a notice stating the count beside the allowance in the caution colour.
- **DP-27 — Shared view allowance** Creating shared views past the tier's shared view allowance is refused.
- **DP-28 — Who decides a request** Only a steward of the requested department decides a request, and the requesting account is refused its own decision.
- **DP-29 — Approval grants the role** An approved request leaves a role grant for the requested role on the requested department.
- **DP-30 — One open request** A second open request by one account for one department is refused `409`.
- **DP-31 — Refusals are client errors** A type refusal, a department refusal and a lock refusal each answer a client-error status, never a server error or a silent success.
- **DP-32 — Sales enquiry** The enquiry form marks its four mandatory controls, a malformed work email is refused `422` naming `work_email`, and a message past 1000 characters is refused.
- **DP-33 — Newsletter subscribe** A repeat subscribe of one address answers success both times and records one row.
- **DP-34 — Not-found page** An address with no route answers `404` with the custom not-found page.
- **DP-35 — Table panel scroll** On a phone the table panel takes the sideways scroll inside itself while the page holds its width and the row title column stays against the left edge.
- **DP-36 — Table semantics and type scale** The table marks its column captions and row titles as header cells, renders values in Inter at 13px and captions at 12px, pads cells 8px by 16px at every width, and panels carry an 8px corner radius.
- **DP-37 — Five colour families** The console renders no more than the five colour families the palette names.
- **DP-38 — Accessibility bar** Every public address passes WCAG 2.2 AA checks with one first-level heading, keyboard focus shows a visible ring, and console controls on a phone are at least 24 by 24 CSS px.
- **DP-39 — Navigation drawer** Below the desktop breakpoint the navigation toggle reports its expanded state and opens a drawer that holds keyboard focus inside it.
- **DP-40 — No sideways scroll** No public address scrolls the page sideways at 320, 390, 768 or 1440 CSS px wide.
- **DP-41 — Reduced motion** Under a reduced motion preference no animation runs on the landing page or the console table page.
- **DP-42 — Owning department in view** The table list, one table and its change log each show the department that owns the table.
- **DP-43 — Bands on public pages** The landing page is a vertical stack of full width bands, each carrying one idea with open vertical space between them.
- **DP-44 — Colour carries meaning** Blue marks what can be pressed, orange an allowance running out and red a refusal or lock, and each console view carries at most one solid blue block in its body.
- **DP-45 — View filters, sorts and operators** The view builder never offers contains for an integer column or greater than for a flag column, a view's filters select the rows its table answers, and its sorts order them with tied rows keeping their insertion order.
- **DP-46 — Counts never leak** A reader's table list and row totals never include a table or row of a department they hold no role in.
- **DP-47 — Server-held controls** The source keeps every record in PostgreSQL, reads every allowance from the grant rows, and checks role, lock, allowance and type in one write path.
- **DP-48 — Session cookie shape** Sign in sets the session cookie `keystone_session` carrying `HttpOnly`, `SameSite=Lax` and `Path=/`, that cookie alone opens the console and the closed API, and `document.cookie` never reads it.
- **DP-49 — Sign out ends the session** `POST /api/auth/logout` ends the session it was called with and no other, after which that cookie answers `401` on `/api` and the console page answers a refusal page rather than a redirect.
- **DP-50 — Session lifetime** A session is valid for twelve hours from its `created_at`, a session past its `expires_at` answers `401` on `/api` and refuses the console page, and a stale session row stays in the store.
- **DP-51 — Password rules on sign up** Sign up refuses a password shorter than 12 characters and refuses the four published obvious passwords whatever their letter case, each `422` naming `password` and recording no account.
- **DP-52 — Sign up reveals no account** A sign up for an email already recorded and a sign up for a malformed email are refused with the same `422`, the same `email` field and the same reason word for word, and neither records an account.
- **DP-53 — Failed sign-in throttling** Five refused sign-in attempts for one work email inside fifteen minutes throttle that email, every further attempt for it answers `429` with a `Retry-After` header, a successful sign-in clears the count, and the throttle is keyed on the email alone.
- **DP-54 — One sign-in refusal** A wrong password and an email nobody holds are each refused `401` with the same reason, the same field and the same body word for word.
- **DP-55 — Form posts carry their token** A form-encoded post to the enquiry or the newsletter address carries the `form_token` its page issued, and one missing, empty or never issued is refused `403` naming `form_token` with nothing recorded.
- **DP-56 — Sign-in attempts are recorded** Every sign-in attempt records its work email, its moment and its outcome and never the password, and only a steward reads `GET /api/login-attempts` while every other role answers `403`.
- **DP-57 — Dialogs open from their own control** Each of the four console dialogs opens by pressing `Enter` on its own named control, carries that control's name as its own accessible name, and moves focus to a control it holds.
- **DP-58 — Tab stays inside an open dialog** While a console dialog is open `Tab` reaches only the controls of that dialog however many times it is pressed, and `Shift+Tab` on its first control moves focus to the last control of the same dialog.
- **DP-59 — Escape closes and focus comes back** `Escape` inside an open console dialog closes it and records nothing, and focus returns to the control that opened it, which held focus immediately before the dialog opened.
- **DP-60 — Keyboard-complete console flows** Saving a view, saving a row, deciding a request and publishing a snapshot are each completed with the keyboard alone, and each records its own result.
- **DP-61 — One region announces every result** Every console address carries one status region named `Workspace updates` whose sentence states the outcome of the last completed action in the published words.
- **DP-62 — Two boundaries and nothing between** The layout changes only at 640 and 800 CSS px, the three bands differ from each other, and inside one band the layout is the same at every width.
- **DP-63 — A closed drawer is unavailable** While the navigation drawer is closed its route links are hidden from the accessibility tree and take no keyboard focus, and opening the drawer returns them to both.
- **DP-64 — Notices keep their own timers** The saved-row affirmation and the refusal notice are the only timed notices, each staying for its published duration, a later action shows a notice an earlier timer already hid, an earlier timer never hides a later notice, and the standing allowance notice is never hidden by a timer.
- **DP-65 — The table updates in place** Applying a view, changing the sort and paging the rows each replace the rows without a page load, and the address carries the view, the sort and the page so a reload and a step back restore the same table.
- **DP-66 — The later change wins** When the filtering is changed twice in quick succession the table shows the later change's rows even when the earlier request answers last.
- **DP-67 — An open dialog stays reachable** At a phone width every control an open dialog holds is the element found at the centre of its own box, and a dialog taller than the viewport takes the scroll inside itself while the page behind it does not.
- **DP-68 — Every animation keeps its band** The drawer slide, the saved-row flash, the loading placeholder pulse and the staged row entrance each run inside their published millisecond band with the published per-row stagger, and reduced motion removes every one of them while the colour and the text still arrive.
- **DP-69 — Fixed copy reads exactly** The empty-table line, the refusal heading, the sign-out confirmation, the snapshot announcement and the not-found sentence each read on screen exactly as published, character for character.
- **DP-70 — Row versions climb by one** Every row carries a `version` starting at `1` that each accepted amendment raises by exactly one, and a `version` never decreases and never repeats on one row.
- **DP-71 — Stale amendments are refused** An amendment whose `If-Match-Version` header names a number other than the row's current `version` is refused `409` naming `version` and carrying `current_version`, and it writes no column and appends no change log entry.
- **DP-72 — Exactly one amendment wins** When several amendments of one row arrive together carrying the same `If-Match-Version`, exactly one of them is accepted and every other one answers the stale-version refusal.
- **DP-73 — Idempotent row creates** A create replayed with the same `Idempotency-Key` and the same body answers the first answer's body byte for byte and creates no second row and no second change log entry, while that key with a different body is refused `409` naming `idempotency_key`.
- **DP-74 — Double submit writes what is published** Two identical subscribes record one `subscribers` row, while two identical enquiry posts record two `enquiries` rows and two identical creates carrying no `Idempotency-Key` header create two rows each at a `version` of `1`.
- **DP-75 — An amendment is one unit of work** A `PATCH` naming several columns where one value is wrong for its column writes not one of the named columns, appends no change log entry and leaves the row's `version` where it was.
- **DP-76 — Derived table figures stay honest** A table answer's `count`, `stored_kilobytes` and `log_high_ordinal` are computed at the read and agree with the store after a create, an amendment, a delete and a column removal, with no gap and no repeat in the ordinals.
- **DP-77 — The change log is a hash chain** Every change log entry carries a `previous_hash` and an `entry_hash` built by the published SHA-256 recipe, the chain verifies from the first entry of each table, and no two entries of one table share a `previous_hash`.
- **DP-78 — Stable paging by cursor** A cursor walk of the rows endpoint answers every row that existed before it began exactly once in insertion order even while rows are created between its page reads, and a cursor issued for another table is refused `422` naming `cursor`.
- **DP-79 — Derived state is computed at the read** A table answer carries `read_at` from the server's own clock and a snapshot answer carries a `retained` ranked when it is read, and the store keeps no `retained` column and runs no sweep process.
- **DP-80 — Effective-dated tier grants** A department's tier grants each carry an `effective_at`, `GET /api/departments/{slug}/grants` marks only the grant in force `in_force`, and every allowance decision uses the grant in force at the moment of the write rather than a later grant that has not begun.
- **DP-81 — A snapshot records the rules it was published under** A snapshot records its tier, that tier's row allowance, content allowance and retention words at publication, and a later grant rewrites none of them.
- **DP-82 — The business time zone decides the day** Every period and retention boundary is decided in `Asia/Kolkata`, five hours and thirty minutes ahead of UTC and never UTC, so a `business_day` turns over at `18:30:00Z` and the turnover moment belongs to the later day.
- **DP-83 — Retention ranks and read-time expiry** A snapshot whose rank by `published_at` is at or below its tier's retention count answers `200`, the rank one above it answers `410` and is absent from `GET /api/snapshots`, and that expiry is computed at the read with no sweep process.
- **DP-84 — The session lifetime boundary is exclusive** A fresh session's `expires_at` is exactly twelve hours after its `created_at` to the second, and a session is refused at and after that moment rather than before it.
- **DP-85 — Content size is derived and floored** A table answer's `content_bytes` sums the published per-column contributions over its rows and `content_kilobytes` floors that figure by `1024`, both computed at the read, and the store keeps neither column.
- **DP-86 — The content allowance refuses the next write** A write to a table whose `content_kilobytes` has reached its tier's `content_allowance_kilobytes` is refused `422` naming the tier, the allowance and `content_kilobytes`, and appends no change log entry.
- **DP-87 — The department snapshot sequence is gap-free** Every snapshot carries a `sequence` contiguous from one within its department, with no gap and no repeat even when publishes for different tables of one department arrive together.
- **DP-88 — A snapshot's recorded figures never move** A snapshot's `row_count` and `content_bytes` are computed once at publication and answer the same figures after the live table is amended.
- **DP-89 — Deep paging and totals over a high-volume table** `actuarial-exposure` answers a page far from the first as its own slice, totals the rows under a filter in `X-Total-Count`, and sorts the whole table before the page is cut.
- **DP-90 — A page carries at most five hundred rows** A `per_page` above `500` is refused `422` naming `per_page`, and no rows answer carries more than `500` rows.
- **DP-91 — Steward-only administration console** `/console/administration` carries the `Grant administration`, `Access request queue` and `Sign-in attempt record` panels, only a steward reaches it, and a viewer, an analyst, an editor and a reader with no session each answer the published refusal rather than a redirect.
- **DP-92 — Permission is read again on every request** Every request reads the role grants standing in the store at the moment it is answered, so a grant revoked or created while an account holds a live session takes effect on that account's very next request rather than at its next sign in.
- **DP-93 — A grant authorises from its own moment** A role grant carries `authorises_from`, authorises nothing before that moment and authorises at it and after it, decided from the server's own clock when the request is read and with no sweep process.
- **DP-94 — A refused administration read records nothing** A refused administration request appends no administration log entry and records no `login_attempts` row, so the stream's highest `ordinal` and that record's count are both unmoved.
- **DP-95 — Bulk revoke is all or nothing behind its phrase** A mismatched confirmation phrase revokes nothing, changes no grant, appends no log entry and announces the published refusal sentence, while a matching phrase revokes every named grant or none of them when any one cannot be revoked.
- **DP-96 — Administration actions are attributed** Every grant created, grant revoked and request decided through the console appends one administration log entry naming the acting steward and the affected account, and that entry verifies in the published hash chain.
- **DP-97 — A steward governs one department only** A steward is refused `403` for every administration action on another department, `GET /api/admin/counts` counts no other department's rows, and a queue cursor issued for one department is refused `422` for another.
- **DP-98 — Only the published administration surface answers** An unaccepted method on an `/api/admin` address answers `405` naming `method` with an `Allow` header, a non-JSON administration write answers `415` naming `content_type`, and an unknown path under `/console/administration` answers the not-found page.
- **DP-99 — The request queue stays honest under concurrent decisions** The queue answers open requests ahead of decided ones by `raised_at` oldest first and twenty to a page, and when two stewards decide one open request together exactly one decision is recorded and the other answers `409` naming `state`.

## Frontend

### Screens and layout (DP-02, DP-35, DP-40, DP-42)

The information architecture is seven addresses, six of them public and one behind sign in. Each
route carries the chrome described below, and the console routes nest the workspace one level deep:

| Address | Public | Purpose |
|---|---|---|
| `/` | yes | the landing page and its proof band |
| `/plans` | yes | the plan matrix and the allowance table |
| `/enquiry` | yes | the qualified sales enquiry form |
| `/community` | yes | the community page and its newsletter form |
| `/developers` | yes | the developer interface reference |
| `/login` | yes | sign in, and the link to sign up |
| `/console` | no | the signed in workspace and the steward console |

Inside the console the workspace addresses nest one level:

| Address | Purpose |
|---|---|
| `/console/tables` | every table the account may read |
| `/console/tables/{slug}` | one table, its columns and its rows |
| `/console/tables/{slug}/views/{view}` | one saved view of one table |
| `/console/tables/{slug}/log` | the append-only change log of one table |
| `/console/snapshots` | every published snapshot the account may read |
| `/console/requests` | access requests, and the steward decision form |
| `/console/account` | the account, its department and its roles |
| `/console/administration` | the steward administration console and its three panels |

The table list, one table and its change log each name the department that owns the table on
screen, in its own element labelled `Department` carrying that department's name, which is the
department's slug in lower case (`claims`, `underwriting` or `actuarial`), separate from
the table name and from the table slug, so a reader can tell the owning department apart from the
table it owns. The word `Department` is both visible text beside the value and the element's own
accessible name, so a reader looking at the screen and a reader on a screen reader each get it.

Every address carries the same chrome.

| Element | Content | Behaviour |
|---|---|---|
| header | the product mark, the route links and the account control | fixed to the top, with a hairline rule once the page scrolls |
| navigation | the route links, and the console links once signed in | a horizontal bar on desktop, a drawer behind a toggle below it |
| account control | sign in, or the account name and a sign out control | the name links to the account page |
| banner | the lock notice, the allowance notice and the refusal notice | one banner at a time, the refusal notice winning |
| footer | the route links, the department list and a legal line | the same on every address |
| not-found page | a title, a sentence and a link back to the landing page | returned for any address with no route |

The page frame is a single centred column with a bounded measure and a gutter either side. Three
breakpoints carry the whole build:

| Breakpoint | Applies from | Table columns visible | Navigation |
|---|---|---|---|
| mobile | 0px | the row title and one value | a toggle and a drawer |
| tablet | 640px | the row title and three values | a toggle and a drawer |
| desktop | 800px | every column | a horizontal bar |

Every column stays in the table at every breakpoint: the visible column count above is how many
fit inside the panel before it scrolls, never a count of columns removed from the table.

The spacing ladder has four steps: 4px, 8px, 16px and 24px. A table cell carries 8px of vertical
padding and 16px of horizontal padding at every breakpoint, so a row keeps one height and a dense
table does not reflow when a value grows. Panels carry a 24px inset and an 8px corner radius.

**The table panel.** A wide table scrolls horizontally inside its own panel and never widens the
page, so no address scrolls sideways at any breakpoint. The row title column stays fixed against
the left edge while the value columns scroll under it, so a reader never loses their place. Every
address holds its own width down to a narrow viewport of 320px, so a reader on a phone reaches
every column by sliding the panel rather than the page.

### Public screens and controls (DP-07, DP-32, DP-33, DP-34)

1. **The landing page.** A page title, a one sentence description, a primary control into sign up
   and a secondary control into the plan matrix, then a proof band of four claims, then a band
   naming the four roles, then a closing band repeating the primary control.
2. **The plan matrix.** The four tiers as four cards in grant order, each card carrying the tier
   name, a one line audience, its row allowance, its stored megabytes, its content kilobytes per
   table, its shared view allowance and its snapshot retention, and a control into sign up. One card carries a most chosen badge. A
   yearly and monthly toggle changes the rendered period word on every card. Below the cards the
   same four tiers render again as a comparison table with one row per allowance, so the matrix
   states each number twice and never differently.
3. **The qualified sales enquiry.** Six controls: full name, work email, phone number, company
   name, role and a message of up to 1000 characters, with a `Send enquiry` control that submits
   them. Full name, work email, company name and message are mandatory and marked required; phone
   number and role are optional. An invalid work email is refused inline beside the control, the
   control keeps the value the reader typed, and the refusal names what was wrong. That refusal is
   attached to its own control as that control's own description or error message and the control
   is marked invalid, so a screen reader announces the refusal with it, and nothing is recorded.
   A message of exactly 1000 characters is accepted and a longer one is refused. The length is
   counted in characters, and a message past that ceiling is refused `422` naming `message` as its
   field. A complete enquiry is recorded in `enquiries` under its work email and answered with a
   confirmation naming the work email it was recorded against.
4. **The community page.** A page title, a description, a founder note attributed to a named
   person, and a newsletter form of one email control and a subscribe control. A repeat subscribe
   of an address already recorded is answered as success without recording a second row, so a
   reader learns nothing about who is already subscribed.
5. **The developer interface reference.** A page describing the read interface over tables and
   rows: the addresses, the role a caller needs, the shape a caller receives and the refusal a
   caller receives without a role. A sign in control sits at the top for a reader who arrived
   without an account.
6. **The not-found page.** A reader who asks for an address that does not exist receives the
   custom not-found page. That answer carries the `text/html` content type, because it is a page
   and not a JSON refusal, and it carries exactly one first-level heading and a link to `/`.

### Interactions (DP-39, DP-45)

**The navigation drawer.** The drawer opens from the left and traps focus until it closes, so
tabbing never wanders off behind it. The toggle reports its expanded state, and closing the drawer
returns focus to the toggle. The open drawer is the page's navigation landmark, carrying the route
links inside it, so a reader on a screen reader reaches it by landmark and not by hunting.

**Saved views.** A `New view` control on the table page opens the view builder. An `Add filter`
control adds one filter, and each filter the reader adds sits in its own group labelled `Filter`
holding a `Column` picker and an `Operator` picker. An `Add sort` control adds a sort the same
way, each sort sitting in its own group labelled `Sort` with its own `Column` picker and a
`Direction` picker whose two options read `asc` and `desc`, so a filter's pickers and a sort's
pickers are never the same control. The view
builder offers an operator only where the column type supports it, so contains never appears for
an integer column and greater than never appears for a flag column.

**The plan toggle.** The yearly and monthly toggle changes the period word on every card and no
number.

**Tier controls.** A tier control on the plan matrix carries the reader into sign up with the
chosen tier recorded against the new account. The created account answer carries that tier under
`tier`, and the account page states it, so the recorded tier is readable in both places. Sign up
accepts the four tier names `starter`, `team`, `scale` and `regulated` and no others: a sign up
that leaves `tier` out, or names anything else, is refused `422` naming `tier`.

### Console dialogs and keyboard (DP-57, DP-58, DP-59, DP-60, DP-67)

Four workspace actions run inside a dialog. Each is opened by its own named control, and the dialog
carries the same name as the control that opened it, so a reader who pressed `New view` lands in a
dialog named `New view`.

| Opening control | Dialog name | Controls inside the dialog | Primary control |
|---|---|---|---|
| `New view` | `New view` | `Name`, `Visibility`, whose two options read `private` and `shared`, `Add filter` and `Add sort` | `Save view` |
| `Edit row` | `Edit row` | one control for each column, labelled with that column's caption | `Save row` |
| `Decide request` | `Decide request` | `Decision`, whose two options read `approved` and `declined`, and `Reason` | `Record decision` |
| `Publish snapshot` | `Publish snapshot` | `Table` and `Period` | `Publish` |

Each of the four dialogs also carries a `Cancel` control that closes it and records nothing. Every
row on `/console/tables/{slug}` carries its own `Edit row` control, every open request on
`/console/requests` carries its own `Decide request` control, and `/console/snapshots` carries one
`Publish snapshot` control. The account control's sign out control is named `Sign out`. A locked
table's rows carry their `Edit row` control too: the dialog opens there, and the save it sends is
refused and announced rather than prevented before it is sent.

**Keyboard alone.** Each of those four actions is completed with the keyboard and nothing else. A
reader reaches the opening control with `Tab`, opens the dialog by pressing `Enter` on it, reaches
every control the dialog holds with `Tab`, types or chooses the values there, and completes the
action by pressing `Enter` on the primary control. No step of any of the four needs a pointer, and
the action records exactly what it records when a pointer is used.

**Focus on opening and on closing.** The control that opened a dialog is the focused control
immediately before the dialog opens. When the dialog opens, focus moves to a control inside the
dialog. When the dialog closes, whether by `Escape`, by `Cancel` or by completing the action,
focus returns to that same opening control.

**Tab stays inside.** While a dialog is open, `Tab` reaches only the dialog's own controls and
never a control outside it, however many times it is pressed: from the dialog's last control `Tab`
returns to its first. `Shift+Tab` pressed on the dialog's first control moves focus to the last
control of the same dialog rather than out of the dialog.

**Escape closes.** Pressing `Escape` while focus is inside an open dialog closes that dialog,
records nothing, and returns focus to the control that opened it.

**An open dialog stays reachable.** An open dialog is never clipped by an ancestor and never
covered by another element. At a phone width of 390 CSS px every control the open dialog holds,
its primary control included, is the element the browser finds at the centre of that control's own
box. At a viewport 390 CSS px wide and 480 CSS px tall the dialog either fits inside the viewport
or takes the scroll inside its own box, so its own scrollable height is greater than its visible
height while the page behind it does not scroll, and the primary control is reached either way.

### Live updates, breakpoints and announcements (DP-61, DP-62, DP-63, DP-65, DP-66, DP-22, DP-91)

**The table updates in place.** The table page carries a `View` picker whose options read the
names of the table's saved views, a `Sort` picker whose options read the table's column captions,
and `Previous page` and `Next page` controls. The `Sort` picker always sorts ascending by the
chosen column, and the chosen column replaces the applied view's own sorts rather than following
them, so the rows are ordered by that one column alone while a sort is chosen. Applying a view, changing the sort and paging the
rows each replace the rows inside the page already open. No page load happens for any of the
three: the document the reader is on is the same document before and after, and anything a script
left on that document is still there afterwards.

**The address carries the table's state.** Each of those three changes records itself in the
address of the open page as a query parameter: `view` carries the applied view's name, `sort`
carries the chosen column's caption, and `page` carries the 1-based page number. A reader who
reloads that address gets the same view, the same sort and the same page of rows. A reader who
takes one step back in the browser's history gets the state the table held before the last of
those changes, in the address and in the rows alike.

**The later change wins.** When a reader changes the filtering twice in quick succession, the
table shows the rows of the later change, whichever of the two requests the server answers first.
An earlier request that answers last never replaces the later change's rows, and the address keeps
the later change too.

**Three bands and nothing between them.** The layout changes at exactly two widths, 640 CSS px
and 800 CSS px, and at no other width.

| Band | Widths | Navigation | Tier cards on `/plans` | The table page's filter and sort controls |
|---|---|---|---|---|
| phone | under 640px | a toggle and a drawer | one card to a row | above the table panel |
| tablet | 640px to 799px | a toggle and a drawer | two cards to a row | above the table panel |
| desktop | 800px and wider | a horizontal bar of route links | all four cards in one row | beside the table panel |

Above the table panel means the controls sit wholly above it, their lowest edge no further down
than the panel's top edge. Beside it means they sit wholly to one side of it, sharing part of its
vertical span. The three bands differ from each other in all three of those respects.

Two console pages carry a layout signature of their own in those same three bands, changing at
those same two widths and at no other width. Above and beside read here exactly as they read for
the table panel above.

| Band | The administration console's three panels | The snapshots page's two panels | The `Publish snapshot` control |
|---|---|---|---|
| phone | one panel to a row, so three rows | stacked, one panel to a row, so two rows | above both panels |
| tablet | over two rows | side by side, so one row | above both panels |
| desktop | all three in one row | side by side, so one row | beside both panels |

Each of those two pages reads differently in each of the three bands, and inside one band neither
drifts: 480px reads like 639px, 720px reads like 640px and like 799px, and 1200px reads like 800px
and like 1440px.

Nothing else about the layout changes with width. Inside one band the layout is the same at every
width: 480px reads like 639px; 720px reads like 640px and like 799px; 1200px reads like 800px and
like 1440px. At 639px the phone layout holds and at 640px the tablet layout holds; at 799px the
tablet layout holds and at 800px the desktop layout holds.

**A closed drawer is unavailable.** Under 800px the route links live in the drawer behind the
toggle. While that drawer is closed its links are not merely moved off the screen: they are hidden
from the accessibility tree and they take no keyboard focus, so `Tab` never lands on one of them
however many times it is pressed, and a reader on a screen reader finds no link to a route while
the drawer is closed. Opening the drawer puts those links back into the accessibility tree and
into the keyboard order.

**One region announces every result.** Every console address carries one status region whose
accessible name is `Workspace updates`. It announces politely, it holds one sentence at a time,
and that sentence states the outcome of the most recently completed action. Six workspace outcomes
are announced there, each worded exactly as below with its own value written in place of the brace, and the steward administration console adds its own announced sentences to that same one region:

| Outcome | The announced sentence |
|---|---|
| a row saved | `Row saved: {reference}.` |
| an amendment refused | `Amendment refused: {reason}.` |
| a snapshot published | `Snapshot published for {period}.` |
| a request approved | `Request approved for {department}.` |
| a request declined | `Request declined for {department}.` |
| a view applied | `View applied: {name}.` |

`{reference}` is the saved row's own `Reference` value, `{reason}` is the refusal's own reason
string, `{period}` is the snapshot's reporting period, `{department}` is the requested
department's name, and `{name}` is the applied view's name. A department's name is its slug in
lower case, so the three names read `claims`, `underwriting` and `actuarial` and nothing else, and
the announced sentence, the `Department` element and the refusal page body each print that one
lower case form. A result that arrives without a page
load is announced in that region, and the region's sentence is the outcome itself rather than a
standing label.

### Visual design (DP-36, DP-37, DP-43, DP-44)

The product is a dense data tool that has to feel calm. Three things carry that.

**Quiet surfaces, loud outcomes.** The page is near white, the rules between rows are a faint
hairline, and the labels are a muted neutral grey. Nothing is coloured until it means something:
the blue action for what can be pressed, the green affirm for a recorded amendment, the red refuse
for a refusal or a lock, the orange caution for an allowance running out. A reader scanning a
table sees values, not decoration. A console view carries one solid blue block in its body, for
its leading action.

**The table is the hero.** The table panel gets the width, the fixed row title column and the
horizontal scroll. Every other surface on the console is a frame around it: the banner above, the
filter and sort controls beside it, the change log a click away. Marketing pages borrow the same
table treatment for the plan comparison, so the public surface looks like the product rather than
like a brochure in front of it.

**Bands, not boxes, on the public pages.** The landing page, the plan matrix and the community
page are a vertical stack of full width bands with generous vertical rhythm, each band carrying
one idea: the title, the proof, the roles, the close. Cards appear only where there is a real set
to compare, which is the plan matrix.

**Palette.** Nine tokens, five colour families and nothing else. A near white surface for page and
panel backgrounds. A near black ink for body text and table values. A mid neutral muted grey for
secondary labels and column captions. A near white neutral hairline for table rules, panel borders
and dividers. A light vivid blue action for primary buttons, links and focus rings, and a mid soft
blue action-deep for pressed and visited primary controls. A mid vivid green affirm for a recorded
amendment and a healthy allowance. A mid vivid red refuse for a refusal, a lock and an exhausted
allowance. A light vivid orange caution for an allowance at or above four fifths of its grant. Choose
the exact values yourself; the families, tones and shades above are the requirement.

**Type.** Inter and no other family, at weights 400, 500, 600 and 700.

| Role | Size | Weight | Line height |
|---|---|---|---|
| table value and body | 13px | 400 | 20px |
| column caption | 12px | 500 | 13.8px |
| control label | 14px | 500 | 20px |
| panel title | 16px | 500 | 24px |
| section heading | 20px | 600 | 30px |
| page title | 17px | 400 | 19.55px |

**Theme.** Light background only. There is no dark theme in this build.

### Motion and effects (DP-41, DP-68, DP-23, DP-70, DP-75, DP-95)

Motion is short, and every moving thing has one job: to say that something changed. A panel or
drawer entering moves with a character that leaves quickly and arrives slowly. A control
responding to a press and a notice strip arriving are quicker and more even. Three named behaviours
appear in the build:

1. A saved amendment flashes its row once, from the affirm colour back to the surface colour.
2. A row still loading shows a pulsing placeholder in place of its values.
3. A notice strip slides down four pixels into place as it arrives.

Every one of those is suppressed when the reader asks for reduced motion. Declare that preference
and honour it. A suppressed animation still changes the colour or the text it was carrying, so a
reader who never sees motion still sees the outcome.

**How long each animation runs.** Four animations carry the drawer and the table, and each one
runs for a duration inside its own published band:

| Animation | Duration |
|---|---|
| the navigation drawer sliding open | between 180 and 320 milliseconds |
| the saved-row affirmation flash | between 320 and 600 milliseconds |
| one pulse of a loading placeholder | between 900 and 1600 milliseconds |
| one table row's staged entrance | between 160 and 280 milliseconds |

The table's rows arrive in stages rather than all at once: each row's entrance starts after the
row above it has started, and the gap between one row's start and the next row's start is between
20 and 60 milliseconds. Every animation the build runs sits inside one of the four bands above:
none runs shorter than 160 milliseconds and none runs longer than 1600 milliseconds.

**The same four bands cover the rest of the build.** Four further surfaces move, and each one runs
inside one of the four bands above rather than inside a band of its own:

| Animation | Duration |
|---|---|
| the `Confirm bulk revoke` dialog entering | between 180 and 320 milliseconds |
| a notice strip arriving, the retention banner included | between 180 and 320 milliseconds |
| the bulk revoke result flashing as it is announced | between 320 and 600 milliseconds |
| a refused row returning to its stored value | between 320 and 600 milliseconds |

The snapshot list arrives in stages the way the table's rows do: each snapshot row's entrance runs
for between 160 and 280 milliseconds, and the gap between one snapshot row's start and the next
one's start is between 20 and 60 milliseconds.

Under a reduced motion preference every animation named in this paragraph and its table is removed
too, and what each of them carried still arrives without it: the `Confirm bulk revoke` dialog still
opens and takes focus, the retention banner still states its words, the bulk revoke result is still
announced, a refused row still returns to its stored value, and every snapshot row arrives at once.

Under a reduced motion preference every one of those four animations is removed. Nothing animates
while the console table rows are still loading, nothing animates as the drawer opens, nothing
animates as a row is saved, and no row entrance is staged: every row arrives at once. What the
motion carried still arrives without it, so the drawer still opens and holds its route links, a
loading row still shows its placeholder, and a saved row still shows the affirm colour and the
announced sentence.

### Feedback states (DP-09, DP-19, DP-26, DP-64, DP-69, DP-23, DP-70, DP-71, DP-75)

The allowance notice appears once a table's row count is at or above four fifths of its row
allowance (count at least 0.8 times the allowance, so 2400 of 3000 already shows it), states the
count and the allowance in one element, and carries the caution colour in that element's text,
its border or its fill. It is a standing notice: it is shown on every open of the page while the
count is at or above four fifths, it carries no timer of its own and no timer ever hides it. While
a refusal notice holds the banner the allowance notice stands aside, and it returns as soon as that
refusal notice's duration ends. Once the count reaches the allowance it carries the refuse colour
instead. A locked table shows a lock banner in the refuse colour naming the period. The allowance
notice, the lock banner and the refusal notice are each a status region that announces itself to
a screen reader, so each is one element carrying its own words.

**Refusals are pages, not redirects.** A reader who asks for an address they hold no role for
receives a refusal page that names the department, and never a redirect to the landing page,
because a redirect reads like a bug.

An invalid enquiry field is refused inline beside its control, which keeps the value the reader
typed. A complete enquiry and a subscribe are confirmed on screen. A refused amendment leaves the
row unchanged and states the reason.

**How long a notice stays.** Two notices are shown by an action and then hidden again on their
own. Each has one published visible duration, counted from the moment it is shown:

| Notice | What it says | Visible for |
|---|---|---|
| the saved-row affirmation notice | the announced sentence `Row saved: {reference}.` | 4000 milliseconds |
| the refusal notice | the announced sentence `Amendment refused: {reason}.` | 8000 milliseconds |

Those two are the only notices with a duration, and both of them live in the `Workspace updates`
region. The saved-row affirmation and the refusal notice each leave their sentence in the
`Workspace updates` region while they are visible, and that region holds no sentence at all once
their duration is up. The allowance notice is not one of them: it is standing, it has no duration
and no timer ever hides it, though while a refusal notice holds the banner it stands aside and
returns when that notice's duration ends, for as long as the count stays at or above four fifths.
A notice is still there one hundred milliseconds before its duration is up, and it is gone one
hundred milliseconds after. Each notice's timer belongs to the action that showed it, and nothing
else. Two consequences hold, and both are part of the build:

1. A later action shows its notice again even when an earlier timer has already hidden that same
   notice. The second save shows the saved-row affirmation again, from nothing, with its own full
   duration ahead of it.
2. A timer started by an earlier action never hides a notice a later action has shown. Saving a
   row, waiting most of the affirmation's duration, then saving again leaves the affirmation on
   screen until the second save's own duration is up, which is later than the first timer's end.

**Which colour the allowance notice carries, at the boundary itself.** The allowance notice's
colour is decided by the count against the allowance and by nothing else, and it is carried by the
notice's own element so a reader sees it rather than reads it. While the count is at or above four
fifths of the row allowance and still below the allowance the notice carries the caution colour
and not the refuse colour. Once the count has reached the allowance the notice carries the refuse
colour and not the caution colour. Both are decided at the read, from the live count, so the
colour crosses at the allowance itself and the count equal to the allowance is on the refuse side
of that crossing.

**The amended row says so, and only it.** A saved amendment flashes the row it amended and no
other row: the affirmation flash runs on that row's own element for between 320 and 600
milliseconds, and while it runs no other row of the table carries an animation of its own. The
`Edit row` dialog returns focus to the `Edit row` control of the row it was opened from, after a
saved amendment and after a refused one alike, so a reader who amends the fourth row lands back on
the fourth row's own control rather than on the first row's.

**A refused amendment is seen to roll back.** An amendment is shown on the row as soon as the
reader completes it, so the row carries the value the reader typed before the server has answered
it. When the server refuses that amendment the row returns to its stored value, visibly: that
return runs for between 320 and 600 milliseconds, and the stored value is what the row reads once
it is over. Under a reduced motion preference the return is not animated and the row still reads
its stored value at the end of it. The conflict banner carries the refuse colour and the saved-row
affirmation carries the affirm colour, each in its own element's text, border or fill.

**A version conflict keeps the refusal notice's own timer.** The `Edit row` dialog is one of the
callers that states the version it read: the save it sends carries the row's `version` as it stood
when the dialog opened in the `If-Match-Version` request header, so a row another caller amended
between the dialog opening and the save is refused for its version rather than overwritten.
An amendment refused because the row has moved on is a refused amendment, so it shows the
refusal notice for the refusal notice's
published duration of 8000 milliseconds and leaves `Amendment refused: {reason}.` in the
`Workspace updates` region while it is there. A second conflict on the same page shows that notice
again from nothing, with its own full 8000 milliseconds ahead of it, even when the first conflict's
timer has already hidden it.

**The snapshots page, its two panels and its retention banner.** `/console/snapshots` carries two
panels, each panel's own name reading on the page as a heading: `Published snapshots`, which lists
the department's snapshots, and `Retention summary`, which states the tier's retention words and
how many snapshots that tier retains. Each of those two panels is a region in the accessibility
tree whose accessible name is its own panel name, the way each administration panel is. The
`Published snapshots` panel lists the retained snapshots and the expired ones alike, reading the
expired ones from the store rather than from
`GET /api/snapshots`, because that address answers only the retained ones. An expired snapshot's
row carries the word `Unavailable` in its own cell and carries `aria-disabled` reading `true` on
the row itself, so a reader on a screen reader is told it is unavailable rather than left to see a
faded row. When a publish pushes a snapshot out of its tier's retention window the page shows a
retention banner, one announced status region of its own naming the period that expired, and that
banner arrives as a notice strip inside the notice strip's published band.

**Copy, word for word.** Five strings the reader sees are fixed. Each reads on screen exactly as
printed here, character for character, with its own full stop and no other wording around it
inside its own element:

| Where the reader sees it | The exact characters |
|---|---|
| a table or a view with no rows to show | `No rows match this view yet.` |
| the first-level heading of a department refusal page | `This department is closed to you.` |
| the landing page a reader arrives at after signing out | `You are signed out of Keystone Tables.` |
| the `Workspace updates` announcement after a snapshot is published | `Snapshot published for {period}.` |
| the sentence on the not-found page | `That address is not part of Keystone Tables.` |

In the snapshot announcement `{period}` is the reporting period the snapshot was published for,
written as the period itself. The refusal page still names the department that is closed, in its
own element beside the heading rather than inside it.

### Accessibility (DP-38, DP-39)

Accessibility is part of the build, not a later pass.

| Requirement | Standard |
|---|---|
| text contrast | every text colour against its own background at the ratio for small text |
| control contrast | every control and focus ring against its neighbour |
| focus | a visible focus ring on every control a keyboard reaches |
| names | every control and every table column carries a programmatic name |
| notices | the banner announces itself to a screen reader when it changes |
| tables | the row title is a header cell and the column captions are header cells |
| motion | the reduced motion preference suppresses animation and keeps outcome |
| targets | every link and button in the header and page body is at least 24 by 24 CSS px |
| headings | every page carries exactly one first-level heading, its page title |

A reader on a keyboard or a screen reader uses the whole product, and the contrast is enough to
read in daylight.

## Backend

### API (DP-01, DP-05, DP-08, DP-11, DP-13, DP-24, DP-31)

The HTTP API is served on the app's origin under the `/api` prefix.

| Endpoint | Request body / query | Returns |
|---|---|---|
| `GET /api/health` | none | `200` once the app is ready |
| `POST /api/auth/login` | `{email, password}` | a bearer token under `token` (or `access_token`) and the account's role grants, and sets the session cookie |
| `POST /api/auth/signup` | `{email, display_name, department, password, tier}` | the created account, carrying its `email`, its `display_name`, its `department` and the `tier` recorded against it |
| `POST /api/auth/logout` | none | no content, with the calling session ended |
| `GET /api/login-attempts` | none | a top-level array of the recorded sign-in attempts, newest first |
| `GET /api/tables` | none | a top-level array of the tables the caller may read, in name order |
| `GET /api/tables/{slug}` | none | one table with its `columns` in position order, its `tier`, its `row_allowance` (or `allowance`), its row `count`, its `stored_kilobytes`, its `content_bytes`, its `content_kilobytes`, its `log_high_ordinal` and its `read_at` |
| `GET /api/tables/{slug}/rows` | `view` (a view `id`), `page` (1-based, default `1`), `per_page` (default `100`, maximum `500`), `cursor` (a cursor the server issued) | a top-level array of one page of the rows the caller may read, in the view's sort order (insertion order without a view), with the total readable row count in the `X-Total-Count` response header and the next page's cursor in the `X-Next-Cursor` response header |
| `POST /api/tables/{slug}/rows` | `{values}`, the row's values keyed by column caption, and the optional `Idempotency-Key` request header | the created row with its `id` and its `version`, or a refusal |
| `GET /api/tables/{slug}/rows/{id}` | none | one row with its `values` |
| `PATCH /api/tables/{slug}/rows/{id}` | `{values}`, the changed values keyed by column caption, and the optional `If-Match-Version` request header | the updated row with its raised `version`, or a refusal |
| `DELETE /api/tables/{slug}/rows/{id}` | none | no content, or a refusal |
| `GET /api/tables/{slug}/log` | `action` (`create`, `update` or `delete`), `account` (the account email), `page` (1-based, default `1`) | a top-level array of change log entries, newest first, twenty at a time |
| `POST /api/tables/{slug}/columns` | `{caption, type, options}` | the created column at the next position |
| `DELETE /api/tables/{slug}/columns/{id}` | none | no content, with the remaining positions closed up |
| `GET /api/tables/{slug}/views` | none | a top-level array of the views the caller may read |
| `POST /api/tables/{slug}/views` | `{name, visibility, filters, sorts}`: `visibility` is `private` or `shared`; `filters` is a list of `{column, operator, value}`; `sorts` is a list of `{column, direction}` with `direction` `asc` or `desc`; `column` is the column caption | the created view, or a refusal |
| `POST /api/tables/{slug}/lock` | `{period}` | the table with its locked period |
| `DELETE /api/tables/{slug}/lock` | none | the table with no locked period |
| `GET /api/snapshots` | `table` | a top-level array of the snapshots the caller may read |
| `GET /api/snapshots/{id}` | none | one snapshot with its frozen `rows` |
| `POST /api/snapshots` | `{table, period}` | the published snapshot, or a refusal on a repeat |
| `GET /api/tiers` | none | a top-level array of the four tiers in grant order with every allowance |
| `GET /api/departments/{slug}/grants` | none | a top-level array of that department's tier grants in `effective_at` order, oldest first, each carrying `department`, `tier`, `effective_at` and `in_force` |
| `GET /api/requests` | `state` | a top-level array of the requests the caller may read |
| `POST /api/requests` | `{department, role}` | the created request at `open` |
| `POST /api/requests/{id}/decision` | `{decision, reason}`, with `decision` `approved` or `declined` | the decided request, its `state` now equal to the decision, or a refusal |
| `POST /api/enquiries` | `{full_name, work_email, phone, company, role, message}` | the recorded enquiry |
| `POST /api/subscribers` | `{email}` | success, whether or not the address was already recorded |

Bearer auth is required on every address above except `GET /api/health`, `POST /api/auth/login`,
`POST /api/auth/signup`, `GET /api/tiers`, `POST /api/enquiries` and `POST /api/subscribers`.

`POST /api/auth/login` also sets a session cookie, and every `/console` page is served on that
cookie. A browser following a link cannot present an Authorization header, so a console page that
answers only on a bearer token is unusable in a browser and does not satisfy this contract.

Every address, pages included, answers `200` with its shape, `401` without a session, `403` with a
session holding no role on the department, `404` for a table that does not exist, `409` for a
repeat that breaks a uniqueness rule, and `422` for a value of the wrong type, a value past a
printed length ceiling or an exhausted allowance.

A session that holds a role on the department but not one the role table grants that action to is
refused `403` as well, so an insufficient role and no role at all answer the same status: a viewer
asked to amend a row, an analyst asked to amend a row, a viewer asked to manage a view, and an
editor or an analyst asked to decide a request, each answer `403`. An analyst, an editor and a
steward each manage views on their department, shared views included, so creating, amending or
deleting a view answers `403` for a viewer of that department and for that reader alone, while the
action an analyst is refused is amending a row. An amend verb on the change log address or on a
snapshot address answers `403` too, because no role amends either, so those addresses answer a
refusal rather than the framework's own method or route error.

A locked-table refusal answers `409` and names the locking period. The two statuses therefore read
the boundary order apart: a row amendment an insufficient role is stopped by answers `403` and
names no period, while one the lock stops answers `409` and names the period.

A refusal body carries a `reason` string and the `field` it concerns. A refusal is never a server
error and never a silent success.

Answers name their fields exactly as below, because a reader of the developer interface has no
other way to learn them:

| Field | Carried by |
|---|---|
| `name` | a tier |
| `row_allowance` | a tier, and a table answer |
| `stored_megabytes` | a tier |
| `view_allowance` | a tier |
| `retention` | a tier |
| `locked_period` | a table |
| `position` | a column |
| `caption` | a column |
| `options` | a choice column |
| `visibility` | a view |
| `filters` | a view |
| `sorts` | a view |
| `values` | a row |
| `ordinal` | a change log entry (integer) |
| `action` | a change log entry (`create`, `update` or `delete`) |
| `account` | a change log entry (the amending account's email) |
| `column` | a change log entry (the amended column's caption, or null for a create and a delete) |
| `recorded_at` | a change log entry (an ISO 8601 timestamp) |
| `before` | a change log entry (the previous value in the column's own JSON type on an update, the deleted row's whole values map on a delete, or null for a create) |
| `after` | a change log entry (the new value in the column's own JSON type on an update, the created row's whole values map on a create, or null for a delete) |
| `published_at` | a snapshot |
| `period` | a snapshot |
| `state` | an access request |
| `reason` | an access request, and a refusal body |
| `field` | a refusal body |
| `count` | a table answer |
| `allowance` | a table answer |
| `version` | a row (integer) |
| `current_version` | a stale-version refusal body (integer) |
| `previous_hash` | a change log entry (the `entry_hash` of the entry one `ordinal` below it) |
| `entry_hash` | a change log entry (its own SHA-256 digest) |
| `stored_kilobytes` | a table answer |
| `log_high_ordinal` | a table answer |
| `read_at` | a table answer (an ISO 8601 timestamp) |
| `retained` | a snapshot (boolean) |
| `content_allowance_kilobytes` | a tier (integer) |
| `effective_at` | a tier grant (an ISO 8601 timestamp) |
| `in_force` | a tier grant (boolean) |
| `content_bytes` | a table answer (integer), and a snapshot (integer) |
| `content_kilobytes` | a table answer (integer) |
| `business_day` | a snapshot, and a change log entry (a calendar date as `YYYY-MM-DD`) |
| `tier` | a table answer, and a snapshot (the tier name) |
| `row_count` | a snapshot (integer) |
| `sequence` | a snapshot (integer) |

A row collection answer stays a top-level array; its total readable row count travels in the
`X-Total-Count` response header, never in the body. A `before` or `after` value keeps the JSON type
of its column: a number for an integer or decimal column, a boolean for a flag column, and a string
for a text, date or choice column.

### Write integrity, concurrency and the audit chain (DP-70 to DP-79)

**A row carries a version.** Every row carries a `version`, an integer the row answers beside its
`values`: in the create answer, in the amendment answer, at `GET /api/tables/{slug}/rows/{id}` and
in every row of the rows collection. A created row carries a `version` of `1`. Every accepted
amendment of a row raises that row's `version` by exactly one, so a row amended twice carries a
`version` of `3`. A `version` never decreases and never repeats on one row: a refused amendment
raises nothing, and the next accepted amendment after a refused one takes the one number above the
`version` the row already held rather than reusing a number a refusal passed over.

**An amendment may state the version it was read at.** `PATCH /api/tables/{slug}/rows/{id}` may
carry the request header `If-Match-Version` holding, in decimal digits and nothing else, the
`version` the caller read the row at. That header is the caller's own concurrency control. When it
holds the row's current `version` the amendment goes on to the write boundary. When it holds any
other number the amendment is refused `409` with `version` as the refusal's `field`, with exactly
the reason `This row has moved on.`, and with a `current_version` key holding the row's current
`version` as an integer. That refusal writes no column, appends no change log entry and leaves the
row's `version` where it was. An amendment carrying no `If-Match-Version` header is taken as an
amendment of the row as it stands and is never refused for its `version`. The `version` is read
after the role, the lock and the allowance and before the column type, so a locked table still
answers its own `409` naming the locking period rather than this one.

**Exactly one amendment of a row wins.** When several amendments of one row arrive together, each
carrying the same `If-Match-Version`, exactly one of them is accepted and every other one is
refused with the stale-version refusal above. The accepted one raises the `version` by one and
appends its change log entries; each refused one writes nothing and appends nothing. Two accepted
amendments of one row never share a `version`, however many callers amend that row at the same
moment.

**A row create may carry an idempotency key.** `POST /api/tables/{slug}/rows` may carry the request
header `Idempotency-Key` holding a string of the caller's own choosing. The server records that key
against the answer it sent and keeps the record for 24 hours from the moment the key was first
seen. Inside that window a second create carrying the same key and the same request body answers
the first answer's status and the first answer's response body byte for byte, creates no second row
and appends no second change log entry. That holds even after the row has since been amended, so
the replayed body still carries the `version` the first answer carried rather than the row's
current one. A create carrying a key the server already recorded against a different request body
is refused `409` with `idempotency_key` as the refusal's `field` and exactly the reason
`This idempotency key was used for another request.`, and records nothing. A create carrying no
`Idempotency-Key` header is a replay of nothing.

**Which repeats are idempotent by their content.** `POST /api/subscribers` is idempotent by the
address alone: a second post of one address answers success and records no second `subscribers`
row. `POST /api/enquiries` is not idempotent by its content: two identical enquiry posts record two
`enquiries` rows. `POST /api/tables/{slug}/rows` is not idempotent by its content either: two
identical creates carrying no `Idempotency-Key` header create two rows, each at a `version` of `1`,
and append two create entries to the change log. Only the `Idempotency-Key` header makes a row
create a replay of an earlier one.

**An amendment is one unit of work.** A `PATCH` naming several columns is one unit. When any one of
the named values is wrong for its column the whole amendment is refused `422`, not one of the named
columns is written, no change log entry is appended, and the row's `version` does not move, so an
amendment never lands half of itself.

**Derived table figures are computed when they are read.** `GET /api/tables/{slug}` answers these
four figures, each computed from the stored rows and log entries at the moment the answer is built
and never read back from a stored copy:

| Table figure | Recipe |
|---|---|
| `count` | the number of rows the table holds |
| `stored_kilobytes` | `count` multiplied by two, because a row is counted as two kilobytes |
| `log_high_ordinal` | the highest `ordinal` among the table's log entries, and `0` when it holds none |
| `read_at` | the server's own clock at the moment the answer was built, as an ISO 8601 timestamp |

A create, an amendment, a delete and a column removal each leave those figures agreeing with the
store on the very next read: `count` equals the stored row count of that table, `stored_kilobytes`
equals twice `count`, and `log_high_ordinal` equals both the highest stored `ordinal` and the
number of log entries the table holds, because the ordinals are contiguous from one with no gap and
no repeat. The `tables` collection in the store carries no `count`, no `stored_kilobytes` and no
`log_high_ordinal` column, because a stored copy of a counted figure is the thing that goes stale.

**The change log is a hash chain.** Every change log entry carries two more fields, `previous_hash`
and `entry_hash`, and the store keeps them in `log_entries` under those same two names. Each of the
two is a SHA-256 digest written as 64 lowercase hexadecimal characters. An entry's `previous_hash`
is the `entry_hash` of the entry one `ordinal` below it in the same table. The first entry of a
table, the one at `ordinal` `1`, carries a `previous_hash` of 64 `0` characters. An entry's
`entry_hash` is the SHA-256 digest of one UTF-8 text built from exactly these seven parts, in this
order, joined by a single `|` vertical bar with no padding around it and with nothing else added
anywhere:

`previous_hash` `|` `table_slug` `|` `ordinal` `|` `action` `|` `account` `|` `column` `|` `recorded_at`

Here `table_slug` is the table's own slug, `ordinal` is its decimal digits with no padding, and
`column` is the empty string when the entry names no column. `previous_hash`, `action`, `account`
and `recorded_at` are each exactly the text the entry answers under that name. Nothing else enters
the digest, and neither `before` nor `after` does, so a reader holding the answered entry
recomputes the digest and nobody needs the store to check it.

No two entries of one table share a `previous_hash`, however many callers amend that table at the
same moment: one entry follows one predecessor and the log never forks. The chain verifies from the
first entry of each table: walking that table's entries in `ordinal` order, the first entry's
`previous_hash` is the 64 `0` characters, each later entry's `previous_hash` equals the previous
entry's `entry_hash`, and every entry's `entry_hash` equals the digest of its own seven parts.

**Stable paging under concurrent writes.** `GET /api/tables/{slug}/rows` also takes a `cursor`
query parameter. A rows answer carries the response header `X-Next-Cursor`, holding the cursor for
the page after the one it answered and holding an empty value when it answered the last page. A
cursor is an opaque string the server issued; a caller passes it back unchanged and never builds
one. Reading with a `cursor` answers the rows that follow the page that cursor was issued for, in
the same insertion order, so a row created between two page reads is never skipped and never
answered twice: the pages of one cursor walk carry no row `id` twice, and every row that existed
before the walk began is answered exactly once, in the order it was inserted. A `cursor` issued for
one table's rows, or for a table of a department the caller holds no role in, used against another
table, is refused `422` with `cursor` as the refusal's `field` and exactly the reason
`This cursor belongs to another table.`, and answers no row.

**Derived snapshot state is computed when it is read.** Every snapshot answer carries `retained`, a
boolean computed when that answer is built: rank the table's snapshots by `published_at` with the
newest first, and the snapshot is `retained` when its rank falls inside its table's tier snapshot
retention count, which is one snapshot for `one period`, four for `four periods`, twelve for
`twelve periods` and every snapshot for `every period`. The `snapshots` collection in the store
carries no `retained` column, and no sweep process runs anywhere in this build, so a snapshot that
has fallen outside its retention reads `retained` as false on the very next read rather than when
some later job gets to it.

### Effective-dated grants, business time and content size (DP-80 to DP-90)

**A tier grant carries the moment it begins.** A department's tier is granted, and every grant
carries the moment it begins. The store keeps those grants in `department_grants`, carrying
`department` (the department slug), `tier` (the tier name) and `effective_at` (an ISO 8601
timestamp). `GET /api/departments/{slug}/grants` answers them oldest first, and any role on the
department reads them while an account holding no role on it is refused as at every other address
of that department.

The grant in force at a moment is the one carrying the greatest `effective_at` at or before that
moment. The boundary moment counts as inside, so a grant takes effect at its own `effective_at`
and not a tick later. A department may hold a later grant that has not begun yet, and that grant
decides nothing at all until its moment arrives.

**Every allowance decision reads the grant in force at the write.** The row allowance, the shared
view allowance, the content allowance and the snapshot retention that govern a write are each taken
from the grant in force at the moment of that write, never from the newest grant on file. A
department holding a grant dated in the future is therefore refused, and told, in the words and the
numbers of the tier it holds today. The `departments` collection carries a `tier` column and it
holds the name of the tier whose grant is in force now.

**The business time zone decides the day.** One published time zone decides every period and
retention boundary of this build: `Asia/Kolkata`, a fixed offset of five hours and thirty minutes
ahead of UTC that never shifts with the seasons. It is not UTC, and no part of this build treats
UTC as the business day. The business day of a moment is that moment's calendar date in that zone,
written `YYYY-MM-DD`. The business day therefore turns over at `18:30:00Z`: a moment at
`18:29:59Z` falls on the business day that carries its own UTC date, and a moment at `18:30:00Z`
falls on the business day after it, because the turnover moment itself belongs to the later day.

A snapshot carries `business_day`, the business day of its `published_at`, and a change log entry
carries `business_day`, the business day of its `recorded_at`. The store keeps each of them in
`snapshots` and in `log_entries` under that same name.

**Expiry boundaries, and which side the boundary moment sits on.** A snapshot retention is a count
of snapshots: one for `one period`, four for `four periods`, twelve for `twelve periods`, and every
snapshot for `every period`. Rank a table's snapshots by `published_at` with the newest first. A
snapshot whose rank is at or below that count is inside its retention, so the rank equal to the
count is the last one retained and the rank one above it is the first one expired.

Publishing a snapshot past the count therefore expires the oldest one: it answers `410` at
`GET /api/snapshots/{id}`, it is absent from `GET /api/snapshots`, and the snapshot ranked one
place newer than it still answers `200` and is still listed. Expiry is computed when a read is
answered, from the server's own clock and the stored snapshots alone. No sweep, no job and no timer
expires anything in this build, and an expired snapshot keeps its row in `snapshots` rather than
being deleted.

A session lifetime sits the other way round: a session is refused once the server's clock reaches
its `expires_at`, so that boundary moment counts as outside. A session is accepted strictly before
`expires_at` and refused at it and after it. A fresh session's `expires_at` is exactly twelve hours
after its `created_at`, to the second and not one second either side of it.

**A table's content size, derived and floored.** A table answer carries `content_bytes` and
`content_kilobytes`, both computed from the stored rows at the moment the answer is built and
neither of them read back from a stored copy. The `tables` collection in the store carries no
`content_bytes` and no `content_kilobytes` column. A row contributes the sum, over the table's
columns, of what that column holds in that row:

| What the column holds in the row | Contributes |
|---|---|
| no value, because it was never given or has since been cleared | `0` |
| a text, date or choice value | the number of characters in the stored text |
| an integer value | `4` |
| a decimal value | `8` |
| a flag value | `1`, whether it holds true or false |

`content_bytes` is the sum of those contributions over every row the table holds, counted in bytes.
`content_kilobytes` is `content_bytes` divided by `1024` and floored to a whole number of
kilobytes, never rounded and never rounded up, so `1023` bytes is `0` kilobytes, `2047` bytes is
`1` kilobyte and `2048` bytes is `2` kilobytes.

**The content allowance refuses the next write.** Every tier grants a content allowance per table,
answered as `content_allowance_kilobytes` and carried by the grant table above. A row create or a
row amendment of a table whose `content_kilobytes` already equals or exceeds the content allowance
of the tier in force is refused `422` with `content_kilobytes` as the refusal's `field` and a
reason naming the tier, that allowance and the table's own `content_kilobytes`, and that refusal
appends no change log entry. The content allowance is read with the row allowance, after the lock
and before the `version`, and when both allowances are exhausted the row allowance is the one
reported.

**A snapshot records the rules it was published under.** A snapshot carries, recorded once at
publication and never recomputed afterwards, the tier that was in force and that tier's own
figures:

| Snapshot field | What publication recorded |
|---|---|
| `tier` | the name of the tier in force at publication |
| `row_allowance` | that tier's row allowance at publication |
| `content_allowance_kilobytes` | that tier's content allowance at publication |
| `retention` | that tier's snapshot retention words at publication |
| `row_count` | the number of frozen rows the snapshot holds |
| `content_bytes` | the content size of those frozen rows by the recipe above |
| `sequence` | the snapshot's place in its department's snapshot sequence |

The store keeps all seven in `snapshots` under those same seven names. A later grant, a later tier
change and a later amendment of the live table each leave every one of them exactly as publication
wrote them: an old record keeps the old rule, because a record that quietly adopts today's rule is
no record at all.

**The department snapshot sequence.** Every snapshot carries `sequence`, its place in the sequence
of its own department. A department's first snapshot carries a `sequence` of `1` and each later one
carries the next whole number, so one department's sequence numbers run contiguously from one with
no gap and no repeat however many of its tables are published at the same moment. Two snapshots of
one department never share a `sequence`, and an expired snapshot keeps the `sequence` it was given.

**Reading a table of several thousand rows.** A rows answer carries at most `500` rows, and that
cap holds however it is asked for: a `per_page` above `500` is refused `422` with `per_page` as the
refusal's `field` and exactly the reason `A page carries at most 500 rows.`, and no answer of
`GET /api/tables/{slug}/rows` ever carries more than `500` rows. A `page` far from the first
answers its own slice and nothing else: at a `per_page` of `n`, `page` `p` answers the rows at
positions `n` multiplied by `p` minus `n` plus one through `n` multiplied by `p` of the answering
order, and `X-Total-Count` carries the whole total under the view's filters rather than the length
of the page it answered. A view's filters narrow that total, and its sorts order the whole table
before the page is cut, so the sort decides which rows a later page carries. Rows are answered in
insertion order without a view, so a row created between two page reads lands after every row that
existed before it and the pages already read are never disturbed.

### Session and account security (DP-48 to DP-56)

**The session cookie.** `POST /api/auth/login` sets one session cookie, and that cookie is named
`keystone_session`. It carries `HttpOnly`, it carries `SameSite=Lax` and it carries `Path=/`, so a
script on the page never reads it: `document.cookie` holds no `keystone_session` entry while the
console renders on it. That cookie on its own opens every `/console` page and every closed `/api`
address, with no Authorization header anywhere.

**Sign out.** `POST /api/auth/logout` needs a session and ends the session it was called with. It
ends that one session and no other, so a second browser signed in as the same account keeps
reading. Once a session has ended, its cookie answers `401` at every closed `/api` address, and a
`/console` page asked for on it answers the refusal page with a client-error status and never a
redirect. The sign out control carries the reader to the landing page, and that is the one
navigation sign out performs: asking afterwards for a `/console` page on the ended cookie is
refused rather than redirected. The ended session's row is removed from `sessions`. Two sign ins
of one account hold two sessions carrying two different cookie values, so each can be ended on its
own.

**Session lifetime.** A session is valid for twelve hours from the moment it was created. Its
`sessions` row records `created_at`, the moment the session was created, and `expires_at`, exactly
twelve hours after `created_at`. A session whose `expires_at` has passed is stale: it answers
`401` at every closed `/api` address, and a `/console` page asked for on it answers the refusal
page with a client-error status and never a redirect. The server refuses a stale session by
comparing the moment against `expires_at` and leaves its row where it is, so a stale row is never
pruned and the seeded stale session stays readable in the store.

**Password rules on sign up.** A sign up password is at least 12 characters long, and a shorter
one is refused `422` with `password` as the refusal's `field`. Four passwords are refused however
long they are, compared with letter case ignored: `keystonetables`, `northbankmutual`,
`passwordpassword` and `claimsworkspace`. Each of those four is refused `422` with `password` as
the refusal's `field` too. A refused sign up records no account.

**Sign up reveals no account.** A sign up for an email already recorded is refused `422`, its body
carrying `email` as its `field` and exactly the reason `This email cannot be used.`. A sign up for
an address nobody holds that is malformed, and so is no work email at all, is refused with that
same `422`, that same `email` field and that same reason word for word, so the two bodies read the
same and a stranger learns nothing about who already holds an account. Neither of them records an
account.

**One sign-in refusal.** A wrong password and an email nobody holds are each refused `401` with
exactly the reason `Email or password is wrong.` and `email` as the refusal's `field`, so the two
bodies read the same word for word and name neither which half was wrong.

**Failed sign-in throttling.** The throttle is keyed on the work email alone and never on the
caller's address. Five refused sign-in attempts for one work email inside fifteen minutes throttle
that email: the sixth attempt for it, and every attempt for it after that, answers `429` with a
`Retry-After` header holding the whole seconds left to wait, the attempt carrying the right
password included. A successful sign-in clears the refused count for that email, so four refusals
followed by a success leave the email unthrottled and the next four refusals answer `401` again.
Throttling one work email throttles no other email.

**Form posts carry their token.** The enquiry form on `/enquiry` and the newsletter form on
`/community` each carry a hidden control `name="form_token"` whose value the server issued with
that page. A form-encoded post to `POST /api/enquiries` or `POST /api/subscribers`, meaning one
whose content type is `application/x-www-form-urlencoded` or `multipart/form-data`, carries that
`form_token`. A form-encoded post to either address whose `form_token` is missing, empty or a
value the server never issued is refused `403` with `form_token` as the refusal's `field`, and
nothing is recorded. A post carrying a JSON body or a bearer token is an interface call rather
than a browser form post and carries no `form_token`, and the sign in and sign up posts carry no
`form_token` either, because a reader with no session yet has no page state to protect.

**Sign-in attempts are recorded.** Every sign-in attempt, successful or refused, records one
`login_attempts` row carrying the work email it was made for, the moment it was made and its
outcome, and the outcome reads `succeeded` or `refused`. That row never holds the password that
was tried, in any column, and `login_attempts` carries no password column at all.
`GET /api/login-attempts` answers a top-level array of those rows, newest first, and only a
steward reads it: a steward of any department answers `200`, while a viewer, an analyst and an
editor each answer `403` and a caller with no session answers `401`.

### The steward administration console (DP-91 to DP-99)

**One console, three panels, stewards only.** `/console/administration` is the steward
administration console. It is a console page, served on the session cookie like every other
`/console` page, and it carries exactly three panels, each panel's own name reading on the page as
a heading:

| Panel | What it holds |
|---|---|
| `Grant administration` | every role grant of the steward's own department, and the controls that create and revoke one |
| `Access request queue` | that department's access requests, the open ones first |
| `Sign-in attempt record` | the recorded sign-in attempts `GET /api/login-attempts` answers |

Only a steward reaches it. A viewer, an analyst and an editor each get the refusal page at
`/console/administration` with a client-error status and never a redirect, and that page states
exactly the sentence `This console is for stewards only.`. A reader with no session at all gets
that same refusal page answered `401`, again rather than a redirect, because a reader who is sent
away to sign in has been told the address exists.

The administration interface sits under the `/api/admin` prefix:

| Endpoint | Accepts | Request body / query | Returns |
|---|---|---|---|
| `GET /api/admin/grants` | `GET`, `POST` | none | a top-level array of the role grants of the caller's own department, each carrying `id`, `account`, `department`, `role`, `authorises_from` and `authorising` |
| `POST /api/admin/grants` | `GET`, `POST` | `{account, role, authorises_from}`, where `authorises_from` is optional | the created role grant on the caller's own department |
| `DELETE /api/admin/grants/{id}` | `DELETE` | none | no content, with that one grant revoked |
| `POST /api/admin/grants/revocations` | `POST` | `{grants, confirmation}`: `grants` is a list of role grant `id` values, `confirmation` is the confirmation phrase below | the revoked count under `revoked`, or a refusal |
| `GET /api/admin/queue` | `GET` | `cursor` (a cursor the server issued) | a top-level array of one page of the caller's own department's access requests |
| `GET /api/admin/counts` | `GET` | none | the caller's own department's figures: `department`, `grants` and `open_requests` |
| `GET /api/admin/log` | `GET` | `page` (1-based, default `1`) | a top-level array of the administration log entries of the caller's own department, newest first, twenty at a time |

Every one of those addresses needs a session holding a `steward` role grant. A caller with no
session is refused `401`. A caller whose role on its own department is `viewer`, `analyst` or
`editor` is refused `403` with `role` as the refusal's `field` and exactly the reason
`This console is for stewards only.`, and that refusal writes nothing anywhere.

**Permission is read again on every request and never cached at sign in.** A session carries the
account it belongs to and nothing a grant decides. Every request, page or interface alike, reads
the role grants standing in the store at the moment that request is answered. A grant revoked
while the account holds a live session therefore takes effect on that account's very next request
on that same session rather than at its next sign in: the read made before the revoke answers
`200` and the next read on the identical session answers the department refusal. A grant created
while the account holds a live session opens that department to it on its very next request the
same way, with no sign out and no sign in between. A build that resolves an account's permissions
once at sign in and carries them inside the session satisfies no part of this paragraph.

**A grant carries the moment it authorises from.** Every role grant carries `authorises_from`, an
ISO 8601 timestamp, and `role_grants` keeps it under that same name. A grant authorises nothing
before that moment: a read of the department made before it is refused exactly as though the grant
were not there at all. A grant authorises at that moment and after it, so the boundary moment
itself counts as inside, the way a tier grant takes effect at its own `effective_at`.

That decision is made from the server's own clock at the moment the request is read, from the
stored grant alone. No sweep, no job and no timer turns a grant on in this build, so a grant whose
moment has arrived authorises on the very next request rather than when some later process gets to
it. `GET /api/admin/grants` carries `authorising`, a boolean computed at that read: true once the
server's clock has reached or passed that grant's `authorises_from`, and false before it. A grant
created with no `authorises_from` authorises from the moment it was created.

**A refused administration read records nothing at all.** A request to the administration console
or to any `/api/admin` address that is refused for want of a steward role, or for being another
department's business, records nothing of itself. It appends no administration log entry, so the
highest `ordinal` of the department's administration log stream reads the same figure before it
and after it, and it records no `login_attempts` row, so that record's count reads the same figure
before it and after it too. A refusal that leaves a trail of its own is a way of writing to a
store the caller was refused.

**Bulk revoke, behind an exact phrase and all or nothing.**
`POST /api/admin/grants/revocations` revokes several role grants of the steward's own department
in one call. Its `confirmation` field carries the confirmation phrase, which reads, character for
character and letter case included:

`Revoke these grants permanently`

A `confirmation` holding anything else is a mismatch, the phrase in a different letter case and
the phrase with one character added or taken away included. A mismatched phrase revokes not one of
the named grants, changes not one grant row in the store, appends no administration log entry, is
refused `422` with `confirmation` as the refusal's `field` and exactly the reason
`The confirmation phrase does not match.`, and announces in the `Workspace updates` region exactly
the sentence `Bulk revoke refused: the confirmation phrase does not match.`

A matching phrase revokes every grant the `grants` list names, or none of them. A named grant
cannot be revoked when its `id` names no role grant at all, or names a role grant of a department
other than the caller's own. When any one named grant cannot be revoked the whole call is refused
`422` with `grants` as the refusal's `field` and exactly the reason
`One of these grants cannot be revoked.`, not one of the named grants is revoked, and no
administration log entry is appended, so a bulk revoke never lands half of itself. A matching
phrase over grants that can every one of them be revoked revokes all of them, answers `revoked`
holding how many it revoked, appends one administration log entry per revoked grant, and announces
in the `Workspace updates` region exactly the sentence `Grants revoked: {count}.` with the revoked
count written in place of the brace.

The `Grant administration` panel carries a `Revoke grants` control, and pressing it opens a dialog
named `Confirm bulk revoke`. That dialog carries the `Confirmation phrase` control, a `Cancel`
control that closes it and records nothing, and the primary control `Revoke`. Completing the dialog
sends one bulk revoke carrying whatever the `Confirmation phrase` control holds. The confirmation
phrase is read before the named grants are, so a mismatched phrase is refused and announced
whichever grants the panel named and even when it named none.

`Confirm bulk revoke` is a console dialog and keeps every rule the four workspace dialogs keep. The
`Revoke grants` control holds focus immediately before it opens; when it opens, focus moves to a
control the dialog holds; `Tab` reaches only the dialog's own controls however many times it is
pressed, and from the last of them returns to the first; `Shift+Tab` on the first moves to the
last; `Escape` closes it and records nothing; and however it closes, by `Escape`, by `Cancel` or by
completing the revoke, focus returns to the `Revoke grants` control that opened it. The whole
revoke is completed with the keyboard alone, by pressing `Enter` on `Revoke grants`, typing the
phrase and pressing `Enter` on `Revoke`.

A refused bulk revoke is a refusal notice like any other: the notice that carries
`Bulk revoke refused: the confirmation phrase does not match.` carries the refuse colour in its own
element's text, its border or its fill, and never the affirm colour or the caution colour.

**Each panel is a region of its own, or it is not there at all.** Each of the three panels is a
region in the accessibility tree whose accessible name is that panel's own published name, so a
reader on a screen reader moves between `Grant administration`, `Access request queue` and
`Sign-in attempt record` by region. A reader the console refuses finds none of those three regions
in the accessibility tree at all: the refusal page carries no region of any of those three names,
rather than carrying them emptied, hidden or disabled, because a panel a reader may not use is one
the build never renders for them.

**The three panels across the three bands.** The administration console lays its three panels out
by width, in the three published bands and changing at the two published widths and at no other
width: under 640 CSS px each panel takes a row of its own, so the three panels occupy three rows;
at 640px to 799px they occupy two rows; at 800px and wider all three sit in one row. Inside one
band nothing drifts, so 480px reads like 639px, 720px reads like 640px and like 799px, and 1200px
reads like 800px and like 1440px.

**Every administration action is attributed, in the same hash chain.** A grant created at
`POST /api/admin/grants`, a grant revoked at `DELETE /api/admin/grants/{id}` or at
`POST /api/admin/grants/revocations`, and an access request decided at
`POST /api/requests/{id}/decision` each append one administration log entry. Those entries live
in `log_entries` beside every other entry, in the administration log stream of the department the
action concerned, whose `table_slug` is `admin-` followed by that department's slug, so the
`claims` department's administration log stream is `admin-claims` and the `underwriting`
department's is `admin-underwriting`. An administration entry carries:

| Administration entry field | Content |
|---|---|
| `ordinal` | its position in that stream, an integer contiguous from one |
| `action` | `grant_created`, `grant_revoked` or `request_decided` |
| `account` | the email of the steward that acted |
| `subject` | the email of the account the action concerned |
| `recorded_at` | the moment it was recorded, an ISO 8601 timestamp |
| `business_day` | the business day of that moment |
| `column` | null, because an administration entry names no column |
| `before` | null |
| `after` | null |
| `previous_hash` | the `entry_hash` of the entry one `ordinal` below it in the same stream |
| `entry_hash` | its own SHA-256 digest |

The store keeps `subject` in `log_entries` under that same name. An administration entry takes its
place in the published hash chain exactly like a table's entry: its `entry_hash` is the SHA-256
digest of the same seven parts joined by a single `|` vertical bar, carrying that stream's own
`table_slug` as the second part and the empty string as the sixth part because the entry names no
column, and `subject` enters the digest nowhere. The first entry of a stream, the one at `ordinal`
`1`, carries a `previous_hash` of 64 `0` characters, the chain verifies from it walking the
stream in `ordinal` order, and the stream's ordinals are contiguous from one with no gap and no
repeat. An administration entry is never updated and never removed. `GET /api/admin/log` answers
that stream newest first, twenty entries a page.

**A steward governs one department and no other.** A steward's writ runs over the department its
own `steward` grant names and over no other one. Every administration action aimed at another
department is refused `403` with `department` as the refusal's `field` and exactly the reason
`This department is not yours to govern.`: revoking one named grant of another department at
`DELETE /api/admin/grants/{id}`, and deciding an access request raised for another department, are
each refused that way, whether or not the acting account holds some lesser role on that other
department. A bulk revoke naming a grant of another department is refused by the all-or-nothing
rule above instead, because that call names several grants and no one of them is the subject.

The refusal holds on the derived surfaces too. `GET /api/admin/counts` answers its own
department's figures and no others: `grants` counts the role grants of the caller's own department
and `open_requests` counts the access requests for the caller's own department whose `state` is
`open`, and neither of them ever counts a row of another department, so a request raised for one
department moves no other department's figure. A queue cursor is issued for one department's
queue and for no other. A cursor issued for one department's queue, used by a steward of another
department, is refused `422` with `cursor` as the refusal's `field` and exactly the reason
`This cursor belongs to another department.`, and answers no request.

**Only the published administration surface answers.** Each `/api/admin` address accepts exactly
the methods its own table row names above and no other method. A request to one of them carrying a
method that row does not name is refused `405` with `method` as the refusal's `field` and exactly
the reason `That method is not allowed here.`, carries an `Allow` response header naming the
methods that address does accept, and writes nothing. A write to an `/api/admin` address whose
content type is anything other than `application/json` is refused `415` with `content_type` as the
refusal's `field` and exactly the reason `That request body type is not supported.`, and records
nothing. An address under `/console/administration` that this brief does not publish has no route
at all, so it answers `404` with the custom not-found page and its published sentence, exactly as
any other address with no route does.

**The access request queue, and two stewards deciding together.** `GET /api/admin/queue` answers
the caller's own department's access requests with every request whose `state` is `open` ahead of
every decided one, each of those two groups ordered by `raised_at` oldest first, and twenty
requests to a page. Every access request carries `raised_at`, the moment it was raised, an ISO
8601 timestamp, and `requests` keeps it under that same name. A queue answer carries the response
header `X-Queue-Cursor`, always holding a non-empty opaque cursor the server issued for that one
department's queue. Reading the queue with that cursor answers the requests that follow the page
just answered, which is an empty array once the queue holds no further request, and that answer
carries its own cursor in turn. A caller passes a cursor back unchanged and never builds one.

An open access request is decided exactly once. When two stewards of one department decide the
same open request at the same moment, exactly one of those decisions is recorded and the other is
refused `409` with `state` as the refusal's `field` and exactly the reason
`This request has already been decided.`. The losing decision records nothing: it leaves the
request's `state` and its `reason` exactly as the winning decision wrote them and appends no
administration log entry. A decided request is never shown as open: it is absent from the open
group of the queue from the very next read, and one queue walk never answers one request twice.

### Business rules (DP-12 to DP-30, DP-45, DP-46, DP-85, DP-86)

#### Tables, columns and views

1. **Tables, columns and typed values.** A table carries a name, a slug, a department, a tier and
   an ordered list of columns. A column carries a caption, a position and exactly one type. The
   six column types, what each accepts and what each refuses:

   | Column type | Accepts | Refuses |
   |---|---|---|
   | text | a string up to 500 characters | a longer string |
   | integer | a whole number | a decimal, a string, an empty value |
   | decimal | a number with up to two decimal places | a number with more places |
   | date | a calendar date in year month day order | any other arrangement |
   | choice | one member of the column's own option list | a value outside that list |
   | flag | true or false | any other value |

2. **Type enforcement at the write boundary.** A value of the wrong type for its column is refused
   at the write boundary and not in the browser alone. The refusal names the column caption and
   the type it wanted, and it leaves the row exactly as it was. A browser-side check that is not
   repeated at the write boundary does not count.
3. **Contiguous column positions.** Column positions are contiguous and start at one. Removing a
   column closes the gap it left, so positions stay contiguous. The change log entries that
   reference the removed column survive the removal unchanged: losing the history is worse than
   losing the column.
4. **Saved views, filters and sorting.** A view is a named, saved arrangement of one table,
   carrying an owner, a visibility, an ordered filter list and an ordered sort list.

   | View property | Values |
   |---|---|
   | visibility | `private` to its owner, or `shared` with the department |
   | filter | `{column, operator, value}`: a column caption, an operator and a value |
   | sort | `{column, direction}`: a column caption and `asc` or `desc` |

   The six filter operators are `equals`, `not equals`, `contains`, `greater than`,
   `less than` and `is empty`. An operator is offered only where the column type supports it, so
   contains never appears for an integer column and greater than never appears for a flag column.

   | Operator | Offered for | What it compares |
   |---|---|---|
   | `equals`, `not equals` | every column type | a number by value, a date by calendar order, a flag by its truth, and a text or choice value as text with case folded away |
   | `contains` | a text column only | whether the stored text holds the given fragment anywhere inside it, with case folded away, so `claim` and `CLAIM` select the same rows |
   | `greater than`, `less than` | an integer, decimal, date, text or choice column, and never a flag column | numbers by value, dates by calendar order, and text and choice values by the sort ordering below |
   | `is empty` | every column type | a column whose value was never given or has since been cleared, so a flag that is false and a number that is zero are both values and neither of them is empty |

   Every filter on a view has to hold: two or more filters on one view combine with AND, and a view
   carrying no filter answers every row the reader may read. A sort orders a number by value, a
   date by calendar order, and a text or choice value alphabetically with case folded away, so
   `apple` and `Apple` sort together and digits sort ahead of letters; a sort running `desc` runs
   that same ordering backwards. The sort list is applied in its own order, the first sort deciding
   and each later one breaking the tie above it. A row whose value on the sort column is empty
   sorts after every row carrying a value under `asc` and ahead of all of them under `desc`, and an
   empty value satisfies neither `greater than` nor `less than`.
5. **A view narrows rows and never widens permission.** A reader opening a shared view of a table
   in a department they hold no role in gets the same refusal page as any other address, and the
   view's own filters are never evaluated. Rows a reader may not read are absent from the result
   and absent from its count, because a count that is too high tells a stranger a row exists.
6. **Stable, deterministic sorting.** Two rows that tie on every sort column keep their insertion
   order, so the same view returns the same order every time it is opened.

#### Change log

7. **Row editing and the append-only change log.** An amendment is a create, an update or a delete
   of one row. An update that succeeds writes exactly one change log entry per amended column. A
   create and a delete each write exactly one entry however many columns the row holds, so a
   create of a six column row writes one entry and not six, and that entry carries `column` as
   null. On a create `before` is null and `after` carries the created row's whole `values` map; on
   a delete `after` is null and `before` carries the deleted row's whole `values` map. Every
   amendment that is refused writes none.

   | Change log field (API key) | Content |
   |---|---|
   | `ordinal` | the entry's position in its table's log, an integer contiguous from one |
   | `action` | `create`, `update` or `delete` |
   | `account` | the email of the account that made the amendment |
   | `recorded_at` | the moment the amendment was recorded, an ISO 8601 timestamp |
   | `column` | the caption of the column amended, or null for a create and a delete |
   | `before` | the previous value in the column's JSON type on an update, the deleted row's whole values map on a delete, or null for a create |
   | `after` | the new value in the column's JSON type on an update, the created row's whole values map on a create, or null for a delete |

   The store keeps the same entry in `log_entries`, where the caption sits under `column_caption`.

8. **The change log is append-only.** An entry is never updated and never removed, including when
   the row it describes is deleted and when the column it references is removed. Ordinals stay
   contiguous from one within each table and never restart, so a gap in the ordinals is evidence
   of a fault rather than of a deletion. An update that changes three columns of one row writes
   three entries sharing one recorded moment, one per column, each carrying its own before and
   after value. The change log page reads newest first, pages twenty entries at a time (`page` is
   1-based), and filters by action and by account email. Any role on the department reads the log; no role hides it,
   and no role may amend it.

#### Tiers and allowances

9. **Entitlement tiers and allowances, from one grant table.** Four tiers carry the product, and
   this grant table is the single source for both the published plan matrix and every refusal the
   console returns:

   | Tier | Row allowance per table | Stored megabytes per department | Content kilobytes per table | Shared views per table | Snapshot retention |
   |---|---|---|---|---|---|
   | starter | 3000 | 2048 | 192 | 2 | one period |
   | team | 50000 | 20480 | 2048 | 10 | four periods |
   | scale | 250000 | 102400 | 10240 | 40 | twelve periods |
   | regulated | 1000000 | 512000 | 102400 | 200 | every period |

   The retention is stored and answered as the words in the last column (`one period`,
   `four periods`, `twelve periods`, `every period`). The content kilobytes column is answered as
   `content_allowance_kilobytes`, and a tier answer carries it beside its other allowances.
10. **An allowance is counted, compared and refused in one place.** Creating a row in a table
    already at its row allowance is refused with a message naming the tier, the allowance and the
    count, and the refusal writes no change log entry. The same numbers render the plan matrix, so
    the published page and the console refusal can never disagree. Shared views are counted per
    table and refuse on that same pattern, naming the tier, the allowance and the count. Stored
    megabytes are counted and answered per department but never refuse anything, because at two
    kilobytes a row no table this build allows reaches the smallest stored megabytes allowance of
    2048, so there is no stored megabytes refusal to state or to reach.

#### Locks, snapshots and requests

11. **Locking a table for a reporting period.** A steward locks a table for a named reporting
    period. A locked table refuses every amendment with `409` and a message naming the period, and
    the lock banner carries the refuse colour and the same period. Unlocking restores amendment and
    writes no change log entry, because a lock amends no row.
12. **Publishing a frozen snapshot.** A steward publishes a snapshot of one table for one period.
    A snapshot carries the table, the period, the publishing account, the moment it was published
    and a frozen copy of every row the table held at that moment. Publishing never requires the
    table to be locked: a steward publishes an unlocked table and a locked one alike, and the
    snapshot's `period` need not equal the table's `locked_period` and is never checked against
    it, so no publish is ever refused for a missing or a differing lock.

    | Snapshot property | Behaviour |
    |---|---|
    | rows | frozen at publication, and never changed by a later amendment |
    | period | one snapshot per table per period, and a repeat is refused |
    | retention | the oldest snapshot beyond the tier's retention is unreachable |
    | access | any role on the department reads it, and no role amends it |

    A snapshot is read-only at its own address. Amending the live table afterwards changes no
    snapshot row. The snapshot and the live table are allowed to disagree, because that
    disagreement is the reason a snapshot exists at all.
13. **Raising and deciding an access request.** An account raises a request for a role on a
    department it holds no role in, and a steward of that department approves or declines it with
    a reason.

    | Request rule | Behaviour |
    |---|---|
    | raising | an account raises a request for a department it holds no role in |
    | deciding | only a steward of the requested department decides it |
    | self decision | the requesting account is refused its own decision, steward or not |
    | repeat | one open request per account per department, and a repeat is refused |
    | effect | an approval grants the requested role and is visible immediately |

    Nobody decides their own request, steward or not, because signing off your own access is not a
    control at all.

### Services (DP-04, DP-47)

PostgreSQL is the store, reached at `DATABASE_URL`, and it is already running: do not download,
install, compile or start a copy of it. The database is the fact: an in-memory dictionary standing
in for a table, a JSON file on the app container's filesystem, or a stubbed client that answers its
own calls are each a contract violation however good the interface looks. A record lives in
PostgreSQL and nowhere else, and the console can only reflect what lives there. Use only the
providers named in this brief. No edge functions. No email is sent by this build; a recorded
enquiry and a recorded subscribe are confirmed on screen.

### Store shape (DP-03, DP-04, DP-10, DP-80, DP-81)

| Entity | Key fields | Relations |
|---|---|---|
| department | slug, name | owns tables, grants roles |
| account | email, display name, department | holds roles, raises requests |
| role grant | account, department, role | one role per account per department |
| tier | name, row allowance, stored megabytes, content allowance kilobytes, view allowance, retention | applied to tables |
| tier grant | department, tier, effective at | decides a department's tier in force |
| table | slug, name, department, tier, locked period | owns columns, rows, views, log entries |
| column | table, caption, position, type, option list | referenced by log entries |
| row | table, ordered values, inserted position | referenced by log entries |
| view | table, name, owner, visibility, filters, sorts | reads rows |
| log entry | table, ordinal, action, account, recorded at, column, before, after | append-only |
| snapshot | table, period, account, published at, frozen rows, recorded tier figures, business day, sequence | read-only |
| request | account, department, requested role, state, reason | decided by a steward |
| session | cookie value, account, created at, expires at | ends at sign out |
| sign-in attempt | work email, attempted at, outcome | read by a steward |

The store keeps one PostgreSQL table per entity above, named `departments`, `accounts`,
`role_grants`, `tiers`, `department_grants`, `tables`, `columns`, `rows`, `views`, `log_entries`,
`snapshots`, `requests`, `sessions` and `login_attempts`, plus `subscribers` for newsletter addresses and
`enquiries` for recorded enquiries.
Every one of them carries an `id` key, and the `id` an answer carries is that row's `id`. These
columns hold the stated values, because the store is read directly to check what the console
claims:

| Table | Columns and what they hold |
|---|---|
| `departments` | `slug`; `tier` (the tier name) |
| `accounts` | `email` |
| `role_grants` | `account` (the account email); `department` (the department slug); `role`; `authorises_from` |
| `tiers` | `name`; `row_allowance`; `content_allowance_kilobytes` |
| `department_grants` | `department` (the department slug); `tier` (the tier name); `effective_at` |
| `tables` | `slug`; `tier` (the tier name); `locked_period` (the period, or null when unlocked) |
| `log_entries` | `table_slug`; `ordinal`; `action`; `recorded_at`; `business_day`; `column_caption` (null for a create or delete); `before`; `after`; `subject` (the account an administration entry concerned, null otherwise) |
| `snapshots` | `table_slug`; `period`; `published_at`; `business_day`; `sequence`; `tier`; `row_allowance`; `content_allowance_kilobytes`; `retention`; `row_count`; `content_bytes` |
| `requests` | `account` (the requesting email); `department` (the slug); `role`; `state` (`open`, `approved` or `declined`); `raised_at` |
| `subscribers` | `email` |
| `enquiries` | `work_email` |
| `sessions` | `value` (the session cookie's value, exactly as the browser holds it); `account` (the account email); `created_at`; `expires_at` |
| `login_attempts` | `email` (the work email the attempt was made for); `attempted_at`; `outcome` (`succeeded` or `refused`) |

Four uniqueness rules hold, and a repeat that breaks one is refused rather than silently merged:

- A role grant is unique on account and department.
- A snapshot is unique on table and period.
- An open request is unique on account and department.
- A log ordinal is unique on table and ordinal.
- A tier grant is unique on department and effective moment.
- A snapshot sequence is unique on department and sequence.

### Seed data (DP-03, DP-23, DP-25, DP-26, DP-80, DP-82, DP-87, DP-89)

The seeded state is deterministic, so a reader opening the build twice sees the same numbers:
three departments each on a different tier; eight accounts spread across the four roles; five
tables with between two and six columns each; one table seeded to four fifths of its row allowance
so the caution notice is visible without any amendment; one table locked for a named period; one
high-volume table of several thousand rows; four published snapshots over two tables; four tier
grants, one of them dated in the future; and three access requests, one open, one approved and one
declined. Seeding writes no change log entry and no view. Every value a seeded row holds in a
text, date or choice column is at most `24` characters long, so a reader can bound a seeded
table's content size without reading one of its rows.

Seed exactly these accounts, every one of them with the password `deku-demo-pw-2026`:

| Email | Role | Department |
|---|---|---|
| `steward.claims@example.com` | `steward` | `claims` |
| `editor.claims@example.com` | `editor` | `claims` |
| `analyst.claims@example.com` | `analyst` | `claims` |
| `viewer.claims@example.com` | `viewer` | `claims` |
| `steward.underwriting@example.com` | `steward` | `underwriting` |
| `editor.underwriting@example.com` | `editor` | `underwriting` |
| `steward.actuarial@example.com` | `steward` | `actuarial` |
| `analyst.actuarial@example.com` | `analyst` | `actuarial` |

Seed exactly these five tables, with `claims` on the `starter` tier, `underwriting` on the `team`
tier and `actuarial` on the `scale` tier:

| Table slug | Department | Seeded state |
|---|---|---|
| `claims-intake` | `claims` | `2400` rows, exactly four fifths of the `starter` row allowance, so the caution notice shows |
| `claims-reserves` | `claims` | `40` rows, locked for the `2026-Q2` period, with a `2026-Q1` snapshot holding its first `36` rows and a `2026-Q2` snapshot holding all `40` |
| `underwriting-risk` | `underwriting` | a working table of at most `50` rows, below its allowance |
| `actuarial-triangles` | `actuarial` | a working table of at most `50` rows, below its allowance |
| `actuarial-exposure` | `actuarial` | the high-volume table, exactly `4000` rows, below its allowance |

The `claims-intake` columns are `Reference` as text, `Claim count` as integer, `Reserve amount` as
decimal, `Opened on` as date, `Band` as choice over `low`, `moderate` and `high`, and `Settled` as
flag, so all six column types are reachable on a table that is not locked. The `claims-reserves`
columns are `Reference`, `Reserve amount`, `Opened on`, `Band` and `Settled`.

The `actuarial-exposure` columns are, in position order, `Reference` as text, `Exposure count` as
integer, `Band` as choice over `low`, `moderate` and `high`, and `Settled` as flag. Its `4000`
rows are seeded in order, and the row at insertion position `n`, counting from `1`, holds exactly:
`Reference` of `EXP-` followed by `n` written in four digits padded with leading zeros, so
position `1` holds `EXP-0001` and position `4000` holds `EXP-4000`; `Exposure count` of `n`;
`Band` of `low` when the remainder of `n` divided by `3` is `1`, `moderate` when that remainder is
`2` and `high` when it is `0`; and `Settled` of true when `n` is even and false when `n` is odd.
No column of this table is ever left without a value.

The two `claims-reserves` snapshots sit on the `starter` tier, whose snapshot retention is one
period, so the `2026-Q1` snapshot is the oldest beyond that retention and is unreachable while the
`2026-Q2` snapshot answers. Both of them record the `starter` tier and the `starter` figures that
were in force when they were published.

Seed two more snapshots, of `actuarial-triangles`, straddling one business day turnover so a
reader can prove which side of `18:30:00Z` a moment falls on without waiting for an evening: a
`2026-B1` snapshot whose `published_at` is `2026-03-31T18:29:59Z`, whose `business_day` is
therefore `2026-03-31`, and a `2026-B2` snapshot whose `published_at` is `2026-03-31T18:30:00Z`,
whose `business_day` is therefore `2026-04-01`. Both sit on the `scale` tier, whose retention is
twelve periods, so both are inside their retention when they are seeded.

The four seeded snapshots take their department sequences from their publication order: in
`claims` the `2026-Q1` snapshot carries a `sequence` of `1` and the `2026-Q2` snapshot carries
`2`, and in `actuarial` the `2026-B1` snapshot carries a `sequence` of `1` and the `2026-B2`
snapshot carries `2`.

Seed exactly these four tier grants in `department_grants`, the fourth of them dated in the future
so a reader can prove an allowance decision reads the grant in force rather than the newest grant
on file:

| Department | Tier | Effective at |
|---|---|---|
| `claims` | `starter` | `2026-01-01T00:00:00Z` |
| `underwriting` | `team` | `2026-01-01T00:00:00Z` |
| `actuarial` | `scale` | `2026-01-01T00:00:00Z` |
| `claims` | `regulated` | `2099-01-01T00:00:00Z` |

The `claims` department therefore holds two grants, of which only the `starter` one is in force,
and every `claims` allowance and refusal reads `starter` until `2099-01-01T00:00:00Z` arrives.

The three seeded requests: an open request from `steward.underwriting@example.com` for `analyst`
on `claims`; an approved request from `editor.underwriting@example.com` for `viewer` on
`actuarial`, whose approval left that role grant; and a declined request from
`analyst.actuarial@example.com` for `analyst` on `underwriting`.

Seed one stale session, so a reader can prove a session past its lifetime is refused without
waiting twelve hours for one: a `sessions` row for `viewer.claims@example.com` whose `value` is
`keystone-stale-session-2026`, whose `created_at` is `2024-01-02T09:00:00Z` and whose `expires_at`
is `2024-01-02T21:00:00Z`, exactly twelve hours later. That row is seeded once, it is never
pruned, and the server refuses it rather than deleting it.

The seeded collections therefore hold exactly: `3` departments, `4` tiers, `8` accounts, `9` role
grants (the eight home grants in the account table plus `editor.underwriting@example.com` as
`viewer` on `actuarial` from the approved request), `4` tier grants, `5` tables, `4` snapshots,
`3` requests, `1` session (the stale one above), and no change log entry, view, subscriber,
enquiry or sign-in attempt.

## Technical requirements

### Deployment (DP-01)

- The app's source lives in `/app`. `/app/run.json` names how to install, build and serve it.
  `serve` runs a production build in the foreground, never a dev server.
- The app listens on `0.0.0.0` at the port in `APP_PUBLIC_PORT` (`4173` inside the container) and
  is reached at `APP_PUBLIC_URL`.
- The HTTP API is served on that same origin under the `/api` prefix, and `GET /api/health`
  returns `200` once the app is ready.
- The app starts with no manual steps: on every start it applies its schema and its seed without
  duplicating a row.

### Configuration and secrets

- Read `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` and `DATABASE_URL` from the environment; never hardcode
  any of them.
- The seeded accounts share the demonstration password `deku-demo-pw-2026`, which
  `/app/USER_README.md` lists.

### Server boundary (DP-21, DP-47)

- Every rule in this brief is enforced on the server. Role, lock, allowance and type are checked at
  the write boundary, and a browser-side check that is not repeated there does not count.
- Every `/console` page is served on the session cookie set at sign in, and every closed API
  address on the bearer token or that cookie.
- No external network calls at runtime beyond PostgreSQL. No real time push: another reader's
  change appears on the next read rather than arriving on its own.

### Browser support and performance (DP-40)

- Every address works in a current desktop browser and a current phone browser, and holds its own
  width from 320px to 1440px.
- The app stays responsive with a few hundred thousand rows in a table and a few thousand change
  log entries.

### Constraints

One deployment, three departments, and no account that reaches all of them. No global
administrator role. No comments, likes, shares, ratings, view counters or site search. No cart, no
payment and no invoice, and the plan matrix states allowances rather than prices. No email is sent
by this build. No file upload and no image upload, so stored megabytes are a counted allowance
rather than a measured disk. No dark theme. No infinite feed and no load-more anywhere. Two things
page, both with numbered previous and next controls and a 1-based `page`: the change log, twenty
entries at a time, and the console table page's rows, one hundred at a time (the rows endpoint's
default `per_page`, up to a maximum of 500), so a table of 250,000 rows never loads at once. Nothing
else pages. No chat widget. No native app.

## Working rules

- **IF-01.** `/app/run.json` holds string `install`, `build` and `serve` fields, and `serve` starts
  the production server in the foreground.
- **IF-02.** `/app/USER_README.md` lists the eight seeded account emails with their role,
  department and the password `deku-demo-pw-2026`.
- **IF-03.** Reserved `.browser_screenshots/` and `.downloads/` directories exist at the app root,
  empty.

## Engineering standards

- **One place for each rule.** An allowance is counted, compared and refused in one function that
  reads the tier grant rows; the plan matrix and every refusal take their figures from those rows,
  never from a literal copy.
- **One write path.** Every row amendment passes one write boundary that checks role, lock,
  allowance and type in that order before anything is written, and writes the row and its change
  log entries in one transaction.
- **One refusal shape.** Every refusal is built by one shared helper that sets the status, the
  `reason` and the `field`, so no handler hand-builds its own error body.
