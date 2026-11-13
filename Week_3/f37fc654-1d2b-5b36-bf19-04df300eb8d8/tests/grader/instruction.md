# Spindrift Rooms Spindrift Commission Stage

Spindrift Commission Stage is the commissioning desk of Spindrift Rooms, a studio run by one installation artist. The artist builds AI-driven interactive pieces (camera-reactive walls, generative portrait kiosks and voice-driven projection rooms) for brand pop-ups, museum lobbies and festival venues. A commissioning client briefs a piece one typed question at a time over a live model of their venue. The client then gets an AI concept preview in their own venue, places the piece in a model of the room, holds an install day and pays the deposit and the later milestones. Co-funding sponsors pay their own share from an invite link. The install crew gets alerts and confirms installation from a phone. The artist-producer runs every commission from one board. The product uses these services:

- Postgres for its records and its durable job table.
- Keycloak for sign-in.
- Kill Bill for every charge.
- Mailpit for email.
- MinIO for files.
- Gotenberg for PDFs.
- Svix for webhooks to each client's own CRM.
- ntfy for crew alerts.
- A generative-AI render provider's HTTP API, which WireMock stands in for.

Out of scope: other artists or studios (there is exactly one studio), real card processing (Kill Bill records payments against its external payment method), refunds, currencies other than US dollars, messaging between users, and any datastore beyond the services listed.

## Problem and users

Independent installation artists sell each AI interactive piece the way art commissions are sold. The client pays a deposit at signing, then milestone payments at concept approval, at fabrication and at signed acceptance. An optional maintenance retainer follows once the piece is on site. Today this runs through a portfolio site, email threads, a PDF contract template, a spreadsheet of deposits and a calendar of install days. Brand activations are often co-funded by two or three sponsors who each owe an agreed share. The artist works those shares out by hand and loses cents to rounding. Receipts don't match the contract. Two clients get promised the same install day. A venue photo sent for a concept preview vanishes when the render vendor times out. The client's CRM never hears that a milestone was paid. The artist pays in unpaid chasing time and refunds for double-booked days, and clients pay in missed launch dates.

- **Artist-producer** (daily): runs every commission alone, from brief to maintained installation, and needs money, install days, renders and documents to agree across every system.
- **Commissioning client** (weekly): briefs a piece, sees an AI concept preview in their own venue, places the piece in a model of the room, holds an install day and pays the deposit and milestones.
- **Co-funding sponsor** (occasional): opens an invite link, sees only their own share of a co-funded commission and pays it.
- **Install crew lead** (weekly): gets install-day alerts on the crew topic and confirms on-site milestones from a phone.

## Journeys

1. **Brief a piece.** Start state: a signed-out visitor on the landing route `/`. The visitor presses "Start a commission" and answers the first question at `/brief/new?step=1`. When asked, they sign in through Keycloak and come back to the same step with their answer saved. They then answer the remaining five questions by keyboard. Each answer reshapes the venue stage behind the question. End state: the room-ready screen of a new commission in state Briefed, at `/c/<commission id>`.
2. **See the piece in the venue.** Start state: a Briefed commission. The client uploads a venue photo and a GLB model on `/c/<commission id>/files` and hears each stored size and SHA-256. On `/c/<commission id>/preview` the client requests a concept preview and hears its progress and completion. On `/c/<commission id>/configure` the client places every required piece, chooses size and extras and watches the quote recount. End state: the commission is Placed and shows a saved quote.
3. **Hold a day and pay the deposit.** Start state: a Placed commission. On `/c/<commission id>/day` the client holds a free venue day and sees the countdown. On `/c/<commission id>/checkout` the client signs the agreement and pays the deposit in the payment sheet. End state: the commission is Contracted, the install day is booked, a receipt is in the client's inbox, the contract PDF is listed and the crew topic has a slot-confirmed alert.
4. **Co-fund a commission.** Start state: the producer has set two sponsors on a held commission. Each sponsor opens the emailed invite link at `/i/<token>`, sees only their own share, signs in and accepts, then pays. End state: each sponsor is on `/c/<commission id>/share` with their share shown as Paid, and the producer's board showed each payment as it arrived.
5. **Deliver and maintain.** Start state: a Contracted commission. The client approves the concept and pays that milestone. The producer starts fabrication and the client pays it. The assigned crew lead confirms installation from a phone. The client signs acceptance and pays it, then starts a maintenance plan and later switches plans. End state: the commission is Maintained and shows Kill Bill's proration for the switch.
6. **Run the studio.** Start state: the producer is signed in on `/studio`. The producer follows commissions on the board, opens the CRM delivery log of a commission and watches a crew-alert job wait through an alert service outage and then complete once. End state: the job shows Done with one alert on the topic.
7. **Crew day on a phone.** Start state: a crew lead assigned to a booked day, on a 375-pixel-wide phone. The crew lead opens `/crew`, opens the day sheet and presses "Confirm installation". End state: the commission is Installed and the day sheet shows the confirmation.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Browser-bound sign-in** Sign-in goes through Keycloak with a fresh state and code challenge per attempt, and a callback with a missing, reused or other-browser state shows the published sign-in error and creates no session.
- **DP-02 — Seeded accounts and roles** At start the app ensures the four roles and the seeded Keycloak accounts exist, gives a first-time self-registered user the client role, and lands each role on its published route after sign-in.
- **DP-03 — Expired access resumes the action** When access expires during a request the browser refreshes once, shared by concurrent requests, and replays the original request with its payload; a failed refresh shows the published signed-out message and keeps what was entered.
- **DP-04 — Sign-in returns to the interrupted step** A client who signs in from the brief or checkout comes back to the interrupted step with the pending answer saved once, at that step's published address as qualified in Interactions, and reloading that address shows the same screen.
- **DP-05 — Brief answers saved per step** Each brief answer is validated and saved on the server step by step in order with the published field errors, and completing all six steps creates one commission in state briefed.
- **DP-06 — Stage reshaped by answers** After each saved answer the venue stage publishes and shows the new room size, installation silhouette and dust density within the published time.
- **DP-07 — Venue search answers the latest query** The venue field shows suggestions only for the latest text typed, even when an earlier search answers later.
- **DP-08 — Cue-line typing sequence** Each brief question types in on the published letter schedule with the guide cursor and colour trail and then reveals its answer controls, and under reduced motion it appears whole at once.
- **DP-09 — Cue-line Brief journey** A client completes the six-question brief by keyboard alone with focus on the first answer control of each new question, and ends on the room-ready screen of their new commission.
- **DP-10 — Upload limits and byte-exact storage** Briefs, venue photos and GLB models are accepted only within the published type and size limits judged by content, stored byte-exact with their SHA-256, and shown as Stored only after the file store confirms.
- **DP-11 — Upload announcements** Each upload's progress and result, including the stored size and SHA-256, is announced word for word in the Upload status live region.
- **DP-12 — Venue files journey** A client uploads a venue photo and a GLB model from the files screen and sees each listed as Stored with its size and SHA-256.
- **DP-13 — Render requests reach the provider** A concept preview request becomes a durable render job that submits the venue photo, brief and layout to the render provider exactly as published.
- **DP-14 — Safe reference-image fetching** A reference-image address that leads, directly or after any redirect, to a loopback, private, link-local or metadata address is refused with the published error and never contacted.
- **DP-15 — Verified render callbacks** Render callbacks are accepted only with a valid signature and a fresh timestamp, a replayed or out-of-order callback changes nothing, and a render is Ready only after its preview is stored.
- **DP-16 — Concept preview journey** A client requests a preview, hears its progress and completion in the Preview status live region, and sees the preview image on their commission.
- **DP-17 — Server-validated placements** The server accepts a layout only when every piece sits inside the room, no pieces overlap, the door clearance is kept and positions are snapped, and it answers each failure with the published message.
- **DP-18 — Layout versions** Saving a layout over a newer version answers 412, and the configurator then shows the latest layout with the published conflict copy.
- **DP-19 — Keyboard and touch placement** Pieces move by the published keys and by drag and fling with touch or mouse, snap to the quarter-metre grid and are saved on drop, with the same function under reduced motion.
- **DP-20 — Configurator breakpoints** The configurator shows scene and inspector side by side from 1200 pixels wide, stacked from 768 to 1199 pixels, and as a scene with a collapsible bottom sheet below 768 pixels.
- **DP-21 — Live quote recount** Configurator choices update the quote in place from the server's reply to the latest choice only, recounting the numerals and announcing the total in the Quote total live region.
- **DP-22 — Configure-the-room journey** A client places every required piece, chooses size and extras and saves the quote, and the commission reaches state placed.
- **DP-23 — Install days in the venue's zone** Install days are whole calendar days in the venue's time zone with one install per day, including days that change to or from daylight saving time.
- **DP-24 — One winner per venue day** Of any number of simultaneous holds for the same venue day exactly one succeeds, and the others receive the published taken response with the next free days.
- **DP-25 — Server-decided hold deadline** A hold ends at the server instant HOLD_SECONDS after it was recorded and is judged on the server at that exact edge, and the countdown follows the server's remaining time, never the device clock.
- **DP-26 — Hold journey** A client holds a free day and watches the countdown, and when the hold ends mid-checkout keeps the open payment sheet and entered data and sees the published hold-ended state.
- **DP-27 — Exact quote and milestone amounts** Quotes, tax and every milestone and share amount are integer cents computed by the published rules, and they match the Kill Bill invoice, the receipt and the invoice PDF.
- **DP-28 — Quote validity** A saved quote is usable through its validUntil second and is refused at checkout from the next second, as qualified in Business rules.
- **DP-29 — Idempotent payments** Every payment request carries an idempotency key; replays and concurrent duplicates return the original response with one Kill Bill payment, and a reused key with a different request answers 409.
- **DP-30 — Paid only after Kill Bill confirms** A milestone or share becomes Paid, enters the ledger and produces its receipt and CRM event only after Kill Bill confirms the payment, and none of these appear when the payment fails.
- **DP-31 — Checkout journey** A client with a held day signs the agreement and pays the deposit by keyboard alone, and sees the commission contracted with its install day booked.
- **DP-32 — Funder shares by basis points** Funder shares are basis points summing to 10000, split to the cent by largest remainder with ties going to the earlier funder, so the shares always add up to the total.
- **DP-33 — Sponsor invite links** A sponsor invite link shows only that sponsor's share and the public summary, changes nothing without sign-in, expires on the server after INVITE_TTL_SECONDS, and stops working when revoked or reissued.
- **DP-34 — Sponsor journey** A sponsor opens the invite link, signs in, accepts, lands on /c/<commission id>/share and pays their share.
- **DP-35 — Commission state machine** Commissions move only along the published transitions by the published roles, and every illegal move answers 409 with the published body.
- **DP-36 — Milestone invoices and due dates** Each milestone is invoiced in Kill Bill on its triggering event, with a due date computed on the server as 14 days later at 23:59:59 in the venue's time zone.
- **DP-37 — Frozen contract and invoice PDFs** The contract PDF is rendered at signing and each invoice PDF at issue, both are stored with their SHA-256 and never rewritten, and a later change makes a new document.
- **DP-38 — Milestone journey** The client approves the concept, the producer starts fabrication, the crew lead confirms installation and the client signs acceptance, with each paid milestone unlocking the next step.
- **DP-39 — Signed CRM events with delivery log** Slot, contract, milestone and maintenance events reach the client's CRM endpoint through Svix with one event id each, and the client and producer see every delivery attempt and its final state.
- **DP-40 — CRM journey** A client saves their CRM endpoint, pays a milestone and sees that delivery with its attempts on the deliveries screen.
- **DP-41 — Crew alerts** Slot-confirmed, day-before load-in and placement-changed alerts reach the crew topic once each with the published titles, including after an alert service outage.
- **DP-42 — Crew see only their days** A crew lead sees and acts on only the install days they are assigned to, and any other day answers 404.
- **DP-43 — Crew day journey on a phone** A crew lead on a phone opens the install-days list, opens their day sheet and confirms installation.
- **DP-44 — Maintenance subscription** After the acceptance milestone is paid the client starts a monthly maintenance plan billed in advance by Kill Bill, and the commission becomes maintained.
- **DP-45 — Mid-cycle plan change** A plan change takes effect immediately from the venue-local date, Kill Bill prorates it, and the app shows Kill Bill's invoice items and amounts.
- **DP-46 — Maintenance journey** A client starts maintenance, switches plans and sees Kill Bill's proration on the maintenance screen.
- **DP-47 — Durable jobs exactly once** Every render, PDF, email, crew-alert and webhook job is stored in Postgres, survives an app restart or service outage, and takes effect exactly once within 30 seconds of its service answering again.
- **DP-48 — Live commission board** The producer's board updates in place within 2 seconds of any confirmed payment and announces it in the Board updates live region.
- **DP-49 — Outage banners and degraded behaviour** When a service is unreachable every screen shows its published banner word for word, and each action behaves as published for that outage.
- **DP-50 — Producer journey** The producer sets funders, watches sponsor payments arrive on the board and follows a job through an outage to completion.
- **DP-51 — Scroll-scrubbed landing stage** The landing stage moves its camera through five published keyframes as the visitor scrolls and reverses on scroll back, while the headline types in.
- **DP-52 — Case-study sheet and navigation drawer** Case-study sheets and the mobile navigation drawer open as dialogs that keep focus inside, close with Escape and return focus, and when closed nothing inside them can be seen or reached.
- **DP-53 — Reduced motion and still fallback** Under reduced motion every sequence shows its end state at once with the same controls, and without WebGL a published still frame carries the same content.
- **DP-54 — Landing journey** A visitor on a phone scrolls the landing stage, opens a case study and starts a commission into the first brief question.
- **DP-55 — Object-level access** Every route checks that each id, including ids inside request bodies, belongs to the caller, and answers 404 for any that does not.
- **DP-56 — Platform and server boundary** The app runs from the published run manifest, answers the health check, enforces the published body limits and serves nothing but the app.
- **DP-57 — Keyboard and dialogs** Every action works by keyboard, dialogs keep Tab inside and return focus to their opener, and published shortcuts work whichever control in their region has focus.
- **DP-58 — Responsive viewports** Every screen fits 375x812, 768x1024 and 1280x800 with no sideways page scrolling and with controls at least 44 pixels in both dimensions.
- **DP-59 — Nocturnal stage look** Every screen sits on the near-black stage with the electric-blue light field, the published typefaces and the single corner rule, with ink contrast of at least 4.5:1.
- **DP-60 — Provider-backed state in source** The source reads every credential from the environment and derives paid, stored, ready and delivered states from the providers' answers, never from local flags.

## Frontend

### Screens and layout (DP-06, DP-12, DP-16, DP-20, DP-22, DP-26, DP-31, DP-34, DP-43, DP-50, DP-58)

One fixed full-bleed venue stage stays mounted across every route and never reloads between screens. Every screen is a centred column about 640 pixels wide laid over the stage. Tables widen their column to about 1040 pixels. At 768 pixels and below, the column fills the width less 16 pixels on each side. The page never scrolls sideways at 375x812, 768x1024 or 1280x800. A table wider than its column scrolls inside its own labelled container.

A top bar holds the wordmark link "Spindrift Rooms" (to `/`) and the links for the signed-in role:

- Client: "Commissions" and "CRM settings".
- Producer: "Studio" and "Jobs".
- Crew lead: "Install days".
- Sponsor: no links.

It also holds "Sign in" or "Sign out". From 768 pixels up the links sit in the bar. Below 768 pixels they move into the navigation drawer, opened by the "Menu" button.

Routes and screens:

- **`/` Landing.** The full stage shows a camera-reactive wall standing on the grid. The typed headline sits in the column, and five caption sections scroll over the stage, followed by a "Recent commissions" section of three case-study cards. The cards sit in one row of three at 1280, two per row at 768 and one per row at 375.
- **`/brief/new?step=1` and `/briefs/<brief id>?step=<n>` Cue-line Brief.** Which address shows which step is set out under Interactions. The stage is at full brightness. One question per screen sits centred at about 44% of the viewport height on desktop and about 27% on phones. The answer chips, the underlined answer field and the OK row with its key-chord hint sit below the question. The close chip is fixed at the top right. Chips sit four in a row on desktop, filling the column, and two per row on phones.
- **`/commissions` Client commissions.** A list of the client's commissions showing title, state, venue and next due amount. When there are none, it shows the typed empty question.
- **`/c/<commission id>` Commission overview** (client owner and producer). It shows the title, a state badge and the venue. Below that are the "Milestones" table (Milestone, Amount, Due, State, Invoice), the "Documents" list, the "Funders" section (editable by the producer), the "Ledger" table and links to Files, Preview, Configure, Install day, Checkout, CRM deliveries and Maintenance. After the brief completes, this page opens with the room-ready line typed as its heading.
- **`/c/<commission id>/files` Files.** Three upload controls and the "Files" list. Each row shows the file name, kind, size in bytes, SHA-256 and the "Stored" badge.
- **`/c/<commission id>/preview` Concept preview.** The venue-photo picker, the optional reference-image address field, the "Request preview" button, the preview progress bar and, when ready, the preview image at the full column width.
- **`/c/<commission id>/configure` Configurator.** The stage becomes the room scene, and the inspector holds the pieces list, the size and extras choices and the quote. Its layout depends on viewport width:
  - From 1200 pixels up, the scene fills the left and a 360-pixel inspector sits on the right.
  - From 768 to 1199 pixels, the scene takes the top 55% of the viewport and the inspector sits below it at full width.
  - Below 768 pixels, the scene fills the screen and the inspector is a bottom sheet behind the "Show inspector" handle. The open sheet covers the lower 60% of the screen.
- **`/c/<commission id>/day` Install day.** A month calendar of the venue's days (seven columns at every size) with Previous and Next month buttons, the hold status and the countdown.
- **`/c/<commission id>/checkout` Checkout.** The review (quote lines, payment schedule, funders), the signature form, the countdown and the "Pay deposit" button, which opens the payment sheet. On phones the payment sheet is a bottom sheet. From 768 pixels up it is a centred panel about 480 pixels wide.
- **`/c/<commission id>/share` Sponsor share.** The public summary (title, venue, installation type, studio name), the sponsor's own share (percent, work, sales tax, total, due date, state) and "Pay my share".
- **`/c/<commission id>/webhooks` CRM deliveries.** The "CRM deliveries" table with one row per event (Event, Type, Created, Attempts, Final state). Each row opens its attempts.
- **`/c/<commission id>/maintenance` Maintenance.** The plan choice, the current plan with Kill Bill's charged-through date, and the "Proration" table after a switch.
- **`/i/<token>` Sponsor invite.** The public summary and the sponsor's share, the "Accept and sign in" button, and the expired or invalid state.
- **`/studio` Studio board** (producer). The "Commissions" table with the columns Commission, Client, State, Install day, Paid and Next due.
- **`/studio/jobs` Jobs** (producer). The "Jobs" table with the columns Kind, Commission, Status, Attempts, Last error and Finished.
- **`/crew` Install days and `/crew/days/<install day id>` Day sheet** (crew lead). The list shows assigned days. The day sheet shows venue, date, commission title, client name, the pieces with positions, the scheduled load-in alert and "Confirm installation". On phones the list is a single column of full-width rows.
- **`/settings/crm` CRM settings** (client). The endpoint field, "Save endpoint" and the signing secret.

On working screens (every route except `/` and the brief) the stage keeps running behind the content, with the grid slowed and the light field dimmed to about two fifths of its landing brightness.

### Public screens and controls (DP-01, DP-04, DP-07, DP-09, DP-11, DP-16, DP-19, DP-20, DP-21, DP-26, DP-34, DP-43, DP-48, DP-49, DP-51, DP-52, DP-57)

Only the roles, names and copy below are public; everything else is free. `<n>`, `<label>`, `<amount>` and `<date>` follow the formats under Feedback states.

| Where | Role and accessible name | Visible copy / notes |
|---|---|---|
| Every screen | `img "Venue stage"` | The stage canvas or its still frame. It carries the attributes `data-scene` (`landing`, `brief`, `configurator` or `working`), `data-motion` (`animated`, `still` or `fallback`), `data-keyframe` (0 to 4 on the landing), `data-room-width` and `data-room-depth` (metres, empty before answered), `data-silhouette` (`none`, `camera-reactive-wall`, `portrait-kiosk` or `projection-room`) and `data-dust` (particle count) |
| Every screen | `status "Service notices"` | Holds one banner per unreachable service, pinned top-centre |
| Every screen | `status "Notices"` | Toasts; each stays 6 seconds |
| Top bar | `link "Spindrift Rooms"`, `link "Sign in"`, `button "Sign out"` | |
| Top bar, below 768 px | `button "Menu"` opening `dialog "Navigation"` with `button "Close menu"` | Drawer from the right |
| Landing | `heading` level 1 | `Light for dark rooms, made to commission.` It carries the same typing markers as the brief heading |
| Landing | `link "Start a commission"` | Goes to `/brief/new?step=1` |
| Landing | five `heading` level 2 captions | `A wall that sees the room.` · `It answers the people in front of it.` · `Built for one venue, by hand.` · `Up close, it's light.` · `In your room, on your day.` |
| Landing | `button "Tidewall"`, `button "Second Face"`, `button "Echo Vault"` opening `dialog "<case study title>"` with `button "Close case study"` | |
| Brief | `heading` level 1 | Its accessible name is the whole question from the first moment; see the questions table under Interactions. It carries `data-typed`, the number of characters shown so far, from 0 up to the question's length. Each character of the question, spaces included, is its own element hidden from the accessibility tree, with `data-letter` set to `hidden`, `violet`, `cyan` or `white` |
| Brief | `radiogroup "<question>"` of `radio` chips, or `group "<question>"` of `checkbox` chips | Chip labels from the questions table |
| Brief | `textbox` named per step, `combobox "Venue"` with `listbox "Venues"` | Underlined answer field |
| Brief | `button "OK"` | Label "OK" followed by an arrow; unavailable until the step has an answer |
| Brief | key-chord hint (decorative text) | `ENTER ↵ · SHIFT+ENTER new line` on text steps, `ENTER ↵ to continue` on chip steps |
| Brief | `button "Close brief"` | Close chip, top right |
| Brief | `status "Brief progress"` | |
| Brief done | `link "Get a concept preview"` | |
| Files | `button "Upload brief PDF"`, `button "Upload venue photo"`, `button "Upload GLB model"` | Each opens a file picker |
| Files | `list "Files"`, `status "Upload status"` | |
| Preview | `radiogroup "Venue photo"`, `textbox "Reference image address (optional)"`, `button "Request preview"` | |
| Preview | `progressbar "Preview progress"` (0 to 100), `status "Preview status"`, `img "Concept preview"`, `link "Configure the room"` | |
| Configurator | `region "Room"` holding one `button` per placed piece named `<piece label> at <x> m, <y> m, turned <r>°` | Key-chord hint `ARROWS move · SHIFT+ARROWS 1 m · R rotate · ENTER ↵ drop` |
| Configurator | `list "Pieces to place"` with `button "Place <piece label>"` | |
| Configurator | `region "Inspector"`, `button "Show inspector"` / `button "Hide inspector"` (below 768 px, expanded state exposed) | |
| Configurator | `radiogroup "Size"` (Compact, Standard, Grand), `group "Extras"` of `checkbox` (Ambient sound, Night-mode lighting, Photo takeaway) | |
| Configurator | `region "Quote"` with its lines and total, `status "Quote total"`, `button "Save quote"`, `status "Placement status"` | |
| Install day | `grid "<month> <year>"` of day `button`s named `<date>, free` / `held` / `booked` / `unavailable` / `your hold` | |
| Install day | `button "Previous month"`, `button "Next month"`, `button "Hold <date>"`, `button "Release hold"`, `timer "Hold time left"`, `status "Hold status"` | Countdown shown as `<m>:<ss> left` |
| Checkout | `textbox "Full name as signature"`, `checkbox "I agree to the commission agreement"`, `button "Sign agreement"` | |
| Checkout | `button "Pay deposit <amount>"` opening `dialog "Payment"` | |
| Payment sheet | `textbox "Name on card"`, `textbox "Card number"`, `button "Pay <amount>"`, `button "Cancel"`, `status "Payment status"` | Test-mode note: `Test mode — no real card is charged.` |
| Hold ended | `heading "Your hold has ended"`, `button "Hold <date> again"` | Shown in place on checkout |
| Commission | `table "Milestones"`, `list "Documents"`, `table "Ledger"` | |
| Commission (client) | `button "Approve concept"`, `button "Sign acceptance"` | |
| Commission (producer) | `button "Start fabrication"`, `button "Cancel commission"` | |
| Funders (producer) | rows with `textbox "Sponsor name"`, `textbox "Sponsor email"`, `textbox "Share percent"`, plus `button "Add sponsor"`, `button "Save funders"`, `button "Resend invite"`, `button "Revoke invite"` | The share percent is typed with two decimals |
| Invite | `button "Accept and sign in"` | |
| Sponsor share | `button "Pay my share"` | |
| CRM settings | `textbox "CRM endpoint URL"`, `button "Save endpoint"` | The signing secret is shown as text |
| CRM deliveries | `table "CRM deliveries"` | |
| Maintenance | `radiogroup "Maintenance plan"`, `button "Start maintenance"`, `button "Change plan"`, `table "Proration"` | |
| Studio | `table "Commissions"`, `status "Board updates"` | |
| Jobs | `table "Jobs"` | |
| Crew | `list "Install days"`, `button "Confirm installation"` | |
| Session | `status "Session"` with `button "Sign in"` | |

### Interactions (DP-03, DP-04, DP-07, DP-09, DP-19, DP-21, DP-26, DP-31, DP-34, DP-43, DP-52, DP-54, DP-57)

**Brief questions.** The intro line `Hi. Six questions, then your room.` types first. It has no controls and shows only on `/brief/new?step=1`. The six questions follow:

| Step | Question | Answer controls |
|---|---|---|
| 1 | `What should stand in the room?` | radio chips "Camera-reactive wall", "Generative portrait kiosk", "Voice-driven projection room"; textbox "Name the piece" |
| 2 | `Where will it stand?` | combobox "Venue" (placeholder `Start typing the venue or address`) |
| 3 | `How big is the room?` | textbox "Width in metres", textbox "Depth in metres" |
| 4 | `Which wall has the main door?` | radio chips "Front wall", "Back wall", "Left wall", "Right wall" |
| 5 | `How many people at once?` | radio chips "Up to 25", "25 to 100", "100 to 300", "Over 300" |
| 6 | `Anything else to try?` | checkbox chips "Ambient sound", "Night-mode lighting", "Photo takeaway"; textbox "Notes for the studio" (multi-line, optional) |

**Brief keyboard and flow.**

- Focus moves to the first chip when a new question's controls appear. On steps 2 and 3, which have no chips, it moves to the first field.
- Tab order within a step: chips, then the fields, then OK, then the close chip. Arrow keys move between radio chips, and Space ticks a radio or checkbox chip.
- Enter anywhere in the step submits it. In the multi-line notes field, Shift+Enter adds a new line.
- Escape, or the close chip, leaves the brief: to `/commissions` when signed in, otherwise to `/`. Saved answers stay on the server.
- **Step addresses.** Step 1 of a new brief lives at `/brief/new?step=1`, and no draft exists yet. Opening `/brief/new` with any other `step` value, or with none, replaces the address with `/brief/new?step=1` and shows question 1.
- Pressing OK on step 1 at `/brief/new?step=1` while signed in creates the draft and saves step 1. Once the server answers, the address changes to `/briefs/<brief id>?step=2`, where `<brief id>` is the draft's id from the API.
- From then on every step of that draft, including step 1 when revisited, lives at `/briefs/<brief id>?step=<n>`. On each later submit the browser saves the step (DP-05) and, once the server answers, changes the address to `/briefs/<brief id>?step=<n+1>`.
- Opening or reloading `/briefs/<brief id>?step=<n>` shows question n with its saved answers filled in, when n is from 1 to the draft's `nextStep` (6 when `nextStep` is null). Any other or missing n replaces the address with `/briefs/<brief id>?step=<nextStep>` (step 6 when null). The intro line does not play on these addresses. The address of a completed draft goes to `/c/<commission id>`. A signed-out visitor opening one is sent to sign in with that address as the return route.
- After step 6, the browser completes the brief and moves to `/c/<commission id>`, whose heading types `Your room is ready.`.
- A signed-out visitor who presses OK on step 1 keeps the answer in the browser and is sent to sign in with the return route `/brief/new?step=1`. On return, the browser creates the draft, submits that kept answer once and continues at `/briefs/<brief id>?step=2` of the new draft, following the step-address rules above. A pending answer or payment interrupted by a failed refresh (DP-03) is handled the same way: after sign-in, the browser returns to the same route and step and replays it once.

**Venue search.** Typing in "Venue" asks the server for suggestions 250 milliseconds after the last keystroke. Only the reply to the latest text is shown; a slower reply to earlier text is dropped. Up and Down move through "Venues" and Enter picks a venue. The same 250-millisecond pause and latest-reply-wins rule apply to quote previews in the configurator.

**Configurator.**

- Pressing "Place <piece label>" puts the piece at the room centre, snapped, and focuses it. Clicking or tabbing to a piece selects it.
- While focus is anywhere inside region "Room", including on a piece button:
  - Arrow keys move the selected piece a quarter metre. Right and Left change x; Up moves it away from the front wall and Down towards it.
  - Shift+arrows move it one metre.
  - R turns it 15° counter-clockwise as seen from above, and Shift+R turns it back 15°.
  - Enter drops the piece, which saves the layout.
  - Escape returns the piece to its last saved position.
- With mouse or touch, pressing a piece lifts it, dragging follows the finger or pointer along the floor, and release drops it.
- A release while moving faster than 0.3 m/s flings the piece. It glides on, losing 8% of its speed every sixtieth of a second, until it is slower than 0.05 m/s or meets a wall. It then snaps to the nearest quarter metre with a spring settle of about half a second that shows no visible overshoot, and drops.
- A refused drop springs the piece back to its last saved position and shows the server's message.
- Changing size or extras previews the quote at once; "Save quote" saves it.
- Below 768 pixels, "Show inspector" opens the bottom sheet and "Hide inspector" or Escape closes it.

**Install day and checkout.**

- Choosing a free day and pressing "Hold <date>" holds it. Holding another day releases the first.
- The countdown starts from the server's remaining seconds. It counts down by elapsed time on the page and re-syncs with the server every 30 seconds and whenever the page regains focus. The device clock may be wrong, and the countdown never reads it.
- At zero, the browser asks the server. When the server reports the hold ended, the hold-ended state appears in place. An open payment sheet stays open, and its fields keep what was typed. "Hold <date> again" re-holds the same day if it is still free and returns to the sheet with the data intact.
- Each press of "Pay <amount>" after a failure creates a new payment attempt. A double tap and the browser's automatic retry of the same attempt reuse its key.
- Toasts, typing and countdown timers never close, reset or repaint over an open sheet or a status message the latest action produced.

**Dialogs and drawers.** "Payment", "Navigation" and each case-study sheet keep Tab and Shift+Tab cycling inside the dialog. Escape closes the dialog, and focus returns to the control that opened it. Once closed, a drawer, sheet or collapsed inspector is hidden: nothing inside it is visible, reachable with Tab or present in the accessibility tree, at every viewport.

**Sign-in and session.**

- "Sign in" goes to `/auth/login` with the current route as `returnTo`.
- When a request answers 401 with `session_expired`, the browser calls the refresh endpoint once. Concurrent 401s share that one refresh. The browser then replays each original request with the same payload and shows no error.
- When the refresh answers 401, the browser shows the signed-out message with its "Sign in" button and keeps every entered value. After sign-in, the replay described under Brief keyboard and flow applies.

**Sponsor invite.** "Accept and sign in" signs the sponsor in with `returnTo` set to `/i/<token>?accept=1`. On return, the browser accepts the invite and navigates to `/c/<commission id>/share`.

**Crew.** The crew lead taps a day in "Install days" to open its sheet. "Confirm installation" moves the commission to installed.

**Landing.** Scrolling scrubs the stage camera (see Motion and effects). A case-study card opens its sheet on click, tap, Enter or Space.

### Visual design (DP-59)

The design direction is "seed": a nocturnal, electric and attentive stage.

**Ground and light.**

- The ground is a near-black navy that fills every screen floor to ceiling.
- One electric-blue light field sweeps from the top edge down the right side and lights the grid beneath it. It is brighter blue at its core and fades to a white-hot pale blue-white in the top-right corner. A dark diagonal wedge cuts in from the lower left.
- The grid is a bowed perspective plane of faint white lines with plus markers at every second crossing and drifting dust.
- Rows, chips and cards are very dark blue-black fills with a faint white hairline border.
- Chrome chips (the close chip, banners and errors) are dark graphite with white ink.
- Ink is white. Muted ink (placeholders and hints) is a mid grey.
- Pale cyan, soft violet and soft pink appear only in the letter-typing trail.

**Accent and corners.** Electric blue marks the OK and primary buttons, the guide cursor's tag, the underline of the answer field, checked chips and the focus outline. Hover brightens it one step. Every corner is barely rounded, and that one corner rule applies everywhere. There are no glowing buttons, no gradient text, no glass and no shadows on controls.

**Stage and brief components.** These components carry the stage and the brief. Each is named here as the product calls it.

- **venue grid stage.** This is the `img "Venue stage"` canvas, or its still frame, fixed edge to edge behind every route and never unmounted.
  - It shows a bowed, slightly tilted perspective plane of faint white grid lines. Plus markers sit at every second crossing and small soft dust motes float above the plane. Near cells are large and shrink towards the far corner.
  - Its states are the `data-scene` values from the controls table. On working screens the grid is slowed.
  - It fades up with the brief's opening and otherwise moves only with scroll, pointer or an answer, as set out in Motion and effects.
  - Under reduced motion it is one still frame, redrawn when the room changes.
- **aurora light field.** This light is part of the venue grid stage image and has no role of its own.
  - It sweeps electric blue from the top edge down the right side. It is brighter at its core and fades to the white-hot pale blue-white in the top-right corner, with the dark wedge cutting in from the lower left. It lights the grid lines beneath it.
  - It fades up together with the grid. On working screens it is dimmed to about two fifths, and under reduced motion it is part of the still frame.
- **cue-line question.** This is the brief's level-1 heading, centred in the column. It is the largest text on the screen, on one line on desktop and wrapping to two or three lines on phones.
  - It is white once settled. Its states are typing, then settled.
  - It types in as described in the signature steps. Under reduced motion it appears whole and white at once.
- **Spindrift guide cursor.** This is a decorative arrow pointer, hidden from the accessibility tree, about as tall as a capital letter of the question.
  - It is filled electric blue with a thin white outline. Below and to the right of its tip sits a small electric-blue tag with barely rounded corners, reading `SPINDRIFT` in small white uppercase Inter.
  - Its states are following, while it eases after the newest letter, and parked, just past the line end.
  - Under reduced motion it is shown parked, with no gliding.
- **brief answer chips.** These are the `radio` and `checkbox` chips of each step.
  - On desktop four chips side by side fill the column's width with narrow gaps. On phones they sit two per row. Each chip is at least 44 pixels tall.
  - Each chip is a very dark fill with a faint white hairline border and barely rounded corners. A small square box sits at the left, and the label beside it may wrap to two lines.
  - States:
    - Hover brightens the border.
    - Checked fills the box electric blue with a white tick and turns the border electric blue.
    - Focus shows an electric-blue outline set slightly apart from the chip.
  - The chips rise into place one after another once the question settles. Under reduced motion they appear at once.
- **underlined answer field.** This is the step's `textbox` or `combobox`, the full column width.
  - It has a transparent fill and only an electric-blue rule underneath. The placeholder is large and in muted ink, and typed text is white.
  - It rises in with the chips, and under reduced motion it appears at once.
- **OK arrow button.** This is `button "OK"`, at the left end of the row under the answer field.
  - It shows the label "OK" followed by a right arrow, white on an electric-blue fill with a thin pale inner edge and barely rounded corners. It is at least 44 pixels in both dimensions.
  - States:
    - Hover brightens the blue one step and nudges the arrow a few pixels right.
    - Press shifts it down a hair.
    - It is unavailable, at reduced opacity, until the step has an answer.
  - Under reduced motion the arrow does not nudge.
- **key-chord hint.** This is the small uppercase Martian Mono line in muted ink, right after the OK arrow button, with the copy from the controls table.
- **close brief chip.** This is `button "Close brief"`, fixed at the top right of the brief with a small margin from both edges.
  - It is a dark graphite chip with barely rounded corners, showing the white uppercase label `CLOSE` followed by a × icon. It is at least 44 pixels in both dimensions.
  - Hover lightens the graphite, and focus shows the electric-blue outline. Escape does the same as pressing it.
  - It fades in with the stage, and under reduced motion it appears at once.
- **Cue-line Brief flow.** This is the whole one-question-per-screen sequence on the brief routes: the intro line, then the six questions in the questions table, each with its own controls.
  - No progress bar or step counter is drawn. The step shows only in the address and in "Brief progress".
  - Each step gives way to the next as set out in the signature steps. Under reduced motion each step swaps with no transition.

**Type.**

- Display type is Inter Tight Regular, body type is Inter Regular, and Martian Mono Regular is used only for key-chord hints.
- Headings step up by about a third per level over body text. The brief question is the largest text on every screen except the landing headline.
- Numbers use Inter's tabular figures.

**Density and composition.** Density is airy: wide margins and one question or one table per column. Every screen is the centred column over the same stage. The camera moves between sections; the page does not.

**Working screens.** Lists, tables and forms carry the same look: rows on dark fills with hairline borders, forms with the underlined answer field and the blue OK-style button, and empty states as a typed question, for example `Nothing commissioned yet. Start with the room?` on `/commissions` and `/studio` (the empty copy for each screen is under Feedback states). Errors and outage banners are white ink on graphite chips pinned top-centre.

**Accessibility.** Every interactive control is at least 44 pixels in both dimensions. Text meets WCAG 2.2 AA, with ink contrast of at least 4.5:1 on every row, including text over the brightest part of the light field.

### Motion and effects (DP-06, DP-08, DP-19, DP-21, DP-51, DP-52, DP-53)

**Easing.** Movement eases out fast and settles softly. Colour and hover changes take about a third of a second.

**Cue-line Brief signature, step by step:**

1. When the brief opens, the grid and light field fade up together over 1.6 seconds.
2. A question opens at the moment the heading's accessible name changes to it and its `data-typed` resets to 0. At 0.4 seconds the question's letters start to appear in place. The whole line is laid out and centred first, so nothing shifts while it types. Letter i (counting every character from 0, spaces included) appears 0.4 + 0.04 × i seconds after the question opens: its `data-letter` leaves `hidden` and `data-typed` becomes i + 1.
3. Each new letter arrives soft violet and blurred, turns pale cyan with a glow, then settles to white. Its `data-letter` reads `violet` for its first 0.2 seconds after appearing, `cyan` from 0.2 to 0.4 seconds, and `white` from 0.4 seconds on. Its colour and blur finish fading to plain white within 0.6 seconds of appearing, so a short trail of violet and cyan letters follows the typing. Every time in these steps holds within a tenth of a second.
4. The blue arrow cursor with its "SPINDRIFT" tag follows just after the newest letter, catching up over about half a second. It parks just past the end of the line.
5. Once the line has settled, the chips, field and OK row rise a short distance into place one after another, 60 milliseconds apart, each finishing within 1.4 seconds.
6. On submit, after the server saves the step, the stage responds over 0.6 seconds. Room width and depth re-space the grid so that one cell is one metre. The chosen installation type drops its outline onto the grid with a springy settle. The audience answer sets the dust density: 40 particles for Up to 25, 80 for 25 to 100, 140 for 100 to 300 and 220 for Over 300, with 60 before it is answered. The stage attributes update when the server's reply arrives.
7. The next question then types in the same way. The intro line holds 0.8 seconds and fades over 0.3 seconds before question 1.

**Landing stage.**

- The landing hero is a WebGL scene of a camera-reactive wall standing on the grid.
- The track starts at the top of the page and is five viewport heights tall, so the hero stays pinned for four viewport heights of scrolling. The camera passes through five keyframes: 0 wide from the front, 1 face-on, 2 orbiting left, 3 close to the wall and 4 back out to the whole room. Keyframe k is reached when the page has scrolled exactly k viewport heights (scroll offset = k × the viewport height, so keyframe 4 is at four viewport heights, where the pin releases). `data-keyframe` reports the keyframe nearest to the current scroll offset.
- Between keyframes the camera glides in proportion to scroll, and scrolling back plays the same path in reverse.
- The headline types letter by letter with the guide cursor, on the same schedule and with the same letter markers as a brief question. It opens when the landing route loads.
- Pointer movement tilts the camera by at most 2 degrees, settling within half a second.

**Other motion.**

- **Case-study sheet.** The card grows into its sheet in about half a second and shrinks back on close.
- **Quote numerals.** When the total changes, each digit column rolls to its new digit within 0.6 seconds. The accessible text holds the final value at once.
- **Toasts and banners.** They fade in within a quarter of a second.
- **Configurator.** The motion is described under Interactions: the springy settle takes about half a second, and the fling loses 8% of its speed each sixtieth of a second.

**No idle loops.** The grid, dust and light field move only with the entrance, scroll, pointer or an answer. Within 2 seconds of the last input nothing on the stage moves. There are no unnamed decorative loops; the countdown text is the only thing that changes while idle.

**Reduced motion.** With reduced motion, `data-motion` is `still`.

- Each question appears whole and white at once, with no blur, trail or stagger. From the moment it opens, its `data-typed` equals its length and every letter's `data-letter` is `white`. The cursor is shown parked at the line end. The answer controls appear immediately, step changes swap with no transition, and focus still moves to the first answer control.
- The grid and light field are one still frame, redrawn (not animated) when an answer changes the room.
- On the landing, each caption section shows the still frame of its keyframe, and the headline appears whole.
- Case-study sheets open and close at once.
- Quote numerals swap at once.
- In the configurator, dragging still moves pieces directly, but a release snaps at once with no glide or spring.

**Without WebGL.** `data-motion` is `fallback`. The stage is a published still frame of the same scene for its route, and it carries the same question, chips, field, buttons and room attributes.

### Feedback states (DP-03, DP-11, DP-16, DP-21, DP-24, DP-26, DP-30, DP-33, DP-48, DP-49)

Every string in backticks renders character for character, including straight apostrophes, em dashes, case and digits. Announcements built from these strings carry the same characters.

**Placeholder formats.**

- `<amount>`: US dollars with a dollar sign, comma thousands and two decimals, for example `$5,269.95`.
- `<date>`: the venue-local calendar date as weekday, day, month and year, for example `Tue 16 Mar 2027`.
- `<due>`: the date followed by `, 23:59:59 (<IANA zone>)`.
- `<fileName>`: the cleaned file name.
- `<sizeBytes>`: a plain integer with no separators.
- `<sha256>`: 64 lowercase hex characters.
- `<n>`: the next question number.
- `<piece label>`: from Seed data.
- `<x>` and `<y>`: metres with up to two decimals.
- `<r>`: whole degrees.
- `<plan label>`: Essential or Priority.
- `<kind label>`: `brief PDF`, `venue photo` or `GLB model`.

Field errors appear under their field and in an error summary `region "Problems"` whose entries link to the fields. The summary's first line is announced in the action's live region.

| Action | Live region | Pending | Success | Errors |
|---|---|---|---|---|
| Save brief step | Brief progress | none | `Answer saved. Question <n> of 6.`; after step 6 `Brief complete. Your room is ready.` | Field messages from the API section |
| Upload | Upload status | `Uploading <fileName>...` | `Stored <fileName> — <sizeBytes> bytes, SHA-256 <sha256>.` | `<fileName> is over the <limit>-byte limit for a <kind label>.`; `<fileName> isn't a <kind label>.` |
| Request preview | Preview status | `Preview queued.` | `Preview rendering — <progress>% done.` for each progress step, then `Preview ready.` | `That address can't be used for a reference image.`; `We couldn't fetch an image from that address.`; on failure `The preview didn't render. Try again with another photo.` |
| Drop a piece | Placement status | none | `Placed <piece label> at <x> m, <y> m, turned <r>°.` | The placement messages from Business rules; on 412 `This layout changed in another window. Showing the latest version.` |
| Quote preview or save | Quote total | none | `Quote updated: <amount> including tax.` | none |
| Hold a day | Hold status | none | `Held <date>. Finish checkout before the timer runs out.` | `That day was just taken. The next free days are <d1>, <d2> and <d3>.` (fewer names when fewer exist; with none, `That day was just taken. There are no free days in the next year.`) |
| Hold ended | Hold status | | `Your hold on <date> has ended. Pick a day again to finish — your details are still here.` under heading `Your hold has ended` | |
| Sign agreement | Notices | none | `Agreement signed. Your contract PDF is being prepared.` | `This quote has expired. Refresh the quote to continue.` |
| Pay | Payment status | `Confirming payment with the billing system...` | `Paid <amount>. Your receipt is on its way.` | `The payment didn't go through. Nothing has been charged.`; `This payment key was already used for a different payment. Close this sheet and try again.`; `This is already paid.`; on hold ended the hold-ended copy; card field messages from the API section |
| Save funders | Notices | none | `Funders saved. Invites are on their way.` | `Shares must add up to 100.00%.`; `Funders are locked once a sponsor accepts or the deposit is paid.` |
| Accept invite | Notices | none | `You're in. Here's your share.` | `This invite was already accepted by another account.` |
| Transitions | Notices | none | `Concept approved.` · `Fabrication started.` · `Installation confirmed.` · `Acceptance signed.` · `Commission cancelled.` | `That step isn't available yet.` |
| Save CRM endpoint | Notices | none | `Endpoint saved.` | `Enter a full http or https address.`; when Svix is down, `Couldn't save the endpoint — our webhook service isn't answering. Try again in a minute.` |
| Maintenance | Notices | none | `Maintenance started on the <plan label> plan.`; `Switched to the <plan label> plan. Kill Bill's proration is below.` | `You're already on that plan.` |
| Board payment | Board updates | | `<payer name> paid <amount> toward <commission title>.` | |
| Session | Session | | | `Your session ended. Sign in again — what you entered is kept.` |

**Pages.**

- Sign-in error page: heading `Sign-in didn't complete`, text `That sign-in link has expired, was already used or was opened in a different browser. Start again from Sign in.`
- Expired invite: heading `This invite has expired`, text `Ask Spindrift Rooms for a new link.`
- Invalid invite: heading `This invite link isn't valid`, text `It may have been replaced or withdrawn. Ask Spindrift Rooms for a new link.`

**Empty states**, typed like a brief question:

- `/commissions` and `/studio`: `Nothing commissioned yet. Start with the room?`
- Files: `No files yet. Add a venue photo?`
- CRM deliveries: `No CRM deliveries yet. Add your endpoint?`
- Install days: `No install days yet. Check back after a booking?`
- Jobs: `No jobs waiting. All quiet?`

**Outage banners.** A banner appears in "Service notices" on every screen within 15 seconds of its service becoming unreachable, and it leaves within 15 seconds of the service answering again.

| Service | Banner |
|---|---|
| Kill Bill | `Payments are paused — our billing system isn't answering. Nothing has been charged.` |
| Mailpit | `Emails are delayed — receipts and notices will arrive once our mail service is back.` |
| MinIO | `Uploads are paused — our file store isn't answering. Nothing was saved.` |
| Gotenberg | `Documents are delayed — PDFs will appear here once our document service is back.` |
| Svix | `CRM updates are delayed — they'll be sent once our webhook service is back.` |
| ntfy | `Crew alerts are delayed — they'll be posted once our alert service is back.` |
| Render provider | `Concept previews are delayed — requests are queued and will start once our render partner is back.` |
| Keycloak | `Sign-in is paused — our sign-in service isn't answering. If you're already signed in, you can keep working for now.` |
| Postgres | `The studio is offline — we can't reach our records. Try again in a minute.` |

When an action answers 503, its live region shows the matching banner text.

## Backend

### API (DP-01, DP-03, DP-05, DP-07, DP-10, DP-13, DP-15, DP-17, DP-18, DP-21, DP-24, DP-29, DP-33, DP-39, DP-42, DP-44, DP-45, DP-47, DP-55, DP-56)

**General rules.**

- The API speaks JSON (`application/json`) except for uploads (`multipart/form-data`), PDFs, images and the event stream.
- Ids are UUID strings, except venue ids, which are the slugs under Seed data.
- Instants are ISO 8601. Venue-related instants carry the venue's UTC offset; all others are in UTC with `Z`.
- Money fields end in `Cents` and are integers.

**Authentication.** Callers authenticate with the app's session cookie or with `Authorization: Bearer <access token>`, where the token is issued by the Keycloak realm to client `AUTH_CLIENT_ID`. Realm roles in either form decide the caller's role.

**Error shape.** The API uses one error shape. Validation failures are `422 {"errors":{"<field>":"<message>"}}`. Every other error is `{"error":{"code":"<code>","message":"<text>"}}` with optional extra fields.

**Error precedence**, for every endpoint:

1. A body over its size limit answers 413 before anything else.
2. No valid session or token: `401 {"error":{"code":"unauthenticated"}}`, or `{"error":{"code":"session_expired"}}` when the app session's access has lapsed.
3. A resource that doesn't exist or isn't the caller's, including ids inside the body: `404 {"error":{"code":"not_found"}}`.
4. A role that may not perform the action: `403 {"error":{"code":"forbidden"}}`.
5. An idempotent replay returns its stored response.
6. State conflicts (409, 410, 412).
7. Validation (422).
8. An unreachable provider (503).

Endpoint entries below list only their own extra errors.

**Platform**

- `GET /api/health` → `200 {"status":"ok"}`, even while dependencies are down.
- `GET /api/status` → `200 {"services":{"postgres":"up|down","keycloak":…,"killbill":…,"mailpit":…,"minio":…,"gotenberg":…,"svix":…,"ntfy":…,"renderProvider":…}}`. Each probe takes at most 3 seconds, and results are reused for at most 5 seconds.
- `GET /api/events` → `text/event-stream` for the signed-in user. It sends `commission.updated {"commissionId","state"}`, `payment.confirmed {"commissionId","payerName","amountCents","label"}`, `render.updated {"renderId","state","progress"}`, `job.updated {"jobId","status"}` and `hold.updated {"commissionId","status"}`, each only to users who may see that commission.

**Sign-in**

- `GET /auth/login?returnTo=<path>` → 302 to the realm's authorization endpoint with `response_type=code`, `scope=openid`, a fresh random `state` of at least 128 bits, a fresh `nonce`, `code_challenge_method=S256` and `redirect_uri=<APP_PUBLIC_URL>/auth/callback`. It sets an httpOnly, SameSite=Lax cookie that binds this attempt's state and verifier to the browser. `returnTo` is kept only when it is a path starting with one `/`; otherwise the role landing route is used. With Keycloak unreachable it answers 503 with an HTML page carrying the Keycloak banner text.
- `GET /auth/callback?code=…&state=…` → for a state that matches this browser's unused attempt, it exchanges the code with the verifier, checks the nonce, sets the session cookie and answers 302 to `returnTo`. For a missing, unknown, reused or other-browser state, or a missing code, it answers 400 with the sign-in error page and sets no session cookie.
- `POST /auth/refresh` → `204` after renewing access through Keycloak. When renewal fails it answers `401 {"error":{"code":"signed_out"}}` and clears the session.
- `POST /auth/logout` → `204`.
- `GET /api/me` → `200 {"id","email","name","roles":["client"]}`.

**Venues**

- `GET /api/venues?q=<text>` (no sign-in needed) → `200 {"venues":[{"id","name","address","city","timeZone","taxRateBp"}]}`. It matches a case-insensitive substring of name, address or city, returns at most 8 venues ordered by name, and returns an empty list for empty `q`.
- `GET /api/venues/<venue id>/days?from=YYYY-MM-DD&to=YYYY-MM-DD` → `200 {"days":[{"date","status":"free|held|booked|unavailable|yours","startsAt","endsAt"}]}`. A span over 62 days answers `422 {"errors":{"to":"Ask for at most 62 days."}}`.

**Brief**

- `POST /api/briefs` (client) → `201 {"id","answers":{},"answeredThrough":0,"nextStep":1,"commissionId":null}`.
- `GET /api/briefs/<id>` → `200`, same shape.
- `PUT /api/briefs/<id>/steps/<n>` with `{"answer":{…}}` → `200` with the brief shape, `answeredThrough` at least `n`, and `nextStep` set to n+1 (or `null` after 6). Re-answering an earlier step is allowed. Other outcomes:
  - `n` outside 1 to 6 answers 404.
  - `n` above `answeredThrough`+1 answers `409 {"error":{"code":"step_out_of_order"}}`.
  - A completed brief answers `409 {"error":{"code":"brief_completed"}}`.
  - Saving the same answer again returns the same body.

  Answers and their 422 messages:

  | Step | Answer | 422 messages |
  |---|---|---|
  | 1 | `{"installationType":"camera-reactive-wall|portrait-kiosk|projection-room","title":"…"}` | `installationType`: `Pick what should stand in the room.`; `title` (2 to 80 characters after trimming): `Give the piece a name of 2 to 80 characters.` |
  | 2 | `{"venueId":"…"}` | `venueId`: `Pick a venue from the list.` |
  | 3 | `{"widthM":12,"depthM":9}` | Numbers from 4 to 60 inclusive in steps of 0.5. `widthM`: `Enter a width from 4 to 60 metres in half-metre steps.`; `depthM`: `Enter a depth from 4 to 60 metres in half-metre steps.` |
  | 4 | `{"doorWall":"front|back|left|right"}` | `doorWall`: `Pick the wall with the main door.` |
  | 5 | `{"audience":"up-to-25|25-100|100-300|over-300"}` | `audience`: `Pick how many people will be there at once.` |
  | 6 | `{"addOns":["ambient-sound","night-lighting","photo-takeaway"],"notes":"…"}` | `addOns` (any subset): `Pick from the listed extras.`; `notes` (optional, at most 2,000 characters): `Keep notes to 2,000 characters or fewer.` |

- `POST /api/briefs/<id>/complete` → `201 <commission>` in state `briefed`, with size `compact` and the step 6 extras. A replay returns `200` with the same commission. An incomplete brief answers `409 {"error":{"code":"brief_incomplete"}}`.

**Commissions**

- `GET /api/commissions` → `200 {"commissions":[{"id","title","state","venueName","clientName","totalCents","paidCents","nextDueAt","installDate"}]}`. A client gets their own commissions, the producer gets all of them, and sponsors and crew get an empty list.
- `GET /api/commissions/<id>` (client owner or producer) → `200` with:

  ```
  {"id","title","state","installationType","venue":{…},
   "room":{"widthM","depthM","doorWall"},"audience","notes",
   "options":{"size","addOns"},
   "quote":{"quoteId","lines":[{"label","amountCents"}],"subtotalCents","taxCents","totalCents","issuedAt","validUntil"} or null,
   "layout":{"version","items":[{"kind","x","y","rotationDeg"}]},
   "requiredPieces":[…],
   "hold":{…} or null,
   "installDay":{…} or null,
   "milestones":[{"id","label","scheduleBp","state","subtotalCents","taxCents","amountCents","invoicedAt","dueAt","killbillInvoiceId","killbillPaymentId","documentId"}],
   "funders":[…],"clientId","createdAt"}
  ```

- `GET /api/commissions/<id>/ledger` (client owner or producer) → `200 {"entries":[{"id","payerName","label","amountCents","killbillPaymentId","at"}]}`.
- `POST /api/commissions/<id>/transitions` with `{"to":"concept_approved|fabricating|installed|accepted|cancelled"}` → `200 <commission>`. An illegal move answers `409 {"error":{"code":"illegal_transition","message":"A commission can't move from <from> to <to>.","from","to"}}`. A move that waits on an unpaid milestone answers `409 {"error":{"code":"milestone_unpaid","milestoneId"}}`.

**Files**

- `POST /api/commissions/<id>/files` (client owner or producer), multipart with the fields `kind` (`brief_pdf`, `venue_photo` or `installation_glb`) and `file` → `201 {"id","kind","fileName","contentType","sizeBytes","sha256","status":"stored","createdAt"}`. Errors:
  - Over the kind's limit: `413 {"error":{"code":"file_too_large","message":"<fileName> is over the <limit>-byte limit for a <kind label>.","limitBytes"}}`.
  - Wrong content or an empty file: `422 {"errors":{"file":"<fileName> isn't a <kind label>."}}`.
  - Unknown kind: `422 {"errors":{"kind":"Pick brief_pdf, venue_photo or installation_glb."}}`.
  - MinIO unreachable: `503 {"error":{"code":"storage_unavailable","message":<MinIO banner text>}}`.
- `GET /api/commissions/<id>/files` → `200 {"files":[…]}`.
- `GET /api/files/<id>/content` → the stored bytes with the stored content type. With MinIO down it answers 503 `storage_unavailable`.

**Renders**

- `POST /api/commissions/<id>/renders` with `{"venuePhotoFileId","referenceImageUrl"}` (`referenceImageUrl` is optional) → `202 {"id","commissionId","state":"queued","progress":0,"createdAt"}`. Errors:
  - Allowed only in briefed, previewed or placed; otherwise `409 {"error":{"code":"illegal_state"}}`.
  - Unsafe reference address: `422 {"errors":{"referenceImageUrl":"That address can't be used for a reference image."}}`.
  - Fetch failed: `422 {"errors":{"referenceImageUrl":"We couldn't fetch an image from that address."}}`.
  - A file that isn't a stored venue photo of this commission answers 404.
- `GET /api/renders/<id>` → `200 {"id","state":"queued|submitted|callback_verified|ready|failed","progress","providerJobId","failureReason","previewSha256"}`.
- `GET /api/renders/<id>/preview` → `image/png` bytes once the render is ready, otherwise `409 {"error":{"code":"not_ready"}}`.
- `POST /api/render-callbacks` (render provider, no session; body at most 16,777,216 bytes) → `204`. Errors:
  - `401 {"error":{"code":"bad_signature"}}`.
  - `401 {"error":{"code":"stale_timestamp"}}`.
  - Unknown `jobRef`: `404`.
  - A completed callback whose preview isn't a PNG: `422 {"errors":{"preview":"Preview must be a PNG image."}}`.

**Layout and quote**

- `PUT /api/commissions/<id>/layout` with `{"version":<int>,"items":[{"kind","x","y","rotationDeg"}]}` → `200 {"version","items"}`, where `version` is the previous value plus one. Errors:
  - Allowed in previewed, placed, held, contracted and concept_approved; otherwise 409 `illegal_state`.
  - A stale version answers `412 {"error":{"code":"version_conflict","currentVersion"}}`.
  - Validation answers `422 {"errors":{"items[<i>]":"<placement message>"}}`.
- `POST /api/commissions/<id>/quote-preview` with `{"size","addOns"}` → `200 {"lines","subtotalCents","taxCents","totalCents"}`. Nothing is saved.
- `PUT /api/commissions/<id>/options` with `{"size":"compact|standard|grand","addOns":[…]}` → `200 {"options","quote","layout"}`. It issues a new quote and drops layout items for removed extras, which raises the version. Locked options answer `409 {"error":{"code":"options_locked"}}`. Bad values answer `422 {"errors":{"size":"Pick Compact, Standard or Grand."}}` or the `addOns` message from step 6.
- `POST /api/commissions/<id>/quote/refresh` → `200 {"quote"}`. It re-issues the quote at current prices with a new validity, and is allowed until the deposit is paid.

**Install day hold**

- `POST /api/commissions/<id>/hold` with `{"date":"YYYY-MM-DD"}` → `201 {"holdId","date","expiresAt","secondsRemaining","serverTime","status":"held"}`. Errors:
  - The day is not free: `409 {"error":{"code":"day_taken","message":"That day was just taken.","nextFreeDays":["YYYY-MM-DD",…]}}`, with at most 3 entries.
  - Not placed or held: 409 `illegal_state`.
  - A date outside the bookable window: `422 {"errors":{"date":"Pick a day from 21 days to one year ahead."}}`.
- `GET /api/commissions/<id>/hold` → `200 {"holdId","date","expiresAt","secondsRemaining","serverTime","status":"held|expired|booked"}` for the latest hold, or 404 when there is none.
- `DELETE /api/commissions/<id>/hold` → `204`.

**Checkout and payments**

- `POST /api/commissions/<id>/sign` (client owner) with `{"signatureName","acceptTerms":true}` → `201 {"contractDocumentId","contractVersion","depositMilestoneId"}`. Errors:
  - `409 {"error":{"code":"hold_expired"}}`.
  - `409 {"error":{"code":"quote_expired","message":"This quote has expired. Refresh the quote to continue."}}`.
  - `422 {"errors":{"signatureName":"Type your full name, 2 to 80 characters."}}`.
  - `422 {"errors":{"acceptTerms":"Tick the box to agree."}}`.
  - Kill Bill unreachable: `503 {"error":{"code":"billing_unavailable","message":<Kill Bill banner text>}}`.
- `POST /api/milestones/<id>/payments` (client owner) and `POST /api/funders/<id>/payments` (the sponsor bound to that funder) take the header `Idempotency-Key` and the body `{"nameOnCard","cardNumber"}`. Success is `201 {"paymentId","amountCents","subtotalCents","taxCents","status":"paid","killbillInvoiceId","killbillPaymentId","paidAt"}`. Errors:
  - `409 {"error":{"code":"idempotency_conflict"}}`.
  - `409 {"error":{"code":"already_paid"}}`.
  - `409 {"error":{"code":"hold_expired"}}` (deposit only).
  - `409 {"error":{"code":"quote_expired"}}` (deposit only).
  - `409 {"error":{"code":"commission_cancelled"}}`.
  - `502 {"error":{"code":"payment_failed","message":"The payment didn't go through. Nothing has been charged."}}`.
  - 503 `billing_unavailable`.
  - Validation, as 422:
    - `idempotencyKey`: `Send an Idempotency-Key of 1 to 64 letters, digits, - or _.`
    - `nameOnCard` (1 to 80 characters): `Enter the name on the card.`
    - `cardNumber` (13 to 19 digits after removing spaces, passing the Luhn check): `Check the card number.`

  Only the last four digits of a card are ever stored.

**Funders and invites**

- `GET /api/commissions/<id>/funders` and `PUT /api/commissions/<id>/funders` (producer). The PUT body is `{"funders":[{"kind":"client","bp":<int>},{"kind":"sponsor","name","email","bp":<int>}]}`, with the client first and up to three sponsors. It answers `200 {"funders":[{"id","kind","name","email","bp","subtotalCents","taxCents","amountCents","state":"lead|invited|accepted|paid|revoked|expired","inviteExpiresAt","position"}]}`. Errors:
  - `409 {"error":{"code":"funders_locked"}}`.
  - `422 {"errors":{"funders":"Shares must add up to 100.00%."}}`.
  - `422 {"errors":{"funders":"Up to three sponsors per commission."}}`.
  - `422 {"errors":{"funders[<i>].email":"Enter a valid email."}}`.
  - `422 {"errors":{"funders[<i>].bp":"Each share must be at least 0.01%."}}`.
- `POST /api/funders/<id>/invite` (producer) → `200 {"inviteExpiresAt"}`. It issues a new link, sends it, and the old link stops working. An accepted or paid sponsor answers `409 {"error":{"code":"invite_used"}}`.
- `DELETE /api/funders/<id>/invite` (producer) → `204`, and the state becomes `revoked`. A paid sponsor answers 409 `already_paid`.
- `GET /api/invites/<token>` (no sign-in) → `200 {"commission":{"title","venueName","installationType","installDate"},"share":{"sponsorName","bp","subtotalCents","taxCents","amountCents"},"expiresAt"}`. An unknown, revoked or replaced token answers `404 {"error":{"code":"invite_invalid"}}`. An expired one answers `410 {"error":{"code":"invite_expired"}}`. Every method other than GET on this path answers 405, except accept.
- `POST /api/invites/<token>/accept` (signed in) → `200 {"commissionId","funderId"}`. A replay by the same account answers the same. Another account answers `409 {"error":{"code":"invite_used"}}`. Kill Bill unreachable answers 503 `billing_unavailable`, and the invite stays unaccepted.
- `GET /api/commissions/<id>/share` (the bound sponsor) → `200 {"commission":{public summary},"share":{…,"state","dueAt","killbillInvoiceId","documentId"}}`.

**Documents**

- `GET /api/commissions/<id>/documents` → `200 {"documents":[{"id","kind":"contract|invoice","version","label","status":"preparing|issued","sizeBytes","sha256","issuedAt"}]}`. The client owner and producer see all of them; a sponsor sees only their own invoice through the share endpoint.
- `GET /api/documents/<id>/pdf` → `application/pdf`. A document still being prepared answers `409 {"error":{"code":"document_preparing"}}`.

**Crew**

- `GET /api/crew` (producer) → `200 {"crew":[{"id","name","email"}]}`.
- `POST /api/install-days/<id>/crew` (producer) with `{"crewUserId"}` → `200 <install day>`. A user who isn't crew answers 404.
- `GET /api/install-days` → `200 {"installDays":[…]}`. Crew get only their assigned days; the producer gets all.
- `GET /api/install-days/<id>` → `200 {"id","commissionId","commissionTitle","clientName","venue","date","startsAt","endsAt","crewUserIds","layout","alerts":[{"kind","title","sendAt","status":"scheduled|sent"}]}`.

**CRM webhooks**

- `PUT /api/me/crm-endpoint` (client) with `{"url"}` → `200 {"url","signingSecret"}`. An address that isn't an absolute http or https URL of at most 2,048 characters answers `422 {"errors":{"url":"Enter a full http or https address."}}`. Svix unreachable answers `503 {"error":{"code":"webhooks_unavailable"}}`.
- `GET /api/me/crm-endpoint` → `200 {"url","signingSecret"}`, or `{"url":null}`.
- `GET /api/commissions/<id>/webhook-deliveries` (client owner or producer) → `200 {"deliveries":[{"eventId","eventType","createdAt","finalState":"delivered|retrying|failed|no_endpoint|pending","attempts":[{"at","responseStatus","status":"success|failed"}]}]}`, read from Svix.

**Maintenance**

- `POST /api/commissions/<id>/maintenance` (client owner) with `{"plan":"essential|priority"}` → `201 {"plan","killbillSubscriptionId","startDate","chargedThroughDate","invoice":{"killbillInvoiceId","items":[{"description","amountCents","startDate","endDate"}],"amountCents"}}`. Errors: 409 `illegal_state` or `milestone_unpaid`, and 503 `billing_unavailable`.
- `PUT /api/commissions/<id>/maintenance` with `{"plan"}` → `200 {"plan","previousPlan","prorationDate","invoice":{…same shape…}}`. The same plan answers `409 {"error":{"code":"same_plan"}}`.
- `GET /api/commissions/<id>/maintenance` → `200 {"plan","chargedThroughDate","invoices":[…]}`, read from Kill Bill.

**Jobs**

- `GET /api/jobs?status=<status>&commissionId=<id>` (producer) → `200 {"jobs":[{"id","kind":"render_submit|render_store|pdf|email|crew_alert|webhook","commissionId","status":"pending|running|done|failed","attempts","lastError","createdAt","finishedAt"}]}`.

**Body limits.**

- JSON bodies: at most 65,536 bytes (inclusive). Larger bodies answer `413 {"error":{"code":"body_too_large"}}`.
- Render callbacks: at most 16,777,216 bytes.
- Uploads: the kind's limit applies to the file. The whole multipart request may exceed it by at most 65,536 bytes.

### Business rules (DP-05, DP-10, DP-14, DP-15, DP-17, DP-23, DP-24, DP-25, DP-27, DP-28, DP-29, DP-30, DP-32, DP-33, DP-35, DP-36, DP-37, DP-41, DP-44, DP-45, DP-47, DP-55)

**Commission states and transitions.** A commission is briefed, previewed, placed, held, contracted, concept_approved, fabricating, installed, accepted, maintained or cancelled.

| From | To | How and by whom | Guard |
|---|---|---|---|
| briefed | previewed | Automatically, when its first render becomes ready | none |
| previewed | placed | Automatically, when a saved layout contains every required piece | none |
| placed | held | Hold endpoint, client owner | none |
| held | placed | Automatically, when the hold ends or is released | none |
| held | contracted | Automatically, when the client's deposit payment is confirmed by Kill Bill | none |
| contracted | concept_approved | Client owner | none |
| concept_approved | fabricating | Producer | The concept-approval milestone is paid |
| fabricating | installed | An assigned crew lead or the producer | The fabrication milestone is paid |
| installed | accepted | Client owner | none |
| accepted | maintained | The maintenance endpoint | The acceptance milestone is paid |
| briefed, previewed, placed, held, contracted or concept_approved | cancelled | Producer | none |

Cancelling releases any hold and booked day, and later payments answer `commission_cancelled`. Every other move answers the illegal-transition 409. Asking the transitions endpoint for an automatic move is also illegal.

**Pieces and placement.**

- Required pieces are the main piece for the installation type plus one piece per chosen extra (footprints under Seed data).
- The room is the rectangle from (0,0) to (width, depth) in metres. The origin is where the front wall meets the left wall, x runs along the front wall and y runs into the room.
- The main door is 1.2 m wide, centred on its wall. Its clearance zone is the rectangle formed by the door opening and extending 0.6 m into the room.
- A piece's x and y are its footprint centre. At 0° its first footprint dimension runs along x, and `rotationDeg` turns it counter-clockwise as seen from above.
- The server checks the items in order and answers with the first failing item:

  | Rule | Message |
  |---|---|
  | x and y are multiples of 0.25, and `rotationDeg` is a multiple of 15 from 0 to 345 | `Positions snap to 0.25 m and turns to 15°.` |
  | The kind is a required piece, listed at most once | `That piece isn't part of this commission.` |
  | Every footprint corner lies inside the room; touching a wall is allowed | `Keep the <piece label> inside the room.` |
  | No two footprints share any area; touching edges is allowed | `The <piece label> overlaps the <other piece label>.` |
  | No footprint shares area with the door clearance zone | `Leave 0.6 m clear inside the door for the <piece label>.` |

- A layout may hold a subset of the required pieces. Holding a day needs all of them, otherwise it answers `409 {"error":{"code":"placement_incomplete"}}`.
- Saves carry the version they edited. Saving over a newer version answers the 412.
- Saving a layout while an install day is booked queues one placement-changed crew alert.

**Options lock.** Options can be changed only in previewed and placed, and only while no sponsor has accepted. Otherwise the request answers `options_locked`.

**Money.**

- Every amount is integer US cents.
- Quote subtotal = main piece price + size price + the prices of the chosen extras (Seed data).
- Tax = subtotal × venue tax rate in basis points ÷ 10000. It is rounded half up to the cent once, on the subtotal.
- Total = subtotal + tax.
- Quote lines are the installation label, `Size: <size label>`, one line per extra, and `Sales tax (<rate>%)`, where the rate is basis points ÷ 100 with two decimals.

**Splitting rule.** One rule splits any amount A by weights in basis points summing to 10000:

1. Each part is floor(A × w ÷ 10000).
2. The leftover cents go one at a time to the parts with the largest remainder (A × w mod 10000).
3. Equal remainders go to the earlier entry in list order.

Parts always add up to A. The rule is applied to subtotal and tax separately, in two stages:

1. **Funder stage.** The quote's subtotal and tax are split across the funders in their list order. The lead client is always first; sponsors follow in the order the producer listed them.
2. **Milestone stage.** The lead client's subtotal part and tax part are each split by the payment schedule: Deposit 4000, Concept approval 2000, Fabrication 2000, Signed acceptance 2000, in that order.

A milestone's or sponsor share's amount is its subtotal part plus its tax part.

For example, with the seed data at start:

- A Camera-reactive wall, Standard size and Night-mode lighting at Halsted Works Hall has subtotal 2,390,000, tax 244,975 and total 2,634,975.
- With funders client 5000, sponsor A 2500 and sponsor B 2500, the tax parts are 122,487, 61,244 and 61,244.
- Sponsor A owes 658,744 (`$6,587.44`).
- The client's deposit is 478,000 + 48,995 = 526,995 (`$5,269.95`).
- The client's concept-approval tax part is 24,498, and fabrication and acceptance are 24,497 each.

**Funders.** Funder basis points are integers from 1 to 10000 and must sum to exactly 10000. A commission has one lead client and up to three sponsors.

- The funder list may be replaced only before the deposit is paid and while no sponsor has accepted; otherwise it answers `funders_locked`.
- Replacing the list:
  - A sponsor whose email is unchanged keeps their link.
  - A new email gets a new invite.
  - A removed sponsor's link stops working.
- A sponsor moves invited → accepted → paid. A sponsor can also become revoked (by the producer, unless paid) or expired (when the link passes its expiry unaccepted). Reissuing the invite returns an expired or revoked sponsor to invited.

**Sponsor links.**

- The link is `<APP_PUBLIC_URL>/i/<token>`. The token is at least 128 random bits, URL-safe, and stored only as a hash.
- A link is valid while server time is strictly before `expiresAt`, which is the moment it was sent plus INVITE_TTL_SECONDS. From `expiresAt` on it answers 410.
- The link only reads: it shows the public summary (title, venue name, installation type, install date if booked, studio name) and that sponsor's own share. It never shows other funders or the commission total.
- Acceptance needs a signed-in account. It binds the sponsor to that account, gives the account the sponsor role, creates the sponsor's Kill Bill account and issues the sponsor's invoice. The share is due 14 days after acceptance at 23:59:59 venue time.

**Install days.**

- An install day is one venue-local calendar date in the venue's IANA zone. `startsAt` and `endsAt` are that date's local midnights, so a day that changes to or from daylight saving time lasts 23 or 25 hours and still holds exactly one install.
- Each venue date has one install slot.
- A date can be held when it is between 21 and 365 days (inclusive) after the venue-local date today.
- `nextFreeDays` lists the up-to-three earliest free bookable dates after the requested date.

**Holds.**

- A hold ends at `expiresAt`, which is the server's recorded time plus HOLD_SECONDS. A hold is active while server time is strictly before `expiresAt`. At `expiresAt` and after it has ended: the date is free again, the commission returns to placed, and deposit payments answer `hold_expired`.
- Ending is judged on the server on every read and every write. A job sends the hold-ended email once and returns the commission to placed within 10 seconds of the edge.
- `secondsRemaining` is computed on the server and is never negative.
- When several holds for the same venue date arrive at once, exactly one is recorded and the rest answer `day_taken`. The same holds for two venues' clients and for a commission re-holding.
- A client's new hold on another date releases their previous hold in the same step.
- When the deposit is confirmed, the hold becomes a booked install day.

**Quotes.**

- A quote's `validUntil` is 23:59:59 venue-local time on the 14th calendar day after its venue-local issue date. When QUOTE_TTL_SECONDS is set, `validUntil` is the issue instant plus that many seconds instead.
- A quote is usable through the second `validUntil` itself. From one second later, signing and the deposit payment answer `quote_expired`.

**Milestones and due dates.**

- A milestone is scheduled until its trigger:

  | Milestone | Trigger |
  |---|---|
  | Deposit | Signing |
  | Concept approval | The move to concept_approved |
  | Fabrication | The move to fabricating |
  | Signed acceptance | The move to accepted |

- On its trigger the milestone is invoiced in Kill Bill, and its `dueAt` is 23:59:59 venue-local time on the 14th calendar day after the trigger's venue-local date. The server computes it with the zone's offset on that date.
- A milestone moves invoiced → payment_pending → paid | failed. A new attempt after a failure moves it failed → retried → paid | failed.
- Re-signing after a hold ends keeps the unpaid deposit invoice when the amounts are unchanged.
- The deposit can be paid only while the hold is active.

**Payments.**

- Each request names one attempt by its `Idempotency-Key`, scoped to the paying user.
- The first request with a key records the attempt as payment_pending, then asks Kill Bill to pay the invoice's balance with that key as the transaction external key.
- When Kill Bill confirms, one database transaction records all of the following together:
  - the share or milestone as paid;
  - one ledger entry;
  - the receipt email job;
  - the milestone-paid email job (when a client milestone becomes paid);
  - the CRM event job;
  - the board event.
- When Kill Bill refuses or is unreachable, the attempt becomes failed. No ledger entry, email or CRM event is created, and the answer is 502 or 503.
- A retry with the same key after an unclear outcome first asks Kill Bill for a payment with that key, and records it if found, so a charge is never made twice.
- A replay of a finished key with the same path and body returns the stored status and body. The same key with a different path or body answers `idempotency_conflict`.
- A request arriving while the same key is still in flight waits up to 10 seconds and returns the first request's response.

**Render jobs.**

- A render job moves queued → submitted (the provider answered 202) → callback_verified (the first verified callback) → ready (a completed callback and the preview stored in MinIO) or failed.
- Callbacks:
  - **Signature.** It must equal `v1=` followed by the lowercase hex HMAC-SHA256 of `<X-Render-Timestamp>.<raw body>`, keyed with RENDER_WEBHOOK_SECRET and compared in constant time.
  - **Timestamp.** It must be within 300 seconds of server time.
  - **Event ids.** Each `eventId` takes effect once, including when the same event arrives concurrently; a replay answers 204 and changes nothing.
  - **Progress.** It never goes down.
  - **Terminal callbacks.** The first completed or failed callback wins, and anything arriving after it changes nothing.

**Reference images.**

- Only http and https addresses are accepted.
- The host is resolved, and every address it resolves to must be public. Refused ranges:
  - IPv4: loopback, 0.0.0.0/8, 10/8, 172.16/12, 192.168/16, link-local 169.254/16 (cloud metadata included), 100.64/10, multicast and broadcast.
  - IPv6: loopback, unspecified, fc00::/7, fe80::/10, multicast, and IPv4-mapped or IPv4-compatible forms of any refused IPv4 address.
- Hosts written as decimal, octal or hex numbers are read as the address they denote.
- The connection goes to the checked address. At most 3 redirects are followed, and each hop is checked again before it is contacted.
- The answer must be a JPEG or PNG by content, at most 12,582,912 bytes, within 10 seconds.
- A refused address answers the "can't be used" error. Any other failure answers the "couldn't fetch" error.

**Uploads.** Type is judged by the bytes, never by the name or the declared type. A file exactly at its limit is accepted.

| Kind | Content check | Limit |
|---|---|---|
| `brief_pdf` | Starts with `%PDF-` | 10,485,760 bytes |
| `venue_photo` | Starts with the JPEG or PNG signature | 12,582,912 bytes |
| `installation_glb` | Bytes 0–3 are `glTF`, bytes 4–7 hold version 2, and bytes 8–11 hold the total length, which equals the file size | 26,214,400 bytes |

- The displayed name is the last path segment of the given name, with control characters removed and cut to 120 characters. It is never used in storage keys.
- A file is Stored only after MinIO acknowledges the write and the app has confirmed the object's size. The SHA-256 is of the exact bytes received.
- The latest stored GLB model replaces the main piece's outline in the configurator, scaled to the piece's footprint.

**Documents.**

- Signing renders the contract PDF.
- Issuing each Kill Bill invoice renders an invoice PDF for that payer.
- An issued PDF's bytes are never rewritten. Re-signing makes contract version n+1 under a new key.

**Maintenance.**

- Maintenance bills monthly in advance in Kill Bill.
- A plan change takes effect immediately with the venue-local date as its requested date. Kill Bill credits the unused part of the old plan and charges the new plan from that date.
- The app shows Kill Bill's invoice items and amounts and never computes proration itself.
- When Kill Bill records a payment for a maintenance invoice, a receipt email is sent once.
- Each start or change creates a `maintenance.changed` event.

**Crew alerts.** The alerts are:

- Slot confirmed: when the deposit is confirmed.
- Day-before load-in: scheduled for 09:00 venue-local time on the day before the install day, and sent at once if that moment has already passed when the day is booked.
- Placement changed: as described under Pieces and placement.

**Jobs.** Every email, PDF, render submission, preview storage, crew alert and CRM event is a row in the Postgres job table, created in the same transaction as the change that causes it.

- Workers claim jobs with row locks, so several app instances sharing one database run each job once.
- A running job whose 30-second lease lapses, for example after a restart, is claimed again.
- A job whose service fails is retried at least every 10 seconds, without a restart, and takes effect within 30 seconds of the service answering again.
- Each job's effect happens exactly once:
  - an email is sent once;
  - a PDF is stored once under its fixed key;
  - the provider gets the job reference as its idempotency key;
  - Svix gets the event id;
  - a crew alert is posted once.

**Access.**

- A client sees only commissions they created, with their briefs, files, renders, documents, ledger and deliveries.
- A sponsor sees only their own share.
- A crew lead sees only install days they are assigned to.
- The producer sees everything.
- Any id outside the caller's reach answers 404, including ids inside request bodies.

### Services (DP-13, DP-30, DP-36, DP-37, DP-39, DP-41, DP-44, DP-45, DP-47, DP-49)

**Kill Bill.**

- At start, until it succeeds, the app uploads its catalog to the tenant if absent: product `Maintenance` (base) with plans `maintenance-essential-monthly` and `maintenance-priority-monthly`, monthly and billed in advance, with immediate plan changes and account billing alignment.
- Each payer (lead client or sponsor) has one USD account with external key `<app user id>` and the external payment method as its default.
- Each issued milestone or sponsor share is one invoice on the payer's account with two external-charge items: `<commission title> — <label> — work` (the subtotal part) and `<commission title> — <label> — sales tax` (the tax part). `<label>` is the milestone label or `Sponsor share`.
- Each confirmed payment is one PURCHASE payment for that invoice's balance, with transaction external key equal to the request's Idempotency-Key.
- Maintenance is a subscription with external key `maint-<commission id>` on the client's account.
- When Kill Bill is unreachable, the actions that need it answer 503 `billing_unavailable`: signing, paying, accepting an invite, starting or changing maintenance, and the moves that issue invoices. Nothing changes state.

**Mailpit (SMTP).** Every email is from MAIL_FROM and arrives once.

| Email | To | Subject | Body contains |
|---|---|---|---|
| Receipt | The payer | `Receipt — <commission title> — <label>` | `Amount paid: <amount>`, `Work: <amount>`, `Sales tax: <amount>`, `Kill Bill invoice: <invoice number>`, `Payment reference: <Kill Bill payment id>` |
| Sponsor invite | The sponsor's email | `You're invited to co-fund <commission title>` | The link, `Your share: <amount> (<percent>%)`, `This link works until <expiry instant>` |
| Milestone due | The lead client, or for `Sponsor share` the sponsor | `<label> is due — <commission title>` | `Amount due: <amount>`, `Due by: <due>` |
| Milestone paid | The lead client and the producer | `<label> is paid — <commission title>` | |
| Hold ended | The client | `Your hold on <date> has ended` | |

The milestone-due email is sent when the milestone or sponsor share is invoiced. With mail unreachable, actions succeed and the emails wait in the job table.

**MinIO** (bucket S3_BUCKET). Object keys:

- `commissions/<commission id>/files/<file id>`
- `commissions/<commission id>/renders/<render id>.png`
- `commissions/<commission id>/documents/contract-v<n>.pdf`
- `commissions/<commission id>/documents/invoice-<Kill Bill invoice id>.pdf`

Bytes are stored exactly as received or rendered. When MinIO is unreachable, uploads and downloads answer 503 `storage_unavailable`, and preview and PDF storage wait as jobs.

**Gotenberg.** The app posts HTML to `<GOTENBERG_URL>/forms/chromium/convert/html`.

- **Contract.** Headed `Commission agreement — <commission title>`. It lists Spindrift Rooms and the client, the installation, the venue, the held date, the quote lines and total, the payment schedule with each milestone's amount, the funders with their shares, and the typed signature with its time.
- **Invoice.** Headed `Invoice — <commission title> — <label>`. It shows the payer, the Kill Bill invoice number, `Work`, `Sales tax`, `Total` and `Due by`, with amounts equal to the Kill Bill invoice.

When Gotenberg is unreachable, documents stay `preparing` and their jobs wait; actions still succeed.

**Svix.**

- Each client has one application with uid `client-<app user id>`. Saving a CRM endpoint creates or updates its one endpoint, whose signing secret is shown to the client.
- Message event types are `slot.held`, `contract.signed`, `milestone.paid` (client milestones) and `maintenance.changed`.
- Each message is created with Svix `eventId` equal to the app's event id. Its payload is `{"eventId","type","occurredAt","commissionId","data"}`, where `data` is:

  | Event type | `data` |
  |---|---|
  | `slot.held` | `{"venueId","date","expiresAt"}` |
  | `contract.signed` | `{"signedAt","signatureName","contractDocumentId","contractSha256","depositKillbillPaymentId"}` |
  | `milestone.paid` | `{"milestoneId","label","subtotalCents","taxCents","amountCents","killbillInvoiceId","killbillPaymentId"}` |
  | `maintenance.changed` | `{"fromPlan","toPlan","effectiveDate"}` |

- Svix signs each delivery, retries failures on its own schedule and keeps the same event id across retries.
- When Svix is unreachable, events wait as jobs and saving an endpoint answers the 503.

**ntfy.** Alerts are posted to topic `spindrift-crew` with NTFY_USERNAME and NTFY_PASSWORD, tag `spindrift`, and these titles:

- `Slot confirmed — <venue name> — <date>`
- `Load-in tomorrow — <venue name> — <date>`
- `Placement changed — <commission title>`

The body is `<commission title> at <venue name> on <date>. Ref <job id>.` When ntfy is unreachable, alerts wait as jobs.

**Render provider (WireMock at WIREMOCK_URL).** The provider's data is invented.

- The app calls `POST <WIREMOCK_URL>/v1/renders` with header `Idempotency-Key: <render job id>` and this JSON body:

  ```
  {"jobRef":"<render job id>",
   "installationType":"camera-reactive-wall",
   "room":{"widthM":12,"depthM":9,"doorWall":"front"},
   "layout":[{"kind","x","y","rotationDeg"}] or null,
   "brief":{"title","audience","notes"},
   "venuePhoto":{"contentType","sizeBytes","sha256","base64"},
   "referenceImage":{"sourceUrl","contentType","sha256","base64"} or null,
   "callbackUrl":"<APP_PUBLIC_URL>/api/render-callbacks"}
  ```

- The provider answers `202 {"providerJobId":"rp_baseline_0001","status":"accepted","etaSeconds":40}`.
- A 5xx answer, a wait longer than 10 seconds or no connection leaves the job queued for retry. A 4xx answer fails the render with `failureReason` `provider_rejected`.
- The provider later posts callbacks to `/api/render-callbacks` with headers `X-Render-Timestamp: <unix seconds>` and `X-Render-Signature: v1=<hex>`, and this body:

  ```
  {"eventId","jobRef","providerJobId",
   "type":"render.progress|render.completed|render.failed",
   "progress":0-100,
   "preview":{"contentType":"image/png","base64"}   (completed only)
   "failureReason"   (failed only)}
  ```

When the provider is unreachable, preview requests still answer 202 and wait as queued jobs.

**Keycloak.**

- At start, until it succeeds, the app uses its service account to ensure the realm roles `producer`, `client`, `sponsor` and `crew` and the seeded users exist.
- A signed-in user with none of the four roles gets `client`.
- After sign-in without `returnTo`, each role lands on its route: the producer on `/studio`, a client on `/commissions`, a crew lead on `/crew`, and a sponsor on `/c/<commission id>/share` of their most recently accepted commission.
- When Keycloak is unreachable, `/auth/login` answers the 503 page. Existing sessions keep working until their access needs renewing.

### Seed data (DP-02, DP-21, DP-27)

Every person, business, venue and case study below is invented.

**Users** (in Keycloak; the email is also the username):

| Name | Email | Password | Role |
|---|---|---|---|
| Mara Lind | mara@spindrift.test | Spindrift-Producer-26 | producer |
| Theo Vance (Northwake Beverages) | theo@northwake.test | Northwake-Client-26 | client |
| Priya Raman (Lumen Hall) | priya@lumenhall.test | Lumenhall-Client-26 | client |
| Jonah Reyes | jonah@crew.spindrift.test | Crew-Jonah-26 | crew |
| Ama Boateng | ama@crew.spindrift.test | Crew-Ama-26 | crew |

**Venues:**

| id | Name | Address | City | Time zone | Tax (bp) |
|---|---|---|---|---|---|
| halsted-works | Halsted Works Hall | 1100 W Fulton Market | Chicago | America/Chicago | 1025 |
| pier-nine | Pier Nine Pavilion | 2 Harbor Way | Seattle | America/Los_Angeles | 1035 |
| lantern-court | Lantern Court Museum Lobby | 40 Esplanade | Denver | America/Denver | 881 |
| saltmarsh-grounds | Saltmarsh Festival Grounds | 9 Cholla Road | Phoenix | America/Phoenix | 860 |
| brightwater-atrium | Brightwater Atrium | 300 Water Street | New York | America/New_York | 888 |

**Prices** (cents):

- Main piece: Camera-reactive wall 1,800,000; Generative portrait kiosk 950,000; Voice-driven projection room 2,600,000.
- Size: Compact 0; Standard 350,000; Grand 725,000.
- Extras: Ambient sound 180,000; Night-mode lighting 240,000; Photo takeaway 115,000.

**Pieces** (label: footprint in metres):

- Main pieces: Camera-reactive wall 4.0 × 0.4; Portrait kiosk 1.2 × 1.2; Projection tower 1.0 × 1.0 (the main piece of a Voice-driven projection room).
- Extras: Speaker column 0.6 × 0.6 (Ambient sound); Light rig 0.8 × 0.8 (Night-mode lighting); Print station 1.0 × 0.6 (Photo takeaway).

**Maintenance plans:**

- Essential (`maintenance-essential-monthly`): $240.00 a month, monthly check-in and remote fixes.
- Priority (`maintenance-priority-monthly`): $480.00 a month, next-day on-site visits.

**Case studies:**

- **Tidewall** — a camera-reactive wall at Halsted Works Hall that turns passers-by into slow tides of light.
- **Second Face** — a generative portrait kiosk at Brightwater Atrium that draws each visitor as the person beside them sees them.
- **Echo Vault** — a voice-driven projection room at Lantern Court Museum Lobby where spoken words become falling constellations.

At start there are no commissions, briefs, holds, files or sponsors.

## Technical requirements

### Deployment (DP-56)

Backend: TypeScript on Node.js 22 with npm. Frontend: TypeScript built with Node 22.

Node.js 22 and npm are available. `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port `APP_PUBLIC_PORT` (4173 when unset). `GET /api/health` answers HTTP 200 `{"status":"ok"}`. The schema and the Kill Bill and Keycloak setup are applied idempotently every time the server starts, not only at build.

### Configuration and secrets (DP-56, DP-60)

Every value is read from the environment at start, never hard-coded and never sent to the browser:

- **Postgres:** DATABASE_URL.
- **Keycloak:** KEYCLOAK_URL, KEYCLOAK_REALM, AUTH_ISSUER_URL, AUTH_CLIENT_ID, AUTH_CLIENT_SECRET.
- **Kill Bill:** KILLBILL_URL, KILLBILL_USERNAME, KILLBILL_PASSWORD, KILLBILL_API_KEY, KILLBILL_API_SECRET.
- **Mail:** SMTP_HOST, SMTP_PORT, MAIL_FROM.
- **MinIO:** S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_FORCE_PATH_STYLE, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
- **Gotenberg:** GOTENBERG_URL.
- **Svix:** SVIX_URL, SVIX_API_KEY.
- **ntfy:** NTFY_URL, NTFY_USERNAME, NTFY_PASSWORD.
- **Render provider:** WIREMOCK_URL; RENDER_WEBHOOK_SECRET (default `spindrift-render-dev-secret` when unset).
- **Timers, all in whole seconds:** HOLD_SECONDS (default 720), INVITE_TTL_SECONDS (default 604800), QUOTE_TTL_SECONDS (unset means the calendar rule) and ACCESS_TTL_SECONDS (default 300, the app session's access lifetime).
- **Public address:** APP_PUBLIC_URL, the public origin used for the Keycloak redirect, invite links and the render callback address.

### Server boundary (DP-49, DP-55, DP-56)

- **Same-origin only.** The app sends no cross-origin headers, and the browser loads nothing from other origins except the Keycloak sign-in pages and fonts bundled with the app. The browser never calls Kill Bill, Postgres, Svix, ntfy, Gotenberg or the render provider.
- **Body limits.** These are the ones stated in the API section.
- **What is served.** The server serves only the built app, its assets and the API. It never serves source files, source maps, run.json, environment files or credentials.
- **Cookies.** Session and sign-in cookies are httpOnly and SameSite=Lax.
- **Unreachable dependencies.** When a dependency is unreachable at boot, the app still starts, answers the health check and shows that service's banner. It connects and finishes its setup on its own when the service returns, with no restart.

### Browser support and performance (DP-51, DP-58)

- **Browsers:** current Chromium, Firefox and Safari.
- **Viewports:** 375x812 with touch, 768x1024 and 1280x800.
- **Loading:** the landing stage's first frame and headline appear within 3 seconds. Each brief question starts typing within 1 second of the previous step's server reply.
- **Responsiveness:** quote numerals start recounting within half a second of the server's reply, and the board reflects a payment within 2 seconds.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its version and licence, where shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`, plus every bundled font.
- IF-03: Every shipped package is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0 or Unlicense, and fonts are OFL-1.1; no GPL, AGPL or LGPL package ships.
- IF-04: The app stores data only in the provided Postgres and MinIO (plus the providers' own records), with no SQLite, Redis, local data files or in-memory store standing in for a database.
- IF-05: The seeded service configuration (compose files, service images and the provided realm, tenant and bucket settings) is left untouched; the app changes provider state only through their APIs at run time.
- IF-06: `package-lock.json` is committed and `install` uses it.
- IF-07: Fonts and scenes are bundled or generated; the app copies no third-party site's names, copy, images, models or shader code.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes and no disabled type checks.
- Names match this brief's domain terms: commission, brief, layout, piece, hold, install day, milestone, funder, sponsor share, quote, render job, ledger.
- Each domain rule (the state transitions, the splitting rule, tax rounding, due-date and expiry instants, the placement checks, the SSRF address check) is decided in exactly one place in the source.
- No abstraction has a single implementation, and nothing is built beyond this brief.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the types already rule out.
- Every API error uses the one error shape from the API section.
- Paid, stored, ready and delivered states are set only from provider confirmations, never from optimistic local updates.
