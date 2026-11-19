# Kettlehole Audio Earshot

Earshot is a portfolio and booking product for one freelance game sound designer and composer, sold under the Kettlehole Audio name. Audio directors walk through a scroll-driven 3D corridor of project "stations". At each station they hear a project's adaptive score build up layer by layer as a game-intensity value rises. At the end of the corridor they send a brief. The freelancer is the only operator. They publish projects with layered stems, share private listening links for work under NDA, triage enquiries, and send producers proposals with a 30/20/20/30 milestone split. When a producer accepts, the proposal claims a production month and Kill Bill creates a deposit invoice. The producer pays the deposit on their proposal page. Earshot uses four services:
- PostgreSQL stores every record.
- MinIO stores audio and brief attachments.
- Every email goes through an SMTP server, which Mailpit receives during grading.
- Kill Bill records accounts, invoices and payments.

Out of scope:
- accounts for directors or producers (the operator is the only person who signs in)
- real card processing
- any datastore other than PostgreSQL and MinIO
- teams with more than one operator
- any currency other than US dollars

## Problem and users

Freelance game audio people win work by being heard, but the usual portfolio tools can only play a flat stereo bounce of a mix. Audio directors hiring for interactive work want proof that a freelancer can build adaptive audio. That means layers that join as a game gets more intense, and each credit stated honestly as a shipped title, a game jam entry or a redesign of someone else's footage. Directors listen in short bursts between other tasks, so they skip anything that starts loud or runs long.

The rest of the freelancer's process causes its own problems:
- NDA work goes out as cloud-drive links that never expire and keep working after a project is cancelled.
- Enquiries arrive by email and are tracked in a spreadsheet that grows by the week.
- A proposal's milestone split is worked out by hand, which leads to rounding disputes.
- Two producers can say yes to the same production month in the same week.
- The freelancer then has to chase the deposit, and invoices dated in the wrong time zone confuse the producer's accounts team.
- A proposal emailed while the mail server was down can arrive days later, after the deal was declined or the offer ran out.

Earshot replaces all of this with one product.

- **Operator** (the freelancer, daily): publishes projects with four layered stems and honest credits, and shares and revokes private listening links, sometimes while a director is listening. Triages enquiries with private notes, a fit score and a rate floor, sometimes in two browser tabs at once. Pages back through a long Enquiries list while new briefs keep arriving. Sends milestone proposals, sets and lowers the capacity of each production month, starts production and invoices later milestones. Keeps the Enquiries list open for most of the day.
- **Audio director** (occasional): passes the sound gate, hears how each project's layers build as intensity rises, and sends a brief with an optional reference file. Some directors use only a keyboard or ask their system to reduce motion. Some listen through a private link that expires or is revoked while the page is open. Their names and studios may contain commas, quotes and non-English letters.
- **Producer** (occasional): opens a proposal link, checks the milestone amounts, accepts it to hold a production month, and pays the deposit. Producers are often on unreliable connections and may press buttons more than once or from several tabs.

## Journeys

1. **A director listens and sends a brief.**
   - Start: a director opens the journey for the first time and nothing is playing.
   - They choose "Enter with sound" at the sound gate and scroll into the first station.
   - The camera moves in close and the intensity readout counts up from 000. The bed, pulse, lead and stinger rungs fill one by one as their layers come in. Scrolling back up takes the layers out again in reverse order.
   - At the end of the corridor they fill in the brief form under their name "Hale, Imogen "Imo"" and their studio "Ålborg Lydværk". They first attach a WAV of more than 10,000,000 bytes: the form refuses it at once with the "That file is too large" copy, before anything is sent. They attach a smaller reference WAV and send it.
   - While the file uploads, the "Reference upload" bar shows its progress. Their connection drops halfway through; the form says it is retrying, sends the brief again by itself with the same idempotency key, and only one enquiry is saved.
   - End: the form shows the received-brief copy with a reference such as ENQ-000002. The director gets one receipt addressed to them under that exact name. The operator gets one alert whose reply goes straight back to the director.
2. **A director who uses only a keyboard and reduced motion.**
   - Start: the system's reduce-motion setting is on.
   - The director presses Enter on "Enter muted" and tabs to the first station's intensity slider and rung buttons.
   - Arrow keys step the intensity one point at a time, and the layer announcements read out each layer as it comes in.
   - They tab on to the brief form and send it with Enter.
   - End: they see the same received-brief copy as in journey 1, and the camera never moved.
3. **The operator publishes a project.**
   - Start: the operator signs in to the console and creates a draft project with a credit type, a credit line and layer thresholds.
   - They upload four stems (WAV or OGG), send the project for review and publish it.
   - End: the project's station appears in the public journey and in search, and all four stems are stored and playable.
4. **The operator shares NDA work privately and takes it back.**
   - Start: a published project is marked NDA, so it is not in the public journey or search.
   - The operator creates a private listening link that expires a few minutes from now and sends it to a director.
   - The director opens the link, passes the gate with sound, and is listening when the expiry instant arrives. Within two seconds the sound fades to silence and the station is replaced by the expired copy. The brief form stays usable.
   - The operator sends a second director a link that expires in an hour. While that director is listening, the operator revokes it. Within six seconds that director's page goes silent and shows the not-available copy. A brief they send from that page records no project.
   - The operator regenerates a third active link while it is open: the old page goes silent within six seconds and the new link plays.
   - End: the expired link shows the expired copy. The revoked and regenerated-away links show the not-available copy, and none of their stems can be fetched any more.
5. **The operator triages and proposes.**
   - Start: the Enquiries list holds more enquiries than fit on one page, and directors keep sending briefs.
   - The operator presses "Show more enquiries" to reach older enquiries and opens one. While they read, with the list scrolled away from the top, a new brief arrives: within three seconds it appears at the top of the open list without a page reload, the rows they are looking at stay where they were on screen, and no row is repeated or lost.
   - The operator opens the enquiry in two tabs. In the first tab they save triage notes, a fit score and a rate floor.
   - In the second, older tab they had already typed different triage notes and a different rate floor. Saving there is refused. That tab takes the first tab's fit score on its own, because only the first tab changed it, and shows the notes and the rate floor side by side, the other window's value against their own. They keep their own notes, take the other window's rate floor and save again, and that save applies.
   - The operator marks the enquiry qualified and builds a proposal for a producer with a fee and a production month. The milestone preview shows four amounts that add up exactly to the fee.
   - While the "Build proposal" dialog is open, a producer in another window accepts a proposal that takes the chosen month's last place. Within three seconds, without closing the dialog, the month's option is marked full and "Send proposal" disables. The operator picks another month, which is still open, and "Send proposal" works again.
   - They send the proposal, then export the pipeline to CSV.
   - End: the producer gets one proposal email with a link. The enquiry shows "Proposal sent". The CSV opens in a spreadsheet with no live formulas.
6. **A producer accepts and pays the deposit.**
   - Start: the producer opens the proposal link in two tabs. At the same moment, the operator lowers that month's capacity in the console.
   - The producer checks the four milestone amounts and presses "Accept and hold <Month YYYY>" in both tabs.
   - One tab holds the month. The other reports that the proposal has already been accepted and shows the same deposit invoice. The producer also leaves a third tab of the same proposal untouched: within three seconds of the accept, without a click or a reload and without moving focus, it switches by itself to the already-accepted state with that same deposit invoice. Within the same three seconds an open console Months table shows the new claimed count, and an open brief form stops offering the month once it is full. The console Months table, the public month list, the proposal page and both month pickers agree on how many places the month has claimed, and the month is never over capacity.
   - They press "Pay deposit" and their connection drops before the answer arrives. The page says it is retrying with the same payment, retries by itself, and only then says the deposit is received.
   - End: there is exactly one month claim, one Kill Bill account (carrying the operator's time zone), one live deposit invoice dated with the operator's local date, and one Kill Bill payment for exactly the deposit cents. One month-held email and one deposit-received email arrive.
7. **The operator runs production and retires old work.**
   - Start: an enquiry whose deposit is paid. It is late evening for the operator, and the UTC date has already moved on to the next day.
   - The operator starts production and invoices milestones 2, 3 and 4 in order, each for the exact cents shown on the proposal. They double-click "Invoice milestone 2" and also press it from a second console tab. Each press shows the milestone as "Invoicing…" at once, before the server answers; the tab whose request is refused rolls back to the server's state and says so. A third console tab open on the same enquiry, untouched, shows milestone 2 as invoiced within three seconds.
   - Later the operator withdraws an old project.
   - End: Kill Bill holds exactly four invoices for the booking, one per milestone, whose total equals the fee, each dated with the operator's own calendar date rather than the UTC date. The withdrawn project's station, search entry, stems and private links all return not-found, and its stem objects are gone from storage.
8. **Mail is down while briefs and proposals go out.**
   - Start: the mail server is unreachable.
   - A director sends a brief, and the operator sends a proposal and then changes the console time zone.
   - In a second console tab the operator opens Settings. Its "Mail queue" lists each waiting email with its kind, reference and recipient, counting down each second to its next try.
   - The operator sends a second proposal on another enquiry, then changes their mind and declines that enquiry while its proposal email is still waiting. The cancelled proposal email leaves the open "Mail queue" within three seconds of the decline.
   - Every action succeeds. The console shows "Receipt pending" and "Proposal email pending", and the declined enquiry shows "Proposal email cancelled".
   - The operator selects an enquiry and starts typing triage notes while the Enquiries list stays open.
   - End: once mail is reachable again, the receipt and the first proposal email go out by themselves without a restart, each exactly once. The proposal email's expiry date is written in the time zone that was set when it was queued. The declined enquiry's proposal email never arrives. The open list announces each delivered email as sent and shows "Receipt sent", while focus, the selected enquiry and the half-typed notes stay where they were. Within three seconds of each delivery, that email leaves the "Mail queue", which reads "No emails are waiting." once the last one is gone.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sound gate** The journey and private listening page open behind a modal sound gate, nothing makes a sound until the visitor chooses "Enter with sound" or "Enter muted", and a muted visitor drives every visual and state change exactly as a listening visitor does with every layer's volume at zero.
- **DP-02 — Station corridor** After the gate, the journey shows one full-screen station per published public project in the operator's order, each with its title, credit label, credit line, role and blurb in the lower-left third, followed by the brief form.
- **DP-03 — Scroll-driven intensity** As a station's 1600-pixel scroll range advances, its intensity rises from 0 to 100 and the pinned mono readout and the station's data-intensity follow it at every scroll position.
- **DP-04 — Intensity ladder** A layer is active while the current station's intensity is at or above that layer's threshold, every rung change updates data-active-layers, the URL query and the "Layer changes" announcement, and scrolling back reverses each step in reverse order.
- **DP-05 — Project search** Public search matches published public projects by title, credit line, blurb and tags, and choosing a result moves the journey to that station.
- **DP-06 — Keyboard-only listening** Using only the keyboard, a director can pass the sound gate, reach every station's four rung buttons, set each layer's intensity and send a brief.
- **DP-07 — Operator sign-in** The operator signs in with the seeded email and password, and every console endpoint other than sign-in answers 401 without a valid session.
- **DP-08 — Project records** The operator creates and edits projects with a slug, title, credit type, credit line, role, blurb, tags, visibility, position and four strictly increasing layer thresholds starting with the bed at 0, with validation errors as defined in API.
- **DP-09 — Stem upload checks** A stem upload is stored only when its content is a real WAV or OGG within the stem size and duration limits and its file name is safe, and anything else is rejected with the 413, 415 or 422 defined in API.
- **DP-10 — Project lifecycle** Projects move only along draft, in review, published and withdrawn as allowed in Business rules, publishing requires all four stems stored, and every illegal move answers 409.
- **DP-11 — Publishing a station** A project the operator creates, fills with four stems, sends for review and publishes appears as a playable station in the journey and in search without a restart.
- **DP-12 — Withdrawing a project** Withdrawing a project deletes its stem objects from storage and revokes its links, after which its station, search entry, stem URLs and private links answer not-found.
- **DP-13 — Storage outage** While storage is unreachable, stations show their text with the resting-audio copy and no audio, uploads, publishing, withdrawal and brief attachments answer 503, and everything recovers by itself when storage returns.
- **DP-14 — Private listening links** The operator creates read-only private listening links for in-review or published projects, each with an operator-set expiry inside the bounds in Business rules, and any attempt to change something through a link answers 405.
- **DP-15 — Revoking and regenerating links** Revoking a link makes its page data and every one of its stems answer 404 at once, regenerating an active link issues a new working link with the same expiry and makes the old one answer 404, and an expired or revoked link cannot be regenerated.
- **DP-16 — NDA projects stay off public pages** An NDA project never appears in the public journey, public search or public stem URLs and is reachable only through a live private link.
- **DP-17 — Private listening session** A director who opens a live private link passes the sound gate and drives the project's intensity ladder exactly as in the public journey, under the NDA notice showing the link's expiry.
- **DP-18 — Sending a brief** The brief form saves an enquiry with a reference and shows the received-brief copy, with field errors as defined in API and the field rules in Business rules.
- **DP-19 — Reference file checks** A brief's optional reference file is stored only when its content is a real WAV, OGG, MP3 or PDF within the reference size limit, and anything else is rejected with 413 or 415 with no enquiry saved.
- **DP-20 — Enquiry pacing** Briefs are limited per sender email and per IP address within a time window, even when many arrive at the same moment, and once a limit is reached the API answers 429 with a Retry-After header and queues no email, and the form tells the director how long to wait.
- **DP-21 — Receipt and alert emails** Each saved enquiry sends exactly one receipt email to the director and exactly one new-brief alert email to the operator.
- **DP-22 — Enquiry triage** The operator records private triage notes, a fit score and a rate floor and moves enquiries only along the pipeline transitions in Business rules, with every illegal move answering 409.
- **DP-23 — Pipeline CSV export** The console exports the enquiry pipeline as CSV in which any cell beginning with a formula trigger character is neutralised and withdrawn projects' slugs never appear.
- **DP-24 — Milestone split** A fee in whole cents splits 30/20/20/30 into four whole-cent milestones that always add up to the fee, with the last milestone taking the remainder.
- **DP-25 — Sending a proposal** A qualified enquiry becomes a proposal with a producer, a fee at or above the rate floor and an open production month, and the producer gets exactly one proposal email with an accept link, as qualified in Business rules.
- **DP-26 — Proposal page and expiry** The producer's proposal page shows the same four milestone amounts and production month the operator previewed, and the accept link answers 410 once the proposal TTL has passed, checked on the server.
- **DP-27 — Production months** The operator sets a capacity for each calendar month in the configured time zone, and a capacity below the month's claimed count is refused with 422 and changes nothing.
- **DP-28 — Accepting a proposal** Accepting a proposal claims its production month, reuses or creates the producer's Kill Bill account, creates the deposit invoice, queues the month-held email and shows the deposit invoice on the page.
- **DP-29 — Last open month** When producers accept proposals for a month's last free place at the same moment, or while the operator lowers its capacity, exactly the free places are claimed and every other acceptance answers 409 with the month-taken copy.
- **DP-30 — All-or-nothing acceptance** If any part of an acceptance fails, the month claim, the booking and the month-held email are left undone, any deposit invoice it created is voided in Kill Bill, and the proposal stays open to accept again, as qualified in Business rules.
- **DP-31 — Paying the deposit** Pay deposit records one Kill Bill PURCHASE payment for the deposit invoice's exact balance, moves the enquiry to deposit paid and sends one deposit-received email.
- **DP-32 — Deposit retries** Replaying a deposit request with the same Idempotency-Key returns the original non-503 response without a second payment or email, a 503 is not stored so the same key tries again, and the same key with a different body answers 409.
- **DP-33 — Starting production** The operator starts production on an enquiry whose deposit is paid, which moves it to booked, and no other state can move to booked.
- **DP-34 — Later milestone invoices** For a booked enquiry the operator invoices milestones 2, 3 and 4 in order, each as one Kill Bill invoice for the exact cents from the split.
- **DP-35 — Private fields stay private** Triage notes, fit score and rate floor never appear in any outbound email, the proposal page, the proposal API, the private listening page or the public journey.
- **DP-36 — Mail outage catch-up** When mail is unreachable, enquiries, proposals, acceptances and payments still succeed with their emails shown as pending, and each queued email goes out exactly once when mail returns, without a restart, except a proposal email cancelled as in DP-60.
- **DP-37 — Reduced-motion ladder** With reduced motion requested there is no camera movement and scroll does not drive intensity, and each station offers an intensity slider and four rung buttons that drive the same URL, attribute and announcement changes.
- **DP-38 — Camera and motion timing** When a station becomes current its camera moves from wide to close in just under one second and back when it stops being current, layer volumes, rung fills and panel glow cross over in under half a second, and the only other animations are the link-end fade, the gate fade-out, console dialog transitions and button press and hover feedback listed in Motion and effects.
- **DP-39 — Dialogs and focus** Every dialog traps focus and closes with Escape, every dialog opened from a control returns focus to that control while the sound gate, which opens on page load, moves focus to the intro heading, and every interactive control shows a visible focus ring.
- **DP-40 — Responsive layouts** The journey, private listening page, proposal page and console are fully usable at 375x812, 768x1024 and 1280x800 with no horizontal scrolling and tap targets at least 44 pixels in each direction.
- **DP-41 — Nocturnal analogue look** Every screen uses the near-black olive ground, warm parchment text, signal-orange actions, oxide-green states, mono meter-style numerals and the type described in Visual design.
- **DP-42 — Real adaptive audio** Stems play through Web Audio with all four layers looping in sync on equal-power volume curves, the corridor is rendered procedurally in WebGL, and seed stems are synthesized by code rather than shipped as audio files.
- **DP-43 — Health and run manifest** The app installs, builds and serves from /app/run.json, listens on port 4173 or APP_PUBLIC_PORT, and answers GET /api/health with 200 and the body {"status":"ok"}.
- **DP-44 — Server boundary** The server rejects state changes whose Origin header names another origin, enforces the request size limits, never serves source files or credentials, and starts even when a dependency is unreachable.
- **DP-45 — Credentials from environment** Every service URL and credential is read from the environment variables listed in Configuration and secrets, and none is hard-coded or sent to the browser.
- **DP-46 — Header-safe brief emails** Names, studios and emails a director types can never add recipients or headers to any email, and the new-brief alert lets the operator reply straight to the director under their exact display name, as qualified in Business rules and Services.
- **DP-47 — Stale console saves** Every enquiry carries a version, and a console write made from an out-of-date copy answers 412 and changes nothing, so a second console tab never silently overwrites newer triage or a producer's acceptance.
- **DP-48 — Link expiry everywhere** A listening link stops working at its exact expiry instant on the page data, on every stem and on an already-open listening page, and its responses are never cached or leaked through referrers.
- **DP-49 — Double acceptance** However many times or from however many tabs a producer presses Accept on one proposal, there is one month claim, one Kill Bill account, one live deposit invoice and one month-held email.
- **DP-50 — Exact deposit money** Deposit amounts and paid state are read back from Kill Bill in exact cents, and a payment Kill Bill already holds for a deposit is adopted, never charged twice.
- **DP-51 — Business time in emails** Every date in an email is written in the operator's time zone as it stood when the email was queued, and a queued email is delivered exactly as it was written.
- **DP-52 — Revocation reaches open pages** When the operator revokes or regenerates a listening link or withdraws its project, a listening page already open on that link fades to silence, removes the station and shows the not-available copy within 6 seconds, and every stem on the link answers 404 at once.
- **DP-53 — Only writable fields** Console enquiry and project writes accept only their writable fields, and a body carrying any other field answers 422 naming that field, with nothing changed and the version unchanged.
- **DP-54 — One month count everywhere** A month's claimed count always equals its accepted, deposit-paid and booked enquiries, and the console, the public month list, the proposal page and both month pickers decide openness from that one figure.
- **DP-55 — Honest payment state** The proposal page shows the deposit as received only after a 200 or a server read of a paid status, and a deposit request lost without a response is retried automatically with the same Idempotency-Key, as qualified in Business rules.
- **DP-56 — One invoice per milestone** However many times or from however many tabs the operator invoices a milestone, Kill Bill holds exactly one non-void invoice for it, and an invoice Kill Bill already holds with that milestone's description and amount is adopted.
- **DP-57 — Delivery announced in the console** An open Enquiries list announces each email that moved from pending to sent since its previous reload, without moving focus, changing the selection or discarding unsaved triage notes.
- **DP-58 — Stable enquiry paging** The console Enquiries list pages newest first by reference with a capped page size and a cursor bound to its status filter, so briefs arriving while the operator pages never repeat or skip a row, and the status filter uses each enquiry's read-time status.
- **DP-59 — Business dates in Kill Bill** The Kill Bill account an acceptance creates carries the operator's time zone, and every deposit and milestone charge is dated with the operator's local calendar date at the moment of the request, as qualified in Business rules.
- **DP-60 — Cancelled proposal emails** A proposal email still waiting in the mail queue when its enquiry is declined or its accept link expires is cancelled and never reaches the producer, while every other queued email is still delivered.
- **DP-61 — Live triage list and stale-save merge** An open Enquiries list shows a newly saved enquiry, or an enquiry whose version increased, within three seconds without a page reload and keeps the rows in view in place, and a triage save refused as stale merges the other window's changes field by field, asking the operator to choose only for fields both windows changed differently.
- **DP-62 — Live acceptance on open pages** An open proposal page that did not accept switches by itself to the already-accepted state with the same deposit invoice within three seconds of an acceptance made anywhere, without a click, a reload or moving focus, except as described in Interactions, and an open console Months table and an open brief form show the month's new claimed count or fullness within the same three seconds.
- **DP-63 — Live month fullness while building a proposal** While "Build proposal" is open, a production month that becomes full or open again in another window is marked unavailable or available in "Production month" within three seconds, and while the selected month is full the dialog says so and "Send proposal" is disabled.
- **DP-64 — Optimistic milestone invoicing** Pressing "Invoice milestone <n>" shows the milestone as invoicing at once, before the server answers, confirms it on a 201 and on any other outcome rolls the view back to the server's state with the copy in Feedback states, and a second console tab showing the enquiry reflects an invoice within three seconds.
- **DP-65 — Checked and resumable brief uploads** The brief form checks the size of a reference file, and the format, channels and sample rate of a reference WAV and that it decodes, in the browser before any request is sent, shows the upload's progress, and retries a brief whose connection drops with the same Idempotency-Key, which the server honours so that exactly one enquiry is saved.
- **DP-66 — Live mail queue** The console Settings view shows every pending email with its kind, reference, recipient and a per-second countdown to its next delivery try, and removes an email within three seconds of it being sent or cancelled.

## Frontend

### Screens and layout (DP-02, DP-17, DP-26, DP-40, DP-48, DP-52, DP-58, DP-64, DP-66)

- **Journey** (`/`)
  - **Structure.** A full-screen 3D corridor fills the whole viewport behind everything. A thin top bar holds the "Earshot" wordmark on the left, then the search box, then the "Sound on" toggle on the right. Below the bar come, in order:
    - an intro chapter one viewport tall;
    - one station chapter for each published public project, in ascending position;
    - the "Send a brief" section.
  - **Station chapters.** Each station chapter is one viewport tall plus 1600 pixels of scroll. Its stage (corridor view, text block and ladder) stays pinned while that 1600-pixel range scrolls past. After that range, the stage scrolls up out of view over one viewport height. The next chapter's top reaches the top of the viewport exactly when this stage has left. The current-station rule for that stretch is in Interactions.
  - **Text block.** The station text sits in the lower-left third: the credit label, then the title, role, credit line and blurb.
  - **Readout and ladder.** One intensity readout is pinned to the right edge for the whole page. Each station's four-rung ladder sits just below the readout on the right, with the bed rung at the bottom and the stinger rung at the top.
  - **By viewport:**
    - 1280x800: the text block takes about two fifths of the width at the lower left. The readout and ladder sit in a narrow column on the right.
    - 768x1024: the text block takes about half the width. The readout and ladder sit on the right at a reduced size.
    - 375x812: the readout and ladder form a compact strip across the top, under the top bar, and the text block fills the lower half. The search box collapses to a button "Search" that opens the search box in place.
- **Private listening page** (`/listen/<token>`). The same corridor with a single station for the linked project. The NDA notice runs across the top in place of the search box, and the "Send a brief" section follows the station. When the link is expired, revoked, regenerated away, withdrawn or unknown, the station area is replaced by the "Link status" copy and the "Send a brief" section stays below it.
- **Proposal page** (`/p/<token>`)
  - A single centred column on the same dark ground holds, in order: the proposal heading, the project title and scope, the fee, the production month, the milestones table, and the accept area.
  - Once the proposal is accepted, the deposit invoice area replaces the accept area.
  - All three viewports use one column. At 375 the milestones table becomes stacked rows, with the label on the left and the amount on the right.
- **Console** (`/console`)
  - A sign-in form shows until the operator signs in.
  - After sign-in there is a navigation bar with Projects, Enquiries, Months and Settings. Below it is a two-pane layout: a list on the left, about a third of the width, and the selected record's detail on the right.
  - The Enquiries list ends with the "Show more enquiries" button while older enquiries exist; the list pane scrolls on its own, so the detail pane stays in view while the operator pages.
  - The detail pane of an enquiry in booked shows the "Milestone invoices" list directly above the single "Invoice milestone <n>" button shown at a time.
  - In the Settings view, the "Mail queue" region sits directly below "Save settings".
  - At 768 the list takes about two fifths of the width.
  - At 375 only one pane shows at a time. Choosing a list item opens its detail, and a "Back to list" button returns to the list.
- No screen scrolls horizontally at 375x812, 768x1024 or 1280x800.

### Public screens and controls (DP-01, DP-04, DP-05, DP-06, DP-14, DP-18, DP-22, DP-25, DP-28, DP-31, DP-37, DP-39, DP-47, DP-48, DP-52, DP-54, DP-55, DP-56, DP-57, DP-58, DP-60, DP-61, DP-63, DP-64, DP-65, DP-66)

Only the controls and regions below are public; everything else is free. Placeholders used in the table:
- `<title>` is a project title.
- `<Month YYYY>` is a production month label as defined in Business rules.
- `<reference>` is an enquiry reference such as ENQ-000002.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| Journey, private page | `dialog "Sound gate"` (modal) | Heading "Earshot by Kettlehole Audio"; text "Every station builds from silence. Choose how you want to listen." |
| Journey, private page | `button "Enter with sound"`, `button "Enter muted"` | Same as the name |
| Journey, private page | `button "Sound on"` with aria-pressed | "Sound on"; pressed means audible |
| Journey | `searchbox "Search projects"`; `list "Search results"` of `link "<title>"` | — |
| Journey | `status "Search status"` | Search copy from Feedback states |
| Journey, private page | `region "<title>"` per station, with attributes `data-station="<slug>"`, `data-intensity="<0-100>"` and `data-camera` set to `wide`, `moving` or `close` | Credit label "Shipped title", "Game jam" or "Redesign"; title, role, credit line, blurb; the title is the station's level-2 heading (tabindex -1), which names the region |
| Journey, private page | `group "Intensity ladder"` inside each station, with `data-active-layers` | Comma-separated active layers in the order bed,pulse,lead,stinger, for example `bed,pulse`; an empty string when none are active |
| Journey, private page | `button "Bed layer"`, `button "Pulse layer"`, `button "Lead layer"`, `button "Stinger layer"` inside each ladder, with aria-pressed | Rung label plus its threshold, for example "Pulse 25" |
| Journey, private page | `slider "Intensity for <title>"` (only with reduced motion), 0 to 100 in steps of 1 | — |
| Journey, private page | `meter "Intensity"` with aria-valuenow 0 to 100 | "INTENSITY" above a three-digit zero-padded value, for example "042" |
| Journey, private page | `status "Layer changes"` | Layer copy from Feedback states |
| Private page | `region "NDA notice"` | Banner copy from Feedback states |
| Private page | `status "Link status"` | Link copy from Feedback states; empty while the link is live |
| Journey, private page | `form "Send a brief"` with `textbox "Your name"`, `textbox "Email"`, `textbox "Studio"`, `textbox "Brief"` (multi-line), `combobox "Preferred production month"` (optional; first option "No preference", then one option per open month labelled `<Month YYYY>`), a file input labelled "Reference file (optional)", and `button "Send brief"` | — |
| Journey, private page | `progressbar "Reference upload"` inside the brief form, with aria-valuemin 0, aria-valuemax 100 and aria-valuenow, shown only while a brief with a reference file is sending | "<p>%", where `<p>` is aria-valuenow |
| Journey, private page | `status "Brief status"` | Brief copy from Feedback states |
| Proposal page | `heading "Proposal <reference>"` | — |
| Proposal page | `table "Milestones"` with columns "Milestone", "Share", "Amount" | Four rows: "Deposit", "Vertical slice", "Content complete", "Final delivery" |
| Proposal page | `button "Accept and hold <Month YYYY>"` | Same as the name; shown only while the proposal is open and its month is open |
| Proposal page | `region "Deposit invoice"` | "Invoice <invoice number>", "Deposit $<deposit>" |
| Proposal page | `textbox "Name on payment"`, `button "Pay deposit"` | — |
| Proposal page | `status "Proposal status"` | Proposal copy from Feedback states |
| Console | `form "Operator sign in"` with `textbox "Email"`, a password field labelled "Password", `button "Sign in"` | — |
| Console | `navigation "Console"` with `link "Projects"`, `link "Enquiries"`, `link "Months"`, `link "Settings"`; `button "Sign out"` | — |
| Console | `list "Projects"`, `button "New project"`, `form "Project details"` | Fields labelled Slug, Title, Credit type, Credit line, Role, Blurb, Tags, Visibility, Position, Bed threshold, Pulse threshold, Lead threshold, Stinger threshold; `button "Save project"`; Credit type offers "Shipped title", "Game jam" and "Redesign", Visibility offers "Public" and "NDA (private links only)", and Tags is one text field of comma-separated tags |
| Console | File inputs labelled "Bed stem file", "Pulse stem file", "Lead stem file", "Stinger stem file" | Each shows the stored stem's format, size and duration, or "Missing"; choosing a file uploads it at once |
| Console | `button "Send for review"`, `button "Back to draft"`, `button "Publish"`, `button "Withdraw project"`, each shown only where the move is legal | — |
| Console | `alertdialog "Withdraw <title>?"` with `button "Withdraw"` and `button "Keep project"` | "Its stems are deleted and every link to it stops working. This cannot be undone." |
| Console | `button "New listening link"` opening `dialog "New listening link"` with `textbox "Label"`, a date-and-time input (to the minute) labelled "Expires at", whose value is read as wall time in the operator's time zone from settings and sent as that instant in `expires_at`, `button "Create link"` | — |
| Console | `list "Listening links"`; for each link `button "Copy link"`, `button "Revoke"` and `button "Regenerate"` (Regenerate shown only for active links) | Label, status "Active", "Expired" or "Revoked", and expiry `<date>` |
| Console | `list "Enquiries"` with a status filter `combobox "Status"` (first option "All statuses", then the eight status labels) and `link "Export CSV"`; each row is a list item holding `button "Open <reference>"`, and the selected row's button carries aria-current="true" | Each row shows the reference, studio, status label, the badge "Receipt pending" or "Receipt sent", and the proposal email badges from Feedback states |
| Console | `button "Show more enquiries"` directly below `list "Enquiries"`, shown only while older enquiries exist | Same as the name |
| Console | `list "Milestone invoices"` (tabindex -1) in the detail pane of an enquiry in booked, holding three list items in the order 2, 3, 4, each with `data-milestone="<n>"` and `data-state` set to `not-invoiced`, `invoicing` or `invoiced` | Each item reads "Milestone <n>: <name>, $<amount>. <state copy>", with the state copy from Feedback states |
| Console | `textbox "Triage notes"`, `spinbutton "Fit score"`, `textbox "Rate floor (USD)"`, `button "Save triage"`, `button "Qualify"`, `button "Decline"`, `button "Build proposal"`, `button "Start production"`, `button "Invoice milestone 2"`, `button "Invoice milestone 3"`, `button "Invoice milestone 4"`, each shown only where legal | — |
| Console | `region "Changed in another window"` directly above `button "Save triage"`, shown only while a stale "Save triage" has conflicting fields; per conflicting field, the texts "Theirs: …" and "Yours: …" and `radiogroup "Triage notes"`, `radiogroup "Fit score"` or `radiogroup "Rate floor (USD)"` holding `radio "Keep mine"` and `radio "Use theirs"` | Same as the name |
| Console | `dialog "Build proposal"` with `textbox "Producer name"`, `textbox "Producer email"`, `textbox "Project title"`, `textbox "Scope"`, `textbox "Fee (USD)"`, `combobox "Production month"` (one option per month from `GET /api/console/months`, in ascending order: an open month labelled `<Month YYYY>`, a full month labelled `<Month YYYY> (full)` with aria-disabled="true" and unselectable), `table "Milestone preview"`, `button "Send proposal"` | — |
| Console | `button "Copy proposal link"` on an enquiry that has a proposal | — |
| Console | `table "Production months"` with a `spinbutton "Capacity for <Month YYYY>"` per row, and `button "Save months"` | Columns "Month", "Capacity", "Claimed" |
| Console | `combobox "Time zone"`, `button "Save settings"` | One option per IANA time zone name, labelled with the name with underscores shown as spaces, for example "America/New York" |
| Console | `region "Mail queue"` in the Settings view, holding `list "Pending emails"` with one list item per pending email, each with `data-kind` set to the email's `kind` from `GET /api/console/mail-queue` | Each item reads "<kind label> for <reference> to <address>. <countdown>"; mail queue copy from Feedback states |
| Console | `status "Console status"` | Console copy from Feedback states |

The console labels enquiry statuses as "New", "Qualified", "Proposal sent", "Accepted", "Deposit paid", "Booked", "Declined" and "Expired".

### Interactions (DP-01, DP-03, DP-04, DP-05, DP-06, DP-17, DP-18, DP-37, DP-39, DP-47, DP-48, DP-49, DP-52, DP-54, DP-55, DP-56, DP-57, DP-58, DP-60, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66)

- **Sound gate.**
  - On load the gate dialog is open with focus on "Enter with sound", and the page behind it cannot be focused or scrolled.
  - "Enter with sound" starts the audio engine inside that click or key press.
  - "Enter muted" and Escape both enter muted without starting audio.
  - While the gate is open it traps focus. Tab and Shift+Tab move only between its two buttons.
  - After either choice the gate closes and focus moves to the intro heading. The intro heading is the level-1 heading "Walk the corridor. Every station builds from silence." at the top of the intro chapter, with tabindex -1; the private listening page has the same intro heading. The gate opens on page load, so no control opened it. It is the only dialog that does not return focus to an opening control.
  - "Sound on" switches audibility at any time. The first switch from muted to on starts the audio engine.
- **Current station.**
  - A station's offset is the page's scroll position minus the top of the station's chapter.
  - The station is current while its offset is from 0 to 1600 inclusive. At most one station is current.
  - No station is current in these stretches:
    - between one station's offset passing 1600 and the next chapter's top reaching the top of the viewport, which is one viewport height of scrolling;
    - while the intro chapter is in view;
    - after the last station's offset passes 1600.
  - Its intensity is the offset divided by 16, rounded to the nearest whole number, with an exact half always rounded up. For example, an offset of 8 pixels gives 0.5, which is intensity 1; an offset of 24 pixels gives 1.5, which is intensity 2; and an offset of 7 pixels gives 0.4375, which is intensity 0.
  - A station that is not current has data-intensity 0 and an empty data-active-layers.
  - While no station is current, the readout shows "000".
- **Layers.**
  - For the current station, a layer is active while intensity is at or above that layer's threshold.
  - A rung change is any change to the set of active layers. This includes a station becoming current (the bed layer comes in) and a station stopping being current (every active layer goes out).
  - On every rung change the page does four things:
    1. It updates data-active-layers.
    2. It replaces the URL query with `?station=<slug>&i=<intensity>` without adding a history entry. When no station is current, it removes both parameters.
    3. It writes the layer copy to "Layer changes".
    4. It fades each changed layer in or out.
  - Scrolling back produces the same changes in reverse order.
  - Only the current station makes sound. All four of its layers loop together from the moment it becomes current.
- **Rung buttons.** Each rung button's aria-pressed shows whether its layer is active. Activating a rung button by click, Enter or Space sets the station's intensity to that layer's threshold. Without reduced motion, the page jumps straight to the matching offset. With reduced motion, the station's intensity is set directly.
- **Reduced motion.** When the system asks for reduced motion, scrolling no longer changes intensity, and the station whose stage is in view is the current station. The current station is the one whose stage holds focus, otherwise the one whose stage fills the most of the viewport's height, and it becomes current at intensity 0. While no station's stage is in view, as on the intro chapter or the brief form alone, no station is current. The slider and the rung buttons set its intensity. Arrow keys, Page Up, Page Down, Home and End move the slider in the usual steps. The URL, data attributes and announcements behave exactly as in the scrolled version.
- **Keyboard order on the journey.**
  1. The top bar controls.
  2. Each station's rung buttons, from bed to stinger. With reduced motion on, the slider comes first.
  3. The brief form fields in visual order.
  4. "Send brief".

  Enter submits the brief form from any single-line field.
- **Search.** Typing in "Search projects" runs a search once typing has paused for a quarter of a second. Activating a result jumps to that station's start, makes it current and moves focus to its heading.
- **Brief form.** "Send brief" disables itself while the brief is sending. Field errors appear under each field, and focus moves to the first invalid field. On success the form clears, and the received-brief copy stays in "Brief status".
  - **Live month options.** The "Preferred production month" options are loaded when the page loads, each time the combobox receives focus, and every 2 seconds while the page is open. So a month that becomes full anywhere leaves the options within three seconds, and a month that opens again returns in ascending order within three seconds. When the selected month leaves the options, the selection becomes "No preference" and "Brief status" shows the month-full brief copy. These updates never move focus.
  - **Reference check in the browser.** When "Send brief" is pressed with a reference file chosen, the form checks the file before it sends anything, in this order, and stops at the first failure:
    1. The file is over 10,000,000 bytes.
    2. Its first 12 bytes are `RIFF`, any four bytes, then `WAVE` (a WAV). Only a WAV goes through checks 3 to 6; any other file is sent as it is and judged by the server.
    3. Its `fmt ` chunk is missing, or its format, as read from the file's bytes, is neither PCM (1), IEEE float (3), nor WAVE_FORMAT_EXTENSIBLE (0xFFFE) with a PCM or IEEE float subformat.
    4. Its channel count, read from the `fmt ` chunk, is not 1 or 2.
    5. Its sample rate, read from the `fmt ` chunk, is outside 22,050 to 96,000 Hz inclusive.
    6. Decoding the whole file with Web Audio (`decodeAudioData` on an `OfflineAudioContext` created at the file's own sample rate and channel count, which plays nothing) fails. The browser does not check duration; the server's duration rule still applies.

    On a failure, "Brief status" shows that check's copy from Feedback states, focus moves to the "Reference file (optional)" input, "Send brief" stays enabled and no request is sent. A brief without a reference file, or whose file passes, is sent.
  - **Upload progress.** While a brief with a reference file is sending, `progressbar "Reference upload"` shows the request body's bytes sent so far divided by its total bytes, times 100, rounded down, updated at least every 250 milliseconds while bytes are moving. It is removed when the request ends.
  - **Idempotency key.** Pressing "Send brief" after the form passes its check creates one Idempotency-Key for that brief, unless a key from an earlier press of the same brief is still held. The form reuses that key for every automatic retry and every later press, and creates a new key only when a field or the chosen file has changed since the last request was sent, or after a 201. Every brief request carries the key in its `Idempotency-Key` header.
  - **Brief retries.** A brief request that ends with no HTTP response, or that answers 409 request_in_progress, shows the brief connection-lost copy and starts the automatic retry rule for briefs from Business rules, with the same key and the same fields and file. "Send brief" stays disabled while automatic retries run. A 201 from any attempt shows the received-brief copy. When the automatic retries end without a response other than those two, the form shows the brief could-not-confirm copy and re-enables "Send brief" with the same key. Any other response is handled as for a first attempt.
- **Private page checks.**
  - The open page asks the server for `GET /api/listen/<token>` again:
    - on the live-link re-check interval from Business rules, for as long as the link answers 200;
    - when its own clock reaches the link's `expires_at`, and after that once a second until the server answers 410 or 404;
    - immediately whenever a stem request answers 410 or 404.
  - On a 410 the page shows the expired copy; on a 404 it shows the not-available copy. In both cases it fades every layer to silence, removes the station region, writes the matching copy to "Link status", leaves "Send a brief" usable and stops checking. The time limits for this are in Business rules under private listening links.
  - A brief sent from this page always carries the page's `listen_token`.
- **Proposal page.**
  - **Load.** The page reads the proposal on load. While the status is proposal_sent and `month_open` is false, the accept button is not shown and the month-taken copy is in "Proposal status".
  - **Accept.** "Accept and hold <Month YYYY>" disables itself while the request is pending. When the accept answers 409 illegal_transition, the page reloads the proposal. If the proposal is now accepted, the page shows the deposit area with the stored invoice and the already-accepted copy. When it answers 409 month_taken, the button disappears and the month-taken copy shows.
  - **Idempotency key.** Pay deposit creates one Idempotency-Key when the deposit area first appears. It reuses that key for every press and every automatic retry, including after a 503 (a 503 is never stored, so the same key tries again). It creates a new key only when the payer name has been edited since the last request was sent.
  - **Pay deposit outcomes.** "Pay deposit" disables itself while a payment is pending, and a second press while pending does nothing. Then:
    - a 200 shows the paid copy and removes the payer field and button;
    - a request that ends with no HTTP response, or that answers 409 request_in_progress, shows the connection-lost copy and starts the automatic retry rule from Business rules, with the same key and the same body;
    - when the automatic retries end without a 200, the page shows the could-not-confirm copy and re-enables "Pay deposit" with the same key;
    - a 503 shows the billing-unreachable payment copy and re-enables the button with the same key, with no automatic retry;
    - a 409 illegal_transition reloads the proposal and shows the state the server returns;
    - any other error shows the refused-payment copy and re-enables the button.
  - **Live state.** While the page shows a proposal in proposal_sent and no accept request from this page is pending, it re-reads `GET /api/proposals/<token>` every 2 seconds. So within three seconds of an acceptance made from any other tab or device:
    - the accept area is replaced by the deposit invoice area with the stored invoice, exactly as after an accept answering 409 illegal_transition, and "Proposal status" shows the already-accepted copy;
    - while `month_open` is false the accept button is hidden and the month-taken copy shows, and when `month_open` becomes true again the button returns and "Proposal status" is cleared;
    - a 410 shows the expired or closed copy and hides the accept button.

    The page stops re-reading once the status is accepted or later, or after a 410. A re-read never moves focus, except that when the focused accept button is removed, focus moves to the `heading "Proposal <reference>"`, which carries tabindex -1. Text typed in "Name on payment" is never changed by a re-read.
  - The page never shows the paid copy, never hides "Pay deposit" and never marks the deposit paid except after a 200, or after a proposal read whose status is deposit_paid or booked. Reloading the page during a pending payment shows the state read from the server.
- **Console.**
  - Choosing a list row opens its detail and marks that row's button with aria-current="true".
  - Each console dialog opens with focus on its first field and keeps Tab and Shift+Tab inside it. It closes on Escape or its cancel control, and returns focus to the control that opened it.
  - Typing in "Fee (USD)" refreshes the milestone preview within half a second of the last keystroke.
  - **Production month in Build proposal.** The "Production month" combobox loads its options from `GET /api/console/months` when the dialog opens, and again every 2 seconds while the dialog stays open. When the dialog opens, the first open month is selected; when no month is open, the first option is selected.
    - Within three seconds of a month becoming full in any window (an acceptance or a lowered capacity), its option changes to `<Month YYYY> (full)` and is marked unavailable, and within three seconds of it opening again (a raised capacity) it returns to `<Month YYYY>` and can be chosen.
    - While the selected month is full, the selection stays on it, the month-full proposal copy shows under the combobox as its accessible description, and "Send proposal" is disabled. When the operator chooses an open month, or the selected month opens again, the copy is removed and "Send proposal" is enabled again.
    - These updates never move focus and never change the other fields or the milestone preview.
  - **Production months table.** The table loads when the Months view opens, again after each "Save months", and every 2 seconds while the Months view is open, so each row's "Claimed" shows a new claimed count within three seconds of an acceptance anywhere. A re-read adds rows for newly set months and updates every "Claimed" cell, and it updates a "Capacity for <Month YYYY>" spinbutton only when the operator has not changed that spinbutton since the table last loaded or saved. A re-read never moves focus.
  - **Paging the Enquiries list.**
    - Opening the list, or changing the "Status" filter, shows the first page of the newest 25 enquiries that match the filter, newest first.
    - "Show more enquiries" is shown only while the last page read reported older matching enquiries. Activating it appends the next page under the rows already shown. Focus stays on the button; when no older rows remain and the button disappears, focus moves to the first appended row's button.
  - **Reloading the Enquiries list.**
    - The list reloads when it is opened. While it stays open, it reloads again within three seconds after a new enquiry is saved or any enquiry's version increases, from any window or instance, and at least every 15 seconds otherwise. This is when the row badges update. Email state changes and an enquiry starting to read as expired do not change the version, so they show on the next reload, which may be up to 15 seconds later.
    - When a reload inserts or removes rows above the rows in view, the list pane keeps the rows in view at the same place on screen: its scroll offset grows by the height of the inserted rows and shrinks by the height of the removed ones. When the list pane is scrolled to the very top, new rows simply appear at the top.
    - Each reload re-reads from the newest matching enquiry down to the oldest row already shown, page after page, so every row already shown is read again. Newly saved enquiries appear at the top, every appended row stays, and a row that no longer matches the filter leaves the list. The button's presence follows the last page read.
    - Each reload updates the rows in place. It never moves focus, never changes which row is selected and never touches the detail pane, so text typed but not saved in "Triage notes" stays as typed.
  - **Delivery announcements.** On each reload after the first, the list compares the receipt, proposal email, month-held email and deposit email states of every row shown with the previous reload. Every email that moved from pending to sent gets its delivery sentence from Feedback states. The sentences go into "Console status" in one update, joined by single spaces, ordered by reference ascending and then by kind in the order receipt, proposal, month-held, deposit. An email that moved from pending to cancelled gets no sentence. A reload with no such change leaves "Console status" as it was. The first load after opening the list announces nothing.
  - The detail pane keeps the version it loaded until the operator saves, reopens the enquiry or invoices a milestone (see Invoicing a milestone).
  - Every enquiry write from the console sends the detail pane's version, and sends only that action's own fields.
  - When a write answers 412, the detail pane takes the enquiry returned in the response as its new version, and the next save uses that version. For a "Save triage" answering 412, the pane merges the three triage fields ("Triage notes", "Fit score", "Rate floor (USD)") one by one, comparing three values for each: the value the pane last loaded, the value in the response, and the value now in the field. "Triage notes" is compared as the exact text, "Fit score" as its whole number, and "Rate floor (USD)" as integer cents, with an empty field meaning no value. After the merge, the response becomes the value the pane last loaded for any later merge.
    - Only the other window changed it (response differs from last loaded, field equals last loaded): the field takes the response's value.
    - Only this pane changed it (field differs from last loaded, response equals last loaded): the field keeps what the operator typed.
    - Both changed it to the same value, or neither changed it: the field keeps its value.
    - Both changed it to different values: a conflict.
  - When at least one field conflicts, the region "Changed in another window" opens directly above "Save triage". It lists one entry per conflicting field, in the order triage notes, fit score, rate floor. Each entry shows the text "Theirs: <value in the response>" and, below it, "Yours: <value now in the field>", then a radiogroup named after the field's label with the radios "Keep mine" (checked) and "Use theirs". Choosing "Use theirs" puts the response's value in the field; choosing "Keep mine" puts the operator's typed value back. An empty value is written "(empty)", the fit score as a whole number, and the rate floor as money (see Writing money).
  - "Save triage" then saves the three fields as they now stand with the new version. When that save answers 200, the region closes. When it answers 412 again, the merge runs again against the newer response, starting from the fields as they now stand, and the region is rebuilt. Any other answer leaves the region open with its choices as they were.
  - Any write other than "Save triage" that answers 412 loads the response into the pane, keeps any triage notes typed but not saved, and opens no region.
  - **Invoicing a milestone.** The "Milestone invoices" list shows each of milestones 2, 3 and 4 as `invoiced` when the pane's enquiry lists it in `proposal.invoiced_milestones`, and otherwise as `not-invoiced`. Only the first `not-invoiced` milestone has its "Invoice milestone <n>" button.
    - Pressing "Invoice milestone <n>" updates the view at once, within 100 milliseconds and before any response arrives: milestone `<n>` becomes `invoicing`, its button is removed, and focus moves to the "Milestone invoices" list. Because the button is gone, a double click sends one request.
    - On a 201, the milestone becomes `invoiced`, the pane takes the response's enquiry and version, the success copy shows in "Console status", and the next milestone's button appears.
    - On a 412, the pane loads the enquiry in the response as for any 412 and the list shows that enquiry's milestones; "Console status" shows the milestone 412 copy.
    - On any other response, or no response, the pane re-reads `GET /api/console/enquiries/<id>` and the list and buttons show that enquiry's milestones, with the pane taking its version and keeping any triage notes typed but not saved. If that re-read fails, the list and buttons return to how they were before the press. "Console status" shows the copy for that outcome from Feedback states.
    - **Second tab.** While the pane shows an enquiry in booked with a milestone still `not-invoiced`, and no invoice request from this pane is pending, it re-reads `GET /api/console/enquiries/<id>` every 2 seconds and updates the "Milestone invoices" list and the Invoice buttons from `proposal.invoiced_milestones`. So an invoice made in another tab shows here within three seconds. This re-read changes nothing else in the pane: not the version it holds, not the triage fields and not focus, except that when the focused Invoice button is removed, focus moves to the "Milestone invoices" list. Because the version is kept (so a later "Save triage" from this pane still merges as in DP-47 and DP-61 instead of overwriting newer triage), the first press of an Invoice button after another tab's invoice answers 412 and rolls back with the milestone 412 copy; the pane then holds the new version, and the next press is sent with it.
  - **Mail queue.** While the Settings view is open, it reads `GET /api/console/mail-queue` when it opens and every 2 seconds after that, so an email leaves "Pending emails" within three seconds of being sent or cancelled and a newly queued email appears within three seconds. Items are in the order the endpoint returns.
    - Each item's countdown is worked out from the item's `retry_at` and the response's `server_time`: the page notes the difference between `server_time` and its own clock when the response arrives, and redraws every countdown once a second from that corrected clock, between reads too.
    - While `retry_at` is null, the countdown reads "Sending". While the corrected clock is before `retry_at`, it reads "Next try in <s>s", where `<s>` is the whole seconds left, rounded up. From `retry_at` on, it reads "Retrying".
    - Reads and redraws never move focus and never change the time zone form.

### Visual design (DP-40, DP-41)

- **Colour roles.**
  - A near-black ground with an olive cast fills every viewport on every screen.
  - Warm parchment ink is used for all text.
  - A hot signal orange, like a peak light on a mixing desk, is used only for primary actions, the focus ring and the readout's needle mark.
  - An oxide green-teal, like tape oxide, is used for filled rungs, success states and the "Receipt sent" badge.
  - A dark olive grey is used for panels, dividers and empty rungs, and never for text.
  - All text and essential graphics meet WCAG 2.2 AA contrast against the ground.
- **Type.**
  - Bricolage Grotesque is the display face for titles and headings: a characterful grotesque with slightly quirky letterforms.
  - Inter is the body face.
  - JetBrains Mono is used for every numeral readout: intensity, amounts in tables, references, thresholds and claimed counts. It is styled like a tape counter or VU scale, with wide letter spacing and uppercase labels.
  - Each heading level is a quarter larger than the level below it, so station titles are about twice the body size, between 1.6 and 2.5 times it.
- **Density and composition.**
  - Spacing is generous, with wide margins and one idea per block.
  - Type stays restrained in the lower-left third, so the corridor is the main thing on screen.
  - The corridor is lined with procedurally generated acoustic panels (wedge foam, slatted diffusers and bass traps), different for each station.
  - The console reuses the palette in a compact two-pane list and detail layout.
  - Icons come from Lucide.
- **Controls.** Every tap target is at least 44 pixels in each direction. Buttons darken at once when pressed, and every focusable control shows a thick signal-orange focus ring.

### Motion and effects (DP-03, DP-04, DP-37, DP-38, DP-48, DP-52, DP-64, DP-65, DP-66)

- **Camera dolly (state change).** When a station becomes current, its data-camera reads `moving` and the camera travels from a wide shot of the corridor to close on that station's panel. The move takes just under one second, starting quickly and settling gently, and data-camera then reads `close`. When the station stops being current, the camera travels back to wide the same way, ending with data-camera `wide`.
- **Intensity counting (progress).** The readout and data-intensity follow the scroll position directly on every frame, with no easing and no lag beyond one frame.
- **Layer crossfade (state change).**
  - When a layer comes in, its volume rises along an equal-power curve and its rung bar fills from left to right, both in under half a second.
  - A layer going out does the reverse over the same time.
  - The corridor panels glow slightly brighter for each active layer, changing over the same time.
  - Layer volumes, the fade to silence and the panel glow have no attribute of their own. What a page publishes is each station's `data-intensity` and `data-camera`, its ladder's `data-active-layers`, the rung buttons' pressed state and the readout; the volume curves themselves live in the Web Audio code (DP-42), and muting means no layer is audible while those published values change exactly as with sound. Automated checks of DP-01 and DP-38 observe only these published values, the animations the page reports (the rung fills, the glow transition and the dolly) and whether a running audio context exists; the shape of each layer's volume curve is reviewed in the Web Audio source under DP-42.
- **Link-end fade (exit).** When an open private page learns its link has expired, been revoked or regenerated away, or its project withdrawn, every layer fades to silence within the limit in Business rules. The station then gives way to the link copy at once.
- **Gate exit and dialogs (enter and exit).** The gate fades out in under half a second. Console dialogs fade and rise in about a quarter of a second.
- **Press and hover feedback.** Buttons darken immediately on press and lighten slightly on hover.
- **Signature: the Intensity Ladder, step by step.**
  1. The station's chapter reaches the top of the viewport. The camera begins its dolly, the readout shows 000 and the bed rung fills.
  2. Over the next 1600 pixels of scrolling, the readout counts up to 100.
  3. As intensity passes each threshold, the pulse, lead and stinger rungs fill and their layers fade in.
  4. When the offset passes 1600, the station stops being current. Every layer goes out, the readout returns to 000, and the camera moves back to wide while the stage scrolls away. No station is current until the next chapter's top reaches the top of the viewport. That station then begins again at step 1.

  Scrolling back up repeats these steps in reverse: layers go out from the top rung down, and the readout counts down.
- **Complete list of motion.** The motions named above are the only animations in the product:
  - the camera dolly, just under one second;
  - intensity counting, every frame;
  - the layer crossfade with its rung fill and panel glow, under half a second;
  - the link-end fade, within the limit in Business rules;
  - the gate fade-out, under half a second;
  - console dialogs entering and leaving, about a quarter of a second;
  - button press and hover feedback, immediate.

  Nothing else animates. There are no idle or decorative loops: no drifting particles, no pulsing buttons and no animated backgrounds. Apart from the camera dolly and the panel glow, the corridor holds still. Rows appended by "Show more enquiries" or a reload appear at once. The "Reference upload" bar, the "Mail queue" countdowns, the "Milestone invoices" states and live option and count updates change in steps, with no animation.
- **Reduced motion.**
  - There is no camera move. data-camera reads `close` for the current station and `wide` for every other station, and switches instantly.
  - There is no scroll-linked counting.
  - Rung bars fill and empty instantly. The gate and dialogs appear and disappear instantly. The panel glow changes instantly.
  - Layer volumes, including the link-end fade, still cross over in under half a second, because sound is not motion.

### Feedback states (DP-01, DP-04, DP-05, DP-13, DP-14, DP-18, DP-19, DP-20, DP-26, DP-27, DP-28, DP-29, DP-31, DP-36, DP-47, DP-48, DP-49, DP-52, DP-55, DP-56, DP-57, DP-59, DP-60, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66)

Placeholders:
- `<Layer>` is "Bed", "Pulse", "Lead" or "Stinger".
- `<n>` is the intensity at that moment, clamped to 0 to 100, or a milestone number where the line says so.
- `<q>` is the search text.
- `<wait>` comes from the Retry-After value: "<s> seconds" when it is below 120 seconds, otherwise "<m> minutes", where `<m>` is Retry-After divided by 60 and rounded up.
- `<date>` is an instant written in the date-and-time format from Business rules, in the operator's current time zone when the screen is rendered.
- `<day>` is a calendar date written in the date-only format from Business rules.
- `<deposit>`, `<amount>` and `<floor>` are amounts written in the money format from Business rules, without the leading dollar sign, which each line prints itself.
- `<invoice number>` is the Kill Bill invoice number.
- `<layers>` is a comma-separated list of the missing layer names.
- `<claimed>` is the month's claimed count.

**Journey and private page**
- "Layer changes":
  - Each changed layer gets one sentence: "<Layer> in at intensity <n>." or "<Layer> out at intensity <n>.".
  - When several layers change in one step, their sentences are joined in the order the layers changed: layers coming in go from the lowest threshold up, and layers going out go from the highest threshold down.
- A station whose storage is unreachable, or whose stem is missing, shows "Audio is resting. Credits and notes are still here." under the blurb. The ladder still moves and nothing plays.
- If the journey data fails to load, "Layer changes" shows "The corridor could not load. Refresh to try again.".
- "Search status":
  - Pending: "Searching…"
  - Success: "<count> projects found."
  - No results: "No projects match “<q>”."
- NDA notice: "Private listening under NDA. This link stops working on <date>."
- "Link status":
  - Revoked, regenerated-away, unknown or withdrawn link: "This listening link is not available."
  - Expired link: "This listening link has expired. Ask Kettlehole Audio for a new one."
- "Brief status":
  - Pending: "Sending your brief…" (the button reads "Sending…").
  - Success: "Brief <reference> received. A receipt will follow by email."
  - Field errors: "Check the highlighted fields.", with each field's message from the 422 shown under that field.
  - 429: "You have sent several briefs in a short time. Try again in <wait>."
  - 413: "That file is too large. The limit is 10,000,000 bytes."
  - 415: "That file type isn’t accepted. Send WAV, OGG, MP3 or PDF."
  - 503: "Reference files can’t be stored right now. Send the brief without the file, or try again later."
  - Browser reference check (see Interactions), by the check that failed:
    - check 1, size: the same copy as the 413 above;
    - check 3, format chunk: "That WAV isn’t PCM or float audio. Send WAV, OGG, MP3 or PDF.";
    - check 4, channels: "That WAV must have one or two channels. Send a mono or stereo file.";
    - check 5, sample rate: "That WAV’s sample rate isn’t accepted. Use 22,050 to 96,000 Hz.";
    - check 6, decoding: "That WAV can’t be decoded. Send another file."
  - Brief connection lost, while automatic retries run: "Connection lost. Retrying your brief…"
  - Automatic brief retries ended without an answer: "We couldn't confirm your brief was received. Press Send brief to try again. It won't be sent twice."
  - Month full (the selected preferred month left the options): "<Month YYYY> is now fully booked. Choose another month or No preference."
  - Any other failure: "Something went wrong. Your brief was not sent."

**Proposal page ("Proposal status")**
- Accept pending: "Holding <Month YYYY>…".
- Accept success: "<Month YYYY> is held. Pay the deposit to confirm it."
- Already accepted, after a 409 illegal_transition from the accept or when a live re-read (see Interactions) finds the proposal accepted or later: "This proposal has already been accepted. The deposit invoice is below."
- Month taken (a 409 month_taken, or on load as described in Interactions): "<Month YYYY> has just been booked by another production. Ask Kettlehole Audio for another month."
- Expired: "This proposal has expired. Ask Kettlehole Audio for a new one."
- Closed: "This proposal is no longer open."
- Accept while billing is unreachable: "Billing is unreachable, so nothing was held. Try again in a few minutes."
- Deposit figures cannot be confirmed (deposit `billing` is `unreachable` on load): "Billing can’t be reached, so these deposit figures may be out of date."
- Pay pending: "Recording payment…".
- Pay request lost, while automatic retries run: "Connection lost. Retrying with the same payment…"
- Automatic retries ended without a 200: "We couldn't confirm the payment. Press Pay deposit to check again. You won't be charged twice."
- Pay success, or on load when the status is deposit_paid or booked: "Deposit received. <Month YYYY> is confirmed. A confirmation email will follow."
- Pay while billing is unreachable: "Billing is unreachable, so no payment was taken. Try again in a few minutes."
- Any other pay error: "The payment request was refused. Reload the page to see the current deposit."

**Console ("Console status")**
- Sign in: "Signing in…". On 401: "That email and password don’t match."
- Save project:
  - Success: "Project saved."
  - 409 slug_taken: "That slug is already used."
  - 422: "Check the highlighted fields."
- Stem upload:
  - Pending: "Uploading <Layer> stem…"
  - Success: "<Layer> stem stored."
  - 415: "That file isn’t a WAV or OGG stem."
  - 413: "That stem is over 20,000,000 bytes."
  - 422 on the file: "File name is not allowed."
- Save settings: success "Settings saved."; 422: "Choose a time zone from the list."
- Storage 503 on any console action: "Storage is unreachable. Uploads and publishing are paused until it returns."
- Project transitions:
  - Publishing a public project: "<title> is live in the journey."
  - Publishing an NDA project: "<title> is published for private links only."
  - 409 stems_incomplete: "Upload the missing stems first: <layers>."
  - Withdrawal: "<title> is withdrawn. Its stems are deleted."
  - Any 409 illegal_transition: "That move isn’t allowed from the current state."
- Listening links:
  - Create: "Link created. It stops working on <date>."
  - Revoke: "Link revoked. It stopped working immediately."
  - Regenerate: "New link created. The old one no longer works."
  - 409 link_not_active: "Only an active link can be regenerated. Create a new link instead."
- Triage: "Triage saved."
- A "Save triage" answering 412 with at least one conflicting field: "This enquiry changed in another window. Choose which value to keep for each field shown, then save again."
- A "Save triage" answering 412 with no conflicting field: "This enquiry changed in another window. Their changes are merged in; save again to apply yours."
- Any other enquiry write answering 412, except a milestone invoice: "This enquiry changed in another window. The latest version is shown; save again to apply your edit."
- Enquiries list fails to load more rows: "Older enquiries could not load. Press Show more enquiries to try again."
- Proposal:
  - Sent with mail delivered: "Proposal sent to <producer email>."
  - Saved with mail pending: "Proposal saved. The email is queued and will go out when mail is reachable."
  - Fee below the rate floor, shown under the fee field: "Below your rate floor of $<floor>."
  - Month full, shown under "Production month" while the selected month is full: "<Month YYYY> is now full. Choose another production month."
- Months:
  - Success: "Months saved."
  - 422 on capacity, shown under that month's capacity field: "Capacity can’t be below the <claimed> places already claimed."
- Start production: "Production started."
- Milestone invoice:
  - Success: "Milestone <n> invoiced: $<amount> on <day>." (`<n>` is the milestone number; `<day>` is the response's `invoice_date`.)
  - 409 milestone_mismatch: "Kill Bill already holds a different amount for milestone <n>. Nothing was invoiced."
  - 412: "This enquiry changed in another window. The milestones shown are the current state."
  - No response: "The request for milestone <n> got no answer. The milestones shown are the current state."
  - Any other error response, other than the billing 503 below: "Milestone <n> was not invoiced. The milestones shown are the current state."
  - "Milestone invoices" state copy: `not-invoiced` reads "Not invoiced", `invoicing` reads "Invoicing…", `invoiced` reads "Invoiced".
- Billing 503 on any console action: "Billing is unreachable. Nothing was invoiced."
- Mail queue:
  - Kind labels, by `kind`: `receipt` "Receipt", `alert` "New-brief alert", `proposal` "Proposal email", `month_held` "Month-held email", `deposit` "Deposit email".
  - `<address>` is the email's `to` address and `<countdown>` is the countdown text from Interactions.
  - When no email is pending, "Pending emails" is empty and the region shows "No emails are waiting."
  - When a read fails, the items stay as they were, their countdowns keep running, and the region shows "The mail queue could not refresh. Retrying…" until the next read succeeds.
- Delivery sentences (see Interactions): "Receipt for <reference> sent.", "Proposal email for <reference> sent.", "Month-held email for <reference> sent.", "Deposit email for <reference> sent."
- Enquiry badges:
  - The receipt badge reads "Receipt pending" until the SMTP server has accepted the receipt, then "Receipt sent".
  - A row with a proposal shows "Proposal email pending" until that email is accepted, then "Proposal email sent". Once that email is cancelled it shows "Proposal email cancelled" instead, permanently.
  - "Month-held email pending" then "Month-held email sent", and "Deposit email pending" then "Deposit email sent", work the same way for those two emails, which are never cancelled.

## Backend

### API (DP-05, DP-07 to DP-10, DP-12 to DP-15, DP-18 to DP-20, DP-22 to DP-29, DP-31 to DP-34, DP-43, DP-46 to DP-50, DP-52 to DP-54, DP-56, DP-58 to DP-60, DP-65, DP-66)

**Conventions**
- All bodies are `application/json; charset=utf-8`, except uploads (`multipart/form-data`), audio, files and CSV.
- Request size limits are in Server boundary.
- Every error body has the shape `{"error":"<code>","message":"<sentence>"}`, with the extra keys named below where they apply.
- Validation errors are `422 {"error":"validation","message":"<sentence>","errors":{"<field>":"<message>"}}`.
- **Writable fields only.** Every JSON request body accepts only the keys its row lists. Each other key, known or unknown, adds `"<key>":"Field is not writable."` to the 422 errors object, alongside any errors for listed fields. Such a request changes nothing: no version change, no Kill Bill call and no queued email.
- Numbers in JSON bodies must be JSON integers where the row says integer: `800000.5`, `"800000"` and `true` answer 422 on that field.
- Ids are UUIDs, money is in integer cents, timestamps are ISO 8601 with an offset and milliseconds, and calendar dates are `YYYY-MM-DD`.

**Error precedence (whole API).** Checks run in this order, and the first failure answers:
1. Unknown method on a known path: 405.
2. Cross-origin state change: 403 `cross_origin`.
3. Request too large: 413 `payload_too_large`.
4. Unparseable JSON: 400 `malformed_json`.
5. Missing console session on any console endpoint other than `POST /api/console/session`: 401 `unauthenticated`.
6. Brief endpoint only: an invalid Idempotency-Key answers 422 on `Idempotency-Key`. After that check, a request carrying a key is handled as in Brief idempotency in Business rules: a replay returns its stored response, and the two 409s for a key answer here. A replay is therefore never paced.
7. Rate limit: 429.
8. Unknown, withdrawn, revoked or out-of-scope resource: 404 `not_found`.
9. Deposit endpoint only: a missing or invalid Idempotency-Key answers 422. After that check, an idempotent replay returns its stored response.
10. Expired or closed: 410.
11. Console enquiry writes only:
    - missing If-Match: `428 {"error":"precondition_required"}`;
    - If-Match that does not equal the current ETag, including `*`: `412 {"error":"stale_version","current":Enquiry}`, with nothing changed.
12. State conflicts: 409.
13. File too large: 413 `file_too_large`. Unsupported content: 415 `unsupported_media`.
14. Field and query validation, including non-writable keys: 422.
15. A needed dependency is unreachable: 503 `storage_unavailable`, `billing_unavailable` or `database_unavailable`.

The endpoint rows below list only their own extra outcomes.

**Platform**
- `GET /api/health` → `200 {"status":"ok"}`. It answers whenever the process is up, whatever the state of the services.

**Public journey**
- `GET /api/journey` → `200 {"stations":[Station]}`.
  - Stations are the published public projects, in ascending position and then by title.
  - Station is `{"slug","title","credit_type":"shipped"|"jam"|"redesign","credit_label":"Shipped title"|"Game jam"|"Redesign","credit_line","role","blurb","tags":[str],"thresholds":{"bed","pulse","lead","stinger"},"playable":bool,"stems":[{"id","layer","url":"/api/stems/<id>"}]}`.
  - When playable is false, stems is `[]`.
- `GET /api/search?q=<text>` → `200 {"results":[{"slug","title","credit_label"}]}`.
  - Search is a case-insensitive substring match on title, credit line, blurb and tags, over published public projects only.
  - A q that is missing, empty or over 100 characters answers 422 on `q`.
- `GET /api/stems/<id>` → `200` with the stem bytes and `Content-Type: audio/wav` or `audio/ogg`. It answers 404 unless the stem belongs to a published public project.
- `GET /api/months` → `200 {"months":[{"month":"YYYY-MM","label":"<Month YYYY>"}]}`. It lists open months from the current month on, in ascending order.

**Private listening (read-only)**
- `GET /api/listen/<token>` → `200 {"station":Station,"expires_at":"<iso>","nda":bool}`. Stem urls here are `/api/listen/<token>/stems/<id>`.
- `GET /api/listen/<token>/stems/<id>` → `200` with audio, as for public stems.
- Errors for both endpoints:
  - 404 for an unknown, revoked or regenerated-away token, a withdrawn project, or a stem that belongs to another project.
  - `410 {"error":"link_expired"}` from the expiry instant on.
  - Any method other than GET on either path answers `405 {"error":"read_only"}` with `Allow: GET`.
- Every response on both endpoints, whether success or error, carries `Cache-Control: no-store`.
- The HTML page at `/listen/<token>` carries `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

**Enquiries (public)**
- `POST /api/enquiries` takes these multipart fields:
  - `name` (required)
  - `email` (required)
  - `studio` (required)
  - `brief` (required)
  - `preferred_month` (optional, `YYYY-MM`)
  - `project_slug` (optional)
  - `listen_token` (optional)
  - `attachment` (optional file)

  It answers `201 {"reference":"ENQ-000002","status":"new","receipt":"sent"|"pending"}`.
- It takes an optional `Idempotency-Key` header of 1 to 100 visible ASCII characters. A request without the header is never treated as a replay. An empty or invalid key answers 422 on `Idempotency-Key`. The replay rules are in Business rules under Brief idempotency.
- Validation answers 422. The messages are free text.
  - `name`: 1 to 120 characters, single-line text.
  - `email`: a bare address.
  - `studio`: 1 to 120 characters, single-line text.
  - `brief`: 20 to 4,000 characters, multi-line text.
  - `preferred_month`: must be an open month at the moment of saving.
  - `attachment` file name: as for stems.

  Single-line text, multi-line text and bare addresses are defined in Business rules.
- Extra errors:
  - `429 {"error":"rate_limited","message":"…","retry_after_seconds":<int>}` with a `Retry-After: <int>` header.
  - 413 `file_too_large`.
  - 415.
  - 503 `storage_unavailable`, only when an attachment is present.
  - `409 {"error":"idempotency_conflict"}` and `409 {"error":"request_in_progress"}`, only for a request carrying an Idempotency-Key.

**Proposals (producer)**
- `GET /api/proposals/<token>` → `200 {"reference","project_title","scope","fee_cents","currency":"USD","production_month":"YYYY-MM","production_month_label","month_open":bool,"milestones":[Milestone],"status","expires_at","deposit":null|Deposit}`.
  - Milestone is `{"number":1-4,"name","percent","amount_cents"}`.
  - Deposit is `{"invoice_number","killbill_invoice_id","amount_cents","balance_cents","paid":bool,"invoice_date":"YYYY-MM-DD","billing":"live"|"unreachable"}`.
  - Status is `proposal_sent`, `accepted`, `deposit_paid` or `booked`.
  - Errors: `410 {"error":"proposal_expired"}`; `410 {"error":"proposal_closed"}` when the enquiry was declined.
- `POST /api/proposals/<token>/accept` with body `{}` → `201 {"status":"accepted","deposit":Deposit,"email":"sent"|"pending"}`, where email is the month-held email.
  - `409 {"error":"month_taken","month":"YYYY-MM"}`.
  - `409 {"error":"illegal_transition","from","to":"accepted"}`.
  - The two 410s from the GET.
  - 503 `billing_unavailable`.
- `POST /api/proposals/<token>/deposit` with header `Idempotency-Key` and body `{"payer_name":str,"amount_cents":integer}` → `200 {"status":"deposit_paid","payment_id","invoice_number","amount_cents","paid_at","email":"sent"|"pending"}`, where email is the deposit-received email.
  - Idempotency-Key is 1 to 100 visible ASCII characters. A missing or invalid key answers 422 on `Idempotency-Key`.
  - `payer_name` is 1 to 120 characters of single-line text.
  - `409 {"error":"idempotency_conflict"}`.
  - `409 {"error":"request_in_progress"}`.
  - `409 {"error":"illegal_transition","from","to":"deposit_paid"}`.
  - 422 on `amount_cents` when it is not the deposit's `amount_cents`.
  - 503 `billing_unavailable`.

**Console (operator session cookie `earshot_session`, HttpOnly, SameSite=Lax)**

*Session*
- `POST /api/console/session` with `{"email","password"}` needs no session → `200 {"operator":{"email"}}`, and it sets the cookie. Wrong credentials answer `401 {"error":"invalid_credentials"}`, never `unauthenticated`.
- `DELETE /api/console/session` → `204`.

*Projects*
- `GET /api/console/projects` → `200 {"projects":[Project]}`. Project is `{"id","slug","title","credit_type","credit_line","role","blurb","tags","visibility":"public"|"nda","position","thresholds","status":"draft"|"in_review"|"published"|"withdrawn","stems":[{"id","layer","format":"wav"|"ogg","bytes","duration_ms"}]}`.
- `GET /api/console/projects/<id>` → `200 {"project":Project}`.
- `POST /api/console/projects` → `201 {"project":Project}` in draft. Its writable fields are `slug`, `title`, `credit_type`, `credit_line`, `role`, `blurb`, `tags`, `visibility`, `position` and `thresholds`; `id`, `status`, `stems` and any other key answer 422 as non-writable.
  - Optional fields and their defaults: tags `[]`, visibility `public`, position the next free position, thresholds 0/25/50/75.
  - Validation (422):
    - `slug`: 3 to 48 characters from lowercase letters, digits and hyphens.
    - `title`: 1 to 120 characters, single-line.
    - `credit_type`: one of the three values.
    - `credit_line`: 1 to 200 characters, single-line.
    - `role`: 1 to 120 characters, single-line.
    - `blurb`: 1 to 1,000 characters, multi-line.
    - `tags`: at most 10, each 1 to 30 characters, single-line.
    - `position`: an integer from 1 to 999.
    - `thresholds`: an object with exactly the keys bed, pulse, lead and stinger; the bed threshold is always 0; pulse, lead and stinger are integers from 1 to 100; and all four are strictly increasing from bed to stinger.
  - `409 {"error":"slug_taken"}`.
- `PATCH /api/console/projects/<id>` with any non-empty subset of the same writable fields → `200 {"project":Project}`.
  - `409 {"error":"project_withdrawn"}`.
  - The same 422 and 409 as create. An empty body answers 422 on `body`.
- `POST /api/console/projects/<id>/stems` with multipart `layer` (`bed`, `pulse`, `lead` or `stinger`) and `file` → `201 {"stem":{"id","layer","format","bytes","duration_ms"}}`.
  - 409 `project_withdrawn`.
  - 413 `file_too_large`.
  - 415.
  - 422 on `layer` or `file`.
  - 503 `storage_unavailable`.
- `POST /api/console/projects/<id>/transition` with `{"to":"in_review"|"draft"|"published"|"withdrawn"}` → `200 {"project":Project}`.
  - `409 {"error":"illegal_transition","from","to"}`.
  - `409 {"error":"stems_incomplete","missing":["lead"]}`.
  - 422 on `to`.
  - 503 `storage_unavailable` for `published` and `withdrawn`.

*Listening links*
- `POST /api/console/projects/<id>/links` with `{"label":str,"expires_at":"<iso>"}` → `201 {"link":Link}`.
  - Link is `{"id","label","token","url":"/listen/<token>","expires_at","status":"active"|"expired"|"revoked"}`.
  - `label` is 1 to 80 characters of single-line text.
  - 409 `illegal_transition` when the project is not in review or published.
  - 422 on `expires_at` when it is unparseable or outside the bounds in Business rules.
- `GET /api/console/projects/<id>/links` → `200 {"links":[Link]}`. Each status is computed at read time.
- `POST /api/console/links/<id>/revoke` with body `{}` → `200 {"link":Link}`.
- `POST /api/console/links/<id>/regenerate` with body `{}` → `201 {"link":Link}` with a new id and token.
  - `409 {"error":"link_not_active"}` when the link is expired or revoked.

*Enquiries*
- `GET /api/console/enquiries?status=<status>&limit=<n>&cursor=<c>` → `200 {"enquiries":[Enquiry],"next_cursor":str|null}`. All three query parameters are optional; the paging rules are in Business rules.
  - `status` is one of the eight enquiry statuses; absent means all statuses. Any other value answers 422 on `status`.
  - `limit` is an integer from 1 to 100 inclusive, default 25. Any other value, for example `0`, `101`, `2.5`, `abc` or an empty value, answers 422 on `limit`.
  - `cursor` is an opaque string taken from an earlier `next_cursor`. A cursor the server did not issue, an altered cursor, or a cursor sent with a different `status` from the one it was issued under (absent counts as its own value) answers 422 on `cursor`.
  - Enquiry is `{"id","reference","version","received_at","status","name","email","studio","brief","preferred_month","project_slug","attachment":null|{"filename","bytes","url"},"receipt":"sent"|"pending","triage_notes","fit_score","rate_floor_cents","proposal":null|Proposal}`.
  - Proposal is `{"token","url","producer_name","producer_email","project_title","scope","fee_cents","production_month","milestones":[Milestone],"expires_at","email":"sent"|"pending"|"cancelled","held_email":null|"sent"|"pending","deposit_email":null|"sent"|"pending","invoiced_milestones":[int]}`.
- `GET /api/console/enquiries/<id>` → `200 {"enquiry":Enquiry}`, with a strong `ETag: "<version>"` header, for example `ETag: "1"`.
- `GET /api/console/enquiries/<id>/attachment` → `200` with the file and `Content-Disposition: attachment`.

*Enquiry writes.* Every write below requires `If-Match: "<version>"`. Each one answers with the `ETag` of the version it created.
- `PATCH /api/console/enquiries/<id>` with a non-empty subset of the writable fields `triage_notes` (string, multi-line, 0 to 4,000 characters), `fit_score` (integer 1 to 5, or null) and `rate_floor_cents` (integer at least 0, or null) → `200 {"enquiry":Enquiry}`.
  - Any other key answers 422 as non-writable. That includes `status`, `version`, `reference`, `name`, `email`, `studio`, `brief`, `preferred_month`, `project_slug`, `attachment`, `proposal`, `receipt`, `received_at` and `id`.
  - An empty body answers 422 on `body`.
- `POST /api/console/enquiries/<id>/transition` with exactly `{"to":"qualified"|"declined"|"booked"}` → `200 {"enquiry":Enquiry}`.
  - 409 `illegal_transition`.
  - 422 on `to` for any other value.
- `POST /api/console/enquiries/<id>/proposal` with exactly the writable fields `{"producer_name","producer_email","project_title","scope","fee_cents":integer,"production_month":"YYYY-MM"}` → `201 {"enquiry":Enquiry}`.
  - Field rules:
    - `producer_name`: 1 to 120 characters, single-line.
    - `producer_email`: a bare address.
    - `project_title`: 1 to 120 characters, single-line.
    - `scope`: 1 to 2,000 characters, multi-line.
  - 409 `illegal_transition`.
  - 422 on `fee_cents` when it is out of range or below the rate floor.
  - 422 on `production_month` when the month is unknown, ended or not open.
  - 422 on any other field that breaks its rule.
- `POST /api/console/enquiries/<id>/milestones/<n>/invoice` with body `{}`, for n from 2 to 4 → `201 {"milestone":{"number","amount_cents","invoice_number","killbill_invoice_id","invoice_date":"YYYY-MM-DD"},"enquiry":Enquiry}`.
  - 404 for any other n.
  - 409 `illegal_transition` unless the enquiry is booked.
  - `409 {"error":"milestone_out_of_order"}`.
  - `409 {"error":"milestone_already_invoiced"}`.
  - `409 {"error":"milestone_mismatch"}`.
  - 503 `billing_unavailable`.

*Other console endpoints*
- `POST /api/console/milestones/preview` with `{"fee_cents":integer}` → `200 {"milestones":[Milestone]}`. 422 on `fee_cents`.
- `GET /api/console/enquiries.csv` → `200`, with `text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="earshot-enquiries.csv"`. It is never paged.
- `GET /api/console/months` → `200 {"months":[{"month","label","capacity","claimed","open":bool}]}`, for every month with a capacity set, from the current month on.
- `PUT /api/console/months/<YYYY-MM>` with `{"capacity":integer 0-12}` → `200 {"month":{"month","label","capacity","claimed","open"}}`. It creates or updates the month.
  - 422 on `capacity` when it is out of range or below the month's claimed count at the moment of the change.
  - 422 on the path month when it is badly formed or has already ended.
- `GET /api/console/mail-queue` → `200 {"server_time":"<iso>","emails":[{"kind":"receipt"|"alert"|"proposal"|"month_held"|"deposit","reference","to","queued_at":"<iso>","retry_at":null|"<iso>"}]}`. It takes no query parameters and is never paged.
  - `emails` holds every mail queue row that is pending at the moment of the read, and no sent or cancelled row. A proposal email that reads as cancelled at that moment (see Mail queue) is left out.
  - `to` is the bare address of the email's one To recipient. `server_time` is the server's clock at the read.
  - `retry_at` is as defined in Mail queue in Business rules.
  - Rows are ordered by `queued_at` ascending, then by reference ascending, then by kind in the order receipt, alert, proposal, month_held, deposit.
- `GET /api/console/settings` → `200 {"time_zone","operator_email"}`.
- `PUT /api/console/settings` with `{"time_zone"}` → `200` with the same shape. 422 when time_zone is not an IANA time zone name.

### Business rules (DP-04, DP-08 to DP-16, DP-19 to DP-36, DP-46 to DP-60, DP-65, DP-66)

**Money and the milestone split.**
- Fees are whole cents in US dollars, from 100 to 100,000,000 inclusive.
- There are four milestones:

  | Number | Name | Share |
  |---|---|---|
  | 1 | Deposit | 30% |
  | 2 | Vertical slice | 20% |
  | 3 | Content complete | 20% |
  | 4 | Final delivery | 30% |

- Milestones 1 to 3 are each the fee times their percent divided by 100, rounded down to a whole cent. Milestone 4 is the fee minus the other three, so it takes any remainder, and the four always add up exactly to the fee. For example, a fee of 499,999 cents splits into 149,999, 99,999, 99,999 and 150,002.
- The split is fixed when the proposal is sent. The console preview, the proposal email, the proposal page, the CSV and every Kill Bill invoice show those same figures.
- Kill Bill amounts:
  - Amounts sent to Kill Bill are written as decimal dollars with exactly two decimals, made from the integer cents without any binary floating-point arithmetic. For example, 435 cents is written as 4.35 and 30,000,000 cents as 300000.00.
  - Amounts read from Kill Bill are converted back to integer cents from their decimal digits, with no rounding step.
- **Writing money.** Every amount of money shown on screen or in an email is written as `$<amount>`:
  - a dollar sign;
  - the whole dollars, with comma thousands separators;
  - a point;
  - exactly two digits of cents.

  For example, 149,999 cents is written `$1,499.99` and 30,000,000 cents is written `$300,000.00`.
  - This format applies to the fee, the deposit, milestone invoice amounts and the rate floor.
  - It also applies to the four milestone amounts, wherever they appear: the "Milestones" table, the "Milestone preview" table, the proposal email and the month-held email.
- The "Fee (USD)" and "Rate floor (USD)" fields take plain decimal dollars with at most two decimals, with or without comma thousands separators and without a dollar sign, for example `4999.99` or `4,999.99`. "Rate floor (USD)" shows a stored floor as decimal dollars with exactly two decimals and no separators, for example `8000.00` for 800,000 cents. The money format above applies to amounts shown as text, not to the contents of these two fields.
- **Writing shares.** Each milestone's share is written as its whole percent followed by a percent sign, for example `30%`, wherever a "Share" column or a share appears.

**Text fields and addresses.**
- *Single-line text* contains none of the characters U+0000 to U+001F, U+007F, U+2028 or U+2029. That rules out carriage returns, line feeds and tabs. It applies to:
  - names (director, producer and payer);
  - studio;
  - project title, credit line, role and tags;
  - the proposal project title;
  - the link label.
- *Multi-line text* may contain line feed, carriage return and tab, but no other character from those ranges. It applies to the brief, blurb, scope and triage notes.
- A *bare address* has all of these properties:
  - at most 254 characters;
  - exactly one `@`, with a non-empty part before it;
  - a domain after it that contains at least one dot;
  - no whitespace, no control characters, and none of `<` `>` `,` `;` `"` `(` `)`.

  Display-name forms such as `Ann <a@x.example>` and lists such as `a@x.example, b@y.example` are therefore rejected.
- A field that breaks its rule answers 422 on that field. The request then saves nothing and queues no email.

**Project lifecycle.**
- The legal moves are:
  - draft → in_review
  - in_review → draft
  - in_review → published, only when all four layers have a stored stem. Otherwise it answers 409 stems_incomplete, listing the missing layers in ladder order.
  - draft, in_review or published → withdrawn
- Every other move answers 409 illegal_transition. That includes every move out of withdrawn, and draft → published.
- A project's status changes only through the transition endpoint; a status sent in a project body is a non-writable key.
- A withdrawn project cannot be edited or given stems: 409 project_withdrawn.
- Stems can be uploaded in draft, in review or published.
- A new stem for a layer replaces the old one. The new object is stored before the old one is deleted, so a published station never has a gap in that layer.

**Visibility.**
- A public project appears in the journey, in search and at public stem URLs only while it is published.
- An NDA project never appears in any of them, whatever its status.
- A project in review, whether public or NDA, is reachable only through a private link.

**Upload checks.** File types are judged by their bytes, never by the file name or the declared content type.
- **Stems** must be one of:
  - a WAV with a RIFF/WAVE header and a PCM or float format chunk, including a WAVE_FORMAT_EXTENSIBLE (0xFFFE) chunk whose subformat is PCM or IEEE float;
  - an Ogg stream whose first page carries a Vorbis or Opus header.

  A stem has one or two channels, a sample rate from 22,050 to 96,000 Hz inclusive, and a duration from 1 to 180 seconds inclusive. The size limit is 20,000,000 bytes, and exactly 20,000,000 is allowed.
- **References** must be one of:
  - a WAV or Ogg as for stems, with a duration of up to 600 seconds inclusive;
  - an MP3, which starts with an ID3 tag or an MPEG audio frame sync;
  - a PDF, which starts with `%PDF-`.

  The size limit is 10,000,000 bytes, and exactly 10,000,000 is allowed.
- Anything else answers 415. That includes SVG, HTML, ZIP and a file renamed to a .wav extension.
- A file name answers 422 when it is empty, is longer than 200 characters, or contains `/`, `\`, `..`, a NUL or any control character. Stored object names never use the uploaded file name.
- Nothing is stored for a rejected upload. A rejected attachment also means no enquiry is saved.

**Private listening links.**
- **Creating a link.** A link can be created only for a project in review or published.
  - Its `expires_at` must be strictly later than the server's current time.
  - It must be at most 31,536,000 seconds (365 days) after that time. Exactly 31,536,000 seconds is allowed.
  - Otherwise the request answers 422 on `expires_at`.
  - Tokens issued on create or regenerate carry at least 128 bits of randomness.
  - The seeded link in Seed data is the only exception to these bounds and to the token rule.
- **Status.** A link is active until it expires or is revoked.
  - It is expired from the instant the server clock reaches `expires_at`, compared to the millisecond.
  - From that instant, the page data and every one of its stem URLs answer 410. That includes stems requested by a page loaded before the expiry.
  - Revoking takes effect on the very next request: from the revoke response on, the page data and every stem URL on that token answer 404, including a stem URL a page already holds.
  - Revoked beats expired. Revoking an expired link answers 200 with status "revoked", and from then on the link answers 404.
- **Regenerating.** Only an active link can be regenerated. Regenerating revokes it and issues a new token with the same label and expiry. An expired or revoked link answers 409 link_not_active.
- **Withdrawal.** Withdrawing a project revokes all its links.
- **An open private page.**
  - While its link answers 200, the open page re-checks the page data every 5 seconds.
  - Within 6 seconds of a revoke, regenerate or withdraw response, a page open on the affected token has faded every layer to silence over at most 400 milliseconds, removed the station and shown the not-available copy.
  - Within 2 seconds after the expiry instant, a page open on that link has faded every layer to silence over at most 400 milliseconds, removed the station and shown the expired copy.
  - In every case the brief form stays usable.

**Withdrawal.**
- Withdrawing deletes every stem object of the project from storage before the status changes.
- If storage is unreachable, nothing changes and the request answers 503.
- After withdrawal, the project's public and private stem URLs, search entries, journey station and links answer not-found. Its slug is left blank in the CSV.

**Enquiry pipeline.**
- The states are new, qualified, proposal_sent, accepted, deposit_paid, booked, declined and expired.
- The legal moves are:
  - new → qualified (by the operator)
  - new, qualified or proposal_sent → declined (by the operator)
  - qualified → proposal_sent (by sending a proposal)
  - proposal_sent → accepted (by the producer accepting)
  - proposal_sent → expired (automatic, see Proposals and expiry)
  - accepted → deposit_paid (when the Kill Bill payment is recorded or adopted)
  - deposit_paid → booked (when the operator starts production)
- Every other move answers 409 illegal_transition with from and to. Declined, expired and booked are terminal.
- The console transition endpoint accepts only qualified, declined and booked. An enquiry's status, reference, contact fields, brief and version change only through the actions in these rules, never through a triage save.
- **Status at read time.** Every read, every filter and every export uses an enquiry's status at the moment of the read: an enquiry stored as proposal_sent whose accept link has passed its expiry instant is expired, everywhere.

**Enquiry versions.**
- Every enquiry has a whole-number version, starting at 1. Its ETag is the version in double quotes.
- Every write the app makes to an enquiry increases its version by exactly 1. These are:
  - a triage save;
  - qualify and decline;
  - sending a proposal;
  - the producer's acceptance;
  - the deposit being paid or adopted;
  - starting production;
  - each milestone invoice.
- Changes to email delivery state, including a proposal email being cancelled, do not change the version. Neither does an enquiry reading as expired. A rejected request never changes it.
- A console write applies only if its If-Match equals the version stored at the moment of the write. The comparison and the update happen as one step on the stored record. When N console writes carry the same current If-Match at once, exactly one succeeds and every other one answers 412 with the enquiry as it now stands.

**Paging the console enquiry list.**
- Enquiries are listed by reference, highest first, which is newest first.
- A page holds at most `limit` enquiries that match the status filter at read time.
- `next_cursor` records the reference of the page's last row and the status filter the page was read under. It is null exactly when no older matching enquiry exists at the moment of the read.
- The page after a cursor holds exactly the matching enquiries whose reference is lower than that cursor's last row, highest first. So briefs saved between two page reads never repeat a row or push one off a later page, and no row between the first and last page is skipped.
- A cursor issued by any running instance works on every instance.
- The CSV export is not paged.

**Triage and the rate floor.**
- Triage notes, the fit score (1 to 5) and the rate floor are private to the operator, and they can be edited in any state.
- When a rate floor is set, a proposal's fee must be at or above it. A fee below it answers 422 on `fee_cents`.

**Enquiry pacing.**
- Limits apply within a rolling window of ENQUIRY_RATE_WINDOW_SECONDS (default 600 seconds):
  - a sender email, compared in lowercase, may save at most ENQUIRY_LIMIT_PER_SENDER enquiries (default 3);
  - a client IP address may save at most ENQUIRY_LIMIT_PER_IP enquiries (default 200).
- **Pacing policy.** An instance's pacing policy is the three values ENQUIRY_LIMIT_PER_SENDER, ENQUIRY_LIMIT_PER_IP and ENQUIRY_RATE_WINDOW_SECONDS from its environment.
  - Each saved enquiry is counted under the policy of the instance that saved it.
  - A limit check counts only enquiries saved under the same policy as the instance making the check.
  - Instances running the same policy share one set of counts. Instances with different policies never affect each other's counts.
- Only saved enquiries count. The client IP is the connection's peer address, and forwarding headers are ignored.
- The limit check and the saving of the enquiry are one step, taken one at a time per sender and per IP across every running instance. So of N briefs from one sender or one IP that arrive at the same moment, exactly as many are saved as the limit still allows, and every other one answers 429.
- A request that would go over either limit answers 429 and queues no email. Its retry_after_seconds and Retry-After header give the whole seconds, at least 1, until the oldest counted enquiry for that limit leaves the window.
- Counts are kept in PostgreSQL, so every running instance with the same pacing policy shares them.

**Brief idempotency.**
- Each brief Idempotency-Key is its own namespace, separate from deposit keys. Its response is stored together with a fingerprint of the request: every multipart field's name and value, and the attachment's file name and the SHA-256 of its bytes, never the multipart boundary or the raw body.
- A request with the same key and the same fingerprint as a stored response returns the stored status and body. It saves no enquiry, queues no email and counts toward no pacing limit.
- The same key with a different fingerprint answers 409 idempotency_conflict.
- The same key while its first request is still running, on any instance, answers 409 request_in_progress.
- 201, 413 file_too_large, 415 and 422 responses are stored under the key. 413 payload_too_large is answered before the key is read (see Error precedence) and is never stored. 429 and 503 responses are not stored, so a retry with the same key is judged afresh.
- So however many times a brief is sent with one key, at most one enquiry is saved and its receipt and alert are queued once.
- **The brief form's automatic retry.** When a brief request ends without any HTTP response, or answers 409 request_in_progress, the form sends it again with the same Idempotency-Key, fields and file 3 seconds later, and keeps doing so every 3 seconds for up to 5 automatic attempts after the first request. It stops at the first response that is neither of those two.

**References and project context.**
- References are "ENQ-" followed by a six-digit sequence number.
- When `listen_token` names a link that is live at the moment of saving, the enquiry records that link's project slug.
- Otherwise `project_slug` is kept only when it names a published public project. In every other case it is stored blank, including when the link was expired, revoked or regenerated away.

**Proposals and expiry.**
- Sending a proposal requires a qualified enquiry. The production month must be the current month or later in the operator's time zone, and it must be open.
- The proposal token carries at least 128 bits of randomness.
- The accept link expires exactly PROPOSAL_LINK_TTL_SECONDS seconds after sending, checked on the server. The default is 1,209,600 seconds (14 days).
- From the expiry instant, a proposal still in proposal_sent answers 410 proposal_expired, and its enquiry reads as expired on every read.
- Expiry no longer applies once the proposal is accepted.

**Dates and the operator's time zone.**
- Every date and time shown to a person, on screen or in an email, is written as `<D> <Month> <YYYY>, <HH:MM>`:
  - the day without a leading zero;
  - the month's full English name;
  - the time in 24-hour form, with zero-padded hour and minute.

  For example: `9 November 2026, 14:05`.
- A calendar date on its own is written `<D> <Month> <YYYY>`, for example `9 November 2026`.
- Dates are written in the operator's time zone, using that zone's real offset at that instant, including daylight saving time and half-hour offsets.
- Month labels `<Month YYYY>` use the full English month name, such as "March 2027".
- Because the proposal TTL is an exact number of seconds, an expiry that crosses a daylight-saving change shows a different local hour from the sending time.

**Billing dates.**
- The Kill Bill account an acceptance creates is given, as its time zone, the operator's time zone from settings at the moment of acceptance. An account that already exists keeps the time zone Kill Bill holds; the app never changes an account's time zone.
- Every charge the app posts to Kill Bill (the deposit and milestones 2, 3 and 4) carries an item start date and a requested date equal to the operator's local calendar date at the moment of the request, worked out in the time zone in settings at that moment, daylight saving included. It is never the UTC date or the server's own date. For example, when it is 23:30 on 9 November in the operator's zone and already 10 November in UTC, the charge is dated 2026-11-09.
- `invoice_date` on the deposit and on a milestone is the start date of that invoice's item as Kill Bill holds it. For an adopted milestone invoice it is the date Kill Bill already holds, not the date of the request.

**Production months.**
- A production month is a calendar month in the operator's time zone, and that zone decides which month is current.
- Each month has a capacity. A month without a capacity set has capacity 0.
- A month's claimed count is always exactly the number of enquiries in accepted, deposit_paid or booked whose proposal names that month. It is never kept as a separately adjusted tally that could drift.
- A month is open while claimed is below capacity. That one figure decides openness everywhere it appears: the console Months table, `GET /api/months`, the proposal's `month_open`, the "Production month" options in Build proposal and the "Preferred production month" options in the brief form. A month that becomes full is absent from `GET /api/months` on the next request, and a brief or proposal naming it answers 422 on its month field.
- Capacity changes and acceptances for one month are taken one at a time on that month's record. A capacity below the claimed count at the moment the change is applied answers 422 and changes nothing, and an acceptance that finds the month no longer open after a capacity change answers 409 month_taken. Claimed therefore never goes above capacity, whatever order the two arrive in.

**Acceptance.**
- Accepting a proposal is one unit of work:
  1. Lock the enquiry.
  2. Check that it is in proposal_sent.
  3. Lock the proposal's month and check that it is open.
  4. Find or create the producer's Kill Bill account.
  5. Void any orphaned deposit invoice on that account.
  6. Create the deposit invoice.
  7. Move the enquiry to accepted, which is what claims the month's place.
  8. Queue the month-held email.
- **Several accepts of one proposal.** Because the enquiry is locked first, however many accepts of one proposal arrive at once, exactly one answers 201. Every other one answers 409 illegal_transition with from `accepted`, or from the enquiry's later state. The month's claimed count rises by exactly 1, even when the month has room for more.
- **Accepts of different proposals.** When acceptances of different proposals race for a month's last free places, they claim places in the order they lock the month until it is full. Every later one answers 409 month_taken.
- **The Kill Bill account.**
  - Acceptance first looks the account up by its external key and reuses it if it exists. That covers an account left from an earlier failed attempt and an account made by anyone else.
  - If creating the account is refused because the key is taken, acceptance looks it up again and reuses it.
  - Acceptance never creates a second account for a key, and a key that is already taken never causes a 5xx.
- **Orphaned invoices.** An orphaned invoice is any unpaid, non-VOID invoice on the account that no accepted enquiry records as its deposit. Acceptance voids these before creating the new deposit invoice.
- **Failure.** If any step fails, nothing is kept: no claim, no booking and no queued email. The enquiry stays in proposal_sent.
  - A deposit invoice the attempt already created is voided before the response.
  - If Kill Bill cannot be reached to void it, the response is still 503, and the next acceptance voids it as an orphan.
- Acceptance does not need mail, because the email is only queued.
- After any number of accepts, every read of the proposal shows the same `deposit.invoice_number`.

**Deposit money read-back.**
- Every proposal read that has a deposit reads the deposit invoice from Kill Bill. `amount_cents` is the invoice amount and `balance_cents` is its balance, both converted exactly. `paid` is true exactly when `balance_cents` is 0. `invoice_date` is as in Billing dates. `billing` is `live`.
- When Kill Bill is unreachable, the read still answers 200 with the last values read back and `billing` set to `unreachable`.
- Paying requires the request's `amount_cents` to equal the deposit's `amount_cents`.

**Deposit payment and idempotency.**
- Each Idempotency-Key belongs to its proposal. Its response is stored together with a fingerprint of the request body.
- **Replays and conflicts.**
  - A replay with the same key and the same body returns the stored status and body. It does not contact Kill Bill or queue mail.
  - The same key with a different body answers 409 idempotency_conflict.
  - The same key while the first request is still running answers 409 request_in_progress.
  - A new key after the deposit is paid answers 409 illegal_transition from deposit_paid.
  - Two different keys racing on one deposit produce one payment. The loser answers that same 409.
- **Before charging,** the app checks Kill Bill:
  - If a successful PURCHASE with transaction external key `earshot-<reference>-deposit` already exists, it is adopted. No new charge is made, and the response carries that payment's id.
  - Otherwise, if the invoice balance is already 0, that state is adopted, and the response carries the id of the payment that settled the invoice.
  - Otherwise the app records a PURCHASE for exactly the invoice balance.
- **On success,** whether paid or adopted, the enquiry moves to deposit_paid, the deposit-received email is queued exactly once, and the response is stored under the key.
- 503 responses are not stored, so a retry with the same key tries again.
- **The proposal page's automatic retry.** When a deposit request ends without any HTTP response, or answers 409 request_in_progress, the proposal page sends it again with the same Idempotency-Key and the same body 3 seconds later, and keeps doing so every 3 seconds for up to 5 automatic attempts after the first request. It stops at the first response that is neither of those two. A 503 is never retried automatically.

**Production and later milestones.**
- Starting production is the deposit_paid → booked move.
- Milestones 2, 3 and 4 can be invoiced only while the enquiry is booked. They must go strictly in order (otherwise 409 milestone_out_of_order) and once each (otherwise 409 milestone_already_invoiced).
- Invoicing a milestone holds the enquiry for the whole step: the version check, the Kill Bill work and the version increase happen together. Of N invoice requests for one milestone carrying the same current version at once, exactly one answers 201 and every other one answers 412. Kill Bill receives at most one new invoice for that milestone.
- Before charging, the app looks through the account's invoices for a non-VOID invoice with an item whose description is that milestone's description from Services:
  - if its amount equals the milestone's split amount, that invoice is adopted, no new charge is made, and the response carries its invoice number and the date Kill Bill holds;
  - if its amount differs, the request answers 409 milestone_mismatch and changes nothing;
  - otherwise the app creates one invoice for exactly the split amount, dated as in Billing dates.

**Private fields.** Triage notes, fit score and rate floor never appear in any of these:
- any email;
- the proposal API or page;
- the private listening API or page;
- the journey.

**Mail queue.**
- Every email is a row in an outbound queue in PostgreSQL. The row is keyed by the email's kind and its enquiry, so each email can exist only once.
- A row is pending, sent or cancelled. Sent and cancelled are final.
- The full message, headers and body, is rendered once when the row is queued and stored in the row. Delivery sends those stored bytes unchanged. Later edits to the time zone, a project or proposal title, or the enquiry never change a queued email.
- The instance that queues a row tries to deliver it straight away.
- **Hold after a failed attempt.** If that first attempt fails, the row is held. No instance tries it again until MAIL_RETRY_SECONDS have passed since that failed attempt.
  - The hold length comes from the environment of the instance that queued the row (default 10 seconds).
  - Only that first failed attempt sets the hold. A later failed attempt, by any instance, never extends it.
- **Retries.** Every running instance looks for due rows every MAIL_RETRY_SECONDS from its own environment, and tries each due row it can claim. A row is due once its hold has ended.
- **When mail returns.** Mail has returned for a row at the first attempt after its hold by an instance that can reach the SMTP server. The row is delivered at that attempt, without a restart. So an instance whose mail is unreachable never delays a row beyond its hold. An instance whose mail works delivers a due row within one of its own retry intervals after the hold ends.
- For example, suppose an instance with MAIL_RETRY_SECONDS of 45 queues a row while its mail is unreachable. That row cannot reach Mailpit sooner than 45 seconds after the failed attempt. Once the hold ends, an instance whose mail works and whose MAIL_RETRY_SECONDS is 10 delivers it within 10 more seconds.
- During a hold the row stays pending. A decline, or an accept-link expiry, that happens during the hold therefore always finds the proposal email still pending.
- An instance claims a row before trying it, so two instances never send the same row.
- A row is marked sent only after the SMTP server accepts it. Each delivered message therefore reaches Mailpit exactly once.
- **Cancelling a proposal email.** A proposal email that is still pending is cancelled, and never delivered, as soon as either of these happens:
  - the operator declines its enquiry;
  - its accept link reaches its expiry instant while the proposal is still in proposal_sent.

  The rules for cancelling are:
  - A decline marks a pending proposal email cancelled in the same step. From an accept link's expiry instant, a still-pending proposal email reads "cancelled" on every read, and its row is marked cancelled no later than the next delivery attempt that claims it.
  - Each delivery attempt checks, on the row it has claimed and at the moment of sending, whether the enquiry is declined or the proposal's `expires_at` is at or before now. If either holds, it marks the row cancelled and sends nothing.
  - A decline and a delivery attempt are taken one at a time on the mail row. A row the SMTP server has already accepted stays sent. A decline that finds the row claimed by a delivery attempt waits for that attempt's outcome. The result is always either one delivered email shown as sent, or no email shown as cancelled.
  - Only proposal emails are ever cancelled. Receipts, alerts, month-held emails and deposit-received emails are delivered once queued, whatever later happens to the enquiry.
- **Next try.** A pending row's `retry_at` is null until its first delivery attempt has failed. From then on it is the end of the row's hold: the instant of that first failed attempt plus the hold length. It never changes after that, because a later failed attempt never extends the hold.
- **Delivery fields in responses.**
  - In the enquiry, accept and deposit responses, the `receipt` or `email` field is "sent" when delivery succeeded before the response, and "pending" otherwise.
  - In console reads, `receipt`, `proposal.email`, `proposal.held_email` and `proposal.deposit_email` give each email's queue state at the moment of the read. Each is null before that email has been queued.

**CSV export.**
- The header row is exactly `reference,received_at,status,name,email,studio,brief,preferred_month,project_slug,fit_score,receipt`.
- There is one row per enquiry, by reference highest first. received_at is in UTC. status is the read-time status value. The slug is blank for withdrawn projects.
- Fields that contain a comma, a quote or a line break are quoted, with quotes doubled.
- A cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return gets a single quote `'` added before its value.

### Services (DP-12, DP-13, DP-21, DP-25, DP-28, DP-30, DP-31, DP-34, DP-36, DP-46, DP-49, DP-50, DP-51, DP-56, DP-59, DP-60)

- **PostgreSQL** is the source of truth for all of these:
  - projects and stem metadata;
  - links;
  - enquiries with their versions, and triage;
  - proposals and milestones;
  - months and settings;
  - rate-limit counts;
  - idempotency records;
  - the mail queue of fully rendered messages with their pending, sent or cancelled state.

  The app applies its schema and seed data idempotently every time it starts.
- **MinIO** (bucket from `S3_BUCKET`):
  - **Object keys.** Stems are stored at `projects/<project id>/stems/<stem id>.<wav|ogg>`. Brief attachments are stored at `briefs/<enquiry id>/<attachment id>.<wav|ogg|mp3|pdf>`.
  - **Access.** The bucket stays private. Every byte reaches browsers through the app.
  - **Playability.** A station is playable only when storage is reachable and all four of its stem objects exist. The app checks this no more than 10 seconds before answering. Each app process may reuse an answer storage gave for up to that long, but never a failed check, so the first request after storage returns checks it again.
  - **When MinIO is unreachable:**
    - The journey still answers 200, with playable false.
    - Stem URLs answer 503 storage_unavailable.
    - Stem uploads, publishing and withdrawal answer 503 and change nothing.
    - Briefs without an attachment are still saved. Briefs with an attachment answer 503.
    - The station and console copy are as given in Feedback states.
    - Everything recovers on the first request after storage returns.
- **Mailpit** receives the messages below, each exactly once, except a proposal email cancelled as in Business rules, which never reaches Mailpit even after mail returns.
  - Every message comes from the address in `MAIL_FROM`, which is `Kettlehole Audio <studio@kettlehole.example>`. It has exactly one To recipient and no Cc or Bcc.
  - Display names are quoted or encoded as the email standards require. Mailpit then shows each name exactly as typed, for example `Hale, Imogen "Imo"` or `Søren Ålund`, with the matching address.
  - Subjects containing non-ASCII text are encoded so that Mailpit's decoded subject is exact, for example `New brief ENQ-000007 from Ålborg Lydværk`.

  | Message | To | Reply-To | Subject |
  |---|---|---|---|
  | Enquiry receipt | the director, under their name | — | `Your brief reached Kettlehole Audio (<reference>)` |
  | New-brief alert | the operator email from settings | the director, under their name | `New brief <reference> from <studio>` |
  | Proposal | the producer, under their name | — | `Proposal <reference> from Kettlehole Audio: <project title>` |
  | Month held | the producer, under their name | — | `<Month YYYY> held for <project title>: deposit due` |
  | Deposit received | the producer, under their name | — | `Deposit received: <Month YYYY> confirmed for <project title>` |

  - The proposal and month-held bodies contain three things: the accept page URL `<APP_PUBLIC_URL>/p/<token>`, the four milestone amounts, and the accept-link expiry written in the date-and-time format from Business rules.
  - The receipt repeats the director's own brief, line breaks included.
  - When Mailpit is unreachable, every action still succeeds and its email waits in the queue, as described in Business rules.
- **Kill Bill** (tenant from `KILLBILL_API_KEY` and `KILLBILL_API_SECRET`):
  - **Account on acceptance.** There is one account for each accepted proposal. It has:
    - external key `earshot-<reference>`;
    - the producer's name and email;
    - company set to the enquiry's studio;
    - currency USD;
    - the time zone given in Billing dates;
    - a default payment method using Kill Bill's built-in external payment plugin.

    An existing account with that key is reused, never duplicated.
  - **Deposit invoice.** The deposit is one external charge on that account for milestone 1, with the description `Milestone 1 of 4: Deposit (<reference>)`, dated as in Billing dates. It produces one committed invoice, and the account never has more than one non-VOID deposit invoice. Orphaned invoices are voided as described in Business rules.
  - **Pay deposit.** Paying records one PURCHASE payment transaction against the deposit invoice for exactly its balance, with the transaction external key `earshot-<reference>-deposit`. That invoice's balance is then zero. An existing PURCHASE with that key is adopted instead.
  - **Later milestones.** Each later milestone is one external charge invoice on the same account, with the description `Milestone <n> of 4: <name> (<reference>)`, for exactly its split amount, dated as in Billing dates. An existing non-VOID invoice with that description is adopted or refused as described in Business rules. After milestone 4 the account holds exactly four non-VOID invoices whose amounts add up to the fee.
  - **Read-back.** The deposit's amount, balance, date and paid state shown anywhere are those Kill Bill holds at read time. The booking counts as confirmed only once Kill Bill has recorded the payment.
  - **When Kill Bill is unreachable:**
    - acceptance, deposit payment and milestone invoicing answer 503 billing_unavailable and leave no app-side change;
    - proposal reads fall back as described in Business rules.

### Seed data (DP-02, DP-07, DP-16, DP-22, DP-27)

Every person, studio and game in the seed data is invented. The app creates these records on start when they are absent, and it never recreates records the operator has changed or withdrawn.

- **Operator:** email `operator@kettlehole.example`, password `ladder-console-2026`.
- **Settings:** time zone `America/Toronto`; operator email `operator@kettlehole.example`.
- **Projects:**

| Position | Slug | Title | Credit type | Credit line | Role | Visibility | Status | Thresholds (bed/pulse/lead/stinger) | Tags |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `salt-flats-chase` | Salt Flats Chase | shipped | Ferrous Run, Brackwater Games, 2025 | Composer and audio implementer | public | published | 0/25/50/75 | chase, synth, adaptive |
| 2 | `lantern-moth` | Lantern Moth | jam | 48-hour jam build, 2026 | Solo audio | public | published | 0/20/45/80 | ambient, jam |
| 3 | `dredge-yard` | Dredge Yard | redesign | Audio redesign of a public gameplay capture | Sound designer | public | published | 0/25/50/75 | industrial, redesign |
| 4 | `glasshouse` | Glasshouse | shipped | Adaptive score for an unannounced title | Composer | nda | published | 0/30/55/85 | orchestral |
| 5 | `kiln-interior` | Kiln Interior | redesign | Work in progress | Sound designer | public | draft (no stems) | 0/25/50/75 | — |

  Each project's blurb is one or two sentences of the builder's own copy about that project.
- **Seed stems:**
  - Each of the four published seed projects gets four stems. They are synthesized by code at start and stored in MinIO.
  - They are mono 16-bit WAV at 22,050 Hz, exactly 8 seconds long, and loop cleanly.
  - The bed is a low drone, the pulse a rhythmic figure, the lead a melodic line and the stinger a short accented hit.
  - Each stem fades in over its first half second and peaks no louder than a quarter of full scale.
  - If storage is unreachable at start, the app retries every 10 seconds until the stems are stored.
- **Private link:** `glasshouse` has one active link labelled "Seed preview", with token `glasshouse-seed-preview`, expiring `2030-01-01T00:00:00.000Z`. Regenerating it issues a random token with the same expiry.
- **Months:** the six calendar months after the current month each have capacity 2 and no claims. The current month is decided in the seeded time zone at first start.
- **Enquiry:** `ENQ-000001`.
  - Status new, version 1, receipt sent, no attachment.
  - Name "Imogen Hale", email `imogen.hale@brackwater.example`, studio "Brackwater Games".
  - Brief: "Looking for an adaptive combat score for a roguelite with four intensity tiers."
  - Triage notes "SEED-PRIVATE-NOTE budget looks thin", fit score 3, rate floor 800000 cents.
  - The next enquiry gets `ENQ-000002`.

## Technical requirements

### Deployment (DP-43)

- The runtime is Node.js 22 with TypeScript.
- `/app/run.json` holds string commands for `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` answers as given in API.
- Several instances may run at once against the same services, each on its own port and each with its own environment. Every rule about locking, pacing, idempotency, paging cursors and the mail queue holds across instances.

### Configuration and secrets (DP-45)

The app reads these environment variables at start:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `APP_PUBLIC_PORT`
- `APP_PUBLIC_URL` (default `http://localhost:<port>`)
- `PROPOSAL_LINK_TTL_SECONDS`
- `ENQUIRY_LIMIT_PER_SENDER`, `ENQUIRY_LIMIT_PER_IP`, `ENQUIRY_RATE_WINDOW_SECONDS`
- `MAIL_RETRY_SECONDS`

No credential or service URL is hard-coded, logged in full, or sent to the browser.

### Server boundary (DP-44)

- **Origin check.** A state-changing request (POST, PUT, PATCH or DELETE) whose Origin header is present and is not the app's own origin answers 403 cross_origin. The app's own origin is the scheme, host and port of `APP_PUBLIC_URL`, compared exactly, so `http://localhost:4173` and `http://127.0.0.1:4173` are different origins. A state-changing request with no Origin header is accepted.
- **Body size limits.** A request body over its limit answers 413 payload_too_large before it is parsed. A body exactly at the limit is allowed.
  - JSON bodies: 65,536 bytes.
  - Enquiry requests: 10,500,000 bytes.
  - Stem uploads: 20,500,000 bytes.
- **What is served.** The server serves only the built front end, API responses and stored media. These all answer 404:
  - source files;
  - `run.json`, `.env` and `package.json`;
  - source maps of server code;
  - any path containing `..`.
- No response carries a stack trace.
- **Dependencies down at start.**
  - When PostgreSQL is unreachable at start, the server still starts. Health answers 200, other API calls answer 503 database_unavailable, and the server tries to reconnect every 5 seconds.
  - When MinIO, Mailpit or Kill Bill is unreachable at start, the server starts normally and behaves as described in Services. It recovers when the service returns, without a restart.

### Browser support and performance (DP-40, DP-42, DP-65)

- Supported browsers are current Chromium, Firefox and Safari, at 375x812, 768x1024 and 1280x800.
- The sound gate is visible and usable within three seconds of first load.
- Readout and ladder updates keep pace with scrolling at the display frame rate on a mid-range laptop.
- A page of enquiries appears within two seconds of opening the list or pressing "Show more enquiries".
- All audio playback, including the link-end fade, goes through a single Web Audio context whose output is that context's destination. Decoding a reference file for the brief form's check uses an `OfflineAudioContext`, which plays nothing.
- Where WebGL is unavailable, a still image of the corridor drawn by the app stands in, and every control and state still works.
- Fonts and scripts are served by the app itself, never from a third-party CDN.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every font, each with its licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, and fonts are under the SIL Open Font License 1.1.
- IF-04: No datastore other than the provided PostgreSQL and MinIO is added: no SQLite, no Redis, no file-based databases, and no in-memory state that has to survive between requests or across instances.
- IF-05: Server and browser source is written in TypeScript.
- IF-06: The repository contains no audio files and no image files other than icons; all audio and corridor graphics are generated by code.
- IF-07: The provided service configuration and seeded credentials are used as given and left unmodified.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` outside third-party type gaps.
- Names in code match this brief's domain terms: station, stem, layer, threshold, intensity, enquiry, version, triage, proposal, milestone, production month, claimed, deposit, listening link, cursor and business date.
- Each domain rule is decided in exactly one place in the source. These include each state transition, the read-time enquiry status, the milestone split, the cents-to-dollars conversion, the visibility rule, link status, the writable-field lists, the single-line and bare-address checks, the pacing limits, a month's claimed count and openness, the paging cursor, date formatting, the operator's local calendar date for billing, proposal-email cancellation and CSV neutralisation.
- Money is integer cents everywhere in the app, and it never passes through binary floating-point arithmetic.
- No abstraction has only one implementation, and there are no wrappers that only forward calls.
- There is no dead, commented-out or unreachable code, and there are no defensive checks for states the rules make impossible.
- Every error response is built through one consistent shape, the one defined in API.
- No feature, endpoint, screen or setting goes beyond this brief.
