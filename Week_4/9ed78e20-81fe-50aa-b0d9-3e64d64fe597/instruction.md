# Aldermoor Labs Open Record

Open Record is the public record and governed console of Aldermoor Labs, the fictional frontier AI research arm of the larger, also fictional, Corvane Group. Anyone can use the public side without an account and with cookies refused. It holds the lab's thesis, its model routes with recorded benchmarks and sample galleries, a newsroom, a ranked search of the whole record, a way to read the record as it stood at an earlier moment, and open roles. The console is for Aldermoor staff:
- Editors draft and review.
- Approvers sign off and schedule embargoed releases.
- Recruiters run requisitions and candidates.
- Administrators grant time-limited roles, read the tamper-evident audit record and look after the background job queue.

Candidates have no account. They apply with a résumé and follow their application through a private tracking link. The platform uses three backend services:
- PostgreSQL is the only system of record. It also holds sessions, rate limits, idempotency keys, job leases and the search index.
- MinIO object storage holds sample media and private résumés.
- An SMTP mail sink (Mailpit) receives every outgoing email.

The platform runs as several identical instances against one database. Out of scope: candidate or visitor accounts, single sign-on, extra datastores or caches, external search services, analytics, comment threads on the public site, and any payment.

## Problem and users

Frontier AI labs often publish their public record with a marketing CMS, a spreadsheet of benchmark numbers and a separate applicant tracking system. This fails in public:
- Launch posts quote competitor scores that nobody checked against the evaluation rows.
- A model page goes live before the safety or legal sign-off exists, or after the person who signed it has lost the authority to sign.
- An embargoed announcement leaks because the news index updated while the model catalogue and menus did not.
- A withdrawn post lives on in feeds, sitemaps, search results and tag lists.
- Candidates apply into a black box and never learn which stage they are at. Emails to them are mis-addressed when their names contain commas or accents.

The lab pays for these failures with retractions, scrutiny from regulators and the press, broken embargoes with partners and a damaged hiring brand. Open Record builds the public site only from records that passed review, responsible-release sign-off and claim validation:
- Every surface that mentions an item changes at the same moment.
- Every hiring decision and permission change is attributed to a person, in an audit chain that shows tampering.

Users:
- **Public visitor** (occasional): reads the lab's thesis, studies a model's recorded benchmarks and samples, browses and searches news, and finds open roles. Has no account and may refuse cookies.
- **Candidate** (occasional): applies to a specific role with a résumé and follows the application's named stage through a private tracking link.
- **Editor** (daily): drafts model routes and news posts, records benchmark rows, and comments on colleagues' drafts.
- **Approver** (weekly): approves or returns drafts, records the safety or legal sign-off on a model's responsible-release record, clears it, schedules embargoed releases and withdraws published items.
- **Recruiter** (daily): opens requisitions, publishes roles, maintains the regional benefits register and moves candidates through named stages, recording a decision at each one.
- **Administrator** (weekly): grants and revokes time-limited roles, inspects and verifies the audit record, and retries dead background jobs.

## Journeys

1. **Reading and searching the record.**
   - A visitor with cookies refused lands on the home page and reads the numbered theses. The accent line beside them fills as they scroll.
   - They follow an item in the "Latest from the record" rail to the newsroom, pick the Safety subject and then the evaluations tag, and copy the address. A second browser with cookies refused opens that address and shows the same posts and the same facet counts.
   - They search for "evaluation". The matched words are highlighted. They follow "More results" and copy that address, and a second browser opening it shows the same page of results. Then they narrow the results to news.
2. **Checking a claim.**
   - A visitor opens the Kestrel 2 model route from the catalogue. Its title travels into the page heading.
   - They jump to "How we evaluated it" from the section rail. The chart's bars grow in one after another.
   - They activate claim marker 2. The address gains the claim, a line draws from the marker to the chart, the uncited rows fade, and the difference counts up to +4.3 while a screen reader hears the claim, the benchmark, both scores and the evaluation date.
   - Pressing Escape undoes each step. Reloading the copied address shows the tethered state straight away.
3. **Review and responsible release.**
   - An editor drafts a model route with two claims and a linked announcement post, then submits both. Each approver receives a sign-off email of their own.
   - One approver records the safety sign-off and a different approver records the legal sign-off. The claims validate, and a non-author approver clears the record.
   - If the safety signer's approver grant is revoked before clearing, the record falls back to legal-signed and must be signed again.
   - The end state is a cleared release record and a route marked approved.
4. **Embargoed launch.**
   - An approver schedules the cleared route for 09:00 London on a chosen day.
   - Until that moment, a visitor who guesses the route's address or the announcement's address, or searches for either title, finds nothing, exactly as for a made-up address.
   - At the instant, the route, the catalogue, the Models menu, the home rail, the feed, the sitemap, search and the announcement all show the release together, whichever instance serves the visitor.
5. **Withdrawal.**
   - An approver withdraws a published news post.
   - The visitor's newsroom, its facet counts and tag list, the home rail (which backfills to five), the feed, the sitemap and search no longer mention it. Its model route drops the announcement link, and its address answers "This post has been withdrawn."
   - Reading the newsroom as of an earlier moment still omits the withdrawn post.
6. **Applying and tracking.**
   - A visitor filters careers by discipline, office and region, opens a role, reads that region's benefits, and applies with a PDF résumé under a name with an accent, an apostrophe and a comma.
   - They see the received confirmation. A receipt addressed to exactly that name arrives by email with a tracking link.
   - The tracking page shows "Screening" after the recruiter moves the application. The candidate can withdraw after confirming.
   - A candidate who lost the link asks for it again and receives a fresh one, and the old link stops working. Asking more than three times in the re-send window looks the same on screen but sends nothing more.
7. **Running a requisition.**
   - A recruiter creates and opens a requisition and records a benefits entry.
   - They review an application, download the résumé, add an interview note and move the candidate to offer, recording a rationale at each step. A colleague's simultaneous move at the same version is refused as stale.
   - The recruiter closes the requisition. This declines the other active candidates, each with a recorded decision.
8. **Governing access.**
   - An administrator grants a colleague the approver role until a chosen instant, and the colleague approves a draft.
   - The administrator revokes the grant, and the colleague's next approval in the same session is refused.
   - The audit record lists the grant, the approval and the revocation, each with who did it. "Verify chain" confirms that no entry has been altered.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Public reading journey** A visitor with cookies refused reads the home essay of numbered theses, follows the "Latest from the record" rail into the newsroom, narrows it by subject and tag, and opens a post, all without an account.
- **DP-02 — Newsroom filters live in the URL** The newsroom's subject, tag and page selections are carried only in the address, so loading a shared newsroom address with cookies refused shows the same posts and facet counts that the API returns for those parameters, and back and forward restore earlier selections.
- **DP-03 — Every surface lists the published record** The catalogue grid, the Models navigation menu, the home rail, the newsroom, search, the feed and the sitemap each list exactly the published items, in the order stated in Business rules.
- **DP-04 — Model route reading journey** A visitor opens a published model route, moves through its sections from the pinned section rail, reads its read time and its publication time in their own zone and in London, studies the benchmark chart and evaluation rows, and plays its sample gallery.
- **DP-05 — Unreleased slugs look unknown** A public request for a model route or news post that is a draft, in review, returned, approved, scheduled or withdrawn without ever being published gets a response identical to the one for a slug that never existed, until its embargo releases it.
- **DP-06 — Benchmarks come only from recorded rows** A model route's chart and evaluation table render only recorded benchmark rows, and every number shown links to the row it came from.
- **DP-07 — Sample gallery from object storage** Model route samples are stored in object storage and served through the platform, and when storage is unreachable the route still loads and the gallery shows its unavailable notice.
- **DP-08 — Claim tether activation** Activating a claim marker by click, tap, Enter or hover puts the claim in the address, fills the marker with the accent, draws a leader line to the chart, fades every uncited row, counts the difference label up to the recorded difference and announces the claim in a polite live region.
- **DP-09 — Claim tether reversal, restore and reduced motion** Escape or a second activation undoes the tether steps in reverse order, loading an address that carries a claim restores the tethered state directly, reduced-motion visitors get each end state without animation, and below 720 pixels wide the leader line becomes a labelled bracket.
- **DP-10 — Drafting and review journey** An editor drafts a news post and submits it for review, a colleague comments, an approver returns it with a reason, the editor revises and resubmits, and a different approver approves it.
- **DP-11 — Content lifecycle transitions** Model routes and news posts move only along the content lifecycle in Business rules, and every illegal move is refused with 409 and leaves the item unchanged.
- **DP-12 — Authors never approve their own work** The author of a model route or news post is refused with 403 when approving, returning, signing off, clearing, scheduling or releasing it, even when they hold an approver grant and call the console API directly.
- **DP-13 — Server-derived read time** The server computes read time from the published body when an item publishes, and refuses any read-time value a client supplies.
- **DP-14 — Release record sign-offs** A model route's responsible-release record takes one safety and one legal sign-off from two different approvers who are not its author, concurrent sign-offs yield exactly one recorded sign-off, any edit to the route voids both, and each eligible approver is emailed when a record awaits them.
- **DP-15 — Claim validation against recorded rows** The claim validator passes a model route only when every claim is marked in the body, every cited row exists, every stated difference equals the recorded difference by numeric value, and every number in a claim's text, as defined in Business rules with model and benchmark names excluded, matches a cited score or the difference.
- **DP-16 — Clearing a release record journey** An editor drafts a model route with claims and submits it, two approvers record safety and legal sign-off, the claims validate and a non-author approver clears the record, after which the route can be scheduled.
- **DP-17 — Embargo set in London time** An approver enters the embargo as a Europe/London wall-clock time, the server stores the instant using the clock-change rules in Business rules, and visitors see published times converted to their own zone alongside London time.
- **DP-18 — Every surface releases together** When an embargo fires, the model route, catalogue grid, Models menu, home rail, search, feed, sitemap and linked news post all become public in one transaction exactly once, within 5 seconds after the instant.
- **DP-19 — One winner for concurrent actions** When approve, return, release or withdraw requests race on the same item at the same version, or a scheduled release fires while an approver withdraws, exactly one action succeeds and every losing request gets 412.
- **DP-20 — Embargoed launch journey** An approver schedules a cleared model route and its linked announcement for a London time, a visitor guessing either address sees not-found until then, and afterwards every surface shows both.
- **DP-21 — Withdrawal journey** An approver withdraws a published news post from the console, after which a visitor finds it gone from the newsroom, its facet counts, the home rail, search, the feed and the sitemap, and its address answers gone.
- **DP-22 — Withdrawn means gone everywhere** Withdrawing a published item removes it from every public list, count, facet, search result, feed and sitemap in the same transaction, and from then on its page and API address answer 410.
- **DP-23 — Requisition lifecycle** Recruiters create, open and close requisitions along the requisition lifecycle in Business rules, a closed role stops taking applications, and closing declines every active application with a recorded decision and raises its version.
- **DP-24 — Careers filters live in the URL** The careers discipline, office and region filters are carried only in the address, so a shared careers address with cookies refused reproduces the exact list of roles.
- **DP-25 — Regional benefits in force today** For each region, careers shows the benefits register entry with the latest effective-from date on or before today's date in London.
- **DP-26 — Publishing a role journey** A recruiter creates and opens a requisition and records a benefits entry for its region, and a visitor filtering careers by that discipline, office and region finds the role with that region's benefits.
- **DP-27 — Applying for a role journey** A visitor applies to an open role with a name, email, consent and a PDF résumé, sees the received confirmation, and gets a receipt email addressed to their name carrying a private tracking link.
- **DP-28 — Résumé checks** A résumé is accepted only when its content is a PDF of 1 to 5,000,000 bytes inclusive, whatever its file name or declared type, and is stored privately under a key the server chooses.
- **DP-29 — One application per email per role** A second submission for the same role from the same email returns the original application with 200 and creates no new record, file or email, including when submissions race.
- **DP-30 — Applications are all-or-nothing** An application row, its résumé object and its receipt outbox entry exist together or not at all, so when storage is unreachable the submission answers 503 and leaves none of them behind.
- **DP-31 — Receipts survive a mail outage** When mail is unreachable an application is still recorded with 201, and its receipt is delivered at least once, under a stable message identifier, after any running instance can reach mail again, without a restart, as qualified in Services.
- **DP-32 — Following an application journey** A candidate opens the tracking link from their receipt, sees the role, the stage and the dates on a stage progress list, and can withdraw the application after confirming.
- **DP-33 — Tracking shows the stage only** The tracking response carries exactly the role, stage and date fields listed in API, and never notes, decision rationale, contact details or other applicants' data.
- **DP-34 — Re-sending links reveals nothing** A request to re-send tracking links gets the same status, body and timing whether or not the email has ever applied, and only a real applicant within the DP-57 limit receives mail.
- **DP-35 — Tracking link lifetime** A tracking link is an unguessable capability for one application that stops working when it is reissued or re-sent, and once its requisition has closed and the retention period has ended it stops working and the candidate's personal data and résumé are erased.
- **DP-36 — Stage decisions** Recruiters move an application only along the application lifecycle and only at its current version, recording a rationale at every move, and the candidate is emailed only the name of the new stage.
- **DP-37 — Résumés only for the requisition's recruiters** A résumé downloads only for recruiters assigned to that application's requisition, and every other caller gets the same response as for an unknown application.
- **DP-38 — Moving candidates journey** A recruiter reviews a new application, downloads its résumé, adds an interview note and moves it through screening, interview and final review to offer, recording a rationale at each step.
- **DP-39 — Staff sign-in** Staff sign in to the console with email and password into a database-held session, and every console request checks the caller's grants as they stand at that moment.
- **DP-40 — Time-limited role grants** Administrators grant roles with an expiry instant and revoke them, the first request after revocation or expiry is refused with 403 even in an existing session, and exactly one expiry notice is queued for each grant, addressed to its grantee, when that grant's expiry comes within seven days.
- **DP-41 — Append-only audit record** Every console state change, scheduled release, sign-off void, candidate withdrawal, job retry and retention erasure writes one attributed audit entry that no one can edit or delete, through the API or in the database.
- **DP-42 — Granting and revoking access journey** An administrator grants a colleague a time-limited approver role, the colleague approves a draft, the administrator revokes the grant, the colleague's next approval is refused, and the audit record shows each step.
- **DP-43 — Cookie-free public site** No public page, asset, feed or public API response sets a cookie or needs one, and no public page requests anything from another origin.
- **DP-44 — Run manifest and health check** The platform installs, builds and serves from /app/run.json, listens on 0.0.0.0 at the port given in Deployment, applies its schema and seed data when serving starts, and answers the health check.
- **DP-45 — Server boundary** The server accepts console writes only from its own origin, enforces the request size and type limits, never serves source files or credentials, and keeps serving when storage or mail is unreachable.
- **DP-46 — Responsive at three viewports** Every public and console screen lays out as described in Screens and layout at 375x812, 768x1024 and 1280x800 without horizontal scrolling, with tap targets of at least 44 pixels.
- **DP-47 — Keyboard operation and focus** Every control is reachable in the stated Tab order with a visible focus ring, dialogs keep focus inside and return it to their opener, and Escape closes dialogs and clears the claim tether.
- **DP-48 — Unhurried section reveals** Long-form sections reveal as they enter the viewport over at least half a second without overshoot, and appear at once for reduced-motion visitors.
- **DP-49 — Studious editorial look** Public screens follow Visual design: a warm paper ground, graphite ink, one oxide accent, a serif display face over a plain sans body at a 68-character measure, hairline rules, and every number set in mono numerals.
- **DP-50 — Real wiring for credentials and samples** Service credentials are read from the environment and never reach the browser, and the platform generates sample-gallery audio and images procedurally instead of shipping copied media.
- **DP-51 — Server-owned content fields** Content create, edit and transition bodies accept only their published keys, and any server-owned or unknown key refuses the whole request with 422 read_only_fields and changes nothing.
- **DP-52 — Sign-offs lapse with the signer's authority** A sign-off on a release record that is not yet cleared is voided in the revoking transaction or within 60 seconds of its signer's grant expiry, the record falls back to the remaining sign-off's state, and clearing in the gap is refused with 409 signoff_lapsed.
- **DP-53 — Derived surfaces stay consistent after withdrawal** After a withdrawal every derived public value (newsroom total, pages, subject and tag facets and the tag list, the five-item home rail, the feed's updated time, and linked_news and linked_model references) equals a fresh recount in the same transaction.
- **DP-54 — Careers text limits and real dates** Requisition titles and descriptions, benefits summaries and close reasons are limited in Unicode code points after trimming with exactly the limit accepted, benefits dates must be real calendar dates, and stored text round-trips exactly.
- **DP-55 — Candidate mail is addressed safely** Every candidate email has exactly one recipient, with the stored name as display name and the trimmed lowercased email as address, and a name or email carrying control characters or header delimiters is refused before anything is stored or sent.
- **DP-56 — One winner for stage moves** Concurrent stage moves at the same version, a candidate withdrawal racing a move, or a requisition close racing a move leave exactly one effect, with one decision, one stage email and one audit entry, and the loser gets 412 or 409 as stated in Business rules.
- **DP-57 — Re-send is throttled silently** At most three re-send emails are queued per email in any rolling re-send window, and throttled requests still answer the same 202, queue nothing and rotate no tokens.
- **DP-58 — Shared rate limits** Public reads, candidate requests, sign-in attempts and console writes are counted per client or per account in the database across every instance, and requests over a limit answer 429 with Retry-After and RateLimit headers.
- **DP-59 — Sign-in lockout with backoff** Five consecutive failed sign-ins for one email lock sign-in for that email with a doubling lockout, identically for known and unknown emails, as qualified in Business rules.
- **DP-60 — Idempotent writes** Every console write and every application submission honours an Idempotency-Key by replaying the first stored response, and answers 409 when the same key arrives with a different request.
- **DP-61 — Many instances, one platform** Several instances sharing one database behave as one platform, with no per-process state for sessions, limits, keys, timers or caches, and every scheduled job running exactly once across instances.
- **DP-62 — Background jobs with retries and dead letters** Outbound mail, résumé erasure and sample uploads run as database-held jobs claimed only by instances that can reach their service, with backoff retries, and jobs refused too many times move to a dead-letter list that administrators can inspect and retry.
- **DP-63 — Readiness reports dependency state** The readiness endpoint reports the database, storage and mail as up or down and names the features each outage degrades, while the rest of the site keeps serving.
- **DP-64 — Versions on every editable record** Content items, applications, requisitions and grants carry row versions, and every change to them requires the current version, answering 428 without one and 412 when it is stale.
- **DP-65 — The record as of a moment** Public model and newsroom reads accept an as_of instant and answer with the record as it stood then, built from publication history, never showing anything unpublished at that instant or withdrawn since.
- **DP-66 — Ranked search of the record** Search across published model routes, news posts and open roles ranks matches by field weight, highlights matched words, and pages by an opaque keyset cursor that yields each match exactly once.
- **DP-67 — Searching the record journey** A visitor with cookies refused searches the record, follows "More results", copies the address, which a second browser opens to the same results, and narrows the results by kind.
- **DP-68 — Tamper-evident audit chain** Each audit entry carries a sequence number and a hash chained to the previous entry by the rule in Business rules, the verify endpoint confirms the chain, and retention erasure leaves it verifiable.
- **DP-69 — Scroll-linked and staggered motion** The thesis accent line follows scroll progress through the essay and the benchmark chart's bars grow in staggered order on first view, each with its stated timing, never blocking input or shifting layout, and with the reduced-motion substitute in Motion and effects.
- **DP-70 — List-to-detail continuity** Opening a model route from the catalogue or a post from the newsroom carries its title into the page heading in under half a second, Back reverses it, and reduced-motion visitors get an immediate swap.

## Frontend

### Screens and layout (DP-01, DP-04, DP-46, DP-49, DP-65, DP-67)

Public screens (all work with cookies refused):

- **Home** at `/`: the essay "The open record of Aldermoor Labs" as numbered theses, set one after another as prose. A thin accent progress line runs beside them. The "Latest from the record" rail lists the five most recent published items.
- **Model catalogue** at `/models`: a grid of published model routes, each showing the model name, its summary and its publication time.
- **Model route** at `/models/<slug>`: the model name, summary, read time and publication time, then the body by section. The benchmark chart and the "Recorded evaluation rows" table come next, followed by the sample gallery and a link to the linked announcement when there is one.
- **Newsroom** at `/news`: subject and tag facets with counts, a list of posts (title, summary, subject, publication time, read time) and page links.
- **News post** at `/news/<slug>`: the title, summary, subject, tags, publication time, read time, body, and a link to the linked model route when there is one.
- **Record as of**: `/news`, `/models` and `/models/<slug>` and `/news/<slug>` accept `?as_of=<instant>`. With that parameter they show the record at that instant, under the "Record as of" banner from Feedback states.
- **Search** at `/search?q=&kind=&cursor=`: the search form, kind filters, a list of results (kind, title, publication or opening time, highlighted fragment) and a "More results" link.
- **Careers** at `/careers`: the filter form, the matching roles (title, discipline, office, region), the "Benefits by region" section, and the "Resend my tracking links" form.
- **Role** at `/careers/<slug>`: the title, discipline, office, region, description, that region's benefits entry in force, and the application form.
- **Tracking** at `/track/<token>`: the role title and office, the current stage name, the stage progress list, the submitted and last-changed dates, and the withdraw control while the application is active.
- **Not found, gone and invalid-link pages**: as owned by Feedback states.

Console screens, all behind sign-in:
- `/console/sign-in`.
- `/console`: the work queue, grouped by status, showing only the groups the signed-in roles can act on.
- `/console/content/new?kind=model|news` and `/console/content/<id>`: the editor, comments, and for model routes the release record panel.
- `/console/rows`: benchmark rows.
- `/console/requisitions` and `/console/requisitions/<id>`: requisitions with their applications grouped by stage.
- `/console/applications/<id>`.
- `/console/benefits`.
- `/console/grants`.
- `/console/audit`.
- `/console/jobs`: the background job queue and its dead letters.

Every console screen shows the "Service status" banner whenever storage or mail is down.

Layout at **1280x800**:
- The page is a 12-column sheet with generous outer margins.
- On every long-form route (model route, news post, role), a section rail in the first three columns stays pinned while the reader scrolls. It lists the section headings as anchor links. Prose sits in columns 4 to 10 at a measure of about 68 characters.
- The benchmark chart and the sample gallery break out to the full sheet width, with a hairline rule above and below.
- The home page reads as one argued essay:
  - The theses run in columns 4 to 10, each with a large numeral to its left.
  - The accent progress line runs in column 3.
  - "Latest from the record" is a quiet list in columns 11 and 12.
  - There are no cards on home.
- The catalogue grid has three columns.
- Search results sit in columns 4 to 10, with the kind filters in the left rail.
- The console uses two panes: a list on the left (four columns) and the detail on the right (eight columns).

Layout at **768x1024**:
- The section rail becomes a "Sections" disclosure at the top of the article.
- Prose spans the full width inside the margins.
- The catalogue has two columns.
- "Latest from the record" moves below the theses.
- The thesis progress line sits at the left edge of the essay.
- The search kind filters sit above the results.
- The console panes stack, list first and then detail.

Layout at **375x812**:
- Everything is a single column.
- Primary navigation folds into a "Menu" button.
- The chart scrolls inside its own frame and never widens the page.
- Each row in the evaluation table becomes a stacked block.
- Console tables become stacked blocks with each column labelled.
- Below 720 pixels wide, the claim tether uses its bracket form (Motion and effects).

At all three viewports, no screen scrolls horizontally. Every interactive target is at least 44 by 44 pixels.

### Public screens and controls (DP-02, DP-08, DP-24, DP-27, DP-32, DP-34, DP-47, DP-62, DP-65, DP-67, DP-68, DP-69)

Only the controls and regions below are a public contract. Everything else is free to design.

| Where | Role and accessible name | Visible copy or behaviour |
|---|---|---|
| Every page | `link "Skip to content"` | First Tab stop. Hidden until focused. |
| Every public page | `navigation "Primary"` with `link "Thesis"`, `button "Models"` (aria-expanded), `link "Newsroom"`, `link "Search"`, `link "Careers"` | "Models" opens a list with one link per published model route, named by model name. |
| Public pages under 720 pixels wide | `button "Menu"` (aria-expanded) | Opens and closes the Primary navigation. |
| Home | `heading "The open record of Aldermoor Labs"` (level 1); a `list "Theses"` of five items, each headed "Thesis <n>. <thesis heading>" | Thesis headings come from Seed data. The list carries `data-thesis-progress="<0.00 to 1.00>"`, and the current thesis item carries `data-current="true"`. |
| Home | `complementary "Latest from the record"` | One link per rail item, with its kind ("Model" or "News") and publication time. |
| Long-form routes | `navigation "Sections"` | One anchor link per section heading. Each section element carries `data-reveal="pending"` until its reveal finishes, then `data-reveal="done"`. |
| Model route | `button "Claim <n>"` with aria-pressed, one per claim in reading order | A numbered marker after the claim text. |
| Model route | `figure "Benchmark results"` | Each bar row carries `data-row-id="<row id>"` and `data-cited="true|false"`. The difference label carries `data-tether-delta`. The leader line or bracket carries `data-tether-line="<claim id>"` and is hidden from assistive technology. The figure carries `data-entered="false"` until its staggered entry finishes, then `data-entered="true"`. |
| Model route | `table "Recorded evaluation rows"` | Each row has the anchor `row-<row id>`. Columns: Model, Organisation, Benchmark, Evaluation date, Score. |
| Model route | `status "Claim tether"` (polite) | Announcements owned by Feedback states. |
| Model route | `region "Samples"` with `button "Play <sample title>"` and `button "Pause <sample title>"` for audio, `button "Previous frame"` and `button "Next frame"` for each image sequence, and `status "Frame position"` | Frame position text owned by Feedback states. |
| Newsroom | `navigation "Subjects"` with links named "<Subject label> (<count>)" and `link "All subjects"`; `navigation "Tags"` with links named "<tag> (<count>)" and `link "All tags"`; the active link has aria-current="true" | Facets. |
| Newsroom | `link "Clear filters"`; `navigation "Pages"` with `link "Previous page"` and `link "Next page"` | Shown only when relevant. |
| Record as of pages | `region "Record as of"` with `link "Read the current record"` | Banner copy owned by Feedback states. |
| Search | `search "Search the record"` containing `searchbox "Search terms"` and `button "Search"`; `navigation "Kinds"` with `link "All kinds"`, `link "Models"`, `link "News"`, `link "Roles"` (active one aria-current="true"); `list "Search results"`; `link "More results"`; `status "Search status"` | Matched words are shown highlighted. "More results" is shown only when the API returns a `next_cursor`. |
| Careers | `form "Filter roles"` with `combobox "Discipline"`, `combobox "Office"`, `combobox "Region"` (each with "Any" first) and `button "Show roles"` | Selecting an option updates the list and the address straight away. The button covers browsers without scripts. |
| Careers | `region "Benefits by region"` | One entry per region. |
| Careers and the invalid-link page | `form "Resend my tracking links"` with `textbox "Email"`, `button "Resend links"` and `status "Resend status"` | |
| Role | `form "Apply for <role title>"` with `textbox "Full name"`, `textbox "Email"`, a file input named "Résumé (PDF)", `checkbox "I consent to Aldermoor Labs processing my application"`, `button "Submit application"` and `status "Application status"` | Field errors appear under each field. |
| Tracking | `heading "<role title>"`, `list "Stage progress"` (the current step has aria-current="step"), `button "Withdraw application"`, `dialog "Withdraw application?"` with `button "Withdraw"` and `button "Keep my application"`, and `status "Application status"` | |
| Console sign-in | `textbox "Email"`, password field "Password", `button "Sign in"`, `status "Sign-in status"` | |
| Console, every screen | `status "Console status"` (polite); `status "Service status"`; `button "Sign out"` | |
| Content editor | `textbox "Title"`, `textbox "Slug"`, `textbox "Summary"`, `textbox "Body"`, `button "Save draft"`, `button "Submit for review"`, `textbox "Comment"`, `button "Add comment"`, `button "Approve"`, `button "Return to author"` opening `dialog "Return to author"` with `textbox "Reason"` and `button "Return"` | |
| Release record panel | `region "Release record"`, `button "Record safety sign-off"`, `button "Record legal sign-off"`, `button "Validate claims"`, `button "Clear release record"` | |
| Content editor | `button "Schedule release"` opening `dialog "Schedule release"` with `textbox "Release time (London)"` and `button "Confirm schedule"`; `button "Release now"`; `button "Withdraw"` opening `dialog "Withdraw this item?"` with `button "Confirm withdrawal"` | |
| Rows | `table "Benchmark rows"`; `form "Record a benchmark row"` | |
| Requisition | `button "Open requisition"`, `button "Close requisition"` (with `dialog "Close requisition"` and `textbox "Reason"`) | |
| Application | `combobox "Move to stage"`, `textbox "Decision rationale"`, `button "Record decision"`, `link "Download résumé"`, `textbox "Interview note"`, `button "Add note"`, `button "Reissue tracking link"` | |
| Grants | `form "Grant a role"` with `textbox "Staff email"`, `combobox "Role"`, `textbox "Expires (London)"`, `button "Grant role"`; `table "Grants"` with `button "Revoke <role> for <email>"` per active grant | |
| Audit | `table "Audit record"` with columns Seq, When, Actor, Action, Target, Detail; `button "Verify chain"`; `link "Older entries"` | |
| Jobs | `navigation "Job states"` with `link "Pending"`, `link "Dead"`, `link "Done"`; `table "Jobs"` with columns Kind, State, Attempts, Last error, Next attempt; `button "Retry job <id>"` on each dead job | |

### Interactions (DP-02, DP-08, DP-09, DP-24, DP-32, DP-47, DP-67, DP-70)

- **Tab order on public pages:** "Skip to content", then the Primary navigation in visual order, then the main content in reading order.
  - On model routes the order inside main content is: the section rail, the claim markers in prose order, the chart, the table, then the gallery.
  - On search the order is: the search box, the "Search" button, the kind links, the results, then "More results".
  - Every focused control shows a two-pixel accent focus ring, set off from the control by a gap of ground colour.
- **Console Tab order:** "Skip to content", then the console navigation, then the list pane, then the detail pane. In each table, every action button is reachable in row order. Enter activates a focused row's link.
- **Newsroom facets are plain links.** Choosing a subject or tag loads the newsroom address with that parameter changed and the page reset to 1. Back and Forward step through earlier selections, because each one is a separate address. An `as_of` parameter is kept while choosing facets.
- **Search:**
  - Submitting the form loads `/search?q=<terms>`, with any kind kept and the cursor dropped.
  - Kind links change only `kind`, and they drop the cursor.
  - The page asks the API for the Search page size set in Business rules, and its address never carries a limit.
  - "More results" loads the address with the `next_cursor` from the API, so every page of results is its own address. Back returns to the previous page.
  - Pressing "/" anywhere outside a text field moves focus to the search box on the Search page.
- **Careers filters** submit with the GET method. With scripts on, a change applies at once and pushes a new address. Back and Forward re-render the list from the address.
- **Claim tether** (the steps are in Motion and effects):
  - A click, tap, Enter or Space on a marker pins the tether.
  - Hovering a marker with a mouse previews it. Moving the pointer away undoes a preview, but not a pinned tether.
  - Escape, or a second activation of the pinned marker, undoes the tether. Focus stays on the marker.
  - Activating a different marker first undoes the current tether, then runs the new one.
  - Address changes for the tether replace the current history entry instead of adding one.
- **Models menu and Menu button:** they open on click or Enter. Escape closes them and returns focus to the button.
- **Dialogs** (withdraw application, return to author, schedule, withdraw item, close requisition):
  - Opening a dialog moves focus to its first field, or to its safe button ("Keep my application" in the withdraw-application dialog).
  - Tab stays inside the dialog.
  - Escape or the cancel button closes it, and focus returns to the control that opened it.
- **Application form:** "Submit application" is disabled while a submission is pending, and a second click during that time does nothing. On a field error, focus moves to the first field with an error. Each submission attempt sends one fresh `Idempotency-Key`, and an automatic retry after a dropped connection reuses that key.
- **Console writes:** every console button sends the item's current version and a fresh `Idempotency-Key`. A dropped-connection retry of the same action reuses its key.
- **Schedule dialog:** as the approver types a London time, the dialog shows the same instant converted to the approver's own browser zone.
- **Sample gallery:**
  - Only one clip plays at a time, so starting a clip pauses any other.
  - "Previous frame" and "Next frame" step through an image sequence, wrapping at both ends. The Left and Right arrow keys do the same while the frame view has focus.
  - Image sequences never advance on their own.
- **List to detail:** following a catalogue card or a newsroom item runs the continuity motion in Motion and effects. Pressing Back returns to the list at the same scroll position, with that item's title back in place.

### Visual design (DP-49)

- **Colour roles:**
  - The page ground is a warm, paper-like off-white.
  - Ink is a deep graphite near-black.
  - Secondary text and labels are a cool mid-grey.
  - One oxide red-brown is the accent. It is used only for the active claim marker, the line or narrow-screen bracket that tethers it to the cited bars, the cited bars, the current thesis numeral, the thesis progress line, link underlines on hover, focus rings and search highlights (shown as the accent underline beneath highlighted words on a pale sand wash).
  - Hairline rules are a pale sand colour.
  - No other hues are used. Charts use graphite and grey for bars, and the accent only for cited bars.
- **Contrast:** all text and controls meet WCAG 2.2 AA contrast on the ground: 4.5 to 1 for body text, and 3 to 1 for large text and control boundaries.
- **Type:**
  - Display headings use Newsreader, a bookish text serif.
  - Body and interface text use Instrument Sans, a plain humanist sans.
  - Every number on screen is set in JetBrains Mono with figures of equal width. That covers scores, differences, dates in tables, counts, read times, stage step numbers, audit sequence numbers and job attempts.
  - Each heading level is a quarter larger than the level below it. Body text is a comfortable reading size with roomy line spacing, and prose never exceeds about 68 characters per line.
  - The platform serves the fonts itself.
- **Evidence:** every number in the chart, the claims and the evaluation table links to its row in "Recorded evaluation rows".
- **Density:** airy. Sections are separated by hairline rules and wide vertical space. Lists breathe, and nothing on home is boxed into cards.
- **Icons:** Lucide icons appear only beside controls, never on their own as decoration.
- **Console:** uses the same ground, ink, type and accent, with the content set more compactly in tables and panes.

### Motion and effects (DP-08, DP-09, DP-48, DP-69, DP-70)

Every motion means something: content entering, a state changing, or progress. All motion starts promptly and settles slowly, with no overshoot or bounce. There are no decorative animation loops anywhere, and nothing moves unless the visitor scrolls or acts. Motion only moves and fades things inside space they already hold. Nothing below a moving element shifts. No motion blocks input: a control under or near a motion can be activated at any moment, and activating it completes any entry motion at once.

- **Section reveals:** each long-form section and each thesis fades in and rises a short way as it enters the viewport. A reveal takes between half a second and eight tenths of a second, and plays once per page load.
- **Thesis progress line (scroll-linked):**
  - A thin line beside the theses fades from the accent at its top to the rule colour.
  - Its filled length follows how far the visitor has scrolled through the essay. It is empty when the first thesis's top reaches the middle of the viewport, and full when the last thesis's bottom does. `data-thesis-progress` reports that fraction with two decimals.
  - The thesis crossing the middle of the viewport is current. Its numeral takes the accent within about a quarter of a second, and its item carries `data-current="true"`.
  - Scrolling back empties the line and moves the current thesis back in step.
- **Chart entry (staggered):**
  - The first time the benchmark chart enters the viewport, each bar grows from the baseline to its recorded length in about half a second (between 0.4 and 0.6 seconds).
  - Each bar starts between 40 and 80 thousandths of a second after the one above it.
  - The scores and labels are present from the start.
  - `data-entered` becomes true when the last bar settles.
  - Sample gallery thumbnails fade in the same way, each about three tenths of a second long, started 40 thousandths of a second apart.
- **Hover and press feedback:** a link's underline thickens, or a button darkens slightly, within about a tenth of a second. Pressing a button sinks it by a hair. Both reverse when the pointer leaves.
- **Disclosure and dialog enter and exit:** menus and dialogs fade and slide a short distance in about a fifth of a second, and exit the same way.
- **List-to-detail continuity:**
  - When a visitor opens a model route from the catalogue, or a post from the newsroom, the clicked title moves and grows from its place in the list into the page heading. This takes between 0.3 and 0.5 seconds, while the rest of the new page fades in.
  - Back reverses it: the heading shrinks back into its list position.
  - The new page accepts input as soon as it loads.
  - Browsers that cannot do this get a plain page change.
- **Claim tether (the signature).** Activation runs these steps:
  1. The address gains `?claim=<claim id>` and the marker fills with the accent (aria-pressed becomes true).
  2. A thin accent line draws itself from the marker to the cited bars, over a little over half a second (between 0.5 and 0.65 seconds). If the chart is off screen, it first glides into view, within half a second.
  3. Every chart row that is not cited fades to 28 percent of full strength over about a quarter of a second (between 0.2 and 0.3 seconds), and its `data-cited` reads false. The cited rows are this model's and the comparator's rows on the claim's benchmark and evaluation date. They keep full strength, and their accent fill sweeps from each bar's base to its end in the same time as the line.
  4. The difference label between the two cited bars counts in mono numerals from 0 to the recorded difference, in the same time as the line, and ends on exactly the difference stated in Business rules.
  5. The "Claim tether" live region announces the claim.

  Undoing the tether runs the same steps in reverse order, each with the same timing as on activation:
  1. The release is announced.
  2. The label returns to empty.
  3. The rows return to full strength.
  4. The line erases itself back to the marker.
  5. The marker unfills, and `claim` leaves the address.

  Loading an address that carries a valid `claim` restores the end state of all five steps without animation, after the page settles. An unknown claim id in the address is ignored.
- **Narrow screens:** below 720 pixels wide, the line is replaced by an accent bracket in the chart margin beside the cited rows, labelled "Claim <n>". The bracket appears at once, and the other steps are unchanged.
- **Reduced motion:** when the visitor prefers reduced motion:
  - Sections appear at once, with `data-reveal` done straight away.
  - The thesis line still follows scroll position, but jumps to each new length with no easing, and the numeral changes colour at once.
  - Chart bars and thumbnails appear at full length at once, with `data-entered` true straight away.
  - Hover feedback changes colour only.
  - Dialogs appear without sliding.
  - List-to-detail swaps the page at once, with no moving title.
  - The tether line appears fully drawn, the rows fade instantly, the bars fill at once, the difference shows its final value at once, and the chart jumps into view.
  - The address, the highlighting and the announcement stay the same.

### Feedback states (DP-07, DP-09, DP-27, DP-30, DP-31, DP-32, DP-34, DP-58, DP-63, DP-65, DP-67, DP-68)

Every asynchronous action shows a pending state, then success or an error, through its named live region. Error states show the `message` from the API response verbatim, which includes the 429 messages. If the request never reached the server, they show "We couldn't reach Aldermoor. Check your connection and try again."

| Action | Live region | Pending | Success | Errors and outage |
|---|---|---|---|---|
| Submit application | "Application status" | "Sending your application…" | "Application received. Your receipt and tracking link are on their way to <email>." (the same for 201, 200 and a replay) | 422: "Please fix the highlighted fields." in the region, with each field message under its field. 409, 429 and 503: the API message. |
| Resend links | "Resend status" | "Sending…" | The API message from the 202 response | 422: the field message. 429: the API message. |
| Withdraw application | "Application status" | "Withdrawing…" | "Your application has been withdrawn." | 409: the API message |
| Search (with scripts) | "Search status" | "Searching…" | "Showing <n> results." where `<n>` is the number of results on this page | 422: the field message |
| Sign in | "Sign-in status" | "Signing in…" | Redirects to `/console` | 401 and 429: the API message |
| Every console action | "Console status" | "Saving…" | See the list below this table | 412: the API message plus `button "Reload"`. Other errors: the API message. |

Console success copy:
- Saved draft: "Draft saved."
- Submit: "Submitted for review."
- Comment: "Comment added."
- Approve: "Approved."
- Return: "Returned to author."
- Sign-off: "<Safety or Legal> sign-off recorded."
- Validate: "Claims validated."
- Clear: "Release record cleared."
- Schedule: "Release scheduled for <D Month YYYY, HH:mm> London."
- Release now: "Released."
- Withdraw: "Withdrawn."
- Row: "Row recorded."
- Requisition: "Requisition opened." or "Requisition closed."
- Decision: "Decision recorded. The candidate will be told the new stage by email."
- Note: "Note added."
- Reissue: "A new tracking link is on its way to the candidate."
- Grant: "Role granted."
- Revoke: "Role revoked."
- Benefits: "Benefits entry recorded."
- Job retry: "Job queued for retry."
- Verify chain: "Audit chain verified: <n> entries." when valid, or "Audit chain broken at entry <seq>." when not.

**Service status** reflects `/api/ready`. It is checked when each console screen loads and every 15 seconds while the screen stays open. It shows:
- When mail is down: "Mail delivery is delayed. Messages are queued and will be sent when mail returns."
- When storage is down: "File storage is unreachable. Applications, résumé downloads and samples are paused."
- Nothing when both are up.

Tether and gallery announcements:
- **Tether on:** "Claim <n>: <benchmark>, <model name> <model score> versus <comparator name> <comparator score>, evaluated <D Month YYYY>."
- **Tether off:** "Claim <n> released."
- **Gallery unavailable:** when storage is unreachable, the "Samples" region shows "Samples are unavailable right now. The recorded benchmarks above are unaffected." in place of the controls.
- **No samples:** a route without samples shows "No samples recorded for this model."
- **Frame position:** reads "Frame <n> of <total>".

**Record as of** banner: "You are reading the record as it stood at <D Month YYYY, HH:mm> London." `<D Month YYYY, HH:mm>` is the `as_of` instant in London time.

Public status pages:
- **Not found** (HTTP 404): heading "Nothing is published here" and a link to home. The body never echoes the requested address, so it is identical for every unknown or hidden slug.
- **Gone** (HTTP 410): heading "This post has been withdrawn." for news posts, "This model route has been withdrawn." for model routes, and "This role has closed." for closed roles.
- **Invalid tracking link** (HTTP 404): heading "This tracking link is not valid." followed by the "Resend my tracking links" form.

Times on screen use these formats. `<D Month YYYY, HH:mm>` is the day without padding, the full month name, the four-digit year and a 24-hour time.
- **Publication times** on model routes, news posts, search results and the home rail: "Published <D Month YYYY, HH:mm> your time (<D Month YYYY, HH:mm> London)". The first part uses the visitor's browser zone. Before scripts run, the server shows only "Published <D Month YYYY, HH:mm> London".
- **Read time:** "<n> min read".

Empty states:
- Newsroom with no matches: "No posts match these filters." followed by "Clear filters".
- Careers with no matches: "No open roles match these filters."
- Search with no matches: "Nothing in the published record matches “<terms>”." with `<terms>` shown as text.
- A region with no entry in force: "No benefits entry in force yet."
- Jobs list with nothing in the chosen state: "No jobs in this state."

## Backend

### API (DP-02, DP-05, DP-12, DP-19, DP-22, DP-28, DP-29, DP-30, DP-33, DP-34, DP-37, DP-39, DP-40, DP-41, DP-51, DP-58, DP-60, DP-62, DP-63, DP-64, DP-65, DP-66, DP-68)

**Formats and limits**
- Request and response bodies are JSON (`application/json`). The exceptions are the application submission (`multipart/form-data`), the résumé download (`application/pdf`), sample media, the feed (`application/atom+xml`) and the sitemap (`application/xml`).
- A JSON body may be at most 100,000 bytes, and exactly 100,000 is allowed. A multipart body may be at most 6,000,000 bytes, and exactly 6,000,000 is allowed. Larger bodies answer `413 {"error":"payload_too_large","message":"That request is too large."}`.
- A body sent with the wrong content type answers `415 {"error":"unsupported_media_type","message":"Send this request as JSON."}`. For the application endpoint the message is "Send this request as a multipart form.".
- A POST whose body is listed as `{}` may also be sent with no body, which counts as `{}`.
- Times are ISO 8601 instants in UTC with a trailing `Z`. Dates are `YYYY-MM-DD`.
- Text lengths everywhere are counted in Unicode code points after trimming leading and trailing whitespace. Stored text is the trimmed text.

**Error shape** is always `{"error":"<code>","message":"<sentence>"}`. Validation adds `"fields":{"<field>":"<sentence>"}`.

**Error precedence** applies to every endpoint, from first to last:
1. Request format (413, 415).
2. Unauthenticated (401).
3. Rate limit and sign-in lockout (429).
4. Idempotent replay, or idempotency conflict (409).
5. Unknown or out-of-scope resource (404).
6. Forbidden (403).
7. Missing version (428).
8. Validation (422, including `read_only_fields` and `claims_invalid`).
9. Stale version (412).
10. State conflicts (409).

The one exception is the application submission. After its own validation passes, a duplicate application returns its stored response before any state check.

Common errors:
- `401 {"error":"unauthenticated","message":"Sign in to continue."}`
- `404 {"error":"not_found","message":"No such item."}` in the console
- `403 {"error":"forbidden","message":"Your current roles do not allow this."}`
- `403 {"error":"author_cannot_approve","message":"Authors cannot approve, sign off, clear, schedule or release their own work."}`
- `428 {"error":"version_required","message":"Send the version you are changing in If-Match."}`
- `422 {"error":"validation_failed","message":"Please fix the highlighted fields.","fields":{...}}` for every field validation unless an endpoint names another code
- `412 {"error":"stale_version","message":"Someone else changed this item. Reload to see the latest version."}`
- `409 {"error":"illegal_transition","message":"This item cannot move from <current status> to <requested status>."}`
- `429 {"error":"rate_limited","message":"Too many requests. Try again in <n> seconds."}`, where `<n>` equals the `Retry-After` value.

**Rate-limit headers.** Every response from a counted endpoint (Business rules, Rate limits) carries:
- `RateLimit-Limit: <limit>`
- `RateLimit-Remaining: <requests left in this window after this one>`
- `RateLimit-Reset: <whole seconds until the window ends, at least 1>`

A 429 also carries `Retry-After` with the same number of seconds as `RateLimit-Reset`.

**Idempotency keys**
- Every console POST, PATCH and DELETE except sign-in and sign-out, and every application submission, accepts an optional `Idempotency-Key` header of 1 to 255 visible ASCII characters. Any other value answers `422 {"error":"invalid_idempotency_key","message":"Idempotency-Key must be 1 to 255 visible ASCII characters."}`.
- A key is scoped to the signed-in staff account. For application submissions it is scoped to the role slug.
- A request's fingerprint is its method, its path and its body:
  - For JSON, the body is the parsed value with keys sorted.
  - For multipart, it is each field value plus the SHA-256 of the résumé bytes.
  - Headers, including If-Match, are not part of it.
- The first request under a key whose final status is from 200 to 499, other than 401 and 429, stores its status and body for `IDEMPOTENCY_TTL_SECONDS`. A 5xx or 429 stores nothing, so a later retry runs afresh.
- A later request with the same key and the same fingerprint gets the stored status and body plus the header `Idempotency-Replayed: true`. It has no other effect, including no audit entry, no email and no version change.
- The same key with a different fingerprint answers `409 {"error":"idempotency_key_reused","message":"This Idempotency-Key was already used for a different request."}`.
- The same key arriving while its first request is still running answers `409 {"error":"idempotency_in_progress","message":"A request with this Idempotency-Key is still being processed."}`.

**Versions.** Content items, applications, requisitions and grants carry a whole-number `version`, starting at 1:
- Their `GET` responses carry it in the body and in an `ETag` header of the form `"<version>"`.
- Every change to one of these records requires `If-Match: "<version>"`, except candidate withdrawal, otherwise it answers 428.
- A change at a stale version answers 412.
- A successful change returns the record with its version increased by exactly one.

Release-record endpoints and comments take no If-Match. Their races are settled in Business rules.

**Public endpoints.** None of these set cookies. All answer 200 unless stated.

- `GET /api/health` returns `{"status":"ok"}`. It is not counted for rate limits.
- `GET /api/ready` returns `{"status":"ready"|"degraded","dependencies":{"database":"up","storage":"up"|"down","mail":"up"|"down"},"degraded_features":[...]}` with status 200. It is not counted for rate limits. It reports the answering instance's own most recent probes.
  - `degraded_features` is `[]` when both services are up.
  - Storage down adds `"applications"`, `"resume_downloads"` and `"samples"`.
  - Mail down adds `"mail_delivery"`.
  - The list is in alphabetical order.
  - When the database is unreachable, it answers `503 {"status":"unavailable","dependencies":{"database":"down","storage":"up"|"down","mail":"up"|"down"},"degraded_features":["everything"]}`.
- `GET /api/public/home` returns `{"theses":[{"number","heading","body"}],"rail":[{"kind":"model"|"news","slug","title","published_at","url"}]}`.
- `GET /api/public/models?as_of=` returns `{"items":[{"slug","title","summary","published_at"}]}`, plus `"as_of"` when that parameter was given.
- `GET /api/public/models/<slug>?as_of=` returns the body below, plus `"as_of"` when given. `samples` is `[]` when storage is unreachable or the route has none, and the response adds `"samples_available":false` in the unreachable case.
  ```
  {"slug","title","summary","published_at","read_time_minutes","organisation":"Aldermoor Labs",
   "sections":[{"id","heading"}],"body":"<source text>",
   "claims":[{"id","number","text","benchmark","eval_date","model_row_id","comparator_row_id","delta"}],
   "rows":[{"id","subject","subject_name","organisation","benchmark","eval_date","score"}],
   "samples":[{"id","kind":"audio"|"image_sequence","title","urls":["/media/samples/..."]}],
   "linked_news":{"slug","title"}|null}
  ```
- `GET /api/public/news?subject=<subject>&tag=<tag>&page=<n>&as_of=<instant>` returns the body below, plus `"as_of"` when given.
  ```
  {"items":[{"slug","title","summary","subject","tags","published_at","read_time_minutes"}],
   "facets":{"subjects":[{"value","label","count"}],"tags":[{"value","count"}]},
   "page","pages","total"}
  ```
- `GET /api/public/news/<slug>?as_of=` returns `{"slug","title","summary","subject","tags","published_at","read_time_minutes","body","linked_model":{"slug","title"}|null}`, plus `"as_of"` when given.
- An `as_of` that is not an instant in the form `YYYY-MM-DDTHH:mm:ssZ`, or that is later than the present, answers `422 validation_failed` with `as_of` "Choose a past instant in the form YYYY-MM-DDTHH:mm:ssZ.".
- `GET /api/public/search?q=&kind=&cursor=&limit=` returns `{"query","kind","items":[{"kind":"model"|"news"|"role","slug","title","url","published_at","rank","highlight"}],"next_cursor":"<opaque>"|null}`.
  - `kind` is the given kind or null. For roles, `published_at` is the role's `opened_at`. `rank` is a number.
  - `422 validation_failed` field messages:
    - `q`: "Enter between 1 and 200 characters."
    - `limit`: "Choose a limit from 1 to 50."
    - `cursor`: "This cursor does not belong to this search."
- `GET /api/public/roles?discipline=&office=&region=` returns `{"items":[{"slug","title","discipline","office","office_label","region","region_label","opened_at"}]}`.
- `GET /api/public/roles/<slug>` returns `{"slug","title","discipline","office","office_label","region","region_label","description","opened_at","benefits":{"id","effective_from","summary"}|null}`.
- `GET /api/public/benefits` returns `{"regions":[{"region","label","entry":{"id","effective_from","summary"}|null}]}`.
- `GET /feed.xml` returns an Atom feed:
  - Each entry's `<id>` is `<PUBLIC_BASE_URL>/news/<slug>`, and its `<updated>` is its `published_at`.
  - The feed's own `<updated>` is the `published_at` of its newest entry, or `2026-01-01T00:00:00Z` when it has none.
- `GET /sitemap.xml` returns a sitemap whose `<loc>` values are absolute addresses under `PUBLIC_BASE_URL`.
- `GET /media/samples/<model slug>/<sample id>/<file>` returns the stored object with its content type.
  - Unknown keys answer 404.
  - Unreachable storage answers `503 {"error":"storage_unavailable","message":"Samples are unavailable right now."}`.

Hidden and withdrawn items:
- For a hidden or unknown model or news slug, including one not yet published at the `as_of` instant, the public JSON endpoints answer `404 {"error":"not_found","message":"Nothing is published at this address."}` and the HTML routes answer the Not found page. Both are byte-identical across hidden and never-existing slugs.
- A withdrawn item that was once published answers `410 {"error":"gone","message":"This item has been withdrawn."}`, with or without `as_of`.
- A closed role answers `410 {"error":"gone","message":"This role has closed."}`. A role whose requisition is a draft answers the 404.

**Candidate endpoints**

- `POST /api/careers/roles/<slug>/applications` takes a multipart form with the fields `name`, `email`, `consent` (must equal `yes`) and the file `resume`.
  - A new application answers `201 {"application":{"reference":"AR-<8 characters from A-Z and 2-7>","role":{"slug","title"},"stage":"submitted","submitted_at"}}`.
  - A duplicate answers `200` with the original body.
  - `422 validation_failed` field messages:
    - `name`: "Enter your full name."
    - `email`: "Enter a valid email address."
    - `consent`: "Please confirm your consent to apply."
    - `resume`: "Attach a PDF résumé of at most 5,000,000 bytes."
  - `409 {"error":"requisition_closed","message":"This role is no longer accepting applications."}`.
  - `503 {"error":"storage_unavailable","message":"We couldn't store your résumé just now. Nothing was submitted; please try again in a few minutes."}`.
  - An unknown or draft role answers the public 404.
- `POST /api/careers/tracking-links` takes `{"email"}` and returns `202 {"message":"If that address has applied for a role with us, we've sent its tracking links to it."}`. A malformed email answers `422 validation_failed` with the `email` message above.
- `GET /api/track/<token>` returns `200` with exactly the keys `{"role":{"title","office"},"stage","stage_label","submitted_at","stage_changed_at"}`.
- `POST /api/track/<token>/withdraw` takes `{}` and returns `200` in the same shape with `"stage":"withdrawn"`. A terminal application answers `409 illegal_transition`.
- An unknown, superseded or expired token answers `404 {"error":"not_found","message":"This tracking link is not valid."}` on both tracking endpoints.
- Tracking responses and pages send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

**Console endpoints.** Every console endpoint requires a session, and answers 401 without one.

**Accepted body keys.**
- Every content and release-record endpoint accepts exactly the keys listed for it below.
- Content create also accepts only the keys valid for its `kind`.
- Any other key answers `422 {"error":"read_only_fields","message":"Some fields are set by the server.","fields":{"<key>":"This field is set by the server."}}`, with one entry for each offending key. Offending keys include `id`, `kind` on PATCH, `status`, `version`, `author`, `comments`, `release_at`, `release_at_local` outside schedule, `published_at`, `read_time_minutes` and any unknown key.
- When any offending key is present, this error is the whole answer and no other field error is reported. Nothing in the request is applied, the version is unchanged and no audit entry is written.

The content object is:
```
{"id","kind":"model"|"news","slug","title","summary","body","subject","tags","claims","linked_news_slug",
 "status","version","author","comments":[{"id","author","body","created_at"}],"release_at",
 "release_at_local","published_at","read_time_minutes"}
```
- `subject` and `tags` are null for model routes.
- `claims` and `linked_news_slug` are null for news posts.
- `read_time_minutes` stays null until the item publishes.

Sign-in, grants, audit and jobs:

| Method and path | Who | Request | Success | Endpoint-specific errors |
|---|---|---|---|---|
| `POST /api/console/session` | anyone | `{"email","password"}` | `200 {"staff":{"email","name","roles":[{"role","expires_at"}]}}` and the session cookie | `401 {"error":"invalid_credentials","message":"That email and password do not match a staff account."}`; `429 {"error":"signin_locked","message":"Too many failed sign-ins for this email. Try again in <n> seconds."}` with `Retry-After: <n>` |
| `DELETE /api/console/session` | signed in | none | `204` | none |
| `GET /api/console/me` | signed in | none | `200 {"email","name","roles":[{"role","expires_at"}]}` (active grants only) | none |
| `GET /api/console/grants` | administrator | none | `200 {"grants":[{"id","staff_email","role","granted_by","granted_at","expires_at","revoked_at","revoked_by","status":"active"|"expired"|"revoked","version"}]}` | none |
| `POST /api/console/grants` | administrator | `{"staff_email","role","expires_at"}` | `201 {"grant":{...}}` | `422 validation_failed` with field messages `staff_email` "No staff account has that email.", `role` "Choose editor, approver, recruiter or administrator." and `expires_at` "Choose an expiry in the future."; `409 {"error":"grant_exists","message":"That person already holds this role."}` |
| `POST /api/console/grants/<id>/revoke` | administrator, with If-Match | `{}` | `200 {"grant":{...}}` | `409 {"error":"grant_inactive","message":"This grant has already ended."}`; `409 {"error":"last_administrator","message":"You cannot revoke the last active administrator grant."}` |
| `GET /api/console/audit?action=&target_id=&before_seq=&limit=` | administrator | none | `200 {"entries":[{"seq","id","at","actor","action","target_type","target_id","detail","prev_hash","hash"}]}`, highest `seq` first, `limit` 1 to 500 (default 100), only entries with `seq` below `before_seq` when it is given | none |
| `GET /api/console/audit/verify` | administrator | none | `200 {"valid":true,"entries":<n>,"head":"<hash of the highest seq, or 64 zeros when empty>"}` or `200 {"valid":false,"entries":<n>,"first_invalid_seq":<seq>}` | none |
| `PUT`, `PATCH` or `DELETE /api/console/audit/<id>` | anyone signed in | any | never succeeds | `405 {"error":"audit_immutable","message":"Audit entries cannot be changed or removed."}` |
| `GET /api/console/jobs?state=&kind=` | administrator | none | `200 {"jobs":[{"id","kind":"mail"|"resume_erase"|"sample_upload","state":"pending"|"running"|"done"|"dead","attempts","refusals","last_error","next_attempt_at","created_at","finished_at"}]}`, newest first, at most 200 | none |
| `POST /api/console/jobs/<id>/retry` | administrator | `{}` | `200 {"job":{...}}` with state `pending`, attempts and refusals 0 | `409 {"error":"job_not_dead","message":"Only dead jobs can be retried."}` |

Job records never include message bodies, recipients or résumé keys. `last_error` is null or one of `mail_unreachable`, `mail_refused`, `storage_unreachable` or `storage_refused`.

Content, release records and benchmark rows:

| Method and path | Who | Request | Success | Endpoint-specific errors |
|---|---|---|---|---|
| `GET /api/console/content?status=` | editor or approver | none | `200 {"items":[content]}` | none |
| `POST /api/console/content` | editor | `{"kind","slug","title","summary","body"}` plus `subject` and `tags` for news, or `claims` and optionally `linked_news_slug` for model routes | `201 {"content":{...}}`, status `draft`, version 1, author = caller | `422` field messages (after this table) |
| `GET /api/console/content/<id>` | editor or approver | none | `200 {"content":{...}}` | none |
| `PATCH /api/console/content/<id>` | the author, holding an editor grant, with If-Match | any non-empty subset of `slug`, `title`, `summary`, `body`, `subject`, `tags`, `claims`, `linked_news_slug` valid for its kind | `200` | `409 {"error":"not_editable","message":"Only drafts and returned items can be edited."}`; `422` as for create |
| `POST /api/console/content/<id>/submit` | the author, holding an editor grant, with If-Match | `{}` | `200` | `409 illegal_transition` |
| `POST /api/console/content/<id>/comments` | editor or approver | `{"body"}` (1 to 4,000 characters) | `201 {"comment":{...}}` | `409 {"error":"comments_closed","message":"Comments are closed once an item is scheduled."}` |
| `POST /api/console/content/<id>/approve` | approver who is not the author, with If-Match | `{}` | `200` | `409 illegal_transition` |
| `POST /api/console/content/<id>/return` | approver who is not the author, with If-Match | `{"reason"}` (1 to 2,000 characters) | `200` | `422` with `reason` "Say what needs to change."; `409 illegal_transition` |
| `POST /api/console/content/<id>/schedule` | approver who is not the author, with If-Match | `{"release_at_local"}` | `200` with `release_at`, `release_at_local` and `"zone":"Europe/London"` filled in | `422` for `release_at_local` per Business rules; `409 {"error":"release_record_not_cleared","message":"This model route's release record is not cleared."}`; `409 {"error":"linked_post_not_ready","message":"The linked announcement must be approved before scheduling."}`; `409 {"error":"linked_to_model","message":"This post releases with its model route."}`; `409 illegal_transition` |
| `POST /api/console/content/<id>/release` | approver who is not the author, with If-Match | `{}` | `200` | `409 linked_to_model`; `409 illegal_transition` |
| `POST /api/console/content/<id>/withdraw` | approver, with If-Match | `{}` | `200` | `409 linked_to_model` (only while the linked model route is scheduled); `409 illegal_transition` |
| `GET /api/console/content/<id>/release-record` | editor or approver | none | `200 {"record":{"status","safety":{"by","at","note"}|null,"legal":{...}|null,"claims_validated_at","cleared_by","cleared_at","last_validation":[{"claim","ok","reason"}]|null}}` | `404` for news posts |
| `POST /api/console/content/<id>/release-record/signoffs` | approver who is not the author | `{"kind":"safety"|"legal","note"}` (note 0 to 2,000 characters) | `201 {"record":{...}}` | `409 {"error":"already_signed","message":"This sign-off is already recorded."}`; `409 {"error":"distinct_approver_required","message":"Safety and legal sign-off must come from different approvers."}`; `409 {"error":"not_in_review","message":"Sign-offs are recorded while a route is in review or approved."}` |
| `POST /api/console/content/<id>/release-record/validate-claims` | editor or approver | `{}` | `200 {"record":{...}}` | `409 {"error":"signoffs_incomplete","message":"Record both sign-offs before validating claims."}`; `409 signoff_lapsed`; `422 {"error":"claims_invalid","message":"Some claims do not match the recorded rows.","fields":{"<claim id or body>":"<reason>"}}` |
| `POST /api/console/content/<id>/release-record/clear` | approver who is not the author | `{}` | `200 {"record":{...}}` | `409 {"error":"claims_not_validated","message":"Validate the claims before clearing this record."}`; `409 {"error":"signoff_lapsed","message":"A sign-off holder no longer holds the approver role. Record that sign-off again."}` |
| `GET /api/console/benchmark-rows` | editor or approver | none | `200 {"rows":[...]}` | none |
| `POST /api/console/benchmark-rows` | editor or approver | `{"subject","benchmark","eval_date","score","source_note"}` | `201 {"row":{"id",...}}` | `422` with field messages `subject` "Choose a model route or a recorded comparator." and `score` "Enter a score from 0 to 100 with at most two decimals."; `409 {"error":"row_exists","message":"A row for this model, benchmark and date is already recorded."}` |
| `PATCH` or `DELETE /api/console/benchmark-rows/<id>` | anyone signed in | any | never succeeds | `405 {"error":"rows_immutable","message":"Recorded rows cannot be changed."}` |

Field messages for creating or editing content:
- `kind`: "Choose model or news."
- `slug`: "Use lowercase letters, numbers and single hyphens, up to 80 characters." or "That slug is already in use."
- `title`: "Enter a title."
- `body`: "Claim markers belong on model routes." for news posts.
- `claims`: "Each claim needs an id, text, benchmark, evaluation date, comparator and stated difference."
- `linked_news_slug`: "No news post has that slug."

Requisitions, applications and benefits:

| Method and path | Who | Request | Success | Endpoint-specific errors |
|---|---|---|---|---|
| `GET /api/console/requisitions` | recruiter | none | `200 {"requisitions":[{"id","slug","title","status","discipline","office","recruiters","version","counts":{"<stage>":n}}]}`, only those the caller is assigned to, with `counts` naming every stage, including those at 0 | none |
| `GET /api/console/requisitions/<id>` | an assigned recruiter | none | `200 {"requisition":{...}}` with `description` | none |
| `POST /api/console/requisitions` | recruiter | `{"slug","title","discipline","office","description","recruiters":[emails]}` | `201 {"requisition":{...}}`, status `draft`, version 1, caller always assigned | `422` with field messages `title` "Enter a title of at most 120 characters.", `description` "Enter a description of at most 8,000 characters.", `office` "Choose a listed office." and `recruiters` "Each recruiter must hold the recruiter role." |
| `POST /api/console/requisitions/<id>/open` | an assigned recruiter, with If-Match | `{}` | `200` | `409 illegal_transition` |
| `POST /api/console/requisitions/<id>/close` | an assigned recruiter, with If-Match | `{"reason"}` (1 to 2,000 characters) | `200` | `422` with `reason` "Say why this requisition is closing."; `409 illegal_transition` |
| `GET /api/console/requisitions/<id>/applications` | an assigned recruiter | none | `200 {"applications":[{"id","reference","name","email","stage","submitted_at","version"}]}` | none |
| `GET /api/console/applications/<id>` | an assigned recruiter | none | `200 {"application":{"id","reference","name","email","stage","version","submitted_at","decisions":[{"from","to","rationale","by","at"}],"notes":[{"id","body","by","at"}]}}` | none |
| `POST /api/console/applications/<id>/stage` | an assigned recruiter, with If-Match | `{"to","rationale"}` (rationale 1 to 2,000 characters) | `200 {"application":{...}}` | `422` with `rationale` "Record the reason for this decision."; `409 illegal_transition` |
| `POST /api/console/applications/<id>/notes` | an assigned recruiter | `{"body"}` (1 to 4,000 characters) | `201 {"note":{...}}` | none |
| `GET /api/console/applications/<id>/resume` | an assigned recruiter | none | `200` PDF bytes with `Content-Disposition: attachment; filename="resume-<reference>.pdf"` | `503 storage_unavailable` (message "Résumés are unavailable right now.") |
| `POST /api/console/applications/<id>/tracking-link/reissue` | an assigned recruiter | `{}` | `200 {"reissued_at"}` | `409 {"error":"link_retired","message":"This application's retention period has ended."}` |
| `POST /api/console/benefits` | recruiter | `{"region","effective_from","summary"}` | `201 {"entry":{...}}` | `422` with field messages `region` "Choose a listed region.", `effective_from` "Use a real date in the form YYYY-MM-DD." and `summary` "Enter a summary of at most 500 characters."; `409 {"error":"entry_exists","message":"That region already has an entry from this date."}` |

An application or requisition the caller is not assigned to answers the console 404, exactly as an unknown id does. That includes the résumé download.

### Business rules (DP-03, DP-05, DP-11, DP-12, DP-13, DP-14, DP-15, DP-17, DP-18, DP-19, DP-22, DP-23, DP-25, DP-29, DP-31, DP-34, DP-35, DP-36, DP-40, DP-41, DP-52, DP-53, DP-54, DP-55, DP-56, DP-57, DP-58, DP-59, DP-61, DP-62, DP-64, DP-65, DP-66, DP-68)

**Content lifecycle** for model routes and news posts. The legal moves are:
- `draft → in_review` (submit, by the author)
- `in_review → returned` (return, with a reason)
- `in_review → approved` (approve)
- `returned → in_review` (resubmit, by the author)
- `approved → scheduled` (schedule)
- `scheduled → published` (the embargo firing, or "Release now")
- `scheduled → withdrawn` (pulling the embargo)
- `published → withdrawn` (withdrawal)

Any other move answers `409 illegal_transition` and changes nothing. `withdrawn` is final.

Further content rules:
- Only `draft` and `returned` items can be edited.
- Comments are allowed in `draft`, `in_review`, `returned` and `approved`.
- Who may perform each move is set by the API tables. Everything an author may not do on their own item (approve, return, sign off, clear, schedule, release) answers `403 author_cannot_approve`, whatever grants the author holds.

**Body text**
- A line starting with `## ` begins a section, and the rest of the line is its heading.
- Blank lines separate paragraphs.
- A marker of the form `[claim:<id>]` stands for that claim. It renders as the claim's text followed by its numbered marker. Claims are numbered 1 upward in order of first appearance in the body.
- Nothing else is interpreted, and all other text is escaped.

**Read time** is computed by the server at the moment an item publishes, and stored with it:
- Take the body, replace each marker with its claim text, and drop the `## ` prefixes.
- Count whitespace-separated words, divide by 225 and round up, with a minimum of 1 minute.
- A client never supplies it. The key is refused as a server-owned field.

**Benchmark rows**
- A row records a subject, benchmark, evaluation date, score and source note.
- The subject is a model route slug of any status, or a recorded comparator from Seed data.
- A score is a decimal string from 0 to 100 inclusive with at most two decimals, displayed exactly as recorded.
- At most one row exists per subject, benchmark and evaluation date.
- Rows are never changed or removed.

**Chart grouping.** A model route's chart and its evaluation table show one group per benchmark and evaluation date on which the route's model has a row. Each group holds the model's row and the row of every comparator recorded on the same benchmark and date. Groups are ordered by benchmark name. Within a group, the model comes first and comparators follow by name.

**Claims**
- A claim is `{"id","text","benchmark","eval_date","comparator","stated_delta"}`. The id matches `c` followed by digits.
- `stated_delta` is a decimal string with at most two decimals and an optional leading `+` or `-`. A value without a sign is read as positive. Any other form fails the `claims` field message.
- The recorded difference is the model's score minus the comparator's score on that benchmark and date. It uses the larger number of decimals of the two scores and carries an explicit sign, for example "+3.2" or "-3.5".
- The recorded difference is the `delta` the public API returns and the value the tether label counts to.
- The stated difference equals the recorded difference when their numeric values are equal, so "3.2", "+3.2" and "+3.20" all equal a recorded "+3.2", and "3.2" does not equal a recorded "-3.2".

**Claim validation** checks every claim and returns a reason for each failure:
- `missing_rows`: "No recorded row for <subject> on <benchmark> at <date>."
- `delta_mismatch`: "Stated difference <stated> does not match the recorded difference <recorded>." `<stated>` is the stated difference as submitted, and `<recorded>` is the signed recorded difference.
- `number_mismatch`: "The number <n> in the claim text does not match the cited rows." Every number in the claim text, found as described below, must equal the model score, the comparator score or the absolute recorded difference.
- `marker_missing`: "Claim <id> is not marked in the body."
- `unknown_marker`, reported under the key `body`: "The body marks claim <id>, which is not defined."

Validation passes only when there are no failures. Numbers in the body outside claims are not validated. For example, with the seed data at start, validating `kestrel-3` passes: its stated "6.9" equals the recorded "+6.9".

**Numbers in claim text** are found in three steps:
1. **Remove names.** Remove every occurrence of the route's title (its model name), the display name of every recorded comparator and the claim's benchmark name. Model and benchmark names are never checked as numbers, even when they contain digits.
2. **Find candidates.** A candidate is a maximal run of the digits 0 to 9 that contains at most one decimal point, with at least one digit on each side of that point. A plus or minus sign written directly before a candidate is not part of it.
3. **Skip non-numbers.** Skip a candidate when the character directly before or after it is a letter, so tokens such as "Q3" are not numbers. Also skip a candidate that is part of a date written `YYYY-MM-DD`.

Every remaining candidate is a number, whether or not it has a decimal point. Numbers are compared by numeric value, so "76" equals "76.0". For example, with the seed data at start, the numbers in claim `c1` of `kestrel-2` are 71.4 and 3.2. The "2" in "Kestrel 2" and the "3" in "Halvard 3" are removed in step 1.

**Release record** (model routes only):
- The status moves `open → safety_signed` or `legal_signed` (whichever comes first) `→ signed` (both) `→ claims_validated → cleared`.
- Safety and legal sign-off each come from an approver who is not the author, and the two must be different approvers.
- Validation can run once the record is `signed`, and may re-run until the record is cleared. A passing run moves the record to `claims_validated`. A failing run keeps it at `signed`.
- Clearing requires `claims_validated`.
- Any edit to a model route empties its record back to `open`. Both sign-offs and the validation are voided, with one `release_record.void` audit entry whose detail is `{"reason":"route_edited"}`.
- Scheduling a model route requires a `cleared` record.

**Sign-off races.** Sign-offs on one record are applied one at a time:
- Two approvers recording the same kind at once: exactly one answers 201, and the other answers `409 already_signed`.
- One approver recording safety and legal at once: exactly one answers 201, and the other answers `409 distinct_approver_required`.
- Each successful sign-off writes exactly one sign-off and one audit entry.

**Sign-offs lapse with the signer's authority:**
- A sign-off on a record that is not yet `cleared` is valid only while its signer holds an active approver grant.
- When an administrator revokes a grant, every such sign-off by that grantee is voided in the same transaction as the revocation. The record's validation is voided too, so `claims_validated_at` and `last_validation` become null. The record falls back to the state of the remaining sign-off: `safety_signed`, `legal_signed` or `open`.
- When a grant reaches its expiry instant, the same void happens within 60 seconds.
- Between the expiry instant and the void, validate-claims and clear answer `409 signoff_lapsed` and change nothing.
- Each voided sign-off writes one `release_record.void` audit entry with the actor `system:grants` for expiry, or the revoking administrator for revocation. Its detail is `{"reason":"signoff_lapsed","kind":"safety"|"legal","signer":"<email>"}`.
- A sign-off attempted at or after the signer's expiry instant answers `403 forbidden`.
- Cleared records are history and are never voided.

**Linked announcement**
- A model route may name one news post as its linked announcement.
- Scheduling the route requires that post to be `approved`, and schedules both for the same instant in the same transaction.
- While the route is scheduled, the post cannot be scheduled, released or withdrawn on its own (`409 linked_to_model`).
- Withdrawing the route withdraws its linked post in the same transaction, whether that post is scheduled or published.
- A published post can later be withdrawn on its own.

**Embargo time** (`release_at_local`):
- It accepts `YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss`, read as a wall-clock time in Europe/London, and is stored as an instant.
- A time that does not exist because the clocks go forward answers `422` with `release_at_local` "That time does not exist in London because the clocks go forward."
- A time that happens twice because the clocks go back means the earlier occurrence, in British Summer Time.
- A time that is not after the present answers "Choose a time in the future." A malformed value answers "Use the form YYYY-MM-DDTHH:mm."
- For example, `2027-03-28T01:30` is refused. `2027-10-31T01:30` is stored as `2027-10-31T00:30:00Z`, `2027-07-01T09:00` as `2027-07-01T08:00:00Z`, and `2027-01-15T09:00` as `2027-01-15T09:00:00Z`.

**Release**
- A scheduled item publishes within 5 seconds after its instant, exactly once across all instances.
- Publishing sets `published_at` to the release instant and computes read time. In the same database transaction, it makes the item, and its linked announcement if any, appear on every public surface and in search, and records the publication in the publication history.
- Before the instant, no public surface or search result mentions either item.
- The release is audited with the actor `system:scheduler`, and the scheduling approver goes in its detail.
- "Release now" publishes immediately along the same path, with `published_at` set to the present.

**Concurrency.** Every versioned change is conditional on the version sent in `If-Match`:
- Of several requests carrying the same version, exactly one succeeds and the rest answer 412.
- A release that fires increases the version, so a withdrawal sent with the pre-release version answers 412. If the withdrawal wins, the release never happens.

**Public ordering and visibility**
- Only `published` items appear publicly.
- The catalogue grid, the Models menu and the API list order model routes by `published_at`, newest first.
- The newsroom orders posts by `published_at`, newest first, with ties broken by slug.
- The home rail shows the five most recent published model routes and news posts. At the same instant, model routes come before news, then items go by title. When an item leaves the rail, the next most recent one enters.
- The feed lists every published news post, newest first.
- The sitemap lists `/`, `/models`, `/news`, `/search`, `/careers`, every published model route, every published news post and every open role.

**Newsroom filters**
- `subject` is one of `research`, `safety`, `policy` or `company`. `tag` is a single tag. `page` is a positive whole number, with 10 posts per page.
- An unknown subject or tag yields no posts. A missing or invalid page means page 1. A page beyond the last yields no posts.
- `pages` is the total divided by 10, rounded up, with a minimum of 1.
- Subject facets:
  - Every subject is listed, in the order above, including those with a count of 0.
  - Each count is the number of published posts matching the current tag filter.
- Tag facets:
  - Only the tags carried by at least one published post are listed, in alphabetical order.
  - Each count is the number of published posts matching the current subject filter, and may be 0.

**Withdrawal and derived values**
- Withdrawing a published item removes it, in the same transaction, from every surface under public ordering, from search and from all facets.
- Every derived value then equals a fresh recount of the published items: total, pages, subject counts, the tag list and its counts, the five-item home rail, and the feed's `<updated>`.
- No published item keeps a reference to a withdrawn item:
  - Withdrawing a post on its own sets its model route's `linked_news` to null, and the route page drops the announcement link.
  - A withdrawn route's post is withdrawn with it, so no `linked_model` names a withdrawn route.
- From then on, its page and API address answer 410.
- An item withdrawn while scheduled was never public, and stays 404.

**Record as of** (`as_of`):
- The publication history records each item's publication instant and its withdrawal instant.
- For an instant T, the record as of T holds the items published at or before T that are not withdrawn now. Withdrawn items never reappear, at any T.
- Lists, facets, totals, pages, `linked_news` and `linked_model` are computed over that set with the same rules as the current record.
- Item details show the item as it was published.

**Search**
- Search covers published model routes (title, summary, and body with markers replaced by claim text), published news posts (title, summary, body) and open roles (title, description). Tags, theses and claims outside the body are not searched.
- Matching uses English word stemming, so "evaluation" matches "evaluations" and "evaluated". Words in `q` must all match. Text in double quotes must match as a phrase. A word with a leading minus excludes items containing it.
- Titles weigh most, then summaries, then bodies and descriptions. An item matching only in its title ranks above an otherwise identical item matching only in its body.
- Results are ordered by `rank` (highest first), then by `published_at` (newest first), then by slug.
- `kind` is `model`, `news` or `role`, or it is absent. An unknown kind yields no results.
- `limit` defaults to 10 in the API. The Search page always requests `limit=3`.
- `highlight` is a passage of at most 30 words from the best-matching summary, body or description. Each matched word is wrapped in `<mark>` and `</mark>`, and all other text is HTML-escaped. When only the title matches, the passage is the first 30 words of the summary (or description) with no marks.
- `next_cursor` is null on the last page.
- Following `next_cursor` until it is null returns every match exactly once, in order. An item withdrawn between pages is never returned.
- A cursor is bound to its `q` and `kind`.

**Careers**
- `discipline` is one of `research`, `engineering`, `policy` or `operations`. `office` and `region` take the values in Seed data.
- An unknown value yields no roles. Filters combine with AND.
- Roles are ordered by `opened_at`, newest first, then by title.

**Careers text limits.** Each limit is in code points after trimming. Exactly the limit is accepted, and one more is refused with the field message from API.
- Requisition `title`: 1 to 120.
- `description`: 1 to 8,000.
- Benefits `summary`: 1 to 500.
- Close `reason`: 1 to 2,000.

An emoji or a character such as 𝔄 counts as one. Stored text reaches the public role and benefits APIs exactly as stored.

**Requisition lifecycle**
- The legal moves are `draft → open` and `open → closed`. Anything else answers 409 `illegal_transition`.
- A draft role is not public.
- Closing moves every application in `submitted`, `screening`, `interview` or `final_review` to `declined`, in the same transaction:
  - Each one records the rationale "Requisition closed: <reason>", attributed to the closing recruiter.
  - Each one gets a stage notice.
  - Each one's version rises by one.

**Benefits register**
- Entries are never changed.
- `effective_from` must be a real calendar date, so `2027-02-30` and `2027-13-01` are refused.
- For each region, the entry in force is the one with the latest `effective_from` on or before today's date in Europe/London.
- An entry dated today (London) is in force from its creation. One dated tomorrow (London) comes into force at London midnight, on the next request.

**Application lifecycle**
- The legal moves are:
  - `submitted → screening`
  - `screening → interview`
  - `interview → final_review`
  - `final_review → offer`
  - any of `submitted`, `screening`, `interview` or `final_review` to `declined` or `withdrawn`
- Anything else answers `409 illegal_transition`.
- Each move records the from-stage, to-stage, rationale, actor and time.
- A candidate withdrawal records the actor `candidate` and the rationale "Withdrawn by candidate".
- Stage labels: `submitted` "Submitted", `screening` "Screening", `interview` "Interview", `final_review` "Final review", `offer` "Offer", `declined` "Not progressing", `withdrawn` "Withdrawn".
- A requisition's `counts` always equal the stages actually stored.

**Stage-move races.** Changes to one application are applied one at a time:
- **Moves at the same version:** of several recruiters' moves at one version, exactly one answers 200 and the rest answer 412. The result is one decision, one stage email, one audit entry and a version one higher.
- **Candidate withdrawal:** it takes no version. It applies to whatever stage is current when it runs, and raises the version.
- **Withdrawal against a move to offer:** if `final_review → offer` wins, the withdrawal answers 409 `illegal_transition` ("This item cannot move from offer to withdrawn."). If the withdrawal wins, the move answers 412.
- **Close against a move:** a move sent with the version from before a requisition close answers 412.

**One application per email per role**
- The first submission answers 201.
- A later submission for the same requisition with the same trimmed, lowercased email answers 200 with the original body. It stores no new résumé and sends no new email.
- Of several identical submissions that race, exactly one answers 201.

**Candidate name and email**
- `name` is refused with its message if, after trimming:
  - it is empty or longer than 120 code points, or
  - it contains any control character (U+0000 to U+001F, U+007F) or a line or paragraph separator (U+2028, U+2029).
- `email` is refused with its message if, after trimming:
  - it is longer than 254 characters, or
  - it does not have exactly one `@` with a non-empty part before it and a domain containing a dot after it, or
  - it contains a carriage return, line feed, comma, semicolon, space, quote mark, angle bracket or any control character.
- The stored email is trimmed and lowercased. Both checks happen before anything is stored or sent.

**Tracking links**
- Each application has exactly one live tracking link. Its token holds at least 128 random bits, encoded as 32 or more URL-safe characters. The link is `<PUBLIC_BASE_URL>/track/<token>`.
- Reissuing it (by a recruiter) or re-sending it (by the candidate) creates a new token and kills the old one at once.
- The link works while the requisition is open, and after closing until `APPLICATION_RETENTION_SECONDS` have passed since the close. That deadline is fixed when the requisition closes: the close stores `closed_at` plus the closing instance's `APPLICATION_RETENTION_SECONDS` with the requisition, and whichever instance runs the retention sweep erases by that stored deadline, never by its own setting.
- Within 60 seconds after that:
  - The link answers 404.
  - A `resume_erase` job deletes the résumé object.
  - The application's name and email become "Erased applicant" and an empty value.
  - The erasure is audited with the actor `system:retention`.
- The link can read the application and withdraw it, and nothing else.

**Re-sending links**
- **Known email, within the limit:** the server creates a new token for every application of that email whose link is still live, and queues one email listing them.
- **Unknown email:** it queues nothing.
- **The limit:**
  - Each trimmed, lowercased email may cause at most three re-send emails in any rolling `RESEND_WINDOW_SECONDS`.
  - Requests for unknown emails count against the same limit.
  - A request over the limit queues nothing and mints no tokens, so the last issued links keep working.
- Every request answers the same 202 body, and known and unknown emails take the same time to within a quarter of a second. The response never waits on mail.

**Role grants**
- Roles are `editor`, `approver`, `recruiter` and `administrator`.
- A grant is active from `granted_at` until strictly before `expires_at`, unless it is revoked.
- Every console request checks active grants at that moment. Sessions never carry roles.
- A signed-in person with no active grant can reach only `/api/console/me` and sign-out. Every other endpoint answers 403, except the changes the tables mark "never succeeds" for anyone signed in, which answer their 405.
- **Expiry notices:**
  - Each grant whose expiry is within seven days (604,800 seconds) of the present gets exactly one expiry notice of its own in the outbox, within 60 seconds of becoming due. That includes a grant created already inside the window.
  - A grantee holding several such grants gets one notice per grant, never a combined notice.
  - The notice is delivered under the job rules in Services.

**Staff sessions**
- A session is a database record with a random identifier held in the cookie. It lasts `SESSION_TTL_SECONDS` from sign-in and ends at sign-out.
- A session created through one instance works on every other instance.

**Sign-in lockout**
- Failed sign-ins are counted per trimmed, lowercased email, whether or not a staff account has that email.
- After 5 consecutive failures, sign-in for that email is locked for `SIGNIN_LOCKOUT_SECONDS`.
- Each failure after a lock ends locks again, for double the previous lock, up to 8 times `SIGNIN_LOCKOUT_SECONDS`.
- During a lock, every attempt answers the `signin_locked` 429, whether its password is right or wrong. Attempts during a lock neither extend it nor count as failures.
- A successful sign-in resets the count.
- Known and unknown emails get identical answers.

**Rate limits**
- Each bucket counts requests in fixed 60-second windows, starting at the bucket key's first counted request in that window.
- Within a window, requests up to and including the limit are served. Later requests answer the 429 from API, change nothing and store nothing.

| Bucket | Counted requests | Keyed by | Limit per window | Set by |
|---|---|---|---|---|
| public | every public HTML page, `/api/public/*`, `/feed.xml`, `/sitemap.xml`, `/media/samples/*` | client | 600 | `RATE_LIMIT_PUBLIC_PER_MINUTE` |
| candidate | application submissions, `/api/careers/tracking-links`, `/api/track/*` | client | 60 | `RATE_LIMIT_CANDIDATE_PER_MINUTE` |
| sign-in | `POST /api/console/session` | client | 20 | `RATE_LIMIT_SIGNIN_PER_MINUTE` |
| console writes | every console POST, PATCH, PUT and DELETE except sign-in | staff account | 120 | `RATE_LIMIT_CONSOLE_WRITES_PER_MINUTE` |

- The client is the connection's peer address. When `TRUST_FORWARDED_FOR` is `true`, it is the leftmost address in `X-Forwarded-For`.
- Counts live in PostgreSQL, so every instance shares them.
- Static assets, `/api/health` and `/api/ready` are not counted.

**Running more than one instance**
- Every instance is identical and keeps no state of its own. Sessions, rate-limit counts, lockouts, idempotency keys, embargo schedules, job leases and any cache live in the database.
- A change committed through one instance is reflected on the next request to every other instance.
- Each piece of scheduled work runs exactly once across instances, through a database lease or lock: embargo releases, sign-off voiding on expiry, grant-expiry notices, retention erasure and job delivery.

**Audit**
- Every console state change, scheduled release, sign-off void, candidate withdrawal, retention erasure, job retry and claim-validation run writes exactly one entry, in the same transaction as the change. A requisition close also writes one entry per declined application.
- An entry records the actor, the action, the target type and id, the time, and a detail object. The actor is a staff email, `candidate`, `system:scheduler`, `system:grants` or `system:retention`.
- Actions are named `<target>.<verb>`. They include:
  - grants: `grant.create`, `grant.revoke`
  - release records: `signoff.safety`, `signoff.legal`, `release_record.void`, `claims.validate`, `release_record.clear`
  - content: `content.create`, `content.update`, `content.submit`, `content.comment`, `content.approve`, `content.return`, `content.schedule`, `content.release`, `content.withdraw`
  - benchmark rows: `row.create`
  - requisitions and benefits: `requisition.create`, `requisition.open`, `requisition.close`, `benefits.create`
  - applications: `application.stage`, `application.note`, `tracking_link.reissue`, `application.erase`
  - jobs: `job.retry`
- No entry ever contains a candidate's name, email or résumé key. Application entries identify the application by id and reference.
- Entries live in a table named `audit_entries`. The database itself refuses UPDATE, DELETE and TRUNCATE on it, even from the platform's own role. The API offers no way to change an entry.

**Audit chain**
- Entries carry `seq`: whole numbers from 1 upward with no gaps, assigned in commit order across all instances.
- `at` is written as `YYYY-MM-DDTHH:mm:ss.sssZ`.
- `prev_hash` is the previous entry's `hash`, or 64 zeros for entry 1.
- `hash` is the lowercase hex SHA-256 of the UTF-8 bytes of `prev_hash`, then a line feed, then the canonical JSON of `{"seq","at","actor","action","target_type","target_id","detail"}`.
  - Canonical JSON has keys sorted at every level, no whitespace between tokens, and non-ASCII characters written as themselves.
  - `target_id` is a string. `detail` holds only strings, whole numbers, booleans, null, arrays and objects.
- Verification recomputes every hash in `seq` order and reports the first entry whose `prev_hash` or `hash` does not match.
- Because entries never hold candidate personal data, retention erasure changes no entry, and the chain stays valid.
- Seed data writes no audit entries.

### Services (DP-07, DP-14, DP-27, DP-28, DP-30, DP-31, DP-35, DP-36, DP-40, DP-45, DP-55, DP-62, DP-63)

**PostgreSQL** (`DATABASE_URL`) is the only system of record. It holds:
- content and revisions, comments, release records and sign-offs
- benchmark rows and claim validations
- embargo schedules and the publication history
- the search index
- requisitions, applications, stage decisions and notes, tracking-token digests and benefits
- staff, grants and sessions
- rate-limit counts, lockouts and idempotency keys
- the job queue (its mail jobs are the outbox)
- the audit table

Every instance, including the outage instances, shares this one database. The schema and seed data are applied idempotently every time serving starts, and several instances starting together must not conflict.

**MinIO** (the `S3_*` variables, private bucket `S3_BUCKET`):
- **Samples** are stored at `samples/<model slug>/<sample id>/<file>`: `clip.wav` for audio, and `frame-01.png` to `frame-12.png` for image sequences.
  - The platform generates them procedurally and queues a `sample_upload` job for any that are missing at start.
  - Samples reach visitors only through `/media/samples/...`.
- **Résumés** are stored at `resumes/<requisition id>/<32 lowercase hex characters chosen by the server>.pdf` with content type `application/pdf`.
  - The candidate's file name never appears in the key, and the bucket stays private.
  - Résumés reach staff only through the console download.
- **Résumé checks:** a résumé is a PDF when its first five bytes are `%PDF-`. The declared content type and the file extension are ignored. Its size must be 1 to 5,000,000 bytes, inclusive at both ends.
- **Storage outage:** storage calls give up after 3 seconds.
  - An application whose résumé cannot be stored answers the 503 from API, and no application row, object or outbox entry remains. If the database write fails after an upload, the object is deleted before the response.
  - The résumé download answers its 503.
  - Model routes still answer 200, with the gallery notice from Feedback states.
  - Storage jobs wait and retry.

**Mail** (`SMTP_HOST`, `SMTP_PORT`, Mailpit in grading):
- **Queueing:** every email is written to the outbox as a `mail` job in the same transaction as the change that causes it. A mail outage never fails the action that queued the email.
- **Addressing:**
  - Every message has exactly one recipient in `To`, and no Cc or Bcc.
  - For candidates, the display name is the stored name exactly as submitted after trimming, and the address is the stored email. For staff, they are the staff name and email.
  - Display names and subjects that are not plain ASCII are encoded with the standard mail header encoding for non-ASCII text (RFC 2047), so they decode exactly. A name containing commas, quotes or apostrophes is quoted so that it stays one recipient.
- **Sender:** `MAIL_FROM`.
- **Message-ID:** every attempt for one job carries the same header, `<outbox-<job id>@aldermoor.example>`.
- **Delivery:**
  - Delivery is at least once.
  - A job is marked `done` only after the mail server accepts the message.
  - An attempt that fails before acceptance produces no message.
  - A second copy can appear only when the connection fails after acceptance and before the platform recorded the send. Both copies then carry the same Message-ID.

Messages:

| Trigger | To | Subject | Body includes |
|---|---|---|---|
| New application | candidate | "Application received: <role title>" | name, role title, reference, tracking link |
| Stage move (including declines on close) | candidate | "Update on your Aldermoor application" | role title, "Your application is now at: <stage label>.", tracking link; never the rationale or notes |
| Links re-sent | candidate | "Your Aldermoor application links" | one line per live application with role title and new tracking link |
| Recruiter reissue | candidate | "Your new tracking link: <role title>" | new tracking link |
| Model route submitted or resubmitted | one message to each holder of an active approver grant except the author | "Release record awaiting sign-off: <title>" | title and the console address of the item |
| Grant expiry within seven days (one message per grant) | grantee of that grant | "Your <Role> access ends soon" | that grant's role and expiry in London time |

**Background jobs** (kinds `mail`, `resume_erase`, `sample_upload`):
- **Readiness probes:** each instance probes storage and mail when it starts, before it claims any job, and then at most every 5 seconds, so `/api/ready` reflects a change within 10 seconds.
- **Claiming:**
  - Every instance runs a worker that claims due `pending` jobs at least once every `OUTBOX_RETRY_SECONDS`.
  - An instance claims a job only while its own most recent probe reports that job's service as up: mail for `mail` jobs, storage for `resume_erase` and `sample_upload` jobs. An instance that cannot reach a service therefore leaves those jobs for instances that can.
  - A claim sets the job `running` with a 60-second lease, so two instances never run one job at the same time.
  - A job whose lease lapses becomes `pending` again.
- **Failed attempts:**
  - An attempt that cannot reach the service (connection refused, timeout or name lookup failure) records `mail_unreachable` or `storage_unreachable` and makes the job due again after `OUTBOX_RETRY_SECONDS`. It never adds to `refusals`, never lengthens the delay and never counts toward dead-lettering.
  - An attempt the service answers with a refusal records `mail_refused` or `storage_refused` and adds one to `refusals`. A refusal is a permanent SMTP rejection, or a storage error reply other than "not found" on a delete. After the n-th refusal, the next attempt is due after `OUTBOX_RETRY_SECONDS` × 2^(n−1) seconds, capped at `OUTBOX_RETRY_MAX_SECONDS`.
  - `attempts` counts every attempt of either kind.
- **Dead jobs:**
  - A job reaching `JOB_MAX_ATTEMPTS` refusals becomes `dead` and is not attempted again until an administrator retries it.
- **Recovery:**
  - A job queued while its service was unreachable from the instance that queued it completes within `OUTBOX_RETRY_MAX_SECONDS` plus 10 seconds of the service being reachable from any running instance, with no restart.

### Seed data (DP-01, DP-04, DP-25, DP-39, DP-67)

Every seeded person, organisation, model, benchmark and score is invented.

**Staff.** Every staff password is `open-record-seed-2026`. Every seeded grant expires `2027-12-31T23:59:59Z`, was granted by Ada Penrose, and has version 1.

| Name | Email | Grants |
|---|---|---|
| Ines Halloran | ines.halloran@aldermoor.example | editor |
| Tomas Reyes | tomas.reyes@aldermoor.example | editor, approver |
| Eleni Marsh | eleni.marsh@aldermoor.example | approver |
| Kofi Brennan | kofi.brennan@aldermoor.example | approver |
| Sana Qadir | sana.qadir@aldermoor.example | recruiter |
| Jules Okonkwo | jules.okonkwo@aldermoor.example | recruiter |
| Ada Penrose | ada.penrose@aldermoor.example | administrator |
| Noor Vance | noor.vance@aldermoor.example | none |

**Comparators:** `halvard-3` "Halvard 3" from Brightline AI, and `morrow-l` "Morrow L" from Teague Systems.

**Benchmark rows** (subject, benchmark, evaluation date, score):
- kestrel-2 ReasonBench-Hard 2026-09-14 71.4
- halvard-3 ReasonBench-Hard 2026-09-14 68.2
- morrow-l ReasonBench-Hard 2026-09-14 70.9
- kestrel-2 LongDoc-QA 2026-09-14 84.9
- halvard-3 LongDoc-QA 2026-09-14 80.6
- morrow-l LongDoc-QA 2026-09-14 85.3
- kestrel-2 CodeTrace 2026-09-14 58.0
- morrow-l CodeTrace 2026-09-14 61.5
- kestrel-1 ReasonBench-Hard 2026-03-01 62.7
- kestrel-3 ReasonBench-Hard 2026-10-20 76.0
- halvard-3 ReasonBench-Hard 2026-10-20 69.1

**Model routes**

`kestrel-2` "Kestrel 2":
- Summary: "Our second general research model, built for long, careful reading."
- Published `2026-09-30T08:00:00Z` (09:00 London). Author Tomas Reyes.
- Release record cleared: safety by Eleni Marsh, legal by Kofi Brennan.
- Linked announcement: `introducing-kestrel-2`.
- Claims:
  - `c1`: text "On ReasonBench-Hard, Kestrel 2 scores 71.4, 3.2 points above Halvard 3.", benchmark ReasonBench-Hard, date 2026-09-14, comparator halvard-3, stated difference "3.2".
  - `c2`: text "On LongDoc-QA, Kestrel 2 scores 84.9, 4.3 points above Halvard 3.", benchmark LongDoc-QA, date 2026-09-14, comparator halvard-3, stated difference "4.3".
- Body:
  ```
  ## What Kestrel 2 is
  Kestrel 2 is our second general research model, trained for long, careful reading and multi-step reasoning. [claim:c1]

  ## How we evaluated it
  Every score on this page comes from a recorded evaluation row with its date. We ran each comparator ourselves on the same harness on the same day. [claim:c2]

  ## Where it falls short
  On CodeTrace, Kestrel 2 trails Morrow L. We publish that row beside the others.
  ```
- Samples:
  - audio `pitch-contour` "Pitch contour study"
  - audio `rhythm-continuation` "Rhythm continuation study"
  - image sequence `denoise-sequence` "Denoising sequence", 12 frames

`kestrel-1` "Kestrel 1":
- Summary: "Our first research model and the baseline for everything since."
- Published `2026-03-12T10:00:00Z`. Author Tomas Reyes.
- No claims and no samples.
- Body: one section "## What Kestrel 1 was" with a short paragraph.

`wren-1` "Wren 1":
- Scheduled with `release_at_local` `2030-01-15T09:00`. Author Ines Halloran.
- Release record cleared: safety by Eleni Marsh, legal by Kofi Brennan.
- Linked announcement `introducing-wren-1`, also scheduled.
- No claims.

`kestrel-3` "Kestrel 3":
- Draft by Ines Halloran.
- Claim `c1`: text "On ReasonBench-Hard, Kestrel 3 scores 76.0, 6.9 points above Halvard 3.", benchmark ReasonBench-Hard, date 2026-10-20, comparator halvard-3, stated difference "6.9".
- Body: one section "## What Kestrel 3 is" containing `[claim:c1]`.

Every seeded content item has version 1.

**News posts.** Times are London wall-clock. All are published except where noted. You write the summaries and bodies.

| Slug | Title | Subject | Tags | Published |
|---|---|---|---|---|
| introducing-kestrel-2 | Introducing Kestrel 2 | research | evaluations, release-notes | 2026-09-30 09:00 |
| how-we-sign-off-a-release | How we sign off a release | safety | evaluations, governance | 2026-08-20 11:00 |
| interpretability-notes-autumn | Interpretability notes, autumn | research | interpretability | 2026-10-08 14:00 |
| why-every-score-links-to-a-row | Why every score links to a row | policy | evaluations, governance | 2026-07-02 10:00 |
| an-update-on-corvane-group | An update on our work with Corvane Group | company | partnerships | 2026-06-15 09:30 |
| we-are-hiring-research-engineers | We are hiring research engineers | company | hiring | 2026-10-14 09:00 |
| introducing-kestrel-1 | Introducing Kestrel 1 | research | release-notes | 2026-03-12 10:00 |
| introducing-wren-1 | Introducing Wren 1 | research | release-notes | scheduled with wren-1 |
| red-team-findings-q3 | Red-team findings, third quarter | safety | evaluations | draft by Ines Halloran |

**Words in seeded text you write.** A word beginning with "evalu" (such as evaluate, evaluated, evaluation, evaluations or evaluating) appears in the text you write only where this rule allows it:
- The body of each news post tagged `evaluations` contains the word "evaluation". Its summary may contain such words.
- The description of `research-engineer-evaluations` may contain such words.
- No other news summary or body, no other requisition description, the `kestrel-1` body and no thesis body contains any such word.

The publication history holds one publication event for each published item, at its published time.

For example, with the seed data at start:
- The home rail reads: We are hiring research engineers, Interpretability notes autumn, Kestrel 2 (model), Introducing Kestrel 2, How we sign off a release.
- The subject counts are Research 3, Safety 1, Policy 1, Company 2.
- The tag list is evaluations, governance, hiring, interpretability, partnerships, release-notes.
- A search for "evaluation" matches exactly five items: the `kestrel-2` model route, the news posts `introducing-kestrel-2`, `how-we-sign-off-a-release` and `why-every-score-links-to-a-row`, and the role `research-engineer-evaluations`. On the Search page that is three results, then two more after "More results". Narrowed to news it matches the three posts, with no "More results".

**Theses.** The headings are fixed, and you write the body paragraphs:
1. "A claim is only as good as the row beneath it."
2. "Release is a decision with names on it."
3. "Every surface tells the same story at the same moment."
4. "Withdrawal should be as thorough as publication."
5. "Candidates deserve to know where they stand."

**Offices and regions:**
- `london` London, region `uk` "United Kingdom"
- `edinburgh` Edinburgh, region `uk`
- `zurich` Zurich, region `europe` "Europe"
- `toronto` Toronto, region `north-america` "North America"

**Requisitions.** Each has version 1, and you write the descriptions.

| Slug | Title | Discipline | Office | Status | Opened | Recruiters |
|---|---|---|---|---|---|---|
| research-engineer-evaluations | Research Engineer, Evaluations | research | london | open | 2026-10-01 | Sana Qadir |
| research-scientist-interpretability | Research Scientist, Interpretability | research | edinburgh | open | 2026-09-20 | Sana Qadir |
| policy-lead-europe | Policy Lead, Europe | policy | zurich | open | 2026-10-10 | Jules Okonkwo |
| infrastructure-engineer-toronto | Infrastructure Engineer | engineering | toronto | open | 2026-08-30 | Jules Okonkwo |
| operations-coordinator-london | Operations Coordinator | operations | london | closed 2026-09-01 | 2026-06-01 | Jules Okonkwo |
| research-scientist-alignment | Research Scientist, Alignment | research | london | draft | none | Sana Qadir |

There are no seeded applications and no seeded jobs other than sample uploads.

**Benefits register:**

| Region | Effective from | Summary |
|---|---|---|
| uk | 2026-01-01 | Private medical cover, 30 days' leave plus bank holidays, 10% pension contribution. |
| uk | 2027-01-01 | Private medical cover, 30 days' leave plus bank holidays, 12% pension contribution. |
| europe | 2026-04-01 | Supplementary health insurance, 28 days' leave, pension under the local plan. |
| north-america | 2026-07-01 | Health, dental and vision cover, 25 days' leave, retirement matching to 6%. |

## Technical requirements

### Deployment (DP-44)

- The runtime is Node.js 22 with TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` answers HTTP 200 with `{"status":"ok"}` once the server is listening and the database schema is applied, whether or not storage and mail are reachable.
- Several instances may run at once against one database, each on its own port.

### Configuration and secrets (DP-50, DP-61)

Read these variables at start:

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | the PostgreSQL connection | none |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the object storage connection | none |
| `SMTP_HOST`, `SMTP_PORT` | the mail server | none |
| `MAIL_FROM` | the sender | `Aldermoor Open Record <record@aldermoor.example>` |
| `APP_PUBLIC_PORT` | the port to bind | 4173 |
| `PUBLIC_BASE_URL` | the absolute origin used in emailed links, the feed and the sitemap | `http://localhost:<port>` |
| `OUTBOX_RETRY_SECONDS` | whole seconds | 10 |
| `OUTBOX_RETRY_MAX_SECONDS` | whole seconds | 60 |
| `JOB_MAX_ATTEMPTS` | refusals before a job is dead | 5 |
| `APPLICATION_RETENTION_SECONDS` | whole seconds | 15,552,000 |
| `RESEND_WINDOW_SECONDS` | whole seconds | 3,600 |
| `SESSION_TTL_SECONDS` | whole seconds | 43,200 |
| `SIGNIN_LOCKOUT_SECONDS` | whole seconds | 30 |
| `IDEMPOTENCY_TTL_SECONDS` | whole seconds | 86,400 |
| `RATE_LIMIT_PUBLIC_PER_MINUTE`, `RATE_LIMIT_CANDIDATE_PER_MINUTE`, `RATE_LIMIT_SIGNIN_PER_MINUTE`, `RATE_LIMIT_CONSOLE_WRITES_PER_MINUTE` | the bucket limits | the values in Business rules |
| `TRUST_FORWARDED_FOR` | `true` or `false` | `false` |

Never hard-code a credential. Never send any of these values, or anything derived from a credential, to the browser.

### Server boundary (DP-43, DP-45)

- **Same-origin writes:** console writes are same-origin only. A state-changing console request with an `Origin` header naming another origin answers `403 {"error":"cross_origin","message":"Requests must come from this site."}`.
- **Size and type limits:** as stated in API.
- **Never served:** the server never serves source files, the run manifest, package files, environment files, credentials or the raw contents of the storage bucket. Such paths, and any path containing `..`, answer the public 404.
- **Cookies:** public pages, assets, feeds, search, and the public and candidate APIs never send `Set-Cookie`. The only cookie is the console session, set only by sign-in, marked HttpOnly and SameSite Strict.
- **Headers:** every response sends `X-Content-Type-Options: nosniff`. Every HTML page sends a Content-Security-Policy that limits scripts, styles, fonts, images and media to the same origin. Public pages make no requests to other origins.
- **Dependency outages:**
  - If storage or mail is unreachable at boot, the platform starts and serves, reports the outage through `/api/ready`, and recovers on its own when the service returns.
  - Storage outages degrade only the features named in API. Mail outages only delay delivery.
  - If the database is unreachable at boot, the server keeps retrying the connection every 2 seconds. It answers `/api/health` only once the schema is applied.

### Browser support and performance (DP-46, DP-47)

- The site covers current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800.
- Public pages work without cookies. The core reading, filtering, search and application flows work without scripts. The tether, live time conversion, motion and gallery playback are enhancements.
- Every public page answers within 1 second on the grading machine with seed data, and is usable within 2 seconds.
- A search answers within 1 second.
- A claim marker starts its first visible step within a tenth of a second of activation.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and those commands alone install, build and serve the platform.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) plus every bundled font and icon set, each with its licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`), font and icon set is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, OFL-1.1 or CC0-1.0.
- IF-04: No datastore is used beyond the provided PostgreSQL and MinIO: no SQLite, no embedded key-value store, no Redis, no in-process cache of record data, and no application data written to local files.
- IF-05: The provided service configuration and its seeded development credentials are left unmodified.
- IF-06: All server and browser source is TypeScript, and JavaScript files appear only as tool configuration or build output.
- IF-07: Sample media and the seeded PDF fixtures are generated by code in the repository, and no audio, image or document media is copied in from elsewhere.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes and no disabled type or lint checks.
- Names in code use the domain terms of this brief: model route, release record, sign-off, claim, benchmark row, embargo, publication history, requisition, application, stage decision, grant, audit entry, job and outbox.
- Each domain rule is decided in exactly one place in the source. That covers each lifecycle's legal transitions, the London embargo conversion, read time, the recorded difference, claim validation, grant activity, sign-off lapse, the benefits entry in force, the public derived values, the audit hash and each rate-limit bucket.
- Every error response is built from the one error shape in API. No endpoint invents its own.
- Every versioned change is made conditional on its version in the database write itself, never only in a check before the write.
- The source has no dead, commented-out or unreachable code, and no defensive checks for states the lifecycle rules make impossible.
- No abstraction exists with only one implementation.
- No feature, endpoint, screen or setting exists beyond this brief.
