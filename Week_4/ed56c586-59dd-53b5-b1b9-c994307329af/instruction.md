# Quillfern Works Ottoline Rask Selected Builds

Ottoline Rask Selected Builds is the public hiring portfolio of Ottoline Rask, an invented independent developer and digital creator who trades as Quillfern Works. It is written for the people who commission freelance and subcontracted builds: product and engineering leads, agency creative directors and founders. It shows six annotated case studies with live previews, a filtered project gallery, five services, skills, illustrative client reviews and figures, a career timeline and an enquiry form whose message reaches the studio inbox by mail. Build one visitor-facing website in TypeScript on Node 22 with two backend services. The first is a Mailpit mail server that carries each enquiry to the studio inbox. The second is a MinIO object store that holds the project covers and preview frames, which reach the browser only through the app server. Out of scope: accounts, sign-in, sessions, cookies, payments, booking, newsletters, dashboards, admin or editor screens, a content management system, comments, chat, search, analytics, tracking, and any database or other datastore, broker, queue or service. The enquiry is the only thing a visitor sends and the only message the site sends. Ottoline Rask, Quillfern Works and every project, client, review, figure and the career timeline are fictional and illustrative. The site labels them so where Seed data places the labels, and nothing on it claims real clients, real awards or real experience.

## Problem and users

People who hire a freelance developer usually judge the developer's craft from a reel or a page of finished screenshots. That leaves the expensive questions open. Which part of a moving build did this person actually make? How does it behave by keyboard, on a phone and with reduced motion? What stack carried it? A wrong shortlist costs the commissioner a week of calls and a failed first sprint. The enquiry is the one moment that has to reach the developer. A form that says "sent" while the mail went nowhere loses a lead nobody learns about, and a form that clears a long brief after a failed send loses the hirer's work. The case-study media has to arrive too: a preview library that fails silently leaves the case studies as blank boxes.

- **Agency creative director subcontracting motion work** (occasional). They want to judge from one case study which moments are Ottoline's own craft and how those moments behave by keyboard, on a phone and with reduced motion, then send a scoped enquiry.
- **Product or engineering lead at a mid-size company commissioning a build** (occasional). They want to filter the gallery by discipline, compare stack, role and outcome across case studies, and send an enquiry with a project type and a budget band.
- **Founder comparing contractors** (occasional). They want to skim services, skills and illustrative client reviews on a phone between meetings, then be sure the enquiry actually reached the studio inbox.

## Journeys

1. **First look from the hero (creative director, 1280x800).** Start: a fresh load of `/`. The greeting, the headline words and the role line play in, and the intro ends. The role line starts rotating. The director pauses it with `Pause roles`, steps with `Next role`, then presses Enter on `Explore projects`. End: the page has glided to `Selected work`, its heading is just under the header with focus on it, the header link `Work` is current, and the address ends in `#work`.
2. **Filter, read and come back (product lead, 1280x800).** Start: `/` with no filter. The lead presses `Motion`, then `Design`. Four cards stay in place, the result line updates, and the address becomes `/?category=motion,design` without a reload. The lead opens `Tidegauge`, reads its stack, follows `Next project: Promptloom`, then presses the browser's Back twice. End: `/` with `Motion` and `Design` pressed, the same four cards, and focus on the `Tidegauge` card link below the header.
3. **Tie a callout to the build (creative director).** Start: `/`. The director opens `Preview Foundry Loop` and steps through its frames with the arrow keys, then closes the dialog with Escape. They open the Foundry Loop case study and press Enter on callout 2. The region outline appears, the preview steps from frame 2 to frame 5, the readout and the address update, and the selection is announced. ArrowDown moves to callout 3, and pressing callout 3 again clears it. End: no callout selected, frame 1, and no `callout` in the address.
4. **Keyboard and scroll tour (creative director).** Start: a fresh load of `/`. Tab reaches every control in the published order, and focus is always visible and clear of the header. The director opens a milestone detail with Enter. On the way down, the current header link and the career journey progress follow the scroll. The counters run once in `About` and in `By the numbers`, and they do not start again when the director scrolls back up. End: every section has been visited, and each counter shows its target.
5. **Skim services and skills, then enquire (founder).** Start: `/`. The founder opens the `Skills and tools` tab `Animation` and opens `GSAP` to see `Used in:` with Foundry Loop. They type their name into the form, scroll back up, open the `Motion & Interaction` service panel and follow `Enquire about Motion & Interaction`. End: `Start a project` is in view, `Project type` shows `Motion & Interaction`, focus is on `Your name`, and the typed name is still there.
6. **Send an enquiry and confirm it arrived (founder).** Start: an empty form. Pressing `Send message` shows five field messages. The founder corrects the fields one by one, and each message clears as they go. They press `Send message` again: the form shows its sending state, and then `Message received.` appears. End: the studio inbox holds exactly one email with every submitted field.
7. **On a phone with touch and reduced motion (founder, 375x812).** Start: `/` with reduced motion set. Everything is already in its end state: no intro, the role rotation paused, and the counters at their targets once reached. The founder taps `Menu`, chooses `Reviews` and swipes through the five reviews. End: review 5 is shown, each change was announced once, and the menu is closed with nothing inside it reachable.
8. **When a service is down (creative director).** Start: a site whose mail server or media library cannot be reached. With the mail server down, `Send message` shows the not-sent message and every value stays. Once mail is back, the next press sends. With the media library down, every cover and frame shows its fallback plate and the media notice shows, while every page still works. Once the library is back, the images load in place and their return is announced. End: both services recovered without a restart of the site.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Hero arrival** Opening `/` plays the hero intro to its end. Any key, pointer press, wheel turn or scroll ends it at once, and `Explore projects` and `Start a project` land on their sections with focus on the heading and one new history entry.
- **DP-02 — Hero copy and intro timeline** The `intro` section shows the published hero copy and sculpture and carries `data-intro="playing"` and then `"done"` at the published moment. Each published intro motion plays at its published start and length, and the page opens in the done state with reduced motion, with a hash, or with a `category` or `service` parameter.
- **DP-03 — Copy drift** The hero copy moves up by the published share of the scroll position, capped as published. It returns exactly when the visitor scrolls back, and it stays put with reduced motion.
- **DP-04 — Sculpture tilt** Mouse or pen movement over the hero sets the sculpture's `data-tilt-x` and `data-tilt-y` and its rotation by the published formula, and both return to 0 when the pointer leaves. Touch, widths under 768 px and reduced motion keep both at 0.
- **DP-05 — Editorial look** The site reads as the published inked editorial sheet: pale sage paper, near-black ink bands for the hero and footer, one ultramarine accent, hairline rules, the three published typefaces and an asymmetric twelve-column grid.
- **DP-06 — Role line journey** A visitor watches the role line rotate, steps through roles by button and keyboard, and pauses and resumes the rotation. At every moment exactly one role shows, and its text matches its index.
- **DP-07 — Automatic role rotation** After the intro ends, the shown role advances on the published page-clock interval in the published order and wraps from 6 to 1. Each change's text and index are in place the moment the change starts.
- **DP-08 — Manual role changes and holds** `Next role` and `Previous role` change the role at once, counting from the incoming role during a slide, and restart the countdown. Hovering the line or focusing a role button holds the rotation, and the next automatic change comes one full interval after the hold ends.
- **DP-09 — Pausing and reduced-motion roles** `Pause roles` and `Play roles` stop and resume automatic changes with their published announcements, resuming with the next change one interval later while focus stays on the button. Screen readers read the roles summary instead of the line, and reduced motion starts paused with instant changes.
- **DP-10 — Scroll and jump journey** A visitor scrolls the home page down and back up while the current header link and the career journey follow. They jump between sections by header link and move back and forward through those jumps.
- **DP-11 — Current section marking** Exactly one header link carries `aria-current="true"` by the published 40% line rule, in both scroll directions. No link is current above `about` or on a case study, and the rule also holds without `IntersectionObserver` or `ResizeObserver`.
- **DP-12 — Career journey progress** Each milestone's `data-reached` and the progress `data-value` follow the published 60% line rule in the same moment as the scroll, in both directions. Each milestone button shows or hides its detail.
- **DP-13 — Section jump landing** Every section jump lands its heading 80 px from the viewport top, within 2 px, with focus on that heading. A jump by link glides and arrives within one second, a jump on load or with reduced motion is instant, and a second jump started during a glide wins.
- **DP-14 — Jump history** Each section jump by link adds one history entry with the target hash, and `Ottoline Rask home` and `Back to top` each add one without a hash. Back and Forward restore each entry's position, focus and current link instantly.
- **DP-15 — Keyboard-only tour** A keyboard-only visitor tabs through the whole home page, opens a milestone detail, and opens a case study from its card link by Enter. They arrive with the case study's title and focus on its level-1 heading.
- **DP-16 — Tab order and skip link** From a fresh load, the Tab order on `/` matches the published list at 1280x800 and the published start at 768x1024 and 375x812. `Skip to content` is the first stop; it is visible while focused and moves focus to the level-1 heading.
- **DP-17 — Visible, unhidden focus** Every focused control shows the published focus ring, and only while it is focused. Every focus change on an element in the page flow scrolls the page so it sits at least 8 px below the header, as qualified in Interactions.
- **DP-18 — Closed means unreachable** A closed menu, a collapsed or collapsing service panel, a closed milestone detail, a hidden skill panel and a hidden review slide expose nothing to Tab or to screen readers, at every published viewport.
- **DP-19 — Glyphs and new-tab links** The `→` and `↗` glyphs are visible but absent from accessible names, and `(opens in a new tab)` is in the name but not visible. Every new-tab link carries `target="_blank"` and `rel="noopener noreferrer"`.
- **DP-20 — Filter, read and return** A product lead presses several disciplines and opens a shown project's case study. They return by `Back to work` or the browser's Back to the same filters, cards and result line, with focus on that project's card link.
- **DP-21 — Discipline filtering** Toggling disciplines shows exactly the published matching cards in published order, and `All` is pressed exactly when no discipline is. The result line and its single announcement update in the same moment, without a reload.
- **DP-22 — Filter address** The pressed disciplines live in the `category` parameter in canonical order, and each change replaces the current history entry. An opened address with unknown or repeated values is applied and rewritten to canonical form at once.
- **DP-23 — Gallery return** Returning from a case study by `Back to work` or Back restores the list, the cards and the result line, with focus on that project's title link clear of the header and no announcement.
- **DP-24 — Case study reading** A visitor reads a case study with `On this page`, steps to neighbouring projects and goes back with the browser. Each arrival shows its title, with focus on its level-1 heading.
- **DP-25 — Case study content** Each `/work/<slug>` shows its title, kind, illustrative description list, the five published sections and the exact published stack list, under the published document title.
- **DP-26 — On this page** The current `On this page` link follows the published 40% line rule in both directions, and its links jump by the section jump rules.
- **DP-27 — Neighbour projects** `Previous project` and `Next project` link to the published neighbours within the address's `category` list and keep the parameter. Each is absent at its end of the list.
- **DP-28 — Not found and server boundary** Unknown pages answer 404 with the published not-found page. API routes answer in the published error order, and the server sends no CORS headers, cookies or Content-Security-Policy and never serves source files, source maps, `.env`, `run.json` or package files.
- **DP-29 — Preview and callout journey** A creative director reveals a card, steps through its quick-look frames by keyboard, opens the case study and ties each callout to its region and frame range. They recover a missing frame or a missing media library without a restart.
- **DP-30 — Card reveal and quick look** Cards carry `data-revealed` on hover and focus, and always below 768 px. The quick-look dialog opens on frame 1 with focus on `Next frame`, steps without wrapping, keeps Tab inside, and returns focus to its opener on close.
- **DP-31 — Callout Thread** Selecting a callout outlines its published region within 1 px, steps the frame through its published range on the page clock, shows the readout, announces the selection and keeps it in the address by replacement. Arrow keys, clearing, selection from the address and reduced motion behave as qualified in Interactions.
- **DP-32 — Media route and manifest** The 42 published objects are stored at their keys, and the browser receives them only through `GET /media/<key>` with the stored bytes and type. The route uses the published 404 and 503 bodies, and `GET /api/media` reports each object's availability.
- **DP-33 — Media fallback and recovery** A single missing object shows its fallback plate, and an unreachable library shows plates everywhere plus `Media notice`, while every page still works. Health reports `unavailable` only when storage cannot be reached or mail refuses a connection. Frames recover through `Try again`, and covers and the notice recover through the page's re-check, without a restart, as qualified in Business rules.
- **DP-34 — Service to enquiry** A founder opens a service panel, reads its deliverables and technology, and follows `Enquire about <service name>` to the form. The project type is chosen, focus is on `Your name`, and anything already typed is kept.
- **DP-35 — Service panels** Service panels open and close by click, Enter and Space with `aria-expanded`, and at most one is open. Each shows the exact published lists, and nothing in a closed or closing panel can be reached.
- **DP-36 — Enquire link prefill** Following an enquire link jumps to `contact` without a reload, sets `Project type` and moves focus to `Your name`. Every typed value is kept, the change is announced once, and one history entry is added.
- **DP-37 — Service parameter on load** Opening `/?service=<value>#contact` in a fresh page gives the prefilled state instantly. An unknown value is removed from the address and selects nothing.
- **DP-38 — Skills browsing** A visitor moves through the skill groups by keyboard, opens a technology card and follows a `Used in:` link to a case study.
- **DP-39 — Skill tabs** The `Skill groups` tabs select on focus with ArrowRight and ArrowLeft (wrapping), Home and End. They keep a single Tab stop and show only the selected panel.
- **DP-40 — Skill cards and meters** Each panel shows its four published cards, with meters carrying the published names and values from the moment the panel shows. A card's detail lists the published `Used in:` case studies or the published no-match text.
- **DP-41 — Skills layout and bars** The tabs and cards follow the published rows and columns at 1280, 768 and 375 wide. The bars grow with the published timing and stagger each time a panel shows, and appear at once with reduced motion.
- **DP-42 — Reading reviews** A founder on a phone swipes through the five illustrative reviews and back, and hears each new position announced once.
- **DP-43 — Review buttons and keys** `Previous review` and `Next review` move one review without wrapping and are disabled at the ends, with focus moving off a button that becomes disabled. ArrowRight, ArrowLeft, Home and End work with focus anywhere in the carousel.
- **DP-44 — Review swipe** A mostly horizontal touch or mouse drag of at least 40 px on the track moves one review when released. Shorter, mostly vertical or past-the-end movements change nothing.
- **DP-45 — Review exposure and announcements** Only the shown slide is exposed to screen readers and to Tab, and the position reads `<k> / 5`. Each change is announced once with the published text.
- **DP-46 — Counters on the way down** A visitor scrolls to `numbers`, scrolls away mid-count and comes back, and sees each figure finish exactly once at its target.
- **DP-47 — Counter start and figures** Each counter block starts at the published 75% line moment, also after a jump or a resize and without `IntersectionObserver`. It then shows the published floor figures on the page clock until its target at 1,500 ms.
- **DP-48 — Count once per load** Scrolling away and back, jumps, resizes and tab switches never restart, pause or reset a counter block. Only a reload starts it over.
- **DP-49 — Counter accessibility and reduced motion** Screen readers read each counter's label and final value from load. Reduced motion shows the targets with `data-state="done"` as soon as the block would start.
- **DP-50 — Enquiry delivered** A founder sends a valid enquiry and sees `Message received.` only after the mail server has accepted it. The studio inbox then holds exactly one email with every submitted field.
- **DP-51 — Enquiry validation** Sending an invalid form shows the published field messages, `aria-invalid`, `aria-describedby` and the count in `Form status`, and moves focus to the first failing field. After the first send, every input is checked again in the same moment.
- **DP-52 — Sending and sent states** A valid press shows the published sending state, disables every field while keeping its value, and sends one request. A 201 replaces the form with the published sent panel, which stays until `Send another message` or a reload.
- **DP-53 — Enquiry API and email** `POST /api/enquiries` checks the published rules and sends exactly one email with the published recipient, sender, Reply-To, subject and body. It answers 201 only after the mail server accepted the message, and a line break in the name never reaches a mail header.
- **DP-54 — Mail outage and retry** When mail is unreachable or slow, the server answers the published 503. The form shows the published not-sent message with every value kept and focus on `Send message`, and the next press sends once mail is back, without a restart.
- **DP-55 — Phone visit** A founder on a phone opens the menu, jumps to a section and swipes the reviews, using touch and reduced motion. They meet the published phone layout throughout.
- **DP-56 — Mobile menu** Below 1024 px, `Menu` opens the modal `Menu` dialog with focus on `About` and Tab wrapping inside. Escape, `Close menu` or a tap outside closes it with focus back on `Menu`, and choosing a link closes it and jumps with focus on the target heading; reopening it mid-close keeps it open, and nothing inside is reachable while it is closed.
- **DP-57 — Published layouts and targets** At 375x812, 768x1024 and 1280x800, the header, hero, gallery, services, counters, contact and footer follow the published layouts with no horizontal overflow, and every target is at least 44 px at 375 wide. Every page has `lang="en"`, one `main` landmark, one level-1 heading and no automated accessibility violations.
- **DP-58 — Custom cursor and footer wordmark** The custom cursor follows the mouse within 1 px with the published states and hides on touch, pen, leaving the window and reduced motion. The footer wordmark plays its wave once per load and sets `data-waved`.
- **DP-59 — Credentials, media and motion source integrity** The source reads every credential and service address from the published environment variables, keeps object-store access on the server and generates its own artwork. It builds motion only on the browser's own animation features, with no animation library.

## Frontend

### Screens and layout (DP-02, DP-05, DP-12, DP-25, DP-28, DP-41, DP-55, DP-57)

**Site map.** The site has these pages and no others.

| Address | Page | Document title |
|---|---|---|
| `/` | Home: sections `intro`, `about`, `work`, `services`, `skills`, `reviews`, `numbers`, `contact`, then the footer | `Ottoline Rask | Developer and digital creator` |
| `/work/<slug>` for the six slugs in Seed data | Case study | `<project title> | Ottoline Rask` |
| anything else, except the API and media routes in API | Not found, HTTP 404 | `Not found | Ottoline Rask` |

Every page has `<html lang="en">`, exactly one `main` landmark and exactly one level-1 heading. Query parameters: `category` and `service` on `/`, and `category` and `callout` on a case study. Section links use the hash, as in `/#work`. `/work/` followed by any slug not in Seed data is not found.

**Header (every page).** A `banner` fixed to the top edge, 64 px tall at every width. It holds link `Ottoline Rask home`, then at widths of 1024 px and more the navigation `Sections` with its six links. Below 1024 px it holds button `Menu` instead. The page under it always starts below the header. The page is always tall enough for every section jump target to reach its jump position (DP-13).

**Home sections.** Each section is a `region` named by its heading and carries `id="<section id>"` and `data-section="<section id>"`, in this order:

- `intro`: an ink band as tall as the viewport, never less than 560 px, starting at the top of the page. The copy group `[data-hero-copy]` holds, in order: paragraph `[data-greeting]` `Hello, I'm Ottoline.`; level-1 heading `I build websites that move with you.`, each of its 7 words an element `[data-headline-word]`; the role line and its three buttons; paragraph `Independent developer and digital creator. I design, animate and build full-stack products, from the first sketch to the cloud.`; and links `Explore projects` (to `/#work`) and `Start a project` (to `/#contact`). Beside the copy sits the sculpture `[data-hero-visual]`, which is decoration hidden from screen readers: an oversized outlined monogram `OR` built from stacked vector layers.
- `about`: heading `About`. Then the introduction paragraph `I'm Ottoline Rask, an independent developer and digital creator working as Quillfern Works. I take a build from the first sketch to the cloud, and I like being the person who knows how every moving part behaves.` and the philosophy paragraph `I treat motion as explanation, not decoration, and I check every screen by keyboard, on a phone and with reduced motion before I call it done. Each case study here says which parts were mine.` Then list `Working principles`, list `Areas of expertise`, the figures block `[data-stats="about"]` and the ordered list `Career journey` with its progress line `[data-journey-progress]`. The list contents are in Seed data.
- `work`: heading `Selected work`, the filter group, the result line `[data-results]` and the six project cards.
- `services`: heading `Services` and the five service items.
- `skills`: heading `Skills and tools`, the tab list and its six panels.
- `reviews`: heading `Client reviews`, the illustrative note and the carousel.
- `numbers`: heading `By the numbers` and the block `[data-stats="numbers"]`.
- `contact`: heading `Start a project`, the paragraph `Tell me what you are building. I read every message myself.`, the form `Project enquiry`, and the contact details beside it.
- Footer (`contentinfo`), an ink band holding: the wordmark `[data-footer-mark]` `Ottoline Rask`, each letter its own element; navigation `Footer` with the six section links; the three social links; button `Back to top`; `© 2026 Quillfern Works.`; and the notice `Ottoline Rask and Quillfern Works are fictional. Projects, clients, reviews, figures and the career timeline on this site are illustrative.`

A visible `status` region `Media notice` sits at the top of `main` on every page and is empty and hidden while the media library is available. A visually hidden polite `status` region `Site updates` sits in every page.

**Project card.** An `article` `[data-project="<slug>"]` with `data-categories` (the project's address values, space-separated, in canonical order). It has its own colour field and the cover media slot. Its level-3 heading holds link `<title>` to the case study, and the card also shows the kind, the year, the discipline names and button `Preview <title>`.

**Case study page.** In this order:
- level-1 heading `<title>`;
- a paragraph with the kind;
- a description list: `Client` `<client> (illustrative)`, `Year` `<year>`, `Role` `<role>`, `Disciplines` (the discipline names joined by `, ` in canonical order);
- link `Back to work`;
- navigation `On this page` with links `Overview` (`#overview`), `The challenge` (`#challenge`), `The solution` (`#solution`), `Design decisions` (`#decisions`) and `Technology stack` (`#stack`);
- the case-study preview figure `[data-preview]` with the list `Callouts`;
- sections with those level-2 headings and ids, holding the prose from Seed data (`Technology stack` is a list);
- navigation `More projects`.

From 1024 px wide the preview figure is fixed beside the prose (sticky) while the reader moves through the sections. Below 1024 px it sits above the sections.

**Not-found page.** Level-1 heading `This page took a wrong turn.`, paragraph `The address may be mistyped, or the page may have moved.`, and link `Back to the homepage` (to `/`), under the header and above the footer.

**Viewports.** No layout changes between the thresholds named here, so each published viewport always gets the layout listed for it.

| Element | 1280x800 (1024 px and wider) | 768x1024 (768 to 1023 px) | 375x812 (under 768 px) |
|---|---|---|---|
| Header | logo link plus `Sections` links | logo link plus `Menu` | logo link plus `Menu` |
| Hero | copy across the left seven of twelve columns; sculpture to its right (its left edge at or right of the copy's right edge) | sculpture below the copy | sculpture below the copy, at most 240 px tall, still |
| Career milestones | one row | one column | one column |
| Gallery | three columns; the middle column starts 64 px lower (first and third shown cards' tops equal within 2 px, second shown card's top 64 px lower within 2 px); shown cards fill the columns in order | two columns, equal tops per row | one column |
| Services | the open service's visual to the right of its panel | visual above its panel | visual above its panel |
| Skills tabs | one row | one row | two rows of three |
| Skill cards | four per row | two per row | one per row |
| Counters | one row of four | two by two | two by two |
| Contact | form and details side by side (tops within 4 px) | details below the form | details below the form |
| Footer links | one row | one row | two columns |

There is no horizontal page overflow at 375, 768, 1024 or 1280 px wide.

### Public screens and controls (DP-09, DP-16, DP-19, DP-30, DP-31, DP-35, DP-39, DP-43, DP-51, DP-56)

These roles and names are public, and tests and judges use only these. Everything else is free.

| Role and accessible name | Where | Notes |
|---|---|---|
| link `Skip to content` | every page, first Tab stop | visible only while focused |
| `banner`; link `Ottoline Rask home` | header | to `/` |
| navigation `Sections`; links `About`, `Work`, `Services`, `Skills`, `Reviews`, `Contact` | header, 1024 px and wider | to `/#about`, `/#work`, `/#services`, `/#skills`, `/#reviews`, `/#contact` |
| button `Menu`; dialog `Menu` (modal) with button `Close menu` and navigation `Menu sections` (the same six links) | header, under 1024 px | `aria-expanded` on `Menu` |
| buttons `Previous role`, `Next role`, `Pause roles` / `Play roles` | hero | the third button's name swaps while paused |
| links `Explore projects`, `Start a project` | hero | `Explore projects` shows `→` after its label |
| buttons `<year>: <title>` | `Career journey` | `aria-expanded`, closed at load |
| `group` `Filter projects by discipline`; toggle buttons `All`, `Web`, `Motion`, `Cloud`, `Data`, `Design`, `AI` | `work` | `aria-pressed` |
| link `<title>`; button `Preview <title>` | each card | |
| dialog `<title> preview` (modal) with buttons `Previous frame`, `Next frame`, `Close preview`, link `Open case study`, and a `status` showing `Frame <k> of 6` | quick look | |
| `img` `<title> cover` | card cover slot | |
| `img` `<title>, frame <k> of 6` | preview frame slots | `<k>` is the frame shown |
| link `Back to work`; navigation `On this page`; navigation `More projects` with links `Previous project: <title>`, `Next project: <title>` | case study | |
| list `Callouts`; buttons `Callout <n>: <label>` | case study | `aria-pressed` |
| button `Try again` | frame fallback plate | |
| buttons `Web Development`, `Motion & Interaction`, `App & Cloud Solutions`, `Creative Design`, `AI & Prompt Engineering`; lists `Deliverables`, `Technology`; links `Enquire about <service name>` | `services` | `aria-expanded`, `aria-controls` |
| `tablist` `Skill groups`; tabs `Frontend`, `Backend`, `Animation`, `Cloud`, `Design`, `AI`; `tabpanel` labelled by its tab | `skills` | |
| button `<technology>`; `meter` `<technology> fluency` | each skill card | `aria-expanded` on the button |
| carousel `Reviews` (`aria-roledescription="carousel"`); slides `group` `Review <k> of 5` (`aria-roledescription="slide"`); buttons `Previous review`, `Next review` | `reviews` | |
| form `Project enquiry`: textbox `Your name`, textbox `Email address`, combobox `Project type`, radiogroup `Budget` with radios `Under $5,000`, `$5,000 to $15,000`, `$15,000 to $40,000`, `Over $40,000`, textbox `Tell me about your project`, button `Send message` | `contact` | each field has a visible label; the dropdown's placeholder option is `Choose a project type` |
| `status` `Form status` | `contact` | visible, empty at load |
| heading `Message received.`; button `Send another message` | sent panel | |
| link `Email Ottoline`; links `Ottoline Rask on GitHub (opens in a new tab)`, `Ottoline Rask on LinkedIn (opens in a new tab)`, `Ottoline Rask on Dribbble (opens in a new tab)` | contact details and footer | |
| `contentinfo`; navigation `Footer` (the six section links); button `Back to top` | footer | |
| `status` `Site updates` (polite, visually hidden); `status` `Media notice` (visible) | every page | |
| heading `This page took a wrong turn.`; link `Back to the homepage` | not-found page | |

**Glyphs.** `Explore projects` shows `→` after its label, and every link that opens a new tab shows `↗` after its label. A glyph is decoration only: it is visible but never part of an accessible name or of anything a screen reader reads. `(opens in a new tab)` is part of the accessible name but is not visible. Every new-tab link carries `target="_blank"` and `rel="noopener noreferrer"`.

**Contact details** (beside the form): link `Email Ottoline` to `mailto:hello@ottolinerask.example`; the address as text `[data-email]` `hello@ottolinerask.example`; the three social links to `https://github.example/ottolinerask`, `https://linkedin.example/in/ottolinerask` and `https://dribbble.example/ottolinerask`; and the line `Taking on new projects from January 2027.` with the label `Illustrative availability`.

### Interactions (DP-01, DP-03, DP-04, DP-06, DP-08, DP-10, DP-12, DP-13, DP-14, DP-15, DP-16, DP-17, DP-20, DP-23, DP-24, DP-26, DP-29, DP-30, DP-31, DP-34, DP-36, DP-37, DP-38, DP-39, DP-40, DP-42, DP-43, DP-44, DP-46, DP-50, DP-52, DP-55, DP-56, DP-58)

**Same-moment changes.** The site is checked in a browser whose clock is paused and moved forward only on purpose. Nothing a visitor needs may wait for a timer or for the next frame, except the five page-clock items in Business rules. Every change a visitor causes is fully in place in the same moment as the action, scroll or resize that causes it. That covers:
- the address;
- `aria-current`, `aria-pressed`, `aria-expanded` and `aria-selected`;
- the shown role after a manual change;
- the visible cards and the result count;
- the selected callout, its region and its readout;
- the review shown;
- the frame shown in the quick-look dialog;
- the tilt attributes;
- the custom cursor's position and state;
- a panel, a dialog or the menu being open or closed (closed means hidden from screen readers with nothing inside it focusable);
- the start of a counter block;
- focus;
- the announcement.

Motion only shows a change that is already in place. It runs on the browser's own animation and transition engine, so it plays in real time without the page's timers or frame callbacks. A section jump's glide uses the browser's own gliding scroll.

**Header, menu and skip link.** `Skip to content` moves focus to the level-1 heading. `Menu` opens the `Menu` dialog with focus on its link `About`. Tab and Shift+Tab wrap inside the dialog. Escape, `Close menu` or a tap outside the panel closes it and returns focus to `Menu`. Choosing a link closes the dialog and jumps to that section, and focus lands on the target heading by the section-jump rule below, not on `Menu`. Reopening the menu while it is still sliding closed leaves it open.

**Current section.** On `/`, the current section is the one named by the 40% line rule in Business rules. Its link in `Sections`, and in the open menu, carries `aria-current="true"`; no other link does. It updates in the same moment as the scroll, in both directions. On a case study, no header link is current.

**Section jumps.** A section jump is any of these:
- a header, menu or footer link;
- `Explore projects` or `Start a project`;
- an `On this page` link;
- opening an address with a hash.

The target heading ends with its top edge 80 px from the viewport top (16 px below the header), within 2 px, and receives focus. Headings are focusable by script only. A jump by link glides and arrives within one second. A jump on load, and any jump with reduced motion, is instant. A second jump started while one is gliding wins: the page ends at the second target, with focus on its heading and its link current. A link on a case study to `/#<id>` loads `/` and lands the same way.

**Jump history.** Every section jump by link adds one history entry whose address carries the target's hash and keeps the query. Back and Forward between those entries show the target named by the entry's hash at the jump position, instantly, with focus on its heading and its link current. An entry without a hash shows the top of the page with focus on the level-1 heading. `Ottoline Rask home` on `/` and the footer's `Back to top` do not reload. They bring the top of the page into view (gliding, or instantly with reduced motion), move focus to the level-1 heading, and add one history entry without a hash that keeps the query. The intro never plays again on the same page load. Arriving on any page by a link, or by Back or Forward without a hash, except the gallery return: the page starts at its top, the document title is that page's, and focus is on its level-1 heading.

**Focus.** Whenever any element receives focus, by Tab, Shift+Tab, a jump or a script, the page scrolls as needed so the element's top edge is at least 8 px below the header's bottom edge (72 px from the viewport top). When the element fits, its bottom edge is also inside the viewport. This rule applies to elements in the page flow. Controls inside the fixed header and inside the open modal dialogs are exempt because scrolling cannot move them. `Skip to content` appears over the left end of the header while it is focused and is exempt too. Every focusable control shows a visible focus ring, at least 2 px thick, in a colour with at least 3:1 contrast against its surroundings. The ring is absent while the control is not focused.

**Exact Tab order on `/` at 1280x800.** Starting state: a fresh load after the intro has ended, nothing open or selected, no filter, tab `Frontend` selected, review 1 shown and no budget chosen. The stops are:

1. Header and hero: `Skip to content`, `Ottoline Rask home`, `About`, `Work`, `Services`, `Skills`, `Reviews`, `Contact`, `Previous role`, `Next role`, `Pause roles`, `Explore projects`, `Start a project`.
2. Career journey: `2017: First freelance website`, `2019: Front-end lead at a product studio`, `2021: Went independent`, `2023: First real-time cloud app in production`, `2025: AI-assisted tools for design teams`.
3. Gallery: `All`, `Web`, `Motion`, `Cloud`, `Data`, `Design`, `AI`, `Hollis Atelier`, `Preview Hollis Atelier`, `Foundry Loop`, `Preview Foundry Loop`, `Tallyhouse`, `Preview Tallyhouse`, `Pulse Roster`, `Preview Pulse Roster`, `Tidegauge`, `Preview Tidegauge`, `Promptloom`, `Preview Promptloom`.
4. Services and skills: `Web Development`, `Motion & Interaction`, `App & Cloud Solutions`, `Creative Design`, `AI & Prompt Engineering`, `Frontend`, `React`, `Next.js`, `TypeScript`, `Accessible HTML and CSS`.
5. Reviews: `Next review`.
6. Contact: `Your name`, `Email address`, `Project type`, `Under $5,000`, `Tell me about your project`, `Send message`, `Email Ottoline`, `Ottoline Rask on GitHub (opens in a new tab)`, `Ottoline Rask on LinkedIn (opens in a new tab)`, `Ottoline Rask on Dribbble (opens in a new tab)`.
7. Footer: `About`, `Work`, `Services`, `Skills`, `Reviews`, `Contact`, `Ottoline Rask on GitHub (opens in a new tab)`, `Ottoline Rask on LinkedIn (opens in a new tab)`, `Ottoline Rask on Dribbble (opens in a new tab)`, `Back to top`.

At 768x1024 and 375x812, the first three stops are `Skip to content`, `Ottoline Rask home` and `Menu`.

**Hero intro.** The intro plays from load (timings in Motion and effects; end moment in Business rules). Any key press, pointer press, wheel turn or scroll during the intro ends it at once: `data-intro="done"`, with every word, line and link in place and fully visible. Opening `/` with a hash, or with a `service` or `category` parameter, starts in the done state, and so does reduced motion. The intro's timing never waits for a font or a picture to load.

**Copy drift and sculpture tilt.** Scrolling moves `[data-hero-copy]` up by the drift rule in Business rules. The browser's computed style for the element reports exactly that upward translation in pixels, and it returns exactly when the visitor scrolls back up. While a mouse or pen pointer moves over the `intro` section, `[data-hero-visual]` carries `data-tilt-x` and `data-tilt-y` by the tilt rule, and its computed style rotates it by those angles about its horizontal and vertical axes. The visual may ease into the angle over at most 150 ms, but the attributes change in the same moment. When the pointer leaves the section, both return to 0. Touch input never changes them. Below 768 px wide, and with reduced motion, drift and both tilts stay 0 and the visual is a still picture. The sculpture has no idle motion of its own.

**Role line.** The visible line `[data-role-line]` reads `I'm a ` + `[data-role]` + `.` and is hidden from screen readers. `[data-role]` carries `data-role-index` (1 to 6) and shows the role with that index from Seed data. Screen readers read the visually hidden paragraph `[data-roles-summary]` `I work as a full-stack developer, motion engineer, Firebase app builder, creative designer, presentation designer and prompt engineer.` instead.
- Automatic changes follow the rotation rule in Business rules.
- `Next role` and `Previous role` change the role at once with no slide; any slide in progress ends at once, leaving only the new text. During a slide, the shown role is the incoming one. Worked example: during the slide from role 2 to role 3, `Next role` shows role 4 and `Previous role` shows role 2.
- While the mouse pointer is over `[data-role-line]`, or focus is on one of the three role buttons, the rotation is held.
- `Pause roles` stops automatic changes until `Play roles`. Manual changes still work while paused. Focus stays on the button, and each press is announced.
- Role changes are never announced.

**Career journey.** Each milestone `[data-milestone]` carries `data-reached` by the 60% line rule in Business rules, in the same moment as the scroll and in both directions. `[data-journey-progress]` carries `data-value`, the number of reached milestones, and its line grows to the last reached milestone. Each milestone button shows or hides its one-sentence detail, and several details may be open at once.

**Gallery filtering.** Pressing a discipline toggles it; `All` clears every discipline. The visible cards, `aria-pressed`, the result line, the announcement and the address follow the filter rules in Business rules, in place and without a reload. Hidden cards are removed from the layout and from the accessibility tree. While the mouse pointer is over a card, or focus is inside it, the card carries `data-revealed="true"` (otherwise `"false"`). Below 768 px wide, every card carries `data-revealed="true"` with its cover fully shown.

**Gallery return.** From a case study, link `Back to work` (to `/?category=<list>#work`, or `/#work` without a list) and the browser's Back both arrive on `/` in the same state. That state is:
- exactly that list pressed;
- the matching cards and result line;
- focus on the link `<title>` of the project just read;
- that card's top edge at least 8 px below the header.

This return adds no announcement, and it takes precedence over the hash, jump and history rules above.

**Quick look.** `Preview <title>` opens the dialog `<title> preview` on frame 1, with focus on `Next frame`.
- The frame slot `[data-preview-frame]` carries `data-frame="<k>"`.
- `Previous frame` is disabled on frame 1 and `Next frame` on frame 6; the frames do not wrap. When the focused button becomes disabled, focus moves to the other frame button.
- ArrowRight and ArrowLeft anywhere in the dialog change the frame the same way.
- Tab and Shift+Tab wrap inside the dialog, and the page behind it cannot be reached while it is open.
- Escape, `Close preview` or a click on the backdrop closes it and returns focus to its `Preview <title>` button.
- `Open case study` keeps the `category` list.

**Callout Thread (case study).** With no callout selected, the preview shows frame 1, the region outline `[data-callout-region]` is hidden, and the readout `[data-readout]` shows `No callout selected`.

Selecting callout n (click, tap, Enter or Space) does all of this:
- only that callout carries `aria-pressed="true"`;
- `[data-preview]` carries `data-callout="<n>"`;
- the region outline shows at the callout's published box, within 1 px of the percentages in Seed data applied to the frame box;
- the frame shown becomes the range start a at once, then steps by the callout stepping rule in Business rules up to b, and holds there;
- the readout shows `Callout <n> of 3 · frames <a>–<b>` (middle dot, en dash);
- the selection is announced;
- the address gets `callout=<n>` by replacing the current history entry, keeping `category` and the hash.

Selecting another callout mid-step restarts the stepping from that callout's own start. Pressing the selected callout again clears the selection: no `aria-pressed="true"`, no `data-callout`, the outline hidden, frame 1, the readout back to `No callout selected`, the clearing announced, and `callout` removed from the address. With focus on a callout, ArrowDown or ArrowRight moves focus to the next callout and selects it, and ArrowUp or ArrowLeft does the same for the previous one; at the first or last callout the key does nothing. Opening a case study with `?callout=<n>` (1 to 3) selects that callout at load with frame b shown at once, no stepping and no announcement. Any other value is removed from the address and nothing is selected. With reduced motion there is no stepping and no outline drawing: the region and frame b show at once, with the same readout, address and announcement.

**Preview recovery.** On a frame fallback plate, `Try again` asks for that object again. When the object arrives, the frame shows, the return is announced, and focus moves to the preview figure (`[data-preview]` on a case study, `[data-preview-frame]` in the dialog, both focusable by script). When it still fails, the plate stays and the failure is announced. Callouts, the readout, frame numbers and the dialog's buttons keep working on a plate.

**Case study navigation.** The current `On this page` link (`aria-current="true"`) follows the 40% line rule for case studies in Business rules, and its links jump as section jumps. `More projects` follows the neighbour rule in Business rules. Following a project link adds one history entry. Back and Forward move between the case studies visited, each arriving at its top with its own title and focus on its level-1 heading, and Back from the first case study visited returns to the gallery as described above.

**Services.** All panels are closed at load. Pressing a service button by click, tap, Enter or Space opens its panel and closes any other, so at most one is open; pressing the open one closes it. A closed panel is hidden from screen readers and nothing inside it is focusable, including while it is closing. Each `Enquire about <service name>` link goes to `/?service=<value>#contact`. Following it does not reload the page:
- the page jumps to `contact` by the section-jump position rule;
- `Project type` shows that service;
- focus moves to the `Your name` field, not the heading;
- the change is announced;
- every other field keeps what the visitor typed;
- one history entry is added.

Opening `/?service=<value>#contact` in a fresh page gives the same state instantly. An unknown value is removed from the address and selects nothing.

**Skills.** `Frontend` is selected at load. Selection follows focus: ArrowRight and ArrowLeft move to and select the next or previous tab, wrapping at the ends, and Home and End select the first and last. Only the selected tab is a Tab stop. Its `tabpanel` is labelled by it and is not a Tab stop itself (its cards are), and the other panels are hidden. In each card, pressing the technology button opens its detail; at most one detail is open per panel, and pressing the open one closes it. The detail shows `Used in:` followed by links to the case studies whose stack in Seed data lists that technology, in project order. When no stack lists it, the detail shows `Used in client work not shown here.` instead. Worked examples:

| Technology | `Used in:` links |
|---|---|
| React | Tallyhouse, Pulse Roster, Tidegauge |
| TypeScript | Hollis Atelier, Foundry Loop, Tallyhouse, Tidegauge |
| Figma | Hollis Atelier, Foundry Loop |
| GSAP | Foundry Loop |
| Node.js | Tallyhouse, Tidegauge |
| Canva | Promptloom |
| Model evaluation | none, so the detail shows `Used in client work not shown here.` |

Each meter carries `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow="<level>"` and `aria-valuetext="<level> out of 100"` from the moment its panel shows, next to the visible figure `<level>`. The meter values never animate.

**Reviews.** One slide shows at a time at every width, starting with review 1. `[data-review-position]` reads `<k> / 5`.
- `Previous review` is disabled on review 1 and `Next review` on review 5; the reviews do not wrap. When the focused button becomes disabled, focus moves to the other one.
- With focus anywhere inside the carousel, ArrowRight and ArrowLeft move one review, and Home and End go to the first and last.
- On the track `[data-review-track]`, a finger or mouse movement of at least 40 px that is more horizontal than vertical moves one review when released: towards the left shows the next review, towards the right the previous one.
- A shorter or mostly vertical movement changes nothing, and a vertical finger movement scrolls the page. At review 1 or 5, a movement past the end changes nothing.
- Only the shown slide is exposed: the others are hidden from screen readers and hold nothing focusable.
- Every change is announced, and there is no automatic rotation.

**Counters.** Each counter `[data-counter="<key>"]` shows its visible figure, and its block carries `data-state` `idle`, `counting` or `done`, following the counter rule in Business rules. The counting figure is hidden from screen readers. A visually hidden text gives the label and final value from load (for example `48`, `98%`), so the final value can be read at any moment. The `%` stays after the satisfaction figure while it counts.

**Enquiry form.** Validation runs in the browser when `Send message` is pressed, by the field rules in Business rules, with messages from Feedback states. Each failing field gets `aria-invalid="true"` and its message in an element below it, referenced by `aria-describedby`. Focus moves to the first failing field, and nothing is sent. No message shows before the first `Send message`. After that press, each field is checked again on every input or change:
- a corrected field loses its message and `aria-invalid` in the same moment;
- the count in `Form status` follows, and it empties when nothing fails;
- a newly broken field gets its message.

Validation never clears a typed value. One press of `Send message` with every field valid sends one request to `POST /api/enquiries`; the sending, sent and not-sent states are in Feedback states. `Send another message` brings back an empty form with focus on `Your name`. A 422 from the server shows the server's messages on their fields, exactly as the browser rules would.

**Custom cursor and footer.** The custom cursor `[data-cursor]` is hidden from screen readers and never catches clicks or taps, and the system cursor stays visible.
- It carries `data-visible="true"` from the first mouse movement, and its centre sits at the pointer position within 1 px in the same moment, with no lag.
- `data-cursor-state` is `view` over a project card (showing the text `View`), `drag` over the reviews track (showing `Drag`), `link` over any other link or button, and `default` everywhere else.
- Any touch or pen input, the pointer leaving the window, and reduced motion set `data-visible="false"`. A later mouse movement shows it again, except with reduced motion.

The first time on a page load that the footer's top edge reaches the line 90% of the way down the viewport, the footer gets `data-waved="true"` and the wordmark plays its wave once. It never repeats on that load, and with reduced motion the wave does not play, though the attribute is still set.

**Touch.** Taps work on every control exactly as clicks do.

### Visual design (DP-05, DP-57)

The site looks like an inked editorial sheet. The page is a pale sage paper. Text and the hero and footer bands are a near-black ink with a cold ultramarine cast, and paper-coloured text sits on those bands. One strong ultramarine blue is the only accent: it marks callout outlines, the focus ring, pressed filters, the selected tab and the current link. A muted grey-green draws 1 px hairline rules between sections and between columns. A burnt orange-red signal colour is used only for field errors and the not-sent message. There are no gradients and no shadows that stand in for rules.

Type: Fraunces, a high-contrast display serif with soft, slightly wonky curves, sets headings and the oversized hero headline. IBM Plex Sans sets body text and controls. IBM Plex Mono sets figures, years, counters, the callout readout and frame numbers. Each heading level is about a third larger than the level below it. The hero headline is the largest type on the site, spans seven of the twelve columns at desktop width, and runs to two or three lines.

Composition: an asymmetric twelve-column sheet with generous white space (airy density: section padding at least as tall as two lines of the largest heading). The gallery is an offset grid in which each card has its own flat colour field behind its cover, drawn from muted tints that keep the ink text legible. Case studies pair the fixed preview with numbered callouts in the prose, each number set in the mono face inside an outlined ultramarine circle.

Every link, button, tab, radio (its whole label) and field is at least 44 by 44 px at 375x812. All text meets WCAG 2.2 AA contrast against its background, both on paper and on ink.

### Motion and effects (DP-02, DP-03, DP-04, DP-13, DP-30, DP-31, DP-35, DP-41, DP-49, DP-58)

These are the only motions on the site. No other animation, transition or loop runs, and there are no unnamed decorative loops.

1. **Hero intro.** The greeting fades in over 300 ms from load. Headline word i (counting from 0) rises 32 px into place and fades in over 500 ms, starting 150 + 100 × i ms after load, so word 6 starts at 750 ms. The paragraph fades in over 400 ms from 1,000 ms. The role line, the role buttons and the two links fade in over 300 ms from 1,300 ms. Copy drift and sculpture tilt follow the pointer and the scroll directly, with the sculpture easing into its angle in at most 150 ms. Both reverse exactly when the visitor scrolls back or moves the pointer back.
2. **Role slide.** On an automatic change, the outgoing text slides up and fades out while the new text slides up into place, over 400 ms.
3. **Journey line.** The progress line grows or shrinks to the last reached milestone over 300 ms.
4. **Card reveal.** The cover opens from a closed mask to the full cover over 500 ms while the title moves 8 px to the right. After a filter change, the shown cards fade in over 250 ms.
5. **Quick-look crossfade and callout outline.** A new frame crossfades in over 200 ms. A callout's region outline draws itself around the box over 300 ms.
6. **Service panel.** The panel's height opens or closes over 300 ms, and the service's visual plays its own 600 ms motion as its panel opens.
7. **Skill bars.** Each time a panel is shown, and for `Frontend` the first time the section's top edge reaches the line 75% of the way down the viewport, each bar grows from empty to its level over 600 ms. Card i (counting from 0) starts 80 × i ms later.
8. **Review track.** The track slides to the new review over 400 ms.
9. **Footer wordmark and cursor.** The wordmark's letters rise 12 px and settle back once, each over 400 ms, with letter i (counting from 0, spaces skipped) starting 40 × i ms later. The custom cursor scales up or down within 150 ms on a state change; its position never animates.
10. **Menu dialog.** It slides down from the top edge over 200 to 350 ms when opening and slides back up over 200 to 350 ms when closing.
11. **Section jumps.** The page glides to the target and arrives within one second.
12. **Hover and focus colour changes.** They finish within 150 ms.

The counters and the callout frame stepping are page-clock changes (Business rules), not motion. The sculpture is vector art with no idle motion and no WebGL, so it needs no separate still fallback beyond the reduced-motion and narrow-width still picture.

**Signature, the Callout Thread, step by step.**
- The visitor selects a numbered callout in the prose.
- Within 300 ms an ultramarine outline draws around the published region of the preview.
- In the same moment, the preview jumps to the first frame of the callout's range, then advances one frame every 150 ms of page time until the last frame, and holds there.
- The mono readout under the preview names the callout and its range.
- Selecting another callout restarts this from its own range, and selecting the same callout again removes the outline and returns the preview to frame 1 at once.

**Reduced motion.** Every item above happens at once, with no movement, glide or fade. The intro starts in its done state, drift and tilt stay 0, the role rotation starts paused and every role change is instant, and the bars, journey line, panels, frames and review track arrive at their end state at once. Callouts show frame b and the region at once, the counters show their targets as soon as the block would start, the wordmark does not move and the custom cursor stays hidden. End states, focus, announcements and addresses are exactly the same as with motion.

### Feedback states (DP-09, DP-21, DP-31, DP-33, DP-36, DP-45, DP-51, DP-52, DP-54)

**`Site updates`** is the single polite `status` region for visitor-caused results. Its text is replaced for each announcement, and each change is announced once, in the same moment as its cause:

| Cause | Announcement |
|---|---|
| a filter change | `Showing <n> of 6 projects.` (`<n>` is the number of shown cards) |
| a review change | `Review <k> of 5: <name>, <role>, <company>.` (for example `Review 2 of 5: Tomas Reyes, Creative Director, Studio Kettle.`) |
| following an enquire link | `Project type set to <service name>.` |
| `Pause roles` / `Play roles` | `Role rotation paused.` / `Role rotation resumed.` |
| selecting / clearing a callout | `Callout <n> of 3: <label>.` / `Callout cleared.` |
| `Try again` succeeding / failing | `The preview frame is back.` / `The preview frame is still unavailable.` |
| the media library returning | `Project images are back.` |

Scrolling, page loads, jumps, the menu, tabs, panels, counters, role changes and the gallery return announce nothing in `Site updates`. The visible result line `[data-results]` shows the same text as the filter announcement at all times. The form speaks only through `Form status`, and the quick-look frame text through the dialog's own `status`.

**Enquiry field messages** (shown below the field):

| Field | Problem | Message |
|---|---|---|
| `Your name` | empty | `Enter your name.` |
| `Your name` | wrong length | `Your name must be 2 to 80 characters.` |
| `Email address` | empty | `Enter your email address.` |
| `Email address` | wrong shape | `Enter an email address like name@example.com.` |
| `Project type` | placeholder chosen | `Choose a project type.` |
| `Budget` | none chosen | `Choose a budget range.` |
| `Tell me about your project` | empty | `Tell me about your project.` |
| `Tell me about your project` | wrong length | `Your message must be 20 to 2,000 characters.` |

**`Form status`** (visible `status`) has these states:
- **Invalid:** `Check the <n> highlighted fields.`, or `Check the 1 highlighted field.` when one field fails.
- **Sending:** `Sending your message…` (one ellipsis character). The button reads `Sending…` and is disabled, every field is disabled with its value kept, and the form carries `aria-busy="true"`.
- **Sent (201):** the form is replaced by a panel with level-3 heading `Message received.`, which receives focus, the paragraph `Thanks, <first word of the name>. Your message is in my inbox, and I usually reply within two working days.` and button `Send another message`. The panel stays until that button is pressed or the page reloads; no timer clears it. The copy is shown only after the mail server accepted the message, so it always holds.
- **Not sent:** after a 503, a network failure or no answer from the site within 30 seconds of real time (the browser's own request timeout, not the page clock), the status shows `Your message was not sent because the mail server is unavailable. Your details are still here, so you can try again.` Every field is enabled again with every value, the project type and the budget kept, the button reads `Send message`, and focus moves to it.

**Media.**
- **Loading:** a slot shows its paper-coloured box at its final size, and a broken-image icon or an empty box is never shown.
- **Shown:** the image with its published accessible name.
- **Unavailable:** the slot gets `data-fallback="true"` and shows a fallback plate in the same box size: an element with role `img`, the same accessible name, and the visible caption `Cover unavailable` (covers) or `Preview frame unavailable` (frames, with button `Try again`).
- **Library unavailable (the whole library cannot be reached):** `Media notice` shows `Project images are unavailable right now. Every page still works.` When the library returns, the notice is hidden and the return is announced in `Site updates`. A single missing object shows only its own plate, with no notice and no re-check.

## Backend

### API (DP-28, DP-32, DP-33, DP-53, DP-54)

Every response body is JSON (`application/json; charset=utf-8`) except media bytes and pages. Request bodies are read as UTF-8 JSON whatever their content type is.

**Error order** for every API and media route, checked in this order, with the first match answering:
1. unknown route: 404 `{"error":"not_found","message":"Not found."}`;
2. wrong method: 405 `{"error":"method_not_allowed","message":"Method not allowed."}`;
3. on grading routes, a missing or wrong `X-Grading-Key`: 404 with the not-found body;
4. on routes that take a body, a body over 16,384 bytes: 413 `{"error":"too_large","message":"The request body is too large."}` (a body of exactly 16,384 bytes is allowed);
5. a body that is not a JSON object: 400 `{"error":"bad_request","message":"The request body must be a JSON object."}`;
6. field checks: 422.

Endpoint rows list only their own outcomes.

| Method and path | Request | Success | Other outcomes |
|---|---|---|---|
| `GET /api/health` | none | 200 `{"status":"ok"}` when storage answers and the mail server accepts a connection | 200 `{"status":"unavailable"}` when storage cannot be reached or the mail server refuses a connection (a missing object does not change health); never 503 |
| `GET /api/media` | none | 200 `{"status":"available","objects":[{"key":"work/hollis-atelier/cover","available":true}, ...]}` listing all 42 published keys in manifest order, each `available` reflecting storage at the moment of the request | while storage cannot be reached: 200 `{"status":"unavailable","objects":[...]}` with every object `"available":false` |
| `GET /media/<key>` | none | 200 with exactly the stored bytes, the stored content type and `X-Content-Type-Options: nosniff` | 404 not-found body for any key not in the manifest (including encoded slashes, `..`, an empty key or a bare `/media/`) and for a published key whose object is missing; 503 `{"error":"media_unavailable","message":"The media library is unavailable."}` while storage cannot be reached |
| `POST /api/enquiries` | `{"name":string,"email":string,"projectType":string,"budget":string,"message":string}` | 201 `{"status":"sent"}`, only after the mail server accepted the message | 422 `{"error":"invalid","message":"The enquiry has invalid fields.","fields":{"<field>":"<message>"}}` naming every failing field (`name`, `email`, `projectType`, `budget`, `message`) with its message from Feedback states; 503 `{"error":"mail_unavailable","message":"The mail server is unavailable."}` |
| `DELETE /api/grading/media/<key>` | header `X-Grading-Key` | 204; the published object is removed from storage | 404 not-found body for a key not in the manifest |
| `POST /api/grading/reset` | header `X-Grading-Key` | 200 `{"status":"ok"}`; every missing published object is stored again | none |

The grading routes exist only when `GRADING_KEY` is set. Without it, every request to them answers as an unknown route. Tests start from the published state, and most need no grading call. Each route accepts only the method listed, and any other method answers 405.

### Business rules (DP-03, DP-04, DP-07, DP-08, DP-11, DP-12, DP-21, DP-22, DP-26, DP-27, DP-31, DP-47, DP-48, DP-51, DP-53, DP-54)

**Rules that hold everywhere.**
- Every action works by keyboard. Tab and Shift+Tab wrap inside every open dialog (the menu and the quick look), Escape closes it, and focus returns to its opener.
- The arrow keys published for a region (quick look, callouts, skill tabs, reviews) work whichever control in that region has focus.
- Under reduced motion every loop stops and each sequence shows its end state at once, with the same function. On touch, every control works by tap.
- A closed menu, panel, detail, tab panel or slide is hidden and inert at every viewport: nothing inside it is visible, focusable or in the accessibility tree, and moving it off-screen does not count as closing it.
- Each published viewport gets its published layout, and no threshold other than 768 px and 1024 px changes any layout.
- Acting again during an exit animation or a pending request keeps the newest state. A stale timer or promise never re-hides a reopened panel or menu, never restarts a counter, and never overwrites a status or error message the latest action showed.

**Page clock.** Exactly five things run on the page's own clock. Each reading may be one 16 ms frame late. The enquiry's 30-second limit is not one of them: it is the browser's own request abort and runs in real time.
1. **The hero intro's end.** `data-intro="playing"` from load, `data-intro="done"` from 1,800 ms of page time.
2. **The role rotation.** Role 1 shows from load. After the intro ends, every 2,500 ms of page time the next role replaces the shown one, with 6 followed by 1. The countdown restarts after every change (manual or automatic), after `Play roles` and when a hold ends. An automatic change shows its new text and index in the same moment it starts. With the intro ending at 1,800 ms on a fresh load, role 2 shows at 4,300 ms and role 3 at 6,800 ms. While paused or held, no automatic change happens, and after a hold ends the next one comes 2,500 ms later. Pressing `Play roles` resumes the rotation and ends any hold caused by focus on that button, so the next automatic change comes 2,500 ms later even though focus stays on the button. The focus hold applies again the next time focus moves onto a role button. With reduced motion the rotation starts paused.
3. **The counters.** A block starts counting the first time on that page load that its top edge is at or above the line 75% of the way down the viewport. This is checked at load and on every scroll and resize, so a jump past the block also starts it. From the start, the figure at t ms of page time is floor(target × t / 1,500) until t reaches 1,500 ms, and exactly the target from then on. `data-state` is `idle` before the start, `counting` during it and `done` from 1,500 ms. A block counts once per page load: scrolling out and back, a section jump, a resize or switching skill tabs never restarts, pauses or resets it, and only a reload starts it over. With reduced motion the figures show their targets and `data-state` is `done` the moment the block would start. Worked examples:

   | Target | Figures |
   |---|---|
   | 48 | 24 at 750 ms; 32 at 1,000 ms; 47 at 1,499 ms; 48 from 1,500 ms |
   | 7 | 2 at 500 ms; 4 at 1,000 ms |
   | 98 | 49% at 750 ms; 97% at 1,499 ms; 98% at 1,500 ms |
   | 31 | 15 at 750 ms |
   | 9 | 4 at 750 ms |
   | 26 | 13 at 750 ms |

4. **Callout frame stepping.** On selection, frame a shows at once, and then one frame every 150 ms of page time until b, where it holds. For a 2–5 range: frame 2 at selection, 3 at 150 ms, 4 at 300 ms, 5 from 450 ms.
5. **The media status re-check.** While `GET /api/media` says unavailable, the page asks it again every 5 seconds of page time.

**Scroll lines.** Each rule is evaluated on every scroll and resize event and never depends on `IntersectionObserver` or `ResizeObserver`.
- **Home current section:** the last of `about`, `work`, `services`, `skills`, `reviews` and `contact`, in page order, whose top edge is at or above the line 40% of the way down the viewport. `numbers` is never current, and nothing is current while the top edge of `about` is below the line.
- **Case-study current section:** the last of `overview`, `challenge`, `solution`, `decisions` and `stack` whose top edge is at or above the 40% line. Nothing is current before `overview` reaches it.
- **Milestones:** a milestone carries `data-reached="true"` while its top edge is at or above the line 60% of the way down the viewport, and `"false"` otherwise.

**Copy drift.** At window scroll position s, `[data-hero-copy]` is moved up by round(0.3 × min(s, 600)) px. Worked examples: s 0 → 0; s 100 → 30; s 250 → 75; s 300 → 90; s 600 → 180; s 900 → 180. With reduced motion, the drift stays 0.

**Sculpture tilt.** Let (x, y) be the pointer position, and let (cx, cy), w and h be the centre, width and height of the `intro` section's box. Then:
- `data-tilt-x` = round(−12 × (y − cy) / (h / 2));
- `data-tilt-y` = round(12 × (x − cx) / (w / 2));
- each is clamped to −12..12 whole degrees;
- an exact half rounds away from zero (2.5 gives 3, −2.5 gives −3);
- the computed transform of `[data-hero-visual]` is a rotation about the x axis by `data-tilt-x` degrees followed by a rotation about the y axis by `data-tilt-y` degrees (rotateX then rotateY), with no perspective, translation or scale in it.

Worked examples with the section at x 0, y 0 and 1280 × 800:

| Pointer | tilt-x | tilt-y |
|---|---|---|
| (640, 400) | 0 | 0 |
| (960, 400) | 0 | 6 |
| (1280, 0) | 12 | 12 |
| (640, 600) | −6 | 0 |
| (320, 200) | 6 | −6 |
| (1100, 100) | 9 | 9 |

**Filtering.** Disciplines have a canonical order and address values: Web `web`, Motion `motion`, Cloud `cloud`, Data `data`, Design `design`, AI `ai`.
- `All` is pressed exactly when no discipline is.
- With none pressed, every card shows. Otherwise a card shows when it has any pressed discipline, and shown cards keep the published order.

Worked examples (pressed → shown):

| Pressed | Shown cards | Result line |
|---|---|---|
| none | all 6 | `Showing 6 of 6 projects.` |
| Web | Hollis Atelier, Foundry Loop, Tallyhouse, Pulse Roster | 4 shown |
| Motion | Foundry Loop, Tidegauge | 2 shown |
| Motion and Design | Hollis Atelier, Foundry Loop, Tidegauge, Promptloom | 4 shown |
| Cloud and AI | Pulse Roster, Promptloom | 2 shown |
| Motion and Data | Foundry Loop, Tallyhouse, Tidegauge | 3 shown |
| AI | Promptloom | `Showing 1 of 6 projects.` |
| all six disciplines | all 6 | 6 shown |

**Filter address.**
- The pressed disciplines are kept in `category` as address values in canonical order, comma separated, whatever order they were pressed in: Design then Motion gives `?category=motion,design`. With none pressed, the parameter is absent.
- A filter change replaces the current history entry (it never adds one) and keeps the hash.
- Opening `/?category=<list>` applies the list. Unknown or repeated values are dropped and the address is rewritten to canonical form at once; when no valid value remains, the parameter is removed. For example, `/?category=design,ai,bogus,ai` becomes `?category=design,ai`.
- Card links carry the list: `/work/<slug>?category=<list>` with disciplines pressed, `/work/<slug>` without.

**Neighbour projects.** `Previous project: <title>` and `Next project: <title>` link to this project's neighbours in the published order, among the projects that the address's `category` list shows. Without a list, the neighbours come from all six projects, and when this project is not in the list they also come from all six. The links keep the `category` parameter. The first shown project has no previous link and the last has no next link; the list does not wrap. Worked examples (project, list → previous, next):

| Project | List | Previous | Next |
|---|---|---|---|
| Foundry Loop | none | Hollis Atelier | Tallyhouse |
| Hollis Atelier | none | none | Foundry Loop |
| Promptloom | none | Tidegauge | none |
| Foundry Loop | motion,design | Hollis Atelier | Tidegauge |
| Tidegauge | motion,design | Foundry Loop | Promptloom |
| Promptloom | motion,design | Tidegauge | none |
| Pulse Roster | cloud | none | none |
| Tidegauge | cloud | Pulse Roster | Promptloom |
| Tallyhouse | data | none | Tidegauge |
| Tidegauge | data | Tallyhouse | none |

**Enquiry field rules.** These are applied in the browser and again on the server, in field order. Values are trimmed first, and the name also has every run of spaces, tabs and line breaks turned into one space.
- **Name:** must be non-empty and 2 to 80 characters long (2 and 80 allowed).
- **Email:** must be non-empty and contain exactly one `@`, with a non-empty part before it, no spaces, and a domain after it that contains a dot that is neither its first nor its last character.
- **Project type:** must be one of `web`, `motion`, `cloud`, `design`, `ai` or `other`. The dropdown lists, after its placeholder, the five service names from Seed data in service order with the first five values, followed by the option `Something else` with the value `other`.
- **Budget:** must be one of `under-5k`, `5k-15k`, `15k-40k` or `over-40k`.
- **Message:** must be non-empty and 20 to 2,000 characters long (20 and 2,000 allowed).

On the server, a missing field or one that is not a string counts as empty.

**Enquiry state machine.**
- `editing` → `invalid` when a press finds a failing field; `invalid` → `editing` as fields are corrected.
- `editing` → `sending` when a press finds every field valid.
- `sending` → `sent` on 201.
- `sending` → `failed` on a 503, a network failure or the 30-second limit, with every value kept.
- `failed` → `sending` on the next press.
- `sent` → `editing` only through `Send another message`.

`sending` accepts no new press, since the button and fields are disabled, so one press sends at most one email. The server never retries a send on its own and never caches a failed connection: each request connects to the mail server again.

**Enquiry email.** The server sends one email per accepted request, with:
- To: `hello@ottolinerask.example`;
- From: the `MAIL_FROM` value;
- Reply-To: the visitor's email;
- Subject: `New enquiry: <project type name> from <name>`.

The body is plain text, with lines separated by line breaks: `Name: <name>`, `Email: <email>`, `Project type: <project type name>`, `Budget: <budget label>`, an empty line, then the message. The project type name and budget label are the visible option labels. The name is used in its trimmed and collapsed form everywhere, so a line break in it never starts a new header. The message keeps its inner line breaks. Header text outside plain ASCII is encoded by the mail standards so that the inbox shows the original characters. Worked example: the name `Ada␊Bcc: x@evil.example` (a line break after Ada) gives the subject `New enquiry: Web Development from Ada Bcc: x@evil.example` and exactly one recipient. The server answers 201 only after the mail server accepted the message. If the mail server cannot be reached, or does not accept within `MAIL_TIMEOUT_SECONDS`, the server answers 503.

**Media object state machine (in the browser).**
- `loading` → `shown` when the object arrives.
- `loading` → `unavailable` (fallback plate) when `/api/media` lists it unavailable or the browser's request for it fails.
- `unavailable` → `shown` after `Try again` succeeds (frames) or after the page's re-check finds the library available again.

When the re-check finds the library available, the page hides the notice, loads every slot in place without a reload, and announces the return. The notice and the re-check apply only while `GET /api/media` reports the whole library unavailable. When a browser request for an image fails, the page asks `GET /api/media` at once: if it reports unavailable, the notice shows and the re-check starts; if it reports available, only that slot shows its plate. A single missing object never shows the notice. A missing frame recovers through `Try again`, and a single missing cover stays a plate until the page is reloaded after the object is stored again.

### Services (DP-32, DP-33, DP-50, DP-53, DP-54)

**Mailpit (outgoing mail).** Each accepted enquiry is delivered over SMTP (`SMTP_HOST`, `SMTP_PORT`, no authentication) as exactly one email to `hello@ottolinerask.example`, with the headers and body described under Enquiry email in Business rules. When the mail server is down, the API answers 503, the form shows its not-sent state, and the next press sends once mail is back, with no restart.

**MinIO (media library).** The bucket named by `S3_BUCKET` holds the 42 published objects. For each project in order, the keys are `work/<slug>/cover`, then `work/<slug>/frame-1` to `work/<slug>/frame-6`. Each object is an original procedural image made for the site and stored with content type `image/png`, `image/webp` or `image/svg+xml`. The six frames of one project differ visibly from each other. The app holds or generates the artwork itself.
- At start, and whenever storage becomes reachable again, it creates its bucket if missing and stores every published object that is missing.
- While storage cannot be reached, it tries again every `MEDIA_PROBE_SECONDS` seconds without a restart, so `GET /api/media` reports `available` within 10 seconds of storage answering.
- The app never lists the bucket for a visitor, never reads any other key, and the browser never receives an object-store address.
- When storage is down, the media route answers 503 and pages show the plates and notice from Feedback states.

### Seed data (DP-25, DP-27, DP-35, DP-40, DP-45, DP-47)

Every person, business, client, review, figure and milestone below is invented and illustrative. The site places the labels `Illustrative career timeline`, `Illustrative figures` (on both figure blocks), `Illustrative fluency scores` (on each skill panel), `Illustrative reviews: the clients, quotes and companies are fictional samples.` (in `reviews`) and `Illustrative availability`, and `(illustrative)` after every client and company name.

**Roles** (index: text): 1 `full-stack developer`, 2 `motion engineer`, 3 `Firebase app builder`, 4 `creative designer`, 5 `presentation designer`, 6 `prompt engineer`.

**About lists.**
- `Working principles`: `Ship the boring parts well.`, `Motion explains, never decorates.`, `Every screen works without a mouse.`, `Measure before you polish.`
- `Areas of expertise`: `Full-stack web development`, `Motion and interaction`, `Firebase and cloud apps`, `Creative and presentation design`, `AI-assisted workflows`.

**Career journey** (button name, then detail):

| Milestone button | Detail |
|---|---|
| `2017: First freelance website` | `Built a booking site for a local bakery and learned that the boring parts decide whether a site gets used.` |
| `2019: Front-end lead at a product studio` | `Led the front end for a team of four and set up the studio's first accessibility checks.` |
| `2021: Went independent` | `Started Quillfern Works to take on motion and full-stack builds directly for agencies and founders.` |
| `2023: First real-time cloud app in production` | `Shipped a real-time volunteer roster that coordinators now run every weekend.` |
| `2025: AI-assisted tools for design teams` | `Began building AI-assisted tools that help design teams repeat and share their best work.` |

**Figures** (key, label, target):
- `[data-stats="about"]`: `years` `Years building for the web` 9; `led` `Projects led end to end` 31.
- `[data-stats="numbers"]`: `projects` `Projects delivered` 48; `technologies` `Technologies in use` 26; `awards` `Awards and mentions` 7; `satisfaction` `Client satisfaction` 98, shown with `%`.

**Projects**, in published order:

| # | Slug | Title | Kind | Client | Year | Role | Disciplines |
|---|---|---|---|---|---|---|---|
| 1 | `hollis-atelier` | `Hollis Atelier` | `Architecture and creative portfolio website` | `Hollis Atelier` | 2025 | `Design and build` | Web, Design |
| 2 | `foundry-loop` | `Foundry Loop` | `Animated studio website` | `Foundry Loop` | 2024 | `Motion and front-end build` | Motion, Web |
| 3 | `tallyhouse` | `Tallyhouse` | `Full-stack web application` | `Tallyhouse Collective` | 2024 | `Full-stack build` | Web, Data |
| 4 | `pulse-roster` | `Pulse Roster` | `Firebase-powered application` | `Pulse Volunteers` | 2023 | `App and cloud build` | Cloud, Web |
| 5 | `tidegauge` | `Tidegauge` | `Interactive dashboard` | `Tidegauge Analytics` | 2025 | `Dashboard design and build` | Data, Motion |
| 6 | `promptloom` | `Promptloom` | `AI-assisted creative tool` | `Promptloom Labs` | 2026 | `Product design and AI build` | AI, Design |

Discipline names are always listed in canonical order, so `data-categories` for Foundry Loop is `web motion`.

**Technology stacks** (exact `Technology stack` list items, in order):
- Hollis Atelier: `Next.js`, `TypeScript`, `Accessible HTML and CSS`, `Figma`, `Brand assets`.
- Foundry Loop: `TypeScript`, `GSAP`, `SVG animation`, `Web Animations API`, `Figma`.
- Tallyhouse: `React`, `Node.js`, `PostgreSQL`, `REST and GraphQL APIs`, `TypeScript`.
- Pulse Roster: `React`, `Firebase Authentication`, `Cloud Firestore`, `Cloud Functions`, `Hosting and CI`.
- Tidegauge: `TypeScript`, `React`, `Framer Motion`, `Node.js`, `MongoDB`.
- Promptloom: `Prompt design`, `Workflow automation`, `Custom AI tools`, `Canva`, `Presentation design`.

**Callouts** (n: label | frame range a–b | region as left, top, width, height in % of the frame box):

| Project | Callout 1 | Callout 2 | Callout 3 |
|---|---|---|---|
| Hollis Atelier | `Plan-to-photo wipe` \| 1–3 \| 8, 12, 46, 60 | `Project index rail` \| 3–4 \| 70, 10, 22, 80 | `Material swatch reveal` \| 4–6 \| 12, 70, 60, 20 |
| Foundry Loop | `Reel scrubber` \| 1–2 \| 10, 70, 80, 18 | `Letterform morph` \| 2–5 \| 15, 15, 55, 45 | `Team grid hover` \| 5–6 \| 60, 40, 32, 44 |
| Tallyhouse | `Booking calendar` \| 1–2 \| 6, 14, 52, 58 | `Invoice builder` \| 3–4 \| 62, 14, 32, 58 | `Usage chart` \| 5–6 \| 6, 76, 88, 18 |
| Pulse Roster | `Live shift board` \| 1–3 \| 8, 10, 84, 50 | `Sign-in screen` \| 3–4 \| 30, 20, 40, 60 | `Swap request flow` \| 4–6 \| 10, 64, 80, 28 |
| Tidegauge | `Streaming tide chart` \| 1–4 \| 6, 18, 62, 56 | `Station picker` \| 4–5 \| 72, 18, 22, 56 | `Alert timeline` \| 5–6 \| 6, 80, 88, 14 |
| Promptloom | `Prompt recipe editor` \| 1–2 \| 6, 12, 40, 70 | `Moodboard canvas` \| 2–5 \| 50, 12, 44, 70 | `Export to slides` \| 5–6 \| 6, 86, 88, 10 |

**Case-study prose** (`Overview` / `The challenge` / `The solution` / `Design decisions`). Write it as given. It is not checked character for character.
- **Hollis Atelier.**
  - Overview: Hollis Atelier is a small architecture practice that wanted its portfolio to feel like walking through a set of drawings. I designed and built the site end to end.
  - The challenge: Hundreds of plans and photographs, no way to show how a drawing became a building, and an old site that could not be used without a mouse.
  - The solution: Each project wipes from plan to finished photograph as the reader moves through it, with a project index rail always in reach and every control usable by keyboard.
  - Design decisions: The wipe follows the reader's scroll instead of a timer, so nobody waits for it. With reduced motion, the plan and the photograph sit side by side.
- **Foundry Loop.**
  - Overview: Foundry Loop is a motion studio that subcontracted me to build its site around its reel. I owned the motion system and the front-end build, and the studio's designers owned the art direction.
  - The challenge: A single reel hid which shots were whose, and the logo's letterforms had to move without becoming unreadable.
  - The solution: A scrubbable reel stops on any shot and shows its credits, the letterforms morph between weights, and the team grid reveals each person's role on hover and on focus.
  - Design decisions: Every animation has a reduced-motion version that shows its end state at once, and the scrubber works with the arrow keys.
- **Tallyhouse.**
  - Overview: Tallyhouse Collective runs shared workshops and needed one place to book rooms, bill members and see usage. I built the application from the data model up.
  - The challenge: Bookings, invoices and usage lived in three spreadsheets that disagreed every month.
  - The solution: A booking calendar, an invoice builder and a usage chart share one data model, so a confirmed booking becomes a line on the next invoice.
  - Design decisions: Invoices are built from confirmed bookings only, and the calendar reads as a table to screen readers.
- **Pulse Roster.**
  - Overview: Pulse Volunteers coordinates shifts for community events. I built a real-time roster that volunteers open on their phones.
  - The challenge: Shift changes went out by group message and arrived after the shift had started.
  - The solution: A live shift board updates the moment someone signs up or swaps, behind a simple sign-in screen, and a swap request flow trades shifts with one tap each.
  - Design decisions: The board keeps working on a weak connection and catches up when it returns, and every status is written in words as well as colour.
- **Tidegauge.**
  - Overview: Tidegauge Analytics sells tide and water-level data to harbour operators. I designed and built the dashboard they watch through a shift.
  - The challenge: Readings arrive every few seconds from dozens of stations, and the old charts redrew so often that operators lost their place.
  - The solution: A streaming tide chart adds new readings without redrawing the view, a station picker keeps chosen stations in reach, and an alert timeline sits under the chart.
  - Design decisions: Only new readings animate, never the axes, and operators can pause the stream to read a moment.
- **Promptloom.**
  - Overview: Promptloom Labs builds tools for design teams that use AI every day. I designed the product and built its prompt and export features.
  - The challenge: Designers kept prompts in scattered notes and could not repeat a result they liked.
  - The solution: A prompt recipe editor saves reusable recipes, a moodboard canvas gathers the results, and one export turns a board into slides.
  - Design decisions: Every generated image keeps the recipe that made it, and the editor is fully usable by keyboard.

**Services** (name | address value | always-shown description | deliverables | technology):
1. `Web Development` | `web` | `Websites and web applications, from the first wireframe to the production deploy.` | `Marketing and product websites`, `Full-stack web applications`, `APIs and integrations`, `Responsive front ends` | `React`, `Next.js`, `MERN stack`, `REST and GraphQL APIs`
2. `Motion & Interaction` | `motion` | `Motion that explains a product, with a reduced-motion version of every moment.` | `Scroll-driven storytelling`, `Micro-interactions`, `Animated brand systems`, `Reduced-motion versions` | `GSAP`, `Framer Motion`, `Web Animations API`, `SVG animation`
3. `App & Cloud Solutions` | `cloud` | `Firebase and cloud apps with sign-in, real-time data and functions.` | `Firebase apps`, `Sign-in and accounts`, `Real-time data`, `Cloud functions` | `Firebase Authentication`, `Cloud Firestore`, `Cloud Functions`, `Hosting and CI`
4. `Creative Design` | `design` | `Decks, brand assets and campaign visuals a whole team can reuse.` | `Presentation decks`, `Brand assets`, `Social and campaign visuals`, `Visual storytelling` | `Canva`, `Figma`, `Presentation design`, `Brand guidelines`
5. `AI & Prompt Engineering` | `ai` | `Prompt systems and small AI tools that fit the way your team already works.` | `Prompt design`, `Workflow automation`, `Custom AI tools`, `Team training` | `Prompt libraries`, `Workflow automation`, `Custom AI tools`, `Model evaluation`

Each service item is `[data-service="<value>"]` with its own visual `[data-service-visual]`: vector and style-sheet art, with a distinct shape and pattern per service. Each panel holds list `Deliverables`, list `Technology` and link `Enquire about <service name>`.

**Skills** (technology and fluency out of 100, four cards per panel in this order):
- Frontend: React 92, Next.js 88, TypeScript 90, Accessible HTML and CSS 94.
- Backend: Node.js 86, REST and GraphQL APIs 82, PostgreSQL 74, MongoDB 70.
- Animation: GSAP 90, Framer Motion 84, Web Animations API 80, SVG animation 86.
- Cloud: Firebase Authentication 85, Cloud Firestore 83, Cloud Functions 78, Hosting and CI 72.
- Design: Canva 88, Figma 84, Presentation design 90, Brand assets 80.
- AI: Prompt design 87, Workflow automation 81, Custom AI tools 76, Model evaluation 70.

Each card is `[data-skill]`.

**Reviews** (k: quote | name | role | company). Each slide shows the quote, the name and `<role>, <company> (illustrative)`.
1. `Ottoline rebuilt our booking flow in six weeks, and every screen worked by keyboard on day one.` | `Priya Nandakumar` | `Head of Product` | `Fernway Health`
2. `We subcontracted the motion on three launches. Each shipped with a reduced-motion version we never had to ask for.` | `Tomas Reyes` | `Creative Director` | `Studio Kettle`
3. `The Firebase app went live before our pilot, and the real-time rota has not dropped a shift since.` | `Amara Osei` | `Founder` | `Loomlight`
4. `Clear estimates, clean pull requests and a dashboard our operations team actually opens every morning.` | `Jonah Feld` | `Engineering Manager` | `Parcelgrid`
5. `Ottoline turned our pitch deck and brand assets into one system the whole team can reuse.` | `Elif Durmaz` | `Brand Lead` | `Northcap Coffee`

**Starting state.** The copy above, the 42 published media objects stored, no filter, every panel and dialog closed, tab `Frontend` selected, review 1 shown, no callout selected, counters idle, and an empty form.

## Technical requirements

### Deployment (DP-28, DP-59)

The runtime is Node 22 with npm. At the `/app` root, provide `run.json` with the string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` always answers HTTP 200 JSON as described in API, with `{"status":"ok"}` when both services answer.

### Configuration and secrets (DP-59)

Read these environment variables at start:
- media library: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`;
- grading routes: `GRADING_KEY` (no default; when it is absent the grading routes do not exist);
- `MEDIA_PROBE_SECONDS` (whole seconds, default 5);
- `MAIL_TIMEOUT_SECONDS` (whole seconds, default 10).

Never hard-code a credential or service address, and never send any of these values, or the object-store address, to the browser.

### Server boundary (DP-28, DP-33, DP-54)

- The site is same-origin only. It sends no CORS headers, sets no cookies, and sends no Content-Security-Policy header or meta tag. The browser never contacts another origin: fonts, scripts, styles and images all come from the app.
- The server serves only the pages, the built assets and fonts, the media route and the API. A request for source files, source maps, `.env`, `run.json` or package files answers the 404 not-found page.
- Request bodies are limited as stated in API.
- The app starts and serves every page whether or not the media library or the mail server can be reached. It recovers when they return, without a restart:
  - media through the storage probe in Services;
  - mail because each send connects again.
- The grader runs two extra copies of the site. In `media-late`, the storage address refuses connections at start and uses its own empty bucket. In `mail-late`, the mail server address refuses connections at start and the mail timeout is 3 seconds. In each copy, that address may begin answering later as the same service (the same storage, or the same mail server), and the copy must notice without a restart.

### Browser support and performance (DP-11, DP-47, DP-57)

- **Browsers:** current Chromium, Firefox and WebKit, tested at 375x812 (touch), 768x1024, 1024 wide and 1280x800, with and without reduced motion, and with a page clock that moves only on purpose.
- **Missing observers:** with `IntersectionObserver` or `ResizeObserver` missing from the browser, every scroll-linked and size-linked rule still holds, and no error reaches the page.
- **Speed:** each page is usable within three seconds of navigation on the grading machine, and the intro never waits for fonts or images.

## Working rules

- IF-01: `/app/run.json` exists, is valid JSON with string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and its commands install, build and serve the site.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package and the three font families (Fraunces, IBM Plex Sans, IBM Plex Mono), each with its licence. Shipped packages means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package uses the MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD licence, and every font file uses the SIL Open Font License 1.1.
- IF-04: The site uses no datastore, broker, queue or service other than the provided mail server and media library, and no database, file-based ones included.
- IF-05: The shipped packages contain no animation library, and no page loads a font, script, style, image or video from another origin.
- IF-06: Every colour in the style sheets is written as a plain hexadecimal or red-green-blue value (alpha allowed), never as a colour-mixing or other colour function.
- IF-07: The provided service configuration and its development credentials stay unchanged.
- IF-08: All artwork is original and made for the site, and the covers and preview frames reach the media library only through the app's own storing at start or on recovery.

## Engineering standards

- The TypeScript is idiomatic and type-checked in strict mode, with no `any` escape hatches and no ignored compiler errors.
- Names in the code match the domain terms of this brief: enquiry, project type, budget band, discipline, callout, frame range, media key, fallback plate, counter, review.
- Each domain rule is decided in exactly one place in the source, and both the browser and the server use that single decision where both need it. These rules are the enquiry field rules, the enquiry state machine, the filter and address canonical form, the neighbour rule, the counter figure, the callout stepping, the scroll lines and the media manifest.
- There is no abstraction with a single implementation, no dead, commented-out or unreachable code, and no defensive checks for states this brief makes impossible.
- Every API error uses the one shape `{"error":<code>,"message":<text>}`, with the 422 `fields` addition being the only extension.
- Motion is built only on the browser's own style-sheet animations, transitions and built-in element animations, and page-clock work uses the page's own timers only for the five published items, and the enquiry's 30-second limit uses the browser's own request abort in real time.
- The code has no features, routes, screens or settings beyond this brief.
