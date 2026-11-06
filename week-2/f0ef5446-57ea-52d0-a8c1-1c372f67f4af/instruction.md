# Relayo Marketing Site and Partner Program

Build the public marketing site for Relayo. Relayo is a business-to-business AI meeting assistant that joins calls, records them and turns them into searchable notes and follow-ups. The site serves two groups. Company prospects read published content and apply to the partner program. Relayo's partner team reviews those applications on the same site.

Visitors can read:
- a home page;
- five agent pages;
- an integrations directory;
- a resources library;
- a careers board;
- a press room;
- a blog.

Visitors can also submit one partner application per work email. Each stored application gets one receipt email, addressed to the applicant by name.

Signed-in staff who hold the partner-reviewer role can:
- read the application queue, with per-status counts and a reply-due time for each application;
- approve or reject each pending application once. The applicant then gets an outcome email.

Sign-in is limited after repeated failures, and the sign-in page counts the wait down. Staff can sign out, which ends only the session they signed out of. A reviewer whose role is withdrawn loses every applicant detail from the open page at once.

The site uses three backing services:
- PostgreSQL for every record, including the emails waiting to be delivered.
- Keycloak for staff sign-in, sessions and role decisions.
- Mailpit for outgoing email.

Out of scope:
- visitor accounts;
- payments;
- a product app behind the marketing pages;
- content editing screens;
- any datastore, cache or queue other than those three services.

## Problem and users

Many software companies run their partner program through a web form that drops into a shared inbox. Things go wrong in predictable ways:
- Applications get lost, or get answered twice.
- Over-long answers are silently cut off, or push the page sideways on a phone.
- Text pasted from a PDF can carry invisible control characters that crash the form.
- A double-clicked submit, a reload after a dropped connection, or a retry the next morning creates two records or sends two confirmations.
- A name with a comma or a line break in it sends the confirmation to the wrong place, or to two places.
- Nobody knows when a reply is due, so applicants who submit on a Friday afternoon before a holiday wait in silence.
- Anyone who finds the admin address can read applicants' details, and anyone can guess passwords against it.
- A reviewer who "signs out" on a shared laptop often leaves a working session behind, and a reviewer who has been removed from the team can still read whatever is open on their screen.
- Embargoed launch articles leak early through their cover images.

Relayo wants intake that:
- keeps every answer the applicant typed, even across a reload in the same tab;
- explains anything it cannot accept, with a summary that leads straight to each problem;
- records each company once;
- confirms each application by email exactly once, addressed to the applicant's exact name.

Reviewing is limited to the people the identity system names as partner reviewers at that moment. Each application is decided exactly once and has a reply due within two Berlin business days.

| Role | Goal | Can | Cannot |
|---|---|---|---|
| Visitor (anonymous company prospect) | Learn what Relayo does and apply to partner | Read public integrations, articles, press, jobs and resources once their publication moment has arrived, icon and cover files included; revalidate public lists with a held tag; filter and page lists with the state kept in the address; return from an integration or article to the exact list view they came from; submit one partner application per work email, retried safely with an Idempotency-Key even after reloading the tab; jump from the error summary to each failing field; receive one receipt email per stored application, addressed to them by name | Read the reviewer queue, any application, or any unpublished or scheduled record or its media |
| Analyst (`analyst@example.com`, marketing team) | Sign in to the site as a staff member | Sign in, subject to the sign-in failure limit, watching the wait count down; sign out, ending only that session | Read the reviewer queue or any application (403); decide an application (403) |
| Reviewer (`reviewer@example.com`, partner team, holds the Keycloak realm role `partner-reviewer`) | Work through new applications before their reply is due | Read the queue filtered by status, ordered newest first or by reply due, with consistent per-status counts; read one application, including its reply-due time and outcome email delivery state; approve or reject a pending application once, with an internal note; sign out, ending only that session | Decide an application a second time; keep seeing any applicant detail once the role is removed |

## Journeys

1. **Read the story.**
   - A Visitor opens `/` and reads the opening statement. They scroll through the before, during and after narrative and watch the current step move from Before to During to After.
   - On a phone, they swipe the use-case carousel left one slide at a time. The current use case is announced, and Previous use case is unavailable on the first slide. A vertical swipe over the carousel scrolls the page instead.
   - On the Education slide, they follow Explore the Education Agent, then return home with the header logo.
   - They end on the home page with every section readable.
2. **Browse integrations.**
   - A Visitor on a slow connection opens `/integrations`. They choose CRM and, before it loads, choose Calendar.
   - The grid shows only the Calendar integrations, the address carries Calendar, Calendar is marked current and the Calendar count is announced. The late CRM answer never appears.
   - With their system's high-contrast colours turned on, Calendar is still visibly marked as current and the focus ring is still drawn around each control they Tab to.
   - They open one Calendar card, then follow Back to integrations. They land on the Calendar view with keyboard focus on the card they opened, fully in view below the header.
   - They open the card again and press the browser's Back button. They end on the same Calendar view with Calendar marked current and the same count.
   - A crafted return address that points anywhere else only ever leads back to the plain integrations list.
3. **Browse press and blog.**
   - A Visitor opens `/press`, chooses News and presses Load more twice in quick succession. The address becomes page 2, not page 3.
   - They reload and see News items 11 to 20. They press Back and end on the first ten News items with Previous unavailable.
   - A press item or article scheduled for a future moment never shows in any list, count or page until that moment arrives on the server's database clock. Its cover file stays unreachable until then too, as do the icons of unpublished integrations.
   - A client that holds a list's tag asks again and is told nothing changed, until a scheduled item goes public and the list really changes.
   - Any client reading the public API meets only the documented routes, methods, query parameters and item keys.
4. **Apply to partner.**
   - A Visitor on a 320-pixel-wide phone opens `/partner-program`, reads the pitch and fills the thirteen fields. Each limited field shows its limit, and the goals counter tracks what they type. Even a company name that fills its whole limit with one unbroken word never pushes the page sideways.
   - They paste a goals text copied from a PDF, leave the work email malformed and submit. The goals text is over the limit and carries an invisible control character; it is kept in the field. An error summary lists each failing field as a link. Following a link moves focus to that field, fully in view, without changing the address.
   - They correct both fields and submit. The network drops after Relayo has stored the application, so the Visitor sees the connection-lost message.
   - They reload the tab. Every answer is still there, in that tab only; a new tab starts empty.
   - They submit again. The form re-sends under the same Idempotency-Key, and they end on the Application received panel.
   - Exactly one application exists, and exactly one receipt email arrives at their work email, addressed to their exact first and last name. A reload now shows an empty form.
   - Had they instead pressed Try again only after the key's lifetime had passed, the request would have been processed fresh and answered with the duplicate-application message. There would still be one application and one receipt.
5. **Review and decide.**
   - A Reviewer opens `/review` and signs in. They see the Pending view with the queue counts.
   - They switch to Approved and back, with the address following, then choose Reply due first. The queue reorders by each application's reply-due time in Berlin business hours, and the address keeps the order.
   - They open a pending application and read it, including when its reply is due. They approve it with an internal note.
   - The row leaves the Pending view, the counts change by one, the decision confirmation is announced, and the details panel shows the outcome email line as read right after the decision, Queued or Sent. The panel does not refresh on its own; once delivery has happened, the Reviewer opens the application again from the Approved view and the line reads Sent.
   - While the mail service is down, the email waits and is retried on a published schedule. The decision still stands.
   - The applicant receives one Approved email, addressed to them by name, that does not contain the note.
   - Later, with another application open and its Reject dialog showing, the partner team removes the Reviewer's role. The Reviewer presses Confirm. The page clears every applicant detail at once and shows the no-access message. The application stays pending. After the role is restored, a reload shows the queue again.
   - The Reviewer signs out and sees the signed-out message. The token they held stops working, while their separate session on another device keeps working.
6. **Refused analyst.**
   - An Analyst opens `/review` and mistypes the password five times. The sixth attempt is refused, even with the correct password. The page counts the wait down second by second, with Sign in unavailable until it reaches zero. Switching to another email lifts the wait for that email only.
   - Once the wait is over, they sign in. They end on the no-access message with no applications shown.
   - Every reviewer API request with their token answers 403, is never cached, and no application changes.
7. **Choose cookies.**
   - On a first visit, a Visitor meets the cookie preferences panel at the lower edge of the screen.
   - With the panel still open, they press Tab through the page. Every focused control stays fully in view; none slides under the sticky header or the panel.
   - They open the Agents menu with Enter and close it with Escape.
   - They open Cookies Settings, leave every optional category off and confirm. They reload, and the panel does not return.
   - They reopen it from the footer and end looking at their earlier choice.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Health route** GET /api/health answers 200 with {"status":"ok"} once the schema, the seeded corpus and the seeded auth accounts are in place, and 503 before that.
- **DP-02 — Application saved pending** A valid POST /api/partner-applications writes one partner_applications row with status pending and answers 201 with the body given under API.
- **DP-03 — Server-side validation** An application with a missing, over-long, unsupported-character or malformed field is refused with 422 and the validation envelope, which gives every failing field its one message by the published priority, echoes every sent value as sent, and writes no row.
- **DP-04 — Thirteen-field form** /partner-program carries the thirteen labelled application fields in the published order with exactly the option lists given under Business rules.
- **DP-05 — Confirmation ending** Submitting a complete application on /partner-program replaces the form with the Application received panel that thanks the company by name.
- **DP-06 — Errors explained in place** Submitting the page form with failing fields shows an announced message beside each failing field, linked to it, and keeps every value already typed, including over-long or unsupported text.
- **DP-07 — Reviewer sign in** POST /api/auth/login with a seeded account and the seeded password answers 200 with the auth service's access token at access_token, and a wrong password answers 401, as qualified by the sign-in failure limit under Business rules.
- **DP-08 — Queue refuses anonymous callers** GET /api/review/partner-applications with no bearer token, a malformed one, an expired one or a forged one answers 401 with the WWW-Authenticate: Bearer header.
- **DP-09 — Decision refuses non-reviewers** A decision request without a token answers 401 and one from a signed-in Analyst answers 403, each leaving the application pending and recording no email.
- **DP-10 — Queue status filter** A Reviewer reading the queue with status=pending, approved or rejected receives exactly the applications in that status, in the chosen queue order.
- **DP-11 — Approve decision** An approve decision moves a pending application to approved, records the deciding reviewer's email and the decision time, and records one approved outcome email in the same transaction.
- **DP-12 — Reject decision** A reject decision moves a pending application to rejected, records the deciding reviewer's email and the decision time, and records one rejected outcome email in the same transaction.
- **DP-13 — Decided once** A second decision on an approved or rejected application answers 409 already_decided, leaves status, reviewer, note and decision time unchanged, and records no further email.
- **DP-14 — Reviewer queue page** On /review a signed-in Reviewer sees pending applications as rows with their own Approve and Reject buttons, opens one to read it, and decides it with an internal note.
- **DP-15 — Duplicate work email race** Simultaneous applications carrying one work email, in any letter case and without an Idempotency-Key, yield exactly one 201, every other answer is 409 duplicate_application, and one row persists.
- **DP-16 — Decision race** Simultaneous Reviewer decisions on one pending application yield exactly one 200, the rest answer 409 already_decided, and exactly one outcome email is recorded and delivered.
- **DP-17 — Retried submission** Re-sending an identical application without a key answers 409 duplicate_application, re-sending it with the original unexpired Idempotency-Key replays the original 201, and neither creates a second row.
- **DP-18 — Concurrent distinct applications** A burst of simultaneous applications with different work emails is accepted in full with 201 each, every one persisted exactly once.
- **DP-19 — Published integrations only** GET /api/integrations lists every published integration and no unpublished one, narrowed to one category when category is given.
- **DP-20 — Integrations category filter** Choosing a category on /integrations narrows the grid to that category, marks the choice current and writes category into the address so a reload shows the same view.
- **DP-21 — Integration detail address** /integration/{slug} opens a published integration and answers 404 for an unknown or unpublished slug.
- **DP-22 — Article detail address** /blog/{slug} opens a public article with its title, author and publication date and answers 404 for an unknown, unpublished or not yet public slug.
- **DP-23 — Blog category filter** GET /api/blog?category=<name> returns, across every page, exactly the public articles in that category.
- **DP-24 — Press filter** GET /api/press?category=News returns only public News items across every page, and /press offers the All, News and Press Releases choices.
- **DP-25 — Seeded corpus** Every start seeds the integrations, articles, press items, jobs and resource cards listed under Seed data as PostgreSQL rows without duplicating any, so the public counts stated there hold on every read.
- **DP-26 — Routes open directly** Every public route in the route table answers 200 with its page when opened directly at its address.
- **DP-27 — Bright blue direction** The site reads as a bright white field under one saturated blue accent worn by the primary pill buttons, links and the current filter.
- **DP-28 — One agent template** The five agent pages share one section layout and differ only in their domain copy and media.
- **DP-29 — Hero survives missing media** The home headline, its supporting line and its two actions stay visible and readable when every hero media file fails to load.
- **DP-30 — Empty filter result** An unknown category on /integrations, /blog or /press shows that list's empty-state copy and a reset link back to the unfiltered list.
- **DP-31 — Cookie preferences** The first visit shows the cookie preferences panel, the choice is remembered across reloads, the footer reopens it on every route, and no page ever requests another origin.
- **DP-32 — Narrow layout** At 375 by 812 the page columns stack into one, the application form and the reviewer table included, with every action still reachable.
- **DP-33 — WCAG at desktop size** /, /sales-agent, /integrations, /resources, /press, /blog and /partner-program show no WCAG 2.2 AA violation at a 1920 by 1200 viewport.
- **DP-34 — WCAG on a phone** /, /integrations and /partner-program show no WCAG 2.2 AA violation at a 390 by 844 viewport.
- **DP-35 — No sideways scrolling** /, /integrations and /careers never scroll sideways at 320, 390, 768 or 1920 pixels wide.
- **DP-36 — Visible focus** The first Tab stop on /, /integrations and /partner-program shows a visible focus indicator.
- **DP-37 — No console errors** /, /integrations and /partner-program load with no console error and no uncaught exception.
- **DP-38 — Reduced motion** Under a reduced-motion preference /, /integrations and /partner-program keep every heading, link and button and run no endlessly repeating animation.
- **DP-39 — Eased card hover** Pointing at an integration card lifts it slightly and deepens its shadow over about a fifth of a second, and under reduced motion only the shadow changes.
- **DP-40 — Published field limits** Each text field longer than its published code-point limit is refused with 422 and the limit message, while a value of exactly the limit is accepted, as counted under Business rules.
- **DP-41 — Normalised storage** Stored text fields are trimmed of Unicode white space only and NFC-normalised, work_email is stored as the Unicode default lower-case of that form, and the 201 body returns the stored work email while an error envelope echoes the raw values.
- **DP-42 — Privileged fields ignored** A create body that also carries id, status, reviewer, decision_note, created_at or decided_at is accepted on its thirteen fields alone and stored pending with no reviewer and no decision time.
- **DP-43 — Two seeded identities** On every start the app ensures the realm role partner-reviewer, the account reviewer@example.com holding it and the account analyst@example.com without it, both signing in with the seeded password.
- **DP-44 — Forbidden versus unauthorized** On every reviewer route a signed-in caller without partner-reviewer answers 403 even for an id that does not exist, and only a Reviewer ever receives 404.
- **DP-45 — Role checked on every request** The auth service decides on each reviewer request whether the caller holds partner-reviewer, so removing the role makes the next request with the same unexpired token answer 403 and restoring it allows the next one.
- **DP-46 — Idempotent application retry** POST /api/partner-applications honours an optional Idempotency-Key with replay, body-mismatch, in-flight and invalid-key answers, judging the same body by the published JSON equality rule, exactly as given under Business rules.
- **DP-47 — Case-insensitive email uniqueness** Two applications whose stored work emails are equal after Unicode lower-casing are the same applicant, and the database refuses the second with 409 duplicate_application whatever its collation.
- **DP-48 — Stable capped paging** GET /api/blog and GET /api/press page in a fixed order with a capped limit and a category-bound next_cursor, never repeating or skipping a public item when another becomes public or is unpublished mid-walk.
- **DP-49 — History restores filters** Choosing a category on /integrations, /blog or /press adds a history entry, and Back and Forward restore that list, its current marker and its announced count without a full reload.
- **DP-50 — Press paging in the address** /press shows ten items per page, Load more writes page into the address, a reload of /press?category=News&page=2 shows News items 11 to 20, and the edge, invalid and beyond-last rules under Interactions hold.
- **DP-51 — Decision body validated** A decision other than approve or reject, or a note over 1000 code points or carrying unsupported characters, answers 422 with the validation envelope and changes nothing.
- **DP-52 — Outcome email contract** Each decision records one email to the stored work email from the configured sender with the published subject for its outcome, naming the company and never containing the internal note.
- **DP-53 — Outcome email header safety** A company name containing line breaks is stored as submitted and its outcome email still has exactly one recipient, one subject and no added header.
- **DP-54 — Queue view in the address** Choosing Pending, Approved or Rejected on /review writes status into the address as a new history entry, and reload, Back and Forward restore that view.
- **DP-55 — Limit hints and goals counter** Each limited field on /partner-program shows its Up to N characters hint linked to the field, and Partnership goals shows a live n / 2000 counter that trims and counts exactly as the server does.
- **DP-56 — Over-long paste kept** Pasting more than the limit into a field keeps the whole pasted text in the field and, on submit, shows the limit message beside it instead of cutting the text.
- **DP-57 — Before, during and after story** Scrolling through the home narrative moves the current-step marker from Before to During to After and back again in reverse, and under reduced motion all three steps show at once.
- **DP-58 — Request size and type limits** A request body over 65,536 bytes answers 413 and a non-JSON media type answers 415 right after the route and method check, while unparseable JSON, a repeated member name, nesting deeper than 32 levels, a number literal over 64 characters or a NaN or Infinity literal answers 400 invalid_json at its place in the check order under Business rules.
- **DP-59 — Credentials from the environment** Every service URL and credential is read from its environment variable at start and none is written in source or sent to the browser.
- **DP-60 — Refused analyst page** An Analyst who signs in on /review sees the no-access message and no application, and the queue answers 403 to that session.
- **DP-61 — Unsupported characters refused** A text field or decision note carrying a control character other than tab, line feed and carriage return, a delete character or an unpaired surrogate is refused with 422 naming that field, an application create also echoing the raw values in valid UTF-8 JSON, such login credentials answer 401, and no request value ever produces a 5xx.
- **DP-62 — Idempotency-Key lifetime** An Idempotency-Key is honoured strictly before its fixed lifetime from first use on the database clock, replays never extend it, and a request after expiry is processed fresh with exactly one processing among simultaneous takers.
- **DP-63 — Only the published API** Unknown /api paths answer 404 not_found, undocumented methods answer 405 with an exact Allow header before any other check, a repeated documented query parameter answers 400 with its code, and list items carry exactly their documented keys.
- **DP-64 — Latest choice wins** On /integrations, /blog and /press the list, current marker, address and Results announcement always follow the last choice, a superseded response never renders or announces, paging controls are disabled while a page loads, and a failed load shows the outage alert on the chosen entry.
- **DP-65 — Focus never hidden** With the cookie panel open at 1280 by 800 and 390 by 844, every focused control on /, /integrations and /partner-program stays visible past the header and the panel, and the Agents and Menu buttons open, close with Escape and return focus by keyboard alone.
- **DP-66 — Sign out ends one session** POST /api/auth/logout answers 204 and ends only the auth-service session of the presented token so that token answers 401 next while another sign-in of the same account keeps working, and a disabled account's token answers 401 on its next request.
- **DP-67 — Receipt email recorded with the application** Every 201 that creates an application records exactly one receipt email in the same PostgreSQL transaction as the row, and no replay, duplicate, in-progress, key-reuse, refused or failed request records one.
- **DP-68 — Outcome email delivery state** Recorded emails are delivered from PostgreSQL with the published first-attempt, backoff and Message-ID rules and reach Mailpit at most once each, and an application's outcome_email_status and details panel show Queued or Sent.
- **DP-69 — Reply due in business hours** Every application carries reply_due_at, the moment 16 Europe/Berlin business hours after its submission with weekends and the published holidays skipped, derived on every read as qualified in Business rules.
- **DP-70 — Queue order in the address** The queue accepts sort=submitted or sort=reply_due and answers invalid_sort for any other or repeated value, and /review keeps the chosen order in the address as a history entry restored by reload, Back and Forward.
- **DP-71 — Sign-in failure limit** Five sign-in failures for one email within the published window make every further sign-in for that email, the correct password included, answer 429 with Retry-After, counted atomically so that simultaneous failures on a fresh email yield exactly five 401s, and /review counts the wait down per email key as qualified under Interactions.
- **DP-72 — Consistent queue counts** Every queue response carries per-status counts taken from the same database snapshot as its items, so they always match the items listed while other changes commit, and /review shows them in Queue counts.
- **DP-73 — Effective publication moment** An article is public only from its published_at and a press item only from its date on the database clock, in lists, cursor walks, result counts and /blog/{slug}.
- **DP-74 — Safe return to the list** Integration and article detail pages lead back to the exact list view the Visitor came from with focus on the opened card, and any return address that is not that list falls back to the plain list.
- **DP-75 — Tab-scoped draft** The partner form keeps its thirteen values and the attempt's Idempotency-Key in that tab's session storage only, restores them on reload, reuses the key until a value changes, and erases both once the application is received.
- **DP-76 — Swipeable accessible carousel** The home use-case carousel exposes only its current slide, announces its position, does not wrap, moves one slide per qualifying horizontal touch swipe while vertical swipes scroll the page, and switches at once under reduced motion.
- **DP-77 — Recipient name in the address line** Every receipt and outcome email is addressed to the stored work email alone with the applicant's first and last name as its display name, written so a standard mail parser recovers that name exactly while no applicant text adds a recipient, a header or a line over 998 octets.
- **DP-78 — Withdrawn access clears the screen** The first 403 on /review removes the queue, the counts, the status and order links, the details panel, any open dialog and every applicant value from the page, shows the no-access alert with focus on it and Sign out kept, and a reload after the role is restored shows the queue again.
- **DP-79 — Private answers never cached** Every response to a path under /api/auth/ or /api/review/ carries Cache-Control: no-store and neither ETag nor Last-Modified, whatever its status.
- **DP-80 — Media follows publication** Integration icons and article covers answer 200 image/svg+xml at their exact published paths only while their row is public, checked on every request, and every other request under those path prefixes answers 404.
- **DP-81 — Conditional public reads** The integrations, blog and press lists answer 200 with a strong ETag and Cache-Control: no-cache, and 304 with no body to a matching If-None-Match, as qualified under API, with the tag changing exactly when the body changes.
- **DP-82 — Marker and focus beyond colour** On /integrations, /blog and /press the current category carries a line at least 2 CSS pixels thick and every focus indicator is drawn outside its control, both still visible and distinct in forced-colours mode.
- **DP-83 — Form reflows with full-limit text** At 320 and 1280 pixels wide, the partner form, its 422 state and the Application received panel never scroll sideways, clip any label, hint, message, counter, summary link, button or thank-you text, or overlap a field's parts with every text field at its limit as one unbroken run, also under the WCAG text-spacing overrides, as qualified under Screens and layout.
- **DP-84 — Error summary of named links** A refused partner form shows one summary link per failing field in form order, named by the field and its message, each moving focus to its field fully in view without changing the address or history.

## Frontend

### Screens and layout (DP-04, DP-14, DP-21, DP-22, DP-26, DP-28, DP-32, DP-35, DP-83)

| Route | Purpose | Access |
|---|---|---|
| `/` | Opening statement, before/during/after narrative, use-case carousel, connected-tools strip | public |
| `/sales-agent` | Sales use case: before, during and after a call | public |
| `/education-agent` | Study use case: before, during and after class | public |
| `/media-agent` | Interview and production use case | public |
| `/sdr-agent` | Inbound qualification and demo use case | public |
| `/recruiting-agent` | Interview and hiring use case | public |
| `/resources` | Library cards grouped as Updates, Case Studies, Webinars, Guides and Videos | public |
| `/integrations` | Integrations directory with a category filter | public |
| `/integration/{slug}` | One integration: icon, name, category, description and the return link | public |
| `/careers` | Culture, values, offices, an image band, open positions | public |
| `/press` | Press room with a category filter and pages of ten | public |
| `/blog` | Article index with a category filter | public |
| `/blog/{slug}` | One article: the return link, cover, title, author, publication date (a calendar date with its four-digit year), read time, body | public |
| `/partner-program` | Partner pitch (why partner, ways to partner, Apply / Connect / Launch) and the application form | public |
| `/review` | Staff sign-in and the partner application queue | staff; enforced by the API |

An unknown address outside `/api` and outside the media paths under API, or an unknown, unpublished or not yet public slug, answers HTTP 404 with a page headed `Page not found` and a link `Back to home`.

Every page has the same header and footer. The header is sticky: it stays at the top while the page scrolls. It holds the logo, the main navigation and two actions, Start for free and Book a demo. Both actions go to outbound placeholder addresses; the site sells nothing and has no product app behind them.

Integration cards and the integration detail page show the integration's icon from its `icon_ref`. Article cards and the article page show the cover from its `cover_ref`.

**At 1280 by 800:**
- The header is one row, and the Agents button opens its menu below the header.
- The home opening statement is a wide two-part composition: the headline and actions on the left, the gradient orb on the right.
- The narrative holds its step list in place on the left while the step panels change on the right.
- The use-case carousel shows one wide slide at a time, with its two buttons beneath it.
- Grids run three across (integrations, articles, resources), or four across for the integration icons strip.
- The partner form groups its fields into four labelled sets in two columns: About you, Your company, Your market, Your partnership. The error summary sits above the sets.
- The reviewer page puts the Queue order and Application status choices and the Queue counts line above a full table, with the details panel beside it.

**At 768 by 1024, and at any width below 1024:**
- The navigation collapses behind a Menu button. The opened panel holds the same navigation, including the Agents button.
- Grids run two across.
- The opening statement stacks, with the orb behind the headline.
- The narrative keeps its held step list.
- The partner form is a single column of the four sets.
- The details panel opens below the table.

**At 375 by 812:**
- Everything is one column.
- The headline scale steps down so no word breaks mid-word.
- Grids run one across.
- The narrative stacks its three steps.
- The carousel slide fills the width.
- The reviewer table turns into stacked rows, one card per application. Each card keeps every column's value, Reply due included, and its Approve and Reject buttons.
- Paging, filter and order controls wrap onto new lines instead of scrolling.

No page ever scrolls sideways at any of these sizes, down to 320 wide.

**Long answers on the partner form.** The partner page must hold together at 320 by 800 (the same as 1280 wide at 400% zoom) and at 1280 by 800 in each of these three states:
- every text field filled to exactly its limit from Business rules, each value one unbroken run with no spaces (the website a valid address of that length);
- the form after a 422 on those values, with messages and the error summary showing;
- the Application received panel for a company name of 160 code points in one unbroken run.

In each state:
- The page never scrolls sideways. A long unbroken value wraps at any character inside its box, in the thank-you line too.
- Every label, hint, message, counter, summary link and button lies entirely within the viewport width.
- With the WCAG text-spacing overrides applied to the whole page (line height 1.5 times the font size, letter spacing 0.12 times, word spacing 0.16 times, and space after each paragraph 2 times the font size):
  - no visible text is clipped. This covers each field's label, hint, message and counter, the error summary heading and links, every button, and the Application received heading and thank-you line. None of these, and no element that wraps one of them, hides or clips content more than 1 pixel larger than its visible box, in either direction.
  - Form controls themselves (single-line text fields, the multi-line goals field and the selects) are exempt: a full-limit value may scroll inside its own box. Text hidden visually for assistive technology only, such as an off-screen live region or a skip link while it is not focused, is exempt too;
  - a field's label, hint, message, counter and control never overlap one another.

The five agent pages use one template, in this order:
1. A hero with the agent's name and promise.
2. Before, During and After content blocks.
3. A details band of three capabilities.
4. A plans strip with two plan cards linking to the outbound pricing placeholder.
5. A closing call to action.

Only the domain copy and the poster images differ.

### Public screens and controls (DP-04, DP-05, DP-14, DP-20, DP-24, DP-31, DP-49, DP-50, DP-54, DP-55, DP-57, DP-60, DP-65, DP-66, DP-70, DP-72, DP-74, DP-76, DP-78, DP-84)

Only the roles, names and copy in this table are public contracts. Everything else is free.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Every page | `banner` | Sticky header |
| Every page | `link "Relayo home"` | The logo, linking to `/` |
| Every page | `navigation "Main"` | Holds `button "Agents"`, which carries `aria-expanded` and opens a menu of `link "Sales Agent"`, `link "Education Agent"`, `link "Media Agent"`, `link "SDR Agent"` and `link "Recruiting Agent"`. Then `link "Integrations"`, `link "Resources"`, `link "Blog"`, `link "Press"`, `link "Careers"` and `link "Partners"` (to `/partner-program`) |
| Every page, below 1024 wide | `button "Menu"` | Carries `aria-expanded`; opens and closes the main navigation |
| Every page | `link "Start for free"`, `link "Book a demo"` | Outbound placeholders |
| Every page | `contentinfo` containing `button "Cookie preferences"` | Footer |
| Every page | `dialog "Cookie preferences"` | Holds `button "Cookies Settings"`, `button "Reject All"` and `button "Accept All Cookies"`. The settings view adds `checkbox "Strictly Necessary Cookies"` (checked and disabled), `checkbox "Performance Cookies"`, `checkbox "Functional Cookies"`, `checkbox "Targeting Cookies"` and `button "Confirm My Choices"` |
| `/` | `heading` level 1 | `Every meeting, captured and ready to act on.` |
| `/` | Supporting line | `Relayo joins your calls, takes the notes and hands your team the next steps.` |
| `/` | `region "Before, during and after"` | A `list` of three step labels: `Before the meeting`, `During the meeting` and `After the meeting`, each with its panel. The current step label carries `aria-current="step"` |
| `/` | `region "Use cases"` with `aria-roledescription="carousel"` | Holds `button "Previous use case"`, `button "Next use case"` and five slides in this order: Sales Agent, Education Agent, Media Agent, SDR Agent, Recruiting Agent |
| `/` | Each slide: `group` named `<n> of 5` with `aria-roledescription="slide"` | `<n>` is the slide's position, 1 to 5. Each slide holds one link: `link "Explore the Sales Agent"`, `link "Explore the Education Agent"`, `link "Explore the Media Agent"`, `link "Explore the SDR Agent"` or `link "Explore the Recruiting Agent"` |
| `/` | `status "Current use case"` | `Use case <n> of 5: <Agent name>`, where `<Agent name>` is the current slide's agent as named in the Agents menu (for example `Use case 2 of 5: Education Agent`). It always describes the current slide, from page load onward |
| `/` | `region "Connected tools"` | Holds `button "Pause tool strip"`, which reads `Play tool strip` while paused |
| Agent pages | `heading` level 1 | `Relayo Sales Agent`, `Relayo Education Agent`, `Relayo Media Agent`, `Relayo SDR Agent`, `Relayo Recruiting Agent` |
| `/integrations` | `navigation "Integration categories"` | Links `All Integrations`, `Collaboration`, `CRM`, `Calendar`, `Desktop App`, `Mobile`, `Browser Extensions`, `Storage`, `Analytics`, `Dialers` and `Video Conferencing`. The chosen link carries `aria-current="true"` |
| `/integrations` | `list "Integrations"` | One card per integration, each a `link` named with the integration name |
| `/integration/{slug}` | `link "Back to integrations"` | Its target follows the return rule under Interactions |
| `/blog` | `navigation "Blog categories"` | Links `All`, `Product Updates`, `Sales`, `Education`, `Media`, `Hiring` and `Company`. The chosen link carries `aria-current="true"` |
| `/blog` | `list "Articles"` | One card per article, each a `link` named with the article title |
| `/blog/{slug}` | `link "Back to articles"` | Its target follows the return rule under Interactions |
| `/press` | `navigation "Press categories"` | Links `All`, `News` and `Press Releases`. The chosen link carries `aria-current="true"` |
| `/press` | `list "Press items"` | Each item shows its date and its headline as a link |
| `/press` | `button "Previous"`, `button "Load more"` | Paging controls |
| `/integrations`, `/blog`, `/press` | `status "Results"` | The polite result count |
| `/partner-program` | `form "Partner application"` | Fields in this order:<br>1. `textbox "First name"`<br>2. `textbox "Last name"`<br>3. `textbox "Work email"`<br>4. `textbox "Job title"`<br>5. `textbox "Company name"`<br>6. `textbox "Website URL"`<br>7. `combobox "Company type"`<br>8. `combobox "Number of employees"`<br>9. `group "Primary markets served"` of checkboxes<br>10. `combobox "Primary customer segment"`<br>11. `group "Partnership interests"` of checkboxes<br>12. `textbox "Partnership goals"` (multi-line)<br>13. `checkbox "I consent to Relayo contacting me about this application."`<br>Then `button "Submit application"` |
| `/partner-program` | Option and checkbox labels | Select options show the option text exactly as listed under Business rules. Market and interest checkboxes are named with the option text, first letter capitalised (for example `Build an integration`). The value sent is the exact option text |
| `/partner-program` | Limit hints | `Up to N characters` under each of First name, Last name, Work email, Job title, Company name, Website URL and Partnership goals. N is that field's limit from Business rules. Each hint is referenced by its field's `aria-describedby` |
| `/partner-program` | `status "Goals character count"` | `<n> / 2000`, where `<n>` is the goals length under the Business rules counting rule |
| `/partner-program` | `status "Form status"`, `alert` | Pending and outcome copy from Feedback states. On a 422 the `alert` holds the error summary: a `list` of `link`s named as in Feedback states |
| `/partner-program` | `region "Application received"` | A level 2 heading `Application received` and the thank-you line from Feedback states |
| `/review` | `form "Staff sign in"` | `textbox "Email"`, a password field labelled `Password`, `button "Sign in"` |
| `/review` | `button "Sign out"` | Shown once signed in, for Reviewers and Analysts alike, and kept when access is withdrawn |
| `/review` | `navigation "Application status"` | Links `Pending`, `Approved` and `Rejected`. The chosen link carries `aria-current="true"` |
| `/review` | `navigation "Queue order"` | Links `Newest first` and `Reply due first`. The chosen link carries `aria-current="true"` |
| `/review` | `status "Queue counts"` | `<p> pending, <a> approved, <r> rejected`, taken from the latest queue response's `counts` |
| `/review` | `table "Partner applications"` | Columns Company, Applicant, Work email, Submitted, Reply due, Status. The Company cell is a `link` named with `<company_name>`. The Reply due cell reads `YYYY-MM-DD HH:MM Berlin`: the application's `reply_due_at` as Europe/Berlin wall-clock time, whatever the browser's own time zone (for example `2026-10-27 16:00 Berlin`). Pending rows add `button "Approve <company_name>"` and `button "Reject <company_name>"` |
| `/review` | `region "Application details"` | Every stored field of the opened application, plus its status, reviewer, decision time, internal note, reply-due time in the Reply due cell format, and, once decided, its outcome email line from Feedback states |
| `/review` | `dialog "Approve application"`, `dialog "Reject application"` | Each holds `textbox "Internal note"` with the hint `Up to 1000 characters. Never sent to the applicant.`, `button "Confirm"` and `button "Cancel"` |
| `/review` | `status "Review status"`, `alert` | Copy from Feedback states |

`<company_name>` is the application's stored company name.

### Interactions (DP-06, DP-14, DP-20, DP-30, DP-31, DP-49, DP-50, DP-54, DP-56, DP-57, DP-64, DP-65, DP-66, DP-70, DP-71, DP-74, DP-75, DP-76, DP-78, DP-84)

**Category filters on `/integrations`, `/blog` and `/press`**

Choosing a category link does all of the following without a full page load:
1. Updates the list in place.
2. Adds one new history entry whose address carries `?category=<name>`. The name is the exact category text, URL-encoded (for example `?category=Press%20Releases`). `All Integrations` and `All` remove `category` from the address.
3. Moves `aria-current` to the chosen link immediately, and keeps keyboard focus on that link.
4. Sets `Results` to the loading copy, then to the new count once the list renders.

Back and Forward restore the list, the current marker and the announced count for their entry, also without a full page load. Opening or reloading an address that carries `category` shows the same view directly. A `category` value that matches no category shows the list's empty state with its reset link.

**The latest choice wins**

Each category choice fetches its list from the list's API, with the chosen category as the `category` query parameter (for example `GET /api/integrations?category=CRM`). Each Load more fetches the next page from the API. The page never filters or pages a list it already holds.

The Visitor may choose again before a list has loaded. The list, the current marker, the address and the `Results` announcement always describe one of two things:
- the last category or page the Visitor chose; or
- the entry that Back or Forward reached.

A response to a request that a later choice has replaced is never rendered and never announced, however late it arrives.

When the latest request fails, or answers with a 5xx:
- The list area shows the list outage alert.
- The address and the current marker stay on the chosen entry.
- The next choice, Back or Forward fetches again.

**Lists and counts**

- `/blog` shows every public article in the chosen category, in the API order.
- `/integrations` shows every published integration in the chosen category, in the API order.
- The count always describes the cards currently shown.

**Return to the list (integration and article details)**

- **Card links.** Every card link on `/integrations` and `/blog` carries `?from=<list address>`. `<list address>` is the list's current path and query, URL-encoded. For example, `/integration/vaultbox-drive?from=%2Fintegrations%3Fcategory%3DStorage`.
- **Accepted return addresses.** On `/integration/{slug}`, `link "Back to integrations"` points to the decoded `from` value only when that value is exactly `/integrations` or begins with `/integrations?`. On `/blog/{slug}`, `link "Back to articles"` points to it only when it is exactly `/blog` or begins with `/blog?`.
- **Refused return addresses.** Every other value points the link to plain `/integrations` or plain `/blog`. So does a missing `from`. Refused values include:
  - an absolute URL;
  - an address starting with `//`;
  - any value containing a backslash;
  - any value containing a control character;
  - a `javascript:` value;
  - any other path.
- **Arriving back on the list.** Following the return link opens the list in the view its address names: category, current marker and announced count.
  - Keyboard focus lands on the card link for the detail page just left.
  - The page scrolls so that the card's whole box is inside the viewport and below the sticky header.
  - When that view holds no card for that detail (for example, under a category that excludes it), focus goes to the list's first category link.
- **Opening a detail page directly.** With no `from`, its link points to the plain list.

**Press paging on `/press`**

- The press room shows ten items per page, in the API order.
- Page 1 never has `page` in its address. Page N, for N of 2 or more, carries `?page=N`, alongside `category` when one is chosen.
- `Load more` replaces the list with the next ten items, adds one history entry with the new `page`, and moves focus to the first item's headline link. `Previous` does the same toward page 1.
- While a page is loading, both `Previous` and `Load more` carry `aria-disabled="true"` and do nothing. A double press therefore advances exactly one page and adds exactly one history entry.
- On page 1, `Previous` carries `aria-disabled="true"` and does nothing. On the last page, `Load more` does the same.
- Reloading `/press?category=News&page=2` shows exactly items 11 to 20 of the News list, in the API order.
- A `page` value of `1`, or one that is not a positive integer (for example `0`, `-1`, `abc` or `1.5`), renders page 1. The address is rewritten without `page`, replacing the current history entry rather than adding one.
- A `page` beyond the last page shows the beyond-last empty state, with no paging controls.
- Changing category always returns to page 1.

**Partner form**

1. Every field accepts typed or pasted text of any length and content. The field never cuts text off at its limit and never strips characters out of it.
2. The goals counter updates on every input. It applies exactly the trimming and counting of the Business rules counting rule.
3. **Draft.** The form keeps the thirteen current values, and the current attempt's Idempotency-Key once one exists, in that browser tab's session storage, updated on every change. Applicant answers and the key are never written to local storage, cookies, IndexedDB or the address.
   - Reloading `/partner-program` in the same tab restores every value exactly, over-long and unsupported text included, and the goals counter matches the restored text.
   - A new tab or window opens with an empty form.
4. **Idempotency-Key.**
   - `Submit application` sends the body with an Idempotency-Key header.
   - The key is generated at the first submit of a given set of values. It is reused by every later submit or `Try again` for those same values, including after a reload of the tab.
   - As soon as any value changes, the stored key is dropped, and the next submit generates a new one.
5. **On 201, or a replayed 201:** the draft and the key are erased, the form and its error summary are replaced by the Application received panel, and focus moves to its heading. A replayed 201 shows exactly the same panel, never the duplicate message. Reloading afterwards shows an empty form.
6. **On 422:**
   - Each failing field gets `aria-invalid="true"` and its message beside it.
   - The message sits inside a polite live region and is referenced by the field's `aria-describedby`.
   - The summary alert shows, rebuilt from this answer: its heading copy, then one link per failing field, in form order, named as in Feedback states. Focus moves to the first failing field, not to the summary.
   - Activating a summary link, by click or Enter, moves focus to its field. For the two checkbox groups that is the group's first checkbox. The page scrolls so that the field's whole box is inside the viewport, below the sticky header and above the cookie panel when the panel is open.
   - Activating a summary link never changes the address and never adds a history entry: no fragment appears.
   - Every typed value stays exactly as typed, including over-long text and unsupported characters. The draft is kept.
7. **On 409 `duplicate_application`:** the duplicate alert shows and the draft is kept.
8. **When the request gets no response, or answers with a 5xx:** the outage alert shows with `button "Try again"`, and the draft and key are kept. Try again re-sends the current values under the rule in step 4.
9. **On a 409 `request_in_progress` answer:** the form keeps its pending state. It re-sends the same request under the same key after about two seconds, up to three times.

**Reviewer page**

- **Sign-in and token.** `/review` signs in through the email and password form. The page keeps the access token in browser storage scoped to the open tab and sends it as a bearer token.
  - Reloading `/review` in that same tab keeps the staff member signed in: no sign-in form appears, and the page shows the view the address names.
  - A new tab or window starts at the sign-in form.
  - Sign out, or a 401 on any request, removes the stored token. A 403 never removes it.
- **Sign-in wait.** A 429 on sign-in shows the too-many-attempts alert, starting from the response's Retry-After value.
  - The alert then counts down on the page's own clock: one less for each whole second that passes, using the same copy and the singular form at 1.
  - While counting, `Sign in` carries `aria-disabled="true"`. Pressing it, or pressing Enter in the form, sends no request.
  - At zero, the alert is removed, `Review status` reads the can-sign-in-again copy, `Sign in` is active again, the typed values stay and focus does not move.
  - Each wait belongs to an email key, which the page computes exactly as the server does under Business rules rule 15. Editing Email to a different key hides the alert and makes `Sign in` active for that key. Editing back to a key that is still waiting shows its remaining count again; for example, ` LOCK-X@Example.COM ` and `lock-x@example.com` are one key.
  - The waits live only in the open page. The page never asks the server for the remaining time, and a reload forgets them.
- **Status in the address.** After sign-in, and after a reload while signed in, the queue shows the view named by `status` in the address.
  - With no `status`, it shows Pending and leaves the address as it is.
  - An unknown `status` value shows Pending and rewrites the address without `status`, replacing the current history entry.
  - Choosing a status link adds a history entry with `?status=pending`, `?status=approved` or `?status=rejected`, keeping any `sort`. Back and Forward restore that view and its current marker.
- **Order in the address.**
  - Choosing `Reply due first` adds a history entry with `sort=reply_due`, keeping any `status`.
  - Choosing `Newest first` adds a history entry without `sort`.
  - Reload, Back and Forward restore the order and its current marker.
  - An unknown `sort` value shows Newest first and rewrites the address without `sort`, replacing the current history entry.
- **Queue reloads.** The queue reloads on sign-in, on a page reload, on a view or order change and after every decision. It does not poll.
  - `Queue counts` updates from every queue response.
  - Opening an application reads it afresh, and the open details panel is read again after every decision. Its outcome email line therefore shows the delivery state as of that read.
- **Details panel.** The Company link opens the details panel and moves focus to its heading.
- **Decision dialogs.** `Approve <company_name>` or `Reject <company_name>` opens the matching dialog with focus in the note field.
  - `Confirm` sends the decision.
  - `Cancel` or Escape closes the dialog and returns focus to the button that opened it.
  - Tab stays inside the open dialog.
- **After a decision.**
  - On success, the dialog closes, the row leaves the Pending view and focus moves to the table caption. When that decision leaves the view with no applications, the table is replaced by the empty-view text from Feedback states, and focus moves to that text, which takes focus from script only and is not a Tab stop.
  - On a 409, the dialog closes and the row refreshes to its stored status.
- **Access withdrawn.** The first 403 from any review request ends access on the page at once. Such requests include loading or reloading the queue, changing the view or order, opening an application, sending a decision and the queue reload after a decision.
  - The page removes the table (or its stacked cards), `region "Application details"`, any open decision dialog, `status "Queue counts"`, `navigation "Application status"` and `navigation "Queue order"`.
  - Afterwards no applicant value remains anywhere in the page's document, hidden or visible: no company name, applicant name, work email, internal note or reply-due text.
  - The no-access alert shows, `Sign out` stays, and focus moves to the alert. The alert takes focus from script only and is not a Tab stop.
  - The token is kept. A reload asks the server again; once the role has been restored, it shows the queue for the view and order the address names.
  - A 403 never shows the session-ended copy.
- **Analyst.** An Analyst's first queue request after sign-in answers 403, so the Analyst lands in the same access-withdrawn state: the no-access alert, `Sign out`, and no queue, counts, status links or order links.
- **Session ended.** A 401 on any request after sign-in returns the page to the sign-in form with the session-ended copy.
- **Sign out.** `Sign out` sends the sign-out request with the bearer token.
  - On 204 or 401, the page drops the token and shows the sign-in form with the signed-out copy, and focus moves to the Email field.
  - On 503, the page stays signed in and shows the sign-out outage alert.

**Home carousel**

- **Current slide only.** Only the current slide is exposed to assistive technology and reachable by Tab. The other four slides are inert. For example, on slide 2, Tab from `Previous use case` reaches only `Explore the Education Agent` among the slide links.
- **Buttons and keys.** `Next use case` and `Previous use case` move one slide per press. The Left and Right arrow keys do the same when focus is inside the carousel.
- **No wrap.** On slide 1, `Previous use case` carries `aria-disabled="true"` and does nothing. On slide 5, `Next use case` does the same. The arrow keys stop at the same ends.
- **Touch swipe.** A swipe moves exactly one slide when it covers at least 50 CSS pixels horizontally and moves further horizontally than vertically.
  - A leftward swipe goes to the next slide, and a rightward swipe to the previous one, never past either end.
  - A shorter swipe, or a mostly vertical one, never changes the slide. A vertical swipe over the carousel scrolls the page as usual.
  - Dragging with a mouse does nothing.
- **Announcement.** After every move, `Current use case` reads the new position.

**Home narrative and header**
- On every route, the header logo returns to `/`.

**Cookie preferences**

- On a first visit, the cookie panel appears at the lower edge without blocking the page. Escape does not dismiss it there.
- `Reject All` saves all three optional categories as off. `Accept All Cookies` saves all three as on. `Confirm My Choices` saves the checkbox states. Each of these closes the panel.
- The choice persists across reloads and visits in a first-party cookie.
- `Cookie preferences` in the footer reopens the panel with the saved choice shown. When reopened this way, Escape closes it and returns focus to the footer button.
- The site requests nothing from another origin whatever the choice, so necessary features never depend on accepting.

**Keyboard and focus**

- Every control is reachable by Tab in reading order. On the partner form, Tab follows the field order above. Every control shows a visible focus ring, drawn as described under Visual design.
- **Focus is never hidden.** This applies at 1280 by 800 and at 390 by 844, with the first-visit cookie panel open, to every element on `/`, `/integrations` and `/partner-program` that takes keyboard focus.
  - When such an element takes focus, the page scrolls as needed so that it does not sit under the sticky header or under the cookie panel.
  - The centre point of the focused element's box always shows that element itself, or something inside it, on top.
  - A skip link that appears only on focus must also be fully in view while focused.
- **Agents menu.**
  - `button "Agents"` reads `aria-expanded="false"` while closed. Enter or Space opens it and sets `aria-expanded="true"`, with focus staying on Agents.
  - The next Tab reaches `Sales Agent`, and Tab continues through the five links in order.
  - Escape, pressed anywhere inside the open menu or on the button, closes it and returns focus to `Agents`.
  - Tabbing past the last link closes the menu, and focus moves on to the next control in the header.
  - Clicking outside closes it.
- **Menu button**, below 1024 wide:
  - `button "Menu"` opens and closes the navigation panel with Enter or Space and carries `aria-expanded`.
  - Escape, pressed anywhere inside the open panel or on the button, closes it and returns focus to `Menu`.

### Visual design (DP-27, DP-28, DP-29, DP-82)

**Colour**
- The page is a bright white field.
- One saturated, clear blue that leans toward cobalt is the only accent. It marks:
  - the primary pill buttons and text links;
  - the current filter, status and order links;
  - the narrative progress line;
  - the carousel's position dots;
  - the focus rings.
- Headings are a near-black cool ink. Body text is a slightly softer dark grey. Secondary text, dates, reply-due times and hints are a mid cool grey that still passes AA contrast on white.
- Panels and alternating bands use a very pale cool grey. Dividing rules are thin light-grey hairlines.
- A muted green appears only for success messages and the Approved label. A deep brick red appears only for field errors.
- Every status also carries its word (Pending, Approved, Rejected, Queued, Sent), so colour never carries meaning alone.
- All text meets WCAG 2.2 AA contrast: at least 4.5 to 1 for body text, and 3 to 1 for large text and control edges. This includes white labels on the blue buttons and any text over the gradient orb.

**Current marker and focus ring on the lists**
- On `/integrations`, `/blog` and `/press`, the current category link carries a solid line at least 2 CSS pixels thick, either beneath its label or around it, in addition to its blue colour. A filled background alone never marks it.
- Every focus indicator on those three pages is a ring drawn outside the control's own edge, at least 2 CSS pixels thick and starting no more than 4 CSS pixels from that edge. This covers category links, card links, `Previous`, `Load more`, and the return links on the detail pages.
- Both stay visible in forced-colours mode, the high-contrast setting in which the system replaces page colours with its own. In that mode colour fills and coloured glows disappear, so neither the marker nor the ring may rely on them. The current link must still look different from the same link when it is not current, and the focus ring must still be drawn.

**Type**
- Display type is a geometric sans-serif, heavy, with slightly tightened letter spacing.
- On desktop, the home headline is about three and a half times the body size, section headings about twice the body size, and card titles about one and a quarter times. On phones, the headline steps down to about twice the body size.
- Body type is a humanist sans at a comfortable reading size. Lines in articles run to no more than about seventy characters.
- Times in the reviewer table use figures of equal width so columns line up.

**Density and composition**
- Spacing is generous. Every section has at least a full line-height of breathing room per heading level, and cards keep clear gutters.
- The composition idea is "one bright room": wide white bands with a single blue thread running through them. The thread is the blue of the buttons, the narrative progress line and the current filter.
- A soft gradient orb sits behind and beside the home headline, shading from the accent blue through pale sky into white.

**Shapes**
- Cards and panels have generously rounded corners. Media cards are rounder than form fields.
- Primary buttons are solid blue pills with white labels. Secondary buttons are white pills with a blue hairline edge and blue labels.

**Targets**
- Every interactive target is at least 44 by 44 pixels. This includes filter and order links, checkboxes with their labels, carousel buttons, return links, error summary links and paging buttons.

**Media**
- All media is original and stored locally: the orb, agent posters, integration icons, article covers and the careers image band.
- No screenshot, video, brand mark or downloaded image from any other site is used. Any background noise texture is drawn as an inline vector pattern.
- Meaningful images have alternative text. Decorative ones are hidden from assistive technology.
- When any media file fails to load, its space keeps a pale panel, and the surrounding text and actions stay in place.

### Motion and effects (DP-38, DP-39, DP-57, DP-76)

Every motion answers page entry, pointer, touch, keyboard, navigation or scroll. The only thing that moves on its own is the one named loop, the connected-tools strip. There is no other decorative loop or ambient movement anywhere.

**Signature interaction: the before, during and after story on `/`**

At 768 wide and above:
- The section is about three screen-heights tall. The whole tall section is the `region "Before, during and after"`, and it scrolls with the page: the document scrolls, not an inner container.
- The step list stays in place on the left while the Visitor scrolls through the section.
- A thin blue progress line beside the list fills from top to bottom in step with the scroll through the section.
- **Scroll range and thirds.** The scroll through the section runs from the section's top reaching the top of the viewport to its bottom reaching the bottom of the viewport, a distance of the section's height minus one viewport height. It splits into equal thirds: Before for the first third, During for the middle third, After for the last third.
- **When the current step changes:**
  - Its label turns blue and gains `aria-current="step"`, and the previous step loses it.
  - The new step's panel fades in and rises a short distance into place over about a third of a second, while the old panel fades out over the same time.
- **Scrolling back up** reverses each change step by step. The line empties, and the current step returns from After to During to Before.

Below 768 wide:
- The three steps stack.
- Each panel fades and rises into place once, over about a third of a second, as it enters view.
- `aria-current="step"` sits on the step whose panel crosses the vertical middle of the viewport.

At every width, the step text is in the page from the start and readable by assistive technology before any reveal.

**Other motion**
- **Page entry:** the home headline and the orb fade in once, in under a second. The headline text is in the page from the start.
- **Cards:** pointing at an integration card or a resource card lifts it slightly and deepens its shadow over about a fifth of a second, easing out. Moving away reverses it. Keyboard focus on a card gives the same lift.
- **Buttons:** buttons darken slightly on hover and press inward slightly on press, both within about a tenth of a second.
- **Carousel:** a slide change glides sideways over about four tenths of a second, in the direction of travel. During a qualifying touch swipe the slide does not follow the finger; it glides once the swipe ends.
- **Lists:** filtered lists cross-fade to their new contents over about a fifth of a second.
- **Dialogs and menus:** dialogs and the Agents menu fade, and dialogs also scale up slightly, over about a fifth of a second. They close over the same time.
- **Cookie panel:** it slides up from the lower edge over about a quarter of a second.
- **Withdrawn access:** the queue and details disappear at once, with no fade, so no applicant detail lingers on screen.
- **Named loop:** the connected-tools strip drifts sideways continuously, taking about forty seconds per full pass. It pauses while the pointer is over it or while focus is inside it. `Pause tool strip` stops it until pressed again.

**Under reduced motion**
- The narrative shows all three panels stacked and fully visible at once, with no held list, no progress line and no fades. `aria-current="step"` still follows the panel crossing the middle of the viewport.
- The headline and the orb appear at once.
- Cards change shadow only, with no lift.
- Carousel slides switch at once, with no transition, whether moved by button, key or swipe.
- Lists, dialogs, the Agents menu and the cookie panel appear and disappear at once.
- The tools strip stands still and wraps into rows, and its pause button is not shown.

### Feedback states (DP-05, DP-06, DP-30, DP-49, DP-55, DP-56, DP-60, DP-64, DP-66, DP-68, DP-71, DP-78, DP-84)

Every async action shows its pending state and its outcome on screen, and announces both through the named live region.

**Partner form**

| State | Region | Copy |
|---|---|---|
| Pending | `status "Form status"` | `Submitting your application…`. The submit button shows the same words and carries `aria-disabled="true"` |
| Success (201 or replayed 201) | `region "Application received"` replaces the form; `status "Form status"` | Heading `Application received` and the line `Thank you, <company_name>. Our partner team reviews every application and replies by email.` |
| Field errors (422) | `alert` | `Please correct the fields below.`, followed by the error summary links. Each field's message, from Business rules, also shows beside its field |
| Duplicate (409 `duplicate_application`) | `alert` | `We already have an application from this work email. Our partner team will be in touch.` |
| Outage (no response or a 5xx) | `alert` with `button "Try again"` | `We couldn't reach Relayo. Your answers are still here.` |

`<company_name>` in the success line is the stored company name. The application is stored before this copy shows. The receipt email may still be waiting for delivery, and the copy promises only a reply, so it holds in every state.

**Error summary link names.** Each link is named `<field name>: <message>`. `<field name>` is the field's accessible name from the controls table: the group name for `Primary markets served` and `Partnership interests`, and the checkbox label for consent. `<message>` is that field's message in this answer. For example:
- `Work email: Enter a valid work email address.`
- `Partnership goals: Must be at most 2000 characters.`
- `I consent to Relayo contacting me about this application.: You must give consent to apply.`

**Filtered lists**

| State | Region | Copy |
|---|---|---|
| Count | `status "Results"` | `<n> integrations`, `<n> articles` or `<n> press items`, where `<n>` is the number of cards shown. When `<n>` is 1: `1 integration`, `1 article`, `1 press item` |
| Loading after any choice, page change, Back or Forward | `status "Results"` | `Loading…`, shown before every new count, so an unchanged count is still announced afresh |
| Unknown category | In place of the list; `Results` reads the count for 0 | `No integrations match this category.` with `link "Show all integrations"` (to `/integrations`); `No articles match this category.` with `link "Show all articles"` (to `/blog`); `No press items match this category.` with `link "Show all press"` (to `/press`) |
| Page beyond the last | In place of the press list | `No press items on this page.` with `link "Show all press"` |
| Outage (the latest request fails or answers with a 5xx) | `alert` | `This list is unavailable right now. Try again in a minute.` |

**Reviewer page**

| State | Region | Copy |
|---|---|---|
| Signing in | `status "Review status"` | `Signing in…` |
| Wrong credentials (401) | `alert` | `That email and password don't match.` |
| Too many attempts (429), and each second of its countdown | `alert` | `Too many sign-in attempts. Try again in <n> seconds.`, or `Too many sign-in attempts. Try again in 1 second.` when `<n>` is 1. `<n>` starts at the response's Retry-After value and counts down as described under Interactions |
| Wait over | `status "Review status"` | `You can sign in again.` |
| Auth service down (503) | `alert` | `Sign-in is unavailable right now. Try again in a minute.` |
| No access (any 403) | `alert` | `Your account does not have access to partner applications.` |
| Session ended (401 after sign-in) | `status "Review status"` | `Your session has ended. Sign in again.` |
| Signed out | `status "Review status"` | `You have signed out.` |
| Sign-out unavailable (503) | `alert` | `Sign-out is unavailable right now. Try again in a minute.` |
| Empty view | In place of the table | `No applications in this view.` |
| Deciding | `status "Review status"` | `Saving decision…` |
| Approved | `status "Review status"` | `Application approved. The applicant will be emailed.` |
| Rejected | `status "Review status"` | `Application rejected. The applicant will be emailed.` |
| Outcome email state | Line in `region "Application details"`, decided applications only | `Outcome email: Queued` while `outcome_email_status` is `"queued"`; `Outcome email: Sent` once it is `"sent"` |
| Already decided (409) | `alert` | `This application was already decided.` |
| Note refused (422) | Beside the note field | The note's message from Business rules |
| Database down (503) | `alert` | `Partner applications are unavailable right now. Try again in a minute.` |

The approved and rejected copy holds even when the mail service is down, because the email is recorded with the decision and delivered later (see Business rules).

## Backend

### API (DP-01, DP-02, DP-03, DP-07, DP-08, DP-10, DP-11, DP-12, DP-19, DP-23, DP-24, DP-41, DP-48, DP-63, DP-66, DP-69, DP-70, DP-72, DP-79, DP-80, DP-81)

**Conventions**

- The API is served on the app's own origin under `/api`.
- A request that carries a body sends `Content-Type: application/json`; a charset parameter is allowed.
- Responses are `application/json; charset=utf-8` and always valid UTF-8.
- Timestamps are ISO 8601 UTC with a `Z` suffix. Press dates are `YYYY-MM-DD`.
- Every error body is a JSON object whose `error` field holds a code; some codes add the fields shown.
- Body-size, media-type and malformed-JSON answers are owned by Server boundary. The order in which checks run is owned by Business rules.

**Validation envelope (422)**

```json
{
  "error": "validation_failed",
  "message": "Please correct the fields below.",
  "errors": {"work_email": "Enter a valid work email address."},
  "values": {"first_name": "Ada", "work_email": "ada-at-example", "...": "..."}
}
```

- The keys of `errors` are exactly the body fields that failed: every failing field, and no passing field. The messages come from Business rules.
- `values` appears only on application create. It carries all thirteen field names, each holding exactly what the request sent: untrimmed, un-normalised and with any unsupported characters intact. A field that was omitted holds `null`.
- A character that UTF-8 cannot carry (an unpaired surrogate) is written as its JSON `\uXXXX` escape. The body therefore still decodes as strict UTF-8 and parses back to the value sent.

**Application object**

Reviewer routes return applications with exactly these keys:

```json
{"id": 7, "first_name": "...", "last_name": "...", "work_email": "...", "job_title": "...",
 "company_name": "...", "website": "...", "company_type": "...", "employee_band": "...",
 "markets": ["..."], "customer_segment": "...", "partnership_interests": ["..."],
 "goals": "...", "consent": true, "status": "pending", "reviewer": null,
 "decision_note": null, "created_at": "2026-10-27T09:00:00Z", "decided_at": null,
 "reply_due_at": "2026-10-28T09:00:00Z", "outcome_email_status": null}
```

- `reply_due_at` follows the reply-due rule under Business rules.
- `outcome_email_status` is `null` while the application is pending. Once it is decided, the value is `"queued"` or `"sent"`, taken from the status of its outcome email record.

**Endpoints.** This table is the complete API surface. Every other path under `/api` is unknown.

| Method and path | Request | Success | Errors (beyond the shared ones) |
|---|---|---|---|
| `GET /api/health` | — | 200 `{"status":"ok"}` | 503 `{"status":"starting"}` until ready |
| `POST /api/auth/login` | `{"email": str, "password": str}` | 200 `{"access_token": str, "token_type": "Bearer", "expires_in": int}`. `access_token` is the access token Keycloak issues for the `app` client | 422 envelope without `values` for a missing or non-string `email` or `password`, with message `This field is required.`; 401 `{"error":"invalid_credentials"}`; 429 `{"error":"too_many_attempts"}` with a `Retry-After` header; 503 `{"error":"auth_unavailable"}` |
| `POST /api/auth/logout` | No body. Header `Authorization: Bearer <token>` | 204, no body | 401 `unauthorized` (the shared answer); 503 `{"error":"auth_unavailable"}` |
| `POST /api/partner-applications` | The thirteen fields (see Business rules); optional header `Idempotency-Key` | 201 `{"id": int, "status": "pending", "work_email": <stored work email>}` | 422 envelope; 409 `{"error":"duplicate_application","message":"An application for this work email already exists."}`; the idempotency answers under Business rules; 503 `{"error":"service_unavailable"}` |
| `GET /api/review/partner-applications` | Query `status` (optional: `pending`, `approved` or `rejected`) and `sort` (optional: `submitted` or `reply_due`). Bearer token | 200 `{"items": [application, ...], "counts": {"pending": int, "approved": int, "rejected": int}}`. Without `status`, `items` holds every application. Order follows `sort` under Business rules | 400 `{"error":"invalid_status"}`; 400 `{"error":"invalid_sort"}` |
| `GET /api/review/partner-applications/{id}` | Bearer token | 200 application | 404 `{"error":"not_found"}` for an unknown id, or for an id that is not a positive integer |
| `POST /api/review/partner-applications/{id}/decision` | `{"decision": "approve" or "reject", "note": str or null (optional)}`. Bearer token | 200 the updated application | 404 as above; 422 envelope without `values`; 409 `{"error":"already_decided","status": <current status>}` |
| `GET /api/integrations` | Query `category` (optional) | 200 `{"items": [...]}`, ordered by `name` compared code point by code point (the same order as comparing UTF-8 bytes, independent of any database collation), then by `slug`; each item has exactly `slug`, `name`, `description`, `category`, `icon_ref` | 400 `{"error":"invalid_category"}` |
| `GET /api/blog` | Query `category`, `limit`, `cursor` (all optional) | 200 `{"items": [...], "next_cursor": str or null}`; each item has exactly `slug`, `title`, `category`, `summary`, `author`, `read_time`, `cover_ref`, `published_at` | 400 `{"error":"invalid_limit"}`; 400 `{"error":"invalid_cursor"}`; 400 `invalid_category` |
| `GET /api/press` | Query `category` (optional: `All`, `News` or `Press Releases`), `limit`, `cursor` | 200 `{"items": [...], "next_cursor": str or null}`; each item has exactly `id`, `date`, `category`, `headline`, `link` | 400 `invalid_limit`; 400 `invalid_cursor`; 400 `invalid_category` |

Under the integrations order, an upper-case letter sorts before any lower-case letter and a space sorts before every letter. For example, with the seed data at start, `Relayo Mobile` sorts before `Relayo for Desktop`.

`icon_ref` is exactly `/media/integrations/<slug>.svg` and `cover_ref` is exactly `/media/articles/<slug>.svg`, where `<slug>` is the item's own slug.

**Shared answers on authenticated routes**

The three `/api/review/...` routes and `POST /api/auth/logout` answer:
- 401 `{"error":"unauthorized"}` with the header `WWW-Authenticate: Bearer`.
- 403 `{"error":"forbidden"}`, on the review routes only.
- 503 `{"error":"auth_unavailable"}` when the auth service cannot be reached to check a presented token.
- 503 `{"error":"service_unavailable"}` when the database is unreachable.

Business rules set when each of these applies.

**Published surface**

- **Unknown path.** A path under `/api` that is not in the table answers 404 `{"error":"not_found"}` as JSON.
- **Wrong method.** A documented path called with a method it does not document answers 405 `{"error":"method_not_allowed"}`. The response carries an `Allow` header listing exactly that path's documented methods, comma-separated in any order.
  - Every GET route also allows HEAD and lists it in `Allow`. A HEAD request answers with the same status and headers as GET, and no body.
  - No route allows OPTIONS.
  - For example, `Allow: GET, HEAD` on `/api/press`, and `Allow: POST` on `/api/partner-applications`.
- **Query parameters.** The only documented query parameters are those listed per route above. Unknown query parameters are ignored.
  - A documented query parameter given more than once answers 400 with that parameter's code: `limit` gives `invalid_limit`, `cursor` gives `invalid_cursor`, `status` gives `invalid_status`, `sort` gives `invalid_sort`, and `category` gives `invalid_category`.
  - When more than one query parameter is invalid, the answer names the first in this order: `status`, `sort`, `category`, `limit`, `cursor`.
- **Item keys.** List items, application objects and `counts` carry exactly their documented keys and no others.

**Public list parameters**

- **`category`** narrows a list to that exact category text. `All` on press means no filter. A single `category` value that matches no category answers 200 with empty `items` and a `null` `next_cursor`.
- **`limit`** defaults to 10. A value above 50 is treated as 50; 50 itself is allowed. A `limit` that is not a positive integer answers `invalid_limit`.
- **`read_time`** is in whole minutes. `published_at` is a timestamp.
- Blog and press lists carry public rows only, as defined under Business rules. The integrations list carries published rows only.

**Private answers are never cached**

Every response to a path beginning `/api/auth/` or `/api/review/` carries `Cache-Control: no-store`, whatever its status: 200, 204, 400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 500 and 503 alike. Such a response never carries `ETag` or `Last-Modified`.

**Conditional reads of the public lists**

These rules apply to GET and HEAD on `/api/integrations`, `/api/blog` and `/api/press`:
- **On 200.** The response carries a strong `ETag`: an opaque tag inside double quotes, never prefixed `W/`. It also carries `Cache-Control: no-cache` and no `Last-Modified`.
- **Tag rule.** Two answers with byte-identical bodies carry the same tag. Answers whose bodies differ carry different tags. So a different `limit`, `category` or `cursor` that yields a different body yields a different tag.
- **`If-None-Match`.** The header holds either `*` or a comma-separated list of tags, with optional white space around the commas. Tags are compared weakly, so `W/"t"` matches `"t"`. `*` matches any current list.
  - A match answers 304 with no body, carrying the same `ETag` and `Cache-Control` as the 200 would.
  - A header value that cannot be read this way is ignored, and the request is answered as if it were absent.
- **`If-Modified-Since`** is ignored.
- **Position.** The conditional check runs only after every 400 query check has passed. Error answers never carry an `ETag`.
- **Publication.** When a scheduled row becomes public on the database clock, the list's body changes, and so does its tag. A client holding the old tag then gets 200 with the new body and tag.

**Public media**

- `GET` or `HEAD` on `/media/integrations/<slug>.svg` answers 200 with `Content-Type: image/svg+xml` and `Cache-Control: no-cache` while the integration with that exact slug is published.
- `GET` or `HEAD` on `/media/articles/<slug>.svg` answers the same way while the article with that exact slug is public under Business rules rule 13.
- Publication is checked against the database on every request. Unpublishing an integration hides its icon on the next request, and a scheduled article's cover becomes reachable on the first request after its moment arrives.
- Every other request under `/media/integrations/` or `/media/articles/` answers 404, the same as any unknown address. That includes an unknown slug, a slug in different letter case, an encoded slash, and dot segments, encoded or not. A query string never changes the answer.
- Site media outside those two path prefixes is free.

### Business rules (DP-03, DP-09, DP-11, DP-12, DP-13, DP-15, DP-16, DP-17, DP-40, DP-41, DP-42, DP-44, DP-45, DP-46, DP-47, DP-48, DP-51, DP-61, DP-62, DP-66, DP-67, DP-68, DP-69, DP-70, DP-71, DP-72, DP-73)

**1. Check order**

One order holds for every endpoint. Steps that do not apply to an endpoint are skipped.

| Step | Check | Answer |
|---|---|---|
| 0 | Route and method | Unknown path or wrong method, as under API "Published surface" |
| 1 | Body size and media type | Server boundary |
| 2 | Authentication | 401 |
| 3 | Permission | 403 |
| 4 | Unknown record | 404 |
| 5 | Malformed JSON | 400 |
| 6 | Idempotency-Key format | 400 |
| 7 | Stored idempotency answers | Replay, reuse and in-progress |
| 8 | Query and body validation | 400 for query parameters, 422 for bodies |
| 9 | State conflicts | 409 `already_decided` or `duplicate_application` |

So `PUT /api/review/partner-applications/1` with no token answers 405, not 401. A stored idempotent replay is returned before any validation, uniqueness or state check. On the public lists, the conditional check under API runs after step 8. Sign-in has its own order after step 8, given in rule 15.

**2. Application fields**

All thirteen fields are required.

| Field | Type | Missing when | Malformed when | Limit (code points) |
|---|---|---|---|---|
| `first_name`, `last_name` | string | absent, not a string, or blank after trimming | — | 80 |
| `job_title` | string | same | — | 120 |
| `company_name` | string | same | — | 160 |
| `work_email` | string | same | not exactly one `@` with a non-empty local part, a domain containing a dot, and no white space | 254 |
| `website` | string | same | does not start with `http://` or `https://`, or contains white space | 2048 |
| `goals` | string | same | — | 2000 |
| `company_type`, `employee_band`, `customer_segment` | string | absent, not a string, or blank | not exactly one of its options (rules 3 to 7) | — |
| `markets`, `partnership_interests` | list of strings | absent, not a list, or empty | any entry not exactly one of its options, or the same option twice | — |
| `consent` | boolean | absent | anything other than `true` | — |

**Which form each check reads.**
- The unsupported-character check reads the value exactly as sent.
- The missing, limit and malformed checks of the seven text fields read the trimmed NFC form defined under the counting rule below. "White space" in the malformed column means any character with the Unicode White_Space property left inside that trimmed form.
- So leading and trailing white space never makes `work_email` or `website` malformed. For example, ` ada@example.com ` is accepted and stored as `ada@example.com`, while `ada @example.com` is malformed.
- Option fields and list entries are compared with their options exactly as sent, with no trimming or normalisation.

**Unsupported characters.** A string contains *unsupported characters* when, as sent, it contains any of:
- a code point from U+0000 to U+001F other than tab (U+0009), line feed (U+000A) and carriage return (U+000D);
- U+007F;
- an unpaired surrogate, that is, a code point from U+D800 to U+DFFF that does not form a valid pair. JSON can carry one as an escape such as `\uD83D`.

This check applies to `first_name`, `last_name`, `work_email`, `job_title`, `company_name`, `website`, `goals` and the decision `note`. An option field or list entry that contains such characters is simply not one of the options. A refused application field's raw value is echoed in the create envelope's `values`; a refused decision `note` is named in `errors` only, because the decision envelope carries no `values`.

**Messages.** Each field gets at most one message, by this priority:
1. **Missing:** `This field is required.` The exception is `consent`, which uses `You must give consent to apply.` whether it is missing or not `true`.
2. **Over the limit:** `Must be at most N characters.`, where N is that field's limit.
3. **Unsupported characters:** `Remove unsupported characters from this field.`
4. **Malformed:**
   - `work_email`: `Enter a valid work email address.`
   - `website`: `Enter a URL starting with http:// or https://.`
   - any option field: `Choose one of the listed options.`

**Counting rule.** A value's length is its number of Unicode code points after NFC normalisation and trimming.
- **Trimming** removes only characters with the Unicode White_Space property, from both ends. Those characters are U+0009 to U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F and U+3000. U+200B and U+FEFF are not white space: they are never trimmed, and they count.
- A rocket emoji counts as 1.
- A letter `e` followed by a combining acute accent composes to one code point and counts as 1.
- A family emoji built from several code points joined together counts each of those code points.
- An unpaired surrogate counts as 1.
- A value of exactly the limit is accepted; one code point more is refused.
- The decision note follows the same counting, with a limit of 1000.

**Storage.**
- Each text field is stored trimmed and NFC-normalised. Line breaks inside a value are kept.
- `work_email` is stored as the Unicode default lower-case mapping of its trimmed NFC form. For example, `ÉLODIE@Example.com` is stored as `élodie@example.com`. A Kelvin sign (U+212A) becomes `K` under NFC and then `k`.
- Option values and lists are stored as sent.
- `created_at` is the server's current UTC time when the row is written.

**Privileged and unknown keys.** A create body may carry other keys, including `id`, `status`, `reviewer`, `decision_note`, `created_at` and `decided_at`. Each such key is ignored for storage and never appears in `errors`. A new application is always stored with:
- `status` `pending`;
- `reviewer` null;
- `decision_note` null;
- `decided_at` null;
- a server-set `created_at`.

**3.** The company type options are `SaaS or Technology Platform`, `IT Services or MSP or VAR`, `Systems Integrator`, `Consultant or Agency`, `Marketplace or Distributor`, `Community or Association`, `Content or Affiliate Publisher` and `Other`.

**4.** The employee bands are `1 to 9`, `10 to 25`, `26 to 100`, `101 to 500`, `501 to 1000`, `1001 to 5000` and `5001 plus`.

**5.** The markets are `North America`, `EMEA`, `APAC`, `LATAM` and `Global`.

**6.** The customer segments are `SMB`, `Mid-Market`, `Enterprise`, `Education`, `Government or Public Sector` and `Other`.

**7.** The partnership interests are `build an integration`, `refer customers`, `resell`, `bundle into a product or service`, `offer through a marketplace or distribution channel`, `support customer implementation or adoption`, `offer to members or community`, `explore co-marketing or co-selling`, `not sure yet` and `other`.

**8. One applicant per work email**

- Two applications whose stored work emails are equal belong to the same applicant.
- PostgreSQL itself refuses a second row with the same stored work email, whatever the database collation. Simultaneous requests can therefore never both persist.
- A second application for a stored work email answers 409 `duplicate_application` and writes nothing.
- Of N simultaneous first applications for one work email, sent without a shared Idempotency-Key, exactly one answers 201 and every other answers 409.

**9. Idempotency-Key on application create**

- **Optional.** The header is optional. Without it, every request is processed fresh.
- **Format.** A valid key is 1 to 255 visible ASCII characters, `!` through `~`. Any other value, including an empty one, answers 400 `{"error":"invalid_idempotency_key"}`.
- **Same body.** Two request bodies are the same when they are equal JSON values under these rules:
  - Objects are equal when they have the same member names with equal values, in any order.
  - Arrays are equal element by element, in order.
  - Strings are equal code point by code point, before any trimming or normalisation. So a composed `é` and `e` followed by a combining accent are different.
  - Numbers are equal when their values are equal, so `1` and `1.0` are the same.
  - `true`, `false` and `null` equal only themselves, never a number.
  - Ignored keys, whether privileged or unknown, still take part in the comparison.
  - White space between tokens never matters.
- **Stored answers.**
  - These outcomes of a keyed request are stored in PostgreSQL together with the key and the body: a 201, a 409 `duplicate_application`, or a 422 `validation_failed` (including one caused by unsupported characters).
  - These answers are never stored: 400, 413, 415, 409 `request_in_progress`, 422 `idempotency_key_reused` and every 5xx.
  - A 5xx also releases the key.
- **Same key, same body, after the first request finished:**
  - The stored status and body are returned unchanged, including the same `id`, with the header `Idempotent-Replayed: true`. The first response never carries that header.
  - A replayed 201 is never turned into a 409 `duplicate_application`.
  - A replayed 422 stays a 422 with an equal JSON body.
- **Same key, different body:** 422 `{"error":"idempotency_key_reused"}`, with nothing written. This holds whether or not the first request has finished.
- **Same key, same body, while the first request is still being processed:** 409 `{"error":"request_in_progress"}`.
  - Of N simultaneous identical keyed requests, exactly one is processed.
  - Each other request answers either 409 `request_in_progress` or, if it arrives after the first one finished, the replay.
  - Exactly one row results.
- **Lifetime.**
  - A key's lifetime is `IDEMPOTENCY_KEY_TTL_SECONDS` seconds, or 86,400 seconds (24 hours) when that variable is unset. It is fixed at first use and measured on the PostgreSQL clock.
  - The key is honoured while that clock reads strictly before first use plus the lifetime. Replays and in-progress answers never extend it.
  - At or after that moment the key is expired. A request carrying it is processed fresh, as a new request: no `Idempotent-Replayed` header, and `idempotency_key_reused` never applies.
  - The fresh answer replaces the stored one and starts a new lifetime from that moment. For example, re-sending the original body of a key that created a row, after expiry, answers 409 `duplicate_application`; an immediate repeat then replays that 409 with the header.
  - Of N simultaneous requests carrying one expired key and one body, exactly one is processed. Every other request answers 409 `request_in_progress` or the replay of the new answer, and at most one new row results.

**10. Application states**

- `pending` → `approved` on `approve`.
- `pending` → `rejected` on `reject`.
- A decision on an `approved` or `rejected` application answers 409 `already_decided`. Nothing changes and no email is recorded.
- No other transition exists: no reopening, no editing and no deleting.

**11. Deciding**

A successful decision does all of the following in one PostgreSQL transaction:
- sets `status`;
- sets `reviewer` to the deciding Reviewer's email as the auth service reports it;
- sets `decision_note` to the trimmed, NFC-normalised note, or to null when the note is absent or blank;
- sets `decided_at` to the server's current UTC time;
- records exactly one outcome email of kind `approved` or `rejected` under rule 16.

Of N simultaneous decisions on one pending application, exactly one answers 200 and every other answers 409 `already_decided`. Exactly one outcome email is recorded. A losing or rolled-back decision records none.

Decision validation messages:
- A `decision` that is missing, or is not `approve` or `reject`: `Choose approve or reject.`
- A `note` that is present but neither a string nor null: `Enter the note as text.`
- A note over its limit: the limit message.
- A note with unsupported characters: the unsupported-character message.

**12. Who may act as staff**

- **Token check (401).** Every authenticated request carries `Authorization: Bearer <token>`. The token must be an access token from the realm at `AUTH_ISSUER_URL`, and the auth service must report it active at the moment of the request. These answer 401:
  - a missing, malformed, expired or forged token;
  - a token whose session has ended through sign-out;
  - a token whose account has been disabled in Keycloak. Re-enabling the account never revives that token.
- **Role check (403).** On the review routes, the caller must hold the realm role `partner-reviewer` at the moment of the request, as the auth service's current role mappings for that user show.
  - This is asked of the auth service on every review request and never cached between requests.
  - Roles written inside the token describe the moment of sign-in, so they never decide this check.
  - A role removed in Keycloak takes effect on the next request made with the same unexpired token. A restored role takes effect on the next request too.
  - A caller who passes the token check but lacks the role answers 403.
- **No early lookups.** Both checks happen before any application is read. So 401 and 403 never reveal whether an id exists, and only a caller holding the role can receive 404.
- **Sign-out.** `POST /api/auth/logout` ends exactly the Keycloak session the presented token belongs to (the session its `sid` names), then answers 204.
  - The next request with that token answers 401.
  - A token from a separate sign-in of the same account keeps working.
  - Sign-out never ends any other session.

**13. Public reads**

- **Integrations.** An integration is listed, opens at its address and serves its icon when its `published` flag is true.
- **Articles.** An article is *public* when its `published` flag is true and its `published_at` is at or before the current time on the PostgreSQL clock. The edge is inclusive: an article whose `published_at` equals the database's current time is public.
- **Press items.** A press item is *public* when its `published` flag is true and its `date` is on or before the current UTC date on the PostgreSQL clock.
- **Where this applies.** The publication moment applies to every list page, every step of a cursor walk, every result count, every list tag, every cover file and `/blog/{slug}`, which answers 404 until its article is public. A scheduled row needs no change to become public; it simply becomes public when its moment arrives.
- **Order:**
  - Blog orders by `published_at` newest first, then `id` descending.
  - Press orders by `date` newest first, then `id` descending.
- **Paging:**
  - `next_cursor` is an opaque string that marks the position of the last item returned. The next page continues strictly after that position in the list order. It is `null` when no further item exists.
  - A cursor is bound to the category it was issued under, and having no category counts as its own binding. Using a cursor with a different `category` answers `invalid_cursor`.
  - A cursor that is malformed, altered, or issued by the other list answers `invalid_cursor`, never a 5xx.
- **Stability while rows change mid-walk:**
  - An item that becomes public after the walk started appears on a later page exactly when it sorts after the cursor position, and never when it sorts before it. This applies whether it was inserted, flagged published, or reached its publication moment. For example, an item newer than everything already returned never appears, and an item older than the cursor position appears once, in its place in the order.
  - An item unpublished mid-walk does not appear on any later page.
  - Every item that stays public throughout the walk is returned exactly once: none repeats and none is skipped.

**14. Reply due**

- **Business time.** Monday to Friday, from 09:00 inclusive to 17:00 exclusive, local time in Europe/Berlin, with Berlin's own switch between summer and winter time. The partner team's holidays are not business time. They are:
  `2026-01-01, 2026-04-03, 2026-04-06, 2026-05-01, 2026-05-14, 2026-05-25, 2026-10-03, 2026-12-24, 2026-12-25, 2026-12-26, 2026-12-31, 2027-01-01, 2027-03-26, 2027-03-29, 2027-05-01, 2027-05-06, 2027-05-17, 2027-10-03, 2027-12-24, 2027-12-25, 2027-12-26, 2027-12-31`.
- **The rule.** `reply_due_at` is the earliest moment by which 16 business hours have passed since the application's `created_at`, rounded down to the whole second.
  - Counting that completes exactly at 17:00 local gives 17:00 that day, never the next opening.
  - An application submitted at or after 17:00, on a weekend or on a holiday, starts counting at the next business opening.
  - The value is written as UTC with `Z` and no fractional seconds.
- **Derived on read.** It is worked out from `created_at` on every read and never stored. A `partner_applications` row inserted directly with only the pinned columns therefore carries the right value like any other row.
- **Worked examples.**
  - Submitted `2026-10-23T14:00:00Z` (a Friday, 16:00 in Berlin; Berlin leaves summer time on 2026-10-25): due `2026-10-27T15:00:00Z`.
  - Submitted `2026-12-23T14:00:00Z` (a Wednesday, 15:00 in Berlin): due `2026-12-29T14:00:00Z`.
- **Queue order (`sort`).**
  - `submitted`, the default: `created_at` newest first, then `id` descending.
  - `reply_due`: `reply_due_at` earliest first, then `id` ascending.
  - Any other value, or `sort` given more than once, answers 400 `invalid_sort`.
  - `sort` combines with `status`.

**15. Sign-in failure limit**

- **Key.** Failures are counted per *email key*: the `email` string, trimmed, NFC-normalised and Unicode lower-cased exactly as work emails are stored.
- **What counts.** Every sign-in that answers 401 `invalid_credentials` records one failure for its email key at the PostgreSQL clock's current time. This covers a wrong password, an unknown email, a disabled account and credentials with unsupported characters. A 422, a 429 and a 503 record nothing.
- **Lock.** While an email key has 5 or more failures in the last `LOGIN_FAILURE_WINDOW_SECONDS` seconds (300 when unset), every sign-in for it answers 429 `too_many_attempts`, the correct password included. Keycloak is not contacted.
- **Retry-After.** The 429 carries `Retry-After: <n>`. `<n>` is the oldest in-window failure's time plus the window, minus now, rounded up to whole seconds, and never less than 1.
- **Reset.** A 200 sign-in deletes that email key's failures.
- **No enumeration.** Unknown and known emails are counted, locked and answered identically.
- **Under concurrency.** Of N simultaneous failing sign-ins for an email key with no recorded failures, exactly 5 answer 401 and N − 5 answer 429.
- **Sign-in order.** After the shared steps, sign-in checks run in this order:
  1. the 422 body check;
  2. the limit, which can answer 429;
  3. unsupported characters in `email` or `password`, which answer 401 `invalid_credentials`;
  4. the credential exchange with Keycloak.

**16. Outbound email**

- **Recorded with its cause.** Every email the app sends is first recorded as one `outbound_emails` row:
  - a `receipt` row in the same PostgreSQL transaction as the 201 that creates its application;
  - an `approved` or `rejected` row in the same transaction as its decision.
- **At most one per kind.** Each application has at most one row per kind.
- **When nothing is recorded.** None of these answers records an email:
  - a 422, including `idempotency_key_reused`;
  - a 409 `duplicate_application`, `request_in_progress` or `already_decided`;
  - a replay;
  - a 400, 413 or 415;
  - any 5xx;
  - a rolled-back decision.

  An expired key's fresh processing records a receipt only when it answers 201.
- **Delivery.** The app delivers recorded emails in the background, starting each new row's first attempt within 3 seconds of its commit. A row is due when its status is `queued` and its `next_attempt_at` is at or before the PostgreSQL clock's current time. The deliverer finds due rows by reading the table at least every 2 seconds, so a running instance also delivers due rows that another process recorded. Several deliveries running at once never take the same row.
- **Success.** When the mail service accepts a message, `status` becomes `sent`, `sent_at` is set, and `attempts` increases by 1.
- **Failure and backoff.** When an attempt fails, `attempts` increases by 1 and `last_attempt_at` is set to now. `next_attempt_at` becomes `last_attempt_at` plus the smaller of 2 raised to `attempts` and 30 seconds. That gives waits of 2, 4, 8, 16, 30, 30 … seconds.
- **Message-ID.** Every message carries `Message-ID: <outbound-email-<id>@relayo.example>`, where `<id>` is the row's id.
- **Exactly once.** A row reaches `sent` at most once, and the mail service never receives two messages with one Message-ID.
- **Applicant text never breaks delivery.** No stored applicant value can make a delivery attempt fail or leave a row queued forever while the mail service is up.

**17. Queue counts**

- Every queue response carries `counts`, the number of applications in each status. It is read from the same database snapshot as `items`, whatever creations and decisions commit meanwhile.
- With a `status` filter, `counts[<status>]` equals the number of `items`.
- Without one, the three counts sum to the number of `items`.

### Services (DP-11, DP-12, DP-43, DP-45, DP-52, DP-53, DP-66, DP-67, DP-68, DP-77)

**PostgreSQL** (`DATABASE_URL`)

PostgreSQL holds every record. That includes stored Idempotency-Keys and their answers, sign-in failures, and every email recorded for delivery. The app connects as a non-superuser owner of its database. It creates its schema idempotently on every start, before reporting healthy.

The table and column names below are pinned. Every table also has an integer `id` primary key.

| Table | Columns |
|---|---|
| `partner_applications` | `first_name`, `last_name`, `work_email`, `job_title`, `company_name`, `website`, `company_type`, `employee_band`, `markets` (JSON array of strings), `customer_segment`, `partnership_interests` (JSON array of strings), `goals`, `consent` (boolean), `status` (`pending`, `approved` or `rejected`), `reviewer` (text, null until decided), `decision_note` (text or null), `created_at` (UTC timestamp), `decided_at` (UTC timestamp or null) |
| `outbound_emails` | `application_id`, `kind` (`receipt`, `approved` or `rejected`), `recipient`, `subject`, `body`, `status` (`queued` or `sent`), `attempts` (integer, 0 when recorded), `last_attempt_at` (UTC timestamp or null), `next_attempt_at` (UTC timestamp, the recording time at first), `sent_at` (UTC timestamp or null), `created_at` (UTC timestamp); unique on (`application_id`, `kind`) |
| `sign_in_failures` | `email_key` (text), `failed_at` (UTC timestamp) |
| `integrations` | `slug` (unique), `name`, `description`, `category`, `icon_ref`, `published` (boolean) |
| `articles` | `slug` (unique), `title`, `category`, `summary`, `author`, `read_time` (integer minutes), `cover_ref`, `body`, `published_at` (UTC timestamp), `published` (boolean) |
| `press_items` | `date` (date), `category` (`News` or `Press Releases`), `headline`, `link`, `published` (boolean) |
| `jobs` | `title`, `location`, `is_open` (boolean) |
| `resource_cards` | `block`, `category`, `title`, `date`, `summary`, `target_link`, `published` (boolean) |

**Keycloak** (`KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`)

Keycloak owns staff identities, sessions and roles.

- **Sign-in** exchanges the email and password with the auth service through the confidential `app` client, and returns the auth service's own access token.
- **Seeding on every start.** Before reporting healthy, the app idempotently ensures that:
  - the realm role `partner-reviewer` exists;
  - both seeded accounts exist, each enabled, email-verified, with a first and last name, no pending required action, and the seeded password set as non-temporary;
  - `reviewer@example.com` holds the role;
  - `analyst@example.com` does not.
- **Service account.** In both the dev realm and the grading realm, the `app` client's service account is already enabled and holds the realm-management roles `manage-users`, `view-users` and `manage-realm`. Use it, with `AUTH_CLIENT_ID` and `AUTH_CLIENT_SECRET`, for every admin call; you need no other Keycloak credentials. The realm's own brute-force detection stays as provided; the sign-in failure limit is the app's.
- **Allowed admin writes.**
  - Start-up seeding may only create the role and the two users, set their passwords, and add or remove that one role mapping.
  - While serving, the app's only admin write is deleting the one session named in a sign-out.
  - Reading a user's role mappings and introspecting tokens are allowed.
- **Graders** use the same admin interface to remove and restore the role, and to disable and re-enable an account, mid-test.

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`)

Mailpit receives every email over SMTP, delivered under Business rules rule 16. Every message is plain-text UTF-8, with:
- **From:** the value of `MAIL_FROM`.
- **To:** the stored `work_email` as the only address, with a display name. The display name is the stored `first_name`, one space, then the stored `last_name`, with each unbroken run of carriage returns, line feeds, tabs, U+0085, U+2028 or U+2029 replaced by a single space. For example, with first name `Zoë` plus a line break plus `Bcc: spy@example.net`, and last name `O"Brien, Jr.`, the display name is `Zoë Bcc: spy@example.net O"Brien, Jr.` and nobody else receives the message.
- **Round trip.** The To header is written so that a standard RFC 5322 and RFC 2047 mail parser recovers the display name character for character; Mailpit's parsed recipient name equals it exactly. This holds for non-ASCII letters, double quotes, commas, semicolons, angle brackets, at signs and backslashes. It also holds for text that itself looks like an encoded word, such as `=?utf-8?q?Admin?=`, which comes back as that literal text and is never decoded.
- **One recipient.** The message has exactly one address in To, no Cc, no Bcc, and one SMTP recipient.
- **Line length.** No header line exceeds 998 octets, even for an 80-code-point first name and an 80-code-point last name of non-ASCII letters.
- **Headers:** built only from fixed text, `MAIL_FROM`, the validated work email, the row id and that display name. The display name is the only applicant text in any header. The subject is always the fixed text below, so a company name with line breaks appears only in the body.

| Kind | Subject |
|---|---|
| `receipt` | `We received your Relayo partner application` |
| `approved` | `Your Relayo partner application: Approved` |
| `rejected` | `Your Relayo partner application: Not approved` |

Receipt body:

```
Hello <first_name>,

Thank you for applying to the Relayo partner program on behalf of <company_name>. Our partner team reviews every application and replies by email.

The Relayo partner team
```

Approve body:

```
Hello <first_name>,

Thank you for applying to the Relayo partner program on behalf of <company_name>. Your application has been approved, and a partner manager will contact you at this address.

The Relayo partner team
```

Reject body:

```
Hello <first_name>,

Thank you for applying to the Relayo partner program on behalf of <company_name>. After review, we are not able to offer a partnership at this time.

The Relayo partner team
```

`<first_name>` and `<company_name>` are the stored values. The receipt contains no other application field. The internal note never appears in any part of any message.

**When a service is down**

| Service down | Behaviour |
|---|---|
| Mailpit | Application create still answers 201, and decisions still commit and answer 200 with `outcome_email_status` `"queued"`. Emails stay recorded in PostgreSQL and are retried on the rule 16 backoff until accepted, never sent twice. |
| Keycloak | Sign-in answers 503 `auth_unavailable` and records no failure. Authenticated requests that carry a token, sign-out included, answer 503 `auth_unavailable`. Public pages and application create keep working. |
| PostgreSQL | API routes and media files answer 503 `service_unavailable`. Pages show the outage copy from Feedback states, and health answers 503. |

### Seed data (DP-25, DP-43, DP-73, DP-80)

Every person, company, product and quote in the seed is invented. Seeding runs on every start and duplicates nothing. Rows are matched by slug; press items by headline and date; jobs and resource cards by title. No partner application, outbound email or sign-in failure exists at start.

**Accounts.** Both use the password `deku-demo-pw-2026`, which is benchmark fixture data, not a secret.

| Email | Realm roles |
|---|---|
| `reviewer@example.com` | `partner-reviewer` |
| `analyst@example.com` | none |

**Integrations.** 32 rows, 30 of them published.

| Category | Published | Named published row (`slug`, name) |
|---|---|---|
| Collaboration | 4 | `huddleboard`, Huddleboard |
| CRM | 5 | `pipewell-crm`, Pipewell CRM |
| Calendar | 3 | `datebook-calendar`, Datebook Calendar |
| Desktop App | 2 | `relayo-desktop`, Relayo for Desktop |
| Mobile | 2 | `relayo-mobile`, Relayo Mobile |
| Browser Extensions | 2 | `tabnote-extension`, Tabnote Extension |
| Storage | 3 | `vaultbox-drive`, Vaultbox Drive |
| Analytics | 3 | `signalgraph`, Signalgraph |
| Dialers | 3 | `ringstead-dialer`, Ringstead Dialer |
| Video Conferencing | 3 | `framecall-video`, Framecall Video |

The two unpublished rows are `ledgerline-crm` (Ledgerline CRM, CRM) and `coldstore-archive` (Coldstore Archive, Storage). You name the remaining published rows, with invented names.

**Articles.** 28 rows, 25 of them public.
- Public per category: Product Updates 12, Sales 5, Education 3, Media 2, Hiring 2, Company 1.
- One public Product Updates article is `meeting-notes-that-write-themselves`, titled "Meeting notes that write themselves".
- The unpublished rows are `draft-q4-roadmap` (Product Updates) and `unpublished-pricing-notes` (Sales).
- One scheduled row: `scheduled-2099-launch`, Product Updates, `published` true, `published_at` `2099-01-01T09:00:00Z`.
- The 25 public articles have `published_at` times spread between 2024-10-01 and 2026-10-01, and at least two of them share one `published_at`.

**Media files.** Every integration row, published or not, has its own original vector icon, and every article row, public or not, has its own original vector cover. Each row's `icon_ref` or `cover_ref` is its media path under API, and each file is served only under the rules there.

**Press items.** 28 rows, 25 of them public.
- Public: 21 News and 4 Press Releases, dated between 2024-10-01 and 2026-10-01. At least two public News items share one `date`.
- Unpublished: 1 News and 1 Press Release.
- One scheduled News item: `Relayo at the 2099 partner summit`, dated `2099-01-01`, `published` true.

**Jobs.** 6 rows, 4 of them open. The careers board lists only the open jobs.

**Resource cards.** 10 published rows, two in each of Updates, Case Studies, Webinars, Guides and Videos.

## Technical requirements

### Deployment (DP-01)

- A current Python 3 runtime is available. Build in Python.
- The app is installed and run as an unprivileged user. Dependencies go into a `.venv` inside `/app`. The manifest calls tools by path (`.venv/bin/<tool>`) or as `python -m <tool>` through that environment.
- Ship `/app/run.json` with `"_schema": "run-manifest-v1"` and the string keys `install`, `build` and `serve`. For example:

  ```json
  {"_schema": "run-manifest-v1",
   "install": "python3 -m venv .venv && .venv/bin/python -m pip install --no-cache-dir -r requirements.txt",
   "build": ".venv/bin/python -m compileall -q .",
   "serve": ".venv/bin/python -m server"}
  ```

- `serve` runs a production server, never a development reloader. The background email delivery runs inside the served app; no second process is needed.
- The server listens on `0.0.0.0` (never loopback only), on port 4173, or on `APP_PUBLIC_PORT` when that variable is set.
- `GET /api/health` behaves as stated under API.
- The app starts from the environment image with no manual step.
- The server keeps running after your session ends and is not a child of your shell.
- Empty `.browser_screenshots/` and `.downloads/` directories exist at the app root.
- No persistent volumes, fixed container names or custom networks.

### Configuration and secrets (DP-59, DP-62, DP-71)

- Read these variables at start: `DATABASE_URL`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `APP_PUBLIC_PORT`, `IDEMPOTENCY_KEY_TTL_SECONDS` and `LOGIN_FAILURE_WINDOW_SECONDS`.
- `MAIL_FROM` holds the sender of every email, `Relayo Partnerships <partners@relayo.example>`. Read it from the environment; never write it in source.
- `IDEMPOTENCY_KEY_TTL_SECONDS` and `LOGIN_FAILURE_WINDOW_SECONDS` are positive whole numbers of seconds. Graders start a dedicated instance with them set to 6 and 8.
- No host, port, password or secret is written in source.
- The client secret, the database credentials and any Keycloak admin access never reach the browser, whether in page source, scripts or API responses.
- The seeded password is written only in `/app/USER_README.md` and in the start-up seeding.

### Server boundary (DP-58, DP-61, DP-63, DP-80)

- **Origin.** Pages and API share one origin. The server sends no cross-origin access headers, and every page loads its scripts, styles, fonts and media from that origin only.
- **Request bodies.** Bodies up to and including 65,536 bytes are accepted. A larger body answers 413 `{"error":"payload_too_large"}`.
- **Media type.** A body sent with a media type other than JSON answers 415 `{"error":"unsupported_media_type"}`.
- **Malformed JSON.** A body answers 400 `{"error":"invalid_json"}` when any of these hold:
  - it does not parse;
  - its top level is not an object;
  - any object anywhere in it repeats a member name;
  - it nests deeper than 32 levels. The top-level object is level 1, and each array or object inside adds one level, so 32 levels are allowed and 33 are refused;
  - any number literal is longer than 64 characters, counting its sign, digits, decimal point and exponent. 64 characters are allowed;
  - it contains a `NaN`, `Infinity` or `-Infinity` literal.

  Such a body is never stored and never touches the idempotency store.
- **Check order.** 413 and 415 run right after the route and method step. The 400 `invalid_json` check runs at its own step of the check order under Business rules.
- **No 5xx from input.** No request value, header or body content ever produces a 5xx, and no response ever contains a stack trace, SQL, a file path or a library name.
- **Unexpected errors** answer 500 `{"error":"internal_error"}`, with the cause logged on the server.
- **Never served.** The server never serves its source files, `run.json`, `USER_README.md`, environment files, dependency manifests or any credential. Such paths answer 404. Integration icons and article covers are served only through the public media rule under API, never from a folder that is exposed as a whole.
- **Unreachable dependency at boot.** If PostgreSQL or Keycloak is unreachable at boot, the process does not exit. It retries every few seconds, answers health with 503 until schema and seeding finish, and serves normally once they do. An unreachable mail service never delays health.
- **Direct API clients.** The authorization, sign-in limit, sign-out, decide-once, one-applicant and one-receipt rules hold for any client calling the API directly, not only for the site's own pages.

### Browser support and performance (DP-32, DP-35, DP-65, DP-76, DP-82, DP-83)

- Current Chromium on:
  - desktop, from 1280 by 800 up to 1920 by 1200;
  - tablet, 768 by 1024;
  - phones with touch, 375 by 812 and 390 by 844;
  - reflow down to 320 wide;
  - forced-colours (high-contrast) mode at 1280 by 800.
- Every public page shows its main content within three seconds of opening on the grading machine.
- A filter or page change shows the new list within one second when the API answers promptly.
- Pages render from the seeded store with no artificial delay.
- A missing media file never delays the opening statement.

## Working rules

- **IF-01** `/app/USER_README.md` lists `reviewer@example.com` with role `partner-reviewer` and `analyst@example.com` with no role, each with the password `deku-demo-pw-2026`.
- **IF-02** `/app/run.json` is a JSON object with `"_schema": "run-manifest-v1"` and the string keys `install`, `build` and `serve`.
- **IF-03** `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence. Shipped packages are the production dependency tree: every package the `install` command installs from the runtime requirements (or a lockfile's non-dev group), transitive dependencies included.
- **IF-04** Every shipped package is under the MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0 or MPL-2.0 licence.
- **IF-05** The only datastores and backing services are PostgreSQL, Keycloak and Mailpit. There is no embedded database, cache server, message broker, or file used as a datastore.
- **IF-06** The provided service configuration stays untouched. Keycloak realm settings and clients are never edited, nothing is imported, and no realm, client, role or user is deleted. The only exceptions are removing the `partner-reviewer` mapping from `analyst@example.com` and deleting the single session named in a sign-out.
- **IF-07** `/app/.browser_screenshots/` and `/app/.downloads/` exist and are empty.
- **IF-08** Python dependencies are installed into `/app/.venv`, and `run.json` calls tools through `.venv/bin/` or `python -m` within that environment, never through a system-wide install.

## Engineering standards

- The Python is idiomatic: standard formatting, type hints on public functions, context-managed database and network resources, and no bare `except`.
- Names in the source match this brief's terms: partner application, work email, reviewer, decision, internal note, receipt, outcome email, outbound email, display name, reply due, sign-in failure, integration, article, press item, public, category, cursor, list tag, media file, return address, Idempotency-Key, sign-out, no access.
- Each domain rule is decided in exactly one place in the source and reused wherever it applies. These rules are:
  - the field limits and counting rule;
  - the unsupported-character rule;
  - the option lists;
  - the application state transitions;
  - the staff token and role checks;
  - the sign-in failure limit and its email key;
  - the idempotency answers, body equality and key lifetime;
  - the publication moment, shared by lists, detail pages, list tags and media files;
  - the list ordering and cursor binding;
  - the list tag and its If-None-Match match;
  - the reply-due computation and holiday list;
  - outbound email recording, backoff and wording;
  - the recipient display name, shared by all three email kinds;
  - the private no-store rule;
  - the published API surface;
  - the return-address check.
- Every error response is built through one consistent error shape: a JSON object with an `error` code and its documented extra fields.
- No abstraction has only one implementation. There is no dead, commented-out or unreachable code, and no defensive check for a state that the database or an earlier check already rules out.
- PostgreSQL guarantees every single-winner and counted outcome, never a read followed by a separate write. These outcomes are:
  - one applicant per work email;
  - one processing per Idempotency-Key, including an expired key's takeover;
  - one decision per application;
  - one email per application and kind;
  - one delivery claim per email;
  - the sign-in failure count;
  - queue counts from the queue's own snapshot.
- The source has no feature, endpoint, screen or setting beyond this brief.
