# Sollis Studio Folio

Folio is the commissioning site of Maren Sollis, an independent designer who works across brand identity, website design and digital product design. Brand, marketing and product leads at mid-size and large companies use it to scope an engagement: what each service includes, past work grouped under the same services, and how the work runs. They then send a structured commission brief that comes back as a one-page PDF they can forward to their buying committee. Build it in TypeScript on Node 22. The backend uses three services: Postgres stores the content and every enquiry, a Mailpit SMTP server receives the two messages each enquiry produces, and Gotenberg renders the brief PDF. Leave out accounts, sign-in, sessions, admin or editor screens, dashboards, carts, payment, newsletters, search, comments, chat, AI features, analytics, cookies and tracking. Content changes only through the grading route in API. Maren Sollis, Sollis Studio's clients and every person and business on the site are fictional.

## Problem and users

Companies often hire one independent designer instead of an agency, but a lead first has to scope the engagement and get a buying committee to approve it. Most designer sites make that hard. Services are vague adjectives. Nobody says which deliverables a brand identity, website or product engagement includes. Budget is never mentioned. The contact form is one text box, and the lead later retypes their answer into an internal memo. Folio fixes this. Each of the three services lists its exact capabilities, deliverables and typical length. Past engagements are grouped under those services as evidence. The enquiry is a structured brief with a project type, a budget range and a description. Every brief is stored exactly as written, reaches the studio inbox with an acknowledgement to the sender, and can be downloaded as a one-page PDF.

- **Brand lead** (occasional): scopes a brand identity, website or product engagement against the published deliverables and evidence, then sends a commission brief the buying committee can sign off.
- **Product manager** (occasional): checks the digital product deliverables, the process and past engagements before proposing the designer to the committee, often on a phone.
- **Principal designer** (daily): receives every commission brief in the studio inbox exactly as the client wrote it, with its project type and budget range, ready to answer.

## Journeys

Every journey starts from the starting content in Seed data, restored through the grading route.

1. **Home tour.** On `/` the visitor reads the intro, About, Services, Selected work, How I work and Start a project in that order. They use the header links to jump to each section and the intro's `Start a project` link to reach the contact heading. Each jump ends with focus on the section heading, clear of the fixed header, and the current header link follows the scroll position in both directions.
2. **Reading the statistics.** A product manager scrolls to About, watches the four statistics count up to their published values, and uses the arrow keys to step through them, reading each note and how it splits into parts.
3. **Scoping a service.** A brand lead opens Brand Identity by keyboard, reads its capabilities, deliverables and typical engagement, and then opens Website Design, which closes Brand Identity. They copy the address and open it in a new window, where Website Design is open with focus on its button. From the open panel, `Start a Website Design project` takes them to the enquiry form with that project type already checked, and Website Design stays open above.
4. **Weighing the evidence.** A product manager follows `See Digital Product Design work` to the gallery, now filtered to that service and announced. They open a project and its cover moves into the case study's hero. They read every section, step to the next project in the same service, and press the browser's Back button twice, once per case study shown. They return to the tile of the project they first opened, with the filter still chosen.
5. **Keeping the work current.** The principal designer replaces the content through the grading route, adding, renaming or removing projects. On the next page load each filter count equals the projects listed under it, an empty service shows its empty notice, and the previous and next links show the new titles.
6. **Sending a commission brief.** A brand lead fills the enquiry form using only the keyboard, corrects the published validation messages, and presses `Send enquiry` twice. They see one thank-you panel with one reference and the values exactly as stored. The studio inbox gets one studio copy and the lead gets one acknowledgement. The lead downloads the brief PDF for the committee.
7. **When mail or PDF is down.** With the mail server unreachable, the brief is still stored and the panel shows the delay notice. With the PDF renderer unreachable, the enquiry is still sent and the brief address shows the unavailable page.
8. **On a phone.** At 375 px wide, a product manager opens the menu by tap, opens a service and a filter by tap, and swipes through a case study's showcase screens one at a time. With reduced motion on, every reveal, count and cover move appears at once in its final state.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Home tour** Starting from the starting content, a visitor reads `/` top to bottom, jumps to every section from the header and from the intro, and lands on each section heading with focus, clear of the header.
- **DP-02 — Starting home content** `/` shows its sections, headings, intro, About, background list, principles and footer exactly as published in Seed data, in published order.
- **DP-03 — Section jumps clear of the header** Every section jump by link or by an address with a hash puts focus on the section heading at least 16 px below the header, within one second, and instantly with reduced motion and on load.
- **DP-04 — Current section while scrolling** The header and menu link of the section holding the point 40% down the viewport carries `aria-current="true"`, updating while scrolling down and back up, and no link is current while the intro holds that point.
- **DP-05 — Editorial paper look** Every page reads as a quiet editorial page: warm off-white paper, hairline rules and no shadows, oversized ragged serif headlines, equal-width figures in statistics and indexes, on a twelve-column grid with project titles hanging into the left margin.
- **DP-06 — Reading the statistics** A product manager scrolls to About, watches the four statistics count up to their published values and steps through them by keyboard to read each note and its parts.
- **DP-07 — Statistics count** Each statistic counts from 0 to its value over 1,200 ms on the published curve once per page load, its tab's name always carries the final value, and with reduced motion the values show at once.
- **DP-08 — Statistics tabs by keyboard** The `Statistics` tab list selects tabs at once with ArrowRight, ArrowLeft, Home and End, wrapping, with one Tab stop and the panel left out of the Tab order.
- **DP-09 — Statistic part bars** The selected statistic's panel shows its note, one bar segment per part sized to the part's share within 0.5 percentage points, and each part as `<part label>: <part value>` text.
- **DP-10 — Scoping a Brand Identity engagement** A brand lead opens Brand Identity by keyboard, reads its capabilities, deliverables and typical engagement, and follows `Start a Brand Identity project` from the open panel into a form with that project type checked while the service stays open.
- **DP-11 — Services collapsed at load** Every service is collapsed at load unless the address names one, and nothing inside a collapsed panel can be reached by Tab or by a screen reader.
- **DP-12 — Published service content** Each open service panel shows its summary, capabilities, deliverables, typical engagement and two links exactly as published, with the two lists side by side from 768 px wide and stacked below.
- **DP-13 — Service panel motion** A service panel opens and closes by changing height over 280 to 360 ms while its chevron turns half a turn, and does both at once with reduced motion.
- **DP-14 — Comparing Website Design** A brand lead moves between service buttons by arrow keys, opens Website Design so the open service closes, and shares an address that reopens it with focus on its button.
- **DP-15 — Service buttons by arrow keys** ArrowDown, ArrowUp, Home and End move focus between the service buttons, wrapping, without opening or closing any service.
- **DP-16 — One open service in the address** At most one service is open, its id is kept in the `service` parameter without a new history entry while other parameters and the hash stay, and an address with `service=<id>` opens it with focus on its button.
- **DP-17 — Digital Product evidence** A product manager follows `See Digital Product Design work` to the gallery filtered and announced for that service, and after the principal designer's content change sees counts and lists that agree.
- **DP-18 — Service work link** Following `See <service name> work` on `/` checks that category, jumps to `Selected work` with focus on its heading and makes the filter announcement.
- **DP-19 — Category counts follow content** After any content change through the grading route, the next page load shows each filter radio's count equal to the projects listed under it, and an empty category shows the published empty sentence.
- **DP-20 — Grading content route** The grading route replaces, restores and lists content and enquiries with the published key, shapes, statuses and error order, as qualified in API.
- **DP-21 — Filtering the work** A brand lead filters the work by each service with the arrow keys, hears each count announced, reloads the filtered address and finds the same category checked.
- **DP-22 — Filter radios and announcements** The `Filter work by service` radios move with arrow keys and clicks, show only the chosen projects in published order and make the published plural, singular or empty announcement once per change.
- **DP-23 — Filter in the address** The chosen category is kept in the `category` parameter without a new history entry, an address with a category opens with it checked and announces nothing, and an unknown category is ignored.
- **DP-24 — Hidden projects unreachable** Projects outside the chosen category cannot be reached by Tab or by a screen reader, and the gallery shows three, two or one column by width as published.
- **DP-25 — Opening a case study** A brand lead opens a work item by keyboard, sees its cover carried into the case study's hero, the title lines rise, the address change and focus land on the heading, then reads every section.
- **DP-26 — Cover Carry motion** Opening a case study from a work item keeps the document loaded, adds one history entry, sets the title and focus, and moves the hero from the cover's box to its own over 440 to 520 ms before the title lines rise.
- **DP-27 — Case study content** Each `/work/<slug>` shows its eyebrow, title, standfirst, hero and the six sections with the project's stored content in published order.
- **DP-28 — On this page navigation** The `On this page` links jump to their sections with focus on the heading clear of the header, and the link of the section holding the point 40% down the viewport is current.
- **DP-29 — Not-found pages** An unknown project and any other unknown page answer HTTP 404 with their published heading, link and title.
- **DP-30 — Moving through the work** A brand lead inside a filtered sequence steps from project to project with the links and arrow keys, then presses Back once per case study shown to return to the gallery tile of the project they first opened.
- **DP-31 — Previous and next project links** `More work` names the previous and next projects of the current sequence, omits them at the ends, keeps the `category` parameter and follows content changes on the next page load.
- **DP-32 — Arrow keys between projects** ArrowLeft and ArrowRight on a case study open the previous and next project unless focus is in a text field, select, radio group or tab list.
- **DP-33 — Back to the same tile** After one browser Back press per case study shown, arriving on `/` keeps the chosen filter, scrolls the item of the project first opened from the gallery fully into view clear of the header, moves the cover back into it and focuses its link.
- **DP-34 — Neighbour slide motion** Moving to the previous or next project slides the old hero 40 px out and the new one 40 px in on the published sides over 320 to 400 ms, then raises the title lines.
- **DP-35 — Motion tour** A visitor loads `/`, watches the intro lines rise and the headings and covers reveal while scrolling, hovers and focuses work items, and scrolls the intro plate down and back.
- **DP-36 — Intro and reveal motion** The intro lines, section headings and covers reveal once per page load with the published offsets, durations and staggers.
- **DP-37 — Work item hover and focus** Hovering or focusing a work item scales its cover to 1.04 and raises its `View case study` caption within the published times, and leaving or blurring reverses both.
- **DP-38 — Intro plate follows scroll** The intro plate is moved down by round(0.25 × min(s, 800)) px at scroll position s and returns exactly when scrolling back.
- **DP-39 — Reduced motion end states** With reduced motion every published motion happens at once without movement or fade, the plate stays at 0, and end states, focus, announcements and addresses match the motion version.
- **DP-40 — Keyboard-only enquiry** A brand lead goes through the site with only the keyboard, from the skip link through the menu, a service, the filter and a case study, to one sent enquiry after pressing Enter twice on `Send enquiry`.
- **DP-41 — Tab order and skip link** The first Tab stops on `/` follow the published order at each width, and `Skip to content` is the first stop, visible while focused, and moves focus to the level-1 heading.
- **DP-42 — Focus visible and clear of the header** Every focused control shows a visible ring at least 2 px wide with 3:1 contrast, and each one outside the header and the open menu is scrolled so its top edge is at least 72 px from the viewport top.
- **DP-43 — Menu dialog by keyboard** Below 1024 px the `Menu` dialog opens with focus on `About`, keeps Tab and Shift+Tab inside, closes on Escape or `Close menu` with focus back on `Menu`, and is unreachable while closed.
- **DP-44 — Phone visit** A product manager on a 375 px phone opens the menu by tap, opens a service and a filter by tap, and swipes through a case study's showcase screens by finger.
- **DP-45 — Phone layout and tap targets** At 375x812 there is no horizontal page overflow, every control is at least 44 by 44 px, and the work, statistics, process and service lists follow the phone layout.
- **DP-46 — Showcase by finger and buttons** A sideways swipe of 60 px or more, or a showcase button, moves exactly one screen, updates the counter and `data-screen` and announces the screen.
- **DP-47 — Menu by tap** A tap on `Menu` opens the menu sliding down, and a tap on `Close menu`, on a menu link or outside the panel closes it the same way as Escape.
- **DP-48 — Procedural plates** Every cover, hero, showcase screen, portrait and intro plate is a deliberate composition drawn from the project's hue and motif, distinct per project and the same on the tile and in the hero.
- **DP-49 — Sending a commission brief** A brand lead fills the enquiry form, corrects the published validation messages, sends it and sees the thank-you panel with the reference and stored values, while the mail server receives both messages.
- **DP-50 — Enquiry checks** Sending the form with failed checks sends nothing and shows the error box, links, messages and `aria-invalid` exactly as published, and the server rejects the same values with 422.
- **DP-51 — One enquiry per submission** Pressing `Send enquiry` any number of times while pending, or sending again after a failure, creates one enquiry, one reference and one pair of messages.
- **DP-52 — Studio copy and acknowledgement** Each sent enquiry reaches the mail server as a studio copy and then an acknowledgement with the published recipients, subjects and text carrying the stored values character for character.
- **DP-53 — Saved without mail and not saved** With the mail server unreachable the enquiry is kept with mail `not_sent` and the panel shows the delay alert, and when the request itself fails the form keeps its values and shows the not-saved alert.
- **DP-54 — Three-viewport review** A reviewer looks at `/`, a case study and `/privacy` at 1280x800, 768x1024 and 375x812, finds the published layout at each, and downloads a brief PDF from a sent enquiry.
- **DP-55 — Brief PDF** The brief address answers a one-page PDF rendered from the stored enquiry with the published file name and text, and an unknown token answers 404.
- **DP-56 — Brief outage and health** With Gotenberg unreachable the brief address answers the published 503 page while enquiries still send, and `/api/health` reports `ok` or `unavailable` with status 200.
- **DP-57 — Page structure and accessibility** Every page has `lang="en"`, one `main`, one level-1 heading, its published title and no automated accessibility violations, and the server keeps the published boundary.
- **DP-58 — Source integrity** The source reads every credential and service address from the environment, sends each enquiry and renders each brief through the real services, and draws every plate from project data.

## Frontend

### Screens and layout (DP-02, DP-05, DP-12, DP-24, DP-27, DP-45, DP-54, DP-57)

Addresses and document titles:

| Address | Page | Document title |
|---|---|---|
| `/` | home: sections `intro`, `about`, `services`, `work`, `philosophy`, `contact`, then the footer | `Sollis Studio \| Independent designer` |
| `/work/<slug>` | one case study | `<project title> \| Sollis Studio` |
| `/privacy` | privacy | `Privacy \| Sollis Studio` |
| `/briefs/<token>.pdf` | the brief PDF of one enquiry (Services) | none |
| anything else | not found, HTTP 404 | `Not found \| Sollis Studio` |

(The titles use a plain vertical bar with one space on each side; it is escaped above only for the table.)

- Every page has `<html lang="en">`, exactly one `main` landmark and exactly one level-1 heading.
- The sections of `/` appear in the order above. Each is a `region` named by its heading and carries `id="<section id>"`. The section headings are level 2, except in `intro`, which holds the page's level-1 heading.
- `/` accepts three query parameters: `category` (the work filter), `service` (the open service) and `type` (a pre-chosen project type in the form). Each control replaces only its own parameter, without adding a history entry, and keeps the other parameters and the hash. An unknown value for any of them is ignored, as if the parameter were absent.
- **Header** (`banner`): fixed to the top edge and 64 px tall at every width. It holds the home link. At widths of 1024 px and more it also holds navigation `Main` with five section links. Below 1024 px it holds the `Menu` button instead.
- **Intro** (`intro`, full viewport height): the three-line heading, the intro line, the two intro links, and the intro plate. The plate is an SVG composition carrying `data-parallax` and is hidden from screen readers.
- **About** (`about`): the heading, two paragraphs, the portrait plate, the level-3 heading `Background` with its three-item list, then the statistics.
- **Services** (`services`): the heading, the intro line, then the three services. Each service is a level-3 heading containing a button, followed by its panel.
- **Work** (`work`): the heading, the filter, then the gallery. The gallery is list `Projects`, with one item per shown project carrying `data-project="<slug>"` and `data-category="<category id>"`. Each item holds:
  - one link whose accessible name is exactly the project title;
  - the cover plate (`data-cover`, hidden from screen readers) on a fixed 4:5 frame;
  - the title, the client, the category name and the year;
  - the caption `View case study`, hidden from screen readers.

  The link goes to `/work/<slug>`, or to `/work/<slug>?category=<id>` while a category is chosen. The gallery has three columns at widths of 1024 px and more, two columns from 600 px to 1023 px, and one column below 600 px.
- **Philosophy** (`philosophy`): the heading; the level-3 heading `Principles` with an ordered list of three principles, each a level-4 heading and a paragraph; the level-3 heading `Process` with the process tabs.
- **Contact** (`contact`): the heading, the intro line, a description list of contact details, then the enquiry form. After a successful send, the form is replaced by the thank-you panel.
- **Statistics panel**: shows the note, a bar of parts (one segment per part, in order, each carrying `data-part="<part label>"`), and under the bar each part as the text `<part label>: <part value>`.
- **Numbers in statistics**: statistic values and part values are written as whole numbers. From 1,000 up they take a comma as the thousands separator, and below 1,000 they have no separator. This applies in tab names, in the visible number (including every number shown while counting) and in part texts. For example, a value of 12345 reads `12,345` and its tab is named `12,345 projects delivered`.
- **Service panel**, when open, shows in order:
  - the summary;
  - level-4 heading `Capabilities` with a list;
  - level-4 heading `Deliverables` with a list;
  - the line `Typical engagement: <weeks>`;
  - link `See <service name> work`, to `/?category=<id>#work`;
  - link `Start a <service name> project`, to `/?type=<id>#contact`.

  At widths of 768 px and more, Capabilities and Deliverables sit side by side with their tops in the same row. Below 768 px they are stacked.
- **Process panel**: shows `Step <k> of 4`, the step name as a level-4 heading, the weeks and the step text.
- **Case study** (`/work/<slug>`), in order:
  - the eyebrow `<category name> · <year>`;
  - the level-1 heading with the project title;
  - the standfirst;
  - the hero `[data-hero]`: the project's cover plate at full content width in a 16:9 frame, with role `img` and accessible name `<title> cover`;
  - six sections with level-2 headings, exactly `Overview`, `Objectives`, `Visual system`, `Showcase`, `Process`, `Results`;
  - navigation `More work`.

  Section contents:
  - **Overview**: a description list with `Client`, `Year`, `Service` (the category name), `Role` and `Duration`, followed by the overview paragraph.
  - **Objectives**: an ordered list of the objectives.
  - **Visual system**: a list with one swatch per palette colour. Each swatch is a block filled with that colour, the colour's name, and its hex code as text.
  - **Showcase**: region `Showcase` holding one screen plate per screen in one sideways row, one screen per view at every width. Each screen is a figure with its caption. The region also holds the two showcase buttons and the counter `<k> / <n>`, and carries `data-screen="<k>"`, where k counts from 1.
  - **Process**: a list of four items, `Discover · <w> weeks`, `Define · <w> weeks`, `Design · <w> weeks` and `Deliver · <w> weeks`, taken in order from the project's `process` weeks. When w is 1 the item reads `1 week`.
  - **Results**: a list of the results, each showing its value in large type and its label.

  Navigation `On this page` holds six links, one per section. At widths of 1024 px and more it is a column fixed beside the content on the left. Below 1024 px it is a row above the sections.
- **Privacy** (`/privacy`): the level-1 heading, three paragraphs and the back link, all from Seed data.
- **Not found**: the heading and link from Feedback states.
- **Footer** (`contentinfo`, on every page): the two footer texts, navigation `Footer`, navigation `Social`, the studio email link and the copyright line. The copy is in Seed data.
- **Layouts by viewport:**
  - **1280x800:** header links shown; the intro heading on the left with the plate to its right; the About text beside the portrait; the four statistics tabs in one row; services full width, with an open panel's lists side by side; work in three columns; contact details and the form side by side, with their tops within 4 px of each other; on a case study, `On this page` fixed beside the content; footer links in one row.
  - **768x1024:** `Menu` instead of the header links; statistics tabs in two rows of two; work in two columns; contact details above the form; `On this page` as a row above the sections; an open panel's lists side by side.
  - **375x812:** work in one column; statistics tabs in two rows of two; process tabs in two rows of two; an open panel's lists stacked; the showcase showing one screen per view.
- No page overflows sideways at 375, 768 or 1280 px wide. Sideways rows such as the showcase scroll inside their own box.

### Public screens and controls (DP-02, DP-08, DP-11, DP-22, DP-27, DP-41, DP-43, DP-46, DP-50)

Only these roles and names are public; everything else is up to you.

| Role and accessible name | Where | Visible copy or notes |
|---|---|---|
| link `Skip to content` | every page, first Tab stop | visible only while focused |
| `banner` | every page | the fixed header |
| link `Sollis Studio home` | header | to `/` |
| navigation `Main` | header, 1024 px and wider | links `About` (`/#about`), `Services` (`/#services`), `Work` (`/#work`), `Philosophy` (`/#philosophy`), `Contact` (`/#contact`) |
| button `Menu` | header, below 1024 px | opens dialog `Menu` |
| dialog `Menu` (modal) | below 1024 px | holds button `Close menu` and navigation `Menu sections` with the same five links |
| `region` per section | `/` | named by the section heading |
| link `Start a project` | intro | jumps to `contact` |
| link `See selected work` | intro | jumps to `work` |
| img `Portrait of Maren Sollis, drawn` | About | the portrait plate |
| tablist `Statistics` | About | one tab per statistic, named `<value> <label>`; the visible number carries `data-count` and is hidden from screen readers |
| tabpanel of the selected statistic | About | note, bar of parts, part texts |
| button `Brand Identity`, button `Website Design`, button `Digital Product Design` | Services | each inside a level-3 heading, with `aria-expanded`; any number or chevron beside the name is hidden from screen readers |
| link `See <service name> work`, link `Start a <service name> project` | open service panel | targets in Screens and layout |
| radiogroup `Filter work by service` | Work | radios `All (<n>)`, `Brand Identity (<n>)`, `Website Design (<n>)`, `Digital Product Design (<n>)` |
| list `Projects` | Work | one item per shown project, each with a link named by the project title |
| tablist `Process` | Philosophy | tabs `Discover`, `Define`, `Design`, `Deliver` |
| form `Project enquiry` | Contact | the fields below, in order |
| textbox `Name` | form | |
| textbox `Email` | form | an email field |
| radiogroup `Project type` | form | radios `Brand Identity` (`brand-identity`), `Website Design` (`website-design`), `Digital Product Design` (`digital-product-design`), `Not sure yet` (`not-sure`) |
| combobox `Budget range` | form | options `Choose a budget range` (empty value), `Under €10,000` (`under-10k`), `€10,000 to €25,000` (`10k-25k`), `€25,000 to €50,000` (`25k-50k`), `Over €50,000` (`over-50k`) |
| textbox `Project description` | form | a text area; its description includes the counter `<n> of 2,000 characters` |
| button `Send enquiry` | form | |
| error box headed `There is a problem with your enquiry` | above the form | one link per failed field |
| `alert` | above the form or the panel | the enquiry alerts in Feedback states |
| link `Download your brief (PDF)` | thank-you panel | to the brief address |
| button `Send another enquiry` | thank-you panel | |
| `status` `Site updates` | every page | polite and visually hidden |
| img `<title> cover` | case study | the hero `[data-hero]` |
| navigation `On this page` | case study | links `Overview`, `Objectives`, `Visual system`, `Showcase`, `Process`, `Results` |
| region `Showcase` | case study | buttons `Previous screen` and `Next screen`, the counter |
| navigation `More work` | case study | link `Previous project: <title>`, link `Next project: <title>`, link `All work` |
| `contentinfo` | every page | the footer |
| navigation `Footer` | footer | links `About`, `Services`, `Work`, `Philosophy`, `Contact` (to the sections of `/`) and `Privacy` (to `/privacy`) |
| navigation `Social` | footer | links `Instagram (opens in a new tab)` (`https://instagram.example/sollis.studio`), `LinkedIn (opens in a new tab)` (`https://linkedin.example/in/maren-sollis`), `Behance (opens in a new tab)` (`https://behance.example/sollis`), each opening in a new tab with `rel="noopener noreferrer"` |
| link `studio@sollis.example` | footer and Contact | `mailto:studio@sollis.example` |
| link `+44 20 7946 0321` | Contact | `tel:+442079460321` |

### Interactions (DP-03, DP-04, DP-08, DP-10, DP-11, DP-14, DP-15, DP-16, DP-18, DP-22, DP-23, DP-24, DP-26, DP-28, DP-31, DP-32, DP-33, DP-40, DP-41, DP-42, DP-43, DP-46, DP-47)

**Skip link and focus**
- On every page the first Tab stop is `Skip to content`. Activating it moves focus to the page's level-1 heading.
- Headings that receive focus are focusable by script only and are never Tab stops.
- Focus is never hidden. This rule covers every element outside the fixed header and outside the open `Menu` dialog. Whenever such an element receives focus (by Tab, Shift+Tab, a link, a jump or a script), the page scrolls as needed so the element's top edge is at least 72 px from the viewport top. That is the 64 px header plus 8 px of clear space. When the element fits, its bottom edge is also inside the viewport.
- Three kinds of control are not scrolled. These are the header's own controls, `Skip to content` (shown over the top of the page while focused) and the controls inside the open `Menu` dialog. Each of them is always fully inside the viewport and never covered by another element.
- Every focusable control shows a focus ring: an outline at least 2 px wide, in a colour with at least 3:1 contrast against what surrounds it. The ring is absent when the control is not focused.

**Tab order**
- On `/` at 1280x800, after a fresh load with no hash and no query, the first 22 Tab stops are exactly: `Skip to content`, `Sollis Studio home`, `About`, `Services`, `Work`, `Philosophy`, `Contact`, `Start a project`, `See selected work`, `12 years of practice`, `Brand Identity`, `Website Design`, `Digital Product Design`, `All (9)`, `Harbour Loom`, `Northlight Gallery`, `Ledgerline`, `Quarry Press`, `Fieldwork Journal`, `Pathway`, `Tidewater Co-op`, `Ostler Hotels`.
- At 768x1024 and 375x812 the first five stops are `Skip to content`, `Sollis Studio home`, `Menu`, `Start a project`, `See selected work`.

**Section jumps**
- A section jump happens when the visitor follows a header, menu, footer or intro link to `/#<id>` while on `/`, or opens `/#<id>` on load.
- The section's heading ends up at least 16 px below the header's bottom edge and receives focus.
- A jump by link arrives within one second. With reduced motion, and on load, it is instant.
- `Start a project` in the intro jumps to `contact`; `See selected work` jumps to `work`.

**Current section**
- On `/`, the current section is the one whose box contains the point 40% of the way down the viewport.
- Its link in `Main`, and in the menu when open, carries `aria-current="true"`. No other link carries it.
- No link is current while that point is in `intro`.
- The current link updates while scrolling, in both directions.

**Menu** (below 1024 px)
- Enter, Space, a click or a tap on `Menu` opens dialog `Menu` and puts focus on its link `About`.
- Tab and Shift+Tab wrap inside the dialog.
- Escape, `Close menu`, or a tap outside the menu panel closes it and returns focus to `Menu`.
- Choosing a link closes the menu and makes that section jump.
- While the menu is closed, none of its links or buttons can be reached by Tab or by a screen reader.

**Statistics tabs**
- The first tab is selected at load.
- ArrowRight and ArrowLeft select the next and previous tab at once, wrapping. Home and End select the first and last.
- The tab list is one Tab stop, at the selected tab. Tab from the selected tab moves past the tab list; the panel is not a Tab stop.
- Choosing a tab announces nothing.

**Services**
- At load every service is collapsed (`aria-expanded="false"`). The exception is an address with `service=<id>`: then that service is open and its button has focus, scrolled clear of the header.
- Nothing inside a collapsed panel can be reached by Tab or by a screen reader.
- Enter or Space on a service button, a click or a tap toggles that service.
- At most one service is open at a time: opening one closes the one that was open.
- Opening a service sets the parameter `service=<id>`. Closing the open service removes the parameter.
- ArrowDown and ArrowUp move focus to the next and previous service button, wrapping. Home and End move focus to the first and last. These keys only move focus; they never open or close a service.
- Following `See <service name> work` on `/` checks that category in the filter, sets `category`, jumps to `work` with focus on `Selected work`, and makes the filter announcement.
- Following `Start a <service name> project` on `/` checks that project type in the form, sets `type=<id>`, jumps to `contact`, and puts focus on the `Name` field, clear of the header. The link is followed from the open panel. On arrival that service is still open and the `service` parameter is still in the address.

**Work filter**
- The radio group is one Tab stop, at the checked radio.
- ArrowRight and ArrowDown check the next radio; ArrowLeft and ArrowUp check the previous one, wrapping. A click or tap checks a radio.
- Choosing a category shows only that category's projects, in published order, and sets `category=<id>`. Choosing `All` removes the parameter.
- Opening `/?category=<id>`, with or without `#work`, shows that category checked and announces nothing.
- Hidden projects cannot be reached by Tab or by a screen reader.
- Each change of the checked radio makes one filter announcement (Feedback states).

**Process tabs**
- `Discover` is selected at load.
- ArrowRight and ArrowLeft select the next and previous tab at once, wrapping. Home and End select the first and last.
- The panel is not a Tab stop. Choosing a step announces nothing.

**Case study: On this page**
- Each link makes a section jump to its section, with focus on that section's heading, following the section-jump rules above.
- The link of the section containing the point 40% down the viewport carries `aria-current="true"`. No link is current before `Overview` reaches that point.

**Showcase**
- `Previous screen` and `Next screen` each move one screen. Each button is natively disabled on the first and last screen respectively.
- A finger swipe of 60 px or more sideways moves exactly one screen, never more, in the direction of the swipe. A shorter swipe returns to the current screen.
- Each change of screen updates the counter and `data-screen`, and makes the showcase announcement.

**Project sequence**
- The sequence is every project in published order. When the address has `category=<id>`, it is only that category's projects, in published order.
- Navigation `More work` holds:
  - `Previous project: <title of the one before>`, absent on the first project;
  - `Next project: <title of the one after>`, absent on the last project;
  - `All work`, to `/#work`, or to `/?category=<id>#work` when a category is set.
- The previous and next addresses keep the `category` parameter.
- ArrowLeft and ArrowRight do the same as the previous and next links when those links are present. They do this only while focus is not in a text field, a select, a radio group or a tab list.

**Cover Carry**
- Following a work item's link from `/`, or following `Previous project` or `Next project`, keeps the same document loaded: a script value set on the page before the navigation is still there afterwards.
- It adds one history entry with the new address, changes the document title, and puts focus on the level-1 heading, with the motion in Motion and effects.
- Every case study shown this way adds one history entry. After opening a project from `/` and then following `Previous project` or `Next project` k times, k + 1 presses of the browser's Back button return to `/`. Each Back press before that shows the case study before it, with focus on its heading.
- Arriving back on `/` shows the gallery with the same filter checked. The item scrolled fully into view, clear of the header, belongs to the project whose case study was just left, which is the project first opened from the gallery. The cover moves back into that item and focus lands on the item's link.
- Opening any `/work/<slug>` address directly also works, as a full page load.

**Enquiry form**
- Before any send, the only thing that changes while typing in `Project description` is the counter. The field never stops input beyond 2,000 characters.
- Sending runs the checks in Feedback states.
- When the error box appears it receives focus. Following one of its links puts focus on that field; for `Project type`, focus goes to the first radio.
- `Send another enquiry` brings back an empty form with a new submission id and puts focus on `Name`.

**Touch**
- A tap works on every control the same way a click does.

### Visual design (DP-05, DP-45, DP-48, DP-57)

**Colour**
- The page ground is a warm off-white, like uncoated paper.
- Text is a warm near-black ink.
- A deep green-teal marks links, focus rings, the checked filter radio, selected tabs and the `Send enquiry` button.
- Hairline rules, 1 px wide, in a soft warm grey-beige separate sections and list rows.
- Secondary text such as clients, years, notes and counters is a muted warm grey.
- Nothing has a drop shadow. Surfaces are told apart only by rules and spacing.
- All text meets WCAG 2.2 AA contrast on every page.

**Type**
- Headlines use the display serif Instrument Serif. They are oversized and set to a ragged right edge with a short measure, so lines break unevenly the way a printed editorial page does.
- Body text uses Instrument Sans.
- **Font files.** Take the files from the npm packages `@fontsource/instrument-serif` and `@fontsource/instrument-sans`. Both are under the SIL Open Font Licence and are installed by the manifest's `install` command like any other dependency. The app serves the files itself.
- Each heading level is about one third larger than the level below it. The intro heading is the largest thing on the page.
- Every statistic, project index number, year and counter uses equal-width figures, so columns of numbers line up.

**Density and composition**
- The layout is airy, with generous space between sections.
- It sits on a twelve-column editorial grid. Project titles in the gallery and on case studies hang into the left margin, outside the text column.

**Plates**
- Every picture is drawn by the app with SVG and CSS shapes. This covers the intro plate, the portrait, project covers, showcase screens and swatches.
- A project's plate is a composition built from its `hue` and `motif`:
  - `arcs`: concentric or overlapping arcs;
  - `grid`: a ruled grid with some cells filled;
  - `stack`: horizontal bands stacked at different heights.
- Tones are light and dark versions of the project's hue.
- The same project always gets the same plate, on its tile and in its hero.

**Size**
- Every link, button, radio (including its whole label), tab, select and field is at least 44 by 44 px at 375x812.

### Motion and effects (DP-07, DP-13, DP-26, DP-34, DP-36, DP-37, DP-38, DP-39, DP-46, DP-47)

The site has only these motions; there is no other animation, transition or loop. Every timed motion except the count and the plate (items 1, 2, 5 to 11 and 13) is a stylesheet animation, a stylesheet transition, or a browser-native animation started from script. The count follows the page clock and the plate follows the scroll position. Nothing the visitor needs waits on a browser timer: no carousel advances on its own, and no content stays hidden until a timer fires. Announcements, focus moves and state changes happen as part of the action that causes them. Scroll-triggered reveals and the statistics count are the only motion started by scrolling.

1. **Intro heading.** Each of the three lines rises from one line height below into place, inside its own clipping box. Each line's rise lasts 600 to 800 ms, and each line starts 100 to 140 ms after the one before. Every line is in place within 1.6 seconds of the page opening.
2. **Section headings** (the level-2 headings in `about` to `contact`). The first time a heading's top edge is above 85% of the viewport height, it rises from 32 px below and fades in, over 500 to 700 ms. This happens once per page load.
3. **Statistics count.** The first time the tab list's top edge is above 85% of the viewport height, every visible number counts from 0 to its value over 1,200 ms. At t ms after the count starts, the number shown is round(value × (1 − (1 − t/1200)³)), rounded half up. From 1,200 ms on, it shows the value. A reading at t may come from up to one frame (17 ms) either side. For example, with the seed data at start, 140 shows 81 at 300 ms, 123 at 600 ms, 138 at 900 ms and 140 at 1,200 ms. The count runs once per page load.
4. **Intro plate.** Its position depends on scroll position only. At window scroll position s, it is moved down by round(0.25 × min(s, 800)) px, rounded half up, measured as the vertical translation the browser reports in the plate's computed style. That is 0 px at 0, 100 px at 400, and 200 px at 800 and beyond. It returns to exactly the same positions when scrolling back up.
5. **Service panels.** They open and close by changing height over 280 to 360 ms. The chevron beside the name turns half a turn over the same time.
6. **Work items, on hover and on keyboard focus alike.** The cover scales from 1 to 1.04 over 300 to 400 ms. The caption `View case study` rises 8 px and fades in over 200 to 300 ms. Leaving or blurring reverses both over the same times.
7. **Cover reveal.** The first time a work item's top edge is above 90% of the viewport height, its cover is revealed from the bottom edge upward over 600 to 800 ms. This happens once per page load.
8. **Filter.** After a filter change, the shown items fade in from transparent to fully opaque over 200 to 300 ms.
9. **Cover Carry** (opening a case study from a work item). The case study's `[data-hero]` starts in the work item cover's box, within 2 px, and moves to its own final box over 440 to 520 ms. It uses a strong ease-out: it covers most of the distance early and settles softly at the end. When the move ends, the eyebrow, the level-1 heading and the standfirst each rise 24 px and fade in, over 160 to 200 ms each, with each one starting 50 to 70 ms after the one before. Going back moves the item's `[data-cover]` from the hero's box to its own box over 440 to 520 ms, with the same easing.
10. **Previous and next project.** The old hero slides 40 px toward the side it leaves while fading out, and the new hero slides in from 40 px on the other side while fading in, over 320 to 400 ms. On `Next` the old hero leaves to the left and the new one enters from the right; `Previous` is the reverse. The three title lines then rise as in item 9. On a direct page load of a case study, the title lines rise as in item 9 with no hero move.
11. **Process.** The new panel's content slides in from 16 px to the right and fades in over 240 to 320 ms.
12. **Showcase.** The row scrolls by one screen and arrives within 600 ms.
13. **Menu dialog.** It slides down from the top edge over 200 to 350 ms when opening, and up over 200 to 350 ms when closing.
14. **Section jumps by link.** They arrive within one second.
15. **Hover and focus colour changes.** They complete within 150 ms.

**Reduced motion.** When the visitor prefers reduced motion, every item above happens at once, with no movement and no fade:
- the count shows the final values;
- the plate does not move at any scroll position;
- the cover appears in its final place at once and the title lines appear without moving;
- section jumps are instant.

End states, focus, announcements, history entries and addresses are exactly the same as with motion.

### Feedback states (DP-19, DP-22, DP-29, DP-46, DP-49, DP-50, DP-51, DP-53, DP-56)

**Status region**

Every page has one polite `status` region named `Site updates`. It is visually hidden, and each announcement replaces its text; it never appends. Each announcement is made once per change. The only things that announce are the filter, the showcase and the enquiry states. Scrolling, opening a service, choosing a statistic or a process step, and moving between case studies announce nothing.

**Filter** (on each change of the checked radio)
- `All`: `Showing <n> projects.`
- A category with two or more projects: `Showing <n> projects in <category name>.`
- A category with one project: `Showing 1 project in <category name>.`
- A category with no projects: `No projects in <category name> yet.` The same sentence also shows in place of the list.
- `<n>` is the number of projects shown, and `<category name>` is the service name.

**Showcase**
- Each change of screen announces `Screen <k> of <n>: <caption>.`

**Enquiry checks**

Checks run only when the form is sent. They run on values with leading and trailing white space removed, in field order. Lengths are counted in Unicode characters, and both limits of each range are allowed.

| Field | Fails when | Message |
|---|---|---|
| Name | empty | `Enter your name.` |
| Name | shorter than 2 or longer than 80 characters | `Name must be 2 to 80 characters.` |
| Email | empty | `Enter your email address.` |
| Email | longer than 254 characters, or not of the form text, `@`, text, `.`, text, with no white space (at least one character before the `@`, and after it a dot with at least one character on each side) | `Enter an email address like name@company.com.` |
| Project type | none chosen | `Choose a project type.` |
| Budget range | none chosen | `Choose a budget range.` |
| Description | empty | `Describe your project.` |
| Description | shorter than 40 or longer than 2,000 characters | `Description must be 40 to 2,000 characters.` |

When any check fails:
- nothing is sent and the status announces nothing;
- the error box appears above the form, headed `There is a problem with your enquiry`, with a list of links, one per failed field in field order, each named exactly as that field's message;
- each failed field has `aria-invalid="true"` and shows its message under it as part of its description;
- fields that pass have no `aria-invalid` and no message.

The description counter reads `<n> of 2,000 characters`. Here `<n>` is the number of characters as typed, written with a comma as the thousands separator. It updates on every input and is never announced.

**Enquiry sending**

While the enquiry is being sent:
- `Send enquiry` has `aria-disabled="true"` and further presses send nothing;
- the status says `Sending your enquiry.`

**Sent**

The API answered with mail `sent`. The form is replaced by the thank-you panel:
- level-3 heading `Thank you, <first name>.`, which receives focus;
- the line `Your enquiry <reference> is with Maren. She will reply within two working days.`;
- description list `Your enquiry`, with `Reference`, `Name`, `Email`, `Project type` (the option's name), `Budget range` (the option's name) and `Project description` (line breaks kept), each exactly as stored;
- link `Download your brief (PDF)`;
- button `Send another enquiry`.

The status says `Enquiry <reference> sent.`

**Saved without mail**

The API answered with mail `not_sent`. The same panel appears, plus an `alert` above the line, saying `Your enquiry <reference> is saved, but we could not send the confirmation email. Maren will still reply within two working days.` The status says `Enquiry <reference> saved.`

**Not saved**

The request fails, the connection drops, or the server answers 503 or any other error. There is no panel. An `alert` above the form says `We could not send your enquiry. Please try again, or email studio@sollis.example.` Every entered value stays and `Send enquiry` is usable again. The status text is emptied. Sending again reuses the same submission id.

**Placeholders**

`<first name>` is the stored name up to its first space, or the whole name when it has no space. `<reference>` is the enquiry reference from Business rules.

**Not-found pages** (HTTP 404, title `Not found | Sollis Studio`)
- `/work/<unknown slug>`: heading `This project does not exist.` and link `All work`, to `/#work`.
- Any other unknown page: heading `This page does not exist.` and link `Back to Sollis Studio`, to `/`.

**Brief unavailable** (HTTP 503 HTML page, title `Brief unavailable | Sollis Studio`)
- Heading `Your brief PDF is not available right now.`
- Line `Your enquiry <reference> is saved. Try the download again in a few minutes.`

## Backend

### API (DP-20, DP-50, DP-51, DP-53, DP-56)

All API bodies are JSON (`application/json; charset=utf-8`). A request body larger than 262,144 bytes is rejected; exactly 262,144 bytes is allowed.

**Error order for the whole API.** Each check is applied in this order, and the first one that fails decides the answer:
1. unknown route: 404 `{"error":"not_found","message":"Not found."}`
2. wrong method: 405 `{"error":"method_not_allowed","message":"Method not allowed."}`
3. missing or wrong grading key, on grading routes only: the same 404 as an unknown route, so the route looks absent
4. body over the size limit: 413 `{"error":"too_large","message":"The request body is too large."}`
5. body that is not JSON: 400 `{"error":"bad_request","message":"The request body must be JSON."}`
6. replay of a stored `submission_id`: answered with its stored response, before any field check
7. shape or field checks: 422

Endpoint rows below name only their own extra answers.

| Method and path | Request | Success | Other answers |
|---|---|---|---|
| `POST /api/enquiries` | `{"submission_id", "name", "email", "project_type", "budget", "description"}`; `submission_id` is a UUID | 201 `{"reference":"SOL-0001","brief_url":"/briefs/<token>.pdf","mail":"sent"}` or the same with `"mail":"not_sent"`; a replay answers 200 with the first answer's body | 422 `{"error":"invalid","fields":{"<field>":"<message>"}}`; 503 `{"error":"unavailable","message":"The enquiry could not be saved."}` when the database cannot store it |
| `PUT /api/grading/content` | header `X-Grading-Key`; body `{"projects":[...],"stats":[...]}` | 200 `{"edition":<n>}` | 422 `{"error":"invalid","message":"The content does not match the published shape."}` |
| `DELETE /api/grading/content` | header `X-Grading-Key` | 200 `{"edition":1}` | none |
| `GET /api/grading/enquiries` | header `X-Grading-Key` | 200 `{"enquiries":[{"reference","name","email","project_type","budget","description","mail"}]}` in the order stored | none |
| `GET /api/health` | none | 200 `{"status":"ok"}` or 200 `{"status":"unavailable"}` | never 503 |

**`POST /api/enquiries`**
- The 422 `fields` object names exactly the failed fields, using the keys `name`, `email`, `project_type`, `budget` and `description` and the messages from Feedback states.
- A missing, non-text or unknown `project_type` or `budget` counts as none chosen.
- A missing or non-UUID `submission_id` fails with field `submission_id` and message `Reload the page and try again.`
- Values are stored with leading and trailing white space removed and nothing else changed.

**Grading routes**
- The `X-Grading-Key` header must equal env `GRADING_KEY`. When `GRADING_KEY` is unset, the grading routes are absent.
- `GET /api/grading/enquiries` returns values as stored, with the ids for `project_type` and `budget`. `mail` is `sent` or `not_sent`.

**Content shape for `PUT /api/grading/content`.** Any break of these rules answers 422.
- **Project objects** have exactly the keys `slug`, `title`, `client`, `category`, `year`, `hue`, `motif`, `role`, `duration`, `standfirst`, `overview`, `objectives` (strings), `palette` (objects `{"name","hex"}`), `screens` (objects `{"caption"}`), `process` (four numbers) and `results` (objects `{"value","label"}`).
- **Statistic objects** have exactly the keys `id`, `value`, `label`, `note` and `parts` (objects `{"label","value"}`).
- A missing or extra key breaks the shape.
- Each rule below includes both of its limits:
  - 1 to 24 projects;
  - slugs unique, 2 to 40 characters of lowercase letters, digits and hyphens, starting with a letter;
  - `category` one of `brand-identity`, `website-design`, `digital-product-design`;
  - `year` a whole number from 2000 to 2026;
  - `hue` a whole number from 0 to 359;
  - `motif` one of `arcs`, `grid`, `stack`;
  - 1 to 5 objectives;
  - 1 to 5 palette colours, each `hex` written as `#` followed by six hex digits;
  - 1 to 6 screens;
  - `process` exactly four whole numbers, each from 1 to 12;
  - 1 to 4 results;
  - 1 to 4 statistics with unique ids;
  - statistic `value` a whole number from 1 to 99,999, with 2 to 4 parts whose whole-number values add up to the value;
  - every text field 1 to 1,200 characters.

**`GET /api/health`** answers `ok` when Postgres, the mail server and Gotenberg all answer, and `unavailable` when any of them does not.

**Pages and brief.** `GET /briefs/<token>.pdf` and the pages are described in Services and Screens and layout. Other routes your pages use internally are yours to define, outside `/api/grading`.

### Business rules (DP-19, DP-20, DP-22, DP-31, DP-51, DP-52, DP-53)

**Derived counts**
- Each filter radio's `<n>` is the number of projects in that category; for `All` it is all projects.
- Counts, the gallery, sequences and case studies are worked out from the stored projects on every full page load.
- For example, with the seed data at start, the radios read `All (9)`, `Brand Identity (3)`, `Website Design (3)` and `Digital Product Design (3)`.

**Content edition**
- The edition starts at 1.
- Each accepted `PUT` replaces all projects and statistics, keeping the order given, and adds one to the edition.
- `DELETE` restores the starting content of Seed data and edition 1, deletes every enquiry, and restarts references at `SOL-0001`.
- A content change shows on the next full page load in any browser. Tests never change content under an open page.

**References**
- A reference is `SOL-` followed by four digits.
- `SOL-0001` goes to the first enquiry stored after the starting content, and each further stored enquiry gets the next number.
- A number is used only when an enquiry is actually stored. A refused or failed request uses no number, and a replay keeps its first reference.
- When different submissions arrive at the same time, each gets its own consecutive reference.

**One enquiry per submission**
- The page creates a new submission id for every form it shows, including after `Send another enquiry`, and reuses it whenever that form is sent again.
- The server stores at most one enquiry per submission id. A later request with the same id, whatever its other fields hold, answers 200 with the first answer's body and sends no message.
- When two requests with the same submission id arrive at the same time, the first to be stored wins and answers 201. The other waits for it and answers 200 with the same body.
- A submission id whose first request failed before the enquiry was stored leaves nothing behind, so sending it again is treated as new.

**All or nothing**
- An enquiry is either stored, with its reference and brief token, or refused with an error. Nothing is half-stored.
- Messages are sent only after the enquiry is stored.
- A stored enquiry is never removed because mail failed.

**Mail outcome**
- The studio copy goes first, then the acknowledgement.
- The enquiry's `mail` is `sent`, and the API answers with `sent`, only after the mail server has accepted both messages.
- When the mail server refuses either message, or does not answer within 5 seconds, the enquiry stays stored with `mail` set to `not_sent` and the API answers `not_sent`.
- No message is ever re-sent automatically.

**Brief token**
- The token is 32 lowercase hexadecimal characters, chosen at random when the enquiry is stored.

### Services (DP-52, DP-53, DP-55, DP-56, DP-58)

**Postgres**
- Stores the projects with their case-study content in published order, the statistics in published order, the content edition, and every enquiry with these fields: reference, submission id, brief token, name, email, project type id, budget id, description, mail outcome, and the time it was stored.
- The services, principles and process steps are fixed copy from Seed data and are not stored.
- Create the schema idempotently every time the server starts. When the database is empty at start, store the starting content.

**Mailpit (SMTP)**
- Each enquiry sends two plain-text, UTF-8 messages, with From set to env `MAIL_FROM`.
- **Studio copy:**
  - To: env `STUDIO_EMAIL`
  - Reply-To: the visitor's email
  - Subject: `New enquiry <reference> · <project type name> · <budget name>`
  - The text starts directly with the field lines below.
- **Acknowledgement:**
  - To: the visitor's email
  - Subject: `Your enquiry <reference> to Sollis Studio`
  - The text starts with `Hello <first name>,`, a blank line, `Thank you for your enquiry. Maren will reply within two working days.`, and a blank line.
- **Both texts then hold these lines exactly:**
  - `Reference: <reference>`
  - `Name: <name>`
  - `Email: <email>`
  - `Project type: <project type name>`
  - `Budget range: <budget name>`
  - a blank line
  - `Project description:`
  - the description as stored, character for character, with its line breaks
- Project type and budget names are the option names from Public screens and controls.
- When the mail server is down, the outcome follows Business rules and the saved-without-mail state in Feedback states. With the server unreachable, no message reaches it.

**Gotenberg**
- On every `GET /briefs/<token>.pdf`, the server renders the brief from the stored enquiry by sending HTML to Gotenberg's Chromium HTML conversion, and answers 200 `application/pdf` with `Content-Disposition: attachment; filename="<reference>-brief.pdf"`.
- The PDF is exactly one A4 page for any valid enquiry. Its text holds `Project brief <reference>`, `Sollis Studio`, the five field lines from `Reference:` to `Budget range:` as in the messages, `Project description:`, and the description as stored.
- **Fitting the description:**
  - The description keeps its line breaks.
  - A run of characters too long for one line is broken at any character.
  - The description's text size is reduced as far as needed for the whole description to fit on the one page. Nothing is clipped, hidden or dropped.
  - Line breaks added by this wrapping are the only difference between the description text in the PDF and the stored description.
- An unknown token answers 404 with the not-found page.
- When Gotenberg cannot be reached, answers with an error, or takes longer than 10 seconds, the brief address answers the 503 brief-unavailable page from Feedback states. Sending enquiries keeps working.

### Seed data (DP-02, DP-09, DP-12, DP-19, DP-27, DP-31)

Every person and business below is fictional, including Maren Sollis, her former employers and every client.

**Published copy of `/`**
- **Intro.** The level-1 heading has three lines, each its own element carrying `data-line` 1, 2 and 3: `Clear brands.`, `Considered websites.`, `Products people keep.` Its accessible name is the three lines joined by single spaces. The line under it reads `Maren Sollis is an independent designer working across brand identity, website design and digital product design.`
- **About.**
  - Heading: `About Maren`.
  - First paragraph: `I am Maren Sollis, an independent designer. For twelve years I have helped companies find a clear voice and give it a form, from the first mark to the last screen.`
  - Second paragraph: `I work alone on purpose: the person you brief is the person who designs, and I take on four engagements a year.`
  - `Background` list, in order: `2014 to 2017 · Designer, Hallam Pike Studio, Bristol`, `2017 to 2021 · Senior brand designer, Northgate Type Office, Rotterdam`, `2021 to now · Independent, Sollis Studio, London`.
- **Services.** Heading `Services`, then the line `Three services, one designer from the first workshop to the handover.`
- **Work.** Heading `Selected work`.
- **Philosophy.** Heading `How I work`. The principles are a level-4 heading and a paragraph each, in order:
  1. `Say one thing well.` / `Every identity, page and screen makes one clear promise before it makes a second.`
  2. `Design the system, not the sample.` / `A logo, a homepage or a screen is the first use of a system your team will keep using.`
  3. `Leave it documented.` / `Every project ends with guidelines the next designer can follow without calling me.`
- **Contact.** Heading `Start a project`, then the line `Tell me about the work. I reply to every enquiry within two working days.` The details list holds `Email` with the studio email link, `Phone` with the phone link, and `Studio` with `London, working worldwide`.
- **Footer.** The texts `Sollis Studio` and `Maren Sollis and every client named on this site are fictional.`, then the line `© 2026 Sollis Studio. All rights reserved.`
- **Privacy.** Heading `Privacy`, then three paragraphs: `This site keeps the enquiries you send: your name, email, project type, budget range and description.`, `Enquiries are used only to reply to you and are deleted after 24 months.` and `The site sets no cookies and uses no analytics.` Then link `Back to Sollis Studio`, to `/`.

**Services**, in order (id, name):
- **`brand-identity` Brand Identity**
  - Summary: `Names, marks and systems that let a company sound and look like itself everywhere.`
  - Capabilities: `Brand strategy workshops`, `Naming and verbal identity`, `Logo and wordmark design`, `Typography and colour systems`, `Brand guidelines`.
  - Deliverables: `Logo suite in SVG and PNG`, `Colour and type specification`, `Brand guidelines PDF, 40 to 60 pages`, `Stationery and social templates`.
  - Typical engagement: `6 to 10 weeks`.
- **`website-design` Website Design**
  - Summary: `Editorial, fast websites that carry a brand's voice and are easy for your team to keep up to date.`
  - Capabilities: `Site architecture and content design`, `Art direction and page design`, `Motion and interaction design`, `Accessibility review to WCAG 2.2 AA`, `Design system for the build team`.
  - Deliverables: `Sitemap and page templates`, `Desktop, tablet and phone designs`, `Interactive prototype`, `Component library with usage notes`.
  - Typical engagement: `8 to 12 weeks`.
- **`digital-product-design` Digital Product Design**
  - Summary: `Clear, testable product interfaces, from first flows to a design system your team can grow.`
  - Capabilities: `Product discovery and research`, `User flows and information architecture`, `Interface design`, `Usability testing`, `Design systems`.
  - Deliverables: `Research summary`, `User flows and wireframes`, `High-fidelity screens`, `Clickable prototype`, `Design system library`.
  - Typical engagement: `10 to 16 weeks`.

**Process steps** (weeks, then text):
- `Discover`: `Weeks 1 to 2`, `Interviews, an audit of what exists and a written brief we both sign.`
- `Define`: `Weeks 3 to 4`, `Positioning, principles and the measures we will judge the work by.`
- `Design`: `Weeks 5 to 9`, `Two directions, one chosen, then refined in weekly reviews.`
- `Deliver`: `Weeks 10 to 12`, `Final files, guidelines and a handover session with your team.`

**Statistics**, in order (id | value | label | note | parts as label: value):
- `years` | 12 | `years of practice` | `In practice since 2014: seven years in studios, five independent.` | `In studios`: 7, `Independent`: 5
- `projects` | 140 | `projects delivered` | `Across the three services since 2014.` | `Brand Identity`: 58, `Website Design`: 47, `Digital Product Design`: 35
- `identities` | 38 | `brand identities launched` | `Identities now in use, by company size.` | `Over 250 people`: 21, `250 people or fewer`: 17
- `awards` | 9 | `design awards` | `Juried awards, by discipline.` | `Type`: 4, `Web`: 3, `Product`: 2

For example, with the seed data at start, tab `140 projects delivered` has segments of 41.43%, 33.57% and 25.00%.

**Projects**, in published order. Each entry's first line gives slug | title | client | category | year | hue | motif | role | duration | process weeks. The lines under it give the standfirst, the overview, the objectives, the palette (name and six hex digits), the screen captions, and the results (value / label). Here the six hex digits of each palette colour are written without a leading hash sign; the stored and displayed hex code is a hash sign followed by those six digits.

1. `harbour-loom` | Harbour Loom | Harbour Loom Textiles | brand-identity | 2025 | 205 | arcs | Creative direction and identity design | 9 weeks | 2, 2, 3, 2
   - `A heritage weaving mill renamed and re-marked for its first range sold straight to customers.`
   - `The mill had sold cloth to other brands for ninety years under a family name nobody outside the trade knew. We chose a new name, drew a mark from the path of the loom's shuttle and built a system for labels, swing tags and the shop.`
   - `Give the mill a name customers can say and remember.`; `Make the mark work stitched, printed and on screen.`; `Hand over a system the in-house team can run alone.`
   - Harbour blue 1F3A5F; Undyed wool E9E2D0; Signal coral D9583B
   - `Swing tag and woven label`; `Shop front and window lettering`; `Online shop header`
   - `+64%` / `return visits to the shop in the first six months`; `11` / `stockists added in the first year`; `1` / `system used across tags, signs and web`
2. `northlight-gallery` | Northlight Gallery | Northlight Gallery | website-design | 2025 | 265 | grid | Website design and art direction | 12 weeks | 2, 2, 6, 2
   - `An exhibition-first website where every show gets its own page rhythm.`
   - `The gallery's old site listed shows like products. The new site gives each exhibition a long page whose type, colour and image rhythm follow the work, while visiting hours and tickets stay in the same place on every page.`
   - `Let each exhibition look like itself.`; `Keep visiting information one tap away on every page.`; `Let the curators build a show page without a developer.`
   - Gallery night 1C1A2E; Wall white F5F3EE; Northlight violet 6B5BD6
   - `Exhibition page opening`; `Visit and tickets panel`; `Archive of past shows`
   - `+41%` / `time spent on exhibition pages`; `2 hours` / `for a curator to build a show page`; `0` / `accessibility errors on the templates at launch`
3. `ledgerline` | Ledgerline | Ledgerline Ltd | digital-product-design | 2025 | 170 | grid | Product design lead | 14 weeks | 3, 2, 7, 2
   - `A calmer invoicing app for freelancers, redesigned around the first five minutes.`
   - `Most new users left before sending their first invoice. We rebuilt sign-up around one task, sending an invoice, moved every other setting to after it, then built a design system so the team could ship the rest.`
   - `Get a new user to their first sent invoice in five minutes.`; `Cut support questions about setup.`; `Give the team a design system they can extend.`
   - Ledger teal 1F6F6B; Cloud F4F6F5; Amber E0A43A
   - `First invoice flow`; `Invoice list with paid and overdue states`; `Design system components`
   - `5 min` / `median time to the first sent invoice`; `-35%` / `setup questions to support`; `120` / `components in the design system`
4. `quarry-press` | Quarry Press | Quarry Press | brand-identity | 2024 | 28 | grid | Identity design and typography | 7 weeks | 1, 2, 3, 1
   - `An identity system for a small publisher of field guides, built from one condensed serif.`
   - `Quarry Press publishes twelve field guides a year and every cover looked different. One condensed serif, a strict cover grid and a colour per subject now make the shelf read as one list.`
   - `Make every guide recognisable from across a shop.`; `Let the designer set a new cover in a day.`; `Keep the cost of colour printing flat.`
   - Slate 2E3338; Limestone EDE8DC; Ochre C8902E
   - `Cover grid for the field guides`; `Spine system on the shelf`; `Catalogue spread`
   - `12` / `covers set in the new system in its first year`; `1 day` / `to set a new cover, down from a week`; `+22%` / `bookshop orders for the spring list`
5. `fieldwork-journal` | Fieldwork Journal | Fieldwork Institute | website-design | 2024 | 50 | arcs | Website design and content design | 10 weeks | 2, 1, 5, 2
   - `A long-read site for a research institute, set for comfortable reading on any screen.`
   - `The institute's reports lived in PDFs few people opened. Fieldwork Journal turns each report into a readable web essay with footnotes beside the text, figures that resize cleanly and a download for the full report.`
   - `Get the reports read, not just downloaded.`; `Make footnotes and figures work on a phone.`; `Publish a new essay from the institute's own editor.`
   - Ink 22201C; Paper F6F1E7; Field yellow D8A520
   - `Essay opening with standfirst`; `Footnotes beside the text`; `Figure on a phone`
   - `3x` / `average reading time per essay`; `58%` / `of readers on phones finishing an essay`; `24` / `essays published in the first year`
6. `pathway-transit` | Pathway | Pathway Transit Authority | digital-product-design | 2024 | 220 | arcs | Product design and usability testing | 16 weeks | 4, 2, 8, 2
   - `A journey planner that puts the next departure and step-free routes first.`
   - `Riders asked one question, when does the next one leave, and the old app answered it three screens deep. Pathway opens on the nearest stops with live departures and offers step-free routes from the first screen.`
   - `Show the next departure on the first screen.`; `Make step-free routes a first-class choice.`; `Pass usability tests with riders who use screen readers.`
   - Route blue 1D4E89; Platform grey E6E8EB; Signal yellow F2C230
   - `Nearest stops with live departures`; `Step-free route options`; `Trip in progress`
   - `1` / `screen to the next departure, down from 3`; `92%` / `task success in tests with screen reader users`; `+30%` / `weekly riders using the app`
7. `tidewater-co-op` | Tidewater Co-op | Tidewater Grocery Co-operative | brand-identity | 2023 | 140 | stack | Identity and signage design | 10 weeks | 2, 2, 4, 2
   - `A friendlier mark and signage family for a member-owned grocer with eleven stores.`
   - `Members said the old signs felt like a discount warehouse. A rounded wordmark, drawn produce icons and a signage kit that store staff can print themselves changed the feel of all eleven stores in one spring.`
   - `Make the co-op feel owned by its members, not a chain.`; `Give staff signs they can print and change in store.`; `Keep every sign readable from the end of an aisle.`
   - Kelp green 2F6B4F; Oat F2EAD8; Tomato C8402F
   - `Store front at dusk`; `Aisle signs and shelf labels`; `Member card`
   - `11` / `stores re-signed in one spring`; `+18%` / `new members in the first year`; `40` / `sign templates staff print themselves`
8. `ostler-hotels` | Ostler Hotels | Ostler Hotel Group | website-design | 2022 | 350 | stack | Website design and design system | 11 weeks | 2, 2, 5, 2
   - `A booking-led website for four small hotels that each keep their own character.`
   - `Four hotels shared one template and looked identical. A shared design system with a palette and picture style per hotel lets each one look like itself, while booking works the same way everywhere.`
   - `Give each hotel its own look inside one system.`; `Make booking two steps from any page.`; `Cut the cost of adding a fifth hotel.`
   - Claret 7A1F2B; Linen F3ECE2; Brass B08A3E
   - `Hotel home page`; `Room chooser`; `Booking summary on a phone`
   - `+27%` / `direct bookings in the first year`; `2` / `steps from any page to a booking`; `3 weeks` / `to add a hotel to the system`
9. `tally-kitchen` | Tally | Tally Kitchen Systems | digital-product-design | 2023 | 15 | stack | Product and interface design | 12 weeks | 3, 2, 5, 2
   - `An order screen for busy kitchens, readable at arm's length and usable with wet hands.`
   - `Cooks read orders from two metres away while plating. Tally uses large type, colour plus shape for each course and wide touch zones, so an order can be cleared with a knuckle.`
   - `Make every order readable from two metres.`; `Never rely on colour alone for course or status.`; `Let a cook clear an order without precise taps.`
   - Char 1E1B18; Steel DADDE0; Flame E2572B
   - `Order rail at service`; `Course markers in colour and shape`; `Clear and recall`
   - `2 m` / `reading distance for every order`; `-48%` / `missed course changes`; `64 px` / `minimum touch zone`

**Starting state**
- Content edition 1, no enquiries, and the next reference `SOL-0001`.
- Sequences with the starting content:
  - all projects as listed above;
  - Brand Identity: `harbour-loom`, `quarry-press`, `tidewater-co-op`;
  - Website Design: `northlight-gallery`, `fieldwork-journal`, `ostler-hotels`;
  - Digital Product Design: `ledgerline`, `pathway-transit`, `tally-kitchen`.

## Technical requirements

### Deployment (DP-56, DP-57)

- **Runtime.** Node 22 is available; write the app in TypeScript.
- **Run manifest.** `/app/run.json` holds the string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- **Listening.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- **Health.** `GET /api/health` answers as described in API.
- **Start-up.** On every start the server applies its schema idempotently and stores the starting content when the database is empty.
- **Outage copies.** The grader runs two extra copies of the app, each starting from the starting content in its own empty database:
  - one with the mail server pointed at an unreachable address;
  - one with Gotenberg pointed at an unreachable address.

### Configuration and secrets (DP-58)

- Read these environment variables at start:
  - `DATABASE_URL`
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `MAIL_FROM` (the grader sets it to `Sollis Studio <folio@sollis.example>`)
  - `STUDIO_EMAIL` (`studio@sollis.example`)
  - `GOTENBERG_URL`
  - `GRADING_KEY`, which has no default; without it the grading routes are absent
- Never hard-code any of these values and never send any of them to the browser.
- The dev setup also provides `MAILPIT_URL`, which the app does not need.

### Server boundary (DP-57)

- The site is same-origin only. It sends no CORS headers and no Content-Security-Policy header or meta tag.
- The site loads no external fonts, scripts, images, video or CDNs. The browser only ever talks to the app.
- The server never serves source files, `.env` files, the lockfile or credentials. Those addresses answer the 404 not-found page.
- The request body limit is in API.
- When the mail server or Gotenberg cannot be reached, the app still starts and everything else keeps working, as described in Services.
- When Postgres is not reachable at start, the server keeps retrying every 2 seconds and answers once it connects.

### Browser support and performance (DP-45, DP-54)

- Support current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, on both mouse and touch.
- `/` and every case study are usable within three seconds of opening on the grading machine.
- Every visible effect of an action shows within one second, except the timed motions, which follow Motion and effects.

## Working rules

- IF-01: `/app/run.json` exists, with string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and its commands install, build and serve the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence, plus the two font families. "Shipped packages" means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package uses the MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD licence. The only exceptions are `@fontsource/instrument-serif` and `@fontsource/instrument-sans`, which are under the SIL Open Font Licence and supply the Instrument Serif and Instrument Sans files that the app serves.
- IF-04: The app stores data only in the provided Postgres database. It uses no other datastore, such as SQLite, Redis, or local files for content or enquiries.
- IF-05: The app uses no animation library, no WebGL, no canvas animation loop and no video.
- IF-06: Every colour in the stylesheets is written in hex or rgb/rgba notation, with no colour-mixing or other colour functions.
- IF-07: The provided service setup and its dev credentials are left unchanged, and no credentials are committed in source files.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with names that match this brief's terms: enquiry, reference, submission id, brief, project, category, statistic, edition.
- Each domain rule is decided in exactly one place in the source: the check messages, the reference numbering, the one-enquiry-per-submission rule, the mail outcome, category counts and project sequences.
- No abstraction has only a single implementation, and no interface or wrapper exists only to be swapped later.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the brief makes impossible.
- Every API error uses the one published shape, with an `error` code and either a `message` or `fields`.
- Content and copy come from the database or from the single published copy, never duplicated across pages.
- There is nothing beyond this brief: no extra pages, endpoints, settings or features.
