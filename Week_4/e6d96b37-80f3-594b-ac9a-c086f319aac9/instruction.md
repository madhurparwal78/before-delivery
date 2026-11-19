# Hollowmint Desk Co. Flan

Flan is the working desk of a one-person rare-coin dealership. It covers the dealer's specimen stock from the moment a coin arrives: photographing both faces, attributing the mintmark variety against an external variety catalogue, shelving the holder in a physical tray cell, tracking album sets, comparing condition over time and choosing which duplicate to keep. It also covers reciprocal swaps with a small circle of vetted counterpart dealers: specimen-for-specimen offers, counteroffers, frozen dispatch evidence, receipt against that evidence, damage disputes and stock audits. It serves two roles, the dealer and their counterpart dealers. It uses four backend services. Keycloak handles sign-in and step-up one-time-code verification. MinIO holds every photograph and evidence object privately. Postgres is the system of record. WireMock plays the invented Varietal Coin Register, which is the only source of catalogue records, reference images and album-hole definitions. Out of scope: money, cash sales and prices, public listings, shipping labels, grading-service submissions, email or push notifications, self-service onboarding of new counterparts, and any datastore other than Postgres and MinIO.

## Problem and users

A one-person rare-coin dealer does all the buying, attributing, photographing, storing and trading alone. Today the stock lives in four places that never agree: a spreadsheet or generic coin-inventory app that allows only a couple of photos per coin and is slow for unusual varieties, a phone camera roll, the cardboard trays of 2x2 flips, slabs and capsules on the desk, and chat or forum threads with the three to six dealers they swap duplicates with. Dealer networks are built for wholesale listing, not for swapping one specimen against another. So a swap gets agreed over chat. One side quietly changes a coin after the other has accepted. Nobody freezes photographs of what went into the packing sleeves. When a coin arrives with a new rim ding, there is no before-and-after pair to point at. The dealer pays for this in several ways: disputes they cannot win, coins sold twice because they sat in two offers, repunched or mis-attributed mintmark varieties priced at the common rate, and Saturday afternoons spent counting trays against a list.

- **Dealer** (daily): takes in, attributes, photographs, shelves and audits every specimen, and trades duplicates by reciprocal swap without double-committing a coin or losing a dispute.
- **Counterpart dealer** (weekly): reviews, counters and accepts the dealer's swap offers, confirms receipt against frozen dispatch photographs and raises damage disputes. A counterpart sees only the exchange side of the desk.

Every person, dealership, coin issue and register record in this brief is invented.

## Journeys

1. **Intake.** The dealer starts with two staged face photographs and an empty intake form. They drop each photograph into its obverse or reverse slot, type a specimen reference, review and confirm. The specimen appears with both photographs stored, waiting for its catalogue record. A wrong-type or over-limit file is refused in its own slot and never stored.
2. **Attribution and reconciliation.** The dealer opens a specimen and zooms into the mintmark. If the attribution is doubtful, they write a note and quarantine it. If they are sure, they type the catalogue reference, wipe between the register's reference image and their own photograph, and save the reconciliation. Saving completes only after the register has answered and its record is stored. While the register is busy, slow or broken, the screen stays pending and the typed correction stays put.
3. **Shelving and sets.** The dealer drags holders into tray cells. A slab that is too large or a cell that is occupied is refused. They then fill album holes from eligible specimens and watch the gaps update on their other open screen.
4. **Condition and keepers.** The dealer wipes between an old and a recent photograph, pins a scratch and saves a condition note. They then rank three duplicates of one issue in keeper order and undo a move.
5. **Offer and counteroffer.** The dealer fills their basket and the counterpart's basket, verifies with a one-time code and sends. Both baskets are reserved. The counterpart's open screen shows the offer at once. A replacement by either side clears both acceptances on both screens. Each side re-accepts the new version with a fresh one-time code, inside the server's stated response window.
6. **Dispatch and receipt.** The dealer orders the packing manifest to match the sleeves and freezes it, which stores immutable evidence. Each party compares the arrival photograph with the frozen dispatch photograph and records receipt. When both receipts match, ownership transfers in one step.
7. **Dispute.** A party pins the damage on the arrival photograph and opens a dispute, which holds the transfer on both screens. They share a private, expiring evidence link and revoke it. Both parties then approve a resolution, which releases the hold.
8. **Audit.** The dealer walks the tray cell by cell, marks a missing coin while offline, reconnects, and sees the queued marks replay once each in order on both of their screens.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Intake layouts** The intake workspace takes the published phone, tablet and desktop arrangements, with the "Create specimen" review as a bottom sheet on phones and every target at least the configured minimum, as qualified in Screens and layout.
- **DP-02 — Intake photo slotting and confirmation** The dealer places each staged face photograph into its slot by touch drag, tap-then-tap or keyboard, enters the specimen reference and creates the specimen only by confirming the "Create specimen" review, as qualified in Interactions.
- **DP-03 — Intake storage, refusals and duplicates** Creating a specimen stays pending until MinIO confirms both photographs, refuses each wrong-type, SVG, oversized or out-of-range file in its slot before anything is stored, and lets exactly one of two drafts claim a reference while the loser keeps both staged faces, as qualified in Business rules.
- **DP-04 — Coin photograph presentation** At its lowest zoom on a phone, the attribution viewer shows the specimen's coin photograph as a complete coin with its whole rim and readable relief.
- **DP-05 — Attribution layouts** The attribution workspace keeps the mintmark viewer above the note on phones, beside it on tablets and inside the inspector beside the stock grid on desktops, with the "Quarantine attribution" review reachable in each.
- **DP-06 — Mintmark zoom and quarantine input** The dealer zooms the mintmark by pinch or the published keys while the touched image point stays put, types an attribution note and confirms quarantine through its review, working the same under reduced motion.
- **DP-07 — Quarantine feedback and conflicts** Confirmed quarantine is announced pending then saved, makes the specimen ineligible for album holes and offers, and a save over a newer attribution is refused with the conflict notice while the unsaved note stays, as qualified in Business rules.
- **DP-08 — Mintmark legibility** At every zoom step the mintmark evidence stays sharp enough to read the letter and its punch details, with the note beside or below it.
- **DP-09 — Reconciliation layouts** The reconciliation workspace stacks register reference and specimen photograph on phones, pairs them on tablets and keeps both inside the desktop inspector.
- **DP-10 — Reference wipe and correction input** The dealer compares register reference and photograph with the Slate rule wipe by drag or keys, types a catalogue reference correction, retries the register and saves through the "Save reconciliation" review.
- **DP-11 — Register outages and session resume** Rate-limited, timed-out, malformed and missing register replies keep reconciliation visibly pending with the server-stated countdown or a retry, never lose the correction or divider position, and a session that ends mid-correction resumes the same save exactly once after signing in again, as qualified in Business rules.
- **DP-12 — Reference alignment** Register reference and specimen photograph line up across the wipe divider so the same mintmark and rim sit in the same place, without crops that hide either.
- **DP-13 — Tray layouts** The tray keeps its row-major cell orientation and holder proportions on phones, tablets and desktops, with paired tray and holder panes on tablets.
- **DP-14 — Holder placement input** The dealer moves a holder into a tray cell by touch drag, tap-then-tap or keyboard pickup and confirms it through the "Place holder" review, and a cancelled placement leaves occupancy unchanged.
- **DP-15 — Placement refusals and contention** A holder too large for a cell or a drop into an occupied cell is refused with its own notice, and when two screens claim one cell exactly one wins while the other keeps its unplaced holder, as qualified in Business rules.
- **DP-16 — Holder fit drawing** Holders and cells are drawn to scale so a slab visibly overhangs a cell that a flip fits inside.
- **DP-17 — Album layouts and targets** The album renders whole in a phone column, beside its candidates on tablets and in the inspector on desktops, with every hole, chip and confirm control at least the configured target size and no sideways scrolling.
- **DP-18 — Album hole filling input** The dealer fills a hole by touch drag, tap-then-tap or keyboard and the "Fill album hole" review, and cancelling leaves the gap open.
- **DP-19 — Album exclusions and live gaps** Album holes come only from stored register records, quarantined and reserved or outbound specimens are refused with their own notices, an accepted fill updates another open screen without reload, and holes reopen when a filling specimen becomes ineligible, as qualified in Business rules.
- **DP-20 — Album gap presentation** Open holes read as named missing issues with their mintmark, not as blank or collapsed space.
- **DP-21 — Condition layouts and marker registration** The condition workspace takes the published arrangements, and a placed marker stays within the configured tolerance of its scratch across viewport changes, zoom and divider positions.
- **DP-22 — Condition wipe and marker input** The dealer moves the Slate rule wipe and places the condition marker by drag, keys or the image coordinate fields, writes a condition note and saves it through its review, the same under reduced motion.
- **DP-23 — Condition save conflicts and image retry** A saved condition note is announced pending then saved in original-image coordinates, a stale second save is refused while keeping its note and coordinates, and a failed photograph load shows a retry that restores the image with its markers, as qualified in Feedback states.
- **DP-24 — Registered condition markers** The condition marker sits visibly on the same scratch in both photographs.
- **DP-25 — Keeper list layouts** The keeper preference list takes the published arrangements, including its review.
- **DP-26 — Keeper reorder input and undo** The dealer reorders keepers by touch or keyboard pickup, confirms the order through its review, and undoes the last confirmed move through the same review.
- **DP-27 — Keeper order announcements and contention** Each staged move, pending save, saved order and restoration is announced, another open screen shows the saved order without reload, and when two screens save at once the loser re-renders in the server's order with the conflict notice.
- **DP-28 — Keeper comparison scale** Keeper chips show the specimens at one image scale so their different wear can be compared.
- **DP-29 — Offer layouts** Offer assembly stacks the two baskets with a review bottom sheet on phones, pairs them on tablets and shows the exchange list beside the basket inspector on desktops.
- **DP-30 — Basket assembly input** The dealer moves their duplicates and the counterpart's specimens into the matching baskets by touch drag, tap-then-tap or keyboard and sends through the "Send reciprocal offer" review.
- **DP-31 — Offer reservation and step-up send** Sending reserves both baskets together only for register-reconciled specimens and only with a fresh step-up, a specimen already reserved elsewhere leaves both baskets unchanged, and the counterpart's open screen shows the sent offer without reload, as qualified in Business rules.
- **DP-32 — Basket distinction** The dealer's basket and the counterpart's basket remain unmistakably separate, including in the narrow review sheet.
- **DP-33 — Counteroffer layouts** The counteroffer workspace keeps both offer sides, the current version and the response window readable on phones, tablets and desktops, with its reviews reachable.
- **DP-34 — Replacement and step-up acceptance input** Either party replaces an offered specimen by touch or keyboard through "Replace offered specimen", and accepts the current version only after completing the real Keycloak one-time-code challenge from "Accept offer version".
- **DP-35 — Voided acceptance, holds and windows** A replacement clears both acceptances on both open screens without reload, a counterpart's staged replacement holds that duplicate until their screen has been gone past the grace period, and both parties see the server's remaining response time and expiry rather than their device clock, as qualified in Business rules.
- **DP-36 — Replacement imagery** The replaced specimen's image changes in its own slot while the rest of both baskets stays still.
- **DP-37 — Dispatch layouts** The dispatch workspace shows a phone sleeve sequence, tablet manifest and evidence panes and the desktop list with inspector, and its closed review sheet takes no focus or taps.
- **DP-38 — Manifest reorder and freeze input** The dealer reorders the packing manifest by touch or keyboard pickup with each item's photographs attached and freezes it only by confirming "Freeze dispatch evidence".
- **DP-39 — Freeze feedback and frozen conflicts** Freezing stays pending until MinIO confirms every immutable evidence object, and any later reorder or freeze is refused with the frozen notice while the frozen order stays, as qualified in Business rules.
- **DP-40 — Sleeve sequence presentation** The pictured sequence reads in the same order as the physical packing sleeves.
- **DP-41 — Receipt layouts** The receipt workspace stacks arrival and dispatch photographs on phones, shows them side by side on tablets and keeps the comparison in the desktop inspector.
- **DP-42 — Arrival zoom and receipt input** The receiving party zooms the arrival photograph by pinch or keys, ticks "Manifest matches" and records receipt through its review with a fresh step-up.
- **DP-43 — Receipt transfer and ended sessions** A first receipt waits for the counterpart, matching receipts from both parties swap ownership in one step and announce it on both screens, an open dispute holds the transfer, and a counterpart whose password changes loses the screen and records nothing, as qualified in Business rules.
- **DP-44 — Receipt comparison fairness** Dispatch and arrival photographs are shown at matching scale and orientation so the same condition feature can be judged.
- **DP-45 — Dispute layouts** Dispute evidence stays full width with reachable notes on phones, pairs with its details on tablets and sits in the desktop inspector, with both dispute reviews reachable.
- **DP-46 — Damage marker and resolution input** A party places the damage marker on the arrival photograph by touch, keys or coordinates, opens the hold through its review, and the parties propose and approve a resolution with focus returning to each opener.
- **DP-47 — Dispute hold, evidence links and marker conflicts** An open dispute holds ownership transfer on both screens until both parties approve a resolution, private evidence links work only for the dispute's parties until they expire or are revoked, and when two screens move one marker the loser shows the server's position, as qualified in Business rules.
- **DP-48 — Damage marker clarity** The damage marker points at the intended physical feature without covering what is needed to judge it.
- **DP-49 — Audit layouts and stable paging** The audit tray keeps its orientation at every published viewport and after rotation, the stock list pages in capped pages that never repeat or skip a specimen while holders move between cells, and the audit list pages through each cell exactly once, as qualified in API.
- **DP-50 — Audit cell navigation and missing marks** The dealer moves between audit cells by swipe, arrow keys or the cell buttons, stopping at the ends, and records a missing item through its review, including while offline, the same under reduced motion.
- **DP-51 — Offline audit sync and live observers** Queued audit marks survive reload, replay once each in recorded order on reconnect with each step announced, update another open screen without reload, and keep a newer server change as a visible conflict, as qualified in Business rules.
- **DP-52 — Tray orientation presentation** The audit tray stays visually fixed while the selected cell and missing mark change.
- **DP-53 — Desk shell layouts and breakpoints** The desk shell shows the published masthead, tabs, corner block, directory, fact boxes and footer at each viewport, switches layout exactly at the published widths without losing the open draft or focus, and keeps closed sheets and the desk tools dialog hidden and inert.
- **DP-54 — Desk tools, sheets and session resume** The dealer opens desk tools and review sheets by touch or keyboard with trapped focus and focus return, and a confirmed action whose session ended resumes exactly once after "Sign in again".
- **DP-55 — Revocation, outages and published surface** A revoked or password-changed counterpart loses private evidence within the live bound with no later write succeeding, every unreachable dependency shows its outage copy without false success, and counterparts and strangers reach only the published routes, as qualified in Server boundary.
- **DP-56 — Desk shell look** The desk carries the grey-ground, white-sheet, slate-ruled, teal-and-bold reference-desk look with coin photographs as the only rich surface.

## Frontend

### Screens and layout (DP-01, DP-05, DP-09, DP-13, DP-17, DP-21, DP-25, DP-29, DP-33, DP-37, DP-41, DP-45, DP-49, DP-53)

**Published viewports.** There are three layouts:

- Phone: 390×844. The narrower 375×812 probe gets the same arrangement.
- Tablet: 768×1024.
- Desktop: 1280×800.

The phone layout applies below 768 CSS pixels of width. The tablet layout applies from 768 to 1279. The desktop layout applies at 1280 and wider. No other breakpoint changes which layout a published viewport gets. No viewport scrolls the page sideways. Every interactive target is at least FLAN_TARGET_MIN_PX wide and tall (see Business rules, Limits and clocks). Labels, focus rings and photograph edges stay inside the viewport. A tray or album may scale its cells to fit, but it keeps its row-major orientation and the true proportions of its holders.

**Desk shell (every page).**

- **Flan wordmark masthead**: link G01, top left. It sits directly on the upper slate rule.
- **Tab Wipe folder tabs**: tabs G02 and G03 ("Stock" and "Exchange"). They rest on the rule at the centre on tablet and desktop. On phones they sit centred below the wordmark. The same folder-tab pair, named after its two photographs, sits above every Slate rule wipe viewer (see Notes on these controls).
- **exchange desk corner block**: link G04. It is flush top right on tablet and desktop, and becomes a full-width strip under the tabs on phones.
- **slate desk rules**: the two slate rules that frame the page top and bottom.
- **Desk status line**: region G06, directly below the header rule, left-aligned.
- **Specimen sheet**: holds region G05 ("Specimen desk").
- **Desk footer**: navigation G23 below the lower rule. It has three columns on tablet and desktop: legal line left, an empty centre, links right. On phones it has two columns: legal line left, links right.
- On phones only, button G15 sits beside the wordmark and opens dialog G16. G16 holds the workspace navigation G38. On tablet and desktop, G38 sits as a row inside the specimen sheet above the workspace, and G15 is absent.

**Desk home** (`/desk/<namespace>`):

1. **day's lead line**: two bold lines at the top of the sheet.
2. **Tray directory panel**: region G18, centred, roughly half the sheet's width on tablet and desktop and full width on phones. It holds the two **tray lockup tile** chips (links G19 and G20) stacked one above the other, then the **pending catalogue note**.
3. The **intake and pending fact boxes**: regions G21 and G22. They sit side by side at equal height on tablet and desktop and stack on phones. On the home page they describe the most recently created specimen from today's intake, including whether its catalogue record is still pending.

**Workspaces.** Each workspace is a region named in Public screens and controls. It fills the specimen sheet, with the arrangement given in the table below.

- **Phone**: the listed items stack top to bottom in one column. Every review dialog opens as a full-width bottom sheet.
- **Tablet**: the two listed panes sit side by side, left then right. Anything listed "below" spans both panes.
- **Desktop**: the left third holds region G33 ("Stock grid") for Stock workspaces or region G34 ("Exchange list") for Exchange workspaces. The right two-thirds holds region G35 ("Inspector"), which contains the tablet's two panes side by side, plus the obverse and reverse fact boxes for the selected specimen. Review dialogs are centred dialogs over the sheet.

| Workspace (desk tab) | Phone stack, top to bottom | Tablet left pane | Tablet right pane |
|---|---|---|---|
| Intake (Stock) | I03, I05, I04, I06, I02, I07 | Obverse: I03 above I05 | Reverse: I04 above I06; I02 and I07 below both panes |
| Attribution (Stock) | viewer with A02, G21, G22, A03, A04 | viewer with A02 | G21, G22, A03, A04 |
| Catalog reconciliation (Stock) | comparison tabs, viewer with R02, R03, pending catalogue note with R04, R05 | comparison tabs and viewer with R02 | R03, pending catalogue note with R04, G21, G22, R05 |
| Tray placement (Stock) | tray grid of G28 cells, holder list P02–P04, P05 | tray grid | holder list, P05 |
| Album (Stock) | album holes S02 in one column, candidate chips G29, S03 | album holes | candidate chips, S03 |
| Condition comparison (Stock) | comparison tabs, viewer with C02 and C03, G30, G31, C04, C05 | comparison tabs and viewer | G30, G31, C04, C05 |
| Keeper preferences (Stock) | D02, D05, D03 | D02 | the focused specimen's obverse at keeper scale, D05, D03 |
| Stock audit (Stock) | V02, V03 and V04 side by side, selected-cell facts, V05 | V02 with V03 and V04 | selected-cell facts, V05 |
| Offer assembly (Exchange) | dealer candidates, O02, counterpart candidates, O03, O04 | dealer candidates above O02 | counterpart candidates above O03; O04 below both panes |
| Counteroffers (Exchange) | N09, dealer side, counterpart side, N02, N04 | dealer side | counterpart side; N09 above and N02, N04 below both panes |
| Dispatch (Exchange) | H02 as a sleeve sequence, the focused item's evidence, H04 | H02 | the focused item's evidence, H04 |
| Receipt (Exchange) | arrival photo with Q02, dispatch photo, Q06, Q03, Q04 | dispatch photo | arrival photo with Q02, Q06, Q03, Q04 |
| Disputes (Exchange) | arrival evidence at full width with U02, G30, G31, U03, U04, U06, U08, U09, U10 | arrival evidence with U02 | G30, G31, U03, U04, U06, U08, U09, U10 |

**Closed means unavailable.** A closed review dialog or sheet, and G16 when closed, is not visible, cannot be focused, cannot be tapped and is absent from the accessibility tree at every viewport. Moving it off-screen does not count as closing it.

**Breakpoint changes keep work.** Resizing across 767/768 or 1279/1280 changes the arrangement in place. The open workspace keeps its draft, its scroll position within the workspace and its keyboard focus.

### Public screens and controls (DP-02, DP-06, DP-10, DP-14, DP-18, DP-22, DP-26, DP-30, DP-34, DP-38, DP-42, DP-46, DP-50, DP-54)

Only the roles and accessible names below are public. A template expands its placeholders from the Seed data fields. No alias, alternative spelling or suffix is public. Live-region text never changes a control's accessible name.

**Shared registry**

| ID | Role and accessible name | Contract |
|---|---|---|
| G01 | link "Flan" | Returns to the desk home. |
| G02 | tab "Stock" | Opens the Stock desk; shows selected state on Stock workspaces. Dealer only: a counterpart's tab list holds G03 alone. |
| G03 | tab "Exchange" | Opens the Exchange desk; shows selected state on Exchange workspaces. |
| G04 | link "Open exchange circle" | Opens the Exchange desk; shows the corner-block counts and step-up status from Feedback states. |
| G05 | main "Specimen desk" | Focusable fallback when a live change removes the initiating control. |
| G06 | region "Desk status" | Desk status line. |
| G07 | status "Desk updates" | Polite, atomic live region present on every page before any async work. |
| G08 | alert "Desk error" | Immediate error announcement that stays visible until the next action. |
| G09 | button "Confirm" | Commits only the action summarised in its enclosing review dialog. |
| G10 | button "Cancel" | Closes its review dialog without committing; the draft stays. |
| G11 | button "Reload current" | Loads the server's latest version and keeps the local draft, unsaved, for a fresh review. |
| G12 | button "Retry save" | Re-sends the same confirmed command with its original command identifier. |
| G13 | button "Retry sync" | Reconnects and replays queued audit marks in recorded order. |
| G14 | button "Sign in again" | Renews the Keycloak sign-in and resumes the pending confirmed command once. |
| G15 | button "Open desk tools" | Phone only; opens G16. |
| G16 | dialog "Desk tools" | Phone desk navigation holding G38. |
| G17 | button "Close desk tools" | Closes G16; focus returns to G15. |
| G18 | region "Tray directory" | Tray directory panel on the desk home. |
| G19 | link "Open stock" | Same destination as G02. Dealer only: a counterpart's tray directory holds G20 alone. |
| G20 | link "Open exchanges" | Same destination as G03. |
| G21 | region "Obverse facts" | First fact box. |
| G22 | region "Reverse facts" | Second fact box. |
| G23 | navigation "Desk footer" | Footer link group. |
| G24 | link "Evidence policy" | Opens `/help/evidence`. |
| G25 | link "Keyboard guide" | Opens `/help/keyboard`, listing every key path in Interactions. |
| G26 | link "Desk help" | Opens `/help`. |
| G27 | img "<specimen> <face>" | A photograph. `<specimen>` is the display label; `<face>` is `obverse`, `reverse`, `dispatch`, `arrival` or `register`. |
| G28 | button "Cell <cell>" | A tray cell; `<cell>` is its coordinate. |
| G29 | button "Specimen <key>" | A selectable, draggable specimen chip. |
| G30 | spinbutton "Image x" | The focused marker's original-image horizontal coordinate. |
| G31 | spinbutton "Image y" | The focused marker's original-image vertical coordinate. |
| G32 | button "Verify identity" | Opens the Keycloak one-time-code challenge for a send or receipt that needs step-up. |
| G33 | region "Stock grid" | Desktop Stock list of specimen chips, in capped pages. |
| G34 | region "Exchange list" | Desktop list of offers. |
| G35 | region "Inspector" | Desktop inspector. |
| G36 | button "Next page" | Inside G33; shows the next page. |
| G37 | button "Previous page" | Inside G33; shows the previous page. |
| G38 | navigation "Workspaces" | The dealer sees links "Intake", "Attribution", "Catalog reconciliation", "Tray placement", "Album", "Condition", "Keepers", "Stock audit", "Offers", "Counteroffers", "Dispatch", "Receipt" and "Disputes". A counterpart sees only "Offers", "Counteroffers", "Dispatch", "Receipt" and "Disputes". |

**Intake**: I01 region "Intake workspace"; I02 textbox "Specimen reference"; I03 button "Obverse photo"; I04 button "Reverse photo"; I05 button "Obverse slot"; I06 button "Reverse slot"; I07 button "Review intake"; I08 dialog "Create specimen".

**Attribution**: A01 region "Attribution workspace"; A02 slider "Mintmark zoom"; A03 textbox "Attribution note"; A04 button "Review quarantine"; A05 dialog "Quarantine attribution".

**Catalog reconciliation**: R01 region "Catalog reconciliation workspace"; R02 slider "Reference divider"; R03 textbox "Attribution correction"; R04 button "Retry catalog"; R05 button "Review reconciliation"; R06 dialog "Save reconciliation".

**Tray placement**: P01 region "Tray placement workspace"; P02–P04 button "Holder <key>" (for example "Holder A", "Holder B", "Holder C"); P05 button "Review placement"; P06 dialog "Place holder".

**Album**: S01 region "Album workspace"; S02 button "Hole <hole>" (for example "Hole Mint A"); S03 button "Review album placement"; S04 dialog "Fill album hole".

**Condition comparison**: C01 region "Condition comparison workspace"; C02 slider "Condition wipe"; C03 button "Condition marker"; C04 textbox "Condition note"; C05 button "Review condition note"; C06 dialog "Save condition note"; C07 button "Retry image".

**Keeper preferences**: D01 region "Keeper preference workspace"; D02 list "Keeper preference" (its items are G29 chips); D03 button "Review keeper order"; D04 dialog "Save keeper order"; D05 button "Undo last move".

**Offer assembly**: O01 region "Offer assembly workspace"; O02 region "Dealer basket"; O03 region "Counterpart basket"; O04 button "Review offer"; O05 dialog "Send reciprocal offer".

**Counteroffers**: N01 region "Counteroffer workspace"; N02 button "Review replacement"; N03 dialog "Replace offered specimen"; N04 button "Accept current offer"; N05 dialog "Accept offer version"; N06 button "Verify acceptance"; N07 textbox "One-time code" and N08 button "Sign In" (both on the Keycloak challenge page); N09 region "Response window".

**Dispatch**: H01 region "Dispatch workspace"; H02 list "Packing manifest"; H03 button "Manifest item <key>"; H04 button "Review dispatch"; H05 dialog "Freeze dispatch evidence".

**Receipt**: Q01 region "Receipt workspace"; Q02 slider "Arrival zoom"; Q03 checkbox "Manifest matches"; Q04 button "Review receipt"; Q05 dialog "Record receipt"; Q06 button "Arrival photo".

**Disputes**: U01 region "Dispute evidence workspace"; U02 button "Damage marker"; U03 textbox "Damage note"; U04 button "Review dispute"; U05 dialog "Hold ownership transfer"; U06 button "Propose resolution"; U07 dialog "Resolve transfer hold"; U08 button "Approve resolution"; U09 button "Copy private evidence link"; U10 button "Revoke evidence link"; U11 dialog "Revoke evidence access".

**Stock audit**: V01 region "Stock audit workspace"; V02 group "Audit tray" (its cells are G28 buttons); V03 button "Previous cell"; V04 button "Next cell"; V05 button "Mark missing"; V06 dialog "Record missing item".

**Notes on these controls**

- The comparison tabs above a wipe viewer are a pair of tabs named after their two photographs:
  - reconciliation: "Register" and "Obverse"
  - condition: "Obverse" and "Arrival"
- Every review dialog contains G10 and G09, plus a summary of the proposed change and the specimens it affects.
- N05 also contains N06.
- U07 contains two radio buttons, "Transfer as agreed" and "Return both baskets", and G09.
- N07 and N08 are the provisioned Keycloak one-time-code page as shipped, with its "One-time code" field and "Sign In" button. The app shows no code form of its own.
- I03 and I04 open a file chooser, accept a dropped file and also act as drag sources for a staged file.
- Q06 opens a file chooser for an arrival photograph.

### Interactions (DP-02, DP-06, DP-10, DP-14, DP-18, DP-22, DP-26, DP-30, DP-34, DP-38, DP-42, DP-46, DP-50, DP-54)

**Moving something to a destination** (photo to slot, holder to cell, specimen to hole or basket, replacement into an offer slot):

- Every source is a published button. Every destination is a published button or named region.
- Touch or pointer dragging moves the real source under the finger. Dropping on a destination stages the move. Releasing anywhere else, or cancelling, leaves the prior draft exactly as it was.
- Tapping a source and then a destination stages the same move without dragging.
- Keyboard: Tab to the source, press Space to pick it up (the source shows pressed state), Tab to the destination, press Enter to stage. Escape cancels the pickup.
- Swapping two staged face photographs between slots exchanges them; no image is ever silently dropped.
- A staged move is a draft. It takes effect only through its review dialog and G09.

**Reorder lists** (D02, H02):

- Space picks up the focused item.
- ArrowUp and ArrowDown move it one place. Focus follows it.
- Enter drops it.
- Escape returns it to where it was before pickup.
- Touch dragging an item up or down reorders it.
- The new order is a draft until its review is confirmed. Each changed place is announced (see Feedback states).

**Zoom sliders** (A02, Q02):

- The value runs from FLAN_ZOOM_MIN to FLAN_ZOOM_MAX.
- ArrowRight or ArrowUp zooms in by FLAN_ZOOM_STEP; ArrowLeft or ArrowDown zooms out.
- Home selects the minimum; End selects the maximum.
- The slider's value text is "<zoom> times", for example "2.5 times".
- A two-finger pinch on the photograph zooms around the pinch point: the image point under the fingers stays under them. The slider value follows.

**Slate rule wipe sliders** (R02, C02):

- The value runs from 0 to 100 percent of the coin's width.
- Arrows change it by 1. Page Up and Page Down change it by 10. Home selects 0 and End selects 100.
- Pointer or touch dragging on the divider tracks the finger directly, with no inertia.
- The value text is "<second tab> <value> percent", for example "Obverse 62 percent".
- The divider position is kept in the browser per specimen and comparison, and survives reload and sign-in.

**Markers** (C03, U02):

- Dragging a marker moves it in original-image coordinates.
- With the marker focused, arrows move it 1 original-image unit, and Shift with an arrow moves it 10. G30 and G31 set the coordinates numerically within the photograph.
- Resizing, zooming, rotating and moving the divider never change the stored coordinates.

**Audit cells** (V02):

- Swiping left on the tray selects the next cell in row-major order; swiping right selects the previous one.
- With focus in V02, ArrowRight and ArrowLeft go to the next and previous cell, and ArrowDown and ArrowUp go one row down and up. V03 and V04 do the same as left and right.
- Selection stops at the first and last cells, and the physical cells never rearrange. The selected cell shows pressed state.

**Review dialogs**:

- Opening a review moves focus to G10.
- Tab and Shift+Tab wrap inside the dialog.
- Escape works the same as G10, and closing returns focus to the control that opened the dialog.
- After G09 succeeds, focus returns to the opener, except after intake, where focus moves to the created specimen's heading.
- If a live change takes away the permitted action while a review is open, the dialog closes, the change is announced and focus moves to G05.

**Step-up**:

- N06 and G32 send the browser to the Keycloak one-time-code challenge. The user types the code into N07 and presses N08, and the browser returns to the same workspace.
- After N06, N05 reopens with G09 enabled, and G09 records the acceptance.
- After G32, the pending send or receipt resumes once.
- Abandoning the challenge records nothing.

**Pages and desk tools**:

- G36 and G37 page G33.
- G15 opens G16 and moves focus into it. G17 or Escape closes it.
- Every journey in this brief can be finished by keyboard alone, with a visible focus ring on every focused control.

**Drafts**: text drafts, divider positions, marker coordinates, staged orders and queued audit marks are kept in the browser per namespace and workspace, and survive reload and sign-in. Staged photo files survive only within the open tab.

### Visual design (DP-04, DP-08, DP-12, DP-16, DP-20, DP-24, DP-28, DP-32, DP-36, DP-40, DP-44, DP-48, DP-52, DP-56)

The look is a plain, austere reference desk built so that the coin photograph is the only thing with depth.

**Ground and sheet**: a flat cool pale-grey ground with a fixed narrow grey margin on each side. A white specimen sheet sits on it, and the grey shows around the sheet so it reads as paper on a desk. Inside the sheet, every list, tray, basket and viewer is a flat box of the same pale grey with a modest, even inset, holding white specimen chips. Corners are square everywhere except two small badges. There are no shadows anywhere.

**Colour roles, in words**:

- pure black ink for body text
- a dark blue-grey slate for the wordmark, headings, the two frame rules and the selected tab
- a muted sea-teal accent for links, the tagline, lockup labels and the corner block fill, darkening one step on hover
- a warm mid-grey for unselected folder tabs
- a cool mid-grey for secondary captions
- a soft amber for the window-closing pill

Teal text on white is set in the deeper teal shade wherever the lighter one would fall below WCAG 2.2 AA contrast. Unselected tab labels are dark enough on the warm grey to pass AA. Every text and focus ring meets WCAG 2.2 AA.

**Type**:

- Saira at medium to semibold weight, slightly tight tracking, in slate, for the wordmark, lockup names and workspace headings.
- Archivo at regular and bold for everything else, at a small reference size about that of standard browser form text.
- Headings are only about a tenth larger than body text. The hierarchy comes from bold weight and teal, not size.
- Counts, grades, sizes and coordinates use even-width figures.
- Form labels are bold, sentence case and end in a colon.

**Desk home (hero)**:

- The Flan wordmark sits top left on the upper slate rule.
- The Tab Wipe folder tabs, Stock and Exchange, touch the rule at the centre like file-folder tabs.
- At top right the teal exchange desk corner block reads the open-offer count and step-up status, with the amber pill when a response window is closing.
- Inside the sheet, the tray directory panel holds the tray lockup tile chips. Each tray lockup tile has a white face carrying its name in Saira and a two-line bold teal label set flush right.
- The pending catalogue note sits below them, and the intake and pending fact boxes pair underneath.

**Working screens**:

- Pending, offline and conflict states are teal-edged inline notes in the style of the pending catalogue note. Each opens with a **teal action link**: a bold teal control with no underline at rest, underlined on hover and focus (G11, G12, G13, G14, R04, C07). Footer links and the tray lockup tile labels use the same teal action link style.
- Empty states are a fact box with a colon heading and two bullets of next steps.
- Phone bottom sheets are full-width white sheets under a slate top rule.
- Focus is a teal focus ring standing slightly off the control on every element.

**Coin imagery**:

- Every coin is shown from its stored photograph. Fixture photographs are procedurally drawn coins with legible rims, distinct mintmark letters and a visible scratch.
- In chips, a coin may also be drawn as a disc with a stroked rim and its mintmark.
- Holders and tray cells are drawn to their millimetre sizes at one shared scale.
- Album gaps show the hole label and expected mintmark in a dashed grey outline.
- Keeper chips use one image scale.
- Dispatch and arrival photographs are shown at the same scale and orientation.

Icons come from Lucide.

### Motion and effects (DP-06, DP-21, DP-22, DP-36, DP-50, DP-53)

- The shell stays still: there are no decorative loops, entrance sequences, parallax or animated navigation. Hover and focus changes are instant.
- Zoom, wipe, marker movement and holder or chip drags follow the input directly, with no easing or settle, in every motion setting. A dropped holder appears in its cell at once.
- **Slate rule wipe** (R02, C02):
  - The two comparison tabs above the viewer name the two photographs.
  - The second photograph is revealed from the coin's left edge up to the divider, and the first shows to its right.
  - Below 50 percent the first tab is the current tab (filled slate). At 50 percent and above, the second tab is current. The swap happens instantly when the divider crosses the midpoint, and swaps back the same way when it returns.
  - Markers and their captions on the second photograph are anchored to original-image coordinates, so each stays on its scratch at every divider position, zoom level and viewport width.
  - A caption fades in over FLAN_MOTION_MS (about a seventh of a second by default) when the divider uncovers it, and fades out the same way when the divider covers it again.
- **Counteroffer replacement**: the removed specimen's image fades out and the new one fades in, in the same slot, over FLAN_MOTION_MS. Nothing else in either basket moves.
- **Reduced motion**: every fade becomes an instant change. Content, focus, saved positions and announcements stay identical. Dividers, zoom and markers still track pointer, touch and keys.

### Feedback states (DP-03, DP-07, DP-11, DP-15, DP-19, DP-23, DP-27, DP-31, DP-35, DP-39, DP-43, DP-47, DP-51, DP-55)

**How feedback is shown**:

- Every async action announces pending and success copy in G07 and error copy in G08.
- The prior screen and the draft stay visible while feedback changes.
- Pending copy shows from the moment a request is sent until its reply arrives, however long the reply is held.
- A result is announced only after the persisted state is known. No success copy is shown before the provider effect it names is confirmed.
- While a request is pending, its G09 or retry control is disabled so it cannot be sent twice.
- A field error also appears next to its field or slot.
- The API `message` field always carries the copy below.

**Placeholders**:

- `<specimen>` is a display label.
- `<position>`, `<count>`, `<seconds>`, `<max>`, `<min>`, `<n>` and `<m>` are decimal integers.
- `<remaining>` is "<hours> h <minutes> min" from the server's `remaining_seconds`, rounded down to whole minutes. Hours may exceed 23.
- `<expiry>` is the server's `expires_at` as "YYYY-MM-DD HH:MM UTC".

| ID | Exact copy | Where and when |
|---|---|---|
| F_PENDING | Saving changes. | G07, while any confirmed command is in flight |
| F_OFFLINE | Offline. Your changes are queued. | G07 and inline note, while the browser is offline |
| F_SERVICE | Service unavailable. Your changes are still here. | G08 and inline note with G12, on any 503 other than the register's |
| F_CONFLICT | This record changed elsewhere. Your draft is still here. | G08 and inline note with G11, on a stale-version 409 |
| F_SESSION | Your session ended. Sign in to continue. | G08 and inline note with G14, on 401 |
| F_REVOKED | Access ended. Private evidence is no longer available. | G08, when the server ends the viewer's access |
| F_HIDDEN | This item is not available. | G08 and page body, on 404 |
| F_FORBIDDEN | You cannot perform this action. | G08, on 403 other than step-up |
| F_INVALID | Check the highlighted fields. | G08, on 422 |
| F_BAD_BODY | The request could not be read. | G08, on 400, 405 and 415 |
| F_TOO_LARGE | The upload or request is too large. | G08, on 413 |
| F_SYNCED | Queued changes saved. | G07, after an audit replay completes |
| F_INTAKE_OK | Specimen created. Both photographs are saved. | G07 |
| F_INTAKE_DUP | This specimen reference already exists. Your draft is still here. | G08 |
| F_ATTR_OK | Attribution quarantined. This specimen is excluded from sets and offers. | G07 |
| F_IN_OFFER | This specimen is in an open offer. Change the offer first. | G08 |
| F_CATALOG_WAIT | Catalog unavailable. Your correction is kept. | G08 and pending catalogue note with R04 |
| F_CATALOG_RATE | Catalog is busy. Your correction is kept for retry. | G08 and pending catalogue note |
| F_CATALOG_COUNTDOWN | Retrying catalog in <seconds> seconds. | pending catalogue note text only, counting down |
| F_CATALOG_RETRYING | Retrying catalog now. | G07, when the countdown reaches zero |
| F_CATALOG_BAD | Catalog reply could not be read. Your correction is kept. | G08 and pending catalogue note with R04 |
| F_CATALOG_MISSING | Catalog has no entry for this reference. Your correction is kept. | G08 and pending catalogue note with R04 |
| F_CATALOG_PENDING | Waiting for the catalog record. This cannot complete yet. | G08, when an action needs an unreconciled record |
| F_CATALOG_OK | Catalog reconciled. Your correction is saved. | G07 |
| F_TRAY_OK | Holder placed. | G07 |
| F_TRAY_SIZE | This holder is too large for this cell. | G08 |
| F_TRAY_TAKEN | This cell is occupied. Choose another cell. | G08 |
| F_SET_OK | Album placement saved. Gaps updated. | G07 |
| F_SET_UNCERTAIN | Quarantined specimens cannot fill this hole. | G08 |
| F_SET_OUTBOUND | Outbound specimens cannot fill this hole. | G08 |
| F_SET_MISMATCH | This specimen does not match this hole. | field error and G08 |
| F_CONDITION_OK | Condition note saved on the original photograph. | G07 |
| F_IMAGE_WAIT | Photograph unavailable. Your notes are kept. | inline note in the viewer with C07 |
| F_REORDER | <specimen> moved to position <position> of <count>. | G07, on each staged move in D02 or H02 |
| F_KEEPER_OK | Keeper order saved. | G07 |
| F_UNDO_OK | Previous keeper order restored. | G07 |
| F_UNDO_NONE | There is no keeper move to undo. | G08 |
| F_OFFER_OK | Offer sent. Both baskets are reserved. | G07 |
| F_OFFER_TAKEN | A specimen was reserved elsewhere. Both baskets remain unchanged. | G08 |
| F_OFFER_EXPIRED | This offer's response window has closed. | G08 |
| F_HOLD_PLACED | <specimen> is held while you review. | G07, counterpart screen |
| F_HOLD_RELEASED | Counterpart left. <specimen> is free again. | G07, dealer screen |
| F_COUNTER_VOID | Offer changed. Both acceptances were cleared. | G07, both screens |
| F_COUNTER_ACCEPT | Acceptance recorded for this offer version. | G07 |
| F_MFA_REQUIRED | Verify your identity before accepting this offer. | G08 and inside N05 or the send or receipt review, with N06 or G32 |
| F_DISPATCH_OK | Manifest frozen. Packing order and evidence are saved. | G07 |
| F_DISPATCH_FROZEN | This manifest is already frozen. Packing order is unchanged. | G08 |
| F_RECEIPT_WAIT | Receipt saved. Waiting for the counterpart. | G07 |
| F_RECEIPT_DONE | Both receipts match. Ownership transferred. | G07, both screens |
| F_RECEIPT_HOLD | Receipt saved. Transfer is held by a dispute. | G07 |
| F_RECEIPT_MISMATCH | Receipt saved. It does not match the manifest, so transfer is held. | G07 |
| F_DISPUTE_OPEN | Dispute opened. Ownership transfer is on hold. | G07, both screens |
| F_RESOLUTION_WAIT | Resolution proposed. Waiting for the counterpart. | G07, both screens |
| F_RESOLUTION_DONE | Resolution approved. The transfer hold is released. | G07, both screens |
| F_LINK_COPIED | Private evidence link copied. | G07 |
| F_LINK_REVOKED | Private evidence link revoked. | G07 |
| F_AUDIT_MISSING | Missing item recorded. Audit history is kept. | G07, also after the replay of each queued missing mark |
| F_RESUMED | Your confirmed action resumed after sign-in. | G07, then replaced by the resumed action's result |
| F_SIGNIN_DOWN | Sign-in is unavailable. Your changes are still here. | G08, when Keycloak cannot be reached |
| F_COMMAND_REUSED | This action was already sent with different details. | G08 |
| F_PHOTO_TYPE | Not a JPEG, PNG or WebP photograph. | slot error |
| F_PHOTO_SVG | SVG drawings are not accepted as photographs. | slot error |
| F_PHOTO_BYTES | Photograph is larger than <max> bytes. | slot error |
| F_PHOTO_EDGE | Long edge must be <min> to <max> pixels. | slot error |
| F_PHOTO_PIXELS | Photograph has more than <max> pixels. | slot error |
| F_PHOTO_MISSING | Add both photographs. | slot error |
| F_REFERENCE_FORMAT | Use 1 to 80 letters, digits or hyphens. | field error |
| F_TEXT_LONG | Use at most <max> characters. | field error |
| F_COORD | Coordinates must be inside the photograph. | field error |
| F_ORDER | The order must list each specimen once. | field error |
| F_BASKET_FULL | A basket holds at most <max> specimens per side. | field error |
| F_BASKET_EMPTY | Each basket needs at least one specimen. | field error |
| F_ARRIVAL_MISSING | Add an arrival photograph for each received specimen. | field error |
| F_CELL_EMPTY | This cell is empty. | field error |
| F_PAGE_LIMIT | At most <max> per page. | field error |
| F_SYNC_LIMIT | At most <max> queued changes per sync. | field error |
| F_STATUS_LINE | Today: <n> specimens taken in. <m> catalog records pending. | G06 text |
| F_CORNER | <n> open offers | G04 first line |
| F_CORNER_VERIFIED | Identity verified | G04 second line while step-up is fresh |
| F_CORNER_VERIFY | Verify to accept | G04 second line otherwise |
| F_CORNER_CLOSING | Window closing | amber pill in G04 while any open offer is closing |
| F_WINDOW | <remaining> left, expires <expiry> | N09 and each offer row in G34 while the offer is `sent` or `countered` |
| F_WINDOW_ACCEPTED | Accepted. No response window is running. | N09 and each offer row in G34 while the offer is `accepted` |
| F_WINDOW_CLOSED | Window closed <expiry> | N09 and offer rows once expired |

**Chip labels**:

- G19 reads "Stock" with the label lines "<n> specimens" and "<m> of 4 cells filled".
- G20 reads "Exchange" with the label lines "<n> open offers" and "<m> awaiting receipt".

**Counts**. Every count covers only records the viewer may see. "Today" is the namespace-clock UTC date.

- Open offers (F_CORNER and G20's first line): offers in status `sent`, `countered` or `accepted`.
- Awaiting receipt (G20's second line): offers in status `dispatched` or `received`.
- G19: `<n>` is dealer-owned specimens that are neither `transferred` nor `missing`. `<m>` is occupied tray cells.
- F_STATUS_LINE:
  - `<n>` is specimens with a `specimen.created` event whose `at` falls on today. Seeded fixture specimens have no such event and never count.
  - `<m>` is specimens whose attribution has `register: "pending"`, whatever the date.
- F_CORNER_CLOSING shows while any counted open offer has `closing` true.

For example, with the seed data at start in `hollowmint`:

- G04 reads "2 open offers".
- G20's lines read "2 open offers" and "0 awaiting receipt".
- G19's lines read "5 specimens" and "1 of 4 cells filled".
- G06 reads "Today: 0 specimens taken in. 0 catalog records pending."

**When derived values update**: G06, G04, the chip labels and N09 update on page load and on every pushed desk event. N09 also refreshes from the server at least once every 60 seconds. The browser never computes them from its own clock.

## Backend

### API (DP-03, DP-11, DP-19, DP-31, DP-35, DP-39, DP-43, DP-47, DP-49, DP-51)

**General rules**

- All routes are same-origin. JSON requests use `Content-Type: application/json`; intake, uploads and arrival photographs use `multipart/form-data`.
- The request body limit is FLAN_REQUEST_MAX_BYTES, inclusive.
- Responses are UTF-8 JSON unless stated otherwise.
- `<ns>` is a namespace. Paths name records by their published keys.
- Every mutating request carries `command_id` (1 to 64 characters). Requests that change an existing record also carry `expected_version` (an integer).

**Error shape.** Every error has the shape `{"error":"<code>","message":"<copy from Feedback states>"}`. A 422, and the per-photograph 413 of Error precedence step 6, add `"fields":{"<field>":"<copy>"}`. A 429 adds `"retry_after_seconds":<integer>`.

**Transport errors** are checked before anything else:

- malformed JSON or multipart: 400 `bad_request` with F_BAD_BODY
- body over the limit: 413 `too_large` with F_TOO_LARGE
- wrong content type: 415 `unsupported_media_type` with F_BAD_BODY
- known path with the wrong method: 405 `method_not_allowed` with an `Allow` header and F_BAD_BODY
- these exceptions come before every other transport check, so neither path reveals itself through 400, 405, 413 or 415:
  - a dealer-only route (listed in Server boundary) answers a signed-in counterpart or outsider 404 `not_found` with F_HIDDEN, whatever the method or body
  - a grading route answers 404 `not_found` with F_HIDDEN, whatever the method or body, to a request without the valid grading key
- unknown path: 404 `not_found` with F_HIDDEN

**Error precedence** applies, in this order, to every parseable request within the limit. This is the only statement of the order; endpoint rows list only their own extra errors.

1. 401 `authentication_required` (F_SESSION): no completed session, an expired session, or a Keycloak session that has ended or been disabled. A half-completed sign-in grants nothing.
2. 404 `not_found` (F_HIDDEN): a missing, foreign, hidden or no-longer-shared resource, including any resource key inside the body.
3. 403 `forbidden` (F_FORBIDDEN): the resource is visible but this role cannot do the action. A missing or stale step-up proof answers 403 `step_up_required` with F_MFA_REQUIRED.
4. Replay: a known `command_id` with an identical payload returns the stored status and body, with no new side effect. The same `command_id` with a different payload answers 409 `conflict` with F_COMMAND_REUSED.
5. 409 `conflict`: state conflicts. Within 409, the order is: a terminal or frozen state (F_OFFER_EXPIRED, F_DISPATCH_FROZEN); then a stale `expected_version` (F_CONFLICT); then occupancy, reservation and eligibility, checked in exactly this listed order: F_TRAY_TAKEN, F_OFFER_TAKEN, F_IN_OFFER, F_SET_UNCERTAIN, F_SET_OUTBOUND, F_CATALOG_PENDING, F_INTAKE_DUP, F_UNDO_NONE. For example, an album fill with a quarantined specimen whose catalogue record is still pending answers F_SET_UNCERTAIN.
6. 422 `invalid` (F_INVALID with `fields`): field and semantic validation, including holder size (field `cell`: F_TRAY_SIZE).
   - When any uploaded photograph exceeds FLAN_UPLOAD_MAX_BYTES, this step answers 413 instead, with the body `{"error":"too_large","message":"<F_TOO_LARGE copy>","fields":{"obverse":"<F_PHOTO_BYTES copy>"}}`.
   - In that body, `obverse`, `reverse` or `photo` names each over-limit file. Every other invalid field is listed with its own copy, as in a 422.
   - This 413 ranks after every earlier step, so 401, 404, 403, replay and 409 (including F_INTAKE_DUP) win over it.
   - A whole body over FLAN_REQUEST_MAX_BYTES is the transport 413 instead, which has no `fields`.

**Provider errors** arise only after all of the checks above pass. They are never stored for replay, so a retry with the same `command_id` runs again.

- Postgres, MinIO or Keycloak unreachable or timed out: 503 `service_unavailable` with F_SERVICE.
- The register timed out, unreachable or answering 5xx: 503 `catalog_unavailable` with F_CATALOG_WAIT.
- The register answering 429: 429 `catalog_busy` with F_CATALOG_RATE. The response carries `Retry-After` and `retry_after_seconds`, both equal to the register's `Retry-After` seconds.
- A malformed register reply: 502 `catalog_malformed` with F_CATALOG_BAD.
- The register answering 404: 502 `catalog_missing` with F_CATALOG_MISSING.

**Platform and session routes**

| Method and path | Request | Success |
|---|---|---|
| GET /api/health | none | 200 `{"status":"ok"}` |
| GET /auth/login?return_to=<path> | none | 302 to Keycloak; the callback returns 302 to `<path>` |
| GET /auth/callback | Keycloak's code and state | 302 to the saved `return_to` |
| GET /auth/step-up?return_to=<path> | none | 302 to Keycloak requesting the one-time-code level; returns 302 to `<path>` with a fresh proof on the session |
| POST /auth/logout | none | 204 |
| GET /api/session | none | 200 `{"subject":"<id>","username":"<username>","role":"dealer"\|"counterpart"\|"outsider","namespace":"<ns>","step_up_fresh":<bool>,"step_up_expires_at":"<UTC>"\|null}` |

**Reads**

| Method and path | Who | Success |
|---|---|---|
| GET /api/desks/<ns>/state | dealer, counterpart | 200, the state object below |
| GET /api/desks/<ns>/stream?after=<sequence> | dealer, counterpart | 200 `text/event-stream`. It first replays every event after `after` (or after `Last-Event-ID`) in sequence order, then streams live. Each message has `id: <sequence>` and `data: <event JSON>`. A comment line is sent every 15 seconds. |
| GET /api/desks/<ns>/specimens?limit=<n>&after=<cursor> | dealer | 200 `{"items":[<specimen>],"next":"<cursor>"\|null}`, where each `<specimen>` is the state object's specimen plus its `"key"`. `limit` is 1 to FLAN_PAGE_MAX (default FLAN_PAGE_MAX); a larger value is 422, field `limit`, F_PAGE_LIMIT. Items are in creation sequence. The cursor is the last item's creation sequence, so moving holders between cells never changes order and no item repeats or is skipped across pages. |
| GET /api/desks/<ns>/audit/cells?limit=<n>&after=<cursor> | dealer | 200 `{"items":[{"cell","specimen","audit_mark","audit_version"}],"next":...}`, in row-major order, with the same limit rule. Its cursor is the last item's cell coordinate (for example `A2`), and each cell appears exactly once across pages. The no-repeat, no-skip guarantee for specimens belongs to the specimen list. |
| GET /api/desks/<ns>/photos/<photo id> | the parties allowed to see the specimen | 200 with the stored bytes exactly, their stored content type and `Cache-Control: no-store` |
| GET /evidence/<token> | an authenticated party of the link's dispute | 200 with the dispute's arrival photograph bytes and `Cache-Control: no-store`. Any other caller, or an expired or revoked token, gets 404 F_HIDDEN. |

**State object.** The state object holds these fields:

```
{"version":<int>,
 "versions":{"tray":<int>,"album":<int>,"keeper_order":<int>},
 "specimens":{"<key>":{"display_label","owner","status","version","holder":{"kind","width_mm","height_mm"},
   "attribution":{"reference","mintmark","revision","certainty","note","correction","register":"stored"|"pending"},
   "quarantined","missing","photos":[{"id","label","object_key","sha256","width","height"}],
   "annotations":[{"id","photo","x","y","text"}]}},
 "tray":{"<cell>":{"specimen","audit_mark","audit_version"}},
 "album":{"set","revision","holes":{"<hole>":{"reference","mintmark","specimen"}}},
 "keeper_order":["<key>"],
 "offers":{"<offer>":{"version","status","dealer_items","counterpart_items","acceptances":{"dealer":<version>|null,"counterpart":<version>|null},
   "holds":["<key>"],"expires_at","remaining_seconds","closing"}},
 "manifests":{"<offer>/<party>":{"version","order","frozen","evidence":[{"specimen","label","object_key","sha256"}]}},
 "receipts":{"<offer>/<party>":{"confirmed","matches"}},
 "disputes":{"<dispute>":{"offer","specimen","version","open","markers":[{"id","x","y","text"}],"resolution":{"outcome","proposed_by"}|null,"resolution_approvals":["dealer"|"counterpart"]}},
 "audit_events":[{"cell","mark","actor","sequence","command_id"}],
 "events":[{"command_id","actor","type","sequence","at"}]}
```

Field rules:

- `owner` is `dealer`, `counterpart` or `outsider`.
- `status` is one of the specimen states in Business rules.
- `certainty` is `certain` or `uncertain`.
- `x` and `y` are original-image coordinates.
- `<party>` in a manifest key is the sender; in a receipt key it is the receiver.
- `actor` is `dealer`, `counterpart` or `system`.
- `at` is a namespace-clock UTC timestamp.
- An offer's `expires_at` is a namespace-clock UTC timestamp or null, `remaining_seconds` is an integer or null, and `closing` is a boolean.
- Only `keeper_order`, manifest `order`, `audit_events` and `events` have meaningful order.
- A counterpart's state holds only offers, manifests, receipts and disputes they are party to, plus the specimens those name. Their `tray` and `album` are `{}`, and their `keeper_order` and `audit_events` are `[]`.

**Commands.** Each row lists only its extra errors.

| Method and path | Request JSON | Success | Extra errors |
|---|---|---|---|
| POST /api/desks/<ns>/specimens (dealer) | multipart: `command_id`, `reference`, `obverse` (file), `reverse` (file) | 201 `{"specimen":<specimen>}` | 409 F_INTAKE_DUP; 422 fields `reference`, `obverse`, `reverse`; the step-6 413 when a file exceeds FLAN_UPLOAD_MAX_BYTES |
| POST /api/desks/<ns>/specimens/<key>/quarantine (dealer) | `command_id`, `expected_version`, `note` | 200 `{"specimen"}` | 409 F_IN_OFFER; 422 `note` |
| POST /api/desks/<ns>/specimens/<key>/reconcile (dealer) | `command_id`, `expected_version`, `correction` | 200 `{"specimen"}` | 422 `correction`; register errors |
| POST /api/desks/<ns>/specimens/<key>/annotations (dealer) | `command_id`, `expected_version`, `annotation`, `photo`, `x`, `y`, `text` | 200 `{"specimen"}` | 422 `x`, `y` (F_COORD), `text` |
| POST /api/desks/<ns>/tray/placements (dealer) | `command_id`, `expected_version` (tray), `specimen`, `cell` | 200 `{"tray","version"}` | 409 F_TRAY_TAKEN; 422 `cell` F_TRAY_SIZE |
| POST /api/desks/<ns>/album/reconcile (dealer) | `command_id` | 200 `{"album"}` | register errors |
| POST /api/desks/<ns>/album/holes/<hole>/fill (dealer; `<hole>` URL-encoded) | `command_id`, `expected_version` (album), `specimen` | 200 `{"album","version"}` | 409 F_SET_UNCERTAIN, F_SET_OUTBOUND, F_CATALOG_PENDING; 422 `specimen` F_SET_MISMATCH |
| PUT /api/desks/<ns>/keeper-order (dealer) | `command_id`, `expected_version`, `order` | 200 `{"keeper_order","version"}` | 422 `order` F_ORDER |
| POST /api/desks/<ns>/keeper-order/undo (dealer) | `command_id`, `expected_version` | 200 `{"keeper_order","version"}` | 409 F_UNDO_NONE |
| POST /api/desks/<ns>/offers/<offer>/send (dealer, step-up) | `command_id`, `expected_version`, `dealer_items`, `counterpart_items` | 200 `{"offer"}` | 409 F_OFFER_TAKEN, F_CATALOG_PENDING, F_IN_OFFER; 422 `dealer_items`, `counterpart_items` (F_BASKET_FULL, F_BASKET_EMPTY) |
| POST /api/desks/<ns>/offers/<offer>/holds (counterpart) | `command_id`, `specimen` | 201 `{"hold":{"specimen"}}` | 409 F_OFFER_TAKEN, F_OFFER_EXPIRED |
| DELETE /api/desks/<ns>/offers/<offer>/holds/<key> (counterpart) | none | 204 | none |
| POST /api/desks/<ns>/offers/<offer>/replace (either party) | `command_id`, `expected_version`, `remove`, `add` | 200 `{"offer"}` | 409 F_OFFER_TAKEN, F_OFFER_EXPIRED, F_DISPATCH_FROZEN, F_CATALOG_PENDING |
| POST /api/desks/<ns>/offers/<offer>/accept (either party, step-up) | `command_id`, `expected_version` | 200 `{"offer"}` | 409 F_OFFER_EXPIRED |
| POST /api/desks/<ns>/offers/<offer>/manifests/<party>/freeze (sender) | `command_id`, `expected_version`, `order` | 200 `{"manifest"}` | 409 F_DISPATCH_FROZEN; 422 `order` F_ORDER |
| POST /api/desks/<ns>/offers/<offer>/arrivals (receiver) | multipart: `command_id`, `specimen`, `photo` | 201 `{"photo"}` | 422 `photo` (photo rules); the step-6 413 for an oversized `photo` |
| POST /api/desks/<ns>/offers/<offer>/receipts (receiver, step-up) | `command_id`, `expected_version` (offer), `matches` | 200 `{"receipt","offer"}` | 422 `matches` F_ARRIVAL_MISSING |
| POST /api/desks/<ns>/offers/<offer>/disputes (receiver of `specimen`) | `command_id`, `expected_version` (offer), `specimen`, `note`, `markers` | 201 `{"dispute"}` | 422 `markers` (F_COORD), `note` |
| PUT /api/desks/<ns>/disputes/<dispute>/markers/<marker> (either party) | `command_id`, `expected_version` (dispute), `x`, `y`, `text` | 200 `{"dispute"}` | 422 `x`, `y`, `text` |
| POST /api/desks/<ns>/disputes/<dispute>/resolution (either party) | `command_id`, `expected_version`, `outcome` (`transfer` or `return`) | 200 `{"dispute"}` | none |
| POST /api/desks/<ns>/disputes/<dispute>/approve-resolution (the party that did not propose) | `command_id`, `expected_version` | 200 `{"dispute","offer"}` | 403 for the proposer |
| POST /api/desks/<ns>/disputes/<dispute>/links (either party) | `command_id` | 201 `{"link":{"token","url","expires_at"}}` | none |
| DELETE /api/desks/<ns>/disputes/<dispute>/links/<token> (either party) | none | 204 | none |
| POST /api/desks/<ns>/audit/marks (dealer) | `command_id`, `expected_version` (cell `audit_version`), `cell`, `mark` (`missing`) | 200 `{"cell"}` | 422 `cell` F_CELL_EMPTY |
| POST /api/desks/<ns>/audit/sync (dealer) | `{"commands":[<audit mark request>, ...]}` | 200 `{"results":[{"command_id","status","body"}]}`, one result per command in request order, each status and body as if posted alone | 422 `commands` F_SYNC_LIMIT |

**Grading routes.** These exist only when FLAN_GRADE_KEY is set and the request carries a header `X-Flan-Grading-Key` equal to it. Otherwise they answer 404 F_HIDDEN, as unknown paths do. A namespace is 1 to FLAN_NAMESPACE_MAX_CHARS lowercase ASCII letters, digits and hyphens; any other value is 422, field `namespace`.

| Method and path | Request | Success |
|---|---|---|
| POST /__grade/seed | `{"namespace":"<ns>","workflow":"<workflow>","variant":"<variant>"}` | 201 `{"namespace","entries":{"dealer","dealer_peer","counterpart","outsider"},"sessions":{"dealer","dealer_peer","counterpart","outsider"},"state_url","media":{"obverse","reverse"},"clock"}` |
| POST /__grade/<ns>/clock | `{"advance_seconds":<nonnegative integer>}` | 200 `{"clock":"<UTC>"}` |
| GET /__grade/<ns>/otp?role=<role> | none | 200 `{"code":"<current provider-valid code>"}` |
| POST /__grade/<ns>/identity | `{"role":"counterpart","action":"revoke"\|"password_change"}` | 200 `{"role","action"}` |

Seed route details:

- `workflow` is one of the fourteen workflow keys in Seed data; `variant` is `base`, `conflict`, `outage`, `offline` or `session`.
- `entries` are absolute URLs that open that role's view of the workflow's screen, or the desk home where the role has no view of that workflow.
- `sessions` are Playwright storage states (`{"cookies":[...],"origins":[...]}`) holding genuine, separate application and Keycloak sign-ins, without a step-up proof. The keycloak-down and postgres-down exceptions are in Seed data, Seeding rules. `dealer` and `dealer_peer` are two tabs of the same dealer.
- `media` are URLs of two staged photographs.
- `clock` is the namespace time.
- A seeding failure answers 500 `{"error":"seed_failed","message":"<what was missing>"}` within ten seconds.

Identity route details:

- `revoke` disables the counterpart's Keycloak user and ends their Keycloak sessions.
- `password_change` sets a new password and ends their Keycloak sessions.

### Business rules (DP-03, DP-07, DP-11, DP-15, DP-19, DP-21, DP-23, DP-27, DP-31, DP-35, DP-39, DP-43, DP-47, DP-51)

**Commands, versions and history**

- Every confirmed change is one command, with a `command_id` and the `expected_version` of the record it changes. The server decides reservations, holds, ownership, holder occupancy, eligibility and every legal transition inside one Postgres transaction.
- A write whose `expected_version` is not the record's current version is refused as stale.
- Each committed command bumps its record's version (the offer exceptions are listed under Offers) and appends its own event, plus any further event a rule below names for the same transaction, each with the next desk `sequence`. Rejected commands create no event, reservation, ownership change, freeze or object.
- Event `type` is one of: `specimen.created`, `specimen.quarantined`, `specimen.reconciled`, `annotation.saved`, `tray.placed`, `album.reconciled`, `album.filled`, `album.reopened`, `keeper.reordered`, `keeper.restored`, `offer.sent`, `offer.replaced`, `offer.accepted`, `offer.expired`, `hold.placed`, `hold.released`, `manifest.frozen`, `arrival.saved`, `receipt.recorded`, `ownership.transferred`, `offer.returned`, `dispute.opened`, `marker.moved`, `resolution.proposed`, `resolution.approved`, `link.created`, `link.revoked`, `audit.marked`, `access.ended`.
- Open screens receive every event over the stream within FLAN_LIVE_MS and redraw in place without reload. On reconnect, a screen replays the events it missed in sequence order, applying each once.

**Specimen states**

- Lifecycle: `intake` → `pending_catalogue` → `attributed` or `quarantined` → `shelved` (attributed and in a tray cell) → `reserved` (in an open offer or hold) → `outbound` (in an accepted or dispatched offer) → `transferred`. Any non-transferred specimen becomes `missing` when an audit marks it missing.
- Quarantining a `reserved` or `outbound` specimen answers F_IN_OFFER.
- Eligibility for an album hole or an offer requires: attribution with `register: "stored"`, certainty `certain`, not quarantined, not missing, and not reserved, held or outbound.

**Intake photographs (P16, P19)**

- The `reference` is 1 to 80 ASCII letters, digits or hyphens (F_REFERENCE_FORMAT). It becomes the specimen key, and the display label is "Specimen <reference>".
- Each face is judged by its content, never by its name or declared type. It must be a JPEG, PNG or WebP by signature (F_PHOTO_TYPE), and any SVG or XML content is refused (F_PHOTO_SVG).
- Size limits:
  - at most FLAN_UPLOAD_MAX_BYTES (F_PHOTO_BYTES, answered with the step-6 413 in API)
  - a long edge from FLAN_PHOTO_MIN_EDGE_PX to FLAN_PHOTO_MAX_EDGE_PX (F_PHOTO_EDGE)
  - at most FLAN_PHOTO_MAX_PIXELS pixels (F_PHOTO_PIXELS)
- Every limit is inclusive. Dimensions are read from the file header before any decoding, so a highly compressed image declaring huge dimensions is refused without being expanded.
- A missing face is F_PHOTO_MISSING.
- The browser applies the same checks when a file is dropped and shows the reason in that slot. The server checks again on create, and its field errors are shown in the matching slot.
- A refused file is never written to MinIO.
- On create, both faces are written to MinIO and confirmed by reading their metadata back. Only then is the specimen committed, with status `pending_catalogue` and both photos recorded. If either write fails, nothing is committed and no orphan object remains listed in state.
- Two creates with the same reference: exactly one wins, and the other gets F_INTAKE_DUP.

**Text lengths (P16).** Lengths are counted in user-perceived characters, so an emoji counts as one. Limits, all inclusive:

- `correction`: FLAN_CORRECTION_MAX_CHARS
- notes and marker texts: FLAN_NOTE_MAX_CHARS

Over the limit is 422 with F_TEXT_LONG.

**Catalogue reconciliation (P18, P24, P57)**

- `correction` is the catalogue reference the dealer asserts, for example "ALD-A".
- On reconcile, the server first stores the correction on the specimen (`attribution.correction`, `register: "pending"`) without changing the specimen version. It then calls the register's variety lookup and image within FLAN_PROVIDER_TIMEOUT_MS.
- A reply is malformed when any of these hold:
  - it is not JSON
  - a published field is missing or of the wrong type
  - `reference` differs from the request
  - `revision` is not a positive integer
  - `image_path` does not start with `/catalog/images/`
  - the image is not a well-formed SVG
- Only a well-formed record whose image is stored in MinIO completes the reconcile. The specimen then takes the register's `reference`, `mintmark` and `revision`, `register: "stored"` and status `attributed`, and keeps the dealer's correction text.
- On any register failure, the attribution stays `pending` with the correction intact. No locally invented record ever completes it, and a retry never replaces the correction with register defaults.
- On a 429, the browser shows F_CATALOG_COUNTDOWN from the server's `retry_after_seconds` (the browser counts the seconds down; the server states the start). R04 is disabled during the countdown. At zero the browser announces F_CATALOG_RETRYING and re-sends the same command.
- After a timeout, malformed reply or missing entry, R04 re-sends the same command.
- Album definitions follow the same rules. A reply with more than FLAN_ALBUM_MAX_HOLES holes is malformed, so an album renders at most that many holes.

**Sessions and step-up**

- Application sessions last FLAN_SESSION_TTL_S on the namespace clock. After that, writes answer 401 and the screen shows F_SESSION with G14.
- G14 signs in again through Keycloak's existing sign-in. Then the browser re-sends the pending confirmed command once, with its original `command_id`, announcing F_RESUMED. Drafts, divider positions and markers are unchanged.
- Step-up is Keycloak's one-time-code level. Password sign-in alone is level 1; the code makes it level 2.
- A step-up proof is fresh for FLAN_STEPUP_TTL_S of real time after Keycloak's authentication time.
- Sending an offer, accepting an offer version and recording receipt each need a fresh proof.
- Every write checks that the user's Keycloak account is enabled and their Keycloak session is active.
- The server re-checks every streaming counterpart at least once per FLAN_LIVE_MS. On revocation or a password change it sends `access.ended` and closes their stream. That screen removes every photograph, closes open reviews, announces F_REVOKED and focuses G05. Their next write answers 401, so no queued or resumed command succeeds afterwards.

**Tray (P30)**

- Cells A1, A2, B1 and B2 are each 60 mm by 60 mm.
- A holder fits when its width and height are both at most the cell's, with no rotation. A holder that does not fit gets F_TRAY_SIZE. A cell holding another specimen gets F_TRAY_TAKEN.
- Placing a specimen that is already shelved moves it, freeing its old cell. Placement uses the tray version, so of two simultaneous placements exactly one commits and the other is stale.

**Album (P57)**

- Holes exist only from a stored register album record.
- A fill requires the specimen's stored mintmark to equal the hole's (F_SET_MISMATCH), the specimen to be eligible, and its status not to be quarantined (F_SET_UNCERTAIN) or reserved, held or outbound (F_SET_OUTBOUND).
- When a filling specimen later becomes quarantined, reserved, outbound, missing or transferred, its hole reopens in the same transaction, with event `album.reopened`.

**Annotations and markers.** Coordinates are integers in the photograph's original pixel grid, from 0 to width−1 and 0 to height−1 (F_COORD). The rendered marker stays within FLAN_GEOMETRY_TOLERANCE_PX of the same image point at every viewport, zoom and divider position.

**Keeper order**

- `order` must list each keeper specimen exactly once (F_ORDER). Position 1 is marked "Keeper" in D02.
- Undo restores the order from before the last confirmed reorder. It stays available until the next confirmed reorder or undo, and after that gets F_UNDO_NONE.

**Offers (P30, P56, P57, P67)**

- Status transitions:
  - `draft` → `sent`: the dealer sends.
  - `sent` or `countered`: a replacement by the dealer makes it `sent`; a replacement by the counterpart makes it `countered`.
  - `accepted` → `sent` or `countered`: a replacement, which voids the acceptance.
  - `sent`, `countered` or `accepted` → `dispatched`: both manifests frozen.
  - `dispatched` → `received`: the first receipt.
  - `disputed`, `transferred` and `returned` as below.
  - `sent` or `countered` → `expired`.
- Any command on an expired offer answers F_OFFER_EXPIRED. Sending a non-draft is stale.
- Each basket side holds 1 to FLAN_OFFER_MAX_ITEMS specimens, inclusive. Dealer items must be dealer-owned and eligible; counterpart items must be counterpart-owned and eligible. An unreconciled specimen gets F_CATALOG_PENDING. An outsider's specimen is not found.
- Sending reserves every item in both baskets in one transaction. If any item is already reserved or held, nothing is reserved and the answer is F_OFFER_TAKEN. Of two offers contending for one specimen, exactly one wins.
- Each party accepts the current version separately, sending it as `expected_version`. Accepting never bumps the offer version. An acceptance stores the party, the offer version it accepted (the version current when it committed) and the Keycloak subject, and `acceptances.<party>` shows that version. When both acceptances name the current version, the status becomes `accepted` and every item becomes `outbound`.
- **Offer version rules**. Three groups of commands and events affect the offer version differently:
  - **Bump the version and clear both acceptances.** These are `offer.sent`, `offer.replaced`, and any committed change to an included specimen's attribution, photographs or annotations (`specimen.reconciled`, `annotation.saved`) while the offer is `sent`, `countered` or `accepted`. Each returns the status to `sent` (dealer change) or `countered` (counterpart change).
  - **Bump the version but keep both acceptances.** These are `receipt.recorded`, `dispute.opened`, `resolution.approved`, `ownership.transferred` and `offer.returned`. The same applies to `manifest.frozen` when it makes the offer `dispatched`; a freeze that leaves the other manifest unfrozen bumps only its manifest's version.
  - **Never bump the offer version or touch acceptances.** These are `offer.accepted`, `hold.placed`, `hold.released`, `offer.expired`, `arrival.saved`, `link.created`, `link.revoked`, `marker.moved` and `resolution.proposed`. The last two bump only the dispute's version.
- A replacement releases the removed specimen's reservation and reserves the added one atomically. Once any manifest is frozen, a replacement is refused with F_DISPATCH_FROZEN.
- **Response windows**: sending, or any dealer change, sets `expires_at` to namespace now plus FLAN_OFFER_WINDOW_S. A counterpart change sets it to now plus FLAN_COUNTER_WINDOW_S. `remaining_seconds` is never below 0. `closing` is true while `remaining_seconds` is at most FLAN_CLOSING_S.
- Expiry is decided on the namespace clock whenever the offer is read or written. Expiry releases every reservation and hold, and appends `offer.expired`.
- A window runs only while the offer is `sent` or `countered`. In `draft`, and from the moment an offer becomes `accepted` through every later status, `expires_at` and `remaining_seconds` are null and `closing` is false, so an accepted offer never expires and never makes F_CORNER_CLOSING show. A replacement that returns an accepted offer to `sent` or `countered` starts a new window by the rule above. An `expired` offer keeps the `expires_at` it expired at, with `remaining_seconds` 0 and `closing` false.
- Window text follows status: F_WINDOW for `sent` and `countered`, F_WINDOW_ACCEPTED for `accepted`, F_WINDOW_CLOSED for `expired`, and no window text for any other status.
- The browser shows only these server values, so a wrong device clock never changes what is open or expired.
- **Review holds**: when the counterpart stages a replacement that adds one of the dealer's duplicates, the browser places a hold. A held specimen is reserved for that offer. The hold lasts while any stream of that counterpart is open. It is released FLAN_HOLD_GRACE_S after their last stream closes, unless they reconnect first, and also on commit or on DELETE. Release appends `hold.released`, and the dealer's screen announces F_HOLD_RELEASED.

**Dispatch (P57)**

- Each sender's manifest lists that sender's items. Freezing needs status `accepted`, sets the final packing order and copies each item's latest obverse photograph into a new immutable object, labelled `dispatch`.
- A manifest is frozen only after MinIO confirms every copy and the manifest record object. It stays pending until then. It is never frozen if any write fails.
- After freezing, every freeze or reorder answers F_DISPATCH_FROZEN, and that check comes before the version check. A counterpart cannot change the dealer's manifest (403).
- When both manifests are frozen, the offer becomes `dispatched`.

**Receipt and transfer**

- A receiver records receipt only after an arrival photograph exists for every item they received (F_ARRIVAL_MISSING). Arrival photographs follow the intake photo rules.
- The first receipt makes the offer `received`, with ownership unchanged.
- When both receipts exist, both have `matches: true` and no dispute is open, the second receipt swaps the owners of every item and makes the offer `transferred`, in one transaction, appending `receipt.recorded` then `ownership.transferred`. Both screens show F_RECEIPT_DONE.
- With a mismatch, the offer stays `received` (F_RECEIPT_MISMATCH). With an open dispute, it stays `disputed` (F_RECEIPT_HOLD).

**Disputes and evidence links (P25, P57)**

- A party opens a dispute on a specimen they received, in status `dispatched` or `received`. It carries markers on that specimen's arrival photograph and a note.
- Opening writes an evidence snapshot object to MinIO (markers plus the frozen dispatch and arrival object keys). The dispute counts as open only after MinIO confirms it. Opening makes the offer `disputed`.
- While a dispute is open, no receipt transfers ownership.
- Either party proposes `transfer` or `return`. The other party approves, and approving closes the dispute.
  - `transfer`: if both receipts exist, ownership swaps and the offer becomes `transferred`, appending `resolution.approved` then `ownership.transferred`; otherwise it returns to `dispatched` or `received`.
  - `return`: ownership is unchanged, reservations are released and the offer becomes `returned`, appending `resolution.approved` then `offer.returned`.
- Resolution never changes frozen dispatch evidence.
- An evidence link token is random, scoped to its dispute and valid for FLAN_LINK_TTL_S on the namespace clock. Revoking it ends access immediately.

**Audit (P17)**

- A missing mark sets the cell's specimen `missing: true` and status `missing`, bumps the cell's `audit_version` and appends to `audit_events`. History is never rewritten.
- Offline marks queue in the browser, survive reload and are sent through sync in recorded order, at most FLAN_SYNC_BATCH_MAX per request. Each is applied once by `command_id`.
- Each queued mark's `expected_version` is the cell's `audit_version` that the browser last received from the server, plus one for each earlier mark on the same cell still queued in that browser. So one browser's queued marks chain on each cell, and marks on different cells are independent.
- A queued mark whose cell changed meanwhile comes back stale. It stays visible as a conflict with G11, never overwriting the newer change.

**Limits and clocks.** Every value is read from the environment at start, with these defaults:

| Variable | Default and unit | Meaning |
|---|---|---|
| FLAN_GRADE_KEY | none; secret string | Enables and authenticates the grading routes |
| FLAN_LIVE_MS | 1000 milliseconds | Maximum delay before open screens show a committed change or a revocation |
| FLAN_PROVIDER_TIMEOUT_MS | 1000 milliseconds | Timeout for every register, MinIO and Keycloak call |
| FLAN_CATALOG_RETRY_S | 1 second | `Retry-After` value in the invented register's published rate-limit reply |
| FLAN_MOTION_MS | 150 milliseconds | Fade duration; configure below 500 |
| FLAN_SESSION_TTL_S | 900 seconds | Application session lifetime, namespace clock |
| FLAN_STEPUP_TTL_S | 300 seconds | Step-up proof freshness, real time |
| FLAN_TOTP_PERIOD_S | 30 seconds | One-time-code period of seeded identities |
| FLAN_LINK_TTL_S | 600 seconds | Evidence link lifetime, namespace clock |
| FLAN_HOLD_GRACE_S | 30 seconds | Hold release grace after the counterpart's last stream closes, real time |
| FLAN_OFFER_WINDOW_S | 172800 seconds (48 hours) | Offer response window, namespace clock |
| FLAN_COUNTER_WINDOW_S | 86400 seconds (24 hours) | Counteroffer response window, namespace clock |
| FLAN_CLOSING_S | 21600 seconds (6 hours) | Remaining time at which an offer counts as closing |
| FLAN_UPLOAD_MAX_BYTES | 5000000 bytes | Largest single photograph, inclusive |
| FLAN_REQUEST_MAX_BYTES | 12000000 bytes | Largest request body, inclusive |
| FLAN_PHOTO_MIN_EDGE_PX | 1000 pixels | Smallest long edge, inclusive |
| FLAN_PHOTO_MAX_EDGE_PX | 8000 pixels | Largest long edge, inclusive |
| FLAN_PHOTO_MAX_PIXELS | 40000000 pixels | Largest width × height, inclusive |
| FLAN_CORRECTION_MAX_CHARS | 80 characters | Longest correction, inclusive |
| FLAN_NOTE_MAX_CHARS | 280 characters | Longest note or marker text, inclusive |
| FLAN_OFFER_MAX_ITEMS | 3 items per side | Largest basket, inclusive |
| FLAN_ALBUM_MAX_HOLES | 200 holes | Largest album, inclusive |
| FLAN_PAGE_MAX | 48 items | Largest page, inclusive |
| FLAN_SYNC_BATCH_MAX | 50 commands | Largest sync batch, inclusive |
| FLAN_NAMESPACE_MAX_CHARS | 64 characters | Longest namespace, inclusive |
| FLAN_TARGET_MIN_PX | 44 CSS pixels | Smallest target width and height |
| FLAN_GEOMETRY_TOLERANCE_PX | 2 CSS pixels | Largest marker-to-feature displacement |
| FLAN_ZOOM_MIN | 1 times | Smallest zoom |
| FLAN_ZOOM_MAX | 4 times | Largest zoom |
| FLAN_ZOOM_STEP | 0.25 times | Keyboard zoom step |
| FLAN_GRADE_CLOCK_ISO | 2026-01-01T12:00:00Z | Starting clock of a seeded grading namespace |

**Clocks**:

- A grading namespace's clock starts at FLAN_GRADE_CLOCK_ISO and advances only through the clock route. The default namespace's clock is real server time.
- A browser's page clock never moves the server or Keycloak.
- One-time codes follow Keycloak's real time, so take a fresh code immediately before each challenge.
- The browser relies on no service worker; offline queues use ordinary browser storage.

No other debounce, expiry, retry count, capacity or animation limit exists.

### Services (DP-03, DP-11, DP-19, DP-39, DP-43, DP-47, DP-55)

**WireMock: the invented Varietal Coin Register.** It is called at `WIREMOCK_URL`, server-side only. All of its data is invented.

- `GET /catalog/varieties?reference=<reference>` returns 200 JSON `{"reference":"ALD-A","issue":"Aldmere crown, 1911","mintmark":"A","revision":1,"image_path":"/catalog/images/ALD-A.svg"}`. Baseline entries:
  - `ALD-A`: mintmark `A`
  - `ALD-K`: mintmark `K`, image `/catalog/images/ALD-K.svg`
  - `ALD-O`: mintmark `O`, image `/catalog/images/ALD-O.svg`
  - All three have issue "Aldmere crown, 1911" and revision 1.
  - Any other reference answers 404 `{"error":"unknown_reference"}`.
- `GET /catalog/images/<reference>.svg` returns 200 `image/svg+xml`: an invented procedural 1000×1000 coin drawing with a stroked rim and its mintmark letter centred at (600,400).
- `GET /catalog/albums?set=ALD-CROWN` returns 200 `{"set":"ALD-CROWN","title":"Aldmere crown mints","revision":1,"holes":[{"label":"Mint A","reference":"ALD-A","mintmark":"A"},{"label":"Mint K","reference":"ALD-K","mintmark":"K"},{"label":"Mint O","reference":"ALD-O","mintmark":"O"}]}`.
- Its published rate-limit reply is 429 with header `Retry-After: <seconds>`.
- The app relies on no other path, parameter or field. Register replies are stored in Postgres, and their images in MinIO.

**MinIO.** The bucket is private and is never made public. Stored bytes equal the submitted bytes, and each `sha256` in state is the stored object's hash. Object keys:

- specimen photographs: `specimens/<ns>/<key>/<label>-<sha256>.<ext>`
- register images: `catalog/<ns>/<reference>/r<revision>.svg`
- frozen evidence: `manifests/<ns>/<offer>/<party>/<key>-dispatch-<sha256>.<ext>` and `manifests/<ns>/<offer>/<party>/manifest.json`
- arrival photographs: `arrivals/<ns>/<offer>/<key>-<sha256>.<ext>`
- dispute snapshots: `disputes/<ns>/<dispute>/evidence-<sequence>.json`

An object counts only after MinIO confirms it.

**Keycloak.**

- On serve, the app configures, idempotently through its service account, the realm's one-time-code step-up level and the identities in Seed data.
- Seed users are `<ns>-dealer`, `<ns>-counterpart` and `<ns>-outsider`, each with password `Flan-<ns>-<role>` and a time-based one-time-code credential with a FLAN_TOTP_PERIOD_S period.
- Roles are realm roles `flan-dealer` and `flan-counterpart`, plus user attribute `flan_namespace`.
- Revocation shows as a disabled user with no sessions.

**Postgres.** Postgres is the system of record for:

- specimens, attributions, register records, trays, cells, albums and keeper order
- offers, holds, manifests, receipts and disputes
- the append-only event log and audit marks
- application sessions, stored command replies and namespace clocks

**Outage behaviour**:

| Dependency down | Behaviour |
|---|---|
| WireMock | Reconcile and album reconcile answer 503 F_CATALOG_WAIT; work stays pending. |
| MinIO | Intake, arrivals, freezes and dispute opening answer 503 F_SERVICE, with nothing committed. Photographs show F_IMAGE_WAIT with C07. |
| Keycloak | Sign-in, step-up and every write answer 503 F_SERVICE; sign-in pages show F_SIGNIN_DOWN. |
| Postgres | Every desk route answers 503 F_SERVICE. Pages show the shell with F_SERVICE. |

In every case drafts stay, and `/api/health` still answers 200.

### Seed data (DP-03, DP-15, DP-19, DP-31, DP-43, DP-49)

Every person, business and coin below is invented.

**Default namespace and judge view**

- At start the app holds the default namespace `hollowmint`, created idempotently on serve. It contains the fixture below with tray, album and keeper order at baseline, plus one sent offer, `offer-1`: C for X, with a fresh 48-hour window.
- The dealer is Wren Halloway of Halloway Numismatics (user `hollowmint-dealer`).
- The counterpart is Odile Marsh of Marsh & Tallow Coins (user `hollowmint-counterpart`).
- The outsider is Penn Ostrander of Ostrander Exonumia (user `hollowmint-outsider`). An outsider sees only F_HIDDEN on this desk.

**Fixture specimens (every namespace)**

| Key | Display label | State |
|---|---|---|
| A | Specimen A | Dealer-owned Aldmere crown ALD-A, mintmark A, reconciled, eligible, flip 50×50 mm |
| B | Specimen B | Same issue, visibly more worn, reconciled, eligible, flip 50×50 mm |
| C | Specimen C | Same issue, reconciled, eligible, slab 70×90 mm |
| U | Specimen U | Dealer-owned, uncertain mintmark K (ALD-K), quarantined, flip 50×50 mm |
| O | Specimen O | Dealer-owned, mintmark O (ALD-O), reconciled, outbound in seeded offer `offer-0`, capsule 46×46 mm |
| X | Specimen X | Counterpart-owned, mintmark K (ALD-K), reconciled, eligible, flip 50×50 mm |
| Y | Specimen Y | Outsider-owned, ALD-A, invisible to both exchange parties |

**Fixture photographs**

- Every fixture photograph is a procedurally drawn 1000×1000 PNG with labels `obverse` and `reverse`, plus `arrival` or `dispatch` where an overlay says so.
- The diagnostic feature is at original-image coordinate (600,400): the mintmark letter on obverse and reverse, a fine scratch through it on a condition photo, and a fresh gouge on a disputed arrival.
- `media.obverse` and `media.reverse` are 1000×1000 PNGs that pass every photo rule.

**Tray, album and keepers**

- The tray "Crown tray 1" has cells A1, A2, B1 and B2 in row-major order. A2 holds B; the others are empty.
- Album `ALD-CROWN` is stored from the register with holes Mint A, Mint K and Mint O, all empty.
- Keeper order is A, B, C.
- Offer `offer-0` exists in every namespace, between the dealer and the counterpart.
  - It is accepted by both at version 1 (status `accepted`), with dealer item O and no counterpart item.
  - It is seeded directly, since basket-size rules apply only when sending.
  - Its `expires_at` and `remaining_seconds` are null and `closing` is false, at every clock position. It counts as an open offer but never shows the F_CORNER_CLOSING pill, and its G34 row reads F_WINDOW_ACCEPTED.
  - No workflow changes it.

**Workflow overlays** applied by the seed route, each independent of any other test:

| Workflow | Overlay |
|---|---|
| intake | No specimen `<ns>-I` exists. Staged media are provided. Under `conflict`, the peer's entry opens a second draft with the same reference prefilled. |
| attribution | A's attribution is unconfirmed (status `pending_catalogue`) with its mintmark visible. |
| catalog_reconciliation | A is `pending_catalogue` with correction draft "ALD-A". Faults are installed by tests through WireMock. |
| tray_placement | Baseline tray and holders. |
| set_tracking | Baseline (empty album). |
| condition_comparison | A has an `arrival` photo from a past exchange, with the scratch at (600,400), and one unsaved condition annotation draft. |
| duplicate_selection | Baseline keeper order, nothing to undo. |
| offer_assembly | Drafts `offer-1` and `offer-2`, both empty; X is available to both. |
| counteroffers | `offer-1` is accepted by both at version 1, with A for X; B is available. Its `expires_at` is null, so N09 reads F_WINDOW_ACCEPTED until a replacement starts a new window. |
| dispatch | `offer-1` is accepted with dealer items A, B and C and counterpart item X. Both manifests are unfrozen, the dealer manifest in order A, B, C. The physical sleeve order is C, A, B. |
| receipt | `offer-1` is dispatched with A for X. Both manifests are frozen. Arrival photos exist for A at the counterpart and for X at the dealer. No receipts. |
| disputes | As receipt, plus the dealer's receipt of X recorded as matching. A's arrival shows the gouge. No dispute yet. |
| stock_audit | A1 holds A, A2 holds B and B1 holds U; B2 is empty. Every cell's `audit_version` is 0 and the audit has no marks. |
| cross-cutting | An unsaved dealer condition-note draft on A and the counterpart's exchange view of a sent `offer-1` (A for X). |

**Seeding rules**

- A variant not named in the overlay table seeds the same state as `base`.
- The seed route fetches register records through the register, exactly as the product does.
- On an instance whose MinIO or register is unreachable, it seeds without that provider: fixture photographs, or register-stored attributions, are then absent, and their screens show the matching pending state.
- On the postgres-down instance, the seed route seeds nothing. It answers 503 `{"error":"service_unavailable","message":"<F_SERVICE copy>"}`. Tests there open pages without a session and see the shell with the Postgres outage behaviour in Services.
- On the keycloak-down instance, the seed route stores the namespace in Postgres and answers 201 as usual. However, each `sessions` entry holds only an application session cookie for that seeded identity, with no Keycloak session. Reads succeed with it. Every write, sign-in and step-up follows the Keycloak outage behaviour in Services.
- The seed never calls another workflow's product operations.

## Technical requirements

### Deployment (DP-53, DP-55)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22.

`/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when set. `GET /api/health` answers HTTP 200 `{"status":"ok"}` whenever the HTTP server runs. The Postgres schema, MinIO bucket use and Keycloak realm setup are applied idempotently on every serve, not only at build.

### Configuration and secrets (DP-55)

These are read at start from the environment, never hard-coded and never sent to the browser:

- Postgres: `DATABASE_URL`
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- Keycloak: `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`
- the register: `WIREMOCK_URL`
- every FLAN_* setting in Business rules, Limits and clocks
- `APP_PUBLIC_PORT` and `APP_PUBLIC_URL`

### Server boundary (DP-49, DP-55)

- The server answers only the routes in API, plus the built frontend's pages under `/`, `/desk/<ns>` and `/desk/<ns>/<workflow>`, `/help`, `/help/evidence`, `/help/keyboard` and static assets. It serves no source files, source maps with secrets, environment, credentials, or debug or test endpoints.
- A counterpart or outsider calling a dealer-only route (specimen list, quarantine, reconcile, annotations, tray, album, keeper order, audit) gets 404 F_HIDDEN, exactly as if the route did not exist, whatever the method or body, as ruled in API. An outsider gets 404 on every `/api/desks/<ns>/` route.
- The API is same-origin; cross-origin requests get no CORS grant. Body limits are those in API.
- Closing a stream mid-way, whether by closing the tab, losing the network or aborting it, releases its database work at once. After ten aborted streams, within five seconds no app database session is active or idle in transaction, and the next request is served.
- When a dependency is unreachable at boot, the server still starts and serves health. It retries setup on each request that needs the dependency, and answers that request with the outage behaviour in Services.

### Browser support and performance (DP-53)

- Supported: current Chromium, Firefox and WebKit at the three published viewports, with touch and with reduced motion.
- With seed data, each workspace is usable within three seconds of navigation.
- Committed changes and revocations reach other open screens within FLAN_LIVE_MS.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and its commands build and serve the app with no manual step.
- IF-02: `THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, with its licence.
- IF-03: Shipped packages and assets use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or SIL OFL 1.1 licences.
- IF-04: The app stores data only in Postgres and MinIO: no other database, cache, queue or file-based store.
- IF-05: The provisioned service configuration is left unedited; Keycloak is configured only at run time through the app's own service account.
- IF-06: Saira, Archivo and Lucide icons are bundled with the app, and the browser loads nothing from third-party origins other than the Keycloak sign-in pages.
- IF-07: No real coin, dealer, auction archive name, wordmark or copy is used; all names, coins and register data are invented.

## Engineering standards

- The TypeScript is idiomatic and strictly typed, with no `any` on domain values.
- Names match this brief's domain terms (specimen, holder, cell, album hole, keeper order, offer, basket, hold, manifest, receipt, dispute, register record, audit mark).
- Each domain rule (an offer or specimen transition, eligibility, holder fit, window expiry, step-up freshness, error precedence) is decided in exactly one place in the source.
- No abstraction has a single implementation, and no defensive check covers a state the rules make impossible.
- There is no dead, commented-out or unreachable code.
- Every error leaves the server in the one published error shape, with copy taken from the single feedback registry.
- Provider calls run only on the server, with the published timeout. No local stand-in for a provider result exists.
- Nothing is built beyond this brief.
