# Rostara Attendance Desk

Rostara is an internal desk for fixing attendance records at Kestrel Works, an invented employer that runs on business time in `Europe/London`. Employees raise a correction when the clock recorded a day wrongly. Managers approve or reject corrections, but only for the people who report to them directly, as the HR system of record defines those reporting lines at the moment of each call. When a manager approves, the desk checks the record again and rewrites that day's attendance in the same step. People operations saves new versions of the correction policy, reads and exports the whole trail and checks that nobody has altered it, but never decides a request. A line manager sees a report's sickness only as an absence. Managers and people operations can send a read-only view of one person's month to someone without a desk account. All data is stored in postgres, and every sign-in is checked against a Keycloak realm. The desk starts, and recovers from a realm that was down at start, without being restarted.

The following are out of scope:
- self-service signup, password reset and invitations
- mail
- payroll export
- leave booking
- editing people, their contact details or reporting lines (the HR system of record owns them)
- any datastore or identity provider other than postgres and Keycloak

## Problem and users

At Kestrel Works the clock records attendance wrongly more often than anyone admits. A sign-in never registers. Someone leaves by a side door and the sign-out is missed. A day is spent at a supplier's site, or the clock never sees a whole day. A night shift gets booked to the wrong calendar day. Payroll is built from these records, so a wrong record means a wrong payslip.

A correction only counts if three things hold:
- the person who approved it was allowed to approve it at that moment;
- the record actually changed, and the change still fits the days around it;
- the change left a trail that nobody can edit, and that shows it if somebody tries.

Each of these is a rule about who may do what. Each rule has to hold when someone calls the server directly, not only when they click a button the screen chose to show them. Reporting lines move without warning: the HR system of record reassigns people and deactivates leavers, and the desk has to follow on the very next call.

Kestrel Works keeps the time of its home office. A sign-in at nine in the morning in London is nine in the morning on the payslip, whatever the season and whatever the server's clock says. Approved leave and a corrected attendance day cannot both stand for the same day. Sickness is health information. A line manager needs to know that a report was absent, not why. The HR system of record also holds each person's phone number and a private note that only people operations may read.

Payroll queries often come from outside the desk. The payroll bureau or an auditor asks to see one person's month. Instead of a screenshot, a manager or people operations sends a link that shows only that month's counts, cannot change anything, stops working after a set time, and stops working at once when it is replaced or revoked.

There are three roles. All accounts are seeded, and no one can sign up.

- **Employee.** Raises corrections against their own days. Reads and withdraws only their own requests. Cannot see anyone else's request, decide anything, change the policy, read the team calendar or share a month.
- **Manager.** Raises corrections for their own days, the same way an employee does. Also reads and decides the requests raised by their current direct reports, reads the team calendar for those reports, and shares a report's month. Never decides their own request, and never decides for anyone outside their reports.
- **People operations (role `admin`).** Reads every request, the whole trail, every person's contact details and the calendar for anyone. Saves new versions of the correction policy, exports and checks the trail, and shares anyone's month. Never approves or rejects anything: the person who sets the cap is not the person who applies it.

## Journeys

1. **Sign in.** A signed-out visitor opens a deep link into the desk, such as a filtered queue or one request, and is sent to `/login`. Nothing from any record is shown on the way.
   - They enter their work address and password and arrive at exactly the page they asked for. With no usable link to return to, they land on `/requests`, scoped to their role, with the role named in the top bar. A return link that points off the desk is ignored, and they land on `/requests`.
   - A work address typed in capitals or in full-width letters still signs them in. A look-alike address written with letters from another alphabet does not, and gets the ordinary refusal.
   - The refusal is the same whether the address is unknown, the password is wrong or the account is deactivated. After repeated refusals for one address, every attempt for that address is refused for a while with the same answer, whether or not the address exists.
   - Signing in always starts a fresh session; whatever session the browser held before is ended.
   - A session that sits unused too long, or grows too old, ends. The next thing the person does tells them so and brings them back through `/login` to the page they were on.
   - If the realm was down when the desk started, `/login` still shows the form and says that sign-in is unavailable. Sign-in starts working shortly after the realm returns.
   - Signing out from the top bar ends the session.
2. **Raise a correction.** An employee on `/requests` chooses `Raise a correction`, and a draft row opens at the head of the queue.
   - They pick the day, the correction type, the times they actually worked (in Kestrel Works time) and a reason, then press `Send for approval`. A reason full of emoji counts each emoji as one character.
   - The new request takes the draft's place as a pending row. Pressing the button twice, or resending after a dropped connection, still leaves exactly one pending request for that day.
   - When a rule refuses the raise, the draft keeps what was typed and shows which rule refused it. The rules include:
     - a time that never happened that day because the clocks went forward;
     - a day already covered by approved leave;
     - a night shift that would run past the next morning's recorded sign-in;
     - a month whose approved and waiting corrections already reach the cap.
3. **Decide.** A manager selects a pending row from a report. The detail pane fills with three things: what the clock recorded, what is claimed, and that day's leave. A sickness day reads only as an absence. The queue stays where it was.
   - The manager approves, or writes a note and rejects. The row takes its new state, and the trail gains an entry naming the manager.
   - On approval, the desk checks the claim again against the attendance as it now stands, and that day's attendance record then reads the claimed times.
   - A request the manager is not entitled to decide is refused by the server, whatever the screen showed.
   - If two tabs decide the same request at once, only one decision lands. The losing tab settles on the winner's real state rather than its own attempt.
4. **Withdraw.** The person who raised a pending request opens it and withdraws it. It reads cancelled, and that day is free to claim again. If their manager decided it first, the screen shows that decision instead.
5. **Change policy.** People operations opens `/policy`, tightens the monthly cap, and confirms in a dialog that names the next version number.
   - A screen reader hears that the policy is saving, then that the new version is in force. The footer shows the new version straight away.
   - If a colleague saved first, the save is refused and nothing is overwritten. The form keeps everything typed and names the version the colleague saved and who saved it. Saving again appends the version after that one.
   - Requests already waiting stay waiting. A manager's later approval is weighed against the policy in force at the moment of approval.
   - From the same screen, people operations downloads the whole trail as a spreadsheet file. A reason that starts like a spreadsheet formula arrives as plain text that no spreadsheet will run. The desk can show at any time whether every trail entry is still exactly as written.
6. **Find in the queue.** Any role narrows the queue by state, correction type, person or month, searches reason text, sorts and pages.
   - The address bar carries all of it. Opening a row, reloading, choosing `Desk` in the breadcrumb or pressing Back all return to exactly the same narrowed queue, with keyboard focus back on the row they came from.
   - Searching for `%` finds only reasons that contain a percent sign. Every matched request appears exactly once across the pages.
   - When the HR system of record moves a report to another manager, the old manager's very next read no longer shows that person anywhere.
7. **Read and share the month.** A manager opens `/calendar` and reads, for each business day, how many of their direct reports have:
   - an attendance day that is recorded, or one that is incomplete;
   - approved leave, or pending leave;
   - a correction waiting.

   Each count has its own mark shape and word, so the month reads the same in a high-contrast setting. The manager can narrow the month to one report. Nobody outside their reports ever counts. The counts move as soon as a report raises or withdraws, or as soon as the manager approves.

   Narrowed to one report, the manager chooses `Share this month` and copies the link it shows. Anyone opening that link sees that person's month counts and nothing else: no phone, no note, no reasons. Sharing the same month again kills the earlier link at once. The manager can revoke the link, and it also stops working by itself after a set time or once the person leaves the manager's team.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Readiness** GET /api/health answers 200 without a session only once the schema, the seed and the realm accounts are all in place, and 503 with each flag while the desk is still starting, as qualified in API.
- **DP-02 — One origin** The pages and the JSON API are served by one server on one origin, with the API under the /api prefix.
- **DP-03 — Production build** The desk is served from a production build whose every route arrives already rendered by the server, never from a development server.
- **DP-04 — Security headers** Every response carries the content-type, framing and referrer headers stated in Server boundary and no X-Powered-By header.
- **DP-05 — Real backing services** Every record lives in the postgres database named by DATABASE_URL and every sign-in is checked by the configured identity realm, with no stand-in store.
- **DP-06 — Seeded people** One employer, Kestrel Works, keeping time in Europe/London, and the sixteen seeded people with their ids, roles, reporting lines, contact details and active flags exist from first start, each work address unique in its folded form.
- **DP-07 — Seeded attendance and leave** Each person holds the seeded attendance days at their business-time punches with their nine deliberate gaps as rewritten by the seeded approvals, plus the nine seeded annual and sickness leave days, with at most one attendance row and one leave row per person per day.
- **DP-08 — Seeded corrections and policy** The nine seeded corrections carry ids 1 to 9 in seed-table order, cover all four states and carry their business-time raise and decision instants, and policy version 1 carries the stated defaults.
- **DP-09 — Seeding runs once** Restarting the desk never duplicates, alters or re-dates a seeded row.
- **DP-10 — Store invariants** The store holds one pending request per person per day, a decider and decision time on every approved or rejected request and neither on a pending or cancelled one, and a note on every rejected one.
- **DP-11 — Sign in** A person signs in with a work address and password at /login, lands on the queue scoped to their role or on the safe page they asked for, and sees that role named in the top bar.
- **DP-12 — One refusal** An unknown work address, a wrong password and a deactivated account with its correct password all receive the identical 401 sign-in refusal stated in Business rules.
- **DP-13 — Sign out** Signing out ends the session, and its token is refused afterwards with 401 and the signed-out wording.
- **DP-14 — Identity realm only** Accounts exist only as the seeded people in the identity realm, and no published route creates an account.
- **DP-15 — Signed-out redirect** A visitor with no valid session to any route in the route table other than /login and /share/<token> is redirected with 303 to /login carrying no record content, with the requested page as next as qualified in Server boundary, and the desk serves no public marketing page.
- **DP-16 — No credential in the browser** No served page or script carries a service credential, the client secret, an administrative token or a database address.
- **DP-17 — Employee refusals** An employee gets 403 for changing policy and 404 for reading, deciding or withdrawing another person's request, with the stored state unchanged.
- **DP-18 — Manager limits** A manager gets 404 for any request that is neither their own nor a current direct report's and 403 for changing policy, with the stored state unchanged.
- **DP-19 — No self decision** Deciding a request you raised is refused with 403 and the self-decision wording, whatever role you hold.
- **DP-20 — Administrator never decides** People operations is refused both approve and reject with 403, and the detail screen shows them no decision control.
- **DP-21 — Unauthenticated calls refused** Every published endpoint except POST /api/session and GET /api/health answers a caller with no valid session with 401 and the signed-out or ended-session wording from API.
- **DP-22 — Wrong role page** A signed-in person opening a route their role cannot use gets status 403 and the wrong-role wording on that route rather than a redirect.
- **DP-23 — Scope by relationship** An employee reads only their own requests, a manager only their own and their current direct reports', and people operations every request in the employer.
- **DP-24 — Scope before filters** A filter value narrows what a caller may see and never widens it, so naming a person outside scope returns no rows.
- **DP-25 — Queue counts** GET /api/requests returns rows, matched, total, page and pages together, at most twenty five rows a page, and a page beyond the last answers the last page.
- **DP-26 — Queue order** The default order puts pending first and then the oldest raised first, and sort re-orders by day, raised or person, every order ending in id ascending as stated in Business rules.
- **DP-27 — Filters and search** The queue narrows by state, correction type, person and month and searches reason text literally and without regard to case, refusing bad values and searches over 100 characters with 400.
- **DP-28 — Queue beside detail** At the widest tier a person selects a queue row and its request opens in the detail pane on the right while the queue stays on the left, for every role.
- **DP-29 — Breadcrumb trail** A breadcrumb trail opening at a Desk link sits across the top of every signed-in route and is the navigation.
- **DP-30 — Queue table** The queue is a table with the eight named columns, captioned {matched} of {total} requests, with tabular figures.
- **DP-31 — Four empty situations** Nothing raised yet, filters excluding everything, still loading and a failed read each render their own wording from Feedback states, and the failed read offers Try again.
- **DP-32 — Own not-found page** An unknown request id, a request outside the reader's scope, an unknown shared-link token and an unknown page route answer 404 with the product's own identical not-found page.
- **DP-33 — Draft row** An employee or manager opens /requests/new, fills the draft row at the head of the queue and sends it, and the new pending request appears in the queue.
- **DP-34 — Five corrections** Each of the five correction types can be raised with the claimed times its type requires and lands as pending with 201, a night shift ending on the following business day.
- **DP-35 — Raise checks** A raise is refused in the order published in Business rules, with 400 for a malformed field, 422 for a type switched off, a day outside the window or a claim that contradicts the recorded punches of that day or the days either side, and 409 for a day already pending, creating nothing.
- **DP-36 — Monthly cap** A raise is refused with 422 once the person's approved and waiting corrections in that month have reached the monthly cap, naming how many of how many are used.
- **DP-37 — Withdraw** The raiser withdraws a pending request, which frees that day, while anyone else gets 404 or 403 and a request no longer pending gets 409.
- **DP-38 — Approval writes attendance** Approving writes the claimed business times into that day's attendance record with source regularisation, a night shift's sign-out landing on the following business day.
- **DP-39 — Rejection note** A rejection needs a note of at least ten characters, stored with the rejected state, and a shorter one is refused with 400.
- **DP-40 — Decision reply** A decision answers 200 with the request in its new state, including decided_by and decided_at, and an approval needs a note only when policy says so.
- **DP-41 — Rechecks at approval** An approval re-checks the window and the cap of the policy then in force, counting approved corrections only, and the claim against the attendance as it then stands, so simultaneous approvals for one person never pass the cap or leave overlapping attendance.
- **DP-42 — Already decided** Of simultaneous decisions on one request exactly one wins, and every later or losing decision gets 409 naming who decided it and when.
- **DP-43 — Detail evidence** GET /api/requests/<id> returns request, evidence, leave and audit in one read, with the leave kind projected for the reader as in Business rules.
- **DP-44 — Decide in the browser** A manager approves or rejects from the detail pane and the row shows its new state without a page load, while a refusal other than a 409 leaves the row as it was beside the refusal wording.
- **DP-45 — Policy versions** People operations changes the policy at /policy through a confirmation naming the next version number, and the new version heads the history with every earlier version still readable.
- **DP-46 — One type stays enabled** A policy enabling no correction type is refused with 400 and no version is written.
- **DP-47 — Self approval refused** Setting manager self-approval on is refused with 400 naming self_approval_allowed, and no version records it.
- **DP-48 — Pending survives tightening** Tightening the policy leaves requests already pending still pending.
- **DP-49 — Append-only trail** Every decision, policy save, shared-link mint and shared-link revocation appends one attributed audit entry, readable by people operations, that the application's database account cannot update or delete.
- **DP-50 — Calendar API** GET /api/calendar returns per-day counts and a person lookup computed live only over the caller's current scope, with person matched by work address without regard to case and all-zero days for a person outside it.
- **DP-51 — Month grid** A manager or people operations reads the month at /calendar with each count beside its own mark shape and a legend showing the same shapes, and narrows it to one person in scope.
- **DP-52 — Focus-trapping dialogs** The filter sheet and the policy confirmation keep focus inside themselves while open, close on Escape and hand focus back to the control that opened them.
- **DP-53 — Announcements** Counts and work in progress are announced in a polite region and outcomes and refusals in an assertive one, with the copy from Feedback states.
- **DP-54 — Landmarks and headings** Every route has banner, main and contentinfo regions, every signed-in route also a navigation region, and each has exactly one first-level heading and no skipped heading levels.
- **DP-55 — Accessibility audit** The sign-in, queue, raise, detail, calendar, policy and shared-month routes report no serious or critical WCAG 2.2 AA violation at any width tier.
- **DP-56 — Narrow reflow** No route scrolls sideways at any of the three width tiers.
- **DP-57 — Own assets** Every icon is inline vector geometry, nothing is requested from another host, and exactly the two named webfont files set the reading and heading families.
- **DP-58 — Focus ring** Every focusable control shows the same ring, a white separation inside the violet accent, drawn as an outline at least 2 pixels thick rather than as a shadow alone.
- **DP-59 — Reading tone** Body copy is near-black on a near-white ground.
- **DP-60 — No idle loops** Nothing on the settled queue animates on a loop.
- **DP-61 — Reduced motion** Under a reduced-motion preference every motion becomes an instant change of state.
- **DP-62 — One violet action** The primary action named for each screen is the only thing on that screen wearing the mid, vivid violet.
- **DP-63 — State as shape, word and tone** Each request state shows as a chip carrying its word, its own glyph and its own tone.
- **DP-64 — Operational register** The queue reads as a dense operational table whose first 1280x800 screen shows the header band and at least five rows when that many are in scope, with no oversized hero or promotional banner.
- **DP-65 — Evidence blocks** The detail pane sets what the clock recorded, what is claimed and the leave that day as separately headed blocks, a missing punch reads Not recorded, and the leave block reads the label for the reader's view of its kind.
- **DP-66 — Draft row in line** The draft row's cells sit under the same column headings as the request rows beneath it.
- **DP-67 — Narrow tier** On the narrowest tier each queue row becomes a card and the approve and reject pair sticks to the bottom with approve above reject, each spanning the full width.
- **DP-68 — Every tier keeps every capability** Raising, deciding, filtering, the month view and sharing a month stay reachable at every width tier.
- **DP-69 — One-transaction decision** The checks, the re-check against the record, the state change, the attendance write and the audit append of a decision land together in one database transaction or not at all.
- **DP-70 — Delegated identity** Passwords are checked only by the identity realm, and the desk keeps no password or password hash of its own.
- **DP-71 — Status ladder** Every refusal answers the published status for its kind, from 400 to 429, with a JSON error wording, and the first failing step of the published order decides the answer.
- **DP-72 — Published fields only** A body field an endpoint does not publish is refused with 400 naming that field, and nothing is created, decided, versioned or shared.
- **DP-73 — API surface** An unknown path under /api/ answers a JSON 404 and a published path with an unpublished method answers a JSON 405 with an Allow header listing that path's published methods.
- **DP-74 — Sign-in lockout** Five refused sign-ins for one work address in its folded form within the window lock that address for the lockout period with an identical 429 and Retry-After, whether the address is known, unknown or deactivated.
- **DP-75 — Exact first state** A freshly seeded desk holds exactly the published people, realm accounts, requests, attendance rows, leave rows, one policy version, six chained trail entries, no shared links and no sign-in attempts.
- **DP-76 — Queue state in the URL** The queue's filters, search, sort and page live in a canonical query string carried through row selection, the Desk breadcrumb, reload and Back.
- **DP-77 — One raise per send** A repeated send by the same person with the same Idempotency-Key and the same values answers 200 with the request as it now stands and Idempotent-Replayed: true, creating nothing, and simultaneous raises for one day create exactly one request.
- **DP-78 — Business time** Every day the desk stores, filters, counts or checks is a Kestrel Works business date in Europe/London, claimed and shown times are business wall-clock times, and API timestamps are the matching UTC instants.
- **DP-79 — Daylight-saving claims** A claimed time that does not occur on its business day is refused with 422 naming the field, a time that occurs twice takes the earlier instant, and claims are compared with recorded punches as instants.
- **DP-80 — Return after sign-in** After signing in, a person lands on the page named by a safe next, and an unsafe next is ignored and never echoed, landing them on /requests.
- **DP-81 — Hostile values** Malformed or overflowing request ids answer the unknown-id 404, NUL characters and malformed or over-deep JSON answer their named 400, and no answer ever carries a stack, SQL or driver message.
- **DP-82 — Stable paging** Every queue order is total, so walking every page under any sort yields each matched request exactly once, and a malformed page value is refused with 400.
- **DP-83 — Focus round trip** The state chips move with arrows, Home and End, opening a request focuses its pane heading, and returning through Desk or Back focuses the originating row's link, as qualified in Interactions.
- **DP-84 — Policy precondition** A policy save must send If-Match with the version in force, answering 428 when it is missing and 412 when it is stale, so of simultaneous saves on one version exactly one lands and version numbers stay contiguous.
- **DP-85 — Policy announcements** Saving policy is announced politely while in flight, then the new version or the refusal assertively, a refused field is marked invalid, described by the refusal and focused, and the footer shows the new version without a reload.
- **DP-86 — Live calendar counts** Calendar counts are read live and move on the corrected business day as soon as a report raises, is approved or withdraws, and each person's waiting total for a month equals that person's pending queue count for the month.
- **DP-87 — Leave blocks a raise** A raise for a day on which the raiser has approved leave is refused with 422 at its published step, while pending leave does not block.
- **DP-88 — One seeder** Two desk instances started together against one empty database produce the exact first state once, with a single seeded_on, and both become ready without a server error.
- **DP-89 — Late realm** A desk started while the realm is unreachable serves /login, answers sign-in with the 503 wording, and lets people sign in within 15 seconds of the realm returning, with no restart.
- **DP-90 — Session expiry** A session ends once SESSION_IDLE_SECONDS pass without use or SESSION_MAX_SECONDS pass since sign-in, and the next call answers 401 with the ended-session wording while the next page sends the person through sign-in back to itself.
- **DP-91 — Sickness shown as absence** A manager reading a report's request sees a sickness leave day only as absence in every answer body, page and script, while the raiser and people operations see the true kind.
- **DP-92 — Live reporting lines** Role, reporting line and active flag are read from the person rows on every call, so a change made by the HR system of record applies on the next call and a deactivated person's open session ends.
- **DP-93 — Conflict settles on the winner** Nothing in the queue or pane changes state before the server answers, and a decision or withdrawal answered with 409 re-reads and shows the winner's real state beside the 409 wording, without a page load.
- **DP-94 — Policy save after a colleague** After a 412 the policy form keeps every typed value, names the version that landed and who saved it, and the next save knowingly appends the version after it.
- **DP-95 — Forced colours** Calendar marks, out-of-month days, focus rings, the selected row edge and state chips stay distinguishable by shape and word, including under a forced-colours setting.
- **DP-96 — Shared month links** A manager for a current direct report, or people operations for any active person, mints a read-only month link whose token answers 200 while live, 410 once expired, revoked, replaced or out of the minter's scope, 404 when unknown and 403 to any write, with mints throttled per minter, as qualified in Business rules.
- **DP-97 — Session rotation and folded addresses** Every sign-in issues a new session identifier and ends the session the request presented, and work addresses match for sign-in, uniqueness and lockout in their folded form while a look-alike from another script gets the identical refusal.
- **DP-98 — Private fields and input limits** A person's phone and private note reach only people operations' request detail and no other answer, page, script, shared month or export, a reason is limited to 280 grapheme clusters with 281 refused 422 naming reason, and a body over 65,536 bytes answers 413.
- **DP-99 — Trail export and chain** People operations downloads the trail as CSV with formula-leading cells neutralised before quoting and the published framing, and every entry carries a stored hash chain that GET /api/trail/verify checks, naming the lowest broken entry.

## Frontend

### Screens and layout (DP-28, DP-29, DP-30, DP-33, DP-51, DP-54, DP-56, DP-64, DP-65, DP-66, DP-67, DP-68, DP-96)

**Routes.** A role that opens a route it cannot use gets the wrong-role page from Feedback states. Which routes a person may use is decided by their role as it stands at that request.

| Route | Who reaches it | What it is for |
|---|---|---|
| `/` | anyone | redirects to `/requests` when signed in, otherwise to `/login` |
| `/login` | anyone | signed out: the sign-in form; signed in: a redirect, as in Server boundary |
| `/requests` | every role | the queue, with the detail pane empty until a row is selected |
| `/requests/<id>` | anyone whose scope includes that request | the queue beside one request in full, where a manager decides it |
| `/requests/new` | employee, manager | the queue with one draft row at its head |
| `/calendar` | manager, people operations | the month grid, and sharing one person's month |
| `/policy` | people operations | the policy form, its version history, the whole trail and its download |
| `/share/<token>` | anyone holding the link, with or without a session | one person's month, read-only |

The desk is the whole product. There is no marketing page, pricing page, help centre or assistant.

**Chrome.** On every signed-in route, a top bar spans the full width and stays fixed while the page scrolls under it. From left to right it holds:
- the brand mark;
- the breadcrumb trail;
- on the right, the signed-in person's initials in a soft disc with their role line beneath;
- `Sign out`.

The breadcrumb trail is the only navigation, and it always has at least two steps. The first step is the `Desk` link. The last is the current screen's name, not linked:
- `Regularisation requests` on `/requests`;
- `Correction for {day}` on a request;
- `Raise a correction` on `/requests/new`;
- `Team calendar` on `/calendar`;
- `Correction policy` on `/policy`.

A right chevron separates the steps. There is no side rail.

A single quiet footer line at the bottom of the document shows the product name and the policy version in force. The footer scrolls with the page. It is read on each page load and again after a policy save or a refused stale save, as Feedback states describes.

**The queue.** The queue is a real table with:
- a caption;
- a header row on a sunk band;
- rows of one height with generous cell padding.

The columns, in order, are `State`, `Person`, `Day`, `Correction`, `Claimed`, `Recorded` and `Raised`, then `Action`.

Above the table sit the state chip group, the reason search, the sort selector and `Filters`. Employees and managers also see `Raise a correction` there.

Each row carries a wash that agrees with its state:
- warm near-white for waiting;
- pale green-tinted near-white for approved;
- the page's own near-white for rejected;
- a slightly sunk near-white for cancelled.

Hovering a row lifts its surface tone one step. The row does not move, grow or gain a shadow. The selected row also has a solid violet-indigo edge on its leading side, at least 3 pixels thick, so selection never depends on tone alone. A row's expand control opens the reason and that request's trail in place beneath it, and only one row is open at a time. Below the table, the pager reads the current page of how many.

On `/requests` the queue heading is the page's first-level heading. On `/requests/<id>` and `/requests/new` the queue heading drops to second level, and the pane's or the draft's heading is first level.

**The detail pane.** On `/requests/<id>` the pane to the right of the queue holds, in order:
1. the state chip and the day being corrected;
2. the line naming who raised it and their manager;
3. for people operations only, the raiser's `Contact on file` block with their phone and private note;
4. the evidence, as three separately headed blocks: what the clock recorded, what is claimed, and the leave on that day;
5. the reason in full;
6. the decision controls, but only when the viewer may decide; or `Withdraw` when the viewer raised the request and it is pending;
7. the trail for that request.

A missing punch reads `Not recorded`, never a blank. When the claim and the record disagree, the pane says which punch differs. A night shift's claimed sign-out shows with its date, as `{HH:MM} on {next day}`.

The leave block shows the reader's label for the kind, `Annual leave`, `Sickness` or `Absence`, followed by `, approved` or `, pending`. Which label a reader gets is set by the projection rule in Business rules. With no leave that day the block reads `No leave recorded`.

Pane prose (the reason and the trail) is set one step larger than a table row. A reason keeps its line breaks.

**The draft row.** `/requests/new` is the queue with one draft row at its head. Its cells sit under the same column headings as the rows beneath it:
- the day field in the Day column;
- the correction type in the Correction column;
- the claimed times in the Claimed column;
- the reason in a full-width cell beneath the row.

Which time cells show depends on the type chosen in that row.

**The month grid.** `/calendar` shows the month name with links to the previous and next month above it. Below sits a seven-column grid of weekdays with as many rows as the month needs.

- **In-month cells.** Each shows its day number. For each of the five counts that is above zero, it also shows that count's mark with the number beside it.
- **Out-of-month cells.** Leading and trailing cells from the neighbouring months show the day and the short month name, `{d} {Mon}` (for example `31 Mar`), in a receding tone, and carry no marks.
- **Marks.** Each mark is its own shape from the icon set, as listed in Visual design, as well as a tone.
- **Legend.** A legend beneath the grid draws each of the five shapes exactly as it appears in the cells, beside its name in words.
- **Narrowing.** Above the grid, a person selector and `Show` narrow the grid to one person in scope.
- **Sharing.** While the grid is narrowed to one person, a `Share this month` button sits beside `Show`. After a mint, a read-only `Shared link` field holding the full link and a `Revoke link` button appear beneath it.

**The policy screen.** `/policy` shows the policy form, grouped by what each field governs:
- the cap and the lookback;
- the enabled correction types;
- the note requirement;
- the self-approval switch, shown off and unavailable.

After a stale save, the colleague callout from Feedback states sits directly under the heading. Beneath the form sits the version history as a table, newest first. Below that, the whole trail is shown as a list, newest first, with a `Download trail` link at its head.

**The shared month.** `/share/<token>` is a standalone page with no breadcrumb, no sign-out and no desk chrome beyond a banner holding the brand mark. It shows:
- the heading `{name}, {Month name} {year}`;
- the same month grid and legend as `/calendar`, narrowed to that one person, with no person selector, month links or sharing controls;
- a footer reading `Rostara attendance desk. Shared read-only.`

It shows the person's name and their month counts and nothing else about them: no work address, phone, private note, reason, note or leave kind. The page for a link that no longer works is described in Feedback states.

**Width tiers.** There are exactly three tiers:

| Tier | Width | Layout |
|---|---|---|
| Widest | from 1024 pixels | The queue and the detail pane sit side by side. |
| Middle | 640 to 1023 pixels | The pane keeps its place beside the queue. The `Correction` and `Claimed` columns leave the table first, then `Raised` and `Recorded`. The breadcrumb collapses to its last two steps. |
| Narrowest | below 640 pixels | Each row becomes a card. Its first line carries the state chip and the person, with the day, claim and record stacked beneath. Selecting a card opens the request as its own screen. The approve and reject pair sticks to the bottom of the window, approve above reject, each spanning the full width. The month grid and the shared month shrink their cells and stack each cell's marks one under another. |

A card and a row carry the same facts. Raising, deciding, filtering, the month view and sharing a month work at every tier, and no tier scrolls sideways.

**Structure.** Every route has banner, main and contentinfo landmarks, and every signed-in route also has the breadcrumb navigation landmark. Each route has exactly one first-level heading and no skipped heading levels. Every input has a real associated label, and placeholder text is never used as a label. A required field says so in text. A validation message is tied to its field so it is read with it. The password field carries the autocomplete hint `current-password`. Its value is never trimmed, echoed or logged.

**Scroll and page state.** The page scrolls as one document. Returning to the queue from a request restores the queue's scroll position. A filter change resets the scroll to the top.

Exactly five things are kept only in the browser:
- which row is expanded;
- whether the filter sheet is open;
- what has been typed into an open draft row or the policy form, together with the policy version that form is changing;
- the shared link just minted on `/calendar`, until the page is left or the link is revoked;
- the current announcement.

Everything else is reproduced from the URL by a full reload.

### Public screens and controls (DP-11, DP-29, DP-30, DP-33, DP-44, DP-45, DP-51, DP-52, DP-76, DP-83, DP-85, DP-90, DP-94, DP-96, DP-99)

These are the only public names. Visible copy is used exactly as written. A name in braces is filled in when the page is drawn.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| brand mark | text in banner | `Rostara` |
| role line | text in banner | `Employee`, `Manager` or `People operations` |
| sign out | button `Sign out` | `Sign out` |
| breadcrumb | navigation `Breadcrumb` holding link `Desk` | `Desk` then the screen name from Screens and layout |
| footer | contentinfo | `Rostara attendance desk. Policy version {version}.` |
| sign-in heading | heading level 1 | `Sign in to Rostara` |
| work address | textbox `Work address` | `Work address` |
| password | password field labelled `Password` | `Password` |
| sign in | button `Sign in` | `Sign in` |
| queue heading | heading | `Regularisation requests` |
| queue | table with caption | `{matched} of {total} requests` |
| column headings | columnheader | `State`, `Person`, `Day`, `Correction`, `Claimed`, `Recorded`, `Raised`, `Action` |
| state chips | radiogroup `Request state` with radios `All`, `Pending`, `Approved`, `Rejected`, `Cancelled` | the same words |
| search | searchbox `Search reasons` | `Search reasons` |
| sort | combobox `Sort` with options `Waiting first`, `Day, newest first`, `Raised, oldest first`, `Person, A to Z` | the same words |
| filter opener | button `Filters` | `Filters` |
| filter sheet | dialog `Narrow the queue` | heading `Narrow the queue` |
| correction filter | combobox `Correction`, first option `Any correction`, then the five type labels | |
| person filter (manager, people operations) | combobox `Person`, first option `Anyone in scope`, then names in the caller's current scope | |
| month filter | textbox `Month` | help `Year and month, for example 2026-10` |
| sheet actions | buttons `Apply filters`, `Clear filters`, `Close` | the same words |
| raise | link `Raise a correction` | `Raise a correction` |
| row open | link `Open request {id}` | the person's name |
| row expand | button `Show details for request {id}`, expanded state exposed | chevron |
| pager | navigation `Pages` with links `Previous page`, `Next page` | `Page {page} of {pages}` |
| detail heading | heading | `Correction for {day}` |
| raised by | text | `Raised by {person}, reporting to {manager}` |
| contact (people operations only) | heading `Contact on file`, then text | `Phone {phone}` and the private note on its own line |
| evidence headings | headings | `What the clock recorded`, `What is claimed`, `Leave that day` |
| missing punch | text | `Not recorded` |
| leave label | text in the `Leave that day` block | `Annual leave`, `Sickness` or `Absence`, then `, approved` or `, pending`; or `No leave recorded` |
| reason heading | heading | `Reason given` |
| trail heading | heading | `What happened` |
| note | textbox `Note` | help `Required when rejecting. At least ten characters.` |
| decide | buttons `Approve`, `Reject` | `Approve`, `Reject` |
| withdraw | button `Withdraw` | `Withdraw` |
| ended-session link | link `Sign in again` beside the refused control | `Sign in again` |
| draft heading | heading | `Raise a correction` |
| day | date field `Day to correct` | `Day to correct` |
| type | combobox `Correction type` | options `Sign in was not recorded`, `Sign out was not recorded`, `Worked away from the workplace`, `Whole day worked but not recorded`, `Night shift recorded against the wrong day` |
| claimed times | time fields `Claimed sign in`, `Claimed sign out` | sign-out help for a night shift: `Ends the following day.` |
| reason | textbox `Reason` | help `Twenty to 280 characters. Each emoji counts as one. Your manager reads this.` |
| send | button `Send for approval` | `Send for approval` |
| discard | link `Discard draft` | `Discard draft` |
| calendar heading | heading | `Team calendar` |
| month steps | links `Previous month`, `Next month` | the same words |
| month grid | table captioned `{Month name} {year}` | for example `October 2026` |
| calendar person | combobox `Person`, first option `Everyone in scope` | |
| show | button `Show` | `Show` |
| share | button `Share this month`, present only while narrowed to one person | `Share this month` |
| shared link | read-only textbox `Shared link` | `{APP_PUBLIC_URL}/share/{token}` |
| revoke | button `Revoke link` | `Revoke link` |
| day marks | text in each in-month cell, `{mark}: {count}`, beside its glyph | marks `Attendance recorded`, `Attendance incomplete`, `Leave approved`, `Leave pending`, `Correction waiting` |
| out-of-month day | text in the cell | `{d} {Mon}` |
| legend | heading | `What the marks mean` |
| policy heading | heading | `Correction policy` |
| colleague callout | text directly under the policy heading | the callout from Feedback states |
| cap | spinbutton `Corrections allowed per person each month` | |
| lookback | spinbutton `How many days back a correction may reach` | |
| enabled types | group `Corrections people may raise` with one checkbox per type label | |
| note rule | checkbox `Require a note when approving` | |
| self approval | switch `Allow managers to approve their own corrections`, off and disabled | help `Not available. Self approval is refused by this product.` |
| save | button `Save new version` | `Save new version` |
| confirm | dialog `Save this policy?` with buttons `Save` and `Keep editing` | `This appends version {version}. Requests already waiting stay waiting.` |
| history | heading | `Previous versions` |
| whole trail | heading | `Whole trail` |
| trail download | link `Download trail` to `/api/trail.csv` | `Download trail` |
| shared month heading | heading level 1 on `/share/<token>` | `{name}, {Month name} {year}` |
| shared month footer | contentinfo on `/share/<token>` | `Rostara attendance desk. Shared read-only.` |
| polite region | status | counts, page changes, work in progress, sign-in page notices |
| assertive region | alert | outcomes, refusals, validation summary |

`{day}`, `{next day}` and `{previous day}` read `YYYY-MM-DD`. `{d}` is the day of the month without a leading zero, and `{Mon}` is the three-letter English month name. Times read `HH:MM` in Kestrel Works time (Europe/London). In the confirmation, `{version}` is one more than the version the form is changing. `{expires}` is the link's expiry as a business date and time, `YYYY-MM-DD HH:MM`.

### Interactions (DP-28, DP-44, DP-52, DP-76, DP-77, DP-80, DP-83, DP-85, DP-90, DP-93, DP-94, DP-96)

**Changing the queue.**
- These actions load the queue for the new query, written in the canonical form from Business rules:
  - choosing a state chip;
  - applying the sheet;
  - pressing Enter in `Search reasons`;
  - choosing a `Sort` option;
  - following a pager link.
- A filter, search or sort change returns to page 1.
- Each of these replaces the current history entry, so Back does not step through each change.

**Selecting a row and coming back.**
- Selecting a row pushes `/requests/<id>?<the queue's canonical query>`.
- The pane fills, and the queue beside it stays narrowed, sorted and paged exactly as before.
- On every route that carries a queue query, `Desk` links to `/requests?<that query>`. Elsewhere it links to `/requests`.
- Reloading either URL reproduces all of these from the URL alone:
  - the checked chip;
  - the search text;
  - the sort;
  - the sheet's chosen values;
  - the caption;
  - the pager.
- Back from a request returns to the same filtered queue, with the queue's scroll position restored.

**Keyboard.**
- The state chips are one tab stop.
  - Arrow Right and Arrow Down move focus to the next chip. Arrow Left and Arrow Up move it to the previous chip. Both wrap around at the ends.
  - Home moves focus to `All` and End moves it to `Cancelled`.
  - Moving focus does not change the queue. Space or Enter applies the focused chip.
- Opening a row, by keyboard or pointer, puts focus on the pane heading `Correction for {day}`.
- Returning to the queue from `/requests/<id>?<query>`:
  - Following `Desk`, or pressing Back, lands on `/requests?<query>`.
  - Focus goes to that row's `Open request {id}` link when the row is on the shown page. Otherwise it goes to the queue heading.
  - On the narrowest tier, Back from a request's own screen focuses that card's `Open request {id}` link.
- Following a pager link puts focus on the queue heading. The polite region then says `Page {page} of {pages}`.
- `Filters` opens the sheet with focus on its first control.
  - While the sheet is open, Tab and Shift+Tab cycle inside it and never reach the page behind.
  - Escape or `Close` shuts the sheet and returns focus to `Filters`.
- The policy confirmation dialog works the same way. Escape or `Keep editing` shuts it and returns focus to `Save new version`.
- The row expand control toggles with Enter or Space. Opening one row closes any other.
- The whole desk is operable by keyboard alone, in reading order.

**Signing in.**
- `/login` keeps a safe `next` from its own address. After a successful sign-in it navigates there, or to `/requests` when there is none.
- What makes a `next` safe is defined in Server boundary.

**The draft row.**
- Each cell is checked as it is left, and the whole row is checked again on send.
- The reason box never caps or cuts what can be typed. Its length is judged by the server, which counts grapheme clusters as in Business rules.
- The first invalid field takes focus, and the validation summary is announced.
- When the row opens, the browser mints one key for that draft. Every send from that draft carries it in the `Idempotency-Key` header, so a double press or a resend after a dropped answer makes one request.
- `Send for approval` is unavailable while a send is in flight.
- Choosing `Night shift recorded against the wrong day` shows the next-day help beside the sign-out cell.

**Deciding and withdrawing.**
- `Approve` sends the decision with any note. `Reject` sends it with the note. `Withdraw` sends the cancel.
- Nothing changes state before the server answers. While a decision or withdrawal is in flight, the row's and pane's chips still read the previous state, and `Approve`, `Reject` and `Withdraw` are unavailable.
- **On success,** the row and the pane take the request's new state without a page load, and focus moves to the pane heading.
- **On a 409,** without a page load:
  - the alert carries the 409 wording;
  - the request and the queue are read again;
  - the row and the pane take the server's state: chip, glyph, wash, `decided_by` and the trail;
  - the decision controls and `Withdraw` leave the pane;
  - the caption, the pager and the polite region update;
  - focus moves to the pane heading.
- **On any other refusal** (400, 401, 403, 404, 422 or a 5xx), the row and the pane stay exactly as they were, the typed note stays, and the refusal shows beside the controls.
- **After any decision, withdrawal or 409,** the caption and the pager are read again so the counts stay true.

**Sharing a month.**
- `Share this month` mints a link for the person and month the grid is showing. It is unavailable while the mint is in flight.
- On success, the `Shared link` field appears holding the full link, with its text selected and focus on it, and `Revoke link` appears beside it. A second `Share this month` replaces the field's link with the new one.
- `Revoke link` revokes the link in the field. On success the field and `Revoke link` leave the page and focus returns to `Share this month`.
- Changing the person or month in the grid clears the field.

**An ended session in the browser.** When a raise, decision, withdrawal, policy save, mint or revocation is refused with the ended-session wording:
- the wording shows as an alert beside that control, with the link `Sign in again` to `/login?next=<the current path and query, encoded as in Server boundary>`;
- every typed draft and form value stays where it was.

**The policy form.**
- The form remembers the version it is changing, and sends it as `If-Match`.
- `Save new version` opens the confirmation dialog, which names the next version. `Save` sends the form exactly as filled; the browser does not pre-check policy fields.
- The dialog closes as soon as an answer arrives. What follows is set out in Feedback states.
- After a 412, the form adopts the version now in force as the version it is changing. So the next `Save new version` names the version after that one, and `Save` lands it with the typed values.
- `Download trail` is an ordinary link; the browser saves the file the server sends.

### Visual design (DP-57, DP-58, DP-59, DP-62, DP-63, DP-64, DP-95)

The north star is comprehension. A decider should be able to tell quickly and correctly whether a claim fits what the clock recorded.

**Register.** The desk is operational: quiet surfaces and dense, organised rows, built for scanning and repeated action. There is no hero and no promotional banner. At 1280x800 the first screen of `/requests` shows the table's header band and at least five rows beneath it, whenever that many are in scope.

**Colour roles.**
- **Page and text.** The page ground is a near-white neutral, with near-black body copy on it.
- **Edges and bands.** Hairline edges are a pale neutral, just darker than the ground. The top bar is a near-black cool neutral with near-white text. Table header bands are a slightly darker near-white than the ground.
- **Quieter text.** Secondary lines are a deep neutral. Helper text, timestamps, out-of-month day labels and the dash for an absent value use a declared third tone that still clears text contrast.
- **Primary violet.** One mid, vivid violet belongs to each screen's single primary action. It is the only thing on that screen wearing that violet, and it darkens on press rather than changing hue. The primary actions are:
  - `Raise a correction` on `/requests`, for employees and managers (people operations' queue has none);
  - `Approve` on a request a manager may decide;
  - `Send for approval` on `/requests/new`;
  - `Save new version` on `/policy`;
  - `Show` on `/calendar` (`Share this month` and `Revoke link` are outlined secondary buttons);
  - `Sign in` on `/login`.

  The shared month has no primary action.
- **Indigo.** A deep, soft indigo is used for the brand mark and the selected row's edge.
- **Pale violet.** A pale, soft violet appears only as a decorative edge, never carrying text or meaning.
- **Brand wash.** The lightest brand wash sits behind the selected row, an info callout (the colleague callout included), the `Contact on file` block and a badge, and nowhere else.
- **Cyan.** A deep, vivid cyan, dark enough to clear text contrast, is the trail and information tone. It is used for timestamps and trail entries, never for anything clickable.

**State chips.** Each state has its own tone and shape, with the glyph inside the chip beside the word. Every chip has a visible edge line around it as well as its fill:

| State | Chip | Glyph |
|---|---|---|
| pending | a light, vivid orange fill with near-black text | a horizontal bar |
| approved | a light, soft teal chip with deep green text | a tick |
| rejected | a deep, vivid red fill with white text | a cross |
| cancelled | a near-white neutral chip with deep neutral text | a diagonal slash |

The state stays readable as a shape, a word or a tone, even if any one of the three is lost.

**Calendar marks.** Each of the five counts has its own glyph geometry, and no two counts share a shape:

| Mark | Glyph |
|---|---|
| `Attendance recorded` | check |
| `Attendance incomplete` | clock |
| `Leave approved` | calendar |
| `Leave pending` | bar |
| `Correction waiting` | bell |

The legend glyph for each mark is the same geometry as its cell glyph, on `/calendar` and on the shared month alike.

**Focus.** Every focusable thing shows the same ring: a white separation with the violet accent outside it, readable on both pale and dark surfaces. The ring is drawn as a real outline line at least 2 pixels thick, never only as a shadow, so it survives settings that strip shadows.

**Forced colours.** Under a forced-colours (high contrast) setting:
- the focus ring stays visible as that outline;
- the selected row keeps its solid leading edge of at least 3 pixels;
- every chip keeps its visible edge line;
- every glyph, in chips, marks and legend, stays painted in the forced text colour;
- out-of-month days stay told apart by their `{d} {Mon}` wording.

**Type.** Two families, both served from the desk's own origin:
- **Open Sans**, a humanist sans, sets everything people read:
  - body text at an ordinary reading size;
  - table rows at the same size on a tighter line;
  - pane prose one step larger;
  - captions about three quarters of body size.
- **Poppins semibold**, a geometric sans, sets the headings:
  - the page heading at a little over twice body size;
  - screen and panel headings at about one and a half and one and a quarter times body size;
  - a single number that is the whole message at about three times body size.

Figures in the queue, the grid and the trail are tabular, so times and counts line up digit under digit. The `Shared link` field sets the link in the reading face at body size and wraps rather than overflowing.

**Icons.**
- Every icon is inline vector geometry on one square canvas, drawn with one shared stroke weight, round ends and joins, and no fill. Each icon is stroked in the colour of the text beside it.
- There is no icon font, no sprite and no image request.
- The set is: clock, calendar, check, cross, bar, slash, chevron down, chevron right, search (a lens), filter (three narrowing strokes), user, shield (for policy), bell (for announcements and waiting corrections), exit (for sign out), plus (for raise), link (for sharing) and download (for the trail file).
- The brand mark is a letter-spaced wordmark in the heading face, with no symbol.
- An empty state shows the relevant glyph enlarged in a muted tone, never a drawing.
- Every icon-only control has an accessible name, and every meaningful glyph has text naming what it means.

**Surface.**
- **Spacing.** All spacing comes from one ramp.
- **Corners.** Chips and buttons are full pills. Panels take one generous corner and inputs a smaller one. Nothing has a sharp square corner, and nothing is rounder than a pill.
- **Separation.** This is a hairline product: things are separated by a hairline edge, a tone step or space. Only the open sheet, the confirmation dialog and the toast float on a soft shadow.
- **No imagery.** There are no raster images, textures or gradients.

**Contrast and targets.** WCAG 2.2 AA holds throughout:
- text clears 4.5 to 1 against whatever sits behind it;
- glyphs, state shapes, chip edges and the focus ring clear 3 to 1;
- touch targets are at least 44 by 44 pixels, and no two touch.

### Motion and effects (DP-60, DP-61)

Motion only says that something changed. There are three speeds:
- a press or hover answers in about a tenth of a second;
- a row or pane changing state takes about a fifth of a second, leaving quickly and arriving slowly;
- something arriving on screen takes under a third of a second and settles with the slightest overshoot.

**Signature moment: a decided row settles.** When the server reports a request's new state, over about a fifth of a second:
- the pending row's warm wash shifts to its new state's wash;
- the chip cross-fades from the bar and `pending` to the new state's glyph and word.

This plays the same way for the person's own successful decision and for a winner's state shown after a 409. It never plays before the server answers. The row itself does not move or resize, and the selected edge stays. The moment is time-based and plays once. It never replays when the reader scrolls back over the row.

**Other named moments, and only these:**
- The detail pane's contents fade out and the next request's contents fade in, in under a quarter of a second.
- The filter sheet slides up from the bottom edge on the narrowest tier and in from the right edge on the wider tiers, in about a quarter of a second. It leaves a little faster.
- A validation message fades in under its field.
- The row chevron turns a quarter circle as the row opens.
- The `Shared link` field fades in under `Share this month` in under a quarter of a second.
- The toast slides down a short way and fades in. It stays about six seconds unless hovered or focused, then fades out.
- The busy arc spins with an uneven, accelerating rhythm, and only while a read or send is actually in flight.

Nothing animates on a loop while the desk is idle. Nothing moves because the page scrolled. There is no carousel. The shared month has no motion at all.

**Reduced motion.** Under a reduced-motion preference, each moment above becomes an instant change of state:
- the row wash and the chip swap at once;
- the pane, sheet, shared-link field, toast and messages appear and disappear without movement or fading;
- the chevron jumps to its open angle;
- the busy arc is shown still beside its text.

### Feedback states (DP-22, DP-31, DP-32, DP-44, DP-53, DP-85, DP-90, DP-93, DP-94, DP-96)

**Live regions.** There are two:
- The polite `status` region carries counts, caption and pager changes, the page announcement from Interactions, the sign-in page notices and every pending line below.
- The assertive `alert` region carries outcomes, refusals and the validation summary.

A new message replaces the old one rather than stacking. The visible toast mirrors whichever message was announced last and has its own dismiss control. Wherever a refusal is shown, its text is the API's `error` wording.

| Action | Pending (status) | Success | Field or rule refusal | No answer, or a 5xx |
|---|---|---|---|---|
| Sign in | button reads `Signing in`; status `Signing in` | lands on the safe `next` or `/requests` | the API wording, the 503 included, as an alert above the form; fields keep their values except the password, which is cleared | the API's 500 wording if one came back, otherwise `The desk could not reach the server. Try again.` |
| Send for approval | `Sending for approval` | the draft becomes the new pending row; alert `Correction for {day} is waiting for a decision.` | the draft stays as typed, the alert names the rule, and a refusal carrying `field` puts focus on that cell with the wording under it | `The desk could not reach the server. Try again.` and the draft stays as typed |
| Approve or Reject | `Saving decision` | `Correction approved. The attendance record for {day} now reads the claimed times.` or `Correction rejected.` | 409: the reconciliation from Interactions; any other refusal: the row is unchanged and the wording appears as an alert beside the decision controls | the same generic wording, beside the controls |
| Withdraw | `Withdrawing request` | `Request withdrawn. That day is free to claim again.` | 409: the reconciliation from Interactions; any other refusal: alert beside `Withdraw` | the same generic wording |
| Save new version | `Saving policy` | alert `Policy version {version} is now in force.`; the footer, history and trail re-read without a page load; focus returns to `Save new version` | 400: the named field is marked invalid, described by the wording and focused, and the alert carries the wording; 412: the stale-save recovery below; 428: the alert carries the wording, the form keeps its values and focus returns to `Save new version` | the same generic wording, and the form keeps its values |
| Share this month | `Creating shared link` | alert `Shared link created. It works until {expires}. Any earlier link for this month no longer works.` | the alert carries the wording, the 429 included, and any shown link stays | the same generic wording |
| Revoke link | `Revoking link` | alert `Shared link revoked.` | the alert carries the wording, and a 409 also clears the field | the same generic wording |
| Queue count re-read | `Loading requests` | caption and pager update | not applicable | the table panel shows `The queue could not be loaded. Try again.` with button `Try again`, which reloads the route |

An ended-session refusal of any action in this table is shown as Interactions describes.

**Stale-save recovery (412).** Without a page load:
- the alert carries the 412 wording;
- the footer, the history and the trail are read again;
- every typed value stays in the form;
- the callout under the heading reads `Version {n} was saved by {name}. Your changes are still in the form.` Here `{n}` is the version now in force and `{name}` is its `created_by`;
- focus returns to `Save new version`.

The callout stays until the next save attempt.

**Marking a refused policy field.** When a policy save is refused with a `field`:
- The field's control gets `aria-invalid="true"` and an `aria-describedby` pointing at visible text holding the API wording.
- For `enabled_types`, the `Corrections people may raise` group and each of its checkboxes are marked this way, and the first checkbox takes focus.
- The marking clears on the next save attempt.

**Re-reading the queue.** Once the server-drawn queue becomes live in the browser, it re-reads `GET /api/requests` with the page's own query. It reads again after any decision, withdrawal or 409 from the pane.

**Draft row checks in the browser.**
- An empty required cell: `This is required.`
- A short reason: `This needs at least {count} characters.`
- The summary: `Fields needing attention: {count}.`

**Empty situations.** Four empty situations never share one blank panel:

| Situation | What shows |
|---|---|
| Nothing raised yet, as an employee | `You have not raised a correction yet.` |
| Nothing raised yet, as a manager | `Nothing is waiting on you. Your reports have no open requests.` |
| Nothing raised yet, as people operations | `No corrections have been raised in this company yet.` |
| Filters exclude everything | `No requests match these filters. Clear them to see the full queue.` with link `Clear filters` |
| Still loading | `Loading requests` |
| Read failed | `The queue could not be loaded. Try again.` with button `Try again` |

**Page answers.**
- **Not found (404).** An unknown route, an unknown or malformed request id, a request outside the reader's scope, and an unknown or malformed shared-link token all get the same page: heading `That page does not exist` and body `The link may be out of date. Go back to the desk.`
  - A signed-in reader of a desk route also gets the desk chrome and the breadcrumb.
  - A signed-out reader of a path outside the route table, and anyone opening an unknown shared-link token, gets the same heading and body with no breadcrumb and no record content.
  - The markup is identical for an out-of-scope id and an unknown one.
- **Shared month no longer available (410).** `/share/<token>` for a link that is expired, revoked, replaced or out of its minter's scope answers 410 with the shared-month banner, heading `This shared month is no longer available` and body `Ask the person who shared it for a new link.` The page is identical for all four causes and names no person.
- **Wrong role (403).** The route itself answers 403, with the desk chrome and `Your role does not have access to this page.`
- **Bad query value (400).** A queue or request route whose query holds a value the queue does not accept answers 400, with the desk chrome, `That filter is not one the queue understands.` and link `Clear filters` to `/requests`.
- **Sign-in page notices.** These show in the status region of `/login`:
  - after signing out: `You are signed out.`;
  - when reached through a redirect caused by an ended session (Server boundary): the ended-session wording from API.

**Absent controls.** A control that does not apply to the viewer is absent, never shown greyed out. People operations never sees `Approve`. Employees never see `Share this month`.

## Backend

### API (DP-01, DP-13, DP-21, DP-25, DP-27, DP-40, DP-43, DP-50, DP-71, DP-73, DP-81, DP-84, DP-90, DP-96, DP-99)

The API speaks JSON (`application/json; charset=utf-8`) under `/api` on the page origin. The one exception is `GET /api/trail.csv`, which answers CSV.

A session is either of these:
- the `token` from `POST /api/session`, sent as `Authorization: Bearer <token>`. This is the desk's own session token, never the realm's token;
- the session cookie that the same call sets for the browser.

**How a call is answered.** The steps run in this order, and the first one that fails gives the answer:
1. **Shared-link writes.** A request that carries a shared-link token and is not `GET` or `HEAD` answers as in Business rules, Shared links, on any path.
2. **Path.** A path under `/api/` that is not in the table below answers 404 `{"error": "No such endpoint."}`, with or without a session. This includes `/api`, `/api/` and any path with a trailing slash. The answer is never the HTML page.
3. **Method.** A published path called with a method it does not publish answers 405 `{"error": "Method not allowed."}`. The `Allow` header lists exactly that path's published methods, in any order, plus `HEAD` where the path publishes `GET`. `HEAD` on a `GET` path answers as `GET` would, with no body.
4. **Session.** This step applies to every endpoint except `POST /api/session` and `GET /api/health`.
   - With no session, an unknown or forged token, or a session ended by signing out, the answer is 401 `{"error": "Sign in to continue."}`.
   - With a session past its idle or absolute limit, a session replaced by a later sign-in, or one whose person is now inactive, the answer is 401 `{"error": "Your session has ended. Sign in again."}`. This is the ended-session wording.
5. **Body.** The body checks in Server boundary apply.
6. **The endpoint's own order.** Business rules gives the order for raise, decision, cancel, policy, sign-in and shared links. The table below gives it for the reads.

**Status ladder.** Every refusal uses exactly these codes:

| Status | Meaning |
|---|---|
| 400 | a malformed body, field or query value, or a body field the endpoint does not publish |
| 401 | no valid session, an ended session, or a refused sign-in |
| 403 | the caller is known, but their role or their relation to the request forbids the action; or a write carrying a shared-link token |
| 404 | an unknown or malformed request id, or a request outside the caller's scope, all answered identically with `{"error": "No such request."}`; likewise for people and shared links as in Business rules |
| 409 | the request's or link's state conflicts with the action |
| 410 | a shared link that no longer works |
| 412 | the policy version named in `If-Match` is no longer the version in force |
| 413 | the request body is over the size limit |
| 422 | a policy rule, the recorded attendance, approved leave, the business calendar or a published length limit refuses the action |
| 428 | a policy save sent no `If-Match` |
| 429 | the sign-in address is locked, or the minter has used up their shared links for now |

503 is used only in two places: by health while the desk starts, and by sign-in when the realm cannot be reached. Every other failure the desk cannot complete answers 500 `{"error": "The desk could not complete that. Try again."}`, with nothing else in the body.

**Error shape.** Every refusal body is `{"error": "<wording>"}`.
- A refusal about one field adds `"field": "<name>"`.
- The already-decided refusal adds `decided_by` and `decided_at`.
- Nothing else appears in an error body.

No answer body or page ever carries a stack frame, a source path, SQL, a constraint or table name, a driver message or a parser message. No refusal body ever carries a phone number or a private note.

**Shared wordings.** These apply to every endpoint that takes a body:
- **Unpublished key:** `{key} cannot be set here.`, with `field` set to that key. When the body has several, the first in the body's own order answers.
- **Missing required field:** `{field} is required.`, with `field`. A field counts as missing when its key is absent or its value is null. This wording applies to every required field except `outcome` on a decision, whose own wording in Business rules answers both a missing and a wrong value.
- **NUL character:** a string value containing the NUL character (U+0000) answers `{field} cannot contain a NUL character.`, with `field`. This is the first check made on that field.

**Objects.** Timestamps are UTC ISO 8601 to the whole second, ending in `Z` (for example `2026-04-03T10:00:00Z`). Days are business dates written `YYYY-MM-DD`, and months are written `YYYY-MM`. Claimed times are business wall-clock times written `HH:MM`.

- **Request object:** `id`, `person` (the raiser's name), `work_address`, `manager` (the raiser's current manager's name), `day`, `correction_type`, `claimed_in` and `claimed_out` (`HH:MM` or null), `reason` (exactly as sent), `state`, `raised_at`, `decided_by` (the decider's name, or null), `decided_at` (or null) and `decision_note` (or null).
- **Queue row:** the request object plus `recorded_in` and `recorded_out` from that day's attendance row, as timestamps or null.
- **Policy object:** `version`, `monthly_cap`, `lookback_days`, `enabled_types`, `require_note_on_approve`, `self_approval_allowed` (always false), `created_by` (a name) and `created_at`. `enabled_types` is always listed in the order `missed_in`, `missed_out`, `offsite`, `whole_day`, `night_shift`.
- **Audit entry:** `id`, `seq`, `request_id` (or null), `actor` (a name), `actor_role`, `verb` (one of `approved`, `rejected`, `policy_saved`, `share_mint`, `share_revoke`), `subject_type` (`request`, `policy` or `share_link`), `subject_id`, `occurred_at`, `note` (or null), `prev_hash` and `entry_hash`.
- **Shared link object:** `id`, `token`, `person_id`, `month`, `expires_at`, and nothing else.

**Endpoints.**

| Method and path | Body or query | Success | Refusals beyond the steps above |
|---|---|---|---|
| `GET /api/health` | | 200 `{"status": "ok", "schema": true, "seeded": true, "realm": true}` once ready | 503 `{"status": "starting", "schema": <bool>, "seeded": <bool>, "realm": <bool>}` while any flag is false |
| `POST /api/session` | `work_address`, `password` | 200 `{"person": {"name", "work_address"}, "role", "token"}`; also sets the session cookie | as in Business rules, Sign-in |
| `GET /api/session` | | 200 `{"person": {"name", "work_address"}, "role"}` | |
| `DELETE /api/session` | | 204, and clears the cookie | |
| `GET /api/requests` | `state`, `type`, `person`, `month`, `q`, `sort`, `page` | 200 `{"rows", "matched", "total", "page", "pages"}` | 400, as in the queue query rules below |
| `POST /api/requests` | `day`, `correction_type`, `claimed_in`, `claimed_out`, `reason`; optional header `Idempotency-Key` | 201 request object | as in Business rules, Raising |
| `GET /api/requests/<id>` | | 200 `{"request", "evidence", "leave", "audit"}`, plus `contact` for people operations | 404 |
| `POST /api/requests/<id>/decision` | `outcome`, `note` | 200 request object | as in Business rules, Deciding |
| `POST /api/requests/<id>/cancel` | no body, or `{}` | 200 request object | as in Business rules, Withdrawing |
| `GET /api/policy` | | 200 policy object in force, header `ETag: "{version}"` | |
| `PUT /api/policy` | `monthly_cap`, `lookback_days`, `enabled_types`, `require_note_on_approve`, optional `self_approval_allowed`; required header `If-Match` | 201 new policy object, header `ETag: "{version}"` of the new version | as in Business rules, Policy |
| `GET /api/policy/history` | | 200 `{"versions": [policy objects, newest first]}`, header `ETag: "{version}"` of the version in force | 403 `Only people operations reads the policy history.` |
| `GET /api/audit` | | 200 `{"entries": [newest first, by seq]}` | 403 `Only people operations reads the whole trail.` |
| `GET /api/trail.csv` | | 200 CSV as in Business rules, Trail export | 403 `Only people operations exports the trail.` |
| `GET /api/trail/verify` | | 200 as in Business rules, Trail chain | 403 `Only people operations reads the whole trail.` |
| `GET /api/calendar` | `month`, `person` | 200 `{"month", "days", "people"}` | 403 `Only managers and people operations read the calendar.`; then 400 `month must read YYYY-MM.` with field `month`; then the NUL refusal for `person` |
| `POST /api/share-links` | `person_id`, `month` | 201 shared link object | as in Business rules, Shared links |
| `DELETE /api/share-links/<id>` | no body | 204 | as in Business rules, Shared links |

`GET /api/health` never reads, renews or ends a session. What each flag means is set out in Server boundary.

**Ids in paths.** `<id>` in a request or shared-link path matches any single path segment. The segment names a record only when both of these hold:
- it is written as a positive whole number with no sign, no leading zero, no decimal point and no exponent;
- it is at most 9,223,372,036,854,775,807.

Any other segment answers exactly as an unknown id does. Examples are `0`, `-1`, `01`, `1.0`, `1e3` and `9223372036854775808`.

**Detail parts.**
- `evidence` is `{"recorded_in", "recorded_out", "source"}`. All three are null when that day has no attendance row.
- `leave` is `{"kind", "status"}`, or null. `kind` is `annual`, `sickness` or `absence`, as projected for the reader in Business rules.
- `audit` lists that request's entries, oldest first.
- `contact` is `{"phone", "private_note"}` for the raiser. It is present only when people operations reads; for every other reader the key is absent.

**Calendar parts.**
- `days` lists every day of the month in order, each as `{"day", "counts": {"recorded", "incomplete", "leave_approved", "leave_pending", "waiting"}}`.
- `people` lists `{"name", "work_address"}` in name order.

**Queue query rules.**
- An empty parameter counts as absent. A repeated parameter uses its first value. Parameters not listed are ignored.
- Values are checked in the order `state`, `type`, `person`, `month`, `q`, `sort`, `page`. The first check on every value is the NUL refusal, `{param} cannot contain a NUL character.`
- A value outside its set answers 400 `Unknown {param} value: {value}.`, with `field` set to the parameter. The sets are:
  - `state`: `pending`, `approved`, `rejected` or `cancelled`;
  - `type`: one of the five type codes;
  - `month`: a real `YYYY-MM`;
  - `sort`: `day`, `raised` or `person`;
  - `page`: digits only, starting with a non-zero digit. So `0`, `-1`, `+2`, `02`, `2.0`, ` 2` and full-width digits are refused.
- A `q` longer than 100 characters after trimming answers 400 `Search is limited to 100 characters.`, with field `q`. Exactly 100 characters is allowed.
- Apart from a NUL, `person` never answers 400. A value that matches nobody in scope narrows the queue to nothing.

### Business rules (DP-10, DP-12, DP-17, DP-18, DP-19, DP-20, DP-23, DP-24, DP-26, DP-34, DP-35, DP-36, DP-37, DP-38, DP-39, DP-41, DP-42, DP-45, DP-46, DP-47, DP-48, DP-49, DP-50, DP-69, DP-72, DP-74, DP-77, DP-78, DP-79, DP-82, DP-84, DP-86, DP-87, DP-90, DP-91, DP-92, DP-96, DP-97, DP-98, DP-99)

**Business time.** The employer's `time_zone` is `Europe/London`.

- **Days.** Every `day` is a business date in that zone. This covers attendance, leave, requests, calendar days, the window, the cap month, shared-link months and filters.
- **Claimed times.** A claimed `HH:MM` is a wall-clock time in that zone on its day.
- **Stored instants.** Every stored instant is UTC, and every timestamp the API returns is UTC. For example, a 09:00 sign-in on a summer-time day reads `…T08:00:00Z`, and on a winter day it reads `…T09:00:00Z`.
- **Converting a business date and time to an instant:**
  - A wall-clock time that occurs twice on a day when the clocks go back resolves to the earlier instant.
  - A wall-clock time that does not occur on a day when the clocks go forward (01:00 to 01:59 in London) is refused wherever it is claimed, as in Raising.
- **Server clock.** The business date "today" is the London date, never the server's own zone or the UTC date. The desk's own checks, however, are anchored to `seeded_on` (see Seed data), not to today.

**Text lengths.** Every length limit on `reason` and `note` counts Unicode extended grapheme clusters, measured after trimming leading and trailing white space. For example:
- `a` counts 1;
- `e` followed by the combining acute accent U+0301 counts 1;
- the flag made of U+1F1EC U+1F1E7 counts 1;
- the sequence U+1F469 U+200D U+1F4BB counts 1;
- the flag made of U+1F3F4 U+E0067 U+E0062 U+E0073 U+E0063 U+E0074 U+E007F counts 1.

A `reason` or `note` is stored exactly as sent, white space and line breaks included; trimming only applies to measuring.

**Work addresses.** A work address is compared in its folded form: Unicode NFKC normalisation, then lower-casing. Folding is used for sign-in, for the uniqueness of `person.work_address`, for the lockout count and for the `person` filters. For example, `IRIS.CALDER@…`, its full-width spelling and an address written with the ligature U+FB01 in place of `fi` each fold to the same address as their plain lower-case spelling. Folding never maps one script onto another, so an address using a Cyrillic letter (for example U+0456 in place of `i`) is a different address: it matches nobody and gets the ordinary sign-in refusal.

**People as the HR system of record keeps them.**
- `person.role`, `person.manager_id`, `person.active`, `person.phone` and `person.private_note` belong to the HR system of record, which writes them directly into postgres at any time. The desk never writes them and never keeps a copy.
- The desk reads every caller's role, active flag and reporting lines from the store on every call and every page request, and never from the session.
- A change therefore applies on the caller's next call, with no sign-out:
  - **Reporting line moves.** The old manager's queue rows, `total` and `matched`, calendar counts and `people`, `Person` filter options and detail reads lose the moved report. The moved report's requests answer the 404. The new manager gains all of them. Shared links follow the rule in Shared links.
  - **Role changes.** The person gets the new role's answers. For example, a manager made an employee gets the wrong-role page on `/calendar` and the 403 from the calendar endpoint.
  - **Deactivation.** A person made inactive while signed in gets the ended-session 401 on their next call. Their next page redirects as in Server boundary. A later sign-in gets the uniform sign-in refusal.
- Decisions already made keep `decided_by` as recorded.

**Private fields.** `phone` and `private_note` reach exactly one place: the `contact` part of a request detail and the `Contact on file` block on that request's page, both read by people operations. They never appear in any other answer, in any manager's or employee's queue, detail or calendar answer, in a shared month, in the trail export, in a refusal body, or in any server-rendered page, hydration data or script served to anyone else. `work_address` never appears in a shared month or the trail export.

**Sessions.**
- A session is created by a successful sign-in and stored in postgres. It records when it began and when it was last used.
- Every successful sign-in issues a new session identifier chosen by the desk. A session identifier the client offers is never adopted. If the sign-in request presented a session, by cookie or bearer token, that session ends at once and afterwards answers the ended-session 401. A sign-in that presents no session leaves the person's other sessions alone, so one person may hold several sessions in different browsers.
- It has ended once either of these is true:
  - the time since its last use is at or past `SESSION_IDLE_SECONDS`;
  - the time since it began is at or past `SESSION_MAX_SECONDS`.

  A call made exactly at either limit finds it ended.
- Every API call and page request that presents a session that has not ended, whatever its answer, sets its last use to now. Renewal never carries a session past its absolute limit.
- The session cookie is set with a `Max-Age` of `SESSION_MAX_SECONDS`.
- The realm's own token lifetimes neither shorten nor lengthen a desk session.
- A restart neither revives an ended session nor ends a live one early.
- Signing out ends the session at once. Its token then counts as no session.

**Scope.**
- An employee's scope is their own requests.
- A manager's scope is their own requests plus every request raised by a current direct report.
- People operations' scope is every request.
- Scope is applied before any filter, so a filter only ever narrows.
- Any read of, or action on, a request outside scope answers the 404 from API, identical to an unknown id.
- Because an employee's scope holds only their own requests, an employee who tries to decide anything they can see gets the self-decision refusal.

**Leave kind as each reader sees it.** The stored kind is `annual` or `sickness`.
- The raiser and people operations read the stored kind.
- A manager reading a report's request reads `annual` as `annual` and `sickness` as `absence`. A manager reading their own request is its raiser.
- The pane labels are `Annual leave` for `annual`, `Sickness` for `sickness` and `Absence` for `absence`.
- For a manager reading a report's request, the leave kind sickness never appears in the answer body, the server-rendered page, the page's hydration data or any script, in any letter case. No script the desk serves to anyone contains the word. The `Sickness` label reaches the raiser and people operations only in their own page and data.
- Calendar counts and shared months do not carry kinds. The approved-leave raise refusal names no kind.

**Request states.** A request is raised as `pending`.

| From | To | How |
|---|---|---|
| `pending` | `approved` | a decision with outcome `approve` |
| `pending` | `rejected` | a decision with outcome `reject` |
| `pending` | `cancelled` | a withdrawal |

`approved`, `rejected` and `cancelled` are final. Every attempt to change them answers that endpoint's 409, below. There is no re-open, un-approve or edit. A wrong correction is put right by raising a new one.

**Simultaneous changes to one request.** When decisions, withdrawals or both arrive for the same request at the same time, exactly one succeeds. Every other change answers its endpoint's 409 for the state the winner left. None answers 500.

**Sign-in (`POST /api/session`).** These steps run in order:
1. The body checks from Server boundary.
2. The unpublished-key refusal.
3. `work_address`, then `password`, each checked in turn:
   - first the NUL refusal;
   - then it must be a non-empty string, or `{field} is required.`

   A 400 is not counted as an attempt.
4. If the folded address is locked, answer 429 `{"error": "Too many attempts for this address. Try again later."}`. Set `Retry-After` to the whole seconds left in the lock, rounded up, from 1 up to the lockout length.
5. If the realm cannot be reached, answer 503 `{"error": "Sign-in is unavailable right now. Try again shortly."}`. This is not counted as an attempt.
6. An unknown address, a wrong password, or a deactivated person with the right password all answer 401 `{"error": "Those details do not match an account"}`. The status, body and headers are identical in all three cases.
7. Otherwise the sign-in succeeds and starts a new session, as in Sessions.

**Lockout.**
- Every answer from step 4 onward, except the 503, records one sign-in attempt against the folded work address, marked as succeeded or not. Every spelling of one address shares one count.
- An address's count is the number of refused attempts since the latest of:
  - its last success;
  - the end of its last lock;
  - now minus `SIGN_IN_WINDOW_SECONDS`.
- The refusal that brings the count to five locks the address for `SIGN_IN_LOCKOUT_SECONDS`, starting from that attempt.
- During the lock, every attempt answers the 429, the right password included. These attempts are recorded but never extend the lock.
- When the lock ends, the count starts again from zero.
- Known, unknown and deactivated addresses lock in exactly the same way.
- Locks live in the database and survive a restart.

**Raising (`POST /api/requests`).** The fields are:
- `day`: a real calendar date.
- `correction_type`, one of:
  - `missed_in` — a sign-in was not recorded;
  - `missed_out` — a sign-out was not recorded;
  - `offsite` — worked away from the workplace;
  - `whole_day` — a whole day worked but not recorded;
  - `night_shift` — a night shift recorded against the wrong day.
- `claimed_in` and `claimed_out`: each `HH:MM` on a 24-hour clock, or null.
  - `missed_in` requires `claimed_in`.
  - `missed_out` requires `claimed_out`.
  - `offsite`, `whole_day` and `night_shift` require both.
  - A time the type does not require may be omitted, sent as null, or sent as a time, which is stored.
- `reason`: a string of 20 to 280 grapheme clusters, counted as in Text lengths. Both limits are allowed.

Refusals run in this order. The first failure answers, and nothing is created.

1. **People operations:** 403 `People operations does not raise corrections.`
2. **Key format:** `Idempotency-Key`, if present, must be 1 to 64 visible ASCII characters. Otherwise 400 `Idempotency-Key must be 1 to 64 visible characters.`, with field `Idempotency-Key`.
3. **Repeat send:** a key this person already used on a created request.
   - With the same published field values, it answers 200 with that request as it now stands (even if it has since been cancelled or decided) and the header `Idempotent-Replayed: true`. Nothing is created.
   - With any different value, it answers 422 `That idempotency key was already used for a different correction.`

   The same key from a different person is unrelated. A refused send stores no key, so resending it is checked afresh.
4. **Field checks:**
   1. The unpublished-key refusal. For example, `person_id`, `state`, `raised_at` or `decided_by` is refused by name and never applied.
   2. Each field in the order `day`, `correction_type`, `claimed_in`, `claimed_out`, `reason`. The NUL refusal comes first on each field, then:
      - a required field that is missing: `{field} is required.`;
      - malformed day: `day must read YYYY-MM-DD.`;
      - unknown type: `Unknown correction type: {value}.`;
      - malformed time: `{field} must read HH:MM.`;
      - a reason that is not a string: `reason must be text.`;
      - a reason under 20 grapheme clusters: `A reason needs at least twenty characters.`;
      - a reason over 280 grapheme clusters: 422 `A reason is limited to 280 characters.`, with field `reason`. This is the one field check answered with 422; every other check in this step answers 400.
   3. The time-order rule, comparing wall-clock `HH:MM`, with field `claimed_out`, answered with 400:
      - For a `night_shift`, `claimed_out` must be earlier than `claimed_in`. Otherwise `A night shift must end on the following day.`
      - For any other request that carries both times, `claimed_out` must be later than `claimed_in`. Otherwise `The sign-out must come after the sign-in.`
5. **Type switched off:** a type the policy in force does not enable answers 422 `That correction type is not currently accepted.` An unknown type is always a 400, never this.
6. **Outside the window:** a day outside the window answers 422 `That day is outside the {days} day correction window.`, where `{days}` is the policy's lookback.
7. **Time that does not occur:** a claimed time that does not occur in Kestrel Works time answers 422 `{HH:MM} does not occur on {day} in Kestrel Works time.`, with `field` set to that field. Each claimed time is checked on its own day. A `night_shift`'s `claimed_out` is checked on the following day, and `{day}` names the day it was checked on. `claimed_in` is checked first.
8. **Claim contradicts the record:** the claimed instants are compared with the attendance rows as they stand, in this order. Where the punch to compare against is absent, that check is skipped.
   1. A `missed_in` whose claimed sign-in is not before that day's recorded sign-out answers 422 `The claimed sign-in must come before the recorded sign-out.`, with field `claimed_in`.
   2. Any claimed sign-in that falls before the sign-out recorded on the previous business day's row answers 422 `A sign-in cannot come before the sign-out recorded on {previous day}.`, with field `claimed_in`. Equal instants are allowed.
   3. A `missed_out` whose claimed sign-out is not after that day's recorded sign-in answers 422 `The claimed sign-out must come after the recorded sign-in.`, with field `claimed_out`.
   4. A `night_shift` whose claimed sign-out falls after the sign-in recorded on the following business day's row answers 422 `A night shift cannot end after the sign-in recorded on {next day}.`, with field `claimed_out`. Equal instants are allowed.
9. **Approved leave:** the raiser has approved leave of any kind on that day. This answers 422 `You were on approved leave on {day}.` Pending leave does not block.
10. **Already waiting:** the person already has a pending request on that day. This answers 409 `You already have a correction waiting on {day}.`
11. **Monthly cap:** 422 `You have {used} of {cap} corrections approved or waiting in {month}.`
    - `{used}` is the person's approved plus pending corrections whose day falls in the calendar month of `day`.
    - `{cap}` is the policy's monthly cap. The raise is refused when `{used}` is at or above `{cap}`.
    - `{month}` is written `YYYY-MM`.

**The window.**
- The window counts back in business dates from the employer's `seeded_on` date, never from the wall clock.
- With a lookback of N days, `seeded_on` itself and every day 1 to N days before it are inside. Day N is inside.
- Day N+1 or earlier is outside, and so is any day after `seeded_on`.

**Simultaneous raises.**
- Simultaneous raises by one person for one day, with or without keys, create exactly one request, answered with one 201.
- Every other send answers the 409 from step 10, or the 200 repeat-send answer when it carried the winner's key and values.
- None answers 500.
- The store itself guarantees one pending request per person per day. A check before writing is not enough on its own.
- `raised_at` is stored truncated to the whole second.

**Deciding (`POST /api/requests/<id>/decision`).** The fields are:
- `outcome`: required, `approve` or `reject`.
- `note`: optional, a string or null, at most 500 grapheme clusters counted as in Text lengths. An omitted note counts as null.

Refusals run in this order:
1. **Out of scope:** 404. A manager deciding for someone who is not a current direct report gets this answer.
2. **Own request:** the caller raised the request. 403 `You cannot decide a request you raised.`
3. **People operations:** 403 `People operations does not decide requests.`
4. **Not pending:**
   - Approved or rejected: 409 `{person} already decided this on {when}.`, also carrying `decided_by` (the name) and `decided_at` (the timestamp). `{person}` is the decider's name, and `{when}` is the business date of `decided_at`.
   - Cancelled: 409 `This request was withdrawn and can no longer be decided.`
5. **400 checks:**
   1. The unpublished-key refusal (for example `decided_by` or `state`).
   2. `outcome` is missing, null or has any other value: `outcome must be approve or reject.`, with field `outcome`. This wording replaces the shared missing-field wording for `outcome`; `outcome is required.` is never answered.
   3. The NUL refusal on `note`.
   4. A `note` that is neither a string nor null: `note must be text.`, with field `note`.
   5. A note over 500 grapheme clusters: `A note is limited to 500 characters.`, with field `note`.
   6. A rejection whose note is null or under ten grapheme clusters: `A rejection needs a note of at least ten characters.`, with field `note`.
   7. An approval whose note is null or empty while the policy in force requires one: `This policy requires a note when approving.`, with field `note`.
6. **Approve only, window:** the day is outside the window of the policy then in force. 422 with the raise window wording.
7. **Approve only, cap:** the raiser's approved corrections in the day's month, not counting this request, are at or above the cap then in force. Pending requests do not count here. 422 `{person} has used {used} of {cap} corrections in {month}.`, where `{person}` is the raiser's name.
8. **Approve only, the record again:** raise step 8 runs again against the attendance rows as they stand at that moment, with the same wordings and fields.

A request refused at step 6, 7 or 8 stays pending. Approvals for one raiser are weighed one at a time, each seeing the effects of the one before. So of several simultaneous approvals for one raiser:
- only those within the cap succeed, and the rest answer the step 7 refusal;
- no combination of them leaves one day's recorded sign-out after the next day's recorded sign-in.

**What a decision writes.** All of the following happen in one transaction, all or nothing:
- the checks, the step 8 re-check included;
- the state change, with `decided_by`, `decided_at` and `decision_note`;
- on approval, the attendance write;
- one audit entry by the decider, in the role `manager`, with verb `approved` or `rejected`, subject the request, and the note.

**The attendance write on approval.**
- `recorded_in` becomes the instant of `claimed_in` on the corrected day in Kestrel Works time.
- `recorded_out` becomes the instant of `claimed_out` on the corrected day. For a `night_shift` it falls on the following business date instead.
- A recorded punch that the request carries no claim for is kept.
- The row's source becomes `regularisation`. A missing row is created.
- Approval is the only thing that rewrites attendance.

**Withdrawing (`POST /api/requests/<id>/cancel`).** Refusals run in this order:
1. Out of scope: 404.
2. The caller did not raise the request: 403 `Only the person who raised a request can withdraw it.`
3. The request is not pending: 409 `This request is already {state} and can no longer be withdrawn.`
4. Any body key: the unpublished-key refusal.

A successful withdrawal moves the request to `cancelled` and frees that day. A withdrawal writes no audit entry.

**Policy (`PUT /api/policy`).** Refusals run in this order:
1. **Not people operations:** 403 `Only people operations changes the policy.`
2. **No `If-Match` header:** 428 `Send If-Match with the policy version you are changing.`
3. **Stale version:** an `If-Match` that is not exactly the current ETag `"{version}"` (`*` and weak forms included) answers 412 `Version {current} was saved after the one you are changing. Reload to see it.` The answer carries the current `ETag`.
4. **Unpublished keys:** the unpublished-key refusal, for example `version` or `created_by`.
5. **Field checks.** The fields are checked one at a time, in the order `monthly_cap`, `lookback_days`, `enabled_types`, `require_note_on_approve`, `self_approval_allowed`, the same way raising checks its fields. All of one field's checks run before the next field is looked at: first whether it is missing, then its value. The first failure answers 400, with its `field`.
   - **Missing.** The first four fields are required. A missing one (absent or null) answers the shared missing-field wording, so the four missing-field answers are exactly:
     - `monthly_cap is required.`
     - `lookback_days is required.`
     - `enabled_types is required.`
     - `require_note_on_approve is required.`
   - **Value.** A field that is present is checked as follows:
     - `monthly_cap`: a whole number from 0 to 10, both allowed, or `monthly_cap must be a whole number from 0 to 10.`
     - `lookback_days`: a whole number from 1 to 90, both allowed, or `lookback_days must be a whole number from 1 to 90.`
     - `enabled_types`: a list of known type codes, each listed at most once, or `enabled_types must list correction types, each once.` An empty list gets `At least one correction type must stay available.`
     - `require_note_on_approve`: true or false, or `require_note_on_approve must be true or false.`
     - `self_approval_allowed`: optional. It may be omitted or false, and is never answered as missing. Any other value, null included, gets `Not available. Self approval is refused by this product.`
   - **Example.** The body `{"monthly_cap": 99, "enabled_types": ["missed_in"], "require_note_on_approve": false}`, which has no `lookback_days`, answers 400 `monthly_cap must be a whole number from 0 to 10.` with field `monthly_cap`, because `monthly_cap` is fully checked before `lookback_days` is looked at. The same body with `"monthly_cap": 2` answers 400 `lookback_days is required.` with field `lookback_days`.

**What a policy save writes.**
- A save appends a new version numbered previous plus one. It never edits an earlier version.
- When several saves send the same `If-Match` at the same time, exactly one answers 201 and the rest answer 412. None answers 500. Version numbers stay contiguous with no gaps, so the highest version always equals the number of versions.
- The save appends exactly one audit entry: people operations as actor, role `admin`, verb `policy_saved`, `request_id` null, subject the policy version, note `Version {version}.`
- Requests already pending stay pending, whatever the new values. They meet the new policy only when someone approves them.
- `GET /api/policy` and the footer read the highest version.

**Shared links.** A shared link shows one person's month, read-only, to anyone holding it.

- **Carrying a token.** A request carries a shared-link token when its path is `/share/<anything>` or its query has a `share` parameter, whatever the token's state.
- **Read-only.** A request that carries a token and is not `GET` or `HEAD` answers 403 `{"error": "A shared link is read-only."}` on any path, before any other step, even when the same request also presents a valid desk session. A token never widens what a session may do, and a session never widens what a token may do.
- **Minting (`POST /api/share-links`).** Refusals run in this order:
  1. An employee: 403 `Only managers and people operations share a month.`
  2. A minter who has already minted `SHARE_LINK_MINTS` links within the last `SHARE_LINK_MINT_WINDOW_MINUTES` minutes: 429 `{"error": "Too many shared links for now. Try again later."}`, with `Retry-After` set to the whole seconds, rounded up and at least 1, until the oldest of those mints leaves the window. The count is kept per minter in postgres, never per address or per connection, and another minter is unaffected.
  3. The unpublished-key refusal. Only `person_id` and `month` are published; `expires_at`, `scope`, `token`, `id`, `role` and every other key are refused by name. The desk alone sets the expiry and the read-only scope.
  4. `person_id`, then `month`: first the missing-field wording; then `person_id` must be a JSON whole number of at least 1, or `person_id must be a person id.`; then `month` must be a real `YYYY-MM`, or `month must read YYYY-MM.`
  5. A person who is unknown, inactive, or outside the minter's mint scope: 404 `{"error": "No such person."}`. A manager's mint scope is their current, active direct reports; people operations' is every active person.
- **What a mint writes.** In one transaction:
  - a new link for that `(person_id, month)`, with `expires_at` equal to the mint time plus `SHARE_LINK_TTL_SECONDS`;
  - the end of any link for the same `(person_id, month)` that was live, which is now replaced;
  - one audit entry: the minter as actor in their role, verb `share_mint`, `request_id` null, subject the link, note `Month {month} for {name}.`

  At most one link is live per `(person_id, month)`, and the store itself guarantees it. Of simultaneous mints for one `(person_id, month)`, each that answers 201 replaced the one before it, exactly one link is live afterwards, and none answers 500.
- **The token.** At least 32 characters drawn from URL-safe characters, generated from a cryptographically secure random source, and never derived from the person, the month, a counter or a clock. The desk stores only its SHA-256, never the token itself, so the token is shown once, in the 201 answer.
- **Reading (`GET /share/<token>`).** No session is needed and none is read, renewed or ended. The answer is one of:
  - **200** while the link is live: the shared month page from Screens and layout, whose counts are computed as in Calendar counts for that one person and month, read live at that request;
  - **404**, the signed-out not-found page, for a token that matches no link, a malformed token included;
  - **410**, the no-longer-available page from Feedback states, for a link that is dead.
- **When a link is dead.** At each read, a link is dead when any of these holds:
  - the time is at or after its `expires_at`;
  - it was revoked;
  - it was replaced by a later mint;
  - its person is now inactive or outside its minter's current mint scope, or its minter is now inactive or no longer holds a role that may mint.
- **Revoking (`DELETE /api/share-links/<id>`).** Refusals run in this order:
  1. An employee: the employee mint refusal.
  2. A link that is unknown, or whose person is outside the caller's current mint scope: 404 `{"error": "No such link."}`.
  3. A link that is already dead: 409 `{"error": "That link no longer works."}`.
  4. Any body key: the unpublished-key refusal.

  A successful revocation answers 204 and, in the same transaction, appends one audit entry: the caller as actor in their role, verb `share_revoke`, `request_id` null, subject the link, note `Month {month} for {name}.`

**Audit trail.**
- Every decision, policy save, shared-link mint and shared-link revocation appends exactly one entry. Nothing else writes to the trail.
- Nothing in the product edits or removes an entry.
- The database refuses any update, delete or truncate of an entry attempted with the application's own database account through ordinary statements.

**Trail chain.**
- Each entry carries `seq`, a whole number from 1 with no gaps, in append order.
- `entry_hash` is the lower-case hex SHA-256 of the entry's canonical string. The canonical string is these eight values, in this order, joined with the unit separator U+001F:
  1. `seq`;
  2. `at`, the entry's `occurred_at` as UTC `YYYY-MM-DDTHH:MM:SSZ`;
  3. `actor_id`;
  4. `action`, the entry's `verb`;
  5. `subject_type`;
  6. `subject_id`;
  7. `detail`, the entry's `note` exactly as stored;
  8. `prev_hash`.

  Whole numbers are written in decimal with no leading zero. A null is written as the empty string. The string is encoded as UTF-8.
- `prev_hash` is the previous entry's stored `entry_hash`. The entry with `seq` 1 has a `prev_hash` of 64 `0` characters.
- `prev_hash` and `entry_hash` are stored with the entry when it is appended. They are never recomputed when the trail is read, and a restart leaves them unchanged.
- Appends are taken one at a time, so under simultaneous decisions, saves and mints every `seq` is still contiguous and every `prev_hash` names its predecessor.
- `GET /api/trail/verify` recomputes each entry's canonical string from its stored values and compares it with the stored hashes. It answers 200 with one of:
  - `{"intact": true, "entries": <n>, "checked_through": <seq>}` when every entry's stored `entry_hash` equals its recomputed hash and every `prev_hash` equals its predecessor's stored `entry_hash`; `checked_through` is the highest `seq`;
  - `{"intact": false, "entries": <n>, "first_broken_seq": <seq>}` naming the lowest `seq` where either comparison fails.

  `entries` is the number of entries. An entry changed out of band, for example through the database owner's schema-change rights, is reported this way on the next call.

**Trail export (`GET /api/trail.csv`).**
- The answer is the file in the response body, with `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="trail.csv"`. The desk never writes it to disk.
- The file is UTF-8 with no byte-order mark. Every line, the last one included, ends with CR LF.
- The header row is exactly `seq,at,actor,actor_role,action,subject_type,subject_id,reason,detail,prev_hash,entry_hash`. Rows follow in `seq` order, oldest first, one per entry:
  - `at` is `occurred_at` as a UTC timestamp;
  - `actor` is the actor's name;
  - `action` is the verb;
  - `reason` is the request's reason exactly as stored for entries whose subject is a request, and empty otherwise;
  - `detail` is the note, empty when null.

  No other column exists. No work address, phone or private note appears in the file.
- Each cell is written in two steps, in this order:
  1. **Neutralise.** A cell whose first character is `=`, `+`, `-`, `@`, TAB (U+0009) or CR (U+000D) gets a single apostrophe in front. Only the first character counts: `a=b` stays as it is.
  2. **Quote.** A cell, after step 1, that contains `"`, `,`, CR or LF is wrapped in double quotes, and each `"` inside it is doubled. CR and LF inside a cell are kept as they are.

  For example, a reason of `=HYPERLINK("http://x","c") badge reader again` is written as `"'=HYPERLINK(""http://x"",""c"") badge reader again"`.

**Queue order, filters and paging.**

| Order | How rows are sorted |
|---|---|
| Default | pending rows first, then the rest; within each group, `raised_at` oldest first, then `id` ascending |
| `sort=day` | corrected day newest first, then `id` ascending |
| `sort=raised` | `raised_at` oldest first, then `id` ascending |
| `sort=person` | raiser's name, compared without regard to case, A to Z, then `id` ascending |

Every order is total. Walking pages 1 to `pages` yields every matched request exactly once, in that order.

Filters:
- `state` and `type` match exactly.
- `person` matches the raiser's work address in its folded form.
- `month` matches the month of the corrected day.
- `q`, after trimming, matches reasons that contain it as a literal substring, without regard to case. `%`, `_` and `\` are ordinary characters.

Counts and paging:
- `total` counts the caller's scope with no filters applied. `matched` counts the scope after filters.
- Pages hold 25 rows. `pages` is the larger of 1 and `matched` divided by 25, rounded up. The last page holds the rows left over.
- A `page` above `pages` answers the last page, with `page` set to `pages`.

Canonical query:
- A queue URL writes only parameters that differ from their defaults, in the order `state`, `type`, `person`, `month`, `q`, `sort`, `page`.
- `page=1` is never written.

**Calendar counts.**
- **Scope.** A manager's scope is their current direct reports, including inactive ones, and never the manager. People operations' scope is all sixteen people.
- **`people`.** The list is exactly that scope.
- **`person`.** A `person`, matched in its folded form, who is in scope narrows the counts to that one person, and `people` stays the same. A `person` who is outside scope or unknown gives every count zero, and `people` stays the same. Another team's data never appears.
- **`month`.** Defaults to the month of `seeded_on`.
- **Freshness.** Counts and scope are read live from the store on every call. Nothing is cached.

For each business day, counted over the in-scope people:

| Count | Who is counted |
|---|---|
| `recorded` | people whose attendance row for that day holds both punches |
| `incomplete` | people with no row, or a row missing a punch, on a day that is one of the 90 seeded days (0 to 89 days before `seeded_on`); other days add nothing here |
| `leave_approved` | people with a leave row of status `approved` |
| `leave_pending` | people with a leave row of status `pending` |
| `waiting` | pending requests on that corrected day, never on the day they were raised |

Consequences:
- An approval that completes a row, or that creates a row holding both punches, moves that person from `incomplete` to `recorded` on that day.
- An approved night shift counts only on its corrected day, never on the following day.
- A raise adds one to `waiting`, and a withdrawal or decision takes one away.

**Agreement with the queue.** For the same caller, every person `p` in `people` and every month `M`, these two numbers are equal:
- the sum of `waiting` over `GET /api/calendar?month=M&person=p`;
- `matched` from `GET /api/requests?state=pending&month=M&person=p`.

**Store invariants.**
- At most one pending request per person per day.
- `approved` and `rejected` requests carry both `decided_by` and `decided_at`. `pending` and `cancelled` requests carry neither.
- The decider is never the raiser.
- A `rejected` request always has a note.
- At most one attendance row and one leave row per person per day.
- At most one live shared link per person per month.
- Every stored instant is UTC.

**Constraints.**
- There is no signup, no password reset and no invitation.
- People operations never decides.
- Nobody decides their own request.
- The trail only grows.
- The policy is versioned.
- Everything is in English.

### Services (DP-05, DP-14, DP-70, DP-89)

**Postgres.**
- Read the connection from `DATABASE_URL`. That account owns the database and is not a superuser.
- The database may start empty, or be emptied between runs. On every start, before reporting ready, create any missing schema and seed any missing data, as Server boundary describes.
- State written by one call is visible to the next call, to other sessions, to other desk instances on the same database, and after a restart.
- If postgres becomes unreachable after the desk is ready, every call that needs it answers the 500 from API.

**Keycloak.**
- `AUTH_ISSUER_URL` is the issuer of one realm. The server is at `KEYCLOAK_URL` and the realm is named in `KEYCLOAK_REALM`.
- The realm publishes its token address and signing keys at `/.well-known/openid-configuration` beneath the issuer.
- The desk is the confidential client `AUTH_CLIENT_ID`. It authenticates with `AUTH_CLIENT_SECRET` and may exchange a work address and password directly for a token.
- The desk folds the typed work address as in Business rules before asking the realm, maps the token's subject or email to its own person row, and takes the role from that row, as it stands at each call.
- The realm only checks passwords. Desk sessions are the desk's own, as Business rules describes.
- When the realm is unreachable, sign-in answers the 503 from Business rules and `/login` shows that wording.

**Realm accounts.** The realm may start with no accounts, and it keeps the client between runs. On every start, and on every retry until the `realm` flag is true, make sure each seeded person exists in the realm with:
- username and email equal to their work address;
- first name and last name taken from their seeded name, split at the first space;
- the seeded password.

A seeded account that can already exchange the seeded password needs nothing, and an account that already exists is never registered twice. Register a missing account through the realm's self-registration over plain HTTP:
1. Request `GET {AUTH_ISSUER_URL}/protocol/openid-connect/registrations?client_id={AUTH_CLIENT_ID}&response_type=code&scope=openid&redirect_uri={APP_PUBLIC_URL}/login`. This answers an HTML page and session cookies.
2. Post its `login-actions/registration` form, with those cookies, as `application/x-www-form-urlencoded`. Send the fields `firstName`, `lastName`, `email`, `username`, `password` and `password-confirm`.

Registration needs no email verification or other required action. Phone numbers and private notes are never sent to the realm.

**Passwords.**
- The realm is the only place a password is held or checked. The desk keeps no password and no password hash.
- A deactivated person's correct password is refused by the desk with the same answer as any other refusal.

No other database, cache, queue, object store, identity provider or mail service is used.

### Seed data (DP-06, DP-07, DP-08, DP-09, DP-75, DP-78, DP-88, DP-98, DP-99)

Every person and the employer below are invented, and so is every phone number and note. Every seeded account uses the password `deku-demo-pw-2026`. This is benchmark fixture data, not a secret.

**employer.** One row: id 1, named `Kestrel Works`, `time_zone` `Europe/London`.

`seeded_on` is chosen once, when seeding first runs:
- If `EMPLOYER_SEEDED_ON` holds a real `YYYY-MM-DD` date, use it. Otherwise use the London business date at that moment.
- If the chosen date falls on the 1st, 30th or 31st of its month, move it back to the nearest earlier date whose day of the month is 2 to 29.
- After that, it never moves until the database is emptied and seeding runs again.

A day "at offset k" means the business date k days before `seeded_on`. "At HH:MM" means that wall-clock time in Kestrel Works time on that date, stored as its UTC instant.

**person.** Ids 1 to 16, in this order:

| id | Work address | Name | Role | Reports to | Active |
|---|---|---|---|---|---|
| 1 | `admin@example.com` | Priya Sahni | admin | nobody | yes |
| 2 | `manager@example.com` | Dara Finch | manager | Priya Sahni | yes |
| 3 | `manager2@example.com` | Omar Vance | manager | Priya Sahni | yes |
| 4 | `manager3@example.com` | Lena Roth | manager | Priya Sahni | yes |
| 5 | `employee@example.com` | Iris Calder | employee | Dara Finch | yes |
| 6 | `employee2@example.com` | Tomas Berg | employee | Dara Finch | yes |
| 7 | `employee3@example.com` | Nadia Kerr | employee | Dara Finch | yes |
| 8 | `employee4@example.com` | Felix Arno | employee | Dara Finch | yes |
| 9 | `employee5@example.com` | Suri Patel | employee | Omar Vance | yes |
| 10 | `employee6@example.com` | Jonas Vale | employee | Omar Vance | yes |
| 11 | `employee7@example.com` | Mira Okoye | employee | Omar Vance | yes |
| 12 | `employee8@example.com` | Ravi Setu | employee | Omar Vance | yes |
| 13 | `employee9@example.com` | Clara Mendt | employee | Lena Roth | yes |
| 14 | `employee10@example.com` | Bo Lindqvist | employee | Lena Roth | yes |
| 15 | `employee11@example.com` | Ayaan Qureshi | employee | Lena Roth | yes |
| 16 | `employee12@example.com` | Greta Solis | employee | Lena Roth | no |

Each person's private fields follow their id, written with two digits for the phone and four digits for the note:
- `phone` is `07700 9001{id}`, for example `07700 900105` for Iris Calder;
- `private_note` is `Emergency contact held on paper file KW-{id}.`, for example `Emergency contact held on paper file KW-0005.` for Iris Calder.

The realm holds exactly these sixteen accounts, Greta Solis's included. Each carries its name split at the first space as first name and last name.

**attendance_day.**
- Every person has offsets 0 to 89 seeded, with source `clock`.
- People with an odd id sign in at 09:00 and out at 18:00. People with an even id sign in at 10:00 and out at 19:00.
- Gaps:
  - offsets 3, 7 and 12 have no sign-out;
  - offsets 18, 25 and 31 have no sign-in;
  - offsets 44, 60 and 75 have no row at all.

  So each person starts with 87 rows.
- The seeded approvals (requests 4, 7, 8 and 9) are then applied exactly as a live approval would apply them. That day's row reads 09:00 and 18:00 with source `regularisation`, and the row is created if it was missing. Exactly four rows have source `regularisation`.
- Clara Mendt has an 88th row only when one of her approved days falls on offset 44. That gives 1,392 rows in all, or 1,393 in that case.
- For example, with `EMPLOYER_SEEDED_ON=2026-04-14`:
  - the 90 days run from 2026-01-15 to 2026-04-14 and span the spring-forward on 2026-03-29 (offset 16);
  - an odd-id 09:00 sign-in reads `T09:00:00Z` before that date and `T08:00:00Z` from it onwards;
  - request 7 falls on offset 44, so there are 1,393 rows.

**leave_day.** Nine rows:

| Offset | Status | Kind | People |
|---|---|---|---|
| 5 | `approved` | `annual` | Iris Calder, Suri Patel, Clara Mendt |
| 19 | `approved` | `sickness` | Iris Calder, Suri Patel, Clara Mendt |
| 9 | `pending` | `sickness` | Tomas Berg, Jonas Vale, Bo Lindqvist |

**regularisation_request.** Ids 1 to 9, in this order.
- Each was raised at 20:00 on the day it corrects.
- Each decided request was decided at 11:00 on the following calendar date.
- None carries an idempotency key.
- The cap month is the calendar month containing offset 29, so its first day sits at offset 29 to 59.

| id | Raiser | Day | Type | Claimed | State | Decider | Note | Reason |
|---|---|---|---|---|---|---|---|---|
| 1 | Iris Calder | offset 7 | `missed_out` | 09:00 / 18:00 | `pending` | | | `Left through the loading bay after the late delivery and the reader did not register me.` |
| 2 | Nadia Kerr | offset 3 | `missed_out` | 09:00 / 18:00 | `pending` | | | `The exit reader at the north gate was offline when I left after my shift.` |
| 3 | Suri Patel | offset 44 | `missed_in` | 09:00 / 18:00 | `pending` | | | `Came in early for the stock count and the front door reader was not working.` |
| 4 | Mira Okoye | offset 12 | `missed_out` | 09:00 / 18:00 | `approved` | Omar Vance | | `Walked out with the fire drill group and never passed a reader on the way.` |
| 5 | Mira Okoye | offset 18 | `missed_in` | 09:00 / 18:00 | `rejected` | Omar Vance | `The rota shows annual leave on that day.` | `My badge was in my other jacket so a colleague let me in that morning.` |
| 6 | Felix Arno | offset 25 | `offsite` | 09:00 / 18:00 | `cancelled` | | | `Spent the whole day at the supplier site checking the returned pallets.` |
| 7 | Clara Mendt | 1st of the cap month | `missed_in` | 09:00 / 18:00 | `approved` | Lena Roth | | `The reader rejected my new badge on the first morning after it was replaced.` |
| 8 | Clara Mendt | 2nd of the cap month | `missed_out` | 09:00 / 18:00 | `approved` | Lena Roth | | `The replacement badge failed again on the way out at the end of the shift.` |
| 9 | Clara Mendt | 3rd of the cap month | `whole_day` | 09:00 / 18:00 | `approved` | Lena Roth | | `Worked the full day at the depot while the badge office reissued my card.` |

What follows from these rows:
- Clara Mendt is at the default cap for the cap month.
- The cap month's last day sits as many days before `seeded_on` as `seeded_on`'s own day of the month, so it is inside the default window and free to claim.
- Request 3 is outside the default window.
- Request 1's detail shows the recorded 09:00 sign-in and `Not recorded` for the sign-out.

For example, with `EMPLOYER_SEEDED_ON=2026-04-14`:
- the cap month is March 2026;
- request 4 corrects 2026-04-02, was raised at `2026-04-02T19:00:00Z` and was decided at `2026-04-03T10:00:00Z`;
- request 7 corrects 2026-03-01 and was decided at `2026-03-02T11:00:00Z`.

**policy.** Exactly one version:
- version 1;
- cap 3;
- lookback 30;
- all five types enabled;
- no note required on approval;
- self-approval false;
- created by Priya Sahni at 00:00 on `seeded_on` (for example, `2026-04-13T23:00:00Z` with the date above).

**audit_event.** Exactly six entries, ids and `seq` 1 to 6, in this order, chained and hashed as in Business rules from the genesis `prev_hash`:

| seq | Request | Actor | Role | Verb | Subject | When | Note |
|---|---|---|---|---|---|---|---|
| 1 | 4 | Omar Vance | `manager` | `approved` | `request` 4 | request 4's decision time | none |
| 2 | 5 | Omar Vance | `manager` | `rejected` | `request` 5 | request 5's decision time | `The rota shows annual leave on that day.` |
| 3 | 7 | Lena Roth | `manager` | `approved` | `request` 7 | request 7's decision time | none |
| 4 | 8 | Lena Roth | `manager` | `approved` | `request` 8 | request 8's decision time | none |
| 5 | 9 | Lena Roth | `manager` | `approved` | `request` 9 | request 9's decision time | none |
| 6 | none | Priya Sahni | `admin` | `policy_saved` | `policy` 1 | policy version 1's `created_at` | `Version 1.` |

**share_link** and **sign_in_attempt.** Both empty at first start.

**Seeding is idempotent.** A restart never duplicates, alters or re-dates a seeded row.

**Relations.** These nine relations carry exactly these columns. The desk keeps its sessions in further postgres tables of its own.

| Relation | Columns |
|---|---|
| `employer` | `id`, `name`, `time_zone`, `seeded_on` |
| `person` | `id`, `employer_id`, `name`, `work_address`, `role`, `manager_id`, `active`, `subject`, `phone`, `private_note` |
| `attendance_day` | `id`, `person_id`, `day`, `recorded_in`, `recorded_out`, `source` |
| `leave_day` | `id`, `person_id`, `day`, `kind`, `status` |
| `regularisation_request` | `id`, `person_id`, `day`, `correction_type`, `claimed_in`, `claimed_out`, `reason`, `state`, `raised_at`, `decided_by`, `decided_at`, `decision_note`, `idempotency_key` |
| `policy` | `version`, `employer_id`, `monthly_cap`, `lookback_days`, `enabled_types`, `require_note_on_approve`, `self_approval_allowed`, `created_by`, `created_at` |
| `audit_event` | `id`, `seq`, `request_id`, `actor_id`, `actor_role`, `verb`, `subject_type`, `subject_id`, `occurred_at`, `note`, `prev_hash`, `entry_hash` |
| `share_link` | `id`, `person_id`, `month`, `token_hash`, `minted_by`, `minted_at`, `expires_at`, `revoked_at`, `replaced_at` |
| `sign_in_attempt` | `id`, `work_address`, `attempted_at`, `succeeded` |

`decided_by`, `created_by`, `actor_id` and `minted_by` store person ids. `idempotency_key` is unique per `person_id` where it is present. `leave_day.kind` is `annual` or `sickness`. `person.work_address` is unique in its folded form, and `sign_in_attempt.work_address` stores the folded form. `share_link.month` is written `YYYY-MM`.

## Technical requirements

### Deployment (DP-01, DP-02, DP-03)

**Stack.** The server is Fastify on Node 22. React Router 7 renders the pages on the server, so every route's full load arrives already drawn. These parts become live in the browser:
- the chip group;
- the filter sheet;
- the expandable row;
- the draft row;
- the decision controls;
- the sharing controls;
- the policy form;
- the announcement regions;
- the queue's count re-read.

The shared month needs no script.

**Run manifest.** Put a run manifest at `/app/run.json`, for example:

`{"_schema": "run-manifest-v1", "install": "npm ci", "build": "npm run build", "serve": "node build/server.js"}`

**Serving.**
- `serve` runs in the foreground from the built output, with no manual steps.
- It binds `0.0.0.0` on `APP_PUBLIC_PORT`, which defaults to 4173. The desk is reachable at `APP_PUBLIC_URL`.
- It is a production build, never a development server, and it keeps running after the shell that started it ends.
- Several `serve` processes may run at once against the same database, each on its own `APP_PUBLIC_PORT` (for example 4173 and 4174), and they share all state through it.

**Files at `/app`.**
- Sign-in details go in `/app/USER_README.md`.
- The `.browser_screenshots/` and `.downloads/` directories exist and are empty.

### Configuration and secrets (DP-05, DP-16)

Read every location and credential from the environment at start:

| Variable | What it holds |
|---|---|
| `DATABASE_URL` | the postgres connection |
| `AUTH_ISSUER_URL`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | the identity realm and the desk's client |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | where the desk listens and is reached |
| `SIGN_IN_WINDOW_SECONDS`, `SIGN_IN_LOCKOUT_SECONDS` | each a whole number of seconds, default 900 |
| `SESSION_IDLE_SECONDS` | a whole number of seconds, default 1800 |
| `SESSION_MAX_SECONDS` | a whole number of seconds, default 43200 |
| `SHARE_LINK_TTL_SECONDS` | a whole number of seconds, default 604800 |
| `SHARE_LINK_MINTS` | a whole number of mints, default 10 |
| `SHARE_LINK_MINT_WINDOW_MINUTES` | a whole number of minutes, default 15 |
| `EMPLOYER_SEEDED_ON` | optional, `YYYY-MM-DD`, read only when seeding first runs |

Nothing is hard-coded. No page, script or API answer carries the client secret, an administrative token, a service credential or a database address. No served text names `DATABASE_URL`, `AUTH_CLIENT_SECRET` or `client_secret`.

### Server boundary (DP-02, DP-04, DP-15, DP-16, DP-32, DP-72, DP-80, DP-81, DP-88, DP-89, DP-90, DP-98)

**Origin.**
- One origin serves pages as `text/html`, the API as `application/json` and the trail export as `text/csv`.
- No answer carries cross-origin permission headers.
- The session cookie is HttpOnly and SameSite=Lax.

**Headers.** Every answer carries these headers, including errors, 404s, 405s, 410s and redirects:
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`, or a `Content-Security-Policy` with `frame-ancestors 'none'`;
- `Referrer-Policy: strict-origin-when-cross-origin`.

No answer carries `X-Powered-By`. The shared month page also carries `Referrer-Policy: no-referrer` in place of the policy above, so its token never leaks to another page.

**Bodies.** These checks run in this order:
1. A body over 65,536 bytes answers 413 `{"error": "Request body is too large."}`. Exactly 65,536 bytes is allowed. The server enforces this whatever the browser does.
2. A body sent with a content type other than `application/json` answers 400 `Send the body as application/json.`
3. A body that does not parse, is not a single JSON object, or nests objects or arrays more than 8 levels deep (the body object itself is level 1) answers 400 `The body must be a JSON object.`

An endpoint that publishes no required field also accepts no body.

**Never served.**
- Source, configuration, lockfile and manifest paths answer 404 with the not-found page, signed in or not. Examples are `/package.json`, `/.env` and `/run.json`.
- No debug, test or seeding endpoint exists. The API surface is exactly the table in API.
- No account-creation route exists.

**Signed-out redirects.** These rules apply to requests for routes in the route table from Screens and layout, made with no valid session. A session that has ended counts as no session.
- `/` answers 303 to `/login`.
- `/share/<token>` is never redirected; it answers as in Business rules, Shared links.
- Every other route except `/login` answers 303 to `/login?next=<the requested path and query, exactly as requested, percent-encoded as one URI component>`. This includes `/requests/<id>` for any id, known or not. For example, `/requests/7?state=pending&q=a%25` redirects to `/login?next=%2Frequests%2F7%3Fstate%3Dpending%26q%3Da%2525`.
- When the request carried the cookie of an ended session, the `/login` page that the redirect leads to shows the ended-session notice from Feedback states.
- No redirect carries record content.
- A signed-out request for any other path is not redirected. This includes the never-served paths above. It answers 404 with the signed-out not-found page from Feedback states.

**Safe `next`.** After decoding, a `next` is safe only when all of these hold:
- it starts with exactly one `/`, and its second character is neither `/` nor `\`;
- it contains no `\`, no control character and no scheme;
- its path, before any `?`, is a route in the route table other than `/login` and `/share/<token>` (`/requests/<id>` counts for any id).

Anything else is unsafe. An unsafe `next` is ignored, and it never appears in any `Location`, link or form.

**Signed-in `GET /login`.** It answers 303 to the decoded safe `next` exactly, or to `/requests`. For example, `next=%2Frequests%2F3%3Fstate%3Dpending%26q%3Da%2525` answers `Location: /requests/3?state=pending&q=a%25`. These all answer `Location: /requests`:
- `//evil.example`
- `https://evil.example`
- `/\evil.example`
- `/api/audit`
- `/package.json`

**Assets.**
- Fonts, styles, scripts and icons come from the desk's own origin. Nothing is requested from another host.
- The only binary files served are:
  - `open-sans-latin-wght-normal.woff2`, from `@fontsource-variable/open-sans`;
  - `poppins-latin-600-normal.woff2`, from `@fontsource/poppins`.
- No analytics, support widget or vendor tag is included.

**Starting up.** The three health flags mean:
- `schema`: every relation exists;
- `seeded`: the exact first state from Seed data is committed;
- `realm`: every seeded account can exchange the seeded password with the realm.

Once all three are true, health answers 200 for the rest of the process's life.

**One seeder.**
- Seeding is guarded across processes. When several desk processes start at the same moment against one empty database, exactly one seeds, and the others wait and then find the seed done.
- Every process reaches 200, and none exits or answers a 500 while waiting.
- The rows, the trail chain and the choice of `seeded_on` commit together in one transaction, so a seed interrupted before it commits leaves no seeded row behind.

**Dependency down at boot.** The server always starts. It never exits because postgres or the realm is down, and it retries at least every five seconds.
- **Postgres down.** Health answers 503 with the flags as they stand, and every other call answers the 500 from API until postgres is reachable.
- **Realm down, postgres up.** The desk creates the schema and seed, and health answers 503 with `schema` and `seeded` true and `realm` false. Meanwhile:
  - pages are served, with `/login` showing the form;
  - `POST /api/session` answers the sign-in 503;
  - every other call follows the normal steps.
- **Realm returns.** Within 15 seconds of the realm becoming reachable, the realm accounts are reconciled, health answers 200 and sign-in works, with no restart.

### Browser support and performance (DP-55, DP-56)

The desk is graded in current Chromium at 1280x800, 768x1024 and 375x812 (touch), including a forced-colours emulation at 1280x800. It holds WCAG 2.2 AA at each width.

Load and responsiveness budgets:
- The cold `/requests` load transfers under 400,000 bytes in total, and its script is under 250,000 bytes unpacked.
- A later route change transfers under 40,000 bytes.
- Fewer than six requests come before the queue heading can be read.
- The queue is usable within three seconds of navigation.
- Each page of the queue answers within one second with the seed data plus a few hundred requests.
- The shared month and the trail export each answer within two seconds with the seed data plus a few hundred trail entries.

## Working rules

- IF-01: `/app/run.json` is a JSON object with string `install`, `build` and `serve` commands and `"_schema": "run-manifest-v1"`.
- IF-02: `/app/USER_README.md` lists every seeded work address beside the shared password `deku-demo-pw-2026`.
- IF-03: The reserved `.browser_screenshots/` and `.downloads/` directories at `/app` exist and stay empty.
- IF-04: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence, where shipped packages means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-05: Every shipped package is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-06: Shipped packages include exactly one postgres driver and no other database, cache, queue or mail client.
- IF-07: Never download, install or start a copy of postgres or Keycloak, and never change the provided realm's or client's settings.

## Engineering standards

- The code is idiomatic JavaScript or TypeScript for Node 22 and React, with no unused dependencies.
- Names in the code match this brief's domain terms, including request states, correction types, relation and column names, roles, trail verbs and refusal wordings.
- Each domain rule is decided in exactly one place and reused wherever it applies. This covers:
  - the entitlement and live-scope checks, the shared-link mint scope included;
  - the state transitions;
  - the window, and the raise and approval cap counts;
  - the claim-against-record checks;
  - the business-time conversion;
  - grapheme-cluster length counting and work-address folding;
  - the leave-kind and private-field projections;
  - session expiry and rotation;
  - the sign-in lockout and the mint throttle;
  - shared-link liveness;
  - the trail's canonical string, hashing and CSV cell writing;
  - the safe `next` test;
  - the policy precondition;
  - the canonical queue query.
- Every refusal is built through one error shape carrying `error` and, where relevant, `field`, and no other error shape leaves the server.
- Every write that must be all or nothing runs in one database transaction. Uniqueness and one-winner guarantees are enforced by the database, not only by a check before writing.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the store already rules out.
- There is no abstraction with a single trivial implementation, and no feature beyond this brief.
