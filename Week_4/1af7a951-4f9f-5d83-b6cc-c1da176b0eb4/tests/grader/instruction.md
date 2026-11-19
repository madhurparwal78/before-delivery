# Saltmoon Practice Lanternfish

Lanternfish is a web app for independent lucid-dreaming coaches who run paid four-week induction cohorts, and for the people who join them.

- An applicant finds an open cohort, pays for a seat and lands on their first baseline night with the right bedtime and wake alarm.
- A dreamer keeps a nightly dream logbook that works offline on a phone at 4 a.m., even on a phone or laptop they share with a partner. They tag dream signs in their own entries and watch each tagged phrase join its category's constellation in a night sky. They also train reality checks against their most frequent kind of dream sign.
- A coach runs cohorts from enrolment through a baseline week and three technique weeks. The coach sees recall rates, technique adherence and dream-sign tallies but never private dream text, refunds seats and sends a weekly digest.

The server stores everything in Postgres. Seat payments and refunds go through Kill Bill. Voice memos are stored in MinIO. Email goes through an SMTP server whose messages can be inspected in Mailpit.

Out of scope:
- password or social-login accounts (people sign in with access codes)
- speech-to-text transcription
- push notifications
- chat
- CSV export
- any datastore beyond Postgres and MinIO
- any third-party origin loaded by the browser

## Problem and users

Today coaches hold their cohorts together with Google Forms logbooks, a shared spreadsheet, a Discord channel and a separate checkout page. This causes several problems:

- Participants write their entries at 4 a.m. on a phone in airplane mode. They half-type an entry and lose it, or submit it twice.
- Partners who share a phone or laptop see each other's half-written dreams.
- Entries made after midnight get filed under the wrong night. When someone travels, their entries land under a night that has already passed.
- In the spreadsheet the coach can read every participant's dream text, but the coach only needs recall rates, technique adherence and dream-sign tallies.
- A refunded participant keeps reading the cohort's pages for days.
- Nobody can see which dream-sign category keeps coming back for a given person: inner awareness, action, form or context. Recognising that category is the skill that pays off, together with recall.
- Participants lose their first nights of recall, which is their best predictor of success.
- Payment retries leave half-made billing records behind, and refunds that get double-clicked refund twice.
- Coaches lose hours to manual reconciliation and to refunds.

The users are:

- **Applicant** (occasional): finds an open cohort, pays for a seat and arrives at their first baseline night knowing their bedtime and their Wake-Back-to-Bed (WBTB) alarm.
- **Dreamer** (daily): captures each night's dreams before they fade, even offline at 4 a.m. on a shared device. They tag dream signs, see which category recurs and drill reality checks against it. From their own night 8 they also log WBTB practice with the MILD or SSILD technique.
- **Coach** (daily): creates and publishes cohorts and watches each one move from the baseline week to the technique weeks. The coach reads per-dreamer aggregates without reading private dreams, refunds seats before the technique weeks begin and sends one weekly digest per cohort week.

## Journeys

1. **Applicant enrols.**
   - Start: the Cohorts screen, listing open cohorts with their nights and seats left.
   - Steps:
     1. The applicant picks a cohort and enters their name, email, home time zone and usual bedtime, then continues.
     2. The enrolment page shows the payment-pending state and their access code.
     3. They press pay. An earlier attempt may have reached the billing provider before the connection dropped; in that case this press reuses what is already there.
     4. A forged form on another site that tries to pay for them is refused and never charges them.
   - End: the page reads Enrolled and shows their first night, bedtime and wake alarm in their home time. Exactly one receipt arrives in their inbox.
2. **Dreamer's first night.**
   - Start: signed out, following a link to `/logbook`.
   - Steps:
     1. The dreamer is sent to sign-in and signs in with their access code. They land on their logbook.
     2. The Tonight panel shows their night number and date, bedtime, wake alarm, and whether the morning capture window is open.
     3. The journal shows the empty-night copy.
     4. They write a dream and save it.
   - End: the entry sits under tonight's night, reads Saved and shows the time it was logged in their home time.
3. **Dreamer travels west.**
   - Start: signed in, with tonight's entry already saved.
   - Steps: the dreamer flies several time zones west and changes their home time zone in Night settings.
   - End: Night settings confirms they are still on the same night until their next bedtime. The Tonight panel keeps that night, and the next entry is filed under it, never under an earlier one.
4. **Dreamer captures offline at 4 a.m. on a shared phone.**
   - Start: signed in with the logbook open. Then the connection drops.
   - Steps:
     1. The offline banner appears.
     2. The dreamer writes an entry and records a whispered voice memo. Both are kept on the device.
     3. Still offline, they sign out, and the browser shows the sign-in screen at once. Later the connection returns, and their partner signs in on the same browser. The partner never sees, counts or sends the kept entry.
     4. Later the dreamer signs in again.
   - End: the Sync region announces the result. The entry appears exactly once and reads Saved. It plays back the same memo, fetched from the server in byte ranges.
5. **Dreamer tags a dream sign and drills.**
   - Start: a saved entry.
   - Steps:
     1. Using only the keyboard, the dreamer selects a phrase, opens the tag dialog, picks a category and confirms.
     2. The phrase is underlined and flies into its constellation, and a new star settles.
     3. The legend count for that category rises by one and is announced. On a phone the announcement comes from just below the collapsed horizon strip.
     4. They open the reality-check drill, which targets their most frequent category, and step through it while the Tonight panel refreshes in the background.
   - End: the drill is logged, and its step and focus were never disturbed.
6. **Coach runs a cohort.**
   - Start: signed in as a coach.
   - Steps:
     1. The coach creates a draft cohort under a name they have not used before, and publishes it. Applicants can now see it.
     2. The coach switches between cohorts. Each choice is in the address, so Back returns to the previous cohort.
     3. As server dates pass, the cohort shows its baseline week and then its technique weeks.
   - End: the roster shows per-dreamer aggregates and tallies, plus the title and text of any entry a dreamer chose to share, and nothing else. A newly shared entry appears within half a minute without a reload.
7. **Coach refunds and sends the digest.**
   - Start: the roster of a cohort in its baseline week.
   - Steps:
     1. The coach refunds one dreamer. Kill Bill records the refund once.
     2. The row changes to Refunded, its shared entries disappear, and that dreamer's open logbook goes back to sign-in.
     3. The freed seat shows again on the Cohorts screen.
     4. The coach sends the weekly digest, then presses send again.
   - End: one digest message holding only aggregates is in the coach's inbox, and the second press confirms that this week's digest was already sent.
8. **Applicant hits a payment outage.**
   - Start: a pending enrolment while billing is unreachable.
   - Steps: the applicant presses pay.
   - End: the payment-outage notice appears and the page still shows the pending state. No seat is held and no charge is made.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Open cohort listing** GET /api/cohorts and the Cohorts screen list every cohort in its enrolling or baseline phase with its price, nights and seats left in the published forms.
- **DP-02 — Enrollment request** An applicant's enrollment is created in pending_payment with a one-time access code, as specified in API.
- **DP-03 — Provider-confirmed seat** An enrollment becomes active, and the page reads Enrolled, only after Kill Bill records a successful PURCHASE on the account keyed by that enrollment, as qualified in Business rules.
- **DP-04 — Last-seat race** When several applicants pay for a cohort's last seat at once, exactly one becomes active and Kill Bill holds exactly one PURCHASE among them.
- **DP-05 — Payment replay** Paying again for an already active enrollment from the app's own origin returns it unchanged without contacting Kill Bill and never records a second PURCHASE.
- **DP-06 — Receipt after confirmation** The applicant's receipt reaches Mailpit only after the payment is confirmed and carries enrollment facts only, as qualified in Services.
- **DP-07 — Applicant enrollment journey** An applicant goes from the Cohorts screen to an Enrolled page showing their first night, bedtime and wake alarm in home time.
- **DP-08 — Billing outage** With Kill Bill unreachable, paying returns the billing outage response, the enrollment stays pending and the page shows the published payment-outage notice.
- **DP-09 — Access-code sign-in** A dreamer or coach signs in with their access code and gets a session; a pending or refunded code is refused with its status and the published copy.
- **DP-10 — Night key** Every entry is filed under the night key the server derives from its own clock, the dreamer's home time zone and bedtime, so an entry at 03:40 belongs to the previous evening's night, as qualified by DP-69.
- **DP-11 — Server-published night status** The Tonight panel shows the night number, night key, bedtime, wake alarm and capture-window status exactly as the server publishes them, whatever the device clock says.
- **DP-12 — Late recall** Entries the server receives after the night's capture window has closed are saved and flagged late recall.
- **DP-13 — Wake alarm** The suggested Wake-Back-to-Bed alarm is the bedtime plus five hours, shown in the dreamer's home time.
- **DP-14 — Night settings** A dreamer can change home time zone and bedtime within the published limits, and the change applies only to entries and checks saved afterwards, as qualified by DP-69 and DP-72.
- **DP-15 — First-night empty state** A night with no entries shows the published empty-state copy.
- **DP-16 — First-night journey** A dreamer signs in, sees the Tonight panel and empty state, writes an entry and sees it Saved under the right night.
- **DP-17 — Idempotent entry save** Saving an entry under its device-made id creates it once; an identical replay returns the stored entry and a different body under the same id is rejected.
- **DP-18 — Concurrent retries** Simultaneous saves of the same entry id leave exactly one stored entry.
- **DP-19 — Entry validation** Entries outside the published field limits or with values of the wrong JSON type are rejected with field errors and nothing is stored.
- **DP-20 — Device state until acknowledged** A new entry reads Kept on this device until the server acknowledges it, and only then reads Saved.
- **DP-21 — Rejected sync rollback** When the server rejects a kept entry, it returns to Kept on this device with the reason shown and is never shown as Saved.
- **DP-22 — Offline banner** While the browser is offline the logbook shows the published offline banner and keeps new entries on the device.
- **DP-23 — Sync announcement** Each sync attempt on reconnect or page load is announced in the Sync live region with the published counts copy, as qualified in Interactions.
- **DP-24 — Offline capture journey** An entry written offline survives a reload, syncs on reconnect, and appears once as Saved.
- **DP-25 — Memo stored as submitted** A voice memo is stored in MinIO byte for byte with its submitted content type and duration.
- **DP-26 — Memo playback** Memo playback returns the stored bytes with the original content type, length and duration, in full or as an exact byte range, with malformed ranges answered in full, and no text is ever shown in its place.
- **DP-27 — Memo limits** Memos over the size limit, of an unlisted type, empty or without a valid duration are rejected, and a second different memo for the same entry is refused.
- **DP-28 — Memo access** Only the owning dreamer can fetch a memo, plus the cohort's coach for an entry the dreamer has shared while holding their seat.
- **DP-29 — Memo storage outage** With MinIO unreachable the entry text still saves, the memo upload returns the storage outage response and the memo stays on the device with the published copy.
- **DP-30 — Tag a dream sign** Tagging a character range of a saved entry with one of the four categories stores one sign and returns the server-confirmed tallies, unless the range is refused as qualified in Business rules.
- **DP-31 — Derived constellations** Star counts, tagged nights and halo radius for each category are derived from stored signs, and the dreamscape, legend and coach tally agree after a reload.
- **DP-32 — Keyboard tagging** A dreamer can select a phrase, open the tag dialog, choose a category and confirm with the keyboard alone, with focus kept in the dialog and returned on close.
- **DP-33 — Tag shortcut** Pressing T tags the current selection whichever control in that entry has focus.
- **DP-34 — Sign condensation** Confirming a tag underlines the phrase, flies it into its category's constellation, settles a new star, grows the halo and then updates the legend and announces the count, on the published timeline.
- **DP-35 — Reduced-motion condensation** With reduced motion the flight and fog are skipped, the star fades in at its final place and the legend count and announcement are unchanged.
- **DP-36 — Tagging journey** A dreamer tags a phrase and sees the legend count for its category rise by one, and the same count after a reload.
- **DP-37 — Drill target** The reality-check drill targets the dreamer's most frequent dream-sign category by the published tie rule.
- **DP-38 — Keyboard drill** The drill dialog is stepped through, logged and closed by keyboard alone, with focus kept in the dialog and returned to its opener.
- **DP-39 — Reality-check log** Logging a drill stores one reality check per device-made id under the server's night key and returns the number of checks with that key.
- **DP-40 — Cohort phase from server date** A cohort's phase follows the server's date in the coach's time zone, and screens show the phase the server publishes.
- **DP-41 — Technique unlock on night 8** Wake-Back-to-Bed and technique fields appear from the dreamer's own night 8 as the server publishes it, within 60 seconds of the night changing.
- **DP-42 — Technique before night 8** Entries that report technique practice before the dreamer's night 8 are rejected with the published field error.
- **DP-43 — Cohort creation** A coach creates a cohort in draft with a name, first night, seat price and seat count, as qualified by DP-76 and DP-77.
- **DP-44 — Cohort transitions** Publish and close are allowed only from draft and technique respectively, and every other request is rejected with the illegal-transition response.
- **DP-45 — Coach tenancy** A coach sees and acts on their own cohorts only; another coach's cohort answers as not found.
- **DP-46 — Roster projection** Roster rows carry only the published aggregate fields and never dream titles, text or memo keys of unshared entries.
- **DP-47 — Shared entry exception** An entry the dreamer shares while holding their seat appears in the coach's roster with its title and text, and disappears when unshared or when the seat is refunded.
- **DP-48 — Adherence counts by night key** Roster nights logged, recall rate, technique minutes and WBTB nights use the stored night keys.
- **DP-49 — Roster layout** The coach screen switches from stacked cards below 768 pixels to a table with cohort tabs, and to split panes at 1200 pixels and wider.
- **DP-50 — Weekly digest** Sending the weekly digest delivers one Mailpit message to the coach with per-dreamer aggregates that match the roster and no dream content, as qualified by DP-67.
- **DP-51 — Digest mail outage** With mail unreachable the digest returns the mail outage response and the coach sees the published copy; success copy appears only after the message is accepted.
- **DP-52 — Refund before technique** A coach refunds an active paid seat during enrolling or baseline, Kill Bill records one full REFUND and the enrollment becomes refunded.
- **DP-53 — Refund window** Refunds once the technique weeks start, of non-active enrollments, of comped seats, or with Kill Bill unreachable are rejected and change nothing.
- **DP-54 — Workspace breakpoints** The dreamer workspace shows a stacked horizon strip below 768 pixels, a pinned band from 768 to 1199 pixels and split panes at 1200 pixels and wider.
- **DP-55 — Mobile dreamscape sheet** On a phone the horizon strip opens a full-screen dreamscape sheet that touch pans, closes with Escape and is unreachable when collapsed.
- **DP-56 — Dreamscape scene and fallback** The dreamscape draws one star per stored sign and names each category's drawn star count in the sky's accessible description, with a slow fog drift as its only idle motion, pans by drag and arrow keys, and falls back to a still picture without WebGL.
- **DP-57 — Night-sky visual design** Every screen uses the deep indigo ground, hushed light ink, violet actions and teal reserved for dream signs and the current night, with the published type and airy spacing.
- **DP-58 — Health and run manifest** The app runs from /app/run.json and answers the health check on the published port.
- **DP-59 — Server boundary** The server enforces same-origin writes, body size limits, JSON parsing and content types in the published order, and never serves source files or credentials.
- **DP-60 — Credentials from environment** Every service URL and credential is read from the environment at start and never reaches the browser.
- **DP-61 — Payment reconciliation** Paying reuses any Kill Bill account and successful PURCHASE already keyed by the enrollment id, so repeated or concurrent pays record at most one account, one PURCHASE and one receipt.
- **DP-62 — Memo signature check** A voice memo whose leading bytes do not match its declared audio type is refused with the published field error and nothing reaches MinIO.
- **DP-63 — No overlapping dream signs** No two stored dream signs in one entry overlap, and simultaneous overlapping tags store exactly one sign while the others get the overlap response, or the conflict or replay response when their range is identical to the winner's.
- **DP-64 — Open work survives refreshes** Timed refreshes, syncs and after-save updates never close an open dialog or sheet, reset the drill step, move focus, change typed input or re-announce an unchanged result, except that every sync attempt is announced as qualified in Interactions.
- **DP-65 — Cohort selection in the address** The coach's selected cohort lives in the address, so reload, Back and Forward restore it, and an unavailable cohort falls back to the earliest one with the published copy.
- **DP-66 — Live roster refresh** The open roster refreshes in place every 30 seconds while visible, keeping focus, open dialogs and scroll, and closes a shared-entry dialog whose entry was unshared with the published copy.
- **DP-67 — One digest per cohort week** Each cohort week gets at most one digest message, and every later or simultaneous send replays the stored digest with the published already-sent copy.
- **DP-68 — Freed seats agree everywhere** A refund frees its seat on every seats-left surface and the pay check at once, and simultaneous refunds of one enrollment record exactly one REFUND.
- **DP-69 — Night key never moves back** A dreamer's published and stored night key is never earlier than their latest stored entry's night key, even after a time-zone or bedtime change.
- **DP-70 — Cross-site pay refused** A pay press arriving with a foreign or null Origin, or with no Origin and Sec-Fetch-Site cross-site, is refused with the cross-origin response before Kill Bill is contacted, so no account or charge is made.
- **DP-71 — Sign-in landing** After sign-in the browser lands on next only when it passes every published landing rule, and otherwise on the signed-in role's own screen.
- **DP-72 — Held night is explained** Saving night settings that would move the night earlier reports night_held and shows the published held-night copy with the unchanged night number.
- **DP-73 — Kept entries belong to their dreamer** Entries and memos kept on a shared browser are shown, counted and synced only under the dreamer who wrote them, and a server write to another dreamer's entry or reality-check id answers 404 and stores nothing.
- **DP-74 — One memo per entry under racing uploads** Simultaneous different memo uploads for one entry store exactly the winner's bytes in MinIO, losers never write there, and a failed MinIO write releases the claim.
- **DP-75 — Results reachable while the sky is collapsed** On a phone the Dream signs status stays outside the collapsed sheet and is announced while the sheet's legend, sky and drill button stay inert, and sign offsets are whole-text UTF-16 offsets.
- **DP-76 — Cohort names are exact and unique** Cohort links, tabs and options are named exactly by the cohort name with the phase label as their description, and a coach can never hold two cohorts whose names match case-insensitively.
- **DP-77 — Names never break mail** Applicant and cohort names are stored exactly as entered, any control character or line separator is refused, and every message carries exactly its published subject and one recipient.
- **DP-78 — A refund ends access now** A successful refund ends every session of that dreamer at once, so their next request answers 401, the open logbook returns to sign-in and their shares leave the roster.
- **DP-79 — Instants and money across layers** The API carries instants as UTC with a Z suffix and no fractional seconds and money as integer cents, while screens show the dreamer's home wall-clock time and dollars with two decimals.
- **DP-80 — Error precedence** Every API request that breaks several rules gets the response of the earliest rung of the published precedence ladder.
- **DP-81 — System-only transitions** Phase and status changes that only the server or a provider may make follow the published transition table, and a manual request for one answers 409 with nothing changed.
- **DP-82 — Roster scroll area** The roster table scrolls sideways and down inside its own area with its header row and Dreamer column pinned, while the page never scrolls sideways.
- **DP-83 — Motion phase and reduced motion** The dreamscape publishes the current condensation phase, and with reduced motion no transition or animation runs and the flight and settle phases never occur.
- **DP-84 — Verbatim copy characters** Every published string renders with the exact straight apostrophes and en dashes it is written with.

## Frontend

### Screens and layout (DP-01, DP-07, DP-16, DP-49, DP-54, DP-55, DP-65, DP-75, DP-82)

**Viewports.** There are three published viewports: 375x812 (phone), 768x1024 (tablet) and 1280x800 (desktop). Each width range gets exactly one layout:
- below 768 pixels: the phone layout
- 768 to 1199 pixels: the tablet layout
- 1200 pixels and wider: the desktop layout

No other breakpoint changes which layout these three sizes get. No page scrolls sideways at any of them.

**Header.** Every screen has a thin header with the Lanternfish wordmark. When someone is signed in, it also shows their name and the sign-out button.

**Cohorts** (`/`, public)
- A heading, then one card per listed cohort.
- Each card shows the cohort's name, coach name, phase label, nights, price and seats left, and has an enrol button.
- The cards sit in one column on a phone, two columns on a tablet and three columns on a desktop.
- The header has a sign-in link.
- Seats left are read from the server each time the screen loads.

**Enrol** (`/enroll/<cohort id>`, public)
- One form in a single centred column at every size, no wider than the text column.
- A draft, unknown or malformed cohort id shows the cohort-not-found state instead of the form.

**Enrolment** (`/enrollments/<enrollment id>`, public)
- The enrolment status page.
- While pending, it shows the pending state with the access code and the pay button.
- Once enrolled, it shows the Enrolled state with the first night, bedtime, wake alarm and a button that opens the logbook.
- It is a single column at every size.

**Sign in** (`/signin`)
- The access-code form in a single column.

**Not found.** Any other browser path shows the not-found page.

**Logbook** (`/logbook`, dreamer)

The workspace has three parts:
- **Tonight panel:** the night line, bedtime, wake alarm, capture-window status and the night-settings button.
- **Journal:**
  - The new-entry form comes first, then the current night's section (its entries, or the empty-night copy), then earlier nights that have entries, newest first.
  - Each saved entry is an article holding its title, its logged time, its read-only text, its memo player, its state label, its tagged phrases, and its tag and share buttons.
  - Each entry the server rejected is an article holding its title, its state label, its rejection line, and its edit and discard buttons.
- **Dreamscape:** the night sky with the four constellations, the legend beside it, the drill button and the Dream signs status.

The Tonight panel always sits at the top of the journal column. The layout depends on the width:

- **Desktop (1200 pixels and wider):**
  - The journal is a text column 560 pixels wide on the left that scrolls on its own.
  - The dreamscape fills the rest of the width to the right and the full height below the header.
  - The legend and the Dream signs status sit over the sky in its lower corner.
- **Tablet (768 to 1199 pixels):**
  - The dreamscape is a band 280 pixels tall across the full width above the journal. It stays pinned at the top while the journal scrolls beneath it.
  - The legend and the Dream signs status sit at the band's right edge.
  - The journal is full width below the band.
- **Phone (below 768 pixels):**
  - The dreamscape collapses to a horizon strip 96 pixels tall across the top, above the journal. The strip shows a miniature of the sky and holds only the open-dreamscape button.
  - The Dream signs status sits directly below the strip, outside the sheet, and stays in the accessibility tree whether the sheet is open or collapsed.
  - Opening the strip expands a full-screen sheet (the dreamscape dialog) holding the sky, the legend, the drill button and the close button.
  - While the sheet is collapsed, it is hidden and inert. Nothing inside it is visible, focusable or exposed to assistive tech. Moving it off-screen does not count as collapsing it.
  - While the sheet is open, everything behind it is inert.

**Coach** (`/coach?cohort=<cohort id>`, coach)

The screen holds the cohort list, the new-cohort form, the selected cohort's header and its roster. The header shows the phase label and the publish, close and digest buttons.

- **Desktop:** The cohort list and the new-cohort form make a left column 320 pixels wide. The selected cohort and its roster fill the rest.
- **Tablet:** The cohort list becomes a horizontal row of tabs above the cohort header. The new-cohort form opens from a button. The roster stays a table.
- **Phone:**
  - A cohort picker sits above the header.
  - The roster becomes stacked cards, one article per dreamer named by their display name. Each card has the dreamer's name as its heading and the same fields as the table columns.

**Roster view (tablet and desktop).**
- The roster table sits inside its own scroll area, the roster view. The view is as tall as the space left below the cohort header in the viewport, and never less than 320 pixels.
- The view scrolls sideways whenever the table is wider than the view, and down whenever the table is taller. The page itself never scrolls sideways.
- While the view scrolls in either direction:
  - the column header row stays pinned at the top of the view;
  - the `Dreamer` column stays pinned at its left edge.
- The view can take keyboard focus, so the arrow keys scroll it.

### Public screens and controls (DP-09, DP-15, DP-20, DP-21, DP-22, DP-23, DP-32, DP-33, DP-38, DP-41, DP-43, DP-49, DP-55, DP-56, DP-65, DP-66, DP-75, DP-76, DP-79, DP-82, DP-83, DP-84)

Only these roles and names are public.

Copy in backticks renders character for character. Apostrophes are the straight ASCII apostrophe (U+0027) and dashes between values are the en dash (U+2013), exactly as written. A typographic apostrophe, an em dash or a hyphen in their place is wrong. Live-region announcements built from this copy use the same characters. Feedback copy is defined in Feedback states.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| Cohorts | `heading "Open cohorts"` (level 1) | `Open cohorts` |
| Cohorts | `article "<cohort name>"` per card | name, coach name, phase label, `Nights <first night> – <last night>`, `$<price>`, `<seats copy>` |
| Cohorts | `button "Enroll in <cohort name>"` | `Enroll`; disabled when the card shows `Full` |
| Cohorts | `link "Sign in"` | `Sign in` |
| Enrol | `form "Enroll in <cohort name>"` | heading with the cohort name |
| Enrol | `textbox "Your name"`, `textbox "Email"` | |
| Enrol | `combobox "Home time zone"` | the accepted zones from `GET /api/time-zones` in their published order; preselected to the browser's zone when it is listed, otherwise `UTC` |
| Enrol | `textbox "Usual bedtime"` | 24-hour `HH:MM` |
| Enrol | `button "Continue to payment"` | `Continue to payment` |
| Enrol (draft, unknown or malformed cohort) | `heading "Cohort not found"` (level 1) | `We couldn't find that cohort.` |
| Enrolment | `heading "Payment pending"` or `heading "Enrolled"` (level 1) | `Payment pending` / `Enrolled` |
| Enrolment | `group "Access code"` | `Your access code: <access code>`, shown only on the page reached right after continuing |
| Enrolment | `button "Pay $<price>"` | shown only while pending |
| Enrolment | `button "Open my logbook"` | shown only when Enrolled |
| Enrolment | `status "Enrollment"` | pending, success and declined copy |
| Enrolment | `alert "Payment"` | payment-outage notice |
| Sign in | `textbox "Access code"`, `button "Sign in"` | |
| Sign in | `status "Sign in"` | sign-in results |
| Header | `button "Sign out"` | `Sign out` |
| Not found | `heading "Page not found"` (level 1) | `We couldn't find that page.` |
| Logbook | `region "Tonight"` | the night line `Night <night number> of 28 – <night key>`, then `Bedtime <bedtime>`, `Wake alarm <wake alarm>` and the capture-window line |
| Logbook | `button "Night settings"` → `dialog "Night settings"` | `combobox "Home time zone"` (same list as Enrol), `textbox "Usual bedtime"`, `button "Save settings"`, `button "Cancel"` |
| Logbook | `status "Connection"` | offline banner |
| Logbook | `region "Journal"` | |
| Logbook | `form "New entry"` | `textbox "Dream title"`, `textbox "Dream text"` (multi-line), `spinbutton "Dreams recalled"`, `checkbox "Lucid"`, `button "Record voice memo"` (reads `Stop recording` while recording), `button "Save entry"` |
| Logbook | in `form "New entry"` from night 8 only | `checkbox "Woke for WBTB"`, `radiogroup "Technique"` with `radio "None"`, `radio "MILD"`, `radio "SSILD"`, `spinbutton "Technique minutes"` |
| Logbook | `heading "Night <night number>, <night key>"` (level 2) per night section | |
| Logbook | `article "<title>"` per entry (`Untitled dream` when the title is empty) | state label, `Logged <logged time>` on saved entries, `Late recall` badge when flagged |
| Logbook | `textbox "Entry text"` (read-only, selectable) inside each saved entry | the stored text; tagged phrases carry a teal underline and are exposed as `mark` elements |
| Logbook | `button "Tag as dream sign"` inside each saved entry | absent on entries still kept on the device |
| Logbook | `button "Share with coach"` (its pressed state shows sharing) inside each saved entry | `Share with coach` / `Shared with coach` |
| Logbook | `button "Edit as new entry"` inside each entry the server rejected | `Edit as new entry` |
| Logbook | `button "Discard"` inside each entry the server rejected | `Discard` |
| Logbook | `audio` element named `Voice memo` inside an entry with a memo | native play and seek controls |
| Logbook | `dialog "Tag dream sign"` | `Phrase: "<phrase>"`, `radiogroup "Category"` with `radio "Inner awareness"`, `radio "Action"`, `radio "Form"`, `radio "Context"`, `button "Confirm tag"`, `button "Cancel"` |
| Logbook | `region "Dreamscape"` carrying the attribute `data-phase` | its value is the condensation phase from Motion and effects; on a phone this region wraps the horizon strip and the sheet |
| Logbook | `img "Dream-sign sky"` (focusable), with the accessible description `Stars: inner awareness <a>, action <b>, form <c>, context <d>.` | the sky |
| Logbook | `list "Dream-sign legend"` | four items in this order: `Inner awareness: <n>`, `Action: <n>`, `Form: <n>`, `Context: <n>`; the target item adds ` (drill target)` |
| Logbook | `status "Dream signs"` | tag results; on a phone, directly below the strip and outside the sheet |
| Logbook | `button "Reality check drill"` | disabled while there is no target |
| Logbook | `dialog "Reality check drill"` | step text, `Step <k> of 3`, `button "Next"` on steps 1 and 2, `button "Log reality check"` on step 3, `button "Close drill"` |
| Logbook | `status "Practice"` | drill, settings and share results |
| Logbook | `status "Sync"` | sync and memo announcements |
| Logbook (phone) | `button "Open dreamscape"` | the horizon strip |
| Logbook (phone) | `dialog "Dreamscape"`, `button "Close dreamscape"` | the full-screen sheet |
| Coach | `heading "Cohorts"` (level 1) | |
| Coach | `navigation "Cohort list"` with `link "<cohort name>"` (desktop), `tablist "Cohort list"` with `tab "<cohort name>"` (tablet), `combobox "Cohort"` with `option "<cohort name>"` (phone) | each shows the cohort name with its phase label on a second line. The accessible name is exactly the cohort name, and the phase label is the accessible description, never part of the name. The selected cohort is marked current, selected or chosen |
| Coach | `heading "<cohort name>"` (level 2) | the selected cohort's header, with its phase label beside it |
| Coach | `form "New cohort"` (desktop: always shown; tablet and phone: opened by `button "New cohort"`) | `textbox "Cohort name"`, `textbox "First night"` (date), `textbox "Seat price (USD)"`, `spinbutton "Seats"`, `button "Create cohort"` |
| Coach | `button "Publish cohort"` (draft only), `button "Close cohort"` (technique only), `button "Send weekly digest"` (baseline and technique only) | |
| Coach | `region "Roster view"` (tablet, desktop), focusable | the roster scroll area |
| Coach | `table "Roster"` inside it | columns `Dreamer`, `Status`, `Night`, `Recall`, `Technique minutes`, `WBTB nights`, `Reality checks`, `Inner awareness`, `Action`, `Form`, `Context`, `Actions`. Each row's `Dreamer` cell is `rowheader "<display name>"`; `Status` shows `<status label>`; `Night` shows `<roster night>`; `Recall` shows `<recall percent>%` |
| Coach | `article "<display name>"` per dreamer (phone) | `heading "<display name>"` (level 3), then the same fields as labelled lines |
| Coach | `button "Refund <display name>"` on each active row or card → `dialog "Refund seat"` | `Refund <display name>'s seat of $<price>?`, `button "Confirm refund"`, `button "Cancel"` |
| Coach | `button "Read shared entry <title>"` → `dialog "Shared entry"` | the title, the text, a memo player if any, `button "Close"` |
| Coach | `status "Coach updates"` | digest, refund, cohort and roster results; it stays in place when the cohort changes, so an announcement survives the switch |

**Placeholders.**
- `<price>`: the cohort's `price_cents` shown in dollars with two decimals and a comma between thousands, for example `$240.00` or `$1,000.00`.
- `<seats copy>`: `Full` when `seats_left` is 0, `1 seat left` when it is 1, and `<seats left> seats left` when it is 2 or more.
- `<first night>` on the card is the cohort's `starts_on`. `<last night>` is `starts_on` + 27 days.
- `<logged time>`: the entry's `created_at` converted to the dreamer's current home time zone from the night endpoint, as 24-hour `HH:MM`. It is never in the browser's own time zone or in UTC.
- `<display name>`: the roster `display_name` defined in API.
- `<recall percent>`: the roster `recall_rate` times 100. It is always a whole number, because the rate has two decimals.
- `<status label>`: `Active` for a roster `status` of `active`, and `Refunded` for `refunded`. The phone card's `Status` line uses the same copy.
- `<roster night>`: `<night number> of 28`, from the roster `night_number`, for example `9 of 28`. A `night_number` above 28 shows `28 of 28`, and 0 shows `Not started`. The phone card's `Night` line uses the same copy.
- **Phase label:** `Draft`, `Enrolling`, `Baseline – week <week> of 4`, `Technique – week <week> of 4` or `Closed`, from the cohort's `phase` and `week`.
- `<a>`, `<b>`, `<c>`, `<d>` in the sky's description: the number of stars drawn for inner awareness, action, form and context. Each equals that category's `stars` from the dreamscape endpoint once any condensation has settled.
- Dates such as `<night key>` are `YYYY-MM-DD`.
- Times such as `<bedtime>` and `<wake alarm>` are 24-hour `HH:MM` in the dreamer's home time zone.

### Interactions (DP-11, DP-20, DP-21, DP-22, DP-24, DP-32, DP-33, DP-34, DP-38, DP-41, DP-55, DP-56, DP-64, DP-65, DP-66, DP-71, DP-72, DP-73, DP-75, DP-78)

**Results never wait on timers.** The result of a completed request appears as soon as its response arrives, without waiting on a timer or an animation frame. Only two things use timers:
- the published refresh intervals;
- the sign-condensation timeline, which has its own published phases.

Tests run with a controlled page clock.

**Keyboard.** Every action works by keyboard. Tab order follows the screen from top to bottom, then left to right, and is fixed for each layout:
- **Desktop:** the header, then the Tonight panel, then the journal top to bottom, then the dreamscape (`Dream-sign sky`, then `Reality check drill`).
- **Tablet:** the header, then the dreamscape band (`Dream-sign sky`, then `Reality check drill`), then the Tonight panel, then the journal top to bottom.
- **Phone:** the header, then `Open dreamscape`, then the Tonight panel, then the journal top to bottom. Controls inside the collapsed sheet are not in the order.

`list "Dream-sign legend"` and its items are not Tab stops at any size. Tab moves straight from the sky to the drill button.

**Dialogs and the phone sheet** all behave the same way:
- Opening one moves focus to its first control.
- Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Focus never leaves the open dialog. In `dialog "Night settings"`, Tab moves from `Home time zone` to the next control however the zone list was opened, scrolled or typed into.
- Escape closes it.
- Closing it by any means returns focus to the control that opened it. The exceptions are the tag dialog (see Tagging a dream sign) and the shared-entry case in Feedback states.

**Night settings.**
- The dialog opens showing the stored home time zone and bedtime, with focus on `Home time zone`.
- `Cancel` or Escape discards any edits, so reopening shows the stored values again.
- `Save settings` sends the change. On success:
  - the dialog closes;
  - the Practice status shows the saved or held-night copy that matches the response's `night_held`;
  - the Tonight panel refreshes.

**Signed-out access and landing.**
- Opening `/logbook` or `/coach` (with any query) without a session redirects to `/signin?next=<that path and query, URL-encoded>`.
- After sign-in, the browser lands on the landing the server decides (Business rules, Sign-in landing). Its origin never changes.
- A signed-in person who opens the other role's screen lands on their own screen.
- Any request from the logbook that gets a 401 sends the browser to `/signin?next=%2Flogbook`. This includes the timed Tonight refresh and an entry save. Kept entries stay on the device.

**Night status.**
- The Tonight panel renders exactly what the server's night endpoint returns: the night number, night key, bedtime, wake alarm, capture-window status and technique availability. The browser never works these out from its own clock or time zone.
- The panel refreshes:
  - on page load;
  - when the connection returns;
  - after each saved entry;
  - after the night settings are saved;
  - every 60 seconds while the page is visible;
  - once when the page becomes visible again.
- The night-8 fields appear or stay hidden according to the latest refresh.

**Kept entries and the shared browser.**
- Every entry and memo kept on the device is stamped with the enrolment id (`id` from the session response) of the dreamer who wrote it.
- The browser remembers the id from the last successful session response, so offline page loads know whose logbook is open. Sign-out clears that remembered id but never deletes kept entries.
- **Signing out while offline.** `Sign out` while the browser reports offline:
  - clears the remembered id at once and shows the sign-in screen;
  - stores a pending sign-out on the device, which survives a reload;
  - sends `DELETE /api/session` as the first request once the connection returns, before any sync or other request, and the server ends that session.

  From the moment of signing out, no kept entry is shown or counted and no sync attempt is made. An offline page load of `/logbook` with no remembered id shows the sign-in screen.
- **Signing in while offline.** `Sign in` while the browser reports offline sends nothing and shows the offline sign-in copy from Feedback states.
- While a dreamer is signed in, kept entries stamped with another enrolment id are:
  - never shown;
  - never sent;
  - never included in any count.
- A page load whose only kept entries belong to someone else makes no sync attempt.
- When their owner signs in again, those entries sync on that page load.

**Saving an entry.** On `Save entry`:
1. The browser makes a new entry id and stores the entry on the device.
2. The form clears, and the entry appears at the top of the current night's section with the device state label.
3. The browser sends the entry. Only a 200 or 201 response turns the label to the saved state. The entry is then filed under the night the server returned, which may move it to another section.
4. A 409 or 422 response marks the entry as rejected. It returns to the device state and shows the rejection line under it.
   - A rejected entry stays on the device with its id. It is never sent again, on reconnect or on page load.
   - It offers exactly two ways out:
     - `Edit as new entry` copies the entry into `form "New entry"`: its title, text, recalled count, lucid flag, night-8 fields and any voice memo kept on the device. It removes the rejected entry from the device and moves focus to `Dream title`. Pressing `Save entry` then follows these steps from step 1 under a new id.
     - `Discard` removes the entry and its kept memo from the device and moves focus to `Dream title`.
5. A request that gets no response, or any other status except 401, leaves the entry kept on the device and not rejected. It is sent again on the next reconnect or page load.

**Offline.**
- While the browser reports offline, the offline banner shows, entries and memos are stored on the device, and nothing is sent.
- Kept entries, rejected ones included, survive a reload and a closed tab.
- When the browser reports online again, and on every page load while the browser reports online, the browser makes a sync attempt if the signed-in dreamer has at least one kept entry that is not rejected, or at least one kept memo.
- A sync attempt:
  1. sends every such entry, in the order it was written;
  2. then sends every such memo;
  3. then announces the attempt in the Sync region with the counts from Feedback states.
- With nothing to send, a reconnect or page load makes no attempt and announces nothing.
- Every sync attempt is announced, even when its counts equal the previous announcement.
- A kept entry that is not rejected is retried on each later reconnect and page load until it is saved or rejected.

**Voice memo.**
- `Record voice memo` asks for the microphone and starts recording.
- `Stop recording` ends the recording and attaches it to the entry being written.
- The recording is uploaded after its entry is saved, exactly as recorded, with its measured duration.
- Playback always fetches the stored memo from the server, which serves any part of it through the byte ranges described in API.
- A memo recorded in the browser may lack the index a player needs to seek, and the server never adds one. For such a memo, playing from the start is enough.
- For an uploaded PCM WAV memo, seeking in the player jumps to that point in the recording in Chromium, Firefox and WebKit.

**Tagging a dream sign.**
1. The dreamer selects a phrase inside a saved entry's `Entry text`, in any of these ways:
   - dragging with the mouse;
   - long-pressing on touch;
   - with the keyboard: Tab into the text, move with the arrow keys and extend with Shift+arrows.
2. They press `Tag as dream sign`, or press `T` while focus is anywhere inside that entry's article: the text, the tag button, the share button or the memo player. With no selection in that entry, the no-selection copy is announced and no dialog opens.
3. The browser computes the offsets as described under Dream signs in Business rules, counting over the whole entry text, across existing marks and astral characters.
4. The tag dialog opens showing the phrase:
   - `Inner awareness` is checked and focused;
   - the arrow keys move focus to another category and check it;
   - Enter anywhere in the dialog, or `Confirm tag`, confirms the checked category;
   - Escape or `Cancel` closes the dialog without saving.
5. Closing the tag dialog by confirm, `Cancel` or Escape always returns focus to that entry's `Tag as dream sign` button. This holds whether the dialog was opened by that button or by `T` from another control in the entry. On confirm, the sign condensation also starts (Motion and effects).

**Reality check drill.**
- `Reality check drill` opens the dialog on step 1 of 3. `Next` moves to the next step.
- Step 1 shows the prompt for the target category:

  | Target category | Step 1 copy |
  |---|---|
  | Inner awareness | `Notice what you are feeling right now. Is it the kind of feeling your dreams bring?` |
  | Action | `Notice what you and others are doing. Could it happen awake?` |
  | Form | `Look at your hands. Count your fingers twice.` |
  | Context | `Look around. Does this place make sense for where you are?` |

- Step 2 copy: `Ask yourself, out loud or silently: am I dreaming?`
- Step 3 copy: `Pinch your nose and try to breathe through it.`
- `Log reality check` saves the drill under a new id with the category the dialog opened with. It closes the dialog and returns focus to the drill button.

**Dreamscape.**
- Dragging with a mouse, or with one finger on touch, pans the sky with the pointer. This works at every size and also with reduced motion.
- Touch panning inside the sky never scrolls the page.
- The sky can be panned at most half its own width and half its own height away from centre.
- With `Dream-sign sky` focused, each arrow-key press pans by 40 pixels, and Home recentres.
- On a phone:
  - `Open dreamscape` opens the full-screen sheet with the server-confirmed legend counts and sky description;
  - `Close dreamscape` or Escape collapses it and returns focus to `Open dreamscape`;
  - while the sheet is collapsed, the strip miniature still gains each new star.

**Sharing.** `Share with coach` toggles sharing for that one entry, and the button shows the state the server returned.

**Coach.**
- Choosing a cohort loads its header and roster and updates the address as described under Screen state in Feedback states. The chooser is the desktop link, the tablet tab or the phone picker.
- `Create cohort` sends the form. The seat price is typed in dollars (for example `240` or `12.50`) and sent as whole cents. A price that is not a dollar amount with at most two decimals shows the price field message without sending anything.
- The publish, close and digest buttons call their endpoints. Each button is disabled while its request is in flight.
- `Refund <display name>` opens the confirmation dialog, and `Confirm refund` sends the refund.
- The roster reloads when the cohort changes, after every refund and on its timed refresh. Each roster reload also updates the phase label.

**Applicant.**
- `Continue to payment` creates the enrolment and opens its page.
- `Pay $<price>` sends the payment once and stays disabled until the response arrives.
- A pending enrolment page can be paid again after an outage or a decline.

### Visual design (DP-57)

**Colour.**
- **Ground:** a deep, nearly black indigo everywhere. No surface is white or light. Panels are only a shade lighter than the ground.
- **Body text:** a soft lavender-white, held back to about 85 percent strength so it glows quietly instead of glaring.
- **Muted slate-indigo:** borders, dividers, secondary text and disabled controls.
- **Soft violet:** every action, including buttons, links, focus rings, selected tabs and radio dots.
- **Cool luminous teal:** reserved for dream signs (tagged phrases, stars, halos and legend counts) and for the current night's heading. These are the only bright pixels on screen.

**Type.**
- Display headings use Fraunces, a soft serif with strong contrast between thick and thin strokes.
- Body text and controls use Atkinson Hyperlegible, a typeface drawn for low-vision reading.
- Each heading level is about one fifth larger than the level below it, starting from the body size.
- No text is heavier than semi-bold.
- Both type families are served from the app itself.

**Density and composition.**
- Spacing is airy: generous line spacing, wide gaps between entries and few controls per row.
- The dreamscape is the largest visual area at desktop size, and on a phone while its full-screen sheet is open. At tablet size it is the pinned band above the journal.
- Type over the sky stays small and restrained.
- Roster rows are dense, but every control in them is still a full-size target.

**Controls and contrast.**
- Every interactive control is at least 44 by 44 pixels. This includes the refund and read buttons inside roster rows and cards.
- Every focus ring stands out clearly against the ground.
- All text and controls meet WCAG 2.2 AA contrast on the dark ground.

### Motion and effects (DP-34, DP-35, DP-55, DP-56, DP-83)

**General feel.**
- Every motion starts fast and slows gently into place.
- Hover and press feedback on controls takes about a tenth of a second.
- Dialogs and the phone sheet fade and rise in about a quarter of a second, and close in under a quarter of a second.
- The only other motions are the fog drift and the sign condensation. There is no other looping or decorative animation.

**Dreamscape scene.** The sky is drawn with WebGL.
- It shows four constellations, each around a fixed anchor: inner awareness upper left, action upper right, form lower left and context lower right.
- Each constellation has one star per stored sign of its category, placed at the same spot on every load.
- The sky's accessible description names how many stars each constellation currently draws, so the drawn stars can be counted without reading pixels.
- Each anchor has a soft teal halo whose radius is that category's halo radius from the dreamscape endpoint.
- Faint violet fog drifts slowly across the sky as its only idle motion, completing one drift cycle every 40 to 80 seconds.
- The fog stops while the page is hidden.

**Sign condensation** (the signature, after the dreamer confirms a tag). Times count from the moment of confirming. The `data-phase` value of `region "Dreamscape"` names each step. It reads `idle` at all other times.

1. **`underline`** (from confirming to about 0.12 seconds): the tagged words in the entry gain a teal underline.
2. **`flight`** (about 0.12 to 0.76 seconds): a glowing copy of the phrase lifts from the words on screen. It breaks into particles that travel along a gentle curve to the category's anchor in the sky, or to the horizon strip on a phone.
3. **`settle`** (about 0.76 to 1.06 seconds): the particles gather into one new star and the halo grows to its new radius.
4. **Back to `idle`:** when the star settles, the legend item for that category and that category's count in the sky's description change to the server-confirmed count, and the Dream signs region announces it.
   - This happens at about 1.06 seconds, or when the server confirms if that comes later. It never happens before the server confirms.
   - The phase stays `settle` until then.

If the server refuses the tag:
- the phase becomes `refused`;
- the particles fade out over about a third of a second;
- the underline is removed;
- no star is added;
- the legend and the sky's description keep their old counts;
- the phase then returns to `idle`.

After a reload, the sky and the legend show the same star counts, because both come from the stored signs.

**Reduced motion.** When the system asks for reduced motion:
- No transition or animation runs anywhere on the page. Every transition and animation has zero duration, and dialogs and the sheet appear and disappear at once.
- The fog stays still.
- No phrase copy flies. The phase goes from `underline` straight to `idle` (or `refused`, then `idle`), and `flight` and `settle` never occur.
- The underline appears at once.
- As soon as the server confirms, the new star appears at its final place, drawn by the canvas over about a tenth of a second, and the halo jumps to its new radius.
- The legend count, the sky's description and the announcement are the same as with full motion. They appear within 0.2 seconds of the server's confirmation.
- Panning by drag, touch and keys still works.

**No WebGL.** Without WebGL, the dreamscape draws a still picture of the same stars and halos at the same places. The legend, the sky's description, the announcements, the phases and panning all still work, and new stars appear with the reduced-motion fade.

### Feedback states (DP-08, DP-09, DP-11, DP-12, DP-15, DP-20, DP-21, DP-22, DP-23, DP-29, DP-30, DP-42, DP-51, DP-53, DP-63, DP-64, DP-65, DP-66, DP-67, DP-72, DP-76, DP-78, DP-84)

Each async result shows on screen and is announced in the named live region with exactly this copy, following the character rule in Public screens and controls. Placeholders follow the definitions there. `<reason>` is the server's field error message, or the conflict line given below.

| Action | Live region | Pending | Success | Field error | Outage or rejection |
|---|---|---|---|---|---|
| Sign in | `status "Sign in"` | button disabled | navigates as described under Signed-out access in Interactions | | invalid code: `That access code didn't work.`; pending code: `This enrollment is waiting for payment.`; refunded code: `This seat was refunded, so this code no longer opens a logbook.`; offline: `You're offline. Connect to the internet to sign in.` |
| Continue to payment | `status "Enrollment"` | button disabled | navigates to the enrolment page | message under each field from the 422 body | closed: `Enrollment for this cohort is closed.`; already enrolled: `You already have a seat request for this cohort.` |
| Pay | `status "Enrollment"`, `alert "Payment"` | `Confirming payment with the billing provider.` | heading becomes `Enrolled`, with `A receipt is on its way to <email>.` and `Your first night: <first night> – bedtime <bedtime>, wake alarm <wake alarm>.` | | billing outage in `alert "Payment"`: `Payments are unreachable right now. Your seat is not reserved and you have not been charged.`; declined: `Your payment was declined. Your seat is not reserved.`; full: `This cohort just filled up. You have not been charged.` |
| Pending enrolment page | `status "Enrollment"` | | | | `Your seat is not reserved until payment is confirmed.` |
| Connection | `status "Connection"` | | | | offline banner: `You're offline. New entries are kept on this device until you reconnect.` |
| Save entry | `status "Sync"` | entry label `Kept on this device` | entry label `Saved` | under the entry: `Not saved: <reason>` | 409 id-conflict reason: `This entry conflicts with one already saved.`; cohort not started or closed: the label stays `Kept on this device` with `Not saved: This cohort is not open for entries.` |
| Sync after reconnect | `status "Sync"` | | `Synced: <saved count>. Kept on this device: <kept count>.` | | same copy |
| Empty night | (visible only) | | `No dreams logged for this night yet. Write down whatever you remember, even a single image.` | | |
| Capture window | (visible in Tonight) | | open: `Morning capture window open until 14:00.`; closed: `Capture window closed. New entries are marked late recall.` | | |
| Before night 1 | (visible in Tonight, in place of the night line) | | `Your first night is <first night>.` | | |
| Technique fields before night 8 | (visible in form) | | `Technique practice unlocks on night 8.`, shown where the night-8 fields will appear | | |
| Voice memo | `status "Sync"` | `Uploading voice memo.` | `Voice memo saved.` | `Not saved: <reason>` | MinIO outage: `Voice memo kept on this device. It will upload when storage is back.`; another memo already stored: `Not saved: This entry already has a different voice memo.`; playback failure: `Voice memo unavailable right now.` |
| Tag dream sign | `status "Dream signs"` | underline shown | `<Category> signs: <n>.` | | no selection: `Select a phrase in this entry first.`; overlap: `That phrase overlaps a sign you already tagged.`; any other rejection: `That sign wasn't saved. Try again.` |
| Drill | `status "Practice"` | button disabled | `Reality check logged. Checks this night: <n>.` | | no target: the drill button is disabled and `Tag a dream sign first to set your drill target.` shows as visible text beside it, not in `status "Practice"` |
| Night settings | `status "Practice"` | button disabled | `night_held` false: `Night settings saved. They apply to new entries.`; `night_held` true: `Night settings saved. You're still on night <n> until your next bedtime.` | message under each field | |
| Share toggle | `status "Practice"` | button disabled | `Shared with your coach.` / `No longer shared.` | | |
| Choose cohort | `status "Coach updates"` | | header and roster of the chosen cohort | | unavailable cohort in the address: `That cohort isn't available.` |
| Create cohort | `status "Coach updates"` | button disabled | `Cohort created as a draft.` | message under each field | name taken: `You already have a cohort with that name.` |
| Publish or close cohort | `status "Coach updates"` | button disabled | `Cohort published.` / `Cohort closed.` | | `That change isn't allowed in this phase.` |
| Send digest | `status "Coach updates"` | `Sending digest.` | first send: `Digest sent to <coach email>.`, shown only after the server confirms the message was accepted; replay: `This week's digest was already sent to <coach email>.` | | mail outage: `Mail is unreachable. The digest was not sent.` |
| Refund | `status "Coach updates"` | button disabled | `Refunded <display name>.` | | window closed: `Refunds close when the technique weeks start.`; comped: `This seat was not paid through checkout.`; billing outage: `Billing is unreachable. No refund was made.`; already refunded: `That seat was already refunded.` |
| Shared entry withdrawn | `status "Coach updates"` | | | | `That entry is no longer shared.` |

**Placeholder meanings.**
- `<Category>`: the legend label (Inner awareness, Action, Form or Context).
- `<n>`: the count or night number the server confirmed. For the held night it is the response's `night_number`.
- `<saved count>`: the number of entries saved by that sync attempt.
- `<kept count>`: the number of the signed-in dreamer's entries still kept on the device afterwards. It includes their rejected entries that are still on the device, meaning ones not yet moved to the form with `Edit as new entry` or removed with `Discard`.
- `<email>`: the enrolment email.
- `<coach email>`: the signed-in coach's email.

**Open work survives refreshes (DP-64).** The following never disturb open work:
- the Tonight panel's timed refresh, its refresh on reconnect and its refresh after a save;
- a sync;
- a memo upload;
- the roster refresh.

None of them ever:
- closes an open dialog or the phone sheet;
- returns the drill to an earlier step;
- moves focus;
- clears or changes a value being typed anywhere in `form "New entry"` or `dialog "Night settings"`;
- clears a text selection inside an entry;
- rewrites a live region whose result did not change. The one exception is a sync attempt, which is always announced as described under Offline in Interactions.

The drill dialog keeps its step and the target category it opened with until it closes. A target that changes on the server while the dialog is open applies the next time the dialog opens.

**Live roster (DP-66).**
- While the coach screen is visible, the selected cohort's roster refreshes every 30 seconds. It pauses while the page is hidden and refreshes once when the page becomes visible again.
- Changed values update inside the existing rows or cards. A newly shared entry's `Read shared entry <title>` button appears, an unshared one disappears, and counts change.
- Rows and cards are never rebuilt during a refresh:
  - focus stays on the same control, matched by its accessible name;
  - an open `Refund seat` or `Shared entry` dialog stays open;
  - the scroll position of the page and of the roster view holds.
- The refresh itself is never announced.
- If the entry in an open `Shared entry` dialog stops being shared, by unsharing or by a refund, the next refresh:
  - closes the dialog;
  - moves focus to that dreamer's `rowheader` (table) or card heading (phone);
  - announces the withdrawn copy above.

**Screen state (DP-65).**
- The coach's selected cohort is the `cohort` value in the address, as in `/coach?cohort=<cohort id>`.
- Choosing a cohort adds a browser history entry. Back and Forward restore the earlier selection, its header and its roster without a full page reload. A reload keeps the selection.
- Creating a cohort selects it and adds its address to history.
- `/coach` with no `cohort` value selects the coach's earliest cohort by `starts_on` (ties by name) and replaces the address without adding history.
- A `cohort` value that is not one of this coach's cohorts (unknown, malformed or another coach's) does the same, and also shows the unavailable-cohort copy above.

## Backend

### API (DP-01, DP-02, DP-05, DP-09, DP-11, DP-14, DP-17, DP-19, DP-25, DP-26, DP-27, DP-28, DP-30, DP-31, DP-39, DP-42, DP-43, DP-44, DP-45, DP-46, DP-47, DP-50, DP-52, DP-62, DP-63, DP-67, DP-72, DP-73, DP-74, DP-76, DP-77, DP-78, DP-79, DP-80)

**Conventions.**
- All request and response bodies are JSON (`application/json; charset=utf-8`), except memo bodies.
- Ids are lowercase UUID strings.
- Dates are `YYYY-MM-DD`.
- Times of day are 24-hour `HH:MM` in the dreamer's home time zone.
- **Instants** (`created_at`) are always returned as UTC in the form `YYYY-MM-DDTHH:MM:SSZ`, with no fractional seconds and no other offset. For example, `2026-10-31T09:40:12Z`.
- **Money** is integer cents in `price_cents`. Screens show it in dollars as described under Placeholders.
- Unknown request fields are ignored.
- Sessions travel in an HttpOnly, SameSite=Lax cookie named `lf_session`. It lasts until sign-out or until a refund ends it.

**Field validation.**
- **Types are strict.** A number sent as a string (`"3"`), a fraction where a whole number is required, or a boolean sent as a string (`"true"`) fails that field. The field gets its 422 message. Boolean fields without a message of their own (`lucid`, `wbtb`, `shared`) use `Use true or false.`
- **Lengths** of names, titles and text count Unicode code points. Sign offsets are the one exception: they count UTF-16 code units (Dream signs in Business rules).
- **No trimming.** Values are stored exactly as sent. A name or text made only of spaces fails its field.
- **Names.** An applicant `name` or cohort `name` containing any Unicode control character fails its field with its usual message. Control characters are general category Cc, which includes CR, LF, tab and U+0085. The line separator U+2028 and paragraph separator U+2029 fail the same way. This is checked on the value exactly as sent.
- **All fields at once.** Every failing field is reported in the same 422, each with its one message.

**Error shape.** Every error body is `{"error":"<code>"}`, plus the extra fields named below. Validation errors are 422 `{"errors":{"<field>":"<message>"}}`.

**Error precedence ladder.** This one rule covers the whole API. When a request breaks several rules, the earliest rung decides the answer:

1. 403 `{"error":"cross_origin"}`: a state-changing request that fails the same-origin rule in Server boundary.
2. 413 `{"error":"payload_too_large"}`: a JSON body over 64,000 bytes, or a memo body over 5,000,000 bytes. Exactly 64,000 and exactly 5,000,000 are allowed.
3. 415 `{"error":"unsupported_media_type"}`: a JSON endpoint given a body whose type is not `application/json` (parameters are ignored), or a memo upload with a type outside its list.
4. 400 `{"error":"invalid_json"}`: a JSON endpoint whose body is not a JSON object.
5. 401 `{"error":"unauthenticated"}`: a session is required and is missing, unknown or ended.
6. 403 `{"error":"forbidden"}`: the session's role does not match the endpoint family. `/api/me/*` is for dreamers and `/api/coach/*` is for coaches.
7. 404 `{"error":"not_found"}`: the path id is unknown, is not a UUID, belongs to another dreamer or another coach, or names a state that is never public, such as a draft cohort on a public endpoint.
8. The endpoint's own check order. Business rules gives one for enrolment creation, pay, entry save, memo upload, sign tagging, cohort creation, digest and refund. Each lists its replays, 409 state conflicts and 422 validation in the order they apply. Every other endpoint answers a replay with its stored response, then 409 state conflicts, then 422 validation.
9. Provider outcomes: the 402 decline from Kill Bill, and the 503 outage responses from Kill Bill, MinIO and mail. They are reached only when every rung above passes, so a request that fails an earlier rung never contacts a provider.

GET requests skip rungs 1 to 4. Endpoints marked "(no body)" ignore any body and skip rungs 2 to 4. A request to a JSON endpoint that carries no body (no `Transfer-Encoding` and no `Content-Length` above 0) also skips rungs 2 to 4 and is read as the empty object `{}`.

For example:
- a cross-site oversized POST gets 403 `cross_origin`;
- an entry PUT with no session and a `text/plain` body gets 415;
- a coach session asking for `/api/me/night` gets 403 `forbidden`;
- Wren asking for Tidewatch's roster gets 404.

Endpoint entries below list only their own extra errors.

**Shared objects.**
- **Cohort `C`** has exactly these keys: `id`, `name`, `coach_name`, `starts_on`, `phase` (`draft`, `enrolling`, `baseline`, `technique` or `closed`), `week` (1 to 4 in the baseline and technique phases, otherwise null), `price_cents`, `seats`, `seats_left`.
- **Enrolment `E`** has exactly these keys: `id`, `cohort_id`, `cohort_name`, `name`, `email`, `status` (`pending_payment`, `active` or `refunded`), `price_cents`, `home_tz`, `bedtime`, `wake_alarm`, `first_night` (null until active), `receipt_status` (`none`, `pending` or `sent`).
- **Entry `N`** has exactly these keys: `id`, `night_key`, `night_number`, `title`, `text`, `dreams_recalled`, `lucid`, `wbtb`, `technique` (`none`, `mild` or `ssild`), `technique_minutes`, `late_recall`, `shared`, `created_at`, `memo` (null or `{"content_type","size_bytes","duration_ms"}`), `signs` (a list of `S`).
- **Sign `S`** has exactly these keys: `id`, `entry_id`, `start`, `end`, `phrase`, `category` (`inner_awareness`, `action`, `form` or `context`), `night_key`.
- **Tallies `T`**: `{"inner_awareness":n,"action":n,"form":n,"context":n}`.
- **Roster row `R`** has exactly these keys: `enrollment_id`, `display_name`, `status`, `night_number`, `nights_logged`, `recall_rate`, `technique_minutes`, `wbtb_nights`, `reality_checks`, `sign_tallies` (a `T`), `shared_entries`.
  - `shared_entries` is a list of `{"entry_id","night_key","title","text","has_memo"}`, holding only entries that are shared while the dreamer is active. A refunded row's list is always `[]`.
  - `display_name` is the enrolment's `name` exactly as entered, for example `Mara Quist`.
  - No other key appears in any coach response: no email, no dream title or text of an unshared entry, no memo key or URL.
- **Session `P`** has exactly these keys: `role` (`dreamer` or `coach`), `name`, and `id` (the dreamer's enrolment id or the coach's id).

**Public endpoints.**

- `GET /api/health` → 200 `{"status":"ok"}`.
- `GET /api/time-zones` → 200 `{"zones":["<zone>", ...]}`. This lists every accepted home time zone (Business rules), sorted by plain character order.
- `GET /api/cohorts` → 200 `{"cohorts":[C]}`, listing cohorts in the enrolling or baseline phase, ordered by `starts_on`.
- `GET /api/cohorts/{id}` → 200 `{"cohort":C}` for any published cohort. A draft cohort answers 404, never 410.
- `POST /api/enrollments` with `{"cohort_id","name","email","home_tz","bedtime"}` → 201 `{"enrollment":E,"access_code":"<access code>"}`.
  - The status is `pending_payment`.
  - The access code is returned only in this response. It is an unguessable string of at least 12 characters.
  - 404 when `cohort_id` is unknown, not a UUID, or a draft cohort.
  - 409 `{"error":"enrollment_closed"}` when the cohort is in its technique or closed phase.
  - 409 `{"error":"already_enrolled"}` when the same email (compared case-insensitively) already has a pending or active enrolment in that cohort. A refunded enrolment does not count.
  - 422 messages:
    - `name`: `Tell us your name in 1 to 80 characters.`
    - `email`: `Use an email address like name@example.com.`
    - `home_tz`: `Choose a time zone from the list.`
    - `bedtime`: `Choose a bedtime between 20:00 and 23:59.`
- `GET /api/enrollments/{id}` → 200 `{"enrollment":E}`.
- `POST /api/enrollments/{id}/pay` (no body) → 200 `{"enrollment":E}` with the status `active`.
  - An enrolment that is already active returns 200 with the unchanged enrolment.
  - 402 `{"error":"payment_declined"}`.
  - 409 `{"error":"cohort_full"}`.
  - 409 `enrollment_closed`.
  - 409 `{"error":"illegal_transition","from":"refunded","to":"active"}` for a refunded enrolment.
  - The Kill Bill outage response (Services).

**Session endpoints.**

- `POST /api/session` with `{"access_code"}` → 200 `P`, and sets the session cookie.
  - 401 `{"error":"invalid_code"}`.
  - 403 `{"error":"enrollment_not_active","status":"pending_payment"|"refunded"}` for the code of a pending or refunded enrolment.
- `GET /api/session` → 200 `P`.
- `DELETE /api/session` (no body) → 204.
- `GET /api/landing?next=<value>` → 200 `{"landing":"<path>"}`, the signed-in caller's landing for that `next` (Business rules, Sign-in landing).

**Dreamer endpoints** (`/api/me/*`).

- `GET /api/me/night` → 200 `{"night_key","night_number","first_night","capture_window":"open"|"closed","bedtime","wake_alarm","home_tz","technique_unlocked","cohort_phase"}`.
  - The values are the server's at the moment of the request, using the night-key rule in Business rules.
- `PATCH /api/me/settings` with `{"home_tz"?,"bedtime"?}` → 200 `{"home_tz","bedtime","wake_alarm","night_key","night_number","night_held"}`.
  - `night_key` and `night_number` are the published values after the change.
  - `night_held` is defined in Business rules.
  - 422 with the enrolment messages.
- `GET /api/me/entries` → 200 `{"entries":[N]}`, newest night first and, within a night, newest first.
- `PUT /api/me/entries/{entry id}` with `{"title","text","dreams_recalled","lucid","wbtb","technique","technique_minutes"}` → 201 `{"entry":N}` when the entry is created.
  - A replay with an identical body returns 200 with the stored entry.
  - 404 when the id is stored for another dreamer. Nothing is stored and that dreamer's entry is unchanged.
  - 409 `{"error":"entry_id_conflict"}` when the id exists for this dreamer with a different body.
  - 409 `{"error":"cohort_not_started"}` before the dreamer's night 1.
  - 409 `{"error":"cohort_closed"}` after night 28 or once the cohort is closed.
  - 422 messages:
    - `id`: `Use the entry id created on this device.` (the path id is not a UUID; this endpoint answers 422 here instead of 404)
    - `title`: `Keep the title to 120 characters or fewer.` (a string; empty is allowed)
    - `text`: `Write at least one word.` (empty or whitespace only)
    - `text`: `Keep the dream text to 20,000 characters or fewer.` (20,000 is allowed)
    - `dreams_recalled`: `Use a whole number from 0 to 20.`
    - `technique`: `Choose none, mild or ssild.`
    - `technique_minutes`: `Use a whole number of minutes from 0 to 180.`
    - `technique`: `Technique practice unlocks on night 8.` (the DP-42 rule in Business rules)
- `PUT /api/me/entries/{entry id}/share` with `{"shared":true|false}` → 200 `{"entry":N}`.
- `PUT /api/me/entries/{entry id}/memo` uploads a voice memo.
  - **Request:**
    - The body is the raw audio bytes.
    - `Content-Type` is one of `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg` or `audio/wav`. Parameters such as `;codecs=opus` are allowed and stored exactly as sent.
    - The `X-Memo-Duration-Ms` header is a whole number from 1 to 600000.
  - **Success:** 201 `{"memo":{"content_type","size_bytes","duration_ms"}}`.
    - Re-sending identical bytes with the same type and duration returns 200 with the same body.
  - **Errors:**
    - 404 for an unknown entry or another dreamer's entry.
    - 409 `{"error":"memo_exists"}` when a different memo is already stored or claimed for the entry.
    - 422 messages:
      - `duration_ms`: `Send the recording length in milliseconds.` (missing or invalid duration)
      - `memo`: `The recording is empty.` (0 bytes)
      - `memo`: `The recording doesn't match its audio type.` (signature mismatch)
    - The MinIO outage response (Services).
  - **Signature check.** The body's leading bytes must match the declared type.
    - The type is compared case-insensitively and without its parameters.
    - A body too short to hold the signature does not match.
    - Byte values below are hexadecimal:

    | Declared type | Required leading bytes |
    |---|---|
    | `audio/webm` | `1A 45 DF A3` at offset 0 |
    | `audio/ogg` | the ASCII `OggS` at offset 0 |
    | `audio/mp4` | the ASCII `ftyp` at offsets 4 to 7 |
    | `audio/mpeg` | the ASCII `ID3` at offset 0, or byte 0 equal to `FF` with the top three bits of byte 1 all set |
    | `audio/wav` | the ASCII `RIFF` at offset 0 and `WAVE` at offset 8 |

- `GET /api/me/entries/{entry id}/memo` → the stored memo.
  - **Every successful response** carries:
    - `Accept-Ranges: bytes`;
    - `Content-Type` equal to the stored type;
    - `X-Memo-Duration-Ms` equal to the stored duration.
  - **No `Range` header:** 200 with all stored bytes and `Content-Length` equal to the stored size.
  - **Answered in full with 200:** a `Range` header that is malformed or asks for more than one range gets the same 200 response. Malformed means any of these:
    - a unit other than `bytes`;
    - a non-numeric part;
    - `bytes=<a>-<b>` with `b` below `a`.
  - **A single range** gets 206 with exactly the stored bytes of that slice, `Content-Length` equal to the slice length and `Content-Range: bytes <first>-<last>/<size>`. The forms are:
    - `bytes=<a>-<b>`: from `a` through `b`, where a `b` beyond the end is clamped to size − 1. `bytes=0-0` is exactly 1 byte.
    - `bytes=<a>-`: from `a` to the end.
    - `bytes=-<n>`: the last `n` bytes, or all of them when `n` is at least the size.
  - **An unsatisfiable range** (a start at or beyond the size, or `bytes=-0`) gets 416 `{"error":"range_not_satisfiable"}` with `Content-Range: bytes */<size>`.
  - **Errors:** 404 when the entry has no memo, and the MinIO outage response.
- `POST /api/me/entries/{entry id}/signs` with `{"start","end","category"}` → 201 `{"sign":S,"tallies":T}`.
  - A replay of the same entry, range and category returns 200 with the stored sign and the current tallies.
  - 409 `{"error":"sign_conflict"}` when the identical range already carries another category.
  - 409 `{"error":"sign_overlap","sign_id":"<stored sign id>"}` when the range overlaps a stored sign of the entry without being identical to it. `<stored sign id>` is the id of the overlapping stored sign that was created first.
  - 422 messages:
    - `range`: `Select between 1 and 200 characters of this entry.`
    - `category`: `Choose inner awareness, action, form or context.`
- `GET /api/me/dreamscape` → 200 `{"constellations":[{"category","stars","tagged_nights","halo_px"}],"target_category":"<category>"|null}`. Constellations come in the order inner_awareness, action, form, context.
- `POST /api/me/reality-checks` with `{"id","category"}` → 201 `{"reality_check":{"id","category","night_key"},"night_count":n}`.
  - Replaying the same id and body returns 200 with the stored response.
  - 404 when the id is stored for another dreamer. Nothing is stored.
  - 409 `{"error":"reality_check_id_conflict"}` when the body differs.
  - 422 messages:
    - `id`: `Use the check id created on this device.`
    - `category`: the sign category message.

**Coach endpoints** (`/api/coach/*`).

- `GET /api/coach/cohorts` → 200 `{"cohorts":[C]}`. This lists this coach's cohorts, drafts included, ordered by `starts_on`, then name.
- `POST /api/coach/cohorts` with `{"name","starts_on","price_cents","seats"}` → 201 `{"cohort":C}` in the `draft` phase.
  - 409 `{"error":"cohort_name_taken"}`.
  - 422 messages:
    - `name`: `Name the cohort in 1 to 80 characters.`
    - `starts_on`: `Use a date like 2026-11-02.`
    - `price_cents`: `Use a price from $1.00 to $1,000.00.` (a whole number from 100 to 100000)
    - `seats`: `Use 1 to 50 seats.` (a whole number)
- `POST /api/coach/cohorts/{id}/publish` and `POST /api/coach/cohorts/{id}/close` (no body) → 200 `{"cohort":C}`.
  - 409 `{"error":"illegal_transition","from":"<phase>","to":"<target phase>"}`.
- `GET /api/coach/cohorts/{id}/roster` → 200 `{"cohort":C,"dreamers":[R]}`, listing active and refunded enrolments ordered by display name.
- `GET /api/coach/cohorts/{id}/shared/{entry id}/memo` → the same responses as the dreamer's memo fetch, ranges included.
  - 404 unless that entry belongs to this cohort, is shared, and its dreamer is active.
- `POST /api/coach/cohorts/{id}/digest` (no body) → 200 `{"digest":{"week":w,"to":"<coach email>","dreamers":n,"replayed":false|true}}`.
  - `dreamers` is the number of active dreamers listed in the message.
  - 409 `{"error":"cohort_not_running"}` outside the baseline and technique phases.
  - The mail outage response.
- `POST /api/coach/enrollments/{id}/refund` (no body) → 200 `{"dreamer":R}` with the status `refunded`.
  - 409 `{"error":"refund_window_closed"}` in the technique or closed phase.
  - 409 `{"error":"illegal_transition","from":"<status>","to":"refunded"}` for a pending or refunded enrolment.
  - 409 `{"error":"not_refundable"}` for a comped seat.
  - The Kill Bill outage response.

### Business rules (DP-02, DP-03, DP-04, DP-05, DP-10, DP-12, DP-13, DP-14, DP-17, DP-18, DP-19, DP-31, DP-37, DP-39, DP-40, DP-41, DP-42, DP-44, DP-48, DP-52, DP-53, DP-61, DP-62, DP-63, DP-67, DP-68, DP-69, DP-71, DP-72, DP-73, DP-74, DP-75, DP-76, DP-77, DP-78, DP-81)

Every check order below starts after rungs 1 to 7 of the precedence ladder. The first rule that matches decides the answer.

**Transition table (DP-81).** These are every legal state change. "System" means the server decides it from its own clock or from a provider's answer. No request can ask for a system edge directly.

| Machine | From → to | Made by |
|---|---|---|
| Cohort | `draft` → its date-derived phase | coach: publish |
| Cohort | `enrolling` → `baseline` → `technique` → `closed` | system: the server date (Cohort phase) |
| Cohort | `technique` → `closed` | coach: close |
| Enrolment | `pending_payment` → `active` | system: a `SUCCESS` PURCHASE in Kill Bill, reached through pay |
| Enrolment | `active` → `refunded` | coach: refund in the enrolling or baseline phase, with a `SUCCESS` REFUND |
| Session | `active` → `ended` | the dreamer or coach signing out, or a refund of that dreamer |
| Memo slot of an entry | `empty` → `claimed` → `stored`; `claimed` → `empty` when the MinIO write fails | system: memo upload |
| Night | `open` → `capture_window_closed` | system: 14:00 home time (Capture window) |
| Digest of a cohort week | `unsent` → `sent` | coach: the first accepted digest send |

- A publish of a cohort that is not a draft, and a close of a cohort that is not in its technique phase, get the illegal-transition response and change nothing. For example, closing a baseline cohort is refused, because only the server date ends a baseline.
- A draft cohort is never public. Every public endpoint and the Enrol screen treat it as not found (404), never as gone.

**Cohort phase.** The server decides the phase from its own clock and the coach's time zone. `today` is the server's current date in that zone.

| Phase | When |
|---|---|
| `draft` | until the cohort is published |
| `enrolling` | published, and `today` is before `starts_on` |
| `baseline` | `starts_on` through `starts_on` + 6 days (7 nights) |
| `technique` | `starts_on` + 7 through `starts_on` + 27 days (21 nights) |
| `closed` | `starts_on` + 28 onward, or after the coach closes it |

- `week` is the number of whole days since `starts_on`, divided by 7 and rounded down, plus 1.
- Publish accepts a start date in the past, for cohorts moved over from a spreadsheet.
- An illegal-transition response names the current phase and the requested target: `enrolling` for publish, `closed` for close.

**Enrolment state.**
- New enrolments and payments are accepted only in the enrolling and baseline phases.
- A refunded email may enrol in the same cohort again. This creates a new enrolment with a new id and a new access code.

**Seats left.**
- `seats_left` is `seats` minus the active enrolments at the moment of the request. Pending and refunded enrolments hold no seat.
- One count is used everywhere: the pay seat check, `GET /api/cohorts`, `GET /api/cohorts/{id}`, `GET /api/coach/cohorts`, the roster `cohort` and the Cohorts card.
- A successful refund frees its seat in the same moment the enrolment becomes refunded.
- For example, with the seed data at start: once one applicant pays for Harvest Moon it is full. Refunding that applicant brings every surface back to one free seat, and a second applicant can then pay.

**Enrolment check order.**
1. A cohort in its technique or closed phase gives `enrollment_closed`.
2. An email that already has a pending or active enrolment in that cohort gives `already_enrolled`.
3. Only then are the fields validated. Any field error gives the 422.

For example, with the seed data at start, `mara@dreamers.example` enrolling again in Autumn Lantern (technique) gets `enrollment_closed`, and `elodie@dreamers.example` enrolling again in Harvest Moon (baseline) gets `already_enrolled`.

**Pay check order.**
1. An active enrolment returns 200 with the unchanged enrolment and does not contact Kill Bill, so this holds even while Kill Bill is unreachable.
2. A refunded enrolment gets the illegal-transition response.
3. A cohort in its technique or closed phase gives `enrollment_closed`.
4. No free seat gives `cohort_full`.
5. Only then is Kill Bill contacted, as described in Paying. An unreachable Kill Bill gives the billing outage response. A PURCHASE that does not succeed gives `payment_declined`.

Because the same-origin rule is rung 1:
- an active enrolment paid with `Origin: https://evil.example` gets 403 `cross_origin`, not the 200 replay;
- a refunded enrolment paid while Kill Bill is unreachable gets 409 `illegal_transition`, not 503.

**Paying.**
1. **Seat check.** The phase check, the free-seat check and taking the seat happen as one step per cohort, held until Kill Bill answers. When several applicants pay for the last seat at once, exactly one wins. Every other payer gets `cohort_full`, and no PURCHASE is attempted for them.
2. **Account.** The server first looks up the Kill Bill account whose external key is the enrolment id.
   - If it exists, it is reused, whoever created it: an earlier attempt that crashed, another server process, or the coach by hand.
   - A second account for the enrolment is never created.
   - If the account has no default payment method, the external payment method is added to it.
3. **Payment.** The server then looks up the payment whose external key is the enrolment id.
   - If it holds a PURCHASE with status `SUCCESS`, the enrolment activates without a new PURCHASE.
   - If it holds only PURCHASE transactions with another status, a new PURCHASE is attempted on that same payment.
   - If there is no payment, the server makes the PURCHASE described in Services.
4. **Activation.** The enrolment becomes active only when Kill Bill holds a PURCHASE with transaction status `SUCCESS`. Any other status gives `payment_declined` and leaves the enrolment pending.
5. **First night.** Activation sets `first_night` to the later of `starts_on` and the dreamer's night key at the moment of activation.
6. **Repeats.** Repeated or simultaneous pays for one enrolment record at most one Kill Bill account, one `SUCCESS` PURCHASE and one receipt. One request activates the enrolment. The others answer as replays of the active enrolment or get `cohort_full`, and never a 5xx.

**Sign-in landing (DP-71).** `GET /api/landing` and the sign-in screen honour `next` only when every one of these holds for the decoded value:
- it starts with exactly one `/`, and its second character is neither `/` nor `\`;
- it contains no `\` anywhere and no `:` before any `?`;
- its path part (everything before the first `?` or `#`) is exactly `/logbook` for a dreamer, or exactly `/coach` for a coach.

When `next` is honoured:
- a dreamer lands on `/logbook`;
- a coach lands on `/coach` followed by `next`'s query string verbatim, so `/coach?cohort=<id>` opens that cohort.

Otherwise the dreamer lands on `/logbook` and the coach on `/coach`. Rejected examples include:
- `//evil.example`
- `/\evil.example`
- `https://evil.example/logbook`
- `/logbook/`
- `/logbookx`
- `/logbook/../coach`
- `/coach?cohort=x` for a dreamer

**Accepted time zones.**
- A home time zone is accepted when it is one of:
  - an IANA zone name the server's runtime knows whose first part is `Africa`, `America`, `Antarctica`, `Arctic`, `Asia`, `Atlantic`, `Australia`, `Europe`, `Indian` or `Pacific`, links such as `Asia/Calcutta` included (other names, such as `US/Pacific`, `Etc/UTC` or `Etc/GMT`, are not accepted);
  - `UTC`;
  - one of the 26 `Etc/GMT` offset zones from `Etc/GMT-14` through `Etc/GMT+12`.
- The sign of an `Etc/GMT` zone is inverted: `Etc/GMT+10` is ten hours behind UTC.
- Zones with 30- and 45-minute offsets, such as `Asia/Kathmandu`, `Australia/Eucla` and `America/St_Johns`, are accepted and used with their real offsets.

**Night key.** The server decides the night key from its own clock, never the device's.
- The **derived key** comes from the dreamer's current home time zone and bedtime, and the server time at which the request arrives:
  - at or after the bedtime (local time of day), it is the local date;
  - before the bedtime, it is the local date minus one day.

  For example, with a 23:00 bedtime, an entry received at 03:40 local time belongs to the previous evening's night.
- The **night key** is the later of the derived key and the night key of the dreamer's latest stored entry. It never moves earlier, even after a time-zone or bedtime change.

  For example: with a bedtime of 20:00, an entry made at 21:00 local time on day D is filed under D. After the dreamer switches to a zone 4 hours further west, it is 17:00 on D locally and the derived key is D − 1. The night endpoint, the next entry and the next reality check still use D.
- **`night_held`** in the settings response is true exactly when the derived key for the new settings is earlier than the night key published after the change.
- The same night key applies to new entries, new reality checks and the night endpoint. The night number and the capture window follow it.
- An entry's or check's night key and late-recall flag are stored when it is created and never change.

**Night number.**
- The night number is the night key minus the dreamer's `first_night`, in days, plus 1.
- Entries are accepted for night numbers 1 to 28 while the cohort is not closed.

**Capture window.**
- A night's morning capture window closes at 14:00 local time on the day after its night key, in the dreamer's current home time zone.
- An entry created after that is saved with `late_recall` true.
- The night endpoint's `capture_window` is `open` until the current night key's window closes, and `closed` after that.

**Wake alarm and settings.**
- `wake_alarm` is the bedtime plus 5 hours 00 minutes, wrapping past midnight. For example, 23:30 becomes 04:30.
- Bedtimes from 20:00 through 23:59 are allowed.

**Technique unlock.**
- `technique_unlocked` is true when the current night number is 8 or more.
- While an entry's night number is below 8, the DP-42 technique error rejects it if any of these holds:
  - `wbtb` is true;
  - `technique` is not `none`;
  - `technique_minutes` is above 0.

**Entry ownership and idempotency.**
- Each id belongs to the dreamer whose save first stored it.
- Another dreamer's save, share, memo or sign request for that id answers 404, stores nothing and leaves the owner's record unchanged. Reality-check ids follow the same rule.
- For the owner:
  - the device-made id is the key;
  - an identical body (all seven fields equal) returns 200 with the stored entry;
  - a different body returns `entry_id_conflict`.
- Simultaneous saves of one id store exactly one entry. One gets 201, and the others get 200 (identical body) or 409 (different body).
- Reality checks follow the same rules with their own id.

**Entry save check order.**
1. An identical replay of a stored id returns 200 with the stored entry.
2. A stored id with a different body gives `entry_id_conflict`, whatever the cohort's state.
3. A night number below 1 for the night key at receipt gives `cohort_not_started`.
4. A night number above 28, or a closed cohort, gives `cohort_closed`.
5. Only then are the fields validated, including the DP-42 technique rule. Any field error gives the 422.

**Memo slot and check order.** Each entry has one memo slot. Rungs 2 and 3 of the ladder have already applied the size and type limits. Then:
1. Identical bytes, type and duration already stored return 200.
2. A slot that is already stored or claimed with a different memo gives `memo_exists`.
3. A missing or invalid duration gives the duration 422.
4. An empty body gives the empty 422.
5. A signature mismatch gives the signature 422.
6. Only then is the slot claimed in Postgres, and only after the claim is MinIO contacted.

Nothing is written to MinIO on any rejection. When different memos for one entry are uploaded at once:
- exactly one claims the slot and gets 201;
- uploads identical to the winner answer 200 once the winner is stored;
- every other upload gets `memo_exists` and never writes to MinIO.

The stored object, its type and its duration are the winner's. A claim whose MinIO write fails gets the storage outage response and is released, so a later upload can succeed.

**Reality checks.**
- A reality check is stored under the night key at receipt.
- `night_count` is the number of the dreamer's reality checks whose night key equals that key.

**Dream signs and constellations.**
- **Offsets.**
  - `start` and `end` are offsets into the whole entry text, counted in UTF-16 code units, the way a browser counts string length. Existing marks do not reset the count.
  - `start` is inclusive and `end` is exclusive.
  - The stored `phrase` is the browser's `text.slice(start, end)`.
  - For example, in the entry text `🌙 My hands melted, then my hands melted again`, tagging `My hands melted` stores start 3 and end 18. Tagging the second `my hands melted` afterwards stores start 25 and end 40.
- **Overlap.** Two different ranges overlap when each starts before the other ends. Ranges that only touch, such as 0 to 5 and 5 to 9, do not overlap. An identical range is never treated as an overlap; steps 1 and 2 of the sign check order decide it.
- **Valid range.** The range is valid when `end` − `start` is from 1 to 200 inclusive, `end` does not exceed the text length, and the phrase contains a character that is not a space.
- **Sign check order:**
  1. The identical range and category already stored returns 200.
  2. The identical range with another category gives `sign_conflict`.
  3. A range overlapping a stored sign of the entry gives `sign_overlap`.
  4. Only then are the range and category validated. An invalid one gives the 422.
- **No overlaps.** No two stored signs of one entry ever overlap. When tag requests with overlapping or identical ranges on one entry arrive at the same time, exactly one gets 201. Each other one gets the answer the sign check order gives against the winner:
  - 200 for the winner's identical range and category;
  - `sign_conflict` for the winner's identical range with another category;
  - `sign_overlap` naming the winner's id for any other overlapping range.
- **Derived values:**
  - `stars` is the number of stored signs in the category.
  - `tagged_nights` is the number of distinct night keys among those signs.
  - `halo_px` is 12 plus 36 × min(`tagged_nights`, 28) ÷ 28, rounded to the nearest whole number with halves rounding up. It runs from 12 at 0 nights to 48 at 28 nights or more.
  - `target_category` is the category with the most stars. Ties go to the earlier category in the order inner awareness, action, form, context. It is null when there are no signs.
- The returned tallies, the dreamscape, the legend, the roster `sign_tallies` and the digest all count the same stored signs.

**Roster aggregates.** The roster counts only entries with night numbers 1 to 28, by their stored night keys.
- `nights_elapsed` is used only for the recall rate. It is the dreamer's current night number capped at 28, or 0 before night 1.
- `nights_logged` is the number of distinct night keys with at least one entry.
- `recall_rate` is the number of distinct night keys with an entry whose `dreams_recalled` is 1 or more, divided by `nights_elapsed`.
  - It is rounded to two decimals with halves rounding up, and is 0 when `nights_elapsed` is 0.
  - For example, 1 recalled night out of 8 elapsed is 0.125, which becomes 0.13 (shown as `13%`). 3 out of 8 is 0.375, which becomes 0.38.
- `technique_minutes` is the sum over entries.
- `wbtb_nights` is the number of distinct night keys with an entry whose `wbtb` is true.
- `reality_checks` is the dreamer's total count.
- `night_number` is the current night number, or 0 before night 1.

**Cohort names.**
- A coach's cohort names are unique, compared after Unicode lower-casing, so `autumn lantern` clashes with `Autumn Lantern`.
- **Cohort creation check order:**
  1. A name that clashes with one of this coach's cohorts gives `cohort_name_taken`. This is decided before any field is validated, so `{"name":"autumn lantern","seats":0}` from Wren gets the 409.
  2. Only then are the fields validated.
- Simultaneous creates of one name store exactly one cohort. Every other request gets `cohort_name_taken`.

**Digest.**
- A digest belongs to its cohort week: the cohort plus its `week`, from the server date in the coach's time zone.
- **Check order:**
  1. A cohort outside the baseline and technique phases gives `cohort_not_running`.
  2. A digest already stored for this cohort week returns 200 with its stored `week`, `to` and `dreamers` and `"replayed":true`, and sends nothing.
  3. Only then is mail contacted.
- The first send that mail accepts stores its `week`, `to` and `dreamers` and answers `"replayed":false`. A send that fails with `mail_unavailable` stores nothing.
- Sends for one cohort week at the same moment produce exactly one message. One answers `"replayed":false`, and the others wait and answer as replays. If the first fails with `mail_unavailable`, the next waiting send tries again.

**Refund check order.**
1. A pending or refunded enrolment gets the illegal-transition response.
2. A cohort in its technique or closed phase gives `refund_window_closed`.
3. A comped seat gives `not_refundable`. A seat is comped when the app never charged it through Kill Bill, which the app knows from its own records without contacting Kill Bill.
4. Only then is Kill Bill contacted. An unreachable Kill Bill gives the billing outage response.

For example, with the seed data at start, refunding Mara Quist (Autumn Lantern, technique) gives `refund_window_closed`. Refunding Elodie Vance (Harvest Moon, baseline) gives `not_refundable`, even while Kill Bill is unreachable.

**Refunds.**
- A refund is allowed only for an active, paid enrolment while the cohort is enrolling or in its baseline phase.
- Before making a REFUND, the server looks on the enrolment's payment for a `SUCCESS` REFUND with the transaction external key `<enrollment id>-refund`. If one exists, the enrolment moves to refunded without a second REFUND. Otherwise the server makes the REFUND described in Services.
- Only a `SUCCESS` refund moves the enrolment to `refunded` and frees its seat. A rejected refund changes nothing.
- When one enrolment is refunded several times at once, exactly one request gets 200. The others get the illegal-transition response from `refunded`, and Kill Bill holds exactly one REFUND.
- **A refund ends access at once (DP-78).** In the same moment the enrolment becomes refunded:
  - every existing session of that dreamer ends, so each later request with those sessions answers 401 `unauthenticated`;
  - their code answers sign-in with the refunded 403;
  - their entries leave every coach surface: `shared_entries` becomes `[]` and the coach's shared-memo fetch answers 404;
  - their stored entries stay private to them.

### Services (DP-03, DP-06, DP-08, DP-25, DP-29, DP-50, DP-51, DP-52, DP-53, DP-61, DP-67, DP-68, DP-70, DP-74, DP-77)

**Postgres** (`DATABASE_URL`)
- The system of record for coaches, cohorts, enrolments, sessions, entries, signs, reality checks, shares, memo slot claims, stored digests and idempotency keys.
- The schema and the seed are applied idempotently every time the server starts serving.

**Kill Bill** (`KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`)
- **Account.** There is one account per enrolment:
  - `externalKey` is the enrolment id;
  - it carries the applicant's name and email;
  - its currency is `USD`;
  - its default payment method uses the `__EXTERNAL_PAYMENT__` plugin.

  Accounts are reused as described in Paying.
- **Purchase.** The seat is one PURCHASE on that account:
  - the amount is the cohort price in dollars (`price_cents` / 100), in `USD`;
  - `paymentExternalKey` is the enrolment id;
  - `transactionExternalKey` is `<enrollment id>-purchase`.
- **Refund.** A refund is one REFUND on that payment for the full amount, with `transactionExternalKey` set to `<enrollment id>-refund`.
- **Cross-site requests.** A pay request refused by the same-origin rule creates nothing in Kill Bill: no account with that external key exists afterwards, and the enrolment stays `pending_payment`.
- **Unreachable.** Kill Bill counts as unreachable when it refuses the connection, answers with a 5xx, or does not answer within 10 seconds. Every endpoint that needs it then returns 503 `{"error":"billing_unavailable"}` and changes nothing in the app.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`)
- **Storage.** Each memo is one object at the key `memos/<enrollment id>/<entry id>`:
  - its body is exactly the uploaded bytes;
  - its `Content-Type` is exactly the submitted type, parameters included;
  - its duration is stored as the user metadata `duration-ms`.
- **No processing.** Nothing is transcoded, trimmed or normalised.
- **One object per entry.** A losing upload in a memo race never writes to MinIO, so `memos/<enrollment id>/` holds at most one key per entry.
- **Privacy.** Objects are never public. The browser never receives an object key or a presigned URL. Memos are fetched only through the app's memo endpoints.
- **Unreachable.** When MinIO is unreachable, memo upload and fetch return 503 `{"error":"memo_storage_unavailable"}`. Entries without memos are unaffected.

**Mail** (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; messages are visible in Mailpit at `MAILPIT_URL`)
- Plain SMTP without authentication.
- **Every message:**
  - its From is the `MAIL_FROM` value, which is `Saltmoon Practice <hello@saltmoon.example>`;
  - it has exactly one recipient, in `To`, given as a bare address with no display name, and no Cc or Bcc;
  - non-ASCII subjects are encoded so that Mailpit decodes them to exactly the published subject.
- **Receipt.** Exactly one receipt goes to the applicant's email after the enrolment becomes active, and never before.
  - The subject is `Your Lanternfish seat in <cohort name> is confirmed`.
  - The plain-text body has these lines and nothing else:
    - `Cohort: <cohort name>`
    - `First night: <first night>`
    - `Bedtime: <bedtime>`
    - `Wake alarm: <wake alarm>`
    - `Amount paid: $<amount paid>`
    - `Enrollment: <enrollment id>`
    - `Access code: <access code>`
  - `<amount paid>` is the amount of the `SUCCESS` PURCHASE that Kill Bill holds, in dollars with two decimals.
  - If mail is unreachable when the payment confirms:
    - the enrolment is still active;
    - `receipt_status` is `pending`;
    - the server retries every 30 seconds while it runs;
    - `receipt_status` becomes `sent` once the message is accepted.
- **Weekly digest.** One message per cohort week goes to the coach's email.
  - The subject is `Lanternfish digest: <cohort name>, week <week>`. For example, a cohort named `Lune d'été – Équinoxe` in week 1 has the subject `Lanternfish digest: Lune d'été – Équinoxe, week 1`.
  - The plain-text body has one line per active dreamer, in the roster's display-name order, and nothing else besides the final line: `<display name>: recall <recall percent>%, technique <technique minutes> min, WBTB nights <wbtb nights>, reality checks <reality checks>, signs inner awareness <a> / action <b> / form <c> / context <d>`.
  - A final line reads `Cohort signs: inner awareness <a> / action <b> / form <c> / context <d>`, where each count sums the listed active dreamers' signs only; refunded dreamers are not counted.
  - The values are the roster values at the moment of the first send.
  - It never contains a dream title, dream text, memo key or link, or any email address other than the recipient's.
  - When mail is unreachable, the digest endpoint returns 503 `{"error":"mail_unavailable"}` and nothing is sent.

### Seed data (DP-09, DP-15, DP-31, DP-46, DP-47, DP-53, DP-65, DP-68, DP-76)

Every seeded person, practice and email address is invented. The seed runs once into an empty database. `D(coach)` is the server's date in that coach's time zone when the seed runs. Seeded enrolments are active and comped, so Kill Bill holds nothing for them at start.

**Coaches**

| Name | Email | Time zone | Access code |
|---|---|---|---|
| Wren Aldana | `wren@saltmoon.example` | America/Denver | `coach-wren-4417` |
| Tobias Merrow | `tobias@saltmoon.example` | Europe/Lisbon | `coach-tobias-2290` |

**Cohorts**

| Name | Coach | starts_on | Published | Price | Seats |
|---|---|---|---|---|---|
| Autumn Lantern | Wren | D(Wren) − 10 days | yes (technique) | $240.00 | 12 |
| Harvest Moon | Wren | D(Wren) − 3 days | yes (baseline) | $240.00 | 3 |
| Winter Owl | Wren | D(Wren) + 14 days | yes (enrolling) | $180.00 | 20 |
| Spring Draft | Wren | D(Wren) + 40 days | no (draft) | $200.00 | 10 |
| Tidewatch | Tobias | D(Tobias) − 2 days | yes (baseline) | $200.00 | 8 |

**Dreamers** (all active and comped, with `first_night` equal to their cohort's `starts_on`)

| Name | Email | Cohort | Home time zone | Bedtime | Access code |
|---|---|---|---|---|---|
| Mara Quist | `mara@dreamers.example` | Autumn Lantern | America/Chicago | 23:00 | `dreamer-mara-3051` |
| Jun Ferreira | `jun@dreamers.example` | Autumn Lantern | Asia/Tokyo | 22:30 | `dreamer-jun-7720` |
| Elodie Vance | `elodie@dreamers.example` | Harvest Moon | Europe/Berlin | 23:30 | `dreamer-elodie-1186` |
| Sam Petrakis | `sam@dreamers.example` | Harvest Moon | America/New_York | 22:45 | `dreamer-sam-5502` |
| Ines Calloway | `ines@dreamers.example` | Tidewatch | Europe/Lisbon | 23:00 | `dreamer-ines-6634` |

**Mara's entries.** Each entry's night key is `starts_on` + night − 1. None is late recall and none has a memo.

| Night | Title | Text | Recalled | WBTB | Technique, minutes | Shared | Signs (phrase → category) |
|---|---|---|---|---|---|---|---|
| 2 | `Folding staircase` | `I was climbing a staircase that folded into the sea, and my teeth felt loose.` | 1 | no | none, 0 | no | `folded into the sea` → form; `my teeth felt loose` → form |
| 3 | `Grandmother's kitchen` | `My grandmother was cooking in a kitchen on the roof of my old school.` | 1 | no | none, 0 | no | `a kitchen on the roof of my old school` → context |
| 5 | `Flying lesson` | `I flew over the river with my arms out and felt completely calm.` | 2 | no | none, 0 | no | `I flew over the river` → action; `felt completely calm` → inner_awareness |
| 9 | `The blue door` | `A blue door kept changing size each time I reached for it.` | 1 | yes | mild, 20 | yes | `kept changing size` → form |
| 10 | `No recall` | `Woke at the alarm, nothing came back.` | 0 | yes | ssild, 15 | no | none |

For example, with the seed data at start:
- **Mara's dreamscape:**
  - form: 3 stars over 2 tagged nights (halo 15)
  - context: 1 star (halo 13)
  - action: 1 star (halo 13)
  - inner awareness: 1 star (halo 13)
  - target: `form`
- **Mara's roster row:** `display_name` `Mara Quist`, `technique_minutes` 35, `wbtb_nights` 2, `reality_checks` 0, `nights_logged` 5, and one shared entry, `The blue door`.
- **Other dreamers:** none of them has entries or reality checks.
- **Harvest Moon** has one free seat.
- **Wren's earliest cohort** is Autumn Lantern.

## Technical requirements

### Deployment (DP-58)

- **Runtime.** Node.js 22 with npm, and TypeScript.
- **Run manifest.** `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```

- **Listening.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set. It serves the browser app and the API from that one origin.
- **Health.** `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}` once the server is listening, including while Kill Bill, MinIO or mail are unreachable.

### Configuration and secrets (DP-60)

At start the server reads these variables:
- `DATABASE_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`
- `APP_PUBLIC_PORT`

None of these values is hard-coded in source, written into the browser bundle or returned by any response.

### Server boundary (DP-59, DP-70)

- **Same-origin writes.** The app's own origin is formed from the request's own scheme and its `Host` header. A state-changing request (POST, PUT, PATCH or DELETE) fails the same-origin rule when either of these holds:
  - it carries an `Origin` header that differs from the app's own origin. The literal `Origin: null` counts as different.
  - it carries no `Origin` header but carries `Sec-Fetch-Site: cross-site`.
- `Sec-Fetch-Site` values `same-origin`, `same-site` and `none`, or no fetch-metadata header at all, pass when there is no `Origin`. Failing requests get the rung-1 response of the precedence ladder.
- **No CORS.** No CORS headers are ever sent, and no `Origin` is ever echoed.
- **Sizes, content types and JSON** are checked in the ladder's order, with the limits stated there.
- **What is never served.** The server serves only the built browser assets, the screens named in Screens and layout, and the API.
  - Any other path returns 404 with the not-found page. This includes `/run.json`, `/package.json`, `/.env`, source files and `/node_modules/...`.
  - An unknown `/api/...` path returns 404 `not_found`.
- **Dependencies at boot.**
  - When Postgres is not reachable at boot, the server retries for up to 60 seconds before it starts listening.
  - Kill Bill, MinIO and mail are never needed to boot. Their absence shows only in their own endpoints, as Services describes.

### Browser support and performance (DP-54, DP-56)

- **Browsers.** Current Chromium, Firefox and WebKit, at the three published viewports, with touch input at the phone size.
- **Load time.** Every screen is usable within three seconds of navigation on the local network.
- **Night sky.**
  - The first frame is drawn within two seconds.
  - The fog drift keeps a steady frame rate and never delays typing in the journal.
- **Memo playback** starts within five seconds in all three browsers. An uploaded PCM WAV memo also seeks within five seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` keys and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its licence, and every bundled font with its licence. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package and bundled font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: No datastore beyond the provided Postgres and MinIO is used: no SQLite, Redis or on-disk JSON files for application state. The browser's own storage, used for entries kept on the device, is allowed.
- IF-05: The provided service configuration files for Postgres, Kill Bill, MinIO and Mailpit are left unchanged.
- IF-06: The application source is TypeScript compiled with `strict` enabled.
- IF-07: `/app/package-lock.json` is committed and `install` uses it.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript. No `any` escapes into domain code, and no type assertion is used to silence the compiler.
- Names in the code use this brief's domain terms: cohort, enrollment, night key, capture window, late recall, dream sign, constellation, reality check, memo slot, roster, digest, seats left, refund, landing.
- Each domain rule is decided in exactly one place in the source and reused everywhere else. This covers cohort phase, the transition table, seats left, night key and held night, capture window, halo radius, target category, roster aggregates, sign-in landing and the digest week. The browser only renders the values the server returns.
- Each integrity rule is enforced by the server in one place:
  - one entry per id and owner;
  - one sign per range, with no overlaps;
  - one memo per entry slot;
  - one PURCHASE and one REFUND per enrollment;
  - one cohort name per coach;
  - one digest per cohort week.
- No abstraction has a single implementation. There is no dead, commented-out or unreachable code.
- There are no defensive checks for states that the database constraints or the types already rule out.
- Every API error goes through one error shape and the one precedence ladder, as specified in API.
- No feature, endpoint, screen or setting exists beyond this brief.
