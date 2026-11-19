# Coldset Works Dotgain

Dotgain is an all-or-nothing crowdfunding service for independent small-press print runs: comics, zines and art books printed by offset or short-run digital presses. A creator sets the campaign goal to the printer's minimum run. They add open and limited reward tiers with shipping priced by zone, and they are paid only if the run is funded, with a settlement that is exact to the penny. A backer's card is held when they pledge and charged only if the campaign reaches its goal by the deadline. Backers always see whether their card is held, charged, released or needs fixing, and they keep a PDF statement of exactly what they paid. The product uses Postgres for its own records, Kill Bill for card holds and charges, Mailpit (over SMTP) for every email, MinIO for campaign images and generated PDFs, and Gotenberg to render statements and settlement sheets from HTML. It has no passwords, sign-in provider, payouts to bank accounts, currency other than pounds sterling, comments, search, admin console or datastore beyond the five listed services.

## Problem and users

Offset printers set a minimum run and charge most of the cost up front for press setup. A cartoonist who orders before the money is in ends up with unsold stacks and a debt. Today creators run all-or-nothing campaigns on general crowdfunding platforms that charge about five percent plus processing. Those platforms treat a 300-copy zine like a gadget launch. The goal is a bare figure that says nothing about print-run break points. A limited variant cover oversells when two backers take the last copy at the same moment. When a card fails at collection, the creator finds out in a week-long scramble over failed pledges. Afterwards, receipts, funded notices and backer statements are assembled by hand in spreadsheets and paid add-ons. The creator pays twice: once in fees, then again in evenings spent working out who was actually charged. Backers live with uncertainty. They cannot tell whether their card is held or charged, or whether their copy of the signed edition really exists.

- **Creator** (daily): launches a campaign whose goal is the printer's minimum run, offers limited and open reward tiers with zone shipping, and is paid only if the run is funded, with an exact settlement.
- **Backer** (occasional): pledges toward a tier, sees whether the card is held, charged or needs fixing, and keeps a statement of exactly what was paid.
- **Lapsed backer** (occasional): fixes a card that failed at collection, inside the fix window, before the pledge is dropped.

## Journeys

1. **Draft and launch.** A new visitor on the home page chooses "Start a campaign", enters a name and email, and receives a Dotgain key. In the Studio they fill in title, story, goal, minimum run, stretch break points, home country, time zone and deadline. They add two tiers (one limited), upload a cover and two spreads, and watch each image report Stored. Then they launch. The end state is the live campaign page, with the cover in its circle and an empty Plate Fill.
2. **Keyboard pledge.** A backer on a laptop opens a live campaign. Using only the keyboard, they pick a tier in the tier group, choose a shipping country and type an add-on. Each change updates the total, the shipping line and the proof rings at once. They open the confirm dialog, enter a test card and confirm. The end state: the proof rings ink solid, the total counts up, the pledge-authorised sentence is announced, and the stage shows their held pledge.
3. **Phone pledge under reduced motion.** A backer on a 375 by 812 phone with reduced motion turned on reads Plate Fill in the single-column layout and pledges by touch. The gauge jumps straight to its new coverage. The end state is the same announcement as in journey 2.
4. **Last signed cover.** Two backers press Confirm on the last copy of a limited tier at the same moment. One gets the hold. The other hears that the tier just sold out, sees the tier marked Gone, and has no hold placed on their card.
5. **Change, cancel and the final day.** From My pledges a backer follows their pledge's "Manage pledge" link to the campaign page and changes tier there, and later tries to cancel in the campaign's final window while the campaign is only just funded. The change succeeds and the old hold is released. The cancellation is refused with the would-unfund sentence, and the pledge stays held.
6. **Funded deadline.** The deadline passes with the total at or above the goal. Every held card is charged, and backers receive funded-and-charged emails. My pledges shows a filled dot with "Charged" and, once rendered, "Download statement". The creator downloads a settlement sheet whose net equals the sum of every statement's to-creator line.
7. **Unfunded deadline.** The deadline passes under the goal. Every hold is released, and every backer gets the not-funded email. The campaign page shows the not-funded heading in place of the pledge form.
8. **Fix a failed card.** A backer's card fails at collection. They receive fix-payment emails at each notice interval, open the emailed link, and enter a working card that is held at once. When the fix window closes, the final collection charges it, and their pledge shows "Charged".

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Person keys** Creating a person returns a secret key once, and every personal route accepts only that key as a bearer credential, as qualified in API.
- **DP-02 — Draft campaigns** A creator saves a draft with a title, story, goal, minimum run, stretch break points, home country, time zone and local deadline, each validated as listed in API.
- **DP-03 — Deadline in the campaign's time zone** The deadline is the wall-clock time the creator picks in the campaign's IANA time zone, converted to one exact instant under the Business rules for skipped and repeated local times.
- **DP-04 — Reward tiers and zone shipping** A draft holds open and limited reward tiers, each with its own domestic, Europe and rest-of-world shipping price, editable only while the campaign is a draft.
- **DP-05 — Draft privacy** A draft, its tiers and its images are visible only to their creator, and anyone else gets the not-found answer.
- **DP-06 — Start-a-campaign journey** From the home page a new creator gets a key, fills the editor and sees the saved draft in the Studio list.
- **DP-07 — Media counts only once stored** An uploaded image counts as stored only after the bucket confirms the object, and a failed upload stays listed as not stored.
- **DP-08 — Launch gate** Launch moves a draft to live only when every image is stored, a cover and at least one tier exist, and the deadline falls inside the allowed campaign length.
- **DP-09 — Media served by visibility** Images are served only through their media id to people who may see the campaign, and no route hands out stored objects by key.
- **DP-10 — Cover-and-launch journey** A creator uploads a cover and spreads, watches each image report stored, launches, and sees the live page with the cover in its circle.
- **DP-11 — Keyboard pledge journey** A backer picks a tier, a shipping country and an add-on and confirms the pledge using only the keyboard.
- **DP-12 — Dialog focus** Every dialog keeps Tab and Shift+Tab inside it, closes on Escape and returns focus as stated in Feedback states.
- **DP-13 — Pledge result announcements** Every pledge, change, cancellation and fix outcome is announced in its named polite live region with the exact copy from Feedback states.
- **DP-14 — Pledge amount fixed at pledge time** A pledge's amount is the tier price plus the shipping for the backer's country zone plus the add-on, fixed in pence when the pledge is made.
- **DP-15 — Holds placed in Kill Bill** A pledge becomes authorised only after Kill Bill confirms a successful authorisation for its full amount on the backer's account.
- **DP-16 — Total counts confirmed holds only** The campaign total and percentage include only pledges whose authorisation Kill Bill has confirmed.
- **DP-17 — Declined cards leave no pledge** A declined card leaves no pledge, no counted amount and no claimed copy.
- **DP-18 — Pledge idempotency** Pledge creation and pledge changes honour an idempotency key with the replay and conflict answers given in Business rules.
- **DP-19 — Pledge receipt** Each confirmed authorisation sends the backer a pledge receipt email as specified in Services.
- **DP-20 — One pledge per backer** A backer holds at most one active pledge per campaign, and a creator cannot back their own campaign.
- **DP-21 — Last copy of a limited tier** When backers claim the last copy of a limited tier at once, exactly one wins and every other is refused before any card is authorised.
- **DP-22 — Sold-out tier journey** A backer who loses the last copy sees the tier marked gone and hears the sold-out announcement, with no hold on their card.
- **DP-23 — Changing a pledge** A change places a new hold for the new amount and only then releases the old one, so a refused change leaves the original pledge as it was.
- **DP-24 — Cancelling a pledge** Cancelling releases the hold in Kill Bill, frees any limited copy and emails the backer.
- **DP-25 — Change-and-cancel journey** From My pledges a backer opens a held pledge's campaign page, changes its tier there and later cancels it, seeing each state with its mark and word.
- **DP-26 — Live pledge preview** As the backer changes tier, country or add-on, the total, the shipping line, the proof rings and the preview sentence update in place without a reload.
- **DP-27 — Campaign page breakpoints** The campaign page switches from one column to its two-column pledge layout, and then to its pinned pledge column, at the published breakpoints in Screens and layout.
- **DP-28 — Phone touch pledge journey** On a phone-sized screen a backer reads Plate Fill and pledges by touch alone.
- **DP-29 — Reduced-motion Plate Fill** Under reduced motion the gauge jumps straight to its final coverage, the total shows its final figure and every announcement is unchanged.
- **DP-30 — Final-window guard** In a campaign's final window the server refuses any reduction or cancellation that would take a funded campaign below its goal.
- **DP-31 — Server closes pledging** New pledges, changes and cancellations close at the deadline instant, as decided by the server.
- **DP-32 — Status from the server, not the device** Every screen shows open, closed and time-left status from the server's answer and never from the device clock.
- **DP-33 — Unfunded deadline** A campaign under its goal at the deadline captures nothing, voids every hold and emails every backer.
- **DP-34 — Closed campaign headings** A closed campaign shows the published funded, not-funded or cancelled heading word for word in place of the pledge form.
- **DP-35 — Creator cancellation** A creator can cancel a live campaign only before its deadline, and cancelling voids every hold.
- **DP-36 — Funded capture** A campaign at or above its goal at the deadline captures every held pledge in Kill Bill for its full amount.
- **DP-37 — Each pledge captured whole or errored** Each pledge at a funded deadline ends either captured, with its receipt and statement recorded, or errored with no capture, and never a mix of the two.
- **DP-38 — Funded backer journey** After a funded deadline a backer sees the funded heading, a filled dot with its word and, once ready, a statement download.
- **DP-39 — Fix-payment notices** An errored pledge's backer receives a fix-payment email when the pledge errors and again at every notice interval until the fix window closes.
- **DP-40 — Fixing a card** Through the fix link a lapsed backer replaces the card, which is held at once and collected when the fix window closes.
- **DP-41 — Final attempt and drop** When the fix window closes the server makes one final collection attempt, then marks the pledge captured or dropped and emails the backer.
- **DP-42 — Lapsed backer journey** A lapsed backer opens the emailed fix link, enters a working card and later sees the pledge charged.
- **DP-43 — Fee arithmetic** Each captured pledge carries a platform fee and a processing fee computed in whole pence with half-up rounding per pledge, as stated in Business rules.
- **DP-44 — Backer statement** Each captured pledge gets a statement PDF that is rendered and stored, and shows as ready only after both succeed.
- **DP-45 — Settlement sheet** The creator's settlement net equals the sum of the to-creator lines on every statement, and its sheet is rendered, stored and announced by email.
- **DP-46 — Owner-only documents** A statement downloads only for its backer and a settlement only for its creator, and any other caller gets the not-found answer.
- **DP-47 — Service status banners** The server reports each dependency's state, and the screens show the published banner while one is down.
- **DP-48 — Payment service outage** While Kill Bill is unreachable, pledges, changes, cancellations and fixes are refused with the payment-unavailable answer and nothing changes.
- **DP-49 — Email outage queue** While mail is down every notice is recorded as queued and the action that triggered it still succeeds, as qualified in Services.
- **DP-50 — Storage and document outages** While storage is down every upload is refused and its image stays listed as not stored, and while the PDF renderer is down statements and settlement sheets stay not ready, as qualified in Services.
- **DP-51 — Health and run manifest** The app installs, builds and serves from its run manifest and answers the health check.
- **DP-52 — Plate Fill geometry** The gauge draws the published hex screen of dots with coverage and size from the published formula, plus one outer ring per stretch break point.
- **DP-53 — Plate Fill ink sequence** After a confirmed hold the proof rings ink ring by ring from the centre out while the total counts up, then the result is announced, within the times in Motion and effects.
- **DP-54 — Pledge state marks** Every pledge state shows its dot mark together with its word, so colour never carries meaning alone.
- **DP-55 — Empty and loading states** Empty lists show the outline dot with their published sentence, and loading shows dots inking ring by ring.
- **DP-56 — Halftone hero** The home page opens on the cropped teal disc breaking into a halftone ramp beside the published headline.
- **DP-57 — One-motif working screens** Lists, forms, tables, banners and buttons share the dot motif, the one teal ink on paper and the single corner rule.
- **DP-58 — Credentials from the environment** Every service URL and credential is read from the environment at start and is never hard-coded or sent to the browser.
- **DP-59 — Server boundary** The server is same-origin, enforces its body limits and never serves source, configuration or credentials.

## Frontend

### Screens and layout (DP-06, DP-10, DP-25, DP-27, DP-28, DP-38, DP-42)

All screens fit their viewport width at 375x812, 768x1024 and 1280x800, with no horizontal scrolling. Every screen shares one header: the bold DOTGAIN wordmark on the left and three text links on the right ("Campaigns", "My pledges", "Studio"). On phones the links stay on the same line as the wordmark at a smaller size.

**Home (`/`).** The hero fills the first screen (described in Visual design), and below it sits the list of live campaigns. Each list row shows the cover in a small circle, the title, the pledged total in large even-width figures, and a mini Plate Fill. Rows are a single column at every viewport. At 1280 the list is limited to a comfortable reading width and aligned with the headline's left edge.

**Campaign page (`/campaigns/<id>`).** It holds these blocks: the cover in a large circle; the title and creator name; Plate Fill with "Pledged so far", the total, the goal line and the countdown; the pledge stage; the story; one full-width inverted teal band of dots; and the reward tier list.
- Below 768 pixels wide (the 375 view): one column, in this order: cover, title, Plate Fill, totals and countdown, pledge stage, story, band, tiers. The cover circle and Plate Fill each fill the column width, up to their full size.
- From 768 to 1199 pixels wide (the 768 view): two columns. The wider left column holds the cover, title, story, band and tiers. The right column holds Plate Fill at its smallest campaign size, the totals, the countdown and the pledge stage. The tops of the two columns are level, and the right column scrolls away with the page.
- From 1200 pixels wide (the 1280 view): the same two columns, with Plate Fill at its largest size. The right column stays pinned in view while the left column scrolls, so the pledge stage is still fully visible after the page has scrolled a full screen. The full-width band still spans the whole page width.

**Studio (`/studio`).** This is the creator's home. It shows a "Studio" heading, a "New campaign" button and the list of the creator's own campaigns (circle, title, status chip, total, mini gauge). The editor (`/studio/campaigns/<id>`) is one column at 375. At 768 and above it has two columns: the form on the left, and on the right a live preview of the cover circle and an empty Plate Fill. Once a campaign is live or closed, the editor also shows the backers table and the settlement panel. At 375 the backers table becomes stacked rows, one per backer, with each value labelled.

**My pledges (`/pledges`).** A single-column list of the backer's pledges. Each row shows the cover circle, campaign title, tier, amount, state mark and word, and the row's actions.

**Fix your payment (`/fix/<code>`).** A single column at every size. It shows the campaign title, the amount, the errored mark and word, a large countdown to the end of the fix window, the card field and the update button.

**Not found.** Any unknown page path shows the not-found heading from Feedback states, with a link back home.

### Public screens and controls (DP-11, DP-12, DP-22, DP-26, DP-28, DP-34, DP-47, DP-54, DP-55)

Only these roles and names are public; everything else is the builder's choice. `<title>`, `<tier title>` and `<P>` are placeholders defined in Business rules and API.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Header | `link "Dotgain"` | DOTGAIN wordmark, goes home |
| Header | `link "Campaigns"`, `link "My pledges"`, `link "Studio"` | Same text |
| Home | `heading` level 1 `"PRINT IT IF THEY BACK IT"` | Shown on two lines, `PRINT IT IF` / `THEY BACK IT` |
| Home | `link "Start a campaign"` | Drawn as the stadium button |
| Home | `list "Live campaigns"` | One `listitem` per campaign, holding `link "<title>"` and `img "Plate Fill: <P>%"` |
| Any page | `region "Service notice"` | The outage banners from Feedback states |
| Any page | `status "Loading"` | `Loading`, while data is fetched |
| Campaign | `heading` level 1 `"<title>"` | Title |
| Campaign | `img "Plate Fill: <P>% of the minimum run"` | The gauge; its dots carry the attributes in Motion and effects |
| Campaign | text `Pledged so far` followed by the total | `£<total>` |
| Campaign | `timer "Time left"` | Countdown in the Business rules format |
| Campaign | `region "Pledge"` | The pledge stage |
| Campaign | `radiogroup "Reward tier"` with one `radio "<tier title>"` per tier | A sold-out radio is disabled and shows `Gone` |
| Campaign | `combobox "Shipping country"` | Country names from Business rules |
| Campaign | `spinbutton "Add-on (£)"` | Pounds and pence, default `0.00` |
| Campaign | `status "Pledge preview"` (polite) | The preview lines and sentence from Feedback states |
| Campaign | `button "Review pledge"` | Opens the confirm dialog |
| Campaign | `dialog "Confirm pledge"` | Summary; `textbox "Name"` and `textbox "Email"` only when the browser holds no key; `textbox "Card number"`; `button "Confirm pledge"`; `button "Back"` |
| Campaign | `status "Pledge result"` (polite) | The pledge, change and cancel announcements |
| Campaign, own pledge | `button "Change pledge"`, `dialog "Confirm change"` with `button "Confirm change"` and `button "Back"` | Shown when the backer has a held pledge here |
| Campaign, own pledge | `button "Cancel pledge"`, `dialog "Cancel pledge"` with `button "Yes, release my card"` and `button "Keep pledge"` | Same |
| Campaign, closed | `heading` level 2 | The closed heading from Feedback states, replacing the pledge stage |
| Campaign | `list "Reward tiers"`, with `button "Open <tier title>"` per tier (expands, carries expanded state) | `<remaining> of <quantity> left`, `Open edition`, or `Gone` |
| Studio | `heading` level 1 `"Studio"`, `button "New campaign"`, `list "Your campaigns"` | |
| Studio | `dialog "Your details"` with `textbox "Name"`, `textbox "Email"`, `button "Continue"`, `textbox "Key"`, `button "Use key"`, then `button "Done"` | After Continue it shows `Your Dotgain key:` followed by the key |
| Editor | `textbox "Title"`, `textbox "Story"`, `textbox "Goal (£)"`, `spinbutton "Minimum run (copies)"`, `combobox "Ships from"`, `combobox "Time zone"`, `textbox "Deadline"`, `button "Save draft"` | Deadline is a local date and time |
| Editor | `button "Add break point"`; `group "Break point <n>"` with `spinbutton "Copies"` and `textbox "Amount (£)"` | `<n>` counts from 1 |
| Editor | `button "Add tier"`; `group "Tier <n>"` with `textbox "Tier title"`, `textbox "Description"`, `textbox "Price (£)"`, `spinbutton "Copies available"`, `textbox "Domestic shipping (£)"`, `textbox "Europe shipping (£)"`, `textbox "Rest of world shipping (£)"`, `button "Save tier"`, `button "Remove tier"` | Blank copies means an open edition |
| Editor | file inputs labelled `Cover art` and `Spread previews`; `list "Images"` with one row per image showing `Stored`, `Uploading` or `Not stored`, and `button "Remove image"` | |
| Editor | `button "Launch campaign"` | |
| Editor | `button "Cancel campaign"`, `dialog "Cancel campaign"` with `button "Yes, release every card"` and `button "Keep campaign"` | Live campaigns only |
| Editor | `status "Studio result"` (polite); on validation errors, `region "Check these fields"` holding one link per invalid field | |
| Editor | `table "Backers"` | Columns Backer, Email, Tier, Amount, State |
| Editor | `region "Settlement"` with `link "Download settlement sheet"` | Totals from API |
| My pledges | `heading` level 1 `"My pledges"`, `list "Pledges"` | Each row: state mark and word, `link "Download statement"` or the text `Statement being prepared`, `link "Fix payment"` when errored, `link "Manage pledge"` when held |
| Fix page | `heading` level 1 `"Fix your payment"`, `timer "Time left to fix"`, `textbox "Card number"`, `button "Update card"`, `status "Fix result"` (polite) | |

State words, always shown next to their mark: authorising `Holding`, authorised `Held`, captured `Charged`, errored `Needs fixing`, voided `Released`, dropped `Dropped`.

### Interactions (DP-11, DP-12, DP-22, DP-25, DP-26, DP-28, DP-42)

- **Choosing a pledge.** Tab enters the tier group on the checked radio, or on the first one when none is checked. The arrow keys move between tiers and select them, skipping disabled radios. Tab then reaches the country picker, then the add-on field, then "Review pledge". Each change of tier, country or add-on asks the server for a fresh quote and updates the "Pledge preview" region and the proof rings in place, within half a second of the last change, with no reload. Until a tier is chosen, "Review pledge" is disabled and no proof rings show.
- **Confirming.** "Review pledge" (Enter, Space, click or tap) opens "Confirm pledge" with focus on its first field: Name when no key is held, otherwise Card number. Tab moves through the fields, "Confirm pledge" and "Back", then wraps to the first field, and Shift+Tab from the first field wraps to "Back". Enter in the card field confirms. While waiting, "Confirm pledge" is disabled but keeps its visible text and accessible name `Confirm pledge`, and the pending copy from Feedback states appears in "Pledge result". "Confirm change" behaves the same way while a change is pending. When the card is declined or a field is wrong, the dialog stays open with focus on the card field or the first wrong field. On success the dialog closes, the ink sequence runs, the stage switches to the held pledge, and focus lands on "Change pledge". When the tier sold out, the payment service is unavailable or pledging has closed, the dialog closes and focus returns to "Review pledge".
- **Changing and cancelling.** "Change pledge" makes the tier, country and add-on controls editable again, pre-filled with the pledge's values, and "Review pledge" opens "Confirm change", which has no card field. "Cancel pledge" opens "Cancel pledge". "Keep pledge" closes it, and "Yes, release my card" sends the cancellation.
- **Tiers.** "Open <tier title>" expands the tier in place to show its description, its shipping table and the full uncropped cover. Pressing it again collapses the tier.
- **Studio.** "New campaign" and the hero's "Start a campaign" open "Your details" when the browser holds no key. "Continue" creates the person, shows the key once, and "Done" goes on to the editor. Pasting a key into "Key" and pressing "Use key" adopts an existing identity after the server confirms it. Choosing files under "Cover art" or "Spread previews" uploads each image at once and shows its row as `Uploading`, then `Stored` or `Not stored`.
- **Editor fields.** "Time zone" offers every IANA zone name the server accepts, and each option is labelled with the name itself (for example `Europe/London`). "Ships from" offers the country names from Business rules. "Deadline" takes the local date and time typed as `YYYY-MM-DD HH:MM` in 24-hour time (for example `2026-12-01 20:00`), which is sent as `deadline_local`. Every field ending in `(£)` takes pounds in the format given under Money in Business rules.
- **Touch.** Every control is reachable and works by tap alone. A whole tier row is the tap target for its radio. No action needs hover, a long press or a drag.
- **My pledges and fix page.** "Download statement" saves the PDF for that pledge. "Fix payment" opens that pledge's fix page. "Manage pledge" opens the pledge's campaign page with focus on "Change pledge", where changing and cancelling work as described above. On the fix page, Enter in the card field submits. While waiting, "Update card" is disabled but keeps its visible text and accessible name `Update card`, and the pending copy appears in "Fix result".

### Visual design (DP-56, DP-57)

The direction is one motif: the halftone dot, the circle a printing screen is made of, used at every scale.

- **Type.** Jost for display and body alike. Headlines are uppercase and bold. Each heading step is about a third larger than the one below it. Amounts, percentages and the countdown are set large in even-width figures, so digits do not shift as they change.
- **Colour.** The ground is a cool near-white paper with a faint green cast. Raised areas (the pledge stage, tables) sit on a slightly deeper pale grey-green surface. Every word, dot, rule and button is one deep printer's teal, used both as ink and as the accent. Secondary text is a lighter but still dark teal. Text placed on teal fills is the paper colour. No black or grey ink appears anywhere. All text and controls meet WCAG 2.2 AA contrast.
- **Hero.** A flat teal disc about 1.2 times the window height across enters from the right. Its centre sits near three quarters of the way across the screen and a little below the middle, and the disc is cropped at the top, right and bottom. Its left edge breaks into a hex halftone ramp of shrinking dots that fades from solid tone into paper. On the bare paper, starting near the left edge, sits the headline from the controls table in very large bold uppercase Jost. Below it comes one sentence at a comfortable reading size: `All-or-nothing pledges for comics, zines and art books. No card is charged unless the print run is funded.` Below that sits the single stadium-ended "Start a campaign" button. On phones the disc moves to the bottom, about 1.3 times the screen width across, with its top a little below the middle of the screen, so the headline, sentence and button sit above it on paper.
- **Working screens.** Circles appear at three scales. Plate Fill is 280 to 420 pixels across on campaign pages and 48 pixels in lists. Bullets are small solid dots. Covers sit in circular masks, small in lists and up to 360 pixels on detail pages. Rectangles (tables, forms, panels, the pledge stage) have square corners. Only buttons and status chips have fully round ends. No other corner rounding exists anywhere. Pledge state marks are: a filled dot for captured, a ring for authorised, a half-filled dot for errored, a crossed ring for voided and dropped, and a dotted ring for authorising. Each always carries its word. One full-width inverted teal band of paper-coloured dots divides each campaign's story from its tiers. Outage and error banners are full-width teal bands with paper text, and they are the only other filled bands. Empty states show one large outline dot above their sentence. Density is comfortable: generous spacing, one idea per row.
- **Covers.** Covers are cropped to circles in lists and in the campaign lead. The full uncropped cover appears inside an opened tier and on the statement PDF.
- **Touch targets.** Every interactive control is at least 44 by 44 pixels.

### Motion and effects (DP-29, DP-52, DP-53, DP-55)

**Plate Fill.** The gauge is a disc of 217 dots in a hex screen: a centre dot (ring 0) and rings 1 to 8 around it, with ring k holding 6k dots. Its funded fraction is f = total / goal, using the campaign total from API. Each dot in ring k has coverage c = clamp(9f − k, 0, 1), and its diameter is pitch × 1.155 × √c, where pitch is the distance between neighbouring dot centres. At f ≥ 1 neighbouring dots merge into a solid disc. Each stretch break point adds one ring outside ring 8 (ring 9 for the first, 10 for the second, 11 for the third), with 6k dots each. A stretch ring's coverage is clamp((total − previous) / (break amount − previous), 0, 1), where previous is the goal for the first break point and the previous break point's amount after that. Every dot element carries `data-ring` (its ring number) and `data-coverage` (its current coverage to three decimals, for example `0.500`). On first load the dots draw straight at their coverage.

**Proof layer.** While a backer has a quote, every dot whose projected coverage is higher than its current coverage also carries `data-proof-coverage`, its projected coverage to three decimals. The projection uses the quote's projected total. Such a dot is drawn as an outline circle at the projected size, never filled. Proof outlines appear or move in under a fifth of a second. When the quote is cleared, every `data-proof-coverage` is removed.

**Ink sequence after a confirmed hold.** The proof outlines fill solid ring by ring from the centre out. Each ring starts about four hundredths of a second after the ring inside it, and each ring's ink takes about half a second. Each dot's `data-coverage` takes its new value when its ring's ink starts. The whole fill finishes within one second of the confirmation. Over the same half second the "Pledged so far" figure counts from the old total to the new one. After the count ends, the result is announced in "Pledge result". The motion starts fast and settles gently. A decline, a sold-out answer, an outage or a closed answer clears the proof outlines with no change to any `data-coverage` or to the total. When the 30-second refresh brings a new total, the gauge inks the same way without an announcement.

**Other motion.** Images reveal through a circular iris that opens from the centre in about a third of a second. Loading shows outline dots inking ring by ring from the centre, repeating until the data arrives. Banners slide down from the top in under a quarter of a second. On hover, a button's fill swaps to paper with teal text and a teal edge in under a fifth of a second. On press, a button shrinks slightly. Keyboard focus shows a clear teal ring drawn just outside the control. No other looping or decorative motion exists, and nothing is linked to scrolling.

**Reduced motion.** When the device asks for reduced motion: the dots jump straight to their final coverage and every `data-coverage` updates at once on confirmation; the total shows its final figure with no count; the announcement follows immediately with the same copy; proof outlines still appear, with the same attributes and the same preview sentence; images appear without the iris; banners appear in place; and the loading dots show one still ring with the word `Loading`.

### Feedback states (DP-12, DP-13, DP-22, DP-34, DP-47, DP-49, DP-55)

Every async action shows its pending state, success, field errors and outage as described below, and announces each in the named polite live region. `<amount>`, `<total>` and the other money placeholders are pounds and pence formatted as described in Business rules.

**Dialogs and focus.** Every dialog keeps Tab and Shift+Tab inside it, wrapping at both ends. Escape closes it. Focus then returns to the control that opened it, except where Interactions names the control that replaces the opener. Every action in this brief works from the keyboard alone and by touch alone.

**Pledge preview** (`status "Pledge preview"`), updated on each quote:
- `Reward: £<reward>`
- `Shipping (<zone name>): £<shipping>`, where the zone name is `Domestic`, `Europe` or `Rest of world`
- `Add-on: £<add_on>`
- `Pledge total: £<amount>`
- `Your pledge would bring this to <N>%`, where `<N>` is the quote's `projected_percent`

**Pledge result** (`status "Pledge result"`):

| Outcome | Copy |
|---|---|
| Pending (on Confirm) | `Asking the payment service to hold £<amount>.` |
| Authorised | `Pledge authorised: £<amount> held on your card. You are charged only if the run is funded.` |
| Changed | `Pledge changed: £<amount> held on your card. The earlier hold was released.` |
| Cancelled | `Pledge cancelled. The hold on your card was released.` |
| Declined | `Card declined. No hold was placed. Try another card.` |
| Sold out | `That tier just sold out. No hold was placed.` |
| Would unfund | `This change would take a funded run below its minimum in the final 24 hours, so it cannot be made.` |
| Closed | `Pledging has closed for this campaign.` |
| Payment service down | `Payment service unavailable. No hold was placed. Try again in a few minutes.` |

When cancelling or changing fails because the payment service is down, the result instead reads `Payment service unavailable. Your pledge is unchanged.` Field errors show under their field: `Use one of the test cards.`, `Enter your name.`, `Enter an email address.` and `Enter an add-on from 0.00 to 500.00.`

**Fix result** (`status "Fix result"`): pending `Asking the payment service to hold £<amount>.`; success `Card updated. £<amount> is held and will be collected when the fix window closes.`; declined, as in the table above; closed `The fix window has closed.`; payment service down, as in the table above.

**Studio result** (`status "Studio result"`): `Saving draft.` then `Draft saved.`; `Tier saved.`; `Uploading <file name>.` then `Cover stored.` or `Image stored.`; launch `Campaign launched.`; launch blocked by images `Launch needs every image stored. Re-upload or remove the images marked Not stored.`; validation `Check the highlighted fields.`, with the "Check these fields" region linking to each field; cancel `Campaign cancelled. Every held card was released.`; storage down `Media storage is unavailable. The image was not stored.` An editor money field that does not match the pounds format shows `Enter an amount in pounds, for example 2400.00.` under the field.

**Closed campaign headings** (level 2, replacing the pledge stage):
- funded, collecting or settled: `Funded. This run goes to press.`
- unfunded: `Not funded. No card was charged.`
- cancelled: `Cancelled by the creator. No card was charged.`

**Service notice banners** (`region "Service notice"`), one per down service, on every page (Studio, editor, campaign, My pledges, fix page) whenever the status endpoint reports that service down:
- payments: `Payments are unavailable. New pledges and changes are paused; held cards are safe.`
- email: `Email is delayed. Notices are queued and will be sent when the mail service is back.`
- storage: `Media storage is unavailable. Uploads and statements are paused.`
- documents: `Statements are delayed. They will appear once they are rendered.`

**Empty states:**
- Home list: `No live campaigns right now.`
- Studio: `No campaigns yet. Start one when your printer quotes a minimum run.`
- My pledges: `No pledges yet. Back a run and it will show here.`
- Backers table: `No backers yet.`

**Not found:** heading level 1 `This page did not go to press.`

Every announcement uses straight apostrophes and the exact characters above.

## Backend

### API (DP-01, DP-02, DP-04, DP-05, DP-07, DP-08, DP-09, DP-14, DP-18, DP-20, DP-23, DP-24, DP-35, DP-40, DP-44, DP-45, DP-46, DP-47)

All bodies are JSON (`application/json; charset=utf-8`) except image uploads and PDF downloads. All money is integer pence. Times are ISO 8601 UTC strings ending in `Z`. Ids are opaque strings.

**Authentication.** Personal routes need `Authorization: Bearer <key>`. A missing or unknown key answers `401 {"error":"unauthenticated"}`. Public routes accept an optional key.

**Error shape.** Every error is `{"error":"<code>"}`. A 422 adds `"fields":{"<request field>":"<message>"}`, where messages are free text unless Feedback states prints them.

**Error precedence** (one rule for the whole API): body limits and malformed JSON (`413`, `415`, `400 {"error":"bad_json"}`), then `401`, then idempotency (a stored replay is returned, or the `409` conflict or in-progress answer), then `404 {"error":"not_found"}` for any unknown resource or one the caller may not see (including ids inside request bodies, such as a tier of another campaign), then `403`, then state conflicts (`409`; when several apply to one request, the first one in that route's list below wins), then validation (`422`), and finally provider answers (`402`, `503`). Another person's resource always answers 404, never 403 or 422.

**People**
- `POST /api/people` with `{"name": string 1–80 chars, "email": valid address up to 254 chars}` → `201 {"id","name","email","key"}`. The key is at least 32 characters. Only two responses ever contain a key: this one, and the `201` of a pledge creation that creates its person (below). An idempotent replay of that pledge leaves `key` out, so no key is ever returned twice.
- `GET /api/me` (personal) → `200 {"id","name","email"}`.

**Campaign object:** `{"id","title","story","status","pledging_open","creator":{"id","name"},"goal","min_run_copies","stretch":[{"copies","amount","reached"}],"ships_from","time_zone","deadline_local","deadline_utc","seconds_left","total","captured_total","backer_count","percent","media":[{"id","kind","status","content_type","bytes"}],"tiers":[tier]}`. `status` is one of `draft`, `live`, `funded`, `collecting`, `settled`, `unfunded`, `cancelled`. `deadline_local` is `YYYY-MM-DDTHH:MM:SS`. `seconds_left` is a whole number, 0 once pledging is closed, and `null` for drafts. `percent` is defined in Business rules.

**Tier object:** `{"id","title","description","price","quantity","claimed","remaining","shipping":{"domestic","europe","rest_of_world"}}`. For open editions, `quantity` and `remaining` are `null`.

**Campaigns**
- `GET /api/campaigns` (public) → `200 [{"id","title","status","total","goal","percent","pledging_open","cover_media_id"}]`. Live campaigns come first, soonest deadline first, followed by closed campaigns, latest deadline first. Drafts never appear.
- `GET /api/me/campaigns` (personal) → `200 [the same row shape]`, the caller's own campaigns in every status, newest first.
- `POST /api/campaigns` (personal) with `{"title","story","goal","min_run_copies","stretch","ships_from","time_zone","deadline_local"}` → `201 campaign` in status `draft`. Validation (422, keyed by field):
  - `title`: 1–120 chars.
  - `story`: 0–20,000 chars.
  - `goal`: integer 10,000 to 10,000,000 inclusive.
  - `min_run_copies`: integer 10 to 100,000 inclusive.
  - `stretch`: 0 to 3 entries, each with `copies` greater than the previous entry's (the first greater than `min_run_copies`) and `amount` greater than the previous entry's (the first greater than `goal`).
  - `ships_from`: a code from the country table.
  - `time_zone`: an IANA zone name.
  - `deadline_local`: `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`, existing in that zone.
- `GET /api/campaigns/{id}` (public) → `200 campaign`. A draft is returned only to its creator.
- `PATCH /api/campaigns/{id}` (creator) with any subset of the create fields → `200 campaign`, under the same validation. A non-draft answers `409 {"error":"campaign_not_draft"}`.
- `POST /api/campaigns/{id}/tiers` (creator) with `{"title": 1–80 chars, "description": 0–1,000 chars, "price": integer 100 to 1,000,000, "quantity": null or integer 1 to 100,000, "shipping": {"domestic","europe","rest_of_world"}, each an integer 0 to 10,000}` → `201 tier`. A ninth tier answers `422` with field `tiers`. `PATCH /api/tiers/{id}` → `200 tier`, and `DELETE /api/tiers/{id}` → `204`. All three answer `409 {"error":"campaign_not_draft"}` once the campaign is not a draft.
- `POST /api/campaigns/{id}/media?kind=cover|spread` (creator). The raw image bytes are the body, with `Content-Type` `image/png`, `image/jpeg` or `image/webp`, and an optional `X-Filename` header. Success is `201 {"id","kind","status":"stored","content_type","bytes"}`. A new cover replaces the previous one and deletes its object. A seventh spread answers `422` with field `media`, an empty body answers `422` with field `media`, and another type answers `415 {"error":"unsupported_media_type"}`. Storage down answers `503 {"error":"storage_unavailable"}` and leaves a media row with status `failed`. A non-draft answers `409 {"error":"campaign_not_draft"}`.
- `DELETE /api/media/{id}` (creator, draft only) → `204`.
- `GET /api/media/{id}` (public for a non-draft campaign, creator only for a draft) → `200` with the image bytes and their content type. A media row that is not stored answers 404.
- `POST /api/campaigns/{id}/launch` (creator) → `200 campaign` in status `live`. Its errors:
  - `409 {"error":"campaign_not_draft"}`.
  - `409 {"error":"media_not_stored"}` when any media row is not stored.
  - `422` with field `cover` when there is no cover.
  - `422` with field `tiers` when there is no tier.
  - `422` with field `deadline_local` when the deadline is outside the length rule.
- `POST /api/campaigns/{id}/cancel` (creator) → `200 campaign` in status `cancelled`. Its errors, in this order:
  - `409 {"error":"not_live"}` whenever the status is anything other than `live`: a draft, an already cancelled campaign, or any closed status.
  - `409 {"error":"campaign_closed"}` for a campaign still `live` from the deadline instant, before close-out has run.
  - `503 {"error":"payment_unavailable"}` with Kill Bill unreachable, leaving the campaign live.
- `GET /api/campaigns/{id}/pledges` (creator) → `200 [pledge with "backer":{"id","name","email"}]`.
- `GET /api/campaigns/{id}/notices` (creator) → `200 [{"kind","to","subject","status":"queued|sent","created_at","sent_at"}]`, every notice for the campaign and its backers.

**Quotes and pledges**
- `POST /api/campaigns/{id}/quote` (public, optional key) with `{"tier_id","country","add_on"}` → `200 {"tier_id","zone","reward","shipping","add_on","amount","projected_total","projected_percent"}`. A closed campaign answers `409 {"error":"campaign_closed"}`, and `422` covers `country` and `add_on`.
- **Pledge object:** `{"id","campaign_id","tier_id","country","zone","reward","shipping","add_on","amount","state","card_last4","replaces","created_at","history":[{"state","at"}],"statement":"none|pending|ready","fees":null|{"platform_fee","processing_fee","to_creator"},"fix_deadline_utc","fix_seconds_left","card_fixed"}`. `zone` is `domestic`, `europe` or `rest_of_world`. The fix fields are `null` unless the pledge is errored or was errored.
- `POST /api/campaigns/{id}/pledges`. It is personal, or carries `"name"` and `"email"` to create the person in the same call; in that case the `201` response adds `"key"`, and an idempotent replay of it leaves `key` out. It needs an `Idempotency-Key` header of 1–64 visible characters (missing answers `422` with field `idempotency_key`). Body: `{"tier_id","country","add_on": integer 0 to 50,000 inclusive,"card_number"}` → `201 {pledge, "campaign_total","campaign_percent"}` with state `authorised`. Errors:
  - `403 {"error":"own_campaign"}`.
  - `409 {"error":"campaign_closed"}`.
  - `409 {"error":"already_pledged"}`.
  - `409 {"error":"tier_sold_out"}`.
  - `422` for `country`, `add_on` and `card_number`.
  - `402 {"error":"card_declined"}`.
  - `503 {"error":"payment_unavailable"}`.
- `GET /api/me/pledges` (personal) → `200 [pledge with "campaign":{"id","title","status","cover_media_id"}]`, newest first, including voided and dropped pledges.
- `GET /api/pledges/{id}` (the pledge's backer) → `200 pledge`.
- `PATCH /api/pledges/{id}` (backer, `Idempotency-Key` required) with any subset of `{"tier_id","country","add_on"}` → `201 {new pledge with "replaces": old id, "campaign_total","campaign_percent"}`. Errors:
  - `409 {"error":"campaign_closed"}`.
  - `409 {"error":"pledge_not_active"}`.
  - `409 {"error":"tier_sold_out"}`.
  - `409 {"error":"would_unfund"}`.
  - `422` with field `pledge` when nothing differs.
  - `402 {"error":"card_declined"}`.
  - `503 {"error":"payment_unavailable"}`.
- `POST /api/pledges/{id}/cancel` (backer) → `200 pledge` in state `voided`. Errors, in this order: `409 {"error":"campaign_closed"}`, `409 {"error":"pledge_not_active"}`, `409 {"error":"would_unfund"}` and `503 {"error":"payment_unavailable"}`.

**Fixing**
- `GET /api/fix/{code}` (the code is the credential) → `200 {"pledge_id","campaign_title","amount","state","fix_deadline_utc","fix_seconds_left","card_fixed"}`.
- `POST /api/fix/{code}` with `{"card_number"}` → `200` in the same shape, with `card_fixed: true`. Errors: `409 {"error":"fix_window_closed"}` when the window has ended or the pledge is no longer errored, `422` for `card_number`, `402 {"error":"card_declined"}` and `503 {"error":"payment_unavailable"}`.

**Documents**
- `GET /api/pledges/{id}/statement.pdf` (backer) → `200 application/pdf`. Answers `409 {"error":"not_ready"}` until the statement is stored.
- `GET /api/campaigns/{id}/settlement` (creator) → `200 {"campaign_id","status","captured_count","dropped_count","errored_count","gross","platform_fee","processing_fee","net","lines":[{"pledge_id","amount","platform_fee","processing_fee","to_creator"}],"pdf":"none|pending|ready"}`. Answers `409 {"error":"not_funded"}` unless the status is funded, collecting or settled.
- `GET /api/campaigns/{id}/settlement.pdf` (creator) → `200 application/pdf`. Answers `409 {"error":"not_ready"}` until the sheet is stored.

**Status and health**
- `GET /api/status` → `200 {"payments":"up|down","email":"up|down","storage":"up|down","documents":"up|down"}`.
- `GET /api/health` → `200 {"status":"ok"}`.

### Business rules (DP-03, DP-08, DP-14, DP-15, DP-16, DP-17, DP-18, DP-20, DP-21, DP-23, DP-24, DP-30, DP-31, DP-32, DP-33, DP-35, DP-36, DP-37, DP-39, DP-40, DP-41, DP-43, DP-45)

**Money.** All amounts are pounds sterling, stored and computed as integer pence. On screen and in emails they show as `£` followed by pounds with comma thousands separators, a point and two pence digits (for example `£1,234.05`). Pounds typed into the add-on field or any editor field ending in `(£)` are digits with optional comma thousands separators. They may be followed by a point and one or two pence digits, and carry no `£` sign. For example, `2400`, `2,400`, `2400.5` and `2,400.00` are all accepted, and any other form is a field error. Accepted input converts to pence exactly.

`percent` = floor(100 × total / goal). A quote's `projected_total` = total + quoted amount when the caller holds no authorised pledge on the campaign. When the caller holds one, `projected_total` = total − that pledge's amount + quoted amount. `projected_percent` = floor(100 × projected_total / goal).

**Countries and zones.** Accepted codes, with the names shown in the pickers (sorted by name):
- European: AT Austria, BE Belgium, CH Switzerland, DE Germany, DK Denmark, ES Spain, FI Finland, FR France, GB United Kingdom, IE Ireland, IT Italy, NL Netherlands, NO Norway, PL Poland, PT Portugal, SE Sweden.
- Rest of world: AU Australia, BR Brazil, CA Canada, JP Japan, MX Mexico, NZ New Zealand, SG Singapore, US United States.

A backer's zone is `domestic` when their country equals the campaign's `ships_from`, otherwise `europe` when the country is in the European list, otherwise `rest_of_world`. Any other code answers 422 on `country` (and on `ships_from`).

**Pledge amount.** amount = tier price + the tier's shipping for the zone + add-on, all in pence, fixed when the pledge is made. Later tier edits are impossible, because tiers lock at launch.

**Test cards.** The payment setup is a test environment. Kill Bill records the holds, charges and releases, and these invented test numbers stand in for the card network (spaces are ignored):

| Card number | Behaviour |
|---|---|
| `4242 4242 4242 4242` | Authorises and captures |
| `4000 0000 0000 0002` | Declined at authorisation |
| `4000 0000 0000 0341` | Authorises, then fails every capture |

Any other number answers 422 on `card_number` with the field copy from Feedback states. Only the last four digits are stored or returned.

**Deadline and length.** The creator picks the deadline as a wall-clock time in the campaign's time zone. The server converts it to one UTC instant, `deadline_utc`. A local time that the zone skips (a clock-change gap) answers 422 on `deadline_local`. A local time that occurs twice takes the earlier of the two instants. At launch the deadline must be at least `MIN_CAMPAIGN_SECONDS` (default 86,400 seconds, one day) and at most 60 days (5,184,000 seconds) after the launch instant, both limits inclusive.

**Server time decides.** The device clock may be wrong. Pledging is open while the server's clock is before `deadline_utc`. From that instant, with the instant itself included, every pledge, change, cancellation and quote answers `409 {"error":"campaign_closed"}` (creator cancellation follows its own order in API), `pledging_open` is `false`, and `seconds_left` is 0. This holds even before close-out has run. Close-out runs within 5 seconds of the deadline.

The browser shows open or closed only from `pledging_open` and `status`. The countdown starts from the last response's `seconds_left` and ticks down by time elapsed since that response, never from the device's date. When it reaches zero, the page fetches the campaign again and keeps the pledge stage until the server reports it closed. Campaign pages fetch the campaign again every 30 seconds and after each own action. My pledges and the fix page fetch again every 30 seconds.

Countdown format: `<D> days <HH>:<MM>:<SS>` when one day or more remains (`1 day` when D is 1), otherwise `<HH>:<MM>:<SS>`.

**Campaign states.**
- draft → live: launch, under the launch gate.
- live → funded: close-out with total ≥ goal.
- live → unfunded: close-out with total < goal.
- live → cancelled: creator cancellation before the deadline.
- funded → collecting: once every authorised pledge has a capture result.
- collecting → settled: when no pledge remains errored. This happens straight away when none errored, otherwise after the last final attempt.

Every other transition is refused with the codes in API (`campaign_not_draft`, `not_live`, `campaign_closed`). A stretch break point is `reached` when the total is at or above its amount.

**Pledge states.**
- authorising: the claim was accepted.
- authorising → authorised: Kill Bill confirms a successful AUTHORIZE.
- A decline or Kill Bill failure while authorising removes the attempt entirely. No pledge remains, and its copy is released.
- authorised → voided: backer cancel, being replaced by a change, creator cancel, or unfunded close-out. This happens only after Kill Bill confirms the VOID; while Kill Bill is unreachable the pledge stays authorised, and close-out voids are retried every 10 seconds.
- authorised → captured, or authorised → errored: the funded close-out.
- errored → captured, or errored → dropped: the final attempt.

Cancel or change on a pledge that is not authorised answers `409 {"error":"pledge_not_active"}`. Every transition appends `{"state","at"}` to `history`.

**What counts.** `total` is the sum of amounts of pledges in authorised, captured or errored state; each of these had a Kill Bill-confirmed authorisation. Authorising, voided and dropped pledges never count. `captured_total` sums captured pledges, and `backer_count` counts pledges that count toward `total`.

**One pledge each.** A person may hold one pledge per campaign in authorising, authorised, captured or errored state. A second one answers `409 {"error":"already_pledged"}`, even when the two requests arrive at the same moment. The campaign's creator pledging answers `403 {"error":"own_campaign"}`.

**Limited copies.** A limited tier's `claimed` counts its pledges in authorising, authorised, captured and errored state, and `remaining` = quantity − claimed. A claim takes a copy before any Kill Bill call. When it would exceed the quantity, the answer is `409 {"error":"tier_sold_out"}`, and Kill Bill never sees a payment for that request. Of N simultaneous claims on the last copy, exactly one gets it. A declined or failed authorisation, a void while live, or a change away from the tier releases the copy for others. A change that keeps the same limited tier keeps the pledge's own copy. A dropped pledge's copy is released to nobody, because the campaign is closed.

**Changes.** A change claims any new limited copy, places a new AUTHORIZE for the new amount on the pledge's card, and only after it succeeds voids the old pledge's hold. The old pledge becomes `voided`, and the new pledge carries `replaces`. When the new hold is refused or fails, the original pledge, its copy and its hold are unchanged.

**Final window.** While a live campaign has at most `FINAL_WINDOW_SECONDS` (default 86,400) before its deadline, a change that lowers a pledge's amount, or a cancellation, is refused with `409 {"error":"would_unfund"}` when the campaign total is at or above the goal and the result would fall below it. Increases are always allowed. Reductions that keep the total at or above the goal are allowed, as are reductions on a campaign already under its goal. Checks and changes on one campaign's pledges are serialised, so two simultaneous reductions cannot together take a funded campaign below its goal.

**Idempotency.** Pledge creation and pledge changes require `Idempotency-Key`, scoped to the person (or, for a pledge that creates its person, to the email) and the route, and kept for 24 hours. A repeat with the same key and an equal body (same JSON values, key order ignored) returns the stored status and body, minus any `key` field, without contacting Kill Bill. The same key with a different body answers `409 {"error":"idempotency_conflict"}`. A repeat while the first request is still running answers `409 {"error":"idempotency_in_progress"}`. A 503 answer is not stored, so the same key may retry after an outage.

**Close-out, unfunded or cancelled.** Every authorised pledge gets a Kill Bill VOID and becomes `voided`. Nothing is captured. Each such backer is emailed.

**Close-out, funded.** For each authorised pledge the server requests a CAPTURE of the full amount. When Kill Bill confirms it, the pledge is `captured`, and in the same step a funded-and-charged notice and a pending statement are recorded. When the capture fails, the pledge is `errored`, nothing is recorded as charged, and its fix window opens. When Kill Bill is unreachable, the pledge stays authorised, the campaign stays `funded`, and the capture is retried every 10 seconds. A pledge is never captured without its notice and statement records, and never errored with a capture.

**Fix window.** The window runs from the deadline for `FIX_WINDOW_SECONDS` (default 604,800, seven days). A fix-payment notice goes out when the pledge errors and again every `FIX_NOTICE_SECONDS` (default 172,800, two days) after that, as long as the send time is strictly before the window's end. With the defaults that makes four notices. Each errored pledge gets a fix code: a random secret of at least 32 URL-safe characters that only opens that pledge's fix page. A fix places a new AUTHORIZE for the pledge amount on the new card. When it succeeds, `card_fixed` becomes true and any earlier fix hold is voided. When the window ends, within 5 seconds, the server makes one final attempt. It captures the latest fix hold when there is one, otherwise it retries capture of the original hold. On success the pledge is `captured`, with the same records as at close-out. On failure the pledge is `dropped`, its remaining holds are voided, and the backer is emailed.

**Fees.** For each captured pledge with amount `a` pence:
- platform_fee = round half up of a × 5 / 100
- processing_fee = (round half up of a × 3 / 100) + 20
- to_creator = a − platform_fee − processing_fee

The settlement sums captured pledges only: `gross` = Σ a, `platform_fee` = Σ platform fees, `processing_fee` = Σ processing fees, `net` = Σ to_creator. `net` always equals `gross − platform_fee − processing_fee` and the sum of every statement's to-creator line. For example, with the seed data at start, a Reading copy shipped domestically is 1,550 pence. Its platform fee is 78, its processing fee is 67, and 1,405 goes to the creator.

**Statements and settlement readiness.** A captured pledge's `statement` is `pending` until its PDF is rendered and the bucket confirms the object, then `ready`. Every other pledge has `none`. The settlement `pdf` becomes `pending` when the campaign is settled, and `ready` once its sheet is rendered and stored. The settlement-ready email follows. Pending renders retry every 10 seconds. With services up, a statement is ready within 30 seconds of capture.

**Launch gate.** Launch needs: a draft; no media row other than `stored`; exactly one stored cover; at least one tier; and a deadline inside the length rule. The answers for each failure are listed in API.

### Services (DP-07, DP-15, DP-19, DP-33, DP-36, DP-39, DP-41, DP-44, DP-45, DP-48, DP-49, DP-50)

**Kill Bill.** For each backer, keep one account with `externalKey` equal to the person id, currency `GBP`, and the person's name and email, created on their first pledge. Each card entry adds a payment method on that account using the `__EXTERNAL_PAYMENT__` plugin. Each pledge is one Kill Bill payment with `paymentExternalKey` equal to the pledge id. It holds:
- an AUTHORIZE for the pledge amount in pounds with two decimals, transaction external key `<pledge id>-auth`;
- a CAPTURE of the full amount at collection, `<pledge id>-capture`;
- a VOID on release, `<pledge id>-void`.

A fix is a separate payment, `<pledge id>-fix-<n>` with `n` counting from 1, holding its own AUTHORIZE and then CAPTURE or VOID. Kill Bill's confirmed transaction status is the source of truth:
- an authorised pledge has a successful AUTHORIZE;
- a captured pledge has a successful CAPTURE;
- an errored or dropped pledge has no successful CAPTURE;
- a voided pledge has a successful VOID;
- a declined attempt or a sold-out loser leaves no successful AUTHORIZE on the account.

When Kill Bill is unreachable, the answers are the `503 {"error":"payment_unavailable"}` responses in API, the payments banner, and the outage copy from Feedback states.

**Mail (SMTP to Mailpit).** Every message is sent From the value of `MAIL_FROM`, which is `Dotgain by Coldset Works <press@dotgain.example>`, to the person's email. `<title>` is the campaign title.

| Notice | When | To | Subject |
|---|---|---|---|
| Pledge receipt | Each confirmed authorisation, including changes | Backer | `Pledge held: <title>` |
| Pledge cancelled | Backer cancellation voided | Backer | `Pledge cancelled: <title>` |
| Funded and charged | Each successful capture, at close-out or final attempt | Backer | `Funded and charged: <title>` |
| Not funded | Unfunded close-out void | Backer | `Not funded, card released: <title>` |
| Campaign cancelled | Creator cancellation void | Backer | `Campaign cancelled: <title>` |
| Fix payment | Each fix notice time | Backer | `Fix your payment: <title>` |
| Dropped | Final attempt failed | Backer | `Pledge dropped: <title>` |
| Settlement ready | Settlement sheet stored | Creator | `Settlement ready: <title>` |

Bodies state the amount in the money format. The receipt adds `Your card is held, not charged.`, and every fix notice contains the link `<APP_PUBLIC_URL>/fix/<code>`. Every notice is recorded in the campaign's notice ledger, and each is sent exactly once, within 10 seconds of becoming due while mail is up. When SMTP is unreachable, the notice stays `queued` and is retried every 10 seconds, the email banner shows, and the triggering action still succeeds with its normal answer.

**MinIO.** All objects live in the bucket named by `S3_BUCKET`, and no object is public:
- campaign images: `campaigns/<campaign id>/media/<media id>.<png|jpg|webp>`
- statements: `statements/<pledge id>.pdf`
- settlement sheets: `settlements/<campaign id>.pdf`

An image's row becomes `stored` only after the upload succeeds and a follow-up read of the object's metadata confirms it, with the same byte length. When MinIO is unreachable, every upload answers `503 {"error":"storage_unavailable"}` and leaves its media row `failed`, shown as `Not stored` in the editor's image list, and the storage banner shows. Because such a draft cannot pass the launch gate, a storage outage is observed through refused uploads and `failed` media rows only.

**Gotenberg.** The server renders each statement and settlement sheet from its own HTML by posting an `index.html` file to `<GOTENBERG_URL>/forms/chromium/convert/html`, then stores the returned PDF bytes in MinIO.
- The statement's text contains: `Dotgain backer statement`; the campaign title; the backer name; `Pledge <pledge id>`; the tier title; the full uncropped cover; and the lines `Reward £<reward>`, `Shipping (<zone name>) £<shipping>`, `Add-on £<add_on>`, `Total charged £<amount>`, `Platform fee (5%) £<platform_fee>`, `Processing (3% + 20p) £<processing_fee>` and `To the creator £<to_creator>`.
- The settlement sheet's text contains: `Dotgain settlement sheet`; the campaign title; one row per captured pledge with its pledge id and four amounts; and `Gross £<gross>`, `Platform fees £<platform_fee>`, `Processing fees £<processing_fee>`, `Net to creator £<net>`, `Captured pledges <captured_count>` and `Dropped pledges <dropped_count>`.

When Gotenberg is unreachable, every captured pledge's `statement` stays `pending` and `GET /api/pledges/{id}/statement.pdf` answers the `409 {"error":"not_ready"}` from API. A settled campaign's settlement `pdf` stays `pending` and `GET /api/campaigns/{id}/settlement.pdf` answers the same 409. No settlement-ready email is sent, and the documents banner shows. Once Gotenberg is back, the pending renders complete on their 10-second retry.

**Status probes.** Each of the four dependencies is probed at least every 10 seconds, and any failed real call marks it down at once. `GET /api/status` reflects state no older than 10 seconds. Pages read it on load, every 15 seconds, and after any 503.

**Postgres** holds campaigns, tiers, media rows, people, pledges and their history, idempotency records, fix codes, and the notice and statement ledgers.

### Seed data (DP-05, DP-09, DP-21)

On first start, against an empty database, the app inserts the records below. Every person, campaign and business here is invented. Seeded covers are generated flat teal-on-paper PNG images that the app stores in the bucket at first start. When storage is unreachable, their rows stay `failed` and are stored once storage returns. No pledges are seeded, so every total starts at 0.

People:

| Name | Email | Key |
|---|---|---|
| Mara Quillfeather (creator) | `mara@quillfeather.example` | `dgk_mara_seed_4f1c0b7a9e2d4c68b3a1` |
| Ines Calloway (creator) | `ines@inkshelter.example` | `dgk_ines_seed_8a2e6d1f0c9b4e37a5d2` |
| Tobias Ferrante (backer) | `tobias@reader.example` | `dgk_tobias_seed_2b9c4e7a1d0f5e83c6` |
| Wren Adeyemi (backer) | `wren@reader.example` | `dgk_wren_seed_6e3a9c2b8d1f4a70e5b9` |

Campaigns:
- `saltmarsh-nocturnes`: live, by Mara.
  - Title `Saltmarsh Nocturnes`, goal 240,000, minimum run 300 copies.
  - Stretch break points: 500 copies at 340,000, then 1,000 copies at 560,000.
  - Ships from GB, time zone `Europe/London`, deadline 20:00 local on the date 30 days after first start.
  - Stored cover.
  - Tiers:
    - `saltmarsh-reading-copy` "Reading copy": 1,200, open edition, shipping 350 / 700 / 1,100.
    - `saltmarsh-signed-variant` "Signed variant cover": 2,500, quantity 2, shipping 350 / 700 / 1,100.
    - `saltmarsh-original-page` "Original page": 18,000, quantity 1, shipping 900 / 1,800 / 3,000.
- `fold-here`: live, by Ines.
  - Title `Fold Here`, goal 60,000, minimum run 100 copies.
  - Stretch break point: 250 copies at 120,000.
  - Ships from IE, time zone `Europe/Dublin`, deadline 20:00 local on the date 30 days after first start.
  - Stored cover.
  - Tiers:
    - `fold-here-zine` "Zine": 600, open edition, shipping 120 / 250 / 400.
    - `fold-here-zine-and-print` "Zine and risograph print": 1,500, quantity 25, shipping 200 / 450 / 750.
- `wet-ink-almanac`: draft, by Mara.
  - Title `Wet Ink Almanac`, goal 150,000, minimum run 200 copies.
  - Ships from GB, `Europe/London`, deadline 20:00 local on the date 21 days after first start.
  - No media. One tier, `wet-ink-almanac-copy` "Almanac": 1,800, open edition, shipping 400 / 800 / 1,200.

Shipping is listed as domestic / Europe / rest of world, in pence.

## Technical requirements

### Deployment (DP-51)

The runtime is Node.js 22 with npm, and the app is written in TypeScript. The app root `/app` holds `run.json` with string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` once the server is listening, whatever the state of Kill Bill, mail, storage and documents. The schema is applied idempotently on every start, and the seed is inserted only when absent. Several copies of the app may run side by side, each with its own database and bucket.

### Configuration and secrets (DP-58)

Read every value at start from the environment:
- `DATABASE_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `GOTENBERG_URL`
- `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`
- `MIN_CAMPAIGN_SECONDS`, `FINAL_WINDOW_SECONDS`, `FIX_WINDOW_SECONDS`, `FIX_NOTICE_SECONDS` (defaults in Business rules)

No credential or service URL is hard-coded, logged, or sent to the browser in any page, script or response.

### Server boundary (DP-59)

The browser talks only to the app's own origin. The server sends no cross-origin permission headers, and the browser never calls Kill Bill, MinIO, Gotenberg or SMTP. JSON bodies are limited to 65,536 bytes and image uploads to 5,000,000 bytes, each limit itself allowed. A larger body answers `413 {"error":"too_large"}`, and a JSON route given another content type answers `415 {"error":"unsupported_media_type"}`.

The server never serves source files, `run.json`, package manifests, lockfiles, installed dependency folders, environment files or credentials. Any such path, any traversal attempt and any unknown `/api` path answers `404 {"error":"not_found"}`, and any unknown page path shows the not-found page.

When Postgres is unreachable at boot, the server retries every 2 seconds and starts listening once connected. When Kill Bill, SMTP, MinIO or Gotenberg is unreachable at boot, the server starts normally and reports that service down.

### Browser support and performance (DP-27, DP-28)

Support current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, with touch input on the phone size. A campaign page is usable, with the pledge controls working, within three seconds of navigation. Quote previews update within half a second of the last input.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string fields `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package, meaning the production dependency tree from `npm ls --omit=dev --all --json`, with its version and licence, plus the Jost font and its licence.
- IF-03: Every shipped package (the same production tree) and every bundled font is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1.
- IF-04: The app stores data only in the provided Postgres database and MinIO bucket: no SQLite, embedded databases, extra caches or files used as a datastore.
- IF-05: The provided service definitions and their environment values are left unmodified.
- IF-06: Fonts and scripts are served from the app itself, and the running app calls no internet host.
- IF-07: Application source, server and browser alike, is written in TypeScript; plain JavaScript appears only as build output or tool configuration.

## Engineering standards

- The TypeScript compiles under strict mode, with no `any` in domain code.
- Names in the code match this brief's domain terms: campaign, tier, pledge, hold, capture, void, errored, dropped, fix window, statement, settlement, Plate Fill.
- Money is integer pence everywhere. Floating-point arithmetic never touches an amount, and the fee rule and the pledge amount rule are each computed in exactly one place.
- Each campaign and pledge state transition, and its rejection, is decided in exactly one place in the source.
- No interface, base class or wrapper exists with only one implementation.
- No dead, commented-out or unreachable code remains, and there are no defensive checks for states the rules make impossible.
- Every error response is built through one consistent error shape, and the frontend reads that shape alone.
- No feature, route, screen or setting exists beyond this brief.
