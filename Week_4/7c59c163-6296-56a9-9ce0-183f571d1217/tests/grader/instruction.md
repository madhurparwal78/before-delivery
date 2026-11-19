# Plumtide Markets — Plumtide Venue

Plumtide Venue is a hosted exchange for small, members-only trading venues: private prediction-market clubs, collector-asset exchanges and invite-only commodity pools. Each venue runs spot, margin and yes/no event contracts on one shared order book. Members fund a house balance by card, builders pay for API plans, and every member gets a monthly statement. One deployment serves many venues, and no venue ever sees another's data. The product uses these services: Keycloak for sign-in, Kill Bill for card payments, builder subscriptions, invoices, refunds and dunning, Postgres for the ledger, books and all product records, Valkey for API rate limits and live book fan-out, Svix for signed builder webhooks, MinIO for statements and ID documents, and Mailpit as the outgoing mail sink. Out of scope: real card networks (Kill Bill's external payment method stands in for the card processor), KYC verification logic beyond storing and showing documents, market data from outside the venue, mobile apps, any datastore or service not listed above, and any sign-in other than Keycloak.

## Problem and users

A small venue is usually one founder and one or two staff. Today they stitch together a hosted matching script, a spreadsheet ledger, a card checkout for deposits, a separate billing tool for builder API plans, and hand-made PDF statements. That costs them in four ways. Margin and event orders sit in separate books, so matching YES and NO interest never meets. A builder whose card fails keeps a high API rate for weeks, because nothing connects dunning to the rate limiter. Statements and webhooks leak between venues, which means refunds and apologies. And every month, drift between deposits, fills and refunds costs a night of reconciliation. Large exchanges now market a single shared book with margin on event contracts. Small venues want the same shape without an institutional clearing stack. Every leaked row or drifted cent comes back to the founder as a refund or a lost member.

Users:

- **Trader** (daily): funds a house balance by card; places and cancels spot, margin and event orders on the venue's shared book; watches fills land; reads monthly statements.
- **Builder** (daily): subscribes to a builder plan (Sandbox, Builder, Desk); mints API keys; trades over the API within the plan's rate limit; receives signed fill, liquidation and settlement webhooks. A builder can also do everything a trader does.
- **Market admin** (weekly): lists, opens, halts and resumes markets; resolves event contracts; runs liquidation checks; refunds deposits; reviews members' ID documents. All of this happens inside one venue.
- **Org owner** (weekly): owns one venue. Invites members and admins, sets the fee schedule, reads venue totals, exports fills, generates statements, and sees each builder's billing and dunning state.
- **Founder operator** (occasional): runs the Plumtide platform across all venues. Onboards new venues and watches provider health, and never reads any venue's member data.

## Journeys

1. **Fund and trade an event.** Start: Ana, a seeded Harbor Lantern Club trader, is signed out. She signs in, opens Balance and deposits $50.00 by card. The deposit confirms and her available balance rises. She opens the RAIN event market and picks the best ask in the Book levels list, which prefills a YES buy at 37¢ for that level's full resting quantity. She lowers Quantity to 120, then reviews and confirms. She sees the fill announced and her available balance drop by the exact cost and fee. End: her order shows filled, and the 37¢ ask ring has shrunk to 80 resting and is still the best ask.
2. **Trade the shared pair book.** Start: Bo is signed in on the LANT market. He places a margin buy that rests beside spot orders at the same price. Another member's spot sell fills it, and his balance, the book levels and the rings update without a reload while his half-typed ticket stays. Later a trade far below his entry triggers the maintenance check. End: his position shows liquidated and the liquidation message appears.
3. **Build a bot.** Start: Ines, a seeded builder, is signed in on the Builder screen. She upgrades to Desk, mints an API key, saves a webhook endpoint, and places an order over the API twice with the same Idempotency-Key. End: one order exists, her endpoint has received one signed `order.filled` event per fill, and the delivery attempts table lists them.
4. **A plan payment fails.** Start: a builder on the Builder plan. Kill Bill leaves a renewal unpaid and the Builder screen shows Payment failed. A second renewal goes unpaid, so the screen shows Downgraded and their keys drop to the Sandbox rate. The builder presses Pay outstanding balance. End: once Kill Bill clears the account, the plan shows Active again and the keys get the Builder rate back. Each step arrives by email.
5. **Run the venue's markets.** Start: Teo, the Harbor market admin, opens Market admin. He lists a new event whose close instant is a few minutes ahead and opens trading on it. Ana buys YES and Bo buys NO on its book. When its close instant passes, the server closes it. He resolves it YES and refunds part of a member's deposit. End: the new event shows Settled YES, Ana sees her payout in her balance, and the refunded member has a refund email.
6. **Own the venue.** Start: Mara, the Harbor org owner, opens Venue. She reads the venue totals, finds a member in the picker, invites a new market admin, raises the taker fee, exports October's fills as CSV and generates October statements. End: the invitee has an invite email, and each member finds a statement on Statements with a "statement ready" email.
7. **Run the platform.** Start: the founder operator signs in. They read provider health and onboard a new venue with an owner email. End: the venue appears in the platform list, the owner has an invite email, and the founder still cannot open any member, order or statement.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Keycloak sign-in** A person signs in through the deployment's Keycloak realm from the Sign in link and lands on their venue home, signed in, in the same browser that started the sign-in.
- **DP-02 — Sign-in stays in its browser** Each sign-in attempt carries its own fresh state and proof key, and a callback with a missing, reused or foreign state shows the sign-in error page and creates no session.
- **DP-03 — Password sessions for scripts** `POST /api/session` exchanges a member's Keycloak username and password for the same session a browser sign-in gives, as specified in API.
- **DP-04 — Role checks on the server** Every role-restricted endpoint, including resolve-event, run-liquidations and refund-deposit, answers 403 to a signed-in caller of the same venue who lacks the role, however the request is built.
- **DP-05 — Not found for other members' records** Another member's order, fill, deposit or statement, and any id from another venue, answers exactly like an id that does not exist.
- **DP-06 — Profile and ID documents** A member edits their display name and uploads an ID document that only their own venue's market admins can open, as qualified in Services.
- **DP-07 — Founder console without member data** The founder operator lists and onboards venues and reads provider health, and every venue route refuses them.
- **DP-08 — Card deposit journey** A trader funds their house balance by card from the Balance screen and sees the confirmed amount in their available balance and deposit list.
- **DP-09 — Balance rises only on Kill Bill success** A deposit credits the house balance only after Kill Bill records a successful PURCHASE on the member's own Kill Bill account, and a replayed deposit request never charges twice.
- **DP-10 — Deposit validation** A deposit outside the published amount range or with an invalid card number is refused with field errors and reaches neither Kill Bill nor the ledger.
- **DP-11 — Card payments paused** While Kill Bill is unreachable, deposits and refunds answer 503 and the Balance screen shows the paused-payments banner, and trading continues.
- **DP-12 — Deposit receipt email** Each confirmed deposit sends one receipt email to the depositor carrying only their own deposit details, delivered later if mail is down.
- **DP-13 — Deposit refunds** A market admin refunds all or part of a deposit through Kill Bill, capped by the published refundable amount, and the member gets a refund email.
- **DP-14 — Balanced venue ledger** Every balance change posts as one journal entry whose legs sum to zero, so each venue's accounts sum to zero and every member balance equals the sum of its legs.
- **DP-15 — Event order journey** A trader picks an event market, sets outcome, price and size, reviews, confirms, sees the order rest or fill, and cancels a resting one.
- **DP-16 — Event matching across the mirror** On an event market a buy of YES at a price meets a buy of NO at 100 minus that price on one price-time-priority book.
- **DP-17 — Exact cost and fee per fill** Each fill charges its notional plus the published basis-point fee rounded half-up per fill, in integer cents.
- **DP-18 — Order validation and holds** An order is checked for ranges, market state and funds, and its maximum cost is held from the available balance until it fills or ends.
- **DP-19 — Order lifecycle** Orders move through resting, partially filled, filled, cancelled and liquidated by the published rules, and cancelling an ended order answers 409.
- **DP-20 — Order announcements** The ticket's live region announces the published order and fill messages word for word.
- **DP-21 — Keyboard-complete ticket** Choosing a market, picking a book level, setting the ticket, reviewing, confirming and cancelling all work by keyboard alone, with dialogs that keep and return focus.
- **DP-22 — Spot and margin share one book** Spot and margin orders on a pair rest on one price-time-priority book and match each other.
- **DP-23 — Spot holdings** Spot buys add units to the buyer's holdings, and spot sells need unreserved units.
- **DP-24 — Margin positions** Margin orders open, grow or reduce one long or short position per member per pair, with collateral and profit or loss as qualified in Business rules.
- **DP-25 — Live in-place updates** Balance, open interest, book levels and the orbit's rings update within one second of a fill, without a reload and without losing the ticket draft.
- **DP-26 — Orderbook Orbit** The market detail shows the live book as the Orderbook Orbit beside a synced ranked list of the same levels, and picking a level on either side prefills the ticket.
- **DP-27 — Scroll and drag camera** Scrolling the market detail moves the orbit camera from top-down to side profile and back along one fixed path, and dragging adds a limited yaw that springs back.
- **DP-28 — Fill settle and re-sort** When a fill lands, the filled ring shrinks, the rings re-sort and settle without bounce, and the trade numeral counts to the new last price.
- **DP-29 — Depth ladder for reduced motion and no WebGL** With reduced motion or without WebGL, a flat two-column depth ladder replaces the orbit, updates at once, and keeps the same selection and ticket prefill.
- **DP-30 — Market detail layouts** The market detail gives each published viewport its published layout (stacked, side by side, three panes) with no horizontal scrolling.
- **DP-31 — Market lifecycle** Market admins list, open, halt, resume and resolve markets along the published state machine, and every illegal step answers 409.
- **DP-32 — Server-decided trading close** An event stops trading at its server-set close instant, refuses later orders, cancels resting ones and flips open screens to closed, whatever the device clock says.
- **DP-33 — Resolution and settlement** Resolving a closed event pays each winning contract 100 cents exactly once and moves the market to settled.
- **DP-34 — Resolve-to-payout journey** A market admin resolves an event in the admin screen, and its holders see the market settled and the payout in their balance.
- **DP-35 — Maintenance check** After every fill on a pair, the server checks each open margin position on that pair against its maintenance requirement at the new mark, within the delay stated in Business rules.
- **DP-36 — Liquidation** A position below maintenance is liquidated at the mark and its resting margin orders end as liquidated, and a market admin can run the check on demand.
- **DP-37 — API keys** A builder creates, lists and revokes API keys, sees each secret once, and trades with a key as themselves.
- **DP-38 — Idempotent order placement** Repeating an order with the same Idempotency-Key returns the original order without a second order, hold or fee, and a different body under that key answers 409.
- **DP-39 — Plan rate limits** Each API key is limited to its builder's effective plan rate, held in Valkey, and excess requests answer 429.
- **DP-40 — No extra fields** Profile, order, deposit, refund, fee and invite requests that carry any field the API does not list are refused with 422 and change nothing.
- **DP-41 — Builder API journey** A builder mints a key, places and cancels orders over the API, and sees the same orders and fills on their screens.
- **DP-42 — Builder plans in Kill Bill** Builder plans are Kill Bill subscriptions: upgrades take effect at once with Kill Bill's proration, downgrades take effect at the end of the term Kill Bill reports, and invoices are read back from Kill Bill.
- **DP-43 — Dunning follows Kill Bill overdue** The builder's plan state follows Kill Bill's overdue state, the downgraded state cuts every key to the Sandbox rate in the same step, a cleared account restores it, and each step sends its email.
- **DP-44 — Billing screen journey** A builder changes plan, sees Payment failed or Downgraded with its banner, pays the outstanding balance, and sees the plan restored once Kill Bill clears it.
- **DP-45 — Builder webhook endpoint** A builder saves one webhook endpoint that becomes their Svix endpoint in their venue's Svix application, and sees its delivery attempts.
- **DP-46 — Signed fill, liquidation and settlement events** Each of the builder's fills, liquidations and settlements is sent once through Svix, signed, and retried under the same event id, carrying only counterparty-free fields.
- **DP-47 — Webhook delivery delays** While Svix is unreachable, fills still succeed, events wait and are delivered later, and the webhooks screen shows the delay banner.
- **DP-48 — Monthly statements** Each member gets a monthly PDF statement for the venue's calendar month, stored in MinIO and opened only by its owner through a short signed link.
- **DP-49 — Statement ready email** Each new statement sends its owner one email with an in-app link and no statement content.
- **DP-50 — Statements unavailable** While MinIO is unreachable, statement links and generation answer 503 and the Statements screen shows the outage banner.
- **DP-51 — Venue totals and member picker** The org owner's venue totals and member picker count and list only their own venue's rows.
- **DP-52 — Fill export** The org owner downloads one month of their venue's fills as CSV, containing only that venue's rows.
- **DP-53 — Invites and fee schedule** The org owner invites members with chosen roles through Keycloak-backed invites and sets the venue's taker and maker fees for orders placed afterwards.
- **DP-54 — Owner journey** An org owner reads venue totals, finds a member, invites an admin, saves fees, exports fills, generates statements and sees builder billing states.
- **DP-55 — Health and run manifest** The app installs, builds and serves from `/app/run.json` on the published port, and `/api/health` answers 200 even while a provider is down.
- **DP-56 — Server boundary** The server enforces the published size limits and origin rule, never serves source files or credentials, and starts even when a provider is unreachable.
- **DP-57 — Candy-shift look** Every screen carries the candy-shift direction: full-bleed slate, sage, blush and olive fields, Parkinsans and Urbanist type, calm surface cards and one olive pill per action.
- **DP-58 — Candy-stage hero** The home screen opens on the candy-stage hero: the plump product name, the orbit, four cropped stickers and the single Open the book pill.
- **DP-59 — Credentials from environment** Every service URL and credential is read from the published environment variables at start, and none is hard-coded or sent to the browser.
- **DP-60 — Procedural orbit graphics** The Orderbook Orbit and the stickers are drawn procedurally in the browser from live data, with no bundled images or video of the book.

## Frontend

### Screens and layout (DP-01, DP-06, DP-07, DP-08, DP-15, DP-26, DP-30, DP-44, DP-48, DP-54)

Every signed-in screen has a top bar with the venue name on the left and the navigation on the right. At 375x812 the navigation folds into a Menu button that opens a full-height sheet. No screen scrolls sideways at 375x812, 768x1024 or 1280x800. Layout changes happen only at these widths: below 768 px one column, from 768 px up to 1279 px two columns, and 1280 px and wider the desktop layout.

- **Home `/`.** This is the candy-stage hero (see Visual design) followed by three scroll chapters: sage, an explainer of the shared book with the spot, margin and event stickers; blush, "Your venue today", with today's volume and open interest; and the olive close block with the Open the book pill again. Signed out, the orbit shows a bundled, invented sample book with the label from Public screens, and both pills lead to sign-in. Signed in, the orbit shows the member's venue flagship event market live, and the volume numeral shows the venue's volume today. At 375 the order is headline, orbit, pill, then the chapters stacked. At 768 and 1280 the hero is centred, with the orbit at about two fifths of the width.
- **Sign-in error, Sign-in unavailable, No venue and Not found pages.** Each is a single centred Parkinsans line, with the copy from Feedback states and one cropped sticker, on the slate field.
- **Accept invite `/invites/<token>`.** A centred surface card with the invitee's email, the venue name and a password form.
- **Markets `/markets`** (sage field). A list of the venue's markets as surface cards: symbol, title, kind (Spot and margin, or Event), status text, last price and, for events, the close time in the venue's time zone. One column at 375, two at 768, three at 1280.
- **Market detail `/markets/<id>`** (blush field). Header: the market title, the status text, the close time for events, the open-interest numeral and the member's available balance. Then three blocks: the book (Orderbook Orbit plus the Book levels list), the order ticket, and Your orders (resting and recent orders plus recent fills).
  - At 375x812: one column in this order: header, orbit (full width, about as tall as it is wide), Book levels, order ticket, Your orders. The ticket sits below the book.
  - At 768x1024: two columns. The left column holds the orbit with Book levels under it. The right column holds the ticket with Your orders under it. Ticket and book sit side by side, and their tops are within the first screen.
  - At 1280x800: three panes from left to right: Book levels, orbit, ticket. Your orders spans the full width below them. All three panes start within the first screen.
  - The page is at least 1200 px taller than the viewport at every size, so the whole scroll range of the camera can be reached. At 768 and 1280 the orbit stays in view while the page scrolls.
- **Balance `/balance`** (slate). Available, held and collateral cards, the Deposit by card pill, a Deposits table and a Positions table (spot units, margin positions, event contracts). One column at 375, two-column card grid at 768 and 1280.
- **Orders `/orders` and order detail `/orders/<id>`** (slate). The member's orders with their status. The detail page shows one order and its fills.
- **Statements `/statements`** (slate). The member's statements, newest first, each with a download link.
- **Profile `/profile`** (slate). Display name form and ID document upload with the list of the member's uploaded documents.
- **Builder `/builder`** (olive close block, pale text, surface cards for dense content). Three sections in order: Plan (state badge, plan choice, banner, invoices), API keys, Webhooks (endpoint and delivery attempts). Stacked at 375 and 768, plan and keys side by side above webhooks at 1280.
- **Market admin `/admin`** (sage). A markets table with lifecycle actions, then a Deposits table with refunds, then an ID documents table.
- **Venue `/owner`** (slate). Venue totals as large Parkinsans numerals, the member picker, invites, fee schedule, exports and statements, and the builder billing table.
- **Platform `/platform`** (slate). The venues table, provider health and Onboard venue. This screen never shows member names, emails or ids.

### Public screens and controls (DP-01, DP-02, DP-06, DP-08, DP-13, DP-15, DP-20, DP-21, DP-26, DP-29, DP-37, DP-44, DP-45, DP-48, DP-51, DP-52, DP-53, DP-54)

Only the roles, names and attributes below are public; everything else is free. Copy for live regions and banners is in Feedback states.

| Screen | Role and accessible name | Visible copy and notes |
|---|---|---|
| All signed-in | `navigation "Venue"` | links `Markets`, `Balance`, `Orders`, `Statements`, `Profile`; `Builder` for builders, `Admin` for market admins, `Owner` for org owners, `Platform` for the founder operator |
| All signed-in | `button "Sign out"` | `Sign out` |
| All signed-in at 375 | `button "Menu"` opening `dialog "Menu"` | holds the navigation links |
| Signed-out pages | `link "Sign in"` | `Sign in`; goes to `/auth/login` |
| Home | `heading "Plumtide Venue"` (level 1) | the hero headline |
| Home | `link "Open the book"` | the olive pill; signed in it opens the flagship market, signed out it starts sign-in |
| Home and market detail | `region "Orderbook Orbit"` | holds the orbit canvas, or the depth ladder |
| Orbit canvas | `img "Orderbook Orbit"` | the WebGL canvas; attributes `data-elevation` (camera elevation in degrees, one decimal), `data-yaw` (degrees, one decimal), `data-settled` (`true` or `false`), `data-highlight` (`ask:<p>`, `bid:<p>` or empty), `data-rings` (a JSON array with one item per drawn ring, `{"level":"ask:<p>"` or `"bid:<p>","x":<number>,"y":<number>}`, where `x` and `y` are the point in CSS pixels from the canvas's top-left corner at which a click or tap selects that ring, kept current whenever rings or the camera move). In these attributes `<p>` is the level's price as integer cents, on the YES scale for events, e.g. `ask:37` or `bid:2400` |
| Home signed out | text `Sample book` | label under the orbit |
| Home and market detail | `region "Last trade"` | the trade numeral above the spindle: the market's last trade as `<price>` in the format from Feedback states (e.g. `37¢` or `$26.00`), or `—` before any trade |
| Markets | `list "Markets"`, each `link "<symbol> — <title>"` | status text per card |
| Market detail | `heading "<title>"` (level 1) | |
| Market detail | `status "Market status"` | one of the market status texts in Feedback states |
| Market detail | `region "Your balance"` | `Available <amount>` |
| Market detail | `region "Open interest"` | the market's `open_interest` (defined in Business rules) as an integer with thousands commas, e.g. `1,200` |
| Market detail | `link "Skip to order ticket"` | first focusable control after the navigation |
| Market detail | `listbox "Book levels"`, each `option "<Ask or Bid> <price>, <quantity> resting"` | e.g. `Ask 37¢, 200 resting`; pair prices as `$26.00` |
| Market detail, reduced motion or no WebGL | `region "Depth ladder"` with `list "Bids"` and `list "Asks"` | one item per level with a size bar |
| Market detail | `form "Order ticket"` | |
| Ticket, event | `radiogroup "Outcome"` with `radio "Yes"`, `radio "No"` | |
| Ticket, pair | `radiogroup "Mode"` with `radio "Spot"`, `radio "Margin"`; `radiogroup "Side"` with `radio "Buy"`, `radio "Sell"` | |
| Ticket | `spinbutton "Price"`, `spinbutton "Quantity"` | event price in whole cents; pair price in dollars with two decimals |
| Ticket | `button "Decrease price"`, `button "Increase price"`, `button "Decrease quantity"`, `button "Increase quantity"` | one tick or one unit per press |
| Ticket | `status "Ticket summary"` | the summary line from Interactions |
| Ticket | `button "Review order"` | |
| Ticket | `dialog "Review order"` with `button "Confirm order"`, `button "Back"` | |
| Market detail | `status "Order updates"` | order and fill announcements |
| Market detail | `region "Your orders"` with `heading "Your orders"`; each resting row has `button "Cancel order <short id>"` | `<short id>` is the first 8 characters of the order id |
| Market detail | `dialog "Cancel order"` with `button "Yes, cancel"`, `button "Keep order"` | |
| Market detail | empty book line | shown in the orbit region and the Book levels area when both sides are empty |
| Balance | `button "Deposit by card"` opening `dialog "Deposit by card"` | |
| Deposit dialog | `textbox "Amount (USD)"`, `textbox "Card number"`, `button "Deposit"` | |
| Balance | `status "Deposit status"`; `table "Deposits"`; `table "Positions"` | |
| Statements | `list "Statements"`, each `link "Download <Month YYYY> statement"` | |
| Profile | `textbox "Display name"`, `button "Save profile"`, `status "Profile status"` | |
| Profile | file input labelled `ID document`, `button "Upload ID document"`, `table "Your documents"` | |
| Builder | `region "Plan"`; state badge text `Active`, `Payment failed` or `Downgraded` | |
| Builder | `radiogroup "Builder plan"` with `radio "Sandbox"`, `radio "Builder"`, `radio "Desk"`; `button "Change plan"` | |
| Builder | `button "Pay outstanding balance"` | shown only while the state is not active |
| Builder | `table "Invoices"`; `status "Billing status"` | |
| Builder | `button "Create API key"` opening `dialog "New API key"` with `textbox "Key name"`, `button "Create key"`, then the secret with `button "Copy key"` | |
| Builder | `table "API keys"`, each row `button "Revoke <key name>"` | |
| Builder | `textbox "Endpoint URL"`, `button "Save endpoint"`, `table "Delivery attempts"`, `status "Webhook status"` | |
| Admin | `table "Markets"`; row buttons `Open trading`, `Halt`, `Resume`, `Resolve`, `Run liquidations` (shown only where legal) | |
| Admin | `button "List market"` opening `dialog "List market"` | |
| Admin | `dialog "Resolve <symbol>"` with `radio "Yes"`, `radio "No"`, `button "Confirm resolution"` | |
| Admin | `table "Deposits"`, each row `button "Refund"` opening `dialog "Refund deposit"` with `textbox "Refund amount (USD)"`, `button "Issue refund"` | |
| Admin | `table "ID documents"`, each row `link "View document"`; `status "Admin updates"` | |
| Owner | `region "Venue totals"` | |
| Owner | `combobox "Find member"` with its `listbox`, options `<display name> — <email>` | |
| Owner | `button "Invite member"` opening `dialog "Invite member"` with `textbox "Email"`, `textbox "Display name"`, `checkbox "Trader"`, `checkbox "Builder"`, `checkbox "Market admin"`, `button "Send invite"` | |
| Owner | `spinbutton "Taker fee (bps)"`, `spinbutton "Maker fee (bps)"`, `button "Save fees"` | |
| Owner | `combobox "Export month"`, `link "Export fills (CSV)"`, `button "Generate statements"` | |
| Owner | `table "Builder billing"`; `status "Venue updates"` | |
| Platform | `table "Venues"`, `region "Provider health"`, `button "Onboard venue"` opening `dialog "Onboard venue"` | |
| Accept invite | `form "Accept invite"` with password field labelled `Choose a password`, `button "Accept invite"` | |
| Any outage | `alert` banner | copy from Feedback states |

### Interactions (DP-15, DP-21, DP-25, DP-26, DP-27, DP-29, DP-41, DP-44)

- **Signing in.** `Sign in` sends the browser to the Keycloak page and back to the page it started from, or to `/` when there is none. A member with no venue lands on the No venue page.
- **Choosing a market.** On Markets, Tab reaches each market link in list order, and Enter opens the market detail.
- **Picking a book level.** The Book levels list is one Tab stop. Its options run top to bottom as on a ladder: asks from the highest price down to the best ask, then bids from the best bid down. Up and Down move the active option, Home and End jump to the ends, and the active option is highlighted on the orbit (`data-highlight`). Enter, Space or a click selects the option and prefills the ticket:
  - On an event, an ask at `p` sets Outcome Yes and Price `p`, and a bid at `p` sets Outcome No and Price `100 − p`.
  - On a pair, an ask sets Side Buy and a bid sets Side Sell, at the level's price, and Mode is left as it was.
  - Quantity is set to the level's resting quantity, and focus moves to Quantity.
  - Clicking or tapping a ring on the canvas selects the same option.
- **Ticket.** The Tab order inside the ticket is: Outcome (or Mode then Side), Price with its two stepper buttons, Quantity with its two stepper buttons, then Review order. Arrow keys move within a radiogroup. The ticket summary updates on every input without submitting:
  - event or spot buy: `Cost <notional> + fee <fee> = <total>`
  - spot sell: `Proceeds <notional> − fee <fee> = <total>`
  - margin: `Collateral <collateral> + fee <fee> = <total>`
  - The amounts are the maximum the order can spend at its limit price, computed by the rules in Business rules, in the money format from Business rules.
  - Ctrl+Enter, or Cmd+Enter on a Mac, opens the review from any control in the ticket.
- **Review and confirm.** Review order opens the Review order dialog with the summary, and focus starts on Confirm order. Tab past the last button wraps to the first, and Shift+Tab from the first wraps to the last, so focus never leaves the dialog. Escape and Back close it and return focus to Review order. Confirm order closes the dialog, sends the order, and returns focus to Review order. The ticket keeps its values after any outcome.
- **Cancel.** A row's Cancel order button opens the Cancel order dialog with focus on Yes, cancel. Focus wraps inside the dialog as in the review dialog. Escape or Keep order closes it and returns focus to that Cancel order button. Yes, cancel moves focus to the Your orders heading.
- **Live updates.** The market detail listens to the server stream (see API). Book levels, rings, the last-trade numeral, the open-interest numeral, the member's balance and Your orders change in place within one second of the server committing a fill, an order or a status change. This includes fills between other members. Nothing reloads, and the ticket's typed values and focus stay where they were.
- **Camera.** Scrolling the market detail page moves the orbit camera as specified in Motion and effects. Dragging on the canvas sideways with a mouse or a finger turns it. Vertical swipes on a phone scroll the page.
- **Touch.** Every control on the ticket, every stepper and every dialog button is at least 44 by 44 px. The stepper buttons let a phone user set price and quantity without the keyboard.
- **Deposits.** Deposit by card opens the dialog with focus on Amount. Enter in either field submits. Escape closes the dialog and focus returns to Deposit by card. Focus wraps inside the dialog.
- **All other dialogs** (List market, Resolve, Refund deposit, New API key, Invite member, Onboard venue, Menu) follow the same rules: focus moves inside on open, wraps with Tab and Shift+Tab, Escape closes, and focus returns to the control that opened it.
- **Owner member picker.** Typing in Find member updates its listbox after each keystroke, with no submit. Up and Down move through the options, and Enter picks one and shows that member's roles under the picker.
- **Screens that depend on server time** (market status, close, billing state) change only when the server reports a change, through the stream or the next response. They never change from the device clock, which may be wrong.

### Visual design (DP-57, DP-58)

The direction is **candy-shift**: soft, plump and decisive. A money-and-leverage exchange is set in pastel colour fields with plump type, on purpose, against the usual near-black terminal with neon tickers. These are members-only clubs where trading is social and event contracts read as yes/no questions. The fields stay calm, the text stays dark on every fill, and one deep olive control colour keeps the seriousness.

- **Typefaces.** Parkinsans (bold) carries the product name, headings and live totals. Urbanist carries body text, labels, tables and forms. Prices, sizes and balances use Urbanist with tabular, equal-width figures so columns line up. Only live totals (today's volume, open interest, venue totals) use Parkinsans numerals.
- **Scale.** Each heading level is about one third larger than the level below (a ratio of about 4 to 3). On the home hero, the product name and the live volume numeral are huge: about one eleventh of the viewport width.
- **Colour roles.**
  - The ground is a soft grey-blue slate.
  - Cards sit on a paler blue-grey surface.
  - Text is near-black ink, and secondary text is a dark slate.
  - The single accent is a deep olive green used for every button and pill, with pale stone text on it.
  - The scroll chapters change the full-bleed background in this order: slate, a soft grey-green sage, a dusty pink-beige blush, then the deep olive close block with pale stone text.
- **Composition.** A centred axis carries the headline, the orbit and the ticket. Die-cut sticker shapes for spot, margin and event contracts sit in the page margins, cropped by the viewport edge.
- **Hero (candy-stage).** "Plumtide Venue" in bold Parkinsans fills the slate field. Below it sits the live Orderbook Orbit at about two fifths of the width. Four flat procedural stickers sit cropped at the four viewport edges: a YES/NO coin in sage, a margin dial in blush, a spot cube in the surface colour and a statement envelope in olive. Each is tilted a little, between 3 and 11 degrees, alternating directions. One large olive pill reads Open the book. On a phone the hero is headline, orbit and pill, with two stickers kept in the corners.
- **Working screens.** Working screens keep the field sequence: Markets and Market admin are sage, the market detail is blush, and Balance, Orders, Statements, Profile, Venue and Platform are slate. Billing and dunning on Builder sit on the olive close block with pale text. Dense content (tables, forms, fill lists, the ticket) sits on surface cards with generously rounded corners (about 28 px) and ink text. Every action is one olive pill. Empty states are one centred Parkinsans line with a cropped sticker. Error and outage banners are blush cards with an ink Lucide icon and the exact copy from Feedback states. Loading states show the sticker shapes as flat skeleton blocks that pass once and stop.
- **Density.** Comfortable: generous padding inside cards, rows tall enough to tap.
- **Accessibility.** Every text and control meets WCAG 2.2 AA contrast on its field (body text at least 4.5 to 1, large numerals and controls at least 3 to 1). Every control is at least 44 px in both directions. Focus is always visible as a thick ink ring offset from the control.
- **Not in this direction:** paper or cream grounds, hairline rules, monospace labels, index numbering, glass or blur effects, neon or dark terminal panels.

### Motion and effects (DP-26, DP-27, DP-28, DP-29, DP-60)

Motion has three speeds. Presses respond in under a fifth of a second. Dialogs, sheets and banners enter and leave in about a third of a second. Count-ups and the stickers' one-time entrance take about six tenths of a second. Everything starts fast and settles softly with no overshoot. There are no unnamed decorative loops: nothing pulses, spins or drifts on its own. The orbit has no idle motion and is still until data, scroll or a drag moves it.

**Orderbook Orbit (signature).** The orbit is a WebGL scene drawn procedurally from the live book.

- **Rings.** Each price level is a torus ring around a central vertical spindle. Bids sit below the middle in sage and asks above in blush. A ring's height on the spindle grows with its distance from the mid price. Its radius is proportional to its resting quantity, and the largest level gets the widest ring. Spot and margin interest share the same rings. On an event market the rings use the YES scale, so NO buys appear as asks at 100 minus their price.
- **Fill.** When a fill arrives from the server stream, the filled ring shrinks to its new radius. Rings that empty are removed, and the remaining rings move to their new order and heights. Each ring springs to its new size and place in under one second with no visible bounce, and `data-settled` reads `false` until every ring is within half a pixel of its target, then `true`. After the rings settle, the Last trade numeral counts from the old last price to the new one over about six tenths of a second and ends on the exact new price.
- **Scroll camera (market detail only).** The page's vertical scroll position from 0 to 1200 px drives the camera elevation, shown in `data-elevation`. Elevation is 90 degrees (top-down ladder view) at 0 px and falls in a straight line to 35 degrees (an angled orbit view) at 600 px. From 600 px to 1200 px it falls in a straight line to 0 degrees (a side depth profile). It stays at 0 beyond 1200 px. The path is the same in both directions: scrolling back up reverses it step by step, and any scroll position always gives the same elevation. The home orbit keeps a fixed 35-degree elevation.
- **Drag.** A sideways drag on the canvas, with mouse or touch, turns the scene: one degree of yaw for every 6 px dragged, capped at 20 degrees either way, shown in `data-yaw`. On release the yaw springs back to 0 in under one second with no bounce.
- **Selection.** Focusing or selecting a Book levels option brightens the matching ring and sets `data-highlight`. Clicking or tapping a ring, at the point `data-rings` gives for it, selects the matching option.

**Stickers.** On first load of the home page the four stickers rotate from flat into their tilt once, in about six tenths of a second, and never move again.

**Reduced motion.** When the system asks for reduced motion:

- The orbit is replaced by the Depth ladder: a flat two-column, ranked ladder with bids on one side and asks on the other, each level with a bar sized by its resting quantity.
- Re-sorts apply at once, numerals show their final values at once, and scrolling changes nothing.
- Stickers sit in their final tilt from the start.
- Dialogs and banners appear and disappear without movement.
- The Book levels list, its selection, the ticket prefill and the Order updates announcements work exactly as with motion.

**Without WebGL.** A browser without WebGL gets the same Depth ladder and behaviour as reduced motion.

### Feedback states (DP-09, DP-10, DP-11, DP-13, DP-19, DP-20, DP-32, DP-43, DP-47, DP-50)

Every async action shows a pending state, then its result, in the named live region. Live regions are polite. Each live region shows only its latest message, which replaces the one before, except `Order updates`. `Order updates` is a log: each message is appended as its own line at the end, the newest 10 lines are kept, and the pending line `Sending order…` or `Cancelling…` is removed when its result arrives. For a placed order, the summary message (`Order resting`, `Filled in full` or `Partially filled — …`) is appended first, then one `Filled …` line per fill of that order in fill order. Later fills, cancels and liquidations are appended as they arrive. Outage banners use `role="alert"` and stay until a later request to that service succeeds. Apostrophes are straight, and dashes are the characters shown.

**Formats used in the copy:**

- `<amount>` is money in the display format from Business rules.
- `<price>` is `<n>¢` on event markets and `<amount>` on pairs.
- `<Plan>` is `Sandbox`, `Builder` or `Desk`.
- `<Month YYYY>` is the month name and year, e.g. `October 2026`.

| Action | Live region | Pending | Success | Field errors | Outage or refusal |
|---|---|---|---|---|---|
| Place order | `Order updates` | `Sending order…` | `Order resting` when nothing filled; `Filled in full` when fully filled; `Partially filled — <filled> of <quantity>` otherwise; then one `Filled <quantity> at <price>` per fill of the member's own orders, including later fills | price `out_of_range`: `Enter a price from 1¢ to 99¢.` (event) or `Enter a price from $0.01 to $10,000.00.` (pair); quantity `out_of_range`: `Enter a quantity from 1 to 100,000.`; quantity `insufficient_funds`: `Not enough available balance for this order.`; quantity `insufficient_holdings`: `You don't hold enough units to sell.`; quantity `exceeds_position`: `This would flip your margin position — close it first.` | not trading: `This market isn't trading right now.` |
| Cancel order | `Order updates` | `Cancelling…` | `Order cancelled` | | already ended: `This order has already ended.` |
| Own margin position liquidated | `Order updates` | | `Your <symbol> margin position was liquidated at <price>.` | | |
| Deposit | `Deposit status` | `Waiting for card confirmation…` | `Deposit confirmed — <amount> added to your balance.` | amount: `Enter an amount from $5.00 to $5,000.00.`; card: `Enter a valid card number.` | declined: `Card declined — nothing was charged.`; Kill Bill down, alert banner: `Card payments are paused — your balance is safe` |
| Refund | `Admin updates` | `Sending refund…` | `Refund of <amount> issued.` | `Enter an amount up to <refundable>.` where `<refundable>` is the cap in Business rules | Kill Bill down: the paused-payments banner above |
| Change plan | `Billing status` | `Updating plan…` | `Plan updated to <Plan>.`; for a downgrade, `Changes to <Plan> on <date>` where `<date>` is Kill Bill's effective date as `D Month YYYY` | | locked: `Pay the outstanding balance before changing plan.`; Kill Bill down, alert: `Billing is unavailable right now — your keys keep their current rate.` |
| Pay outstanding balance | `Billing status` | `Sending payment…` | `Payment received.` (the badge changes only when Kill Bill clears the account) | | Kill Bill down: the billing banner above |
| Billing state banners | alert on Builder | | payment failed: `Your last plan payment failed — pay now to keep your rate.`; downgraded: `Your plan is downgraded to Sandbox until the outstanding invoice is paid.` | | |
| Save endpoint | `Webhook status` | `Saving endpoint…` | `Endpoint saved.` | url: `Enter an http or https URL.` | Svix down, alert: `Webhook delivery is delayed — your fills are safe and will be sent.` |
| Create API key | inside the dialog | `Creating key…` | the secret with `This key is shown once.` | name: `Enter a key name of up to 40 characters.` | |
| Statement link | alert on Statements | | the PDF opens | | MinIO down: `Statements are unavailable right now — try again in a few minutes.` |
| Generate statements | `Venue updates` | `Generating…` | `Statements are being generated for <Month YYYY>.` | month: `Choose a month that has ended.` | MinIO down: the statements banner above |
| Save fees | `Venue updates` | `Saving fees…` | `Fees saved.` | `Enter whole basis points from 0 to 1,000, with the maker fee no higher than the taker fee.` | |
| Send invite | `Venue updates` | `Sending invite…` | `Invite sent to <email>.` | email: `Enter a valid email.`; roles: `Choose at least one role.` | duplicate: `That person is already a member.`; Keycloak down, alert: `Sign-in is unavailable right now — try again in a minute.` |
| Save profile | `Profile status` | `Saving…` | `Profile saved.` | `Enter a display name of 1 to 60 characters.` | |
| Upload ID document | `Profile status` | `Uploading…` | `Document uploaded.` | `Upload a PDF, PNG or JPEG of up to 5,000,000 bytes.` | MinIO down, alert: `Documents are unavailable right now — try again in a few minutes.` |

**Other copy:**

- **Market status texts** (`Market status`), from the market's server status: `Listed`, `Trading open`, `Trading halted`, `Trading closed`, `Resolved YES`, `Resolved NO`, `Settled YES`, `Settled NO`.
- **Empty book line:** `No resting orders yet — be the first on the book.`
- **Empty statements:** `No statements yet — your first arrives on the 1st.`
- **Sign-in error page:** heading `Sign-in link expired`, then `Start again from Sign in.` with the Sign in link.
- **Sign-in unavailable page:** heading `Sign-in is unavailable right now — try again in a minute.`
- **No venue page:** heading `No venue yet`, then `Ask your venue's owner for an invite.`
- **Not found page** (any unknown route, or a record the member may not see): heading `We couldn't find that page`.
- **Invite page:** expired: `This invite has expired — ask for a new one.`; used or unknown: the Not found page.

## Backend

### API (DP-03, DP-04, DP-05, DP-07, DP-09, DP-10, DP-13, DP-18, DP-19, DP-37, DP-38, DP-39, DP-40, DP-42, DP-45, DP-48, DP-51, DP-52, DP-53, DP-55)

**General rules:**

- **Format.** JSON in and out (`application/json; charset=utf-8`), except the CSV export, the event stream, the auth redirects and the document upload.
- **Ids and timestamps.** Ids are UUIDs. Timestamps are ISO 8601 in UTC with `Z`.
- **Money and prices.** Money is integer cents in fields ending `_cents`. Prices are integer cents in `price` fields: one tick is one cent.
- **Errors.** Every error has the shape `{"error":"<code>"}`, with extra fields only where a row below says so. Validation errors are `422 {"error":"validation","errors":{"<field>":"<code>"}}`. Each field error uses the code stated for it in API or Business rules. Any other failed check on a field, including a missing field, a wrong type or a value outside the format stated for it, uses the code `invalid`.
- **Unknown fields.** Every request body listed below accepts only its listed fields. Any other key answers `422 {"error":"validation","errors":{"<key>":"unknown_field"}}` and changes nothing.
- **Sessions and keys.** The session cookie is `pv_session`. Builders may instead send `Authorization: Bearer <api key>` on the key-enabled endpoints, marked **key** below. A key on any other endpoint answers `403 {"error":"forbidden"}`.

**Error precedence**, the same for every endpoint:

1. Body too large (413) or malformed JSON (`400 {"error":"bad_json"}`).
2. Unauthenticated: `401 {"error":"unauthenticated"}`.
3. Rate limited (API-key requests only): `429 {"error":"rate_limited","retry_after_ms":<int>}` with a `Retry-After` header in whole seconds, rounded up.
4. Idempotent replay, which returns the stored response.
5. Unknown resource, other member's private record, or other venue's id (path or body): `404 {"error":"not_found"}`. A malformed id also answers this 404.
6. Missing role, or no venue: `403 {"error":"forbidden"}`.
7. State conflicts: 409.
8. Validation: 422.

**Scope.** Member routes (orders, fills, deposits, statements) treat another member's record as unknown. Venue routes for admins and owners treat any record of the caller's own venue as known, so a lower role gets 403 there. The founder operator has no venue, so every venue route answers them 404 for ids and 403 otherwise.

**Shared objects:**

- **Me:** `{"id","username","display_name","email","roles":["trader"|"builder"|"market_admin"|"org_owner"|"founder_operator"],"venue":{"id","slug","name","time_zone"}|null}`
- **Market:** `{"id","kind":"pair"|"event","symbol","title","status","closes_at":<ts>|null,"outcome":"yes"|"no"|null,"last_price":<int>|null,"open_interest":<int>,"taker_fee_bps","maker_fee_bps"}`
- **Order:** `{"id","market_id","mode":"spot"|"margin"|null,"side":"buy"|"sell","outcome":"yes"|"no"|null,"price","quantity","filled_quantity","remaining_quantity","status":"resting"|"partially_filled"|"filled"|"cancelled"|"liquidated","hold_cents","taker_fee_bps","maker_fee_bps","created_at","fills":[Fill]}`. Event orders have `side` `"buy"` and `mode` null.
- **Fill:** `{"id","order_id","market_id","mode","side","outcome","price","quantity","notional_cents","fee_cents","liquidity":"maker"|"taker","filled_at"}`. `price` is what this member paid or received per unit.
- **Balance:** `{"available_cents","held_cents","collateral_cents","total_cents"}`
- **Deposit:** `{"id","amount_cents","refunded_cents","status":"succeeded"|"declined","card_last4","killbill_payment_id","created_at"}`
- **Billing:** `{"plan":"sandbox"|"builder"|"desk","effective_plan","state":"active"|"payment_failed"|"downgraded","overdue_state":<Kill Bill state name>,"rate_per_second","pending_plan":<plan>|null,"pending_effective_date":"YYYY-MM-DD"|null,"provider":"ok"|"unavailable","invoices":[{"id","number","invoice_date","amount_cents","balance_cents","items":[{"description","amount_cents","start_date","end_date"}]}]}`

**Session and identity:**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /auth/login?next=<path>` | anyone | `next` is a same-site path | 302 to Keycloak's authorization endpoint | |
| `GET /auth/callback?code&state` | anyone | | 302 to `next` (default `/`), sets `pv_session` | 400 sign-in error page; 503 sign-in unavailable page |
| `POST /api/session` | anyone | `{"username","password"}` | `200 Me`, sets `pv_session` | `401 {"error":"invalid_credentials"}`; `503 {"error":"sign_in_unavailable"}` |
| `DELETE /api/session` | signed in | | 204, cookie cleared | |
| `GET /api/me` | signed in | | `200 Me` | |
| `PATCH /api/me` | member | `{"display_name"}` (1 to 60 characters after trimming) | `200 Me` | |
| `POST /api/me/documents` | member | `multipart/form-data`, one part `document` | `201 {"id","filename","content_type","size_bytes","uploaded_at"}` | `422 {"error":"validation","errors":{"document":"unsupported_type"}}`; `503 {"error":"documents_unavailable"}` |
| `GET /api/me/documents` | member | | `200 {"documents":[...]}` (own only) | |
| `GET /api/invites/{token}` | anyone | | `200 {"email","venue_name"}` | `410 {"error":"invite_expired"}` |
| `POST /api/invites/{token}/accept` | anyone | `{"password"}` (12 to 128 characters) | `200 {"email"}` | 410 as above; `503 {"error":"identity_unavailable"}` |

**Markets** (all scoped to the caller's venue):

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/markets` | member, **key** | | `200 {"markets":[Market]}` | |
| `GET /api/markets/{id}` | member, **key** | | `200` Market plus `"server_time"` | |
| `GET /api/markets/{id}/book` | member, **key** | | `200 {"market_id","sequence","last_price","bids":[Level],"asks":[Level]}`. Bids are sorted high to low and asks low to high. Level is `{"price","quantity"}`, plus `"spot_quantity","margin_quantity"` on pairs | |
| `GET /api/stream?market_id=<id>` | member | | `text/event-stream`. Events: `book` (the book object), `trade` `{"price","quantity","at"}`, `market` (Market). For the caller only: `balance` (Balance), `order` (Order), `fill` (Fill), `liquidation` `{"position_id","market_id","mark_price"}` | |
| `GET /api/venue/summary` | member | | `200 {"volume_cents_today","open_interest_contracts","flagship_market_id"}` | |
| `POST /api/markets` | market_admin | `{"kind","symbol","title","closes_at"}`. `symbol` is 2 to 12 uppercase letters or digits and unique in the venue. `title` is 1 to 120 characters. `closes_at` is required for events, must be in the future by the server clock, and is absent for pairs | `201` Market with status `listed` | `409 {"error":"symbol_taken"}` |
| `POST /api/markets/{id}/open`, `/halt`, `/resume` | market_admin | none | `200` Market | 409 per Business rules |
| `POST /api/markets/{id}/resolve` | market_admin | `{"outcome":"yes"|"no"}` | `200` Market with status `resolved` | 409 per Business rules |
| `POST /api/markets/{id}/liquidations` | market_admin | none | `200 {"checked","liquidated":[{"position_id","quantity","mark_price","returned_cents"}]}` | `409 {"error":"not_a_pair"}` |

**Orders, fills, balances:**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `POST /api/orders` | trader or builder, **key** | Optional header `Idempotency-Key`. Pair body: `{"market_id","mode":"spot"|"margin","side":"buy"|"sell","price","quantity"}`. Event body: `{"market_id","outcome":"yes"|"no","price","quantity"}` | `201` Order after matching. A replay returns the stored status and body with header `Idempotent-Replayed: true` | `409 {"error":"market_not_trading","status":"<status>"}`; `409 {"error":"idempotency_conflict"}`; 422 `out_of_range` on `price` or `quantity`; `422 {"error":"validation","errors":{"quantity":"insufficient_funds"}}`, and the same body with `insufficient_holdings` or `exceeds_position` in place of `insufficient_funds` |
| `GET /api/orders?status=open|all&market_id=` | owner of the orders, **key** | | `200 {"orders":[Order]}`, newest first, at most 200 | |
| `GET /api/orders/{id}` | its owner, **key** | | `200` Order | |
| `DELETE /api/orders/{id}` | its owner, **key** | | `200` Order with status `cancelled` | `409 {"error":"invalid_transition","from":"<status>","to":"cancelled"}` |
| `GET /api/fills?market_id=` | owner, **key** | | `200 {"fills":[Fill]}`, newest first, at most 200 | |
| `GET /api/fills/{id}` | its owner, **key** | | `200` Fill | |
| `GET /api/balance` | member, **key** | | `200` Balance | |
| `GET /api/positions` | member, **key** | | `200 {"spot":[{"market_id","quantity","reserved"}],"margin":[{"id","market_id","side":"long"|"short","quantity","cost_cents","collateral_cents","status":"open"|"closed"|"liquidated","equity_cents","maintenance_cents"}],"event":[{"market_id","outcome","quantity"}]}` | |
| `POST /api/deposits` | trader or builder | Optional `Idempotency-Key`. `{"amount_cents","card_number"}` | `201` Deposit (succeeded) | `402 {"error":"payment_declined","deposit_id"}`; `503 {"error":"payments_unavailable"}`; `409 {"error":"idempotency_conflict"}` |
| `GET /api/deposits` and `GET /api/deposits/{id}` | owner | | `200 {"deposits":[Deposit]}` / `200` Deposit | |
| `GET /api/admin/deposits?q=` | market_admin | `q` matches member display name or email, case-insensitive substring | `200 {"deposits":[Deposit plus "member":{"id","display_name","email"}]}` | |
| `POST /api/deposits/{id}/refunds` | market_admin | `{"amount_cents"}` | `201 {"id","deposit_id","amount_cents","killbill_transaction_id","created_at"}` | `409 {"error":"deposit_not_refundable"}`; `422 ... {"amount_cents":"exceeds_refundable"}`; 503 `payments_unavailable` |
| `GET /api/admin/documents` | market_admin | | `200 {"documents":[{"id","member":{"id","display_name"},"filename","content_type","size_bytes","uploaded_at"}]}` | |
| `GET /api/admin/documents/{id}/link` | market_admin | | `200 {"url","expires_at"}` | 503 `documents_unavailable` |

**Statements:**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/statements` | member | | `200 {"statements":[{"id","month":"YYYY-MM","created_at"}]}` (own only) | |
| `GET /api/statements/{id}/link` | its owner | | `200 {"url","expires_at"}` | `503 {"error":"statements_unavailable"}` |
| `POST /api/venue/statements` | org_owner | `{"month":"YYYY-MM"}` | `202 {"month","members"}` for a new run; `200` with the same body when the month already ran | `422 ... {"month":"not_closed"}`; 503 `statements_unavailable` |

**Builder:**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/keys` | builder | | `200 {"keys":[{"id","name","created_at","revoked_at"}]}` | |
| `POST /api/keys` | builder | `{"name"}` (1 to 40 characters) | `201 {"id","name","secret","created_at"}`. `secret` is `pv_<id>_<40 lowercase hex>`, where `id` is 12 lowercase hex characters. It is returned only here | |
| `DELETE /api/keys/{id}` | its builder | | 204. The key stops working at once | |
| `GET /api/billing` | builder | | `200` Billing, re-read from Kill Bill on every call | |
| `POST /api/billing/plan` | builder | `{"plan":"sandbox"|"builder"|"desk"}` | `200` Billing after Kill Bill confirms | `409 {"error":"already_on_plan"}`; `409 {"error":"plan_locked"}`; `503 {"error":"billing_unavailable"}` |
| `POST /api/billing/pay` | builder | none | `200` Billing | `409 {"error":"nothing_due"}`; 503 `billing_unavailable` |
| `GET /api/webhooks` | builder | | `200 {"endpoint":{"url","svix_endpoint_id","signing_secret"}|null,"delivery":"ok"|"delayed","attempts":[{"message_id","event_type","event_id","status":"succeeded"|"pending"|"failed","response_status","timestamp"}]}` | |
| `PUT /api/webhooks/endpoint` | builder | `{"url"}` (http or https, at most 500 characters) | `200` the endpoint object | `503 {"error":"webhooks_unavailable"}` |
| `DELETE /api/webhooks/endpoint` | builder | | 204 | 503 as above |

**Owner:**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/venue/totals` | org_owner | | `200 {"members","open_orders","deposits_cents","refunds_cents","fees_cents","volume_cents_today","open_interest_contracts"}` | |
| `GET /api/venue/members?q=` | org_owner, market_admin | `q` is 1 to 60 characters, a case-insensitive substring of display name or email | `200 {"members":[{"id","display_name","email","roles"}]}`, sorted by display name, at most 10 | |
| `POST /api/venue/invites` | org_owner | `{"email","display_name","roles"}`. `roles` is a non-empty subset of `trader`, `builder`, `market_admin` | `201 {"member_id","email","roles"}` | `409 {"error":"already_member"}`; `503 {"error":"identity_unavailable"}` |
| `PUT /api/venue/fees` | org_owner | `{"taker_fee_bps","maker_fee_bps"}` | `200 {"taker_fee_bps","maker_fee_bps"}` | |
| `GET /api/venue/fills.csv?month=YYYY-MM` | org_owner | `month` defaults to the current venue month | `200 text/csv` with `Content-Disposition: attachment; filename="fills-<venue slug>-<YYYY-MM>.csv"` | 422 `month` |
| `GET /api/venue/billing` | org_owner | | `200 {"builders":[{"member_id","display_name","plan","effective_plan","state"}]}` | |

The CSV has this header row, then one row per fill of any member of the venue in that month, oldest first: `fill_id,filled_at,market_symbol,member_email,mode,side,outcome,price,quantity,fee_cents,liquidity`. Empty values are empty fields.

**Platform** (founder_operator only; nothing here carries member names, emails or ids):

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/platform/venues` | | `200 {"venues":[{"id","slug","name","time_zone","member_count","created_at"}]}` | |
| `POST /api/platform/venues` | `{"slug","name","time_zone","owner_email"}`. `slug` is 3 to 20 lowercase letters, digits or `-`. `name` is 1 to 60 characters. `time_zone` is an IANA zone | `201` the venue object; the owner gets an invite as in DP-53 | `409 {"error":"slug_taken"}`; 503 `identity_unavailable` |
| `GET /api/platform/health` | | `200 {"providers":{"keycloak","killbill","postgres","valkey","svix","minio","mailpit"},"checked_at"}`. Each value is `"up"` or `"down"`, from a check that waits at most 2 seconds | |

**Health:** `GET /api/health` answers `200 {"status":"ok"}` with no authentication whenever the process is serving.

### Business rules (DP-09, DP-13, DP-14, DP-16, DP-17, DP-18, DP-19, DP-22, DP-23, DP-24, DP-31, DP-32, DP-33, DP-35, DP-36, DP-38, DP-39, DP-42, DP-43, DP-48, DP-53)

**Money display.** `<amount>` is `$` followed by dollars with thousands commas and two decimals, e.g. `$1,000.00`. Event prices display as `<n>¢`.

**Ranges** (all limits inclusive):

| Field | Range | 422 code |
|---|---|---|
| Event price | 1 to 99 | `out_of_range` |
| Pair price | 1 to 1,000,000 cents | `out_of_range` |
| Quantity | 1 to 100,000 | `out_of_range` |
| Deposit `amount_cents` | 500 to 500,000 | `out_of_range` |
| Fee basis points | 0 to 1,000 whole numbers | `out_of_range` |

- `card_number` is 13 to 19 digits, spaces allowed, and must pass the Luhn check, otherwise `invalid`.
- `maker_fee_bps` above `taker_fee_bps` answers `exceeds_taker`.
- An ID document is 1 to 5,000,000 bytes and must be a PDF, PNG or JPEG, judged by its bytes. A larger upload answers 413.

**Fees.** Each order stores the venue's taker and maker rates in force when it is placed. Later fee changes apply only to orders placed after them. Each fill charges the incoming (taker) order its taker rate and the resting (maker) order its maker rate. The fee for one fill is `floor((notional_cents × bps + 5000) / 10000)`: half-up rounding, applied per fill, never per order.

**Holds.** On placement the order's maximum spend at its limit price moves from available to held:

- **Event buy or spot buy:** `price × quantity` plus the fee on that at the taker rate.
- **Spot sell:** the fee on `price × quantity` at the taker rate. The units are reserved from the seller's holdings.
- **Margin order that opens or grows a position:** collateral of `ceil(price × quantity / 2)` plus the fee on `price × quantity` at the taker rate.
- **Margin order that reduces a position:** the fee only.

If the hold is more than the available balance, the order answers 422 `insufficient_funds` and nothing changes. After each fill the order's hold is recomputed for its remaining quantity by the same formula. The amount actually spent leaves held, and the rest of the difference returns to available. When the order ends, its remaining hold returns to available and its reserved units are freed.

**Matching (one book per market).**

- **Priority.** Orders match by price-time priority: best price first, then earliest at the same price. Spot and margin orders on a pair sit on the same levels with no preference between them. A fill executes at the resting order's price.
- **Own orders.** An incoming order skips the same member's resting orders and continues to the next eligible order.
- **Event mirror.** A YES buy at `p` is a bid at `p`. A NO buy at `q` is an ask at `100 − q`. They cross when `p + q ≥ 100`. At execution price `e`, on the YES scale, the YES buyer pays `e` and the NO buyer pays `100 − e` per contract, and 100 cents per contract goes to the event's escrow.
- **Netting.** After each event fill, a member who holds both YES and NO of that event closes the smaller count of pairs. Each closed pair returns 100 cents from escrow to their available balance.
- **One market at a time.** Matching on one market is strictly one order at a time in arrival order. A resting quantity is never filled twice, and of two simultaneous orders the one committed first takes priority.
- **Response.** The order response reflects the book after its own matching.

For example, with the seed data at start: Ana buys YES at 37 for 120 contracts. That matches Bo's resting NO buy at 63, which is the ask at 37. Ana pays 4,440 cents plus a fee of 56 cents (125 basis points of 4,440 is 55.5, rounded half-up), 4,496 cents in all, and her order is filled. Bo pays 63 × 120 = 7,560 cents with no maker fee, and his order is partially filled with 80 remaining.

**Spot holdings.** A spot buy fill adds units to the buyer's holdings. A spot sell needs unreserved units at placement, otherwise 422 `insufficient_holdings`. When a margin short meets a spot buyer, the buyer's units come from the venue's lending inventory.

**Margin positions.** Each member has at most one margin position per pair, long or short, with quantity `q`, cost `C` (the sum of fill notionals) and collateral `K`.

- **Open or grow.** A margin buy grows a long and a margin sell grows a short. Each such fill moves `ceil(notional / 2)` from held to collateral.
- **Reduce.** An order on the opposite side reduces the position. At placement its quantity may not exceed `q` minus the quantity of the member's other resting reducing orders, otherwise 422 `exceeds_position`. A position never flips side.
- **Reduction by `r` at price `x`.** Basis `b = floor(C × r / q)` and released collateral `k = floor(K × r / q)`, or all of `C` and `K` when `r = q`. Profit or loss is `r × x − b` for a long and `b − r × x` for a short. Available receives `max(k + profit, 0)`. Any shortfall below zero is covered by the venue's insurance account. When `q` reaches 0 the position is `closed`.
- **Mark.** The mark is the pair's last trade price, or the seeded last price before any trade.
- **Equity and maintenance.** At mark `m`, equity is `K + (q × m − C)` for a long or `K + (C − q × m)` for a short. Maintenance is `ceil(q × m / 4)`.

**Maintenance check and liquidation.**

- **When.** Within 2 seconds after every fill on a pair, the server checks every open margin position on that pair at the new mark. A market admin's run-liquidations request does the same check at once and returns the result.
- **Liquidation.** A position whose equity is below maintenance is liquidated at the mark. Available receives `max(equity, 0)`, insurance covers any deficit, and the position's status becomes `liquidated`. Every resting margin order of that member on that pair ends as `liquidated` with its hold released.
- **Example.** A long of 10 opened at $25.00 (cost 25,000, collateral 12,500) is liquidated by the first trade at or below $16.66. At 1,666, equity is 4,160 against maintenance of 4,165. At 1,667, equity is 4,170 against 4,168, so it holds.

**Order state machine.**

- A new order with no fill is `resting`. Some fill makes it `partially_filled`, and a complete fill makes it `filled`.
- `resting` or `partially_filled` → `cancelled` happens by the owner's cancel or by an event's close.
- `resting` or `partially_filled` → `liquidated` happens for margin orders when the position is liquidated.
- `filled`, `cancelled` and `liquidated` are ended. Any further transition answers the `invalid_transition` 409.
- A cancel is allowed while the market is halted. Of two simultaneous cancels, one returns 200 and the other answers 409.

**Market state machine.**

- **Pair:** `listed → trading` (open), `trading → halted` (halt), `halted → trading` (resume).
- **Event:** the same three steps, plus `trading` or `halted` → `closed` at `closes_at`, `closed → resolved` (resolve, with outcome), and `resolved → settled` after payouts.
- **Rejections:** every other step answers `409 {"error":"invalid_transition","from":"<status>","to":"<status>"}`. Opening or resuming an event whose `closes_at` has passed answers the same 409 with `to` set to `trading`. Orders on a market that is not `trading` answer the `market_not_trading` 409.

**Time rules** (always the server clock, never the device):

- **Close.** An event is `closed` from its `closes_at` instant. Reads at or after it already report `closed`. Orders that arrive at or after it answer the `market_not_trading` 409 with status `closed`. Resting orders are cancelled within 2 seconds, and open market detail screens show `Trading closed` within 2 seconds.
- **Settlement.** Within 5 seconds of a resolution, each winning contract pays 100 cents from escrow to its holder, which empties the escrow, and the market becomes `settled`. Payouts post exactly once, even if the server restarts in the middle.
- **Overdue checks.** The app re-reads each builder's Kill Bill overdue state on every billing read and at least every `OVERDUE_POLL_SECONDS` seconds (default 15).
- **Final notice.** If a builder is still `payment_failed` `DUNNING_FINAL_NOTICE_SECONDS` seconds after the app recorded it (default 259,200), the final notice email is sent once.
- **Invites.** An invite link stays valid for `INVITE_TTL_SECONDS` seconds (default 604,800).
- **Statement links.** Statement and document links expire after 60 seconds.
- **Monthly statements.** Each statement covers a calendar month in the venue's time zone, from midnight on the 1st up to, but not including, midnight on the next 1st. Statements are generated automatically within 10 minutes after midnight on the 1st, venue time, for the month that just ended, by a server that is running at that time. Missed runs are never caught up at start: a month whose automatic run did not happen stays un-run until the org owner generates it. A month counts as already run once any run for that venue and month, automatic or by the org owner, has started.

**Builder plan state machine** (from Kill Bill's overdue state, never from a click):

- Kill Bill `WARNING` → `payment_failed`. `DOWNGRADED` → `downgraded`. The clear state → `active`. Any of these may follow any other, as Kill Bill reports.
- While `downgraded`, the effective plan is Sandbox. When the app records `downgraded`, it sets every one of the builder's keys to the Sandbox rate before the same request or check finishes. When Kill Bill clears the account, the rate returns to the plan's rate the same way.
- Plan changes answer the `plan_locked` 409 while `payment_failed` or `downgraded`.
- Upgrades (Sandbox → Builder → Desk) take effect at once with Kill Bill's proration. Downgrades take effect on the date Kill Bill reports for the change, which is the subscription's charged-through date. Until then `plan` stays the current plan and `pending_plan` and `pending_effective_date` show the change.
- Builders start on Sandbox with no Kill Bill subscription.

**Rate limits** (API-key requests only). Each key has a bucket that holds up to its rate and refills at its rate per second:

| Plan | Requests per second |
|---|---|
| Sandbox | 2 |
| Builder | 20 |
| Desk | 100 |

A request finding the bucket empty answers the 429.

**Idempotency** (orders and deposits).

- **Key format.** `Idempotency-Key` is 1 to 64 letters, digits, `-` or `_`, otherwise `422 ... {"Idempotency-Key":"invalid"}`. Keys belong to one member and one endpoint and never expire.
- **Replay.** The same key with an identical body (compared as parsed JSON) returns the first response's status and body unchanged, even if the order has since changed. It creates no second order, hold, fee, Kill Bill payment or email.
- **Conflict.** The same key with a different body answers `idempotency_conflict`.
- **Concurrency.** Of simultaneous requests with one key, exactly one executes and the others return its replay.

**Deposits and refunds.**

- A deposit credits available only after Kill Bill reports the PURCHASE as `SUCCESS`. Any other result records the deposit as `declined` with the 402 and no ledger entry. Kill Bill unreachable creates no deposit.
- A refund needs a `succeeded` deposit, otherwise `deposit_not_refundable`. Its `<refundable>` cap is the smaller of the deposit's amount minus earlier refunds and the member's current available balance. A refund above the cap answers `exceeds_refundable`.
- The ledger debit posts only after Kill Bill reports the refund `SUCCESS`. Refunds on one member are processed one at a time, so of two simultaneous refunds that together exceed the cap, one succeeds and the other answers 422.

**Ledger.** Every change to any balance (deposit, refund, hold, release, fill, fee, netting, payout, margin reduction, liquidation) is one journal entry. Each entry has at least two legs whose signed amounts sum to exactly zero. Entries and legs are never edited or deleted: a correction is a new reversing entry. A member's available, held and collateral balances equal the sums of their legs, and the sum of all legs of a venue is zero. Account names and tables are in Services.

**Derived values** (computed when read):

- An event's `open_interest` is the number of YES contracts its members hold after netting, which always equals the number of NO contracts held. It is 0 once the market is settled.
- A pair's `open_interest` is the total quantity of every open margin position on that pair, longs and shorts added together. Spot holdings do not count.
- `open_interest_contracts` is the sum of `open_interest` over every market of the venue.
- `members` counts every person in the venue with any role, org owners, market admins and invitees who have not yet accepted included.
- `open_orders` counts the venue's orders in `resting` or `partially_filled`.
- `deposits_cents` is the sum of `amount_cents` of the venue's `succeeded` deposits of all time. Declined deposits do not count.
- `refunds_cents` is the sum of the venue's succeeded refunds of all time.
- `fees_cents` is the sum of `fee_cents` of every fill of the venue of all time, maker and taker fills both.
- `volume_cents_today` (in totals and summary) is the sum, over the venue's trades since midnight today in the venue's time zone, of execution price times quantity, counting each trade once rather than once per side, with event prices on the YES scale.

For example, with the seed data at start, the harbor totals are `members` 5, `open_orders` 6, `deposits_cents` 400,000, and 0 for `refunds_cents`, `fees_cents`, `volume_cents_today` and `open_interest_contracts`. After the matching example above, RAIN's `open_interest` is 120, harbor's `volume_cents_today` is 4,440 and `fees_cents` is 56.

**Tenancy.** Every venue-owned record belongs to exactly one venue. Every read, list, count, search, export, statement, webhook and stream event carries only the caller's venue.

**Invites.** An invite creates the person in Keycloak in the venue with the chosen roles and the required action `UPDATE_PASSWORD`, and emails them a one-time link. Accepting sets their password, removes the required action and makes the link unusable. An email already registered in that venue answers `already_member`.

### Services (DP-06, DP-09, DP-11, DP-12, DP-13, DP-14, DP-39, DP-42, DP-43, DP-45, DP-46, DP-47, DP-48, DP-49, DP-50, DP-53)

Every instance that shares a database drains the same outgoing queue of emails and webhook messages. A message queued by an instance that cannot reach its provider is delivered by any instance that can, and each is delivered once.

**Keycloak** (`KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`)

- **Realm and roles.** Everyone signs in through the one realm `KEYCLOAK_REALM`. At start the app creates any missing realm roles (`trader`, `builder`, `market_admin`, `org_owner`, `founder_operator`) and one group per venue named `venue-<venue slug>`, using the `app` client's own service account.
- **Browser sign-in.** The authorization-code flow against `AUTH_ISSUER_URL`. Each attempt gets a fresh random `state` and `nonce` and an S256 code challenge, all bound to a short-lived HttpOnly cookie in the browser that started it.
- **Callback.** The callback is accepted only once, only with a `state` matching that browser's cookie, and only within 10 minutes. A missing, foreign or reused `state` gives the sign-in error page, sets no `pv_session`, and does not exchange the code.
- **Script sign-in.** `POST /api/session` uses Keycloak's password grant with the `app` client.
- **What a session carries.** Realm roles come from the token. The venue comes from the person's venue group, read through the admin API, never from the browser. A person in no venue group (for example, self-registered) gets a session with `venue` null.
- **Seeded people.** The app creates the seeded people at start if they are missing: permanent passwords, verified emails, groups and roles. A user that already exists is left as it is.
- **Outage.** Sign-in shows the unavailable page, `POST /api/session` and invites answer 503 as listed in API, and existing sessions keep working.

**Kill Bill** (`KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`)

- **Accounts.** One Kill Bill account per member per venue, created on first need: external key `<venue slug>:<member id>`, the member's name and email, currency USD. Each account gets a default payment method on the `__EXTERNAL_PAYMENT__` plugin. Only the card's last four digits are passed to Kill Bill as a plugin property. The full card number is never stored or logged.
- **Deposits.** A deposit is a PURCHASE on the depositor's own account, with `paymentExternalKey` and `transactionExternalKey` both `deposit-<deposit id>`, amount in dollars, currency USD. A replayed request reuses the same keys.
- **Refunds.** A refund is a REFUND on that payment, with `transactionExternalKey` `refund-<refund id>`.
- **Catalog.** At start, if the tenant's catalog lacks it, the app uploads a catalog with product `BuilderApi` and three monthly in-advance USD plans: `sandbox-monthly` at $0.00, `builder-monthly` at $49.00 and `desk-monthly` at $249.00. Upgrades are immediate and downgrades are end of term.
- **Overdue configuration.** At start, if the tenant has none, the app uploads an overdue configuration with two states:
  - `WARNING`: at least 1 unpaid invoice.
  - `DOWNGRADED`: at least 2 unpaid invoices, with plan changes blocked.
  - The grace therefore lasts until the next renewal also goes unpaid.
- **Renewals and failures.** A renewal fails when Kill Bill leaves its invoice unpaid, for example because the account carries the `AUTO_PAY_OFF` tag or its payment failed. The app never decides this itself. `GET /api/billing` reports Kill Bill's invoices and items exactly as Kill Bill holds them. `POST /api/billing/pay` pays every unpaid invoice through Kill Bill with the account's default payment method.
- **Subscriptions.** A plan subscription's bundle external key is `plan-<member id>`.
- **Outage.** Deposits and refunds answer `payments_unavailable`. Plan changes and payments answer `billing_unavailable`. `GET /api/billing` answers 200 with the last recorded state and `"provider":"unavailable"`. Orders, fills and every other screen keep working.

**Postgres** (`DATABASE_URL`)

- **Contents.** Postgres holds every product record. The schema is applied idempotently on every start.
- **Ledger tables.** The ledger lives in two tables that observers read:
  - `journal_entries(id, venue_id, kind, reference_id, created_at)`
  - `journal_legs(id, entry_id, venue_id, account, amount_cents)`, where `amount_cents` is a signed integer.
- **Account names:**
  - `member:<member id>:available`, `member:<member id>:held`, `member:<member id>:collateral`
  - `venue:card_clearing`, `venue:fees`, `venue:insurance`
  - `venue:escrow:<market id>`, `venue:margin_lending:<market id>`
- **Outgoing queue.** Fills, liquidations, settlements, emails and webhook messages are written to an outgoing queue in the same transaction as the change that causes them. Workers in every instance claim queue rows without blocking one another, and each row is processed exactly once.
- **Seeding.** Seed data is applied once per database, under a lock.

**Valkey** (`VALKEY_URL`)

- **Rate limits.** Key `ratelimit:<key id>` is a hash with fields `rate` (the key's current requests per second), `tokens` and `updated_ms`, and has no expiry. `rate` is written when a key is created and whenever the builder's effective plan changes. Revoking a key deletes its hash.
- **Live fan-out.** Book, trade and market events are published on channel `market:<market id>`. Member-only events (balance, order, fill, liquidation) go on `member:<member id>`. Every instance relays them to its open streams.

**Svix** (`SVIX_URL`, `SVIX_API_KEY`)

- **Applications and endpoints.** Each venue has one application with uid `venue-<venue slug>`, created when first needed. Each builder's saved endpoint has uid `member-<member id>` and channel `member-<member id>`. The signing secret shown to the builder is that endpoint's secret.
- **Messages.** Each message is sent with its `eventId` set to the payload's `event_id`, the same value as the idempotency key, and the channel `member-<member id>` of the builder it concerns. Only that builder's endpoint receives it.
- **Delivery.** Svix signs every delivery (`webhook-id`, `webhook-timestamp`, `webhook-signature`), retries failed deliveries on its schedule with the same message id, and stops after a success. The webhooks screen lists Svix's delivery attempts for the endpoint.
- **Event types and payloads.** No payload ever contains a member's name, email or id, or anything about the counterparty.
  - `order.filled`, one per fill of the builder's own order: `{"event_id":"fill_<fill id>","type","venue","market_id","market_symbol","order_id","fill_id","mode","side","outcome","price","quantity","fee_cents","liquidity","order_status","remaining_quantity","filled_at"}`. `venue` is the venue slug.
  - `position.liquidated`: `{"event_id":"liq_<position id>","type","venue","market_id","position_id","side","quantity","mark_price","returned_cents","liquidated_at"}`
  - `event.settled`, one per builder holding contracts in the settled market: `{"event_id":"settle_<market id>_<position key>","type","venue","market_id","outcome","contracts","payout_cents","settled_at"}`. `<position key>` is the builder's event position id.
- **Outage.** Messages stay queued and are retried every 5 to 60 seconds, the gap doubling each time. Fills and settlements are never blocked. Saving or removing an endpoint answers `webhooks_unavailable`, and `GET /api/webhooks` answers 200 with `"delivery":"delayed"`, the stored endpoint and no attempts.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`)

- **Statements.** Each statement is stored at `venues/<venue id>/statements/<member id>/<YYYY-MM>.pdf` with content type `application/pdf`. The object's bytes are exactly the PDF the app rendered, and the app never renders it again for that month.
- **Statement content.** The app renders the PDF itself as real extractable text. It holds the venue name, the member's display name, the month, the opening and closing total balance, and every deposit, refund, fill (symbol, mode or outcome, side, price, quantity, fee), payout, netting and liquidation of that member in the month. It holds nothing about any other member.
- **ID documents.** Documents are stored at `venues/<venue id>/documents/<member id>/<document id>`.
- **Links.** Links are presigned GET URLs on `S3_ENDPOINT`, valid for 60 seconds, issued only to the statement's owner or to a market admin of the document's venue. The bucket stays private.
- **Outage.** Statement links and generation answer `statements_unavailable`, and uploads and document links answer `documents_unavailable`. A scheduled run that cannot store a statement retries every minute until it succeeds.

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`). Every email is from `Plumtide Venue <venue@plumtide.example>`, which is `MAIL_FROM`, and goes to one recipient only:

| When | To | Subject |
|---|---|---|
| A deposit succeeds | the depositor | `Deposit received — <amount>`. Body: amount, card last four, deposit id, time in the venue's time zone, new available balance |
| A refund succeeds | the deposit's owner | `Refund issued — <amount>` |
| Plan state becomes `payment_failed` | the builder | `Payment failed — your <Plan> plan` |
| Final notice time rule | the builder | `Final notice — your <Plan> plan` |
| Plan state becomes `downgraded` | the builder | `Your plan is now Sandbox` |
| Plan state returns to `active` from `payment_failed` or `downgraded` | the builder | `Your <Plan> plan is active again`, where `<Plan>` is the restored plan |
| A statement is stored | its owner | `Your <Month YYYY> statement is ready`. Body: the link `<APP_PUBLIC_URL>/statements` and nothing from the statement |
| An invite is created | the invitee | `You're invited to <venue name>`. Body: the link `<APP_PUBLIC_URL>/invites/<token>` |

Each email is sent once per event. No email carries another member's name, email or account id. While SMTP is unreachable, emails stay queued, are retried every 10 seconds, and arrive within 60 seconds of mail becoming reachable for any instance. No API response changes.

### Seed data (DP-15, DP-16, DP-17, DP-26, DP-31, DP-51)

Every venue, person, market and amount below is invented. The seed is applied at first start of a database. Seed deposits are real Kill Bill purchases, made the same way as DP-09 deposits. An instance that starts without Kill Bill does not seed funded records and serves whatever an instance with Kill Bill has seeded in the shared database.

**Venues:**

| Slug | Name | Time zone | Taker fee | Maker fee | Flagship |
|---|---|---|---|---|---|
| `harbor` | Harbor Lantern Club | America/New_York | 125 bps | 0 bps | `RAIN` |
| `copper` | Copperfield Pool | Europe/London | 50 bps | 10 bps | `FROST` |

**People.** All passwords are `plumtide-demo-26`.

| Username | Display name | Email | Venue | Roles |
|---|---|---|---|---|
| `hl-owner` | Mara Quill | mara.quill@harbor.example | harbor | org_owner |
| `hl-admin` | Teo Brandt | teo.brandt@harbor.example | harbor | market_admin |
| `hl-ana` | Ana Pike | ana.pike@harbor.example | harbor | trader |
| `hl-bo` | Bo Lindqvist | bo.lindqvist@harbor.example | harbor | trader |
| `hl-ines` | Ines Okafor | ines.okafor@harbor.example | harbor | builder |
| `cp-owner` | Wren Ashdown | wren.ashdown@copper.example | copper | org_owner |
| `cp-admin` | Juno Hale | juno.hale@copper.example | copper | market_admin |
| `cp-pell` | Pell Varga | pell.varga@copper.example | copper | trader |
| `cp-odile` | Odile Marsh | odile.marsh@copper.example | copper | builder |
| `plumtide-founder` | Sol Rennick | sol.rennick@plumtide.example | none | founder_operator |

**Markets.** "Seed time" is when the seed ran.

| Venue | Symbol | Kind | Title | Status | Close | Last price |
|---|---|---|---|---|---|---|
| harbor | `RAIN` | event | Will Harbor Point log more than 4 inches of rain this month? | trading | 30 days after seed time | none |
| harbor | `FERRY` | event | Will the winter ferry run every day this week? | trading, empty book | 30 days after seed time | none |
| harbor | `GALA` | event | Will the lantern gala sell out? | listed | 60 days after seed time | none |
| harbor | `LANT` | pair | Brass Lantern shares | trading | | $25.00 |
| copper | `FROST` | event | Will Copperfield see frost before the solstice? | trading | 30 days after seed time | none |
| copper | `CU` | pair | Copper bar units | trading | | $8.00 |

**Deposits** (Kill Bill purchases, card ending 4242):

| Member | Deposit |
|---|---|
| Ana | $1,000.00 |
| Bo | $1,000.00 |
| Ines | $2,000.00 |
| Pell | $500.00 |
| Odile | $500.00 |

**Holdings and plans.** Bo holds 50 LANT spot units. Ines is on the Builder plan through a Kill Bill subscription created at seed time and paid. Odile is on Sandbox with no subscription.

**Resting orders**, placed in this order with holds by the Business rules:

| Member | Market | Order |
|---|---|---|
| Bo | RAIN | buy NO at 63 for 200 (YES ask 37) |
| Bo | RAIN | buy NO at 60 for 100 (YES ask 40) |
| Ana | RAIN | buy YES at 34 for 150 |
| Ana | RAIN | buy YES at 30 for 80 |
| Ana | LANT | spot buy 10 at $24.00 |
| Bo | LANT | spot sell 20 at $26.00 |
| Pell | FROST | buy YES at 45 for 100 |

For example, with the seed data at start:

| Member | Available | Held |
|---|---|---|
| Ana | 68,106 cents | 31,894 cents |
| Bo | 80,517 cents | 19,483 cents |
| Pell | 45,477 cents | 4,523 cents |

The RAIN book shows bids 34 (150) and 30 (80) and asks 37 (200) and 40 (100).

## Technical requirements

### Deployment (DP-55)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22.

- **Manifest.** Node 22 and npm are the runtime. `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```

- **Port.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- **Health.** `GET /api/health` returns the 200 body from API.
- **Startup.** Schema, Keycloak roles and groups, the Kill Bill catalog and overdue configuration, and the seed data are all applied idempotently on `serve`, not only at build.
- **Workers.** The outgoing-queue workers, the close timer, the maintenance checks, the overdue checks and the monthly statement run all live in the serving process.

### Configuration and secrets (DP-59)

- **Read at start from the environment:**
  - Postgres: `DATABASE_URL`
  - Keycloak: `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`
  - Kill Bill: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
  - Valkey: `VALKEY_URL`
  - Svix: `SVIX_URL`, `SVIX_API_KEY`
  - MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
  - Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
  - App: `APP_PUBLIC_URL`, `APP_PUBLIC_PORT`, `OVERDUE_POLL_SECONDS`, `DUNNING_FINAL_NOTICE_SECONDS`, `INVITE_TTL_SECONDS`
- **Never exposed.** No credential or service URL is hard-coded in source, written to logs, or sent to the browser. The only service URLs the browser ever sees are the Keycloak sign-in redirect and presigned MinIO links.
- **Stored secrets.** API key secrets are stored only as hashes. Session ids are random and stored server-side.

### Server boundary (DP-56)

- **Same origin.** The browser talks only to the app's own origin, apart from the Keycloak sign-in page and presigned MinIO links. The server sends no CORS headers.
- **Origin check.** The allowed origin is the request's own origin: the scheme it arrived on plus its `Host` header, host and port. A state-changing request whose `Origin` header names any other origin answers `403 {"error":"bad_origin"}`. A request with no `Origin` header is allowed. Because each instance compares against its own address, the outage instances at their own URLs follow the same rule. `APP_PUBLIC_URL` is used only for links in emails.
- **Cookie.** `pv_session` is HttpOnly, `SameSite=Lax`, `Path=/`.
- **Size limits.** JSON bodies may be up to 65,536 bytes; a larger body answers `413 {"error":"payload_too_large"}`. Document uploads may be up to 5,000,000 bytes of file content; larger answers the same 413.
- **What is served.** The server serves only built frontend assets and the API. Source files, `run.json`, package manifests, lockfiles, environment files and anything outside the build output answer 404.
- **Provider unreachable at boot.** The server still starts and `/api/health` answers 200. Each feature that needs the missing provider answers its 503 from API until the provider returns, and startup tasks for that provider are retried every 10 seconds.

### Browser support and performance (DP-25, DP-30)

- **Browsers and viewports.** Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch.
- **Load time.** Every screen is usable within three seconds of navigation, and the orbit or ladder draws the book within three seconds.
- **Live updates.** Live updates appear within one second of the server commit.
- **Ticket responsiveness.** The ticket summary updates within a tenth of a second of each keystroke.
- **Fonts.** Parkinsans and Urbanist are served from the app itself.

## Working rules

- IF-01: `/app/run.json` exists with `"_schema":"run-manifest-v1"` and string `install`, `build` and `serve` commands, and `install` uses the committed lockfile (`npm ci`).
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package, meaning the production dependency tree from `npm ls --omit=dev --all --json`, with its licence, plus the two font families.
- IF-03: Every shipped package (same definition as IF-02) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0, and the fonts under the SIL Open Font License 1.1.
- IF-04: The app uses no datastore, queue, cache or external network service beyond Postgres, Valkey, Keycloak, Kill Bill, Svix, MinIO and the SMTP sink (no SQLite, no file-based database, no CDN at runtime).
- IF-05: The app never changes the Keycloak `app` or `gf-observer` clients, the realm's registration and login settings, the Kill Bill tenant's credentials, or the MinIO bucket's access policy.
- IF-06: All application source, backend and frontend, is TypeScript. Only tool configuration files may be plain JavaScript.
- IF-07: `package-lock.json` is committed and every dependency version in `package.json` is exact.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` outside third-party type gaps.
- Names in code match the domain terms in this brief: venue, member, market, order, fill, hold, position, collateral, mark, journal entry, leg, deposit, refund, statement, plan, dunning.
- Each domain rule is decided in exactly one place in the source, for example a market or order transition, a fee rounding, a hold formula, the maintenance check, or the mapping from overdue state to plan state.
- No abstraction has only one implementation, and there are no defensive checks for states the types or the state machines already rule out.
- There is no dead, commented-out or unreachable code, and no feature, endpoint, screen or setting beyond this brief.
- Every error response uses the one shape from API. Provider failures map to the published 503 codes in one consistent way.
- Money is integer cents end to end, and no floating-point arithmetic touches money or prices.
- All state changes that touch balances happen inside one database transaction together with their journal entry and outgoing queue rows.
