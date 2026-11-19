# Pellory Works Rulehouse

Rulehouse is a brand rulebook and logo-usage grant desk. Each customer deploys it for one brand, and this deployment runs the invented brand Quenby & Co. Public readers learn the brand from six published chapters, and the figures in those chapters can be operated by hand. Signed-in employees, agency partners and press contacts find assets and download sized renditions through short-lived links. Agency partners ask for one named use of one asset, and reviewers decide it in stages, citing stable rule identifiers. The brand owner releases and retires assets, publishes chapter versions, revokes grants and checks an audit log that shows any tampering.

Build one TypeScript server on Node 22 that uses three services:
- PostgreSQL is the system of record. It also drives the live fan-out to open screens.
- MinIO stores asset masters, sized derivatives and proof uploads.
- Mailpit receives every notice the product sends.

The following are out of scope:
- outside identity providers, single sign-on and directory sync (sign-in is local and groups are local)
- consent platforms, edge caches, outbound webhooks and outside log sinks
- audio, video and compiled animation scenes
- paid plans
- external assets and external fonts
- creating new assets, or editing licences and groups, in the UI (the seed sets them)
- any cache, queue or datastore beyond the three services

## Problem and users

A brand lead at a company of 40 to 400 people keeps the brand in three places that never agree: a PDF guidelines deck, a shared drive of logo files, and email threads where agencies ask whether they may put a given mark on a van wrap. Agencies download whatever they find and keep using it after their contract ends. Nobody can show who approved what, under which rule, or until when. Enterprise asset portals track rights and expiry, but they are priced and staffed for large companies. In those portals, request-and-approve is often added through metadata workarounds. Their guidelines are still static pictures, so a rule such as "body text contrast at least 4.5:1" cannot be checked on the page. The cost falls on the brand lead and outside counsel: rebrands that leak early, retired marks on partner work, and hours spent rebuilding an approval trail when legal asks.

Rulehouse publishes one brand's rulebook. Every rule has a stable identifier that requests and grants cite. A logo use is granted per application and ends no later than the agency's engagement. Every decision lands on an audit log that an auditor can verify.

| Role (API value) | Who | Goal |
|---|---|---|
| brand owner (`owner`) | runs the customer's Rulehouse, weekly | release, restrict and retire assets; set agency engagement end dates; invite people; publish chapter versions; revoke grants; verify the audit chain |
| brand reviewer (`brand_reviewer`) | daily | work the deadline-ordered queue; approve, reject, request changes or attach conditions that cite rule identifiers; approve chapter versions |
| legal reviewer (`legal_reviewer`) | weekly | review Co-brand, Merchandise and Partnership requests after brand review; attach legal conditions; accept proofs; revoke grants; read the audit log; see brand decisions arrive live |
| chapter author (`author`) | weekly | draft and submit chapter versions with stable rule identifiers |
| agency partner (`agency`) | weekly, one agency organisation with one engagement | find the right logo variant, request it for a named application, upload proofs, download released files before the engagement ends |
| employee (`employee`) | weekly | download generally released assets and cite a rule |
| press contact (`press`) | occasional | download press-licensed assets only |
| public reader (not signed in) | occasional | learn the brand from the public chapters by working their live figures |

The owner, both reviewer roles and the author work for the brand. For licence audiences they count as employees.

## Journeys

1. **An agency asks for the right variant.**
   - Start: Ana Ferreira of Studio Lumen is signed in and holds a grant on the Tab variant of the Logo.
   - She reads the Logo chapter's variant rules.
   - In the library she sees `Logo — Tab` as Available and `Logo — Full lock` as Request required, with the reason next to the disabled download.
   - Using only the keyboard, she opens the request dialog for Full lock, picks Co-brand, sets a campaign end after her engagement ends, reads the engagement cap notice, cites two rules and submits.
   - End: her request page shows Under review, `Held by Bea Lindqvist`, a due time and links for the cited rules.
2. **Three reviewers decide in turn and the grant arrives live.**
   - Start: Bea and Cai (brand reviewers) and Leo (legal reviewer) are signed in separately.
   - Bea and Cai each approve one brand stage.
   - Leo adds a clear-space condition and a no-recolour condition. His decision panel shows that the grant ends on the engagement end date. He approves.
   - End: without reloading, Ana's page announces that her request is Granted and shows the grant end and both condition texts. A grant mail sits in Mailpit.
3. **Downloads end when the grant ends.**
   - Start: Ana downloads the Tab file through a link that shows when it expires.
   - Leo revokes her grant from the grants screen.
   - Ana's open library changes the badge to Request required, and her old link now answers not found.
   - Finn de Vries of Fathom Collective downloads a file. The app clock passes the link lifetime.
   - End: Finn's link answers that it has expired.
4. **A proof unlocks a grant.**
   - Start: Finn's Pin pictogram grant is waiting for a proof.
   - He tries a renamed text file, which is refused, then an oversized PNG, which is refused, then a valid PNG, which shows as waiting for review.
   - Bea accepts the proof in her own session.
   - End: Finn's grant turns Active live.
5. **A chapter version waits for its assets.**
   - Start: Ari Novak (author) submits Iconography version 2, which references the draft Courier spot icon. Bea approves it.
   - Olu Mensah (owner) tries to publish and is refused with a list of unreleased assets.
   - Olu's first release attempt is refused because a derivative is the wrong size. He removes it, uploads a correctly sized file, releases the asset and publishes.
   - An anonymous reader sees `Version 2`. Olu then republishes version 1 as version 3.
   - End: the public page shows version 3 and version 2 is superseded.
6. **A missed deadline lands with the owner and on the record.**
   - Start: a Co-brand request is submitted.
   - As the app clock advances, the holder gets a warning mail.
   - At the deadline, the stage moves to Olu's queue live, marked as escalated, and Olu receives a mail.
   - Past the ceiling, the request expires.
   - Olu filters the audit log to that request, reads every record and verifies the chain.
   - End: after one record is tampered with, verification names the broken record.
7. **A public reader learns the brand by playing.**
   - Start: an anonymous reader opens the home page.
   - The reader scrolls through the rulebook assembly into the chapter mosaic.
   - The reader drags the weight slider, selects a colour family on the wheel to filter the swatch table, scrubs the motion playhead and reshapes the easing curve. Every figure also works by keyboard and by touch.
   - End: every figure shows its published readouts.
8. **A new agency partner is invited.**
   - Start: Olu invites a person by email.
   - The invitee opens the mailed activation link, sets a password and lands signed in on the library.
   - End: opening the same link again shows that it is no longer valid.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** /app/run.json installs, builds and serves the app on port 4173 (or APP_PUBLIC_PORT), and GET /api/health answers 200 with the status JSON qualified in Services.
- **DP-02 — Grading routes and server clock** Key-guarded reset, seed, clock and tamper routes behave as published in API, and every time-dependent decision uses the shared app clock in the workspace time zone with the published date and time formats.
- **DP-03 — Sign-in and sessions** Seeded people sign in with email and password through the sign-in page or carry a seed-issued session cookie, and sign-out ends the session.
- **DP-04 — Invitation activation by mail** Inviting an agency partner or press contact mails a one-use activation link that sets a password and signs them in, and a used or expired link shows the published invalid-link page.
- **DP-05 — One error order and shape** Every API error follows the published check order and returns the {"error","message"} body with the code and message from the API error catalogue.
- **DP-06 — Not found for what you cannot open** Another agency's request, grant or proof, a draft version for non-editors, the queue for non-reviewers and admin areas for the wrong roles all answer exactly like a resource that does not exist.
- **DP-07 — Server-side role checks** Each action in the role table, other than the audit reads answered not found, is refused with 403 for a caller who can see its target but whose role may not perform it, whatever the UI shows, while an invisible target answers not found first, and the 403 refusal is audited as denied as qualified in Business rules.
- **DP-08 — Credentials from the environment** Every service URL, credential, key and timer is read from the published environment variables at start and never hard-coded or sent to the browser.
- **DP-09 — Blueprint look on every screen** Public and signed-in screens carry the published visual design: white ground under the chapter frame grid, flat field colours with ink text, the system type, grid-framed cells and the stated corner rule.
- **DP-10 — Rulebook assembly** On desktop widths without reduced motion, scrolling the pinned home stage assembles the opening cell, brand promise card and incoming chapter fields into the chapter mosaic in the published steps, reversing step by step on scroll back.
- **DP-11 — Reduced motion and phone stacking** Under reduced motion or below the 768-pixel breakpoint the home page shows three static stacked sections with opacity-only fades, the jump-to-chapters cue moves focus to the mosaic, and every sliding motion is absent.
- **DP-12 — Published breakpoint** At 768 pixels and wider the mosaic has four columns and the review queue is a table; narrower, the mosaic has two columns and the queue is a card list, with no horizontal overflow at 375, 768 or 1280 pixels.
- **DP-13 — Variant cards and grant scope** The library shows one card per logo variant named "<asset name> — <variant label>", and a grant on one variant never makes another variant or the base asset available.
- **DP-14 — Request a variant with the engagement cap** An agency partner requests a variant by keyboard through the request dialog, sees the engagement cap notice when the campaign outlasts the engagement, and lands on a request page showing Under review, its holder and its cited rule links.
- **DP-15 — Stage routing and the holder** Submission routes the request through the published brand, second-brand and legal stages to the least-loaded eligible reviewer, escalates to the owner when nobody is eligible, and the request always shows one holder.
- **DP-16 — Multi-stage approval to a grant** Two brand reviewers and a legal reviewer each decide their stage of a Co-brand mark request in their own sessions, and the requester's page turns Granted live with the grant end, conditions, announcement and grant mail.
- **DP-17 — Grant window** A minted grant runs from its approval or proof-acceptance date to the earliest of the four published caps, with the cap named in the decision panel and a Zero-length grant when the end falls before the start.
- **DP-18 — Conditions** Stage holders attach the six published condition kinds with validated values, each shown with its exact display text on the request, the grant and the grant mail.
- **DP-19 — Live request updates** Request pages, review queues, libraries and admin grant views update over the app's live channel within two seconds of a change, and every request state change is announced with the published sentence.
- **DP-20 — Availability decision** Each card's badge, reason and enabled actions come from the published six-step decision evaluated on the server at request time against the app clock, never the device clock.
- **DP-21 — Viewer-scoped library data** Library and grant responses for agency partners and press contacts carry only the published fields and only the caller's own grants, conditions and requests.
- **DP-22 — Library filters** Signed-in viewers filter the library by class, availability and search by keyboard, with each card's accessible name carrying its badge and the results status reading the published count sentence.
- **DP-23 — Signed download links** Download issues a link valid for the configured lifetime that re-runs the availability decision on every use, answering the published not-found or expired page as qualified in Business rules.
- **DP-24 — Revocation ends access live** When an owner or legal reviewer revokes a grant, the holder's open library changes the badge without reload and the link they already hold answers not found.
- **DP-25 — Proof upload checks** Proof uploads are accepted only as PNG, JPEG or PDF detected by content and up to the configured size, with the published refusals.
- **DP-26 — Proof review** A reviewer accepts or rejects a pending proof from their own session and the requester sees the grant turn Active, or the rejection reason, live.
- **DP-27 — Storage outage** With MinIO unreachable, health reports unavailable with 200, proof upload, release and download show the published storage copy, and chapters, library and queue keep working.
- **DP-28 — Size contracts on release** An asset is released only after storage confirms every derivative object and each matches its class's size contract, otherwise the release is refused with one published line per failing derivative.
- **DP-29 — Publication rules** A version that references any unreleased asset cannot be published and the refusal names each one, while a successful publish or republish supersedes the previous version in one step.
- **DP-30 — Draft to published version** An author submits a version, a brand reviewer approves it, the owner publishes it once its assets are released, and anonymous readers see the new version line and copy at once.
- **DP-31 — Citing rules by identifier** Requests cite live rule identifiers whose links open the chapter with that statement focused, all operable by keyboard.
- **DP-32 — Withdrawn rules** A withdrawn identifier's rule page names the version that withdrew it and links its replacement, and unknown identifiers answer not found.
- **DP-33 — Deadline timers and mail** Each request carries a stored deadline by application tier, with a warning mail at the configured share of the window, escalation to the owner at the deadline and expiry at the configured multiple, all fired by the app clock.
- **DP-34 — Deadline-ordered queue** A reviewer's queue lists their open stages by deadline then request id with the due time, and an owner sees a breached stage arrive live with the escalation label.
- **DP-35 — Concurrent decisions and duplicate submits** Of two simultaneous decisions on one stage exactly one wins and the other gets the published refusal, a decision after withdrawal is refused, and a double-submitted request creates one request.
- **DP-36 — Retirement during review** Retiring an asset needs a released successor, shows the successor on its card and rejects every open request on it with the published successor reason.
- **DP-37 — Audit records and chain** Every published action appends one attributed record whose hash covers the previous hash and its canonical form, the log cannot be changed through the API, and verification reports the first broken record.
- **DP-38 — Audit screen** The owner filters the audit log to one request, reads exact before and after cells, and verifies the chain from the screen, seeing the broken record after tampering.
- **DP-39 — Weight slider** The typography chapter's weight slider works fully by keyboard with the published range, readout, rendered weight, transition and delayed announcement.
- **DP-40 — Colour wheel and swatch table** The colour chapter's wheel of ten family buttons is operable by arrow keys and Enter, filters the published swatch table and announces the published count sentence.
- **DP-41 — Motion timeline** The motion chapter's playhead moves by keyboard, drag, touch and keyframe buttons in whole seconds, the readout and values table follow the published keyframes, and Play behaves as published including under reduced motion.
- **DP-42 — Curve editor** The curve editor's two handles move by arrow keys, Shift+arrow, mouse and touch drag with the published steps and clamps, the printed curve updates, and Reset curve restores the default.
- **DP-43 — Phone review in a bottom sheet** A reviewer at phone width opens a request from the queue cards and decides it in a bottom sheet with large touch targets while the requester on desktop sees the change live.
- **DP-44 — Changes requested and resubmission** Request changes returns the request to its requester as holder, and resubmission reopens the same stage with the same reviewer and a fresh deadline.

## Frontend

### Screens and layout (DP-09, DP-11, DP-12, DP-13, DP-22, DP-43)

**Breakpoint rule.** Widths of 768 pixels and wider get the desktop layout. Narrower widths get the phone layout. The three published viewports, 375x812, 768x1024 and 1280x800, have no horizontal overflow, and no other breakpoint changes which layout these viewports get. At 768x1024 the desktop layout uses narrower columns.

**Public routes (anonymous and signed in):**

- `/` is the home page. In order, it contains:
  1. The **rulebook opening cell**: a white cell framed by grid lines, about 800 pixels wide on desktop and about 325 pixels wide on phones. It holds the four-line opening statement at the top left. In its bottom row it pairs the small Quenby mark (bottom left) with the **jump-to-chapters cue** (bottom right).
  2. The **brand promise card**: a solid square in the accent colour, about 500 pixels on desktop and about 325 pixels on phones. It holds a white display statement at the top left and the white Quenby mark at the bottom left.
  3. The **chapter mosaic**: eight chapter tiles plus the **Quenby mark tile**.

  On desktop without reduced motion these sit on one pinned stage (see Motion and effects). On phones and under reduced motion they are three stacked static sections in normal flow.

  On desktop the mosaic fills exactly one viewport, with thin gutters and a thin outer margin. It has four columns of unequal width and three rows:
  - Logo: column 1, rows 1–2
  - Voice: column 2, row 1
  - Colour: column 3, rows 1–2
  - Typography: column 4, row 1
  - Quenby mark tile: a small square in column 2, row 2
  - Iconography: column 1, row 3
  - Motion: column 2, row 3
  - Library: column 3, row 3
  - Rule index: column 4, rows 2–3

  On phones the mosaic has two columns:
  - Logo | Voice
  - Colour | Typography
  - Iconography | Quenby mark tile stacked above Motion
  - Library | Rule index

  The tile reading order and Tab order everywhere is Logo, Voice, Colour, Typography, Iconography, Motion, Library, Rule index. Every tile shows:
  - its label at the top left in the display face
  - one oversized glyph in the lower area
  - a line under the label: `v<n> · <count> rules` for chapters (`<n>` is the published version number and `<count>` is that version's statement count, both from the server), `Assets and grants` for Library, and `<total> rules` for Rule index (`<total>` is the number of live rules)

  Each tile has a field colour and a glyph:

  | Tile | Field | Glyph |
  |---|---|---|
  | Logo | Lagoon | the **big Quenby mark glyph**, anchored bottom right on desktop and bottom left on phones |
  | Colour | Saffron | two overlapping stepped swatch squares |
  | Typography | Ember | the **letterform specimen glyph**: a huge "Aa" anchored bottom right, slightly over the padding |
  | Iconography | Meadow | a parcel pictogram |
  | Motion | Iris | the **easing handle glyph**: an S-curve drawn as a thin line between two small rounded-square handles |
  | Voice | Moss | the **voice quote glyph**: heavy opening marks at the top left and closing marks at the bottom right, each a filled disc with a tapering tail |
  | Library | Clay | an outlined padlock |
  | Rule index | Orchid | three stacked identifier bars joined by a thin line with square nodes |

  Every glyph is flat inline vector art in two or three shades of its tile's hue.
- `/chapters/<slug>` shows a chapter page. The `logo`, `colour`, `typography`, `iconography`, `motion` and `voice` chapters each show, inside grid-framed white cells:
  - a level-1 heading with the chapter title
  - the line `Version <n>, published <D MMM YYYY>`
  - the introduction
  - the list of rule statements, each with its identifier visible
  - the chapter's figures, if any

  On desktop the statements and figures sit in two columns. On phones they are one column, with figures after the statements.
- `/rules` is the rule index: every live identifier grouped under its chapter title, each a link.
- `/rules/<identifier>` is one rule (see Interactions).
- Any unknown route shows the not-found page: a single field cell with one large glyph and the heading `Not found`.

**Signed-in routes:**

- Every signed-in screen has a top bar with the small Quenby mark, `navigation "Main"` showing only the links the caller's role may open, and `button "Sign out"`.
- `/signin` shows the sign-in form in one centred cell.
- `/activate/<token>` shows the activation form.
- `/library` shows the filters and asset cards:
  - desktop: filters in a left cell and cards in a grid of three columns at 1280 pixels and two columns at 768 pixels
  - phones: one column, with filters above the cards

  Each card shows:
  - the card name, class label and licence name
  - the availability badge as a field-colour chip with its word and a glyph (never colour alone: Available meadow with a check, Request required saffron with a key, Restricted ember with a bar, Retired stone with a clock)
  - the download action, or the disabled action with its reason
  - for agency partners, `Request use`
  - for the viewer, their own grant line if any
- `/requests` lists the agency partner's own requests in a table.
- `/requests/<id>` is the request page. A header cell shows the request id, state label, holder, escalation and due time. Cells below show the details, cited rules, stages, conditions, grant and proofs.
  - Reviewers and owners on desktop see the decision panel as a right-hand cell.
  - On phones the decision panel opens as a bottom sheet.
- `/queue` is a table on desktop and a card list on phones.
- `/editor/<slug>` shows the version list and the open version's form.
- `/admin/assets`, `/admin/grants`, `/admin/audit` and `/admin/people` are owner screens; the legal reviewer may also open audit and grants. Each is a grid-framed table with its actions.

**Empty states.** Each empty state is a single field cell with one large glyph and one sentence:
- library with no matches: `No assets match these filters.`
- empty queue: `Nothing is waiting for you.`
- no requests: `You have no requests yet.`
- audit filter with no matches: `No audit records match.`

### Public screens and controls (DP-03, DP-04, DP-10, DP-13, DP-14, DP-22, DP-38, DP-39, DP-40, DP-41, DP-42, DP-43)

Only these roles, names and copy are public, and tests and judges touch only these. Names shown as `<...>` are filled from the record.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Home | `heading` level 1 | `Quenby & Co. is not a mood board. It is a set of rules, each with a name you can cite.` set over four lines |
| Home | `button "Jump to chapters"` | two stacked chevrons |
| Home | `region "Brand promise"` | `Every colour, letter, mark and move here is a rule with an identifier. Ask for what you need by name, and we answer by name.` |
| Home | `navigation "Chapters"` | holds the eight tile links |
| Home | `link "<tile label>"` × 8 | labels `Logo`, `Voice`, `Colour`, `Typography`, `Iconography`, `Motion`, `Library`, `Rule index`; the tile line is the link's accessible description |
| Everywhere | `img "Quenby & Co. mark"` | hero, promise card, mark tile, top bar |
| Chapter | `heading` level 1 | chapter title |
| Chapter | `list "Rules"` | one `listitem` per statement; the item's element id is the identifier |
| Typography | `slider "Weight"` | native range; readout `Weight <n>` |
| Typography | `figure "Weight specimen"` | `Quenby & Co. sets every letter by rule.` |
| Typography | `status "Weight announcement"` | polite; `Weight <n>` |
| Colour | `group "Palette wheel"` | ten `button "<family> family"` with pressed state |
| Colour | `button "Show all families"` | |
| Colour | `status "Swatch filter"` | polite; `<n> swatches in <family>` or `20 swatches` |
| Colour | `table "Swatches"` | caption `Swatches`; columns Name, Hex, On white, Rating, On ink, Rating |
| Motion | `list "Tracks"` | items `<property>, <n> keyframes` |
| Motion | `group "Timeline"` | drag area for the playhead |
| Motion | `slider "Playhead"` | readout `mm:ss / mm:ss` |
| Motion | `button "<property> keyframe at mm:ss"` | one per keyframe |
| Motion | `table "Values at playhead"` | columns Property, Value |
| Motion | `button "Play"` / `button "Pause"` | the label toggles |
| Motion | `group "Curve editor"` | holds the plot |
| Motion | `button "Handle 1"`, `button "Handle 2"` | the accessible name stays exactly `Handle 1` / `Handle 2`; the value text `x <x>, y <y>` is the button's accessible description, taken from visible text beside the handle that updates on every move |
| Motion | `status "Printed curve"` | the curve in the printed curve format defined in Interactions |
| Motion | `button "Reset curve"`, `button "Replay"`, `region "Curve demo"` | |
| Rule route | `link "<identifier>"` | replacement link in the withdrawal notice |
| Sign-in | `textbox "Email"`, password field labelled `Password`, `button "Sign in"` | |
| Activation | `heading` level 1 `Activate your account`, password field labelled `Password`, `button "Activate account"` | |
| Signed in | `navigation "Main"` | links `Library`, `My requests`, `Queue`, `Editor`, `Admin` (by role) |
| Signed in | `button "Sign out"` | |
| Signed in | `status "Page status"` | polite; success copy |
| Signed in | `alert` | errors and outages, inside the form or panel that failed |
| Library | `group "Filters"` | holds the next three controls |
| Library | `combobox "Class"` | options `All classes`, then the six class labels |
| Library | `checkbox "Available"`, `checkbox "Request required"`, `checkbox "Restricted"`, `checkbox "Retired"` | |
| Library | `searchbox "Search assets"` | |
| Library | `status "Library results"` | polite; the count sentence |
| Library | `article "<card name>, <badge>"` | one per card |
| Card | `button "Download <file name>"` | one per derivative when Available |
| Card | `button "Download"` | when not Available: shown disabled but focusable, with the reason as visible text and as its accessible description |
| Card | `button "Request use"` | agency partners only; disabled with its reason when the decision says so |
| Card | `link "Download again: <file name>"` | appears after a link is issued, next to `Link expires at <HH:mm>` |
| Request dialog | `dialog "Request <card name>"` | |
| Request dialog | `combobox "Application"` | the nine application labels |
| Request dialog | `group "Territories"` | one checkbox per engagement territory code |
| Request dialog | date fields labelled `Campaign start` and `Campaign end` | |
| Request dialog | `group "Cited rules"` | one checkbox per live identifier, named by the identifier |
| Request dialog | `textbox "Note"` | |
| Request dialog | `status "Request notices"` | |
| Request dialog | `button "Submit request"`, `button "Cancel"` | |
| My requests | `table "My requests"` | columns Request, Asset, Application, State, Due |
| Request page | `heading` level 1 `<request id>` | |
| Request page | `status "Request state"` | state label |
| Request page | text `Held by <display name>`, `Due <D MMM YYYY HH:mm>` and the escalation label | |
| Request page | `list "Cited rules"` | `link "<identifier>"` per cited rule |
| Request page | `region "Grant"` | grant id, status label, `Ends <D MMM YYYY>`, condition texts |
| Request page | `region "Proofs"` | file field labelled `Proof file`, `button "Upload proof"`, rows `<file name> — <proof status label>` |
| Request page | `button "Withdraw request"`, `button "Resubmit request"` | requester only, by state |
| Request page | assertive live region named `Request updates` | |
| Decision (desktop) | `region "Decision"` | |
| Decision (phone) | `button "Decide"` opens `dialog "Decide <request id>"` | bottom sheet |
| Decision panel | text: stage reason, grant preview | |
| Decision panel | `textbox "Comment"` | |
| Decision panel | `button "Approve"`, `button "Reject"`, `button "Request changes"` | |
| Decision panel | `combobox "Condition"` | options `Clear space`, `No recolour`, `Attribution`, `Proof required`, `Territory`, `Expiry override` |
| Decision panel | `textbox "Condition value"`, `button "Add condition"` | |
| Proof review | `button "Accept proof"`, `button "Reject proof"`, `textbox "Proof rejection reason"` | |
| Queue | `table "Review queue"` (desktop) / `list "Review queue"` (phone) | columns or card lines Request, Asset, Application, Requester, Stage, Due; each request id is a `link "<request id>"` |
| Queue | `status "Queue updates"` | polite |
| Editor | `list "Versions"` | items `Version <n> — <state word>` |
| Editor | `button "Start version <n>"` | |
| Editor | `textbox "Introduction"` | |
| Editor | `textbox "Rule identifier <k>"`, `textbox "Rule text <k>"` | `<k>` counts from 1 |
| Editor | `button "Add statement"`, `button "Remove statement <k>"` | |
| Editor | `combobox "Replacement for <identifier>"` | |
| Editor | `group "Referenced assets"` | one checkbox per asset name |
| Editor | `button "Save draft"`, `button "Submit for review"` | |
| Editor | `textbox "Review comment"`, `button "Approve version <n>"`, `button "Request changes to version <n>"` | |
| Editor | `button "Publish version <n>"`, `button "Republish version <n>"` | |
| Admin assets | `table "Assets"` | |
| Admin assets | `button "Release <asset name>"`, `button "Restrict <asset name>"`, `button "Retire <asset name>"` | |
| Admin assets | `dialog "Retire <asset name>"` | `combobox "Successor"`, `button "Retire asset"` |
| Admin assets | file field labelled `Add derivative to <asset name>` | |
| Admin assets | `button "Remove <file name>"` | |
| Admin grants | `table "Grants"` | |
| Admin grants | `button "Revoke <grant id>"` | |
| Admin grants | `dialog "Revoke <grant id>"` | `textbox "Reason"`, `button "Revoke grant"` |
| Admin audit | `textbox "Request id"`, `combobox "Action"` (options `All actions`, then the action vocabulary), date fields labelled `From` and `To`, `button "Apply filters"` | |
| Admin audit | `table "Audit log"` | columns Sequence, Time, Actor, Action, Resource, Before, After, Outcome |
| Admin audit | `button "Verify chain"`, `status "Chain status"` | |
| Admin people | `textbox "Email"`, `textbox "Display name"`, `combobox "Role"` (`Agency partner`, `Press contact`), `combobox "Organisation"`, `button "Invite person"` | |
| Admin people | date field labelled `Engagement end for <organisation name>`, `button "Save engagement end for <organisation name>"` | |

### Interactions (DP-10, DP-11, DP-14, DP-22, DP-31, DP-39, DP-40, DP-41, DP-42, DP-43)

**Keyboard is complete.** Every action works by keyboard, and pressing Enter on a focused button or link activates it. Every dialog and bottom sheet:
- moves focus to its first field when it opens
- keeps focus inside: Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last (a native dialog alone does not do this)
- closes on Escape or Cancel
- returns focus to the control that opened it when it closes

Focus is always visible as a two-pixel ink outline set three pixels outside the control.

**Home page.**
- Activating `Jump to chapters` scrolls to the finished mosaic and moves focus to the Logo tile.
- Focusing any tile link by Tab also jumps the scroll to the finished mosaic, so the focused tile is fully visible.
- No behaviour depends on a scroll position.

**Rule links.**
- `/rules/<identifier>` for a live rule renders that rule's chapter page with the URL unchanged. It scrolls the statement into view and moves focus to the statement's list item, whose element id is the identifier.
- Every cited identifier on a request or grant is a link to its `/rules/<identifier>` route.

**Library.**
- Changing the class, ticking an availability checkbox or typing in the search box filters the cards at once, without a page load.
- Search matches the card name or the class label, ignoring case.
- Cards are sorted by card name in code point order.
- `Request use` opens `dialog "Request <card name>"` with:
  - `Campaign start` set to today's date from the server
  - the first engagement territory ticked
  - `Application` set to `Social`
- When `Campaign end` is after the engagement end, `status "Request notices"` shows the engagement cap notice from Feedback states as soon as the field changes.
- `Submit request` sends the request with a fresh submission key that is created when the dialog opens and reused for every press until the dialog closes. Pressing it twice therefore makes one request.
- On success the browser goes to the new request page.
- Pressing `Download <file name>` issues a link (see API) and starts the download. The card then shows `Link expires at <HH:mm>` and `link "Download again: <file name>"` pointing at the issued link.

**Request page and decisions.**
- The decision panel is shown to the stage holder and to owners. It shows:
  - the stage reason
  - the grant preview
  - `Comment`
  - the three decision buttons
  - the condition picker
- Reject and Request changes use the text in `Comment` as the reason or comment.
- `Add condition` sends the selected kind and the `Condition value` text. These value formats are accepted:
  - Clear space: `0.5`, `1`, `1.5` or `2`
  - Attribution: free text
  - Territory: codes such as `DE, AT`
  - Expiry override: a date in `YYYY-MM-DD` form
  - No recolour and Proof required: the value is ignored
- After a condition is added, the grant preview updates.
- A reviewer can decide a request from the queue without a pointer:
  1. Tab to the row's request link.
  2. Press Enter. The request page opens with focus on its level-1 heading.
  3. Tab reaches `Comment`, then `Approve`, `Reject`, `Request changes`, `Condition`, `Condition value` and `Add condition`, in that order.

**Phone review (narrower than 768 pixels).**
- Queue rows are cards. Tapping a card's request link opens the request page.
- `button "Decide"` sits fixed at the bottom of the screen. It opens `dialog "Decide <request id>"` as a bottom sheet that rises from the bottom edge and covers at most the lower two thirds of the screen. The sheet has the same controls as the desktop panel.
- Every control in the sheet and on the phone queue is at least 44 by 44 pixels and works by tap.
- After a decision the sheet closes, focus returns to `Decide`, and the result appears in `Page status`.

**Weight slider (typography chapter).**
- `slider "Weight"` is a native range control: minimum 250, maximum 900, step 1, starting at 400.
- Keys follow native behaviour and are clamped: arrows ±1, Page Up and Page Down ±50, Home 250, End 900.
- The readout `Weight <n>` and the specimen's rendered font weight follow the value on every change.
- The weight demo uses the system font stack and loads no font file.

**Palette wheel (colour chapter).**
- The ten disc buttons sit clockwise from the top in this order: Ember, Saffron, Meadow, Lagoon, Harbour, Iris, Orchid, Clay, Moss, Stone.
- Only one disc is in the Tab order at a time. Right and Down move focus clockwise, Left and Up move it anticlockwise, and focus wraps around.
- Enter or Space selects the focused family: its button is marked pressed, the swatch table shows only that family's rows, and `Swatch filter` reads the count sentence from Feedback states.
- `Show all families` clears the selection, shows all twenty rows and announces the cleared sentence.
- Pointer and touch taps select too.

**Motion timeline (motion chapter).**
- The timeline lasts 12 seconds and has six tracks. Keyframes (time in seconds → value) are:

  | Property | Keyframes |
  |---|---|
  | Opacity | 0 → 0, 2 → 1, 10 → 1, 12 → 0 |
  | Scale | 0 → 0.8, 3 → 1, 12 → 1 |
  | Offset X | 0 → -40, 4 → 0, 8 → 0, 12 → 40 |
  | Offset Y | 0 → 24, 3 → 0, 12 → 0 |
  | Rotate | 0 → -6, 6 → 0, 12 → 6 |
  | Blur | 0 → 8, 2 → 0, 10 → 0, 12 → 4 |

  So `list "Tracks"` reads `Opacity, 4 keyframes`, `Scale, 3 keyframes`, `Offset X, 4 keyframes`, `Offset Y, 3 keyframes`, `Rotate, 3 keyframes`, `Blur, 4 keyframes`.
- `slider "Playhead"` is a native range control: minimum 0, maximum 12, step 1. Arrows move ±1, Page Up and Page Down ±4, Home to 0, End to 12.
- The readout reads `mm:ss / 00:12`, for example `00:05 / 00:12`.
- Pressing the mouse or touching inside `group "Timeline"` moves the playhead. The group's width maps 0 to 12 seconds from left to right, and each value snaps to the nearest whole second. Touch drags work the same as mouse drags.
- Each `button "<property> keyframe at mm:ss"` moves the playhead to its time.
- `table "Values at playhead"` shows each property's value interpolated linearly between its neighbouring keyframes, with two decimals rounded half up, for example `-1.00`. For example, at `00:01` the values are Opacity `0.50`, Scale `0.87`, Offset X `-30.00`, Offset Y `16.00`, Rotate `-5.00` and Blur `4.00`. At `00:05` the values are Opacity `1.00`, Scale `1.00`, Offset X `0.00`, Offset Y `0.00`, Rotate `-1.00` and Blur `0.00`.
- `Play` changes its label to `Pause` and advances the playhead one second per second of browser clock, stopping at 12. Under reduced motion `Play` jumps straight to the end and the readout reads `00:12 / 00:12`.

**Curve editor (motion chapter).**
- The plot area is 320 pixels square. x runs from 0 at the left edge to 1 at the right edge. y runs from -0.5 at the bottom edge to 1.5 at the top edge.
- **Printed curve format.** A curve is printed as the word `cubic`, a hyphen, the word `bezier`, then the four values in parentheses separated by comma and space, `(x1, y1, x2, y2)`, each value with exactly two decimals. This is the format wherever a curve is printed.
- The default curve for rule `motion.curve.panel-open` is the printed curve with values `(0.30, 0.00, 0.20, 1.00)`. At that default, `Handle 1` has value text (its accessible description, as stated in the controls table) `x 0.30, y 0.00` and `Handle 2` has `x 0.20, y 1.00`.
- On a focused handle, Left and Right change x by 0.01 and Up and Down change y by 0.01. With Shift held, each step is 0.10.
- x is clamped to 0.00–1.00 and y to -0.50–1.50.
- Mouse or touch dragging a handle maps the pointer through the plot area, snapped to 0.01 and clamped the same way.
- `Printed curve` shows the printed curve format, for example with values `(0.40, -0.10, 0.20, 1.00)`.
- `Reset curve` restores the default.
- `Replay` moves a block across `region "Curve demo"` in one second along the printed curve. Under reduced motion it jumps to the end at once.

**Text equivalents.** Every figure has a paragraph that states its rule in prose next to it, and every figure works without a pointer.

### Visual design (DP-09)

The design direction is **seed**: a blueprint grid that re-cuts itself around flat, saturated colour fields.

**Typefaces.**
- Display: the system UI sans stack at a heavy weight (650). It is used for headings, tile labels and button labels.
- Body: the same system stack at 400 and 600, with tabular figures for every number.
- Display headings are about twice the body size.
- No web font is loaded.

**Colour roles.** Names refer to the swatch table in the colour chapter.
- Ground: white.
- Grid lines: hairlines in Harbour 300 at about 40 percent strength.
- Accent: Harbour 700, used for the opening statement, the brand promise card, the mark tile and focus-adjacent emphasis.
- On-accent: white.
- Ink: the brand ink printed under the swatch table.
- Muted ink: Stone 700.
- Fields: the eight 300 tones Ember, Saffron, Meadow, Lagoon, Iris, Orchid, Clay and Moss. Each always carries ink text. As the published swatch table proves, ink on every field passes AAA.
- Field colours are reserved for chapter identity and status. Signed-in content sits in white cells.

**Mood.**
- Flat: solid fields, with no shadow and no gradient anywhere.
- Exact: every block edge lands on a grid line.
- Playful: each chapter tile carries one oversized glyph.
- Density is comfortable.

**Composition.**
- The **chapter frame grid** is a full-bleed layer of thin lines on both axes. It sits behind every screen and re-cuts its cells around whatever is on screen.
- Public pages are a pinned stage that assembles the one-viewport chapter mosaic.
- Signed-in screens set content in white cells bounded by the same lines, with about 23 pixels of cell padding and labels in the display face at a small size in sentence case.

**Hero.**
- The rulebook opening cell holds the four-line accent statement.
- Its bottom row pairs the small Quenby mark with the jump-to-chapters cue.
- The Quenby mark is an original cluster of three stacked trapezoids, each with a chevron cut. It appears at three sizes: about 34 pixels in the hero and top bar, about 46 pixels on the promise card and mark tile, and about 116 pixels as the big Quenby mark glyph.

**Corners and buttons.** One corner rule applies everywhere: sharp inner corners, and slightly rounded corners (about 8 pixels) only on the outer corners of a cell group or the mosaic. Primary actions use a black pill button with white text.

**Working screens.**
- The library, queue, request page, editor and audit log sit inside grid-framed white cells.
- Badges are field chips with a word and a glyph.
- The queue is a cell table ordered by deadline.
- Empty and error states are a single field cell with one large glyph and the sentence.

**Size and contrast.** Every interactive control is at least 44 by 44 pixels on phones and at least 32 pixels tall on desktop. All text meets WCAG 2.2 AA contrast.

**Design risk.** Eight saturated fields share one viewport with dark ink and no neutral relief. A brand rulebook earns this, because colour, contrast and identity are its subject.

### Motion and effects (DP-10, DP-11, DP-39, DP-41, DP-42)

**Everyday feedback.**
- UI state changes (badges, panels, pressed buttons, tile hover) take about a third of a second and ease out.
- Grid-line fades take about one and a half seconds.
- When a block settles into a new slot without scroll scrubbing, the settle takes about three seconds and slows sharply at the end.
- Hovering a mosaic tile softens its corners and shifts its label a few pixels within about a third of a second.
- Nothing loops. Unnamed decorative loops are banned.

**Rulebook assembly (signature).** This runs at desktop widths without reduced motion. The home page pins a full-viewport stage for 2,700 pixels of scroll. Progress runs from 0 at the top to 1 after 2,700 pixels, and every change below is a direct function of progress:

1. **0 to 0.2.** The opening statement, mark and cue fade to invisible by 0.2. Grid lines slide to frame a centred square, and the brand promise card (about 500 pixels on a 1280x800 screen) fills it with its statement and white mark.
2. **0.2 to 0.5.** These are the **incoming chapter fields**. The Colour field (Saffron) enters from the left edge and the Logo field (Lagoon) enters from the right edge. The visible width of each grows evenly from about 70 to about 195 pixels, and grid lines track their inner edges.
3. **0.5 to 0.75.**
   - The card drops its statement but keeps its mark, and shrinks to about 416 pixels.
   - The Voice field (Moss) descends from the top and the Rule index field (Orchid) rises from the bottom.
   - The side fields widen to about 394 pixels.
   - Glyphs show cropped at the viewport edges. For example, the Logo field shows only part of the big Quenby mark glyph.
4. **0.75 to 1.** Every field moves into its mosaic slot. The card becomes the Quenby mark tile of about 90 pixels, gutters close to about 10 pixels, and the mosaic's outer corners round slightly. At progress 1 all eight tiles are inside the viewport and show their label, glyph and tile line.

Scrolling back reverses every step. While scrolling in one direction, each measured size and position changes in one direction only. After progress 1 the stage unpins.

**Reduced motion and phones.** Under reduced motion, or at widths below 768 pixels:
- there is no pinning and no sliding
- the opening cell, the brand promise card and the finished mosaic stack as three static sections in normal flow, and no element stays fixed or sticky while scrolling
- each section fades in by opacity only, in about 0.3 seconds, as it enters the viewport
- the jump-to-chapters cue moves focus straight to the Logo tile
- every tile stays a focusable link with the ink focus outline

Reduced motion also changes the figures:
- The weight specimen eases between weights over 500 milliseconds, and under reduced motion that transition lasts 0 seconds.
- Under reduced motion, `Play` and `Replay` jump to their end state at once.
- Under reduced motion, the bottom sheet appears without sliding.

### Feedback states (DP-04, DP-14, DP-19, DP-22, DP-25, DP-27, DP-38, DP-40)

Every string in backticks here and in API renders character for character: straight apostrophes, the same dashes, case and digits. Announcements built from these strings carry the same characters.

**While an action waits.** The pressed button reads `Signing in`, `Uploading` (proof and derivative uploads), `Checking chain` (Verify chain) or `Saving` (every other action), and is disabled until the response arrives.

**After a success.** These appear in `status "Page status"`:

| Action | Copy |
|---|---|
| submit request | `<request id> submitted.` |
| decision | `Decision saved.` |
| add condition | `Condition added.` |
| withdraw | `<request id> withdrawn.` |
| resubmit | `<request id> resubmitted.` |
| upload proof | `Proof uploaded. Waiting for review.` |
| accept proof | `Proof accepted.` |
| reject proof | `Proof rejected.` |
| revoke | `<grant id> revoked.` |
| release | `<asset name> released.` |
| restrict | `<asset name> restricted.` |
| retire | `<asset name> retired.` |
| add derivative | `<file name> added.` |
| remove derivative | `<file name> removed.` |
| save draft | `Draft saved.` |
| submit version | `Version <n> submitted for review.` |
| approve version | `Version <n> approved.` |
| request changes on a version | `Changes requested on version <n>.` |
| publish | `Version <n> published.` |
| republish | `Version <m> published from version <n>.` |
| invite | `Invitation queued for <email>.` |
| engagement end | `Engagement end saved.` |

**After an error.** Every failed action shows the API `message` verbatim in an `alert` inside the form, panel, card or row that failed. Storage outages use the 503 messages from the API catalogue, so the proof upload `alert` reads the proof storage message and a failed download reads the download message.

**Library results.** `status "Library results"` reads `<n> assets` (`1 asset` when one), followed by `, <value>` for each active filter in this order: the class label, then each ticked badge in the order Available, Request required, Restricted, Retired, then `matching "<query>"`. For example: `4 assets, Available`.

**Request notices.** In the request dialog, when the campaign outlasts the engagement: `Your engagement ends on <D MMM YYYY>, so any grant will end by then.`

**Live request announcements.** The assertive region `Request updates` on a request page announces `<request id> is now <state label>.` for every state change pushed after the page loaded. On a queue page, `status "Queue updates"` announces `<request id> added to your queue.` or `<request id> left your queue.`

**Weight announcement.** `status "Weight announcement"` says `Weight <n>` once, `WEIGHT_ANNOUNCE_DELAY_MS` milliseconds after the last change. Each new change restarts the wait.

**Swatch filter.** `status "Swatch filter"` reads `<n> swatches in <family>` (for example `2 swatches in Ember`), or `20 swatches` when cleared.

**Chain status.** `status "Chain status"` reads `Chain verified: <n> records.` or `Chain broken at record <sequence>.`

**Download link.** The card shows `Link expires at <HH:mm>` next to its link.

**Pages and notices:**

| Situation | Copy |
|---|---|
| invalid invitation | `This invitation link is no longer valid.` |
| expired download link | `This link has expired.` |
| not found | `Not found` |
| withdrawn rule | `This rule was withdrawn in version <n>. It is replaced by <identifier>.` |
| zero-length grant preview | `This grant would end on <D MMM YYYY>, before it starts. Approving records the decision but grants nothing.` |
| grant preview | `Grant will end on <D MMM YYYY> (<cap>)` |
| escalated, nobody eligible | `Escalated: no eligible reviewer` |
| escalated, deadline missed | `Escalated: deadline missed` |

## Backend

### API (DP-02, DP-03, DP-04, DP-05, DP-13, DP-21, DP-23, DP-25, DP-27, DP-37)

**General rules.**
- All bodies are JSON (`application/json; charset=utf-8`) except the uploads, which are `multipart/form-data` with a single field `file`.
- JSON request bodies may be at most 100,000 bytes (exactly 100,000 is allowed).
- Every JSON date-time is ISO 8601 UTC with milliseconds and `Z`. Calendar dates are `YYYY-MM-DD`.
- Authentication uses the session cookie named by `SESSION_COOKIE_NAME`, which is HttpOnly and SameSite=Lax.

**Error shape.** Every error is `{"error": "<code>", "message": "<text>"}`.

**Error check order.** This order applies to every route and is stated only here:
1. 401 not signed in
2. 404 unknown or not visible to the caller
3. 403 visible, but this role may not do this action
4. 409 state conflict (wrong state, stale revision, race)
5. 422 validation
6. 413 size
7. 503 storage unavailable

An idempotent replay returns its stored response before any of these checks except 401.

**Error catalogue.** `<...>` parts are filled from the record. These are the only codes the API returns.

| Status | Code | Message |
|---|---|---|
| 401 | `unauthenticated` | `Sign in to continue.` |
| 403 | `forbidden` | `You can't do that.` |
| 403 | `not_stage_holder` | `Only <holder display name> or an owner can decide this stage.` |
| 403 | `download_not_allowed` | the card's reason from the availability decision |
| 403 | `cross_origin` | `Requests must come from this site.` |
| 404 | `not_found` | `Not found` |
| 405 | `method_not_allowed` | `The audit log cannot be changed.` |
| 409 | `wrong_state` | requests `<request id> is already <state label>.`; grants `<grant id> is <status label>.`; assets `<asset name> is <state>.`; versions `Version <n> is <state word>.` |
| 409 | `already_decided` | `Already decided by <display name>: <decision label>.` |
| 409 | `withdrawn` | `<request id> was withdrawn by <display name>.` |
| 409 | `not_requestable` | `<card name> cannot be requested: <reason>` |
| 409 | `duplicate_open_request` | `You already have <request id> open.` |
| 409 | `idempotency_conflict` | `This submission key was already used for a different request.` |
| 409 | `stale_version` | `This draft changed since you opened it. Reload to see the latest.` |
| 409 | `open_version` | `Version <n> is already open.` |
| 409 | `publish_blocked` | `Cannot publish version <n>: <asset name> is <state>[, <asset name> is <state>...].` with assets in reference order |
| 409 | `already_registered` | `<email> already has an account.` |
| 409 | `seed_conflict` | `Reset before seeding.` |
| 410 | `invitation_invalid` | `This invitation link is no longer valid.` |
| 410 | `link_expired` | `This link has expired.` |
| 422 | `invalid_body` | `Request body is not valid JSON.` |
| 422 | `invalid_credentials` | `Email or password is incorrect.` |
| 422 | `email_invalid` | `Enter a valid email address.` |
| 422 | `weak_password` | `Password must be at least 12 characters.` |
| 422 | `application_prohibited` | `<application label> use is not permitted by this licence.` |
| 422 | `territory_invalid` | `Territories must be within your engagement: <codes, comma and space separated>.` |
| 422 | `campaign_dates` | `Campaign end must be on or after its start.` |
| 422 | `rules_required` | `Cite at least one rule.` |
| 422 | `rule_unknown` | `<identifier> is not a live rule.` |
| 422 | `note_too_long` | `Note must be 2,000 characters or fewer.` |
| 422 | `reason_required` | `Give a reason.` |
| 422 | `comment_required` | `Say what needs to change.` |
| 422 | `condition_invalid` | `Clear space must be 0.5, 1, 1.5 or 2.` / `Attribution needs a credit line.` / `Territory needs at least one country code.` / `Expiry override needs a date as YYYY-MM-DD.` |
| 422 | `proof_type` | `Proof must be a PNG, JPEG or PDF file.` |
| 422 | `derivative_type` | `Derivative must be a PNG or SVG file.` |
| 422 | `size_contract` | one line per failing derivative, joined by a line break: `Cannot release: <file name> is <w> x <h>; a <class label> must be <W> x <H>.` or `Cannot release: <file name> is missing from storage.` |
| 422 | `no_derivatives` | `Cannot release: <asset name> has no derivatives.` |
| 422 | `successor_invalid` | `Choose a released successor asset.` |
| 422 | `identifier_invalid` | `<identifier> is not a valid rule identifier.` |
| 422 | `identifier_prefix` | `<identifier> must start with <slug>.` |
| 422 | `identifier_duplicate` | `<identifier> appears twice.` |
| 422 | `identifier_missing` | `Every statement needs a rule identifier.` |
| 422 | `replacement_missing` | `<identifier> was removed without a replacement.` |
| 422 | `seed_invalid` | `<JSON path>: <problem>` |
| 413 | `proof_too_large` | `Proof must be <MB> MB or smaller.` |
| 413 | `too_large` | `Request body is too large.` |
| 503 | `storage_unavailable` | proof upload `Proof storage is unavailable. Your request is unchanged.`; link issue and `/dl` `Downloads are unavailable right now.`; release and derivative changes `Storage is unavailable. Nothing was changed.` |

`<MB>` is `PROOF_MAX_BYTES` divided by 1,048,576, printed without trailing zeros. The default 5242880 prints `5`.

When several fields fail validation, the message names the first failure in the body's field order.

**Endpoints.**

Health and session:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | — | 200 `{"status":"ok"}` or `{"status":"unavailable"}` (see Services) | none |
| `POST /api/session` | anyone | `{"email","password"}` | 200 `{"principal":{"id","displayName","role","organisationId"}}` and Set-Cookie | 422 `invalid_credentials` |
| `DELETE /api/session` | signed in | — | 204, cookie cleared | none |
| `GET /api/me` | signed in | — | 200 `{"principal":{...},"today":"YYYY-MM-DD","now":"<ISO>","timeZone":"Europe/Berlin","weightAnnounceDelayMs":300}` | none |

Invitations and engagements:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `POST /api/invitations` | owner | `{"email","displayName","role":"agency"\|"press","organisationId"}` | 201 `{"id","email","expiresAt"}` | 409 `already_registered`; 422 `email_invalid` |
| `GET /api/invitations/<token>` | anyone | — | 200 `{"email","displayName"}` | 410 `invitation_invalid` (unknown, used or expired) |
| `POST /api/invitations/<token>/activate` | anyone | `{"password"}` | 200 principal body and Set-Cookie | 410 `invitation_invalid`; 422 `weak_password` |
| `PUT /api/organisations/<id>/engagement` | owner | `{"endsOn":"YYYY-MM-DD"}` | 200 `{"id","engagement":{"startsOn","endsOn","territories"}}` | none |

Library, links and downloads:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/library?class=&availability=&q=` | signed in | all three optional; `class` takes one class key (for example `spot_icon`), never the label; `availability` takes a badge string exactly as printed in the card's `badge` field (`Available`, `Request required`, `Restricted`, `Retired`, URL-encoded, for example `Request%20required`) and repeats once per badge; `q` is the search text; an unrecognised `class` or `availability` value matches no card | 200 `{"count":n,"cards":[card]}`, where `count` is the number of cards returned after filtering | none |
| `POST /api/derivatives/<id>/link` | signed in | — | 201 `{"url":"/dl/<token>","expiresAt":"<ISO>"}` | 403 `download_not_allowed`; 503 |
| `GET /dl/<token>` | anyone holding the link | — | 200 file bytes with `Content-Disposition: attachment; filename="<file name>"` | 404 page `Not found`; 410 page `This link has expired.`; 503 page with the download message (HTML pages) |

Requests:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `POST /api/requests` | agency | `{"idempotencyKey","assetId","variantId"\|null,"applicationClass","territories":[...],"campaignStartsOn","campaignEndsOn","citedRules":[...],"note","submit":true\|false}` | 201 request detail (`submit` false saves a Draft) | 409 `not_requestable`, `duplicate_open_request`, `idempotency_conflict`; 422 request validation codes |
| `POST /api/requests/<id>/submit` | requester | — | 200 request detail | 409 `wrong_state` |
| `GET /api/requests` | agency | — | 200 `{"requests":[summary]}`, own requests only | none |
| `GET /api/requests/<id>` | requester, brand and legal reviewers, owner | — | 200 request detail | none |
| `POST /api/requests/<id>/withdraw` | requester | — | 200 request detail | 409 `wrong_state` |
| `POST /api/requests/<id>/resubmit` | requester | the same fields as create (all optional) | 200 request detail | 409 `wrong_state`; 422 |
| `POST /api/requests/<id>/stages/<n>/decision` | stage holder or owner | `{"decision":"approve"\|"reject"\|"request_changes","comment":string\|null}` | 200 request detail | 403 `not_stage_holder`; 409 `already_decided`, `withdrawn`, `wrong_state`; 422 `reason_required`, `comment_required` |
| `POST /api/requests/<id>/conditions` | stage holder or owner | `{"kind","value"}` | 201 `{"id","kind","text"}` | 403 `not_stage_holder`; 409 `wrong_state`; 422 `condition_invalid` |

Grants and proofs:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/grants` | owner and legal (all), agency and press (own) | — | 200 `{"grants":[grant]}` | none |
| `GET /api/grants/<id>` | holder, owner, legal | — | 200 grant | none |
| `POST /api/grants/<id>/revoke` | owner, legal | `{"reason"}` | 200 grant | 409 `wrong_state`; 422 `reason_required` |
| `POST /api/grants/<id>/proofs` | grant holder | multipart `file` | 201 `{"id","fileName","status":"pending_review","uploadedAt"}` | 409 `wrong_state`; 422 `proof_type`; 413 `proof_too_large`; 503 |
| `GET /api/proofs/<id>/content` | brand and legal reviewers, owner, holder | — | 200 the proof bytes | 503 |
| `POST /api/proofs/<id>/accept` | brand reviewer, legal reviewer, owner | — | 200 grant | 409 `wrong_state` |
| `POST /api/proofs/<id>/reject` | brand reviewer, legal reviewer, owner | `{"reason"}` | 200 grant | 409 `wrong_state`; 422 `reason_required` |

Queue and assets:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/queue` | brand reviewer, legal reviewer, owner | — | 200 `{"rows":[{"requestId","stage","stageLabel","cardName","applicationLabel","requesterName","organisationName","deadline","escalation"}]}` | none |
| `GET /api/admin/assets` | owner | — | 200 `{"assets":[{"id","name","class","state","successorId","derivatives":[{"id","variant","fileName","format","width","height","byteSize"}]}]}` | none |
| `POST /api/assets/<id>/derivatives` | owner | multipart `file`, optional field `variant` | 201 derivative | 409 `wrong_state` (not draft); 422 `derivative_type`; 413 `too_large` (over 10,485,760 bytes); 503 |
| `DELETE /api/derivatives/<id>` | owner | — | 204 | 409 `wrong_state`; 503 |
| `POST /api/assets/<id>/release` | owner | — | 200 asset | 409 `wrong_state`; 422 `size_contract`, `no_derivatives`; 503 |
| `POST /api/assets/<id>/restrict` | owner | — | 200 asset | 409 `wrong_state` |
| `POST /api/assets/<id>/retire` | owner | `{"successorAssetId"}` | 200 asset | 409 `wrong_state`; 422 `successor_invalid` |

Chapters, versions and rules:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/chapters` | anyone | — | 200 `{"chapters":[{"slug","title","version","publishedAt","ruleCount"}],"liveRuleCount":n}` | none |
| `GET /api/chapters/<slug>` | anyone | — | 200 `{"slug","title","version","publishedAt","intro","statements":[{"identifier","text"}],"assets":[name]}` | none |
| `GET /api/rules` | anyone | — | 200 `{"rules":[{"identifier","chapter","text","version"}]}` | none |
| `GET /api/rules/<identifier>` | anyone | — | 200 `{"identifier","status":"live","chapter","text"}` or `{"identifier","status":"withdrawn","withdrawnInVersion":n,"replacedBy":"<identifier>"}` | none |
| `GET /api/chapters/<slug>/versions` | author, brand reviewer, owner | — | 200 `{"versions":[{"id","number","state","revision","publishedAt"}]}` | none |
| `GET /api/versions/<id>` | anyone if published or superseded; otherwise author, brand reviewer, owner | — | 200 version with content | none |
| `POST /api/chapters/<slug>/versions` | author | — | 201 draft copied from the latest version | 409 `open_version` |
| `PUT /api/versions/<id>` | author | `{"revision","intro","statements":[{"identifier","text"}],"assetIds":[...],"withdrawn":[{"identifier","replacedBy"}]}` | 200 version (revision + 1) | 409 `wrong_state`, `stale_version`; 422 identifier codes |
| `POST /api/versions/<id>/submit` | author | — | 200 version | 409 `wrong_state`; 422 `identifier_missing` |
| `POST /api/versions/<id>/approve` | brand reviewer | — | 200 version | 409 `wrong_state` |
| `POST /api/versions/<id>/request-changes` | brand reviewer | `{"comment"}` | 200 version | 409 `wrong_state`; 422 `comment_required` |
| `POST /api/versions/<id>/publish` | owner | — | 200 version | 409 `wrong_state`, `publish_blocked` |
| `POST /api/chapters/<slug>/republish` | owner | `{"version":n}` | 201 the new published version | 409 `publish_blocked` |

Audit and live channel:

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/audit?requestId=&action=&from=&to=` | owner, legal | — | 200 `{"records":[record]}` in sequence order | none |
| `GET /api/audit/verify` | owner, legal | — | 200 `{"ok":bool,"records":n,"brokenAt":n\|null}` | none |
| any `POST`, `PUT`, `PATCH` or `DELETE` on `/api/audit` or below | owner, legal | — | — | 405 `method_not_allowed` |
| `GET /api/live` (WebSocket upgrade, same origin, cookie session) | signed in | — | server pushes `{"type":"request.updated","requestId"}`, `{"type":"queue.updated"}`, `{"type":"library.updated"}`, `{"type":"grant.updated","grantId"}`, `{"type":"chapter.updated","slug"}` | 401 before upgrade |

**Grading routes.** Every route below needs header `X-Grading-Key` equal to `GRADING_KEY`. A missing or wrong key answers 404 `not_found`.

| Method and path | Request | Success |
|---|---|---|
| `POST /api/grading/reset` | — | 200 `{"now":"<APP_START_AT in UTC>"}`. Empties every table and the bucket (a bucket it cannot reach is skipped), resets the app clock to `APP_START_AT` and does not reload the demo seed. |
| `POST /api/grading/seed` | the seed body below | 201 the seed response below. 409 `seed_conflict` if any principal exists; 422 `seed_invalid`. |
| `POST /api/grading/clock` | `{"advanceMinutes": n}` or `{"setTo": "<ISO>"}` | 200 `{"now":"<ISO>"}`. Runs every timer that became due, in due order, before answering. |
| `POST /api/grading/audit/tamper` | `{"sequence": n, "after": {...}}` | 200 `{"sequence": n}`. Overwrites that record's `after` without recomputing any hash. |

**Seed body.**
- Every object has a `key` made of lowercase letters, digits, `-` and `_`. References use keys.
- Ids are derived from keys:
  - principals `usr_<key>`
  - organisations `org_<key>`
  - groups `grp_<key>`
  - licences `lic_<key>`
  - assets `ast_<key>`
  - variants `var_<asset key>_<variant key>`
  - derivatives `drv_<asset key>_<n>`, where `<n>` counts from 1 across the asset in seed order (base derivatives first, then variants in order)
  - versions `ver_<slug>_<number>`
- Requests take `REQ-0001` upward in seed order and grants take `GR-0001` upward in seed order. Later requests, grants, conditions (`CON-0001`) and proofs (`PRF-0001`) continue each sequence.
- A request's `stages` list its stages in order. A decided stage has `decision`, `decidedAt` and `comment`. The first undecided stage of an `under_review` request is its open stage.
- Deadlines are derived from `submittedAt` and the application tier.
- A grant that names a `request` takes that request's conditions.
- The server writes each derivative object with generated bytes at the stated width and height (PNG pixels, or SVG `width` and `height`), and writes one master per asset.
- `audit` entries are chained in the order given. `actor` is a principal key or `system`. `request` is a request key or null.
- The seed sends no mail and runs no timers. Due points already past at the seed's clock are treated as done.

The complete example below is the demo dataset (see Seed data):

```json
{
  "organisations": [
    {"key": "quenby", "name": "Quenby & Co.", "kind": "brand", "territory": "DE"},
    {"key": "lumen", "name": "Studio Lumen", "kind": "agency", "territory": "DE",
     "engagement": {"startsOn": "2026-01-05", "endsOn": "2026-04-15", "territories": ["DE", "AT", "CH"]}},
    {"key": "fathom", "name": "Fathom Collective", "kind": "agency", "territory": "NL",
     "engagement": {"startsOn": "2026-02-01", "endsOn": "2026-12-31", "territories": ["NL", "BE"]}},
    {"key": "brightwell", "name": "Brightwell Agency", "kind": "agency", "territory": "DE",
     "engagement": {"startsOn": "2025-09-01", "endsOn": "2026-03-01", "territories": ["DE"]}},
    {"key": "ledger", "name": "The Morning Ledger", "kind": "press", "territory": "FR"}
  ],
  "principals": [
    {"key": "olu", "email": "olu@quenby.example", "displayName": "Olu Mensah", "role": "owner", "password": "rulehouse-demo-1", "organisation": "quenby"},
    {"key": "bea", "email": "bea@quenby.example", "displayName": "Bea Lindqvist", "role": "brand_reviewer", "password": "rulehouse-demo-1", "organisation": "quenby"},
    {"key": "cai", "email": "cai@quenby.example", "displayName": "Cai Brennan", "role": "brand_reviewer", "password": "rulehouse-demo-1", "organisation": "quenby"},
    {"key": "leo", "email": "leo@quenby.example", "displayName": "Leo Varga", "role": "legal_reviewer", "password": "rulehouse-demo-1", "organisation": "quenby"},
    {"key": "ari", "email": "ari@quenby.example", "displayName": "Ari Novak", "role": "author", "password": "rulehouse-demo-1", "organisation": "quenby"},
    {"key": "emi", "email": "emi@quenby.example", "displayName": "Emi Takahashi", "role": "employee", "password": "rulehouse-demo-1", "organisation": "quenby"},
    {"key": "ana", "email": "ana@studiolumen.example", "displayName": "Ana Ferreira", "role": "agency", "password": "rulehouse-demo-1", "organisation": "lumen"},
    {"key": "finn", "email": "finn@fathom.example", "displayName": "Finn de Vries", "role": "agency", "password": "rulehouse-demo-1", "organisation": "fathom"},
    {"key": "bram", "email": "bram@brightwell.example", "displayName": "Bram Koster", "role": "agency", "password": "rulehouse-demo-1", "organisation": "brightwell"},
    {"key": "pia", "email": "pia@morningledger.example", "displayName": "Pia Laurent", "role": "press", "password": "rulehouse-demo-1", "organisation": "ledger"}
  ],
  "groups": [
    {"key": "press-list", "name": "Press list", "members": ["pia"]}
  ],
  "licences": [
    {"key": "mark", "name": "Mark licence",
     "permittedApplications": ["internal_comms", "social", "press_article", "event", "film", "packaging", "co_brand", "merchandise", "partnership"],
     "prohibitedApplications": [], "audiences": ["employee", "agency"], "territories": ["worldwide"], "excludedTerritories": [],
     "defaultDurationDays": 90, "modificationPermitted": false, "attributionRequired": false},
    {"key": "general", "name": "General licence",
     "permittedApplications": ["internal_comms", "social", "press_article", "event", "film", "packaging", "co_brand", "partnership"],
     "prohibitedApplications": ["merchandise"], "audiences": ["employee", "agency"], "territories": ["worldwide"], "excludedTerritories": [],
     "defaultDurationDays": 365, "modificationPermitted": true, "attributionRequired": false},
    {"key": "editorial", "name": "Editorial licence",
     "permittedApplications": ["internal_comms", "social", "press_article"],
     "prohibitedApplications": [], "audiences": ["employee", "press"], "territories": ["worldwide"], "excludedTerritories": ["FR"],
     "defaultDurationDays": 30, "modificationPermitted": false, "attributionRequired": true},
    {"key": "press", "name": "Press licence",
     "permittedApplications": ["internal_comms", "press_article"],
     "prohibitedApplications": [], "audiences": ["employee", "press"], "territories": ["worldwide"], "excludedTerritories": [],
     "defaultDurationDays": 30, "modificationPermitted": false, "attributionRequired": true}
  ],
  "assets": [
    {"key": "logo", "name": "Logo", "class": "mark", "state": "released", "licence": "mark", "successor": null, "derivatives": [],
     "variants": [
       {"key": "full_lock", "derivatives": [
         {"fileName": "logo-full-lock.svg", "format": "svg", "width": 800, "height": 320},
         {"fileName": "logo-full-lock-1600.png", "format": "png", "width": 1600, "height": 640}]},
       {"key": "tab", "derivatives": [
         {"fileName": "logo-tab.svg", "format": "svg", "width": 320, "height": 320},
         {"fileName": "logo-tab-512.png", "format": "png", "width": 512, "height": 512}]}]},
    {"key": "logo-1998", "name": "Logo 1998", "class": "mark", "state": "retired", "licence": "mark", "successor": "logo", "variants": [],
     "derivatives": [{"fileName": "logo-1998.png", "format": "png", "width": 600, "height": 240}]},
    {"key": "parcel", "name": "Parcel spot icon", "class": "spot_icon", "state": "released", "licence": "general", "successor": null, "variants": [],
     "derivatives": [{"fileName": "parcel-120.png", "format": "png", "width": 120, "height": 120}]},
    {"key": "courier", "name": "Courier spot icon", "class": "spot_icon", "state": "draft", "licence": "general", "successor": null, "variants": [],
     "derivatives": [{"fileName": "courier-128.png", "format": "png", "width": 128, "height": 128}]},
    {"key": "pin", "name": "Pin pictogram", "class": "pictogram", "state": "released", "licence": "general", "successor": null, "variants": [],
     "derivatives": [{"fileName": "pin-64.png", "format": "png", "width": 64, "height": 64}]},
    {"key": "menu", "name": "Menu UI icon", "class": "ui_icon", "state": "released", "licence": "general", "successor": null, "variants": [],
     "derivatives": [{"fileName": "menu-24.svg", "format": "svg", "width": 24, "height": 24}]},
    {"key": "harbour-photo", "name": "Harbour photograph", "class": "photograph", "state": "released", "licence": "editorial", "successor": null, "variants": [],
     "derivatives": [{"fileName": "harbour-1600.png", "format": "png", "width": 1600, "height": 1067}]},
    {"key": "storefront", "name": "Storefront photograph", "class": "photograph", "state": "released", "licence": "press", "successor": null, "variants": [],
     "derivatives": [{"fileName": "storefront-1600.png", "format": "png", "width": 1600, "height": 1067}]},
    {"key": "rebrand-teaser", "name": "Rebrand teaser illustration", "class": "illustration", "state": "restricted", "licence": "general", "successor": null, "variants": [],
     "derivatives": [{"fileName": "rebrand-teaser-1200.png", "format": "png", "width": 1200, "height": 800}]}
  ],
  "requests": [
    {"key": "r-ana-tab", "requester": "ana", "asset": "logo", "variant": "tab", "applicationClass": "social", "territories": ["DE"],
     "campaignStartsOn": "2026-02-02", "campaignEndsOn": "2026-06-30", "citedRules": ["logo.variants.tab"], "note": "Spring social posts.",
     "state": "granted", "submittedAt": "2026-02-01T09:00:00.000Z", "escalation": null, "conditions": [],
     "stages": [
       {"kind": "brand", "assignee": "bea", "decision": "approve", "decidedAt": "2026-02-02T09:30:00.000Z", "comment": null},
       {"kind": "brand", "assignee": "cai", "decision": "approve", "decidedAt": "2026-02-02T10:00:00.000Z", "comment": null}]},
    {"key": "r-finn-pin", "requester": "finn", "asset": "pin", "variant": null, "applicationClass": "event", "territories": ["NL"],
     "campaignStartsOn": "2026-03-10", "campaignEndsOn": "2026-04-30", "citedRules": ["iconography.pictogram.size"], "note": "Trade fair signage.",
     "state": "granted", "submittedAt": "2026-02-26T10:00:00.000Z", "escalation": null,
     "conditions": [{"kind": "proof_required", "value": null, "addedBy": "bea"}],
     "stages": [{"kind": "brand", "assignee": "bea", "decision": "approve", "decidedAt": "2026-02-27T10:00:00.000Z", "comment": null}]},
    {"key": "r-finn-tab", "requester": "finn", "asset": "logo", "variant": "tab", "applicationClass": "social", "territories": ["NL"],
     "campaignStartsOn": "2026-03-05", "campaignEndsOn": "2026-05-31", "citedRules": ["logo.variants.tab"], "note": "Launch posts.",
     "state": "under_review", "submittedAt": "2026-03-02T07:00:00.000Z", "escalation": null, "conditions": [],
     "stages": [
       {"kind": "brand", "assignee": "cai", "decision": null, "decidedAt": null, "comment": null},
       {"kind": "brand", "assignee": null, "decision": null, "decidedAt": null, "comment": null}]},
    {"key": "r-bram-parcel", "requester": "bram", "asset": "parcel", "variant": null, "applicationClass": "packaging", "territories": ["DE"],
     "campaignStartsOn": "2026-03-01", "campaignEndsOn": "2026-09-30", "citedRules": ["iconography.spot.size"], "note": "Gift box sleeve.",
     "state": "under_review", "submittedAt": "2026-02-28T16:00:00.000Z", "escalation": null, "conditions": [],
     "stages": [{"kind": "brand", "assignee": "bea", "decision": null, "decidedAt": null, "comment": null}]}
  ],
  "grants": [
    {"key": "g-ana-tab", "holder": {"principal": "ana"}, "asset": "logo", "variant": "tab", "request": "r-ana-tab",
     "notBefore": "2026-02-02", "notAfter": "2026-04-15", "status": "active"},
    {"key": "g-finn-parcel", "holder": {"principal": "finn"}, "asset": "parcel", "variant": null, "request": null, "conditions": [],
     "notBefore": "2026-02-10", "notAfter": "2026-08-31", "status": "active"},
    {"key": "g-press-storefront", "holder": {"group": "press-list"}, "asset": "storefront", "variant": null, "request": null, "conditions": [],
     "notBefore": "2026-02-20", "notAfter": "2026-03-21", "status": "active"},
    {"key": "g-finn-pin", "holder": {"principal": "finn"}, "asset": "pin", "variant": null, "request": "r-finn-pin",
     "notBefore": null, "notAfter": "2026-04-30", "status": "pending_proof"}
  ],
  "chapters": [
    {"slug": "logo", "title": "Logo", "versions": [
      {"number": 1, "state": "superseded", "author": "ari", "publishedAt": "2026-01-12T09:00:00.000Z",
       "intro": "The Quenby mark is three stacked trapezoids. It comes in two locks.",
       "statements": [
         {"identifier": "logo.variants.full-lock", "text": "Use the Full lock for partnerships, co-branding and film."},
         {"identifier": "logo.variants.tab", "text": "Use the Tab alone when the symbol starts the layout."},
         {"identifier": "logo.clear-space.half", "text": "Keep clear space of half the symbol height around the mark."}],
       "assets": ["logo", "logo-1998"], "withdrawn": []},
      {"number": 2, "state": "published", "author": "ari", "publishedAt": "2026-02-02T09:00:00.000Z",
       "intro": "The Quenby mark is three stacked trapezoids. It comes in two locks, and each lock has its own rules.",
       "statements": [
         {"identifier": "logo.variants.full-lock", "text": "Use the Full lock for partnerships, co-branding and film."},
         {"identifier": "logo.variants.tab", "text": "Use the Tab alone when the symbol starts the layout."},
         {"identifier": "logo.clear-space.minimum", "text": "Keep clear space of at least 1x the symbol height on every side."},
         {"identifier": "logo.colour.no-recolour", "text": "Show the mark in Harbour 700, ink or white only."}],
       "assets": ["logo"], "withdrawn": [{"identifier": "logo.clear-space.half", "replacedBy": "logo.clear-space.minimum"}]}]},
    {"slug": "colour", "title": "Colour", "versions": [
      {"number": 1, "state": "published", "author": "ari", "publishedAt": "2026-02-02T09:00:00.000Z",
       "intro": "Ten colour families, each published with its contrast against white and ink.",
       "statements": [
         {"identifier": "colour.contrast.body-text", "text": "Body text meets a contrast of at least 4.5:1 against its ground."},
         {"identifier": "colour.fields.ink", "text": "Text on a 300 field colour is always set in ink."},
         {"identifier": "colour.accent.harbour", "text": "Harbour 700 is the only accent colour."}],
       "assets": [], "withdrawn": []}]},
    {"slug": "typography", "title": "Typography", "versions": [
      {"number": 1, "state": "published", "author": "ari", "publishedAt": "2026-02-02T09:00:00.000Z",
       "intro": "Quenby & Co. sets type in the reader's own system face.",
       "statements": [
         {"identifier": "typography.weight.range", "text": "Display type runs from weight 250 to 900; body text sits at 400."},
         {"identifier": "typography.figures.tabular", "text": "Numbers in tables use tabular figures."}],
       "assets": [], "withdrawn": []}]},
    {"slug": "iconography", "title": "Iconography", "versions": [
      {"number": 1, "state": "published", "author": "ari", "publishedAt": "2026-02-02T09:00:00.000Z",
       "intro": "Three icon classes, each with a fixed size.",
       "statements": [
         {"identifier": "iconography.spot.size", "text": "Spot icons are 120 x 120 pixels."},
         {"identifier": "iconography.pictogram.size", "text": "Pictograms are 64 x 64 pixels."},
         {"identifier": "iconography.ui.size", "text": "UI icons are 24 x 24 pixels."}],
       "assets": ["parcel", "pin", "menu"], "withdrawn": []},
      {"number": 2, "state": "draft", "author": "ari", "publishedAt": null,
       "intro": "Three icon classes, each with a fixed size, and a new courier icon.",
       "statements": [
         {"identifier": "iconography.spot.size", "text": "Spot icons are 120 x 120 pixels."},
         {"identifier": "iconography.pictogram.size", "text": "Pictograms are 64 x 64 pixels."},
         {"identifier": "iconography.ui.size", "text": "UI icons are 24 x 24 pixels."},
         {"identifier": "iconography.spot.courier", "text": "Use the Courier spot icon for delivery updates."}],
       "assets": ["parcel", "courier", "pin", "menu"], "withdrawn": []}]},
    {"slug": "motion", "title": "Motion", "versions": [
      {"number": 1, "state": "published", "author": "ari", "publishedAt": "2026-02-02T09:00:00.000Z",
       "intro": "Things arrive quickly and settle softly.",
       "statements": [
         {"identifier": "motion.curve.panel-open", "text": "Panels open on the standard easing curve with control values 0.30, 0.00, 0.20, 1.00."},
         {"identifier": "motion.timeline.length", "text": "Title sequences finish within 12 seconds."}],
       "assets": [], "withdrawn": []}]},
    {"slug": "voice", "title": "Voice", "versions": [
      {"number": 1, "state": "published", "author": "ari", "publishedAt": "2026-02-02T09:00:00.000Z",
       "intro": "We write the way we would say it across a counter.",
       "statements": [
         {"identifier": "voice.tone.plain", "text": "Write in plain words, one idea per sentence."},
         {"identifier": "voice.name.ampersand", "text": "Write the name as Quenby & Co., with the ampersand."}],
       "assets": [], "withdrawn": []}]}
  ],
  "audit": []
}
```

**Seed response (201).** Session values are opaque strings. Each one is a valid value for the cookie named in `cookieName`.

```json
{
  "now": "2026-03-02T08:00:00.000Z",
  "cookieName": "rulehouse_session",
  "ids": {
    "organisations": {"quenby": "org_quenby", "lumen": "org_lumen", "fathom": "org_fathom", "brightwell": "org_brightwell", "ledger": "org_ledger"},
    "principals": {"olu": "usr_olu", "bea": "usr_bea", "cai": "usr_cai", "leo": "usr_leo", "ari": "usr_ari", "emi": "usr_emi", "ana": "usr_ana", "finn": "usr_finn", "bram": "usr_bram", "pia": "usr_pia"},
    "groups": {"press-list": "grp_press-list"},
    "licences": {"mark": "lic_mark", "general": "lic_general", "editorial": "lic_editorial", "press": "lic_press"},
    "assets": {"logo": "ast_logo", "logo-1998": "ast_logo-1998", "parcel": "ast_parcel", "courier": "ast_courier", "pin": "ast_pin", "menu": "ast_menu", "harbour-photo": "ast_harbour-photo", "storefront": "ast_storefront", "rebrand-teaser": "ast_rebrand-teaser"},
    "variants": {"logo/full_lock": "var_logo_full_lock", "logo/tab": "var_logo_tab"},
    "derivatives": {
      "logo/logo-full-lock.svg": "drv_logo_1", "logo/logo-full-lock-1600.png": "drv_logo_2",
      "logo/logo-tab.svg": "drv_logo_3", "logo/logo-tab-512.png": "drv_logo_4",
      "logo-1998/logo-1998.png": "drv_logo-1998_1", "parcel/parcel-120.png": "drv_parcel_1",
      "courier/courier-128.png": "drv_courier_1", "pin/pin-64.png": "drv_pin_1", "menu/menu-24.svg": "drv_menu_1",
      "harbour-photo/harbour-1600.png": "drv_harbour-photo_1", "storefront/storefront-1600.png": "drv_storefront_1",
      "rebrand-teaser/rebrand-teaser-1200.png": "drv_rebrand-teaser_1"},
    "requests": {"r-ana-tab": "REQ-0001", "r-finn-pin": "REQ-0002", "r-finn-tab": "REQ-0003", "r-bram-parcel": "REQ-0004"},
    "grants": {"g-ana-tab": "GR-0001", "g-finn-parcel": "GR-0002", "g-press-storefront": "GR-0003", "g-finn-pin": "GR-0004"},
    "versions": {"logo/1": "ver_logo_1", "logo/2": "ver_logo_2", "colour/1": "ver_colour_1", "typography/1": "ver_typography_1", "iconography/1": "ver_iconography_1", "iconography/2": "ver_iconography_2", "motion/1": "ver_motion_1", "voice/1": "ver_voice_1"}
  },
  "sessions": {"olu": "<session value>", "bea": "<session value>", "cai": "<session value>", "leo": "<session value>", "ari": "<session value>", "emi": "<session value>", "ana": "<session value>", "finn": "<session value>", "bram": "<session value>", "pia": "<session value>"}
}
```

**Projected shapes.** For agency partners and press contacts these are the complete key lists. Any other key is a leak.

- **Library card**:
  - `assetId`, `variantId` (or null), `cardName`, `classLabel`, `licenceName`
  - `badge` (exactly one of the strings `Available`, `Request required`, `Restricted`, `Retired`, the same words the card shows), `reason` (null when Available), `successorName` (or null)
  - `canRequest` (always false for non-agency viewers), `requestReason` (or null), `openRequestId` (the caller's own open request on this card, or null)
  - `derivatives`: a list of `{id, fileName, format, width, height}`, empty unless Available
  - `grant`: the caller's own covering or pending grant `{id, status, statusLabel, notBefore, notAfter, conditions:[{kind,text}]}`, or null

  Other viewers get the same keys.
- **Request detail**:
  - `id`, `state`, `stateLabel`, `holder:{id,displayName}`, `requester:{id,displayName,organisationName}`
  - `cardName`, `assetId`, `variantId`, `applicationClass`, `applicationLabel`, `territories`, `campaignStartsOn`, `campaignEndsOn`
  - `citedRules:[{identifier,status}]`, `note`, `submittedAt`, `deadline`, `escalation` (`null`, `"no_eligible_reviewer"` or `"deadline_missed"`)
  - `stages:[{n,kind,label,assigneeName,decision,decisionLabel,decidedByName,decidedAt,comment}]`
  - `conditions:[{id,kind,text}]`, `grant` (as on the card, plus `cap`), `proofs:[{id,fileName,status,statusLabel,reason,uploadedAt}]`

  Stage holders and owners also get `stageReason` and `grantPreview:{notBefore,notAfter,cap,zeroLength}`.
- **Grant**: `id`, `status`, `statusLabel`, `holder:{type,id,displayName}`, `cardName`, `requestId`, `notBefore`, `notAfter`, `cap`, `conditions:[{kind,text}]`, `revokedReason`.

### Business rules (DP-02, DP-06, DP-07, DP-13, DP-15, DP-17, DP-18, DP-20, DP-23, DP-28, DP-29, DP-32, DP-33, DP-35, DP-36, DP-37, DP-44)

**App clock and dates.**
- The app clock starts at `APP_START_AT` (default `2026-03-02T09:00:00+01:00`) when the database is first created. It stands still unless the grading clock route moves it.
- The clock is stored in the database, so every instance that shares the database agrees on it.
- Business dates and times use `APP_TIME_ZONE` (default `Europe/Berlin`).
- Every date in the UI is `D MMM YYYY` in that zone, for example `15 Apr 2026` or `2 Mar 2026`. Every time in the UI is `HH:mm` in 24-hour form.
- Your device clock may be wrong, so the server decides every time-dependent status: badges, grant status, link expiry, deadlines, escalation, invitation validity and the default dates in forms. Pages show the status the server returns and never recompute it from the device clock.
- After every clock move, the server pushes `library.updated` and `queue.updated` to every open socket, and open screens re-fetch.

**Visibility.**
- Anything a caller cannot open answers 404 `not_found`, exactly as if it did not exist, on API and page routes alike. This covers:
  - another agency's request, grant, proof or proof content (another principal's request, even in the same agency, is also invisible)
  - a draft, in-review or approved version for anyone but authors, brand reviewers and the owner
  - `/queue` and `GET /api/queue` for anyone but brand reviewers, legal reviewers and owners
  - the pages `/admin/assets` and `/admin/people` for anyone but the owner, and the pages `/admin/audit` and `/admin/grants` for anyone but the owner and the legal reviewer
  - these API routes, which together with `GET /api/queue` above are the only API routes answered 404 because of the caller's role: `GET /api/admin/assets` for anyone but the owner; `GET /api/audit`, `GET /api/audit/verify` and every `POST`, `PUT`, `PATCH` or `DELETE` on `/api/audit` or below for anyone but the owner and the legal reviewer
  - grading routes without the key
- An id inside a request body that the caller cannot see answers 404, never 422.
- Anonymous visitors read published chapters, rules and the rule index only. Signed-out page routes for signed-in screens redirect to `/signin`.

**Role table.**
- These actions are allowed only for the listed roles. A caller who can see the target but has the wrong role gets 403, never 404 for a resource the caller can see. This covers `POST /api/invitations`, `PUT /api/organisations/<id>/engagement`, `POST /api/assets/<id>/derivatives`, `DELETE /api/derivatives/<id>`, release, restrict, retire, revoke, decisions, conditions, proof actions and version actions.
- When the target is invisible to the caller under Visibility, the action answers 404 first, because step 2 of the error check order (404) comes before step 3 (403). For example:
  - an agency partner uploading a proof on another agency's grant gets 404
  - an agency partner deciding a stage of another agency's request gets 404
  - a legal reviewer approving an in-review version gets 404, because only authors, brand reviewers and the owner can see versions that are not published or superseded
- Reading or verifying the audit log, and every write attempt on `/api/audit`, answers 404 to a wrong role, as listed under Visibility.
- Only the owner-only asset, derivative and organisation routes treat every existing id as visible to every signed-in caller (draft assets included). On those routes a wrong role gets 403 and only an unknown id gets 404.
- Each 403 refusal on a decision, condition, revoke, release, restrict, retire, version action, publish or link issue also writes one audit record with outcome `denied` and null `before` and `after`. A 404 writes no audit record.

| Action | Allowed |
|---|---|
| create, submit, withdraw or resubmit a request | agency (the requester for an existing request) |
| decide a stage, add a condition | the stage holder (a brand or legal reviewer) or an owner |
| accept or reject a proof | brand reviewer, legal reviewer, owner |
| upload a proof | the grant's principal holder |
| revoke a grant | owner, legal reviewer |
| release, restrict or retire an asset; add or remove derivatives | owner |
| start, edit or submit a version | author |
| approve a version or request changes to it | brand reviewer |
| publish or republish | owner |
| invite a person; set an engagement end | owner |
| read or verify the audit log | owner, legal reviewer |

- Nobody reviews their own request: the requester is never eligible for any stage. Nobody is granted anything by themselves.

**Assets.**
- Asset classes and labels: `mark` Mark, `spot_icon` Spot icon, `pictogram` Pictogram, `ui_icon` UI icon, `illustration` Illustration, `photograph` Photograph.
- Asset states: `draft` → `released` (release) → `restricted` (restrict) → `released` (release again). `retired` is reached from `released` or `restricted` (retire). Every other transition answers 409 `wrong_state`.
- Retiring needs a successor asset that is `released`; otherwise it answers 422 `successor_invalid`.
- Drafts appear only in `/admin/assets`. Released, restricted and retired assets appear in the library.
- A `mark` asset has variants. The Logo has `full_lock` (label `Full lock`: symbol and wordmark locked together, for partnerships, co-branding and film) and `tab` (label `Tab`: the symbol alone, for compositions where the symbol starts the layout).
- The library shows one card per variant, named `<asset name> — <variant label>` with an em dash and one space on each side. An asset without variants shows one card named by the asset.
- A grant on one variant never covers another variant, and a grant on an asset never covers its variants.

**Release: storage confirms before release.**
- Release checks every derivative of the asset (or of each variant) in derivative order. Storage must confirm that the object exists and that its byte length equals the recorded size. Each derivative of a size-contract class must also match its contract: Spot icon 120 x 120, Pictogram 64 x 64, UI icon 24 x 24 (pixels).
- Each failing derivative adds one `size_contract` line. If any line exists, nothing changes.
- An asset with no derivatives cannot be released.
- An uploaded derivative takes its pixel size from the stored file: the PNG header, or the SVG root's integer `width` and `height`. An upload with the same file name replaces the older derivative.
- Until release succeeds, the asset is not released anywhere: in the library, in publication checks or in requests.

**Licences.**
- A licence has these fields: `permittedApplications`, `prohibitedApplications` (beats permitted), `audiences` (a subset of `employee`, `agency`, `press`), `territories` (ISO codes or `worldwide`), `excludedTerritories`, `defaultDurationDays`, `modificationPermitted`, `attributionRequired`.
- A request whose application is not permitted, or is prohibited, answers 422 `application_prohibited`.

**Availability decision.** One server decision covers every (viewer, asset, variant) at the app clock. It is evaluated on every library read, link issue and link use, never by a background sweep. The first matching step wins:

1. The asset is `retired` → `Retired`, reason `Retired. Use <successor name> instead.`
2. The asset is `restricted` → `Restricted`, reason `Restricted by the brand team.`
3. An explicit deny applies → `Restricted`. An explicit deny beats any grant. The checks run in this order:
   - the viewer's audience is not in the licence audiences → `Not licensed for <audience plural>.` (plurals: `employees`, `agencies`, `press contacts`)
   - the viewer's organisation territory is in `excludedTerritories` → `Not licensed in <code>.`
   - the viewer is an agency partner whose engagement has ended (the app clock is past the end of `endsOn`) → `Your engagement ended on <D MMM YYYY>.`
4. An active grant covers exactly this asset and variant → `Available`, reason null. The grant must:
   - be held by the viewer or one of the viewer's groups
   - have the app clock inside the window from the start of `notBefore` to the end of `notAfter` (23:59:59.999 in `APP_TIME_ZONE`)
   - not be revoked
   - not be pending proof

   Employees, and the owner, reviewers and author, hold an implicit grant on every released asset whose audiences include `employee`.
5. The viewer is an agency partner with no covering grant → `Request required`.
   - Download is disabled with reason `Request use to download.`
   - `Request use` is enabled.
   - If the viewer has an open request (Draft, Routed, Under review or Changes requested) on this card, `Request use` is disabled with reason `You already have <request id> open.`
   - If the viewer holds a pending-proof grant on this card, `Request use` is disabled with reason `Upload your proof for <grant id> first.`
6. Anything else → `Restricted`, reason `Not licensed for <audience plural>.`

`POST /api/requests` succeeds only when the decision gives `Request required` with `Request use` enabled. Otherwise it answers 409 `not_requestable` using the card's reason, or 409 `duplicate_open_request`.

Worked examples, with the demo seed at start (2 Mar 2026):

| Viewer and card | Step | Result |
|---|---|---|
| Ana, `Logo 1998` | 1 | `Retired`, `Retired. Use Logo instead.` |
| Emi, `Rebrand teaser illustration` | 2 | `Restricted`, `Restricted by the brand team.` |
| Pia, `Harbour photograph` | 3, territory | `Restricted`, `Not licensed in FR.` |
| Ana, `Storefront photograph` | 3, audience | `Restricted`, `Not licensed for agencies.` |
| Bram, `Parcel spot icon` | 3, engagement | `Restricted`, `Your engagement ended on 1 Mar 2026.` |
| Ana, `Logo — Tab` (GR-0001) | 4 | `Available` |
| Pia, `Storefront photograph` (group grant GR-0003) | 4 | `Available` |
| Emi, `Logo — Full lock` | 4, implicit | `Available` |
| Ana, `Logo — Full lock` | 5 | `Request required` |
| Finn, `Logo — Tab` | 5, with REQ-0003 open | `Request required`; `Request use` disabled, `You already have REQ-0003 open.` |
| Finn, `Pin pictogram` | 5, with GR-0004 pending proof | `Request required`; `Request use` disabled, `Upload your proof for GR-0004 first.` |

On 16 Apr 2026 at 00:00 in Berlin, Ana's `Logo — Tab` turns `Restricted` with `Your engagement ended on 15 Apr 2026.`

**Application classes and deadline tiers.**

| Value | Label | Tier | Extra stage |
|---|---|---|---|
| `internal_comms` | Internal comms | standard (`DEADLINE_HOURS_STANDARD`, 24 h) | — |
| `social` | Social | standard | — |
| `press_article` | Press article | standard | — |
| `event` | Event | extended (`DEADLINE_HOURS_EXTENDED`, 48 h) | — |
| `film` | Film | extended | — |
| `packaging` | Packaging | legal (`DEADLINE_HOURS_LEGAL`, 72 h) | — |
| `co_brand` | Co-brand | legal | legal stage |
| `merchandise` | Merchandise | legal | legal stage |
| `partnership` | Partnership | legal | legal stage |

**Request validation.**
- At least one territory, each within the requester's engagement territories and the licence territories.
- Campaign end on or after campaign start.
- At least one cited rule, each a live identifier.
- A note of at most 2,000 characters (exactly 2,000 is allowed).
- At submission the request stores the current published version number of each cited rule's chapter and the requester's grants at that moment.

**Request states.**
- States and labels: `draft` Draft, `routed` Routed, `under_review` Under review, `changes_requested` Changes requested, `approved` Approved, `granted` Granted, `rejected` Rejected, `withdrawn` Withdrawn, `expired` Expired.
- Legal transitions:
  - draft → routed (submit)
  - routed → under_review (assignment, in the same transaction)
  - under_review → under_review (a non-final approval routes the next stage)
  - under_review → approved → granted (final approval mints the grant in the same step, so callers see Granted)
  - under_review → rejected
  - under_review → changes_requested
  - changes_requested → routed → under_review (resubmit)
  - draft, routed, under_review or changes_requested → withdrawn
  - under_review → expired (ceiling)
- Every other transition answers 409 `wrong_state`.
- **Holder.** A request always shows exactly one holder, as `Held by <display name>`. While Under review the holder is the open stage's assignee. In Draft, Changes requested and every terminal state the holder is the requester.

**Routing.**
- Stages run in order:
  1. `brand`, by a brand reviewer
  2. for `mark` assets only, a second `brand` stage by a different brand reviewer
  3. for Co-brand, Merchandise and Partnership only, `legal`, by a legal reviewer
- Each stage goes to the eligible reviewer with the fewest open stages, meaning undecided stages assigned to them on requests that are Under review. Ties go by display name A→Z.
- The requester is never eligible. A reviewer who decided an earlier stage of this request is not eligible for a later brand stage.
- When nobody is eligible, the stage goes to the owner with the fewest open stages (ties by display name), and the request shows `Escalated: no eligible reviewer`.
- The stage reason is one of:
  - `Stage <k> of <n>: brand review.`
  - `Stage <k> of <n>: first brand review (mark asset).`
  - `Stage <k> of <n>: second brand review (mark asset).`
  - `Stage <k> of <n>: legal review (<application label>).`

  With the demo seed, Ana's Co-brand Full lock request has three stages, assigned to Bea Lindqvist, Cai Brennan and Leo Varga. Bea and Cai each hold one open stage, and the tie goes to Bea by name.

**Decisions.**
- `approve` (label Approved), `reject` (label Rejected, needs a comment as its reason) and `request_changes` (label Changes requested, needs a comment).
- Approving a non-final stage routes the next stage. Approving the final stage mints the grant.

**Conditions.** Only the stage holder or an owner adds a condition, and only while the request is Under review. Conditions copy onto the grant.

| Kind | Value | Display text |
|---|---|---|
| `clear_space` | one of 0.5, 1, 1.5, 2 | `Keep clear space of <n>x the symbol height on every side.` |
| `no_recolour` | none | `Do not recolour the mark.` |
| `attribution` | non-empty text | `Credit line: <text>` |
| `proof_required` | none | `Upload final artwork for approval before use.` |
| `territory` | one or more codes | `Use only in: <codes, comma and space separated>` |
| `expiry_override` | a date | `Use ends on <D MMM YYYY>.` |

**Grant window.**
- `notAfter` is the earliest of:
  - the campaign end date (cap label `campaign end`)
  - the approval date plus `defaultDurationDays` calendar days (`licence term`)
  - any `expiry_override` date (`expiry override`)
  - the agency engagement `endsOn` (`engagement end`)

  When caps tie, the label is the first in that list.
- `notBefore` is the approval date, or the proof acceptance date when a proof is required.
- The window runs from the start of `notBefore` to 23:59:59.999 on `notAfter` in `APP_TIME_ZONE`. For example, a grant ending 15 Apr 2026 ends at `2026-04-15T21:59:59.999Z`, because Berlin is on summer time.
- Worked example: approved 2 Mar 2026, campaign end 30 Jun 2026, licence 90 days (31 May 2026), engagement end 15 Apr 2026 → the grant ends 15 Apr 2026 and the panel reads `Grant will end on 15 Apr 2026 (engagement end)`.
- **Zero-length.** When `notAfter` falls before `notBefore`, the decision panel shows the zero-length preview, and approving records the decision and mints a grant with status Zero-length. For example, Bram's REQ-0004 approved on 2 Mar 2026 with the engagement ending 1 Mar 2026. When the two dates are equal, the grant lasts one day.
- Grant statuses and labels:

  | Status | Label | Meaning |
  |---|---|---|
  | `active` | Active | |
  | `pending_proof` | Pending proof | minted when a `proof_required` condition exists |
  | `revoked` | Revoked | |
  | `expired` | Expired | derived when the app clock passes the end of `notAfter` |
  | `zero_length` | Zero-length | |

- Grant ids run `GR-0001` upward.
- Revoking needs a reason. It works only on Active or Pending proof grants (otherwise 409 `wrong_state`) and takes effect at once.

**Proofs.**
- The proof is detected by its content, not its extension:
  - PNG starts with bytes 89 50 4E 47 0D 0A 1A 0A
  - JPEG starts with FF D8 FF
  - PDF starts with `%PDF-`
- The proof may be at most `PROOF_MAX_BYTES` bytes (exactly that size is allowed). The type check runs before the size check.
- Uploading needs a Pending proof grant with no proof Pending review. Otherwise it answers 409 `wrong_state`.
- Proof statuses: `pending_review` Pending review, `accepted` Accepted, `rejected` Rejected.
- Accepting a proof sets the grant to Active with `notBefore` = the acceptance date. Rejecting needs a reason, and the requester may upload again.
- Objects are stored at `proofs/<grant id>/<proof id>`.

**Deadlines.**
- At submission and at each resubmission, the request stores `deadline` = the submission time plus the tier hours. It is never recomputed.
- While the request is Under review, three timers run on the app clock:
  - **warning** at `DEADLINE_WARNING_PERCENT` percent of the window: mail to the current holder
  - **breach** at the deadline: the open stage moves to the owner with the fewest open stages, the request shows `Escalated: deadline missed`, and the owner gets a mail
  - **ceiling** at `EXPIRY_CEILING_MULTIPLIER` times the window after submission: the request becomes Expired and the requester gets a mail
- Each timer fires once per submission. A clock jump past several points fires them in time order.
- With the defaults, a Co-brand request submitted at `2026-03-02T08:00:00.000Z` warns at `2026-03-04T14:00:00.000Z`, breaches at `2026-03-05T08:00:00.000Z` and expires at `2026-03-08T08:00:00.000Z`.
- Changes requested pauses all three. Resubmission starts them again from the new submission time.
- The queue lists the caller's open stages ordered by deadline ascending, then request id ascending. Each row shows `Due <D MMM YYYY HH:mm>`.

**Changes requested and resubmission.**
- Request changes makes the requester the holder.
- Resubmitting (optionally with edited fields, validated as on create) reopens the same stage with the same reviewer, sets a fresh deadline, and keeps every earlier approved stage.
- If that reviewer is no longer eligible, normal routing picks the stage's reviewer.

**Races and idempotency.**
- Every action on a request takes a lock on that request, and the first to commit wins:
  - When two people decide the same stage, the later one gets 409 `already_decided`, naming the first decider and the decision label.
  - A decision that finds the request withdrawn gets 409 `withdrawn`.
  - A decision or withdrawal on any other closed state gets 409 `wrong_state`.
- A create replayed with the same `idempotencyKey` by the same principal within `SUBMIT_DEDUP_SECONDS` seconds of the first (on the app clock) returns the stored 201 response with the same request. The same key with a different body answers 409 `idempotency_conflict`.
- Retiring an asset rejects every open request on that asset or its variants (Draft, Routed, Under review, Changes requested) with comment `Asset retired. Use <successor name> instead.`, decided by `system`.

**Chapters and versions.**
- Chapters `logo`, `colour`, `typography`, `iconography`, `motion` and `voice` have versions numbered from 1.
- Version states and words: `draft` draft, `in_review` in review, `approved` approved, `published` published, `superseded` superseded.
- Transitions:
  - draft → in_review (author submits)
  - in_review → approved (a brand reviewer approves)
  - in_review → draft (request changes)
  - approved → published (owner)
  - published → superseded (when a newer version publishes)

  Others answer 409 `wrong_state`.
- Only one version per chapter may be draft, in review or approved at a time.
- Every save carries `revision`. A stale revision answers 409 `stale_version`.
- Identifier rules:
  - An identifier matches `^[a-z]+\.[a-z0-9-]+\.[a-z0-9-]+$`, starts with the chapter slug and is unique in the version.
  - A draft may hold statements without an identifier, but submit and publish refuse them.
  - Removing an identifier that is live in the published version needs a `withdrawn` entry naming a replacement identifier present in the draft.
- **Publication** needs every referenced asset to be `released`. Otherwise it answers 409 `publish_blocked`, listing each unreleased asset in reference order with its state word. For example, with the demo seed: `Cannot publish version 2: Courier spot icon is draft.`
- Publishing makes the version published and the previous published version superseded in one transaction.
- `Republish version <n>` creates version latest + 1 with version n's content and publishes it in the same step, under the same check.
- Identifiers are stable across versions. A withdrawn identifier resolves to the version that withdrew it and its replacement, and `/rules/<identifier>` shows the withdrawal notice. For example: `/rules/logo.clear-space.half` names version 2 and links `logo.clear-space.minimum`. Unknown identifiers answer 404.

**Signed download links.**
- A link names one derivative, the caller and the covering grant (or the implicit employee grant), with an expiry `DOWNLOAD_LINK_TTL_SECONDS` seconds after issue on the app clock.
- The token is signed with `LINK_SIGNING_SECRET`.
- Every `GET /dl/<token>` checks, in order:
  1. A tampered or unknown token → 404.
  2. The availability decision, re-run at the app clock, no longer gives Available for that caller and card (grant revoked or ended, asset restricted or retired, engagement ended) → 404, even inside the link lifetime.
  3. The link is past its expiry → 410.
- A link used one second after its grant's end answers 404.
- Masters have no route at all.

**Audit log.**
- Every action in the table below writes exactly one record in the same transaction as the change.
- Fields: `sequence` (from 1, no gaps), `occurredAt` (app clock), `actorId` (`usr_...` or `system`), `actorRole` (the role, or `system` for timers and retirement rejections), `action`, `resourceType`, `resourceId`, `requestId` (or null), `before`, `after`, `outcome` (`success` or `denied`), `previousHash`, `recordHash`.
- **Hash.** `recordHash = sha256_hex(previousHash + "\n" + canonical)`. `canonical` is the JSON object with exactly the keys sequence, occurredAt, actorId, actorRole, action, resourceType, resourceId, requestId, before, after, outcome in that order, with nested object keys sorted A→Z, no whitespace, UTF-8. The first record's `previousHash` is 64 zeros.
- Worked example:
  - Record 1 canonical `{"sequence":1,"occurredAt":"2026-03-02T08:00:00.000Z","actorId":"usr_ana","actorRole":"agency","action":"request.submitted","resourceType":"request","resourceId":"REQ-0001","requestId":"REQ-0001","before":null,"after":{"state":"routed"},"outcome":"success"}` with previousHash of 64 zeros gives recordHash `8c66733454bcd3e060ccbf2d713f1d94e8ccfc8d30c42bcc2a1259db4f7b3c4e`.
  - Record 2 canonical `{"sequence":2,"occurredAt":"2026-03-02T08:00:00.000Z","actorId":"system","actorRole":"system","action":"request.assigned","resourceType":"request","resourceId":"REQ-0001","requestId":"REQ-0001","before":{"state":"routed"},"after":{"holder":"usr_bea","state":"under_review"},"outcome":"success"}` gives recordHash `3056a7c4a6168b444586954fce5749acc364fdd72ba9620f1e5714d30571d32c`.
- Actions and their exact `before` and `after`. Dates inside these objects are `YYYY-MM-DD` and holders are principal ids.

| Action | Actor | Resource | before | after |
|---|---|---|---|---|
| `request.submitted` | requester | request | `null` (first submission); `{"state":"draft"}`; `{"state":"changes_requested"}` | `{"state":"routed"}` |
| `request.assigned` | system | request | `{"state":"routed"}` (first open stage after a submission); `{"holder":"<previous>"}` (a later stage) | `{"holder":"<id>","state":"under_review"}`; `{"holder":"<id>"}`; either adds `"escalation":"no_eligible_reviewer"` when escalated |
| `request.decided` | decider, or system on retirement | request | `{"state":"under_review"}` | `{"decision":"<approve\|reject\|request_changes>","stage":<n>,"state":"<new state>"}` plus `"comment"` when given; new state is `under_review`, `granted`, `rejected` or `changes_requested` |
| `request.withdrawn` | requester | request | `{"state":"<state>"}` | `{"state":"withdrawn"}` |
| `request.escalated` | system | request | `{"holder":"<previous>"}` | `{"escalation":"deadline_missed","holder":"<owner id>"}` |
| `request.expired` | system | request | `{"state":"under_review"}` | `{"state":"expired"}` |
| `condition.added` | decider | condition | `null` | `{"kind":"<kind>","text":"<display text>"}` |
| `grant.minted` | final decider | grant | `null` | `{"notAfter":"<date>","notBefore":"<date or null>","status":"<active\|pending_proof\|zero_length>"}` |
| `grant.activated` | proof acceptor | grant | `{"status":"pending_proof"}` | `{"notBefore":"<date>","status":"active"}` |
| `grant.revoked` | revoker | grant | `{"status":"<status>"}` | `{"reason":"<text>","status":"revoked"}` |
| `proof.uploaded` | holder | proof | `null` | `{"fileName":"<name>","status":"pending_review"}` |
| `proof.accepted` | reviewer | proof | `{"status":"pending_review"}` | `{"status":"accepted"}` |
| `proof.rejected` | reviewer | proof | `{"status":"pending_review"}` | `{"reason":"<text>","status":"rejected"}` |
| `asset.released` | owner | asset | `{"state":"<draft\|restricted>"}` | `{"state":"released"}` |
| `asset.restricted` | owner | asset | `{"state":"released"}` | `{"state":"restricted"}` |
| `asset.retired` | owner | asset | `{"state":"<state>"}` | `{"state":"retired","successor":"<asset id>"}` |
| `chapter.submitted` | author | chapter_version | `{"state":"draft"}` | `{"state":"in_review"}` |
| `chapter.approved` | brand reviewer | chapter_version | `{"state":"in_review"}` | `{"state":"approved"}` |
| `chapter.changes_requested` | brand reviewer | chapter_version | `{"state":"in_review"}` | `{"comment":"<text>","state":"draft"}` |
| `chapter.published` | owner | chapter_version | `{"state":"approved"}`; `null` for a republish | `{"state":"published","version":<n>}`; a republish adds `"republishedFrom":<n>` |
| `link.issued` | viewer | derivative | `null` | `{"expiresAt":"<ISO>","grant":"<grant id or implicit>"}` |

- `requestId` is set for request, condition, grant and proof records whose grant came from a request, and null otherwise.
- No API route changes or deletes a record.
- **Verification** walks from sequence 1. It reports the first record whose `previousHash` differs from the prior `recordHash`, or whose `recordHash` differs from the recomputed value. After tampering with record k, it reports `brokenAt` k.
- **Audit table cells.** The Time column is `D MMM YYYY HH:mm`. Actor is the display name or `System`. Resource is `<resourceType> <resourceId>`. Before and After print `field: value` pairs, one per line, keys A→Z, with strings unquoted. A null object prints `none`.

### Services (DP-01, DP-04, DP-16, DP-19, DP-23, DP-27, DP-28, DP-33)

**PostgreSQL** (`DATABASE_URL`) stores every record named in this brief, the app clock and the mail outbox. The schema is applied idempotently on every serve, not only at build. LISTEN/NOTIFY carries each committed change to the live channel of every app instance on the same database, and open screens receive it within two seconds. When the database starts empty, the server loads the demo seed.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) holds three kinds of object in one private bucket:
- masters at `masters/<asset id>/<file name>` (never served)
- derivatives at `derivatives/<asset id>/<variant key or base>/<file name>`
- proofs at `proofs/<grant id>/<proof id>`

`/dl/<token>` streams bytes through the app server. The browser never talks to MinIO.

When MinIO is unreachable:
- `GET /api/health` answers 200 `{"status":"unavailable"}` within one second, never 503.
- Proof upload, derivative add and remove, release, link issue and `/dl` answer 503 with their catalogue messages.
- Chapters, rules, the library listing, requests, decisions and the queue keep working, because they do not need MinIO.

When MinIO is reachable, health answers 200 `{"status":"ok"}`.

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`) receives every notice.
- Each notice is written to the outbox in the same transaction as its cause and sent over SMTP, normally within five seconds. Failed sends retry every ten seconds, and the cause still succeeds.
- From is `MAIL_FROM`. Bodies are plain text and include `<APP_PUBLIC_URL>/requests/<request id>` where a request is involved.

| Trigger | To | Subject | Body includes |
|---|---|---|---|
| invitation | invitee | `Your Rulehouse invitation` | `<APP_PUBLIC_URL>/activate/<token>` and `This link works once and expires on <D MMM YYYY> at <HH:mm>.` |
| stage assigned (including escalation by routing) | assignee | `Review needed: <request id> <card name>` | stage reason, due time |
| warning | current holder | `Deadline soon: <request id>` | `Due <D MMM YYYY HH:mm>` |
| breach | owner who receives the stage | `Deadline missed: <request id> is now yours` | previous holder's name |
| changes requested, rejected, expired, zero-length grant | requester | `Decision on <request id>: <state label>` | comment or reason; for zero-length `This grant ended before it started, so nothing can be downloaded.` |
| grant minted (not zero-length) | requester | `Granted: <request id> until <D MMM YYYY>` | `Grant <grant id> on <card name>`, `Ends <D MMM YYYY>`, `Status: <status label>`, then each condition text on its own line |
| grant revoked | holder, or each group member | `Grant <grant id> revoked` | the reason |

**Invitations.**
- An invitation's token works once and expires `INVITE_TTL_HOURS` hours after it is created, on the app clock.
- Opening `/activate/<token>` and setting a password of at least 12 characters creates the principal with the invited role and organisation, signs them in and redirects to `/library`.
- A used, expired or unknown token shows the invalid-invitation page.

### Seed data (DP-02, DP-13, DP-20)

Every seeded person, organisation and brand is invented. At first boot with an empty database, and after `POST /api/grading/seed` with the example body in API, the records are exactly those in that example, with the app clock at `2026-03-02T09:00` Berlin time (`2026-03-02T08:00:00.000Z`). Every password is `rulehouse-demo-1`.

Derived facts, with the demo seed at start:
- **Library cards (9, in code point order, the same for every signed-in viewer):** `Harbour photograph`, `Logo 1998`, `Logo — Full lock`, `Logo — Tab`, `Menu UI icon`, `Parcel spot icon`, `Pin pictogram`, `Rebrand teaser illustration`, `Storefront photograph`. Courier spot icon is a draft and appears only to the owner in `/admin/assets`. With no filters, `GET /api/library` returns `"count":9` and `status "Library results"` reads `9 assets`.
- **Emi sees:** Available on everything except `Logo 1998` (Retired) and `Rebrand teaser illustration` (Restricted).
- **Ana sees:**
  - Available: `Logo — Tab`
  - Request required: `Logo — Full lock`, `Menu UI icon`, `Parcel spot icon`, `Pin pictogram`
  - Restricted: `Harbour photograph`, `Storefront photograph`, `Rebrand teaser illustration`
  - Retired: `Logo 1998`
- **Pia sees:**
  - Available: `Storefront photograph`
  - Restricted: `Harbour photograph` (territory), `Rebrand teaser illustration`, and every card with an employee-and-agency licence (`Not licensed for press contacts.`)
  - Retired: `Logo 1998`
- **Queues:**
  - Cai's queue: REQ-0003, due `3 Mar 2026 08:00`.
  - Bea's queue: REQ-0004, due `3 Mar 2026 17:00`.
  - Leo's and Olu's queues are empty.
- **Mosaic tile lines:** Logo `v2 · 4 rules`, Voice `v1 · 2 rules`, Colour `v1 · 3 rules`, Typography `v1 · 2 rules`, Iconography `v1 · 3 rules`, Motion `v1 · 2 rules`, Library `Assets and grants`, Rule index `16 rules`.
- **Audit log:** empty. The first action after boot writes sequence 1.

**Colour chapter swatch table.** Print this table verbatim in the colour chapter. Colour codes are listed below as six digits without the leading mark; the page prints every colour code as a number sign followed by those six digits, in the Hex column and in the line below the table. Below the table, print the line `Ratings are measured against White FFFFFF and Ink 17161C.` with the number sign before each code.

Contrast is (L1 + 0.05) / (L2 + 0.05), using WCAG relative luminance with L1 the lighter colour. It is printed to two decimals, rounded half up. Ratings are `AAA` at 7 or above, `AA` at 4.5 or above, `AA Large` at 3 or above, and otherwise `Fail`. For example, Harbour 700 has luminance 0.0763, so on white it is 1.05 / 0.1263 = `8.31:1`.

| Family | Name | Hex | On white | Rating | On ink | Rating |
|---|---|---|---|---|---|---|
| Ember | Ember 700 | A3341F | 6.84:1 | AA | 2.63:1 | Fail |
| Ember | Ember 300 | F2A08C | 2.06:1 | Fail | 8.72:1 | AAA |
| Saffron | Saffron 700 | 9A5B00 | 5.43:1 | AA | 3.31:1 | AA Large |
| Saffron | Saffron 300 | F7C266 | 1.63:1 | Fail | 11.01:1 | AAA |
| Meadow | Meadow 700 | 2F6B2A | 6.45:1 | AA | 2.79:1 | Fail |
| Meadow | Meadow 300 | A9D99A | 1.61:1 | Fail | 11.20:1 | AAA |
| Lagoon | Lagoon 700 | 00666B | 6.75:1 | AA | 2.67:1 | Fail |
| Lagoon | Lagoon 300 | 7FD3D0 | 1.73:1 | Fail | 10.39:1 | AAA |
| Harbour | Harbour 700 | 1F4E8C | 8.31:1 | AAA | 2.16:1 | Fail |
| Harbour | Harbour 300 | 9DBDF0 | 1.91:1 | Fail | 9.39:1 | AAA |
| Iris | Iris 700 | 5B3A9E | 8.26:1 | AAA | 2.18:1 | Fail |
| Iris | Iris 300 | C6B2F0 | 1.90:1 | Fail | 9.44:1 | AAA |
| Orchid | Orchid 700 | 8E2C77 | 7.56:1 | AAA | 2.38:1 | Fail |
| Orchid | Orchid 300 | EDA8DC | 1.87:1 | Fail | 9.62:1 | AAA |
| Clay | Clay 700 | 7A4A33 | 7.36:1 | AAA | 2.44:1 | Fail |
| Clay | Clay 300 | E0B9A0 | 1.81:1 | Fail | 9.95:1 | AAA |
| Moss | Moss 700 | 4F5A1E | 7.46:1 | AAA | 2.41:1 | Fail |
| Moss | Moss 300 | CFD88E | 1.51:1 | Fail | 11.87:1 | AAA |
| Stone | Stone 700 | 4D4A55 | 8.66:1 | AAA | 2.08:1 | Fail |
| Stone | Stone 300 | C9C6CF | 1.69:1 | Fail | 10.67:1 | AAA |

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` step.

- Node 22 and npm are the runtime available. A lockfile (`package-lock.json`) is committed.
- `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}` when healthy (see Services for the storage outage body).
- The server applies its schema idempotently on every serve.

### Configuration and secrets (DP-08)

The server reads these at start, never hard-codes them and never sends them to the browser:

| Variable | Default |
|---|---|
| `DATABASE_URL` | — |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | — |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | — |
| `GRADING_KEY` | — |
| `APP_START_AT` | `2026-03-02T09:00:00+01:00` |
| `APP_TIME_ZONE` | `Europe/Berlin` |
| `DOWNLOAD_LINK_TTL_SECONDS` | 300 |
| `DEADLINE_HOURS_STANDARD` | 24 |
| `DEADLINE_HOURS_EXTENDED` | 48 |
| `DEADLINE_HOURS_LEGAL` | 72 |
| `DEADLINE_WARNING_PERCENT` | 75 |
| `EXPIRY_CEILING_MULTIPLIER` | 2 |
| `PROOF_MAX_BYTES` | 5242880 |
| `WEIGHT_ANNOUNCE_DELAY_MS` | 300 |
| `SUBMIT_DEDUP_SECONDS` | 10 |
| `INVITE_TTL_HOURS` | 72 |
| `SESSION_COOKIE_NAME` | `rulehouse_session` |
| `LINK_SIGNING_SECRET` | if unset, a random secret is made at boot and issued links die on restart |

Only `weightAnnounceDelayMs`, `today`, `now` and `timeZone` reach the browser, through `GET /api/me` (and the same values are embedded for anonymous chapter pages).

### Server boundary (DP-05, DP-06, DP-27)

- Same origin only. A state-changing request whose `Origin` header is present and differs from the app's origin answers 403 `cross_origin`. No CORS headers are sent.
- The JSON body limit and the upload limits are stated in API.
- The server never serves source files, the run manifest, environment values, masters or raw storage URLs.
- When PostgreSQL is unreachable at boot, the server retries every two seconds for up to sixty seconds before exiting. When MinIO is unreachable at boot, the server starts anyway and behaves as described for the MinIO outage in Services.

### Browser support and performance (DP-12)

- The app targets current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, plus the phone review at 390x844.
- Every page is usable within three seconds on the demo seed.
- The library and queue render the demo seed within one second of the response.
- Live changes appear within two seconds of the commit.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence. Shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0.
- IF-04: No datastore, cache or queue beyond PostgreSQL, MinIO and Mailpit is used (no SQLite, Redis or file-based database).
- IF-05: The app loads no web font and no asset from another origin. Every glyph and mark is inline vector art written for this product.
- IF-06: The provided service configuration (the compose files and their environment values) is left unchanged.
- IF-07: `package-lock.json` is committed and `install` uses it.

## Engineering standards

- The TypeScript is idiomatic and strictly typed, with no `any` on domain data, and names match this brief's terms (grant, stage, holder, derivative, statement identifier, engagement).
- The availability decision, the grant window, routing and each state machine's transitions are each decided in exactly one place in the source, and every caller uses it.
- No abstraction has a single implementation, and there are no defensive checks for states the state machines cannot reach.
- There is no dead, commented-out or unreachable code, and there are no features beyond this brief.
- Every API error goes through one error shape, `{"error","message"}`, with the codes from the catalogue.
- Database writes that must happen together (decision, audit record, outbox mail) share one transaction.
- Time comes only from the app clock, never directly from the system clock, in every server-side rule.
