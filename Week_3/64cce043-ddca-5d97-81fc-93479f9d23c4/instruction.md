# Hollowmere Strongroom Ledger

Strongroom Ledger is a private vault for one person. The owner records which companies and apps hold which pieces of their personal data. Each record is graded by sensitivity using rules the owner edits and puts in order. The owner logs breaches by the kinds of data exposed. From that, the server works out an exposure score, the list of affected records and an ordered list of next steps. Some steps, such as a credit-bureau fraud alert, apply to the person and are counted once, however many companies trigger them. The owner can give one trusted contact a read-only view. That view is limited in scope, masks sensitive values and ends at a time the server sets.

Build it as a Python web app backed by two services:
- **Keycloak** handles every sign-in, the trusted contact's account and the ending of sessions.
- **Postgres** is the system of record, the clock that grant expiry and session idle time are measured against, and the channel for live change events.

Out of scope:
- payments, email and file uploads
- importing from breach-lookup sites
- more than one trusted contact per vault, and shared vaults
- an admin console
- any datastore other than the provided Postgres database

## Problem and users

Breach notices usually say "some customer data was exposed". The person affected then has to remember whether that company has their passport scan, national ID, bank account, health record, address or date of birth. They have to judge how bad that is and decide what to do first.

Today they use a spreadsheet, a password manager's notes field or a breach-lookup site. Those tools can say that an email address appeared in a breach. They do not know what each company holds, they rank nothing, and they give no ordered recovery plan. They also repeat person-wide steps, such as placing a fraud alert with a credit bureau, once for every company. In reality that alert is placed once per person.

A partner, parent or adult child may have to act while the owner is travelling, ill or locked out. Today that person gets either everything (a shared login) or nothing. The owner pays in lost hours, late card and ID replacement, and fraud they could have prevented.

- **Owner** (weekly): records holdings, edits and orders grading rules, logs breaches, reads the exposure score and works through next steps. They also grant, narrow and revoke the trusted contact's access, and change their password. They often keep the vault open in more than one tab or window, and sometimes leave a form half-filled long enough for the session to lapse.
- **Trusted contact** (occasional): signs in with an account the app created for them. They see a masked, read-only view of the owner's vault, limited to the levels the owner chose, and watch next steps get done while the owner is away.
- **Outsider** (occasional): the signed-in owner of another vault, or a signed-out visitor. They must learn nothing about this vault, not even whether a record exists.

## Journeys

1. **Sign in and read exposure.**
   - **Start:** signed out, holding a link to one of their breach pages.
   - Opening the link brings them to `/` with the requested page remembered. The owner chooses `link "Sign in"` and signs in on the realm's page.
   - They come back to that breach page.
   - A plain sign-in from `/` lands on `/vault`. That screen shows the ledger of holdings grouped by company. Beside it are the exposure score, its band and the ordered next steps.
   - A person who registered on the realm page and never used the app gets one empty vault, even if they finish sign-in in two browsers at once.
2. **Record and find holdings.**
   - **Start:** the owner at `/vault`.
   - They add a holding through `dialog "Add holding"`, and it appears in its place with a level set by the server.
   - They type quickly in `searchbox "Search holdings"`, change their mind and choose a level. The rows, the counts and the Results status follow the latest input. The page address carries the filters, so Back and Forward step through earlier filters in place, and a copied link opens filtered.
3. **Tune grading rules.**
   - **Start:** the owner at `/vault/rules`.
   - They move a rule by drag or keyboard. The Preview shows the new levels and the projected score while it moves, and the drop is announced.
   - If a rule was added in another window meanwhile, the drop is refused. The list snaps to the saved order and focus stays on the handle.
   - They edit one rule in two tabs. The second save is refused and their entries are kept.
   - If the trusted contact is watching, a rule edit that changes a holding's level moves that holding into or out of the contact's view at once.
4. **Log a breach with a blast preview.**
   - **Start:** the owner at `/vault`.
   - They open the Log breach form, type a few letters, and pick the company from the suggestions with the keyboard. They then tick data kinds.
   - The touched ledger rows light one by one and the score numeral counts to the projected total. Person-level steps shared with existing exposure are counted only once.
   - A change from another tab redraws the screen without touching the form.
   - **End:** they save, and the committed score appears and is announced.
5. **Work the next steps by keyboard.**
   - **Start:** the owner at `/vault`.
   - They arrow through `list "Next steps"` and press Space.
   - A step done earlier in another window settles on the server's state with an alert. A second step whose first step is still open is refused with an alert. Focus stays on the step in every case.
6. **Grant a trusted contact.**
   - **Start:** the owner at `/vault/contact` with no active grant.
   - They grant access through `dialog "Grant access"` and pass on the one-time temporary password.
   - The contact signs in, chooses their own password on the realm page, and sees the masked, scoped view with the server's remaining access time.
7. **Narrow, revoke and expiry.**
   - **Start:** the contact has `/shared` open.
   - The owner narrows the scope. The contact's view loses those rows within two seconds.
   - The owner revokes. The contact's view shows Access ended within two seconds.
   - Without a revoke, the same screen appears within two seconds after the grant's end instant.
8. **Delete, idle out and change password.**
   - **Start:** the owner at a holding's detail page.
   - The owner deletes the holding with a confirmed double click. One delete happens and the row leaves every surface.
   - Later they leave a breach page with unsaved ticks until the session idles out. Saving sends them through sign-in and back to the same page, with the ticks restored and nothing saved yet.
   - At `/vault/account` they change their password. Their other browser and their contact's browser are signed out on their next request.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign in through the realm** The owner signs in on the realm's sign-in page from link "Sign in" and lands on /vault (a trusted contact on /shared), or on the screen they first asked for as DP-61 allows.
- **DP-02 — Browser-bound sign-in** Each sign-in attempt carries a fresh state and PKCE challenge bound to the browser that started it, and a callback with a missing, reused, expired or foreign state shows the sign-in failure page and creates no session.
- **DP-03 — Unfinished sign-in reaches nothing** A browser holding only a pending sign-in, or a contact who has not finished the realm's password step, gets the signed-out answer from every API route and sees no vault or grant data.
- **DP-04 — A new account gets an empty vault** A realm account that is neither seeded nor a trusted contact gets its own empty vault with the default grading rules on its first sign-in, once only as DP-75 qualifies.
- **DP-05 — Record a holding** The owner adds a holding through dialog "Add holding" and the row appears in ledger order with its server-computed level, without a reload.
- **DP-06 — Holding validation** Holding writes reject bad fields with 422 field errors and a second holding of the same company and data kind with 409, as listed in API.
- **DP-07 — No client-set holding fields** A holding write carrying any key outside the editable list answers 422 and changes nothing.
- **DP-08 — Vault-scoped ids** Every id in a path or request body that is outside the caller's view answers 404 with the same body as an id that never existed.
- **DP-09 — Find holdings** The owner narrows the ledger by search text, company, data kind and level and sees the matching rows, the filter counts and their own score.
- **DP-10 — Live filtering** Typing in the search box or changing a filter updates the ledger rows, the filter counts and status "Results" in place within one second, with no submit button or reload, as qualified by DP-63 and DP-72.
- **DP-11 — Facets and totals per vault** The holdings list returns totals, facet counts and the exposure score computed only from the caller's own vault, following the facet rule in Business rules.
- **DP-12 — Scoped contact search** For a trusted contact, search text matches only company and data kind label, and items, totals, facets and score count only the holdings their scope shows.
- **DP-13 — Edit grading rules** The owner adds, edits and deletes grading rules on the Rules screen, and every holding's level and the score follow the change.
- **DP-14 — Published grading order** A holding's level comes from the matching rule with the lowest priority number, the stricter level among tied rules, and Low when no rule matches.
- **DP-15 — Rule validation and fields** Rule writes reject bad values and unknown keys with 422 and a 51st rule with 409, changing nothing.
- **DP-16 — Owner-only actions** Every write route, and the rules, grant and account routes, refuse a trusted contact on the server whatever the screen shows, as qualified in API.
- **DP-17 — Reorder rules with a preview** While the owner drags a rule, region "Preview" shows each holding's previewed level and the projected score in place, and dropping saves the new order.
- **DP-18 — Preview equals saved grading** The levels and score the rule preview returns for an order equal those the vault reports after that order is saved.
- **DP-19 — Keyboard rule reorder** A rule's move handle picks the rule up with Space, moves it with the arrow keys, drops it with Space or Enter and cancels with Escape, keeping focus on the handle and announcing each step, as DP-78 qualifies when the order cannot be saved.
- **DP-20 — Log a breach** The owner logs a breach from form "Log breach" and sees the touched rows, the new score and the new next steps without a reload.
- **DP-21 — Blast preview** Ticking or unticking a data kind lights or clears the touched ledger rows one by one in ledger order and counts the score numeral to the server's projected score, as timed in Motion and effects.
- **DP-22 — Reduced-motion blast preview** Under reduced motion the touched rows show a still amber edge and the Touched label, and the numeral changes straight to the projected score, which is announced politely.
- **DP-23 — Committed score check** After a breach is saved the screen shows the server's committed score, and an alert appears when it differs from the last preview.
- **DP-24 — Breach validation** Breach writes reject a missing company, a malformed or future date and an empty, repeated or unknown data-kind list with 422 field errors.
- **DP-25 — Idempotent breach logging** A repeated breach request with the same Idempotency-Key and body returns the stored 201 response and creates nothing, and the same key with a different body answers 409.
- **DP-26 — Breach detail** The owner opens a breach and sees its data kinds, the holdings it touches in ledger order and those holdings' next steps.
- **DP-27 — Edit breach kinds** Changing a breach's data kinds recomputes the affected holdings, the steps and the score, and clears the done marks of holdings it no longer touches.
- **DP-28 — Remove a breach** Removing a breach answers 204, later requests for it answer 404, and its touched holdings, steps and score contribution go in the same change.
- **DP-29 — Not-found page** Opening a screen URL for a record that does not exist or is outside the caller's view shows the published not-found page with status 404.
- **DP-30 — Work the next steps** The owner marks steps done and reopens them in list "Next steps", and the score falls and rises by each step's points.
- **DP-31 — Step order and exposure score** Next steps are ordered, and the exposure score and band computed, exactly as Business rules defines, including shared person-level steps, by one computation that every surface shares.
- **DP-32 — Step transitions** Marking an open step done or reopening a done step succeeds once, the illegal repeat answers 409, of two simultaneous identical requests exactly one succeeds, and the ordering rule of DP-71 applies within a holding.
- **DP-33 — Keyboard step list** In the next-steps list the arrow keys move focus, Space or Enter toggles the focused step, and focus stays on that step after the update.
- **DP-34 — Announced exposure changes** Saving or deleting a holding, changing rules, logging, editing or removing a breach and marking a step announce the published copy with the new score in status "Exposure updates".
- **DP-35 — Delete a holding** The owner deletes a holding after confirming in alertdialog "Delete holding?" and returns to the ledger with the row gone.
- **DP-36 — Deleted holdings leave every surface** After deletion the holding answers 404 and is gone from lists, search, facets, totals, the score, breach affected lists, next steps and the contact's view.
- **DP-37 — Id-only change events** Every committed change sends a database notification and a live event that carry only the vault id, a type and a record id, never values, notes or masked fields.
- **DP-38 — Grant a trusted contact** The owner grants access through dialog "Grant access", the realm gains the contact's account with a temporary password, and the dialog shows that password once.
- **DP-39 — Grant rules** A vault has at most one active grant, the server sets the end instant from the chosen duration and the database clock, and of two simultaneous grant requests exactly one succeeds, as DP-79 qualifies for the realm.
- **DP-40 — Grant dialog by keyboard** The grant dialog opens with focus inside, keeps Tab and Shift+Tab within it, closes on Escape and returns focus to the control that opened it.
- **DP-41 — Contact view** The trusted contact signs in, sets their own password on the realm page, and sees the shared ledger, score, next steps and remaining access time, read-only.
- **DP-42 — Contact field projection** Every response a trusted contact receives carries only the published contact fields, never notes, versions, rule details or other grant details.
- **DP-43 — Server-side masking** Values of Critical and High holdings reach a trusted contact only in the published mask format.
- **DP-44 — Narrow the scope** Narrowing applies on the contact's next request, their open view loses the removed levels within two seconds without a refresh, and widening answers 422, with races settled as DP-80 sets.
- **DP-45 — Revoke access** Revoking ends the contact's app sessions and realm sessions at once, so their next request answers 401 and their open view shows the Access ended screen within two seconds.
- **DP-46 — Contact live updates** The contact's live stream carries only the published contact events, and their screen announces each one politely with the published copy.
- **DP-47 — Narrow and revoke while watched** With the contact's view open, the owner narrows and then revokes from the Trusted contact screen, and both screens show each result without reloading.
- **DP-48 — Server-decided remaining time** Grant status and remaining time on both screens come from the server, refresh at the published interval and never depend on the device clock.
- **DP-49 — Exclusive expiry edge** A contact request at or after the grant's end instant by the database clock answers the access-ended 403, and one before it succeeds.
- **DP-50 — Access ended screen** A contact whose grant has ended sees the published Access ended screen in place of the shared view, within the window DP-69 sets when the view is open.
- **DP-51 — Change password** The owner changes their password in form "Change password" on the Account screen and stays signed in there.
- **DP-52 — Sessions end on password change** A password change ends every other session of the owner and every session of their trusted contact, so their next request answers 401 and the realm lists no session for either.
- **DP-53 — Identity outage** While the realm is unreachable, existing sessions keep working, sign-in, new grants and password changes answer the published 503, revoking still ends access, and the outage banner shows.
- **DP-54 — Run manifest and health** The app installs, builds and serves from /app/run.json on port 4173 and answers the health check.
- **DP-55 — One error shape** Every API error uses the one published error body and follows the published precedence order.
- **DP-56 — Server boundary** The server enforces the published body limit, content type and origin checks and never serves source files, the manifest or credentials.
- **DP-57 — Responsive layout** At 375, 768 and 1280 pixels wide the screens follow the layouts in Screens and layout with no horizontal scrolling, and the score is pinned above the list on narrow screens.
- **DP-58 — Touch and reduced motion** Every control is at least 44 by 44 pixels, and under reduced motion every change shows its final state at once, with nothing counting or staggering.
- **DP-59 — Ledger look** The screens read as a dark, ruled ledger with aligned figures and one amber accent kept for exposure, as described in Visual design.
- **DP-60 — Real identity and database wiring** Credentials and URLs come from the environment, accounts and sessions are managed through the realm's admin interface, and live events travel through database notifications.
- **DP-61 — Safe return after sign-in** A signed-out visit to a vault or shared screen returns there after sign-in, while any return value that fails the check in Business rules lands on the signer's default screen instead.
- **DP-62 — One holding per company and kind, under load** Of simultaneous holding writes that collide on company (in any spelling) and data kind, exactly one succeeds and the rest answer 409 holding_exists, with one change event sent.
- **DP-63 — Latest input wins** The ledger rows, filter counts, Results status, breach preview and rule preview always show the answer to the most recent input, and a late answer to older input never paints.
- **DP-64 — Stale edits are refused** Holding, rule and breach edits carry the version they were loaded at, and a stale version answers 409 stale_version before any validation error and changes nothing.
- **DP-65 — Rule limit under load** With 49 rules, of simultaneous rule adds exactly one succeeds and the rest answer 409 rule_limit, and a reorder built before a concurrent add answers 422 rather than dropping the new rule.
- **DP-66 — Unsaved edits survive live refresh** A live event or poll that redraws the vault or a breach detail page keeps the owner's unsaved ticks, typed company, focus and form key, and re-requests the preview against the new vault state.
- **DP-67 — Live streams release on disconnect** Within 20 seconds of a client closing its live stream the server releases every database resource the stream held, so the count of strongroom database sessions returns to its earlier level.
- **DP-68 — Honest step toggles** A step toggle shows at once, then settles on the server's state and score, rolling back or showing the published alert on failure or conflict while focus stays on the step.
- **DP-69 — Expiry is pushed on time** A contact's open stream receives access-ended within two seconds after the grant's end instant by the database clock, and the open screen shows Access ended in that window without a reload.
- **DP-70 — Shared person-level steps** Each person-level step appears once per vault while any affected holding contributes it, at the strictest contributor's level and points, keeping its id and done mark until the last contributor leaves.
- **DP-71 — Steps in order within a holding** When both steps of a holding are holding-level, step 2 cannot be marked done while step 1 is open (409 step_out_of_order), and reopening step 1 also reopens a done step 2 in the same change.
- **DP-72 — Filters live in the URL** The ledger's search text and filters are mirrored in the page address, so Back and Forward restore rows and counts in place and a filtered link opens filtered.
- **DP-73 — Company suggestions** The Log breach form's Company combobox offers the vault's companies in a listbox that works by keyboard and whose every option is visible and clickable at every published width.
- **DP-74 — Unsaved work survives an expired session** A save answered 401 after the session idled out keeps the entries as a one-use draft, signs in again to the same screen and restores them without saving.
- **DP-75 — One vault per account under load** Simultaneous first sign-ins of one new realm account create exactly one vault with exactly twelve default rules.
- **DP-76 — Answers belong to their caller** Under many interleaved concurrent requests from different people, every response and live event belongs only to the person who made the request.
- **DP-77 — Rule edits move the contact's view** A rule edit that changes a holding's level moves it into or out of the contact's view and mask at once and pushes view.changed to their open screen within two seconds.
- **DP-78 — Honest rule reorder** A drop is announced, and a reorder the server refuses snaps the list and Preview back to the server's state with the published alert while focus stays on the moved handle.
- **DP-79 — Grant and realm stay in step** Of simultaneous grant requests only the winner creates or updates the contact's realm account, and a grant whose realm call fails is not stored.
- **DP-80 — Simultaneous revoke and narrow** Of simultaneous revokes exactly one succeeds with one grant.updated and one access-ended, and a narrow racing a revoke either commits first or answers no_active_grant.
- **DP-81 — Grant dialog survives refresh** Refreshes and live events never close the open Grant access dialog, clear its entries or focus, or hide a shown temporary password before Done.
- **DP-82 — Idle sessions expire** A session unused for SESSION_IDLE_SECONDS by the database clock answers 401 on its next request and its live stream closes by the next keep-alive.
- **DP-83 — Exact breakpoints** The two-column layout applies at 1024 pixels wide and above, the pinned-band layout from 600 to 1023, and the phone layout below 600, on the ledger, shared and Rules screens.
- **DP-84 — Closed means unreachable** The closed phone menu and the closed Log breach form expose no focusable control and nothing in the accessibility tree.
- **DP-85 — One delete per confirmation** A double click on Delete in alertdialog "Delete holding?" sends one DELETE and one holding.deleted, and a replayed DELETE answers 404.

## Frontend

### Screens and layout (DP-01, DP-05, DP-09, DP-13, DP-17, DP-20, DP-26, DP-29, DP-30, DP-35, DP-38, DP-41, DP-50, DP-51, DP-57, DP-61, DP-83, DP-84)

**Screen routes**

| Route | Who | Content |
|---|---|---|
| `/` | signed out | The Hollowmere wordmark, heading `Strongroom Ledger`, one line saying what the vault does, and `link "Sign in"`. A signed-in person who opens `/` is redirected to their home screen. |
| `/vault` | owner | The ledger with the exposure column. |
| `/vault/holdings/<id>` | owner | One holding: company, data kind, level, value and notes. Also the line `Graded by <rule label>` (or `No rule matched`), whether it is affected (yes or no), and edit and delete controls. |
| `/vault/breaches` | owner | Breaches, newest announced date first. Each is a link `<company> — <announced on>`. |
| `/vault/breaches/<id>` | owner | One breach: the heading `Breach at <company>`, its data kinds (editable), the holdings it touches and their steps. While kinds are being edited, it also shows a projected score. |
| `/vault/rules` | owner | Grading rules in order, with a Preview region showing every holding's level and the projected score. |
| `/vault/contact` | owner | The grant panel for the most recent grant, with the status word `Active`, `Expired` or `Revoked`. `button "Add trusted contact"` is shown whenever no grant is active. The empty state shows only when no grant has ever been created. |
| `/vault/account` | owner | The change-password form. |
| `/shared` | trusted contact | Heading `Shared by <owner name>`, the remaining access time, a read-only ledger with search and filters, the exposure column with read-only steps, and the breaches that touch the contact's scope. Once the grant has ended, this route shows the Access ended screen instead. |

**Routing**
- A signed-out request for `/vault`, any path starting with `/vault/`, or `/shared` answers 302 to `/?next=<encoded>`. `<encoded>` is the requested path and query, percent-encoded as a single query value.
- On `/` opened with a `next` parameter, `link "Sign in"` points to `/auth/login?next=<encoded>` with that same value. Without one, it points to `/auth/login`.
- A contact who opens a `/vault` route is redirected to `/shared`. An owner who opens `/shared` is redirected to `/vault`.
- An unknown path, or a record route whose id is outside the caller's view, renders the not-found page with HTTP 404. The page copy is in Feedback states.

**Top bar**
- Every owner screen has a top bar with the Hollowmere wordmark, `navigation "Vault"` and `button "Sign out"`.
- The contact screen has the wordmark and `button "Sign out"`.

**The ledger** (`/vault`, and read-only on `/shared`)
- Above the rows sits a filter bar with the search box and three selects.
- Rows are grouped under a company heading row, in ledger order (see Business rules).
- Each holding row shows the data kind label, a level badge, and the value in monospace with figures lined up down the column. Thin ruled lines separate the rows.
- On the owner's ledger, each row links to its detail page, and `button "Add holding"` sits at the head of the ledger.

**The exposure column.** `region "Exposure"` contains, in this order:
1. the heading `Exposure score`
2. a very large score numeral and the band name
3. `button "Log breach"` (owner only)
4. the breach form, when it is open
5. `list "Next steps"`, where each step shows its text, the company, the data kind, its points, and whether it is done or open

**Layouts by width.** These apply to the ledger screens (`/vault` and `/shared`) and the Rules screen. No screen scrolls sideways at any width.

- **Two-column layout: 1024 pixels wide and above.** The published 1280 by 800 view uses it.
  - The ledger fills about the left three-fifths.
  - The exposure column fills the right two-fifths at full height and stays in view while the ledger scrolls.
  - The breach form opens inside the column, so the ledger rows stay visible beside it.
  - On Rules, the rule list is on the left and `region "Preview"` is on the right.
- **Pinned-band layout: 600 to 1023 pixels wide.** The published 768 by 1024 view uses it.
  - The page is one column.
  - A score band stays pinned under the top bar while the page scrolls. It holds the score numeral, the band and `button "Log breach"`.
  - Below the band come the breach form (when open), then the next steps, then the ledger.
  - The filter bar wraps to two lines.
  - On Rules, `region "Preview"` sits above the rule list, and its projected-score line stays pinned under the top bar.
- **Phone layout: narrower than 600 pixels.** The published 375 by 812 view uses it.
  - The stacking is the same as the pinned-band layout.
  - The owner's navigation collapses behind `button "Menu"`.
  - Each ledger row becomes a two-line card: the data kind and level badge on the first line, the value on the second. The company heading sits above each group.
  - Dialogs fill the screen.

**Closed panels**
- While the phone menu is closed, its links are not visible, not focusable and not in the accessibility tree.
- While the breach form is closed, none of its fields or buttons are visible, focusable or in the accessibility tree, at every width.
- Moving a panel off-screen does not count as closing it.

### Public screens and controls (DP-01, DP-05, DP-10, DP-17, DP-19, DP-20, DP-30, DP-33, DP-35, DP-38, DP-40, DP-41, DP-44, DP-45, DP-51, DP-61, DP-68, DP-72, DP-73, DP-74, DP-78, DP-84)

These roles and accessible names are the public surface. Anything else is free. `<rule label>` and `<kind label>` are defined in Business rules. `<company>` is a holding's company as displayed.

| Screen | Role and accessible name | Visible copy or purpose |
|---|---|---|
| `/` | `link "Sign in"` | `Sign in`. Its target carries `next` as described in Screens and layout. |
| all owner screens | `navigation "Vault"` with links `Ledger`, `Breaches`, `Rules`, `Trusted contact`, `Account` | |
| all signed-in screens | `button "Sign out"` | `Sign out` |
| owner screens narrower than 600 | `button "Menu"` | Opens and closes the navigation. |
| all screens | `alert` outage banner | Outage copy from Feedback states. |
| `/vault`, `/shared` | `searchbox "Search holdings"` | |
| `/vault`, `/shared` | `combobox "Company"`, `combobox "Data kind"`, `combobox "Level"` (filter bar) | See "Filter select options" below. |
| `/vault`, `/shared` | `status "Results"` | Results copy from Feedback states. |
| `/vault`, `/shared` | `table "Holdings"` | One `row` per holding and one per company heading. |
| `/vault` | `button "Add holding"` | Opens `dialog "Add holding"`. |
| `/vault`, `/vault/rules`, `/shared` | `region "Exposure"` (on Rules, `region "Preview"`) | Score numeral and band name. |
| owner screens with a score | `status "Exposure updates"` | Exposure announcements. |
| `/vault` | `button "Log breach"` | Opens `form "Log breach"`. |
| `/vault` | `form "Log breach"` | See "Log breach form" below. |
| `/vault` | `list "Next steps"` | One `checkbox "<step text>, <company>"` per step. |
| `/shared` | `list "Next steps"` | One `listitem` per step, showing `Done` or `Open`. Read-only. |
| `/shared` | `status "Access time"` | Remaining-time copy from Feedback states. |
| `/shared` | `status "Shared updates"` | Contact announcements. |
| add or edit holding | `dialog "Add holding"` or `dialog "Edit holding"` | Contains `textbox "Company"`, `combobox "Data kind"`, `textbox "Value"`, `textbox "Notes"`, `button "Save holding"` and `button "Cancel"`. |
| holding detail | `button "Edit holding"`, `button "Delete holding"` | |
| holding detail | `alertdialog "Delete holding?"` | Contains `button "Delete"` and `button "Keep"`. |
| breach detail | `group "Data kinds"` with one `checkbox "<kind label>"` per kind, `button "Save kinds"`, `button "Remove breach"`, `table "Affected holdings"`, `list "Steps for this breach"` | |
| breach detail | `alertdialog "Remove breach?"` | Contains `button "Remove"` and `button "Keep"`. |
| `/vault/rules` | `list "Rules"` | Each rule is a `listitem` showing its priority and `<rule label>`. |
| `/vault/rules` | for each rule: `button "Move rule: <rule label>"`, `button "Edit rule: <rule label>"`, `button "Delete rule: <rule label>"` | |
| `/vault/rules` | `button "Add rule"`, and `dialog "Add rule"` or `dialog "Edit rule"` | The dialog contains `combobox "Data kind"` (first option `Any kind`), `textbox "Company contains"`, `combobox "Level"`, `spinbutton "Priority"`, `button "Save rule"` and `button "Cancel"`. |
| `/vault/rules` | `region "Preview"` | Contains `table "Preview levels"` and the line `Projected score <score>`. |
| `/vault/rules` | `status "Rule order"` | Reorder announcements. |
| `/vault/contact` | `button "Add trusted contact"` | Present whenever no grant is active. Opens `dialog "Grant access"`. |
| `/vault/contact` | `dialog "Grant access"` | See "Grant access dialog" below. |
| `/vault/contact` | grant panel | Contact name and email, the status word and the remaining-time line. While the grant is active it also has `group "Levels shown"` checkboxes, `button "Narrow scope"` and `button "Revoke access"`. These are absent once the grant has ended. |
| `/vault/contact` | `alertdialog "Revoke access?"` | Contains `button "Revoke"` and `button "Keep"`. |
| `/vault/contact` | `status "Grant updates"` | Grant announcements. |
| `/vault/account` | `form "Change password"` | Password fields labelled `Current password` and `New password`, and `button "Change password"`. |
| `/vault/account` | `status "Account updates"` | |
| owner screens | `status "Draft restored"` | Draft copy from Feedback states. |
| any form or dialog | `alert` error summary headed `Check these fields` | One link per field error. |
| any screen | `alert` | Request-level errors from Feedback states. |
| not found | heading `Not found`, `link "Back to ledger"` | |
| sign-in failure | heading `Sign-in failed`, `link "Sign in"` | |
| Access ended | heading `Access ended`, and `status "Shared updates"` | `Access ended.` |

**Log breach form.** `form "Log breach"` contains:
- `combobox "Company"`, which controls `listbox "Company suggestions"` with one `option` per suggested company
- `textbox "Announced on"`
- `group "Data kinds"`, with one `checkbox "<kind label>"` per kind
- `status "Breach preview"`
- `button "Save breach"` and `button "Cancel"`

**Filter select options** (the filter bar's `combobox "Company"`, `combobox "Data kind"` and `combobox "Level"`):
- The first option reads `All` and has an empty value.
- Every other option reads `<name> (<count>)`, using the facet counts. `<name>` is the company spelling, the `<kind label>` or the level label.
- Order: companies A to Z, kinds in the published kind order, levels strictest first.
- Option values are the company spelling, the kind code and the level code.

**Grant access dialog.** `dialog "Grant access"` contains:
- `textbox "Contact name"`
- `textbox "Contact email"`
- `radiogroup "Duration"` with the radios `24 hours`, `7 days` and `30 days`
- `group "Levels shown"` with the checkboxes `Critical`, `High`, `Moderate` and `Low`
- `button "Grant access"` and `button "Cancel"`

After a successful grant, the dialog shows `Temporary password: <password>` and `button "Done"`.

**Preview and affected tables.**
- `table "Preview levels"` has the columns Company, Data kind (the `<kind label>`) and Level (the level label). It has one row per holding, in ledger order.
- `table "Affected holdings"` has the same columns, with one row per affected holding in ledger order.

### Interactions (DP-10, DP-17, DP-19, DP-21, DP-30, DP-33, DP-35, DP-40, DP-44, DP-45, DP-47, DP-48, DP-63, DP-66, DP-68, DP-72, DP-73, DP-74, DP-78, DP-81, DP-84, DP-85)

**Filtering**
- Typing in the search box updates results after a pause of no more than 300 milliseconds. A select change updates them at once.
- The rows, the option counts and `status "Results"` change in place. There is no submit button and the page does not reload.
- Only the answer to the most recent input is ever shown (Latest input wins, in Feedback states).

**Filters in the address**
- `/vault` and `/shared` mirror the filters in the query string as `q`, `company`, `data_kind` and `level`.
- Keys appear in that order, with standard percent-encoding. Empty values are left out, so with no filters the address is bare `/vault` or `/shared`.
- Typing in the search box replaces the current history entry. Each select change adds a new history entry.
- Back and Forward restore the search box, the selects, the rows, the option counts and `status "Results"` in place, with no reload.
- Opening a filtered address shows the filtered rows on first paint. Its first holdings request already carries the filters.
- These values in the address are dropped, the address is rewritten with the history entry replaced, and the filter is treated as `All` or empty:
  - a `data_kind` that is not a published code
  - a `level` that is not a published level
  - a `q` longer than 100 characters
- A `company` value is kept as given. If nothing matches, the empty state shows.

**Live refresh**
- Every owner screen and the contact screen holds one live stream (see API).
- When a change event arrives, the screen fetches fresh data and redraws in place within two seconds of the commit, with no reload. This includes changes made in another tab.
- Redraws follow the unsaved-input rules in Feedback states.
- An open Edit dialog keeps the version it was opened with.

**Dialogs** (`Add holding`, `Edit holding`, `Add rule`, `Edit rule`, `Grant access`, and the alert dialogs)
- Opening a dialog moves focus to its first field. In an alert dialog, focus goes to the safe button (`Keep`).
- Tab on the last control wraps to the first. Shift+Tab on the first wraps to the last.
- Escape closes the dialog without saving. However a dialog closes, focus returns to the control that opened it.
- A successful save closes the dialog, and focus returns the same way.
- On a field error the dialog stays open and focus moves to the error summary.
- On a stale edit the dialog stays open with the owner's entries kept.

**Phone menu**
- `button "Menu"` opens and closes the navigation and reports whether it is expanded.
- Escape closes the open menu and returns focus to `button "Menu"`. Following a link closes it.

**Next steps (owner)**
- The list is a single Tab stop. Tab lands on the first open step, or on the first step if none are open.
- Up and Down move between steps without wrapping. Home and End jump to the first and last step.
- Space or Enter toggles the focused step. On touch, a tap toggles it.
- The step-toggle rules in Feedback states decide what follows.

**Rule reorder by pointer or touch**
- Pressing a move handle and dragging lifts the rule. As it passes other rules, the list shows the gap where it would land.
- During the drag, the Preview asks the server for the levels and score of that order, at most once every 150 milliseconds. Changed levels switch in place, and the projected score updates.
- Live redraws of the Rules screen wait until the drag ends.
- Releasing the rule saves the order. Pressing Escape, or releasing outside the list, puts the rule back, and the Preview shows the saved levels.

**Rule reorder by keyboard**
- Focus a move handle and press Space to pick the rule up.
- Up and Down move it one place at a time, and the Preview updates as it does during a drag.
- Space or Enter drops the rule and saves. Escape cancels and returns it to where it started.
- A live `rule.*` event during a pick-up cancels the pick-up before the redraw. The cancel is announced, and no order is saved.
- Focus stays on the moved rule's handle throughout, and after any save, refusal or cancel. Each step is announced in `status "Rule order"`.

**Logging a breach**
- `button "Log breach"` opens `form "Log breach"` with focus in `combobox "Company"`. `textbox "Announced on"` starts at the server's date for today.
- **Suggestions.** Typing in `combobox "Company"`, or pressing ArrowDown in it, opens `listbox "Company suggestions"`.
  - The list holds up to 8 of the vault's companies, using each group's spelling, that contain the typed text case-insensitively. They are sorted A to Z. With empty text, it holds the first 8 companies A to Z.
  - ArrowDown and ArrowUp move the active option while focus stays in the combobox.
  - Enter picks the active option, closes the list and requests a preview. It never submits the form. A click or tap on an option picks it the same way.
  - The first Escape closes the list and keeps focus in the combobox. A further Escape closes the form.
  - The list opens in front of every other layer. It is never cut off by the exposure column and never covered by the pinned score band. Every option, once scrolled into view, is the topmost element at its own centre.
- **Preview requests.** Each tick or untick asks the server for a preview. So does a company change, after a pause of no more than 250 milliseconds.
- **Showing the preview.** Each preview updates the touched rows and the numeral as described in Motion and effects, and writes the line in `status "Breach preview"`.
- **Saving.** Each opening of the form creates a new Idempotency-Key, which Save sends. A double-clicked Save therefore logs one breach.
- **Cancelling.** Cancel or Escape closes the form, clears the lit rows in reverse order and returns the numeral to the committed score. Focus returns to `button "Log breach"`.

**Breach detail**
- Ticking kinds shows the server's projected score beside `button "Save kinds"`. Rows do not light here.
- `button "Save kinds"` sends the ticks together with the version the page loaded.

**Deleting and removing**
- `button "Delete holding"` opens `alertdialog "Delete holding?"`.
  - `Delete` turns disabled as soon as it is pressed and stays disabled while its request is in flight. A double click therefore sends one request.
  - On success, the ledger opens at `/vault` with focus on `button "Add holding"`.
  - `Keep` closes the dialog.
- `button "Remove breach"` works the same way and returns to `/vault/breaches`.
- `button "Save holding"` is disabled while its write is in flight, so a double click sends one request.

**Grant panel**
- After a successful grant, the dialog shows the temporary password, and `button "Done"` takes focus. Closing the dialog clears the password from the page for good.
- While `dialog "Grant access"` is open, neither the 15-second grant refresh nor any live event closes it. They also never clear the typed name, the email, the chosen duration, the ticked levels or the focused control, and never hide a shown temporary password before `button "Done"` is pressed. This includes the app's own `grant.created` event.
- To narrow, the owner unticks levels and chooses `button "Narrow scope"`. `button "Revoke access"` asks for confirmation in `alertdialog "Revoke access?"` first.

**Contact screen**
- There are no write controls.
- On `view.changed` or `grant.updated` it fetches fresh data.
- On `access-ended`, or on any access-ended answer, it replaces the whole view with the Access ended screen within two seconds, without a reload. After that, a later 401 does not navigate away.
- A 401 that arrives before any `access-ended`, for example after the owner changed their password, opens `/`.

**Remaining time**
- The owner panel and the contact's `status "Access time"` show the server's `remaining_seconds` and `status`. They fetch both again every 15 seconds and after every live event.
- The device clock may be wrong, so neither screen counts down or works out expiry on its own. The shown value changes only when a server answer arrives.

**Owner session ending mid-work**
- **Saves.** These saves follow the draft rule in Feedback states when they answer 401:
  - from `form "Log breach"`
  - from `dialog "Add holding"` and `dialog "Edit holding"`
  - from breach detail's `button "Save kinds"`
- **Other actions.** Any other action the owner takes (a step toggle, a delete, a reorder) that answers 401 opens `/auth/login?next=<current path and query>`.
- **Background requests.** These leave the screen exactly as it is when they answer 401: live-event refetches, polls, previews and stream reconnects. The screen then stops reconnecting its stream.

**Sign out.** `button "Sign out"` ends the session, discards any stored draft and opens `/`.

### Visual design (DP-57, DP-58, DP-59)

**Mood.** Guarded, exact and calm, like the inside of a safe with a ledger open on the shelf.

**Colour roles**
- **Ground and text.** The ground is a near-black with a faint cold green-grey cast. Text is a warm parchment off-white.
- **Amber accent.** One amber accent is kept for exposure only: the score numeral, the touched-row edge and the band name. It is used nowhere else.
- **Sea-green.** A muted sea-green marks done steps and the "Clear" band.
- **Coral red.** A coral red marks Critical badges, the delete and remove buttons, and errors.
- **Other level badges.** High, Moderate and Low badges use the parchment ink at decreasing strength.
- **Level words.** Every badge also carries its level word, so colour is never the only signal.

**Type**
- Headings and the wordmark use Space Grotesk.
- Body text and controls use IBM Plex Sans.
- Values, points and every number, including the score, use IBM Plex Mono with equal-width figures, so columns line up.
- Each heading step is about one fifth larger than the step below it.
- The score numeral is about four times the body size.

**Composition**
- **The ledger.** Ruled rows with thin hairlines between them and a slightly stronger rule under each company heading. Rows have generous room (comfortable density).
- **The exposure column.** A tall, quiet panel set apart by a thin vertical rule. The numeral is at the top and the steps are below it.

**Controls and focus**
- Every button, checkbox row, list link, select, suggestion option and step is at least 44 by 44 pixels.
- Focus shows as a clearly visible parchment outline around the control.

**Contrast.** All text and control edges meet WCAG 2.2 AA against the dark ground. This includes amber and coral text.

### Motion and effects (DP-21, DP-22, DP-58, DP-63)

**Meaning of motion**
- **Dialogs and panels.** Dialogs, the breach form and the suggestions list enter by fading in and rising slightly, in about a sixth of a second, and leave in the same time. They ease out quickly and settle softly.
- **Hover.** Hovering a ledger row lifts its background a shade.
- **Press.** Pressing a button darkens it for the length of the press.
- **Completing a step.** A step toggled done fades its text to the done style in about a sixth of a second.

**Blast preview (the signature).** For each tick or untick:
1. **The server answers.** It returns the affected holding ids in ledger order and the projected score. A preview for anything other than the latest ticks and company is thrown away. It never lights a row or moves the numeral.
2. **Rows light up.** Rows newly joining the touched set light one after another in ledger order. Each gets an amber edge on its leading side.
   - Each row starts about one twenty-fifth of a second after the one before, and each light takes about a sixth of a second.
   - From the 12th newly touched row on, all remaining rows light together with the 12th.
   - As each row lights, it gains the word `Touched` in its accessible text.
3. **The numeral counts.** At the same time, the score numeral counts in whole numbers from the value it shows to the projected score.
   - The count takes a little under half a second (about 420 milliseconds) and ends exactly on the projected value.
   - While a preview is on screen, a small `Preview` tag sits next to the numeral.
4. **Rows clear.** Rows leaving the touched set lose their edge one by one in reverse ledger order, with the same spacing, and the numeral counts back down.
5. **A new preview arrives.** If one arrives during a count, the count restarts from whatever value is showing.
6. **Saving.** Saving clears the `Preview` tag, and the numeral shows the committed score.
   - If the committed score equals the preview, nothing moves.
   - If it does not, the DP-23 alert appears and the numeral changes straight to the committed value.

**Other score changes.** Step toggles the server confirms, deletions and rule changes count the numeral to the new value over the same little-under-half-a-second.

**No other motion.**
- Nothing on any screen loops, pulses or moves on its own.
- There are no decorative animations, no idle spinners and no background effects.

**Reduced motion.** When the system asks for reduced motion, nothing fades, rises, counts or staggers.
- Touched rows show a still amber edge and a visible `Touched` label at once.
- The numeral changes straight to the final value, which is announced politely (preview copy in Feedback states).
- Dialogs, the form and the suggestions list appear and disappear at once.
- Everything ends in the same final state as with full motion.

### Feedback states (DP-03, DP-10, DP-22, DP-23, DP-29, DP-34, DP-44, DP-45, DP-46, DP-48, DP-50, DP-51, DP-53, DP-63, DP-64, DP-66, DP-68, DP-71, DP-74, DP-78, DP-81)

All announcements are polite (`status`), except the alerts named below.

**Placeholders**
- `<score>` is the exposure score as a whole number with no separators.
- `<n>` is a count.
- `<p>` is a rule's position, counting from 1.
- `<total>` is the number of rules.
- `<contact name>` is the grant's contact name.
- `<remaining>` is the server's `remaining_seconds`, rounded down in each unit and written as:
  - `<d>d <h>h` when it is at least 86,400 seconds
  - `<h>h <m>m` when it is at least 3,600 seconds
  - `<m>m <s>s` otherwise

**Pending.** While a write is in flight, its button is disabled and reads `Working...`.

**Failed request.** A request that fails without an error body (a network failure or a 500) shows an `alert` reading `Something went wrong. Your change was not saved.` and leaves the form filled in.

**Field errors.**
- Each field error shows under its field, using the API's message.
- An `alert` error summary headed `Check these fields` lists one link per field error. Following a link focuses that field.

**Stale edits.** A 409 `stale_version` shows the API's `stale_version` message in an `alert`.
- In `dialog "Edit holding"` and `dialog "Edit rule"`:
  - The dialog stays open with every entry kept.
  - Focus moves to the alert.
- On breach detail:
  - The ticks are replaced by the server's current kinds.
  - The page takes the server's current version.
  - The projected score is cleared.

**Latest input wins.** Each of the following shows only the server's answer to the most recent input:
- the ledger rows, the filter option counts and `status "Results"`
- the breach form's lit rows, its numeral and `status "Breach preview"`
- the projected score on breach detail
- `table "Preview levels"` and its projected score on Rules

Input means search text, filters, ticks, company text or rule order. An answer for older input is discarded unseen, even when it arrives after the newer one. It never repaints those regions, even briefly. The final keystroke is never dropped.

**Unsaved input survives redraws.** A live event, the 30-second status check or the 15-second grant refresh may redraw a screen.
- **Log breach form.** While `form "Log breach"` is open, a redraw leaves these unchanged:
  - the typed company and date
  - an open suggestions list
  - the ticks
  - the focused control
  - the lit rows
  - the `Preview` tag
  - the form's Idempotency-Key

  The screen then asks for the preview again against the new vault state, and the lit rows and numeral follow that answer.
- **Breach detail.** A redraw renews `table "Affected holdings"`, `list "Steps for this breach"` and the score. It keeps the unsaved ticks and the focused control, and asks for a fresh projected score for those ticks. A `breach.updated` for this breach from another window never overwrites the ticks. Saving afterwards follows the stale-edit rule above.
- **Grant dialog.** Covered by the Grant panel rule in Interactions.

**Step toggles.**
- **On Space, Enter or tap.** The step's checkbox flips at once and the step shows `Working...`. The numeral does not change yet.
- **While a toggle is in flight.** A second toggle of the same step sends nothing.
- **On 200.** The numeral counts to the server's score, and the step announcement fires. When reopening step 1 also reopened step 2, both show open.
- **On 409 `step_already_done` or `step_already_open`.**
  - The step shows the server's state, and the numeral shows the server's score from a fresh read.
  - An `alert` reads `This step was already changed in another window.`
- **On 409 `step_out_of_order`.**
  - The checkbox returns to open and the score stays unchanged.
  - An `alert` shows the API's `step_out_of_order` message.
- **On a network failure or a 500.**
  - The checkbox returns to its previous state and the score stays unchanged.
  - The failed-request alert shows.
- **Focus.** In every outcome, focus stays on the same step.

**Rule reorder.** `status "Rule order"` announces:
- `Picked up <rule label>. Position <p> of <total>.`
- on each move: `Position <p> of <total>.`
- on drop: `Dropped <rule label>. Position <p> of <total>.`
- on cancel: `Move cancelled.`

When a save answers 422 `rule_ids` (a rule added, or deleted, in another window, or any unknown id) or fails without an error body:
- The list refetches and shows the server's order, including any new rule.
- `table "Preview levels"` and the projected score return to the saved grading.
- An `alert` reads `The rules changed in another window. The order was not saved.`
- Focus stays on the moved rule's handle.

**Draft after an expired session.** This applies when a covered save (see "Owner session ending mid-work" in Interactions) answers 401.
- **Storing the draft.** The screen stores a draft in this tab's session storage. The draft holds:
  - the field values and ticks
  - the Idempotency-Key
  - the loaded version
  - the screen path and query
  - the signed-in email
- **Signing in again.** The screen then opens `/auth/login?next=<current path and query>`. The realm may skip its own page while its own session lasts.
- **Restoring.** When sign-in returns to that path, the same form or dialog reopens with the draft restored.
  - Focus is on its save button.
  - `status "Draft restored"` reads `Your session ended. Your unsaved entries were kept; check them and save again.`
  - Nothing is saved automatically.
  - A later save sends the original Idempotency-Key and version. A change made in between therefore meets the stale-edit rule.
- **Discarding.** The draft is used once. It is discarded without restoring when `GET /api/me` reports a different email, and on Sign out.

**Empty states**
- Ledger with no holdings: `Your ledger is empty. Add the first company that holds your data.`
- Filters that match nothing: `No holdings match these filters.`
- No next steps: `Nothing to do. No logged breach touches your holdings.`
- Breaches screen with none: `No breaches logged.`
- Trusted contact screen with no grant ever: `No trusted contact. Add one to share a read-only view while you are away.`
- Shared view with nothing in scope: `Nothing is shared with you yet.`

**`status "Results"`**, after each filter change and each Back or Forward: `Holdings shown: <n>.`

**`status "Exposure updates"`**
- `Holding saved. Exposure score <score>.` when a holding is added or edited
- `Holding deleted. Exposure score <score>.`
- `Rules updated. Exposure score <score>.` when a rule is saved or deleted
- `Rule order saved. Exposure score <score>.`
- `Breach logged. Holdings touched: <n>. Exposure score <score>.`
- `Breach updated. Exposure score <score>.` when breach kinds are saved
- `Breach removed. Exposure score <score>.`
- `Step marked done. Exposure score <score>.`
- `Step reopened. Exposure score <score>.`

**`status "Breach preview"`**, after each preview that is shown: `Preview: holdings touched <n>, projected score <score>.`

**Committed-score mismatch** (`alert`): `The saved score differs from the preview. Showing the saved score.`

**`status "Grant updates"`**
- `Access granted to <contact name>.`
- `Scope narrowed.`
- `Access ended for <contact name>.` This holds even during an identity outage, because Strongroom access ends at once.

**Remaining time**
- While the grant is active, the owner panel and `status "Access time"` read `Access ends in <remaining>`. The panel's status word is `Active`.
- After the grant has ended, the owner panel shows the word `Expired` or `Revoked` and no remaining-time line.

**`status "Shared updates"`** (contact)
- `Shared view updated.` on `view.changed`
- `The owner narrowed what you can see.` on `grant.updated`
- `Access ended.` on `access-ended`. The Access ended screen keeps this status.

**`status "Account updates"`**: `Password changed. Other sessions are signed out.`

**Pages**
- **Not found:** heading `Not found` and the text `This record does not exist or is not in your view.`
- **Sign-in failure:** heading `Sign-in failed` and the text `Sign-in could not be completed. Start again.`
- **Sign-in unavailable:** heading `Sign-in unavailable`, then the 503 message from API.
- **Access ended:** heading `Access ended` and the text `This shared view has ended. Ask the vault owner for a new grant.`

**Outage banner** (`alert`, at the top of every screen, including `/`): `Sign-in service unavailable. Your ledger still works; signing in, changing passwords and granting access are paused.`
- Screens read `GET /api/status` on load, every 30 seconds and after any 503.
- The banner shows while the status says `down` and goes once it says `ok`.

## Backend

### API (DP-02, DP-03, DP-06, DP-07, DP-08, DP-11, DP-12, DP-15, DP-16, DP-24, DP-25, DP-28, DP-32, DP-37, DP-39, DP-42, DP-44, DP-45, DP-49, DP-52, DP-53, DP-55, DP-61, DP-62, DP-64, DP-65, DP-67, DP-71, DP-79, DP-80, DP-82, DP-85)

**Formats**
- All `/api` bodies are JSON (`application/json; charset=utf-8`).
- Timestamps are UTC ISO 8601 with milliseconds and `Z`, for example `2026-11-02T09:15:00.000Z`.
- Dates are written `YYYY-MM-DD`.
- Ids are opaque strings.
- Levels are `critical`, `high`, `moderate` and `low`. The kind codes are in Business rules.

**Error body**
- Every error has the shape `{"error":{"code":"<code>","message":"<message>"}}`.
- Validation errors add `fields` inside `error`. No other key is ever added.
- Example: `{"error":{"code":"validation","message":"Check the highlighted fields.","fields":{"company":"Required."}}}`

| Status | code | message |
|---|---|---|
| 401 | `signed_out` | `Sign in to continue.` |
| 403 | `cross_origin` | `Request refused.` |
| 403 | `access_ended` | `This shared view has ended.` |
| 403 | `owner_only` | `Only the vault owner can do this.` |
| 404 | `not_found` | `Not found.` |
| 409 | `holding_exists` | `This company already holds that data kind in your ledger.` |
| 409 | `rule_limit` | `A vault holds at most 50 rules.` |
| 409 | `stale_version` | `This record changed in another window. Reload it and try again.` |
| 409 | `step_already_done` | `This step is already done.` |
| 409 | `step_already_open` | `This step is already open.` |
| 409 | `step_out_of_order` | `Finish the step before this one first.` |
| 409 | `grant_active` | `A trusted contact already has access. Revoke it first.` |
| 409 | `no_active_grant` | `There is no active grant.` |
| 409 | `idempotency_conflict` | `This Idempotency-Key was used with a different request.` |
| 413 | `too_large` | `Request body is too large.` |
| 415 | `unsupported_media_type` | `Send JSON.` |
| 422 | `validation` | `Check the highlighted fields.` |
| 500 | `internal` | `Something went wrong.` |
| 503 | `identity_unavailable` | `Sign-in service unavailable. Try again in a few minutes.` |

**Field messages** (inside `fields`)

| Message | When |
|---|---|
| `Required.` | missing or blank |
| `Too long.` | over the field's limit |
| `Choose a data kind from the list.` | unknown kind |
| `Choose a level from the list.` | unknown level |
| `Use a date in the form YYYY-MM-DD.` | malformed date |
| `Date cannot be in the future.` | the date is after the database's current date |
| `Tick at least one data kind.` | kinds empty or missing |
| `Each data kind can appear once.` | a kind is repeated |
| `Priority must be a whole number from 1 to 999.` | bad priority |
| `List every rule exactly once.` | the order list is missing a current rule, repeats one, or contains an id that is not one of the vault's current rules |
| `Send the version you loaded.` | `version` missing on a PATCH, or not a whole number of 1 or more |
| `Enter an email address.` | malformed email |
| `This email cannot be used for a trusted contact.` | the email belongs to a realm account other than this vault's past contacts |
| `Choose 24h, 7d or 30d.` | bad duration |
| `Choose at least one level.` | levels empty |
| `Scope can only be narrowed. Revoke and grant again to widen it.` | the change would widen the scope |
| `This field cannot be set.` | any key outside the route's editable keys |
| `Current password is incorrect.` | wrong current password |
| `Use 12 to 128 characters.` | bad new password length |
| `New password must differ from the current one.` | the new password equals the current one |

**Error precedence** (one rule for the whole API). Checks run in this order:
1. Boundary checks: `413`, `415` and `403 cross_origin` (see Server boundary).
2. `401 signed_out`. This includes an idle-expired session.
3. `403 access_ended`, for a contact whose grant has ended.
4. `404 not_found`, for any path id or body id outside the caller's view. It is identical to the answer for an id that never existed. Two exceptions:
   - The `rule_ids` entries on `/api/rules/order` and `/api/rules/preview` are never looked up at this step. An entry that is not one of the owner's current rules (deleted in another window, unknown, or from another vault) answers 422 `rule_ids` at step 9, with the same body in every case.
   - On the owner-only routes with body ids (`/api/rules/order`, `/api/rules/preview`, `/api/breaches/preview`), a contact skips this step and gets step 5, and the body ids are not looked up.
5. `403 owner_only`.
6. Idempotent replay, which returns the stored response.
7. `409` state conflicts, including `stale_version`. For steps, `step_already_done` is checked before `step_out_of_order`. A stale `version` wins over any 422 problem in the same body. A missing or malformed `version` is a 422.
8. `503 identity_unavailable`, on `POST /api/grant` and `POST /api/account/password` while the realm is unreachable, even when the body is also invalid.
9. `422 validation`.

The rows below list only their own extra errors.

**Sign-in routes** (HTML redirects, not JSON)

| Method and path | Behaviour |
|---|---|
| `GET /auth/login?next=` | `next` is optional. Answers 302 to the realm's authorization endpoint. That URL carries a fresh state, a nonce, a PKCE S256 challenge and `redirect_uri` exactly `<origin>/auth/callback`. Stores a pending sign-in row in Postgres holding the state, the nonce, the verifier and the raw `next`. Sets only the cookie `strongroom_signin`, holding a random pending id. `next` never appears in a cookie or in the realm URL. If the realm is unreachable, answers with the 503 sign-in unavailable page. |
| `GET /auth/callback?code&state` | **Success:** answers 303 to the return target (Business rules), sets `strongroom_session` and consumes the pending sign-in. **Failure:** a missing, unknown, reused, expired or other-browser state, or a failed code exchange, gets the 400 sign-in failure page and no session cookie. **Realm unreachable:** the 503 sign-in unavailable page. |
| `POST /auth/logout` | 204. Ends this session and clears its cookie. |

**JSON routes.** "Any" means owner or contact. Contacts see only their scope.

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | | 200 `{"status":"ok"}` | |
| `GET /api/status` | anyone | | 200 `{"identity":"ok"}` or `{"identity":"down"}` | |
| `GET /api/me` | any | | 200 `{"role":"owner"\|"contact","name":str,"email":str}` | |
| `GET /api/kinds` | any | | 200 `{"kinds":[{"code","label","steps":[str,str]}],"levels":[{"code","label","weight"}]}`, in published order | |
| `GET /api/holdings?q=&company=&data_kind=&level=` | any | all optional | 200 `{"items":[holding],"total":int,"facets":{"company":{name:int},"data_kind":{code:int},"level":{code:int}},"exposure":{"score":int,"band":str}}` | 422 when `q` is over 100 characters, or the kind or level is unknown |
| `POST /api/holdings` | owner | `{"company","data_kind","value","notes"?}` | 201 `{"holding":holding,"exposure":exposure}` | 409 `holding_exists` |
| `GET /api/holdings/{id}` | any | | 200 `{"holding":holding}` | |
| `PATCH /api/holdings/{id}` | owner | `{"version"}` plus any of `company`, `data_kind`, `value`, `notes` | 200 `{"holding","exposure"}` | 409 `stale_version`, 409 `holding_exists` |
| `DELETE /api/holdings/{id}` | owner | | 204 | |
| `GET /api/rules` | owner | | 200 `{"rules":[rule]}`, in rule order | |
| `POST /api/rules` | owner | `{"data_kind","company_contains"?,"level","priority"?}` | 201 `{"rule","exposure"}`. `priority` defaults to one more than the highest. | 409 `rule_limit` |
| `PATCH /api/rules/{id}` | owner | `{"version"}` plus any of `data_kind`, `company_contains`, `level`, `priority` | 200 `{"rule","exposure"}` | 409 `stale_version` |
| `DELETE /api/rules/{id}` | owner | | 204 | |
| `PUT /api/rules/order` | owner | `{"rule_ids":[id]}` | 200 `{"rules","exposure"}`. Priorities become 1 to n in list order. | 422 `rule_ids` |
| `POST /api/rules/preview` | owner | `{"rule_ids":[id]}` | 200 `{"levels":[{"holding_id","level"}],"score":int}`, in ledger order. Nothing is stored. | 422 `rule_ids` |
| `GET /api/breaches` | any | | 200 `{"breaches":[breach]}`, newest `announced_on` first, then newest created | |
| `POST /api/breaches` | owner | `{"company","announced_on","data_kinds":[code]}`, with an optional header `Idempotency-Key` of 1 to 100 characters | 201 `{"breach","exposure"}` | 409 `idempotency_conflict` |
| `POST /api/breaches/preview` | owner | `{"company","data_kinds":[code],"breach_id"?}`. An empty company or empty kinds are allowed. | 200 `{"affected_holding_ids":[id],"current_score":int,"score":int}`. Nothing is stored. | |
| `GET /api/breaches/{id}` | any | | 200 `{"breach","holdings":[holding],"steps":[step]}` | |
| `PATCH /api/breaches/{id}` | owner | `{"version","data_kinds":[code]}` | 200 `{"breach","exposure"}` | 409 `stale_version` |
| `DELETE /api/breaches/{id}` | owner | | 204 | |
| `GET /api/exposure` | any | | 200 exposure | |
| `POST /api/steps/{id}/done` | owner | none or `{}` | 200 `{"step","exposure"}` | 409 `step_already_done`, 409 `step_out_of_order` |
| `POST /api/steps/{id}/reopen` | owner | none or `{}` | 200 `{"step","exposure"}` | 409 `step_already_open` |
| `GET /api/grant` | owner | | 200 `{"grant":grant}` (the most recent) or `{"grant":null}` | |
| `POST /api/grant` | owner | `{"contact_name","contact_email","duration":"24h"\|"7d"\|"30d","levels":[level]}` | 201 `{"grant","temporary_password"}` | 409 `grant_active`, 503 `identity_unavailable` |
| `PATCH /api/grant` | owner | `{"levels":[level]}` | 200 `{"grant"}` | 409 `no_active_grant` |
| `DELETE /api/grant` | owner | | 200 `{"grant"}` with status `revoked` | 409 `no_active_grant` |
| `GET /api/contact/grant` | contact, also after the grant has ended | | 200 contact-grant | owners get 404 |
| `POST /api/account/password` | owner | `{"current_password","new_password"}` | 200 `{"status":"changed"}` | 503 `identity_unavailable` |
| `GET /api/events` | any | | 200 `text/event-stream` (Business rules) | |

**Contacts on owner routes**
- Contacts get `403 owner_only` on every write route.
- They also get it on `/api/rules`, `/api/rules/order`, `/api/rules/preview`, `/api/breaches/preview`, `/api/grant` and `/api/account/password`.
- A rule id is never in a contact's view, so `/api/rules/{id}` answers 404 to a contact.
- On other write routes with a path id:
  - an id outside the contact's scope answers 404
  - an id inside it answers 403 `owner_only`

**Object shapes for owners.** Owners get exactly these keys.
- **holding:** `id`, `company`, `data_kind`, `value`, `notes`, `level`, `rule_id` (null when no rule matched), `affected`, `version`, `created_at`, `updated_at`
- **rule:** `id`, `priority`, `data_kind` (a code or `any`), `company_contains`, `level`, `label`, `version`
- **breach:** `id`, `company`, `announced_on`, `data_kinds`, `affected_holding_ids`, `version`, `created_at`
- **step:** `id`, `holding_id`, `company`, `data_kind`, `level`, `number` (1 or 2), `text`, `status` (`open` or `done`), `points`
- **exposure:** `score`, `band`, `affected_count`, `open_steps`, `steps` (an array of step)
- **grant:** `id`, `status` (`active`, `expired` or `revoked`), `contact_name`, `contact_email`, `duration`, `levels`, `created_at`, `ends_at`, `remaining_seconds`

**Object shapes for contacts.** Contacts get exactly these keys and no others. In particular they never get `version`.
- **holding:** `id`, `company`, `data_kind`, `level`, `value` (masked as in Business rules), `affected`
- **breach:** `id`, `company`, `announced_on`, `data_kinds`, `affected_holding_ids`
- **step, exposure, me:** the same keys as owners get
- **contact-grant:** `status`, `ends_at`, `remaining_seconds`, `levels`, `owner_name`

**Editable keys**

| Write | Editable keys |
|---|---|
| holding POST | `company`, `data_kind`, `value`, `notes` |
| holding PATCH | `company`, `data_kind`, `value`, `notes`, plus the required precondition key `version` |
| rule POST | `data_kind`, `company_contains`, `level`, `priority` |
| rule PATCH | `data_kind`, `company_contains`, `level`, `priority`, plus `version` |
| breach POST | `company`, `announced_on`, `data_kinds` |
| breach PATCH | `data_kinds`, plus `version` |
| grant POST | `contact_name`, `contact_email`, `duration`, `levels` |
| grant PATCH | `levels` |
| password | `current_password`, `new_password` |

- `version` is a precondition. It is never stored from the request.
- Any other key answers 422 with `This field cannot be set.` on each such key, and changes nothing.
- Examples of such keys: `id`, a holding's `level`, `rule_id`, `affected`, `score`, `vault_id`, `owner`, `status`, `ends_at`, `created_at`, `version` on a POST, and `contact_email` on a PATCH.

**Field limits.** Text is trimmed first. Inside `company`, each run of whitespace becomes one space. Every limit includes its end values.
- `company`: 1 to 80 characters
- `value`: 1 to 120 characters
- `notes`: 0 to 500 characters, default empty
- `company_contains`: 0 to 60 characters; empty means any company
- `priority`: a whole number from 1 to 999
- `contact_name`: 1 to 80 characters
- `contact_email`: up to 254 characters, stored lower-case
- `new_password`: 12 to 128 characters

### Business rules (DP-04, DP-14, DP-18, DP-25, DP-27, DP-28, DP-31, DP-32, DP-36, DP-37, DP-39, DP-42, DP-43, DP-44, DP-45, DP-46, DP-48, DP-49, DP-52, DP-61, DP-62, DP-64, DP-65, DP-67, DP-69, DP-70, DP-71, DP-75, DP-77, DP-79, DP-80, DP-82, DP-85)

**Data kinds and recovery steps.** The published kind order, labels and two ordered steps per kind. Step text is shown verbatim.

| Code | `<kind label>` | Step 1 | Step 2 |
|---|---|---|---|
| `passport` | Passport | Report the passport to the issuing office as compromised | Apply for a replacement passport |
| `national_id` | National ID | Report the ID number to the issuing authority | Place a fraud alert with a credit bureau |
| `driving_licence` | Driving licence | Ask the licensing office to flag the licence number | Request a replacement licence |
| `bank_account` | Bank account | Call the bank fraud line about this account | Turn on alerts for every transaction |
| `payment_card` | Payment card | Freeze the card in the issuer app | Order a replacement card with a new number |
| `health_record` | Health record | Ask the provider who accessed your record | Check insurer statements for care you did not receive |
| `tax_id` | Tax ID | File an identity theft report with the tax office | Freeze your credit with each credit bureau |
| `password` | Password | Change the password at this company | Change it anywhere you reused it |
| `date_of_birth` | Date of birth | Add a spoken passphrase to key accounts | Treat messages that quote your birth date with suspicion |
| `home_address` | Home address | Check for mail redirection you did not request | Check your credit file for new accounts at this address |
| `phone` | Phone number | Ask your carrier for a port-out lock | Treat calls that mention this breach with suspicion |
| `email` | Email address | Change the email account password | Turn on two-step sign-in for the email account |

**Person-level and holding-level steps.**
- Three steps are person-level, because credit bureaus and passphrases apply to the person, not to one company:
  - `Place a fraud alert with a credit bureau` (National ID, step 2)
  - `Freeze your credit with each credit bureau` (Tax ID, step 2)
  - `Add a spoken passphrase to key accounts` (Date of birth, step 1)
- Every other step is holding-level.

**Levels**, from strictest to least strict:

| Level | Label | Weight | Points per step |
|---|---|---|---|
| `critical` | Critical | 40 | 20 |
| `high` | High | 20 | 10 |
| `moderate` | Moderate | 8 | 4 |
| `low` | Low | 2 | 1 |

**Company matching.**
- Companies compare case-insensitively after trimming and collapsing whitespace.
- This comparison applies to duplicate checks, ledger groups, facets, suggestions and breach matching.
- A group's heading and its facet key use the spelling of the group's earliest-created holding.

**Ledger order.** Companies run A to Z, case-insensitively. Within a company, holdings follow the published kind order.

**Holding uniqueness.**
- A vault holds at most one holding per matched company and data kind. This holds even when writes arrive at the same moment.
- Of N simultaneous `POST /api/holdings` that differ only in company spelling, exactly one answers 201 and the rest answer 409 `holding_exists`. For example, `Acme  Bank`, `acme bank` and ` ACME Bank ` differ only in spelling.
- A PATCH that renames into a collision, racing a POST of the same pair, also has exactly one winner.
- Only the winner sends a notification.

**Record versions.**
- Holdings, rules and breaches have a `version` that starts at 1.
- Each committed write to the record's own stored fields raises it by exactly 1:
  - a holding PATCH
  - a rule PATCH
  - a breach PATCH
  - a reorder, for each rule whose priority changed
- Derived changes (level, affected status, steps) never change it.
- A PATCH whose `version` is not current answers 409 `stale_version` and changes nothing.
- Of two simultaneous PATCHes with the same current version, exactly one answers 200 and the other answers 409 `stale_version`. The stored record matches the winner.

**Grading.**
- **When a rule matches.** A rule matches a holding when both of these hold:
  - its `data_kind` is the holding's kind or `any`
  - its `company_contains` is empty or appears case-insensitively in the holding's company
- **Level.** The level comes from the matching rules with the lowest priority number. Among those, the strictest level wins.
- **`rule_id`.** It names the deciding rule. When several tied rules give the same level, it is the earliest created of them.
- **No match.** When no rule matches, the level is Low and `rule_id` is null.
- **One place.** Grading runs on the server in one place, for:
  - stored levels
  - the rule preview
  - every list
  - the contact view
  - the score

  The preview for an order therefore equals the stored grading after that order is saved.

**Rules.**
- **Labels.** `<rule label>` is built from three parts:
  - the kind label, or `Any kind`
  - then ` at <company_contains>`, when that is not empty
  - then ` is <Level label>`

  For example, `Passport is Critical` and `Any kind at clinic is Critical`.
- **Rule order.** Rules are ordered by priority, then by strictest level, then by creation time.
- **Limit.** A vault holds at most 50 rules (50 is allowed). This holds under simultaneous adds: with 49 rules, of 5 simultaneous `POST /api/rules`, exactly one answers 201 and four answer 409 `rule_limit`.
- **Reorder.** `PUT /api/rules/order` must name every rule the vault has at the moment it is applied. A reorder built before a concurrent add answers 422 `rule_ids` and never saves an order that leaves out the new rule. A reorder or preview that names a rule deleted in another window, or an id that is not one of the vault's current rules, also answers 422 `rule_ids` (never 404) and saves nothing.
- **Deleting every rule.** Deleting every rule leaves every holding Low.

**Default rules.** Every new vault starts with these twelve rules, at priorities 1 to 12:
1. Passport is Critical
2. National ID is Critical
3. Tax ID is Critical
4. Health record is High
5. Bank account is High
6. Payment card is High
7. Driving licence is High
8. Password is High
9. Date of birth is Moderate
10. Home address is Moderate
11. Phone number is Low
12. Email address is Low

**One vault per account.**
- On first sign-in, an account is matched by email to a seeded vault or grant. After that it is matched by its realm user id.
- Any other account gets a new vault with the default rules and no holdings.
- When the same new account completes several callbacks at once, exactly one vault with exactly twelve rules results, and every one of its sessions sees the same vault and the same rule ids.
- A contact account never gets a vault of its own.

**Affected holdings.**
- A holding is affected while at least one breach in its vault has the same company and lists the holding's kind.
- A breach's `affected_holding_ids` are those holdings, in ledger order.
- Affected status is always worked out from current data. A new holding that matches an existing breach is affected as soon as it is saved.

**Next steps.**
- **Holding-level steps.**
  - Every affected holding has the holding-level steps of its kind, each at the holding's level.
  - A holding-level step keeps its id while its holding stays affected with the same kind.
  - Its done mark is cleared when its holding stops being affected (breach removed, kinds edited, holding edited or deleted) or changes kind.
- **Person-level steps.**
  - A vault has at most one step per person-level text. That step exists while at least one affected holding contributes it. A contributor is an affected holding whose kind lists that step.
  - Its `holding_id`, `company` and `data_kind` come from the first contributor in ledger order.
  - Its `number` is the step's number in that kind.
  - Its `level` is the strictest level among the contributors, and its `points` are that level's points per step.
  - Its id and done mark last while at least one contributor remains. Both clear when the last contributor stops being affected.
  - For a contact, only in-scope contributors count.
- **Ordering.** Steps are ordered by level (strictest first), then by the ledger position of `holding_id`, then by `number`.
- **Points.** A step's `points` are its level's points per step.
- **History.** Done marks keep no history.
- **Example.** With the seed data, Ada adds `Larchfield Clinic` / Date of birth. The clinic rule grades it Critical. She then logs a Larchfield Clinic breach with Date of birth ticked.
  - The blast preview and the committed score both read 84, up from 48.
  - The passphrase step stays a single step anchored to the Brightway Air Date of birth holding. It rises to Critical, 20 points.
  - Larchfield's `Treat messages that quote your birth date with suspicion` adds 20.
  - The step order becomes:
    1. Passport step 1
    2. Passport step 2
    3. the passphrase step
    4. the Larchfield Date of birth step 2
    5. the Brightway Air Date of birth step 2 (4 points)
  - Deleting the Larchfield Date of birth holding returns the score to 48. The passphrase step keeps its id and its done mark.

**Step state machine.**
- `open` to `done` by `POST .../done`, and `done` to `open` by `POST .../reopen`.
- Done on a done step answers 409 `step_already_done`. Reopen on an open step answers 409 `step_already_open`.
- **Order within a holding.** When both steps of a holding are holding-level, step 2 cannot be marked done while step 1 is open. That request answers 409 `step_out_of_order`.
- **Cascade.** Reopening step 1 while step 2 is done reopens both in the same transaction. That sends one `step.updated` per step. The response returns step 1, with exposure reflecting both steps.
- **Person-level steps.** These are never blocked and never cascade.
- **Simultaneous requests.** Of simultaneous identical requests, exactly one succeeds and the rest get the 409.

**Exposure score.**
- The score is the sum of the points of every open step.
- `affected_count` counts distinct affected holdings. `open_steps` counts open steps.
- Bands: `Clear` at 0, `Contained` from 1 to 39, `Exposed` from 40 to 99, `Severe` at 100 and above.
- A level change from a rule edit changes the points of existing steps and keeps their done marks.
- One server computation produces the score, band, affected list and step list. These all use it, so they agree for the same vault state:
  - the dashboard
  - breach detail
  - the holdings list
  - both previews
  - the contact view
- For a contact, the computation runs only over in-scope holdings.

**Breach preview.**
- The preview returns the holdings the given company and kinds would touch, and the score as if the breach existed.
- With `breach_id`, it scores as if that breach's kinds were replaced.
- Saving stores the same computation, so the committed score equals the preview unless the vault changed in between.
- The steps of a breach detail page are the vault's steps whose contributors include a holding that breach touches. A person-level step shows with its vault-wide id, level and points.

**Breach state machine.**
- A breach is logged by POST.
- Afterwards only `data_kinds` can change, through a versioned PATCH.
- It is removed by DELETE. After that, it answers 404 to every request, and its effects go in the same transaction.
- `announced_on` may not be after the database's current date.

**Idempotent breach logging.**
- `Idempotency-Key` is scoped to the vault and never expires.
- The same key with an identical body returns the stored 201 status and body and creates nothing. This holds even after that breach was removed.
- The same key with a different body answers 409 `idempotency_conflict`.
- Simultaneous requests with the same key create exactly one breach, and all of them answer with its 201 body.

**Holding deletion.**
- A delete happens in one transaction with the holding's done marks and every derived value.
- The holding then answers 404. It is gone from:
  - lists, search, facets and totals
  - the score
  - every breach's affected ids
  - the steps (a person-level step loses it as a contributor)
  - the contact's view
- A second DELETE of the same id answers 404 and sends nothing.

**Search and facets.**
- `q` is a case-insensitive substring match.
  - For owners it matches company, value, notes or kind label.
  - For contacts it matches company or kind label only.
- `company`, `data_kind` and `level` are exact filters. `company` follows company matching.
- `items` are in ledger order, and `total` is their count.
- Each facet counts the holdings that match `q` and every active filter except its own. Zero counts are left out.
- `exposure` is the caller's whole-scope score and band, whatever the filters.
- Every count comes only from the caller's vault, and for a contact only from their scope.

**Trusted contact scope.** A contact sees:
- the holdings whose current level is in the grant's `levels`
- those holdings' steps
- the breaches that touch at least one of them, with `affected_holding_ids` limited to them
- the score for that scope

**Scope checks.**
- Ids outside the scope answer 404.
- The grant and scope are read from the database again on every request and every live event. They are never kept in a token or a cookie.
- When a rule edit changes a holding's level, the holding moves into or out of the contact's view and mask at once. Their open stream gets `view.changed` within two seconds.
- **Example.** With the grant narrowed to Moderate and Low, editing `Any kind at clinic is Critical` to Moderate brings both Larchfield Clinic holdings into the contact's list, unmasked. Editing it to High removes them again, and the contact's GET for those ids then answers 404.

**Masking.** For a contact, the `value` of a Critical or High holding is masked on the server.
- Every letter and digit except the last four letters or digits becomes `*`. Spaces and punctuation stay as they are.
- A value with four or fewer letters and digits is fully replaced.
- Moderate and Low values show in full. Owners always see full values.
- For example, with the seed data at start:
  - `P 5520 4471 8` reaches Ines as `* **** *471 8`
  - `4929 1180 2231 6604` reaches her as `**** **** **** 6604`

**Grant state machine.** A grant moves from none to `active`, may be narrowed while active, and ends as `revoked` or `expired`.
- **Create (POST).** POST creates a grant only when none is active. Otherwise it answers 409 `grant_active`.
- **Narrow (PATCH).**
  - The new `levels` must be a non-empty subset of the current levels. An equal set is a 200 that changes nothing.
  - Adding any level is the widening 422.
- **Revoke (DELETE).** DELETE revokes the active grant.
- **No active grant.** PATCH or DELETE without an active grant answers 409 `no_active_grant`.
- **After it ends.** An ended grant never becomes active again. A new POST creates a new grant.
- **Simultaneous requests.**
  - Of simultaneous POSTs, exactly one gets 201 and the others get 409.
  - Of simultaneous DELETEs, exactly one gets 200 and the others get 409 `no_active_grant`. Exactly one `grant.updated` is sent, and the contact's stream gets exactly one `access-ended`.
  - A PATCH racing a DELETE either answers 200 and commits before the revoke, or answers 409 `no_active_grant`.
  - A revoked grant's `levels` never change again.

**Grant and realm together.**
- The grant row is won first. Only the winning request then creates or updates the contact's realm account.
- A losing request:
  - never creates a realm user
  - never sets a password
  - never resets a password
- Two simultaneous grants to different emails leave no realm user for the loser's email.
- Two grants to the vault's previous contact email keep that realm user's id. Only the winner's temporary password signs in.
- If the realm call fails after the row was won, the grant row is removed, no `grant.created` is sent, and the request answers 503 `identity_unavailable`.

**Grant time.**
- **Durations.** `24h`, `7d` and `30d` mean 24, 168 and 720 grant hours. A grant hour lasts `GRANT_HOUR_SECONDS` seconds (default 3600).
- **End instant.** At creation, the server sets `ends_at` to the database's current time plus the duration.
- **Status**, decided on every request by the database clock:
  - `revoked` once revoked
  - otherwise `expired` when the database time is at or after `ends_at` (the end instant counts as ended)
  - otherwise `active`
- **`remaining_seconds`.** The whole seconds from the database's current time to `ends_at`, rounded down. It is 0 unless the grant is active.
- **Requests after the end.** A contact without an active grant gets 403 `access_ended` on every route except `GET /api/me`, `GET /api/contact/grant` and `POST /auth/logout`. A request one or more seconds before `ends_at` succeeds.

**Contact accounts.**
- Granting creates a realm account for the contact email, or reuses that vault's previous contact account.
- It sets a new random temporary password of 16 letters and digits. That password appears only in the 201 response.
- An email already held by any other realm account answers 422 on `contact_email`.
- Revoking and narrowing end the contact's realm sessions.
- Revoking and expiry leave the account in the realm.

**Sessions.**
- **Creation and cookie.** A session exists only after a successful callback. It is a random id in the `strongroom_session` cookie (HttpOnly, SameSite=Lax, Path=/), backed by a row in Postgres. It is valid on any instance that shares the database.
- **Idle expiry.**
  - A session expires when the database time reaches `SESSION_IDLE_SECONDS` (default 1800) after its last activity.
  - Activity is any request with the session cookie except `GET /api/events`, `GET /api/status` and `GET /api/health`.
  - An expired session's next request answers 401. Its open stream closes by the next keep-alive.
- **Ending.** A session also ends at sign out, on a revoke (the contact's sessions) and on a password change.

**Pending sign-ins.**
- A pending sign-in is a Postgres row holding the state, nonce, PKCE verifier and `next`. It moves from started to consumed or expired.
- The browser holds only its random id, in the `strongroom_signin` cookie (HttpOnly, SameSite=Lax).
- A pending sign-in grants nothing. It is single-use and expires `SIGNIN_PENDING_SECONDS` (default 600) after it starts.
- The callback accepts a state only when it matches the pending row named by the same browser's cookie. It also checks the ID token's nonce.
- A contact who entered the temporary password but has not chosen a new one has no code, and so no session.

**Return after sign-in.** `next` is the `next` query value on `/auth/login`, after one standard percent-decode. On a successful callback, the return target is `next` exactly as stored when all of these hold:
- It starts with exactly one `/`, and its second character is neither `/` nor `\`.
- It contains no `\`, no control character (codes 0 to 31 and 127) and no whitespace.
- It is at most 512 characters long (512 is allowed).
- The part before any `?` is a screen route for the signer's role:
  - for an owner, `/vault` or a path starting with `/vault/`
  - for a contact, exactly `/shared`

Otherwise, including when `next` is missing, the target is the default landing: `/vault` for an owner and `/shared` for a contact. A safe `next` that names a record outside the caller's view still redirects there, and that page renders the 404 page.

**Password change.**
1. The server checks the current password with the realm.
2. It sets the new password in the realm, non-temporary.
3. In one step, it deletes every other app session of the owner and every app session of their contact, and ends every realm session of both accounts.

The session that made the change stays signed in.

**Revoke.**
- Revoking deletes the contact's app sessions in the same transaction and ends their realm sessions at once.
- If the realm is unreachable, the revoke still succeeds. The app then retries ending the realm sessions every 30 seconds until that works.

**Change events.**
- **When they are sent.** Every committed write sends exactly one database notification per directly written record, in the same transaction, on channel `strongroom_events`.
- **Payload.** Exactly `{"vault_id":"<vault id>","type":"<record>.<verb>","id":"<record id>"}`.
  - `<record>` is `holding`, `rule`, `breach`, `step` or `grant`.
  - `<verb>` is `created`, `updated` or `deleted`.
- **Which write sends what.**
  - A reorder sends one `rule.updated` per rule whose priority changed.
  - A step toggle sends `step.updated`, and a cascade reopen sends two.
  - A narrow or revoke sends `grant.updated`.
- **What sends nothing.** Derived effects send no notification of their own: levels, affected status, steps appearing or disappearing, and done marks cleared as a side effect. Expiry also writes no notification.
- **Example.** A double-confirmed holding delete sends one `holding.deleted`.

**Live streams.** `GET /api/events` relays notifications within two seconds.
- **Owners** receive their own vault's notifications as `event: change`, with data `{"type","id"}`.
- **Contacts** never receive record types or ids.
  - Each change in their vault arrives as `event: change` with data `{"type":"view.changed","id":null}`. This includes rule changes.
  - The exception is a narrow, which arrives as `{"type":"grant.updated","id":"<grant id>"}`.
- **Revoke.** The contact's stream receives exactly one `event: access-ended` with data `{}`, with no `view.changed` or `grant.updated` before it. Then the stream closes.
- **Expiry.**
  - Each contact stream is scheduled against `ends_at` by the database clock. It sends that single `access-ended` between the end instant and two seconds after it, then closes. It never waits for a keep-alive to notice expiry.
  - Narrowing does not move the schedule. A new grant gets its own schedule.
- **Keep-alive.** Every stream writes a comment line every 15 seconds.
- **Privacy.** No notification or event ever carries a value, note, name, email, level or masked field.
- **Release on disconnect.**
  - A stream holds server resources only while its client is connected.
  - When the client closes the stream, the server stops relaying and releases every database connection, listener and transaction the stream held. This happens within 20 seconds, detected at the latest by the next keep-alive write.
  - A stream the server closes itself releases the same way.
  - After 60 streams are opened and closed in a row, 20 seconds later the count of `strongroom` database sessions is at most 2 above its count before the first stream. No `strongroom` session stays `active` or `idle in transaction` without a request in flight.
  - A new stream or request is never refused or stalled because of earlier closed streams.

### Services (DP-38, DP-45, DP-52, DP-53, DP-60, DP-67, DP-79)

**Keycloak**
- **Connection details.**
  - The realm is `KEYCLOAK_REALM` at `KEYCLOAK_URL`, with issuer `AUTH_ISSUER_URL`.
  - The confidential client is `AUTH_CLIENT_ID` and `AUTH_CLIENT_SECRET`. Its service account also administers the realm.
- **Sign-in.**
  - Every person signs in on the realm's own page with the authorization code flow.
  - Self-registration stays as provided.
- **Contact accounts.** Granting creates or updates a realm user:
  - Username and email are the contact email in lower case.
  - The email is marked verified and the account is enabled.
  - The first name is the contact name.
  - The password credential is the temporary password, marked temporary, with the required action `UPDATE_PASSWORD`.
- **Ending sessions.** After a revoke, a narrow or an owner password change, the realm lists no sessions for the affected accounts.
- **Seeded accounts.** At start, and at most once every 30 seconds when `/auth/login` is requested, the app makes sure the seeded accounts exist. It creates any missing one with its seeded password and leaves existing ones untouched.
- **Realm unreachable.**
  - `GET /api/status` reports `down`. The app checks the realm at most once every 10 seconds.
  - The sign-in routes show the sign-in unavailable page with 503.
  - `POST /api/grant` and `POST /api/account/password` answer 503 `identity_unavailable` and store nothing.
  - Existing sessions keep reading and writing vault data, and narrowing works.
  - Revoking follows the retry rule in Business rules.
  - The outage banner shows.

**Postgres** (`DATABASE_URL`, a non-superuser database owner)
- It is the system of record for accounts, sessions, pending sign-ins, vaults, holdings, rules, record versions, breaches, done marks, idempotency keys and grants.
- It supplies the clock for:
  - grants and their scheduled `access-ended`
  - dates
  - session idle time
- It carries the change notifications.
- Every connection the app opens, whether pooled or listening, sets its application name to `strongroom`.
- The app creates its schema and seed at start, without error when they already exist. It keeps no application state anywhere else.

### Seed data (DP-01, DP-04, DP-41)

Every person, company and value below is invented. The seed is applied at start whenever the database has no vaults. Every seeded holding, rule and breach starts at `version` 1.

**Realm accounts**

| Email (also username) | Password | Name | Role |
|---|---|---|---|
| `ada.marsh@example.com` | `Strongroom-Owner-1` | Ada Marsh | owner of vault A |
| `teodor.vance@example.com` | `Strongroom-Owner-2` | Teodor Vance | owner of vault B |
| `ines.marsh@example.com` | `Strongroom-Contact-1` (not temporary) | Ines Marsh | trusted contact of vault A |

**Vault A rules.** Priority 1 is `Any kind at clinic is Critical`. Priorities 2 to 13 are the twelve default rules, in published order.

**Vault A holdings**, with their levels at start:

| Company | Kind | Value | Notes | Level |
|---|---|---|---|---|
| Brightway Air | Passport | `P 5520 4471 8` | `Saved for online check-in` | Critical |
| Brightway Air | Date of birth | `1986-03-14` | | Moderate |
| Brightway Air | Email address | `ada.marsh@example.com` | | Low |
| Copperleaf Bank | Bank account | `GB29 CPLF 6016 1331 9268 19` | `Joint account with Ines` | High |
| Copperleaf Bank | Payment card | `4929 1180 2231 6604` | | High |
| Copperleaf Bank | Home address | `14 Wren Row, Aldmoor` | | Moderate |
| Larchfield Clinic | Health record | `Patient LC-208113` | `Asthma review every spring` | Critical |
| Larchfield Clinic | Phone number | `+44 7700 900412` | | Critical |
| Parcelwise | Home address | `14 Wren Row, Aldmoor` | | Moderate |
| Parcelwise | Phone number | `+44 7700 900412` | | Low |
| Tally Rent | National ID | `QQ 12 34 56 C` | `Scan of ID card uploaded at signup` | Critical |
| Tally Rent | Home address | `14 Wren Row, Aldmoor` | | Moderate |

**Vault A breach.** Brightway Air, announced `2026-10-20`, kinds Passport and Date of birth. All steps start open.

**Vault A grant.** Active, to Ines Marsh (`ines.marsh@example.com`), duration `30d`, levels Critical, High, Moderate and Low, created at seeding.

**Vault B (Teodor).** The default rules and these holdings:
- Quayside Mobile, Phone number, `+44 7700 900118` (Low)
- Quayside Mobile, Payment card, `5412 7500 0000 1290` (High)
- Harbor Gym, Home address, `3 Pier Lane, Saltby` (Moderate)

Vault B has one breach: Quayside Mobile, announced `2026-10-28`, kind Phone number. It has no grant.

**Worked examples, with the seed data at start**
- **Ada's score.** 48, band Exposed. Her steps, in order:
  1. Passport step 1 (20 points)
  2. Passport step 2 (20 points)
  3. the person-level passphrase step (4 points)
  4. Date of birth step 2 (4 points)

  All four are at Brightway Air.
- **Breach previews.**
  - A Copperleaf Bank breach with Bank account ticked previews 68.
  - Ticking Payment card as well previews 88.
- **Searches.**
  - `parcel` shows 2 holdings.
  - `cop` shows 3 holdings, the Copperleaf Bank rows.
- **Suggestions.** Typing `b` in the Log breach Company combobox suggests `Brightway Air` and `Copperleaf Bank`.
- **Teodor's score.** 2, band Contained.

## Technical requirements

### Deployment (DP-54)

The runtime image has Python 3.12 with `venv` and `pip`.
- The app is installed and run as an unprivileged user.
- Dependencies go into a `.venv` inside `/app`.
- The manifest calls tools by path (`.venv/bin/<tool>`) or as `python -m <tool>`.

`/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt","build":".venv/bin/python -m compileall -q .","serve":".venv/bin/python -m app"}
```

`serve`:
- binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set
- creates the schema and seed at start
- answers `GET /api/health` with HTTP 200 `{"status":"ok"}` once the database is reachable, whether or not the realm is

### Configuration and secrets (DP-60, DP-82)

These are read at start from the environment. They are never hard-coded and never sent to the browser.
- `DATABASE_URL`
- `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`
- `APP_PUBLIC_PORT`
- `APP_PUBLIC_URL`: when set, the origin for `<origin>/auth/callback`. Otherwise the origin comes from the request's host.
- `GRANT_HOUR_SECONDS` (default 3600). The verifier may set it to 1, which makes `24h` last 24 seconds.
- `SESSION_IDLE_SECONDS` (default 1800). The verifier may set it to 20.
- `SIGNIN_PENDING_SECONDS` (default 600)

### Server boundary (DP-03, DP-56, DP-76)

- **Same origin.** Pages and the API share one origin, and no cross-origin sharing headers are sent. A POST, PUT, PATCH or DELETE whose `Origin` header is present and is not the request's own origin answers 403 `cross_origin`.
- **Body limits.** JSON bodies are limited to 65,536 bytes. Exactly 65,536 bytes is allowed; more answers 413. Any content type other than JSON answers 415.
- **Signed-out access.** Every `/api` route except `/api/health` and `/api/status` answers 401 without a session. This includes a browser that holds only a pending sign-in.
- **Request isolation.** Each request is answered only for its own session's identity, vault and scope. The same holds for each live stream. Under hundreds of interleaved concurrent requests from different people, no response or event ever carries another caller's identity, vault or data, and a contact's answers stay masked and scoped. Nothing request-specific is kept between requests outside the database.
- **Never served.** Source files, `run.json`, `.venv`, environment files, credentials, and any path outside the built static assets and the routes in this brief all answer 404.
- **Database unreachable at boot.** The server retries every 2 seconds and answers `GET /api/health` with 503 `{"status":"starting"}` until it connects.
- **Realm unreachable at boot.** The server starts normally and behaves as described in Services.

### Browser support and performance (DP-10, DP-57, DP-83)

The app supports current Chromium, Firefox and WebKit at 375 by 812, 768 by 1024 and 1280 by 800, with touch and with reduced motion. Layout edges fall exactly at 600 and 1024 CSS pixels.
- The seeded ledger is usable within three seconds of opening `/vault`.
- Filter results appear within one second.
- Live changes reach open screens within two seconds.
- Fonts are self-hosted.

## Working rules

- IF-01: `/app/run.json` is valid JSON with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: Python dependencies install into `/app/.venv`, and the manifest calls tools only as `.venv/bin/<tool>` or `python -m <tool>`.
- IF-03: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its version and licence. Shipped packages are the production dependency tree that `install` puts into `.venv` (as `.venv/bin/python -m pip list` reports), plus the bundled fonts.
- IF-04: every shipped package and font is under MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0, MPL-2.0 or OFL-1.1.
- IF-05: the app stores state only in the provided Postgres database: no SQLite, Redis, extra containers or data files written at runtime. The browser's session storage holds only the one-use draft.
- IF-06: the app never changes the provided realm's settings, clients or roles. It only creates and updates users, their credentials and their sessions.
- IF-07: no runtime request goes to a font, script or style CDN. Every asset the browser loads comes from the app's own origin, apart from the realm's sign-in pages.

## Engineering standards

- The Python is idiomatic and type-hinted, and database parameters are always bound, never put into SQL text.
- Names in the code use the domain terms of this brief: holding, grading rule, priority, level, breach, affected holding, next step, person-level step, exposure score, band, grant, scope, trusted contact, record version, return path, draft.
- Each of these is decided in exactly one place, and every surface that needs it calls that place:
  - grading
  - the exposure computation (score, band, affected holdings, person-level merging and step order)
  - the step transition and its ordering
  - grant status
  - masking
  - the contact field projection
  - the return-path check
  - the version check
- These rules are enforced so that they hold under concurrent requests, without a separate read-then-write check: holding uniqueness, the 50-rule limit, one active grant, one vault per account and one revoke winner.
- Every API error is produced through one error shape with the published codes. No route builds its own error body.
- There is no abstraction with a single implementation, and no defensive check for a state the data model makes impossible.
- There is no dead, commented-out or unreachable code, and no feature, route or setting beyond this brief.
- State changes and their notifications commit in the same transaction. Every live stream releases its database resources on every exit path.
