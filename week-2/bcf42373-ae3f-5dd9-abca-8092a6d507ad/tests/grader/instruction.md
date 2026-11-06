# Ivo Kastrel Casebook

Build and deploy the personal site and private studio of Ivo Kastrel, an invented solo creative developer. The site has three parts. The first is a long, dark, film-like home page in eight chapters. The second is a catalogue of case studies that visitors can filter by discipline. The third is a short journal, a wall of recognitions and a project inquiry form. Behind the site sits a studio where the one owner curates case studies and works through the inquiry inbox. Publishing or unpublishing a case study in the studio changes every public read straight away. The app is a Python server that renders HTML pages, with plain JavaScript that improves those pages in the browser. PostgreSQL is its only backing service. Out of scope: visitor accounts, signup, email sending, payments, search, comments, analytics, and any datastore, cache, queue or file store other than PostgreSQL.

## Problem and users

A creative developer wins work from how their site feels in the first ten seconds. The site also has to stay correct while they keep reshaping it. Half-finished case studies sit beside finished ones, and the order of the catalogue changes. Commissioners reach a page from a shared link, then follow its numbering ("case 02 of 05") and its previous and next links. If a draft leaks through a shared or guessed address, the site loses trust. The same happens when numbering skips a value or a message is lost. Too much security noise on the studio sign-in also costs trust.

| Role | Goal | Can do |
|---|---|---|
| Visitor (no account) | Judge the work quickly, read the thinking, send a project request | Read every public page and public API, including the sign-in page `/studio/login`. Filter the catalogue, read the journal and send an inquiry. **Cannot** reach `/studio` or any `/api/studio/` endpoint, read a draft or a journal entry that is not yet live, list inquiries, or change any record. |
| Owner | Keep the catalogue current and answer every inquiry | Everything a visitor can do. Also: sign in, create, edit, publish, unpublish and delete case studies, read every inquiry and mark it resolved. |

There is exactly one account and no signup.

## Journeys

1. **First look.** A visitor opens `/` for the first time in a browsing session. An intro cover lifts away. The manifesto statement slides across the black field as they scroll. They move through about, services, selected work, process, journal, awards and contact, then press `VIEW` under the selected work and land on `/work` with every published case study numbered from `01`.
2. **Filtering and following the work.**
   1. On `/work`, the visitor chooses `3D WEB` and then `UI/UX`, and the address follows each choice.
   2. They press browser Back and see the `3D WEB` list again. A second Back shows `All`, and Forward brings back `3D WEB`.
   3. They open Hollow Signal. They see its place as `01 / 05`, follow `Next` to Ember Ledger, and return to the index.
3. **Reading the journal.** From the home journal chapter or `/journal`, the visitor opens `Motion Beyond Animation`, reads it and goes back to `/journal`. An entry dated tomorrow in the studio's time zone is not visible anywhere yet.
4. **Sending an inquiry.**
   1. The visitor presses `Let's Connect` and the inquiry panel rises from the bottom edge.
   2. They mistype their email and press `Submit`. The panel keeps everything they typed, an error summary points to the email field, and nothing is stored.
   3. They fix the email and press `Submit` again. The thanks message appears in the panel, is announced, and receives keyboard focus.
   4. They press Escape. Focus returns to `Let's Connect`.
5. **Curating the studio.**
   1. The owner opens `/studio`, lands on `/studio/login`, mistypes the password once, then signs in and reaches `/studio`.
   2. They create a draft and see each field's limit printed beside it. One field is too long, the save is refused and that field is marked. They fix it.
   3. They publish the draft and it appears on `/work` with the next ordinal. They unpublish it and it disappears. They edit its title, then delete it.
   4. They open the inquiries pane and mark the newest inquiry resolved.
   5. They sign out and land back on `/studio/login`.
6. **A guess, a stale token, a shared draft link.**
   - Someone guessing the owner's password is locked out after five refused attempts. While locked, even the right password is refused, and the answer looks the same whether or not the email has an account.
   - A token that has been signed out, or is older than the session lifetime, opens nothing.
   - Every variant of a draft's address answers exactly like an address that never existed.
7. **Restart.** The owner deletes, retitles and unpublishes seeded case studies. The server restarts with several workers, and every change is still in place. No seeded record comes back or is duplicated.

**Definition of done.** Every journey above completes in a browser without an error page. Every rule below holds for a black-box observer of the HTTP answers, the PostgreSQL rows and the rendered page. The site holds together for a keyboard user, a screen reader user, a visitor who asked for reduced motion, and a phone.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Owner sign-in** POST /api/auth/login with the seeded owner email and password answers a bearer token of at least 16 characters that opens every studio endpoint.
- **DP-02 — One refusal for any wrong sign-in** A wrong password and an unknown email get the same status and a byte-identical body, carry no token and create no sessions row.
- **DP-03 — Hashed password** The owner's accounts row holds a salted password hash, never the plain password.
- **DP-04 — Sign-in lockout** Five refused sign-ins for one email inside the lockout window lock that email, whether or not it has an account. Every later attempt, even with the correct password, then gets the lockout answer with no token, counted from PostgreSQL across all workers.
- **DP-05 — Lockout lifts with time** An email unlocks on its own once fewer than five refusals since its latest successful sign-in fall inside the lockout window, and the correct password then signs in.
- **DP-06 — Sign-out ends the token** After POST /api/auth/logout the same token is refused on every studio read and write, and its sessions row keeps revoked_at set.
- **DP-07 — Studio sign-in page** Signing in at /studio/login reaches /studio with its Case studies and Inquiries panes, and a reload keeps the owner there. Sign out returns to /studio/login. A refused or locked sign-in stays on the page with the email kept and its reason from Feedback states shown.
- **DP-08 — Server-side studio authorization** Every /api/studio/ endpoint, reads included, refuses a missing, forged, revoked or expired token before reading or changing any record, and a body claiming a role grants nothing.
- **DP-09 — Session lifetime** A token stops working once the database clock reaches its expires_at, on every studio endpoint and on sign-out. expires_at is set at sign-in to the session lifetime after created_at and is never moved by use.
- **DP-10 — Studio page gate** Opening /studio with no session, a signed-out session or an expired one lands on /studio/login, and the delivered /studio HTML carries no case study or inquiry data.
- **DP-11 — Draft absent from public reads** The draft red-meridian is absent from GET /api/cases, every discipline filter, /work and the home page.
- **DP-12 — Identical not-found answers** A draft or not-yet-live slug and an unknown slug get the same status and a byte-identical body at GET /api/cases/{slug}, /work/{slug}, GET /api/journal/{slug} and /journal/{slug}. No not-found body echoes the requested path.
- **DP-13 — No widening query parameters** Query parameters other than discipline never change what a public read returns.
- **DP-14 — Canonical addresses only** Case study and journal addresses match only the exact stored slug, so uppercase, trailing-slash, encoded and numeric-id forms answer not found with no redirect.
- **DP-15 — Only the published surface** An /api address outside the API table answers not found in the JSON refusal shape, and a listed address called with an unlisted method gets the wrong-method answer with its Allow header. /api/auth/signup, /cart, /checkout, /newsletter and /search answer not found.
- **DP-16 — Not-found page** An unknown address shows the site's own not-found page, which keeps the site chrome and offers a link back to /.
- **DP-17 — New case study is a draft** A case study created with POST /api/studio/cases is stored with published false and published_at null, appears in the studio list and stays out of every public read.
- **DP-18 — Publish and unpublish** Publishing stamps published_at and lists the case study on every public read, on the home page too when featured. Unpublishing clears published_at and removes the case study from every public read, every total and every neighbour link at once.
- **DP-19 — Guarded publish transitions** Publishing a published case study or unpublishing a draft gets its conflict answer and leaves published_at unchanged, and of four simultaneous publishes of one draft exactly one succeeds.
- **DP-20 — Publishing needs a summary and an outcome** Publishing a case study whose summary or outcome is empty or only whitespace, or blanking either field on a published case study, is refused naming that field, and the case study is unchanged.
- **DP-21 — Delete** Deleting a case study removes its row, its studio entry and every public read of it.
- **DP-22 — Studio curation in the browser** Signed in at /studio, the owner works only through the studio's own controls: creates a draft with Create draft, sees it marked Draft and absent from /work; publishes it, so it shows Published and lists on /work with the next ordinal; unpublishes it, edits its title, and deletes it.
- **DP-23 — Seed lands once** On a fresh database, the multi-worker server stores the seed exactly once: one owner account, six case studies, four journal entries, three recognitions and three figures.
- **DP-24 — Owner changes survive a restart** After the owner deletes low-tide-radio, retitles hollow-signal and unpublishes vanta-atelier, a restart of serve against the same database keeps all three changes and duplicates no seeded row.
- **DP-25 — PostgreSQL is the store** Every record lives in PostgreSQL behind DATABASE_URL, in exactly the eight tables of the data model, with no in-memory or file stand-in.
- **DP-26 — Case study limits and types** On create and edit, every over-limit, out-of-range, missing or wrongly typed field is refused in one validation answer that names each failing field. Nothing is written, and lengths count Unicode characters after trimming.
- **DP-27 — Slug shape and discipline** A slug that breaks the slug shape, or a discipline outside the three allowed values, is refused naming that field, and nothing is written.
- **DP-28 — Editable fields only** A create or edit carrying any key outside the editable fields, or carrying slug on an edit, is refused naming each such key, and nothing changes.
- **DP-29 — Slug conflict** Creating a case study at a slug already in use, drafts included, gets the slug conflict answer, and the slug keeps exactly one row.
- **DP-30 — Simultaneous creates** Four simultaneous creates carrying one new slug store exactly one row: one succeeds and three get the slug conflict answer.
- **DP-31 — Limits on the studio form** The studio form shows each field's published limit as hint text and shows the slug as read-only text when editing. A refused save marks every failing field in words and keeps every typed value.
- **DP-32 — Published catalogue order** GET /api/cases answers the five published case studies in catalogue order with ordinals 01 to 05, including when positions tie, and every public list follows that same order.
- **DP-33 — Contiguous ordinals** Unpublishing or deleting a published case study leaves the rest numbered contiguously from 01, in the same order.
- **DP-34 — Place and wrapping neighbours** GET /api/cases/{slug} carries challenge, approach, outcome, stack, ordinal, total, and the wrapping previous and next neighbours, all derived at read time from the one catalogue order.
- **DP-35 — Discipline filter on the API** GET /api/cases?discipline=<value> answers only that discipline's published case studies, each keeping its ordinal from the full set, and an unknown value is refused naming discipline.
- **DP-36 — Case study page** /work/hollow-signal shows its place as NN / TT, its Next link opens /work/ember-ledger, and it links back to /work. The home VIEW link opens /work.
- **DP-37 — Discipline filter in the address** On /work, choosing a discipline in Discipline filter lists only that discipline's case studies, marks the choice current, puts it in the address and survives a reload; browser Back and Forward restore each earlier list, address and marker; and an unknown value in the address redirects to /work.
- **DP-38 — Empty discipline** A discipline with no published case study shows the empty state from Feedback states, with a link to all work.
- **DP-39 — Journal reads** GET /api/journal answers the public entries newest first with excerpts, GET /api/journal/{slug} answers one entry with its body, and the unpublished unfinished-light is not found.
- **DP-40 — Journal goes live on the studio's day** A published journal entry becomes public on its published_on date in the studio's business time zone, and it appears on the API, /journal, its own page and the home chapter alike.
- **DP-41 — Journal pages** /journal links each public entry. Following Motion Beyond Animation opens its page, which shows its title, its stored calendar date, its body and a link back to /journal.
- **DP-42 — Inquiry stored** POST /api/inquiries stores a valid inquiry with status new and a received_at time, and answers its id and status.
- **DP-43 — Inquiry validation** A bad, missing or unlisted inquiry field, or a supplied project_type outside the four allowed values, is refused naming every failing field, and nothing is stored.
- **DP-44 — Malformed requests refused in one shape** An oversized body, invalid JSON, a JSON value that is not an object, and a non-JSON content type each get their own status in the one JSON refusal shape, never an HTML page or a server error.
- **DP-45 — Bounded email check** A 20,000-character hostile email address is refused naming email within 2 seconds.
- **DP-46 — Inquiry from the contact page** A valid inquiry sent from /contact posts only to the app's own origin and is stored once. Its thanks message replaces the form inside the form's status region and takes keyboard focus.
- **DP-47 — Rejected form keeps input** A refused submission from /contact or the Let's Connect panel keeps what was typed, marks each wrong field in words, lists the wrong fields in an error summary that links to each one, and stores nothing.
- **DP-48 — Messages stay private** A visitor's message never appears in any public API read or public page.
- **DP-49 — Duplicate inquiry window** The same email and message received again inside the duplicate window, even four at once, is stored once, and every answer carries the original id. A different message from that email is a new inquiry.
- **DP-50 — Guarded resolve** The owner lists every inquiry newest first. Resolving a new inquiry stamps resolved_at once. Resolving one that is already resolved gets the resolve conflict answer, and so do three of four simultaneous presses.
- **DP-51 — Inbox in the studio** In the studio, the owner marks the newest inquiry resolved with its Mark resolved button. Pressing it on an inquiry already resolved in another tab shows the refusal and the row's Resolved state.
- **DP-52 — Server-rendered home** The HTML delivered for / carries the eight chapter anchors, the hero statement, the figures and links to exactly the featured published case studies, all readable with scripting off.
- **DP-53 — Home chapters** The home page shows its eight chapters in the order given in Screens and layout, with the stored figures, the 3D WEB skills, the four process steps, the three newest public journal entries and the three recognitions.
- **DP-54 — Site chrome** Every public page carries the mark, the six navigation links, ONLINE, Let's Connect, the Motion button and the bottom rail.
- **DP-55 — Document metadata** /, /work, /journal, /contact and /work/hollow-signal carry their pinned titles, the en language, the pinned viewport and the pinned description.
- **DP-56 — Intro cover once** The first page of a browsing session opens under a full-viewport intro cover that is gone within three seconds, and the next page of that visit has no cover.
- **DP-57 — Let's Connect panel** Let's Connect opens the Let's Connect dialog, and Tab stays inside it. A valid inquiry shows the thanks in the dialog's status region with focus on it. Escape returns focus to Let's Connect, and reopening shows an empty form.
- **DP-58 — Reduced motion** With reduced motion requested, no endless animation runs, and the hero statement and every chapter heading rest at their final readable state, whatever the Motion button's state.
- **DP-59 — Motion toggle** The Motion button starts pressed. Pressing it stops every endless animation and settles every reveal, and that choice survives a reload and a new tab.
- **DP-60 — Split heading reveal** Chapter headings rise word by word out of a soft blur as they scroll into view and finish within about a second, and each keeps the whole heading as its accessible name.
- **DP-61 — Hero statement follows scroll** With motion on, the hero statement slides left as the hero scrolls away and returns step by step when scrolled back, as described in Motion and effects.
- **DP-62 — Living chrome** With motion on, exactly five endless loops run: the live dot pulses, the equaliser bars bounce at different speeds, the plus markers and process rings turn, the hero glows and smoky blot drift slowly, and a faint grain jitters over the hero. No other endless animation runs.
- **DP-63 — Cinematic hero** The home page opens on a near-black field where the thin uppercase manifesto statement spans the full width, partly erased by a dark smoky blot.
- **DP-64 — Near-black and blood red** The home page, the case study pages and the journal use a near-black ground with one deep blood red accent and near-white body copy.
- **DP-65 — Thin headlines and script accents** Giant headline lines are a thin uppercase sans. The JOURNAL title, the figures and the closing words Digital Experience. are set in a handwritten script face.
- **DP-66 — Stage grid and generated visuals** Behind the selected work, a web of fine deep red hairlines frames a centred generated visual, and each case study card on /work carries a generated cover visibly different from its neighbours.
- **DP-67 — Case study composition** A case study page sets a centred visual between a smaller visual above and below, with its name at the left and a short paragraph at the right, over a blurred enlargement of the same visual.
- **DP-68 — Figures band and footer glow** The figures band fills the width in deep red, with near-white script figures in ruled rows. The footer glows from bright red at its bottom edge into near-black, tilted slightly off level.
- **DP-69 — Phone layout** At 375 CSS pixels wide, the hero statement shrinks to roughly a third of its desktop size, and the figures band and the service cards stack in one column.
- **DP-70 — WCAG 2.2 AA** /, /work, /work/hollow-signal, /journal, /journal/motion-beyond-animation, /contact and /studio/login pass an automated WCAG 2.2 AA audit.
- **DP-71 — No sideways scrolling** /, /work, /work/hollow-signal, /contact and /studio never scroll sideways at 320, 375, 768 and 1280 CSS pixels wide.
- **DP-72 — Visible focus and menu** Every control the Tab key reaches shows a visible focus ring, and below the navigation breakpoint the Menu button reveals the folded navigation.
- **DP-73 — Journal cover brightens** A journal cover on the home page rests dimmed and brightens on hover and on keyboard focus.
- **DP-74 — Same-origin runtime** Every request made by the public pages and by /studio goes to the app's own origin.
- **DP-75 — Health** GET /api/health answers its ready body on the public origin once the app and its database are ready.
- **DP-76 — Domain rules decided once** Each of these rules is decided in exactly one place in the source: the publish rule; the catalogue order with its ordinals, totals and neighbours; the editable-field list; the sign-in lockout; the journal's business-day rule; the duplicate-inquiry window.
- **DP-77 — Credentials from the environment** The database URL is read from the environment at start, and is never written into the source or sent to the browser.

## Frontend

Every page arrives from the server as a complete document that is readable with scripting off. Plain JavaScript shipped by the app then adds to that document:
- the split heading reveals;
- the scroll-linked hero statement;
- the inquiry panel;
- the in-page filter update;
- the menu button;
- the motion toggle;
- the studio's actions.

The front end decides nothing about who may see a record. Hiding a control is presentation only: the server refuses the call whatever the page drew.

### Screens and layout (DP-07, DP-10, DP-16, DP-22, DP-31, DP-36, DP-41, DP-52, DP-53, DP-67, DP-69, DP-71)

| Route | Purpose | Access |
|---|---|---|
| `/` | the home page, eight chapters | public |
| `/work` | the case study index with its discipline filter | public |
| `/work/<slug>` | one published case study | public |
| `/journal` | the journal index | public |
| `/journal/<slug>` | one public journal entry | public |
| `/contact` | the standalone inquiry page | public |
| `/studio/login` | owner sign-in | public |
| `/studio` | the owner console | owner |

The frame is fixed:
- the personal mark at top left;
- a short navigation at top right;
- a status pill near the navigation;
- a quiet bottom rail;
- the equaliser `Motion` button at bottom left.

Moving between `/`, `/work` and a case study keeps the frame in the same place. Public routes are spacious. The studio is compact, so the owner sees a whole catalogue on one screen.

**Home page.** It is eight chapters in this order. Each chapter is a region with its own heading and anchor (DP-53):

1. **Hero `#hero`.**
   - The introduction sits at upper left.
   - The role stack sits at lower right.
   - The manifesto statement runs across the full width in the thin headline face.
2. **About `#about`.**
   - The about manifesto comes first.
   - Then the figures band: a full-width deep red field with each stored figure in the script face, with its label and caption, in rows divided by fine rules.
3. **Services `#services`.**
   - Three discipline cards: `UI/UX`, `3D WEB` and `FRONTEND`.
   - Each card has a short description, two generated service pictures and a capability list.
   - The `3D WEB` list reads `Frontend Engineering`, `Three.js / WebGL`, `GSAP Animation` and `Performance Optimization` as plain text.
4. **Selected work `#work`.**
   - Every featured published case study, in catalogue order. Each shows its title, summary, ordinal and discipline label, and links to its page.
   - Then the `VIEW` link and the hint line.
   - Behind it sits the stage grid around a square framed generated visual.
5. **Process `#process`.**
   - Four steps, `Discovery`, `Creative Direction`, `Digital Craftsmanship` and `Launch & Evolution`. Each step's number sits inside a process ring, followed by its paragraph.
   - Then the closing line, whose last two words are in the script face.
6. **Journal `#journal`.**
   - The `JOURNAL` title in script and the journal intro.
   - The three newest public entries as staggered cards, each with a generated cover, title and date.
7. **Awards `#awards`.**
   - The awards heading and intro.
   - One upright card per stored recognition, showing the award, its date and the issuer, standing on a faceted red and black floor.
8. **Contact `#contact`.**
   - The contact heading and line.
   - The inquiry form.

**`/work`.** It lists every published case study in catalogue order. Each card shows its ordinal, title, discipline label, summary and generated cover. The `Discipline filter` sits above the list.

**`/work/<slug>`.**
- The title in large headline type.
- The place line `<ordinal> / <total>`. Both values come from `GET /api/cases/{slug}`, as two-digit numbers.
- The summary, challenge, approach and outcome.
- The stack as plain text, and the year.
- `Previous` and `Next` links, and an `All work` link back to `/work` inside the main content.

The composition (DP-67) is a centred generated visual between a smaller visual above and a smaller visual below. The name sits at the left and a short paragraph at the right, over a blurred enlargement of the same visual. It may continue as the visitor scrolls.

**Journal pages.** `/journal` lists public entries newest first. Each shows its title, date, excerpt and generated cover, and links to its page. `/journal/<slug>` shows the title, the date, the body paragraphs and an `All journal entries` link back to `/journal`. Dates read as the stored calendar date in the form `July 1, 2026` (full month name, day without a leading zero, four-digit year), never shifted by a time zone. Recognition dates use the same form.

**`/contact`.** The inquiry form, alone on the page, inside the site chrome.

**`/studio/login`.** The `Email` and `Password` fields, the `Sign in` button and the sign-in alert.

**`/studio`.**
- **Gate.** The delivered HTML is the same for every request and contains no record data. The page reads its data from the studio API with the owner's token. If no token is held, or the server refuses the one held, the browser goes to `/studio/login`. After signing in, the browser returns to `/studio`.
- **`Case studies` pane.** A table of every case study, drafts included, in catalogue order. Each row shows the title, slug, discipline, state (`Draft` or `Published`), featured flag and position, plus the row actions.
- **Editor.** Below the table sits the `Case study editor` form. It is used to create and to edit. When editing, the slug is shown as read-only text and is never sent.
- **`Inquiries` pane.** Every inquiry, newest first. Each shows the name, email, phone, project type, message, received time (in the studio's business time zone) and status (`New` or `Resolved`).
- **`Sign out`.** A button that signs the owner out.

**Viewports.**

| Viewport | Layout |
|---|---|
| 1280×800 | Full navigation. Multi-column chapters: the hero is split corner to corner, the figures band has three columns, there are three service cards, and the work and journal cards are staggered. Studio table and editor sit side by side. |
| 768×1024 | The navigation folds behind `Menu`. Service and journal cards run two across. The figures band has three columns. The studio editor sits below the table. |
| 375×812 | One column throughout. The hero statement is about a third of its desktop size, with the introduction and role stack under it. The figures band and service cards stack. The inquiry form is full width. The studio table becomes one stacked card per case study. |

The navigation folds below 900 CSS pixels. Chapters become one column below 600 CSS pixels. Nothing on any page scrolls sideways at any width from 320 CSS pixels upward.

### Public screens and controls (DP-07, DP-22, DP-31, DP-36, DP-37, DP-46, DP-47, DP-51, DP-54, DP-55, DP-57, DP-59, DP-72)

Only the controls and regions in this table are public contracts. Everything else on the page is free.

| Where | Role and accessible name | Visible copy or behaviour |
|---|---|---|
| every page | `link "Ivo Kastrel"` | the winged personal mark at top left, linking to `/` |
| every page | `navigation "Main"` with links `HOME`, `ABOUT`, `SERVICES`, `WORK`, `BLOG`, `CONTACT US` | point to `/`, `/#about`, `/#services`, `/work`, `/journal`, `/contact` |
| every page, below the breakpoint | `button "Menu"` with `aria-expanded` | two thin lines; reveals the main navigation |
| every page | status pill text `ONLINE` with a live dot, and `button "Let's Connect"` | opens the inquiry dialog |
| every page | `button "Motion"` with `aria-pressed` | the equaliser strip of thin red bars |
| every page | bottom rail | `TENSION`, `IMMERSION`, `IMPACT` separated by plus markers |
| every page | footer | plain labels `TIKTOK`, `INSTAGRAM`, `BEHANCE` with no link target, and `link "Studio"` to `/studio/login` |
| inquiry panel | `dialog "Let's Connect"` with `button "Close"` | full-screen panel holding the inquiry form |
| inquiry form (home `#contact`, `/contact`, dialog) | `textbox "Name"`, `textbox "Phone"`, `textbox "Email"`, `textbox "Message"`, `combobox "Project type"`, `button "Submit"` | the `Project type` options read `UI/UX`, `3D WEB`, `FRONTEND`, `OTHER` plus an empty first choice `No preference` |
| inquiry form | `status "Inquiry status"` | present and empty in the delivered HTML; holds pending and thanks copy |
| inquiry form | `alert "Inquiry errors"` | the error summary, with one link per failing field |
| home `#work` | `link "VIEW"` | to `/work`, with the hint `Scroll down for more` |
| `/work` | `navigation "Discipline filter"` with links `All`, `UI/UX`, `3D WEB`, `FRONTEND` | links to `/work`, `/work?discipline=ui-ux`, `/work?discipline=3d-web`, `/work?discipline=frontend`; the current one carries `aria-current="true"` and an underline |
| `/work` | `status "Catalogue status"` | the count announcement |
| case study page | `link "Previous: <title>"`, `link "Next: <title>"`, `link "All work"` | `<title>` is the neighbour's title |
| journal entry | `link "All journal entries"` | to `/journal` |
| not-found page | heading `Nothing at this address.` and `link "Back to the home page"` | to `/` |
| `/studio/login` | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `alert "Sign-in errors"` | |
| `/studio` | `region "Case studies"`, `region "Inquiries"`, `button "Sign out"`, `status "Studio status"`, `alert "Studio errors"` | |
| `/studio` | `button "Create draft"` | opens the editor empty, in create mode |
| `/studio` row | `button "Edit <title>"`, `button "Publish <title>"` (drafts), `button "Unpublish <title>"` (published), `button "Delete <title>"` | visible text is the verb; the title completes the accessible name |
| `/studio` editor | `form "Case study editor"` with fields `Title`, `Slug`, `Discipline`, `Summary`, `Challenge`, `Approach`, `Outcome`, `Stack`, `Year`, `Featured`, `Position`, and `button "Save"` | in create mode the button reads `Save draft` |
| `/studio` inquiry row | `button "Mark resolved <name>"` on each new inquiry | visible text `Mark resolved` |

**Field hints (DP-31).** Each editor field shows its limit from the case study limits table in Business rules, as hint text tied to the field:

| Field kind | Hint form |
|---|---|
| text fields | `Up to <max> characters` |
| `Title` | `1 to 80 characters` |
| `Slug` | `Lowercase letters, digits and single hyphens, up to 64 characters` |
| `Year`, `Position` | `A whole number from <min> to <max>` |

**Copy and metadata (DP-55).**

| Slot | Copy |
|---|---|
| title of `/` | `Ivo Kastrel - Front-End Developer, UI/UX Designer and 3D Web Developer` |
| title of `/work`, `/journal`, `/contact` | `Ivo Kastrel - Work`, `Ivo Kastrel - Journal`, `Ivo Kastrel - Contact` |
| title of a case study or journal entry | `<title> - Ivo Kastrel` |
| every page | `lang="en"`, viewport `width=device-width, initial-scale=1`, description `Cinematic web experiences by a solo creative developer.` |
| hero introduction | `I create digital experiences that aren't just seen, they're felt. From the first impression to the smallest interaction, I focus on making every experience clear, immersive, and memorable.` |
| role stack | `VISUAL STORYTELLER`, `UI/UX DESIGNER`, `3D WEB DEVELOPER` |
| hero statement | `IT WAS ALWAYS GOING TO BE THIS WAY` |
| about manifesto | `I don't build websites, I build experiences people enjoy exploring.` |
| services intro | `Design attracts attention. Development brings it to life. I combine both to create websites that not only look exceptional but also feel fast, clear, and memorable.` |
| Discovery | `Every great story begins with understanding. I explore your vision, audience, and goals to uncover the foundation for an experience that feels authentic and unforgettable.` |
| Creative Direction | `Ideas take shape through thoughtful research, wireframes, visual exploration, motion concepts, and design systems.` |
| Digital Craftsmanship | `With strategy in place, I transform concepts into immersive experiences, with every line of code crafted for performance, accessibility, and lasting impact.` |
| Launch & Evolution | `A successful launch is only the beginning. I monitor, refine, and evolve the product to keep it relevant, engaging, and aligned with business goals.` |
| closing line | `From the First Idea to the Final Frame Every Step Is Crafted to Create an Unforgettable Digital Experience.` |
| journal intro | `A collection of experiments, creative processes, front-end discoveries, and visual stories.` |
| awards heading and intro | `AWARDS & RECOGNITIONS` and `Forged in obsession, shaped in darkness, and recognized beyond the screen.` |
| contact heading and line | `GET IN TOUCH` and `LET'S BE CREATIVE` |

### Interactions (DP-07, DP-22, DP-37, DP-46, DP-47, DP-51, DP-56, DP-57, DP-59, DP-72, DP-73)

**Inquiry dialog.**
1. Pressing `Let's Connect` opens `dialog "Let's Connect"`, and focus moves to `Name`.
2. While the dialog is open, Tab and Shift+Tab cycle only through its controls.
3. Escape or `Close` closes it, and focus returns to `Let's Connect`.
4. After an accepted inquiry, the dialog stays open showing the thanks, with focus on it.
5. Closing and reopening the dialog shows an empty form, with no thanks and no errors.

**Inquiry form (all three placements).**
1. `Submit` sends the form as JSON to `POST /api/inquiries` on the same origin.
2. When `Project type` is `No preference`, the `project_type` key is left out.
3. On acceptance, the form's fields are replaced by the thanks text inside `status "Inquiry status"`. That region was present and empty in the delivered HTML. The thanks text takes focus: it is focusable by script but not in the Tab order.
4. On refusal:
   - every typed value stays;
   - each failing field shows its message beside it and is marked invalid for assistive technology;
   - `alert "Inquiry errors"` shows the summary heading with one link per failing field;
   - following a link moves focus to that field.

**Discipline filter.**
1. Choosing a link updates the list in place and moves `aria-current` to that link. It also pushes the link's address, so the address reads `/work?discipline=<value>`, or `/work` for `All`.
2. `Catalogue status` announces the count.
3. Back and Forward restore the list, the marker and the count for each address.
4. A reload renders the same filtered page from the server.
5. With scripting off, the links work as plain navigation.

**Menu.** `Menu` toggles the folded navigation and its `aria-expanded`. Escape closes it and returns focus to `Menu`.

**Motion toggle.**
- On a first visit `Motion` starts pressed, even when reduced motion is requested.
- Pressing it flips `aria-pressed`. Off settles every reveal at its final state and stops every loop.
- The choice is remembered on the visitor's device until pressed again.

The only things stored on a visitor's device are:
- the motion choice;
- a flag, for the browsing session, that the intro has played;
- in the studio only, the owner's token for that tab's browsing session.

**Intro cover.**
1. On the first page of a browsing session, a full-viewport cover sits outside the main content and is hidden from assistive technology. It shows the name `Ivo Kastrel` on near-black.
2. It lifts away and is gone within three seconds, leaving the page usable.
3. Later pages in that session show no cover.

**Studio.**
- `Create draft` opens an empty editor. `Save draft` creates the case study.
- `Edit <title>` loads the row into the editor. `Save` sends only the changed editable fields.
- `Publish`, `Unpublish` and `Delete` act at once on their row, and the table refreshes from the server after each action.
- `Mark resolved` resolves its inquiry. On the resolve conflict answer, the row refreshes and shows `Resolved`.
- Any studio answer saying the token is refused sends the browser to `/studio/login`.
- `Sign out` ends the token on the server, forgets it in the tab, and goes to `/studio/login`.

**Hover and focus.** A home journal cover is dimmed at rest. It brightens to full strength on pointer hover and when its card link has keyboard focus, and dims again when either ends. Every focusable control shows a bright red focus ring at least two CSS pixels thick, offset from the control.

**Accessibility.**
- Landmarks on every page, one level-one heading per page, and ordered headings.
- Every form control is labelled.
- Split headings keep their whole text as the accessible name.
- The intro cover, the stage grid, the equaliser bars, the plus markers and the generated visuals' decorative layers are hidden from assistive technology.
- Each generated visual that carries meaning has a written alternative that names its record.

### Visual design (DP-63, DP-64, DP-65, DP-66, DP-67, DP-68, DP-69, DP-70)

The north star is tension under restraint. The first frame feels like the opening of a dark film. Every later chapter feels like a slow camera move toward the work.

**Colour roles.**

| Role | Described colour |
|---|---|
| page field and footer base | near-black neutral |
| panels, dialog and studio surfaces | near-black, one step lighter than the page |
| primary accent: hairlines, large script words, the figures band | deep, vivid blood red |
| bright accent: focus ring, error marks, the live dot | mid, vivid red |
| live dot flash | a hotter, lighter red than the bright accent |
| body text | near-white neutral |
| mark and close cross | near-white |
| muted text | light warm grey |

The deep red is never used for body-size text, and never for any text sitting directly on the page field. Text on the red band is near-white. Body text holds at least 4.5 to 1 contrast against its background, and large text at least 3 to 1 (WCAG 2.2 AA). Meaning is never carried by colour alone:
- the current filter is also underlined;
- an error is also written in words;
- a draft row also reads `Draft`.

**Gradients.**
- **Footer.** It glows from the bright red at its bottom edge into near-black by its middle, along a line tilted slightly off level.
- **Hero.** It layers three soft glows: deep red at upper left, deep red at bottom centre, and a dark warm red near the top.
- **Generated visuals.** These are compositions of these gradients at different angles, crossed by the stage grid. Each record's composition is derived from its stored fields, so the same record always draws the same visual and neighbours differ visibly.

**Type.** The site uses only fonts already on the visitor's device and ships no font file.
- **Headline face.** A neo-grotesque sans at its thinnest weight, in uppercase. Giant headline lines are about five times the body size on desktop, set with tight line spacing so lines nearly touch. Smaller headline lines are about three and a half times the body size.
- **Body face.** The same family at regular weight for body copy and labels.
- **Script face.** A handwritten brush script, never smaller than about twice the body size. It is used for the `JOURNAL` title, the figures, the closing words and the `3D WEB` service title.

The largest words are the thinnest.

**Icons.** Every icon is inline vector line art in near-white or the deep red:
- the close cross: two thin crossing strokes;
- the process ring: a fine unfilled circle;
- the plus marker: two thin strokes;
- the stage grid: sixteen deep red hairlines forming diagonals and a centred square;
- the personal mark: an original symmetric winged glyph.

**Composition and density.**
- **Public chapters.** Each chapter is at least one viewport tall, with wide margins.
- **Awards.** The cards stand upright on a floor of red and black triangles.
- **Studio.** Compact rows.
- **Touch targets.** Every control is at least 44 by 44 CSS pixels.

### Motion and effects (DP-56, DP-58, DP-59, DP-60, DP-61, DP-62, DP-73)

Motion means something here. Words arrive, panels rise and the chrome is alive. Nothing moves for its own sake, and every motion lands on a readable final state.

| Motion | Meaning | Feel and timing | Reduced-motion or Motion-off substitute |
|---|---|---|---|
| split heading reveal | a chapter arrives | each word rises a short way out of a soft blur and settles quickly, in about half a second; words are staggered by under a tenth of a second; the whole heading is done within about one second of entering view | heading shown at once at its final state |
| hero statement slide | the camera moves on | scroll-linked, described below | statement rests still at its starting place |
| inquiry dialog | a curtain rises | rises from the bottom edge in about half a second, decelerating into place; closes downward in about a third of a second | appears and disappears at once |
| card hover | the card can be opened | lifts slightly and brightens in about a quarter of a second, settling without overshoot | brightens only, no lift |
| journal cover brighten | focus or hover | dimmed to full strength in about a quarter of a second | change happens at once |
| intro cover | the visit begins | the name holds briefly, then the cover lifts away; gone within three seconds | skipped |
| live dot | the studio is online | pulses with a hot red flash about once every one and a half seconds | still, solid |
| equaliser bars | the site is playing | bars rise and fall at three heights, each at a slightly different speed | bars rest at mixed still heights |
| ring turn | time passing | process rings and plus markers each turn a full circle in about twenty seconds | still |
| fluid drift | atmosphere | the hero glows and the smoky blot drift and swell very slowly, one cycle per fifteen seconds or longer | still |
| grain jitter | film texture | a faint noise layer over the hero shifts a few times a second | still |

**Signature interaction: the hero statement.**
1. At the top of the page, the statement's first letter sits at the left margin.
2. As the visitor scrolls the hero up out of view, the whole line slides left in direct step with scroll. When the hero's bottom edge reaches the top of the viewport, the line has slid about one quarter of the viewport width.
3. The smoky blot crosses the letters as they pass.
4. Scrolling back slides the line right, step by step, until it returns to its starting place.
5. Without scrolling it does not move.

**Banned loops.** No endless animation runs other than the five loops in the table: live dot, equaliser bars, ring turn, fluid drift and grain jitter. Loops run only while their chapter is in view, and never move the layout.

**Reduced motion.** A reduced-motion request overrides the `Motion` button. While reduced motion is requested, every substitute in the table applies, even if `Motion` is pressed. Stopping the scroll never leaves a chapter half hidden. Smoothed scrolling, if used, is off under reduced motion and when `Motion` is off.

### Feedback states (DP-07, DP-22, DP-31, DP-37, DP-38, DP-46, DP-47, DP-51, DP-57)

| Action | Pending | Success | Field error | Refusal or outage |
|---|---|---|---|---|
| inquiry submit | `Submit` disabled; `Inquiry status` reads `Sending your message…` | `Inquiry status` reads `Thanks, your message is in. I reply within two working days.` and takes focus | `Inquiry errors` heading `Check the highlighted fields.` with one link per field, and the field message from API beside each field | `Inquiry errors` reads `Your message could not be sent. Try again in a minute.` |
| sign in | `Sign in` disabled; button reads `Signing in…` | browser goes to `/studio` | field message beside `Email` or `Password` | `Sign-in errors` shows the API's refusal or lockout reason; on outage it reads `Sign-in is unavailable. Try again in a minute.` |
| studio save, publish, unpublish, delete, resolve | the pressed button is disabled | `Studio status` reads `Draft created.`, `Saved.`, `Published.`, `Unpublished.`, `Deleted.` or `Marked resolved.` | the editor marks each failing field with its field message; `Studio errors` reads `Check the highlighted fields.` | `Studio errors` shows the API's reason for a conflict; on outage it reads `That change could not be saved. Try again in a minute.` and the editor keeps its values |
| discipline filter | the list stays as it is until the new one arrives | `Catalogue status` reads `<count> case studies shown.`, or `1 case study shown.` when `<count>` is 1, where `<count>` is the number of cards listed | none | if the in-page update fails, the browser loads the link's address as a full page |

When a list is empty, it shows `Nothing here yet.` and a `link "See all work"` to `/work`. The thanks text stays true in every state: an accepted inquiry has been stored in PostgreSQL.

## Backend

### API (DP-01, DP-02, DP-06, DP-08, DP-12, DP-15, DP-17, DP-19, DP-26, DP-28, DP-29, DP-34, DP-35, DP-39, DP-42, DP-43, DP-44, DP-49, DP-50, DP-75)

Every answer under `/api`, refusals included, is `application/json`, except 204 answers, which have no body. Requests that carry a body must send `application/json` (a `charset` parameter is allowed). Bearer auth (`Authorization: Bearer <token>`) is required on every `/api/studio/` endpoint and on `POST /api/auth/logout`, and on nothing else.

| Endpoint | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/health` | none | 200 `{"status":"ok"}` | 503 `{"status":"unavailable"}` |
| `POST /api/auth/login` | `{"email": string, "password": string}` | 200 `{"token": "<token>"}` | 401 sign-in refusal, 422, 429 lockout |
| `POST /api/auth/logout` | none | 204 | none beyond precedence |
| `GET /api/cases` | optional `discipline` | 200 array of `{slug, title, discipline, summary, year, featured, ordinal}` in catalogue order | 422 `errors.discipline` |
| `GET /api/cases/{slug}` | none | 200 `{slug, title, discipline, summary, challenge, approach, outcome, stack, year, featured, ordinal, total, previous, next}`; `previous` and `next` are `{slug, title}` | 404 |
| `GET /api/journal` | none | 200 array of `{slug, title, excerpt, published_on}`, newest first | none |
| `GET /api/journal/{slug}` | none | 200 `{slug, title, excerpt, body, published_on}` | 404 |
| `GET /api/recognitions` | none | 200 array of `{award, issuer, awarded_on}` | none |
| `GET /api/figures` | none | 200 array of `{value, label, caption}` | none |
| `POST /api/inquiries` | `{name, phone, email, message, project_type?}` | 201 `{"id": <id>, "status": "new"}`; a duplicate gets 200 with the stored inquiry's `{id, status}` | 422 |
| `GET /api/studio/cases` | none | 200 array of studio rows | none |
| `POST /api/studio/cases` | editable fields plus `slug` | 201 studio row | 422, 409 slug conflict |
| `PATCH /api/studio/cases/{id}` | changed editable fields | 200 studio row | 404, 422 |
| `POST /api/studio/cases/{id}/publish` | `{"published": true}` or `{"published": false}` | 200 studio row | 404, 422, 409 transition conflict |
| `DELETE /api/studio/cases/{id}` | none | 204 | 404 |
| `GET /api/studio/inquiries` | none | 200 array of `{id, name, phone, email, message, project_type, status, received_at, resolved_at}`, newest `received_at` first, ties by higher `id` first | none |
| `POST /api/studio/inquiries/{id}/resolve` | none | 200 inquiry row with `status` `resolved` and `resolved_at` | 404, 409 resolve conflict |

**Field formats.**
- A studio row is `{id, slug, title, discipline, summary, challenge, approach, outcome, stack, year, featured, position, published, published_at, created_at, updated_at}`.
- Ids are integers. A path id that is not a stored integer id answers 404.
- Timestamps are ISO 8601 with an offset. `published_on` and `awarded_on` are `YYYY-MM-DD`.
- `ordinal` and `total` are strings of at least two digits, zero-padded: `"01"`, `"05"`.
- Collections are top-level JSON arrays.

**Refusal shape.** Every refusal is `{"error": "<reason>"}`. A validation refusal is `422 {"error": "Some fields need attention.", "errors": {"<field>": "<message>"}}`, naming every failing field in that request at once.

| Status | Reason |
|---|---|
| 400 | `The request body is not a JSON object.` (invalid JSON, or valid JSON that is not an object) |
| 401 on studio endpoints and logout | `Sign in to continue.` |
| 401 sign-in refusal | `Email or password is incorrect.` |
| 404 | `Not found.` |
| 405 | `Method not allowed.`, with an `Allow` header listing the address's methods |
| 409 slug conflict | `That slug is already in use.` |
| 409 publish on a published case study | `This case study is already published.` |
| 409 unpublish on a draft | `This case study is already a draft.` |
| 409 resolve conflict | `This inquiry is already resolved.` |
| 413 | `The request body is larger than 32,768 bytes.` |
| 415 | `Send the request body as application/json.` |
| 429 lockout | `Too many sign-in attempts. Try again later.`, with a `Retry-After` header |
| 503 | `The service is briefly unavailable. Try again in a minute.` |

**Field messages.** `<min>` and `<max>` come from the limits tables in Business rules.

| Problem | Message |
|---|---|
| missing, or blank after trimming, where required | `This field is required.` |
| too long | `Use at most <max> characters.` |
| too short (inquiry name, message, phone) | `Use at least <min> characters.` |
| integer out of range | `Use a whole number from <min> to <max>.` |
| not a JSON string | `Use text.` |
| not a JSON integer (booleans and strings are not integers) | `Use a whole number.` |
| not a JSON boolean | `Use true or false.` |
| slug shape | `Use lowercase letters, digits and single hyphens.` |
| discipline | `Choose ui-ux, 3d-web or frontend.` |
| project type | `Choose ui-ux, 3d-web, frontend or other.` |
| phone characters | `Use digits, spaces, +, -, ( and ) only.` |
| email | `Enter a valid email address.` |
| control characters in a name | `Remove control characters.` |
| key outside the accepted keys | `This field cannot be set.` |
| empty edit | key `body`: `Send at least one field to change.` |
| publish without a summary or outcome | `Add a summary before publishing.` or `Add an outcome before publishing.` |

**Error precedence.** This one order holds across the whole API, and the first failing check answers:
1. An address matching no route answers 404. A known address with an unlisted method answers 405.
2. A body over the size limit answers 413.
3. On studio endpoints and logout, a missing, unknown, revoked or expired token answers 401.
4. On endpoints that take a body, a non-JSON content type answers 415.
5. A body that is not a JSON object answers 400.
6. An unknown id or slug answers 404.
7. On login, a locked email answers 429.
8. Every field problem, including keys that cannot be set, answers in one 422.
9. State conflicts answer 409: a slug in use, a publish transition, or a resolve.
10. The publish requirement for a summary and an outcome answers 422.

A duplicate inquiry inside the window is answered with its stored inquiry after step 8.

### Business rules (DP-02, DP-03, DP-04, DP-05, DP-06, DP-08, DP-09, DP-11, DP-12, DP-13, DP-14, DP-17, DP-18, DP-19, DP-20, DP-21, DP-26, DP-27, DP-28, DP-29, DP-30, DP-32, DP-33, DP-34, DP-35, DP-37, DP-39, DP-40, DP-42, DP-43, DP-45, DP-48, DP-49, DP-50)

**Sign-in.**
- **Passwords.** Stored only as a salted hash.
- **Email matching.** Emails are compared after trimming and lowercasing.
- **What a sign-in does.** A successful sign-in creates a `sessions` row with a fresh random token. A token never comes from, or is affected by, a role or account field in any request body.
- **One refusal.** A wrong password and an unknown email get the same sign-in refusal: same status, same body, no token, no session row.
- **Every attempt is recorded.** Each attempt with a well-formed body writes one `sign_in_attempts` row. This covers refused, locked and successful attempts, for known and unknown emails alike.
- **Lockout.** An email is locked while five or more refused attempts for it fall inside the trailing lockout window and after its latest successful sign-in. Locked attempts count as refused.
  - The lockout window is 15 minutes (900 seconds) unless `SIGN_IN_LOCKOUT_WINDOW_SECONDS` sets it.
  - While locked, every attempt gets the lockout answer, even with the correct password: no token and no session row. Known and unknown emails are treated identically.
  - `Retry-After` is the whole number of seconds until the lock would lift if no further attempt arrived. It is at least 1 and at most the window length.
  - The lock lifts on its own once fewer than five refusals remain inside the window.
- **Database clock.** Counting uses only stored rows and the database server's clock, so it holds across every worker and every restart.

**Sessions.**
- **Lifetime.** A session's `expires_at` is its `created_at` plus the session lifetime: 12 hours (43,200 seconds) unless `SESSION_LIFETIME_SECONDS` sets it.
- **Expiry.** A token is refused once the database clock is at or after `expires_at`. Using a token never moves `expires_at`.
- **Sign-out.** `POST /api/auth/logout` sets `revoked_at`, and a revoked token is refused.
- **Scope.** Both rules apply to every studio endpoint and to logout itself, before any record is read or changed.

**Case study lifecycle.** A case study is either a draft or published.

| From | Action | Result |
|---|---|---|
| none | create | draft: `published` false, `published_at` null |
| draft | publish | published; `published_at` stamped with the database clock |
| published | unpublish | draft; `published_at` cleared |
| published | publish | 409 publish conflict; nothing changes |
| draft | unpublish | 409 unpublish conflict; nothing changes |
| either | edit | fields change, `updated_at` stamped |
| either | delete | the row is gone |

- **Publish requirement.** Publishing requires a non-blank `summary` and `outcome`. Blank means empty after trimming whitespace. An edit that would leave a published case study with a blank `summary` or `outcome` is refused the same way.
- **Concurrent publishes.** Of several simultaneous publishes of one draft, exactly one succeeds. The rest get the publish conflict answer, and `published_at` is written once.
- **Effect on public reads.** Every public read reflects the current state on the next request.

**Case study fields.**
- **Editable fields.** Create and edit accept exactly these keys: `title`, `discipline`, `summary`, `challenge`, `approach`, `outcome`, `stack`, `year`, `featured`, `position`. Create also accepts `slug`.
- **Refused keys.** Any other key is refused with the cannot-be-set message and nothing changes. This includes `published`, `published_at`, `id`, `created_at`, `updated_at`, `ordinal`, `total`, `role`, unknown keys, and `slug` on an edit even when the value is unchanged. Refused keys are named alongside any other field errors.
- **Required on create.** `title`, `slug`, `discipline`, `year` and `position` are required. The other text fields default to empty, and `featured` defaults to false.
- **Null.** No field accepts null.
- **Edits.** An edit sends one or more editable fields. Text values are stored trimmed.

| Field | Rule (limits inclusive) |
|---|---|
| `title` | string, 1 to 80 characters |
| `slug` | string, 1 to 64 characters, matching the slug shape |
| `discipline` | `ui-ux`, `3d-web` or `frontend`; shown to visitors as `UI/UX`, `3D WEB`, `FRONTEND` |
| `summary`, `stack` | string, 0 to 200 characters |
| `challenge`, `approach`, `outcome` | string, 0 to 2000 characters each |
| `year` | JSON integer, 1990 to 2100 |
| `position` | JSON integer, 1 to 9999; positions need not be unique |
| `featured` | JSON boolean |

- **Counting characters.** Lengths are counted after trimming. Each Unicode code point counts as one character, so `é`, `✦` or a single-code-point emoji each count as one.
- **Slug shape.** Lowercase letters and digits in groups joined by single hyphens, with no leading or trailing hyphen.
- **Slug uniqueness.** A slug is unique across all case studies, drafts included, and is fixed at creation. The database holds this, so of several simultaneous creates for one new slug exactly one lands and the others get the slug conflict answer.

**Catalogue order and derived values.**
- **Order.** The catalogue order of published case studies is `position` ascending, then `slug` ascending. These all follow that one order: the `/work` list, the API list, the home selected work (published and featured only), each ordinal, each total, and each pair of neighbours.
- **Ordinal.** A case study's place in the full published set, counting from 1, written with at least two digits.
- **Total.** The size of the published set.
- **Neighbours.** `previous` and `next` wrap: the first case study's `previous` is the last one, and the last one's `next` is the first. With a single published case study, both neighbours are itself.
- **Derived at read time.** None of these values is stored.
- **Discipline filter.** A discipline filter keeps each case study's ordinal from the full set. `discipline` must be exactly one allowed value:
  - On the API, any other value, an empty value or a repeated parameter answers 422 naming `discipline`.
  - On `/work`, the same cases answer 302 to `/work`.
- **Other parameters.** All other query parameters on public reads (`/`, `/work`, `/journal`, `/api/cases`, `/api/journal`) are ignored. They never widen or change the answer.

**Public visibility.**
- **Case studies.** Only published case studies exist publicly.
- **Journal entries.** A journal entry is public when it is published and its `published_on` is on or before today's date in the studio's business time zone, `Pacific/Auckland`. The date is judged at each request, so an entry appears with the first request after midnight in Auckland on its date. The API list, `/journal`, the entry's own page and the home chapter (three newest public entries) all use this rule. Public entries are listed newest `published_on` first, with ties broken by `slug` ascending.
- **Not found.** Anything not public answers exactly like an address that never existed: the same 404 status and a byte-identical body on both the API and the HTML page. No not-found body contains the requested path or slug, or anything that varies by request.
- **Exact slugs.** Slug lookups match only the exact stored slug. Uppercase forms, a trailing slash, percent-encoded characters and numeric ids answer 404 with no redirect.
- **Trailing slashes.** No address other than `/` answers with a trailing slash.

**Inquiries.**

| Field | Rule |
|---|---|
| `name` | string, 1 to 120 characters after trimming, no control characters (code points 0 to 31) |
| `phone` | string, 7 to 20 characters after trimming, only digits, spaces, `+`, `-`, `(` and `)` |
| `email` | string, at most 254 characters, as qualified below |
| `message` | string, 10 to 4000 characters after trimming |
| `project_type` | optional; when present, `ui-ux`, `3d-web`, `frontend` or `other` |

- **Email check.** The email must contain exactly one `@` and no whitespace. The part before the `@` is 1 to 64 characters. The domain has at least one dot, with no empty label. The check runs in time proportional to the address length, so a 20,000-character address is refused within 2 seconds.
- **Accepted keys.** Any key other than the five above is refused with the cannot-be-set message.
- **Storage.** A valid inquiry is stored with `status` `new` and `received_at` from the database clock.
- **Duplicates.** A duplicate is a valid inquiry whose trimmed, lowercased email and trimmed message equal a stored inquiry's, arriving less than 60 seconds after that inquiry's `received_at`.
  - A duplicate is not stored. It is answered with the stored inquiry's `id` and current `status`.
  - Simultaneous identical submissions store exactly one row, and every answer carries that row's `id`.
  - From 60 seconds onward the same text is a new inquiry.
- **Resolving.** Resolving is the one guarded transition `new` → `resolved`. It stamps `resolved_at` from the database clock.
  - Resolving a resolved inquiry gets the resolve conflict answer, and `resolved_at` keeps its first value.
  - Of several simultaneous resolves, exactly one succeeds.
- **Privacy.** No public read or page ever shows an inquiry.

**Read-only records.** Journal entries, recognitions and figures are seeded and read-only in this scope. Recognitions and figures are listed by ascending `position`.

### Services (DP-23, DP-24, DP-25)

PostgreSQL is the only backing service. It is already running at `DATABASE_URL`, connected as a non-superuser database owner. Do not install or start another copy. Every record lives in PostgreSQL. No in-memory dictionary, local file or stub may stand in for a table. The generated visuals are drawn from stored fields and are not stored.

**Data model.** The database has exactly these eight tables. Timestamps are stored with their time zone.

| Table | Columns |
|---|---|
| `accounts` | `id`, `email` unique, `password_hash`, `role` (`owner`), `created_at` |
| `sessions` | `id`, `account_id`, `token` unique, `created_at`, `expires_at`, `revoked_at` (null while live) |
| `sign_in_attempts` | `id`, `email` (trimmed, lowercased), `succeeded` boolean, `attempted_at` |
| `case_studies` | `id`, `slug` unique, `title`, `discipline`, `summary`, `challenge`, `approach`, `outcome`, `stack`, `year`, `featured`, `position`, `published`, `published_at`, `created_at`, `updated_at` |
| `journal_entries` | `id`, `slug` unique, `title`, `excerpt`, `body`, `published_on` date, `published`, `created_at` |
| `recognitions` | `id`, `award`, `issuer`, `awarded_on` date, `position` |
| `figures` | `id`, `value`, `label`, `caption`, `position` |
| `inquiries` | `id`, `name`, `phone`, `email`, `message`, `project_type` nullable, `status` (`new` or `resolved`), `received_at`, `resolved_at` nullable |

**Schema and seed on start.**
- The app creates its schema on every start without harming existing data.
- It loads the seed whole, in one guarded step, and only into a database that has never been seeded. All workers start at the same moment against the same database. Exactly one copy of each seeded row lands and no worker fails.
- Once seeded, a database is never seeded again. A seeded case study the owner deleted stays deleted, and an owner's edit, publication or resolution is never reverted.

**Outage.** When PostgreSQL is unreachable, the outage behaviour in Server boundary applies.

### Seed data (DP-11, DP-23, DP-32, DP-39)

Every seeded person, client and business is invented.

**Account.** `owner@example.com`, role `owner`, password `deku-demo-pw-2026`. This is benchmark fixture data, not a secret. It is hashed like any password.

**Case studies.** Every one has a non-empty summary, challenge, approach, outcome and stack, written for an original fictional client.

| position | title | slug | discipline | year | featured | state |
|---|---|---|---|---|---|---|
| 1 | Hollow Signal | `hollow-signal` | `3d-web` | 2026 | yes | published |
| 2 | Ember Ledger | `ember-ledger` | `ui-ux` | 2025 | yes | published |
| 3 | Night Cartography | `night-cartography` | `frontend` | 2025 | yes | published |
| 4 | Vanta Atelier | `vanta-atelier` | `3d-web` | 2024 | no | published |
| 5 | Low Tide Radio | `low-tide-radio` | `ui-ux` | 2024 | no | published |
| 6 | Red Meridian | `red-meridian` | `frontend` | 2026 | no | draft |

Hollow Signal's summary is `A launch film for a sound hardware brand, told as a single descent through red light.`

For example, with the seed data at start:
- `GET /api/cases` answers five case studies with ordinals `01` to `05`.
- The discipline filters answer 2 (`3d-web`), 2 (`ui-ux`) and 1 (`frontend`).
- `/work/hollow-signal` reads `01 / 05`, and its `previous` is Low Tide Radio.

**Journal entries.**

| title | slug | published_on | published |
|---|---|---|---|
| Motion Beyond Animation | `motion-beyond-animation` | 2026-07-01 | yes |
| The Psychology of Dark Interfaces | `the-psychology-of-dark-interfaces` | 2026-06-14 | yes |
| Designing Experiences, Not Websites | `designing-experiences-not-websites` | 2026-05-22 | yes |
| Unfinished Light | `unfinished-light` | 2026-08-03 | no |

Each entry has an excerpt and at least three body paragraphs of original text.

**Recognitions,** all issued by `Juried Web Annual`, in this order:
1. `Developer Award` (2026-09-26)
2. `Site of the Day` (2026-09-12)
3. `Honorable Mention` (2026-08-30)

**Figures,** in this order:

| value | label | caption |
|---|---|---|
| `10+` | `Brands served` | `Each one different. Each one demanding something sharper.` |
| `25+` | `Projects shipped` | `Each one pushed beyond the obvious.` |
| `6+` | `Years of practice` | `Learning fast. Moving faster.` |

No inquiry, session or sign-in attempt is seeded.

## Technical requirements

### Deployment (DP-23, DP-24, DP-75)

Python 3 with pip is available.
- **Install.** `install` brings in the app's dependencies from its requirements file. The app is installed and run as an unprivileged user who cannot write the system packages, so `pip` falls back to that user's own site on its own and passing `--user` does the same; either way the manifest calls tools as `python -m <tool>` or by path.
- **Manifest.** `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"pip install --no-cache-dir -r requirements.txt","build":"","serve":"python -m gunicorn --workers 3 --bind 0.0.0.0:${APP_PUBLIC_PORT:-4173} app:app"}
```

- **Serve.** `serve` stays in the foreground and starts a production server with at least two worker processes. It binds `0.0.0.0` on port 4173 and honours `APP_PUBLIC_PORT`. A development server, a debug or auto-reload mode, and binding to `127.0.0.1` are all ruled out.
- **Restarts.** `serve` may be stopped and started again against the same database at any time.
- **First start.** The app creates its schema and seed on start with no manual step. `GET /api/health` answers its ready body once the app and its database are ready.
- **State.** No state is kept outside PostgreSQL.

### Configuration and secrets (DP-04, DP-09, DP-77)

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection URL, read at start |
| `APP_PUBLIC_PORT` | port to answer on (4173 when unset) |
| `APP_PUBLIC_URL` | the app's public address, where an absolute URL is needed |
| `SIGN_IN_LOCKOUT_WINDOW_SECONDS` | lockout window length in seconds (900 when unset) |
| `SESSION_LIFETIME_SECONDS` | session lifetime in seconds (43,200 when unset) |

None of these values is written into the source. No credential and no connection URL ever reaches the browser.

### Server boundary (DP-15, DP-44, DP-74)

- **Same origin.** Every script, style and generated visual is served by the app itself. Pages fetch nothing from any other origin, and the inquiry form posts only to the app.
- **Request size.** Request bodies up to 32,768 bytes are read. A body of 32,769 bytes or more is refused without being parsed, with nothing stored.
- **Error pages.** Errors under `/api` are always JSON. An unexpected failure answers 500 in the refusal shape with the reason `Something went wrong.` and never an HTML page. Every refusal listed in API is a client error, never a 500.
- **Never served.** The server never serves its source files, its manifest, its dependency list or its environment. Addresses such as `/app.py`, `/run.json`, `/requirements.txt` and `/.env` answer 404.
- **Database unreachable.** The server still starts and keeps retrying the database, recovering without a restart. Until it reconnects:
  - `GET /api/health` answers its 503 body;
  - other `/api` calls get the 503 refusal;
  - pages answer 503 with a plain page in the site chrome reading `The studio is briefly offline. Try again in a minute.`

### Browser support and performance (DP-56, DP-70, DP-71)

The app supports current Chromium-class browsers at 375×812, 768×1024 and 1280×800, and any width from 320 CSS pixels up. It works with touch input and with reduced motion requested.
- The first readable text appears without waiting for any script or generated visual.
- The home page is usable within three seconds on a fresh load.
- Each public API read answers within one second with a few hundred case studies and a few thousand inquiries stored.
- The case study index has no pagination.

## Working rules

- IF-01: `/app/run.json` has `"_schema":"run-manifest-v1"` and string `install`, `build` and `serve` commands, where:
  - `install` brings in the app's dependencies from its requirements file;
  - `serve` starts a production server binding `0.0.0.0` in the command itself, with at least two workers set by `--workers`/`-w` or by `WEB_CONCURRENCY` in that same command;
  - no command runs a development server.
- IF-02: `/app/USER_README.md` names `owner@example.com` and the password `deku-demo-pw-2026`.
- IF-03: `/app` ships no font, image, audio, video or 3D model file; every visual is generated by the app.
- IF-04: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its licence. "Shipped packages" means the production dependency tree that `install` brings in from the requirements file. Every licence is MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0, MPL-2.0 or LGPL.
- IF-05: PostgreSQL is the only datastore: no SQLite or other database file, no cache server, no queue and no files written for records.

## Engineering standards

- The Python reads as idiomatic server code, and the templates as plain templates, with names taken from this brief: case study, discipline, ordinal, total, neighbour, publish, journal entry, inquiry, resolve, sign-in attempt, session.
- Each domain rule is decided in exactly one place in the source: the publish rule, the catalogue order with ordinals, totals and neighbours, the editable-field list, the sign-in lockout, the journal's business-day rule and the duplicate-inquiry window.
- Every API refusal is built in one place in the one JSON shape, including the framework's own errors (404, 405, 413, 415, 400).
- The time rules read the database clock or the `Pacific/Auckland` date, never a naive local time.
- No abstraction has a single trivial implementation, and no defensive check guards a state the code cannot reach.
- There is no dead, commented-out or unreachable code.
- There are no features beyond this brief.
