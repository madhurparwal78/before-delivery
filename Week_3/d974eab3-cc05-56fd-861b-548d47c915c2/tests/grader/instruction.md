# Alder Quay Laboratories Vireo Pace

Vireo Pace is a public brand site from Alder Quay Laboratories, a mid-size consumer health maker. It tells one story in seven chapters, from a breath of air to the energy a cell spends, and then explains a plant-based daily drink stick made with red beet root. Anyone curious about how the body makes and spends energy can read it, and store advisors use its product chapter and printed product sheet. Build it in TypeScript on Node 22. It uses two backend services. Postgres holds the one published content record: the product, the interviews and the eight lifestyle scenarios. Gotenberg prints the product information sheet PDF from that same stored product record. Out of scope: accounts, sign-in, sessions, cart, checkout, payment, newsletter, search, comments, AI features, editor screens, dashboards and any extra datastore. Also out of scope: external fonts, scripts, images, video or content networks, WebGL, canvas animation loops and video. The site makes no health claim. Its science chapters explain textbook physiology and what is in the stick. Nothing on the site says the stick changes energy, performance, oxygen use, sleep or health. Every interviewee is a fictional profile who talks about their own routines and never about results from the product.

## Problem and users

Consumer health makers usually explain a daily wellness product across several agency microsites: a science page, a product page with its printed leaflet, an interview series and a lifestyle campaign. Each one holds its own copy of the facts. When a serving amount or an ingredient line changes, these copies drift apart, and readers meet three different products. Readers also leave because these sites are built for one mouse on one large screen:

- chapters only work with a scroll wheel
- carousels can't be reached by keyboard or screen reader
- motion ignores the reduced-motion setting
- on phones, swiping a sideways story drags the whole page

Vireo Pace keeps one published content record. Every page reads it through the site's own API, and the product sheet is printed from the same stored product record, so the downloaded sheet always says what the page says.

- **Visitor** (occasional): follows the chapter story from breath to cellular energy, learns what is in the stick, reads interviews and moves between the ON and OFF lifestyle scenarios by mouse, keyboard, screen reader or touch.
- **Store advisor** (weekly): opens the product chapter and downloads the product information sheet PDF to answer a customer's question about ingredients and use.
- **Communications lead** (weekly): publishes one content record for chapters, interviews, scenarios and product facts, so that the pages and the printed sheet never disagree. In this build the lead's publishing step is the grading route in API, which replaces the record or restores the starting content.

## Journeys

1. **Reading the story.** A visitor opens `/` with the starting content. They scroll down through Opening, About, Oxygen & Energy, Science & Technology, Product, Interviews and Lifestyle, then back up. The chapter rail and the address hash follow the chapter in view. They press a rail stop and land on that chapter with its heading focused and clear of the header. They copy the address, open it in another browser and land on the same chapter.
2. **Breath to energy.** A visitor on a laptop scrolls through About and Oxygen & Energy. The Inner Pace panels slide past and the oxygen stages advance with the scroll. They return to Oxygen & Energy with the keyboard, step through the five stages with the arrow keys and hear each stage announced once. A visitor on a phone swipes the Inner Pace panels sideways instead.
3. **What is in the stick.** A visitor opens the Science & Technology disclosures with Enter and Space and moves the nitrate pathway slider with the arrow keys. They follow `See the amounts per stick` to the Product chapter, read the ingredients table and the not-a-medicine notice, and turn the pack to its back view.
4. **The store advisor's sheet.** The communications lead publishes a changed product record. A store advisor opens Product, sees the new facts and presses `Download product sheet (PDF)`. They hear that the sheet is being prepared, then that it is ready, and receive a PDF with the same facts and the new edition number. If the print service is down, the advisor sees the published outage alert and the rest of the site keeps working. Once the print service is back, the next download works without the site being restarted.
5. **Interviews.** A visitor filters the interviews to Experts and opens one. The address becomes `/interviews/<slug>`. They move to the next interview with the arrow key, go back with the browser's back button and return to the list. A mistyped interview address shows the published not-found page.
6. **A whole day, ON and OFF.** In Lifestyle, a visitor picks OFF and the stage turns from paper to night. They choose Rest, and the marker, picture, copy, address and announcement all agree. When they switch back to ON, Work comes back, because it is the ON scenario they started on. They switch scenarios quickly, and the panel always ends on the scenario they chose last. They share the address, and a second browser opens the same mode and scenario.
7. **Phone, keyboard and reduced motion.** A visitor on a 375 px touch phone uses the menu, the swipeable rows and the scenario picture. A keyboard-only visitor tabs through the page in the published order and uses the menu dialog. A visitor with reduced motion set sees every change happen at once with the same content, announcements and addresses.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Chapter tour journey** Starting from the starting content, a visitor reads the seven chapters in order, sees the rail and the address follow the scroll both ways, jumps by a rail link and opens the copied chapter address in a fresh browser on the same chapter.
- **DP-02 — Exact starting content** After a restore through the grading route, and on first start with an empty database, the content API reports edition 1, and every page shows exactly the starting content of Seed data with the edition line reading edition 1.
- **DP-03 — Current chapter in rail and address** The current chapter, decided by the rule in Business rules, is the only one marked current in the rail and the open menu and is named by the address hash, updating in both scroll directions without adding history entries.
- **DP-04 — Chapter jumps land clear of the header** Every chapter link and every opened chapter address brings that chapter's heading into view clear of the header with focus on it, within the time set in Business rules.
- **DP-05 — Grading route** The grading route replaces or restores the whole content record with the exact statuses, bodies, shape rules and error order given in API.
- **DP-06 — Inner Pace journey** A visitor follows the three Inner Pace panels by scrolling on a wide screen, by the panel buttons on the keyboard and by swiping on a phone, hearing each button or swipe change announced once.
- **DP-07 — Scroll-led Inner Pace story** On wide screens without reduced motion the About chapter stays in view while its progress, panel and track position follow the scroll formula in Business rules in both directions.
- **DP-08 — Panel buttons** `Previous panel` and `Next panel` move to the published panel positions, are disabled at the ends and announce the panel reached.
- **DP-09 — Inner Pace row** Below the wide layout, or with reduced motion at any width, the panels sit in one sideways row that snaps panel by panel, follows a finger swipe and is moved by the buttons as qualified in Business rules.
- **DP-10 — Oxygen journey** A visitor follows the five oxygen stages by scrolling and by the stage tabs, and the selected tab, the diagram's dot and the announcement always name the same stage.
- **DP-11 — Scroll-led oxygen stages** On wide screens without reduced motion the Oxygen & Energy chapter stays in view while its progress, stage, selected tab and dot follow the scroll formula in Business rules, the dot moving only forward as the scroll moves forward and only back as it moves back.
- **DP-12 — Stage tabs by keyboard** The `Oxygen stages` tabs follow the tab keyboard rules, jump the page to each chosen stage's published position, keep focus on the tab and announce the stage once.
- **DP-13 — Oxygen stages without pinning** Below the wide layout, or with reduced motion, the Oxygen & Energy chapter is not held in view and the stage changes only through the tabs, with the dot jumping to that stage's point.
- **DP-14 — Science journey** A visitor opens the ingredient disclosures, steps the nitrate pathway slider through its three steps and follows the amounts link to the Product chapter.
- **DP-15 — Collapsed disclosures are unavailable** Each Science disclosure starts collapsed, toggles with Enter, Space or a click, reports its state, and while collapsed nothing inside it is visible, focusable or exposed to a screen reader.
- **DP-16 — Nitrate pathway slider** Slider `Nitrate pathway` follows the slider keyboard and pointer rules, reports its step name and keeps the diagram's highlighted step and the step text equal to its value.
- **DP-17 — Not-a-medicine notice** The not-a-medicine notice built from the stored product name appears character for character in Science & Technology, the Ingredients tab and the product sheet.
- **DP-18 — Science spreads look** The science chapters read as paper-white spreads with wide margins, hairline rules and app-drawn diagrams in which the oxygen and beet colours mark their subjects.
- **DP-19 — Product sheet journey** After the communications lead publishes a changed product, the Product chapter, the store page and a freshly downloaded product sheet all show that product and the new edition number.
- **DP-20 — Product sheet PDF** `GET /api/product/sheet` renders a fresh PDF from the stored product record on every request, with the published filename and the published text in order.
- **DP-21 — Sheet pending and ready states** Pressing `Download product sheet (PDF)` shows and announces the pending state, then downloads the file and announces it is ready, keeping focus on the button.
- **DP-22 — Sheet outage and recovery** When Gotenberg cannot be reached, errors or is too slow, the sheet answers the published outage, the button shows the published alert, health reports the outage, every other part of the site keeps working and the next request after Gotenberg returns succeeds without a restart.
- **DP-23 — Service settings from the environment** The database address, the Gotenberg address and the grading key are read from the environment at start and are never written into the source or sent to the browser.
- **DP-24 — Product keyboard journey** A keyboard-only visitor reads every product information tab, turns the pack through its three views and downloads the product sheet, hearing each result announced once.
- **DP-25 — Product information tabs** The `Product information` tabs follow the tab keyboard rules and show the stored details, the ingredients table with formatted amounts and the how-to-use steps, storage and cautions.
- **DP-26 — Pack view** The `Pack view` radios turn the drawn pack to the chosen view within the published time, rename the pack picture and announce the view.
- **DP-27 — Online store page** `/store` shows each stored pack with its price and a link for each stored store that opens in a new tab without access to the site.
- **DP-28 — Pack and portrait art** The pack, the interview portraits and the scenario pictures are drawn by the site with shapes, show the product name on the pack, and differ visibly per interview hue and per scenario.
- **DP-29 — Interview journey** A visitor filters the interviews, opens one at its published address, moves between interviews by link and arrow key, returns with the back button and meets the published page for an unknown interview.
- **DP-30 — Interview filter** The `Show interviews` radios show only the chosen category in published order and announce the number shown.
- **DP-31 — Interview pages** Each `/interviews/<slug>` page has the published title, focused heading, answers and previous and next links in published order, and ArrowLeft and ArrowRight open the neighbours.
- **DP-32 — Content and interview API** `GET /api/content` and `GET /api/interviews/<slug>` answer with the exact shapes, order and errors given in API.
- **DP-33 — Not-found and information pages** Unknown addresses answer HTTP 404 with the published not-found pages, and the contact, privacy and legal pages show their published copy and titles.
- **DP-34 — ON/OFF journey** A visitor switches between ON and OFF by click and keyboard, sees the stops, stage, picture, copy and address change together, and finds the same view after reload and in a second browser.
- **DP-35 — Mode remembers its scenario** Choosing a mode shows that mode's four stops and selects the scenario last chosen in that mode during the page visit, with the start scenario counting as chosen, or the mode's first scenario in the scenario order if none was chosen.
- **DP-36 — Meridian address** The scenario lives in the address, reloading or opening the address in another browser shows the same mode and scenario, and an unknown scenario falls back as stated in Business rules.
- **DP-37 — Stage colour change** Switching mode turns the Lifestyle chapter between the bright paper stage and the night stage within the published time, with readable text on both.
- **DP-38 — Scenario journey** A visitor chooses each of the eight scenarios by keyboard, click and swipe and always reads the scenario they chose last, with one announcement per change.
- **DP-39 — Scenario panel** Each scenario choice shows that scenario's picture name, title, time, copy and moment line from the stored record and marks the panel busy while it loads.
- **DP-40 — Latest choice wins** When an earlier scenario's answer arrives after a later choice, the panel, the attributes, the address and the announcement still show only the later choice.
- **DP-41 — Scenario API** `GET /api/scenarios/<id>` answers with the exact shape and errors given in API.
- **DP-42 — Server boundary** The server answers only on its own origin, enforces the request body limit, never serves source files or credentials and follows the API error order.
- **DP-43 — Keyboard journey** A keyboard-only visitor tabs through the page in the published order, skips to the story, opens and leaves the menu dialog and reaches every chapter without a pointer.
- **DP-44 — Tab order and skip link** Each published viewport has the exact Tab order of Interactions, and `Skip to story` moves focus to the first heading of the main content.
- **DP-45 — Menu dialog** The `Menu` dialog takes focus, keeps Tab inside, closes with Escape or its close button and returns focus, and while it is closed nothing inside it can be reached.
- **DP-46 — Visible focus ring** Every focusable control shows the published focus ring only while it has focus.
- **DP-47 — Phone journey** A visitor on a 375 px touch phone uses the menu by taps and swipes the Inner Pace row, the interview row and the scenario picture without the page moving sideways.
- **DP-48 — Touch targets and no sideways page scroll** At every published viewport no page scrolls sideways, and at 375x812 every control is at least the published tap size.
- **DP-49 — Interview row and scenario swipes** At 375x812 the interview row moves card by card under a finger, and a swipe across the scenario picture chooses the next or previous scenario as qualified in Business rules.
- **DP-50 — Motion journey** A visitor with motion sees the opening words, chapter headings, menu and Meridian move as published, and the same visitor with reduced motion gets the same end states at once.
- **DP-51 — Published motion only** Each motion in Motion and effects runs within its published timing, and nothing else on the site moves on its own.
- **DP-52 — Reduced motion** With reduced motion every published motion is an instant change, no chapter is held in view, and content, announcements, addresses and focus are exactly as with motion.
- **DP-53 — Responsive journey** One address opened at 1280x800, 768x1024 and 375x812 shows the same scenario in each published layout, and content published in the middle shows in a fresh browser while the open pages keep what they loaded until reload, as qualified in Business rules.
- **DP-54 — Published layouts** The header, rail, interview list, product chapter, Meridian stops and footer take the published arrangement at 1280x800, 768x1024 and 375x812.
- **DP-55 — One edition across browsers** A change published through the grading route shows on the next page load in any browser, while a page already open keeps what it loaded, except for scenarios it fetches afterwards, as qualified in Business rules.
- **DP-56 — Visual direction** The site alternates hushed night stages and clinical paper spreads in the published palette and type, with leaf green kept for actions and the active stop and every text readable.
- **DP-57 — Content from the published record** Every chapter, stage, interview, scenario and product fact on the pages comes from the stored content record through the site's API, and none of the record is copied into the browser code.

## Frontend

### Screens and layout (DP-01, DP-06, DP-10, DP-14, DP-19, DP-24, DP-29, DP-33, DP-34, DP-38, DP-47, DP-53, DP-54)

Every page has the header, a main area and the footer. The story page `/` holds seven full-viewport chapters, one after another. Night stages (Opening, Oxygen & Energy, and Lifestyle in OFF mode) alternate with paper spreads (About, Science & Technology, Product, Interviews, and Lifestyle in ON mode). Each chapter is a `region` named by its heading. Addresses, chapter ids and page titles are owned by Business rules, and every copy line is owned by Seed data.

- **Header**: a `banner` fixed to the top edge, 64 px tall at every width. It holds the home link, the `Site` navigation at widths of 1024 px and more, and the `Menu` button at every width.
- **Chapter rail**: at widths of 1024 px and more, a slim `Chapters` navigation is fixed down the left edge with seven numbered stops, and the chapter content starts to its right with nothing under the rail. Below 1024 px the rail is not shown and can't be focused.
- **Opening**: full viewport height. The level 1 hero heading, its line and two links sit on a night stage with one soft light source.
- **About**: the Inner Pace story. It has a lead, three panels (title and text), the `Previous panel` and `Next panel` buttons and a counter `<k> / 3`, where `<k>` is the current panel. The panels sit side by side in a track, which is the element carrying `data-track`. The `About` region carries `data-panel` and, while held in view, `data-progress`. How tall it is and how it moves are set in Business rules.
- **Oxygen & Energy**: a diagram drawn as a path from the lungs at the left to a cell at the right. The oxygen dot on that path is the element carrying `data-dot`. Next to it are the `Oxygen stages` tabs and the selected stage's panel (title and text). The region carries `data-stage` and, while held in view, `data-progress`.
- **Science & Technology**: a lead, three disclosures, the `Nitrate pathway` slider with the pathway diagram beside it (`img "Nitrate pathway diagram"` carrying `data-step`), the step text below it, and the not-a-medicine notice.
- **Product**: the heading (the stored product name) and the product line. Then the pack showcase: the drawn pack picture, carrying `data-view`, with the `Pack view` radios. Then the `Product information` tabs with their panels, the `Download product sheet (PDF)` button, the edition line (Business rules) and the `Visit the online store` link.
- **Interviews**: the heading, the fictional-profile note, the `Show interviews` radios and the `Interviews` list. Each list item is an `article` with a portrait drawn from the interview's hue, a level 3 heading with the name, the role, the label `Expert` or `Everyday`, the lede and the read link.
- **Lifestyle (the ON/OFF Meridian)**: the heading, the lead, the `Mode` radios, the `Moments` radios drawn as four stops on one horizontal line with a marker under the chosen stop (the element carrying `data-marker`), and the scenario panel. The panel holds the picture (carrying `data-scenario`), the time, a level 3 heading with the scenario title, the copy, and the moment line under the label `Where it fits`. The region carries `data-mode` and `data-scenario`.
- **Interview page** `/interviews/<slug>`: a level 1 heading with the name, the role, the lede and the portrait. Then each answer as a level 2 heading with the question followed by the answer paragraph, the fictional-profile note, the `Interview pages` navigation and the `All interviews` link.
- **Store page** `/store`: a level 1 heading `Online store`, then each stored pack as the line `<product name>, <sticks> sticks` above `¥<price> (tax included)` (formatting in Business rules), then a heading `Where to buy` and one store link per stored store, then the edition line (Business rules).
- **Contact, Privacy and Legal pages**: a level 1 heading and the copy from Seed data.
- **Footer**: a `contentinfo` landmark with the footer copy and the `Footer` navigation.

Layouts at the three published viewports. No breakpoint between them changes which layout a published viewport gets. No page scrolls sideways at any of them, because rows that move sideways scroll inside their own box.

| Part | 1280x800 | 768x1024 | 375x812 |
|---|---|---|---|
| Header | home link, `Site` links, `Menu` | home link and `Menu` only | home link and `Menu` only |
| Chapter rail | shown at the left edge; content starts to its right | absent | absent |
| Interviews | grid of three columns (six cards make two rows of three) | grid of two columns | one sideways row, one card at a time, each card between 80% and 90% of the viewport width, snapping card by card |
| Product | pack showcase on the left, `Product information` on the right, top edges within 24 px of each other | pack picture above `Product information` | pack picture above `Product information` |
| Meridian stops | one row of four | one row of four | a two by two grid |
| Inner Pace | held in view, scroll-led | held in view, scroll-led | sideways row |
| Footer links | one row | free | free |

### Public screens and controls (DP-03, DP-08, DP-12, DP-15, DP-16, DP-21, DP-25, DP-26, DP-27, DP-30, DP-31, DP-35, DP-39, DP-44, DP-45)

Only these roles, names and attributes are public. Everything else is free. `<…>` values come from the stored record.

| Role and accessible name | Where | Visible copy and notes |
|---|---|---|
| `link "Skip to story"` | every page, first Tab stop | shown only while focused |
| `banner` | every page | the header |
| `link "Alder Quay Laboratories home"` | header | to `/` |
| `navigation "Site"` | header, 1024 px and wider | links `About` (`/#about`), `Science & Technology` (`/#science`), `Product` (`/#product`), `Interview` (`/#interviews`), `Online store` (`/store`) |
| `button "Menu"` | header, every width | opens the menu dialog |
| `dialog "Menu"` (modal) | opened by `Menu` | `button "Close menu"`; `navigation "Menu chapters"` with the seven chapter links named as in the rail; then `link "Online store"` and `link "Contact"` (`/contact`) |
| `navigation "Chapters"` | rail, 1024 px and wider | `link "01 Opening"`, `link "02 About"`, `link "03 Oxygen & Energy"`, `link "04 Science & Technology"`, `link "05 Product"`, `link "06 Interviews"`, `link "07 Lifestyle"`: the two-digit number, one space, the title; the current one carries `aria-current="true"` |
| `region` per chapter | `/` | named by its chapter heading |
| `link "Begin the story"`, `link "See Vireo Pace"` | Opening | jump to `about` and to `product` |
| `button "Previous panel"`, `button "Next panel"` | About | native buttons, disabled at the ends |
| `tablist "Oxygen stages"` | Oxygen & Energy | tabs `Breath`, `Blood`, `Cell`, `Mitochondria`, `ATP`; one focusable `tabpanel` per tab |
| `button "Where it grows"`, `button "What it holds"`, `button "How it becomes powder"` | Science | disclosures with `aria-expanded` `true` or `false` |
| `link "See the amounts per stick"` | inside the `How it becomes powder` panel | jumps to `product` |
| `slider "Nitrate pathway"` | Science | values 1 to 3, starting at 1; `aria-valuetext` `Nitrate`, `Nitrite` or `Nitric oxide` |
| `img "Nitrate pathway diagram"` | Science | carries `data-step` |
| `img "<product name> pack, <view> view"` | Product | `<view>` is `front`, `side` or `back`; carries `data-view` with the same word |
| `radiogroup "Pack view"` | Product | radios `Front`, `Side`, `Back`; `Front` checked at start |
| `tablist "Product information"` | Product | tabs `Details`, `Ingredients`, `How to use`; `Details` selected at start; one focusable `tabpanel` per tab |
| `table "Ingredients per stick"` | Ingredients tab | column headers `Ingredient` and `Amount` |
| `heading "Cautions"` with a `list` | How to use tab | one item per stored caution |
| `button "Download product sheet (PDF)"` | Product | `aria-disabled="true"` while pending |
| `link "Visit the online store"` | Product | to `/store` |
| `radiogroup "Show interviews"` | Interviews | radios `All`, `Experts`, `Everyday`; `All` checked at start |
| `list "Interviews"` | Interviews | one `listitem` per shown interview, each an `article` |
| `link "Read the interview with <name>"` | each card | to `/interviews/<slug>` |
| `navigation "Interview pages"` | interview page | `link "Previous interview: <name>"`, `link "Next interview: <name>"` |
| `link "All interviews"` | interview page, unknown-interview page | to `/#interviews` |
| `radiogroup "Mode"` | Lifestyle | radios `ON`, `OFF` |
| `radiogroup "Moments"` | Lifestyle | the four scenarios of the current mode, named by scenario name, in the scenario order (Business rules) |
| `img "Illustration: <title>"` | Lifestyle panel | carries `data-scenario` |
| `link "Buy at <store name> (opens in a new tab)"` | `/store` | to the store's url, in a new tab |
| `link "care@alderquay.example"` | `/contact` | an email link to that address |
| `navigation "Footer"` | footer | eight links, in this order: `About`, `Science & Technology`, `Product`, `Interview`, `Online store`, then `Contact`, `Privacy`, `Legal` (`/privacy` and `/legal` for the last two) |
| `contentinfo` | every page | the footer |
| `status "Story updates"` | every page | polite, visually hidden (Feedback states) |
| `alert` | Product, Lifestyle, any page whose content fails to load | Feedback states |

Data attributes the tests read: `data-word` (each word of the hero heading), `data-panel`, `data-progress` and `data-track` (About), `data-stage`, `data-progress` and `data-dot` (Oxygen & Energy), `data-step` (nitrate diagram), `data-view` (pack), `data-mode`, `data-scenario` and `data-marker` (Lifestyle), and `data-scenario` on the scenario picture. Their values are set in Business rules.

### Interactions (DP-04, DP-08, DP-09, DP-12, DP-15, DP-16, DP-21, DP-25, DP-26, DP-30, DP-31, DP-35, DP-43, DP-44, DP-45, DP-47, DP-49)

Tab order, from a fresh load of `/` with the menu closed:

- 1280x800: `Skip to story`, `Alder Quay Laboratories home`, the five `Site` links in this order: `About`, `Science & Technology`, `Product`, `Interview`, `Online store`; then `Menu`, `01 Opening`, `02 About`, `03 Oxygen & Energy`, `04 Science & Technology`, `05 Product`, `06 Interviews`, `07 Lifestyle`, `Begin the story`, `See Vireo Pace`.
- 768x1024 and 375x812: `Skip to story`, `Alder Quay Laboratories home`, `Menu`, `Begin the story`, `See Vireo Pace`.

Keyboard, click and touch:

- **Skip link**: Enter on `Skip to story` moves focus to the first heading of the main content: the hero heading on `/` and the page heading elsewhere.
- **Menu**:
  - Pressing `Menu` opens the dialog and puts focus on `01 Opening`.
  - Tab from the last control wraps to `Close menu`, and Shift+Tab from `Close menu` wraps to the last control.
  - Escape or `Close menu` closes the dialog and returns focus to `Menu`.
  - Choosing a chapter link closes the dialog and makes a chapter jump. Choosing `Online store` or `Contact` opens that page.
- **Chapter jumps**: rail links, `Site` links to chapters, menu chapter links, `Begin the story`, `See Vireo Pace`, `See the amounts per stick`, `All interviews`, and opening a `/#<chapter id>` address. Each moves to the chapter as set by the jump rule in Business rules and focuses its heading. Headings take focus by script only and are never Tab stops.
- **Tablists** (`Oxygen stages`, `Product information`):
  - There is one Tab stop, at the selected tab.
  - ArrowRight and ArrowLeft move to the next or previous tab and select it at once, wrapping from last to first and from first to last.
  - Home and End select the first and last tab.
  - Tab from a tab moves into its focusable tab panel.
  - A click or tap selects a tab.
  - Choosing an oxygen stage moves the page as set in Business rules and keeps focus on the tab.
- **Radio groups** (`Mode`, `Moments`, `Pack view`, `Show interviews`): there is one Tab stop, at the checked radio. Arrow keys move to the next or previous radio and check it at once, wrapping. So arrow keys in `Moments` change the scenario and arrow keys in `Mode` change the mode. A click or tap checks a radio.
- **Slider** `Nitrate pathway`: ArrowRight and ArrowUp add one, ArrowLeft and ArrowDown subtract one, with no wrap. Home goes to 1 and End to 3. A pointer press or drag on its track sets the value nearest the pointer.
- **Disclosures and every button**: Enter and Space act like a click.
- **Panel buttons**: these move the Inner Pace story as set in Business rules. Focus stays on the pressed button. When that button becomes disabled at an end, focus moves to the other panel button.
- **Product sheet**: Enter, Space, a click or a tap on `Download product sheet (PDF)` starts the download (Feedback states). Focus stays on the button throughout.
- **Interview pages**: ArrowLeft opens the previous interview and ArrowRight the next one, whichever element has focus. At the ends the key does nothing. A card's read link opens the interview page with its heading focused, and the browser's back button returns to the previous address.
- **Touch**:
  - Taps work on every control as clicks do.
  - A finger swipe on the Inner Pace row (when it is a row) or on the interview row scrolls that row by one panel or card, and the page never scrolls sideways.
  - A horizontal swipe across the scenario picture changes the scenario as set in Business rules.
- **Focus**: focus never lands on a hidden or covered control. Every action announces or moves focus exactly as its section says.

### Visual design (DP-18, DP-28, DP-46, DP-56)

- **Colour roles**:
  - Ink is a near-black green, used for night stages and for text on paper.
  - Paper is a warm off-white, used for science spreads and the ON stage.
  - Leaf is one fresh leaf green, used only for actions (buttons, links in their hover and focus states, the selected tab, the checked radio) and for the active rail stop and Meridian marker.
  - Oxygen is a pale aqua, used for the oxygen dot, the air path and oxygen diagram strokes.
  - Beet is a deep beet red, used for the beet root drawing, the nitrate pathway highlight and the beet row of the ingredients table.

  No other accent colours are used.
- **Mood**:
  - Night stages are hushed: near-black green with one soft, still pool of light behind the display line.
  - Science spreads are clinical: paper-white with thin hairline rules between sections. Numbers in tables line up in columns, with every digit the same width.
  - The site comes alive only through the leaf green.
- **Type**: display lines and headings use the Shippori Mincho serif. Body text, labels and controls use the Zen Kaku Gothic New sans. Both are served as SIL OFL font files by the app. Each heading level is about one third larger than the level below it, and body text sits one step under the smallest heading.
- **Density**: airy. Wide margins on spreads, short display lines on night stages, at most about 70 characters per line of body text.
- **Composition**: full-viewport chapters alternate night stages and paper spreads. On wide screens the slim rail with seven numbered stops runs down the left edge.
- **Art**: every picture is drawn by the site with vector shapes. That covers the pack showing the product name, the eight scenario pictures (each a distinct scene in the scenario's mode colours), the interview portraits (abstract head-and-shoulder shapes coloured from the interview's hue, so that six hues give six visibly different portraits) and the diagrams.
- **Tap size**: every button, link, radio, tab and slider thumb is at least 44 x 44 px at 375x812.
- **Contrast**: all text meets WCAG 2.2 AA on every page and stage, including both the ON and OFF stages.
- **Focus ring**: a ring at least 2 px thick, in a colour with at least 3:1 contrast against its surroundings, drawn around the focused control and absent when it isn't focused.

### Motion and effects (DP-50, DP-51, DP-52, DP-37, DP-26)

Only these motions exist. Each one starts quickly and settles softly. Apart from them, nothing on the site moves, fades or loops on its own: no auto-advancing carousel, no idle drift of the light pool or the dot, and no timed reveal that hides content until a timer fires.

1. **Opening heading**: each word rises from 24 px below into place while fading in. Each word's rise lasts 500 to 700 ms, each word starts 80 to 140 ms after the one before, and every word is in place within 1.6 seconds of the page opening.
2. **Chapter headings** (the level 1 and level 2 headings of About to Lifestyle): the first time each one enters the viewport, it slides up from 32 px below while fading in, over 400 to 700 ms. After that it stays in place.
3. **Inner Pace track and oxygen dot**: these follow the scroll position only (Business rules). They never move over time. When the visitor scrolls back, they retrace their path step by step.
4. **Pack turn**: the pack turns to the chosen view over 400 to 600 ms.
5. **Meridian**:
   - The marker glides to the chosen stop over 250 to 450 ms.
   - The scenario picture crossfades from the old scene to the new one over 250 to 450 ms.
   - The scenario copy slides in from 16 to 24 px to the right over 250 to 450 ms.
   - The stage colour changes between the bright paper stage and the night stage over 400 to 700 ms.
6. **Menu dialog**: slides down from the top edge over 200 to 350 ms when opening and up over 200 to 350 ms when closing.
7. **Chapter jumps by link**: arrive within one second.
8. **Hover and focus colour changes**: finish within 150 ms.

**Reduced motion**: when the visitor has asked for reduced motion, every item above happens at once with no movement and no fade. Words, headings, pack, marker, picture, copy and stage colour show their end state immediately, and jumps are instant. The About and Oxygen & Energy chapters are not held in view (Business rules). The end state, announcements, addresses, keyboard behaviour, swipes and focus are exactly as with motion.

### Feedback states (DP-21, DP-22, DP-30, DP-33, DP-39, DP-40, DP-12, DP-08, DP-26, DP-35)

Every string in backticks in this brief renders character for character: straight apostrophes, the same dashes, case, digits and final full stops. Announcements built from these strings carry the same characters.

Every page has one polite `status` region named `Story updates`. It is visually hidden. Each announcement replaces its text and is never appended to it, and each change is announced once. Scrolling alone announces nothing. Announcements are made in the same moment the change shows on screen.

| Change | Announcement in `Story updates` |
|---|---|
| Oxygen stage chosen by a tab | `Stage <k> of 5: <title>.` (for example `Stage 3 of 5: Oxygen enters the cell.`) |
| Inner Pace panel changed by a button or a swipe | `Panel <k> of 3: <title>.` (for example `Panel 2 of 3: Recovery.`) |
| Pack view chosen | `Showing the <front, side or back> of the pack.` |
| Interview filter chosen | `Showing <n> interviews.`, and `Showing 1 interview.` when one is shown |
| Mode or scenario changed by the visitor (never the scenario shown at page start) | `<ON or OFF>: <name>. <title>.` (for example `OFF: Rest. Lights out.`) |
| Product sheet pending | `Preparing the product sheet.` |
| Product sheet downloaded | `Product sheet ready.` |

`<k>` is the stage or panel number and `<title>` its title. `<n>` is the number of interviews shown. `<name>` and `<title>` in the mode row are the scenario's name and title.

Async actions:

- **Product sheet download**:
  - Pending: the button carries `aria-disabled="true"`, a further press does nothing, and the pending announcement is made.
  - Success (200): the browser downloads the file under the filename given in API, the button is enabled again, focus stays on it, and the ready announcement is made.
  - Outage (503 or any failure): the button is enabled again, focus stays on it, and an `alert` shows exactly the `message` of the sheet 503 body in API. The alert stays until the next press of the button, which removes it.
- **Scenario choice**:
  - Pending: the scenario panel carries `aria-busy="true"` and keeps showing the previous scenario.
  - Success: the panel shows the latest choice (Business rules), `aria-busy` is removed, and the mode row announcement is made. The scenario shown at page start makes no announcement.
  - Failure: the panel keeps the previous scenario, `aria-busy` is removed, and an `alert` shows `This moment cannot be shown right now. Please choose it again.`
- **Content load on any page**: the page reads its content from the API (Business rules). If that read fails, the page shows an `alert` with `The story cannot be loaded right now. Please reload the page.`
- **Unknown interview page**: a level 1 heading equal to the `message` of the API's unknown-interview 404 body, and the `All interviews` link.
- **Any other unknown page**: a level 1 heading `This page does not exist.` and link `Back to the story` (to `/`).

## Backend

### API (DP-05, DP-20, DP-22, DP-32, DP-41, DP-42)

All responses are JSON (`application/json; charset=utf-8`) except the sheet. Request bodies are JSON, and a request body may be at most 262,144 bytes: exactly 262,144 bytes is accepted, more is rejected.

**Error order for the whole API.** Each check below runs only if the ones before it passed:

1. An unknown path, or a method a path does not list, answers 404 `{"error":"not_found","message":"Not found."}`.
2. On the grading route, a missing or wrong `X-Grading-Key` answers the same 404 body, so the route looks absent.
3. A body over the limit answers 413 `{"error":"too_large","message":"The request body is too large."}`.
4. A body that breaks the shape (including a body that is not JSON) answers 422 `{"error":"invalid","message":"The content does not match the published shape."}`.

| Method and path | Success | Its own errors |
|---|---|---|
| `GET /api/health` | 200 `{"status":"ok"}` when Postgres and Gotenberg both answer; 200 `{"status":"unavailable"}` when Gotenberg does not answer within 2 seconds | none |
| `GET /api/content` | 200 `{"edition":<n>,"product":<product>,"interviews":[{"slug","name","role","category","lede","hue"}],"scenarios":[{"id","mode","name"}]}`; `<product>` is the full stored product in the shape of Seed data; interviews in published order, scenarios in the scenario order of Business rules | none |
| `GET /api/interviews/<slug>` | 200 `{"slug","name","role","category","lede","hue","answers":[{"question","answer"}],"previous":{"slug","name"} or null,"next":{"slug","name"} or null}` | unknown slug: 404 `{"error":"not_found","message":"This interview does not exist."}` |
| `GET /api/scenarios/<id>` | 200 `{"id","mode","name","title","time","copy","moment"}` | unknown id: 404 `{"error":"not_found","message":"This scenario does not exist."}` |
| `GET /api/product/sheet` | 200 `application/pdf`, header `Content-Disposition: attachment; filename="vireo-pace-product-sheet.pdf"`, body the PDF | Gotenberg unreachable, answering with an error, or taking longer than 20 seconds: 503 `{"error":"sheet_unavailable","message":"The product sheet cannot be prepared right now. Please try again in a few minutes."}` |
| `PUT /api/grading/content` | header `X-Grading-Key` equal to env `GRADING_KEY`; body `{"product":<product>,"interviews":[<interview>],"scenarios":[<scenario>]}`; replaces all three and adds one to the edition; 200 `{"edition":<n>}` | key, size and shape errors as in the error order |
| `DELETE /api/grading/content` | same header; puts back the starting content of Seed data with edition 1; 200 `{"edition":1}` | key error as in the error order |

`<n>` is the stored content edition, a whole number from 1 upward.

**Grading body shapes.** These are exactly the field names of Seed data. Any missing field, extra field or wrong type is a shape error.

- `<interview>`: `{"slug","name","role","category","lede","hue","answers":[{"question","answer"}]}`.
- `<scenario>`: `{"id","mode","name","title","time","copy","moment"}`.
- `<product>`: `{"name","format","serving","packs":[{"sticks","price_yen"}],"ingredients":[{"name","mg"}],"how_to_use":[str],"storage","cautions":[str],"stores":[{"name","url"}]}`.

**Shape rules.**

- Interviews:
  - 1 to 12 interviews.
  - Unique slugs of 2 to 40 characters made of lowercase letters, digits and hyphens, starting with a letter.
  - `category` is `expert` or `everyday`.
  - `hue` is a whole number from 0 to 359.
  - 1 to 6 answers each.
- Scenarios:
  - Exactly eight, with exactly the eight published ids.
  - Each `mode` is `on` or `off` and matches its id prefix.
  - `time` is `HH:MM` on a 24-hour clock.
- Product:
  - 1 to 3 packs, with `sticks` a whole number from 1 to 100 and `price_yen` a whole number from 1 to 100,000.
  - 1 to 10 ingredients, with `mg` a whole number from 1 to 10,000.
  - 1 to 6 steps in `how_to_use` and 1 to 6 cautions.
  - 1 to 4 stores, each `url` starting with `https://`.
- Every text field is 1 to 1,200 characters long, both ends included.

### Business rules (DP-02, DP-03, DP-04, DP-07, DP-08, DP-09, DP-11, DP-12, DP-13, DP-15, DP-16, DP-17, DP-30, DP-31, DP-35, DP-36, DP-39, DP-40, DP-45, DP-49, DP-52, DP-55, DP-57)

**Addresses and titles.**

| Address | Page | Document title | Status |
|---|---|---|---|
| `/` | the story | `Vireo Pace | Alder Quay Laboratories` | 200 |
| `/interviews/<slug>` | one interview | `<name> | Vireo Pace interviews` for a stored slug; `Not found | Vireo Pace` for an unknown slug | 200 for a stored slug, 404 otherwise |
| `/store` | online store | `Online store | Vireo Pace` | 200 |
| `/contact` | contact | `Contact | Alder Quay Laboratories` | 200 |
| `/privacy` | privacy | `Privacy | Alder Quay Laboratories` | 200 |
| `/legal` | legal | `Legal | Alder Quay Laboratories` | 200 |
| anything else | not found | `Not found | Vireo Pace` | 404 |

Every page carries `lang="en"` on its root element.

**Chapter ids**, in order: `opening`, `about`, `oxygen`, `science`, `product`, `interviews`, `lifestyle`.

**The address is the view.**

- The hash always names the current chapter as `#<chapter id>`. A load of `/` without a hash gets `#opening` at once.
- When the current chapter changes, by scrolling or by a jump, the hash is replaced without adding a history entry, and any query string is kept.
- Opening `/#<chapter id>`, with or without a query string, jumps straight to that chapter with no scroll motion and focuses its heading.
- The Lifestyle scenario lives in the query string `scenario=<scenario id>`, for example `/?scenario=off-rest#lifestyle`. Choosing a mode or a scenario replaces the address with the shown scenario's id and adds no history entry. Before any choice, an address without `scenario` stays without one.
- Opening an interview from a card adds a history entry, so the back button returns to the story address it came from. Moving between interviews by link or arrow key adds one history entry per move.
- Reloading, or opening the same address in another browser, shows the same chapter, mode and scenario.

**Current chapter.** The current chapter is the one whose box contains the point 40% of the way down the viewport. At the very top of the page it is `opening`. Its rail link, and its link in the menu while the menu is open, carry `aria-current="true"`, and no other link does. It updates while scrolling in either direction.

**Chapter jump.** A jump ends with the chapter heading at least 16 px below the header's bottom edge, never under the header, and with focus on that heading. A jump by link arrives within one second, or at once with reduced motion.

**Inner Pace story.** Both modes below keep the same panels, buttons, announcements and `data-panel` meaning.

- **Held in view**: at widths of 768 px and more without reduced motion, the About chapter is three viewport heights tall and its stage stays in view while the visitor scrolls through it.
  - Progress p = (window scroll position minus the chapter's top offset) / (chapter height minus viewport height), kept within 0 to 1.
  - `data-progress` is p with two decimals, rounded half up.
  - The track moves left by p times two panel widths, where each panel is as wide as the stage.
  - `data-panel` is 1 while p < 0.25, 2 while 0.25 ≤ p < 0.75 and 3 when p ≥ 0.75, decided on the exact p and not on the rounded attribute.
  - `Next panel` and `Previous panel` jump the page, with no scroll motion, to p = (k − 1) / 2 for the target panel k.
  - For example, at 1280x800 the chapter is 2,400 px tall and scrolls through 1,600 px. 400 px into it is panel 2. `Next panel` from panel 1 jumps to 800 px into it (`0.50`, panel 2, track moved one panel width), and pressing it again jumps to 1,600 px (`1.00`, panel 3).
- **Row**: below 768 px wide, or with reduced motion at any width, the chapter is not held in view. The three panels sit in one row that scrolls sideways inside the chapter, one panel per view, snapping to each panel.
  - `data-panel` follows the panel whose centre is nearest the row's centre, and the region carries no `data-progress`.
  - The buttons scroll the row by one panel, at once with reduced motion and arriving within 600 ms otherwise.
  - A finger swipe moves the row by one panel.
- `Previous panel` is disabled on panel 1 and `Next panel` on panel 3.

**Oxygen stages.**

- **Held in view**: at widths of 768 px and more without reduced motion, the chapter is five viewport heights tall with its stage held in view.
  - p is computed as for Inner Pace, and `data-progress` is p with two decimals.
  - `data-stage` is min(5, floor(p × 5) + 1), and the selected tab always equals `data-stage`.
  - The dot sits p of the way along the path, so its horizontal position only grows as p grows and only shrinks as p shrinks.
  - Choosing a tab jumps the page, with no scroll motion, to p = (k − 0.5) / 5.
  - For example, at 1280x800 the chapter is 4,000 px tall and scrolls through 3,200 px. 1,000 px into it is `0.31`, stage 2. 2,400 px is `0.75`, stage 4. 3,200 px or more is `1.00`, stage 5. Choosing `Cell` jumps to 1,600 px into it (`0.50`, stage 3).
- **Not held**: below 768 px wide, or with reduced motion, the chapter has normal height and no `data-progress`. The stage changes only through the tabs, and the dot jumps to the chosen stage's point on the path (stage k sits (k − 0.5) / 5 of the way along).
- **Labels**: each tab is named by the stage name. Its panel shows the stage title and text from Seed data.

**Nitrate pathway.** `data-step` on the diagram always equals the slider value, and the diagram highlights that step. The step text below it is the text for that value from Seed data.

**Collapsed means unavailable.** The following are hidden and unavailable at every viewport: a closed menu dialog (from the moment closing starts), a collapsed Science disclosure panel, an unselected tab panel, and the chapter rail below 1024 px. Nothing inside them is visible, can be reached by Tab, or is exposed to a screen reader. Moving something out of view is not closing it.

**Keyboard completeness.** Every action on the site can be done with the keyboard alone. An open modal dialog keeps Tab and Shift+Tab inside itself, closes with Escape and returns focus to the control that opened it. Reduced motion and touch change only how things move, never what the visitor can do.

**ON/OFF Meridian.**

- **Scenario order**: the fixed order `on-work`, `on-sports`, `on-hobby`, `on-housework`, `off-break`, `off-holiday`, `off-relax`, `off-rest`. It decides the order of the `Moments` radios, each mode's first scenario (`on-work` and `off-break`), the swipe neighbours and the scenario order in `GET /api/content`.
- **Attributes**: the Lifestyle region's `data-mode` is `on` or `off` in lowercase. `data-scenario`, on both the region and the scenario picture, is the shown scenario's id, for example `off-rest`.
- **Start**: the scenario named in the address, if it is one of the eight ids, with its mode following from it. Otherwise ON / Work (`on-work`). An unknown `scenario` value is replaced in the address with `on-work`. The start scenario counts as the last choice in its mode. For example, after opening `/?scenario=on-sports#lifestyle`, choosing OFF and then ON brings back `on-sports`. Showing the start scenario announces nothing, so the status region stays empty at page load.
- **Choosing a mode** shows that mode's four stops and selects the scenario last chosen in that mode during this page visit, or the mode's first scenario if none was chosen.
- **Every scenario shown**, at start, by a mode change, by a radio or by a swipe, requests `GET /api/scenarios/<id>`, even if that scenario was seen before. Choosing the scenario already shown, for example pressing its checked radio, does nothing: it makes no request and no announcement.
- **Latest choice wins**: the `Mode` and `Moments` radios and the address follow the visitor's choice at once. `data-mode`, `data-scenario`, the stage, the picture and its name, the panel copy and the announcement change together when the answer for the latest choice arrives. An answer for an earlier choice that arrives later is ignored and announces nothing. Once nothing is loading, the radios, the region attributes, the address, the picture and the copy all name the same scenario.
- **Swipe**: a horizontal finger swipe of at least 50 px across the scenario picture chooses a neighbour. Right to left chooses the next scenario of the current mode, left to right the previous one. Nothing happens past the first or last, and shorter movements do nothing.

**Interviews.**

- The list shows interviews in published order.
- `Experts` shows only `expert` interviews and `Everyday` only `everyday` ones, in published order.
- Each card's label is `Expert` or `Everyday`.
- Previous and next on interview pages follow published order regardless of the filter. The first interview has no previous link and the last has no next link.

**Product text, derived from the stored product.**

- The Product chapter line is `<format>. <serving>.`
- The Details tab shows `Format: <format>`, `Serving: <serving>`, then one line per pack: `<sticks> sticks: ¥<price> (tax included)`.
- Ingredient amounts read `<mg> mg`.
- Prices and amounts use thousands commas. For example, with the seed data at start: `14 sticks: ¥1,980 (tax included)` and `3,000 mg`.
- The How to use tab shows the steps as an ordered list, then `Storage: <storage>`, then `Cautions` with the cautions.
- The not-a-medicine notice is `<product name> is a food. It is not a medicine and is not intended to diagnose, treat, cure or prevent any disease.` It appears at the end of Science & Technology, under the ingredients table and on the product sheet.
- The edition line is `Content edition <n>`, where `<n>` is the stored edition. It appears in the Product chapter under the download button, at the end of the store page and as the last line of the product sheet. For example, with the seed data at start it reads `Content edition 1`.

**One content record.**

- Postgres holds one content record: the product, the interviews, the scenarios and the edition number. The fixed site copy may also live there.
- On every page load the browser reads the product, interviews and scenarios through the site's own API. None of that content is copied into the browser code or the served HTML.
- A change published through the grading route shows on the next page load in any browser. A page already open keeps the product, the interviews, the edition and the scenario names it loaded. The one exception: a scenario the open page shows after the change is fetched fresh, so its panel, picture name and announcement show the newly published scenario record.
- The product sheet is printed from the same stored record on every request and carries its edition.
- When the app starts with an empty database, it stores the starting content of Seed data at edition 1. When the database already holds a record, the app keeps it.

### Services (DP-20, DP-22)

- **Postgres**: stores the content record. The app creates its tables idempotently every time it starts, not only at build.
- **Gotenberg**: on each `GET /api/product/sheet`, the app sends an HTML document built from the stored product record to `POST $GOTENBERG_URL/forms/chromium/convert/html` as the file `index.html`, and returns the PDF it answers with. The app keeps no cached PDF.
  - The sheet's text, in order:
    1. `<product name> product information`
    2. `Alder Quay Laboratories`
    3. `Format: <format>`
    4. `Serving: <serving>`
    5. one line per pack as in Details
    6. `Ingredients per stick`, then one line `<name> <mg> mg` per ingredient
    7. `How to use`, then the steps numbered `1.`, `2.` and onward
    8. `Storage: <storage>`
    9. `Cautions`, then each caution
    10. the not-a-medicine notice
    11. the edition line (Business rules)
  - When Gotenberg is unreachable, answers with an error or takes longer than 20 seconds, the sheet answers the 503 in API, the button shows its outage alert, and every other page and endpoint keeps working.
  - Each sheet request contacts Gotenberg anew, so the first request after Gotenberg returns succeeds without restarting the site.
  - Health checks Gotenberg with `GET $GOTENBERG_URL/health`.

### Seed data (DP-02)

Every person, business, store and address here is fictional. A store advisor's phone line and the store addresses use reserved example names.

**Fixed site copy** (the same in every edition):

- **Opening**:
  - Level 1 heading: `Energy you make, at your own pace.` (each word its own element carrying `data-word`).
  - Line: `Vireo Pace is a daily drink stick from Alder Quay Laboratories, made with red beet root.`
- **About**:
  - Heading: `Inner Pace`.
  - Lead: `Inner Pace is how Alder Quay Laboratories thinks about energy: something your body already makes, spends in effort and rebuilds in recovery.`
  - Panels, in order (title, then text):
    1. `Effort`: `Every climb, deadline and load of laundry spends energy your body makes from breath and food.`
    2. `Recovery`: `Pauses, meals and sleep are when the body rebuilds what effort used.`
    3. `One pace`: `Effort and recovery are not opposites. Kept in rhythm they are one pace: your Inner Pace.`
- **Oxygen & Energy**:
  - Heading: `From breath to energy`.
  - Stages (name / title / text):
    1. `Breath` / `Air reaches the lungs` / `With each breath, air travels down to hundreds of millions of tiny air sacs in the lungs, where oxygen passes into the blood.`
    2. `Blood` / `Red blood cells carry it` / `Haemoglobin inside red blood cells picks up oxygen in the lungs and carries it through the arteries to every tissue.`
    3. `Cell` / `Oxygen enters the cell` / `In the smallest blood vessels, oxygen leaves the blood and moves into the cells that use it.`
    4. `Mitochondria` / `Mitochondria use it` / `Inside each cell, mitochondria use oxygen to release the energy stored in food, giving off water and carbon dioxide.`
    5. `ATP` / `Energy you can spend` / `That energy is held in a molecule called ATP, which muscles and nerves spend as you move, think and rest.`
- **Science & Technology**:
  - Heading: `A root that keeps nitrate`.
  - Lead: `Vireo Pace is made with red beet root. Here is what that plant is, what it holds and how it becomes a powder.`
  - Disclosure panels:
    - `Where it grows`: `Red beet (Beta vulgaris) is a root vegetable grown in cool climates. Its deep red colour comes from pigments called betalains.`
    - `What it holds`: `Beet roots store nitrate taken up from the soil, along with natural sugars and fibre.`
    - `How it becomes powder`: `Washed roots are sliced, juiced, gently dried and milled into a fine powder.` followed by the amounts link.
  - Nitrate steps (value, name: text):
    1. `Nitrate`: `Beet roots store nitrate taken up from the soil.`
    2. `Nitrite`: `Bacteria in the mouth turn part of swallowed nitrate into nitrite.`
    3. `Nitric oxide`: `In the body, part of that nitrite becomes nitric oxide, a molecule involved in widening blood vessels.`
- **Interviews**:
  - Heading: `Voices on pace`.
  - Fictional-profile note (also on every interview page): `Everyone in these interviews is fictional. They talk about their own routines, not about results from Vireo Pace.`
- **Lifestyle**:
  - Heading: `ON and OFF, one pace`.
  - Lead: `Some moments call for effort, others for recovery. Choose a mode, then a moment.`
- **Footer**: `Alder Quay Laboratories`, `A fictional company created for this site.`, `© 2026 Alder Quay Laboratories`.
- **`/contact`**: heading `Contact`, then `Alder Quay Customer Care`, `Phone 0120-555-014, weekdays 9:00 to 17:00` and the email link.
- **`/privacy`**: heading `Privacy`, then `This site sets no cookies and keeps no record of who you are. Server logs keep the address and time of each request for 14 days.`
- **`/legal`**: heading `Legal`, then `Alder Quay Laboratories, Vireo Pace and every person on this site are fictional. All text and pictures were made for this site.`

**Starting product:**

```json
{"name":"Vireo Pace","format":"Drink stick, 6 g of powder","serving":"One stick in 150 ml of water",
"packs":[{"sticks":14,"price_yen":1980},{"sticks":30,"price_yen":3960}],
"ingredients":[{"name":"Red beet root powder","mg":3000},{"name":"Dextrin","mg":2400},
{"name":"Yuzu juice powder","mg":450},{"name":"Sea salt","mg":100},{"name":"Vitamin C","mg":50}],
"how_to_use":["Tear open one stick.","Stir it into 150 ml of cold or room-temperature water.",
"Drink it within 30 minutes of mixing."],
"storage":"Keep sealed sticks away from direct sunlight, heat and damp.",
"cautions":["If you are pregnant, nursing, taking medication or under medical care, ask your doctor before use.",
"Red beet can turn urine pink or red."],
"stores":[{"name":"Alder Quay Online Store","url":"https://store.alderquay.example/vireo-pace"},
{"name":"Harbourline Pharmacy Online","url":"https://harbourline.example/vireo-pace"}]}
```

**Starting interviews**, in published order (slug | name | role | category | hue | lede | answers as question / answer):

1. `mina-okabe` | `Mina Okabe` | `Sports physiologist` | `expert` | 150 | `Hard days only count if easy days follow them.`
   - `What do people get wrong about training?` / `They count the hard sessions and forget the easy ones. The body adapts during recovery, so the easy days are part of the work.`
   - `How do you spend your own rest days?` / `A long walk, a proper lunch and an early night. Nothing I would post about.`
2. `daniel-reyes` | `Daniel Reyes` | `Sleep researcher` | `expert` | 220 | `Sleep is the longest recovery of the day.`
   - `Why is sleep harder to protect than exercise?` / `Nobody hands you a medal for going to bed on time. It is still the habit I would keep if I could keep only one.`
   - `What is your evening routine?` / `Screens off at ten, the same book for twenty minutes, lights out by half past.`
3. `harue-sato` | `Harue Sato` | `Registered dietitian` | `expert` | 35 | `Regular meals make a steadier day than perfect ones.`
   - `Where do you start with someone who feels flat every afternoon?` / `With lunch. Many people skip it or eat it standing up, then wonder why the middle of the afternoon feels long.`
   - `Do you plan your own meals?` / `Loosely. I cook twice a week and eat the leftovers without guilt.`
4. `kenji-mori` | `Kenji Mori` | `Carpenter and trail runner` | `everyday` | 95 | `I run before work so the workshop gets my calm hours.`
   - `When do you run?` / `At six, three mornings a week, on the forest trail behind the workshop.`
   - `What does a rest day look like?` / `Sharpening tools, a nap after lunch and no stopwatch anywhere.`
5. `ana-lindqvist` | `Ana Lindqvist` | `Night-shift nurse` | `everyday` | 265 | `My week has two clocks, and I keep both honest.`
   - `How do you switch between night and day weeks?` / `Slowly. I move bedtime by an hour a day and keep the curtains shut until it sticks.`
   - `What helps you wind down after a shift?` / `A shower, a short walk with the dog and then straight to bed.`
6. `tom-achebe` | `Tom Achebe` | `Designer working from home` | `everyday` | 5 | `The commute I lost became a walk I keep.`
   - `What changed when you started working from home?` / `The day lost its edges. I added a walk at nine and at five so it has a start and an end again.`
   - `How do you share housework with two children at home?` / `A chart on the fridge and a ten-minute tidy before dinner that everyone joins.`

**Starting scenarios** (id | mode | name | title | time | copy | moment):

- `on-work` | `on` | `Work` | `The long afternoon` | `15:00` | `Meetings run into each other and the window light starts to slant.` | `A glass of water with a stick of Vireo Pace beside the keyboard.`
- `on-sports` | `on` | `Sports` | `Before the climb` | `07:30` | `Laces tied, the trail head still in shade.` | `A bottle mixed the night before, cold from the fridge.`
- `on-hobby` | `on` | `Hobby` | `The workbench` | `10:00` | `Saturday hands on wood, glue and the radio.` | `A cup on the shelf, away from the sawdust.`
- `on-housework` | `on` | `Housework` | `Laundry day` | `11:30` | `Two loads hung, one to fold, floors next.` | `A glass on the windowsill between rooms.`
- `off-break` | `off` | `Break` | `Ten minutes` | `13:10` | `Phone face down, shoulders down.` | `Water, a window, nothing to finish.`
- `off-holiday` | `off` | `Holiday` | `Slow morning` | `09:00` | `No alarm, a guidebook left closed.` | `A stick packed in the day bag, just in case.`
- `off-relax` | `off` | `Relax` | `After the bath` | `21:00` | `Steam on the mirror, music low.` | `Warm tea instead; the stick can wait for tomorrow.`
- `off-rest` | `off` | `Rest` | `Lights out` | `23:00` | `The day put away, the room dark and cool.` | `Nothing at all. Rest is part of the pace.`

**Edition at start:** 1.

## Technical requirements

### Deployment (DP-22, DP-42)

- The runtime is Node 22 with npm. The app is TypeScript.
- `/app/run.json` holds string commands `install`, `build` and `serve` plus `"_schema":"run-manifest-v1"`, for example:
  `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`
- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or 4173 when it is unset.
- `GET /api/health` answers as in API.

### Configuration and secrets (DP-23)

The app reads these at start:

- `DATABASE_URL`: the Postgres connection.
- `GOTENBERG_URL`: the Gotenberg base address.
- `GRADING_KEY`: the grading route key. It has no default: without it, the grading route is absent and answers the unknown-path 404.
- `APP_PUBLIC_PORT`: the listening port.

None of these values is hard-coded in the source or sent to the browser.

### Server boundary (DP-22, DP-42)

- The site is served on one origin. No response carries cross-origin permission headers, and the browser only calls the site's own API.
- Every request body is held to the 262,144-byte limit of API.
- The server never serves source files, `.env` files, the manifest, package files or credentials. Requests for them answer the not-found page with 404.
- A service down at start doesn't stop the app. If Gotenberg can't be reached at start, the app starts and serves every page, health reports `unavailable`, and the sheet answers its 503 until Gotenberg answers again, after which it works with no restart. If Postgres can't be reached at start, the app keeps retrying the connection and serves once connected.

### Browser support and performance (DP-48, DP-54)

- Current Chromium on desktop, plus touch emulation, at 375x812, 768x1024 and 1280x800.
- The story page shows its content and responds to input within three seconds of opening.
- Every API answer except the sheet arrives within one second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and the serve command starts the site with no manual step.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and both font families, each with its licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) has an MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD licence. Font files are SIL OFL 1.1.
- IF-04: The site uses only Postgres and Gotenberg as backend services: no other database, cache, queue or file store, and no files written as a content store.
- IF-05: Pages load nothing from another origin: no external fonts, scripts, stylesheets, images or video.
- IF-06: The TypeScript configuration has strict type checking turned on, and the source contains no type-check suppression comments.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript. Names follow this brief's domain terms: chapter, stage, panel, scenario, mode, interview, product, pack, ingredient, edition, product sheet.
- Each domain rule is decided in exactly one place in the source. That covers the current-chapter rule, the progress-to-panel and progress-to-stage formulas, the latest-choice rule, the mode memory, the not-a-medicine notice, the yen and milligram formatting, and the content shape rules.
- The product chapter, the store page and the product sheet build their facts from the same stored record through the same formatting.
- There is no abstraction with a single implementation and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the brief makes impossible.
- Every API error uses the one `{"error","message"}` shape.
- There are no features, pages, endpoints or settings beyond this brief.
