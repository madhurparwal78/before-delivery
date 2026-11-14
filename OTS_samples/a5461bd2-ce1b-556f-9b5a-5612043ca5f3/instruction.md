# Vellum Orbit Studio Eight Worlds

Eight Worlds is the public website of Vellum Orbit Studio, a fictional branding and digital design studio in Kochi run by two founders. It is built for founders and marketing leads of small Indian businesses who are thinking about hiring a studio. Visitors walk through a ring of eight 3D brand worlds made for fictional clients. Each world opens into a full case study. The site also shows six services, an illustrative price list in rupees, the studio's way of working, answers to common questions and a four-step project enquiry. The server keeps all content and every enquiry in Postgres. Each world's 3D model and every gallery image is a file in a private MinIO bucket, and the browser gets those files only through the site. Each enquiry is handed to the studio's project-intake service, played by a WireMock stand-in. The site has no accounts, sign-in, admin or editor screens, cart, payment, newsletter, search, comments, chat, AI features, analytics, cookies or tracking, and no datastore besides Postgres and MinIO. Every client, person, price and contact detail on the site is invented and labelled as illustrative.

## Problem and users

A small business founder hires a branding studio perhaps once in their working life. Before writing to one, they want to see how the studio thinks across very different brands. They also want to know what a logo, a website, an online store or a packaging range actually includes, roughly what it costs in rupees and how long it takes. Most small-studio sites answer none of this. The work sits in a grid of identical thumbnails, prices hide behind "get in touch", and the contact form is one text box that loses everything when it fails.

- **Small business founder** (occasional visitor). Walks the eight brand worlds by scroll, drag, keyboard or touch, reads the case studies and filters the work by service before deciding to write.
- **Marketing lead** (occasional visitor). Compares the six services and the illustrative price list (fixed items and custom quotes, with delivery estimates and revision rounds), then sends a four-step enquiry.
- **Studio founder** (daily). Gets every enquiry through the project-intake service exactly as the visitor wrote it, with service, budget and description. Relies on the eight worlds and the price list being published exactly as set.

## Journeys

1. **Walk the worlds.** A founder lands on `/` and sees the opening scene. They press `Enter the worlds`, and the camera descends onto the ring with world 1 active and announced. They scroll, drag, swipe or use the rail to turn the ring one world at a time. They enter a world: the camera flies into its island and the address becomes `/worlds/<slug>`. Leaving brings them back to the same world on the ring, with focus on the button they used to enter.
2. **Read a case study.** From a world page or the work gallery, a founder opens `/work/<slug>`, reads its sections, browses its four images in the image viewer by keyboard, buttons or swipe, and moves to the previous or next project.
3. **Filter the work.** A founder opens `/work`, presses service filters, picks an industry, pages with `Show more work`, opens a project and comes back to the same filters, page and tile.
4. **Compare services and prices.** A marketing lead switches between the six service tabs, opens process steps, then filters the price list by category and price type, opens an item's details and follows `Enquire about <item name>`.
5. **Send an enquiry.** A marketing lead fills in the four steps: about you, your project, budget and review. They fix validation messages, go back and forth without losing an answer, and send. The page says the enquiry was received only after the intake service accepts it, and shows both references.
6. **Recover from a failure.** When the intake service fails, the review stays on screen with every answer and a `Try again` button. Trying again never creates a second enquiry. When the 3D scenes cannot load, or the browser has no WebGL, the worlds appear as a still gallery with every world reachable.
7. **Browse on a phone.** On a 375-pixel-wide phone, a marketing lead opens the menu, swipes between worlds and through a case-study gallery, and reaches every page without sideways scrolling, also with reduced motion turned on.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Published pages and titles** Every address in the site map answers HTTP 200 with its full page and document title on a direct load, and every other page address answers 404 with its not-found heading.
- **DP-02 — Header, skip link and current page** Every page starts with the `Skip to content` link and has the fixed header, showing the `Main` navigation or the `Menu` button depending on width, and marks exactly the current section's link as current.
- **DP-03 — Footer and illustrative contact** Every page ends with the footer carrying the fictional-studio notice, the footer and social navigations and the illustrative contact details.
- **DP-04 — Opening scene** The home page opens on the three-line intro heading, and `Enter the worlds` moves to world 1, focuses its rail button, announces it and runs the descent onto the ring.
- **DP-05 — Published stage state** The stage publishes its mode, active world, rendered yaw, target yaw, camera state and emblem angle as data attributes that always agree with the overlay, rail and announcer and read as published in each mode.
- **DP-06 — Immersive entry journey** A founder opens the site, enters the worlds, enters and leaves Ledgerwick Advisory, and moves forward and back through history with the same address, focus and camera states each time.
- **DP-07 — Entering and leaving a world** Entering a world changes the address, title, content and focus in one step and flies the camera in, and leaving restores the same active world, scroll position and focus on its enter button.
- **DP-08 — World-to-world links** A world page's previous and next world links move to the neighbouring world in ring order without wrapping, updating address, focus, active world and target yaw together.
- **DP-09 — World rail and keys** The world rail has one Tab stop and marks the active world. It selects worlds by click, tap, arrow keys, Home and End, and `Previous world` and `Next world` are disabled at the ends.
- **DP-10 — Ring turn** Every change of active world turns the ring straight from its rendered yaw to the new target in the published time, with the yaw moving in one direction and reaching the target exactly.
- **DP-11 — Pointer drag** Dragging anywhere on the stage outside its buttons, links and rail turns the ring with the pointer, up to one world either side. Releasing after the published distance selects the next or previous world, and nothing is selected past the ends.
- **DP-12 — 3D world navigation journey** A founder drags, clicks the rail and follows world links in the 3D stage and sees the active world, yaw, overlay and scroll position agree at every step, also with reduced motion.
- **DP-13 — Scroll selects the world** On the home page the scroll position alone decides the active world, one world per viewport height, and every other way of selecting a world moves the scroll position to match.
- **DP-14 — Reversed scroll mid-turn** A new active world during a turn starts a fresh turn from the yaw shown at that moment, so reversing the scroll mid-turn settles on the world the scroll position names.
- **DP-15 — World announcer** The `World announcer` live region reads the published world line exactly once per change of active world and when `Enter the worlds` brings world 1 in, never on load, never as a repeat and never while scrolling within one world's range, as qualified in Feedback states.
- **DP-16 — Scroll-driven journey** A founder scrolls through, back and past the ring on desktop and tablet and sees one announcement and one turn per distinct world reached.
- **DP-17 — Keyboard-only journey** A founder walks the ring, enters and leaves a world, and opens a case study and its image viewer using only the keyboard, with focus always visible and returned to each opener.
- **DP-18 — Visible focus clear of the header** Every keyboard focus shows the published focus ring, and every keyboard or scripted focus move scrolls its element clear of the fixed header and into view only when it is not already there, while a pointer click alone never scrolls.
- **DP-19 — Reduced motion** With reduced motion every turn, descent, flight and slide completes in the step that starts it and no animation runs, while every control, key, address, announcement and focus move still works.
- **DP-20 — Reduced-motion journey** A founder with reduced motion reaches all eight worlds and their pages through the rail and sees instant state changes in the stage, viewer and menu.
- **DP-21 — Idle emblem motion** In 3D mode each island's emblem turns at the published steady rate as the stage's only idle motion, and holds still with reduced motion.
- **DP-22 — Scene models** Each world's model is a binary glTF file with at least 5,000 vertices served from the studio's file store, and the stage fetches all eight on first load of the home page or a world page.
- **DP-23 — Still layout without WebGL** Without WebGL the worlds section shows its heading, notice and eight world cards in ring order with links to every world page in place of the overlay, rail and stage buttons, and world pages work without a canvas.
- **DP-24 — Scene failure and retry** When any scene model fails, the same still layout appears with its notice and `Try 3D again`, which returns to 3D with world 1 active and focused once all eight models load.
- **DP-25 — 3D fallback journey** A founder without WebGL, with a failing model, or with the file store unreachable still reaches every world's text, images or image plates and links, and can still send the enquiry.
- **DP-26 — Files and file-store outage** Scene and gallery files stream from the private bucket under their published keys. Unknown files answer 404, every file answers 503 while the file store is unreachable, and failed images show their plate.
- **DP-27 — World pages** Each world page shows the world's own ground, ink and display face and its published content in the published order.
- **DP-28 — Services tabs** The `Services` tab list selects services by click, tap, arrow keys, Home and End, keeps the address on `/services/<id>`, and selects the addressed service on a direct load.
- **DP-29 — Service panels and process steps** Each service panel shows its purpose, deliverables, four collapsible process steps, examples and its work, price and enquiry links.
- **DP-30 — Service exploration journey** A marketing lead compares services by keyboard, opens process steps and follows a service's enquiry link to an enquiry with that service already chosen.
- **DP-31 — Work filters and counts** The work gallery filters by service and industry together, using the published matching rule, counts and results status.
- **DP-32 — Show more work** The gallery shows the published page size of matching projects in gallery order, and `Show more work` appends the next page with focus on its first tile, never repeating or skipping a project.
- **DP-33 — Gallery address and return** Filters and pages live in the gallery address, loading the address restores them, and returning from a case study lands on the same address with focus on the opened tile.
- **DP-34 — Projects API paging** `GET /api/projects` filters like the gallery and pages by offset with a capped limit, giving every match once in gallery order.
- **DP-35 — Portfolio filtering journey** A founder combines service and industry filters, pages with Show more, opens a case study and comes back to the same filters, page and tile.
- **DP-36 — Case studies** Each case study shows its published sections in order, previous and next project links that wrap in gallery order, and its world and gallery links.
- **DP-37 — Image viewer** The gallery's modal `Image viewer` changes images by buttons, arrow keys and swipe, wrapping at the ends, keeps Tab inside, and returns focus to its thumbnail on close.
- **DP-38 — Case-study navigation journey** A founder moves between case studies, browses a gallery by keyboard and by touch at phone width, and returns to the filtered gallery they came from.
- **DP-39 — Price list items** The price list shows the fourteen illustrative items with type, price, delivery and revisions, and each item's details expand to its inclusions, payment line and enquiry link.
- **DP-40 — Price filters and counts** The `Category` and `Price type` radio groups filter the price list together, with the published counts, status, empty state and address.
- **DP-41 — Pricing journey** A marketing lead filters the price list by keyboard, opens an item's details, reloads to the same filters and follows the item's enquiry link to step 2.
- **DP-42 — Studio page** The studio page shows the published principles, people, project stages and links, with the principles in two columns on desktop and one on a phone.
- **DP-43 — Questions** The questions page lists the eight questions as an accordion operated by click, tap, Enter, Space and arrow keys, and opens the question named in the address on load.
- **DP-44 — Enquiry steps and draft** The four-step enquiry moves focus to each step's heading, never changes an answer on Back or Edit, and restores answers and step from this tab's draft.
- **DP-45 — Enquiry validation** Next checks every field of the step against the published rules and messages, marks invalid fields and radio groups and focuses the first one (a radio group by its first radio).
- **DP-46 — Multi-step enquiry journey** A marketing lead fills in, corrects, reloads and reviews the enquiry and sees every answer kept exactly as typed.
- **DP-47 — Enquiry request checks** `POST /api/enquiries` refuses wrong content types, oversized bodies, invalid JSON and invalid fields with the published statuses and bodies, and ignores unpublished fields.
- **DP-48 — Intake hand-off** Each new enquiry is stored and handed to the project-intake service once, and is shown as sent only with the intake reference that service returned, as qualified in Business rules.
- **DP-49 — One enquiry per submission** Repeated or simultaneous posts with one submission id store one enquiry with one reference, and a retry after a failed hand-off sends the stored enquiry again.
- **DP-50 — Enquiry limit per email** New enquiries from one email address beyond the published number within the published window are refused with 429, the wait time and the published alert, and nothing is stored.
- **DP-51 — Enquiry error and success journey** A marketing lead meets the length, intake-failure and limit refusals, retries and reaches the sent panel with both references, while the studio receives one enquiry per send.
- **DP-52 — Only the published surface** Every path, file and method outside the published pages, files and API answers the published 404 or 405, and no error reveals server internals.
- **DP-53 — Responsive layout and touch targets** At the three published widths every page fits without horizontal scrolling and follows the published layout, and on a phone every control is at least 44 by 44 pixels.
- **DP-54 — Menu dialog** Below 1024 pixels wide `Menu` opens a modal menu that keeps Tab inside, closes by Escape, `Close menu`, a tap outside or a link, and returns focus to `Menu`.
- **DP-55 — Mobile and accessibility journey** A marketing lead on a 375-pixel phone uses the menu, swipes and scrolls through the worlds by touch and meets no serious accessibility findings, also with reduced motion.
- **DP-56 — Deployment and health** The app installs, builds and serves from its run manifest on the published port and answers the health check as published.
- **DP-57 — Configuration from the environment** Every service address, credential and setting is read from the published environment variables at start and is never hard-coded or sent to the browser.
- **DP-58 — Gallery-dark editorial look** The studio's own pages show the deep ink ground, warm paper text, gold accent, high-contrast serif headlines and quiet sans body at an airy measure.
- **DP-59 — Distinct world art direction** The eight world islands and pages read as eight different brands through their own colours, type and island forms.
- **DP-60 — Real 3D stage** The stage is a real WebGL scene rendered from the served models, with no pre-rendered video or image standing in for it.

## Frontend

### Screens and layout (DP-01, DP-02, DP-03, DP-04, DP-27, DP-36, DP-42, DP-53)

**Site map and document titles.** Every address below answers HTTP 200 with the full page on a direct load, including reloads and deep links:

- `/`: home, with sections `intro`, `worlds` and `studio-in-brief`, then the footer. Title `Vellum Orbit Studio | Eight brand worlds`.
- `/worlds/<world slug>`: one world. Title `<world name> | Vellum Orbit Studio`.
- `/work`: the work gallery. Title `Selected work | Vellum Orbit Studio`.
- `/work/<project slug>`: one case study. Title `<project name> | Vellum Orbit Studio`.
- `/services` and `/services/<service id>`: services. Title `Services | Vellum Orbit Studio`.
- `/studio`: the studio. Title `The studio | Vellum Orbit Studio`.
- `/pricing`: the price list. Title `Price list | Vellum Orbit Studio`.
- `/faq`: questions. Title `Questions and answers | Vellum Orbit Studio`.
- `/contact`: the enquiry. Title `Start a project | Vellum Orbit Studio`.

**Not-found pages.** Each answers HTTP 404, has the title `Not found | Vellum Orbit Studio`, and shows a level-1 heading and a link:

- `/worlds/<unknown>`: heading `This world does not exist.`, link `Back to the worlds` (to `/`).
- `/work/<unknown>`: heading `This project does not exist.`, link `All work` (to `/work`).
- `/services/<unknown>`: heading `This service does not exist.`, link `All services` (to `/services`).
- Any other unknown page address: heading `This page does not exist.`, link `Back to Vellum Orbit Studio` (to `/`).

**Every page:**

- Is marked as English.
- Has exactly one `main` landmark and exactly one level-1 heading.
- Fits the viewport width at 1280x800, 768x1024 and 375x812. The page's full scroll width equals the viewport width, so nothing scrolls sideways.
- Marks each page section with `data-section="<name>"`. No element has an `id` equal to a section name.

**Header** (`banner`). Fixed to the top edge and 64 pixels tall at every width.

- On the left: the studio name as link `Vellum Orbit Studio home`.
- At 1024 pixels and wider: navigation `Main` on the right.
- Below 1024 pixels: button `Menu` on the right.

**Footer** (`contentinfo`). Shows, in this order:

- The text `Vellum Orbit Studio is a fictional studio. Every client, person, price and contact detail on this site is illustrative.`
- Navigation `Footer` with links `Work`, `Services`, `Studio`, `Pricing`, `Questions` (to `/faq`) and `Contact`.
- A level-2 heading `Illustrative contact`, followed by:
  - link `hello@vellumorbit.example` (to `mailto:hello@vellumorbit.example`)
  - link `+91 484 555 0142` (to `tel:+914845550142`)
  - text `Kochi, Kerala`
- Navigation `Social (illustrative)` with links that open in a new tab, without giving the new page access back to this one:
  - `Instagram (opens in a new tab)` (to `https://instagram.example/vellumorbit`)
  - `Behance (opens in a new tab)` (to `https://behance.example/vellumorbit`)
  - `LinkedIn (opens in a new tab)` (to `https://linkedin.example/company/vellumorbit`)
- The line `© 2026 Vellum Orbit Studio`.

At 1280 pixels the footer sits in four columns. At 768 pixels it uses two. At 375 pixels it uses one.

**Home, section `intro`.** Fills the viewport height.

- Level-1 heading in three lines: `Eight brands.`, `Eight worlds.`, `One small studio.` Each line is its own element. The heading's accessible name is the three lines joined by single spaces.
- Below it, the line `Vellum Orbit is a two-founder branding and digital design studio in Kochi. Step inside the work.`
- Button `Enter the worlds`.
- On desktop the heading spans columns 2 to 9 of a twelve-column grid. On a phone it spans the full width.

**Home, section `worlds`.** A `region` named `Worlds`, 8 viewport heights tall (in still mode, only as tall as its content). It holds the stage, which stays pinned in view while the section scrolls past. The stage element carries `data-stage` and the state attributes described in Interactions. Inside the stage:

- A `canvas`, hidden from screen readers, drawing the ring of eight islands seen from its centre.
- Over the canvas, on the twelve-column overlay:
  - the active world's numeral, such as `03 / 08` (two digits, a space, a slash, a space, `08`), hidden from screen readers;
  - the active world's name as a level-2 heading;
  - the world's industry name under the heading.
- Buttons `Previous world` and `Next world`, and button `Enter <world name>` for the active world.
- Navigation `World rail` along the bottom edge: eight buttons in ring order. Each shows a two-digit numeral (`01` to `08`, hidden from screen readers) and the world name. Each button's accessible name is exactly the world name.
  - At 768 pixels and wider all eight buttons fit in one row.
  - Below 768 pixels the rail is a strip that the visitor swipes sideways inside itself (the page never scrolls sideways). It keeps the active button in view.

**Home, section `studio-in-brief`.**

- Level-2 heading `The studio in brief`.
- The line `We design identities, websites, stores, packaging, applications and content for founders who want their business to look like itself.`
- Links `Our services` (`/services`), `See the price list` (`/pricing`), `Questions and answers` (`/faq`) and `Start a project` (`/contact`).

**World page** (`/worlds/<slug>`). The stage stays at the top as a band 60% of the viewport tall, showing the camera inside the island. On this page the stage's overlay, rail, `Previous world`, `Next world` and `Enter` button are absent; in still mode the band has no canvas. Below the band is an `article` with `data-world="<slug>"`. Its background is the world's ground colour and its text is the world's ink colour, both from Seed data. Contents, in order:

1. Level-1 heading: the world name, set in the world's display face (the first font in the heading's font list).
2. The line `<industry name> · <service names joined by ", ">`, with service names in the services' published order.
3. Level-2 `Overview` and the overview paragraph.
4. Level-2 `Visual identity`, followed by:
   - a list of three swatches `Ground <hex>`, `Ink <hex>` and `Accent <hex>` (each swatch's background is exactly that colour);
   - the line `Display face: <face>`.
5. Level-2 `Design decisions`: an ordered list of the three decisions, each with a level-3 title and a paragraph.
6. Level-2 `Deliverables` with the list.
7. Link `Read the full case study` (to `/work/<slug>`).
8. Links `Previous world: <name>` and `Next world: <name>` (Interactions).
9. Button `Back to all worlds`.

The article runs in one wide column, at most twelve columns across on desktop.

**Work gallery** (`/work`).

- Level-1 heading `Selected work`.
- The service filter group, then the `Industry` select and `Clear filters`, then the results status.
- List `Projects` of tiles. Each tile shows:
  - a small plate in the project's ground and accent colours;
  - a link named by the project name (to `/work/<slug>`);
  - the industry name;
  - the service names.
- The line `Showing <shown> of <total>` whenever at least one project matches, then `Show more work` when it applies.
- Tile columns: three at 1280 pixels, two at 768 pixels, one at 375 pixels.

**Case study** (`/work/<slug>`).

- Level-1 heading: the project name.
- The line `<industry name> · <service names joined by ", ">`.
- Level-2 sections in this order:
  1. `The brief`: paragraph.
  2. `Brand strategy`: paragraph.
  3. `Identity`: paragraph.
  4. `Typography`: lines `Display face: <face>` and `Body face: <face>`.
  5. `Colour`: the three swatches, as on world pages.
  6. `Digital design`: paragraph.
  7. `Implementation`: paragraph.
  8. `Gallery`: four thumbnail buttons.
  9. `Deliverables`: list.
- World projects add the link `Visit the world` (to `/worlds/<slug>`).
- Then links `Previous project: <name>` and `Next project: <name>`, and link `All work`.
- The case study page uses the project's ground, ink and display face just as a world page does.
- The text runs in a single wide measure. The gallery thumbnails sit in a row of four at 1280 pixels, two by two at 768 pixels and one column at 375 pixels.

**Services** (`/services`, `/services/<id>`).

- Level-1 heading `Services`.
- Tab list `Services`, then the selected panel. The tabs sit in one row at 1024 pixels and wider. Below that they form a strip that the visitor swipes sideways inside itself.
- Each panel contains:
  - a level-2 heading: the service name;
  - the purpose paragraph;
  - level-3 `Deliverables` with the list;
  - level-3 `Process` with four step buttons;
  - level-3 `Examples` with links to every project that has that service, in gallery order, each named by the project name;
  - links `See all <service name> work` (to `/work?service=<id>`), `See <service name> prices` (to `/pricing?category=<id>`) and `Enquire about <service name>` (to `/contact?service=<id>`).

**Studio** (`/studio`).

- Level-1 heading `The studio`.
- The line `Two founders, two designers, one room in Kochi. We take on six projects a season so each one gets our full attention.`
- Level-2 `What we care about`: the four principles from Seed data, each a level-3 heading and a paragraph. Two columns of two at 1280 pixels, one column at 375 pixels.
- Level-2 `The people`: the four people, each with name, role and one line.
- Level-2 `How a project runs`: an ordered list of the five stages, each with its line.
- Links `See the price list` (to `/pricing`) and `Start a project` (to `/contact`).

**Price list** (`/pricing`).

- Level-1 heading `Price list`.
- The note `Illustrative prices in Indian rupees for a fictional studio. They are not a quote and not any real studio's published prices.`
- The two filter groups, then status `Price results`, then the items.
- Each item is an `article` containing:
  - a level-2 heading: the item name;
  - the type badge `Fixed price` or `Custom quote`;
  - the price text;
  - `Delivery: <delivery>`;
  - `Revisions: <revisions>`;
  - button `Details for <item name>`.
- When expanded, the details show:
  - a list of the item's three inclusions;
  - the line `Payment: half to start, half on handover.` for fixed items, or `Quoted after a 30-minute call.` for custom quotes;
  - link `Enquire about <item name>` (to `/contact?service=<category>&item=<id>`).
- Items sit in three columns at 1280 pixels, two at 768 pixels and one at 375 pixels.

**Questions** (`/faq`).

- Level-1 heading `Questions and answers`.
- The eight questions in Seed data order. Each is a level-2 heading holding a button named by the question, followed by its answer region.

**Enquiry** (`/contact`).

- Level-1 heading `Start a project`.
- The line `Tell us about your business and the work you have in mind. Vellum Orbit is a fictional studio, so this form is a working demonstration: nothing you send reaches a real business.`
- The ordered list `Enquiry steps` (items `About you`, `Your project`, `Budget`, `Review`), then the current step.
- The line `Prefer email? hello@vellumorbit.example is an illustrative address.`
- The form is at most eight columns wide on desktop and the full width on a phone.
- Step contents:
  - Step 1: text field `Name`, email field `Email`, text field `Business name`; button `Next`.
  - Step 2: radio group `Service` with the six service names; text area `Project description` with its counter; buttons `Back` and `Next`.
  - Step 3: radio group `Approximate budget` with the five budget options from Business rules; buttons `Back` and `Next`.
  - Step 4: a description list with terms `Name`, `Email`, `Business name`, `Service`, `Enquiring about` (only when an item is attached), `Project description` and `Approximate budget`. Each value is the answer exactly as typed, with line breaks kept. Then:
    - buttons `Edit about you`, `Edit your project` and `Edit budget`;
    - the line `This demonstration stores your enquiry and hands it to a stand-in intake service. No real business will receive it.`;
    - buttons `Back` and `Send enquiry`.
- Each step has a level-2 heading `Step <n> of 4: <step name>`, where the step names are the four list items.
- When the address carries an item (Interactions), step 2 and the review show `Enquiring about: <item name>` with button `Remove item`.

### Public screens and controls (DP-02, DP-04, DP-05, DP-09, DP-15, DP-28, DP-31, DP-37, DP-39, DP-40, DP-43, DP-44, DP-54)

Only the roles, names and attributes in this table are public. Everything else is free.

| Role and accessible name | Where | Visible copy and state |
|---|---|---|
| link `Skip to content` | every page, first Tab stop | visible only while focused |
| `banner`, link `Vellum Orbit Studio home` | every page | studio name |
| navigation `Main`, links `Work`, `Services`, `Studio`, `Pricing`, `Contact` | 1024 px and wider | current link has `aria-current="page"` |
| button `Menu` | below 1024 px | `Menu`; `aria-expanded` |
| dialog `Menu` (modal), button `Close menu`, navigation `Menu sections` | below 1024 px, while open | same five links as `Main` |
| `contentinfo`, navigations `Footer` and `Social (illustrative)` | every page | Screens and layout |
| button `Enter the worlds` | `/` intro | `Enter the worlds` |
| `region` `Worlds` | `/` | contains the stage |
| element with `data-stage` | `/`, `/worlds/<slug>` | data attributes in Interactions |
| navigation `World rail`, eight buttons named by world names | `/` | active button has `aria-current="true"` |
| buttons `Previous world`, `Next world` | `/` | `disabled` at world 1 and world 8 respectively |
| button `Enter <world name>` | `/` | for the active world |
| `status` `World announcer` | `/` | Feedback states |
| heading `The eight worlds`, list `Worlds`, `article`s, links `Explore <world name>`, button `Try 3D again` | `/` in still mode | Interactions and Feedback states |
| `article` with `data-world`, links `Read the full case study`, `Previous world: <name>`, `Next world: <name>`, button `Back to all worlds` | `/worlds/<slug>` | |
| `group` `Filter by service`, six toggle buttons `<service name> (<count>)` | `/work` | `aria-pressed` |
| `combobox` (native select) `Industry` | `/work` | options `All industries (<count>)` and `<industry name> (<count>)` |
| buttons `Clear filters`, `Show more work`, `Show all projects` | `/work` | present only when they apply |
| list `Projects`, tile links named by project names | `/work` | |
| `status` `Results` | `/work` | Feedback states |
| buttons `Open image <n> of 4: <caption>` | `/work/<slug>` | thumbnails |
| dialog `Image viewer` (modal), buttons `Previous image`, `Next image`, `Close viewer` | `/work/<slug>` | `Image <n> of 4` and the caption |
| links `Visit the world`, `Previous project: <name>`, `Next project: <name>`, `All work` | `/work/<slug>` | |
| `tablist` `Services`, six `tab`s named by service names, `tabpanel` named by its tab | `/services` | `aria-selected` |
| buttons `<n>. <step name>` | service panels | `aria-expanded` |
| `radiogroup` `Category` with radios `All (<n>)` and `<service name> (<n>)` | `/pricing` | |
| `radiogroup` `Price type` with radios `All types (<n>)`, `Fixed price (<n>)`, `Custom quote (<n>)` | `/pricing` | |
| buttons `Details for <item name>`, `Show all items` | `/pricing` | `aria-expanded` on details |
| `status` `Price results` | `/pricing` | Feedback states |
| buttons named by each question, each answer a `region` named by its question | `/faq` | `aria-expanded` |
| list `Enquiry steps` | `/contact` | current item has `aria-current="step"` |
| textboxes `Name`, `Email`, `Business name`, `Project description` | `/contact` | |
| `radiogroup`s `Service`, `Approximate budget` | `/contact` | |
| buttons `Next`, `Back`, `Edit about you`, `Edit your project`, `Edit budget`, `Send enquiry`, `Remove item`, `Try again`, `Start another enquiry` | `/contact` | |
| `status` `Enquiry status`, `alert` | `/contact` | Feedback states |

### Interactions (DP-02, DP-04, DP-05, DP-07, DP-08, DP-09, DP-10, DP-11, DP-13, DP-14, DP-17, DP-18, DP-21, DP-22, DP-23, DP-24, DP-28, DP-29, DP-31, DP-32, DP-33, DP-36, DP-37, DP-39, DP-40, DP-43, DP-44, DP-45, DP-54)

**General rule.** Announcements, focus moves, address changes, document titles and every data attribute change in the same browser task as the action that causes them. Only the drawn motion follows over time. Drive every animation from the browser's own frame clock or from stylesheet transitions, never from timers that the visitor has to wait for, so a paused and stepped page clock controls all motion.

**Skip link and focus.**

- `Skip to content` moves focus to the page's level-1 heading. Headings can receive focus from script but are not Tab stops.
- Whenever an element receives focus by keyboard or by script, the page scrolls just enough to bring it into the clear zone. This covers Tab, Shift+Tab, an arrow key, a link, and any scripted focus move, including one that follows a pointer click or tap. An element is in the clear zone when:
  - its top edge is at least 72 pixels from the top of the viewport (8 pixels below the header);
  - when it fits, its bottom edge is inside the viewport.
- When the element is already in the clear zone, the page does not scroll.
- A pointer click or tap never scrolls the page by itself: focusing the control that was clicked never scrolls. Only a scripted focus move caused by the click follows the rule above. For example:
  - Clicking `Show more work` scrolls the first newly shown tile's link into the clear zone.
  - Clicking `Clear filters` scrolls the first `Filter by service` button into the clear zone, but only if it is outside it.
  - Clicking `Enter <world name>` shows the world page from its top (vertical scroll position 0). The page then scrolls only if the level-1 heading is not already in the clear zone.
- The pinned stage lays out its overlay, rail buttons, `Previous world`, `Next world` and `Enter <world name>` inside the clear zone. Focusing any of them therefore never moves the page away from the active world's scroll position.

**Current page.**

- `Work` is current on `/work` and `/work/<slug>`.
- `Services` is current on `/services` and `/services/<id>`.
- `Studio`, `Pricing` and `Contact` are current on their own pages.
- No link is current on `/`, `/worlds/<slug>` and `/faq`.
- The current link carries a visible underline 2 pixels thick.

**Menu.**

- `Menu` opens dialog `Menu` and moves focus to link `Work` inside it.
- Tab and Shift+Tab wrap inside the dialog.
- Escape, `Close menu`, or a tap outside the panel closes it and returns focus to `Menu`.
- Choosing a link closes the dialog and navigates.
- While closed, nothing inside it is reachable by Tab or by a screen reader.

**Opening scene.** On a fresh `/`:

- The Tab order is `Skip to content`, `Vellum Orbit Studio home`, the five `Main` links, then `Enter the worlds`. Below 1024 pixels, `Menu` replaces the five links.
- `Enter the worlds` (click, tap, Enter or Space), all in the same task:
  - the page jumps to the top of section `worlds` (world 1's position);
  - `data-camera` becomes `descending`;
  - focus moves to rail button `Ledgerwick Advisory`;
  - the announcer reads world 1's line, as qualified in Feedback states.
- After the descent (Motion and effects), `data-camera` becomes `ring`.
- In loading mode, `Enter the worlds` works exactly as in 3D mode.
- In still mode, `Enter the worlds` jumps to the top of section `worlds` and moves focus to link `Explore Ledgerwick Advisory`. `data-camera` stays `ring` and the announcer stays silent.
- Scrolling past the intro by wheel, keys or touch selects worlds by position and leaves `data-camera` at `ring`, with no descent.

**Stage state attributes.** The element with `data-stage` carries:

- `data-mode`:
  - `loading` while the scene models load;
  - `3d` once all eight have loaded;
  - `still` in the still layout.
- `data-active-world`: the active world's slug. Exactly one world is active at a time, and on load of `/` it is `ledgerwick`.
- `data-yaw`: the ring's yaw as drawn, in degrees with one decimal, from `0.0` to `315.0`, updated every frame.
- `data-target-yaw`: the active world's yaw. World k (1 to 8 in ring order) has yaw (k − 1) × 45, written with one decimal, for example `225.0` for world 6.
- `data-camera`: one of `ring`, `descending`, `entering`, `inside` or `leaving`.
- `data-emblem-angle`: the emblems' turn in degrees, with one decimal, from `0.0` to `359.9`, updated every frame. All eight emblems share this value.
  - It starts at `0.0` when `data-mode` becomes `3d`.
  - It rises at the idle emblem rate (Motion and effects), by the page clock, and wraps from just under 360 back to `0.0`.
  - It holds its value while `data-mode` is not `3d`, and stays `0.0` with reduced motion.

The overlay numeral and heading, the rail's current button and the announcer (whenever it holds a line) always name the world in `data-active-world`.

**Stage by mode.**

- `loading` and `3d` on `/`:
  - The canvas, the overlay (numeral, level-2 world name, industry name), `Previous world`, `Next world`, `Enter <world name>` and the rail are all present and work.
  - `data-yaw` and `data-camera` follow the same rules and timings in both modes. Turns and flights are computed while the models load, and the canvas starts drawing once all eight have loaded.
  - In `loading`, the stage also shows its loading text (Feedback states).
- `still` on `/`:
  - The element with `data-stage` remains and holds the still layout (below).
  - The canvas, overlay, rail, `Previous world`, `Next world` and `Enter <world name>` are absent.
  - On load of `/` in still mode, `data-active-world` is `ledgerwick`, `data-yaw` and `data-target-yaw` are `0.0`, and `data-camera` is `ring`.
  - After leaving a world page in still mode (by `Back to all worlds`, Escape or the browser Back button), `/` shows `data-active-world` equal to the slug of the world just left, `data-yaw` and `data-target-yaw` both equal to that world's yaw (for example `180.0` after leaving Neem & Nectar), and `data-camera` `ring`.
  - While `/` stays in still mode, scrolling, the cards and their links never change these attributes; only entering a world page (or `Try 3D again`, as described in Still layout) changes them.
- A world page, in any mode: `data-active-world` is that world. Once any flight ends, `data-yaw` equals `data-target-yaw` and `data-camera` is `inside`.

**Rail and buttons.**

- Only the active rail button is in the Tab order, and it carries `aria-current="true"`.
- With focus on the rail:
  - ArrowRight and ArrowDown select and focus the next world;
  - ArrowLeft and ArrowUp select and focus the previous world;
  - Home selects and focuses the first world, End the last;
  - there is no wrapping.
- Clicking or tapping a rail button selects that world.
- `Previous world` and `Next world` select the neighbouring world. They are `disabled` at world 1 and world 8 respectively.
- `Enter <world name>` always names the active world.

**Scroll decides the world on `/`.**

- Let p = (vertical scroll position − top of section `worlds`) ÷ viewport height. The active world is k = clamp(floor(p + 0.5), 0, 7) + 1. World k's position is p = k − 1.
- The active world, overlay, rail and announcer update in the scroll handler's own task.
- Selecting a world any other way (rail, keys, buttons, drag or swipe) jumps the page to that world's position in the same task, so the scroll position and the active world always agree.
- Scrolling beyond world 8's position, down to `studio-in-brief`, keeps world 8 active. Scrolling above the section keeps world 1 active.

**The turn.**

- Whenever `data-target-yaw` changes, the ring turns from the yaw currently drawn to the new target. The yaw moves straight between the two values, always in one direction, and reaches the target exactly within the ring-turn time (Motion and effects).
- Going from `315.0` back to `0.0` turns back through every world; the ring never takes the short way round.
- A new target during a turn starts a new full turn from the yaw drawn at that moment. So scrolling back mid-turn reverses the motion and settles on the world the scroll position names.

**Pointer drag on the stage** (mouse or pen, horizontal).

- A press anywhere on the stage starts a drag, except on its buttons, its links and the rail. This includes the overlay's numeral, heading and industry text, which let pointer and touch input pass through to the canvas below.

- While the pointer is down, the drawn yaw is: yaw at press + (press x − current x) × 0.1875, within 45 degrees either side of the yaw at press and never below `0.0` or above `315.0`. Dragging left turns towards the next world.
- On release:
  - a drag of 80 pixels or more selects the next world (dragged left) or the previous world (dragged right), then turns from the drawn yaw to the new target;
  - a shorter drag turns back to the unchanged target.
- At world 8 a left drag selects nothing, and at world 1 a right drag selects nothing.
- A press without movement does nothing.
- One drag selects at most one world.

**Touch on the stage** (the same area as for pointer drag).

- A one-finger swipe whose horizontal distance is at least 60 pixels and larger than its vertical distance selects the next world (swipe left) or the previous world (swipe right).
- The stage lets the browser handle vertical panning, so a vertical swipe scrolls the page and selects worlds by position.

**Entering a world.** `Enter <world name>` (click, tap, Enter or Space), all in the same task:

- the address becomes `/worlds/<slug>` as a new history entry;
- the title changes;
- the world page replaces the home content;
- focus moves to the world's level-1 heading;
- `data-camera` becomes `entering`.

The camera then flies into the island. When the flight ends, `data-camera` is `inside`.

**Leaving a world.** Button `Back to all worlds`, Escape (when focus is not in a text field and no dialog is open), or the browser Back button, all in the same task:

- the address becomes `/`;
- `data-camera` becomes `leaving`;
- the same world stays active;
- the page is at that world's scroll position;
- focus moves to `Enter <world name>`.

The camera flies out. When the flight ends, `data-camera` is `ring`. The browser Forward button enters the world again, exactly as entering does.

**World to world.**

- `Previous world: <name>` and `Next world: <name>` follow ring order without wrapping. The first world has no previous link and the last has no next link.
- Following one, all in the same task: the address changes, the title changes, focus moves to the new world's heading, and `data-active-world` and `data-target-yaw` change. The camera moves from island to island (`data-camera` is `entering`, then `inside`).
- A direct load of `/worlds/<slug>` shows the world with `data-camera="inside"` and no flight. Leaving from there goes to `/` with that world active.

**Scene loading and idle motion.**

- On first load of `/` or any `/worlds/<slug>`, the stage fetches all eight models from `/scenes/<slug>/world.glb`.
- While `data-mode` is `loading`, the rail, keys, buttons, announcer and `Enter` buttons already work. The canvas draws once all eight models have loaded.
- In `3d` mode the only idle motion is each island's emblem turning (Motion and effects).

**Still layout.** The still layout is used in two cases:

- the browser offers neither WebGL 2 nor WebGL;
- any of the eight models answers an error status or its request fails.

In the still layout:

- `data-mode` is `still`, and the stage attributes read as described in Stage by mode.
- Section `worlds` is only as tall as its content and the scroll rule is off.
- The section shows, in this order:
  - level-2 heading `The eight worlds`;
  - its notice (Feedback states);
  - button `Try 3D again`, after a model failure only;
  - list `Worlds`: eight `article`s in ring order.
- Each card has:
  - a level-3 heading: the world name;
  - the industry name;
  - the one-line summary;
  - a plate drawn with the page's own styling in the world's ground and accent colours;
  - link `Explore <world name>` (to `/worlds/<slug>`).
- The canvas, the overlay (numeral, level-2 world name, industry name), the rail, `Previous world`, `Next world` and `Enter <world name>` are absent, and the announcer stays silent.
- After a model failure, button `Try 3D again` fetches the eight models again:
  - when all eight load, `data-mode` becomes `3d` with world 1 active and focus on its rail button;
  - when any fails again, the still layout stays and its notice is shown again.
- World pages work in every mode. In `still` mode they have no canvas but keep the world's colours, type and content.
- In `still` mode, entering a world from a card, leaving it and moving from world to world are instant: `data-camera` goes straight to `inside` or `ring`.
- In `still` mode, leaving a world page (by `Back to all worlds`, Escape or the browser Back button) returns to `/` with focus on that world's `Explore <world name>` link, scrolled into the clear zone, and with the stage attributes set for the world just left as described in Stage by mode.

**Work filters.**

- Each service toggle button flips its `aria-pressed`. Choosing an option in `Industry` applies it at once. Matching and counts follow Business rules.
- `Clear filters` is present only while any filter is active. It clears both filters and moves focus to the first button of `Filter by service`.
- `Show all projects` (in the empty state) clears both filters.
- The first page of matching tiles shows. `Show more work`, present while more matches remain, appends the next page and moves focus to the first newly shown tile's link.

**Gallery address.**

- The address is `/work?service=<ids joined by ",">&industry=<id>&pages=<n>`. Each part appears only when it is not the default:
  - service ids appear in the services' published order;
  - `pages` is the number of pages shown, present when it is 2 or more.
- Every change replaces the address, with no new history entry.
- Loading an address with these parameters restores the filters and pages. Unknown values are ignored.

**Returning from a case study.**

- After the visitor opens a tile, the browser Back button or the case study's `All work` link returns to the exact gallery address they came from. Focus lands on that project's tile link, clear of the header.
- `All work` links to the gallery address this tab last showed, or to `/work` when the tab has shown none.

**Case studies.**

- `Previous project: <name>` and `Next project: <name>` follow gallery order and wrap: Ledgerwick Advisory's previous project is Relaywise, and Relaywise's next project is Ledgerwick Advisory. These links are the same whatever filter the visitor came from.
- Opening a thumbnail shows dialog `Image viewer` with:
  - the image (from `/media/<slug>/<n>.svg`, with the caption as alt text);
  - the text `Image <n> of 4`;
  - the caption.
- Focus starts on `Close viewer`.
- `Next image` and `Previous image` change the image and wrap (4 to 1 and 1 to 4). ArrowRight and ArrowLeft do the same with focus anywhere in the viewer. A one-finger horizontal swipe of 60 pixels or more on the image changes it, with a left swipe going to the next image.
- The text and caption change in the same task as the image.
- Tab and Shift+Tab wrap inside the viewer.
- Escape or `Close viewer` closes it and returns focus to the thumbnail that opened it.
- A failed image shows a plate in the project's ground colour, inside the image's frame, with the caption and the text `Image unavailable`.

**Services.**

- Tabs use automatic activation:
  - ArrowRight and ArrowLeft move focus and select, wrapping at the ends;
  - Home and End select the first and last tab;
  - a click or tap selects.
- Selecting a tab replaces the address with `/services/<id>`.
- `/services` selects the first tab. A direct load of `/services/<id>` selects that tab without moving focus.
- Process step buttons toggle by Enter, Space, click or tap, and any number of steps can be open. A collapsed step's paragraph is unreachable by Tab or screen reader.

**Price list.**

- `Details for <item name>` toggles by Enter, Space, click or tap, and any number can be open. Collapsed details are unreachable by Tab or screen reader.
- Filtering keeps each item's open or closed state.
- Radios behave as native radios: arrow keys move and select within a group.
- The address is `/pricing?category=<id>&type=<fixed or custom>`. Each part is present only when it is not an `All` option. The address is replaced on every change and restored on load, and unknown values are ignored.
- `Show all items` resets both groups to their `All` options.

**Questions.**

- All questions are collapsed at load.
- Enter, Space, click or tap toggles one question, and any number can be open. A collapsed answer is unreachable by Tab or screen reader.
- ArrowDown and ArrowUp move focus between question buttons, wrapping at the ends. Home and End move to the first and last. These keys never toggle.
- `/faq?open=<id>` loads with that question open and its button focused.

**Enquiry.**

- Moving to a step (by Next, Back or an Edit button) moves focus to that step's heading in the same task. The current item in `Enquiry steps` carries `aria-current="step"`.
- Back and Edit never change an answer. Next after an Edit continues to the following step.
- The address can pre-fill the form:
  - `/contact?service=<id>` selects that service on step 2;
  - adding `&item=<id>` (a price item of that service) attaches the item.
  - Unknown or mismatched values are ignored.
- `Remove item` detaches the item. Choosing a different service also detaches it.
- The `Project description` counter reads `<n> / 1,200 characters`, where n is the number of characters typed (counted by the Business rules length rule), with digits grouped, for example `1,024 / 1,200 characters`. It updates on every input.
  - The field has no hard cut-off; typing past the limit is allowed and the counter shows, for example, `1,201 / 1,200 characters`.
- Next checks every field of the current step (Business rules). Each invalid field gets `aria-invalid="true"` and its message below it, linked by `aria-describedby`. Focus moves to the first invalid field and the step does not change.
  - Text fields carry these attributes on the field itself.
  - For the `Service` and `Approximate budget` radio groups, the `radiogroup` element carries `aria-invalid="true"` and `aria-describedby`, and its message sits below the whole group.
  - When a radio group is the first invalid field, focus moves to its first radio. No radio is checked while the group is invalid.
  - A message disappears as soon as its field becomes valid while typing or choosing. No new message appears while typing.
- Draft:
  - The answers, the current step and the review's submission id are kept in this tab's session storage.
  - Leaving `/contact` (by a link, Back or a reload) and returning in the same tab restores every answer and the step.
  - A submission id is created when the visitor arrives at Review from another step. A reload on Review keeps it. Leaving Review by Back or an Edit button discards it.
  - A successful send clears the draft.
- `Send enquiry` posts once. Pressing it again, or pressing `Try again`, reuses the review's submission id.
- `Start another enquiry` shows an empty form at step 1 with focus on its heading.

### Visual design (DP-53, DP-58, DP-59)

**Colour.**

- The studio's own pages (home, work, services, studio, pricing, questions, enquiry, not found) sit on a deep blue-black ink ground.
- Text is a warm paper white.
- A burnished gold marks primary actions, the current rail item, the active step and focus rings.
- Thin dark graphite hairlines separate sections and table rows.
- Secondary text, such as industries and delivery lines, is a warm grey that still meets the text contrast rule.
- World pages and case studies replace the studio colours with the record's own ground, ink and accent.
- Write stylesheet colours as plain hexadecimal or red-green-blue values (alpha allowed). Never mix or compute colours in the stylesheet.

**Type.**

- Headlines on studio pages use Bodoni Moda, a high-contrast serif with very thin hairlines and heavy stems. Body text is Figtree, a quiet, open sans.
- Each heading level is about one third larger than the level below it, and the level-1 intro heading is large enough to fill about half the viewport width on desktop.
- Body lines stay between 60 and 75 characters on desktop.
- Every price, index numeral, rail number, step number, count and counter uses figures of equal width so columns line up.
- Fonts (Bodoni Moda, Figtree and the eight world display faces) are files served by the app itself.

**Density and composition.**

- Airy: generous space between sections (at least the height of two lines of body text) and wide margins.
- One fixed stage holds the ring, seen from its centre, with the numbered rail along the bottom edge and the editorial text panels laid on a twelve-column overlay.
- Inside a world, the case-study content runs in one wide measure below its scene. Below 768 pixels every panel stacks into one column.

**Islands.** Each world's island is a distinct form in its own colours:

- Ledgerwick Advisory: a stack of ruled slabs.
- Monsoon Crate Coffee: a crate on a hill under columns of rain.
- Basalt & Beam: basalt columns crossed by a beam.
- Quillstack: stacked blocks shaped like quills.
- Neem & Nectar: a leaf-shaped terrace.
- Reelhouse Pictures: a film reel standing on its edge.
- Tiffin Theory: stacked round tiers.
- Static Bloom: a petal mesh.

Each island carries one small emblem floating above it. The emblem has no rotational symmetry about its vertical axis (for example a single pointed blade or a one-sided flag), so every degree of its turn is visible.

**Size and contrast.**

- Every button, link and form control is at least 44 by 44 pixels at the phone width.
- All text meets WCAG 2.2 AA contrast against its own ground, including on the light world grounds, where the accent colour is never used for text.
- Keyboard focus shows an outline at least 2 pixels wide, with at least 3:1 contrast against the surface behind it, and it is absent when the element is not focused.

### Motion and effects (DP-04, DP-07, DP-10, DP-14, DP-19, DP-21, DP-54, DP-37)

These are all the motions on the site. Nothing else animates.

| Motion | What it means | Duration | With reduced motion |
|---|---|---|---|
| Intro descent (`data-camera` `descending`) | the visitor arrives at the ring | 900 milliseconds | completes at once |
| Ring turn (`data-yaw` towards `data-target-yaw`) | the active world changes | 450 milliseconds | completes at once |
| World entry, exit and world-to-world flight | the visitor goes into or out of a world, or between worlds | 700 milliseconds | completes at once |
| Idle emblem turn | the scene is live | one full turn every 24 seconds (15 degrees per second), continuous | none |
| Menu panel slide | the menu opens or closes | 200 milliseconds, sliding down from the header | completes at once |
| Image viewer slide | the image changes | 240 milliseconds, the new image sliding in from the side it comes from | completes at once |

**Signature: Orbit Pass.** The ring always shows which world is active, how far along the visitor is, and the way back to where they entered.

- Each viewport height of scroll, each drag of 80 pixels or more, each rail arrow key or rail step, and each swipe turns the ring by exactly one world (45 degrees).
- In each turn the camera eases to face the new island. The motion starts gently, is fastest at its midpoint and settles gently, symmetrically, within 450 milliseconds. The overlay numeral and name switch to the new world at once, the announcer reads it once and the rail marks it current.
- Scrolling back turns the ring back one world at a time. A scroll reversed mid-turn sets off a fresh turn from wherever the ring is and settles on the world the scroll position names.
- Entering a world flies the camera forward into its island in 700 milliseconds, with the same gentle start and settle. Leaving flies back out along the same path.
- From the intro, the camera descends from above onto the ring in 900 milliseconds.
- While the pointer drags, the ring follows the finger or mouse directly, with no easing.

**Idle motion.** Only the emblems move while the visitor does nothing. Each turns about its vertical axis once every 24 seconds, all in the same direction (anticlockwise seen from above). `data-emblem-angle` (Interactions) records the turn. There are no other decorative loops, no autoplay, no parallax and no hover-only content. Text never fades; opacity changes happen only inside the canvas. Apart from the ring, nothing is linked to scrolling.

**Reduced motion.** When the visitor asks for reduced motion, nothing moves:

- Every turn, descent, flight and slide completes in the task that starts it: `data-yaw` equals `data-target-yaw` at once, and `data-camera` goes straight to `ring` or `inside`.
- The emblems hold still, and no stylesheet or script animation runs anywhere.
- Dragging does not move the ring while the pointer is down, but a released drag of 80 pixels or more still selects a world at once.
- Every address, focus move, announcement, key and control works exactly as it does without reduced motion.
- The 3D scene still renders, at rest.
- The still layout is the same layout that appears without WebGL or after a model failure.

### Feedback states (DP-15, DP-23, DP-24, DP-26, DP-31, DP-40, DP-45, DP-48, DP-50)

**World announcer** (`status` `World announcer`).

- Reads `World <k> of 8: <world name>, <industry name>`, for example `World 3 of 8: Basalt & Beam, Architecture and real estate`.
- It is empty at load, and loading a page never sets it.
- Its text changes exactly once per change of active world. It never changes again while the scroll stays within one world's range, or while `data-mode` is `still`.
- `Enter the worlds` also sets it, in the same task, to world 1's line whenever it does not already hold that line. On a fresh `/` it is empty, so the first press always announces world 1.
- When it already holds world 1's line, pressing `Enter the worlds` leaves the text unchanged and nothing is re-announced. This happens, for example, after the visitor scrolls back up to the intro and presses again. The text is never cleared and rewritten to repeat a line.
- `Try 3D again` never sets it.

**Scenes.**

| State | What the visitor sees |
|---|---|
| Loading | while `data-mode` is `loading`, the stage shows `Loading the worlds…` |
| No WebGL | the notice `Your browser cannot show the 3D worlds, so here they are as a still gallery.` |
| Model failure, or the file store is down | the notice `Some 3D scenes could not load, so the worlds are shown as a still gallery.` and button `Try 3D again`; a failed retry shows the same notice again |
| Image failure | the plate with the caption and `Image unavailable` (Interactions) |

**Work results** (`status` `Results`).

- Reads `<n> projects match`, or `1 project matches` when exactly one matches.
- With none, it reads `No projects match these filters.`, list `Projects` is empty and `Show all projects` appears.
- It is empty at load and changes once per filter change, never on load, Show more or restore.

**Price results** (`status` `Price results`).

- Reads `Showing <n> of 14 items`.
- With none, it reads `No items match these filters.` and `Show all items` appears.
- It is empty at load and changes once per filter change.

**Enquiry field errors.** The messages are the ones in the Business rules field table, shown as described in Interactions.

**Enquiry send.**

| State | What the visitor sees |
|---|---|
| Pending | `Send enquiry` becomes disabled and reads `Sending…`; status `Enquiry status` reads `Sending your enquiry…` |
| Success (server answered 201) | the form is replaced by: a level-2 heading `Enquiry received` (focused in the same task the answer arrives); the line `Thank you, <name>. Your enquiry <reference> was recorded and handed to the studio's intake service as <intake reference>.`; the line `Vellum Orbit Studio is fictional, so no one will contact you.`; link `Back to the worlds` (to `/`); button `Start another enquiry`. `<name>` is the name as typed, `<reference>` and `<intake reference>` are the values in the response, and `Enquiry status` is empty. |
| Intake failure (server answered 502, any other 5xx, or a network failure) | the review stays with every answer; an `alert` reads `We could not hand your enquiry to the studio's intake service. Your answers are kept. Try again in a moment.`; button `Try again` receives focus |
| Too many (server answered 429) | the review stays with every answer; an `alert` reads `You have sent <limit> enquiries from this email address in the last <window> minutes. Try again in <m> minutes.`, and `Send enquiry` stays enabled |
| Field errors (server answered 422) | the form returns to the earliest step with an error and shows its messages there |

- In the too-many alert:
  - `<limit>` is `ENQUIRY_LIMIT` and `<window>` is `ENQUIRY_WINDOW_SECONDS` ÷ 60;
  - `<m>` is the response's `retry_after_seconds` ÷ 60, rounded up;
  - the last sentence reads `Try again in 1 minute.` when m is 1;
  - the alert receives focus;
  - with the defaults, for example, it begins `You have sent 3 enquiries from this email address in the last 10 minutes.`
- Each alert is replaced by the next send's outcome and removed on success.

## Backend

### API (DP-26, DP-34, DP-47, DP-48, DP-49, DP-50, DP-52, DP-56)

All responses are JSON in UTF-8 unless stated. Every `GET` route also answers `HEAD`. The content data is invented.

**Error order for the whole API.** Checks run in this order:

1. Unknown path: 404 `{"error":"not_found"}`.
2. Unpublished method: 405 `{"error":"method_not_allowed"}` with an `Allow` header listing the path's methods, for example `GET, HEAD`.
3. Content type: 415 `{"error":"unsupported_media_type"}`.
4. Body size: 413 `{"error":"too_large"}`.
5. Invalid JSON: 400 `{"error":"invalid_json"}`.
6. Field errors: 422 `{"errors":{"<field>":"<message>"}}`, listing every failing field.
7. The submission replay check.
8. The enquiry limit: 429.

Rows below name only their own extra errors.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | none | 200 `{"status":"ok"}` whenever Postgres answers, whatever MinIO and the intake service do | 503 `{"status":"unavailable"}` while Postgres does not answer |
| `GET /api/worlds` | none | 200 `{"items":[{"slug","name","index","industry_id","industry","services":[<ids>],"summary","colours":{"ground","ink","accent"},"display_face","yaw"}]}` in ring order; `index` is 1 to 8 and `yaw` is (index − 1) × 45 | |
| `GET /api/projects?service=<ids joined by ",">&industry=<id>&offset=<n>&limit=<n>` | query only | 200 `{"total":<n>,"items":[{"slug","name","industry_id","industry","services":[<ids>],"world_slug"}],"next_offset":<n>}` in gallery order; `world_slug` is `null` for projects 9 to 12, and `next_offset` is `null` when no items follow | 422 `{"errors":{"offset":"Must be a whole number of 0 or more."}}`, 422 `{"errors":{"limit":"Must be a whole number of 1 or more."}}` |
| `GET /api/projects/<slug>` | none | 200 with the list item's fields plus `"colours":{"ground","ink","accent"}`, `"display_face"`, `"body_face"`, `"sections":{"brief","strategy","identity","digital_design","implementation"}`, `"gallery":[{"n","caption","src"}]` (with `src` `/media/<slug>/<n>.svg`), `"deliverables":[...]`, `"previous":{"slug","name"}`, `"next":{"slug","name"}` | 404 `{"error":"not_found"}` |
| `GET /api/services` | none | 200 `{"items":[{"id","name","purpose","deliverables":[...],"steps":[{"name","text"}]}]}` in published order | |
| `GET /api/prices` | none | 200 `{"items":[{"id","category","name","type","price_text","delivery","revisions","inclusions":[...]}]}` in published order; `type` is `fixed` or `custom` | |
| `GET /api/questions` | none | 200 `{"items":[{"id","question","answer":[<paragraphs>]}]}` in published order | |
| `POST /api/enquiries` | Business rules | 201 `{"reference":"VO-000042","intake_reference":"<string>","status":"sent"}` | 502 `{"reference":"VO-000042","status":"intake_failed","error":"intake_unavailable"}`; 429 `{"error":"rate_limited","retry_after_seconds":<s>}` with header `Retry-After: <s>` |
| `GET /api/grading/enquiries?email=<address>` | header `X-Grading-Key: <GRADING_KEY>` | 200 `{"enquiries":[{"reference","submission_id","name","email","business_name","service","budget","description","item","intake_state","intake_reference","created_at"}]}`, oldest first, values as stored, email matched case-insensitively; `intake_reference` is `null` until sent, and `created_at` is an ISO 8601 UTC timestamp | answers the unknown-path 404 when the key header is missing or wrong, or when `GRADING_KEY` is unset |
| `GET /scenes/<world slug>/world.glb` | none | 200, content type `model/gltf-binary`, streamed from MinIO | 404 `{"error":"not_found"}` for an unknown slug or file; 503 `{"error":"file_unavailable"}` while MinIO cannot be reached |
| `GET /media/<project slug>/<n>.svg` (n from 1 to 4) | none | 200, content type `image/svg+xml`, streamed from MinIO | 404 and 503 as for scenes |

**`GET /api/projects` details.**

- `limit` defaults to `WORK_PAGE_SIZE`, and larger values are capped at it.
- `offset` defaults to 0.
- An `offset` at or past the end gives empty `items` and `next_offset` `null`.
- Unknown service or industry ids are ignored, as in the gallery.

**`POST /api/enquiries` request.**

- Content type `application/json`, with or without a charset.
- A body of at most 16,384 bytes is allowed; 16,385 bytes or more answers 413.
- The JSON object has the fields `name`, `email`, `business_name`, `service` (a service id), `budget` (a budget id), `description`, `item` (a price item id or `null`) and `submission_id` (a version 4 UUID).
- Any other field, such as `status`, `reference`, `intake_reference` or `created_at`, is ignored and never stored.

**Pages and assets.** Page addresses answer HTML. Every page address and every built browser asset that the pages reference (scripts, styles, fonts) answers `GET` and `HEAD`.

### Business rules (DP-13, DP-31, DP-32, DP-34, DP-40, DP-44, DP-45, DP-47, DP-48, DP-49, DP-50)

**Gallery matching** (the same in the gallery and in `GET /api/projects`).

- With no service chosen, every project matches the service filter. With services chosen, a project matches when it has at least one of them.
- The industry filter keeps only projects in that industry.
- Both filters apply together.
- Results always come in gallery order.

**Gallery counts.**

- A service button's count is the number of projects with that service among those matching the industry filter (the service filter is ignored for this count).
- An industry option's count is the number of projects in that industry that match the service filter (the industry filter is ignored).
- `All industries` counts every project that matches the service filter.

**Paging.**

- The page size is `WORK_PAGE_SIZE` (default 6).
- Pages are taken from the stable gallery order, so paging through any filter shows every match exactly once, with no repeat and no gap.

**Worked examples** with the starting content and a page size of 6:

- No filters: 12 projects match. The buttons read `Brand identity (7)`, `Framer websites (4)`, `Shopify stores (3)`, `Packaging (3)`, `Business applications (3)`, `Social and content (4)`. Page 1 is projects 1 to 6, and `Show more work` adds projects 7 to 12.
- `Packaging` and `Shopify stores` pressed: `3 projects match` (Monsoon Crate Coffee, Neem & Nectar, Tiffin Theory). The industry options read `All industries (3)`, `Food, coffee and hospitality (1)`, `Lifestyle and personal care (1)`, `Consumer products (1)`, and every other industry `(0)`.
- `Brand identity` pressed: `7 projects match`. Page 1 is Ledgerwick Advisory, Monsoon Crate Coffee, Basalt & Beam, Reelhouse Pictures, Static Bloom and Saltpan Kitchen, with `Showing 6 of 7`. `Show more work` adds Relaywise.
- `Brand identity` pressed with industry Food, coffee and hospitality: `2 projects match` (Monsoon Crate Coffee, Saltpan Kitchen). The buttons read `Brand identity (2)`, `Framer websites (0)`, `Shopify stores (1)`, `Packaging (1)`, `Business applications (0)`, `Social and content (1)`.
- `Business applications` and `Framer websites` pressed with industry Technology and software: Quillstack and Relaywise.
- `Social and content` pressed with industry Finance and professional services: `No projects match these filters.`

**Price filters.**

- A category count is the number of items in that category that match the type filter.
- A type count is the number of items of that type that match the category filter.
- The `All` options count every item that matches the other group.
- Worked examples with the starting content:
  - No filter: `All (14)`, `Brand identity (3)`, `Framer websites (2)`, `Shopify stores (2)`, `Packaging (2)`, `Business applications (2)`, `Social and content (3)`, `All types (14)`, `Fixed price (9)`, `Custom quote (5)`.
  - Social and content: `Showing 3 of 14 items`, with `All types (3)`, `Fixed price (2)`, `Custom quote (1)`.
  - Custom quote: `Showing 5 of 14 items`, with `All (5)`, `Framer websites (0)` and every other category `(1)`.
  - Brand identity with Fixed price: `Showing 2 of 14 items` (Logo and wordmark, Brand guidelines book), with `All (9)`.
  - Framer websites with Custom quote: `No items match these filters.`

**Length rule.** Lengths count characters as Unicode code points: an emoji such as 🌿 counts as 1, and each line break counts as 1. Each stated maximum is itself allowed.

**Enquiry fields.** The browser checks a field on Next; the server checks every field on post. The first failing rule of a field gives its message. A field that is missing or is not a string counts as empty.

| Field | Rule | Message |
|---|---|---|
| `name` | empty after trimming spaces | `Enter your name.` |
| `name` | over 80 characters | `Keep your name to 80 characters or fewer.` |
| `email` | empty after trimming | `Enter your email address.` |
| `email` | does not match `^[^\s@]+@[^\s@]+\.[^\s@]+$` | `Enter an email address like name@example.com.` |
| `business_name` | empty after trimming | `Enter your business name.` |
| `business_name` | over 120 characters | `Keep your business name to 120 characters or fewer.` |
| `service` | none chosen, or not a published service id | `Choose a service.` |
| `description` | under 30 characters after trimming | `Describe your project in at least 30 characters.` |
| `description` | over 1,200 characters | `Keep your description to 1,200 characters or fewer.` |
| `budget` | none chosen, or not a published budget id | `Choose an approximate budget.` |
| `item` | not `null` and not a price item of the chosen service | `Choose an item from the chosen service.` |
| `submission_id` | missing or not a version 4 UUID | `Missing submission id.` |

Values are stored exactly as sent, with no trimming and no change of case.

**Budget options** (id, visible label):

- `under-50k`: `Under ₹50,000`
- `50k-150k`: `₹50,000 to ₹1,50,000`
- `150k-500k`: `₹1,50,000 to ₹5,00,000`
- `above-500k`: `Above ₹5,00,000`
- `not-sure`: `Not sure yet`

**Enquiry steps** (browser).

- The steps run details → project → budget → review → sending → sent or failed.
- Next moves forward only when the current step is valid.
- Back moves to the previous step, and each Edit button jumps to its step. Neither changes an answer.
- From failed, `Try again` returns to sending.
- From the success panel, only `Start another enquiry` starts a new enquiry.

**Intake states** (server). Each stored enquiry has an intake state:

- `pending`: from storage until its hand-off ends.
- `sent`: the intake service accepted it.
- `failed`: the hand-off failed.

Allowed changes are `pending` → `sent`, `pending` → `failed`, and `failed` → `pending` (on a replay), which then goes on to `sent` or `failed`. A `sent` enquiry never changes again.

**New enquiry.** When the checks pass and the submission id is new:

1. The server assigns the next reference: `VO-` and six digits, in order, starting at `VO-000001`.
2. It stores the enquiry with intake state `pending`.
3. It makes exactly one intake request (Services).
   - A 201 answer whose JSON has a non-empty string `intake_reference` sets the state to `sent` and stores that intake reference. The response is the 201 body with that intake reference.
   - Any other status, an unreadable body, a connection error, or no answer within `INTAKE_TIMEOUT_MS` (default 5000 milliseconds) sets the state to `failed`. The response is the 502 body. An intake answer that arrives after the timeout changes nothing.
4. Only these states decide the answer. The browser shows the enquiry as sent only on the 201 response.

**Replay.** A post whose `submission_id` is already stored creates nothing new, and its other fields are ignored. It answers according to the stored enquiry:

- intake state `sent`: 201 with the stored references, and no intake request;
- intake state `failed`: the server hands the stored enquiry to the intake service again (one intake request) and answers 201 or 502 as for a new enquiry;
- intake state `pending`: the server waits for the hand-off in progress to end, then answers as above.

A replay never counts towards the limit and is never refused by it.

**Simultaneous posts.** When several posts carry the same new submission id at once, exactly one stores the enquiry and makes the intake request. The others wait for that hand-off to end and answer as a replay. So pressing Send twice gives one enquiry, one reference and one intake request.

**Limit per email.**

- At most `ENQUIRY_LIMIT` (default 3) new enquiries are stored per email address, compared case-insensitively, within the last `ENQUIRY_WINDOW_SECONDS` (default 600) seconds by server time.
- The next new post answers 429 with `retry_after_seconds` (and `Retry-After`) set to the seconds until the oldest counted enquiry leaves the window, rounded up, and stores nothing.
- Refused posts (415, 413, 400, 422, 429) never count.

### Services (DP-22, DP-26, DP-48, DP-57)

**Postgres** (`DATABASE_URL`) holds:

- the eight worlds;
- the twelve projects with their case-study sections, gallery captions and gallery order;
- the six services with deliverables and steps;
- the fourteen price items with categories and inclusions;
- the eight questions with answers;
- every enquiry exactly as submitted, with its reference, submission id, intake state, intake reference and creation time.

The app applies its schema on every start without harm to existing data. When the content tables are empty it stores the starting content from Seed data. Two instances starting against the same database at the same moment store the starting content once.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). The bucket is private. It holds:

- each world's model under key `scenes/<world slug>/world.glb`: binary glTF 2.0 with at least 5,000 vertices, drawing the island and its emblem in the world's colours;
- every gallery image under key `media/<project slug>/<n>.svg` (n from 1 to 4): an SVG at least 1,200 by 800 units drawing an abstract composition in the project's three colours.

The app generates these files itself and stores any that are missing:

- at start;
- when MinIO is unreachable at start, as soon as it answers, checking at least every 10 seconds.

The browser gets the files only through `/scenes/...` and `/media/...` (API). **While MinIO is down:** the app starts, every page and the enquiry work, file routes answer the 503 from API, the stage falls back to the still layout with the model-failure notice, and gallery images show their plates (Feedback states).

**Project-intake service** (`WIREMOCK_URL`; a stand-in, and every reference it returns is invented). For each hand-off the server sends `POST ${WIREMOCK_URL}/v1/intake/enquiries` with `Content-Type: application/json` and this body, built from the stored values:

```json
{"reference":"VO-000042","name":"Anika Joseph","email":"anika@pepperleaf.example","business_name":"Pepperleaf Teas","service":"packaging","budget":"50k-150k","description":"A range of six tea tins for a new Kochi tea label.","item":"pack-range","source":"vellum-orbit-site"}
```

(The values above are an invented example.)

- A success answer is `201` with `{"intake_reference":"<string>"}`, for example `{"intake_reference":"IN-DEMO-0001"}`. That is the stand-in's baseline answer to every hand-off.
- The app never calls the service's admin interface.
- **While the intake service is down or failing:** every send ends in the 502 from API and the intake-failure alert from Feedback states, and the enquiry is stored with intake state `failed`.

### Seed data (DP-27, DP-29, DP-36, DP-39, DP-42, DP-43)

Every client, person, business, price and contact detail below is invented. The starting content is exactly this, and nothing on the site changes it. All projects use Figtree as their body face.

**Industries** (id, name, in this order):

- `finance`: Finance and professional services
- `food`: Food, coffee and hospitality
- `architecture`: Architecture and real estate
- `technology`: Technology and software
- `lifestyle`: Lifestyle and personal care
- `film`: Film and creative production
- `consumer`: Consumer products
- `experimental`: Experimental

**Services** (id, name, in this order): `brand-identity` Brand identity, `framer-websites` Framer websites, `shopify-stores` Shopify stores, `packaging` Packaging, `business-applications` Business applications, `social-content` Social and content.

**Projects in gallery order.** Projects 1 to 8 are the eight worlds, in ring order. Each colour below is six hexadecimal digits written without a leading hash sign. Wherever the site shows or uses one (swatch labels such as `Ground <hex>`, page backgrounds, text and plates), it is that value with a hash sign in front.

| # | slug | name | industry | services | ground | ink | accent | display face |
|---|---|---|---|---|---|---|---|---|
| 1 | `ledgerwick` | Ledgerwick Advisory | finance | brand-identity, framer-websites | `0F1B2D` | `F2E9D8` | `C49A5A` | Libre Caslon Display |
| 2 | `monsoon-crate` | Monsoon Crate Coffee | food | brand-identity, packaging, shopify-stores | `1E2B22` | `F4E6D0` | `D08A3E` | Fraunces |
| 3 | `basalt-beam` | Basalt & Beam | architecture | brand-identity, framer-websites | `2A2A2C` | `EDEBE6` | `E3B23C` | Archivo |
| 4 | `quillstack` | Quillstack | technology | business-applications, framer-websites | `120F2A` | `E7E4FF` | `8C7CFF` | JetBrains Mono |
| 5 | `neem-nectar` | Neem & Nectar | lifestyle | packaging, shopify-stores, social-content | `F3EEDC` | `1F3A26` | `C98A1B` | DM Serif Display |
| 6 | `reelhouse` | Reelhouse Pictures | film | brand-identity, social-content | `0B0B0B` | `F5D9A8` | `E4572E` | Bebas Neue |
| 7 | `tiffin-theory` | Tiffin Theory | consumer | packaging, shopify-stores | `E9EDEF` | `1A1F24` | `E0A100` | Rubik |
| 8 | `static-bloom` | Static Bloom | experimental | brand-identity, social-content | `2B0F2A` | `FFE3F1` | `FF4FA3` | Syne |
| 9 | `copperline` | Copperline Tax Partners | finance | business-applications | `1C2321` | `EFE7D7` | `B87333` | Libre Caslon Display |
| 10 | `saltpan-kitchen` | Saltpan Kitchen | food | social-content, brand-identity | `F1ECE2` | `23303A` | `2F7F8F` | DM Serif Display |
| 11 | `courtyard-homes` | Courtyard Homes | architecture | framer-websites | `E8E1D5` | `2B2622` | `9A5B34` | Archivo |
| 12 | `relaywise` | Relaywise | technology | brand-identity, business-applications | `0E1A1F` | `E2F1F0` | `3FD0B6` | Rubik |

**World copy.** Each world is listed with its summary, overview, three design decisions (title and paragraph) and deliverables. A world's deliverables are also its case study's `Deliverables`.

1. **Ledgerwick Advisory**
   - Summary: `A quiet, ledger-ruled identity for a Kochi advisory firm that wanted to feel steady rather than corporate.`
   - Overview: `Ledgerwick Advisory helps family businesses in Kerala with accounts, tax and succession planning. The partners wanted clients to feel the calm of a well-kept ledger the moment they opened a letter or the website. We built the identity on fine ruled lines, a warm brass accent and a classical display face, then carried it into a calm Framer website with plain-language service pages.`
   - Decisions:
     - `Ruled lines as structure`: `Every layout sits on a grid of hairline rules borrowed from account books, so letters, reports and web pages share one quiet rhythm.`
     - `Brass, used sparingly`: `The brass accent marks only the one thing a reader must act on, such as a signature line or a booking link.`
     - `A classical voice`: `Libre Caslon Display gives headings the weight of an old institution while the body text stays plain and easy to read.`
   - Deliverables: `Logo and wordmark`; `Stationery and report templates`; `Brand guidelines book`; `Framer website, six pages`.
2. **Monsoon Crate Coffee**
   - Summary: `A rain-washed identity, packaging range and Shopify store for a small-batch coffee roaster in the Western Ghats.`
   - Overview: `Monsoon Crate roasts beans from three estates near Chikmagalur and ships them in small crates across India. The founder wanted the brand to carry the smell of wet earth and the season that shapes the harvest. We drew a rain-streak pattern for the packs, set the labels in a soft serif and built a Shopify store where each estate has its own page.`
   - Decisions:
     - `Rain as a pattern`: `A pattern of slanted streaks changes density with the roast: light roasts get a drizzle, dark roasts a downpour.`
     - `Labels that read like field notes`: `Each pack lists estate, altitude and roast date in a small typed block, the way a buyer would note a sample.`
     - `One store, three estates`: `The Shopify store groups coffees by estate so a returning buyer finds their usual bag in two taps.`
   - Deliverables: `Logo and wordmark`; `Packaging range of six packs`; `Shopify store with subscription page`; `Brand guidelines book`.
3. **Basalt & Beam**
   - Summary: `A sturdy, grid-built identity and portfolio website for a two-partner architecture practice.`
   - Overview: `Basalt & Beam is a two-partner practice that designs homes and small public buildings in laterite and timber. They wanted a brand as honest as their materials and a website that lets drawings speak first. We built the identity from a construction grid, a single ochre accent and a compact grotesque, and designed a Framer portfolio where every project opens on its plan.`
   - Decisions:
     - `The grid is the logo`: `The mark is cut from the same grid that structures every sheet, so the logo and the drawings belong to one system.`
     - `Drawings before photographs`: `Each project page opens on its plan or section, with photographs following, because clients hire the practice for its thinking.`
     - `One ochre line`: `A single ochre line marks the current project and section, like a highlighter on a drawing set.`
   - Deliverables: `Logo and mark`; `Drawing-sheet and presentation templates`; `Framer portfolio website`; `Signage guidelines`.
4. **Quillstack**
   - Summary: `A precise, code-born identity and product design for a start-up that turns field notes into reports.`
   - Overview: `Quillstack builds a mobile and web application that lets field teams write short notes and turns them into weekly reports. The founders wanted a brand that felt exact without feeling cold. We built the identity around a monospaced face and a violet signal colour, designed the application's core flows and launched a Framer marketing site that explains the product in four screens.`
   - Decisions:
     - `Monospace as voice`: `JetBrains Mono sets headings and numbers so the brand reads like a well-formatted log.`
     - `A violet signal`: `Violet appears only on live, changing data, so users learn that colour means something is happening.`
     - `Flows before screens`: `We mapped every path from first note to finished report before drawing a single screen.`
   - Deliverables: `Logo and wordmark`; `Application flows and wireframes`; `Application interface design`; `Framer marketing website`.
5. **Neem & Nectar**
   - Summary: `A botanical packaging range, Shopify store and social kit for a small-batch skincare label.`
   - Overview: `Neem & Nectar makes soaps, balms and oils from neem, honey and coconut in small batches. The founder wanted packs that look kept rather than thrown away. We drew a set of botanical line illustrations, chose a warm display serif and a cream ground, built a Shopify store with clear ingredient pages and made a template kit for weekly posts.`
   - Decisions:
     - `Ingredients on the front`: `Every pack names its three main ingredients on the front face, in the same order as the label.`
     - `Line drawings, not photographs`: `Hand-drawn leaves and flowers keep the range consistent even when products change.`
     - `A kit the founder can run`: `The social kit gives the founder six layouts to fill without a designer.`
   - Deliverables: `Packaging range of eight products`; `Shopify store`; `Social template kit`; `Illustration library`.
6. **Reelhouse Pictures**
   - Summary: `A bold, poster-loud identity and content system for an independent film production house.`
   - Overview: `Reelhouse Pictures produces documentaries and short films in Malayalam and English. The producers wanted a brand that could sit on a festival poster and a phone screen with equal force. We set the name in a tall condensed face, paired black with a projector-lamp red and built a content system for trailers, stills and release announcements.`
   - Decisions:
     - `Title-card typography`: `Bebas Neue sets every title like an opening card, tall and tightly spaced.`
     - `Red means release`: `The red accent is kept for release dates and calls to watch, so it always signals news.`
     - `A frame for every format`: `One frame system adapts each still to posters, stories and wide banners without recropping by hand.`
   - Deliverables: `Logo and title card`; `Poster templates`; `Social and content system`; `Trailer end-card designs`.
7. **Tiffin Theory**
   - Summary: `A bright, stackable packaging system and Shopify store for a brand of steel lunch boxes.`
   - Overview: `Tiffin Theory makes stackable steel lunch boxes with leak-proof lids. The founders wanted the boxes to stand out on a shelf of plain steel and to explain their tiers at a glance. We designed sleeves that show each tier as a coloured band, set them in a friendly rounded grotesque and built a Shopify store where buyers compare sizes side by side.`
   - Decisions:
     - `Tiers as bands`: `Each sleeve shows the box's tiers as stacked yellow and grey bands, so size is clear from across the aisle.`
     - `Rounded and friendly`: `Rubik's soft corners echo the rounded steel of the boxes.`
     - `Compare, then buy`: `The store's size table lets buyers compare capacity, tiers and weight before choosing.`
   - Deliverables: `Packaging sleeves for four sizes`; `Shipping carton design`; `Shopify store`; `Product photography direction`.
8. **Static Bloom**
   - Summary: `A loud, glitch-flower identity for an experimental music and visual arts collective.`
   - Overview: `Static Bloom is a collective that runs late-night sound and light events in Kochi. They asked for a brand that could change every season without losing itself. We built a flower mark from interference patterns, chose a wide display face and a neon pink, and made a content kit that remixes the mark for each event.`
   - Decisions:
     - `A mark that mutates`: `The flower mark is generated from a pattern seed, so each event gets its own bloom from the same family.`
     - `Pink on plum`: `Neon pink on deep plum gives the collective one colour pair people remember after dark.`
     - `Wide type, short words`: `Syne's wide letterforms work best on short event names, so the copy stays to a few words.`
   - Deliverables: `Generative logo system`; `Event poster templates`; `Social and content kit`; `Stage visual loops`.

**Case-study copy.** For each project: The brief / Brand strategy / Identity / Digital design / Implementation, then the four gallery captions in order.

- **Ledgerwick Advisory**
  - `Give a forty-year-old advisory firm a brand that feels steady and current, and a website that explains its services in plain language.`
  - `We positioned the firm as the calm keeper of a family's numbers, not a large consultancy, and wrote every message around steadiness.`
  - `A wordmark in a classical display face sits on hairline rules taken from ledger paper, with brass kept for signatures and calls to act.`
  - `The website uses the same ruled grid, with one service per page and a short answer at the top of each.`
  - `We built the six-page site in Framer and handed over templates for letters and reports in the firm's office software.`
  - Captions: `Wordmark on ruled ledger paper`; `Letterhead and report cover`; `Services page on the Framer website`; `Brass accent on a signature line`.
- **Monsoon Crate Coffee**
  - `Launch a coffee brand that carries the monsoon, with packs for six coffees and an online store.`
  - `We built the story around the season that shapes each harvest and let each estate speak for its own coffees.`
  - `A rain-streak pattern changes density with roast level, under a soft serif wordmark and an amber accent.`
  - `The store groups coffees by estate and puts roast date and grind options on every product page.`
  - `We set up the Shopify store with a subscription page and supplied print-ready files for all six packs.`
  - Captions: `Six packs in the rain-streak pattern`; `Estate label with altitude and roast date`; `Shopify product page for a dark roast`; `Delivery crate with stamped logo`.
- **Basalt & Beam**
  - `Give a two-partner practice an identity as honest as its materials and a portfolio that shows drawings first.`
  - `We framed the practice around thinking in plan and section, so every surface leads with a drawing.`
  - `The mark is cut from a construction grid and paired with a compact grotesque and one ochre line.`
  - `Each portfolio page opens on a plan, then sections, then photographs, with the ochre line marking where you are.`
  - `We built the portfolio in Framer with a project template the partners update themselves.`
  - Captions: `Mark drawn on the construction grid`; `Drawing-sheet title block`; `Portfolio page opening on a plan`; `Site signage in laterite and brass`.
- **Quillstack**
  - `Name the product's voice, map how field notes become reports and launch a site that explains it in four screens.`
  - `We positioned Quillstack as the exact, quiet tool that saves a field team's Friday afternoon.`
  - `A monospaced wordmark and a violet signal colour give the brand the order of a clean log file.`
  - `We designed the note, review and report flows for phone and desktop, with violet kept for live data.`
  - `We handed over the application design system and built the four-screen marketing site in Framer.`
  - Captions: `Monospaced wordmark and signal colour`; `Field note screen on a phone`; `Weekly report on desktop`; `Framer marketing site hero`.
- **Neem & Nectar**
  - `Design a range of eight skincare packs, a Shopify store and a social kit the founder can run alone.`
  - `We built the brand around ingredients you can name, shown plainly and in the same order everywhere.`
  - `Botanical line drawings, a warm display serif and a cream ground make the range feel kept rather than thrown away.`
  - `Each product page in the store leads with its ingredients and how to use it, before the price.`
  - `We set up the Shopify store and delivered six editable post layouts with the illustration library.`
  - Captions: `Eight packs on a cream ground`; `Neem leaf line drawing`; `Ingredient-first product page`; `Weekly post from the social kit`.
- **Reelhouse Pictures**
  - `Create a brand that holds its own on a festival poster and a phone screen, plus a system for release content.`
  - `We treated every touchpoint as a title card: one bold line, one date, one call to watch.`
  - `A tall condensed wordmark on black with a projector-lamp red reserved for releases.`
  - `The content system resizes stills into posters, stories and banners from one frame grid.`
  - `We delivered poster and social templates and end cards for trailers in two languages.`
  - Captions: `Title card in condensed type`; `Festival poster template`; `Release story on a phone`; `Trailer end card`.
- **Tiffin Theory**
  - `Make steel lunch boxes stand out on a shelf of plain steel and explain their tiers at a glance.`
  - `We sold the boxes on clarity: how many tiers, how much food and whether it leaks, in that order.`
  - `Sleeves show each tier as a stacked band in yellow and grey, set in a rounded grotesque.`
  - `The store's size table compares capacity, tiers and weight side by side before checkout.`
  - `We supplied sleeve and carton artwork for four sizes and set up the Shopify store.`
  - Captions: `Four sleeves with tier bands`; `Shipping carton`; `Size comparison table`; `Stacked boxes on a shelf`.
- **Static Bloom**
  - `Give an experimental collective a brand that can change each season without losing itself.`
  - `We made change the constant: one family of marks, a new bloom for every event.`
  - `A flower mark generated from interference patterns, a wide display face and neon pink on plum.`
  - `The content kit remixes the mark for each event in posts, stories and stage visuals.`
  - `We delivered the mark generator, poster templates and a set of stage visual loops.`
  - Captions: `A season of generated blooms`; `Event poster in pink on plum`; `Event story sequence`; `Stage visual still`.
- **Copperline Tax Partners**
  - `Design a client portal where small businesses upload invoices and see where their tax return stands.`
  - `We built the portal around one question clients always ask: what do you still need from me?`
  - `We worked within the firm's existing copper wordmark and added a clear status palette for the portal.`
  - `The portal shows each return as a short checklist with the missing documents at the top.`
  - `We delivered the portal flows, interface design and a component library for the firm's developers.`
  - Captions: `Return checklist on desktop`; `Invoice upload on a phone`; `Status colours`; `Portal component sheet`.
  - Deliverables: `Portal flows and wireframes`; `Portal interface design`; `Component library`.
- **Saltpan Kitchen**
  - `Refresh a coastal seafood kitchen's identity and give it a weekly content rhythm.`
  - `We built the brand on the tide: what came in today is what is on the menu.`
  - `A salt-crystal mark, a sea-blue accent and a warm serif for menus and signs.`
  - `A weekly post series shows the day's catch, the dish and the boat it came from.`
  - `We delivered the identity files, menu templates and twelve weeks of post layouts.`
  - Captions: `Salt-crystal mark`; `Menu board`; `Day's catch post`; `Takeaway bag`.
  - Deliverables: `Logo and mark`; `Menu templates`; `Social and content series`.
- **Courtyard Homes**
  - `Build a website for a builder of courtyard homes that lets buyers walk a plan before visiting.`
  - `We led with the courtyard, the one room every buyer remembers, on every page.`
  - `We kept the builder's existing logo and set the site in a compact grotesque with a terracotta accent.`
  - `Each home page pairs a large plan with photographs placed by room.`
  - `We built the Framer site with a template the sales team uses for each new home.`
  - Captions: `Home page with courtyard photograph`; `Plan with rooms marked`; `Home listing on a phone`; `Enquiry section`.
  - Deliverables: `Framer website, five pages`; `Home listing template`.
- **Relaywise**
  - `Name and brand a delivery-routing start-up and design the dispatcher's main screens.`
  - `We positioned Relaywise as the calm voice in a busy dispatch room.`
  - `A relay-baton mark, a rounded grotesque and a teal signal for routes on time.`
  - `The dispatcher's screen shows every route as one line, teal when on time and amber when late.`
  - `We delivered the identity, the dispatcher interface design and a component library.`
  - Captions: `Relay-baton mark`; `Dispatcher route board`; `Driver view on a phone`; `Brand colour sheet`.
  - Deliverables: `Logo and wordmark`; `Brand guidelines`; `Dispatcher interface design`.

**Service copy.** For each service: purpose, deliverables, then the four process steps (name and paragraph).

- **Brand identity**
  - Purpose: `A brand identity gives your business one recognisable look and voice, from the logo to the way you write an invoice.`
  - Deliverables: `Logo and wordmark`; `Colour palette and type pairing`; `Brand guidelines book`; `Stationery templates`.
  - Steps:
    1. `Discovery`: `We talk with the founders and a few customers to learn what the business stands for.`
    2. `Strategy`: `We agree on positioning and a short list of words the brand must feel like.`
    3. `Design`: `We present two routes, then develop the chosen one into a full system.`
    4. `Guidelines`: `We hand over files and a guidelines book so anyone can use the brand well.`
- **Framer websites**
  - Purpose: `A Framer website is fast to launch and easy for you to edit, with designed pages rather than a template.`
  - Deliverables: `Site map and page wireframes`; `Designed pages for phone and desktop`; `Built Framer site with editable content`; `Launch and handover session`.
  - Steps:
    1. `Map`: `We list every page and what each must help a visitor do.`
    2. `Design`: `We design the pages for phone and desktop in your brand.`
    3. `Build`: `We build the site in Framer and connect your domain.`
    4. `Launch`: `We launch, then walk you through editing your own pages.`
- **Shopify stores**
  - Purpose: `A Shopify store designed around how your customers actually choose and buy your products.`
  - Deliverables: `Store structure and product page design`; `Theme setup or custom theme`; `Payment, shipping and tax settings`; `Training for your team`.
  - Steps:
    1. `Audit`: `We review your products, prices and how orders reach you today.`
    2. `Structure`: `We plan collections, filters and product pages.`
    3. `Build`: `We design and build the store and load your first products.`
    4. `Train`: `We train your team to add products and handle orders.`
- **Packaging**
  - Purpose: `Packaging that stands out on a shelf, explains the product and prints well at your printer.`
  - Deliverables: `Pack structure and dieline`; `Front, back and side artwork`; `Print-ready files`; `Printer proof check`.
  - Steps:
    1. `Shelf study`: `We look at where your product sits and what surrounds it.`
    2. `Concepts`: `We present three concepts on mock-up packs.`
    3. `Artwork`: `We complete the artwork for every face and every variant.`
    4. `Print check`: `We check the printer's proof before the run.`
- **Business applications**
  - Purpose: `Clear, usable screens for the software your team or customers use every day.`
  - Deliverables: `User flows and wireframes`; `Interface design for phone and desktop`; `Component library`; `Developer handover`.
  - Steps:
    1. `Research`: `We watch how people do the task today.`
    2. `Flows`: `We map every path through the application.`
    3. `Interface`: `We design the screens and their states.`
    4. `Handover`: `We hand over the design system and answer your developers' questions.`
- **Social and content**
  - Purpose: `Templates and monthly content that keep your social channels consistent without a full-time designer.`
  - Deliverables: `Template kit for posts and stories`; `Monthly content calendar`; `Designed posts each month`; `Usage guide`.
  - Steps:
    1. `Audit`: `We review your channels and what your audience responds to.`
    2. `Kit`: `We design templates your team can fill.`
    3. `Calendar`: `We plan each month's posts with you.`
    4. `Produce`: `We design the month's posts and send them ready to publish.`

**Price items** (in this order; all prices are illustrative):

| id | category | name | type | price text | delivery | revisions | inclusions |
|---|---|---|---|---|---|---|---|
| `logo-wordmark` | brand-identity | Logo and wordmark | Fixed price | `₹45,000` | 2 to 3 weeks | 3 revision rounds | Two initial logo routes; Final logo in colour and one-colour versions; Files for print and screen |
| `identity-system` | brand-identity | Brand identity system | Custom quote | `From ₹1,80,000` | 6 to 8 weeks | 3 revision rounds | Logo, colour and type system; Brand guidelines book; Stationery and social templates |
| `brand-guidelines` | brand-identity | Brand guidelines book | Fixed price | `₹60,000` | 2 weeks | 2 revision rounds | Up to 40 pages of guidance; Logo, colour and type rules; Editable source file |
| `framer-landing` | framer-websites | Framer landing page | Fixed price | `₹55,000` | 2 weeks | 2 revision rounds | One designed page for phone and desktop; Built in Framer with editable text; Contact form and domain setup |
| `framer-site` | framer-websites | Framer website, up to 8 pages | Fixed price | `₹1,40,000` | 4 to 5 weeks | 2 revision rounds | Up to 8 designed pages; Built in Framer with editable content; One editing training session |
| `shopify-theme` | shopify-stores | Shopify theme setup | Fixed price | `₹85,000` | 3 weeks | 2 revision rounds | Theme chosen and styled to your brand; Up to 30 products loaded; Payment and shipping settings |
| `shopify-custom` | shopify-stores | Custom Shopify store | Custom quote | `From ₹2,50,000` | 8 to 10 weeks | 3 revision rounds | Custom theme designed for your products; Collections and filters planned with you; Team training and 30 days of support |
| `pack-single` | packaging | Single pack design | Fixed price | `₹38,000` | 2 to 3 weeks | 3 revision rounds | One pack structure and dieline; Artwork for every face; Print-ready files |
| `pack-range` | packaging | Packaging range | Custom quote | `From ₹1,20,000` | 5 to 7 weeks | 3 revision rounds | Shared system for every pack in the range; Artwork for each variant; Printer proof checks |
| `app-flows` | business-applications | App flows and wireframes | Fixed price | `₹70,000` | 3 weeks | 2 revision rounds | Up to 12 user flows; Wireframes for phone and desktop; A clickable prototype |
| `app-design` | business-applications | Business application design | Custom quote | `From ₹3,00,000` | 10 to 12 weeks | 3 revision rounds | Interface design for every screen and state; Component library; Developer handover sessions |
| `social-kit` | social-content | Social template kit | Fixed price | `₹28,000` | 1 to 2 weeks | 2 revision rounds | 12 post and story templates; Editable files for your team; Usage guide |
| `content-month` | social-content | Monthly content design | Fixed price | `₹42,000 a month` | Every month | 1 revision round | Up to 16 designed posts; Monthly content calendar; One planning call |
| `campaign-content` | social-content | Campaign content | Custom quote | `From ₹90,000` | 3 to 4 weeks | 2 revision rounds | Campaign concept and key visual; Posts, stories and banners; Formats for every channel you use |

**Questions** (id, question, answer):

- `services`: Which services does the studio offer?
  - `We offer six services: brand identity, Framer websites, Shopify stores, packaging, business applications, and social and content. Many projects combine two or three of them.`
- `timelines`: How long does a project take?
  - `Most projects take between two and twelve weeks. Each item on the price list shows its delivery estimate, from one to two weeks for a social template kit to ten to twelve weeks for a business application.`
- `pricing`: How are prices set?
  - `Fixed-price items have one published price. Larger or less predictable work is a custom quote, starting from the price shown, and we confirm it after a 30-minute call.`
  - `All prices on this site are illustrative.`
- `revisions`: How many revision rounds are included?
  - `Each item on the price list states its revision rounds, usually two or three. A round is one set of combined feedback from you, which we then apply in full.`
- `framer`: Why do you build websites in Framer?
  - `Framer lets us design and build in one place, launch quickly and hand you a site you can edit yourself without code.`
- `shopify`: Do you build Shopify stores from scratch?
  - `Yes. We set up and style an existing theme for smaller stores, or design a custom store when your products need it.`
- `ownership`: Who owns the final files?
  - `Once the final payment is made, you own the final files and the right to use them. We keep the right to show the work in our portfolio.`
- `collaboration`: How do we work together?
  - `We work in short rounds with one call a week and a shared folder for files. You always talk to one of the two founders.`

**Studio page.**

- Principles:
  - `Proportion`: `We measure before we decorate. Good proportion is the reason a page feels calm before anyone reads it.`
  - `Patience`: `We take six projects a season so each one gets time to settle. The second idea is usually better than the first.`
  - `Craft`: `We check the printer's proof, the phone screen and the invoice template with the same care as the logo.`
  - `Distinction`: `Every brand we make should look like its business and no one else's, which is why our eight worlds look nothing alike.`
- People (all fictional):
  - Meera Varghese, `Co-founder, creative director`: `Leads identity and art direction, and still draws every first sketch by hand.`
  - Arjun Pillai, `Co-founder, digital lead`: `Leads websites, stores and applications, from first flow to launch.`
  - Tara Menon, `Packaging and print designer`: `Takes packs from concept to the printer's proof.`
  - Kabir Rao, `Content and motion designer`: `Designs monthly content and the motion in our brand worlds.`
- Stages:
  1. `Listen`: `A first call and a short questionnaire about your business.`
  2. `Map`: `We agree on scope, price, timeline and revision rounds in writing.`
  3. `Make`: `We design in short rounds and share progress every week.`
  4. `Refine`: `We apply your feedback in the agreed revision rounds.`
  5. `Hand over`: `You receive every final file and a walkthrough of how to use them.`

**Enquiries.** None exist at start. References begin at `VO-000001`.

## Technical requirements

### Deployment (DP-56)

- The runtime is Node.js 22 and the source language is TypeScript.
- The 3D stage uses WebGL through Three.js, installed from npm and served by the app.
- `/app/run.json` holds string commands `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `serve` binds `0.0.0.0` on the port in `APP_PUBLIC_PORT` (4173 when unset).
- `GET /api/health` answers as published in API.

### Configuration and secrets (DP-57)

The app reads these environment variables at start:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO connection and bucket |
| `WIREMOCK_URL` | address of the project-intake service |
| `GRADING_KEY` | key for the grading route |
| `WORK_PAGE_SIZE` | gallery page size (default 6) |
| `ENQUIRY_LIMIT` | enquiries allowed per email address in the window (default 3) |
| `ENQUIRY_WINDOW_SECONDS` | length of the limit window (default 600) |
| `INTAKE_TIMEOUT_MS` | intake request timeout (default 5000) |
| `APP_PUBLIC_PORT` | serving port (default 4173) |

No credential, service address or key is hard-coded, logged, or sent to the browser. The browser receives only the enquiry limit and window values it needs for its copy.

### Server boundary (DP-52)

- The site is same-origin only. It sets no cross-origin headers and sends no content security policy, whether as a header or a meta tag.
- Pages load no external fonts, scripts, images, video or other hosts.
- Request bodies follow the size limit in API.
- The server serves only:
  - the published pages;
  - the built browser assets those pages reference;
  - the published files;
  - the API routes.
- Everything else gets the not-found answer, never a directory listing:
  - any other `/api/...` path;
  - any other path under `/scenes/` or `/media/`, including `/scenes/`, `/scenes/<slug>/` and `/media/<slug>/`;
  - any `.map` file (no source maps ship);
  - any path naming a server file or folder, such as `/package.json`, `/.env`, `/src/` or `/node_modules/`.
- The not-found answer is JSON `{"error":"not_found"}` under `/api/`, `/scenes/` and `/media/`, and the not-found page elsewhere.
- A method other than a path's published ones answers 405 as stated in API, including on pages, where `Allow` is `GET, HEAD`.
- Error bodies never contain a stack trace, query, file path or service address.
- The app starts while MinIO or the intake service is unreachable. While Postgres is unreachable at start, it keeps retrying and the health check answers its 503 until Postgres answers.

### Browser support and performance (DP-53, DP-22)

- The site supports current Chromium, Firefox and WebKit at 1280x800, 768x1024 and 375x812, with touch at the phone size.
- On `/`, the rail, keys and `Enter the worlds` respond within two seconds of load.
- The eight models together are at most 4,000,000 bytes, and the stage reaches `3d` within five seconds on the local network.
- Every animation is driven by the page clock (General rule in Interactions).

## Working rules

- IF-01: `/app/run.json` is a JSON object with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every font file with its licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) uses MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, and every font file uses SIL OFL 1.1.
- IF-04: The app stores data only in the provided Postgres database and MinIO bucket: no SQLite, no other database or cache, and no data files written as storage.
- IF-05: The provided development compose files and service configuration stay unchanged.
- IF-06: Application source is TypeScript; plain JavaScript appears only in build or tool configuration files.
- IF-07: No page or stylesheet references a font, script, image or other asset on another host.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` outside third-party boundaries.
- Names in the code match the domain terms of this brief: world, ring, rail, yaw, project, service, price item, enquiry, submission id, intake state, intake reference.
- Each domain rule is decided in exactly one place in the source and used everywhere from there. This covers the active-world rule, gallery matching and counts, price counts, the enquiry field rules, the intake state changes, the replay rule and the limit.
- There is no abstraction with only one implementation, and no wrapper that only passes calls through.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the rules make impossible.
- Every API error uses the one published error shape, built in one place.
- No feature, route, setting or screen exists beyond this brief.
