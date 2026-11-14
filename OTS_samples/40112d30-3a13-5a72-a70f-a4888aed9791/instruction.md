# Mothlight Works Nightform

Nightform, by Mothlight Works, is an online form builder for people who collect sign-ups, orders, applications and feedback on their own. An owner builds a multi-page form from short text, long text, number, choice, checkbox, dropdown, grid, ranking, scale, date and file-upload questions. The owner then adds logic: pages and questions that are shown or skipped based on earlier answers, calculated fields written in a small published formula language, earlier answers inserted into later wording, and checks that compare one answer with another. Respondents fill the form on a phone, tablet or desktop by touch, mouse or keyboard. They fix errors from a linked summary, can save part-way and resume on another device from an emailed link, and get an email copy of what they sent. Owners publish numbered editions, set a closing time and a response limit, edit drafts live with invited co-editors, watch a live summary and export CSV. Before anyone fills the form in, the builder's signature view, the Lit path, shows the exact pages and questions a respondent with given trial answers will see. One logic engine on the server decides visibility, page order, calculated values, insertions, checks, closing and limits. The browser only shows what the server sends. The backend uses four services and nothing else: Postgres stores everything, Valkey orders and fans out live changes and holds rate-limit counters, MinIO stores file answers and CSV exports, and Mailpit receives every email. Out of scope: any datastore beyond these four, outside sign-in (accounts are email and password only), payments or paid plans, AI question writing, themes or add-ons, response routing, inbox triage, comment threads, quarantine, and any external asset loaded at runtime. Every form, person and business named in this brief is invented.

## Problem and users

Solo founders, small-club secretaries, independent teachers and one-person event runners collect what they need through free form builders, and those tools fail them in ways that cost money and goodwill. A respondent without an account cannot save a long application and finish it on another device, so half-finished applications are lost. Branching and calculated totals are hard to check before publishing, so a price formula or a skip rule quietly sends people down the wrong path, and the owner hears about it from angry emails. A limit of 40 places lets a 41st person in when two people press Submit together. A file answer shows as uploaded when the storage write never finished. A respondent who types a spreadsheet formula into a text box turns the owner's CSV export into an attack on the owner's spreadsheet. Owners pay for this with premium tiers at tens of dollars a month, or with hours spent reconciling spreadsheets and refunding over-booked places.

- **Form owner** (daily): builds a multi-page form with branching, calculated totals and cross-answer checks, publishes it with a closing time and a response limit, watches the live summary and exports responses.
- **Co-editor** (weekly): edits the same draft live alongside the owner without overwriting the owner's changes, and checks the logic with trial answers.
- **Respondent** (occasional): fills a form on phone, tablet or desktop by touch, mouse or keyboard, fixes errors from a linked summary, saves part-way and resumes on another device from an emailed link, and receives an email copy of what was sent.

## Journeys

1. **Build and check a branching form by keyboard.** An owner starts from an empty draft with three titled pages. Using only the keyboard, they add a choice question and a number question through the Add question dialog, give page 2 a named show rule, see a mistyped formula refused with its column, and type trial answers so that the Lit path lights page 2 or skips it with the rule's name. They move a question with Alt+Arrow and publish edition 1. In a second browser, a respondent walks the form and sees `Page 2 of 2` when page 2 is skipped.
2. **Change your mind going back.** A respondent fills the Supper club form up to Travel, goes back, lowers the guest count, and sees Travel drop out, the page count shrink and a notice saying one answer will not be sent. Raising the count brings Travel and the parking answer back. Answering that they are not coming jumps to the last page. They submit, and the owner's response view lists only the answers that count.
3. **Price a pre-order.** A respondent fills the Bakery pre-order. Each answer updates the subtotal, discount, total and per-person share to the penny, a large-order question appears once the total reaches the threshold, and the hidden margin field never reaches the page or the email copy.
4. **Fix errors from the summary.** A respondent presses Next on the Trip and Budget forms with several mistakes. The error summary takes focus, each link takes them to the field, a percentage budget of 33.3 three times reports that it totals 99.9, and 70.1, 29.8 and 0.1 passes.
5. **Fill by keyboard or by touch.** One respondent completes grid, ranking, scale and date questions with only the keyboard. Another, on a phone, uses stacked grid cards, the date sheet, the ranking Move buttons and a file upload that shows as attached only once it is stored. The owner then downloads the same file.
6. **Save on one device, finish on another.** A respondent saves part-way and gets an email link. They open it on a second device, which takes over the response, while the first device is told the response moved. They finish and submit, and the link then reports that the response was already sent. If the owner publishes a changed edition in the meantime, the link moves the answers onto it and lists any that no longer apply.
7. **Watch responses arrive and close on time.** An owner watches the live summary update as two respondents submit, deletes one response, and exports CSV with spreadsheet formulas neutralised. When the closing time passes or the last place is taken, respondents who still have the form open see the closed panel without doing anything, and the count never passes the limit.
8. **Edit together.** The owner and an invited co-editor see each other's presence. Their changes to different fields both land in the same order on both screens. When both change the same label at once, the later change wins and the other editor is told whose version was kept.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Form definition** The owner API stores, returns and validates forms in the published form definition shape, and refuses a malformed definition with 422 as listed in API.
- **DP-02 — Builder by keyboard** An owner adds questions through the Add question dialog and reorders them with Alt+ArrowUp and Alt+ArrowDown using only the keyboard, with the focus moves and announcements given in Interactions.
- **DP-03 — Rules and jumps** The Logic pane saves named show rules and jumps for the selected page or question, and a refused formula shows its exact refusal in `#formula-error` with focus kept in the box.
- **DP-04 — Formula refusals and bounds** Every formula and insertion is checked at save time against the published refusal list, including the 500-character, 16-level and earlier-questions-only limits, and the answer arrives within one second.
- **DP-05 — Lit path** Trial answers in the builder light and skip page-map items, and show `Skipped by` lines, trial values and the path announcement exactly as the server's trial evaluation returns them, discarding any older reply.
- **DP-06 — Publishing editions** Publish turns the draft into the next numbered edition, is refused while the draft has formula problems, and never changes what live respondents see until it succeeds.
- **DP-07 — Page walk** The server decides which pages and questions are shown, in which order and with which page count, by the walk in Respondent rules, matching the Supper club table.
- **DP-08 — Hidden answers** An answer on a hidden page or question is kept in the part-done response, counts as blank everywhere, returns when shown again and is discarded on submit.
- **DP-09 — Path notice** When a commit hides or brings back answered questions, the respondent sees and hears the counted path notice.
- **DP-10 — Page moves** Next, Back and Submit replace the page at once, move focus to the page heading, announce the page and set the document title.
- **DP-11 — Submit once** Submit carries an idempotency key, so a double activation or a replay creates one response and one email copy, and a reused key with another body is refused with 409.
- **DP-12 — Email copy** A submitted response with a copy address queues one email copy in the same transaction, listing shown questions with filled-in labels and leaving out hidden calculated fields and internal notes.
- **DP-13 — Supper club walk** A respondent walks the Supper club form forward and back, sees pages appear and disappear with the right page counts and notices, and submits, and the owner's response view lists only the answers that count.
- **DP-14 — Exact arithmetic** Formulas compute with exact decimals, the published operator precedence and the published rounding, matching every arithmetic and rounding table in Formula language.
- **DP-15 — Functions and blank answers** Every published function, the blank rules and the truth rule give the published results, and a failure shows its published reason.
- **DP-16 — Calculated display** A calculated field shows its value with its places, prefix and suffix, or the not-calculated text when blank, and later formulas use the unrounded value.
- **DP-17 — Live calculated fields** On the Bakery form each commit updates every shown calculated field, announces changed values and applies rules that use them, while a hidden field never appears and a late reply is ignored.
- **DP-18 — Answer insertion** `{{key}}` in labels, help, page titles and check messages inserts the effective answer as plain text by the published display rules, or the not-answered text when the answer is blank or hidden.
- **DP-19 — Inserted text on screen** Inserted text updates on each commit, changes everywhere when an earlier answer changes, and appears in accessible names and error messages.
- **DP-20 — Field checks** Next and Submit run the published checks in order and report only the first failing check per question with its exact message.
- **DP-21 — Cross-answer checks** A form-level check reports its message against its target only when all its inputs are shown, answered and free of errors, and exact decimals decide it.
- **DP-22 — Error summary** A failed Next or Submit shows the focused error summary with one link per error in page order, inline messages, the title prefix and the alert, and each link moves focus to its field as published.
- **DP-23 — Grid keyboard** On wide screens a grid question is one tab stop that arrow, Home, End and Ctrl keys move through, and only Space or Enter selects.
- **DP-24 — Ranking keyboard** A ranking item is picked up, moved, dropped or put back by keyboard, or moved by its buttons, with the exact announcements and focus kept on the item.
- **DP-25 — Scale keyboard** A scale question is one radio group in which arrow, Home, End and digit keys choose a number without wrapping.
- **DP-26 — Date picker** The Choose a date dialog opens on the right day, moves by the published keys, refuses days outside the allowed range, keeps focus inside and returns focus to its button.
- **DP-27 — Shuffled options** Shuffled choice and checkbox options appear in the published hash order for every respondent, while the summary and exports keep definition order.
- **DP-28 — Keyboard-only fill** A respondent completes grid, ranking, scale and date questions and the error summary using only the keyboard, and the stored answers match what was chosen.
- **DP-29 — Phone respondent layout** At 767 pixels wide or less a grid becomes one card per row, the date picker becomes a full-width sheet, every target is at least 44 by 44 pixels and nothing scrolls sideways.
- **DP-30 — File answers** A file answer counts as attached only after storage confirms the object, is stored byte for byte, and can be downloaded only by the form's owner and co-editors.
- **DP-31 — Storage outage** When storage is unreachable, an upload shows the published failure and attaches nothing, other answers stay, a required file blocks Next, and Export CSV shows its own failure.
- **DP-32 — Phone fill with upload** A respondent on a phone fills the date, grid, ranking and file questions by touch and submits, and the owner downloads the same file.
- **DP-33 — Save and finish later** Save and finish later commits the page, emails one resume link with its expiry and shows the published status, or the queued notice when mail cannot be delivered.
- **DP-34 — Resume window** A resume link works until exactly the resume window after the last save, is refused one second later with the expired page, and each save moves the expiry.
- **DP-35 — One device at a time** Opening a resume link moves the part-done response to that browser, and the browser that lost it is refused with 409 and disabled controls without overwriting anything.
- **DP-36 — Private part-done responses** A part-done response can be read only through its own device or link, never by the form's owner or anyone else, and its link stops working once it is submitted.
- **DP-37 — Resume onto a newer edition** A link opened after a newer edition went live moves the response to that edition, keeps only answers that are still valid, and shows the published change notice on the published page.
- **DP-38 — Responses pinned to editions** Every submitted response always shows the wording, options and calculated results of the edition it was submitted against.
- **DP-39 — Edition change journey** An owner publishes a changed edition while one respondent is mid-form and another holds a resume link, and each respondent sees and submits the edition the rules give them.
- **DP-40 — Summary numbers** The summary's counts, percentages, means and mean positions match the stored submitted responses under the published rounding, across all editions and after deletions.
- **DP-41 — Live summary** An open summary updates its count, tables, chart bars and announcement within 2 seconds of a submit or delete without a reload, and agrees with itself after a reload.
- **DP-42 — CSV export** Export CSV stores the file in object storage and serves it with the published columns, row order, encoding and cell formats.
- **DP-43 — CSV formula neutralising** Text cells beginning with `=`, `+`, `-`, `@`, tab or carriage return get a leading `'` in every export, as qualified in CSV export.
- **DP-44 — Closing rules** The server clock and the submitted count decide whether a form is open, so a submit at or after the closing time is refused whatever the browser shows, and closing and reopening follow the form state machine.
- **DP-45 — Response limit** Submissions for the last places are settled one at a time in one transaction, so concurrent submits never accept more responses than the limit.
- **DP-46 — Closed panel** A respondent who opens a closed form, or has it open when it closes, sees the closed panel with focus on its heading and the published texts, arriving live within 2 seconds.
- **DP-47 — Invitations** An owner invites a co-editor by email with a single-use link that expires after the invitation window, and the reply never reveals whether the email has an account.
- **DP-48 — Live co-editing** Every co-editing change gets one server order from the form's sequence, every open builder on any app instance applies changes in that order within 2 seconds, and presence is shown.
- **DP-49 — Same-field conflicts** When two editors change the same field from the same revision, the later change in server order wins, and the earlier editor sees the value replaced and the published notice with focus unmoved.
- **DP-50 — Co-editor access** Co-editors can edit, try out and read a form but cannot publish, change settings, invite or delete, and a closed form's builder answers 404 to them while the owner keeps it.
- **DP-51 — Accounts** People sign up, sign in and sign out with email and password, a wrong email or password gets one message, and owner pages require a session.
- **DP-52 — Owner pages and not-found** Anything a person may not open answers 404 with the not-found copy, never 403, following the one error precedence in API.
- **DP-53 — Live regions and landmarks** Every page has one main landmark, one h1, the two named live regions and the published navigation, and every announcement uses its exact published sentence.
- **DP-54 — Published layouts** At 375 by 812, 768 by 1024 and 1280 by 800 each screen shows its published layout and order, and no width from 320 to 1440 scrolls sideways.
- **DP-55 — Motion and reduced motion** Page changes and the Lit path run their named animations with the published timing, and with reduced motion none of them run while text, focus and announcements stay the same.
- **DP-56 — Valkey and Mailpit outages** With Valkey down, submissions still work and the builder and summary show their paused texts, and with Mailpit down, mail waits in a durable outbox and the queued notice shows.
- **DP-57 — Grading routes** The grading seed and clock routes create the published records and set the server clock only when given the grading key, and answer 404 without it.
- **DP-58 — Platform and health** The app installs, builds and serves from the run manifest on the published port, answers the health and services routes, and serves live updates only over `/ws` on the same port.
- **DP-59 — Configuration from the environment** Every variable listed in Configuration and secrets is read from the environment at start and never hard-coded, and no credential, service URL or grading key reaches the browser.
- **DP-60 — Dark-room look** The marketing page, builder, summary, responses and respondent screens carry the dark-room design of Visual design: one plum-black ground, a single lit item and hot pink only on the primary action, chart bars, path marker and error markers.

## Frontend

### Screens and layout (DP-29, DP-54, DP-60)

The published viewports are 375 by 812 (phone), 768 by 1024 (tablet) and 1280 by 800 (desktop). There is one layout switch, between 767 and 768 pixels wide: 767 or less gets the phone layout, and 768 or more gets the wide layout. No other breakpoint changes which layout a published viewport gets. No page scrolls sideways at any width from 320 to 1440 pixels, including 390 and 1024.

- **Marketing page `/`.** On wide screens it is a text band set on a seven-column grid. `Nightform` sits in column one, `Open for new workspaces` in column two, and the six capabilities as one stacked list spanning columns three and four: `Branching`, `Formulas`, `Save and resume`, `Live summary`, `Co-editing`, `CSV export`. The seven invented sample forms sit as one stacked list spanning columns five and six: `Allotment waiting list`, `Choir audition`, `Bakery pre-order`, `Supper club RSVP`, `Trip dates`, `Household budget`, `Book club sign-up`. Link `Sign in` and the single pink link `Start a form` sit at the right of column seven. About a third of a screen of empty ground follows, then the sheet: seven inline SVG thumbnails, one per column and one per sample form in list order, each a dim drawing of that form's page map with its lit path, titled above. At 767 pixels or less the band stacks into one column in the same order, and the thumbnails run two per row.
- **Sign up `/signup` and sign in `/signin`.** One centred column of fields at every width.
- **Forms `/forms`.** A list of the person's forms, one line per form with its title link, state and response count, and the `New form` button above it. When the list is empty it shows the empty-state sentence from Feedback states.
- **Builder `/forms/<id>/edit`.** At 768 pixels and wider it has three panes side by side on the same ground. The pages pane on the left takes about a fifth of the width. The page canvas in the centre takes 40 to 60% of the width. The logic pane on the right holds the rule and formula controls, then the Lit path (trial answers, page map, trial values). A top bar above the panes holds the form title, the state badge `#form-state`, `#presence`, `#live-status`, `Publish`, `Form settings` and `Invite editor`. At 767 pixels or less the panes collapse to one pane: the `Pane` switcher sits under the top bar and shows exactly one of Pages, Canvas or Logic, with Canvas first.
- **Summary `/forms/<id>/summary`.** `#response-count` first, then one section per question in form order. On wide screens each section has its table beside its chart. At 767 pixels or less the table sits above the chart.
- **Responses `/forms/<id>/responses`.** `Export CSV` above the `Responses` table. Rows are separated by space, with no rules or stripes. At 767 pixels or less each row becomes a stacked block showing reference, submitted time and edition in that order.
- **Response view `/forms/<id>/responses/<response id>`.** Heading, edition line, then one block per stored answer in the edition's order.
- **Editions `/forms/<id>/editions` and `/forms/<id>/editions/<n>`.** A list of editions, and a read-only view of one edition's pages and questions.
- **Respondent form `/f/<slug>` and resume `/r/<token>`.** One page of questions per screen in `#page`. Its order: the form title as plain text, `#notice` when present, `#error-summary` when present, `#page-title`, `#page-count`, `#path-notice` when present, the questions, then `Back`, `Next` or `Submit`, and `Save and finish later`. On wide screens the column takes 40 to 60% of the width, starting about a sixth of the way across. At 767 pixels or less it fills the width less comfortable side margins. Grid questions are a grid at 768 pixels and wider, and one card per row at 767 or less. The date picker is a centred dialog at 768 pixels and wider, and a full-width sheet at 767 or less. On phone width every button, radio, checkbox, grid choice, ranking button and calendar day is at least 44 by 44 pixels.
- **Invitation `/invite/<token>`** and the **not-found, expired and already-sent pages**: one heading and at most one action, in one column; the only exception is the signed-out invitation page, which offers its two links, `Sign in` and `Create account`.

### Public screens and controls (DP-02, DP-03, DP-05, DP-22, DP-24, DP-26, DP-30, DP-33, DP-46, DP-47, DP-53)

Only the controls and regions in this table are public, and their roles and accessible names are exact and never change with state. State goes in `aria-pressed`, `aria-checked`, `aria-selected`, `aria-disabled`, `aria-busy`, `disabled` or `data-` attributes. When one published name contains another (`Next` and `Next month`), they are told apart by exact match. `<label>` on respondent screens is the question's label with insertions filled. In the builder it is the raw label.

| Where | Role and name (or id) | Notes |
|---|---|---|
| Every page | one `main`; one `h1` | |
| Every page | `#announcer` with `role="status"` and `aria-live="polite"` | polite announcements |
| Every page | `#alert` with `role="alert"` | refusals |
| Owner pages | `navigation "Main"` with `link "Forms"` and `button "Sign out"` | |
| Owner form pages | `navigation "Form"` with links `Edit`, `Summary`, `Responses`, `Editions` | |
| Owner form pages | `#form-state` | text `Draft`, `Open` or `Closed`, from the server |
| Marketing | `link "Start a form"` (to `/signup`), `link "Sign in"` | |
| Sign up | `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"` | |
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Forms | `button "New form"`; one `link "<form title>"` per form | |
| New form | `dialog "New form"`, `textbox "Form title"`, `button "Create form"` | |
| Builder top bar | `button "Publish"`, `link "Open live form"` (after publishing), `button "Form settings"`, `button "Invite editor"`, `#presence`, `#live-status`, `button "Save changes"` (only while Valkey is down), `#notice` | |
| Builder, phone | `combobox "Pane"` with options `Pages`, `Canvas`, `Logic` | |
| Pages pane | `navigation "Pages"` with one `button "<page title>"` per page (`aria-pressed` on the selected one), `button "Add page"` | |
| Canvas | `textbox "Page title"`; one row per question holding `button "Select question <key>"` (`aria-pressed` when selected); `button "Add question"` | |
| Selected question | `textbox "Question label"`, `textbox "Help text"`, `checkbox "Required"`, `textbox "Options"`, `textbox "Rows"`, `textbox "Columns"`, `textbox "Minimum"`, `textbox "Maximum"`, `combobox "Pattern"`, `textbox "Internal note"`, `button "Remove question"` | each shown only where the type has that field |
| Add question | `dialog "Add question"`, `combobox "Question type"`, `textbox "Question key"`, `textbox "Question label"`, `checkbox "Required"`, `textbox "Options"`, `button "Add"`, `button "Cancel"` | type options: `Short text`, `Long text`, `Number`, `Choice`, `Checkbox`, `Dropdown`, `Grid`, `Ranking`, `Scale`, `Date`, `File upload`, `Calculated` |
| Logic pane | `textbox "Rule name"`, `textbox "Show when"`, `button "Save rule"`; for a page also `button "Add jump"`, `textbox "Jump name"`, `textbox "Jump when"`, `combobox "Jump to"`, `button "Save jump"`; for a calculated question `textbox "Formula"`, `textbox "Decimal places"`, `textbox "Prefix"`, `textbox "Suffix"`, `checkbox "Hidden from respondents"`, `button "Save formula"`; for a question `button "Add check"`, `textbox "Check name"`, `textbox "Fails when"`, `textbox "Check message"`, `button "Save check"`; `#formula-error` | |
| Lit path | `region "Trial answers"` holding one control per answerable question named `Trial: <label>`; `list "Page map"`; `#lit-marker`; `#trial-values` | see Builder and Lit path |
| Form settings | `dialog "Form settings"`, `textbox "Closing time"`, `textbox "Response limit"`, `textbox "Closed message"`, `combobox "Send a copy to"`, `button "Close now"`, `button "Reopen form"`, `button "Save settings"` | |
| Invite | `dialog "Invite editor"`, `textbox "Email address"`, `button "Send invitation"` | |
| Invitation page | `h1` `Join <form title>`, `button "Accept invitation"`; when signed out `link "Sign in"` and `link "Create account"` | |
| Summary | `#response-count`; one `region "<label>"` per question; `table "<label> table"`; `img "<label> chart"` (an SVG); per grid row `table "<label>: <row label> table"` | |
| Responses | `button "Export CSV"`, `link "Download CSV"`, `table "Responses"` with columns `Reference`, `Submitted`, `Edition`; per row `link "Open response <reference>"` and `button "Delete response <reference>"` | |
| Delete | `dialog "Delete response"`, `button "Delete"`, `button "Cancel"` | |
| Response view | `h1` `Response <reference>`, line `Edition <n>`, `link "Download <name>"` per stored file | |
| Editions | one `link "Edition <n>"` per edition, each with `Published <date, time>` | |
| Respondent page | `#page`, `#page-title` (the `h1`, with `tabindex="-1"`), `#page-count`, `#path-notice`, `#notice`, `button "Back"`, `button "Next"`, `button "Submit"`, `button "Save and finish later"` | `Submit` replaces `Next` on the last shown page |
| Save | `dialog "Save and finish later"`, `textbox "Email address"`, `button "Send link"`, `button "Close"`, `#save-status` | |
| Error summary | `region "There is a problem with your answers"` as `#error-summary` with `tabindex="-1"`, an `h2`, and one `link` per error | |
| Questions | short and long text and number: `textbox "<label>"`; choice: `radiogroup "<label>"` of `radio "<option label>"`; checkbox: `group "<label>"` of `checkbox "<option label>"`; dropdown: `combobox "<label>"` | |
| Grid, wide | `grid "<label>"`, rows `row`, first cell `rowheader`, answer cells `gridcell "<row label>: <column label>"` | |
| Grid, phone | per row a `radiogroup "<row label>"` of `radio "<column label>"` | |
| Ranking | `list "<label>"` of `listitem` per option; buttons `Move <option> up` and `Move <option> down` | |
| Scale | `radiogroup "<label>"` of `radio "<number>"` | |
| Date | `textbox "<label>"`, `button "Choose date for <label>"`; `dialog "Choose a date"` with `button "Previous month"`, `button "Next month"`, `grid "<Month YYYY>"` of `gridcell "<D Month YYYY>"`, `button "Close"` | |
| File | inside `group "<label>"`: `button "Choose file"`, `#upload-<key>`, `button "Remove <name>"` | |
| Calculated | `#calc-<key>` as an `output`, with live announcing off | hidden fields are absent from the page |
| Field errors | `#error-<key>` beside the question | |
| Closed | `#closed-panel` holding an `h1` with `tabindex="-1"` | |
| Confirmation | `h1` with `tabindex="-1"` | |

### Interactions (DP-02, DP-10, DP-22, DP-23, DP-24, DP-25, DP-26, DP-28, DP-32, DP-35, DP-46, DP-49)

Copy quoted by number (M01 to M86) is defined in the Messages table in Feedback states.

**Timing rule for every screen.** Content, focus, announcements, attribute changes and saved state change at once, in the same task as the server reply or the key press that causes them. Nothing a person waits for depends on a client timer finishing, and there is no debounce. Animations only add visual change. Page timers use only the page's own `Date`, `performance.now`, `setTimeout`, `setInterval` or `requestAnimationFrame`, never a worker.

**Committing answers.** A short text, long text, number or date box commits on blur or when Enter is pressed. A choice, tick, dropdown, scale, grid, ranking or file change commits immediately. Each commit carries a rising number. The page applies the server's evaluation in the reply and discards any reply whose number is older than the newest one it has applied. A commit never shows field errors.

**Pages.** `Next` and `Submit` check the page, and `Back` never checks. Enter in a short text, number or date box commits and then presses `Next` (or `Submit`). On a page change the new page replaces the old one at once, focus moves to `#page-title`, `#announcer` reads M05, and the document title becomes `<page title> - <form title>`. `Back` goes to the previous page the walk shows for the current answers.

**Error summary.** When `Next` or `Submit` fails, `#error-summary` appears above `#page-title` and takes focus. Its `h2` is M01, followed by one link per error in page order, each link's text being the exact message. The document title gains the M03 prefix, and `#alert` reads M02. Each failing question shows the same message in `#error-<key>`, and its field gets `aria-invalid="true"` and an `aria-describedby` that includes `error-<key>`. Activating a link (Enter, click or tap) moves focus to the field and scrolls it into view, and leaves the summary as it is:

| Question | Focus goes to |
|---|---|
| text, number, dropdown, date | its input (for a date, the text box) |
| choice, scale, checkbox | the checked option, or else the first option |
| grid | the first cell of the first unanswered row, or else the first cell |
| ranking | the first item |
| file | its `Choose file` button |

The summary, inline messages and title prefix stay until the next `Next` or `Submit` rebuilds them, or until the page changes. With no errors the page moves on.

**Grid at 768 pixels and wider.** The grid is one tab stop: exactly one answer cell has `tabindex="0"`, which is the last focused cell, or the first answer cell at first. Arrow keys move focus by one cell and stop at the edges, never wrapping and never reaching the row header. Home and End go to the first and last answer cell of the row. Ctrl+Home goes to the first answer cell of the first row, and Ctrl+End to the last cell of the last row. Space or Enter selects the focused cell (`aria-selected="true"`) and clears the row's other cell. Arrow keys never select. Tab leaves the grid.

**Grid at 767 pixels or less.** One card per row, each a radio group. Tapping a radio selects it.

**Ranking.** Items are in `aria-posinset` order, and each has `tabindex="0"`. On a focused item, Space picks it up (`data-grabbed="true"`) and `#announcer` reads M39. ArrowUp and ArrowDown then move it one place, and `#announcer` reads M38. Space drops it (M40), and Escape puts it back where it was picked up (M41). Focus stays on the item throughout. An item at an end does not move further and nothing is announced. The `Move <option> up` and `Move <option> down` buttons move the item one place, announce M38 and keep focus on the button. They have `aria-disabled="true"` at the ends. The order commits on drop and on each button press, never on arrow moves. Dragging an item with a mouse or finger also moves it and commits on release.

**Scale.** One tab stop. ArrowRight and ArrowUp go one higher, ArrowLeft and ArrowDown one lower, stopping at the ends without wrapping. Home and End go to the lowest and highest numbers, and a digit key picks that number when it exists. Selection follows focus, and each selection commits. The `min_label` and `max_label` texts are visible and tied to the group by `aria-describedby`.

**Date.** The text box takes `YYYY-MM-DD`. `Choose date for <label>` opens `Choose a date` with focus on the selected date, or else today (the server's date), or else the nearest allowed day. Weeks start on Monday. ArrowLeft and ArrowRight move one day, ArrowUp and ArrowDown one week, Home and End to the week's Monday and Sunday, PageUp and PageDown one month, and Shift+PageUp and Shift+PageDown one year. Enter or Space picks the day: the dialog closes, the box fills, the answer commits and focus returns to the button. Escape closes with no change and returns focus to the button. Days outside `min` and `max` have `aria-disabled="true"` and cannot be picked. Tab and Shift+Tab cycle through `Previous month`, `Next month`, the focused day and `Close` without leaving the dialog. At 767 pixels or less the dialog is a full-width sheet, and tapping a day picks it.

**Choice, checkbox and dropdown** use the browser's native keyboard and touch behaviour.

**Every dialog** (New form, Add question, Form settings, Invite editor, Save and finish later, Delete response, Choose a date) is modal. Focus starts on its first control (`Question type` for Add question, the selected day for the calendar). Tab and Shift+Tab wrap inside it, Escape closes it, and closing returns focus to the control that opened it. A click outside does nothing.

**Builder by keyboard.** `Add question` opens its dialog. Enter in `Question key` or `Question label` presses `Add`. `Add` adds the question at the end of the selected page and closes the dialog, focus returns to `Add question`, and `#announcer` reads M35. A refused key keeps the dialog open with M37 or M68 in `#alert`, as given in Form definition. With focus anywhere inside a question row, including its `Select question <key>` button, Alt+ArrowUp and Alt+ArrowDown move the question one place within its page. Focus stays on the moved row's button and `#announcer` reads M38. A page button in `Pages` selects that page and shows its rule and jumps in the Logic pane. `Select question <key>` selects a question and shows its controls and rule. Builder text boxes commit on blur, or on Enter in a single-line box. `Save rule`, `Save jump`, `Save formula` and `Save check` commit their group. A refused formula puts its refusal in `#formula-error` and `#alert`, sets `aria-invalid="true"` on the box and leaves focus in the box. `Publish` reports through `#announcer` or `#alert` as given in Feedback states.

**Trial answers.** Text, number and date trial boxes commit on blur or Enter. Choice, dropdown and scale trials are comboboxes with an empty first option. A checkbox trial is a `group "Trial: <label>"` of checkboxes named by the option labels. A grid trial has one combobox per row, named `Trial: <label>: <row label>`. Combobox and checkbox trials commit on change. Ranking and file questions have no trial control and count as blank.

**Live editing.** An editor who is typing in a box keeps their text when another editor's change to the same field arrives, and nothing is added to `#notice` until they commit. Incoming changes never move focus.

**Moved and closed.** When a commit, `Next`, `Back`, `Save` or `Submit` gets the moved refusal, every control on the page gets `disabled` and `#alert` reads M21. When the form closes, `#closed-panel` replaces the content of `#page`, focus moves to its `h1`, and `Submit`, `Next` and `Back` are gone.

**Submit.** While a submit is pending, `Submit` has `aria-busy="true"` and further activations send nothing new. Every attempt to submit one response reuses the same idempotency key. On success, the confirmation replaces the page and focus moves to its `h1`.

### Visual design (DP-60)

The direction is dark-room: hushed, lit and deliberate. Display and body text are both set in Work Sans, served by the app. Each heading level is 1.25 times the size of the level below it. Body text on the marketing page uses Work Sans at regular weight. Running text on the working screens is set a step larger for comfortable reading, and figures are tabular wherever numbers line up (summary, response table, calculated values, page counts).

The palette roles in words:
- **Ground:** a near-black plum that runs unbroken from the top of every page to the bottom, with no section bands.
- **Surface:** a slightly lifted deep plum, used only for the one item being worked on (the selected question in the builder, the current row of the response table).
- **Ink:** pure white, for the lit item only, meaning the current page of questions, the selected chart or the lit path.
- **Muted:** a soft grey-mauve, for everything not being worked on. Running help text is lifted further to a pale mauve so that it keeps at least 7 to 1 contrast against the ground.
- **Accent:** a hot pink, used on exactly four kinds of thing: the one primary action per screen (`Start a form`, `Publish`, `Next` or `Submit`, `Create form`, `Send link`), the chart bars, the Lit path marker, and the marker on the left edge of each error, whose message sits beside it in white words.
- **On accent:** the near-black plum, for text sitting on pink.

Composition: each screen holds one lit item at 40 to 60% of the width, with its text beside it. Questions you are not working on recede into the dark like unlit rooms, and the current question is the only full-ink block. Comfortable density. Corners are square everywhere, with no borders, rules, stripes, shadows, glass, paper or cream grounds, monospace labels or index numbering.

The marketing hero is a text band followed by a sheet, as laid out in Screens and layout, with no imagery beyond the procedural page-map thumbnails.

The working screens carry the same language. The builder's three panes sit on one ground: page list as plain text with the current page in ink and the rest muted; the selected question on the surface tone and the other questions directly on the ground. The response table is separated by space alone. The summary lights one chart at a time (the one hovered or focused, at first the first) in ink with pink bars, and the rest are muted. Empty states are one sentence set somewhat larger than body text on its own line, offset about a sixth of the way across. Loading shows the dim page map, never a spinner. Every interactive target is at least 44 by 44 pixels on phone width. Keyboard focus shows a solid white outline at least two pixels thick, offset from the control. All text and controls meet WCAG 2.2 AA contrast, with one stated exception: the titles and question lines of skipped Lit path items are dimmed on purpose to about a third of full brightness and are exempt. Their `Skipped by` line stays in the full muted tone and does meet AA, so the reason for each skip is always readable.

The darkness has a purpose: a form is a set of rooms a respondent walks through, the logic decides which rooms light up, and the dark ground makes the branching visible.

### Motion and effects (DP-05, DP-55)

Motion means one thing in Nightform: something has just become lit or dimmed. Every movement starts briskly and settles gently with no overshoot or bounce. There are no decorative loops, pulsing, shimmer, parallax or spinners anywhere.

- **Page change.** The new page crossfades in as one animation named `page-fade` on `#page`, lasting 420 to 600 milliseconds. It is visual only, and focus, content and announcements change before it starts.
- **Lit path (the signature).** When a trial answer changes and the server's reply arrives, every page-map item and question line takes its new lit or skipped state at once in its attributes and text. Visually, each item whose state changed crossfades in an animation named `lit-fade` of about 420 milliseconds: lit items rise to full white ink, and skipped items' titles and question lines sink to about a third of full brightness, with their `Skipped by` line beside them in the full muted tone. The crossfades start in path order from the top of the map, 40 milliseconds apart, and the stagger is capped at 12 items, so any item after the twelfth starts together with the twelfth. The pink marker `#lit-marker` then slides down the lit chain to the last lit page in an animation named `lit-marker` of about 600 milliseconds over the map's height. Each calculated value in `#trial-values` counts from its old number to its new one over about 320 milliseconds in tabular figures, in an element `.lit-count` whose `data-final` holds the final text from the first frame. A new reply mid-animation starts the new animations from wherever the visuals are, so the lit set always ends at the newest reply.
- **Hover and press.** Muted text and controls lift to full ink on hover and on keyboard focus, in about a fifth of a second. A pressed button darkens slightly for as long as it is held.
- **Dialogs and the date sheet** appear in a crossfade of about a quarter of a second and leave the same way. Focus moves at once.
- **Loading.** While a page's first data loads, `main` has `aria-busy="true"` and the dim page map slowly crossfades in over about 600 milliseconds.

**Reduced motion.** Under the reduced-motion preference, no animation runs on `#page` or in the page map at all: there is no `page-fade`, `lit-fade` or `lit-marker`, the lit and dimmed states switch instantly, the marker sits at its final page, and calculated values appear at their final number. Text, attributes, focus and announcements are exactly the same as with motion.

### Feedback states (DP-09, DP-12, DP-17, DP-22, DP-31, DP-33, DP-34, DP-41, DP-46, DP-49, DP-53, DP-56)

There are two live regions on every page. `#announcer` is polite and `#alert` is assertive. Every refusal goes to `#alert`, and everything else to `#announcer`. Each announcement replaces the region's text at once with the exact sentence. When a sentence repeats in a row, the region is cleared and set again in the same task or a microtask, never behind a timer. A region's text is never the only copy of a visible message. When one commit produces several polite sentences, `#announcer` holds them joined by one space: the path notice first, then changed calculated values in form order.

Pending states: a pending `Submit` has `aria-busy="true"`; an upload in progress has `aria-busy="true"` on `#upload-<key>`; `main` has `aria-busy="true"` while a screen first loads. Everything else answers before the next interaction.

**Messages (the one table of published copy).** Placeholders use the formats in Business rules, Formats. Field-check messages are in Checks, formula results and refusals are in Formula language, and API codes are in API.

| # | Copy | Shown when, and where |
|---|---|---|
| M01 | `There is a problem with your answers` | name and `h2` of `#error-summary` |
| M02 | `There is a problem with your answers. <n> to fix.` | `#alert` on a failed `Next` or `Submit`; also the `ANSWERS_INVALID` message (`1 to fix.` for one) |
| M03 | `Error: ` | document-title prefix while the summary shows |
| M04 | `Page <n> of <m>` | `#page-count`; `<n>` and `<m>` count shown pages only |
| M05 | `Page <n> of <m>: <title>` | `#announcer` on each page change |
| M06 | `1 answer no longer applies and will not be sent.` | `#path-notice` and `#announcer` when a commit hides one answered question |
| M07 | `<n> answers no longer apply and will not be sent.` | the same, for two or more |
| M08 | `1 earlier answer applies again.` | `#path-notice` and `#announcer` when a commit brings one back |
| M09 | `<n> earlier answers apply again.` | the same, for two or more |
| M10 | `(not answered yet)` | an insertion whose answer is blank or hidden |
| M11 | `Not calculated yet` | a calculated field whose value is blank |
| M12 | `<label>: <text>` | `#announcer` when a commit changes a shown calculated value; each line of `#trial-values` |
| M13 | `We sent a link to <email>. It works until <expiry>.` | `#save-status` and `#announcer` once Mailpit has accepted the resume email |
| M14 | `Your answers are saved; the email will follow.` | instead of M13 when the email is still in the outbox; added under the confirmation when the email copy is still in the outbox |
| M15 | `Welcome back. Your answers were saved on <saved>.` | `#notice` when a resume link opens on the same edition |
| M16 | `This form changed since you saved. 1 of your answers no longer applies: <label>.` | `#notice` when a link moves a response to a newer edition and one answer drops |
| M17 | `This form changed since you saved. <n> of your answers no longer apply: <labels>.` | the same for two or more; `<labels>` are the old edition's labels in form order, joined by `, ` |
| M18 | `This form changed since you saved. All your answers still apply.` | the same when nothing drops |
| M19 | `This link has expired.` | `h1` of the expired-link page; `LINK_EXPIRED` message |
| M20 | `This response has already been sent.` | `h1` of the submitted-link page; `ALREADY_SENT` and `ALREADY_SUBMITTED` message |
| M21 | `This response was continued on another device. Open your emailed link to carry on.` | `#alert` on the device that lost the response; `DRAFT_MOVED` message |
| M22 | `This form is closed` | `h1` of `#closed-panel`, always |
| M23 | `This form closed at <closes> (<zone>).` | default closed text when closed by time; `<zone>` is the `APP_TZ` name |
| M24 | `This form has reached its limit of <n> responses.` | default closed text when closed by the limit |
| M25 | `This form is not taking responses.` | default closed text when closed by hand |
| M26 | `Your answers were not sent.` | extra line in `#closed-panel`, and `#alert`, when the form closed while open on the page |
| M27 | `Thank you. Your response was sent.` | confirmation `h1` |
| M28 | `Reference: <reference>` | confirmation line, and the first line of the email copy |
| M29 | `(no answer)` | Answer text in the email copy and resume email for a shown question left blank |
| M30 | `Uploading <name>` | `#upload-<key>` while storing |
| M31 | `Attached: <name> (<size>)` | `#upload-<key>` after storage confirms |
| M32 | `<label>: attach a <types> file.` | `#alert` and `#upload-<key>` for a wrong type; `<types>` names the question's allowed types in the order PDF, PNG, JPEG, joined as `PDF`, `PDF or PNG` or `PDF, PNG or JPEG`; `FILE_TYPE` message |
| M33 | `<label>: the file must be <n> MB or smaller.` | the same for a file over `max_bytes`; `<n>` is `max_bytes` divided by 1,048,576 in Number text; `FILE_TOO_LARGE` message |
| M34 | `We could not store <name>. Your other answers are safe. Try again.` | `#alert` and `#upload-<key>` when storage fails; `UPLOAD_FAILED` message |
| M35 | `Question added: <label>.` | `#announcer` after `Add` |
| M36 | `Question removed: <label>.` | `#announcer` after `Remove question` |
| M37 | `That key is already used.` | `#alert` for a duplicate question key; `DUPLICATE_KEY` message |
| M38 | `<item> moved to position <n> of <m>.` | `#announcer` for a builder question move (`<item>` is the key) and a ranking move (`<item>` is the option label) |
| M39 | `<option> picked up, position <n> of <m>.` | `#announcer` on ranking pick-up |
| M40 | `<option> dropped at position <n> of <m>.` | `#announcer` on ranking drop |
| M41 | `Move cancelled. <option> is back at position <n> of <m>.` | `#announcer` on Escape while an item is picked up |
| M42 | `Edition <n> is live.` | `#announcer` after `Publish` or `Reopen form` succeeds |
| M43 | `Fix 1 problem before publishing.` | `#alert` when publishing is refused for one problem; `FORMULA_PROBLEMS` message |
| M44 | `Fix <n> problems before publishing.` | the same for two or more |
| M45 | `Path: <lit> of <all> pages shown, <label> <text>` | `#announcer` after each trial reply, naming the form's last calculated field that is not hidden from respondents |
| M46 | `Path: <lit> of <all> pages shown` | the same when the form has no such field |
| M47 | `Skipped by: <rule name>` | beside each skipped page-map item |
| M48 | `Settings saved.` | `#announcer` after `Save settings` |
| M49 | `The form is now closed.` | `#announcer` after `Close now` |
| M50 | `Invitation sent to <email>.` | `#announcer` after `Send invitation`, whether or not that email has an account |
| M51 | `Also editing: <names>` | `#presence`, other editors' names joined by `, ` in the order they joined; empty when alone |
| M52 | `<name> changed <field> on <key> at the same time. Their version is kept.` | `#notice` and `#announcer` for the editor whose value was replaced; `<field>` is the control's name in lower case, for example `question label` |
| M53 | `Live editing is paused. Save to keep your changes.` | builder `#live-status` while Valkey is down |
| M54 | `Changes saved.` | `#announcer` after `Save changes` |
| M55 | `1 response` | `#response-count`, and `#announcer` when it changes |
| M56 | `<n> responses` | the same for 0 or two or more |
| M57 | `Answered: <a> of <n>` | under each summary question |
| M58 | `Mean <x>`, `Lowest <x>`, `Highest <x>` | summary lines for number, scale and numeric calculated questions |
| M59 | `Live updates are paused. Reload for the latest numbers.` | summary `#live-status` while Valkey is down |
| M60 | `Export ready: 1 response.` | `#announcer` when an export is stored |
| M61 | `Export ready: <n> responses.` | the same for 0 or two or more |
| M62 | `The export could not be stored. Try again.` | `#alert` when storage fails; `EXPORT_FAILED` message |
| M63 | `Response deleted.` | `#announcer` after `Delete` |
| M64 | `Email or password is wrong.` | `#alert` on a failed sign-in; `SIGN_IN_FAILED` message |
| M65 | `Not found.` | `h1` of the not-found page; `NOT_FOUND` message |
| M66 | `Too many requests. Try again later.` | `#alert`; `RATE_LIMITED` message |
| M67 | `Sign in to continue.` | `SIGN_IN_REQUIRED` message |
| M68 | `Check the highlighted fields.` | `VALIDATION_FAILED` message; `#alert` for any `VALIDATION_FAILED`; per-field messages appear beside the fields |
| M69 | `This request was already used with different answers.` | `IDEMPOTENCY_CONFLICT` message |
| M70 | `That answer does not fit this question.` | `ANSWER_INVALID` message |
| M71 | `The request is too large.` | `BODY_TOO_LARGE` message |
| M72 | `This form is already open.` | `FORM_OPEN` message |
| M73 | `Publish the form first.` | `FORM_DRAFT` message |
| M74 | `Enter your name.` | field message: name |
| M75 | `Enter an email address like name@example.com.` | field message: any email field outside form questions |
| M76 | `Use at least 8 characters.` | field message: password |
| M77 | `An account with this email already exists.` | field message: sign-up email |
| M78 | `Enter a form title.` | field message: form title |
| M79 | `Enter the closing time as YYYY-MM-DD HH:MM.` | field message: closing time |
| M80 | `Enter a whole number of 1 or more.` | field message: response limit |
| M81 | `Choose an email question.` | field message: send a copy to |
| M82 | `Use lower-case letters, digits and underscores, starting with a letter.` | field message: question key |
| M83 | `No forms yet. Start one with New form.` | empty `/forms` |
| M84 | `No responses yet.` | empty summary and responses pages |
| M85 | `That question was removed by another editor.` | `#notice` when an editor's change names a question that no longer exists |
| M86 | `Send an Idempotency-Key header.` | `IDEMPOTENCY_KEY_REQUIRED` message |

On a closed form, the panel's text is the owner's `closed_message` when one is set, or otherwise M23, M24 or M25 by reason. The confirmation holds M27, then M28, then M14 when the email copy is still in the outbox.

## Backend

### API (DP-01, DP-06, DP-11, DP-30, DP-35, DP-36, DP-42, DP-45, DP-47, DP-52, DP-57, DP-58)

All bodies are JSON (`application/json; charset=utf-8`) except file uploads and CSV downloads. Owner routes use the session cookie `nf_session`. Respondent routes use the device cookie `nf_device`, a random value the server sets on a browser's first respondent request. A part-done response belongs to exactly one device.

**One error shape:** `{"error": {"code": "<CODE>", "message": "<copy>", "items": [{"key": "<field or question key>", "message": "<copy>", "page": "<page key>"}]}}`. `items` appears only on `VALIDATION_FAILED`, `ANSWERS_INVALID`, `FORMULA_INVALID` and `FORMULA_PROBLEMS`, and `page` only on `ANSWERS_INVALID`. Every message is the copy given in Feedback states, Checks or Formula language.

**One error precedence for the whole API, first match wins:** 413 `BODY_TOO_LARGE`, then 401 `SIGN_IN_REQUIRED` (owner routes with no valid session), then 404 (`NOT_FOUND`: missing, or not this person's to see under Accounts and visibility; or `LINK_EXPIRED` and `ALREADY_SENT` on resume tokens), then 429 `RATE_LIMITED`, then 409 state conflicts (`FORM_CLOSED`, `DRAFT_MOVED`, `ALREADY_SUBMITTED`, `IDEMPOTENCY_CONFLICT`, `FORM_OPEN`, `FORM_DRAFT`), then 422 validation, then 503 storage failures. An id inside a body that names something the person cannot see answers 404. An idempotent replay returns its stored response before any state check. No route ever answers 403.

**Evaluation object** (returned by commits, trials, page moves and resume):

```json
{"seq": 4,
 "pages": [{"key": "about", "title": "About you", "state": "lit", "skipped_by": null,
            "questions": [{"key": "attending", "state": "lit", "skipped_by": null,
                           "label": "Are you coming?", "help": null}]}],
 "shown_pages": 3,
 "values": {"total": {"value": "15.7", "text": "£15.70"}},
 "hidden_now": 0, "restored": 0, "announce": "Page 1 of 3: About you"}
```

`state` is `lit` or `skipped`. `skipped_by` names the rule that skipped the item. A question on a skipped page carries its page's `skipped_by`. `label`, `help` and page `title` have insertions filled. `values` maps every calculated key to its unrounded `value` (Number text, or a date or text) and its shown `text`. `hidden_now` and `restored` count answered questions that this commit hid or brought back. To respondents, `values` leaves out calculated fields with `hidden` true, and no evaluation ever carries a formula or an internal note.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | | 200 `{"status":"ok"}` | |
| `GET /api/services` | | 200 `{"postgres":"up","valkey":"up","minio":"up","mailpit":"up"}`, each `up` or `down` by a check made within the last 5 seconds | |
| `POST /api/account` | `{"name","email","password"}` | 201 `{"user":{"id","name","email"}}` and sets `nf_session` | 422 `VALIDATION_FAILED` (M74, M75, M76, M77) |
| `POST /api/session` | `{"email","password"}` | 200 `{"user":{...}}` and sets `nf_session` | 422 `SIGN_IN_FAILED` |
| `GET /api/session` | | 200 `{"user":{...}}` | 401 |
| `DELETE /api/session` | | 204, cookie cleared | |
| `GET /api/forms` | | 200 `{"forms":[{"id","title","role","state","edition","responses"}]}`, `role` `owner` or `editor`, `state` `draft`, `open` or `closed`, `edition` the live edition number or null | |
| `POST /api/forms` | `{"title"}` | 201 `{"id","slug","title"}`; the draft is one page `{"key":"page_1","title":"Page 1","questions":[]}` | 422 `VALIDATION_FAILED` (M78) |
| `GET /api/forms/<id>` | | 200 `{"id","slug","title","role","state","closed_reason","edition","rev","draft":<definition>,"problems":[{"key","message"}],"settings":{...},"responses","server_now"}`; `closed_reason` is `time`, `limit`, `hand` or null | |
| `POST /api/forms/<id>/changes` | `{"changes":[<change>]}` | 200 `{"rev","applied":[{"seq","conflict_with"}]}` | 422 `CHANGE_INVALID`, `DUPLICATE_KEY`, `FORMULA_INVALID`, `VALIDATION_FAILED` |
| `POST /api/forms/<id>/trial` | `{"seq","answers":{<key>:<value>}}` | 200 evaluation of the draft, including hidden calculated fields | 422 `ANSWER_INVALID` |
| `POST /api/forms/<id>/publish` | `{}` | 200 `{"edition":<n>}` | 422 `FORMULA_PROBLEMS` |
| `PUT /api/forms/<id>/settings` | `{"closes_at","response_limit","closed_message","copy_to"}` | 200 `{"settings":{...},"state","closed_reason"}` | 422 `VALIDATION_FAILED` (M79, M80, M81) |
| `POST /api/forms/<id>/close` | `{}` | 200 `{"state":"closed","closed_reason":"hand"}`; on an already closed form, 200 with no change | 409 `FORM_DRAFT` |
| `POST /api/forms/<id>/reopen` | `{}` | 200 `{"state":"open","edition":<n>}` | 409 `FORM_OPEN`, `FORM_DRAFT`; 422 `FORMULA_PROBLEMS` |
| `POST /api/forms/<id>/invitations` | `{"email"}` | 202 `{"message":"<M50>"}` | 422 `VALIDATION_FAILED` (M75) |
| `POST /api/invitations/<token>/accept` | `{}` | 200 `{"form_id"}` | 401; 404 unknown, used or expired |
| `GET /api/forms/<id>/editions` | | 200 `{"editions":[{"number","published_at"}]}` | |
| `GET /api/forms/<id>/editions/<n>` | | 200 `{"number","published_at","definition"}` | |
| `GET /api/forms/<id>/responses` | | 200 `{"responses":[{"id","reference","submitted_at","edition"}]}`, newest first | |
| `GET /api/forms/<id>/responses/<rid>` | | 200 `{"id","reference","edition","submitted_at","items":[{"key","label","text","value"}],"files":[{"key","name","size","type","url"}]}`; items are in the edition's order with that edition's labels filled in, including hidden calculated fields and notes as `note`; each item's `text` is its Answer text (Formats) and `value` its API answer value | |
| `DELETE /api/forms/<id>/responses/<rid>` | | 204 | |
| `GET /api/forms/<id>/files/<file id>` | | 200 the stored bytes with their content type and `Content-Disposition: attachment; filename="<name>"` | |
| `GET /api/forms/<id>/summary` | | 200 the summary object of Summary | |
| `POST /api/forms/<id>/exports` | `{}` | 201 `{"id","responses","url"}` | 503 `EXPORT_FAILED` |
| `GET /api/forms/<id>/exports/<eid>` | | 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>-responses.csv"` | 404 after the export link window |
| `GET /api/f/<slug>` | | 200 `{"title","intro","state","closed":null or {"heading","text"},"today":"YYYY-MM-DD"}` | 404 unknown or never published |
| `POST /api/f/<slug>/responses` | `{}` | 201 `{"id","edition","page","answers","evaluation"}` for a new part-done response; 200 with this device's existing part-done response on this form | 409 `FORM_CLOSED` (nothing created) |
| `GET /api/responses/<id>` | | 200 the same shape | |
| `POST /api/responses/<id>/answers` | `{"seq","page","answers":{<key>:<value or null>}}` | 200 `{"evaluation"}` | 409 `FORM_CLOSED`, `DRAFT_MOVED`, `ALREADY_SUBMITTED`; 422 `ANSWER_INVALID` |
| `POST /api/responses/<id>/next` | `{"page"}` | 200 `{"page","evaluation"}` | 409 as above; 422 `ANSWERS_INVALID` |
| `POST /api/responses/<id>/back` | `{"page"}` | 200 `{"page","evaluation"}` | 409 as above |
| `POST /api/responses/<id>/save` | `{"email","page"}` | 200 `{"email","expires_at","sent"}`; `sent` is false while the email is still in the outbox | 409 as above; 429; 422 `VALIDATION_FAILED` (M75) |
| `POST /api/responses/<id>/submit` | header `Idempotency-Key`; `{"page"}` | 200 `{"id","reference","submitted_at","edition","copy","replayed"}`; `copy` is `sent`, `queued` or `none` | 409 as above and `IDEMPOTENCY_CONFLICT`; 429; 422 `ANSWERS_INVALID`, `IDEMPOTENCY_KEY_REQUIRED` |
| `PUT /api/responses/<id>/files/<key>` | raw bytes; headers `Content-Type` and `X-File-Name` (percent-encoded) | 201 `{"name","size","type"}` | 409 as above; 422 `FILE_TYPE`, `FILE_TOO_LARGE`; 503 `UPLOAD_FAILED` |
| `DELETE /api/responses/<id>/files/<key>` | | 204 | 409 as above |
| `POST /api/resume/<token>` | `{}` | 200 `{"id","edition","page","answers","evaluation","notice","saved_at"}`, and the response moves to this device | 404 `NOT_FOUND`, `LINK_EXPIRED`, `ALREADY_SENT`; 409 `FORM_CLOSED` |

Owner-only routes: publish, settings, close, reopen, invitations, and deleting responses. A co-editor calling them gets 404.

**Change shapes** (over `/ws` or `POST /api/forms/<id>/changes`), each with `base_rev`, the draft revision the editor's builder had applied when the edit began:
- `{"op":"set","key":"<question key, page key or form>","field":"<field>","value":<json>,"base_rev":<n>}`. Question fields are any field of Form definition except `key` and `type`. Page fields are `title`, `show_rule` and `jumps`. Form fields are `title`, `intro` and `checks`.
- `{"op":"add_question","page":"<page key>","question":<question>,"base_rev":<n>}`
- `{"op":"remove_question","key":"<key>","base_rev":<n>}`
- `{"op":"move_question","key":"<key>","position":<1-based position in its page>,"base_rev":<n>}`
- `{"op":"add_page","page":<page>,"position":<n>,"base_rev":<n>}` and `{"op":"remove_page","key":"<key>","base_rev":<n>}`

`conflict_with` in a reply is the id of the user whose committed value this change replaced under Live editing, or null.

**Live updates over `/ws`.** There is one WebSocket at `/ws` on the app's own port, and no other realtime transport. Upgrades from another origin are refused. The client sends `{"type":"join","form":"<id>","view":"builder"}` or `{"type":"join","form":"<id>","view":"summary"}` (session required), or `{"type":"join","response":"<id>"}` (device required), and in the builder `{"type":"change","change":<change>}`. The server sends:
- `{"type":"joined","rev"}`
- `{"type":"applied","seq","by":{"id","name"},"change","conflict_with"}`
- `{"type":"presence","editors":[{"id","name"}]}`
- `{"type":"summary","summary":<summary object>}`
- `{"type":"form_state","state","closed_reason","closed":{"heading","text"}}`
- `{"type":"moved"}` to a device that lost its response
- `{"type":"refused","error":<error object>}` for a refused change

A join to something the person cannot see closes the socket with code 4404.

**Grading routes.** These work only with header `X-Grading-Key: <GRADING_KEY>`. Without the key, with a wrong key or with `GRADING_KEY` unset, they answer 404.
- `POST /api/grading/seed` with any of `users` and `forms`:

  ```json
  {"users": [{"key": "owen", "name": "Owen Hale", "email": "owen@example.test", "password": "pw-owen-1"}],
   "forms": [{"key": "rsvp", "owner": "owen", "editors": ["ria"],
              "editions": ["<definition>", "<definition>"],
              "draft": null,
              "settings": {"closes_at": "2026-03-14T17:00", "response_limit": 2, "closed_message": null, "copy_to": "email"},
              "responses": [{"key": "r1", "status": "partial", "answers": {"guests": "3"}, "page": "meals", "edition": 1,
                             "email": "ana@example.test", "saved_at": "2026-03-01T09:00"},
                            {"key": "r2", "status": "submitted", "answers": {}, "edition": 1, "submitted_at": "2026-03-01T10:00"}]}]}
  ```

  `editions` lists published definitions in order, and the last one is live. An empty list leaves the form a draft. `draft` is the builder's unpublished definition, defaulting to the live edition. Users named in `owner` and `editors` come from this request's `users`. Seeded answers go through the same engine as real ones, so calculated values and discards match. A partial response with `email` gets a resume token, with its window counted from `saved_at`. Times are local in `APP_TZ`. The reply is 201 `{"users": {"owen": {"id", "session"}}, "forms": {"rsvp": {"id", "slug", "fill_url", "edit_url", "summary_url", "responses": {"r1": {"id", "resume_url"}, "r2": {"id", "reference"}}}}}`, where `session` is a valid `nf_session` cookie value. An invalid seed answers 422 `SEED_INVALID` with a message naming the first problem.
- `POST /api/grading/clock` with `{"now": "2026-03-14T16:59:00+00:00"}` sets the server clock to that instant, and it runs on from there. `{"now": null}` returns to real time. The reply is 200 `{"now": "<ISO 8601>"}`. The clock is stored in Postgres, so every app instance sharing the database follows it within 1 second, and form-state pushes follow it.

### Business rules (DP-01, DP-04, DP-06 to DP-27, DP-30, DP-33 to DP-50)

#### Formats

- `<date>`: day without a leading zero, three-letter English month, four-digit year, for example `14 Mar 2026` or `3 Apr 2026`. Calendar cells use the full month, for example `14 March 2026`, and the calendar grid is named like `March 2026`.
- `<date, time>`, used for `<expiry>`, `<saved>`, `<closes>` and `Published <date, time>`: `<date>, HH:MM` on a 24-hour clock in `APP_TZ`, for example `14 Mar 2026, 17:00`.
- `<reference>`: the first 8 characters of the response id, which is a lower-case UUID.
- `<size>`: under 1,048,576 bytes, the size divided by 1,024, rounded half away from zero, at least 1, followed by ` KB` (for example `340 KB`). Otherwise the size divided by 1,048,576 to one decimal, followed by ` MB` (for example `1.2 MB`).
- `<label>`: on respondent screens, in error messages, in email and in the owner's response view, the label with insertions filled. In the builder, summary and CSV, the raw label.
- **Number text**: a number with no trailing zeros after the decimal point, no decimal point when whole, no exponent and no thousands separators, for example `3.5`, `100` or `-0.25`.
- **Answer text**, used by the email copy, the resume email and each item's `text` in the owner's response view: the insertion display rules of Respondent rules for the types they cover; for a ranking, the option labels best first joined by ` > `; for a file, its name; for a whole grid, `<row label>: <column label>` for each answered row in row order, joined by `; `; and, in emails, M29 for a shown question left blank.
- All times the server judges use the server clock (the grading clock when set) in `APP_TZ`. The device clock may be wrong, and the browser never decides open, closed, expired or today.

#### Form definition

One JSON shape, in snake_case, is used by the grading route, the owner API and every edition. Example, the Supper club form:

```json
{
  "title": "Supper club RSVP",
  "intro": "Tell us if you are coming.",
  "pages": [
    {"key": "about", "title": "About you",
     "questions": [
       {"key": "attending", "type": "choice", "label": "Are you coming?", "required": true,
        "options": [{"value": "Yes", "label": "Yes"}, {"value": "No", "label": "No"}]},
       {"key": "guests", "type": "number", "label": "How many guests?", "help": "Count yourself.",
        "required": false, "min": 1, "max": 8, "decimals": 0}],
     "jumps": [{"name": "Not attending", "when": "{attending} = \"No\"", "to": "thanks"}]},
    {"key": "meals", "title": "Meals",
     "questions": [
       {"key": "meal", "type": "dropdown", "label": "Main course", "required": true,
        "options": [{"value": "Vegetarian", "label": "Vegetarian"}, {"value": "Fish", "label": "Fish"}]},
       {"key": "diet", "type": "short_text", "label": "Which diet?", "required": false, "max_length": 40,
        "show_rule": {"name": "Vegetarian meal", "when": "{meal} = \"Vegetarian\""}}]},
    {"key": "travel", "title": "Travel",
     "show_rule": {"name": "Two or more guests", "when": "{guests} >= 2"},
     "questions": [
       {"key": "parking", "type": "choice", "label": "Do you need parking?", "required": true,
        "options": [{"value": "Yes", "label": "Yes"}, {"value": "No", "label": "No"}]}]},
    {"key": "thanks", "title": "Anything else",
     "questions": [{"key": "comment", "type": "long_text", "label": "Anything to add about your {{meal}} meal?", "required": false}]}
  ],
  "checks": []
}
```

| type | Extra fields (optional unless marked required) | Answer value in the API |
|---|---|---|
| `short_text`, `long_text` | `min_length`, `max_length`, `pattern` (one of `email`, `phone`, `digits`, `letters`) | string of at most 10,000 characters |
| `number` | `min`, `max`, `decimals` | string holding a decimal number, for example `"3.50"` |
| `choice`, `dropdown` | `options` (required), `shuffle` | the option's `value` |
| `checkbox` | `options` (required), `shuffle`, `min_selected`, `max_selected` | array of option values |
| `grid` | `rows` and `columns` (required, each a list of `{value, label}`) | object mapping row value to column value |
| `ranking` | `options` (required) | array of all option values, best first |
| `scale` | `min`, `max` (required, whole numbers), `min_label`, `max_label` | whole number as a string |
| `date` | `min`, `max` (`YYYY-MM-DD`) | `YYYY-MM-DD` |
| `file` | `max_bytes` (at most `UPLOAD_MAX_BYTES`), `accept` (a subset of `pdf`, `png`, `jpeg`; all three when absent) | `{"name", "size", "type"}` once stored; set only by upload |
| `calculated` | `formula` (required), `places`, `prefix`, `suffix`, `hidden` | never sent by a browser |

Every question has `key` (lower-case letters, digits and underscores, starting with a letter, unique in the form), `type`, `label`, and the optional `help`, `required`, `show_rule` and `note` (an internal note the owner and co-editors see in the builder and response view, which never reaches respondents or email). Pages have `key`, `title`, `questions`, and the optional `show_rule` and `jumps`. `show_rule` is `{"name", "when"}`, a jump is `{"name", "when", "to"}`, and form-level `checks` are `{"name", "page", "target", "fail_when", "message"}`. An option is `{"value", "label"}`. Options entered in the builder's `Options` box are one per line, with value and label the same. A definition with an unknown type or field, a missing required field or a malformed option list answers 422 `CHANGE_INVALID` with the first problem as the message. A `set` or `add_question` change that brings in a save-time refusal (a formula, rule, jump, check or insertion problem, listed below) answers 422 `FORMULA_INVALID` instead. Other changes, such as removing or moving a question, are never refused for a save-time refusal: any refusal they cause stays in the draft as a problem. In a seed, every one of these, a duplicate key included, answers 422 `SEED_INVALID`, and a save-time refusal is refused only in an edition, because a draft may hold problems. The one exception is an `add_question` change, which is what the Add question dialog sends: it may leave out a grid's `rows` and `columns`, a scale's `min` and `max`, and a calculated question's `formula`. The server then fills in rows `[{"value": "row_1", "label": "Row 1"}]`, columns `[{"value": "col_1", "label": "Column 1"}]`, `min` 1 and `max` 5, and an empty formula, which is stored as a problem (Builder and Lit path) rather than refused. These are then edited with the selected question's `Rows`, `Columns`, `Minimum` and `Maximum` boxes and the Logic pane's `Formula` box. A duplicate key answers `DUPLICATE_KEY`. A bad key format answers 422 `VALIDATION_FAILED` with one item whose `key` is the rejected key and whose message is M82, so the Add question dialog shows M68 in `#alert` and M82 beside `Question key`.

#### Respondent rules

**Conditions.** A `show_rule` or a jump's `when` is a formula, and it counts as met when its value is true under Truth (Formula language). An error while evaluating counts as not met. A rule may use only questions that come earlier in the form, on an earlier page or earlier on the same page. A page's `show_rule` may use questions on earlier pages only. A jump may use its own page and earlier pages. A form-level check may use its `page` and earlier pages. Calculated fields follow the same earlier-only rule.

**The walk.** The server walks the form once, in order, from the first page. A page or question whose `show_rule` is not met is skipped. After a shown page, its jumps are tried in listed order, and the first one met sends the walk to its `to` page. Jumps go forward only. With no jump met, the walk goes to the next page. A page reached by a jump is still skipped if its own `show_rule` is not met, and the walk continues with the next page. Pages passed over by a jump are skipped by that jump's name, and pages hidden by their rule are skipped by the rule's name. `Page <n> of <m>` counts only shown pages for the current answers and changes as soon as an answer changes it. The last shown page has `Submit` in place of `Next`. Because the walk runs in form order, a hidden answer also hides everything that depended on it, in one pass.

The Supper club form, walked in this order:

| Answers | Pages shown | Shown questions | Answers that count |
|---|---|---|---|
| yes, 3 guests | About you, Meals, Travel, Anything else | attending, guests, meal, diet, parking, comment | attending, diet, guests, meal, parking |
| back: guests 1 | About you, Meals, Anything else | attending, guests, meal, diet, comment | attending, diet, guests, meal |
| back: attending No | About you, Anything else | attending, guests, comment | attending, guests |
| meal changed to Fish | About you, Meals, Travel, Anything else | attending, guests, meal, parking, comment | attending, guests, meal, parking |
| guests blank | About you, Meals, Anything else | attending, guests, meal, diet, comment | attending, diet, meal |

(The first row assumes attending Yes, 3 guests, Vegetarian, a diet and a parking answer were all given. Rows 2 and 3 each change one thing from the row before. Rows 4 and 5 each start again from the first row: row 4 changes the meal to Fish, and row 5 clears the guest count while the meal stays Vegetarian.)

**Hidden answers: kept, ignored, then discarded on submit.** An answer on a page or question that becomes hidden stays in the part-done response, counts as blank for every formula, rule, check, insertion and page count, and comes back if its page or question is shown again. On submit, only answers to shown questions are stored, and hidden ones are discarded for good, including their stored files. A commit that hides answered questions shows M06 or M07 in `#path-notice` and `#announcer`. One that brings them back shows M08 or M09. `#path-notice` keeps its last sentence until the page changes. Calculated fields are never counted. In the Supper club walk, guests changed to 1 counts 1 (parking), attending changed to No counts 3 (meal, diet, parking), and meal changed to Fish counts 1 (diet).

**Answer insertion.** `{{key}}` in a question's `label` or `help`, a page `title` or a check `message` inserts the current effective answer as plain text, never as markup, so typed `<b>x</b>` shows as those characters. What appears:
- text: as typed
- number: its Number text
- choice and dropdown: the option's `label`
- checkbox: the ticked labels joined by `, ` in option order
- date: as `<date>`
- grid row `{{key.row}}`: the chosen column's `label`
- calculated: its shown text

A blank or hidden answer inserts M10. Insertions on the page being filled update on each commit that changes them, and going back to change an answer changes it everywhere it appears. Accessible names use the filled label. Ranking, file and whole-grid questions cannot be inserted.

**Shuffling.** A `choice` or `checkbox` with `"shuffle": true` shows its options sorted by the ascending lower-case hexadecimal SHA-256 digest of `<SHUFFLE_SEED>:<question key>:<option value>`, so every respondent sees the same order. The summary and CSV keep definition order.

#### Checks

`Next` checks the current page. `Submit` checks the last page, then every shown page again in order, and opens the page with the first error. Blank optional answers skip every check. For each shown question, in page order, only the first failing check reports:

| # | Check | Applies to | Exact message |
|---|---|---|---|
| 1 | required | text, number | `<label>: answer this question.` |
| 1 | required | choice, dropdown, scale | `<label>: choose an option.` |
| 1 | required | checkbox | `<label>: tick at least one option.` |
| 1 | required | grid | `<label>: choose an option in every row.` |
| 1 | required | ranking | `<label>: move at least one option to set your order.` |
| 1 | required | date | `<label>: enter a date.` |
| 1 | required | file | `<label>: attach a file.` |
| 2 | format | number | `<label>: enter a number.` |
| 2 | format | date | `<label>: enter a real date as YYYY-MM-DD.` |
| 3 | length | text | `<label>: use at least <n> characters.`, `<label>: use at most <n> characters.` |
| 3 | decimals | number | `<label>: use at most <n> decimal places.` (with `decimals` 0: `<label>: enter a whole number.`) |
| 4 | range | number | `<label>: enter a number from <min> to <max>.`; only `min`: `<label>: enter a number from <min> or more.`; only `max`: `<label>: enter a number up to <max>.` |
| 4 | range | date | `<label>: enter a date from <min> to <max>.`; only `min`: `<label>: enter a date from <min> or later.`; only `max`: `<label>: enter a date up to <max>.` (dates as `<date>`) |
| 4 | count | checkbox | `<label>: tick from <min> to <max> options.`; only `min_selected`: `<label>: tick at least <min> options.`; only `max_selected`: `<label>: tick at most <max> options.` |
| 5 | pattern `email` | text | `<label>: enter an email address like name@example.com.` |
| 5 | pattern `phone` | text | `<label>: enter digits, spaces and an optional leading +.` |
| 5 | pattern `digits` | text | `<label>: use digits only.` |
| 5 | pattern `letters` | text | `<label>: use letters only.` |

Patterns: `email` is `^[^@\s]+@[^@\s]+\.[^@\s]+$`, `phone` is `^\+?[0-9 ]{7,20}$`, `digits` is `^[0-9]+$` and `letters` is `^[A-Za-z]+$`. A number answer must match `^-?[0-9]+(\.[0-9]+)?$` after trimming. Text length counts characters after trimming outside spaces. Required is met by any non-blank answer. A ranking becomes answered when an option is first moved. A required grid needs every row.

A choice value that is not an option, a checkbox value that is not an option, a grid cell outside its rows or columns, a ranking that is not a permutation, a non-string text value, or text over 10,000 characters is refused at commit with 422 `ANSWER_INVALID`.

Then the page's form-level `checks` run, in listed order. A check reports its `message`, with insertions filled, against its `target` question when `fail_when` is true. It runs only when every question its formula refers to, directly or through calculated fields, is shown, answered and free of any error above. At most one check reports per target (the first), and an error while evaluating counts as not failed. Errors appear in page order of the question or target they belong to.

Worked checks. A Trip form has `{"name": "Dates in order", "page": "trip", "target": "end", "fail_when": "{end} <= {start}", "message": "End date must be after the start date."}`. A Budget form has `pct_total` = `{rent} + {food} + {other}` and `{"name": "Adds to 100", "page": "budget", "target": "other", "fail_when": "{pct_total} <> 100", "message": "The percentages must total 100. They total {{pct_total}}."}`. Exact decimals decide:

| Answers | Exact total | Check |
|---|---|---|
| `33.3 + 33.3 + 33.4` | `100` | passes |
| `10.1 + 20.2 + 69.7` | `100` | passes |
| `0.1 + 0.2 + 99.7` | `100` | passes |
| `33.3 + 33.3 + 33.3` | `99.9` | reports, ending `They total 99.9.` |
| `50 + 50 + 1` | `101` | reports |
| `70.1 + 29.8 + 0.1` | `100` | passes |
| `1.1 + 2.2 + 96.7` | `100` | passes |

#### Formula language

The formula language is Nightform's own small parser and evaluator. No owner or respondent text is ever run as code by any language feature. Every save-time check and every evaluation answers within one second, whatever the input.

**Values.** Numbers are exact decimals, written `12` or `3.50`, and never binary floating point. Text is in double quotes (`"Fish"`) with no escapes. There are `true` and `false`, dates (from `DATE("2026-03-14")`, date answers or `TODAY()`), and blank. References are `{key}`, and `{key.row}` for one grid row. Function names and `AND`, `OR`, `NOT`, `TRUE` and `FALSE` are not case-sensitive. Keys are.

| Reference | Value |
|---|---|
| text, choice, dropdown | text (choice and dropdown give the option's `value`) |
| number, scale | number |
| date | date |
| grid row `{key.row}` | text (the column's `value`) |
| checkbox | a tick list, usable only in `HAS`, `TICKED`, `BLANK`, `COUNT` |
| ranking, file, whole grid `{key}` | usable only in `BLANK` and `COUNT` |
| calculated | its value |

**Operators, tightest first:**

| Level | Operators | Notes |
|---|---|---|
| 1 | `( )`, function calls | |
| 2 | `^` | right to left; the power is a whole number from 0 to 64 |
| 3 | unary `-` | looser than `^`, so `-2 ^ 2` is `-4` |
| 4 | `*`, `/`, `%` | left to right; a `%` result takes the sign of the right side |
| 5 | `+`, `-` | left to right |
| 6 | `&` | joins text; numbers join as Number text, dates as `<date>`, truth values as `true` or `false` |
| 7 | `=`, `<>`, `<`, `<=`, `>`, `>=` | not chained; text compares without regard to case; `=` and `<>` between different kinds give false and true; `<` and the like between different kinds fail |
| 8 | `NOT` | |
| 9 | `AND` | stops at the first false |
| 10 | `OR` | stops at the first true |

**Numbers and rounding.** `+`, `-`, `*` and `^` are exact. Every number a step produces may have at most 1,000 digits, counting every digit of the whole-number part and every digit after the decimal point up to the last non-zero one. Exactly 1,000 digits is allowed, and a step that would produce more fails with `Cannot calculate: the number is too large.`, so no evaluation does unbounded work. `/` and `AVG` keep 12 decimal places, rounding half away from zero. `ROUND(x, n)` rounds half away from zero, and a negative `n` rounds to tens or hundreds. A calculated field's `places` rounds what is shown the same way and shows exactly that many decimals. Without `places` it shows Number text. `prefix` and `suffix` go around the number. A later formula uses the unrounded value, not the shown text. Dates show as `<date>`, text as it is, and truth values as `true` or `false`.

| Formula | Result |
|---|---|
| `0.1 + 0.2` | `0.3` |
| `1.1 * 3` | `3.3` |
| `ROUND(2.675, 2)` | `2.68` |
| `ROUND(1.005, 2)` | `1.01` |
| `ROUND(-2.5, 0)` | `-3` |
| `ROUND(1234.5678, -2)` | `1200` |
| `2 + 3 * 4 ^ 2` | `50` |
| `-2 ^ 2` | `-4` |
| `2 ^ 3 ^ 2` | `512` |
| `(2 + 3) * 4` | `20` |
| `7 % 3` | `1` |
| `-7 % 3` | `2` |
| `10 / 4` | `2.5` |
| `1 / 3 * 3` | `0.999999999999` |
| `2 ^ 0.5` | `Cannot calculate: the power must be a whole number from 0 to 64.` |
| `1 / 0` | `Cannot calculate: division by zero.` |
| `5 % 0` | `Cannot calculate: division by zero.` |
| `2 ^ 65` | `Cannot calculate: the power must be a whole number from 0 to 64.` |
| `(10 ^ 60) ^ 20` | `Cannot calculate: the number is too large.` |
| `FLOOR(-1.5)` | `-2` |
| `CEIL(-1.5)` | `-1` |
| `DATE("2026-02-30")` | `Cannot calculate: it needs a date written YYYY-MM-DD.` |
| `"a" + 1` | `Cannot calculate: it needs a number.` |

| Value and places | Shown |
|---|---|
| `7 / 3` at 2 places | `2.33` |
| `1 / 3 * 3` at 2 places | `1.00` |
| `0.125` at 2 places | `0.13` |
| `2.5` at 0 places | `3` |
| `19.999` at 2 places | `20.00` |

**Functions (the complete list).**
- `SUM(a, ...)`, `MIN(a, ...)`, `MAX(a, ...)`, `AVG(a, ...)`, and `COUNT(a, ...)` (the number of answers that are not blank)
- `ROUND(x, n)`, `FLOOR(x)`, `CEIL(x)`, `ABS(x)`
- `IF(test, a, b)`, where only the chosen side is evaluated
- `BLANK(x)`
- `LEN(t)`, `UPPER(t)`, `LOWER(t)`, and `TRIM(t)` (outer spaces off, inner runs of spaces cut to one)
- `DATE("YYYY-MM-DD")`, `DAYS(a, b)` (a minus b in days), and `ADD_DAYS(d, n)` (the fractional part of `n` is dropped toward zero)
- `TODAY()`, the server date in `APP_TZ`
- `HAS(list, "value")`, and `TICKED(list)` (the number of ticks)

The listed functions take 1 or more values (SUM, MIN, MAX, AVG, COUNT), exactly 1 (FLOOR, CEIL, ABS, BLANK, LEN, UPPER, LOWER, TRIM, DATE, TICKED), exactly 2 (ROUND, DAYS, ADD_DAYS, HAS), exactly 3 (IF) or none (TODAY).

Worked, with `{n}` holding `  ana   maria `, `{s}` 14 Mar 2026, `{e}` 1 Mar 2026 and the server clock on 16 Mar 2026:

| Formula | Result |
|---|---|
| `UPPER("ada")` | `ADA` |
| `LOWER("ADA")` | `ada` |
| `TRIM({n})` | `ana maria` |
| `LEN("héllo")` | `5` |
| `"Yes" = "yes"` | `true` |
| `1 & " of " & 2` | `1 of 2` |
| `"10" = 10` | `false` |
| `DAYS({s}, {e})` | `13` |
| `DAYS({e}, {s})` | `-13` |
| `ADD_DAYS({s}, 20)` | `3 Apr 2026` |
| `ADD_DAYS(DATE("2026-02-27"), 2)` | `1 Mar 2026` |
| `{s} > {e}` | `true` |
| `TODAY()` | `16 Mar 2026` |
| `DAYS(TODAY(), DATE("2026-01-01"))` | `74` |
| `"Due " & ADD_DAYS({s}, 1)` | `Due 15 Mar 2026` |

**Blank answers.** Blank is an unanswered, hidden or empty answer, and empty text is blank. In arithmetic, blank is 0. With `&` it is empty text. `SUM`, `MIN`, `MAX` and `AVG` leave it out, and with nothing left `SUM` is 0 and the others are blank. `=` is true only against blank. `<>` is true unless both sides are blank. `<`, `<=`, `>` and `>=` are false. `ROUND`, `FLOOR`, `CEIL`, `ABS`, `DAYS` and `ADD_DAYS` give blank. `LEN` gives 0.

**Truth.** True values are true, a non-zero number, non-empty text, a date, and a tick list with a tick. False values are false, 0 and blank.

A blank calculated field shows M11. Worked, with `{a}` blank and `{b}` 4:

| Formula | Result |
|---|---|
| `{a} + 5` | `5` |
| `{a} * 5` | `0` |
| `{a} & "x"` | `x` |
| `{a} = 0` | `false` |
| `{a} = ""` | `true` |
| `{a} > 3` | `false` |
| `{a} < 3` | `false` |
| `{a} <> 3` | `true` |
| `BLANK({a})` | `true` |
| `SUM({a}, {b})` | `4` |
| `AVG({a}, {b})` | `4` |
| `MIN({a}, {b})` | `4` |
| `MAX({a})` | `Not calculated yet` |
| `COUNT({a}, {b})` | `1` |
| `ROUND({a}, 2)` | `Not calculated yet` |
| `{a}` | `Not calculated yet` |
| `DAYS({a}, {b})` | `Not calculated yet` |
| `NOT {a}` | `true` |
| `IF({a}, 1, 2)` | `2` |
| `LEN({a})` | `0` |

**Errors while calculating.** A calculated field that fails shows `Cannot calculate: <reason>` and counts as blank for later formulas. The reasons are `division by zero.`, `it needs a number.`, `these answers cannot be compared.`, `the power must be a whole number from 0 to 64.`, `the number is too large.` and `it needs a date written YYYY-MM-DD.` Text never turns into a number by itself.

**Save-time refusals.** These are shown in the builder and returned as `FORMULA_INVALID`. `Column <n>` counts characters from 1. The whole formula is read for characters first, then for grammar. At the end of the input, a missing bracket is reported when the expression before it is complete, and an early end otherwise, both at the column just past the last character.

| Formula | Refusal |
|---|---|
| (empty) | `Column 1: the formula is empty.` |
| `1 +` | `Column 4: the formula ends too early.` |
| `(1 + 2` | `Column 7: a closing bracket is missing.` |
| `SUM(1` | `Column 6: a closing bracket is missing.` |
| `1 $ 2` | `Column 3: unexpected character $.` |
| `"open` | `Column 1: this text has no closing quote.` |
| `ROUND(1)` | `Column 1: ROUND takes 2 values.` |
| `IF(1, 2)` | `Column 1: IF takes 3 values.` |
| `SUMM(1)` | `Column 1: there is no function called SUMM.` |
| `1 2` | `Column 3: unexpected 2.` |
| `foo` | `Column 1: unexpected foo.` |
| `TODAY(1)` | `Column 1: TODAY takes 0 values.` |
| `SUM()` | `Column 1: SUM takes at least 1 value.` |
| `FLOOR(1, 2)` | `Column 1: FLOOR takes 1 value.` |
| `)` | `Column 1: unexpected ).` |
| `process.exit()` | `Column 8: unexpected character ..` |
| `constructor.constructor(1)` | `Column 12: unexpected character ..` |
| a formula of 501 characters | `The formula is longer than 500 characters.` |
| 17 levels of nested brackets | `The formula has more than 16 levels of brackets.` |

Also at save:
- `Column <n>: there is no question called {<key>}.`
- `Column <n>: {<key>} comes later in the form, so it cannot be used here.`
- `Column <n>: a calculated field cannot use itself.`
- `Column <n>: a rule cannot use the question it belongs to.`
- `Column <n>: {<key>} can only be used inside HAS, TICKED, BLANK or COUNT.` (checkbox)
- `Column <n>: {<key>} can only be used inside BLANK or COUNT.` (ranking, file, whole grid)
- `A jump can only go to a later page.`
- for `{{key}}` in text: `{{<key>}} comes later in the form, so it cannot be inserted here.`, `{{<key>}} is not a question in this form.` and `{{<key>}} cannot be inserted.` (ranking, file, whole grid)

Together with the earlier-only rule, these make a dependency cycle impossible. The length cap is `FORMULA_MAX_CHARS` and the depth cap is `FORMULA_MAX_DEPTH`. A formula exactly at the cap is allowed. Function-call brackets count as levels. The two messages print the configured numbers.

**Worked example, the Bakery pre-order.** `subtotal` = `{loaves} * 3.35 + {rolls} * 0.45`; `discount` = `ROUND(IF({subtotal} >= 20, {subtotal} * 0.125, 0), 2)`; `total` = `{subtotal} - {discount} + IF({delivery} = "yes", 2.5, 0)`; `each` = `{total} / {people}`. All four have `"places": 2` and `"prefix": "£"`.

| loaves | rolls | delivery | people | subtotal | discount | total | each |
|---|---|---|---|---|---|---|---|
| 3 | 7 | yes | 4 | £13.20 | £0.00 | £15.70 | £3.93 |
| 3 | blank | no | 2 | £10.05 | £0.00 | £10.05 | £5.03 |
| 5 | 7 | no | 3 | £19.90 | £0.00 | £19.90 | £6.63 |
| blank | blank | no | 1 | £0.00 | £0.00 | £0.00 | £0.00 |
| 6 | 3 | yes | blank | £21.45 | £2.68 | £21.27 | Cannot calculate: division by zero. |
| 7 | 1 | no | 2 | £23.90 | £2.99 | £20.91 | £10.46 |
| 8 | 4 | no | 3 | £28.60 | £3.58 | £25.02 | £8.34 |

#### Save and resume

`Save and finish later` opens its dialog, and `Send link` commits the current page without checks and saves. On success `#save-status` shows M13, or M14 while the email waits in the outbox. Mail has subject `Continue your form: <form title>`, goes to that address, and its body holds the link `<APP_BASE_URL>/r/<token>`, the expiry as `<date, time>`, and the respondent's shown answers so far as `<label>: <answer>` lines, each answer as Answer text (Formats). It never includes hidden calculated fields or notes. There is one token per response, and each save mails the same link to the address given.

- **Window.** The link is valid until `RESUME_TTL_HOURS` after the last save, and each save moves the expiry. At exactly the expiry instant it still works. From one second after, it answers 404 `LINK_EXPIRED` and the page shows M19, and the response becomes `expired`. A part-done response that was never saved expires `RESUME_TTL_HOURS` after it was created. Any request on an expired response answers 404 `LINK_EXPIRED`.
- **Opening the link** on any device shows the saved answers on the saved page with M15 in `#notice`, and makes that browser the response's device. A device that loses the response gets 409 `DRAFT_MOVED` on its next commit, `Next`, `Back`, `Save` or `Submit` (and a `moved` push over `/ws`). It never overwrites the other device's answers.
- **Once submitted**, the link answers 404 `ALREADY_SENT` (page M20). An unknown token answers 404 `NOT_FOUND`.
- **If the form changed.** A part-done response stays on its edition while its page is open and may be submitted on it. When a link is opened after a newer edition went live, the response moves to the newest edition. Each answer is kept if its key still exists with the same type and its value is still allowed (an option still exists, a number is still in range), and the rest are dropped. `#notice` shows M16, M17 or M18. The page opened is the first page on the new walk with an empty required question or a dropped answer, or else the saved page.
- **A closed form's link** answers 409 `FORM_CLOSED` and shows the closed panel.
- Resume emails per IP are capped at `RESUME_EMAIL_PER_HOUR`. The next one in the same clock hour answers 429.

A part-done response is private to the device or link holding it. Nobody else, including the form's owner and co-editors, can read a part-done answer, and every such read answers 404.

#### Closing rules

Settings are `closes_at` (a local date and time in `APP_TZ`, entered in the builder as `YYYY-MM-DD HH:MM`, or null), `response_limit` (a whole number of 1 or more, or null), `closed_message` (or null) and `copy_to` (the key of a text question with pattern `email`, or null).

Form state machine:

| From | Event | To |
|---|---|---|
| draft | Publish | open, or closed at once if the settings already close it |
| open | Publish | open, with the new edition live |
| open | server clock reaches `closes_at` | closed (`time`) |
| open | submitted count reaches `response_limit` | closed (`limit`) |
| open | `Close now` | closed (`hand`) |
| open | settings saved with `closes_at` already reached or a limit at or under the count | closed (`time` or `limit`) |
| closed | Publish | closed, with the new edition live |
| closed | `Reopen form` | open: publishes the draft as a new edition, clears hand-closing, sets a reached `closes_at` and a reached `response_limit` to null |

Illegal edges: reopening an open form answers 409 `FORM_OPEN`. Closing or reopening a draft answers 409 `FORM_DRAFT`. Closing a closed form is a 200 no-op. Saving settings never reopens a closed form, and deleting responses never reopens one.

- **Opening a closed form** shows `#closed-panel` with M22, then the closed text. No part-done response is created.
- **Mid-form.** When the form closes while a respondent has it open, the server pushes `form_state` over `/ws` within 2 seconds of the server clock reaching `closes_at` (including when the grading clock is moved past it) or of the limit being reached. The panel then appears with the extra line M26. A commit, `Next`, `Back`, `Save` or `Submit` that arrives first answers 409 `FORM_CLOSED`, with the closed text as its message, and shows the same panel and line.
- **At closing time.** A submit arriving at or after `closes_at` by the server clock is refused, whatever the page shows. One arriving at 16:59:59 for a 17:00 closing is accepted.
- **The limit.** Submits are settled one at a time in one database transaction against the form's limit row, so the submitted count never passes the limit. Of two respondents submitting for the last place, exactly one gets the confirmation and the other gets the panel and M26. The limit counts submitted responses across all editions, minus deleted ones.
- The owner's `#form-state` badge and the `state` in every API reply come from the server, and the badge updates over `/ws` within 2 seconds of a change.

#### Submit

`Submit` sends `POST /api/responses/<id>/submit` with an `Idempotency-Key` header. The key is scoped to the response and remembered for good. A replay with the same key and body returns the original 200 body with `"replayed": true`. The same key with another body, or on another response, answers 409 `IDEMPOTENCY_CONFLICT`. A submit with a new key on a submitted response answers 409 `ALREADY_SUBMITTED`. Two simultaneous requests with one key create one response: the second waits and returns the replay. Submits per IP are capped at `SUBMIT_PER_MINUTE` per clock minute, and the next one answers 429.

Response state machine: partial goes to submitted (Submit with no errors on an open form), or to expired (window lapsed, judged at request time). A submitted response can be deleted by the owner, after which it is gone from every count and its reference answers 404. Commits on a submitted response answer 409 `ALREADY_SUBMITTED`.

**Email copy.** When `copy_to` is set and answered, the submitted response and its email copy are written in the same transaction: either both happen or neither does. The copy has subject `Your copy: <form title>`. Its body is M28, then one line per shown question in order as `<label>: <answer>`, with each answer as Answer text (Formats). Calculated fields with `hidden` true and every `note` are left out. It is sent once. The confirmation shows M14 when the copy was not yet accepted by Mailpit.

A response stays pinned to the edition it was submitted against. Its owner view always shows that edition's wording, options and calculated results.

#### File answers

`Choose file` picks one file and uploads it at once. While it stores, `#upload-<key>` shows M30 with `aria-busy="true"`. The answer counts as attached only after MinIO confirms the object, and then shows M31 and `Remove <name>`. A type outside `accept` (judged by the file's content type: `application/pdf`, `image/png`, `image/jpeg`) answers 422 `FILE_TYPE`. A file over `max_bytes` (or `UPLOAD_MAX_BYTES` when unset) answers 422 `FILE_TOO_LARGE`, and a file of exactly that size is allowed. On a storage failure, the reply is 503 `UPLOAD_FAILED`, nothing is attached, `Choose file` keeps working, and `Next` treats the question as unanswered. A new upload replaces the earlier file. The owner's response view has `Download <name>` only for confirmed files, and never lists a file whose write failed. Respondents never get a download link. Files are served only to the form's owner and co-editors, and everyone else gets 404.

#### Builder and Lit path

Publishing makes the current draft the next numbered edition, counting up from 1 by one each time. The edition is stored byte for byte as published and never changes afterwards. Publishing is refused with 422 `FORMULA_PROBLEMS` while the draft has any problem. A problem is any save-time refusal that structural changes left in a stored formula, rule, check or insertion, for example a reference to a removed question. A calculated question added without a formula keeps the empty formula, a problem reported with the empty-formula refusal of Formula language, until one is saved. Draft edits never affect respondents, who keep seeing the live edition.

**Lit path.** Every trial change sends `POST /api/forms/<id>/trial` with a rising `seq`, and the server evaluates the draft with the same engine respondents use. The builder discards any reply whose `seq` is older than the newest one applied. `Page map` has one `listitem` per page in form order, with `data-page="<key>"` and `data-state` of `lit` or `skipped`, holding one line per question with `data-question="<key>"` and the same two states. A skipped item shows M47 with its `skipped_by`. `#lit-marker` has `data-page` set to the last lit page. `#trial-values` holds one M12 line per calculated field, including hidden ones, with `data-key="<key>"`. After each reply `#announcer` reads M45 or M46, where `<all>` is every page in the draft. For example: `Path: 4 of 6 pages shown, Total £38.50`. The lit set, dimmed set and values always equal the server's newest reply. The builder evaluates once with no trial answers when it opens.

#### Live editing

Co-editors are invited from `Invite editor`. Mail has subject `Join <form title> on Nightform` and holds the inviter's name and the link `<APP_BASE_URL>/invite/<token>`. The link is valid for `INVITE_TTL_HOURS` and works once. The reply is M50 whatever the email. Any signed-in account that opens the link and presses `Accept invitation` becomes a co-editor, after which the link answers 404. Signed out, the invitation page offers `Sign in` and `Create account`, both of which return to it.

Each change goes over `/ws`, or through `POST /api/forms/<id>/changes` while Valkey is down. The server gives it the next number from the form's Valkey sequence, and that number is its server order and the draft's new revision. Changes apply in that order on the server and on every open builder, on any app instance, within 2 seconds. Changes to different fields both survive. For the same field (same `key` and `field`), the later change in server order wins. When a change replaces a value another editor committed after this change's `base_rev`, the reply's `conflict_with` names that editor. Their builder replaces the value and shows M52, naming the winner, in `#notice` and `#announcer`. A change naming a question or page that no longer exists is dropped, and its sender sees M85. While Valkey is down, changes made on one builder apply in Postgres order when `Save changes` is pressed. `#presence` lists the other editors who have the builder open, updating within 2 seconds of anyone joining and within 30 seconds of anyone leaving.

#### Summary

`/forms/<id>/summary` and `GET /api/forms/<id>/summary` count only submitted responses that have not been deleted, across all editions. Questions are matched by key, take the newest edition's raw label and keep options removed in later editions as rows. The summary object is `{"count", "questions": [{"key", "label", "type", "answered", "rows": [{"value", "label", "count", "percent"}], "mean", "lowest", "highest", "grid": [{"row", "label", "rows": [...]}], "ranking": [{"value", "label", "mean_position"}]}]}`, with numbers as Number text strings except `percent`, `mean` and `mean_position`, which use the fixed decimals below.

- `#response-count` shows M55 or M56.
- choice, dropdown, checkbox, scale: a table with columns `Option`, `Count` and `Percent`, rows in definition order (scale rows from min to max). The percent is the share of those who answered this question, to 1 decimal, rounded half away from zero, followed by `%`: 1 of 3 is `33.3%`, 2 of 3 is `66.7%`, 1 of 8 is `12.5%`, 1 of 6 is `16.7%`, 0 of 0 is `0.0%`, 5 of 5 is `100.0%`, 1 of 16 is `6.3%` and 3 of 16 is `18.8%`. Percents need not total 100. The SVG chart has one `rect` per option with `data-option` (the value) and `data-count`, and each bar's width is in proportion to its count over the largest count, so a zero count has zero width.
- number, scale and numeric calculated fields: M58 lines, with the mean to 2 decimals rounded half away from zero (4, 5 and 4 give `4.33`; 1 and 2 give `1.50`; 3, 4, 4, 5, 5 and 5 give `4.33`; 2.5 and 3.125 give `2.81`), and lowest and highest as Number text.
- grid: one table per row in the same shape.
- ranking: a table with columns `Option` and `Mean position`, to 2 decimals, best first, with ties in option order.
- every question: M57. A hidden or blank answer counts as not answered, so text, date and file questions show only this line.

The open summary receives the new summary over `/ws` within 2 seconds of any submit or delete on any instance, and `#announcer` reads the count text whenever it changes. Deleting through `Delete response <reference>` and `Delete` in its dialog removes the response and shows M63. Only the owner can delete.

#### CSV export

`Export CSV` creates an export, stores it in MinIO and only then announces M60 or M61 and shows `Download CSV`. The link serves the stored object to the owner and co-editors for `EXPORT_LINK_TTL_MINUTES` after creation, and answers 404 after that. The file is UTF-8 with no byte-order mark, CRLF line ends and RFC 4180 quoting. Rows run oldest first by `submitted_at`. The columns are `response_id`, `submitted_at` and `edition`, then one per question key of the newest edition in form order (a grid gets one column per row, named `<key>.<row>`), then keys found only in older editions, in first-seen order.

| Type | Cell |
|---|---|
| `submitted_at` | ISO 8601 with offset in `APP_TZ`, for example `2026-03-14T17:00:00+00:00` |
| number, scale | Number text (`3.5`) |
| date | `YYYY-MM-DD` |
| choice, dropdown, grid row | the option's `value` |
| checkbox | ticked values in definition order, joined by `; ` |
| ranking | values best first, joined by ` > ` |
| file | file name |
| text | as stored |
| calculated | the shown text without prefix or suffix (hidden fields included); empty when it failed or is blank |
| not answered or hidden | empty |

Formula neutralising: cells for number and scale answers, numeric calculated values, dates, and the `response_id`, `submitted_at` and `edition` columns are written as they are. Every other non-empty cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, so a respondent's `=SUM(A1)` exports as `'=SUM(A1)`.

#### Accounts and visibility

Sign-up needs a name, a valid email that has no account yet, and a password of at least 8 characters. Emails are compared without regard to case. Sign-in with a wrong email or a wrong password gets the same M64. The session cookie `nf_session` is HttpOnly, SameSite=Lax, Path=/. Signed out, `/forms` redirects to `/signin`, and every other owner page shows the not-found page.

Each of these answers 404 (`NOT_FOUND`, M65):
- another owner's form (edit, summary, responses, response, export, files, editions)
- any owner route for someone who is neither the form's owner nor one of its co-editors
- owner-only routes for a co-editor
- a closed form's builder and builder socket for co-editors (the owner keeps them, read-write, until reopening)
- any read of a part-done answer by anyone but its device or link
- a submitted response for anyone but the form's owner and co-editors
- grading routes without the key

A respondent's only read is their own part-done response.

### Services (DP-12, DP-30, DP-31, DP-33, DP-42, DP-45, DP-48, DP-56)

- **Postgres** (`DATABASE_URL`): accounts, sessions, workspaces, forms, drafts and their revisions, numbered editions stored exactly as published, partial and submitted responses each pinned to its edition, resume and invitation tokens, idempotency records, the per-form response-limit row that settles races, the grading clock, export records and the durable mail outbox. The schema is applied idempotently every time the app serves.
- **Mailpit** (`SMTP_HOST`, `SMTP_PORT`): every email is sent from `MAIL_FROM`. These are the resume email (to the address given, subject `Continue your form: <form title>`), the email copy (to the `copy_to` answer, subject `Your copy: <form title>`) and the invitation (to the invitee, subject `Join <form title> on Nightform`). Every email is first written to the outbox in Postgres in the same transaction as the action that causes it. It is then delivered and marked sent exactly once, and retried at least every 30 seconds while Mailpit is unreachable. Down: actions still succeed, and the screens show M14 where Save and Submit report.
- **MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`): file answers are stored byte for byte with their content type at `files/<form id>/<response id>/<question key>/<file id>`, and CSV exports at `exports/<form id>/<export id>.csv`. Nothing else is stored there. Files discarded on submit are deleted. Down: uploads answer 503 `UPLOAD_FAILED` (M34), exports answer 503 `EXPORT_FAILED` (M62), a form with a required file question cannot pass that page, and nothing else fails.
- **Valkey** (`VALKEY_URL`): the per-form change sequence `nf:form:<form id>:seq` (incremented once per applied change); pub/sub channel `nf:form:<form id>` for changes, presence and form state, and `nf:summary:<form id>` for summary pushes, so every app instance fans out to its own sockets; presence hash `nf:presence:<form id>` with a 30-second expiry refreshed while builders are open; rate-limit counters `nf:rl:submit:<ip>:<YYYYMMDDHHMM>` (60-second expiry) and `nf:rl:resume:<ip>:<YYYYMMDDHH>` (3,600-second expiry), both keyed by the server clock. Down: submissions still succeed; the builder shows M53 in `#live-status` with `Save changes`, and presence is empty; the summary shows M59 in `#live-status` and is correct after a reload; rate limits pause; nothing else fails.

On every instance, `/api/health` answers 200 `{"status":"ok"}` while the process runs, and `GET /api/services` reports each dependency as `up` or `down`.

### Seed data (DP-57)

At start the database is empty: no accounts, forms or responses. Tests create everything through the grading routes. Every person, business and form in this brief is invented. The reference forms, which tests seed by these keys and labels:

- **Supper club RSVP**: exactly the definition in Form definition.
- **Bakery pre-order**: one page `order` titled `Your order` with `loaves` (`Loaves`, number, decimals 0, min 0), `rolls` (`Rolls`, number, decimals 0, min 0), `delivery` (`Delivery`, choice with values and labels `yes` and `no`), `people` (`People sharing`, number, decimals 0), then the calculated `subtotal` (`Subtotal`), `discount` (`Discount`), `total` (`Total`) and `each` (`Each`) of the worked example, then a hidden calculated `margin` (`Margin`, `{total} * 0.3`, places 2, hidden true), then `bulk_note` (`Collection time for large orders`, short text, shown by `{"name": "Large order", "when": "{total} >= 20"}`), then `email` (`Your email`, short text, pattern email). `copy_to` is `email`.
- **Trip dates**: page `trip` titled `Your trip` with `start` (`Start date`, date, required) and `end` (`End date`, date, required), and the check `Dates in order`.
- **Household budget**: page `budget` titled `Budget` with `rent` (`Rent percent`), `food` (`Food percent`) and `other` (`Other percent`), each a required number with decimals 1, then the calculated `pct_total` (`Percent total`) and the check `Adds to 100`.

For example, with a seed of user `owen` (`Owen Hale`, `owen@example.test`, `pw-owen-1`) owning the Supper club form, the reply's `fill_url` is `<APP_BASE_URL>/f/<slug>`.

## Technical requirements

### Deployment (DP-58)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build`.

One Node app server serves the API, the `/ws` WebSocket, the built browser client and the Work Sans font file, all on one port. `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

`serve` binds `0.0.0.0` on `APP_PUBLIC_PORT`, defaulting to 4173, and applies the database schema idempotently before answering. `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}`. Several instances may run against the same database, bucket and Valkey at once (the outage instances are such copies). They share all data, and live changes cross between them through Valkey.

### Configuration and secrets (DP-59)

Every variable below is read from the environment at start and never hard-coded; the published defaults (port 4173, and the `APP_BASE_URL` fallbacks to `APP_PUBLIC_URL`, then `http://localhost:<port>`) are allowed. No credential, service URL or grading key reaches the browser. A configured value reaches the browser only where a published message prints it, such as the `APP_TZ` name in M23, the formula caps in the formula refusals and the upload limit in M33. Numbers this brief states without a variable, such as the 1,000,000-byte JSON body cap and the 10,000-character text cap, are fixed parts of the product, not configuration.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres |
| `VALKEY_URL` | Valkey; the app takes host, port, user and password from it, and an address where nothing answers (any scheme) means Valkey is down |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit and the From line |
| `GRADING_KEY` | enables the grading routes; unset means they answer 404 |
| `APP_TZ` | time zone for every server time rule and display (grading: `Europe/London`) |
| `APP_BASE_URL` | origin used in emailed links; falls back to `APP_PUBLIC_URL`, then `http://localhost:<port>` |
| `RESUME_TTL_HOURS` | resume window in hours after the last save (grading: 720) |
| `INVITE_TTL_HOURS` | invitation link lifetime in hours (grading: 72) |
| `SHUFFLE_SEED` | shuffle seed (grading: `nightform-1`) |
| `UPLOAD_MAX_BYTES` | largest allowed file in bytes, inclusive (grading: 2097152) |
| `RESUME_EMAIL_PER_HOUR` | resume emails per IP per clock hour (grading: 20) |
| `SUBMIT_PER_MINUTE` | submits per IP per clock minute (grading: 60) |
| `FORMULA_MAX_CHARS` | longest allowed formula in characters, inclusive (grading: 500) |
| `FORMULA_MAX_DEPTH` | deepest allowed bracket nesting, inclusive (grading: 16) |
| `EXPORT_LINK_TTL_MINUTES` | export link lifetime in minutes (grading: 60) |

### Server boundary (DP-52, DP-58)

- Same origin only. State-changing requests whose `Origin` header names another origin answer 404, and `/ws` upgrades from another origin are refused. No CORS headers are sent.
- JSON bodies are limited to 1,000,000 bytes (inclusive). Larger ones answer 413 `BODY_TOO_LARGE` (M71) before anything else. File uploads are limited by File answers.
- The server never serves source files, the run manifest, environment values, credentials, stack traces or directory listings. Unknown paths answer the not-found page (404) and unknown API paths answer 404 `NOT_FOUND`.
- No external request is made at runtime: no CDN, analytics or remote fonts. No service worker is registered.
- At boot, an unreachable Valkey, MinIO or Mailpit never stops the app. It serves with that service marked down and reconnects when the service returns. An unreachable Postgres is retried until it answers, while `/api/health` already reports the process.

### Browser support and performance (DP-54)

Current Chromium, Firefox and WebKit, by mouse, touch and keyboard, at the published viewports and every width from 320 to 1440 pixels. A respondent page or the builder is usable within 3 seconds of navigation on the grading machine. Commit, trial, next and back replies are applied within 1 second. Live pushes arrive within the 2 seconds their rules state.

### How Nightform is checked (DP-53, DP-55, DP-57)

Checks read only DOM attributes, accessible roles and names, published text, computed layout sizes and positions, the page's running animations list, and API, Mailpit, MinIO, Valkey and Postgres records. They never compare colours or pixels. Tests add a seeded `session` value as the `nf_session` cookie instead of signing in. Pages are opened with the page clock paused and moved by hand, and with service workers blocked, which is why the timing rule in Interactions matters. The server clock moves only through the grading clock route.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and the app runs from it alone.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its version and licence, plus the Work Sans font.
- IF-03: Every shipped package is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0, and the font is under OFL-1.1, with its licence file committed.
- IF-04: The app stores data only in the provided Postgres, Valkey and MinIO and sends mail only through the provided SMTP server: no SQLite, no other database or queue, and no files written for app data.
- IF-05: All app source is TypeScript, `package-lock.json` is committed, and `install` uses `npm ci`.
- IF-06: The browser loads nothing from another origin at runtime, and no service worker is registered.
- IF-07: The provided service configuration files (the dev compose services and their environment) are left unchanged.
- IF-08: No grading-only behaviour exists outside the published grading routes and the `GRADING_KEY` they require.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes, and names match the domain terms in this brief: form, edition, draft, page, question, show rule, jump, check, calculated field, response, resume link, co-editor, Lit path.
- The walk, the formula evaluator, the checks and insertion are decided in exactly one place on the server, and the builder trial, the respondent page and submit validation all call it. The browser never recomputes them.
- Each state transition (form open and closed, response partial, submitted and expired) and each derived value (page count, summary numbers, CSV cells, closed text) is decided in exactly one place in the source.
- Every API error is produced through the one error shape and the one precedence order. No route builds its own error format.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive check for a state the types or the database already rule out.
- Every timer, limit and credential comes from configuration read once at start. No literal duplicates a configured value.
- There are no features beyond this brief.
