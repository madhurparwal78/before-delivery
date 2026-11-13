# Cutline Jury Desk

Cutline Jury Desk runs a juried web and digital design prize program for a founder who works alone. Studios pay an entry fee and upload case-study images, and they can follow their entry through each judging round. Jurors score blind entries against published criteria and declare their conflicts. The program director screens entries, builds conflict-free panels, closes rounds into normalised standings with a visible shortlist cut, and publishes results at an embargo time. Visitors browse past winners and watch a live leaderboard while results are revealed. The desk uses four backend services. Postgres is the system of record. Kill Bill records entry-fee invoices, payments and refunds. MinIO stores case-study images and jury packets. Mailpit receives every email the desk sends. Out of scope: any other datastore, any sign-in provider other than the desk's own email-and-password accounts, card entry forms, public comments, voting by visitors, and any payment provider other than Kill Bill.

## Problem and users

Independent design prizes often depend on a single founder who lives on entry fees of about 40 to 90 US dollars. Today the program is held together with a form builder, payment links, shared scoring spreadsheets and email threads full of conflict disclosures. Studios cannot tell whether their payment, their images and their entry arrived together as one complete submission. Jurors sometimes receive a rival's entry, or an entry from a former client, because the conflict was buried in an inbox. One harsh or generous juror can move the shortlist unless the founder corrects the scores by hand. Results also leak through spreadsheet links before the announcement. The large prize programs solve these problems with expensive association software and private statistical normalisation. A one-person program cannot afford that, so the founder pays in late nights, refund disputes and lost trust.

- **Studio entrant** (weekly): submits a paid entry with case-study images, gets one receipt, follows the entry through the rounds, and withdraws before the deadline for a refund if plans change.
- **Juror** (daily during judging): scores the blind entries assigned for the current round against the published criteria, declares conflicts, and finishes the ballot before the round closes.
- **Program director** (daily): opens programs and categories, assigns jurors without conflicts, closes rounds, reviews the normalised standings against the shortlist cut, and publishes results at the embargo time.
- **Public visitor** (occasional): browses winners in the public gallery by year, category and award level, and follows the live leaderboard while results are revealed.

## Journeys

1. **Enter and pay.** A studio entrant starts signed out on the leaderboard. They create a studio account, start a new entry in an open category, and fill in the title, case-study text, site address and credits. They drop three screenshots on the entry, see each one accepted with its pixel size, and press the pay button that shows the current fee. The entry page ends showing status "Submitted", the entry number, a receipt panel with the amount, fee tier and invoice id, and the entry deadline in the program's time zone. The receipt email is in the studio's inbox.
2. **Change of plans.** A studio entrant with a submitted entry opens it before the deadline, presses "Withdraw entry" and confirms. The entry shows "Withdrawn", the receipt panel shows the refund, and a refund email arrives. After the deadline the same action withdraws the entry with no refund, and the dialog says so before the entrant confirms.
3. **Billing pauses.** A studio entrant presses pay while billing is unreachable. The desk says that payments are paused, the draft and its images stay exactly as they were, and nothing is charged. When billing answers again, pressing pay once more submits the entry. Nobody restarts anything.
4. **Set up judging.** The program director signs in, moves the entry deadline to a past date after entries close, and passes or disqualifies each submitted entry (a disqualification needs a reason). The director adds jurors to the Round 1 panel. The panel table shows how many entries each juror received, and conflicts are already excluded. The director sets a ballot deadline and opens the round. The panel table then shows each juror's progress, the jury packet is in storage, and each juror has an invitation email.
5. **Score blind.** A juror signs in, opens the round from the jury page, and sees each assigned entry as a number, title, case-study text and images, with no studio named. The juror recuses from one entry they recognise. They score Craft, Clarity, Idea and Story for the rest, watch the "left to score" count fall to zero, and submit the final ballot. The ballot page ends showing "Ballot submitted" and locked scores.
6. **Close and cut.** The program director watches the provisional standings for an open round. Each counted ballot reorders the table with The Cut Shuffle. The director closes the round, which stores the normalised scores, and checks who sits above the cobalt shortlist cut. The director confirms the standings, runs the final round the same way, and confirms the winner, finalists and honourable mentions.
7. **Publish and reveal.** The program director publishes a category with an embargo time a few seconds away. A public visitor on the leaderboard sees the category marked as embargoed with its reveal time. When the time passes, the category is revealed: rows start in their shortlist order and shuffle into the final ranking, the winner shows a filled star and "Winner", and each studio gets its results email. The visitor then opens the gallery, filters by year, category and award level, and finds the new winner.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Studio accounts and sign-in** A studio entrant creates a studio account or signs in with email and password, and every seeded director, juror and studio can sign in, with the session held in an HttpOnly cookie as set out in API.
- **DP-02 — One error order for every endpoint** Every protected endpoint answers by the single error-precedence rule and error shapes in API, and unauthenticated calls to protected endpoints answer 401.
- **DP-03 — Programs and categories** The program director creates programs with a time zone, early-bird and entry deadline dates and two fees, edits those dates, and adds categories with a shortlist size and finalist count, all validated as stated in API.
- **DP-04 — Deadlines in the program's time zone** Entry, early-bird and withdrawal-refund cutoffs are judged on the server against the end of 23:59 in the program's time zone, and every deadline an entrant sees, on screen or in email, carries the label format from Business rules regardless of the browser's zone.
- **DP-05 — Entry drafts** A studio entrant creates, edits and deletes draft entries in an open category, and deleting a draft removes its case-study images from storage.
- **DP-06 — Case-study image checks** Uploads are judged by their content, size and pixel dimensions with the limits, order and rejections in Business rules, and an accepted image is stored with its detected type, width, height and byte size.
- **DP-07 — Re-encoded images served back** Only server re-encoded image bytes are ever served, from storage keys the server chooses, to callers allowed to see the entry.
- **DP-08 — Fee in effect at payment time** The fee charged is the early-bird fee while the early-bird window is open at the moment of payment and the standard fee afterwards, and the receipt, Kill Bill invoice and screen all show that tier.
- **DP-09 — All-or-nothing submission** An entry becomes submitted only when its fee is paid in Kill Bill, its images are in storage and its receipt email is sent; any failure leaves an unpaid draft with no successful charge, as qualified in Business rules.
- **DP-10 — One payment per idempotency key** Repeating a submission with the same idempotency key returns the stored response with exactly one invoice, one payment and one receipt, and reusing the key for a different entry answers 409.
- **DP-11 — Billing outage keeps the draft** When Kill Bill is unreachable the desk still starts, answers payment and refund attempts with the payments-paused 503, keeps the draft or entry unchanged, and accepts the payment on the next attempt once billing answers, with no restart.
- **DP-12 — Studio records stay private** A studio reaches only its own entries, receipts, invoices and draft images, and any other studio's id answers 404.
- **DP-13 — Withdrawal and refund** A studio withdraws a submitted entry before the deadline with a full Kill Bill refund and a refund email, or after the deadline with no refund, and every other withdrawal answers 409, as qualified in Business rules.
- **DP-14 — Screening and reinstatement** After the deadline the director passes or disqualifies submitted entries with a reason and may reinstate a disqualified entry, and the studio sees the status and reason.
- **DP-15 — Director-only actions** Creating programs, categories and jurors, screening, reinstating, adding jurors to a panel, opening, closing and confirming rounds and publishing results are refused with 403 for jurors and studios.
- **DP-16 — Juror accounts and declared conflicts** The director creates juror accounts with an optional home studio, and a juror declares conflicts with named studios, which immediately removes those studios' entries from every open or scheduled round the juror sits on.
- **DP-17 — Conflict-free assignment** A juror on a round panel is assigned every entry in the round except entries from the juror's home studio or a declared-conflict studio.
- **DP-18 — Recusal mid-round** A juror recusing from an entry in an open round loses that assignment and any score for it is excluded from the round result.
- **DP-19 — Round state machine** Rounds move scheduled, open, closed, normalised, published only by director action with the guards in Business rules, and every illegal step answers 409.
- **DP-20 — Blind ballot** A juror's ballot and the jury packet carry each entry's number, title, case-study text and images only, never studio name, email, credits or site address.
- **DP-21 — Scoring and final ballot** A juror scores Craft, Clarity, Idea and Story from 1 to 10 for each assigned entry, sees how many remain, and submits a final ballot only when every assignment is scored, after which scores are locked.
- **DP-22 — Ballot against round close** A final ballot submitted while the director closes the round either counts in the stored result with 200 or is refused with the round-closed 409, never both or partly.
- **DP-23 — Normalised round score** Closing a round computes and stores each entry's score once by the weighting, per-juror normalisation, trimming and rounding in Business rules.
- **DP-24 — Ranking and the cut** Standings rank by score, then higher Idea mean, then earlier submission, and mark each row above or below the category's cut, with provisional standings while a round is open.
- **DP-25 — Confirming standings** Confirming a closed round turns its standings into shortlisted and eliminated entries in Round 1, or winner, finalist and honourable mention in the final round.
- **DP-26 — Embargoed publishing** Publishing a category with an embargo time keeps every result off public surfaces and studio-facing results until that time passes, as qualified in Business rules.
- **DP-27 — Results notice email** When a category's embargo passes each entering studio gets one results email carrying only its own entries' outcomes and rounded scores, never juror names, per-juror scores or other studios' details, as qualified in Business rules.
- **DP-28 — Public gallery and leaderboard** The public gallery and leaderboard return only the published field list for revealed entries, filterable by year, category and award level.
- **DP-29 — Counts agree with rows** Per-category state counts, per-juror ballots remaining and leaderboard ranks always equal what the stored entries, assignments and scores imply.
- **DP-30 — Director audit trail** Every successful director action writes exactly one audit event the director can list, newest first.
- **DP-31 — Jury packet and invitations** Opening a round stores a blind jury packet in storage and emails each panel juror an invitation with the ballot deadline and assignment count, as qualified in Business rules.
- **DP-32 — Entrant journey** A studio entrant signs in, drafts an entry, adds images, pays, gets one receipt and sees the entry as submitted with its receipt in the browser.
- **DP-33 — Juror journey** A juror signs in, opens the round ballot, scores every blind entry, submits the final ballot and sees it confirmed in the browser.
- **DP-34 — Director judging journey** The director screens entries, builds a panel, opens and closes a round, watches the standings and confirms the shortlist in the browser.
- **DP-35 — Public reveal journey** A public visitor opens the leaderboard, watches a category revealed at its embargo time and finds the winners in the gallery.
- **DP-36 — The Cut Shuffle** When standings change, each affected row rolls its score, travels to its new rank, swaps its cut marker as it crosses the cut and a summary is announced last, with the timings in Motion and effects.
- **DP-37 — Reduced-motion standings** With reduced motion requested, standings re-order instantly with static up or down delta labels and the same announcement, and no other element animates.
- **DP-38 — Status by glyph and label** Above-cut, below-cut, winner, finalist and honourable-mention status always shows a glyph and a text label, never colour alone, and text meets WCAG 2.2 AA contrast.
- **DP-39 — Responsive layout** Every screen works at 375x812, 768x1024 and 1280x800 with no horizontal overflow and tap targets at least 44 pixels.
- **DP-40 — Keyboard and focus** Every control is reachable by Tab in visual order with a visible focus ring, dialogs trap focus, Escape closes them and focus returns to the control that opened them.
- **DP-41 — Visual identity** Screens use the paper, ink, signal, cut and rule colour roles, the extra-wide display face for category headers, the body face and monospaced two-decimal scores described in Visual design.
- **DP-42 — Ranked-table composition** Standings, leaderboard and entry lists sit on a visible twelve-column hairline grid as full-width ranked tables under a sticky black band with the round name and countdown.
- **DP-43 — Health, manifest and boundary** The app starts from /app/run.json on the configured port, answers the health check, and the server boundary rules on origin, body size and never-served files hold.
- **DP-44 — Credentials from the environment** Every service URL and credential is read from the environment named in Configuration and secrets and never appears in source or browser-delivered code.
- **DP-45 — Real provider effects** Payments, refunds, images, packets and emails are real Kill Bill, storage and Mailpit operations, and no state the brief assigns to a provider is kept only in the app.

## Frontend

### Screens and layout (DP-32, DP-33, DP-34, DP-35, DP-39, DP-42)

Every screen shares three things. A sticky black band runs across the top and holds the context name and a countdown (see below). Under it sits the primary navigation. Below that is the content area, laid on a twelve-column grid whose column lines show as faint hairlines behind lists and tables. At 1280x800 the grid has twelve columns. At 768x1024 it has six, and at 375x812 it has four. Nothing scrolls sideways at any of the three sizes.

**Sticky band.** The band always shows a context name on the left. On a screen that has a countdown target in its current state, it also shows a countdown on the right. The countdown counts down to that target instant, is shown as `<d>d <hh>:<mm>:<ss>`, and changes once per second. When it reaches zero it reads "Closed" until the page is reloaded. On a screen whose target is "None" in its current state, the band has no countdown and no `timer` element.

| Screen | Context name | Countdown target |
|---|---|---|
| Leaderboard | The selected program's name | The soonest `revealsAt` among the program's embargoed categories. With none, the band shows the text "Results published" instead of a countdown |
| Gallery | "Gallery" | None |
| Sign in, Create a studio account | "Cutline Jury Desk" | None |
| Studio entries, new entry | The open program's name (see Business rules), or the newest program's name when no program is open | The open program's `deadlineAt`. None when no program is open |
| Existing entry | The entry's program name | That program's `deadlineAt` while its entry deadline is open, otherwise none |
| Jury, Conflicts | "Jury" | None |
| Juror ballot | `<category> — <round name>` | The round's `ballotDeadlineAt` |
| Director home | "Director" | None |
| Director program | The program's name | Its `deadlineAt` while entries are open, otherwise none |
| Director category | The category name | None |
| Director round | `<category> — <round name>` | The round's `ballotDeadlineAt` while the round is open, otherwise none |
| Director audit | "Director actions" | None |

- **Leaderboard (`/`).** A program picker sits above one section per category. Each section opens with the category name as a very large display header and holds a full-width ranked table with columns Rank, Entry, Category, Score and Status. Rows are separated by thin rules. A heavy cobalt rule marks the cut and runs across every column. A category under embargo shows "Reveals at `<embargo label>`" and no rows. A category with nothing published yet shows "No results yet." By default the page shows the newest program that has at least one published category. If no program has one, it shows the newest program. At 375 wide the Category column folds under the entry title, and Rank, Entry, Score and Status stay in one row.
- **Gallery (`/gallery`).** Three filters sit above a grid of winner cards: three cards across at 1280, two at 768 and one at 375. Each card shows the first image, the title, the studio, the year and category, the award marker and the score.
- **Sign in (`/signin`) and Create a studio account (`/signup`).** Each is a single centred form, six columns wide at 1280 and full width on phones.
- **Studio entries (`/studio`).** A ranked-style table of the studio's own entries with columns Entry number, Title, Category, Status and Fee, newest first. A "New entry" button sits above the table, and the open program's entry deadline label sits beside it. When no program has entries open, the button is replaced by the text "Entries are closed." and no deadline label is shown.
- **Entry (`/studio/entries/new` and `/studio/entries/<id>`).** At 1280 the details form takes seven columns on the left. The right five columns hold the fee panel, the deadline label, the image list with the drop zone, and the action buttons. At 768 and 375 the right column stacks under the form. After submission the form becomes read-only and the receipt panel appears where the fee panel was. On the new-entry form, the Category combobox lists the open program's categories, and the fee panel and deadline label come from the open program. On an existing entry, they come from the entry's own program.
- **Jury (`/jury`).** A list of the juror's open rounds, each showing its ballot deadline label and "`<remaining>` left to score". A link leads to the juror's conflicts.
- **Conflicts (`/jury/conflicts`).** A form to declare a conflict above the list of declared conflicts.
- **Ballot (`/jury/rounds/<id>`).** One block per assigned entry in entry-number order. At 1280 the images and case-study text take seven columns and the four score inputs take five. On narrower screens they stack. A summary line "`<scored>` of `<assigned>` scored" and the "Submit final ballot" button sit in a bar that sticks to the bottom of the viewport on every size.
- **Director home (`/director`).** Programs list and the "New program" form.
- **Director program (`/director/programs/<id>`).** Date edit form, "Add category" form, the "Entries by state" table and the "New juror" form.
- **Director category (`/director/categories/<id>`).** The screening table of every non-draft entry, with studio name, email and credits visible to the director, plus the publish form.
- **Director round (`/director/rounds/<id>`).** The panel table and the round actions, above the "Standings" ranked table with the cut rule.
- **Director audit (`/director/audit`).** The "Director actions" table, newest first.

A signed-out visitor who opens a studio, jury or director route is sent to `/signin`, and after signing in they return to the route they asked for. A signed-in user on another role's route sees the forbidden copy from Feedback states.

### Public screens and controls (DP-01, DP-32, DP-33, DP-34, DP-35, DP-38, DP-40)

Only the controls and regions below are public. Everything else is free for you to design. Here `<n>` is an entry number, `<category>` a category name, `<round name>` either "Round 1" or "Final round", `<studio>` a studio name, and `<juror>` a juror's name.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Every page | `link "Skip to content"` | Skip to content (first Tab stop, visible on focus) |
| Every page | `banner` holding the context name, plus `timer "Time remaining"` on screens that have a countdown target in Sticky band | Context name and countdown |
| Every page | `navigation "Primary"` with links "Leaderboard", "Gallery", "Studio", "Jury", "Director" and `link "Sign in"` or `button "Sign out"` | Same |
| Every page | `status "Desk status"` (polite), `alert "Desk error"` | Copy from Feedback states |
| Sign in | `textbox "Email"`, password field labelled "Password", `button "Sign in"`, `link "Create a studio account"` | Same |
| Create account | `textbox "Studio name"`, `textbox "Contact name"`, `textbox "Email"`, password field labelled "Password", `button "Create studio account"` | Same |
| Studio entries | `table "Your entries"`, `button "New entry"`, one `link "<title>"` per row | Same |
| Entry | `combobox "Category"`, `textbox "Title"`, `textbox "Case study"`, `textbox "Site address"`, `textbox "Credits"`, `button "Save draft"` | Same |
| Entry | file input labelled "Add case-study images", drop zone text "Drop PNG or JPEG images here" | Same |
| Entry | `list "Case-study images"`; each item has `img "<title> — image <k>"` and `button "Remove image <k>"` | `<k>` counts from 1 in upload order |
| Entry | `region "Fee"` | "Entry fee $`<fee>` (`<tier label>`)", the early-bird label line, and "Entries close `<deadline label>`" |
| Entry | `button "Pay $<fee> and submit"` | Same |
| Entry | `button "Delete draft"` opens `dialog "Delete this draft?"` with `button "Delete draft"` and `button "Keep draft"` | "This removes the entry and its images." |
| Entry | `region "Receipt"` | Amount, tier label, invoice id, paid time, and the refund line once refunded |
| Entry | text "Status: `<status label>`" and, for disqualified entries, "Reason: `<reason>`" | Same |
| Entry | `button "Withdraw entry"` opens `dialog "Withdraw entry?"` with `button "Withdraw"` and `button "Keep entry"` | Before the deadline: "You'll be refunded $`<fee>`." After: "The deadline has passed, so there is no refund." |
| Jury | one `link "<category> — <round name>"` per open round, `link "Conflicts"` | Same |
| Conflicts | `combobox "Studio"`, `textbox "Note"`, `button "Declare conflict"`, `list "Declared conflicts"` | Same |
| Ballot | `article "Entry <n>"` holding `group "Scores for Entry <n>"` with `spinbutton "Craft"`, `spinbutton "Clarity"`, `spinbutton "Idea"`, `spinbutton "Story"`, then `button "Save scores for Entry <n>"` and `button "Recuse from Entry <n>"` | Same |
| Ballot | `dialog "Recuse from Entry <n>?"` with `textbox "Note"`, `button "Recuse"`, `button "Cancel"` | "Your scores for this entry will not count." |
| Ballot | `button "Submit final ballot"` opens `dialog "Submit final ballot?"` with `button "Submit ballot"` and `button "Keep scoring"` | "You can't change scores after submitting." |
| Director home | `button "New program"`, `textbox "Program name"`, `spinbutton "Year"`, `combobox "Time zone"`, date fields "Early-bird ends" and "Entries close", `textbox "Early-bird fee"`, `textbox "Standard fee"`, `button "Create program"` | Fees are typed in dollars |
| Director program | date fields "Early-bird ends" and "Entries close", `button "Update dates"`, `textbox "Category name"`, `spinbutton "Shortlist size"`, `spinbutton "Finalists"`, `button "Add category"`, `table "Entries by state"` | Same |
| Director program | `textbox "Juror name"`, `textbox "Juror email"`, password field labelled "Juror password", `combobox "Home studio"` (first option "None"), `button "Create juror"` | Same |
| Director category | `table "Entries"`; per row `button "Pass Entry <n>"`, `button "Disqualify Entry <n>"`, `button "Reinstate Entry <n>"` (each only when legal) | Same |
| Director category | `dialog "Disqualify Entry <n>"` with `textbox "Reason"`, `button "Disqualify"`, `button "Cancel"` | Same |
| Director category | `textbox "Embargo time (<zone>)"`, `button "Publish results"` opens `dialog "Publish <category> results?"` with `button "Publish"` and `button "Cancel"` | Same |
| Director round | `combobox "Add juror"`, `button "Add to panel"`, `table "Panel"` with columns Juror, Assigned, Scored, Remaining, Ballot | Ballot cell reads "Submitted" or "In progress" |
| Director round | date field "Ballot deadline", `button "Open round"`, `button "Close round"` opens `dialog "Close <round name>?"` with `button "Close round"` and `button "Cancel"`, `button "Confirm standings"` | Same |
| Director round and Leaderboard | `table "Standings"` (director) or `table "<category> standings"` (leaderboard), one `row` per entry; `separator "Shortlist cut"` (Round 1) or `separator "Finalist cut"` (final round and leaderboard) | Status cell shows a marker from Feedback states |
| Director round and Leaderboard | `status "Standings updates"` (polite) | The shuffle summary from Motion and effects |
| Director round | text "Provisional" above the table while the round is open | Same |
| Leaderboard | `combobox "Program"`, one `region "<category>"` per category, `button "Replay reveal for <category>"` on revealed categories | Same |
| Gallery | `combobox "Year"`, `combobox "Category"`, `combobox "Award level"` (each with first option "All"), `list "Winners"` of `article` cards, each with `img "<title> by <studio>"` | Same |
| Director audit | `table "Director actions"` with columns Time, Action, Target | Same |

### Interactions (DP-32, DP-33, DP-34, DP-35, DP-40)

- **Forms.** Enter in any text field submits that field's form. While a request is pending, the submitting button is disabled and shows its pending copy. When a field is rejected, the field error appears under the field and is tied to it, focus moves to the first rejected field, and the alert region carries the same text.
- **Images.** Choosing files or dropping them on the drop zone uploads each file in turn. Each file shows its own pending line, and a progress bar fills with the real upload progress. Tab reaches the drop zone, and Enter or Space opens the file picker. "Remove image `<k>`" removes the image after the server confirms.
- **Paying.** The pay button generates one idempotency key per entry page visit. It reuses that key if the entrant presses again after a timeout or an outage, so a double press can never charge twice. On success the page re-renders as submitted and focus moves to the "Receipt" region heading.
- **Spinbuttons.** Arrow Up and Arrow Down change a score by 1 within 1 to 10. Home sets 1 and End sets 10. Typing a number is also accepted.
- **Ballot progress.** "`<scored>` of `<assigned>` scored" updates after each successful save or recusal. "Submit final ballot" stays disabled until every remaining assignment is scored.
- **Dialogs.** Each dialog opens with focus on its first field, or on its safe button ("Keep draft", "Keep entry", "Cancel", "Keep scoring") when it has no field. Tab and Shift+Tab cycle inside the dialog. Escape or the safe button closes it, and focus returns to the control that opened it.
- **Live refresh.** The director round screen fetches standings and panel progress every 5 seconds while the round is open, and right after any action on it. The leaderboard checks for newly revealed categories every 5 seconds. Every other screen value changes on page load or after the user's own action, except the countdown (once per second) and the fee panel. The fee panel refetches the program when the countdown passes the early-bird end, so the fee and the pay button label switch to the standard fee without a reload.
- **Hover and press.** Hovering a table row tints it slightly darker than the paper. Pressing a button darkens it at once. Links underline on hover and on focus.
- **Touch.** Every action works by tap. Nothing relies on hover, long-press or swipe.
- **Tab order.** Tab follows reading order: skip link, then navigation, then the main content top to bottom and left to right, then the sticky ballot bar last. Every focusable element shows a two-tone focus ring, ink and paper, that stays visible on every surface.

### Visual design (DP-38, DP-41, DP-42)

- **Colour roles.** Paper is a warm off-white used as the page ground. Ink is a near-black used for text, primary buttons and the sticky band, where paper-coloured type is set on ink. Signal is a vermilion used for errors, destructive buttons, disqualification and the countdown in its final 24 hours. Cut is a strong cobalt blue used only for the cut rule and the above-cut marker. Rule is a warm mid-grey used only for hairlines and grid lines, never for text.
- **Type.** The display face is Archivo at its widest setting and heaviest weight. Use it for category headers and page titles. Body text is IBM Plex Sans. Every score, rank, fee and countdown is set in IBM Plex Mono with figures of equal width, so columns of numbers line up. Scores always show two decimals. Each step up the heading scale is one third larger than the step below. On desktop, category headers are at least five and a half times the body size. On phones they drop to about two and a half times the body size and wrap rather than overflow. Bundle all three faces with the app.
- **Density.** The layout is compact: rows are just tall enough for one line of body text plus padding that keeps every tap target at least 44 pixels tall.
- **Composition.** The full-width ranked table is the centre of the product. Rank, entry title, category and score sit on the twelve-column hairline grid. Rows are divided by one-pixel rule lines. A heavy cobalt line, four times as thick as a row rule, runs across all columns at the cut. The black band sticks to the top with the round name and countdown in inverted type.
- **Contrast.** All text meets WCAG 2.2 AA: at least 4.5 to 1 for body text and 3 to 1 for large text. Markers and the cut rule reach at least 3 to 1 against the paper.
- **Icons.** Icons come from Lucide. Every other visual is drawn in SVG or the stylesheet. No raster decoration ships with the app.

### Motion and effects (DP-36, DP-37)

**The Cut Shuffle** runs on the director's standings when a refresh brings a changed order or changed scores, and on the leaderboard when a category is revealed or "Replay reveal for `<category>`" is pressed. On a reveal, the rows start in their shortlist order showing their Round 1 scores, then shuffle to the final ranking and final scores. A visitor who opens the leaderboard after a category was revealed sees it already settled, and the replay button plays the shuffle again.

1. **Score roll (0 to 320 milliseconds).** Every row whose score changed rolls its score digit by digit, like an odometer, from the old two-decimal value to the new one. All changed rows roll together.
2. **Row travel (starting at 320 milliseconds).** Each row that changed rank glides vertically from its old slot to its new slot over 480 milliseconds. The movement starts fast and settles softly with no overshoot. Rows start 40 milliseconds apart in new-rank order, so the row that ends highest moves first. After the last row settles, the order of rows in the page matches the ranked order from the API.
3. **Marker swap.** When a row's centre passes the cobalt cut rule during its travel, its marker swaps at that moment between the "Above cut" and "Below cut" markers from Feedback states.
4. **Summary.** After every row has settled, `status "Standings updates"` announces one line. If one row moved, the line is "Entry `<n>` moved from `<old ordinal>` to `<new ordinal>`, now `<above|below>` the cut." The ordinal suffix is decided by the number's last two digits, then by its last digit. If the last two digits are 11, 12 or 13, the suffix is "th". Otherwise, a last digit of 1 gives "st", 2 gives "nd" and 3 gives "rd", and any other last digit gives "th". For example: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 31st and 111th. If several rows moved, the line names one of them and adds " `<k>` other entries moved.", where `<k>` is the number of other rows that moved. The named row is the one that crossed the cut; if more than one crossed, it is the one that moved furthest; if none crossed, it is the row that moved furthest overall. A further tie goes to the row with the better new rank. If scores changed but no row moved, the line is "Scores updated, no change in order."

The shuffle runs on time, not on scroll. A second update that arrives mid-shuffle waits until the first one settles.

**Other motion.** Dialogs fade in and rise slightly, in about a fifth of a second, and fade out in about a sixth of a second. Row hover tints in under a tenth of a second. The upload progress bar moves only with real progress. The pending text on a button is static. The countdown changes once per second with no animation. Nothing on any screen loops for decoration.

**Reduced motion.** When the system asks for reduced motion, the standings re-render in their new order at once and scores swap to their new values with no roll. Each moved row shows a static "`<up|down>` `<k>`" label next to an arrow glyph pointing up or down, where `<k>` is the number of places moved, until the next update. The same summary line is announced. Dialogs appear and disappear without fading, and the hover tint changes at once.

### Feedback states (DP-09, DP-11, DP-13, DP-21, DP-22, DP-38)

Every async action shows its pending copy in `status "Desk status"` and on its button, its success copy in `status "Desk status"`, and its errors in `alert "Desk error"`. Field errors also appear under the field. When the API returns an error body with `message`, the message is the copy below for that action and code. Placeholders follow the definitions in Business rules: `<n>` is the entry number, `<fee>` is the fee in dollars with two decimals, `<deadline label>` and `<embargo label>` use the label formats, and `<k>`, `<a>` and `<b>` are counts.

| Action | Pending | Success | Errors (code: copy) |
|---|---|---|---|
| Sign in | Signing in… | (navigates to the requested page) | `invalid_credentials`: That email and password don't match. |
| Create studio account | Creating your studio… | Studio account created. | `email_taken`: An account already uses that email. `studio_name_taken`: Another studio already uses that name. |
| Save draft | Saving draft… | Draft saved. | `deadline_passed`: Entries closed at `<deadline label>`. |
| Upload image | Uploading `<file name>`… | `<file name>` added, `<width>` × `<height>` pixels. | `file_too_large`: Images must be 8,000,000 bytes or smaller. `unsupported_type`: Upload a PNG or JPEG image. Unreadable (field `file`): This file isn't a readable PNG or JPEG image. Dimensions (field `file`): Images must be 640 to 4,096 pixels on each side. Count (field `file`): An entry holds at most 6 images. `storage_unavailable`: Image storage is unavailable. Your draft is saved — try the upload again shortly. |
| Remove image | Removing image… | Image removed. | `storage_unavailable` as above |
| Delete draft | Deleting draft… | Draft deleted. | `storage_unavailable` as above |
| Pay and submit | Recording your payment… | Entry `<n>` submitted. Receipt sent to `<studio email>`. | `payments_paused`: Payments are paused. Your draft is saved — try again shortly. `mail_unavailable`: We couldn't send your receipt, so nothing was charged. Your draft is saved — try again shortly. `storage_unavailable`: Image storage is unavailable, so nothing was charged. Your draft is saved — try again shortly. `deadline_passed` as above. Missing images (field `assets`): Add at least one case-study image. |
| Withdraw | Withdrawing… | Before the deadline: Entry `<n>` withdrawn. Refund of $`<fee>` recorded. After: Entry `<n>` withdrawn. No refund after the deadline. | `payments_paused`: Refunds are paused. Your entry is still submitted — try again shortly. |
| Declare conflict | Recording conflict… | Conflict with `<studio>` recorded. `<k>` assignments removed. | — |
| Save scores | Saving scores… | Scores saved for Entry `<n>`. `<k>` left to score. | Score fields: Scores are whole numbers from 1 to 10. `ballot_submitted`: Your ballot is already submitted. `round_closed` as below |
| Recuse | Recusing… | You've recused from Entry `<n>`. | `round_closed` as below |
| Submit final ballot | Submitting your ballot… | Ballot submitted. `<k>` entries scored. | `round_closed`: This round closed before your ballot arrived. It was not counted. `ballot_incomplete`: Score every entry before submitting. `<k>` left. |
| Create program | Creating program… | Program created. | Field errors from API |
| Update dates | Updating dates… | Dates updated. | `judging_started`: Judging has started, so dates and categories are locked. |
| Add category | Adding category… | Category added. | `category_exists`: That category already exists in this program. `judging_started` as above |
| Create juror | Creating juror… | Juror account created. | `email_taken` as above |
| Pass entry | Passing… | Entry `<n>` passed screening. | `deadline_not_passed`: Entries are still open until `<deadline label>`. |
| Disqualify entry | Disqualifying… | Entry `<n>` disqualified. | Reason field: Give a reason of 1 to 300 characters. |
| Reinstate entry | Reinstating… | Entry `<n>` reinstated. | — |
| Add to panel | Adding juror… | `<juror>` added to the panel with `<k>` entries. | — |
| Open round | Opening round… | Round opened for `<k>` jurors. | `panel_empty`: Add at least one juror before opening. `screening_incomplete`: Screen every submitted entry before opening Round 1. `no_entries`: There are no entries to judge in this round. `previous_round_not_confirmed`: Confirm Round 1 standings before opening the final round. `deadline_not_passed` as above. `storage_unavailable`: Storage is unavailable, so the round was not opened. Try again shortly. |
| Close round | Closing round… | Round closed. Scores stored for `<k>` entries. | — |
| Confirm standings | Confirming… | Standings confirmed: `<a>` above the cut, `<b>` below. | — |
| Publish results | Publishing… | Results scheduled for `<embargo label>`. | `final_not_confirmed`: Confirm the final round before publishing. |

Copy shared by every action:

- Any `invalid_transition`: That step isn't available in the current state.
- `forbidden`: Only the program director can do that.
- `not_found`: We couldn't find that.
- `unauthenticated`: Sign in to continue.
- A network failure with no response: The desk can't be reached. Check your connection and try again.

**Status markers.** Every status is shown as a glyph plus a text label, never by colour alone. The glyph is hidden from assistive technology and the label is read.

| Status | Glyph | Label |
|---|---|---|
| Above the cut | Filled upward triangle | "Above cut" |
| Below the cut | Hollow upward triangle | "Below cut" |
| Winner | Filled star | "Winner" |
| Finalist | Hollow star | "Finalist" |
| Honourable mention | Hollow circle | "Honourable mention" |

On the leaderboard and on confirmed final-round standings, the award marker sits beside the cut marker. Studio status labels are always text, with disqualified entries in signal colour plus a cross glyph.

## Backend

### API (DP-01, DP-02, DP-03, DP-12, DP-20, DP-28)

**Format.** All endpoints live under `/api`, and requests and responses are `application/json; charset=utf-8`. The exceptions are image upload (`multipart/form-data`) and asset download (image bytes).

- Timestamps are ISO 8601 in UTC with a `Z` suffix. The exceptions are `deadlineAt`, `earlyBirdEndsAt`, `ballotDeadlineAt` and `embargoAt`, which carry the program's offset.
- Dates are `YYYY-MM-DD`.
- Money is integer cents in `...Cents` fields, and the currency is always `USD`.
- Scores are strings with exactly two decimals (for example `"7.40"`), or `null` when there is no score.
- Ids are opaque strings.

**Sessions.** A successful sign-in or studio sign-up sets the cookie `cutline_session` with HttpOnly, SameSite=Lax and Path=/. Sessions last until sign-out.

**Error shapes.**
- Validation errors are `422 {"errors":{"<field>":"<copy>"}}`.
- Every other error is `{"error":"<code>","message":"<copy>"}`, and `message` is the Feedback states copy for that code and action.
- `401 {"error":"unauthenticated"}` means there is no session. A failed sign-in answers `401 {"error":"invalid_credentials"}`.
- `403 {"error":"forbidden"}` means the caller's role may not do this.
- `404 {"error":"not_found"}` covers unknown ids and ids the caller may not see.

**Error precedence**, the only order for the whole API:
1. Server boundary rejections on the raw request, checked in this order:
   - A state-changing request whose `Origin` names another origin gets the 403 from Server boundary. An unauthenticated cross-origin write therefore answers 403, not 401.
   - Then 413.
   - Then 415.
2. 401 unauthenticated.
3. 404 for an unknown resource or one not visible to the caller.
4. 403 for the wrong role.
5. An idempotent replay returns its stored response here, before any state check.
6. 409 state conflicts, in the guard order given in Business rules.
7. 422 validation.
8. 503 provider unavailable.

The rows below name only their extra errors. Rule errors come from Business rules.

**Projection.** Each response contains exactly the keys listed for the caller's role, and nothing more.

**Accounts**

| Method and path | Who | Request | Success |
|---|---|---|---|
| `POST /api/studios` | anyone | `{"studioName","contactName","email","password"}` | `201 {"user":User}` and sets the session. 409 `email_taken` or `studio_name_taken` (case-insensitive). 422 when studioName or contactName is not 2 to 80 characters, email is invalid, or password is under 10 characters |
| `POST /api/session` | anyone | `{"email","password"}` | `200 {"user":User}` and sets the session |
| `GET /api/session` | signed in | — | `200 {"user":User}` |
| `DELETE /api/session` | signed in | — | `204` and clears the cookie |
| `GET /api/studios` | director, juror | — | `200 {"studios":[{"id","name"}]}` sorted by name |
| `POST /api/jurors` | director | `{"name","email","password","studioId"}` (`studioId` may be null) | `201 {"juror":{"id","name","email","studioId"}}`. 409 `email_taken`. 422 for a bad field or unknown studioId |
| `GET /api/jurors` | director | — | `200 {"jurors":[{"id","name","email","studioId"}]}` |

`User` is `{"id","role","name","email","studioId","studioName"}`, where `role` is `director`, `juror` or `studio`. `studioId` and `studioName` hold the user's own studio for studio users and the home studio for jurors; they are null for the director and for jurors with no home studio.

**Programs and categories**

| Method and path | Who | Request | Success |
|---|---|---|---|
| `GET /api/programs` | anyone | — | `200 {"programs":[Program]}`, newest year first |
| `POST /api/programs` | director | `{"name","year","timeZone","earlyBirdDate","deadlineDate","earlyBirdFeeCents","standardFeeCents"}` | `201 {"program":Program}`. 422 when: name is not 2 to 80 characters; year is not 2000 to 2100; timeZone is not an IANA zone name; earlyBirdDate is after deadlineDate; a fee is not a whole number from 100 to 100000; earlyBirdFeeCents is above standardFeeCents |
| `PATCH /api/programs/:id` | director | any of `{"earlyBirdDate","deadlineDate"}` | `200 {"program":Program}`. Same date validations |
| `POST /api/programs/:id/categories` | director | `{"name","shortlistSize","finalistCount"}` | `201 {"category":Category}`, created with two scheduled rounds "Round 1" and "Final round". 409 `category_exists` (same name in the program, case-insensitive). 422 when name is not 2 to 60 characters, shortlistSize is not 1 to 50, or finalistCount is not 1 to shortlistSize |
| `GET /api/programs/:id/summary` | director | — | `200 {"categories":[{"id","name","counts":{<every entry state>: int},"rounds":[{"id","name","state","panel":[Panel]}]}]}` |

- `Program` is `{"id","name","year","timeZone","earlyBirdDate","deadlineDate","earlyBirdEndsAt","deadlineAt","earlyBirdLabel","deadlineLabel","earlyBirdFeeCents","standardFeeCents","currentTier","currentFeeCents","entriesOpen","categories":[Category]}`. `currentTier` is `early_bird` or `standard`.
- `Category` is `{"id","name","shortlistSize","finalistCount"}`. Directors also get `"rounds":[{"id","name","kind","state"}]`, where `kind` is `round_1` or `final`.
- `Panel` is `{"jurorId","name","assigned","scored","remaining","ballotSubmitted"}`.

**Entries (studio)**

| Method and path | Who | Request | Success |
|---|---|---|---|
| `POST /api/entries` | studio | `{"categoryId","title","summary","siteUrl","credits"}` | `201 {"entry":Entry}` in state `draft`. 422 when: title is not 1 to 120 characters; summary is not 1 to 2000 characters; siteUrl is not an `https://` URL of at most 300 characters; credits is over 500 characters; categoryId is unknown |
| `GET /api/entries` | studio | — | `200 {"entries":[Entry]}`, own studio only, newest first |
| `GET /api/entries/:id` | owning studio, director | — | `200 {"entry":Entry}`. The director gets `EntryDirector` |
| `PATCH /api/entries/:id` | owning studio | any of the create fields | `200 {"entry":Entry}` |
| `DELETE /api/entries/:id` | owning studio | — | `204` |
| `POST /api/entries/:id/assets` | owning studio | multipart with one part `file` | `201 {"asset":Asset}` |
| `DELETE /api/entries/:id/assets/:assetId` | owning studio | — | `204` |
| `POST /api/entries/:id/submit` | owning studio | header `Idempotency-Key` (1 to 100 characters), body `{}` | `201 {"entry":Entry,"receipt":Receipt}`. 422 `{"errors":{"idempotencyKey":"Send an Idempotency-Key header of 1 to 100 characters."}}` |
| `POST /api/entries/:id/withdraw` | owning studio | `{}` | `200 {"entry":Entry,"refund":{"amountCents","refundedAt"}}`. `refund` is `null` after the deadline |
| `GET /api/entries/:id/receipt` | owning studio, director | — | `200 {"receipt":Receipt}`. 404 when the entry was never paid |
| `GET /api/invoices/:invoiceId` | owning studio, director | Kill Bill invoice id | `200 {"invoice":{"invoiceId","entryNumber","amountCents","currency","tier","status"}}`, where `status` is `paid` or `refunded` |
| `GET /api/assets/:assetId` | see Business rules visibility | — | `200` with the image bytes, `Content-Type` `image/png` or `image/jpeg`, and `X-Content-Type-Options: nosniff` |

- `Entry` (studio view) is `{"id","entryNumber","programId","categoryId","categoryName","title","summary","siteUrl","credits","state","statusLabel","disqualifyReason","award","score","assets":[Asset],"fee","submittedAt","deadlineLabel","canWithdraw","refundOnWithdraw"}`. `fee` is `{"tier","amountCents"}` or `null`, and `tier` is `early_bird` or `standard`.
- `EntryDirector` is `Entry` plus `{"studioId","studioName","studioEmail"}`. It is never masked.
- `Asset` is `{"id","url","name","type","width","height","bytes"}`, where `url` is `/api/assets/<id>` and `name` is the original file name with any path removed, cut to 100 characters.
- `Receipt` is `{"entryNumber","title","amountCents","currency","tier","invoiceId","paymentId","paidAt","refund"}`, where `refund` is `null` or `{"amountCents","refundedAt"}`.

**Screening, rounds and publishing (director)**

| Method and path | Request | Success |
|---|---|---|
| `GET /api/categories/:id/entries` | — | `200 {"entries":[EntryDirector]}`, every non-draft entry, by entry number |
| `POST /api/entries/:id/screen` | `{"decision":"pass"\|"disqualify","reason"}` | `200 {"entry":EntryDirector}`. 422 when decision is not one of the two, or when a disqualification reason is not 1 to 300 characters |
| `POST /api/entries/:id/reinstate` | `{}` | `200 {"entry":EntryDirector}` |
| `GET /api/rounds/:id` | — | `200 {"round":Round,"panel":[Panel]}` |
| `POST /api/rounds/:id/jurors` | `{"jurorId"}` | `201 {"panel":[Panel]}`, or `200` with the same body when the juror is already on the panel. 422 `{"errors":{"jurorId":"Choose a juror."}}` for an unknown juror |
| `POST /api/rounds/:id/open` | `{"ballotDeadline":"YYYY-MM-DD"}` | `200 {"round":Round}`. 422 for a missing or invalid date |
| `POST /api/rounds/:id/close` | `{}` | `200 {"round":Round,"standings":Standings}` |
| `POST /api/rounds/:id/confirm` | `{}` | `200 {"round":Round,"outcomes":[{"entryNumber","state"}]}` |
| `GET /api/rounds/:id/standings` | — | `200 Standings`. Empty `rows` while the round is scheduled |
| `POST /api/categories/:id/publish` | `{"embargoAt"}` (ISO 8601 with an offset) | `200 {"category":{"id","name","embargoAt","embargoLabel","state":"published"}}`. 422 for an unparseable time |
| `GET /api/audit` | — | `200 {"events":[{"id","action","targetType","targetId","at","detail"}]}`, newest first, at most 200 |

- `Round` is `{"id","categoryId","name","kind","state","ballotDeadline","ballotDeadlineLabel","ballotDeadlineAt","openedAt","closedAt"}`. `ballotDeadline`, `ballotDeadlineLabel` and `ballotDeadlineAt` are null until the round opens.
- `Standings` is `{"provisional","cut","cutLabel","rows":[{"rank","entryId","entryNumber","title","categoryName","score","ideaMean","ballotsCounted","cut","award"}]}`. `cutLabel` is "Shortlist cut" or "Finalist cut". Each row's `cut` is `above` or `below`. `ideaMean` is a number rounded to 4 decimals, or `null`. `award` is `null` until the final round is confirmed.

**Juror**

| Method and path | Request | Success |
|---|---|---|
| `GET /api/juror/rounds` | — | `200 {"rounds":[{"id","name","categoryName","ballotDeadlineLabel","assigned","remaining","ballotSubmitted"}]}`, open rounds where the juror is on the panel |
| `GET /api/rounds/:id/ballot` | — | `200 {"round":{"id","name","categoryName","ballotDeadlineLabel","ballotDeadlineAt","state"},"entries":[BlindEntry],"assigned","scored","remaining","submitted"}` |
| `PUT /api/rounds/:id/scores/:entryId` | `{"craft","clarity","idea","story"}` | `200 {"scores":{"craft","clarity","idea","story"},"remaining"}`. 422 for any value that is not a whole number from 1 to 10 |
| `POST /api/rounds/:id/ballot/submit` | `{}` | `200 {"submitted":true,"counted","submittedAt"}`. `counted` is an integer: the number of the juror's current assignments in the round whose scores this ballot counts, leaving out recused and conflicted entries. It is the `<k>` in the success copy |
| `POST /api/rounds/:id/entries/:entryId/recuse` | `{"note"}` (optional, at most 300 characters) | `200 {"remaining"}` |
| `POST /api/conflicts` | `{"studioId","note"}` (note optional, at most 300 characters) | `201 {"conflict":{"studioId","studioName","note","declaredAt"},"removedAssignments"}`, or `200` with the existing conflict and `removedAssignments: 0` when it was already declared. 422 for an unknown studio |
| `GET /api/conflicts` | — | `200 {"conflicts":[...]}`, the juror's own conflicts |

`BlindEntry` has exactly `{"entryId","entryNumber","title","summary","images","scores"}`. `images` is a list of `{"url","width","height"}` and `scores` is `null` or the four scores. A juror opening a round they are not on, a scheduled round, or an entry not assigned to them gets 404.

**Public**

| Method and path | Request | Success |
|---|---|---|
| `GET /api/public/gallery` | query `year`, `category` (category name, case-insensitive), `award` (`winner`, `finalist` or `honourable_mention`), all optional | `200 {"items":[GalleryItem]}` sorted by year (newest first), then category name, then award (winner, finalist, honourable mention), then score from high to low. 422 for an unknown `award` value |
| `GET /api/public/leaderboard` | query `programId`, optional (default as on the Leaderboard screen) | `200 {"program":{"id","name","year","timeZone"},"categories":[{"id","name","state","revealsAt","revealsLabel","cut","rows":[LeaderRow]}]}` |
| `GET /api/health` | — | `200 {"status":"ok"}` |

- `GalleryItem` has exactly `{"entryNumber","title","studioName","programName","year","category","award","score","images"}`, where `images` is a list of URLs.
- Each leaderboard category's `state` is `pending`, `embargoed` or `revealed`. `revealsAt` and `revealsLabel` are set only when the state is `embargoed`, and `rows` is empty unless it is `revealed`.
- `LeaderRow` has exactly `{"rank","entryNumber","title","studioName","score","previousRank","previousScore","award","cut"}`. `previousRank` is the entry's Round 1 rank among the shortlisted entries and `previousScore` is its Round 1 score.
- `cut` is the category's finalist count.

### Business rules (DP-04 to DP-10, DP-12 to DP-31)

**Time and labels.**
- Every cutoff is judged on the server in the program's IANA time zone. The cutoff for an entry deadline, early-bird date or ballot deadline D is the exclusive boundary 00:00:00 local time on the day after D. The window is open at every instant before that boundary, including all of the 23:59 minute on D. It has passed at the boundary itself and at every instant after.
- `deadlineAt`, `earlyBirdEndsAt` and `ballotDeadlineAt` are that boundary instant, written with the program's offset at that instant. For example, a deadline date of 31 Dec 2026 in Asia/Kolkata gives `2027-01-01T00:00:00+05:30`. Every countdown counts to this same instant, so it reaches zero exactly when the window closes.
- The deadline label is `23:59 <zone>, <D> <Mon> <YYYY>`, for example "23:59 Asia/Kolkata, 31 Dec 2026". `<zone>` is the IANA name, `<D>` has no leading zero, and `<Mon>` is the three-letter English month. Ballot deadlines use the same label.
- The early-bird line on the entry page reads "Early-bird ends `<early-bird label>`" while the window is open and "Early-bird ended `<early-bird label>`" afterwards.
- The embargo label is `<HH>:<MM> <zone>, <D> <Mon> <YYYY>`, written in the program's time zone.
- Every deadline an entrant sees, on any screen or in any email, uses these labels exactly as the server sends them and never converts them to the browser's zone.

**Fees.**
- The fee tier is fixed at the moment the payment succeeds. The fee is the early-bird fee while the early-bird date is open and the standard fee after it. `<tier label>` is "Early-bird" or "Standard".
- `<fee>` is the fee in dollars with two decimals.
- `entriesOpen` is true while the entry deadline is open.
- The open program is the program with `entriesOpen` true whose `deadlineAt` is soonest. A tie goes to the program created first. When no program has entries open, there is no open program.
- Studio screens without an entry of their own (the entries list and the new-entry form) take their categories, fee, tier and deadline from the open program. An existing entry always uses its own program.
- The API accepts a draft in any category of any program whose entries are open.

**Entry states.** `draft`, `submitted`, `screened`, `disqualified`, `withdrawn`, `round_1`, `shortlisted`, `eliminated`, `final_round`, `winner`, `finalist`, `honourable_mention`, `published`. Entry numbers are given in sequence within a program when a draft is created, starting at 1.

| Action | Legal from | To |
|---|---|---|
| Edit, delete, upload or remove image | `draft` | `draft` (delete removes the entry) |
| Submit | `draft` | `submitted` |
| Withdraw | `submitted` | `withdrawn` |
| Screen as pass | `submitted` | `screened` |
| Screen as disqualify | `submitted`, `screened` | `disqualified` |
| Reinstate | `disqualified` | `screened` |
| Round 1 opens | `screened` | `round_1` |
| Round 1 confirmed | `round_1` | `shortlisted` or `eliminated` |
| Final round opens | `shortlisted` | `final_round` |
| Final round confirmed | `final_round` | `winner`, `finalist` or `honourable_mention` |
| Category published | `winner`, `finalist`, `honourable_mention` | `published` (the award level is kept in `award`) |

- Any other entry action answers `409 {"error":"invalid_transition","from":"<state>","action":"<action>"}`.
- Creating a draft, editing or deleting a draft, uploading or removing an image, and submitting after the entry deadline all answer `409 {"error":"deadline_passed"}`.
- Screening and reinstating before the entry deadline answer `409 {"error":"deadline_not_passed"}`.

**Studio-facing masking.**
- Until the category's embargo passes, a studio sees any entry in `winner`, `finalist`, `honourable_mention` or `published` as `final_round`, with `award` and `score` null.
- After the embargo the studio sees `published`, the award and the final-round score.
- An eliminated entry's `score` stays null until the embargo passes, and then shows its Round 1 score.
- `statusLabel` is the text for the state the studio sees: Draft, Submitted, Screened, Disqualified, Withdrawn, Round 1, Shortlisted, Not shortlisted, Final round, Winner, Finalist or Honourable mention.

**Submission is all-or-nothing.** Guards are checked in this order:
1. The entry is a draft (`invalid_transition`).
2. The deadline is open (`deadline_passed`).
3. There is at least one image (422, field `assets`).

Then:
1. The fee is paid in Kill Bill (see Services).
2. The receipt email is sent.
3. The entry becomes `submitted` with the payment details stored.

Undo rules:
- If billing fails at any point, any invoice already created is adjusted to zero, nothing is charged, and the draft is unchanged (`503 payments_paused`).
- If the receipt cannot be sent, the payment is refunded in full in Kill Bill, the invoice is adjusted to zero, and the draft is unchanged (`503 mail_unavailable`).
- If storage cannot confirm every image object at submit time, nothing is charged (`503 storage_unavailable`).

The end state is always one of two:
- A `submitted` entry with exactly one successful PURCHASE and one receipt email.
- A `draft` with no successful un-refunded PURCHASE and a Kill Bill account balance of zero.

**Idempotency.**
- Keys are scoped to the studio. Only `201` submit responses are stored.
- A repeat with the same key for the same entry returns the stored `201` status and body, with no new invoice, payment or email.
- The same key used for a different entry answers `409 {"error":"idempotency_key_reused"}`.
- A failed attempt stores nothing, so the same key can be retried after an outage.
- Two requests with the same key in flight at once both return the single stored result.
- Parallel submissions of one draft with different keys produce exactly one `201`. The others answer `invalid_transition`, and only one invoice exists.

**Withdrawal.**
- Before the entry deadline, withdrawing first records a full REFUND in Kill Bill. Then, in one database step, it marks the entry `withdrawn`, stores the refund and queues the refund email, and answers 200. Mailpit is never contacted inside this request, so a Mailpit outage does not change the response. The queued email is delivered by the retry rule in Services.
- If billing is unreachable, the entry stays `submitted`, nothing is queued, and the answer is `503 payments_paused`.
- After the deadline the entry becomes `withdrawn` with no refund and no email.
- `canWithdraw` is true only in `submitted`. `refundOnWithdraw` is true only while the deadline is open.

**Images.** Checks run in this order:
1. A file part over 8,000,000 bytes answers `413 {"error":"file_too_large"}`. Exactly 8,000,000 bytes is allowed.
2. A file whose leading bytes are not a PNG or JPEG signature answers `415 {"error":"unsupported_type"}`, whatever its name or declared type. SVG, HTML, GIF and WebP are all rejected this way.
3. A file that does not fully decode answers 422 with the unreadable copy on field `file`.
4. Width or height outside 640 to 4,096 pixels answers 422 with the dimensions copy. 640 and 4,096 are allowed.
5. A seventh image on one entry answers 422 with the count copy.

An accepted image is re-encoded by the server in its detected format, dropping all metadata and any bytes after the image data. Only the re-encoded bytes are stored and served. The storage key never uses the uploaded file name.

**Visibility.**
- A studio sees only its own entries, images, receipts and invoices. Any other id answers 404, including ids nested in a path (for example another studio's asset id under the caller's own entry id).
- A juror sees an entry's images only for entries assigned to them in an open round.
- Images of published entries are public once the embargo has passed.
- The director sees everything.
- Anyone else gets 404.

**Director-only actions.** The following are refused with `403 forbidden` for jurors and studios, whatever the UI shows: creating programs, updating program dates, adding categories, creating jurors, screening, reinstating, adding to a panel, opening, closing and confirming rounds, reading round standings and round detail, reading the summary and the audit, and publishing. Juror-only actions (ballot, scores, recusal, conflicts) answer 403 for other roles.

**Program edits.** Dates and categories are locked once any round in the program has left `scheduled` (`409 {"error":"judging_started"}`). Past dates are allowed.

**Jurors, conflicts and assignment.**
- A juror's excluded studios are their home studio plus every studio they have declared a conflict with.
- Each panel juror is assigned every entry in the round except entries from excluded studios.
- In an open round, assignments are stored. They are created for every panel juror when the round opens, and for one juror when that juror joins an open round. They are removed by a conflict or a recusal.
- In a scheduled round, nothing is stored yet. Each panel row's `assigned` is computed on every read: the entries that would enter the round if it opened now (`screened` entries for Round 1, `shortlisted` entries for the final round), minus entries from that juror's excluded studios.
  - The count therefore follows screening, reinstatement and new conflicts at once.
  - `scored` is 0, and `remaining` equals `assigned`.
- The `<k>` in the Add to panel success copy is that juror's `assigned` in the returned panel.
- Declaring a conflict does three things for every round the juror sits on:
  - It removes the juror's stored assignments to that studio's entries in every open round.
  - It excludes any scores the juror gave those entries.
  - It leaves those entries out of the computed counts of every scheduled round.
- `removedAssignments` counts only the stored assignments that were removed.
- Recusing in an open round removes that one assignment and excludes its score, even if the juror's ballot was already submitted.
- `assigned` counts current assignments. `scored` counts current assignments with scores. `remaining` is assigned minus scored, and is 0 once the ballot is submitted.

**Round states.** `scheduled`, `open`, `closed`, `normalised`, `published`. Only the director moves a round.

Open (from `scheduled`), with guards in this order:
1. The state is `scheduled` (`invalid_transition`).
2. For Round 1, the entry deadline has passed (`deadline_not_passed`).
3. For Round 1, no `submitted` entry is left unscreened (`409 {"error":"screening_incomplete"}`).
4. For the final round, Round 1 is `normalised` (`409 {"error":"previous_round_not_confirmed"}`).
5. The panel is not empty (`409 {"error":"panel_empty"}`).
6. At least one entry would enter the round (`409 {"error":"no_entries"}`).

Effects of opening, all or nothing:
1. The server first writes the jury packet to storage. If that write fails, the answer is `503 {"error":"storage_unavailable"}` and nothing changes: the round stays `scheduled`, no entry moves, and no assignment, queued email or audit event exists.
2. Once the packet is stored, one database step does all of the following: it moves every `screened` entry to `round_1` (Round 1) or every `shortlisted` entry to `final_round` (final round), stores the assignments, sets the round `open`, writes the audit event, and queues one invitation per panel juror.
3. The answer is 200.

Invitations are never sent inside the request. They are delivered by the retry rule in Services, so a Mailpit outage does not change the response.

Other moves:
- Close goes from `open` to `closed`. Confirm goes from `closed` to `normalised`. Publish moves both of the category's rounds to `published`.
- Adding a juror to the panel is legal only while the round is `scheduled` or `open`.
- Any other move answers `invalid_transition`.

**Ballots.**
- Scores can be saved and recusals made only while the round is `open`. On a later state these answer `409 {"error":"round_closed"}`.
- After the final ballot is submitted, saving scores answers `409 {"error":"ballot_submitted"}`.
- Submitting with any assignment unscored answers `409 {"error":"ballot_incomplete"}`.
- Only submitted final ballots count.
- A submit and a close that race are settled in a single order. If the submit finishes first it answers `200` and the ballot is in the stored result. Otherwise it answers `round_closed` and the ballot is not in the result. A `200` ballot is never left out, and a refused ballot is never counted.
- Two simultaneous closes produce one `200`. The other answers `invalid_transition`.

**Round score.** The round score is computed from counted ballots, which leave out recused and conflicted assignments.
1. For each juror, the weighted total of each entry they scored is (35 × Craft + 30 × Clarity + 25 × Idea + 10 × Story) ÷ 100.
2. Take the mean and the population standard deviation of that juror's weighted totals in the round. Each entry's standard score is (total − mean) ÷ deviation, or 0 when the deviation is 0, including when the juror scored only one entry.
3. The juror's mapped score for an entry is 5 + 1.5 × standard score, clamped to 0 through 10.
4. An entry's round score is the mean of its mapped scores. When it has 5 or more, drop the single highest and the single lowest first.
5. Round half-up to 2 decimals, decided on the exact decimal value, so 6.125 becomes 6.13.

An entry with no counted ballots has score `null`. For example, a juror whose weighted totals are 8, 6 and 4 gets mapped scores 6.84, 5.00 and 3.16.

The score is computed once at close and stored. Later conflicts or edits never change it. While the round is open, `GET /api/rounds/:id/standings` applies the same computation to the ballots submitted so far, marks the result `"provisional": true`, and stores nothing.

**Ranking and the cut.**
- Rank order is: score from high to low, with null scores after every scored entry; then higher Idea mean (the mean of raw Idea scores from that entry's counted ballots); then earlier submission time; then lower entry number. Ranks run from 1 to the number of rows with no gaps.
- In Round 1, rows ranked at or above the category's shortlist size are `above` and the rest are `below`. In the final round the finalist count sets the cut.
- This tie-break rule is published as written here.

**Confirm.**
- Round 1: `above` rows become `shortlisted` and `below` rows become `eliminated`.
- Final round: rank 1 becomes `winner`, ranks 2 through the finalist count become `finalist`, and every other row becomes `honourable_mention`.

**Publishing and embargo.**
- Publish requires the final round to be `normalised` (`409 {"error":"final_not_confirmed"}`). A second publish of the same category answers `invalid_transition`.
- `embargoAt` may be in the past, in which case results go live at once.
- Until the embargo instant has passed, the category's entries, award levels and scores are absent from the public gallery, the public leaderboard (state `embargoed`), public image access, studio-facing entry views (see masking) and every studio email. Visibility is checked against the server clock on each request.
- When the embargo passes, each studio with at least one entry in the category that reached Round 1 gets exactly one results email. The email counts as queued at the embargo instant and is delivered under the Mailpit timing in Services. If Mailpit is reachable at the embargo, the email arrives within 10 seconds after the embargo passes. If Mailpit is unreachable then, it arrives within 10 seconds after Mailpit becomes reachable again. A restart never sends a second one.
- Public responses carry exactly the keys listed for them in API (`GalleryItem`, the public leaderboard response and `LeaderRow`). Results emails carry only the lines listed in Services.
- None of them ever carries juror identities, per-juror scores, Idea means, ballot counts, studio emails, contact names, credits, site addresses, or any entry, award level or score of a category whose embargo has not passed.

**Agreement.**
- Summary counts equal the number of entries in each state.
- Each panel row's `assigned`, `scored` and `remaining` equal what that juror's ballot endpoint reports.
- Leaderboard ranks equal the stored final-round ranks, and `previousRank` equals the Round 1 rank order among the category's shortlisted entries.

**Audit.**
- Every successful director write records exactly one event. A failed request records none.
- The actions are: `program.create`, `program.update`, `category.create`, `juror.create`, `entry.pass`, `entry.disqualify`, `entry.reinstate`, `panel.add`, `round.open`, `round.close`, `round.confirm` and `category.publish`.
- `targetType` is `program`, `category`, `juror`, `entry` or `round`.

### Services (DP-09, DP-11, DP-13, DP-27, DP-31, DP-45)

**Postgres** holds programs, categories, rounds, entries, assets, jurors, conflicts, assignments, scores, ballots, stored round results, idempotency records, sent-email records and the audit trail. The schema is applied idempotently every time the app serves, and the seed data is inserted when missing.

**Kill Bill** (all calls use the tenant from the environment):
- Each studio has one account, created at its first payment attempt that reaches billing. The account has external key `cutline-studio-<studio id>`, the studio's name and email, currency USD, and a default payment method on the built-in `__EXTERNAL_PAYMENT__` plugin.
- Each submission produces one invoice with one external charge in USD for the fee, described as `Entry <n> — Early-bird entry fee` or `Entry <n> — Standard entry fee`. It also produces one payment against that invoice with payment external key `cutline-entry-<entry id>` and a single PURCHASE transaction with status SUCCESS for the fee. The invoice balance ends at zero.
- A refund is a REFUND transaction for the full fee on the same payment.
- When Kill Bill is unreachable, payment and refund attempts answer `503 {"error":"payments_paused"}` with the Feedback states copy for that action. The draft or entry is left unchanged, and the next attempt contacts Kill Bill again.

**MinIO** (bucket from `S3_BUCKET`):
- Images are stored at `entries/<entry id>/<asset id>.png` or `.jpg`, with the matching content type.
- Deleting an image removes its object, and deleting a draft removes every object under `entries/<entry id>/`.
- Opening a round writes `rounds/<round id>/jury-packet.json` with exactly `{"roundId","roundName","categoryName","ballotDeadlineLabel","entries":[{"entryNumber","title","summary","assetIds"}]}`, covering every entry in the round. The packet is rewritten whenever the round's assignments change while it is open, that is, when a juror joins, declares a conflict or recuses. The change itself is committed and answered first. The rewrite is retried every 5 seconds until storage accepts it, so the stored packet matches the round within 5 seconds of storage being reachable.
- Seeded gallery images are drawn by the server and written under the same key pattern when missing.
- When storage is unreachable, uploads, image removal, draft deletion, submission (before anything is charged) and opening a round answer `503 {"error":"storage_unavailable"}` and change nothing.

**Mailpit** (over SMTP from `SMTP_HOST` and `SMTP_PORT`). Every message is plain text and carries the From header read from `MAIL_FROM`, which is set to `Cutline Jury Desk <desk@cutline.example>`. Use the value exactly as given in the environment.

| Message | To | Subject | Body includes |
|---|---|---|---|
| Receipt | The studio's email | `Cutline receipt: Entry <n> — <title>` | Category, `$<fee>`, tier label, invoice id, and "Withdraw before `<deadline label>` for a full refund." |
| Jury invitation | The juror's email | `Cutline jury invitation: <category> — <round name>` | The ballot deadline label, "`<k>` entries assigned", and the path `/jury`. No studio names |
| Refund | The studio's email | `Cutline refund: Entry <n> — <title>` | `$<fee>` refunded |
| Results | The studio's email | `Cutline results: <category> <year>` | One line per entry of that studio in the category that reached Round 1: `Entry <n> — <title>: <outcome> (<score>)`. Outcome is Winner, Finalist, Honourable mention or Not shortlisted, and score is the final-round score, or the Round 1 score for Not shortlisted |

- Receipt failure is handled by the submission rule above.
- Invitations are queued when a round opens, and when a juror joins an open round. The join answers its success status whatever Mailpit's state.
- Invitation, refund and results emails are queued in Postgres in the same database step as the action that causes them.
- A sender delivers each queued email, retrying every 5 seconds while Mailpit is unreachable. Each email is delivered exactly once, and queued emails survive a restart.
- While Mailpit is reachable, a queued email arrives within 10 seconds of being queued. After a Mailpit outage, it arrives within 10 seconds of Mailpit becoming reachable again.

### Seed data (DP-01, DP-16, DP-28)

Every seeded person, studio and program is invented. Seed records are inserted only when missing.

**Director**
- Mara Lindqvist, `director@cutline.example`, password `director-pass-26`.

**Studios** (role studio):

| Studio | Contact | Email | Password |
|---|---|---|---|
| Halftone Works | Dario Feld | `studio@halftone.example` | `halftone-pass-26` |
| Fieldnote Studio | Leni Marsh | `hello@fieldnote.example` | `fieldnote-pass-26` |
| Parallax & Pine | Ayo Mensah | `team@parallaxpine.example` | `parallax-pass-26` |
| Mono Harbour | Kit Okonkwo | `desk@monoharbour.example` | `monoharbour-pass-26` |

**Jurors** (password `juror-pass-26` for all):

| Juror | Email | Home studio | Declared conflicts |
|---|---|---|---|
| Ines Varga | `ines@jury.example` | Halftone Works | none |
| Teo Brandt | `teo@jury.example` | none | none |
| Priya Raman | `priya@jury.example` | none | none |
| Olu Adeyemi | `olu@jury.example` | none | none |
| Sana Kobayashi | `sana@jury.example` | none | Fieldnote Studio, note "Former client" |
| Ruth Calder | `ruth@jury.example` | none | none |

**Open program "Cutline Open Call"**
- Time zone `Asia/Kolkata`.
- The early-bird date is 30 days after the date the seed is first applied, and the entry deadline is 60 days after it, both counted in that zone. `year` is the year of the deadline date.
- Early-bird fee is 4500 cents and the standard fee is 7000 cents.
- Categories: Portfolio (shortlist 5, finalists 3), Editorial (shortlist 5, finalists 3) and Commerce (shortlist 4, finalists 2).
- No entries exist at start.

**Past programs.** Both are in `Europe/Lisbon` with fees of 4500 and 7000 cents. Every category is published with its embargo in the past and both rounds `published`. Each listed entry has two server-drawn images, and every Round 1 entry listed was shortlisted.

| Program, year | Category (shortlist, finalists) | Entry | Studio | Round 1 rank, score | Final rank, score | Award |
|---|---|---|---|---|---|---|
| Cutline Annual 2025, 2025 | Portfolio (4, 2) | 3 Tidewater Archive | Parallax & Pine | 2, 7.10 | 1, 8.42 | winner |
| | | 7 Glasshouse Index | Mono Harbour | 1, 7.65 | 2, 7.91 | finalist |
| | | 12 Northbound Letters | Fieldnote Studio | 3, 6.48 | 3, 6.88 | honourable mention |
| | | 11 Small Hours Press | Halftone Works | 4, 6.20 | 4, 6.05 | honourable mention |
| | Editorial (3, 2) | 2 Paper Weather | Fieldnote Studio | 3, 6.02 | 1, 7.88 | winner |
| | | 5 The Long Table | Halftone Works | 1, 7.44 | 2, 7.20 | finalist |
| | | 9 Signal Garden | Mono Harbour | 2, 6.90 | 3, 6.31 | honourable mention |
| Cutline Annual 2024, 2024 | Portfolio (3, 2) | 4 Quiet Machines | Mono Harbour | 1, 7.80 | 1, 8.05 | winner |
| | | 6 Saltmarsh Almanac | Parallax & Pine | 2, 7.02 | 2, 7.12 | finalist |
| | | 8 Index of Rooms | Halftone Works | 3, 6.66 | 3, 6.40 | honourable mention |

For example, with the seed data at start, the leaderboard opens on Cutline Annual 2025 and the gallery shows 10 items.

## Technical requirements

### Deployment (DP-43)

The runtime is Node.js 22 with npm, and the source language is TypeScript. Put `/app/run.json` at the app root with string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The serve command binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers `200 {"status":"ok"}` once the server is listening and the schema is applied. The same build is also served as extra instances with one dependency pointed at a dead address, so nothing may assume a fixed port or a reachable provider.

### Configuration and secrets (DP-44)

Read these at start, from the environment only:

| Service | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| Kill Bill | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Port | `APP_PUBLIC_PORT` |

No credential or service URL is hard-coded, logged, or included in anything sent to the browser.

### Server boundary (DP-11, DP-43)

- **Same origin.** The app serves its pages, bundled fonts, icons and API from one origin, and the browser loads nothing from any other origin. No CORS headers are sent. A state-changing request whose `Origin` header names another origin answers `403 {"error":"forbidden"}`.
- **Request limits.**
  - JSON bodies may be up to 65,536 bytes; larger bodies answer `413 {"error":"payload_too_large"}`.
  - Multipart upload bodies may be up to 8,100,000 bytes; larger bodies answer `413 {"error":"file_too_large"}`.
  - A write with any other content type answers `415 {"error":"unsupported_media_type"}`.
- **Never served.**
  - The server never returns source files, the run manifest, package files, environment files, or any credential.
  - An unknown `/api` path answers `404 {"error":"not_found"}`.
  - Any other path returns either a built asset or the app page.
- **Unreachable dependencies.**
  - The app starts and answers its health check when Kill Bill, MinIO or Mailpit is unreachable at boot. It never needs a restart when they come back.
  - Each action that needs one of these providers tries it afresh with a timeout of at most 5 seconds. A failure becomes that provider's 503 from Services and is never remembered.
  - If Postgres is unreachable at boot, the server still listens, answers health with `503 {"status":"starting"}`, and retries every 2 seconds until the database answers.

### Browser support and performance (DP-39)

Support current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800. Every screen is usable within three seconds of navigation on the grading machine. API reads answer within one second, and submit and withdraw answer within five seconds while their providers are healthy.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and those commands alone install, build and serve the app.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package and its licence, plus each bundled font and icon set. "Shipped packages" means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package, font and icon set is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or SIL OFL-1.1.
- IF-04: The app stores state only in the provided Postgres, Kill Bill, MinIO and Mailpit services. There is no SQLite, Redis, embedded database or state kept in local files.
- IF-05: The provided service configuration, compose files and environment variable names are left unchanged.
- IF-06: Application source is TypeScript. JavaScript appears only as generated build output or tool configuration.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` outside third-party boundaries, and it uses the domain words of this brief (entry, draft, juror, panel, ballot, recusal, round, cut, embargo) in its names.
- Each domain rule is decided in exactly one place in the source: each entry and round transition guard, the fee tier, the round score computation, the ranking order, the studio-facing masking and each role's field projection.
- Every error response is built from the one error shape in API, and every rejection uses a code that this brief defines.
- No interface or abstraction has only one implementation, and no wrapper exists only to pass calls through.
- There is no dead, commented-out or unreachable code, and there are no defensive checks for states the business rules make impossible.
- Calls to providers are made where the action happens, use the configured credentials, and turn failures into the documented 503s without being retried silently inside a request.
- Nothing beyond this brief is built: no extra screens, endpoints, roles or settings.
