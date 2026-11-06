# Loomwise Evidence Desk

Evidence Desk is a web workspace for product teams at B2B software companies of 50 to 500 people. Teams use it to:

- collect customer feedback;
- highlight the exact sentences customers said;
- link those sentences to features as evidence;
- rank features against weighted objectives;
- plan releases on a roadmap board;
- tell each customer who asked for a feature when it ships.

One chain runs from start to finish. A highlighted quote in a note becomes an insight on a feature. That insight drives the feature's counts and scores, its rank, its place on the roadmap and the "you asked, we shipped" email.

Build it as one TypeScript web app backed by three services:

- PostgreSQL is the system of record.
- S3-compatible object storage (MinIO) holds note attachments and frozen release scopes.
- An SMTP mail sink (Mailpit) receives every outgoing email.

Members sign in with an email and password that belong to one workspace. The only page anyone can open without signing in is the shared public roadmap.

Out of scope: single sign-on, billing, third-party helpdesk or CRM connectors, AI summaries or auto-tagging, real-time co-editing, mobile apps, and any datastore besides the three named services.

## Problem and users

Product managers get feedback from four places: support tickets, sales-call notes, CSV exports from old survey tools, and emails that account managers forward. The real decision ("which three features go into next quarter, and who asked for them") ends up in spreadsheets that drift away from the evidence. Senior people spend hours on three chores:

- re-tagging notes;
- rebuilding "who asked for this" lists before every planning cycle;
- emailing customers one by one when something ships.

If a count is wrong, or a confidential enterprise quote appears on a public roadmap, sales stops trusting the roadmap. Evidence Desk keeps the evidence and the decision in one place, and every number can be traced back to quotes.

- **Product manager** (daily): triages the feedback inbox, highlights quotes into insights on features, scores features and ranks them against objectives, and arranges features on the roadmap board.
- **Head of product** (weekly): sets objective weights, freezes and ships releases, publishes the roadmap to customers and leadership through share links, exports the ranked list for the exec deck, renames features, and invites members.
- **Customer success manager** (weekly): logs call notes for their accounts with transcripts attached, imports legacy feedback spreadsheets, and checks when a customer's request has shipped.
- **Roadmap viewer** (occasional): opens a shared public roadmap link without signing in.

## Journeys

1. **Triage and highlight.**
   - A product manager signs in and starts on the Unprocessed inbox. They page down with "Load more notes" until the oldest note shows. No note appears twice, even where two notes arrived in the same second.
   - They search the workspace for "KPI", open "Weekly KPI pack" and select "If reports could email themselves to the ops team". A marker-yellow mark covers exactly those characters.
   - They press L, choose "Scheduled report emails" and the importance "Important", then confirm.
   - A thin ink thread draws from the quote to that feature's row in the hierarchy rail. The row's insight count and impact score count up, and the row slides from rank 2 to rank 1. The thread then fades to a small tick beside the quote.
   - They mark the note processed and it leaves the Unprocessed list. After a reload the mark sits on the same characters.
2. **Keep the evidence honest.**
   - A product manager sees that "Northwind Freight" and "Northwind Freight Ltd" are the same customer and merges the second into the first. The unique-company count of "Scheduled report emails" drops by one, and the old company's page now answers "not found".
   - They change the contact on a note, unlink a wrongly linked quote, and delete a duplicate note. The deleted note's quotes vanish from search, from the export and from the company's requests, and its stored files leave storage.
   - They snooze another note until next Monday at 9:00 in the workspace's time zone.
   - Every feature row shows recomputed numbers without a reload.
3. **Log a call note with a transcript.**
   - A customer success manager logs a sales-call note for a contact, pastes formatted text from an email and attaches the call transcript as a .vtt file. The note appears in the inbox with the transcript listed. A file named .vtt that is really a web page is refused.
   - On a day when object storage is down, the note still saves and a real transcript shows as pending upload. It becomes a download link on its own after storage returns, with no restart. The downloaded file keeps its name, accents included.
4. **Import legacy feedback.**
   - A customer success manager pastes a CSV saved from a spreadsheet program, with a byte-order mark, Windows line endings and a feedback cell spanning two lines. They preview it. Each row shows as created, matched or skipped with a reason and its line number, and nothing is written yet.
   - They import. The new notes appear in the Unprocessed inbox, attached to existing companies where the email domain matches.
   - A colleague presses import on the same file at the same moment. Between the two imports every note, contact and company exists exactly once.
5. **Weigh objectives and rank.**
   - The head of product sets the weights of the three objectives.
   - A product manager opens "Scheduled report emails" and lowers its effort. Its priority rises and it moves from second to first place in the ranking table, with the values given in the Seed data example. The score history lists the new version with the priority it had at that moment.
   - When several product managers save scores for the same feature at the same time, one save wins. Every other person sees a conflict message that shows the winning values.
6. **Arrange the roadmap.**
   - A product manager opens the roadmap board. Releases are grouped into month columns.
   - Using only the keyboard, they pick up "Bulk user import", move it to first position in "March Drop", then move it into "April Drop". They hear the position announced at each step.
   - A pointer user drags a card between releases in the same way.
   - After a reload the order is the same.
7. **Freeze, ship and close the loop.**
   - The head of product freezes "March Drop", which stores its scope. They take "Bulk user import" back out, which stores the next scope version, and then ship.
   - The release is marked shipped. "Bulk user import" waits in Unscheduled.
   - Each customer contact who asked for one of the shipped features gets exactly one "You asked, we shipped" email that names only their features, in board order.
   - A customer success manager opens Orchard Lane Bank's company page and sees "SAML single sign-on" listed as shipped in March Drop, March 2027.
8. **Share and export.**
   - The head of product creates a roadmap share link that lasts a set time and sends it to a customer.
   - The roadmap viewer opens it without signing in. They see only public releases, feature names and public descriptions.
   - The head of product renames a feature. The ranking, the public roadmap and the export show the new name at once, while the stored scope snapshot and emails already queued keep the old one.
   - They download the ranked feature list with top quotes as CSV for the exec deck.
   - The link stops working the moment it expires. Regenerating it gives a fresh window of the same length. Once it is revoked it stays dead for good.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Feedback inbox triage** A product manager opens the inbox, filters notes by Unprocessed, Snoozed and Processed, loads further pages with "Load more notes", reads a note in the reading column, and marks it processed so it leaves the Unprocessed list.
- **DP-02 — Note body allowlist** Every note body is reduced on save to the allowlist in Business rules, so the stored body, the API response and the reading view never carry scripts, event handlers, inline styles or links other than http, https and mailto.
- **DP-03 — Note states and snooze** Notes move between unprocessed, snoozed and processed only along the legal edges in Business rules, and a snoozed note returns to Unprocessed at the chosen local time in the workspace time zone, including across daylight-saving changes.
- **DP-04 — Highlight a quote into an insight** Selecting text in a note, choosing a feature by pressing L or by dragging the mark onto the hierarchy rail, and confirming an importance creates an insight whose marks sit on the same characters after a reload.
- **DP-05 — Insight records exact offsets** Creating an insight stores the note id, the start and end offsets into the note's plain text and the importance, and returns a quote that is exactly that slice of the plain text.
- **DP-06 — Evidence thread motion** Linking a quote draws the thread from the mark to the feature row, counts the row's numbers up, slides the row to its new rank and leaves a persistent tick beside the quote, within the timings in Motion and effects.
- **DP-07 — Workspace-scoped feature picker** The feature picker and its feature search return only non-archived top-level features from the signed-in user's own workspace, matching the typed text literally.
- **DP-08 — Derived feature counters** Each feature's insight count, unique-company count and impact score always equal a recomputation from its linked insights, in the API, the hierarchy rail and the ranking table.
- **DP-09 — Evidence edits keep counters true** A product manager who unlinks an insight, deletes a note or changes a note's contact sees the affected feature rows change to the recomputed counts and scores without reloading.
- **DP-10 — Company merge** Merging one company into another moves its contacts, notes and domains to the target, removes the merged company from every surface, and recounts unique companies on every affected feature in the same request.
- **DP-11 — Highlights survive note edits** Editing a note body keeps or re-anchors every highlighted span as defined in Business rules, and rejects with 409 an edit that would remove highlighted text.
- **DP-12 — Log a call note with a transcript** A customer success manager logs a call note for a contact with a transcript attached that passes the content check, and the note appears in the inbox with the attachment listed.
- **DP-13 — Attachment pending during storage outage** When object storage is unreachable, saving a note still succeeds, and an attachment that passes the content check is accepted with status pending and shown as pending, never as a broken link.
- **DP-14 — Pending attachments upload on recovery** Pending attachments upload on their own once object storage is reachable again, picked up from the shared database by any running instance within the retry interval in Services, without a server restart.
- **DP-15 — Import preview before writing** A customer success manager pastes a legacy feedback CSV, sees a preview of created, matched and skipped rows with line numbers that writes nothing, then imports and sees the new notes in the inbox.
- **DP-16 — Import matching rules** Imported rows match existing contacts by normalised email and companies by normalised email domain within the workspace, rows that are invalid or duplicates are skipped with a stated reason, and a repeated import creates nothing.
- **DP-17 — Objectives and weights** The head of product creates objectives and sets their weights, and every feature's objective fit and priority score reflect the new weights on the next read without changing any score version.
- **DP-18 — Priority score and ranking** Every feature's priority score and rank follow the formula, rounding and tie-break rules in Business rules.
- **DP-19 — Score version conflicts** Of simultaneous score saves on one version exactly one wins and every other gets 409 with identical current values, and each committed version is kept in a readable history with the priority computed at that commit.
- **DP-20 — Rank a feature against objectives** A product manager edits a feature's effort, confidence and objective fits on its detail screen and sees its priority, rank and score history update.
- **DP-21 — Roadmap board by target month** The roadmap board shows releases grouped into columns by target month in the workspace time zone, and a product manager reorders features within a release and moves them between releases by pointer drag.
- **DP-22 — Keyboard moves with announced positions** Every board move can be made by keyboard alone, and each pick-up, step, drop and cancel is announced with the feature's position and release.
- **DP-23 — Board order versions** Board moves persist across reloads and follow the release and status guards in Business rules in the published error precedence, and a move made against any outdated release order is rejected with 409 and every touched release's current order.
- **DP-24 — Feature status machine** Feature status changes follow only the legal edges in Business rules, with archive from any state and restore to the prior state, and every illegal edge is rejected with 409.
- **DP-25 — Freeze a release scope** Freezing a release stores its scope snapshot in object storage before the release reports frozen, and later scope changes to a frozen release need the head of product and write the next snapshot version.
- **DP-26 — Ship once per idempotency key** Shipping a frozen release releases the features in its latest scope snapshot and makes the release immutable; a replayed idempotency key returns the stored response and every other repeat is rejected, as qualified in Business rules.
- **DP-27 — You asked, we shipped emails** Shipping a release sends exactly one email per distinct requesting contact per release, listing only that contact's features in board order with content fixed at ship time and carrying only published fields, as qualified in Services.
- **DP-28 — Ship and close the loop** The head of product freezes and ships a release from the roadmap board and sees the release marked shipped along with the number of customer emails queued.
- **DP-29 — Customer request status** A customer success manager sees on a company's page each feature its contacts asked for and, once it has shipped, the release and target month it shipped in.
- **DP-30 — Revocable share links** The head of product creates, regenerates and revokes unguessable roadmap links in Settings, and a link that is revoked, replaced or expired stops working at once, as qualified in Business rules.
- **DP-31 — Public roadmap shows published fields only** The public roadmap page and its API show only public releases with feature name, public description, release name and target month, and accept no changes.
- **DP-32 — Prioritised feature export** The head of product downloads the ranked feature list as CSV, with current feature names, up to three top customer quotes per feature and only their own workspace's data.
- **DP-33 — Export cells cannot run as formulas** Every export cell that a spreadsheet could read as a formula is neutralised by the rule in Business rules.
- **DP-34 — Workspace-scoped search and totals** Global search, company lists and each feature's requested-by totals show only records from the signed-in user's own workspace.
- **DP-35 — Invite members by email** The head of product invites a member by email with a role, the invitation is delivered through the outbox, and its accept link works exactly once before it expires.
- **DP-36 — Sign-in, sessions and roles** Members sign in with email and password, and each action is allowed only to the roles listed for it in API.
- **DP-37 — One error contract** Every API error uses one JSON shape and the single precedence order stated in API.
- **DP-38 — Server boundary** The server accepts state changes only from its own origin, enforces body-size limits, never serves source or credentials, and keeps serving when object storage or mail is down.
- **DP-39 — Run manifest and health** The app installs, builds and serves from /app/run.json on port 4173 (or APP_PUBLIC_PORT) and answers the health check.
- **DP-40 — Responsive panes** The three-pane desktop layout collapses into stacked pane tabs below 900 pixels wide, with no horizontal page overflow at 375, 768 and 1280 pixels wide.
- **DP-41 — Keyboard and focus** Every control in the public controls table can be reached by Tab in reading order and shows a visible focus ring; dialogs trap focus, Escape closes them and focus returns to the control that opened them.
- **DP-42 — Reduced motion substitutes** When reduced motion is requested, no thread drawing, numeral counting or row sliding runs, and the substitutes in Motion and effects appear at once.
- **DP-43 — Paper-and-ink visual identity** Screens use the paper ground, ink text, hairline rules, cobalt accent, marker-yellow highlights, serif display with sans body type, and monospaced score figures described in Visual design.
- **DP-44 — Credentials from environment** Every service credential and URL is read from the environment variables in Configuration and secrets, never hard-coded and never sent to the browser.
- **DP-45 — Stable inbox paging** The inbox lists notes in capped pages, newest first, with a cursor bound to its filter, so walking every page returns each matching note exactly once even when notes share a creation time or arrive mid-walk, as qualified in Business rules.
- **DP-46 — Deleted means gone everywhere** A deleted note or a merged-away company disappears from every read surface in the same request, and a deleted note's stored objects leave object storage within the window in Services, whichever instance ran the delete.
- **DP-47 — Uploads judged by content** An attachment is accepted only when its bytes match its extension, on every path including pending, and downloads carry the canonical type, a no-sniff header and a safe attachment filename.
- **DP-48 — Imports never write twice** Real imports in a workspace run one at a time, so two simultaneous imports of the same file create each note, contact and company exactly once, and the CSV reading rules in Business rules hold.
- **DP-49 — Share link expiry and lifecycle** A share link works only while server time is before its expiresAt, regenerating gives a fresh window of the same lifetime, a revoked link can never be regenerated, and every public roadmap response forbids caching and indexing.
- **DP-50 — Renames propagate with history** A renamed feature shows its new name on every live surface on the next read, while scope snapshots and already-queued emails keep the name they had, and feature names stay unique per workspace ignoring case.
- **DP-51 — Bounded literal search** Global search matches only note titles and plain text, treats percent, underscore and backslash literally, caps query length, and returns ordered groups of at most 10 with the exact snippet window in Business rules.
- **DP-52 — Overlapping highlights as exact segments** Saved and pending highlights render as mark segments over runs where the set of covering insights is constant, each carrying its offsets and sorted insight ids, split at element boundaries and never splitting a surrogate pair.
- **DP-53 — Simultaneous links stay exact** Of simultaneous identical links exactly one succeeds and the rest get 409 duplicate_insight, and simultaneous distinct links, importance changes and unlinks leave every counter equal to a recomputation.

## Frontend

### Screens and layout (DP-01, DP-12, DP-15, DP-20, DP-21, DP-29, DP-40, DP-45)

**Routes:**
- `/signin`
- `/inbox` and `/inbox/<noteId>`
- `/features` and `/features/<featureId>`
- `/roadmap`
- `/companies` and `/companies/<companyId>`
- `/import`
- `/settings`
- `/invite/<token>` (no sign-in needed)
- `/r/<token>` (public roadmap, no sign-in needed)

A signed-out visitor to any other route goes to `/signin`.

- **App shell.** A top bar holds:
  - the workspace name in the display serif;
  - the global search box;
  - the main navigation (Inbox, Features, Roadmap, Companies, Import, Settings);
  - a sign-out button.

  Settings shows only to the head of product. Import shows to every role.
- **Inbox (triage).** At 1280×800 there are three panes side by side:
  - **Left:** a note list about 280 pixels wide, with filter tabs at the top and a "Load more notes" button at the end while more pages exist.
  - **Middle:** a reading column about 68 characters wide. It shows the note title, source, contact, company, received date, body, attachments and a "Linked evidence" list.
  - **Right:** the product hierarchy rail, a tree of product, component, feature and subfeature. Each feature row shows its insight count, unique-company count, impact and rank in monospaced figures. The rail collapses to a narrow strip with one button.

  Below 900 pixels wide (768×1024 and 375×812), the panes stack behind a "Panes" tab row (Inbox, Note, Hierarchy) and one pane shows at a time. Choosing a note switches to the Note tab.
- **Features (ranking).** A table of every non-archived top-level feature in rank order, with the columns Rank, Feature, Status, Insights, Companies, Impact, Effort, Confidence, Objective fit and Priority.
  - Below 900 pixels the table shows only Rank, Feature and Priority. Each row has a "Details" disclosure that reveals the other values stacked beneath it.
  - The head of product also sees an "Export CSV" button.
- **Feature detail.** The screen shows:
  - the feature name as a heading;
  - a "Feature details" form with name and public description (head of product and product manager);
  - the status and status buttons;
  - a "Scores" form (effort, confidence, one fit selector per objective);
  - the derived numbers;
  - a "Score history" list, newest first, showing each committed version with its effort, confidence and priority at that commit;
  - a "Requested by" list of companies with how many insights each contributed;
  - the linked quotes, each linking back to its note.
- **Roadmap board.**
  - An "Unscheduled" lane comes first. It holds planned and in-progress features that have no release.
  - Month columns follow, oldest first, each headed with its month and year ("March 2027"). Each column holds its releases in target-date order.
  - Each release shows its name, target date, status (Open, Frozen, Shipped), a "Public" or "Internal" tag and an ordered list of feature cards.
  - At 900 pixels and wider, columns sit side by side inside a board region that scrolls sideways on its own. Below 900 pixels, columns stack vertically.
- **Companies.** A table of companies with domains, contact count and note count. A company page lists its contacts, its notes and a "Requests" list. Each request shows the feature, its status and, when released, the line "Shipped in <release> · <month label>".
- **Import.** A large text area for pasting CSV and a "Preview import" button. After a preview: a preview table (Line, Outcome, Reason) with totals and an "Import rows" button.
- **Settings** (head of product only). Three sections:
  - Objectives, with a weight field per objective.
  - Members, with an invitation form.
  - Share links, listing every link ever made, active, expired or revoked, with its dates and state.
- **Public roadmap** (`/r/<token>`). A page in the same paper-and-ink style with the heading "Product roadmap", then one section per month showing release names and their features with public descriptions. There is no navigation, no search and no sign-in prompt.
- **Invitation accept** (`/invite/<token>`). The heading "Join <workspace>" and a name and password form.

No screen scrolls sideways at 375, 768 or 1280 pixels wide. The only sideways scrolling allowed is the roadmap board's own region at 900 pixels and wider.

### Public screens and controls (DP-01, DP-04, DP-12, DP-15, DP-20, DP-21, DP-22, DP-28, DP-30, DP-35, DP-41, DP-45, DP-49, DP-50, DP-52)

Only the roles and names below are public contracts. Everything else is free. `<feature>`, `<release>`, `<objective>` and `<filename>` stand for the record's current name.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Sign in | textbox "Email", textbox "Password", button "Sign in" | "Sign in to Evidence Desk" heading |
| Shell | navigation "Main" with links "Inbox", "Features", "Roadmap", "Companies", "Import", "Settings" | link text equals name |
| Shell | combobox "Search workspace" with listbox "Search results" | options grouped under "Notes", "Companies", "Features"; note options show the snippet as text |
| Shell | button "Sign out" | "Sign out" |
| Shell | status "Save status"; status "Evidence announcements"; status "Board announcements"; alert (one per page) | copy from Feedback states |
| Inbox | tablist "Inbox filter" with tabs "Unprocessed", "Snoozed", "Processed" | tab label plus total count for that status |
| Inbox | listbox "Notes" with one option per loaded note, named by note title; no two options share a note | title, contact, source label, date |
| Inbox | button "Load more notes", after the listbox, present only while another page exists | "Load more notes" |
| Inbox | button "Log note" | "Log note" |
| Inbox, narrow | tablist "Panes" with tabs "Inbox", "Note", "Hierarchy" | tab labels |
| Reading column | article "Note", its heading level 2 is the note title | body in reading measure |
| Reading column | buttons "Mark processed", "Reopen", "Snooze", "Edit note", "Delete note" | same text |
| Reading column | saved and pending highlights are HTML `mark` elements carrying `data-start`, `data-end` and `data-insights`; marks covered by the pending selection also carry `data-pending="true"` | quote text |
| Reading column | img "Linked to <feature>" beside each saved highlight, after its last mark | small tick |
| Reading column | img "Evidence thread to <feature>" (only while the thread animates) | the thread |
| Reading column | button "Link to feature" in the floating selection toolbar | "Link to feature · L" |
| Reading column | list "Linked evidence", each item with button "Unlink <feature>" | quote, feature, importance |
| Reading column | list "Attachments" | link "<filename>" when available; text "<filename> — Pending upload" when pending |
| Dialog | dialog "Link quote to feature" with combobox "Feature", radiogroup "Importance" (radios "Nice to have", "Important", "Critical"), button "Link quote", button "Cancel" | quote shown at top |
| Dialog | dialog "Snooze note" with textbox "Snooze until" (date and time), button "Snooze note" | time zone name shown under field |
| Dialog | dialog "Edit note" with textbox "Title", textbox "Note body", combobox "Contact" (option "No contact" plus the workspace's contacts), button "Save changes" | |
| Dialog | alertdialog "Delete note?" with buttons "Delete" and "Cancel" | "This also removes its <n> linked insights." |
| Dialog | dialog "Log note" with textbox "Title", textbox "Note body" (accepts pasted formatting), combobox "Contact", combobox "Source" (options "Support ticket", "Sales call", "Email"), file input labelled "Attach transcript or file", button "Save note" | |
| Rail | complementary "Product hierarchy" containing tree "Product hierarchy"; feature rows are treeitems named by feature | counts in monospaced figures |
| Rail | button "Collapse hierarchy" / "Expand hierarchy" | icon with tooltip |
| Rail | text "Linked" badge on the row (reduced motion only) | "Linked" |
| Features | table "Feature ranking", columns as in Screens and layout; feature names are links | |
| Features | button "Export CSV" (head of product) | "Export CSV" |
| Feature detail | group "Feature details" with textbox "Feature name", textbox "Public description", button "Save details" | |
| Feature detail | group "Scores" with spinbutton "Effort", spinbutton "Confidence", combobox "<objective> fit" (options "None", "Low", "Medium", "High"), button "Save scores" | |
| Feature detail | list "Score history", one item per version | "v<version> · effort <effort> · confidence <confidence>% · priority <priority>" |
| Feature detail | buttons "Move to planned", "Start work", "Archive", "Restore" (only legal ones are shown) | |
| Feature detail | list "Requested by" | "<company> · <n> insights" |
| Roadmap | region "Roadmap board"; each month is a group named by its label ("March 2027"); each release is a list named by release name; the lane is list "Unscheduled" | |
| Roadmap | each feature card is a button named "<feature>" | name and status |
| Roadmap | per release: button "Freeze scope", button "Ship release" (head of product, shown when legal) | |
| Roadmap | dialog "Ship <release>" with button "Ship and notify customers" | "Each customer who asked for these features gets one email." |
| Companies | table "Companies"; per company page button "Merge into…" | |
| Companies | dialog "Merge company" with combobox "Merge into", button "Merge companies" | |
| Company page | list "Requests" | "Shipped in <release> · <month label>" when shipped |
| Import | textbox "CSV", button "Preview import", table "Import preview", button "Import rows" (disabled until a preview succeeds for the current text) | |
| Settings | region "Objectives" with spinbutton "<objective> weight" per objective, button "Save weights" | |
| Settings | region "Members" with textbox "Invite email", combobox "Role" (options "Head of product", "Product manager", "Customer success"), button "Send invitation" | |
| Settings | region "Share links" with spinbutton "Link lifetime (seconds)" (empty means no expiry) and button "Create share link"; each link is a listitem in list "Share links" showing its state word "Active", "Expired" or "Revoked", with buttons "Copy link", "Regenerate" (absent on revoked rows), "Revoke" (absent on revoked rows) | URL, created, expiry and revoked dates |
| Public roadmap | heading level 1 "Product roadmap"; one region per month named by its label | release names, features, public descriptions |
| Invitation | textbox "Your name", textbox "Password", button "Join workspace" | |

### Interactions (DP-04, DP-06, DP-09, DP-21, DP-22, DP-41, DP-45, DP-52)

- **Selecting a quote.**
  - In the reading column the user selects text by pointer or by keyboard (Shift with the arrow keys).
  - When the selection ends inside the note body, it is turned into offsets in the note's plain text. A selection edge that falls between the two halves of a surrogate pair (for example inside an emoji) moves outward, so the whole character is included.
  - The pending highlight then appears at once over exactly those characters, and a small toolbar with "Link to feature · L" appears just above it.
  - A selection that is empty, only whitespace, or extends outside the body creates nothing.
  - Clicking elsewhere or pressing Escape removes the pending highlight.
- **Highlight segments.** The reading view renders highlights as follows, on every render and after a reload:
  - Take every saved insight span on the note, plus the pending span when there is one.
  - Split the plain text into the longest runs over which the set of covering spans does not change.
  - Wrap each covered run in `mark` elements. A run that crosses an element boundary (into or out of `strong`, a link, a list item or any other element) becomes several marks, one per piece, with contiguous offsets.
  - Each mark carries `data-start` and `data-end` (its offsets in the plain text, end exclusive) and `data-insights`: the ids of the saved insights that cover it, sorted as strings and separated by single spaces, or empty when only the pending span covers it.
  - A mark covered by the pending span also carries `data-pending="true"`.
  - Marks never nest. The text content of the marks for one insight, joined in order, equals that insight's quote.
- **Linking by keyboard.**
  - With a pending highlight present, pressing L (or activating "Link to feature") opens "Link quote to feature" with focus in the Feature combobox.
  - Typing filters the workspace's features. Arrow keys move through the options, and Enter picks one. Importance defaults to "Important".
  - "Link quote" commits. Escape or "Cancel" closes the dialog, removes the pending highlight and returns focus to the note body.
- **Linking by drag.**
  - Pressing on the pending highlight and dragging draws a thread that follows the pointer.
  - Dropping on a feature row in the rail commits with importance "Important". Dropping anywhere else cancels and the thread retracts.
  - Below 900 pixels the rail is on another tab, so only the dialog path exists and there is no thread. The tick and announcement still appear.
- **After commit.**
  - The pending highlight becomes saved, and the segments are recomputed. The thread, counting and row slide run as described in Motion and effects.
  - Focus stays in the note body.
  - Clicking a saved mark opens a small popover listing the features and importance of every insight in its `data-insights`, each with an "Unlink <feature>" button.
  - Unlinking recomputes the segments and removes the tick. The feature row's numbers update straight away.
- **Inbox.**
  - The filter tabs switch the list and load its first page.
  - "Load more notes" adds the next page below the loaded options, and focus stays on the button (or moves to the first new option when the button disappears).
  - Arrow keys move through the Notes listbox and Enter opens the note.
  - While the inbox is open, it reloads the first page every 30 seconds. Notes already in the list are updated in place, new ones are added in order, and pages already loaded stay loaded, so no note shows twice. A note whose snooze has ended reappears within 30 seconds.
- **Attachments.** While a note with pending attachments is open, the note view checks again every 5 seconds and turns "Pending upload" into a link once storage confirms the file.
- **Share links.** While Settings is open, the share-link list reloads every 30 seconds and after every action, so a link that has passed its expiry shows "Expired" within 30 seconds.
- **Roadmap board by pointer.**
  - Dragging a card shows a drop slot between cards.
  - Dropping commits the move, and the other cards close up or open space.
  - Dropping on a frozen or shipped release that the user may not change returns the card to where it started, with the matching alert.
- **Roadmap board by keyboard.**
  - Tab reaches each card. Space or Enter picks it up.
  - Up and Down move it within its list.
  - Left and Right move it into the previous or next list (Unscheduled first, then releases in board order, skipping shipped releases), at the same index or at the end.
  - Space or Enter drops it and commits. Escape cancels and returns the card to its original slot.
  - Every step is announced through "Board announcements", and focus stays on the moved card. Nothing is saved until the drop.
- **Dialogs.** Opening a dialog moves focus to its first field. Tab and Shift+Tab cycle inside it. Escape closes it and focus returns to the control that opened it.
- **Global search.** Typing two or more characters shows grouped results after a short pause of about a quarter of a second. Arrow keys move through them, Enter opens one and Escape clears the box.
- **Tab order** follows reading order: top bar, inbox list, reading column, rail. Every interactive element shows a clearly visible cobalt focus ring.

### Visual design (DP-43)

- **Colour roles.**
  - The page ground is a warm off-white like paper, with no gradients anywhere.
  - Text and thin threads are a deep blue-black ink.
  - Rules and table lines are pale stone-grey hairlines.
  - One cobalt blue accent marks actions, focus rings, links and the evidence thread.
  - Highlights are a marker yellow under ink text. Where two highlights overlap, the overlapping marks are a deeper marker yellow, so overlap is visible.
  - Status uses words and icons as well as colour.
  - Text and controls meet WCAG 2.2 AA contrast against the ground.
- **Type.**
  - Headings, the workspace name and release names use Fraunces, a soft high-contrast serif. Everything else uses Inter, a plain sans.
  - Each heading level is about one fifth larger than the one below it, starting from body size.
  - Every number in a score cell, count, rank or table uses fixed-width figures, so columns of digits line up exactly.
- **Density and composition.**
  - Spacing is comfortable, on a strict 8-pixel rhythm in score tables and on the roadmap board.
  - Panels and cards are separated by hairline rules, never shadows.
  - The reading column keeps a line length of about 68 characters.
  - The rail and the inbox list stay quiet so the note text leads.
- **Controls and imagery.** Controls are at least 44 by 44 pixels to tap. Icons come from the Lucide set. All illustration (empty states, the public roadmap header ornament) is drawn in SVG made by the app, with no stock imagery.

### Motion and effects (DP-06, DP-42)

All motion starts quickly and settles softly, with no bounce. Three tempos are used:
- quick: about a sixth of a second;
- medium: just over a quarter of a second;
- slow: about four-tenths of a second.

**Highlight paint** (state change): the marker yellow sweeps left to right across the selected characters at the quick tempo.

**Evidence thread** (the signature), shown when the rail is visible:
1. A thin cobalt S-shaped curve draws itself from the right edge of the highlight's last mark to the left edge of the target feature row. It starts from nothing and grows to full length at the slow tempo (about 0.42 seconds).
2. When the line reaches the row, the row's insight count and impact score count up from their old values to the new ones at the medium tempo (about 0.28 seconds), in fixed-width figures.
3. If the rank changes, the row slides from its old position to its new one at the same time and at the same medium tempo. The other rows shift to make room, and the end of the thread stays attached to the moving row.
4. The thread then fades at the quick tempo into a small tick ("Linked to <feature>") beside the quote, which stays there.

The whole sequence finishes within 1.2 seconds of the server confirming the link. Unlinking runs no thread: the tick fades out and the numbers count down at the medium tempo.

**Other motion:**
- **Board moves** (state change): a dropped card slides into its slot at the medium tempo, and neighbouring cards shift at the same tempo.
- **Dialogs and popovers** (enter and exit): fade in and rise slightly at the quick tempo, and fade out at the same tempo.
- **Hover and press:** table rows and feature rows show a cobalt hairline underline and a faint ink tint within the quick tempo. Buttons darken slightly when pressed.
- **Progress:** while any request takes longer than 0.3 seconds, a thin cobalt bar slides along under the top bar until it finishes. This is the only looping motion. No other decorative or ambient animation runs, and nothing is tied to scrolling.

**Reduced motion** (when the operating system asks for less motion):
- The highlight appears at once.
- No thread is drawn, so the "Evidence thread to <feature>" image never appears.
- Numbers show their new values straight away with no counting.
- Rows and cards jump to their new position with no sliding.
- The feature row shows a static "Linked" badge until another note is opened. The tick appears at once.
- Dialogs appear and disappear without fading or rising.
- The progress bar is replaced by the pending copy alone.
- The announcements in Feedback states are made in both modes.

### Feedback states (DP-03, DP-13, DP-19, DP-22, DP-28, DP-35, DP-47, DP-50)

Successes go to status "Save status" unless a row names another region. Errors go to the page's alert. Field errors also appear under their field, linked to it as its description.

Placeholders used below:
- `<n>`, `<old>`, `<new>`, `<rank>`, `<total>`, `<i>` and `<count>` are integers.
- `<priority>` has two decimals.
- `<email>` is the address entered.
- `<local time>` is the snooze instant in the workspace time zone, formatted like "Mar 14, 2027, 3:30 AM".
- `<month label>` is the month name and year, for example "March 2027".
- `<status label>` is one of "Candidate", "Planned", "In progress", "Released", "Archived".
- `<ext>` is the file's extension in lowercase with its dot, for example ".vtt".

| Action | Pending | Success | Error and outage |
|---|---|---|---|
| Sign in | button reads "Signing in…" | goes to `/inbox` | "Email or password is incorrect." |
| Any request answered 401 | — | — | goes to `/signin` with alert "Your session ended. Sign in again." |
| Any request answered 5xx (not named below) | — | — | "Something went wrong on our side. Nothing was saved." |
| Load more notes | button reads "Loading notes…" | new options appear | "The inbox changed filter. Showing the first page again." (on a 422 cursor answer; the list reloads its first page) |
| Save note (Log note) | "Saving note…" | "Note saved." | attachment left pending: "Note saved. <filename> will upload when storage is back."; Title field: "Add a title."; Note body field: "Add the note text."; attachment over the size limit: "<filename> is larger than 10 MB."; wrong extension: "Attach a .txt, .vtt, .pdf, .png or .jpg file."; content does not match extension: "<filename> is not a valid <ext> file." |
| Edit note | "Saving changes…" | "Note updated." | highlight conflict: "This edit removes highlighted text from <n> linked insights. Unlink them first or keep that text." |
| Delete note | "Deleting note…" | "Note deleted." | |
| Mark processed / Reopen | — | "Marked processed." / "Moved back to Unprocessed." | illegal edge: "This note can't move from <from> to <to>." |
| Snooze | "Snoozing…" | "Snoozed until <local time>." | field: "Pick a time in the future." |
| Link quote | button reads "Linking…" | "Evidence announcements": "Linked to <feature>; impact <old> → <new>; now rank <rank> of <total>" | duplicate: "This quote is already linked to <feature>." |
| Unlink | — | "Evidence announcements": "Unlinked from <feature>; impact <old> → <new>; now rank <rank> of <total>" | |
| Save details | "Saving details…" | "Feature details saved." | Feature name field, name clash: "A feature with this name already exists."; empty: "Add a feature name." |
| Save scores | "Saving scores…" | "Scores saved. Priority <priority>." | conflict: "Someone else saved these scores first. Current values: effort <effort>, confidence <confidence>%. The form now shows them; review and save again."; Effort field: "Effort must be a whole number from 1 to 100."; Confidence field: "Confidence must be a whole number from 10 to 100." |
| Status change | — | "Status changed to <status label>." | "<feature> can't move from <from status label> to <to status label>." |
| Merge companies | "Merging…" | "Merged <source company> into <target company>." | |
| Preview import | "Reading CSV…" | "Preview ready: <created> created, <matched> matched, <skipped> skipped. Nothing has been imported yet." | header: "The CSV header does not match the legacy feedback format." |
| Import rows | "Importing…" | "Imported <notes> notes: <created> created, <matched> matched, <skipped> skipped." | |
| Save weights | "Saving weights…" | "Weights saved. Priorities updated." | field: "Weight must be a whole number from 0 to 100." |
| Board pick-up ("Board announcements") | — | "Picked up <feature>. Position <i> of <count> in <release>." | |
| Board step | — | "<feature>, position <i> of <count> in <release>." | |
| Board drop | "Saving order…" | "Dropped <feature>. Position <i> of <count> in <release>." | outdated order: "The board changed while you were moving <feature>. It now shows the latest order."; candidate: "<feature> must be planned before it joins a release."; frozen and not head of product: "<release> is frozen. Ask a head of product to change its scope."; shipped: "<release> has shipped and can't change."; storage down while changing a frozen scope: the Freeze outage copy |
| Board cancel | — | "Move cancelled. <feature> is back at position <i> of <count> in <release>." | |
| Freeze scope | "Freezing scope…" | "Scope frozen for <release>." | storage down: "Storage is unavailable, so <release> was not frozen. Try again in a minute." |
| Ship release | button reads "Shipping…" | "<release> shipped. <n> customer emails queued for delivery." | not frozen: "Freeze <release> before shipping it." |
| Create / regenerate / revoke / copy share link | — | "Share link created." / "New link created. The old link no longer works." / "Link revoked. It no longer works." / "Link copied." | lifetime field: "Lifetime must be a whole number of seconds from 30 to 31536000." |
| Export CSV | button reads "Preparing export…" | file download starts | |
| Send invitation | "Sending invitation…" | "Invitation queued for <email>." | "<email> already has an Evidence Desk account." |
| Join workspace | "Joining…" | goes to `/inbox` | page heading, by the `410` code from API: `invitation_used` "This invitation has already been used"; `invitation_expired` "This invitation has expired"; `invitation_replaced` "This invitation was replaced by a newer one"; Password field: "Use at least 12 characters." |
| Public roadmap, inactive link | — | — | page heading "This roadmap link is no longer active" |

"queued" and "will upload" stay true when mail or storage is down. No success copy claims delivery.

## Backend

### API (DP-05, DP-07, DP-16, DP-19, DP-23, DP-26, DP-30, DP-31, DP-32, DP-34, DP-35, DP-36, DP-37, DP-45, DP-47, DP-49, DP-50, DP-51)

**Conventions.**
- **Content types and body limits.**
  - Requests and responses are `application/json; charset=utf-8`, except attachment upload (`multipart/form-data`), attachment download, the CSV export and the HTML pages.
  - A JSON body over 1,000,000 bytes is rejected with `413 {"error":{"code":"payload_too_large",...}}`. Exactly 1,000,000 bytes is allowed.
  - A write that carries a body (a `Content-Length` above 0, or a chunked body) without a JSON content type (or multipart for upload) gets `415 {"error":{"code":"unsupported_media_type",...}}`.
  - A write with no body never gets `415`. It is read as an empty JSON object. This is how the body-less writes are sent: freeze, ship, regenerate and every `DELETE`.
- **Formats.** Ids are opaque strings. Instants are ISO 8601 UTC with whole seconds and a trailing `Z` (for example `2027-03-14T07:30:00Z`). Calendar dates are `YYYY-MM-DD` and months are `YYYY-MM`. Lengths of text are counted in UTF-16 code units.
- **Error shape** (the only one): `{"error":{"code":"<code>","message":"<sentence>"}}`. A `422` adds `"fields":{"<field>":"<sentence>"}`. Some `409`s add one named key, listed with their endpoint.
- **Error precedence**, for every endpoint:
  1. `405 method_not_allowed` for a method the path does not support.
  2. Body size and content type (`413`, `415`).
  3. `401 unauthenticated`.
  4. `404 not_found` for an unknown, deleted or merged-away id, or another workspace's id, in the path.
  5. `403 forbidden` (role) or `403 cross_origin`.
  6. An idempotent replay returns its stored response.
  7. State conflicts (`409`, `410`).
  8. `422 validation_failed`.
  9. `503 storage_unavailable`.

  The rows below list only their own extra errors.
- **Ids in request bodies.** An id in a request body is never answered with `404`. This covers `contactId`, `featureId`, `intoCompanyId` and the keys of `fits` and `expectedOrderVersions`.
  - An id that is unknown, or that belongs to another workspace, gets `422 validation_failed` on that field with the message "No such record in this workspace." The response is identical for both cases.
  - An id that exists in the workspace but is unfit for the action also gets `422` on that field. The unfit cases are an archived feature or a subfeature as an insight target, and merging a company into itself.
- **Roles**: H = head of product, P = product manager, C = customer success. "Any" means any signed-in member. A role not listed gets `403`.
- **Shapes.**
  - User `{"id","name","email","role"}`, where role is `head_of_product`, `product_manager` or `customer_success`.
  - Note `{"id","title","body","text","source","status","snoozedUntil","receivedOn","createdAt","contact","company","attachments","insights"}`.
    - `body` is the allowlisted HTML and `text` is the plain text defined in Business rules.
    - `source` is `support_ticket`, `sales_call`, `email` or `csv_import`.
    - `status` is `unprocessed`, `snoozed` or `processed`.
    - `contact` is `{"id","name","email"}` or null. `company` is `{"id","name"}` or null.
  - Attachment `{"id","filename","contentType","size","status"}`, where status is `available` or `pending`.
  - Insight `{"id","noteId","featureId","featureName","start","end","quote","importance","companyId"}`, where importance is `nice_to_have`, `important` or `critical`.
  - FeatureSummary `{"id","name","publicDescription","componentId","status","releaseId","insightCount","companyCount","impact","effort","confidence","fits","objectiveFit","priority","rank","rankTotal","version"}`.
    - `fits` maps objective id to 0–3.
    - `objectiveFit` and `priority` are numbers with two decimals.
    - `status` is `candidate`, `planned`, `in_progress`, `released` or `archived`.
  - Release `{"id","name","targetDate","targetMonth","status","isPublic","orderVersion","snapshotVersion","featureIds","shippedAt","emails":{"queued","sent"}}`, where status is `open`, `frozen` or `shipped`.
  - Company `{"id","name","domains","contacts","noteCount"}`.
  - ShareLink `{"id","token","url","createdAt","expiresInSeconds","expiresAt","revokedAt","status"}`.
    - `expiresInSeconds` and `expiresAt` are null for a link with no expiry.
    - `status` is `active`, `expired` or `revoked`, judged at the moment of the read.

**Session and health**
- `GET /api/health` (public) → `200 {"status":"ok"}`.
- `POST /api/session` (public) `{"email","password"}` → `200 {"user":User}` and sets an HttpOnly session cookie. Wrong email or password → `401 invalid_credentials`.
- `DELETE /api/session` (Any) → `204`.
- `GET /api/me` (Any) → `200 {"user":User,"workspace":{"id","name","timeZone"}}`.

**Notes and attachments**
- `GET /api/notes?status=unprocessed|snoozed|processed&limit=<n>&cursor=<cursor>` (Any)
  - `status` defaults to `unprocessed`. `limit` is a whole number from 1 to 100 (both allowed), default 50. `cursor` is omitted for the first page.
  - → `200 {"notes":[{"id","title","source","status","snoozedUntil","contactName","companyName","createdAt","insightCount"}],"nextCursor":<string or null>,"counts":{"unprocessed","snoozed","processed"}}`.
  - 422 fields: `limit`; `cursor` (malformed, or issued for a different status). An unknown `status` gets 422 field `status`.
- `POST /api/notes` (Any) `{"title","body","source","contactId"}` → `201 {"note":Note}`.
  - `contactId` is optional. `source` is one of the first three values.
  - 422 fields: `title` (1–200 characters), `body` (not empty after the allowlist, at most 200,000 bytes), `source`, `contactId`.
- `GET /api/notes/{id}` (Any) → `200 {"note":Note}`.
- `PATCH /api/notes/{id}` (H, P) `{"title","body","contactId"}` (any subset; `contactId` may be null to clear it) → `200 {"note":Note}`.
  - `409 {"error":{"code":"highlight_conflict",...,"insightIds":[...]}}`.
  - 422 fields as for create.
- `DELETE /api/notes/{id}` (H, P) → `204`.
- `POST /api/notes/{id}/status` (H, P) `{"to":"processed"|"unprocessed"}` → `200 {"note":Note}`. `409 invalid_transition`.
- `POST /api/notes/{id}/snooze` (H, P) `{"until":"YYYY-MM-DDTHH:MM"}` (workspace-local, no offset) → `200 {"note":Note}`. `409 invalid_transition`. 422 field `until`.
- `POST /api/notes/{id}/attachments` (Any), multipart field `file` → `201 {"attachment":Attachment}` (status `pending` when storage is unreachable).
  - The file may be at most 10,000,000 bytes (equal is allowed), or `413`.
  - Extensions (ignoring case) `.txt`, `.vtt`, `.pdf`, `.png`, `.jpg`, `.jpeg` are accepted. Any other extension, or none, gets `415`.
  - Bytes that fail the content check in Business rules get 422 field `file`.
- `GET /api/attachments/{id}` (Any) → `200` with the file bytes and these headers:
  - `Content-Type`: the canonical type from Business rules;
  - `X-Content-Type-Options: nosniff`;
  - `Content-Disposition: attachment; filename="<fallback>"; filename*=UTF-8''<encoded>`.
    - `<fallback>` is the display filename with every non-ASCII character, `"` and `\` replaced by `_`.
    - `<encoded>` is the display filename as UTF-8 bytes, percent-encoded with uppercase hex, leaving only ASCII letters, digits and ``!#$&+-.^_`|~`` unencoded.
    - For example, `Ränder call.vtt` gives `filename="R_nder call.vtt"; filename*=UTF-8''R%C3%A4nder%20call.vtt`.
  - Errors: pending → `409 attachment_pending`. Storage unreachable → `503 storage_unavailable`. An attachment of a deleted note is `404`.

**Insights**
- `POST /api/insights` (H, P) `{"noteId","featureId","start","end","importance"}` → `201 {"insight":Insight,"feature":FeatureSummary,"before":{"impact","priority","rank"}}`. `409 duplicate_insight`. 422 fields `noteId`, `start`, `end`, `featureId`, `importance`.
- `PATCH /api/insights/{id}` (H, P) `{"importance"}` → `200 {"insight":Insight,"feature":FeatureSummary,"before":{...}}`.
- `DELETE /api/insights/{id}` (H, P) → `200 {"feature":FeatureSummary,"before":{...}}`.

**Hierarchy, features and scores**
- `GET /api/hierarchy` (Any) → `200 {"products":[{"id","name","components":[{"id","name","features":[FeatureSummary plus "subfeatures":[{"id","name","status"}]]}]}]}`. Archived features are excluded.
- `POST /api/products` (H, P) `{"name"}` → `201 {"product":{"id","name"}}`.
- `POST /api/components` (H, P) `{"productId","name"}` → `201 {"component":{"id","productId","name"}}`.
- `POST /api/features` (H, P) `{"componentId","name","publicDescription","parentFeatureId"}` → `201 {"feature":FeatureSummary}`.
  - `parentFeatureId` is optional and creates a subfeature.
  - A new feature starts as `candidate`, effort 5, confidence 50, every fit 0, version 1.
  - 422 fields: `name` (1–120 characters after trimming, unique as in Business rules), `publicDescription` (at most 500 characters), `parentFeatureId` (must be a top-level feature in the same component).
- `GET /api/features?q=<text>` (Any) → `200 {"features":[FeatureSummary]}` in rank order: non-archived, top-level, own workspace only. When `q` is given, the name must contain it, ignoring case, with every character matched literally. 422 field `q` when it is over 100 characters. This feeds the feature picker.
- `GET /api/features/{id}` (Any) → `200 {"feature":FeatureSummary plus "requestedBy":[{"companyId","companyName","insightCount"}],"insights":[Insight],"subfeatures":[...],"scoreVersions":[{"version","effort","confidence","fits","priority","savedAt","savedBy"}]}`.
  - `scoreVersions` is newest first. `savedBy` is the saving member's user id, or null for seeded versions.
- `PATCH /api/features/{id}` (H, P) `{"name","publicDescription"}` (either) → `200 {"feature":FeatureSummary}`. 422 fields `name` (the name clash copy from Feedback states when taken) and `publicDescription`.
- `PATCH /api/features/{id}/scores` (H, P) `{"version","effort","confidence","fits"}` (`version` required, the others optional) → `200 {"feature":FeatureSummary}`.
  - `409 {"error":{"code":"version_conflict",...,"current":{"version","effort","confidence","fits","priority"}}}`.
  - 422 fields `version`, `effort`, `confidence`, `fits`.
- `POST /api/features/{id}/status` (H, P) `{"to"}`, where `to` is a status or `"restore"` → `200 {"feature":FeatureSummary}`. `409 invalid_transition` with `"from"` and `"to"` keys. `409 release_frozen`.

**Objectives**
- `GET /api/objectives` (Any) → `200 {"objectives":[{"id","name","weight"}]}`.
- `POST /api/objectives` (H) `{"name","weight"}` → `201 {"objective":{...}}`.
- `PATCH /api/objectives/{id}` (H) `{"name","weight"}` → `200 {"objective":{...}}`.
- Both objective writes: 422 field `weight` (whole number 0–100).

**Releases and roadmap**
- `GET /api/roadmap` (Any) → `200 {"timeZone","unscheduled":[{"id","name","status"}],"columns":[{"month","label","releases":[Release plus "features":[{"id","name","status","position"}]]}]}`.
- `POST /api/releases` (H) `{"name","targetDate","isPublic"}` → `201 {"release":Release}`.
- `PATCH /api/releases/{id}` (H), same fields → `200 {"release":Release}`. `409 release_shipped`.
- `GET /api/releases/{id}` (Any) → `200 {"release":Release}`.
- `POST /api/roadmap/moves` (H, P) `{"featureId","toReleaseId","toIndex","expectedOrderVersions":{"<releaseId>":<orderVersion>}}`.
  - `toReleaseId` null means Unscheduled. `toIndex` is 0-based.
  - Expected versions are required for every release the move touches (the source release, the target release, or both).
  - → `200 {"releases":[{"releaseId","orderVersion","featureIds"}]}`, one entry per touched release.
  - Errors:
    - `409 {"error":{"code":"order_conflict",...,"current":[{"releaseId","orderVersion","featureIds"}]}}`, where `current` lists every touched release, stale or not;
    - `409 feature_not_planned`;
    - `409 release_shipped`;
    - `403 forbidden` for a frozen scope change by P;
    - `503 storage_unavailable`;
    - 422 fields `featureId`, `toReleaseId`, `toIndex`, `expectedOrderVersions`.
- `POST /api/releases/{id}/freeze` (H) → `200 {"release":Release}`. `409 invalid_transition`. `503 storage_unavailable`.
- `POST /api/releases/{id}/ship` (H), header `Idempotency-Key` (1–200 printable ASCII characters) → `200 {"release":Release,"emailsQueued":<n>}`.
  - `409 invalid_transition` (open release). `409 release_shipped`.
  - `422 idempotency_key_reused`. 422 field `Idempotency-Key` when the header is missing or malformed.

**Share links and public roadmap**
- `GET /api/roadmap/share-links` (H) → `200 {"shareLinks":[ShareLink]}`, newest first, including expired and revoked links.
- `POST /api/roadmap/share-links` (H) `{"expiresInSeconds"}` (optional whole number 30–31,536,000, both ends allowed; omitted or null means no expiry) → `201 {"shareLink":ShareLink}`. 422 field `expiresInSeconds`.
- `POST /api/roadmap/share-links/{id}/regenerate` (H) → `200 {"shareLink":ShareLink}`: same id, new token, new window. `409 link_revoked`.
- `DELETE /api/roadmap/share-links/{id}` (H) → `204`.
- `GET /api/public/roadmap/{token}` (public) → `200 {"columns":[{"month","label","releases":[{"name","targetMonth","features":[{"name","publicDescription"}]}]}]}`, exactly these keys.
  - An inactive or unknown token → `404 {"error":{"code":"link_inactive",...}}`.
  - Any other method on `/api/public/...` → `405 method_not_allowed`.
- `GET /r/{token}` (public) → `200` HTML page. Inactive or unknown → `404` HTML page with the inactive heading from Feedback states.
- Every response from `/api/public/roadmap/...` and `/r/...` carries `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`, on every status, `405` included.

**Companies, search, import, export, invitations**
- `GET /api/companies` (Any) → `200 {"companies":[Company]}`, name A–Z ignoring case.
- `GET /api/companies/{id}` (Any) → `200 {"company":Company plus "requests":[{"featureId","featureName","status","releaseName","targetMonth","shipped"}]}`.
- `POST /api/companies/{id}/merge` (H, P) `{"intoCompanyId"}` → `200 {"company":Company}` (the target). 422 field `intoCompanyId`.
- `GET /api/search?q=<text>` (Any) → `200 {"notes":[{"id","title","snippet"}],"companies":[{"id","name","domains"}],"features":[{"id","name","insightCount","companyCount"}]}`. 422 field `q`.
- `POST /api/imports` (Any) `{"csv","dryRun"}` → `200` when `dryRun` is true, `201` when false, each with `{"dryRun","totals":{"rows","created","matched","skipped","notes","companiesCreated"},"rows":[{"line","outcome","reason","noteId"}]}`. 422 field `csv`.
- `GET /api/exports/features.csv` (H) → `200 text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="evidence-desk-features.csv"`.
- `POST /api/invitations` (H) `{"email","role"}` → `201 {"invitation":{"id","email","role","expiresAt"}}`. `409 already_member`.
- `GET /api/invitations/{token}` (public) → `200 {"email","role","workspaceName"}`. `410 invitation_replaced`. `410 invitation_used`. `410 invitation_expired`. An unknown token is `404 not_found`.
- `POST /api/invitations/{token}/accept` (public) `{"name","password"}` → `201 {"user":User}` and signs the new member in. `410` and `404` as for `GET`. 422 fields `name` (1–80 characters) and `password` (at least 12 characters).

### Business rules (DP-02, DP-03, DP-05, DP-08, DP-10, DP-11, DP-16, DP-17, DP-18, DP-19, DP-23, DP-24, DP-25, DP-26, DP-27, DP-29, DP-30, DP-31, DP-33, DP-34, DP-35, DP-45, DP-46, DP-47, DP-48, DP-49, DP-50, DP-51, DP-53)

**Workspace scope.** Every member belongs to exactly one workspace, and account emails are unique across the product. Every read, search, picker, count, total, export, email and share page uses only the requesting member's workspace (or, for a share link, the link's workspace). Records from another workspace behave exactly like ids that do not exist.

**Note body allowlist.**
- On every save (create, edit, import, seed), the body is reduced to these elements: paragraph, line break, strong, b, em, i, u, unordered and ordered lists, list item, blockquote, code, pre and link.
- The only attribute kept is `href` on links, and only when it starts with `http:`, `https:` or `mailto:`, ignoring case. Otherwise the link keeps its text and loses `href`. Links are stored with `rel="noopener noreferrer nofollow"`.
- Other elements are removed and their text is kept. The exceptions are `script`, `style`, `iframe`, `object`, `embed`, `template`, `noscript`, `svg` and `math`, which are removed along with everything inside them.
- Comments are removed.
- The stored and returned `body` is the reduced form. Imported feedback is plain text placed in one paragraph.

**Plain text and offsets.**
- A note's `text` is its reduced body with entities decoded.
- Each line break, and each boundary between block elements (paragraph, list item, blockquote, pre), becomes exactly one newline.
- Outside `pre`, runs of whitespace collapse to one space and each block is trimmed. There is no leading or trailing newline.
- Offsets count positions in `text` in UTF-16 code units.
- An insight's `quote` is always `text` from `start` up to but not including `end`.

**Insights.**
- `start` and `end` are whole numbers with 0 ≤ `start` < `end` ≤ the length of `text`. Neither may fall between the two halves of a surrogate pair (422 on that field).
- The quote holds at least one non-space character and at most 2,000 characters.
- The feature must be a non-archived top-level feature in the workspace (subfeatures take no insights). An archived feature or a subfeature gets `422` field `featureId`.
- Linking the same note, span and feature again gives `409 duplicate_insight`. Of several identical links sent at the same time, exactly one gets `201` and every other gets that `409`.
- Spans may overlap when they link to different features.
- An insight's company is its note's contact's company at read time, or none.

**Highlights through edits.** When a note body changes, each insight is checked in turn:
- If the new `text` has the same quote at the same offsets, the insight is unchanged.
- Otherwise, if the quote appears in the new `text`, the insight moves to the occurrence whose start is closest to the old start. The earlier occurrence wins a tie.
- Otherwise, the whole edit is rejected with `409 highlight_conflict` listing the insights that would lose their text, and nothing changes.

An insight never points at text different from its quote.

**Derived counters.** For each feature:
- `insightCount` is the number of linked insights.
- `companyCount` is the number of distinct companies among those insights. Insights without a company don't count.
- `impact` is the sum of importance points: nice to have 1, important 3, critical 5.

Every change that can affect them (link, unlink, importance change, note delete, note contact change, company merge) updates them in the same transaction, so every read equals a recomputation from the insights.

Changes touching one feature commit one after another, so for simultaneous requests:
- each response's `before` holds the values just before its own commit;
- its `feature` holds the values just after that commit;
- the `before.impact` of each response equals either the starting impact or the resulting impact of another of those responses.

An importance change or unlink that meets an insight already deleted gets `404`.

**Objective fit, priority and rank.**
- `objectiveFit` = Σ(objective weight × fit level) ÷ (3 × Σ weights). Fit levels are None 0, Low 1, Medium 2, High 3. When Σ weights is 0, `objectiveFit` is 0.
- `priority` = 100 × objectiveFit × impact × (confidence ÷ 100) ÷ effort.
- Both are computed exactly from the unrounded values and then rounded half away from zero to two decimals.
- Rank orders the workspace's non-archived top-level features by:
  1. priority, high first;
  2. then impact, high first;
  3. then current name, A–Z ignoring case.
- `rankTotal` is how many features are ranked.
- Effort is a whole number from 1 to 100. Confidence is a whole number from 10 to 100. Weights are whole numbers from 0 to 100.
- A weight change updates every feature's fit and priority on the next read. It does not change any feature's `version` or any stored score version.

**Score versions.**
- Effort, confidence and fits change only through the scores endpoint.
- A save may name any subset of objectives in `fits`. Named objectives take the new level, and every objective left out keeps its current level. A key that is not an objective of the workspace, or a level other than 0–3, gets `422` field `fits`.
- A newly created objective starts at fit 0 on every feature.
- Each successful save increases `version` by one and stores a score version holding the effort, confidence, fits, the priority computed at that commit, the time and the member. A stored priority is never recomputed later.
- A save naming any version other than the current one gets `409 version_conflict`. Its `current` is read after the winning save has committed, so every loser of one race receives identical `current` bodies.
- Of several saves sent at the same time with the same version, exactly one succeeds.
- The feature's priority always comes from committed values only.

**Note states.**
- Legal edges:
  - unprocessed → processed;
  - processed → unprocessed (reopen);
  - unprocessed → snoozed (snooze);
  - snoozed → unprocessed (automatic when the snooze ends).
- Snoozing again while snoozed replaces the time.
- Every other request (for example, snoozing a processed note or marking a snoozed note processed) gets `409 invalid_transition`.

**Snooze time.**
- `until` is read as wall-clock time in the workspace time zone and must be later than now (`422` otherwise).
- A local time skipped by a daylight-saving jump moves forward by the size of the jump. A local time that occurs twice uses the first occurrence.
- `snoozedUntil` is returned in UTC. From that instant on, every read reports the note as `unprocessed` with `snoozedUntil` null.
- For example, with the seed data at start (Tallyrun is in America/New_York), `2027-03-14T02:30` gives `2027-03-14T07:30:00Z`, and `2027-11-07T01:30` gives `2027-11-07T05:30:00Z`.

**Inbox pages.**
- A status list is ordered by `createdAt`, newest first, then by `id` in descending byte order. This is a strict order with no ties.
- A page holds at most `limit` notes. `nextCursor` is null exactly when no note of that status follows the page's last note.
- The cursor encodes the last note's `createdAt` and `id` together with the status, and the next page starts strictly after that position.
- A note created after an earlier page was served is newer than that position, so it never appears on a later page of the same walk.
- Walking every page of a status returns each note that kept that status throughout the walk exactly once, whatever the ties in `createdAt` and whatever was created or deleted in between.
- A note whose snooze has ended is listed under Unprocessed at its own `createdAt` position.
- `counts` holds the total number of notes in each status at the moment of the read, never page sizes.

**Feature status.**
- Legal edges:
  - candidate → planned;
  - planned → in_progress;
  - any non-archived status → archived (the prior status is remembered);
  - restore: archived → the remembered status.
- A feature becomes released only when its release ships.
- Every other edge gets `409 invalid_transition`. This includes any manual move to released, planned → candidate, and restoring a feature that is not archived.
- Archiving a feature in an open release removes it from that release, and restore does not put it back.
- Archiving a feature in a frozen release gets `409 release_frozen`.
- A released feature can be archived and stays in its shipped release's history.

**Feature names.**
- Names are trimmed. They are unique per workspace ignoring case, among all features and subfeatures, archived included. A clash on create or rename gets `422` field `name`.
- A name may start with any character, including `=`, `+`, `-` and `@`.
- On the next read after a rename, the new name appears on every live surface:
  - ranking and rank tie-breaks;
  - hierarchy and picker;
  - search;
  - export;
  - feature detail;
  - company `requests`;
  - roadmap board;
  - public roadmap.
- Two things keep their history:
  - stored scope snapshot objects keep the names they had when written;
  - outbox rows keep the content rendered when they were written (see Services), so renaming after a ship never changes an email already queued.
- A shipped release's immutability covers its membership, order and release fields. The names and public descriptions of its features stay editable.

**Releases.**
- Legal edges: open → frozen (freeze), frozen → shipped (ship).
- Freezing a release that is not open, or shipping an open release, gets `409 invalid_transition`.
- Any change to a shipped release gets `409 release_shipped`: an edit, a move in or out, a reorder, a freeze, or a ship under a new key.
- Roadmap columns group releases by the month of `targetDate`, which is a calendar date in the workspace time zone. `targetMonth` is that `YYYY-MM`, and the label is the English month name and year.

**Freeze and scope.**
- Freezing writes scope snapshot version 1 to storage first. Only then is the release marked frozen with `snapshotVersion` 1. If storage cannot confirm the write, the response is `503 storage_unavailable` and the release stays open.
- While frozen, only the head of product may move features into or out of the release (`403` for others). Each such change writes the next snapshot version before it commits, with the same `503` rule.
- A feature moved out of a frozen release goes to Unscheduled (or to its target release) with its status unchanged.
- Reordering inside a frozen release is open to H and P and writes no snapshot.

**Board order.**
- Each release keeps an ordered list of features and an `orderVersion` that starts at 1 and goes up by one on every order or membership change.
- A move must carry the current `orderVersion` of every release it touches. If any one of them is outdated, the move gets `409 order_conflict` and changes nothing.
- Of simultaneous moves carrying the same versions, exactly one succeeds and the rest get that `409`.
- The roles, release states and statuses are checked in the precedence order from API. For example, a product manager moving a feature out of a frozen release gets `403` even when its versions are outdated.
- Only planned or in-progress features may join a release (`409 feature_not_planned`).
- `toIndex` must be from 0 to the target's length after removal (`422`).
- Unscheduled is always in rank order. A move into it ignores `toIndex` and needs no version for it.
- Positions shown to users are 1-based.

**Ship and idempotency.**
- In one transaction, shipping:
  - marks every feature in the release's latest scope snapshot `released`;
  - sets `shippedAt`;
  - writes one outbox email per distinct contact whose notes hold insights on any of those features.
- Each email lists only that contact's requested features from the release, in the release's board order at ship time.
- A feature removed before shipping is not released, and a contact whose only requests were removed features gets no email.
- `emailsQueued` and `<n>` count these emails.
- `emails.queued` is the number of that release's outbox rows, and `emails.sent` the number of those rows marked sent. Both are read live, so `sent` reaches `queued` once mail has drained them.
- An `Idempotency-Key` is scoped to the workspace and kept indefinitely.
  - Repeating a key for the same release returns the stored status and body unchanged, ahead of any state check.
  - Using a key already used for a different release gets `422 idempotency_key_reused`.
  - A new key on an already shipped release gets `409 release_shipped`.
- Of simultaneous ship requests with different keys, exactly one gets `200`. No contact ever receives two emails for the same release.

**Customer request status.**
- A company's `requests` lists each feature that has at least one insight from that company's notes, once, with its current name and status.
- When the feature is released, the entry also gives the release name and target month, and `shipped` is true.
- A company's `noteCount` is the number of existing notes whose contact belongs to it.

**Deletion and merge.**
- Deleting a note deletes its insights, its attachments and any kept pending bytes in the same transaction. From the response on, the note is gone from every surface:
  - its own URL and its attachments' URLs (`404`);
  - inbox lists and counts;
  - search;
  - every feature's counters, `requestedBy` and linked quotes;
  - export top quotes;
  - its company's `noteCount` and `requests`;
  - the recipients of any later ship.
- Its stored objects are removed as stated in Services.
- Merging company A into company B, in one transaction:
  - moves A's contacts (and so their notes and insights) to B;
  - adds A's domains to B's domains;
  - deletes A;
  - updates feature counters.
- From that response on, A's id is `404` on its own URL, A is absent from company lists, search and pickers, and every surface names B instead.
- Changing a note's contact moves its insights' company in the same transaction as the counter, `requestedBy` and `requests` updates.

**Attachments.**
- The extension decides the accepted kind. The bytes must then match it:
  - `.png`: begin with the eight bytes 89 50 4E 47 0D 0A 1A 0A;
  - `.jpg` and `.jpeg`: begin with FF D8 FF;
  - `.pdf`: begin with `%PDF-`;
  - `.txt`: valid UTF-8 with no NUL byte;
  - `.vtt`: valid UTF-8 with no NUL byte, starting (after an optional UTF-8 byte-order mark) with `WEBVTT` followed by a space, a tab, a line feed, a carriage return and line feed, or the end of the file.
- This check runs before anything is stored, whether storage is up or down. Bytes that fail it are never kept, not even as pending.
- `contentType` comes only from the extension, never from the client: `text/plain; charset=utf-8`, `text/vtt; charset=utf-8`, `application/pdf`, `image/png`, `image/jpeg`.
- The display `filename` is formed in four steps:
  1. take the last segment of the client's name after any `/` or `\`;
  2. normalise it to Unicode NFC;
  3. cut its base to keep the whole name at most 120 characters with the extension kept;
  4. use `file` when the base is empty.

  For example, `../../Ränder call.vtt` becomes `Ränder call.vtt`.

**Company and contact uniqueness.** Contact email is unique per workspace. A domain belongs to at most one company per workspace.

**Legacy import.**
- **Reading.**
  - A leading UTF-8 byte-order mark is ignored. Line endings may be LF or CRLF, mixed.
  - Fields follow standard CSV quoting, and a quoted field may contain commas, doubled quotes and line breaks.
  - The header must be exactly `contact_email,contact_name,company_name,feedback,received_on` (case and surrounding spaces ignored), otherwise `422`.
  - There may be at most 2,000 data rows (2,000 is allowed).
  - A row's `line` is the physical line on which its record starts, counting the header as line 1.
- **Skips.** Each row is checked against these reasons in this order, and the first one that applies is its reported `reason`:
  1. `missing_email`, when the email is blank after trimming;
  2. `invalid_email`, when it does not have exactly one `@` with a dot after it;
  3. `missing_feedback`, when the feedback is blank after trimming;
  4. `invalid_date`, when `received_on` is neither blank nor a real calendar date in `YYYY-MM-DD` (so `2027-02-29` is invalid);
  5. `duplicate`, when the same contact already has a note, or an earlier kept row in the file, with the same feedback (trimmed, inner whitespace collapsed) and the same `received_on` (blank counts as its own value).

  A skipped row creates nothing: no contact, no company and no note. Its `noteId` is null, and it adds nothing to `companiesCreated`.
- **Each kept row.**
  - The email is trimmed and lowercased.
  - The domain is the part after `@`, with any leading `www.` removed.
  - The contact is matched by email within the workspace, including contacts created by earlier rows of the same file. Otherwise a new contact is created with `contact_name`, or with the part before `@` when that is blank.
  - A new contact's company is found by domain among the workspace's company domains, including companies created by earlier rows of the same file. Otherwise a company is created with `company_name`, or with the domain when that is blank, and counted in `companiesCreated`.
  - Personal mail domains never match or create a company: gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, yahoo.com, icloud.com, me.com, aol.com, proton.me and protonmail.com.
  - A matched contact keeps its company.
- **Notes.** Each kept row creates one unprocessed note with source `csv_import`. The title is the feedback cut to 60 characters, with "…" added when longer. `receivedOn` is the given date or null.
- **Outcomes.** A row's outcome is `created` when it creates its contact, `matched` when the contact already existed, or `skipped`. `notes` = created + matched.
- **Dry run.** A dry run writes nothing and returns the report the real import would produce at that moment.
- **Real imports.**
  - Real imports in one workspace run one at a time: each reads and writes as if no other import were running.
  - Importing the same file twice, one after the other or at the same moment, creates each note, contact and company exactly once. The second report shows every row the first kept as `duplicate`, so the two reports' `notes` add up to the number of notes created.

**Close-the-loop content and public fields.**
- Emails and the public roadmap carry only feature name, public description, release name and target month. An email also carries the recipient's own name and the workspace name.
- They never carry note text, quotes, importance, scores, counts, or other companies' or contacts' names.

**Share links.**
- A token has at least 192 random bits written in URL-safe characters. The URL is `<APP_BASE_URL>/r/<token>`.
- `createdAt` is the creation instant truncated to whole seconds. `expiresAt` is exactly `createdAt` + `expiresInSeconds`, or null.
- A link is active while it is not revoked and server time is strictly before `expiresAt`. At `expiresAt` and after, it is expired. An inactive token is refused from the very next request.
- Regenerating an active or expired link:
  - keeps its id and gives it a new token, a new `createdAt` and `expiresAt` = new `createdAt` + its original `expiresInSeconds` (no expiry stays no expiry);
  - clears its expiry state;
  - stops the old token at once.
- Regenerating a revoked link gets `409 link_revoked`.
- Revoking sets `revokedAt`. Revoking an already revoked link answers `204` and leaves `revokedAt` unchanged.
- The public view lists, oldest month first, only months that contain public releases (any status), with non-archived features in board order. It is read-only.

**Export.**
- One header row: `rank,feature,product,component,status,release,target_month,insight_count,company_count,impact,effort,confidence,objective_fit,priority,top_quote_1,top_quote_2,top_quote_3`. Then one row per ranked feature, in rank order, with current names.
- Cell formats:
  - `rank`, `insight_count`, `company_count`, `impact`, `effort` and `confidence` are plain whole numbers (confidence without a percent sign);
  - `status` is the API value (`candidate`, `planned`, `in_progress`, `released`);
  - `objective_fit` and `priority` use the API's two-decimal form, trailing zeros kept;
  - `release` is the release name and `target_month` is its `YYYY-MM`; both cells are empty when the feature has no release.
- Top quotes are the feature's insight quotes ordered by importance (critical first), then newest insight first. Cells are empty when there are fewer than three.
- The file is UTF-8 without a byte-order mark, with CRLF line endings. Fields containing a comma, quote or line break are quoted with inner quotes doubled.
- **Formula neutralisation:** every cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return gets a single apostrophe in front, before quoting.
- For example, with the seed data at start, the row for Scheduled report emails is:
  `2,Scheduled report emails,Tallyrun Platform,Reporting,planned,March Drop,2027-03,1,1,3,5,80,0.70,33.60,wants the Monday report in their inbox automatically,,`

**Search.**
- `q` is trimmed and must then be 2–100 characters (`422` field `q` otherwise).
- Matching is case-insensitive substring, and every character of `q` matches only itself, `%`, `_` and `\` included:
  - notes by title or `text`, never by body markup;
  - companies by name or any domain;
  - features (non-archived, top-level) by name or public description.
- Groups are ordered as follows:
  - notes newest `createdAt` first, then `id` descending;
  - companies by name A–Z ignoring case;
  - features in rank order.
- Each group returns at most 10 results.
- A note's snippet is built from `text` like this:
  - It starts 40 characters before the first match in `text` (or at 0) and runs 120 characters, ending at the end of `text` if sooner.
  - When the match is only in the title, the snippet starts at 0.
  - An edge that would split a surrogate pair moves outward by one.
  - When text was cut before or after the window, a "…" is added on that side, outside the count.
- The UI shows snippets as text, never as markup.

**Invitations.**
- The email is trimmed and lowercased. An email that already has an account gets `409 already_member`.
- A new invitation to the same email replaces the earlier one. From that moment the earlier token gets `410 invitation_replaced` on both `GET` and accept.
- The token is single-use and lasts `INVITE_TTL_SECONDS`. Accepting creates the member in the inviting workspace with the invited role and signs them in.
- A second use gets `410 invitation_used`. A use at or after expiry gets `410 invitation_expired`.
- When more than one applies, `invitation_replaced` is reported first, then `invitation_used`, then `invitation_expired`.

**Sessions.** A session ends after `SESSION_IDLE_SECONDS` without a request. Signing out ends it at once.

### Services (DP-13, DP-14, DP-25, DP-27, DP-35, DP-38, DP-46)

**PostgreSQL** (`DATABASE_URL`) holds:
- workspaces and members;
- contacts, companies and domains;
- notes, highlights and insights;
- the product hierarchy;
- scores and score versions;
- objectives;
- releases and their order;
- share links;
- idempotency records;
- pending attachment bytes and pending object deletions;
- the outbox;
- an audit trail of every state change.

The schema is applied without duplication on every start. The seed is inserted when the database has no workspaces.

**Object storage** (`S3_*`, bucket `S3_BUCKET`, path-style when `S3_FORCE_PATH_STYLE` is `true`).
- **Keys.**
  - Attachments are stored under `notes/<noteId>/<attachmentId>-<safe name>`. The safe name is the display filename with every character other than ASCII letters, digits, dot, dash and underscore replaced by one `-`. For example, `Ränder call.vtt` becomes `R-nder-call.vtt`.
  - Scope snapshots are stored under `releases/<releaseId>/scope-v<snapshotVersion>.json` as `{"releaseId","name","targetDate","snapshotVersion","frozenAt","features":[{"id","name","position"}]}`.
- **Uploads.**
  - An attachment is `available` only after storage confirms the object. When storage is unreachable on upload, the app keeps the bytes in PostgreSQL and answers `201` with `pending`.
  - Every running instance polls the shared database every `ATTACHMENT_RETRY_SECONDS` for pending attachments and tries to upload each one.
  - Each instance claims a row before it tries, so no two instances work on the same attachment at the same moment. A failed attempt releases the claim for the next pass.
  - Once storage confirms the object, the status becomes `available` in the database and the kept bytes are dropped, with no restart. Pending work never depends on the instance that accepted it.
  - For example, an attachment uploaded through the storage-down instance is saved as `pending`. The main instance can reach storage, so it picks it up from the shared database. Within `ATTACHMENT_RETRY_SECONDS` plus 5 seconds, the object exists under its key and reading the note through either instance reports `available`.
- **Deletions.**
  - Deleting a note records a pending object deletion for the prefix `notes/<noteId>/` in the same transaction.
  - Every running instance drains these records on the same retry interval with the same claim rule. It deletes every object under the prefix and marks the record done only once the prefix lists empty.
  - Within `ATTACHMENT_RETRY_SECONDS` plus 5 seconds of the delete, whichever instance served it, no object remains under that prefix while any instance can reach storage.
  - A pending upload of a deleted note is never sent.
- **Outage.** A download while storage is unreachable gets the `503` from API, and the UI shows the attachment as pending.

**Mail** (SMTP at `SMTP_HOST`:`SMTP_PORT`, From header taken from `MAIL_FROM`).
- **Outbox.**
  - Every email is written to the outbox in the same transaction as its cause, with its recipient, subject, plain-text body and HTML body fully rendered at that moment. Sending never re-renders.
  - Every running instance polls the shared database every `OUTBOX_RETRY_SECONDS` for unsent outbox rows.
  - To send a row, an instance first claims it, so no other instance can work on that row at the same moment. It then hands the row to SMTP and marks it sent before releasing the claim.
  - A failed attempt releases the claim, and the row waits for the next pass by any instance.
  - A row marked sent is never sent again, so each outbox row reaches the mail sink at most once even with several instances on one database.
- **Outage.** While mail is down, ship and invite still succeed with the copy from Feedback states. The emails go out once mail is reachable again, through any instance that can reach it, with no restart.
- **You asked, we shipped.**
  - Sent to one contact per release.
  - To: the contact's name and email.
  - Subject: `You asked, we shipped: <release name>`.
  - Plain-text and HTML bodies carry the same content:
    - "Hi <contact name>,"
    - "You asked for these, and they are now live in <release name> (<month label>):"
    - one line per requested feature in the release, in board order: "<feature name> — <public description>"
    - "— The <workspace name> product team"
- **Invitation.**
  - To: the invited email.
  - Subject: `You're invited to <workspace name> on Evidence Desk`.
  - The body names the role and contains the link `<APP_BASE_URL>/invite/<token>`.

### Seed data (DP-01, DP-04, DP-10, DP-18, DP-21, DP-28, DP-34, DP-45, DP-51, DP-52)

Every seeded person, business and email domain is invented. Every seeded member's password is `evidence-desk-2026`.

**Workspace "Tallyrun"** (time zone America/New_York)
- Members:
  - Rhea Okafor `hop@tallyrun.example` (head of product);
  - Dev Malik `pm@tallyrun.example` (product manager);
  - Sasha Lind `pm2@tallyrun.example` (product manager);
  - Imani Brooks `csm@tallyrun.example` (customer success).
- Companies and contacts:
  - Northwind Freight, domain `northwindfreight.example`: Ana Ruiz `ana@northwindfreight.example`.
  - Northwind Freight Ltd, domain `nwfreight.example`: Lee Chen `lee@nwfreight.example`.
  - Orchard Lane Bank, domain `orchardlanebank.example`: Priya Nair `priya@orchardlanebank.example`.
  - Bluefin Clinics, domain `bluefinclinics.example`: Tom Becker `tom@bluefinclinics.example`.
- Objectives: "Win mid-market deals" weight 50, "Reduce churn" weight 30, "Cut support load" weight 20.
- Hierarchy: product "Tallyrun Platform".
  - Component "Reporting": features "Scheduled report emails" and "CSV export presets".
  - Component "Access": features "SAML single sign-on" (subfeature "Okta setup guide", candidate), "Audit trail viewer" and "Bulk user import".

| Feature | Public description | Status | Effort | Confidence | Fits (mid-market / churn / support) |
|---|---|---|---|---|---|
| SAML single sign-on | Sign in with your identity provider over SAML. | planned | 8 | 90 | High / Low / None |
| Scheduled report emails | Send any saved report to a list of recipients on a schedule. | planned | 5 | 80 | Medium / High / Low |
| Bulk user import | Add many users at once from a spreadsheet. | planned | 3 | 70 | Low / None / Medium |
| Audit trail viewer | See who changed what, filterable by user and date. | planned | 5 | 50 | Medium / None / Low |
| CSV export presets | Save column choices for repeat CSV exports. | candidate | 3 | 60 | Low / Low / Medium |

All features are at version 1. Each has one stored score version (version 1, `savedBy` null) whose priority is its priority at seed time, as given in the example below.

- Releases, all open, each at order version 1:
  - "March Drop", target 2027-03-15, public: SAML single sign-on, Scheduled report emails, Bulk user import, in that order.
  - "Internal Tooling", target 2027-04-05, internal, empty.
  - "April Drop", target 2027-04-20, public: Audit trail viewer.
- Notes, all unprocessed. Each body is the given text in one paragraph, except N5, which is a paragraph followed by a two-item list.
  - N1 "Weekly KPI pack", support ticket, Ana Ruiz, created 2026-10-20T14:00:00Z: "We export the KPI pack every Monday by hand. **If reports could email themselves to the ops team** we would stop asking for screenshots." The bold part is strong text.
  - N2 "Renewal blocker: SSO", sales call, Priya Nair, created 2026-10-21T15:30:00Z: "Security review blocks us until we have SAML single sign-on with Okta. This is a hard requirement for renewal."
  - N3 "Audit questions from clinic auditors", email, Tom Becker, created 2026-10-22T13:00:00Z: "Auditors keep asking who changed a patient-facing setting. We need an audit trail we can filter by user. We cut 100% of manual audit pulls last quarter."
  - N4 "Monday report for finance", support ticket, Lee Chen, created 2026-10-23T16:45:00Z: "Our finance team wants the Monday report in their inbox automatically."
  - N5 "Forwarded renewal thread", email, Priya Nair, created 2026-10-24T12:10:00Z: "Forwarded from the renewal thread:" then list items "Okta groups should map to roles" and "Export audit events weekly".
  - N6 "Clinic rota export", support ticket, Tom Becker, created 2026-10-25T09:00:00Z: "Clinic managers rebuild the staff rota by hand each week. A rota download would save them an afternoon."
  - N7 "Dock scheduling feedback", email, Ana Ruiz, created 2026-10-25T09:00:00Z: "Our dock team wants to book loading slots from the shipment list."
- Insights:
  - On N2, quote "SAML single sign-on with Okta" → SAML single sign-on, critical.
  - On N2, quote "single sign-on with Okta. This is a hard requirement" → Audit trail viewer, nice to have. It overlaps the first span.
  - On N4, quote "wants the Monday report in their inbox automatically" → Scheduled report emails, important.
- No share links and no invitations.

For example, with the seed data at start:
- The Unprocessed tab counts 7 notes. N6 and N7 share a creation time.
- N2 renders three marks: "SAML " (first insight), "single sign-on with Okta" (both insights) and ". This is a hard requirement" (second insight).
- Feature values:

  | Feature | Insights | Companies | Impact | Fit | Priority | Rank |
  |---|---|---|---|---|---|---|
  | SAML single sign-on | 1 | 1 | 5 | 0.60 | 33.75 | 1 of 5 |
  | Scheduled report emails | 1 | 1 | 3 | 0.70 | 33.60 | 2 |
  | Audit trail viewer | 1 | 1 | 1 | 0.40 | 4.00 | 3 |
  | Bulk user import | 0 | 0 | 0 | — | 0.00 | 4 |
  | CSV export presets | 0 | 0 | 0 | — | 0.00 | 5 |

- Linking N1's quote "If reports could email themselves to the ops team" to Scheduled report emails as important makes it 2 insights, 2 companies, impact 6, priority 67.20, rank 1 of 5. The announcement reads "Linked to Scheduled report emails; impact 3 → 6; now rank 1 of 5".
- Merging Northwind Freight Ltd into Northwind Freight then gives that feature 1 company.
- Shipping March Drop queues 2 emails: Priya Nair (SAML single sign-on only) and Lee Chen (Scheduled report emails only).
- Saving effort 2 on Scheduled report emails at version 1 (confidence 80 and fits unchanged) gives version 2, priority 84.00 and rank 1 of 5, and SAML single sign-on moves to rank 2.
- A search for `0%` finds N3 as its only note. A search for `strong` finds no note.

**Workspace "Quarry Labs"** (time zone Europe/Berlin)
- Members: Mara Voss `hop@quarrylabs.example` (head of product), Ollie Grant `pm@quarrylabs.example` (product manager).
- Company Saltmarsh Media, domain `saltmarsh.example`, with contact Jo Park `jo@saltmarsh.example`.
- Objective "Grow enterprise", weight 100.
- Product "Quarry Studio", component "Exports", feature "Audit log export" (public description "Weekly audit log files", planned, effort 4, confidence 70, fit High).
- Release "Q2 Exports", target 2027-05-10, public, open, containing it.
- Note "Weekly audit files", email, Jo Park, unprocessed: "We need the audit log export as CSV every week." It has an insight with quote "audit log export as CSV every week", critical.

None of Quarry Labs' records may appear anywhere in Tallyrun, and the reverse also holds.

## Technical requirements

### Deployment (DP-39)

- The runtime is Node.js 22 LTS, with TypeScript as the source language.
- The root of `/app` holds `run.json` with string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:
  `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`.
- The server listens on `0.0.0.0` at the port in `APP_PUBLIC_PORT`, or 4173 when that is unset.
- `GET /api/health` answers `200 {"status":"ok"}` once the server accepts requests, including while object storage or mail is unreachable.
- Outage instances run the same build at the same time as the main instance:
  - They use the same PostgreSQL database, object storage bucket and mail sink. Only one dependency's address points at a dead port.
  - All data is shared, so a request to any instance sees the same records.
  - Pending attachments, pending object deletions and outbox rows are picked up from the database by whichever instance can reach the service, as described in Services.

### Configuration and secrets (DP-44)

These are read from the environment at start:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`
- `MAIL_FROM`, the From line of every email. The environment sets it to `Loomwise Evidence Desk <updates@loomwise.example>`, and the app uses that same value when it is unset.
- `APP_PUBLIC_PORT`
- `APP_BASE_URL`, default `http://localhost:<port>`
- `ATTACHMENT_RETRY_SECONDS`, whole seconds 1–60, default 10
- `OUTBOX_RETRY_SECONDS`, whole seconds 1–60, default 10
- `INVITE_TTL_SECONDS`, default 604800
- `SESSION_IDLE_SECONDS`, default 43200

No credential or service URL is written in source, and none reaches the browser in any page, script, response or header.

### Server boundary (DP-38)

- The app is same-origin only. It sends no cross-origin sharing headers. A state-changing request whose `Origin` header is present and differs from the app's own origin gets `403 cross_origin`.
- Body limits are those in API.
- The server never serves anything outside the built client assets and the routes in this brief. Such paths get `404`, including:
  - source files and source maps;
  - `run.json`, `package.json` and lockfiles;
  - `.env` files;
  - dependency folders.
- Every HTML page carries a content security policy that allows scripts, styles, fonts and images only from the same origin, and no inline scripts. The public roadmap's extra headers are listed in API.
- The session cookie is HttpOnly.
- At boot the server waits for PostgreSQL, retrying every 2 seconds. It does not wait for object storage or mail: it starts, serves, and uses each dependency once it answers.
- With the seed data, a search with a 100-character query answers within 1 second.

### Browser support and performance (DP-40, DP-41)

- Supported browsers: current Chromium, Firefox and WebKit at 375×812, 768×1024 and 1280×800.
- With the seed data, the inbox, ranking table and roadmap board are usable within three seconds of navigation. A link commit is confirmed within one second.
- Fonts are self-hosted, and pages make no requests to other hosts.

## Working rules

- IF-01: `/app/run.json` exists with string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and those commands are the only way the app is installed, built and started.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence. Shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json` (the lockfile's non-dev group).
- IF-03: Every shipped package and bundled font uses MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1.
- IF-04: The only datastores are the provided PostgreSQL database and object storage bucket. No SQLite, embedded key-value store, Redis or data files are used as storage.
- IF-05: Provided service configuration (compose fragments, service images, seeded credentials) is used as given and left unmodified.
- IF-06: Application source, server and client, is TypeScript. JavaScript files appear only as build output or tool configuration.
- IF-07: Icons come from Lucide, and all illustration is SVG generated by the app. No stock or downloaded imagery.
- IF-08: Pages load no scripts, styles or fonts from other hosts.

## Engineering standards

- The code is idiomatic TypeScript in strict mode, with no explicit `any` and no suppressed type errors.
- Names in code match the domain terms in this brief: note, highlight, insight, importance, feature, subfeature, component, product, objective, weight, fit, impact, priority, rank, score version, release, scope snapshot, share link, outbox, company merge, cursor.
- Each domain rule is decided in exactly one place in the source and reused everywhere else it applies:
  - the note-body allowlist, plain-text offsets and highlight segmentation;
  - re-anchoring and the derived counters;
  - the priority formula and ranking;
  - each state machine and share-link activity;
  - the inbox order and cursor;
  - import matching and skip reasons, the attachment content check and filename rule;
  - formula neutralisation, the search match and snippet window;
  - the error precedence.
- No interface, wrapper or factory exists with only a single implementation.
- The code has no dead, commented-out or unreachable code, and no TODO stubs.
- Input is validated once, at the API boundary. Inside the domain there are no defensive checks for states the rules make impossible.
- Every API error is built from one error shape. No handler writes its own ad hoc error body.
- The app has no features, endpoints, screens or settings beyond this brief.
