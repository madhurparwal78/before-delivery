# Tallyroom Workspace

Tallyroom Workspace is one workspace for small product companies of 5 to 40 people. It holds:

- issues, and two-week cycles counted on the company's own working-day calendar;
- team chat with channels and threads;
- shared docs;
- a live office floor plan with rooms you can join or knock on;
- per-seat billing.

One sign-in and one member list cover all of it. Build it as a single TypeScript web app. Changes reach other people's open pages through one live event stream per page.

The backend services are:
- **Postgres**: the system of record, including the mail outbox, the attachment deletion queue, the event log and all state shared between app copies.
- **Mailpit**: receives every email the app sends.
- **Kill Bill**: holds each workspace's per-seat subscription, and its seat count is the confirmed seat limit.
- **MinIO**: stores attachments.

Out of scope:
- creating new workspaces (the seeded workspaces are the only ones);
- payment methods, invoices and payment screens;
- video or audio calls;
- single sign-on;
- push notifications and native apps;
- any datastore other than Postgres and MinIO.

## Problem and users

A product company of this size usually pays for four or five tools: a tracker, a chat app, a docs tool, a virtual-office app and a billing portal for each. Every tool keeps its own member list and seat count. Owners pay for seats nobody uses. A contractor removed in one tool can still sign in to the others. "Who is around right now" sits in a separate tab from the work.

Cycle planning goes wrong more quietly. Trackers count a two-week cycle as fourteen calendar days. A cycle that covers a public holiday or a clock change therefore ends on the wrong day, and burndown charts show weekends as missed work. Engineering leads fix this by hand in a spreadsheet every fortnight.

The company pays twice: once in duplicate seat fees, and again in the hours spent each cycle reconciling dates, unread pings and seat counts.

The users:
- **Workspace owner** (weekly): sets the working calendar and time zone, manages the seat limit and the paid plan, and invites and removes people.
- **Member** (daily): plans issues and moves them through the current cycle, chats in channels and threads, edits specs, and joins rooms on the office floor.
- **Guest** (weekly): works only on the projects and channels they share, attaches files, and knocks on a room to join a review.

The device clock and the browser's time zone may be wrong, or far from the workspace's zone. The server decides every date, expiry and status. People keep the app open in several tabs and on phone and laptop at once, and several copies of the app may serve one workspace at the same time.

## Journeys

1. **Owner sets the working calendar.**
   - Start: Ana, owner of the seeded Kereru Labs workspace, is signed in at the Settings route.
   - She confirms the time zone is Pacific/Auckland and that Monday to Friday are working days, and keeps the two seeded holidays. She starts adding a third holiday on a working day of the current cycle, pauses while two workspace refreshes pass, then finishes and saves. Her half-typed entry survives both refreshes. An earlier attempt with two bad fields shows a summary she follows, link by link, to each field.
   - End: the calendar confirmation is announced and the calendar lists three holidays. Ben, a member whose browser is set to a European zone, already has the Cycle module open. Within the refresh window his ribbon shows the new holiday as a crease, without a reload, and his Today line shows the date as it is in Auckland. Finished cycles are unchanged.
2. **Member triages by keyboard.**
   - Start: Ben is on the Issues route, filtered to Kiln through the project filter. The address shows the filter.
   - He reloads, and the filter and rows are the same. Using only the keyboard, he selects an issue, opens the status picker with its shortcut and moves the issue to In progress. He then opens the assignee picker on another issue and assigns it. While he works, Chiara moves a third issue, and its row updates in place.
   - End: each change is announced, the list shows the new status and assignee, and focus is back on the row where he started.
3. **Member plans the cycle on the crease ribbon.**
   - Start: Chiara opens the Cycle module.
   - The ribbon first draws one column per calendar day. It then folds weekends and holidays into labelled creases, and the counter switches to the working-day count. She unfolds a holiday crease to read why it is not counted. She then drags an issue chip, from the ribbon or from the unplaced tray, onto a weekend crease. On her phone she does the same with a long press.
   - End: the issue's due date lands on the next working day and the move is announced. The burndown covers working days only. When a later move fails to save, the chip goes back to where it was and she hears that the due date was not saved.
4. **Member catches up in chat.**
   - Start: Dev opens the seeded channel that has no messages and sees its empty-state copy.
   - He posts a message that mentions Elin, and Ben replies in a thread. Elin has the app open in two tabs.
   - End: within 2 seconds, without a reload, her badge for that channel and her inbox count each rise by one in both tabs. She gets one mention email. Both badges clear in both tabs once she reads the channel in one of them. When Dev's next send loses its response, his message shows as not sent. He retries it, and it appears in the channel exactly once.
5. **Two members edit one spec.**
   - Start: Ben and Chiara both open the doc "Kiln launch spec". Ben's copy contains accented letters, emoji, blank lines and mixed line endings.
   - Chiara saves first. Ben then saves his older copy.
   - End: Ben is told a newer version exists and is offered Keep mine or Load theirs. He picks Keep mine, and his text is saved as the next version exactly as he typed it. Chiara sees that version on her open page. Later someone restores an older version from Version history. It comes back as a new version, and the versions after it stay listed.
6. **Guest joins and works on Kiln.**
   - Start: Ana invites a new contractor as a guest on the Kiln project and the #kiln-review channel. The contractor gets an email telling them to sign in with that address.
   - They create an account with that address, land on Your invitations, join, land on the welcome screen, and go to Issues.
   - End:
     - They see only Kiln and #kiln-review: Kiln's burndown, Kiln's chips, and the people they share work with.
     - They attach a file whose name has accents and quotation marks to a Kiln issue and hear it attached. A member downloads it under its original name.
     - They knock on the private Review Room, which Ben joined directly while it was empty, and Ben lets them in.
7. **Owner changes seats.**
   - Start: Ana opens Settings and sees the seats used against the limit.
   - She raises the limit by one, then asks for one seat fewer.
   - End: the new limit and monthly total show only after billing confirms the raise. The reduction stays scheduled for the end of the paid period, and Settings says so. A later attempt to go below the number of active people is refused with the published copy. When someone changes the seat count directly in billing, Settings shows that value within the freshness window. When billing is unreachable, the billing notice shows, the old limit stays, and her typed seat count and the status message survive every refresh.
8. **Owner works through a mail outage.**
   - Start: mail delivery is down.
   - Ana sends two invites, and a member posts a mention.
   - End: the invites and the message are all created. Ana sees the mail-delayed notice with the held count. She revokes one invite, and the count drops by one in the very next status check. The remaining held emails stay in the outbox until mail is back, then go out once each without a restart. The revoked invite's email never goes out.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Workspace sign-in** People sign in with email and password and get a session cookie, and every page and API call except sign-in, account creation, health and status requires that session.
- **DP-02 — Workspace scoping** Every record a person can read or change belongs to their own workspace, and another workspace's records answer as if they did not exist.
- **DP-03 — Guest visibility** A guest sees and acts only on the projects and channels they currently share, and everything else answers as not found.
- **DP-04 — Removal ends access** When the owner removes a person, that person's next request is rejected as signed out, their open event streams are revoked and closed within 2 seconds, their seat is freed, and they leave every channel and room.
- **DP-05 — Sign-in journey** A seeded member signs in, lands on the Issues route of their workspace, and signs out back to the sign-in route.
- **DP-06 — Working calendar settings** The owner sets the workspace time zone, working weekdays, holiday list and first cycle start, with field errors for invalid values as qualified in Business rules.
- **DP-07 — Workspace today** The server reports today's date and whether it is a working day in the workspace time zone, and the Today line shows that server date, refreshed within 10 seconds, never the browser's own date.
- **DP-08 — Cycle boundaries** Each cycle is ten counted days that start at midnight workspace time on its first counted day and run until the next cycle starts, across clock changes, with missing and repeated midnights resolved as qualified in Business rules.
- **DP-09 — Digest schedule** The owner and each member get one digest email at eight in the morning workspace time on each counted day, listing only issues they can see, and the workspace reports when the next one is due.
- **DP-10 — Calendar journey** The owner adds a holiday in the current cycle through refreshes without losing the edit, and a member in another browser zone sees the new crease and the Auckland today on an already open ribbon.
- **DP-11 — Issues and keys** Members and guests create issues in projects they can see, and each issue's key is the project key plus the next number in that project.
- **DP-12 — Issue status flow** An issue moves only along the published status edges, and a parent cannot be done while any sub-issue is still open.
- **DP-13 — Cycle rollover and attribution** An open issue from an ended cycle reports the current cycle, and a closed issue counts toward the cycle in which it was closed, including on non-working days.
- **DP-14 — Due dates on working days** A due date set on a non-working day is stored as the next working day, and the response says it was moved.
- **DP-15 — Issue pickers and shortcuts** In the Issues and Cycle lists, shortcuts open the status and assignee pickers for the selected issue whichever list control has focus, and closing a picker returns focus to where it started.
- **DP-16 — Triage journey** A member filters Issues to one project, reloads, and triages with the keyboard alone, moving one issue to In progress and assigning another, and hears each change announced.
- **DP-17 — Crease fold** Opening a cycle draws one equal column per calendar day, then folds non-working days into labelled narrow creases, widens the working columns and changes the counter to the working-day count.
- **DP-18 — Crease unfold** Clicking a crease or pressing Enter on it unfolds that day to show that it is not counted, why, and any clock change, and moving focus away folds it again.
- **DP-19 — Burndown over working days** The cycle burndown plots open issues on counted days only, lists the same values as text with one entry per counted day, and matches the viewer's cycle burndown from the API.
- **DP-20 — Ribbon with reduced motion** With reduced motion requested, the ribbon appears already folded with the final counter, and unfolding swaps instantly.
- **DP-21 — Cycle planning journey** A member opens the current cycle, unfolds a holiday crease and drags an issue chip onto a weekend crease, and its due date lands on the next working day, shown and announced.
- **DP-22 — Channels and threads** Channel members post messages and thread replies, and authors and the owner can delete them.
- **DP-23 — Unread counts** Each person's per-channel and inbox unread counts always equal their unread visible messages after replies, deletions, read marks from any tab and channel removal.
- **DP-24 — Mentions** Mentioning a channel member by handle puts the message in their inbox, updates their open pages within 2 seconds, and queues one mention email for them.
- **DP-25 — Typing indicator** While someone types in a channel, the other members' open pages show who is typing within 2 seconds, and the indicator clears within the published delay after the last keystroke.
- **DP-26 — Message replay** Re-sending a message with the same idempotency key returns the first result without posting twice, and a different message under that key is rejected.
- **DP-27 — Chat journey** A member opens an empty channel, posts a mention and gets a thread reply, and the mentioned member's badges rise in two open tabs without reload and clear in both after reading.
- **DP-28 — Versioned doc saves** A doc save made against an outdated version never overwrites and is answered with the newer version, and of two simultaneous saves from one version exactly one wins.
- **DP-29 — Conflict choice** When a save conflicts, the editor offers Keep mine or Load theirs and announces the conflict and its outcome in the doc status region.
- **DP-30 — Doc conflict journey** Two members edit the same spec, the second save hits the conflict, and choosing Keep mine saves a new version that both members then see.
- **DP-31 — Attachments stored first** An attachment on an issue, message or doc is listed only after its file is stored, and a failed upload leaves no attachment and no stored object behind.
- **DP-32 — Attachment access** An attachment downloads only for people who can see its parent record, and everyone else gets not found.
- **DP-33 — Upload announcements** An upload announces its start and its result, or the published failure copy, in the upload status region.
- **DP-34 — Guest attachment journey** The guest attaches a file with an accented, quoted name to a Kiln issue and hears it attached, and a member then downloads the same bytes under the original name.
- **DP-35 — Office floor and presence** The office floor shows every room, who is inside and whether each person is active or away, as decided by the server and shown on every open page within 2 seconds of a change.
- **DP-36 — Knock lifecycle** Anyone joins an empty private room directly, knocking on an occupied private room creates a waiting knock, and an occupant lets the knocker in or turns them away before the server expires it after the published window or when the room empties.
- **DP-37 — Knock status from the server** The knocker's door status shows exactly the server's knock status, including after a reload during the wait and whatever the device clock says.
- **DP-38 — Answering a knock** An occupant answers knocks one at a time from a dialog with the keyboard alone, and focus returns to where it was before the dialog opened.
- **DP-39 — Office knock journey** A member joins the empty Review Room directly, the guest knocks, and the member lets them in, after which the guest appears inside the room on both people's floor plans.
- **DP-40 — Invites and seats** The owner can invite people as members or guests only while active members plus pending invites stay below the confirmed seat limit.
- **DP-41 — Invite email** Each invite queues one email to the invited address that tells the person to sign in with that address and carries no link token.
- **DP-42 — Invite expiry** An invite expires on the server after its published window, and accepting it after that shows the expired screen whatever the device clock says.
- **DP-43 — Last free seat** When two invitees accept the last free seat at the same moment, exactly one joins, the other sees the full-workspace screen, and active members never exceed the seat limit.
- **DP-44 — Invite acceptance journey** The owner invites a new person, who creates an account with that address, joins from Your invitations, and passes through each published landing route into the workspace.
- **DP-45 — Per-seat subscription** Each workspace has one Kill Bill account and one per-seat subscription, and the seat count recorded there is the workspace's seat limit.
- **DP-46 — Seat changes confirmed by billing** A raised seat limit takes effect only after Kill Bill confirms it, a reduction follows DP-83, and when Kill Bill fails the old limit stays and the owner sees the billing notice.
- **DP-47 — Billing journey** The owner raises the seat limit and sees the confirmation and the new monthly total, then fails to lower the limit below the active members.
- **DP-48 — Mail outbox** Every email is written to an outbox first and delivered to Mailpit exactly once even when several app copies share the database, and while mail is down it stays held and the owner sees the held count.
- **DP-49 — Mail recovery journey** The owner sends invites while mail is down, revokes one, and sees the invites created and the mail-delayed notice with the held count following each change.
- **DP-50 — Database outage** When the database is unreachable, the app keeps serving its pages and health check, answers every other API call with the database error, and shows the database notice.
- **DP-51 — Service notices** The app reports the state of each service and shows the published notice for each one that is down or delayed, and no notice for a service that is ok.
- **DP-52 — Published breakpoints** Below 768 pixels wide the workspace is one pane with a bottom tab bar, from 768 to 1279 it is list plus detail, and from 1280 it is the rail, list and detail.
- **DP-53 — Dialogs and focus return** Every dialog and picker keeps Tab and Shift+Tab inside itself, closes on Escape, and returns focus to the control that opened it.
- **DP-54 — Verbatim copy** Every string this brief prints in backticks renders and is announced character for character.
- **DP-55 — Health and run manifest** The app installs, builds and serves from the run manifest, and it answers the health check while any dependency is down.
- **DP-56 — Server boundary** The server accepts same-origin requests only, enforces the published body limits, and never serves source files or credentials.
- **DP-57 — Drafting-sheet look** Every screen reads as a ruled drafting sheet with the published colour roles, type families and tabular numerals, and a title block on the detail sheet.
- **DP-58 — Drawn floor plan** The office floor is a drawn plan of ruled rooms on a shared grid with doors, labels and presence marks, not a list of cards.
- **DP-59 — Real providers and env credentials** Billing, mail and file storage go through Kill Bill, Mailpit and MinIO with credentials read from the environment and no stand-in state, and a dependency that was unreachable is retried until it returns without a restart.
- **DP-60 — Per-viewer derived surfaces** Burndown, ribbon chips, the unplaced tray, the project filter, the assignee picker, filtered issue lists, the member list and the digest are computed only from what the viewer can see, and seat counts appear only for the owner.
- **DP-61 — Published landing routes** After sign-in, account creation, joining and every navigation the address bar shows the published route, reloading it shows the same screen, sign-in follows only a same-origin next path, and hidden records show the not-found copy.
- **DP-62 — Issue filters in the address** The Issues project and cycle filters live in the address, survive reload, Back, Forward and shared links, and the list always shows the result of the latest choice.
- **DP-63 — Honest message sends** A sent message shows at once as sending, is marked not sent when the request fails, is retried with the first attempt's idempotency key so a lost response never posts twice, and a stream copy of it never adds a second article.
- **DP-64 — Refresh keeps edits** The 10-second workspace refresh updates the Today and Next digest lines in place without resetting unsaved calendar edits, an unfolded crease or focus, and redraws a changed calendar on the open ribbon already folded.
- **DP-65 — Doc text stored as submitted** Doc titles and bodies are stored and returned exactly as submitted, with length limits counted in Unicode code points, text that cannot be stored refused, and unedited line endings kept, including the text saved by Keep mine.
- **DP-66 — Safe attachment downloads** Every attachment download is sent as an attachment with nosniff, the published encoded filename header and an opaque content type for active types, while the record keeps the original name and type.
- **DP-67 — Held mail follows its record** Revoking an invite, deleting a mentioning message, removing a person or removing a person from a channel drops the related held mail in the same change, so the held count falls at once and that mail is never sent.
- **DP-68 — Live notices in place** Service notices and the Attach file buttons change in place within 10 seconds of a service state change without losing drafts, open dialogs, scroll position or focus.
- **DP-69 — Honest chip moves** A chip moved on the ribbon moves at once, and when the server does not save the move it returns to where it was and the failure is announced with focus kept on the chip.
- **DP-70 — Knock dialogs survive updates** Live floor and knock updates never reopen, duplicate or close the open knock dialog or move its focus, and a knock decided elsewhere or expired closes it with the published announcement.
- **DP-71 — Kill Bill seat count is the limit** Every seat limit the app uses or returns was read from Kill Bill no more than 10 seconds earlier, so a change made directly in Kill Bill is adopted and enforced within 10 seconds, as qualified in Services.
- **DP-72 — Live event stream** The workspace event stream delivers every change to messages, threads, unread counts, typing, presence, the floor, knocks, issues and docs to other open pages within 2 seconds, and a reconnect replays each missed event exactly once in order.
- **DP-73 — Access checked on every event** Losing a channel, a project or the workspace stops every matching event on already open streams at once, sends one revoked event within 2 seconds, and keeps the lost scope out of any replay.
- **DP-74 — Presence belongs to the person** Room occupancy and typing belong to the person rather than the tab, so closing one of two tabs or reloading changes nothing for others, and a person leaves their room only after the grace period once their last stream closes.
- **DP-75 — Streams release on abort** Closing or aborting the event stream releases its database session and listeners at once, so repeated aborts leave no session held or idle in a transaction and the next request answers normally.
- **DP-76 — Calendar changes from today** A calendar change applies from the workspace's current date, so finished cycles keep their dates, counted days, burndown and issues on every surface for every viewer, and the current cycle changes only from today on.
- **DP-77 — Sign-out clears the page** Signing out or any unauthenticated answer discards everything the page holds for that person, including late responses and the event stream, as qualified by DP-80, and no response depends on state held between requests, so the next person on that tab sees only their own work.
- **DP-78 — Calendar error summary** A failed calendar save reports every failing field at once in a linked summary that survives refreshes, and announces the problem count.
- **DP-79 — Touch drag and live ribbon alignment** A long press on a chip starts a touch drag under the same rules as a mouse drag, each burndown circle stays centred on its working-day column, folded or unfolded, and a reduced-motion change applies to the next ribbon animation without a reload.
- **DP-80 — Lost session keeps the doc edit** When a session ends with unsaved doc edits in the editor, the same person signing back in on that tab gets the text and base version restored, and anyone else never sees them.
- **DP-81 — Office at every viewport** The whole floor plan with tappable rooms and the knock dialog fit inside every published viewport on any module, and a private room that empties or a removed knocker expires waiting knocks at once.
- **DP-82 — Billing form survives refreshes** A typed seat count, the pending state of Update seats and a failed change's status message all survive every later refresh until the next seat action.
- **DP-83 — Seat reductions wait for the paid period** A seat reduction is stored in Kill Bill for the subscription's charged-through date, keeps the current limit until then, applies on the first read on or after that date, and is cleared by a raise or a request for the current limit.
- **DP-84 — State shared across app copies** Typing, stream counts, occupancy, presence, held mail, the confirmed seat limit and idempotent replay behave as one state across app copies sharing a database, and each server-timed change yields exactly one stored event.
- **DP-85 — Events visible in id order** An event becomes visible to replay and to live streams in id order, so no reader can pass an event that commits later.
- **DP-86 — Live issues** Issue changes reach everyone who shares the project within 2 seconds and update lists, ribbon, tray and burndown in place, keeping selection, focus, an open picker and a pending chip move.
- **DP-87 — Pickers stay reachable** A status or assignee picker opened on any row, including the last row of a scrolled list, shows every option inside the viewport, unclipped and choosable, at every published viewport.
- **DP-88 — Hidden panes are unavailable** Below 768 pixels wide the pane not shown cannot be reached by Tab, by assistive technology or by shortcut, and moving between list and detail places focus as published.
- **DP-89 — Deletion reaches storage** Deleting a message removes its attachment rows at once and their stored objects through a durable queue, even when storage is down at the time.
- **DP-90 — Password change ends other sessions** Changing a password ends every other session of that person at once and revokes their open event streams within 2 seconds, while the session that made the change stays signed in.
- **DP-91 — Exact doc restore** Restoring an older doc version creates a new version byte-equal to it, keeps every later version listed, and follows the same version conflict rule as a save.

## Frontend

### Screens and layout (DP-05, DP-07, DP-35, DP-44, DP-52, DP-57, DP-58, DP-60, DP-61, DP-62, DP-81, DP-88, DP-90)

The signed-in workspace has six modules: Issues, Cycle, Chat, Docs, Office and Settings. Settings is for the owner only. Every module has a list and a detail sheet.

**Issues.**
- The list shows the visible issues for the chosen project and cycle. By default it shows every project the person can see and the current cycle.
- Rows are grouped by status in the order Backlog, Todo, In progress, In review, Done, Cancelled. This is the status order. A group with no rows is not shown.
- Within a group, rows are ordered by project key A to Z, then by issue number ascending. This is the Issues list order.
- Each row shows key, title, status, assignee and due date.
- The detail sheet shows one issue: title, description, status, assignee, cycle, due date, parent and sub-issues, and attachments.

**Cycle.**
- The list shows the cycle's issues in the Issues list order.
- The detail sheet shows:
  - the cycle header: `Cycle <number>`, the date range from first to last working day, and the length counter;
  - a `Today: <date>` line;
  - the crease ribbon, with chips for the cycle's issues placed in the columns of their due dates;
  - the unplaced tray above the ribbon, holding chips for the cycle's issues that have no due date or a due date outside the cycle's days;
  - the burndown, with its values also listed as text.
- Previous and next buttons switch cycles.
- Every surface in this module comes from the viewer's own Cycle and issue responses. A guest's chips, tray, burndown and list therefore contain only issues they can see.

**Chat.**
- The list shows Inbox first, then the person's channels, each with its unread badge.
- The detail sheet shows the selected channel's top-level messages, oldest first, with reply counts, the typing line and the composer.
- A thread opens as a sheet over the detail, with the root message, its replies and a reply composer.

**Docs.**
- The list shows the visible docs.
- The detail sheet shows the title field, the body editor, the version number, the last editor and the attachments. For a guest the title and body are read-only, and the save and history controls are not shown.

**Office.**
- The list shows rooms, each with its occupant count and whether its door is open or private.
- The detail sheet shows the drawn floor plan, and the door status for a room you have knocked on.

**Settings** (owner only): the working calendar form, seats and billing, members, invites and the password form. Seat counts appear nowhere else and to no one else.

**Account** (members and guests): the password form only.

The detail sheet carries a small ruled title block in its top-right corner, as on a drafting sheet. It shows the record's key or name, its state, and the date it was last changed.

**Screens outside the workspace.**
- **Sign-in**: the sign-in form and a link to create an account.
- **Create account**: the account form.
- **Your invitations**: one card per invite addressed to the person's email, with the workspace name and the server's status for the invite.
- **Welcome**: the welcome heading and a link to Issues.
- **Outcome screens** for an invite that cannot be accepted: full workspace, expired and withdrawn. They are shown at the Your invitations route.

The copy for all of these screens is in Feedback states.

**Routes.** These are the published routes. Each route shows the same screen when reloaded or opened directly.

| Route | Screen |
|---|---|
| `/sign-in`, `/create-account` | sign-in, create account (public) |
| `/invitations` | Your invitations, and the invite outcome screens |
| `/welcome` | welcome after joining |
| `/issues`, `/issues/<key>` | Issues module, with the issue open in Detail |
| `/cycle`, `/cycle/<number>` | Cycle module for the current cycle, or for that cycle |
| `/chat/inbox`, `/chat/<channel id>` | Chat module with the inbox, or with that channel open |
| `/docs`, `/docs/<doc id>` | Docs module, with the doc open |
| `/office` | Office module |
| `/settings` | Settings (owner) |
| `/account` | Account (members and guests) |

The Issues routes carry their filters in the query string, as set out in Interactions. Module links point at `/issues`, `/cycle`, `/chat/inbox`, `/docs`, `/office` and `/settings`.

**Landing rules.**
- A signed-out visit to `/` goes to `/sign-in`.
- A signed-out visit to any other non-public path goes to `/sign-in?next=<path>`. Here `<path>` is the requested path with its query string, percent-encoded.
- After sign-in, the person lands on `next` when it starts with exactly one `/` and is not followed by a second `/` or a `\`. Anything else, including a missing `next`, a scheme or `//evil.test`, lands on `/issues`. A person with no workspace always lands on `/invitations`.
- Create account lands on `/invitations`.
- A successful join lands on `/welcome`.
- A signed-in person with no workspace who opens `/`, `/account` or any module route goes to `/invitations`.
- A person in a workspace who opens `/`, `/invitations`, `/welcome` (after leaving it), `/sign-in` or `/create-account` goes to `/issues`.
- A member or guest who opens `/settings` goes to `/issues`. The owner who opens `/account` goes to `/settings`.
- A record route for something unknown or hidden from the person, for example `/issues/ATL-1` as the seeded guest, shows the not-found copy in `region "Detail"`, and the address stays as opened. So does any unknown path under a module.
- Sign-out lands on `/sign-in`.
- A removed person's next navigation, or the revoked workspace event, lands on `/sign-in` with the signed-out copy.
- A session that ends while the doc editor holds unsaved changes lands as set out for DP-80 in Interactions.

All redirects replace the history entry, so Back never returns to a page that would just redirect again.

**Dates and numbers.** Dates on screen read like `Sat 24 Oct`: weekday, day and short month, in the workspace calendar. Times use the 24-hour clock. Every date, time and count is set in tabular monospaced numerals.

**Layout per published viewport.** No viewport may scroll horizontally.
- **1280x800 and wider**: a narrow icon rail at the left edge (`navigation "Modules"`, vertical), then `region "List"`, then `region "Detail"`, side by side and all visible at once.
- **768x1024, and anything from 768 up to 1279 wide**: `navigation "Modules"` as a single row across the top, with `region "List"` and `region "Detail"` side by side below it.
- **375x812, and anything below 768 wide**:
  - One pane shows at a time. On Issues, Chat and Docs the list shows first. On Cycle, Office, Settings and Account the detail shows first, because the module's main surface is there, and `button "Back"` shows the list. On a record route the detail shows first.
  - Opening an item replaces the list with the detail and a `button "Back"`.
  - `navigation "Modules"` is a tab bar fixed to the bottom edge, fully inside the viewport.
  - The Cycle ribbon fits the screen width, with all columns visible at once.
  - The whole floor plan fits the pane width, with every room's button at least 44 by 44 pixels.
  - The pane not shown is hidden and inert: nothing in it is visible, in the Tab order or in the accessibility tree.

No breakpoint other than 768 and 1280 changes which of these layouts a published viewport gets.

### Public screens and controls (DP-01, DP-06, DP-15, DP-17, DP-18, DP-22, DP-25, DP-29, DP-33, DP-35, DP-38, DP-40, DP-46, DP-51, DP-61, DP-62, DP-63, DP-68, DP-78, DP-82, DP-90, DP-91)

Only these roles and names are public; everything else is up to you. `<placeholders>` follow the definitions in Feedback states. `textbox "Due date"`, `textbox "Holiday date"` and `textbox "First cycle starts"` are plain text inputs that take a date typed as `YYYY-MM-DD`.

| Where | Role and accessible name | Visible copy or behaviour |
|---|---|---|
| Sign-in | `form "Sign in"`, `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `link "Create an account"` | |
| Create account | `form "Create account"`, `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"` | |
| Everywhere signed in | `navigation "Modules"` with `link "Issues"`, `link "Cycle"`, `link "Chat"`, `link "Docs"`, `link "Office"`, `link "Settings"` (owner only); `button "Sign out"`; `link "Account"` (members and guests only) | current module marked `aria-current="page"` |
| Everywhere | `region "Service notices"` holding one `alert` per active notice | copy in Feedback states |
| Everywhere signed in | `status "Announcements"` (polite) | results of issue, assignee, due-date, message, member, invite, calendar and password actions |
| Panes | `region "List"`, `region "Detail"`, `button "Back"` (below 768 only) | |
| Not found | `heading "Not found"` in `region "Detail"` | copy in Feedback states |
| Issues | `combobox "Project filter"`, `combobox "Cycle filter"`, `button "New issue"` | `button "New issue"` opens `dialog "New issue"` with `textbox "Title"`, `textbox "Description"`, `combobox "Project"` and `button "Create issue"` |
| Project filter options | `All projects`, then each visible project name A to Z | default `All projects` |
| Cycle filter options | `Current cycle`, `All cycles`, `No cycle`, then `Cycle <n>` for each cycle from 1 to the current one | default `Current cycle` |
| Issues list | each row is a `row` named `<key> <title>`; inside it `button "Status: <status label>"` and `button "Assignee: <name or Unassigned>"` | |
| Pickers | `listbox "Status"` with one `option` per legal next status label, in the status order from Screens and layout, skipping statuses that are not legal next moves; `listbox "Assignee"` with `option "Unassigned"`, then one `option` per active person who can see the issue's project, by name A to Z | a picker opens with focus on its first option |
| Issue detail | `textbox "Due date"`, `button "Attach file"` | |
| Cycle | `button "Previous cycle"`, `button "Next cycle"`, `status "Cycle length"`, `region "Cycle ribbon"`, `img "Burndown"`, `list "Burndown values"` with one `listitem` per burndown entry in date order reading `<date>: <n> open` (it may be visually hidden but stays in the accessibility tree) | counter reads `<calendar days> days`, then `10 working days`; `img "Burndown"` is drawn as a vector graphic holding one circle per burndown entry, in date order |
| Cycle ribbon | one `button` per crease named `<date>, not counted`, with `aria-expanded`; one `group` per working day named `<date>`; issue chips as `button "<key> due <date>"`; `group "Unplaced"` above the ribbon holding chips named `button "<key> due <date>"`, or `button "<key>, no due date"` when there is no due date | an unfolded crease shows `Not counted`, the reason from Business rules and any clock-change copy; a working-day group with a clock change shows that copy too |
| Chat list | `link "Inbox"` or `link "Inbox, <n> unread"`; `link "#<channel>"` or `link "#<channel>, <n> unread"` | the badge shows `<n>`; no badge at zero |
| Channel | `textbox "Message #<channel>"`, `button "Send"`, `button "Mark channel read"`; each message is an `article` with `button "Reply in thread"` and, for its author or the owner, `button "Delete message"`; a failed send's `article` holds `button "Retry send"` | typing line in `status "Typing"`; send states in Feedback states |
| Thread | `complementary "Thread"`, `textbox "Reply"`, `button "Send reply"`, `button "Close thread"` | replies use the same send states and `button "Retry send"` |
| Docs | `textbox "Doc title"`, `textbox "Doc body"`, `status "Doc status"` (polite), `button "Attach file"`; for the owner and members `button "Save doc"` and `button "Version history"` | |
| Doc conflict | `dialog "Newer version saved"` with `button "Keep mine"`, `button "Load theirs"` | |
| Version history | `dialog "Version history"` with one `button "Restore version <n>"` per version older than the current one, newest first | |
| Uploads | every `button "Attach file"` opens the file chooser, and has `aria-disabled="true"` while storage is unavailable; `progressbar "Upload progress"`; `status "Upload status"` (polite); each attachment as `link "<filename>"` | |
| Office | `region "Office floor"` (the drawn plan); each room as `button "<room>, <n> inside"`; `status "Knock status"` (polite) for the knocker | an open room, or a private room with nobody inside, joins on activation; each private room with someone inside that you are not in has `button "Knock on <room>"` below the plan, and activating that room's plan button moves focus to it |
| Knock answer | `dialog "Knock at <room>"` with `button "Let in"`, `button "Not now"` | at most one in the page at a time, on any module |
| Settings calendar | `form "Working calendar"`, `combobox "Time zone"` (a text field with a list of zone names; a typed value is sent as typed), `checkbox "Monday"` through `checkbox "Sunday"`, `textbox "Holiday date"`, `textbox "Holiday name"`, `button "Add holiday"`, `button "Remove holiday <date>"`, `textbox "First cycle starts"`, `button "Save calendar"`, `region "Calendar errors"` above the form after a failed save, with one `link` per field error | `Next digest: <date> 08:00` from the workspace record |
| Settings seats | `spinbutton "Seats"`, `button "Update seats"`, `status "Billing status"` (polite) | `<active> of <limit> seats used, <pending> pending` and `Monthly total: $<total>` |
| Settings people | `table "Members"` with `button "Remove <name>"` for each person except the owner; `form "Invite"` with `textbox "Invite email"`, `radio "Member"`, `radio "Guest"`, one `checkbox "<project name>"` and one `checkbox "#<channel>"` per item (guest only), and `button "Send invite"`; `table "Invites"` with `button "Revoke invite for <email>"` for each pending invite | |
| Password (Settings, Account) | `form "Password"`, `textbox "Current password"`, `textbox "New password"`, `button "Change password"` | |
| Your invitations | `heading "Your invitations"`; for each invite, `button "Join <workspace>"` while the server says it is pending | |
| Welcome | `heading "Welcome to <workspace>"`, `link "Go to Issues"` (goes to `/issues`) | |
| Outcome screens | heading from Feedback states, `link "Back to your invitations"` | the link reloads the server's statuses |

### Interactions (DP-15, DP-16, DP-18, DP-21, DP-23, DP-25, DP-29, DP-37, DP-38, DP-53, DP-62, DP-63, DP-64, DP-65, DP-68, DP-69, DP-70, DP-72, DP-74, DP-77, DP-78, DP-79, DP-80, DP-81, DP-82, DP-86, DP-87, DP-88, DP-91)

**Issue list keyboard.**
- Tab enters the list on the selected row.
- J and K select the next and previous row in the Issues list order, across status groups. They stop at the first and last row.
- Enter opens the selected issue in the detail sheet and sets the address to `/issues/<key>`, keeping the filter query.
- S opens `listbox "Status"` for the selected row, and A opens `listbox "Assignee"`.
- These shortcuts work whenever focus is anywhere inside `region "List"` on the Issues or Cycle module, including on a row's buttons. They do not work while the person is typing in a text field, or while `region "List"` is the hidden pane.
- A picker opens with focus on its first option, in the option order from Public screens and controls. Up and Down move between options and stop at the first and last option. Enter chooses, and Escape closes without changing anything. Either way, focus returns to the element that had it before the picker opened.
- A chosen status or assignee is sent at once, and its result is announced.
- A picker opened on any row, including the last row of a long scrolled list, opens fully inside the viewport and above every other layer. Every option is visible and can be clicked at all published viewports.

**Phone panes.** Below 768 wide, opening an item moves focus to the detail sheet's title. `button "Back"` returns focus to the row that opened the item.

**Issue filters in the address.**
- The Issues route carries `?project=<project id>&cycle=<value>`. `<value>` is `all`, `none` or a cycle number. Each parameter is left out when it holds its default, which is all projects and the current cycle.
- Every filter change pushes one history entry. Back and Forward restore both comboboxes and the matching rows.
- Reloading or opening a shared address shows the same filters and rows.
- An unknown project id, or an unknown cycle value, falls back to that filter's default. The address is then rewritten in place, without a new history entry.
- When filter choices follow each other quickly, the list always shows the response for the latest choice. A slower answer to an earlier choice is discarded.

**Live issues.**
- `issue` events update the Issues list, Cycle list, ribbon, unplaced tray and burndown in place, with no reload.
- Selection and focus stay on the same key. If that row leaves the current filter, selection and focus move to the next row, or to the last row when none follows.
- An open picker stays open while its row stays in the list. If the row leaves the list, the picker closes and focus moves as above. A choice that has gone stale gets the `can't move` copy from Feedback states.
- An event for a chip with a move pending does not overwrite that chip. The pending move settles or rolls back first.

**Dialogs and pickers.**
- When a dialog or picker opens, focus moves to its first control.
- Tab from the last control goes to the first, and Shift+Tab from the first control goes to the last. Focus never reaches the page behind.
- Escape closes the dialog or picker, and focus returns to the control that opened it.
- A dialog the app opens by itself, such as the knock dialog, returns focus to whatever had focus before it appeared.

**Crease ribbon.**
- Each crease is in the Tab order.
- Clicking a crease, or pressing Enter or Space on it, unfolds that one day to full column width and shows `Not counted`, the reason and any clock-change copy.
- Moving focus elsewhere, or clicking elsewhere, folds it again. Only one crease is unfolded at a time.
- Unfolding keeps the ribbon's total width, so no viewport scrolls sideways.
- Each burndown circle's centre lies within 2 pixels of the horizontal centre of its working-day group, once folded and also while a crease is unfolded.

**Issue chips on the ribbon.**
- Dragging a chip to another column sets the issue's due date to that column's date. Dropping it on a crease sends that date, and the server moves it to the next working day.
- On a focused chip, Shift+Right and Shift+Left move its due date to the next or previous working day.
- Chips in `group "Unplaced"` drag onto any column or crease the same way. Shift+Right on an unplaced chip sets its due date to the cycle's first working day.
- The chip moves to its target at once, while the request is pending. On success it settles in the column of the stored date, and the result is announced.
- If the request fails (a network error or any 5xx), the chip goes back to the column or tray it came from and the failure copy is announced. Focus stays on the chip throughout.

**Touch.**
- Every control and drag works by tap, with no hover-only actions.
- A finger held on a chip for 400 milliseconds, moving no more than 10 pixels, starts a drag. Earlier movement scrolls the page and changes nothing.
- Releasing over a column or crease moves the chip under the same rules as a mouse drag, including the rollback on failure.

**Sending messages.**
- Send, or Enter in the composer, posts the text. A composer that is empty or holds only whitespace sends nothing.
- Each new message gets a fresh idempotency key, generated in the page.
- The message appears at once as an `article` reading `Sending`, at the end of the channel, and the composer clears.
- On success, the sending text goes away and the article takes the server's id and position.
- A stream event or refetch carrying the `client_key` of an article in `Sending` settles that article, whichever arrives first, so there is never a second article.
- On a network error or any 5xx, the article stays with the not-sent copy and `button "Retry send"`. Retry resends the same body with the same idempotency key as the first attempt. A lost response therefore replays the stored message instead of posting a second one.
- While an article shows the not-sent copy, a stream event or refetch carrying its `client_key` adds nothing and does not change it. The channel shows that one article until Retry settles it.
- On a validation error, the article is removed, the text goes back into the composer, and the length copy is announced.
- On `not_found`, the article is removed and the text goes back into the composer. This means the channel is gone for this person.
- Thread replies behave the same way in `complementary "Thread"`.

**Chat reading.**
- Opening a channel marks it read up to its newest shown message. Opening a thread marks that thread read.
- `button "Mark channel read"` does the same without scrolling.
- Badges update from the event stream. A send, delete or read mark made in any tab shows in the person's other open tabs within 2 seconds.

**Live event stream.**
- Every signed-in page in a workspace keeps one event stream open. It uses that stream, not polling, for messages, thread replies, unread badges, typing, presence, the floor, knocks, issues and docs.
- On a dropped connection it reconnects, sending the last event id it saw.
- On `reset`, it refetches the open channel, unread counts, floor, knocks, issue list, cycle and doc list.
- On `revoked`:
  - for a channel, it drops that channel from the list without reload, and shows the not-found copy if that channel was open;
  - for a project, it drops that project's issues, docs and filter option, and shows the not-found copy if one of its records was open;
  - for the workspace, it goes to `/sign-in` with the signed-out copy.
- The page fetches only two things on a timer: `GET /api/status`, and the workspace record.

**Sign-out and lost sessions.**
- Signing out, or any `unauthenticated` answer, discards everything the page holds for that person: lists, unread counts, composer drafts, pending responses and the event stream.
- A response to a request made under the earlier person is discarded and never painted, including when the next person signs in on the same tab without a reload.
- The one exception is a doc edit, below. A deliberate `button "Sign out"` discards that too.

**Unsaved doc edit after a lost session.**
- When any request answers `unauthenticated` while the doc editor holds unsaved changes, the page keeps the title, body, base version, doc id and person id in that tab's session storage, and goes to `/sign-in?next=/docs/<doc id>`.
- After the same person signs in on that tab, the editor restores that text and base version, and `status "Doc status"` shows the restored copy from Feedback states. Nothing is saved until `button "Save doc"` is used. If a newer version is stored by then, that save gets the normal conflict dialog.
- A different person signing in on that tab never sees the draft, and it is deleted.
- The draft is deleted after a successful save or Load theirs.

**Workspace refresh.**
- The workspace record is fetched on load and every 10 seconds. `Today: <date>` and `Next digest: <date> 08:00` update in place from it.
- While `form "Working calendar"` holds any value that differs from the last loaded or saved calendar, a refresh leaves every form field as it is. Otherwise the form shows the refreshed values.
- A refresh never moves focus.
- After a successful save, the form shows the saved values.
- When a refresh shows that the calendar changed (weekdays, holidays, zone or first cycle start), an open Cycle module refetches its cycle. It redraws the ribbon in place, already folded, without replaying the fold. The changed creases therefore appear within 10 seconds of the save.
- A refresh that does not change the calendar leaves the ribbon untouched. An unfolded crease stays unfolded, with `aria-expanded="true"`, and keeps focus.

**Calendar errors.**
- `button "Add holiday"` adds the typed date and name to the form's holiday list without checking them. `button "Save calendar"` sends the whole form, and the server judges every field.
- After a failed save, `region "Calendar errors"` shows one `link` per entry in the answer's `fields`, in form order: Time zone, working days, holidays, First cycle starts. Each link's text is that entry's copy.
- Activating a link moves focus to that field: `combobox "Time zone"`, `checkbox "Monday"`, `textbox "Holiday date"` or `textbox "First cycle starts"`.
- Each failing field has `aria-invalid="true"` and an `aria-describedby` pointing at its error.
- The summary and the form values survive refreshes. A field's error, and its link, clears when that field changes.

**Seat form.**
- An unsaved `spinbutton "Seats"` value survives refreshes.
- `button "Update seats"` has `aria-disabled="true"` while a change is pending, so one activation sends one request.
- The result of the last seat action stays in `status "Billing status"` through refreshes until the next seat action.
- With no such result to show, and a reduction scheduled, `status "Billing status"` shows the scheduled copy from Feedback states, including after a reload.

**Typing.**
- Typing in a composer tells the server at most once per second.
- The typing line shows the server's typing list for the channel, from the stream, naming people in the list's order. Each person appears once, whatever number of tabs they type in.

**Docs.**
- `button "Save doc"` sends the title and body together with the version they were loaded at.
- If the person did not edit the body, the loaded body is sent unchanged. If they did, every line they did not edit keeps its original line ending, and a line they typed or changed ends with a line feed. This also holds for Keep mine.
- On a conflict, `dialog "Newer version saved"` opens. Keep mine re-saves the open text on top of the newer version. Load theirs replaces the editor with the newer version.
- A `doc` event updates the list in place. An open editor with no unsaved changes loads the new version. An editor with unsaved changes is left alone, and its next save follows the conflict rule.
- `button "Version history"` opens `dialog "Version history"`. A restore button sends the open doc's base version. On success the dialog closes and the editor shows the new version. On a conflict the dialog closes and `dialog "Newer version saved"` opens.

**Uploads.**
- While the service status says storage is unavailable, every `button "Attach file"` has `aria-disabled="true"`. Activating it opens no file chooser and announces the storage copy in `status "Upload status"`.
- The buttons enable again in place when the status returns to ok.

**Service notices in place.**
- Notices appear and clear without a reload. Neither change may:
  - move focus;
  - clear any composer or form text;
  - close an open dialog, picker or thread;
  - reset the list's scroll position.

**Knocking.**
- Activating `button "Knock on <room>"` sends the knock and shows the server's status in `status "Knock status"`. Later statuses arrive on the stream.
- After a reload during the wait, the page fetches the person's latest knock for that room and shows the server's status within 2 seconds.
- The page never works out expiry from the device clock.

**Answering knocks.**
- People inside a private room get `dialog "Knock at <room>"` within 2 seconds of a knock arriving, on whichever module they are on and at any viewport. The dialog stays fully inside the viewport. Closing it returns focus, and leaves any draft as it was.
- With several knocks waiting, the dialog shows the oldest. The next one opens only after the current one closes.
- Stream and floor updates never reopen, duplicate or close the open dialog, and never move focus inside it.
- Let in or Not now answers the knock. Escape closes the dialog without answering.
- If the open knock expires on the server, or another occupant answers it first, the dialog closes and the matching copy is announced. Focus then returns to where it was before the dialog opened.

**Office presence.**
- Pointer or keyboard activity in the page tells the server you are active at most once every 30 seconds.
- The floor updates from the stream.
- Reloading a page, or closing one of several, never shows you leaving your room to anyone else.

### Visual design (DP-57, DP-58)

The look is a technical drafting sheet: quiet, ruled and exact.

**Colour roles.**
- A warm paper off-white is the ground.
- A deep graphite ink with a faint green cast is used for text and lines.
- A light warm grey draws the hairline rules on every pane edge and table row.
- A single drafting blue is the accent. It is used only for the current cycle, the keyboard focus ring and your own presence mark on the floor plan, and nowhere else.
- A burnt orange-red signal marks errors, expired states, not-sent messages and service notices.
- Text and controls meet WCAG 2.2 AA contrast on the paper ground.

**Type.**
- IBM Plex Sans Condensed is the display face, used for headings, title blocks and the cycle header. It is upright and narrow, like lettering on a plan.
- IBM Plex Sans is the body face.
- IBM Plex Mono with tabular figures sets every count, date, time, key and amount, so numbers line up in columns.
- Each heading level is about one fifth larger than the level below it, so headings stay only modestly larger than body text.

**Density.**
- Compact. Rows are tight and separated by single hairline rules. There are no cards, shadows or rounded card stacks.
- Interactive controls are still at least 44 by 44 pixels to tap.
- The crease ribbon is the one exception, so that every column fits at 375 wide. A crease is drawn eight pixels wide and at least 44 pixels tall. An issue chip is as wide as its column and at least 24 pixels tall.

**Composition.**
- A drafting-sheet grid: the narrow module rail, a ruled list column, and a detail sheet with its title block in the top-right corner.
- The office floor is a drawn plan of thin-walled rooms, snapped to the same small grid. Each room has a door gap, its name in condensed capitals, and a small round mark for each person inside: filled in ink when active, hollow when away, blue for you.
- Private rooms draw their door closed.
- Icons are thin line icons.

### Motion and effects (DP-17, DP-18, DP-19, DP-20, DP-64, DP-79)

All motion starts quickly and settles softly. Nothing loops for decoration. Live updates from the stream or the refresh change text and marks in place, with no animation.

- **Pane enter and exit.** The detail sheet slides in a short distance from the right and settles in about a fifth of a second. On exit it reverses.
- **Pickers and dialogs.** These fade in and drop slightly into place in under a fifth of a second, and fade out the same way.
- **Notices.** A service notice slides down into the notices region in about a fifth of a second, and slides back up when it clears.
- **Hover and press.** A row or button darkens its background slightly on hover within a tenth of a second. A press nudges the control down by one pixel while it is held.
- **Chip move.** A moved chip glides to its new column in about a fifth of a second. A failed move glides it back the same way.
- **Crease cycle (signature).** On opening a cycle:
  1. The ribbon draws one equal-width column per calendar day of the cycle, and `status "Cycle length"` reads `<calendar days> days`.
  2. About a fifth of a second later, every non-working column narrows to an eight-pixel crease labelled vertically with its short date. Over the same interval the working columns widen together to share the freed width. The fold takes about a third of a second.
  3. As the fold ends, the counter changes to `10 working days`.
  4. The burndown line then redraws over the working-day columns only, in about a third of a second.

  The whole sequence completes within one second of the ribbon appearing.
  - Unfolding a crease widens that one day back to full column width in under a fifth of a second, while the other columns narrow to give it room. Folding it again reverses the same way.
  - Switching to another cycle replays the sequence for that cycle.
  - A redraw caused by a calendar change seen on the workspace refresh does not replay it. The ribbon appears already folded in its new shape.
- **Reduced motion.** When the system asks for reduced motion, every transition above becomes an instant swap:
  - The ribbon renders already folded.
  - The counter shows `10 working days` from the start, without counting.
  - The burndown is drawn in place.
  - Creases stay focusable with the same names, and unfolding and folding swap instantly.
  - A change to this preference while the page is open applies to the next ribbon animation, with no reload.

### Feedback states (DP-29, DP-33, DP-37, DP-42, DP-43, DP-46, DP-48, DP-50, DP-51, DP-54, DP-61, DP-63, DP-65, DP-68, DP-69, DP-70, DP-78, DP-80, DP-82, DP-83, DP-86, DP-90, DP-91)

**Placeholders.**
- `<key>` is an issue key such as `KIL-4`.
- `<status label>` is one of `Backlog`, `Todo`, `In progress`, `In review`, `Done`, `Cancelled`.
- `<name>` is a person's display name.
- `<email>` is an email address as entered.
- `<filename>` is the uploaded file's original name.
- `<date>` uses the date format from Screens and layout.
- `<n>`, `<m>`, `<limit>`, `<active>`, `<pending>` and `<held>` are whole numbers with no separators.
- `<total>` is dollars with two decimals.
- `<workspace>` is the workspace name, and `<owner name>` is that workspace owner's name.
- `<room>` is a room name.
- `<channel>` is a channel name without its `#`.

Every string below renders exactly as printed: straight apostrophes, the same case, digits and full stops. A live-region announcement carries the same characters.

| Action | Pending | Success | Error | Outage |
|---|---|---|---|---|
| Sign in (status line in `form "Sign in"`) | `Signing in` | lands per the landing rules | `That email and password don't match.` | database notice |
| Signed out by removal or session end | | `/sign-in` shows `You've been signed out.` | | |
| Create account | `Creating account` | signed in, at `/invitations` | `An account with that email already exists.`; field errors below the fields | database notice |
| Change password (`status "Announcements"`) | `Changing password` | `Password changed. Other devices were signed out.` | `That current password isn't right.`; `Use 8 to 128 characters.` | database notice |
| Not found (`region "Detail"`) | | `heading "Not found"` and `That item doesn't exist or isn't shared with you.` | | |
| Save calendar (`status "Announcements"`) | `Saving calendar` | `Calendar saved.` | `Calendar not saved: <n> problems.`, or `Calendar not saved: 1 problem.` when exactly one field failed; field copy: `Choose a time zone from the list.`, `Pick at least one working day.`, `The first cycle must start on a working day.`, `The first cycle start can't change after cycle 1 has begun.`, `That date is already a holiday.`, `Give the holiday a name.`, `Holiday names can be up to 60 characters.`, `Enter a date as YYYY-MM-DD.` | database notice |
| Create issue (`status "Announcements"`) | | `<key> created.` | `Cycle <n> has ended. Plan into the current cycle or later.`; title error `Give the issue a title.` | database notice |
| Move issue (`status "Announcements"`) | | `<key> moved to <status label>.` | `<key> can't move from <status label> to <status label>.` (from the issue's current status, then to); `<key> has open sub-issues. Finish or cancel them first.` | database notice |
| Assign (`status "Announcements"`) | | `<key> assigned to <name>.` or `<key> unassigned.` | | database notice |
| Due date, from the field or a chip (`status "Announcements"`) | | `Due date set to <date>.`, or, when the server moved it, `Due date moved to <date>, the next working day.` | `Enter a date as YYYY-MM-DD.`; failed save: `Due date not saved.` | `Due date not saved.` |
| Clock change on a working-day group or unfolded crease | | `Clocks go forward` or `Clocks go back` | | |
| Send message or reply (in the `article`, result in `status "Announcements"`) | `Sending` | the article shows the message | too long: removed, text restored, `Messages can be up to 4000 characters.` announced | `Not sent.` with `button "Retry send"` |
| Empty channel | | `No messages in #<channel> yet.` | | |
| Empty inbox | | `You're all caught up.` | | |
| Typing (`status "Typing"`) | | `<name> is typing`, `<name> and <name> are typing` (the two names in the order of the server's typing list), or `Several people are typing` for three or more | | |
| Save doc (`status "Doc status"`) | `Saving` | `Saved version <n>.` | title: `Give the doc a title.`; title too long: `Doc titles can be up to 200 characters.`; body too long: `A doc can be up to 200,000 characters.`; conflict: `<name> saved version <n> while you were editing. Keep mine or load theirs?`; after Load theirs: `Loaded version <n> from <name>.` | database notice |
| Doc draft restored (`status "Doc status"`) | | `Your unsaved changes were restored.` | | |
| Restore doc version (`status "Doc status"`) | `Saving` | `Restored version <n> as version <m>.` | conflict copy as for Save doc | database notice |
| Upload (`status "Upload status"`) | `Uploading <filename>` | `Attached <filename>.` | `<filename> is too large and was not attached.`; `<filename> is empty and was not attached.`; `That file name is too long. Use 255 characters or fewer.` | `Upload failed: storage is unavailable. Nothing was attached.`; activating a disabled Attach file: the storage notice copy below |
| Knock (`status "Knock status"`) | `Waiting` | `Let in` | `Not now`; `Knock expired` | database notice |
| Knock dialog body | | `<name> is at the door.` | | |
| Answer knock, or dialog closed by the server (`status "Announcements"`) | | `Let <name> in.` or `Told <name> not now.` | `That knock has expired.`; `That knock was already answered.` | database notice |
| Send invite (`status "Announcements"`) | | `Invite created for <email>.` | `No free seats. Add a seat before inviting.`; `<email> already has a pending invite.`; `<email> is already in this workspace.` | billing: `Can't check seats right now. Try again when billing is back.`; database notice |
| Revoke invite (`status "Announcements"`) | | `Invite for <email> revoked.` | | database notice |
| Remove person (`status "Announcements"`) | | `Removed <name>.` | | database notice |
| No invites at `/invitations` | | `No invitations for <email>.` | | |
| Join workspace | `Joining` | `/welcome` with its heading and link | full: `heading "This workspace is full"` with `Ask <owner name> to add a seat, then try again.`; expired: `heading "This invite has expired"` with `Ask <owner name> to send a new one.`; withdrawn: `heading "This invite was withdrawn"` | billing: `heading "We can't check seats right now"` with `Try again in a minute.`; database notice |
| Update seats (`status "Billing status"`) | `Confirming with billing` | raise, or the current limit requested: `Seat limit is now <limit>.`; reduction: `Seat limit stays at <limit> until <date>, then <n>.` | `You have <active> people in this workspace. Remove someone before lowering seats below that.`; `Choose between 1 and 40 seats.` | `Seat limit not changed. It stays at <limit>.` and the billing notice |

Each `alert` in `region "Service notices"` is shown while the service status says so:
- **Database unavailable**, shown to everyone: `Tallyroom can't reach its database. Changes are not being saved.`
- **Storage unavailable**, shown to everyone signed in: `Attachments are unavailable right now. Nothing new can be attached.`
- **Billing unavailable**, shown to the owner on Settings: `Billing unavailable. Your seat limit stays at <limit> until billing is back.`
- **Mail delayed**, shown to the owner only: `Mail delayed: <held> messages waiting to send.`, or `Mail delayed: 1 message waiting to send.` when exactly one message is held.

Notices come from the service status endpoint. The page checks it on load, after any 503, and every 10 seconds. A `notice` stream event also triggers an immediate check. A notice appears, changes its count, or clears within 10 seconds of the status changing.

## Backend

### API (DP-01, DP-02, DP-03, DP-11, DP-12, DP-14, DP-22, DP-23, DP-26, DP-28, DP-31, DP-32, DP-36, DP-40, DP-42, DP-43, DP-46, DP-48, DP-50, DP-51, DP-55, DP-60, DP-63, DP-66, DP-72, DP-73, DP-75, DP-78, DP-83, DP-85, DP-86, DP-90, DP-91)

**Formats.**
- All endpoints are under the app's own origin.
- Request and response bodies are JSON (`application/json`), except uploads (`multipart/form-data`), downloads and the event stream.
- Instants are ISO 8601 with the workspace's UTC offset at that instant, for example `2026-10-19T00:00:00+13:00`.
- Dates are `YYYY-MM-DD` in the workspace calendar.
- Ids of workspaces, projects, channels, docs, rooms, knocks, invites and attachments are UUID strings. Message ids are integers.
- The session is an HttpOnly, SameSite=Lax cookie named `tr_session`.

**Error shape.** Every error body is `{"error":{"code":"<code>","message":"<sentence>"}}`. Validation errors carry `fields` inside `error`: `{"error":{"code":"validation","message":"<sentence>","fields":{"<field>":"<sentence>"}}}`. The message text is free, and so are the `fields` sentences, except that `PUT /api/workspace/calendar` answers with the field copy from Feedback states. Tests and the UI otherwise rely only on `code` and on the `fields` keys.

**Error precedence**, for the whole API:
1. Body size and content type checks.
2. Postgres unreachable (`database_unavailable`), for every endpoint except health and status. Sessions and stored idempotent responses live in the database, so this comes before authentication and replay.
3. Unauthenticated (`unauthenticated`).
4. An idempotent replay returns its stored response.
5. Unknown resource, another workspace's resource, or one hidden from the caller (`not_found`).
6. Role not allowed (`forbidden`). This includes a signed-in person with no workspace calling a workspace endpoint.
7. Validation (`validation`).
8. Storage and billing outages (`storage_unavailable`, `billing_unavailable`).
9. State conflicts.

The billing outage comes before state conflicts because the seat checks need the confirmed limit.

**Error codes.** These are the only statuses this API returns for errors.

| Code | Status | When |
|---|---|---|
| `unauthenticated` | 401 | no valid session, or the person was removed |
| `invalid_credentials` | 401 | sign-in email and password do not match |
| `invalid_credentials` | 403 | the current password given to a password change does not match; the session stays valid |
| `forbidden` | 403 | the person's role, or having no workspace, does not allow this |
| `cross_origin` | 403 | a state-changing request from another origin |
| `not_in_room` | 403 | answering a knock while not inside its room |
| `knock_required` | 403 | joining an occupied private room without being let in |
| `not_author` | 403 | attaching to a message you did not write |
| `not_found` | 404 | as above, and unknown paths under `/api` |
| `validation` | 422 | field errors |
| `too_large` | 413 | body over its limit |
| `unsupported_media_type` | 415 | wrong content type |
| `email_taken` | 409 | account email already registered |
| `illegal_transition` | 409 | status change not on a published edge |
| `open_sub_issues` | 409 | parent moved to `done` with an open sub-issue |
| `cycle_closed` | 409 | planning into an ended cycle |
| `version_conflict` | 412 | doc saved or restored against an outdated version |
| `idempotency_conflict` | 409 | key reused with a different body |
| `room_open` | 409 | knocking on an open room |
| `room_empty` | 409 | knocking on a private room with nobody inside |
| `already_inside` | 409 | knocking on a room you are in |
| `knock_expired` | 409 | answering an expired knock |
| `knock_answered` | 409 | answering an already answered knock |
| `workspace_full` | 409 | no free seat for this invite or acceptance |
| `invite_pending` | 409 | that email already has a pending invite |
| `already_member` | 409 | that email belongs to a person in this workspace |
| `already_in_workspace` | 409 | the accepting person already belongs to a workspace |
| `invite_expired` | 409 | invite past its window |
| `invite_revoked` | 409 | invite revoked |
| `invite_accepted` | 409 | invite already accepted |
| `invite_not_pending` | 409 | revoking an invite that is not pending |
| `seats_below_active` | 409 | new seat limit below active people |
| `owner_required` | 409 | the owner tries to remove themself |
| `database_unavailable` | 503 | Postgres unreachable |
| `storage_unavailable` | 503 | MinIO unreachable |
| `billing_unavailable` | 503 | Kill Bill unreachable or refused, or no charged-through date to schedule a reduction for |

**Idempotency.** `POST /api/channels/{id}/messages`, `POST /api/invites` and `PUT /api/billing/seats` accept an optional `Idempotency-Key` header of 1 to 100 characters.
- The key is scoped to the person and the endpoint. It is kept for `IDEMPOTENCY_TTL_SECONDS` (default 86,400 seconds, 24 hours).
- A repeat with the same key and the same body returns the stored status and body, with the header `Idempotent-Replay: true`. Nothing runs a second time, and no event or email is produced again.
- The same key with a different body returns `idempotency_conflict`.
- Of two concurrent requests with one key, on the same app copy or on different copies sharing the database, the work runs once. The second request waits and replays.
- A 503 response is not stored, so a retry after an outage runs normally.

**Objects.** Every field is always present, with `null` where it is empty.
- **Person**: `{"id","name","email","handle","role":"owner"|"member"|"guest"}`
- **Workspace**: `{"id","name","slug","time_zone","working_weekdays":[ISO weekday 1..7],"holidays":[{"date","name"}],"cycle_anchor":"<date>","today":"<date>","is_working_day":bool,"next_digest_at":"<instant>","seats":{"limit","active","pending"} or null}`. `seats` is an object for the owner and `null` for members and guests.
- **Cycle**: `{"number","starts_at","ends_at","first_working_date","last_working_date","calendar_days","working_day_count","days":[{"date","counted":bool,"reason":null|"<text>","clock_change":null|"forward"|"back"}],"burndown":[{"date","open"}],"issue_keys":[],"is_current":bool,"is_finished":bool}`. `issue_keys` and `burndown` cover only issues the caller can see.
- **Issue**: `{"key","project_id","title","description","status","assignee_id","parent_key","sub_issue_keys":[],"cycle_number","due_date","closed_at","attachments":[Attachment]}`
- **Message**: `{"id","channel_id","author_id","body","thread_root_id","reply_count","mentions":[person id],"created_at","attachments":[Attachment],"client_key"}`. Message ids increase across the workspace. `client_key` is the sender's `Idempotency-Key` when the reader is the author and the send carried one. It is `null` for everyone else, in every response and event.
- **Doc**: `{"id","project_id","title","body","version","updated_by","updated_at","attachments":[Attachment]}`
- **Attachment**: `{"id","filename","size","content_type","parent":{"type":"issue"|"message"|"doc","id"}}`
- **Room**: `{"id","name","kind":"open"|"private","x","y","w","h","occupants":[{"person_id","name","status":"active"|"away"}]}`. `x`, `y`, `w` and `h` are whole grid units.
- **Knock**: `{"id","room_id","person_id","status":"waiting"|"let_in"|"not_now"|"expired","created_at","expires_at"}`
- **Invite**: `{"id","email","role","project_ids","channel_ids","status":"pending"|"accepted"|"revoked"|"expired","created_at","expires_at","workspace_name"}`
- **Billing**: `{"limit","active","pending","price_per_seat":"8.00","currency":"USD","monthly_total":"<limit × 8.00, two decimals>","billing_status":"ok"|"unavailable","account_external_key","scheduled_limit","scheduled_on"}`. `scheduled_limit` and `scheduled_on` are null with no reduction scheduled.

**Endpoints.** The role column says who may call. "Any" means any signed-in person of the workspace. The errors column lists only the endpoint's own codes beyond the general precedence.

| Method and path | Role | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | public | | 200 `{"status":"ok"}` | |
| `GET /api/status` | public | | 200 `{"database":"ok"\|"unavailable","mail":"ok"\|"delayed","storage":"ok"\|"unavailable","billing":"ok"\|"unavailable","held_mail":<int or null>}` | |
| `POST /api/accounts` | public | `{"name","email","password"}` | 201 `{"person":Person}` with role null, session set | `email_taken`, `validation` |
| `POST /api/session` | public | `{"email","password"}` | 200 `{"person":Person,"workspace":Workspace or null}`, session set | `invalid_credentials` |
| `DELETE /api/session` | signed in | | 204 | |
| `GET /api/me` | signed in | | 200 `{"person":Person,"workspace":Workspace or null}` | |
| `POST /api/account/password` | signed in | `{"current_password","new_password"}` | 204 | `invalid_credentials`, `validation` on field `new_password` |
| `GET /api/events` | any | optional header `Last-Event-ID` | 200 `text/event-stream`, as described below | |
| `GET /api/workspace` | any | | 200 Workspace | |
| `PUT /api/workspace/calendar` | owner | `{"time_zone","working_weekdays","holidays","cycle_anchor"}` | 200 Workspace | `validation` |
| `GET /api/cycles/current` | any | | 200 Cycle | |
| `GET /api/cycles/{number}` | any | whole number 1 to 1,000; anything else is `not_found` | 200 Cycle | |
| `GET /api/projects` | any | | 200 `{"projects":[{"id","key","name"}]}`, visible projects only | |
| `POST /api/projects/{id}/members` | owner | `{"person_id"}` of a guest | 204 | `validation` |
| `DELETE /api/projects/{id}/members/{person id}` | owner | | 204 | |
| `GET /api/issues` | any | optional query `project` (a project id), `cycle` (a cycle number, `current` or `none`) and `status` (a status value such as `in_progress`), combined | 200 `{"issues":[Issue]}`, visible issues only, in the Issues list order | `validation` |
| `POST /api/issues` | any | `{"project_id","title","description"?,"assignee_id"?,"parent_key"?,"cycle_number"?,"due_date"?}` | 201 Issue plus `"due_date_snapped":bool` | `cycle_closed`, `validation` |
| `GET /api/issues/{key}` | any | | 200 Issue | |
| `PATCH /api/issues/{key}` | any | any of `title`, `description`, `assignee_id`, `cycle_number`, `due_date` | 200 Issue plus `"due_date_snapped":bool` | `cycle_closed`, `validation` |
| `POST /api/issues/{key}/transition` | any | `{"to":"<status>"}` | 200 Issue | `illegal_transition`, `open_sub_issues`, `validation` |
| `GET /api/channels` | any | | 200 `{"channels":[{"id","name","unread"}]}`, own channels only | |
| `GET /api/channels/{id}/messages` | channel member | | 200 `{"messages":[Message],"typing":[person id]}`, top-level only | |
| `POST /api/channels/{id}/messages` | channel member | `{"body","thread_root_id"?}` | 201 Message | `idempotency_conflict`, `validation` |
| `GET /api/messages/{id}/thread` | channel member | | 200 `{"root":Message,"replies":[Message]}` | |
| `DELETE /api/messages/{id}` | author or owner | | 204, also while storage is down | |
| `POST /api/channels/{id}/read` | channel member | `{"up_to":<message id>}` | 200 the unread body | `validation` |
| `POST /api/threads/{root id}/read` | channel member | `{"up_to":<message id>}` | 200 the unread body | `validation` |
| `GET /api/unread` | any | | 200 `{"channels":{"<channel id>":n},"inbox":n}` (the unread body), every own channel, zeros included | |
| `GET /api/inbox` | any | | 200 `{"items":[Message]}`, unread inbox messages, newest first | |
| `POST /api/channels/{id}/typing` | channel member | `{}` | 204 | |
| `POST /api/channels/{id}/members` | owner | `{"person_id"}` | 204 | `validation` |
| `DELETE /api/channels/{id}/members/{person id}` | owner | | 204 | |
| `GET /api/docs` | any | | 200 `{"docs":[Doc without body]}` | |
| `POST /api/docs` | owner or member | `{"project_id","title","body"}` | 201 Doc at version 1 | `validation` |
| `GET /api/docs/{id}` | any | | 200 Doc | |
| `PUT /api/docs/{id}` | owner or member | `{"title","body","base_version"}` | 200 Doc | 412 `{"error":{...},"current":Doc}` with code `version_conflict`; `validation` |
| `GET /api/docs/{id}/versions` | owner or member | | 200 `{"versions":[{"version","saved_at","saved_by","title","body"}]}`, every saved version, newest first | |
| `POST /api/docs/{id}/restore` | owner or member | `{"version":<n>,"base_version":<m>}` | 200 Doc | 412 as for `PUT /api/docs/{id}`; `validation` on field `version` for the current version or an unknown one |
| `POST /api/issues/{key}/attachments`, `POST /api/messages/{id}/attachments`, `POST /api/docs/{id}/attachments` | can see parent | multipart field `file` | 201 Attachment | `not_author` (messages), `too_large`, `validation`, `storage_unavailable` |
| `GET /api/attachments/{id}` | can see parent | | 200 the stored bytes with the download headers from Business rules | `storage_unavailable` |
| `GET /api/floor` | any | | 200 `{"rooms":[Room],"me":{"room_id","status"}}` | |
| `POST /api/rooms/{id}/join` | any | `{}` | 200 floor body | `knock_required` |
| `POST /api/rooms/leave` | any | `{}` | 204 | |
| `POST /api/presence/heartbeat` | any | `{}` | 204 | |
| `POST /api/rooms/{id}/knocks` | any | `{}` | 201 Knock, or 200 the existing waiting knock | `room_open`, `room_empty`, `already_inside` |
| `GET /api/rooms/{id}/knocks/mine` | any | | 200 the caller's latest Knock for that room | `not_found` if there is none |
| `GET /api/rooms/{id}/knocks` | room occupant | | 200 `{"knocks":[Knock]}`, waiting only, oldest first | `not_in_room` |
| `GET /api/knocks/{id}` | knocker or room occupant | | 200 Knock | |
| `POST /api/knocks/{id}/answer` | room occupant | `{"answer":"let_in"\|"not_now"}` | 200 Knock | `not_in_room`, `knock_expired`, `knock_answered`, `validation` |
| `GET /api/members` | any | | 200 `{"members":[Person]}`, visible people by name A to Z | |
| `DELETE /api/members/{person id}` | owner | | 204 | `owner_required` |
| `GET /api/invites` | owner | | 200 `{"invites":[Invite]}` | |
| `POST /api/invites` | owner | `{"email","role","project_ids","channel_ids"}` | 201 Invite | `workspace_full`, `invite_pending`, `already_member`, `idempotency_conflict`, `validation`, `billing_unavailable` |
| `DELETE /api/invites/{id}` | owner | | 200 Invite | `invite_not_pending` |
| `GET /api/invites/mine` | signed in | | 200 `{"invites":[Invite]}` addressed to the caller's email | |
| `POST /api/invites/{id}/accept` | signed in, invited email | `{}` | 200 `{"person":Person,"workspace":Workspace}` | `already_in_workspace`, `invite_expired`, `invite_revoked`, `invite_accepted`, `workspace_full`, `billing_unavailable` |
| `GET /api/billing` | owner | | 200 Billing | |
| `PUT /api/billing/seats` | owner | `{"seats":<int>}` | 200 Billing | `seats_below_active`, `idempotency_conflict`, `validation`, `billing_unavailable` |

**Event stream.** `GET /api/events` answers 200 with `Content-Type: text/event-stream` and `Cache-Control: no-cache`.

Each event has three fields:
- `id:`, a decimal sequence number. It is strictly increasing per workspace and stored in Postgres with the event.
- `event:`, one of the names below.
- `data:`, a one-line JSON object of the published shape.

| Event | Delivered to | `data` |
|---|---|---|
| `message` | members of the channel | Message (top-level) |
| `thread_reply` | members of the channel | Message (reply) |
| `message_deleted` | members of the channel | `{"id","channel_id","thread_root_id"}` |
| `unread` | the person whose counts changed | the unread body |
| `typing` | members of the channel | `{"channel_id","typing":[person id]}` |
| `presence` | everyone in the workspace | `{"person_id","status":"active"\|"away"}` |
| `room` | everyone in the workspace | Room |
| `knock` | the knocker and the room's occupants | Knock |
| `issue` | everyone who shares the issue's project | Issue, on every create or change |
| `doc` | everyone who shares the doc's project | `{"id","project_id","version","updated_by"}`, on every create, save or restore |
| `notice` | everyone in the workspace | `{}`; the page re-reads the status |
| `revoked` | the person who lost access | `{"scope":"channel"\|"project"\|"workspace","id":"<channel, project or workspace id>"}` |
| `reset` | the reconnecting stream only | `{}`, with no `id:` |

Stream rules:
- A request without `Last-Event-ID` receives live events only.
- A request with `Last-Event-ID: <n>` first receives every stored event after `n` that the person may see now, in id order, each exactly once. Live events follow, with no duplicate of a replayed event.
- Every body is projected for the person receiving it, on replay as well as live. A replayed `unread` body holds only channels the person has now, and `client_key` follows the Message rule. A `message` or `thread_reply` event whose message has since been deleted is skipped on replay, and its `message_deleted` event is still delivered.
- Only the 1,000 most recent events of a workspace are kept for replay. When `n` is older than the oldest kept event (for example `0` once more than 1,000 events exist), the stream sends a single `reset` event instead of a replay, then live events.
- Events become visible in id order. A reader, on replay or live, never moves past an id whose event has yet to commit, so a stored event is never skipped. A delay this causes stays within the 2-second delivery limit.
- The server writes a comment line (`: keepalive`) every 15 seconds.

### Business rules (DP-02 to DP-04, DP-06 to DP-09, DP-11 to DP-14, DP-19, DP-22 to DP-26, DP-28, DP-31, DP-32, DP-35, DP-36, DP-40, DP-42, DP-43, DP-45, DP-46, DP-48, DP-60, DP-65, DP-66, DP-67, DP-71 to DP-76, DP-81, DP-83, DP-84, DP-86, DP-89, DP-90, DP-91)

**Text.**
- Every length limit in this brief counts Unicode code points, not bytes or UTF-16 units. A limit's end value is allowed.
- Titles, bodies, names and filenames are stored and returned exactly as submitted: no trimming, no line-ending change and no Unicode normalisation.
- A field that must be non-empty is rejected when it holds only whitespace.
- Any submitted text holding U+0000 or an unpaired surrogate answers `validation` on its field, and nothing is changed, because it cannot be stored as submitted.

**Scope and roles.**
- Each person belongs to at most one workspace. Every read and write is limited to the caller's workspace.
- A project is shared by the owner, every member, and each guest added to it. A channel is shared by its channel members.
- Guests see only the projects and channels they currently share, and the issues, docs, messages and attachments under them.
- Guests read docs in shared projects and may attach files to them. Only the owner and members create, save, restore or list versions of docs. A guest who calls those on a doc they can see gets `forbidden`.
- A guest sees the owner, every member, and any other guest who shares one of their projects or channels. Members and the owner see everyone.
- The office floor is shared with everyone in the workspace. Room occupants are named for every viewer.
- Only the owner may change the calendar, channel and project membership, seats, invites and members. Anyone else who calls an owner endpoint gets `forbidden`. Project membership changes apply to guests only.

**Derived surfaces.** Every count, list or option is computed per viewer from what that viewer can see:
- cycle `burndown` and `issue_keys`;
- ribbon chips and the unplaced tray;
- project filter options;
- assignee picker options;
- `GET /api/issues` with any filter;
- `GET /api/members`;
- the digest.

Seat counts are returned only to the owner.

**Request isolation.** No answer may depend on state held between requests for a person. Interleaved requests from different people each get exactly what that person would get alone.

**Losing access.**
- Removing a person from the workspace:
  - ends all their sessions, so their next request is `unauthenticated`;
  - takes them out of every channel, project and room;
  - frees their seat;
  - expires their waiting knocks;
  - leaves their issue assignments in place, shown as `<name> (removed)`.
- Every event is checked against the receiving person's access at the moment it is written to their stream, not only when the stream opened.
- After a person loses a channel, a project (a guest) or the workspace, none of their open streams carries any further event from that scope. That means no `message`, `thread_reply`, `typing`, `unread`, `issue` or `doc` for it.
- Within 2 seconds, each of their open streams receives one `revoked` event for that scope. A workspace removal then closes the stream.
- A replay never includes events from a scope the person no longer has.
- Removal from a channel or project also sends that person a fresh `unread` event.

**Accounts.**
- Emails are compared case-insensitively.
- Passwords are 8 to 128 characters. Names are 1 to 80 characters.
- A successful password change makes the old password stop working and the new one work. Every other session of that person ends at once, so its next request is `unauthenticated`. Each stream of those sessions receives one `revoked` event with scope `workspace` and closes within 2 seconds. The session that made the change, and its streams, stay as they were.

**Working calendar.**
- `time_zone` must be an IANA zone name.
- `working_weekdays` is a non-empty set of ISO weekdays, where 1 is Monday.
- Holidays have unique dates and names of 1 to 60 characters.
- `cycle_anchor` may differ from the stored value only while the workspace's today is before the stored anchor. While it can change, it must be a working day under the submitted calendar. Once cycle 1 has begun, the stored anchor is history, and resubmitting it unchanged is valid under any calendar.
- A save reports every failing field in one `fields` object, not only the first:
  - field `time_zone`, `working_weekdays` or `cycle_anchor` for those values;
  - field `holidays` for every holiday error: a date not typed as `YYYY-MM-DD` or not a real date, a duplicate date, or a missing or overlong name.
  - A `cycle_anchor` that is not a real `YYYY-MM-DD` date is also a `cycle_anchor` error.
- A day is *counted* when its weekday is a working weekday and it is not a listed holiday. An uncounted day's `reason` is:
  - the holiday's name, when the day is a listed holiday;
  - otherwise `Weekend` for a Saturday or Sunday;
  - otherwise `Non-working day`.
- **Effective from today.** Each save takes effect from the workspace's local date at the moment of the save, in the zone in effect before it. Whether a day is counted, its reason and its local midnight are decided by the calendar in effect on that day. That is the latest save whose effective date is on or before the day; the seed calendar applies before any save. Adding or removing a holiday dated before today therefore changes nothing before today.
- `today` and `is_working_day` are the server's current date in the zone in effect now.

**Cycles.**
- Cycle 1 begins on `cycle_anchor`. Each cycle is exactly 10 counted days.
- `starts_at` is 00:00 local time on the cycle's first counted day. `ends_at` equals the next cycle's `starts_at`, so cycles tile with no gap.
- The uncounted days after a cycle's last counted day belong to that cycle.
- `days` lists every calendar date from `first_working_date` up to the day before the next cycle's first counted day. `calendar_days` is its length, and `working_day_count` is always 10.
- Across a clock change, both boundaries stay at local midnight. The cycle then lasts one hour more or less in absolute time, and no boundary moves to 01:00 or 23:00, with two exceptions:
  - When 00:00 does not exist on that date, the boundary is the first instant after the gap. For example, in `Africa/Cairo` a boundary on `2027-04-30` is `2027-04-30T01:00:00+03:00`.
  - When 00:00 happens twice on that date, the boundary is the earlier instance. For example, in `America/Havana` a boundary on `2027-11-07` is `2027-11-07T00:00:00-04:00`.
- A day's `clock_change` compares the zone's UTC offset in force just before that local date begins with the offset at the end of that date. It is `forward` when the offset grew, `back` when it shrank, and null when it is the same. Working-day groups and unfolded creases show the matching copy from Feedback states.
- The current cycle is the one whose span contains the server's now, or cycle 1 when now is before the anchor. A cycle is finished once now reaches its `ends_at`. The server's now is the app process clock (`Date.now()`), shifted as set out for `SERVER_CLOCK_START` in Configuration and secrets. Every server date, instant and expiry comes from it, never from database time functions such as `now()` or `CURRENT_DATE`.
- **Finished cycles are fixed.** A finished cycle keeps, on every surface and after any later calendar or issue change:
  - its `starts_at`, `ends_at`, `days`, counted flags, reasons and `clock_change` values;
  - its burndown;
  - its member issues, which are the issues that reported it at its end.

  This holds for `GET /api/cycles/<n>`, `GET /api/issues?cycle=<n>` (which returns those member issues), the ribbon, and digests already sent.
- A finished cycle's stored record is issue-level, reflecting each issue's state at `ends_at`, however late the record is written. Each viewer sees it restricted to what they can see now, so a guest added after the cycle finished sees it limited to the projects they now share. Reopening one of its issues later changes neither its burndown nor its `issue_keys`. Repeated reads by the same viewer with the same access return identical bodies.
- In the current cycle, a calendar change recounts only today and later days. Its start and its earlier days stay as they were, and its end moves so that it still holds 10 counted days. Later cycles follow the new calendar. Issues already rolled forward stay where they are.

**Issues.**
- Titles are 1 to 200 characters. Descriptions are up to 20,000 characters.
- Each project numbers its issues consecutively from 1 in creation order. The key is the project key, a hyphen and the number. Simultaneous creates never share a number.
- `assignee_id` must be an active person who can see the project, or null.
- `parent_key` must name a top-level issue in the same project. Sub-issues cannot have sub-issues.
- `cycle_number` must be a cycle that exists. Planning into a finished cycle answers `cycle_closed`.
- `due_date` is a real date typed as `YYYY-MM-DD`, or null. Anything else is a `validation` error on field `due_date`.

**Status edges** (the only legal moves):
- `backlog` → `todo`, `cancelled`
- `todo` → `backlog`, `in_progress`, `cancelled`
- `in_progress` → `todo`, `in_review`, `cancelled`
- `in_review` → `in_progress`, `done`, `cancelled`
- `done` → `in_progress`, which reopens the issue and clears `closed_at`
- `cancelled` → `backlog`, which clears `closed_at`

Any other move, including a move to the same status, answers `illegal_transition`. A legal move of a parent to `done` while any sub-issue is outside `done` and `cancelled` answers `open_sub_issues`. Moving to `done` or `cancelled` sets `closed_at` to the server's now.

**Rollover and attribution.**
- An issue that is not closed and is planned into a finished cycle reports the current cycle as its `cycle_number`.
- A closed issue that had a cycle reports the cycle whose span contains its `closed_at`. Work closed on a weekend or holiday therefore counts toward the cycle that day belongs to.
- Issues never planned into a cycle keep `cycle_number` null.
- `burndown` has one entry per counted day of the cycle, up to and including today for the current cycle. Each entry's `open` is the number of the cycle's issues visible to the caller that were not closed by the end of that day.

**Due dates.** A `due_date` on an uncounted day is stored as the next counted day after it, and that response carries `"due_date_snapped":true`. Otherwise it carries false. Later calendar changes do not move stored due dates.

**Messages and threads.**
- A body is 1 to 4,000 characters. A longer body is a `validation` error on field `body`.
- A reply's `thread_root_id` must be a top-level message in the same channel.
- Deleting a top-level message also deletes its replies.
- A mention is `@<handle>`, matched case-insensitively against members of that channel. Other handles are ignored.

**Unread counts.**
- Each person has one read marker per channel and one per thread.
- Reading moves a marker to the larger of its current value and `up_to`, so a marker never moves back, whatever order read marks arrive in. `up_to` must be a message in that channel or thread, and it may name a deleted one.
- A channel's unread count is the number of top-level messages in it that are:
  - not deleted;
  - not written by the person;
  - newer than the person's channel marker.

  Thread replies never count in a channel's badge.
- The inbox count is the number of messages, in channels the person belongs to, that are not deleted, not written by the person, and unread, and that either mention the person or are replies in a thread whose root or an earlier, undeleted reply the person wrote. Unread means:
  - for a top-level message, newer than the channel marker;
  - for a reply, newer than that thread's marker.
- Being added to a channel sets the channel marker to its newest message. Being removed drops that channel and its messages from every count.
- Counts are derived from stored messages and markers on every read, and never kept as separate totals.
- Every send, delete, read mark and membership change sends a fresh `unread` event to each person whose counts it changed.

**Typing and presence.**
- Typing, presence and room occupancy belong to the person, not to a tab, connection or app copy.
- A person is listed in `typing` for 5 seconds after their last typing signal from any tab, and never for a message they have since sent. The server sends a `typing` event within 1 second of a channel's list changing, including when an entry lapses.
- The `typing` list, in `GET /api/channels/{id}/messages` and in `typing` events, holds each person at most once, ordered by display name A to Z, ties broken by person id.
- A person on the floor is `active` until `PRESENCE_AWAY_SECONDS` (default 600 seconds, 10 minutes) pass with no heartbeat or request. They are then `away`, and a `presence` event goes out within 2 seconds.
- A person is in at most one room. Joining another room moves them. Signing out leaves the room.
- A person stays in their room while at least one of their event streams is open, on any app copy. When their last stream closes, they leave the room `STREAM_GRACE_SECONDS` (default 60 seconds) later, unless a stream of theirs opens again first. A reload within that time therefore never shows them leaving. A person who joined with no stream ever open stays until they leave.

**Docs.**
- Titles are 1 to 200 characters and must not be only whitespace. Field: `title`.
- Bodies are 0 to 200,000 characters. Field: `body`.
- A save is accepted only when `base_version` equals the stored version. The doc then gets version + 1.
- Any other `base_version` answers `version_conflict` with the stored doc, byte for byte as saved. Nothing is written.
- Of two simultaneous saves from the same version, exactly one succeeds and the other gets `version_conflict`.
- Every saved version is kept. A restore creates a new version whose title and body are byte-equal to version `n`, recording the caller as its editor. Nothing is erased, and the versions after `n` stay listed. It follows the same `base_version` rule as a save, so of two simultaneous restores from one version exactly one succeeds.

**Attachments.**
- A file is 1 to 10,000,000 bytes. A larger file answers `too_large`. An empty file answers `validation` on field `file`.
- The filename is 1 to 255 characters. A longer name answers `validation` on field `file`, and nothing is stored.
- The attachment row keeps the filename exactly as uploaded. It keeps the uploaded part's content type, or `application/octet-stream` when the part has none.
- The row is written only after MinIO has accepted the object. If the row cannot be written, the object is deleted.
- A message attachment may only be added by the message's author.
- A download needs the same visibility as the parent. If the parent is deleted or hidden, its attachments answer `not_found`.
- **Deleting a message** deletes its attachments and those of its deleted replies. The rows go at once. The object deletions are queued durably in Postgres in the same transaction, so a delete made while storage is down still succeeds. Each object is gone within `OUTBOX_RETRY_SECONDS` plus 10 seconds of storage being reachable to any app copy sharing the database.
- **Download headers.** Every download sends:
  - `X-Content-Type-Options: nosniff`;
  - `Content-Length` equal to `size`;
  - `Content-Disposition: attachment; filename="<fallback>"; filename*=UTF-8''<encoded>`;
  - `Content-Type: application/octet-stream` when the stored type, compared case-insensitively and ignoring parameters, is `text/html`, `application/xhtml+xml`, `image/svg+xml`, `text/javascript` or `application/javascript`. Every other type is sent as stored.
- In those headers:
  - `<fallback>` is the original name with every character outside printable ASCII (0x20 to 0x7E), and every `"` and `\`, replaced by `_`.
  - `<encoded>` is the UTF-8 bytes of the original name, percent-encoded with uppercase hex. Only `A`–`Z`, `a`–`z`, `0`–`9` and ``! # $ & + - . ^ _ ` | ~`` stay unencoded.

**Knocks.**
- Anyone may join a private room with nobody inside directly. Only private rooms with at least one occupant take knocks.
  - Knocking on an open room answers `room_open`.
  - Knocking on an empty private room answers `room_empty`.
  - Knocking on a room you are in answers `already_inside`.
  - Knocking again while your knock on that room is waiting returns the same knock.
- A knock is `waiting` while the server's now is before `created_at` + `KNOCK_TTL_SECONDS` (default 60 seconds). From that instant on it is `expired`; the edge itself counts as expired. The server sends a `knock` event with the expired status within 2 seconds of the edge.
- When a private room loses its last occupant, by leaving, moving, stream grace or removal, its waiting knocks become `expired` at once, with `knock` events.
- An occupant answers `let_in` or `not_now`. `let_in` moves the knocker into the room at once.
- Answering an expired knock answers `knock_expired`. Answering a decided knock answers `knock_answered`. Of two simultaneous answers, exactly one is recorded.
- Every change to a knock sends a `knock` event. Every change to a room's occupants sends a `room` event.
- Joining a private room that has at least one occupant needs a `let_in` knock less than `KNOCK_TTL_SECONDS` old. Otherwise the join answers `knock_required`.

**Invites and seats.**
- An invite is `pending` until it is accepted, revoked, or reaches `created_at` + `INVITE_TTL_SECONDS` (default 604,800 seconds, 7 days). From that instant on it is `expired`; the edge itself counts as expired. Only pending invites can be revoked or accepted.
- Guests must name at least one project or channel. Members name none.
- Sending needs active people + pending invites to be less than the confirmed seat limit. Otherwise it answers `workspace_full`. An expired invite does not count as pending.
- An address with a pending invite answers `invite_pending`. An address belonging to a person in the workspace answers `already_member`.
- Accepting needs the invite's email to match the caller's, and the caller to be in no workspace. It checks the seat limit again: active people must be fewer than the limit.
- When two acceptances race for the last free seat, on one app copy or several, exactly one is accepted. The other answers `workspace_full`, and its invite stays pending.
- Active people never exceed the confirmed limit, except when the limit is lowered directly in Kill Bill or a scheduled reduction applies (see Services).
- On acceptance, a member joins every channel the owner and members share by default (`#general` and `#random` in the seed). A guest joins the invite's projects and channels.

**Billing.**
- The seat limit is a whole number from 1 to 40.
- A request below active people answers `seats_below_active`.
- A raise is stored and returned only after Kill Bill confirms the recorded seat count, and it clears any scheduled reduction.
- A request below the current limit, at or above active people, does not lower the limit. It schedules a reduction, as set out in Services. `limit` and `monthly_total` stay as they were. A new reduction replaces a scheduled one. A reduction may go below active + pending, and pending invites over the limit then wait for a free seat at acceptance.
- A request for the current limit clears any schedule and answers 200.
- The chain is: no reduction, then scheduled, then applied or cleared.
- If Kill Bill fails, or takes more than 5 seconds, the call answers `billing_unavailable` and nothing changes.
- Seat changes for one workspace run one at a time, across every app copy sharing the database.
- `billing_status` is `unavailable` when a check of Kill Bill made for the request fails.

**Mail.**
- Every email (invite, mention, digest) is first written to an outbox in Postgres, linked to its workspace, its recipient and the record it is about: the invite, or the mentioning message.
- A sender delivers held messages to SMTP and retries every `OUTBOX_RETRY_SECONDS` (default 30 seconds) while SMTP fails.
- A message is marked sent once SMTP accepts it. Each outbox message is delivered exactly once, even when several app processes share one database.
- Held mail is removed in the same transaction as the change that makes it moot, so `held_mail` is already lower in the very next status response:
  - deleting a message removes its held mention emails and those of its deleted replies;
  - revoking an invite removes its held invite email;
  - removing a person removes every held email addressed to them;
  - removing a person from a channel removes their held mention emails from that channel.
- The sender never delivers a held invite email whose invite is no longer pending.
- Mail that SMTP has already accepted is unaffected by later deletions.
- `held_mail` is the number of unsent outbox messages, read from the database on every status call. It is shown to the owner, and it is null for everyone else and while the database is down.
- `mail` is `delayed` when `held_mail` is above zero or the last delivery attempt failed.
- A change in `held_mail` sends a `notice` event to the owner.

**Digest.**
- On each counted day, the app queues one digest for the owner and for each member. It does so at the first moment at or after 08:00 workspace time when the server is running, and before that day ends. Guests get none.
- A person never gets two digests for the same date.
- `next_digest_at` is 08:00 workspace time on the next counted day whose digest has not been queued yet.

**App copies.** Copies sharing one database behave as one app:
- Typing lists, stream counts, room occupancy, presence, `held_mail`, the last confirmed seat limit and its age, idempotency records and the seat-change queue are read from Postgres, so what one copy records holds on every other copy at once.
- Each copy's `database`, `storage`, `billing` and mail delivery states in `GET /api/status` report what that copy itself can reach.
- Each server-timed change (a typing lapse, turning away, a knock expiring, a room leave after grace, a scheduled reduction applying) produces exactly one stored event, whichever copies are running.

### Services (DP-31, DP-41, DP-45, DP-46, DP-48, DP-50, DP-51, DP-59, DP-66, DP-67, DP-71, DP-83, DP-89)

**Postgres** holds:
- workspaces, calendar saves, finished cycle records, people, sessions, projects and their guests;
- issues, channels, messages and read markers;
- docs and versions;
- rooms, knocks and invites;
- idempotency records, the mail outbox, the attachment deletion queue and attachment rows;
- the event log and the state shared between app copies.

Apply the schema idempotently every time the app serves, and load the seed data when the database is empty. Copies that start at the same moment on an empty database still produce one schema and one seed. Unread counts and seat usage are derived from stored rows.

**Mailpit** receives every email over SMTP, from the `MAIL_FROM` address (`Tallyroom <notices@tallyroom.test>`):
- **Workspace header.** Every email carries the header `X-Tallyroom-Workspace: <workspace id>`, where `<workspace id>` is the `id` from `GET /api/workspace` of the workspace the email was sent for (for an invite, the inviting workspace). Workspace ids are random per database, so app copies on separate databases send under different ids, while copies sharing one database send under the same id. Every "one email" and "exactly once" rule in this brief counts the emails carrying one workspace id, and checks scope Mailpit messages to one copy by this header.
- **Invite**: to the invited address, with subject `You're invited to <workspace> on Tallyroom`. The body names the inviter and the workspace, and says to sign in or create an account at `APP_PUBLIC_URL` with that exact address. It contains no token, code or per-invite link.
- **Mention**: to the mentioned person, with subject `<name> mentioned you in #<channel>`, where `<name>` is the author. One per message per mentioned person.
- **Digest**: to each recipient, with subject `Your Tallyroom digest for <weekday> <day> <month>`, for example `Your Tallyroom digest for Friday 30 October`. The body lists the recipient's visible open issues in the current cycle and their inbox unread count.

When Mailpit is down, messages stay held and the mail-delayed notice shows. Delivery resumes without a restart.

**Kill Bill** holds billing.
- On serve, and again until it succeeds, the app uploads to its tenant a catalog with product `Seat` and monthly plan `tallyroom-seat-monthly` at 8.00 USD, unless that catalog is already there.
- Workspace ids are random UUIDs, generated when the seed is loaded into an empty database. App copies on different databases therefore never share a Kill Bill account, while copies on one database share it.
- For each workspace, the app ensures one account with external key `tallyroom-<workspace id>`, the workspace name and currency USD. The account holds one subscription on `tallyroom-seat-monthly`, in a bundle with external key `tallyroom-<workspace id>-seats`.
- That subscription has a custom field named `seats`, holding the limit as a decimal string. The billing record's `account_external_key` names this account.
- **The `seats` field is the confirmed seat limit.**
  - The app re-reads it whenever its own copy is more than 10 seconds old, and on every invite send and acceptance. Every limit the app enforces or returns, in `GET /api/billing` and in the owner's `Workspace.seats`, is therefore at most 10 seconds old.
  - A value changed directly in Kill Bill is adopted within 10 seconds, even when it is below the active people. Nobody is removed in that case; new invites and acceptances answer `workspace_full` until a seat is free.
  - A raise rewrites the field and reads it back before the new limit counts.
  - If Kill Bill confirms a change but the app's own write then fails, the next read adopts Kill Bill's value.
- **A reduction waits for the paid period.**
  - The app reads the subscription's `chargedThroughDate` and writes a custom field named `seats_scheduled` on the subscription, holding `<n>@<YYYY-MM-DD>` with that exact date. It reads the field back, then answers 200 with `scheduled_limit` and `scheduled_on` set.
  - Kill Bill sets `chargedThroughDate` only once it has invoiced the subscription. While it is null, the call answers `billing_unavailable` and nothing changes. Today's date, or any other date the app works out, is never substituted.
  - Once `scheduled_on` is on or before the workspace's today, the next Kill Bill read writes `seats` with the scheduled value, removes `seats_scheduled` and adopts the value under the same rule as a direct lowering.
  - A raise, or a request for the current limit, removes `seats_scheduled`.
  - A `seats_scheduled` value written directly in Kill Bill is adopted within 10 seconds, as `seats` is.
- **When Kill Bill is down:**
  - `GET /api/billing` and the owner's `Workspace.seats` answer with the last confirmed limit, and `billing_status` is `unavailable`.
  - Seat changes, invite sends and acceptances answer `billing_unavailable`, and nothing changes.

**MinIO** stores each attachment at key `<workspace slug>/<attachment id>/<safe filename>`. In the safe filename, every character of the original name other than letters, digits, dot, hyphen and underscore becomes an underscore. The object keeps the uploaded content type. When MinIO is down:
- uploads and downloads answer `storage_unavailable`;
- `storage` reads `unavailable`;
- no row is written;
- message deletions still answer as usual, and their object deletions wait in the queue;
- everything else keeps working.

**Status checks.** Each service's state in `GET /api/status` is never more than 10 seconds old. A change in any service state sends a `notice` event.

### Seed data (DP-05, DP-10, DP-34, DP-39, DP-43, DP-44, DP-47, DP-60)

Every seeded person, company and email address is invented. Every seeded person's password is `tally-demo-1`.

**Workspace Kereru Labs** (slug `kereru`)
- Time zone `Pacific/Auckland`, working weekdays Monday to Friday, `cycle_anchor` `2026-10-19`, seat limit 8.
- Holidays: `2026-12-25` `Christmas Day` and `2026-12-28` `Boxing Day (observed)`. This calendar is in effect from the beginning.

People:

| Name | Email | Handle | Role |
|---|---|---|---|
| Ana Whitlow | ana@kereru.test | ana | owner |
| Ben Ostrow | ben@kereru.test | ben | member |
| Chiara Lund | chiara@kereru.test | chiara | member |
| Dev Ramaswamy | dev@kereru.test | dev | member |
| Elin Park | elin@kereru.test | elin | member |
| Femi Ade | femi@kereru.test | femi | guest |

Femi shares project Kiln and channel #kiln-review. That makes 6 active people and no pending invites.

Projects: `Kiln` (key `KIL`) and `Atlas` (key `ATL`).

Issues (none has a due date):

| Key | Title | Status | Assignee | Cycle | Notes |
|---|---|---|---|---|---|
| KIL-1 | Kiln onboarding checklist | todo | Ben | 1 | |
| KIL-2 | Kiln billing export | in_progress | Chiara | 1 | |
| KIL-3 | Export CSV header row | done | Chiara | 1 | sub-issue of KIL-2, closed at `2026-10-21T10:00:00+13:00` |
| KIL-4 | Export date format | todo | Dev | 1 | sub-issue of KIL-2 |
| KIL-5 | Kiln review checklist | in_review | Femi | 1 | |
| KIL-6 | Kiln empty states | backlog | unassigned | none | |
| ATL-1 | Atlas search index | todo | Elin | 1 | |
| ATL-2 | Atlas rate limits | backlog | Dev | none | |

Channels:
- `#general`: Ana, Ben, Chiara, Dev, Elin.
- `#kiln-review`: Ana, Ben, Femi.
- `#random`: Ana, Ben, Chiara, Dev, Elin, with no messages.

Messages (every seeded message is read by everyone at start):
- In `#general`, three messages: from Ana `Welcome to cycle 1.`, from Ben `Kiln export is in progress.` and from Chiara `Atlas notes are up.`.
- In `#kiln-review`, one message from Femi `Review checklist is ready.`, with one thread reply from Ben `Looking now.`.

Docs:
- `Kiln launch spec`: project Kiln, version 1, body `Launch scope for Kiln.`
- `Atlas notes`: project Atlas, version 1, body `Notes on Atlas search.`

Rooms: `Lobby` (open), `Studio` (open), `Review Room` (private) and `Focus Booth` (private). All are empty at start.

**Workspace Halyard Works** (slug `halyard`)
- Time zone `America/New_York`, working weekdays Monday to Friday, no holidays, `cycle_anchor` `2026-10-26`, seat limit 5.
- People: Hal Booker (hal@halyard.test, handle `hal`, owner) and Iris Vane (iris@halyard.test, handle `iris`, member).
- Project `Rig` (key `RIG`), with RIG-1 `Rig inventory sync` (todo, Iris, cycle 1) and RIG-2 `Rig label printer` (backlog, unassigned, no cycle).
- Channel `#general` (Hal, Iris), with no messages.
- Rooms: `Lobby` (open) and `Huddle` (private).

For example, with the seed data at start:
- Kereru cycle 1 has `starts_at` `2026-10-19T00:00:00+13:00`, `ends_at` `2026-11-02T00:00:00+13:00` and 14 calendar days.
- Kereru cycle 5 starts on `2026-12-14`. Because of both holidays, its last working date is `2026-12-29`.
- Halyard cycle 1 has `starts_at` `2026-10-26T00:00:00-04:00` and `ends_at` `2026-11-09T00:00:00-05:00`, across the clock change of 1 November. Its `Sun 1 Nov` crease shows `Not counted`, `Weekend` and `Clocks go back`.
- Femi's project filter offers `All projects` and `Kiln`.
- On KIL-1, Femi's assignee picker offers `Unassigned`, Ana, Ben, Chiara, Dev, Elin and Femi.
- The status picker on KIL-1 (todo) offers `Backlog`, `In progress` and `Cancelled`, in that order.

## Technical requirements

### Deployment (DP-55, DP-84)

- The runtime is Node.js 22 with npm. Write the server and the browser code in TypeScript.
- Put `/app/run.json` at the app root. It has the string fields `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`, for example `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}`.
- When you finish, leave no virtual environment (such as `.venv`) inside `/app`. `install` recreates the dependencies on the grading machine.
- The served process binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}` as soon as the process is serving, whether or not any dependency is reachable.
- Several copies of the app may run at once against the same database and services. Each copy:
  - still delivers every outbox message once;
  - keeps every concurrency rule in Business rules;
  - delivers to its own open streams the events written by any copy, within the stream's published delay.
- Copies may also run on their own empty database or bucket. Each such copy seeds itself.

### Configuration and secrets (DP-59)

Read these at start. Never hard-code them, and never send any of them to the browser:
- `DATABASE_URL`
- `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `APP_PUBLIC_URL` (the address used in email bodies) and `APP_PUBLIC_PORT`
- The timers from Business rules and API: `INVITE_TTL_SECONDS`, `KNOCK_TTL_SECONDS`, `PRESENCE_AWAY_SECONDS`, `STREAM_GRACE_SECONDS`, `OUTBOX_RETRY_SECONDS`, `IDEMPOTENCY_TTL_SECONDS`. Grading sets some of these to a few seconds.
- `SERVER_CLOCK_START` (optional): an ISO 8601 instant with a UTC offset. When it is set, the server's now equals that instant at the moment the process starts, then advances in real time, so every server date, instant, expiry and scheduled job follows it. When it is unset, the server's now is `Date.now()` unchanged. Grading sets it on a copy with its own empty database and bucket, to test the digest, cycle rollover and finished cycles on fixed dates.

If the bucket named by `S3_BUCKET` does not exist, create it.

### Server boundary (DP-50, DP-56, DP-75)

- **Same origin.** Serve the app and the API from one origin, and send no CORS headers. A state-changing request whose `Origin` header names another origin answers `cross_origin`.
- **Body limits.**
  - JSON bodies may be up to 1,000,000 bytes. That size is allowed, and a larger body answers `too_large`.
  - Upload bodies may be up to the attachment limit in Business rules plus multipart framing.
  - A JSON endpoint called with another content type answers `unsupported_media_type`.
- **What is never served.** Only the built browser assets and the API are served. Source files, `run.json`, package manifests, environment files and any path containing a credential answer 404. No response, page or script ever contains a service credential.
- **Client leaves.** When a client closes or aborts the event stream, or a download, the server releases what it held at once: its database session, any open transaction, and its listeners. After 20 aborted streams in a row:
  - the app's database sessions return to within 2 of their earlier number within 5 seconds;
  - none is left `idle in transaction`;
  - the next request answers normally.
- **Down at boot.** If a dependency is unreachable at boot, the app still starts and serves:
  - the pages and `GET /api/health` load;
  - database-backed calls, the event stream included, answer `database_unavailable`;
  - storage calls answer `storage_unavailable`;
  - billing calls answer `billing_unavailable`;
  - mail is held in the outbox.

  When the dependency returns, the app reconnects within 10 seconds, without a restart. It then applies any schema, seed and Kill Bill registration still owed.

### Browser support and performance (DP-52, DP-72)

- Support current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800.
- With the seed data, the Issues module is usable within three seconds of opening the page.
- API calls that do not touch a provider answer within half a second.
- A change one person makes shows in another person's open page within 2 seconds, through the event stream, whichever app copy each person uses.
- Fonts and icons are bundled with the app. The page loads nothing from any third-party origin.

## Working rules

- IF-01: `/app/run.json` is valid JSON with exactly the string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package and its licence, plus the IBM Plex fonts and the Lucide icons. Shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- IF-03: Every shipped package and bundled asset is under MIT, ISC, 0BSD, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or OFL-1.1.
- IF-04: No datastore other than the provided Postgres and MinIO is used. This rules out SQLite, Redis, in-memory stores standing in for persistence or for the event log, and JSON files used as a database.
- IF-05: The provided service configuration and dev compose files are left unmodified.
- IF-06: Server and browser source is TypeScript. Plain JavaScript appears only in tool configuration files.
- IF-07: Fonts, icons and scripts are served from the app itself. No page references a CDN or other third-party origin.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` escapes. Names use this brief's domain terms: workspace, cycle, crease, counted day, knock, invite, seat limit, outbox, read marker, event stream.
- Each domain rule is decided in exactly one place in the source, and every caller uses that one decision. This covers:
  - status edges;
  - counted days and the calendar in effect on a date;
  - cycle boundaries, clock-change marks and finished-cycle records;
  - the unread derivation;
  - per-viewer visibility, including the per-event access check and event projection;
  - the seat check, Kill Bill freshness and the seat reduction schedule;
  - knock and invite expiry;
  - code-point length limits and refused text;
  - the unsafe download types;
  - outbox and attachment-queue removal on deletion.
- No abstraction has only a single implementation, and there are no wrapper layers that only forward calls.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every API error is produced through the one error shape and code table in this brief.
- Provider effects (the Kill Bill seat count, the MinIO object, SMTP acceptance) are confirmed before the app records the dependent state. No code path fakes a provider's answer, or keeps a cached one beyond the published freshness.
- Every stream, transaction and database session is released on every exit path, including client abort. No request-specific state lives in module or process scope.
- Nothing is built beyond this brief: no extra screens, endpoints, settings or providers.
