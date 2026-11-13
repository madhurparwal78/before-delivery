# Sorts & Quoins Galley

Galley, from Sorts & Quoins, is a hosted documentation platform for small software teams. A team writes markdown pages that can use a fixed set of components. It arranges them in a sidebar of tabs and groups, imports an OpenAPI file to generate API reference pages, previews drafts, and publishes a public docs site. Publishing is refused while any internal link or component is broken. Renaming a page files a single-hop redirect and rewrites the links that point to the page. One TypeScript app serves both the signed-in editor and the public reader site on the same port. The app uses three backing services and nothing else. Postgres stores everything Galley keeps. MinIO file storage holds published site snapshots, imported OpenAPI files exactly as uploaded, and uploaded images. Mailpit receives team invite mail. These are out of scope: sign-in through any outside provider or magic link, Git or GitHub sync, custom domains, billing, webhooks, importing from a URL, embeds of outside content, plugins, custom stylesheets or scripts, service workers, and any AI or language-model feature (no assistant, chat, AI search, summaries, writing help or API keys). Do not add any other datastore, queue, search engine, CDN, analytics service or error-tracking service.

## Problem and users

Small software companies, often one founder with a few contractors, keep their product docs in a hosted docs tool or a static generator. Pages get renamed and moved all the time. Every move breaks deep links that support macros, blog posts and search engines still point to. Most tools make you add redirects by hand, one per page. Link checkers in CI only catch a break after it ships. Redirect chains (A to B to C) build up until a rename loops back and readers get a 404. API reference pages drift from the OpenAPI file the team actually shipped, because nobody kept that exact file. Teams pay for this in support tickets, lost search traffic and hours spent hand-editing redirect maps.

Galley makes link integrity part of the editor. A rename files one single-hop redirect and rewrites the links that point to the page. Publishing is refused while any internal link, anchor or component is broken. Every published snapshot and every imported OpenAPI file is kept exactly as it was.

- **Owner**: runs the team's docs site, decides who can edit and publish, and cuts new doc versions. Uses Galley weekly.
- **Editor**: writes and reorganises pages, imports the OpenAPI file, previews and publishes without breaking links. Uses Galley daily.
- **Viewer**: reads drafts and previews inside the team and checks analytics without changing anything. Uses Galley weekly.
- **Reader**: anyone on the public site who wants an answer through search or the sidebar, tries an endpoint and rates the page. Daily.

## Journeys

1. **Write a page.** Start: an editor is signed in on the editor page of a draft page. They type `/` on an empty line, filter the component menu, insert a Tabs snippet with Enter, fill it in, and upload an image with the `Image` button. The page autosaves and announces the saved message. They open Preview in a new tab. End: the preview shows the rendered components and the image, and a pasted `<script>` tag appears as plain text.
2. **Reorganise and rename.** Start: an editor is in the `Pages` tree of a published version. With the keyboard they move a page into the next group and move a group up one place. Then they press F2 on a page, type a new path and press Enter. End: the old path is struck through, the new path is set, a redirect chip lands in the proof margin's Redirects list, the rewritten-link count shows the number of links fixed, and focus is on the renamed row. A second editor's tree has shown each change live.
3. **Publish through the gate.** Start: a version has two broken links and a misplaced `<Tab>`. The editor presses `Ctrl+Shift+P`. The check is announced, then the Publish dialog lists the problems. The editor activates the first row, lands on that line, fixes it, and watches the count drop after autosave. They fix the rest and publish. End: the live site shows the new snapshot, and the publish report says `published`.
4. **Ship an API reference.** Start: an editor has the team's OpenAPI file. They import it. One reference page per operation appears in the `API reference` group, and `Download source` returns the exact file. They publish. A reader opens an operation and fills the Try it panel by keyboard. End: the panel shows the chosen documented response and announces its status line.
5. **Share a draft.** Start: an editor is changing a page that is not published yet. They create a preview link and send it to an outside reviewer. The reviewer opens it signed out and sees only that page. A colleague opens the same page, and each sees the other's presence notice. The colleague saves first, so the editor's next save is refused with the conflict message and their text is kept. End: the preview link stops working after it expires, showing the expiry message.
6. **Read on a phone.** Start: a reader on a 375-pixel-wide phone follows an old link to a renamed page. They land on the new page at the same heading. They open the `Menu` drawer, switch to another version, use `On this page`, search by keyboard, and rate the page. End: the vote is thanked, and an editor's analytics screen updates live.
7. **Run the team.** Start: the owner is on the team screen. They invite a viewer by email. The viewer joins from the mailed link and sees the editor with no edit or publish controls. The owner promotes them to editor. End: the viewer's open session gains the edit controls without a reload. An invite sent while mail was down shows as held, then changes to sent on its own once mail is back.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** The app installs, builds and serves from `/app/run.json` as set in Deployment, and its health route answers as set there on every instance, including outage instances.
- **DP-02 — Credentials from the environment** Every service URL and credential is read at start from the environment variables named in Configuration and secrets, and none is hard-coded in source or sent to the browser.
- **DP-03 — Same-origin server boundary** The server enforces the body limits, origin rule and never-served list in Server boundary, and no page or request the app makes ever goes to an outside host.
- **DP-04 — Grading routes behind a switch** The seed and outage routes described under Grading routes work only when `GRADING_ROUTES` is `on` and answer as not found otherwise.
- **DP-05 — Autosave and page JSON** The editor saves a page with its revision after the autosave pause and announces the saved message, and page JSON returns the saved source and the next revision, as qualified in Writing pages.
- **DP-06 — Slash menu** Typing `/` at the start of an empty line opens the `Insert component` listbox, which filters, moves and inserts each component's published snippet by keyboard while focus stays in the page source.
- **DP-07 — Allowlisted page source** Preview, shared previews and the public site render only the published markdown and the six published components, show raw HTML as escaped text, and make links only from the published link kinds.
- **DP-08 — Image upload to file storage** The `Image` button stores a PNG, JPEG or WebP image in file storage before it inserts the image line, and when storage is unreachable the page source stays unchanged and the editor shows the image-outage message.
- **DP-09 — Authoring a page end to end** An editor writes a page with the slash menu and an image, sees it autosave, and checks every component and an escaped script tag in preview.
- **DP-10 — Navigation JSON and live moves** Moving a page or group saves at once to navigation JSON and appears in every other open editor's `Pages` tree within one second without a reload.
- **DP-11 — Keyboard reorder in the Pages tree** The `Pages` tree is a single tab stop with published levels and positions, and Alt+ArrowUp and Alt+ArrowDown move the focused row across group boundaries, keep focus on it and announce the move.
- **DP-12 — Reorganising the sidebar end to end** An editor drags a page into another group and moves pages and a group by keyboard, including on a phone, while a second editor sees each move live.
- **DP-13 — One-hop redirects on rename** A rename files one redirect from the old path, points every older redirect straight at the new path, removes the redirect instead of looping when a page is renamed back, and rewrites and counts the links that point to the page, as qualified in Redirects.
- **DP-14 — Refused redirects** A rename or manual redirect that would loop, leave the site, point at a missing page or take a live page's path is refused with its published code and message, and nothing changes.
- **DP-15 — Public redirects and the not-found page** After a publish, an old path answers a single permanent redirect to the new path on the same site with the fragment kept, and a removed path answers with the not-found page and its search box.
- **DP-16 — Rename splice** Confirming a rename plays the strike, set, file and count phases on the published timers, keeps focus on the renamed row, announces the rename message, and under reduced motion shows the end state at once.
- **DP-17 — Renaming a page end to end** An editor renames a page twice by keyboard and publishes, and a reader who follows the oldest link lands on the renamed page's heading through a single redirect.
- **DP-18 — Publish gate rules** Checking a version reports every broken link, broken anchor, unknown or invalid component, invalid image and duplicate path with its published file, line, code and message in the published order, and any problem blocks the publish.
- **DP-19 — Publish dialog and live gate count** Publish, from the button or the shortcut, announces the check and then opens the blocked or confirm dialog; each problem row jumps to its line, and the gate count drops live as problems are fixed.
- **DP-20 — Storage-confirmed publish** A publish goes live only after its snapshot manifest is confirmed in file storage, replays by idempotency key, lets one of two concurrent publishes win, and on a storage failure keeps the previous snapshot serving and shows the publish-outage message.
- **DP-21 — Fixing a blocked publish end to end** An editor fixes each gate problem by keyboard from the dialog, watches the count fall to none, and publishes.
- **DP-22 — Live preview and reader update banner** The signed-in preview updates within one second of each autosave, and a reader who has a changed page open sees the update banner and gets the new content only after choosing Reload.
- **DP-23 — Shared preview links** A shared preview link shows only its one draft page without sign-in, accepts no writes, and shows the expiry message once it is revoked or older than `PREVIEW_LINK_TTL_MS`.
- **DP-24 — Presence and revision conflicts** Two editors on one page each see the other's presence notice, and a save against an old revision is refused with the conflict message while the local text is kept and autosave stops.
- **DP-25 — Previewing and sharing a draft end to end** An editor watches the preview update live, shares the draft with a signed-out reviewer until the link expires, then meets a conflict with a second editor and publishes.
- **DP-26 — Versions from their own snapshots** A new version is a copy of an existing one with its own ids, and each published version serves only pages from its own snapshot.
- **DP-27 — Version switcher** The public version switcher works by keyboard and keeps the page path when that page exists; otherwise it shows the version-fallback notice on the first page with focus on its heading. Every public page carries the published document title.
- **DP-28 — Switching versions end to end** An editor creates and publishes a new version, and a reader switches between versions by keyboard on a desktop and on a phone.
- **DP-29 — OpenAPI file kept byte for byte** An imported OpenAPI 3.0 JSON file is stored in file storage exactly as uploaded, and `Download source` returns those exact bytes.
- **DP-30 — Generated reference pages** Import creates the `API reference` group with one page per operation in file order, each page with the published sections in order, generated identically every time and keeping page ids on re-import.
- **DP-31 — Try-it panel** The `Try it` panel checks required parameters before sending, sends only to the app's own mock route, and shows and announces the chosen documented response, by keyboard and on a phone.
- **DP-32 — Trying an endpoint end to end** An editor imports the fixture, downloads its source and publishes, and a reader tries an operation by keyboard alone.
- **DP-33 — Search ranking** Public search returns each published page of the current version once, in its best band (title, then heading, then body text), in navigation order within a band, with the published result lines.
- **DP-34 — Search dialog** The `Search docs` dialog opens from its shortcuts, updates results and the announced count in place as the reader types, opens a result with Enter, and returns focus to its opener on Escape.
- **DP-35 — Finding an answer end to end** A reader opens search by shortcut, moves to a heading result by keyboard, lands on that heading, and searches again from the not-found page.
- **DP-36 — Reader layout and table of contents** The public site shows the published reader layout for each published width, with no sideways page scroll, and a table of contents that marks the heading in view.
- **DP-37 — Sidebar drawer** At phone width the `Menu` button opens the sidebar as a modal drawer that keeps focus inside, closes on Escape or a backdrop tap, returns focus to `Menu`, is hidden and inert when closed, reverses smoothly mid-motion, and is instant under reduced motion.
- **DP-38 — Reading on a phone end to end** A reader on a phone opens and closes the drawer, uses the `On this page` disclosure and heading links, and reads without sideways scrolling.
- **DP-39 — Tabs and code groups** Tabs and code groups follow the published tabs keyboard pattern; a code-group choice selects the same title in every code group on the page and is restored on the next load, and `Copy` announces the copied message.
- **DP-40 — Accordion, steps, callouts and cards** Accordions expose their state and keep closed content out of focus and find-in-page, and they open instantly under reduced motion; steps render as a numbered list with the published headings, callouts are named notes, and cards are links.
- **DP-41 — Using page components end to end** A reader works every component on a page by keyboard and finds their code-group choice kept after a reload.
- **DP-42 — Ratings and search terms recorded** A reader's helpful vote counts once per browser per page and can be changed or removed, and a search term is logged once per pause or Enter, as qualified in Feedback and analytics.
- **DP-43 — Live analytics** The analytics screen computes helpful percentages and search-term counts from stored votes and logged searches for the team's own sites, and updates within one second of each new vote or logged search.
- **DP-44 — Reading feedback end to end** A reader votes and searches while an editor and a viewer watch the analytics tables change live.
- **DP-45 — Sign-in and roles** Email and password sign-in returns only to same-site paths, viewers get no edit or publish controls and are refused on every write, and a role change reaches an open session within one second.
- **DP-46 — Team invites by mail** An owner's invite is mailed with the published subject and a single-use, expiring link, and when mail is unreachable the invite is held and retried until the mail server accepts it.
- **DP-47 — Managing the team end to end** An owner invites a viewer by keyboard, the viewer joins from the mailed link, and the owner promotes them to editor while their session is open.
- **DP-48 — Light, dark and system themes** The `Theme` radio group, in the editor top bar and on the public site, switches both between the published light and dark colours, follows the system setting by default, cross-fades (instantly under reduced motion), and is one choice shared by the editor and the public site that is remembered after a reload.
- **DP-49 — Editor layout** The editor shows its published layout at each published width, with the `Pages` tree in a drawer at phone width and the keyboard reorder and rename paths still working there.
- **DP-50 — Proof-room look** The reader site looks like a proofed galley page: warm paper ground, hairline rules, proof-red marks, serif headings, sans body text and monospace for every path and count, with no shadow deeper than a hairline.
- **DP-51 — Editor proof margin** The editor looks like the published page with a proof margin on the right that holds redirect chips, the rewritten-link count and gate issues as proof marks.

## Frontend

### Screens and layout (DP-09, DP-12, DP-36, DP-37, DP-38, DP-49, DP-50, DP-51)

Every route below is served by the one app on one origin.

| Route | Who | Screen |
|---|---|---|
| `/signin` | anyone | Sign-in form |
| `/app` | signed in | Editor home: the team's sites, each with its versions and links into them |
| `/app/sites/<siteSlug>/<versionSlug>/pages/<pagePath>` | signed in | Editor page |
| `/app/sites/<siteSlug>/<versionSlug>/redirects` | signed in | Redirects screen |
| `/app/sites/<siteSlug>/<versionSlug>/preview/<pagePath>` | signed in | Draft preview of one page |
| `/app/sites/<siteSlug>/analytics` | signed in | Analytics screen |
| `/app/team` | owner | Team screen |
| `/preview/<token>` | anyone with the link | Shared preview of one draft page |
| `/invite/<token>` | anyone with the link | Join-the-team form |
| `/docs/<siteSlug>` | public | Redirects to the default version's first page (see Business rules, Versions) |
| `/docs/<siteSlug>/<versionSlug>/<pagePath>` | public | Reader page |

`<pagePath>` is the page's path inside its version. It may contain `/`, for example `guides/install`. Everywhere else in this brief, a version-relative path (in redirects, links and messages) is written with a leading slash, for example `/guides/install`. An unauthenticated request for any `/app` route is sent to `/signin?next=<that route>`.

**Reader page.** It has a header, a sidebar, the article and a table of contents.
- The header holds the site title, the `Sections` tabs (one per sidebar tab), the `Search` button and the version switcher.
- The sidebar holds the `Docs` navigation, showing the groups of the current section with their pages, and the `Theme` radio group at its foot.
- The article column is about 68 characters wide and ruled by hairlines. It contains the current group's title as a small label, the page title as the only h1, the page content, and the rating group at the end.
- The table of contents is the `On this page` navigation, sticky beside the article.

Layouts by viewport width:
- **1024 pixels and wider (including 1280x800):** three panes in this order from left to right: sidebar, article, table of contents.
- **768 to 1023 pixels (including 768x1024):** two panes, sidebar and article. The table of contents is folded into an `On this page` disclosure button above the article.
- **Below 768 pixels (including 375x812):** one column. The header shows the `Menu` button, the site title and the `Search` button. The sidebar, the `Sections` tabs, the version switcher and the `Theme` group live in the `Site navigation` drawer, which opens from the left. The `On this page` disclosure sits above the article.

No breakpoint between these changes which layout a published width gets. At 320 and 375 pixels wide the page never scrolls sideways; wide code blocks and tables scroll inside their own box. Every tap target is at least 44 by 44 pixels below 768 pixels wide.

**Not-found page.** This is the page for an unknown or removed public path in a published version. It uses the reader layout. Its article shows the not-found heading and text (Feedback states) and a `Search the docs` search box.

**Editor page.** The editor is the same galley as the reader page, with proof marks added.
- A top bar holds the site and version titles and the version actions: `New page`, `New group`, `Import OpenAPI`, `New version`, `Redirects`, `Preview`, `Share preview` and `Publish`, plus the `Analytics` and `Team` links, the `Theme` radio group and `Sign out`.
- The left column is the `Pages` tree: every tab, group and page of the version.
- The centre column is the page editor: the title field, a small toolbar with the `Image` button, the `Page source` text area with a line-number gutter, and the save status.
- The right column is the `Proof margin`. It contains the presence notices, the `Redirects` list of redirect chips, the `links rewritten` count, the `Publish check` panel when it is open, and on reference pages the `Source` panel.

Editor layouts by viewport width:
- **1024 pixels and wider:** three columns: tree, editor, proof margin.
- **768 to 1023 pixels:** two columns, tree and editor. The proof margin stacks below the editor.
- **Below 768 pixels:** one column. The tree is in a `Pages` drawer opened by the `Pages` button, the top-bar actions wrap onto as many rows as they need, and the proof margin stacks below the editor.

A viewer sees the same editor with the page source read-only and none of the actions they cannot use (see Business rules, Team and roles).

**Other editor screens.**
- **Redirects screen:** a table of the version's redirects (From, To, Kind) with a remove button on each row, and an add form with `From` and `To` fields.
- **Analytics screen:** the `Page ratings` and `Search terms` tables.
- **Team screen:** a members table with a role select per member except the owner, an invite form, and an invites list with each invite's status.
- **Preview:** a draft preview looks exactly like the reader page with the draft-preview banner across the top.
- **Shared preview:** looks like a preview, but its sidebar lists only that one page.

### Public screens and controls (DP-06, DP-07, DP-11, DP-16, DP-19, DP-23, DP-27, DP-31, DP-33, DP-34, DP-36, DP-37, DP-39, DP-40, DP-42, DP-43, DP-45, DP-46, DP-48, DP-49)

Only the ids, roles and names below are public. Ids come from the server, use the ids in the JSON documents, and never change across reload, rename, reorder, publish or another person's session. Anything not listed is up to you.

**Stable ids and structure**

| Where | Role and accessible name | Id and attributes |
|---|---|---|
| Public sidebar | `navigation "Docs"` | each page link `id="nav-<pageId>"`; the current page's link has `aria-current="page"`; each group is a block `id="nav-grp-<groupId>"` whose title is a heading |
| Public section tabs | `tablist "Sections"`; each `tab` is a link to that tab's first page | `id="tab-<tabId>"`; the current section's tab has `aria-selected="true"` |
| Editor tree | one `tree "Pages"`, a single tab stop with roving focus | tab rows `id="row-tab-<tabId>"` at `aria-level` 1; group rows `id="row-grp-<groupId>"` at level 2; page rows `id="row-<pageId>"` at level 3; every row has `aria-level`, `aria-posinset` and `aria-setsize` |
| Page row actions | `button "Actions for <page title>"` opening `menu` with `menuitem "Rename"` and `menuitem "Remove"` | |
| Inline rename | `textbox "Path"` on the row | the row carries `data-splice` (Motion and effects) |
| Drag target | the drop indicator line | `id="drop-indicator"`, present only while dragging |
| Heading anchors | every h2 and h3 has `id="<anchor>"`, followed by a link to `#<anchor>` named `Link to <heading text>` | anchor rule in Business rules, Writing pages |
| Components | each rendered component root carries `data-component="<name>"` | names: `callout`, `tabs`, `code-group`, `steps`, `accordion`, `cards` |
| Page source | `textbox "Page source"`, one multi-line text area | `id="editor"`; the gutter holds one `<span data-line="<n>">` per line, and a line with a gate problem selected from the dialog also has `data-error="true"` |
| Live regions | one polite `status` region in the editor and one on the public site (preview and shared preview included) | `id="announcer"`; every announced message in this brief goes there and nowhere else |
| Search | `dialog "Search docs"` with `combobox "Search docs"`, a count line, and `listbox "Search results"` | options `role="option"` with `id="result-<n>"`, 1-based in rank order; the count line is `id="search-count"` |
| Ratings | `group "Was this page helpful?"` with `button "Yes"` and `button "No"` | both carry `aria-pressed` |
| Table of contents | `navigation "On this page"` listing every h2 and h3 | the link of the heading at the top of the viewport has `aria-current="location"` |
| Drawer and accordion motion | | `data-motion="opening\|open\|closing\|closed"` on the drawer and on each accordion region |

**Controls**

| Screen | Role and name | Visible copy or behaviour |
|---|---|---|
| Sign-in | `textbox "Email"`, `textbox "Password"` (password input), `button "Sign in"` | |
| Editor top bar | `button "New page"`, `button "New group"`, `button "Import OpenAPI"`, `button "New version"`, `link "Redirects"`, `link "Preview"`, `button "Share preview"`, `button "Publish"`, `link "Analytics"`, `link "Team"`, `button "Sign out"` | `Team` appears for owners only |
| Phone editor | `button "Pages"` opens `dialog "Pages"` containing the tree | |
| New page | `dialog "New page"`: `textbox "Title"`, `textbox "Path"`, `combobox "Group"`, `button "Create page"`, `button "Cancel"` | |
| New group | `dialog "New group"`: `textbox "Title"`, `combobox "Tab"`, `button "Create group"`, `button "Cancel"` | |
| New version | `dialog "New version"`: `combobox "Copy from"`, `textbox "Slug"`, `textbox "Title"`, `button "Create version"`, `button "Cancel"` | |
| Editor page | `textbox "Title"`, `button "Image"` (opens the file chooser `Upload image`), save status text | save status shows `Saving` or `Saved` |
| Slash menu | `listbox "Insert component"` with one `option` per component | options in order: `Callout`, `Tabs`, `Code group`, `Steps`, `Accordion`, `Cards` |
| Proof margin | `complementary "Proof margin"` holding `list "Redirects"` (one `listitem` chip per redirect), the `links rewritten` count `id="links-rewritten"`, `complementary "Publish check"` when open, and on reference pages `region "Source"` with `link "Download source"` | chip text `<from> → <to>`; the count shows a numeral followed by the words `links rewritten` |
| Publish dialog | modal `dialog` named by its heading; in the blocked view one `button` per problem row, plus `button "Close"`; in the confirm view `button "Publish now"` and `button "Cancel"` | heading and texts in Feedback states |
| Publish check panel | `complementary "Publish check"` with the same heading and rows as the blocked view, and `button "Close"` | |
| Share preview | `dialog "Share preview"` with read-only `textbox "Preview link"`, `button "Copy link"`, `button "Revoke"`, `button "Close"` | |
| Import | file chooser `OpenAPI file` | |
| Source panel | `region "Source"` with the file name, its size in bytes and its SHA-256, plus `link "Download source"` | all in monospace |
| Redirects screen | `table "Redirects"` with columns From, To, Kind (`auto` or `manual`); `button "Remove redirect from <from>"` per row; `textbox "From"`, `textbox "To"`, `button "Add redirect"` | |
| Analytics | `table "Page ratings"` (Page, Yes, No, Helpful); `table "Search terms"` (Term, Searches, Results) | |
| Team | `table "Members"` (Name, Email, Role) with `combobox "Role for <name>"`; `textbox "Email"`, `combobox "Role"` (Editor, Viewer), `button "Send invite"`; `table "Invites"` (Email, Role, Status) with `button "Send now"` on held rows | status texts in Feedback states |
| Invite page | heading per Feedback states; `textbox "Name"`, `textbox "Password"`, `button "Join team"` | |
| Reader header | `button "Menu"` (below 768 pixels only, with `aria-expanded`), `button "Search"`, `button "Version: <version title>"` opening `listbox "Versions"` (one option per published version, named by its title; the current one has `aria-selected="true"`) | |
| Drawer | `dialog "Site navigation"` (modal) | |
| Table of contents disclosure | `button "On this page"` with `aria-expanded` and `aria-controls` (below 1024 pixels only) | |
| Theme | `radiogroup "Theme"` with `radio "Light"`, `radio "Dark"`, `radio "System"` | on the reader site at the foot of the sidebar (inside the `Site navigation` drawer below 768 pixels); in the editor in the top bar, after `Team` and before `Sign out` |
| Not-found page | `search` landmark with `searchbox "Search the docs"` | |
| Update banner | the update banner text with `button "Reload"` | |
| Draft banner | the draft-preview banner text | |
| Callout | `note` named `Note`, `Tip`, `Warning` or `Danger` | |
| Tabs | `tablist`, `tab` (with `aria-selected` and `aria-controls`), `tabpanel` (with `aria-labelledby`) | code groups use `tablist "Code examples"` |
| Code panel | `button "Copy"` in every code-group panel | |
| Steps | ordered list; each item starts with an h3 | heading format in Feedback states |
| Accordion | `button` named by its title, with `aria-expanded` and `aria-controls` | |
| Cards | a list; each card is one `link` named by its title | |
| Try it | `region "Try it"`: one `textbox "<parameter name>"` per parameter, `textbox "Request body"` (multi-line), `combobox "Response code"`, `button "Send request"`, the result status line and the response body in a preformatted block | |

### Interactions (DP-05, DP-06, DP-08, DP-11, DP-12, DP-16, DP-19, DP-22, DP-23, DP-24, DP-27, DP-31, DP-34, DP-37, DP-39, DP-40, DP-42, DP-45, DP-46, DP-48, DP-49)

**Keyboard rules that hold everywhere.** Every action works by keyboard alone. In every open modal dialog or drawer, Tab past the last control wraps to the first and Shift+Tab before the first wraps to the last. Focus never reaches the page behind. Escape closes the dialog or drawer, and focus returns to the control that opened it (for a shortcut, to whatever had focus when the shortcut was pressed). A published shortcut works whichever control in its region has focus, including buttons, rows and the page source. The exceptions are stated with each shortcut.

**Editor: Pages tree.**
- Tab enters the tree on the last focused row (on the first row if none has been focused yet).
- Up and Down move between visible rows. Right expands a collapsed row, or moves to its first child. Left collapses an expanded row, or moves to its parent. Home and End go to the first and last visible rows. Enter on a page row opens that page in the editor.
- `Alt+ArrowUp` and `Alt+ArrowDown` on a page row move that page one place within its group. At the top of a group, `Alt+ArrowUp` moves the page to the last slot of the previous group in tree order, across tab boundaries; at the bottom, `Alt+ArrowDown` moves it to the first slot of the next group, including an empty one. At the very first or last slot of the version nothing happens and nothing is announced.
- The same keys on a group row move the group within its tab and across into the neighbouring tab's last or first slot.
- Focus stays on the moved row. Each move saves at once and is announced with the page moved or group moved message (Feedback states).
- Pointer drag of a page or group row shows the drop indicator line at the target slot. Releasing the pointer drops the row there and saves at once, with the same announcement. Escape during a drag cancels it.
- On a phone the tree is in the `Pages` drawer and the keyboard path works there. Drag is not required on a phone.

**Editor: rename.**
- F2 on a page row, or `Rename` from the row's actions menu, turns the row into the `Path` field. The field holds the current path, fully selected.
- Enter confirms. On success the Rename splice plays (Motion and effects) and focus returns to the renamed row. On a refusal the field stays open with its message tied to it by `aria-describedby`, `aria-invalid="true"` is set, the message is announced, and focus stays in the field.
- Escape cancels, restores the row and returns focus to it.

**Editor: writing.**
- The `Page source` text area takes plain typing. Autosave runs after the autosave pause (Business rules, Timers); the save status shows `Saving` while a save is in flight and then the saved message.
- **Slash menu.** Typing `/` as the first character of an empty line opens the `Insert component` listbox under the caret. Letters typed after `/` stay in the text and filter the options by name (case-insensitive, contains); an empty filter result shows the no-match text. Up and Down move the active option through `aria-activedescendant`, and focus never leaves the text area. Enter replaces the `/` and the filter letters with that component's snippet (Business rules, Writing pages) and puts the caret at the snippet's marked spot. Escape closes the menu and keeps the typed `/` and letters.
- `Image` opens a file chooser. A chosen file is uploaded first. Only after storage confirms it is the image line inserted at the caret, and the image-uploaded message announced. A refused file leaves the source unchanged and shows its message.
- `Ctrl+Shift+P` anywhere in the editor, including in the page source, does what `Publish` does.

**Editor: publish.**
- `Publish` announces the checking message and runs the check (pending: the button carries `aria-busy="true"`). It then announces the check result and opens the Publish dialog: the blocked view if the check found problems, otherwise the confirm view.
- Blocked view: focus goes to the dialog heading, and Tab cycles through the problem rows and `Close`. Activating a row closes the modal dialog, opens that page in the editor, puts the caret at the start of that line, focuses the text area, and marks the gutter line with `data-error="true"`. The blocked view then stays open as the non-modal `Publish check` panel in the proof margin.
- The panel re-runs the check after each autosave, rewrites its heading and rows in place, and announces the problems-left message. When the count reaches zero it shows the no-problems text.
- Confirm view: `Publish now` publishes and `Cancel` closes. While publishing, `Publish now` carries `aria-busy="true"` and the publishing message is announced. On success the dialog closes and the published message is announced. On a storage failure the dialog stays open showing the publish-outage message, which is announced. Focus returns to the opener when the dialog closes.

**Editor: preview, sharing, presence and conflicts.**
- `Preview` opens the page's preview route in a new tab. That tab updates within one second after each autosave of that page, with no reload.
- `Share preview` creates a link and opens the `Share preview` dialog with the full link selected in `Preview link`. `Copy link` copies it. `Revoke` kills it and announces the link-revoked message.
- When another editor opens the same page, the presence notice for them appears in the proof margin within one second. It goes once their session has left for longer than the presence timeout.
- If a save is refused for an old revision, the conflict message appears in the proof margin and is announced. The text area keeps the local text and stays editable, and autosave stops for that page until it is reloaded.
- When the server rewrites a page's source (a rename elsewhere rewrote its links), an editor with that page open and no unsaved typing receives the new source and revision within one second.

**Editor: other screens.**
- Redirects screen: `Add redirect` validates on the server. A refusal shows its message under the field it concerns, announces it, and moves focus to that field.
- Team screen: `Send invite` shows and announces the invite-sent or invite-held message. A role select change saves at once.
- A viewer whose role is changed sees the new controls appear, or disappear, within one second, and the role-changed message is announced.

**Reader: search.**
- `Ctrl+K` or `Meta+K` opens `Search docs` from anywhere on the reader page. `/` opens it only when focus is not in a text field.
- Results and the count line update in place after the search debounce. Up and Down move the active option through `aria-activedescendant` with focus kept in the combobox, Enter opens the active result, and Escape closes and returns focus to the opener.
- A heading result opens its page scrolled to that heading's anchor.
- On the not-found page, typing in `Search the docs` and pressing Enter opens `Search docs` with that query and its results.

**Reader: drawer, table of contents and switcher.**
- `Menu` opens the `Site navigation` drawer and moves focus into it. Focus stays trapped inside. Escape, a tap on the backdrop, or following a link closes it, and focus returns to `Menu`.
- `On this page` toggles the table of contents list. Following a table-of-contents link or a heading anchor link moves to that heading; the jump is instant under reduced motion.
- The version switcher opens `Versions`. Up and Down move, Enter chooses and Escape closes. Choosing a version goes to the same page path in that version when it has one. Otherwise it goes to that version's first page, shows and announces the version-fallback notice, and puts focus on that page's h1.

**Reader: components.**
- Tabs and code groups: Left and Right move to the previous or next tab and wrap at the ends; Home and End go to the first and last tab. Selection follows focus. Only the selected tab is in the Tab order.
- Choosing a code-group title selects that title in every code group on the page that has it, and remembers it for this browser. On the next page load, every code group with that title opens on it.
- `Copy` copies its panel's code and announces the copied message.
- An accordion button toggles its region. When closed, the region is hidden: its links take no focus and find-in-page does not reach its text.

**Reader: ratings, Try it, theme and updates.**
- Ratings: pressing `Yes` or `No` votes and announces the thanks message. Pressing the other button changes the vote. Pressing the pressed button again removes the vote and announces the feedback-removed message.
- Try it:
  - `Send request` first checks required parameters. If any is empty, nothing is sent; each empty field gets the required-parameter message tied by `aria-describedby` with `aria-invalid="true"`, and focus moves to the first of them.
  - A request body that is not valid JSON gets the invalid-body message the same way.
  - Otherwise the request goes to the mock route. The result shows the status line and the response body, and the status line is announced. The whole panel works by keyboard alone.
- Theme: choosing a radio applies that theme at once and remembers it for this browser. The editor and the public site share that one remembered choice: a theme chosen in either one applies to both, including after a reload. `System` follows the device's light or dark setting and changes with it.
- When a publish changes the page a reader has open, the update banner appears and is announced. The content does not change until the reader chooses `Reload`.

### Visual design (DP-48, DP-50, DP-51)

- **Ground and ink.** The page is warm off-white paper, and text is a warm near-black ink. The accent is a proof red used for every mark of change or error: strike lines, the gate's problem marks, redirect chips' left rule, focus rings and primary buttons. Rules are hairlines in a pale warm grey-beige.
- **Light theme colours.** Page background: red 246, green 242, blue 234. Body text: red 31, green 28, blue 24. Accent: red 200, green 54, blue 31. Rules: red 217, green 209, blue 195.
- **Dark theme colours.** Page background: red 22, green 24, blue 27. Body text: red 236, green 230, blue 218. Accent: red 232, green 106, blue 84. Rules: red 58, green 60, blue 64.
- **Contrast.** All text and controls meet WCAG 2.2 AA contrast in both themes.
- **Type.** Headings and the site title are set in Source Serif 4, a bookish serif. Body text and controls are set in IBM Plex Sans. Every slug, path, redirect, count, file name, line number and code sample is set in IBM Plex Mono. Each heading level is about one fifth larger than the level below it, and h1 is the largest. All three are OFL font files served by the app. Icons are inline line icons in the Lucide style.
- **Depth.** No shadow is deeper than a one-pixel hairline. Panels separate by rules, not by elevation.
- **Density.** Comfortable: generous line height in the article and roomy rows in the tree and tables.
- **Composition.** The reader site is a three-column galley proof: sidebar, the hairline-ruled article column, and the sticky contents list. The editor is the same galley with the proof margin on the right, where gate issues and redirect chips sit like a proofreader's marks beside the copy. Chips are small monospace labels with a proof-red rule.
- **Tap size.** Controls are at least 44 by 44 pixels below 768 pixels wide.

### Motion and effects (DP-16, DP-37, DP-40, DP-48)

Every motion starts quickly and settles softly with a long ease-out, and finishes well within one and a half seconds. Each duration is a named client timer in Business rules, Timers. Every client timer and animation runs on page timers so it can be driven by a paused page clock. No state change ever waits for a stylesheet transition or animation to finish. Nothing loops: there are no idle, decorative or ambient animations anywhere.

**Rename splice (signature).** The splice shows in one gesture what a rename did to the site's link graph. When a rename succeeds, the renamed row's `data-splice` attribute steps through `strike`, `set`, `file`, `count`, `done`, one phase after another:
1. **Strike:** a thin proof-red line draws left to right across the old path, over the full width of the path (strike timer).
2. **Set:** the new path's characters appear one by one, each starting one stagger step after the previous (set timer). For paths too long to finish at that pace, the step shrinks so that the last character starts no later than six sevenths of the way through the phase.
3. **File:** a chip `<old path> → <new path>` lifts off the row and travels into the proof margin's `Redirects` list. Any older chip that pointed at the old path changes its target to the new path in place (file timer).
4. **Count:** the `links rewritten` numeral counts up from 0 to the number of rewritten links (count timer).

The rename message is announced as the splice starts. Focus stays on the renamed row throughout.

**Reduced motion.** When the browser reports a reduced-motion preference, the splice skips to its end state. The new path replaces the old one at once, the chip appears in the list with no travel, the count shows its final number, `data-splice` reads `done` by the next animation frame, and the same message is announced. Nothing is lost: every end state matches the animated path.

**Drawer.** The drawer slides in from the left and out to the left (drawer timer), with `data-motion` reading `opening`, `open`, `closing`, `closed`. Toggling it mid-motion reverses from its current position and takes as long as the distance already travelled. Under reduced motion it opens and closes instantly, going straight to `open` or `closed`.

**Accordion.** The region unfolds and folds (accordion timer) with `data-motion` the same as the drawer. Under reduced motion it is instant.

**Theme switch.** The page cross-fades between themes (theme timer). Under reduced motion it is instant.

**Feedback.** Press feedback on buttons is an immediate change of tint with no motion. Transient visible notices (the copied, thanks, feedback-removed and image-uploaded messages) fade out after the notice timer; their announcement stays in the live region until it is replaced. Anchor jumps scroll smoothly except under reduced motion, where they jump.

### Feedback states (DP-05, DP-08, DP-14, DP-15, DP-16, DP-18, DP-19, DP-20, DP-22, DP-23, DP-24, DP-27, DP-31, DP-33, DP-34, DP-39, DP-42, DP-45, DP-46)

Every async action has a pending state (button `aria-busy="true"` or the save status), a success message, a field error tied to its field, and an outage message where a service is involved. All of these are shown on screen and announced through `id="announcer"`. Every string below renders character for character, with straight apostrophes and straight double quotes, and its announcement carries the same characters. This table is the only place the copy is stated.

**Placeholders.**
- `<n>`: a whole number in digits.
- `<path>`, `<from>`, `<to>`, `<old path>`, `<new path>`: version-relative paths with a leading `/`.
- `<page title>`, `<version title>`, `<site title>`, `<group title>`, `<heading text>`, `<team name>`: as stored.
- `<name>`: a user's display name. `<inviter name>`: the inviting owner's display name.
- `<email>`: as entered, lower-cased.
- `<query>`: the search text, trimmed.
- `<file>`: `pages/<pagePath>.md`. `<line>`: a 1-based line number.
- `<Name>`: a component tag name as written. `<title>`: an attribute value as written.
- `<role label>`: `Owner`, `Editor` or `Viewer`.
- `<code>`: an HTTP status code. `<reason phrase>`: its phrase from the Try it table in Business rules.
- Where a count is 1, the message uses the singular form given in brackets.

**Editor messages**

| Name | Exact text |
|---|---|
| saving status | `Saving` |
| saved | `Saved` |
| save failed | `Couldn't save. Check your connection.` |
| conflict | `<name> saved this page while you were editing. Copy your changes, then reload to see theirs.` |
| presence | `<name> is also editing this page.` |
| no components match | `No components match` |
| image uploaded | `Image uploaded.` |
| image outage | `Image upload failed: file storage is unavailable. Your page is saved.` |
| image type | `Images must be PNG, JPEG or WebP.` |
| image size | `Images must be 5,000,000 bytes or smaller.` |
| page moved | `Moved <page title> to position <n> of <n> in <group title>.` |
| group moved | `Moved <group title> to position <n> of <n> in <tab title>.` (`<tab title>` is the tab's title) |
| renamed | `Renamed to <new path>. <n> links rewritten. Redirect added from <old path>.` (`1 link rewritten`) |
| redirect loop | `This would create a redirect loop: <path> → <path> → <path>.` (the cycle, written as many paths as it has, starting and ending with the path being saved) |
| path taken | `Another page already uses <path>.` |
| bad path | `Paths use letters, digits, hyphens and underscores, separated by /.` |
| off site | `Redirects must stay on this site.` |
| target missing | `No page at <path>.` |
| redirect exists | `A redirect from <path> already exists.` |
| redirect added | `Redirect added from <from> to <to>.` |
| redirect removed | `Redirect removed from <from>.` |
| checking | `Checking <n> pages.` (`Checking 1 page.`) |
| check found problems | `Found <n> problems. Publish is blocked.` (`Found 1 problem. Publish is blocked.`) |
| check clean | `No problems found.` |
| blocked heading | `Publish blocked: <n> problems` (`Publish blocked: 1 problem`) |
| problem row | `<file>:<line> <message>` where `<message>` is a gate message below |
| problems left | `<n> problems left.` (`1 problem left.`) |
| no problems left | `No problems left.` |
| confirm heading | `Publish <version title>?` |
| confirm text | `<n> pages change.` (`1 page changes.`) |
| publishing | `Publishing <version title>.` |
| published | `Published <version title>.` |
| publish outage | `Couldn't publish: file storage is unavailable. The live site hasn't changed.` |
| publish in progress | `Another publish of this version is running. Try again in a moment.` |
| draft banner | `Draft preview. Not published.` |
| preview link created | `Preview link created.` |
| preview link revoked | `Preview link revoked.` |
| imported | `Imported <n> operations.` (`Imported 1 operation.`) |
| import invalid | `This file isn't an OpenAPI 3.0 JSON file.` |
| import too large | `This file is larger than 1,000,000 bytes.` |
| import outage | `Import failed: file storage is unavailable.` |
| version created | `Created <version title>.` |
| sign-in failed | `Email or password is wrong.` |
| no access | `You don't have access to this page.` |
| role changed | `Your role is now <role label>.` |
| invite sent | `Invite sent to <email>.` |
| invite held | `Invite held: mail is unavailable. We'll send it when mail is back.` |
| still unavailable | `Mail is still unavailable. We'll keep trying.` |
| invite status | `Sent`, `Held: mail is unavailable`, `Accepted`, `Expired` |
| invite heading | `Join <team name> on Galley` |
| invite invalid | `This invitation isn't valid. Ask for a new one.` |

**Gate messages** (the `message` of each publish-report error)

| Code | Exact message |
|---|---|
| `broken_link` | `Broken link to <path>: no page at that path.` |
| `broken_anchor` | `Broken link to <path>#<anchor>: no heading with that anchor.` (for a same-page link, `<path>` is the page's own path) |
| `unknown_component` | `Unknown component <Name>.` |
| `invalid_component` | one of: `Callout needs type note, tip, warning or danger.` · `Tabs needs 2 or more Tab items.` · `Tab must be inside Tabs.` · `Tab needs a title.` · `Tab title "<title>" is used twice in these Tabs.` · `CodeGroup needs 2 or more titled code blocks.` · `Code block title "<title>" is used twice in this CodeGroup.` · `Steps needs 1 or more Step items.` · `Step must be inside Steps.` · `Step needs a title.` · `Accordion needs a title.` · `Cards needs 1 or more Card items.` · `Card must be inside Cards.` · `Card needs a title and an href.` · `<Name> is missing its closing tag.` |
| `invalid_image` | `Images must be uploaded to this site.` |
| `duplicate_slug` | `Duplicate path <path>: also used by <page title>.` (`<page title>` is the other page's title) |

**Reader messages and formats**

| Name | Exact text |
|---|---|
| document title | `<page title> - <site title> (<version title>)` |
| not-found document title | `Page not found - <site title> (<version title>)` |
| not-found heading (h1) | `This page isn't here.` |
| not-found text | `It may have moved. Search the docs instead.` |
| expired preview (h1) | `This preview link has expired.` |
| search count | `<n> results for "<query>"` (`1 result for "<query>"`) |
| no results | `No results for "<query>".` |
| result line 1 | `<page title>` |
| result line 2 | `<group title> › <heading text>` for a heading match, otherwise `<group title>` |
| version fallback | `<page title> isn't in <version title>. Showing the first page instead.` (`<page title>` is the page the reader left) |
| update banner | `This page was updated.` |
| step heading | `Step <n>: <title>` |
| copied | `Copied` |
| thanks | `Thanks for your feedback.` |
| feedback removed | `Feedback removed.` |
| required parameter | `<name> is required.` (`<name>` is the parameter name) |
| invalid body | `Request body must be valid JSON.` |
| Try it status line | `<code> <reason phrase>` |
| no votes | `-` |

## Backend

### API (DP-03, DP-04, DP-05, DP-08, DP-10, DP-13, DP-14, DP-15, DP-18, DP-20, DP-22, DP-23, DP-24, DP-26, DP-29, DP-30, DP-31, DP-33, DP-42, DP-43, DP-45, DP-46)

**Conventions.**
- Request and response bodies are JSON (`application/json; charset=utf-8`) unless a row says otherwise.
- Body limits are set in Server boundary.
- Times are ISO 8601 UTC strings.
- Signed-in calls carry the `galley_session` cookie (HttpOnly, SameSite Lax), which is set by sign-in.

**Error shape.** Every error is `{"error":{"code":"<code>","message":"<text>"}}`. Validation errors add `"fields":{"<field>":"<text>"}`. A few codes add one more key inside `error`, named in the table. Where Feedback states defines copy for an error, `message` is that copy.

**Error precedence** (one rule for the whole API):
1. Body too large or of the wrong media type.
2. Unauthenticated.
3. Unknown resource, or a resource of another team: 404 `not_found`, never 403.
4. Forbidden by role or origin.
5. An idempotent replay returns its stored response here, before any state check.
6. State conflicts.
7. Validation.
8. Service failures.

Endpoint rows below name only their own extra errors.

| Code | Status | Extra key |
|---|---|---|
| `too_large` | 413 | |
| `unsupported_media_type` | 415 | |
| `unauthenticated` | 401 | |
| `invalid_credentials` | 401 | |
| `not_found` | 404 | |
| `forbidden_role` | 403 | |
| `cross_origin` | 403 | |
| `path_taken` | 409 | |
| `redirect_exists` | 409 | |
| `revision_conflict` | 409 | `savedBy`: `{"id","name"}` |
| `page_removed` | 409 | |
| `reference_page` | 409 | |
| `publish_blocked` | 409 | `report`: publish-report JSON |
| `publish_in_progress` | 409 | |
| `slug_taken` | 409 | |
| `email_in_use` | 409 | |
| `invite_pending` | 409 | |
| `owner_role_fixed` | 409 | |
| `version_unpublished` | 409 | |
| `invite_invalid` | 410 | |
| `validation_failed` | 422 | `fields` |
| `redirect_loop` | 422 | `cycle`: array of paths |
| `redirect_off_site` | 422 | |
| `redirect_target_missing` | 422 | |
| `idempotency_key_required` | 422 | |
| `idempotency_key_reused` | 422 | |
| `invalid_openapi` | 422 | |
| `mock_unknown_code` | 422 | |
| `storage_unavailable` | 503 | `report` on publish only |
| `mail_unavailable` | 503 | |

**The three JSON documents.** Saved state is read only through these three documents. They are the only schemas tests rely on.

Page JSON, from `GET /api/pages/<pageId>`:
```json
{"id":"pg_8f2a","versionId":"ver_1c4e","path":"guides/install","title":"Install","kind":"page",
 "operationId":null,"source":"## Requirements\n\nQuire runs on Linux and macOS.\n","revision":4,
 "state":"published","hasDraftChanges":true,"updatedAt":"2026-11-02T10:15:00Z",
 "updatedBy":{"id":"usr_33aa","name":"Dara Okafor"}}
```
- `kind` is `page` or `reference`. `operationId` is set only for reference pages.
- `state` is `draft`, `in_preview`, `published` or `removed` (Business rules, Page states).

Navigation JSON, from `GET /api/versions/<versionId>/navigation`:
```json
{"versionId":"ver_1c4e",
 "tabs":[{"id":"tab_01","title":"Guides","groups":[
   {"id":"grp_01","title":"Getting started","pages":["pg_0001","pg_8f2a"]},
   {"id":"grp_02","title":"Publishing","pages":["pg_77b0"]}]}],
 "redirects":[{"from":"/setup","to":"/guides/install","kind":"auto"},
              {"from":"/old","to":"/guides/publish","kind":"manual"}]}
```
Order is array order. Redirects are listed by `from`, sorted A to Z. Removed pages do not appear.

Publish-report JSON, from `GET /api/versions/<versionId>/publish-report` (the latest attempt):
```json
{"versionId":"ver_1c4e","status":"blocked","publishedAt":null,"snapshotId":null,
 "errors":[{"file":"pages/guides/install.md","line":7,"code":"broken_link",
            "message":"Broken link to /guides/setup: no page at that path."}]}
```
- `status` is `idle`, `validating`, `blocked`, `uploading`, `published` or `failed`. Before any attempt it is `idle` with empty `errors`.
- `publishedAt` and `snapshotId` belong to the attempt and are null unless it published.

**Session and team**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/session` | `{"email","password","next"?}` | 200 `{"user":{"id","email","name"},"redirectTo":"<path>"}` and sets the cookie | 401 `invalid_credentials` |
| `DELETE /api/session` | | 204 | |
| `GET /api/me` | | 200 `{"user":{"id","email","name"},"team":{"id","name"},"role":"owner\|editor\|viewer"}` | |
| `GET /api/team` | | 200 `{"id","name","members":[{"userId","name","email","role"}],"invites":[{"id","email","role","status":"held\|sent\|accepted\|expired","createdAt","sentAt"}]}` | |
| `POST /api/team/invites` | `{"email","role":"editor\|viewer"}` | 201 invite (`status` `sent`), or 202 invite (`status` `held`) | 409 `invite_pending`, 409 `email_in_use` |
| `POST /api/team/invites/<inviteId>/send` | | 200 invite (`sent`) | 503 `mail_unavailable` (invite stays held) |
| `PUT /api/team/members/<userId>` | `{"role":"editor\|viewer"}` | 200 member | 409 `owner_role_fixed` |
| `POST /api/invites/<token>/accept` | `{"name","password"}` (password 10 to 200 characters) | 201 `{"user":{...}}` and sets the cookie | 410 `invite_invalid` |

**Pages, navigation and redirects**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/pages/<pageId>` | | 200 page JSON | |
| `POST /api/versions/<versionId>/pages` | `{"title","path","groupId"}` | 201 page JSON | 409 `path_taken` |
| `PUT /api/pages/<pageId>` | `{"title","source","revision"}` | 200 page JSON (revision plus one) | 409 `revision_conflict`, 409 `page_removed`, 409 `reference_page` (source change on a reference page) |
| `POST /api/pages/<pageId>/rename` | `{"path","revision"}` | 200 `{"page":<page JSON>,"navigation":<navigation JSON>,"linksRewritten":<n>,"redirectAdded":{"from","to"}\|null,"redirectRemoved":{"from","to"}\|null}` | 409 `path_taken`, 409 `revision_conflict`, 409 `page_removed`, 422 `redirect_loop` |
| `DELETE /api/pages/<pageId>` | | 200 page JSON (`removed`) | 409 `page_removed` |
| `GET /api/versions/<versionId>/navigation` | | 200 navigation JSON | |
| `POST /api/versions/<versionId>/tabs` | `{"title"}` | 201 navigation JSON | |
| `POST /api/versions/<versionId>/groups` | `{"tabId","title"}` | 201 navigation JSON | |
| `POST /api/pages/<pageId>/move` | `{"groupId","index"}` (0-based slot after removal) | 200 navigation JSON | 409 `page_removed` |
| `POST /api/groups/<groupId>/move` | `{"tabId","index"}` | 200 navigation JSON | |
| `POST /api/versions/<versionId>/redirects` | `{"from","to"}` | 201 navigation JSON | 409 `redirect_exists`, 422 `redirect_loop`, 422 `redirect_off_site`, 422 `redirect_target_missing` |
| `DELETE /api/versions/<versionId>/redirects?from=<path>` | | 200 navigation JSON | |
| `POST /api/sites/<siteId>/assets` | raw image body, `Content-Type` `image/png`, `image/jpeg` or `image/webp` | 201 `{"id","url":"/assets/<siteSlug>/<imageId>"}` | 415 `unsupported_media_type`, 503 `storage_unavailable` |
| `GET /assets/<siteSlug>/<imageId>` (public) | | 200 image bytes with their stored type | 503 `storage_unavailable` |

Path fields are validated by the path rule in Business rules (422 `validation_failed` with the bad-path message on `path`, `from` or `to`).

**Publishing, preview and versions**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/versions/<versionId>/check` | | 200 `{"pages":<n>,"changedPages":<n>,"errors":[...]}` | |
| `POST /api/versions/<versionId>/publish` | header `Idempotency-Key` (1 to 100 characters) | 200 publish-report JSON (`published`) | 409 `publish_blocked`, 409 `publish_in_progress`, 422 `idempotency_key_required`, 422 `idempotency_key_reused`, 503 `storage_unavailable` |
| `GET /api/versions/<versionId>/publish-report` | | 200 publish-report JSON | |
| `GET /api/sites/<siteId>` | | 200 `{"id","slug","title","versions":[{"id","slug","title","default","publishedAt"}]}` | |
| `POST /api/sites/<siteId>/versions` | `{"fromVersionId","slug","title"}` | 201 version | 409 `slug_taken` |
| `POST /api/versions/<versionId>/make-default` | | 200 site | 409 `version_unpublished` |
| `POST /api/pages/<pageId>/preview-links` | | 201 `{"id","url":"/preview/<token>","expiresAt"}` | 409 `page_removed` |
| `GET /api/pages/<pageId>/preview-links` | | 200 `[{"id","url","expiresAt","revoked"}]` | |
| `DELETE /api/preview-links/<linkId>` | | 204 | |
| `GET /preview/<token>` (public HTML) | | 200 the draft page | 410 page with the expired-preview heading for an unknown, revoked or expired token, or a removed page |

Any method other than `GET` or `HEAD` on `/preview/<token>` answers 405 and changes nothing.

**API reference**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/versions/<versionId>/openapi?name=<file name>` | raw body, `Content-Type: application/json` | 201 `{"importId","groupId","pages":[{"id","path","title","operationId"}]}` | 422 `invalid_openapi`, 503 `storage_unavailable` |
| `GET /api/versions/<versionId>/openapi/source` | | 200 the stored bytes, `Content-Type: application/json`, `Content-Disposition: attachment; filename="<file name>"` | |
| `GET /api/versions/<versionId>/openapi` | | 200 `{"importId","fileName","bytes":<n>,"sha256":"<hex>","importedAt"}` | |
| `POST /api/mock/<siteSlug>/<versionSlug>/<operationId>` (public) | `{"code":<n>,"parameters":{"<name>":"<value>"},"body":"<text>"}` | status `code` with that code's example as the body | 422 `mock_unknown_code`, 422 `validation_failed` (fields per parameter or `body`) |

**Public reader routes**

| Method and path | Success | Errors |
|---|---|---|
| `GET /docs/<siteSlug>` | 302 to the default version's first page | 404 not-found page |
| `GET /docs/<siteSlug>/<versionSlug>/<pagePath>` | 200 the page from the live snapshot, or the redirect in Business rules, Redirects | 404 not-found page |
| `GET /docs/<siteSlug>/<versionSlug>/search?q=<query>` | 200 `{"query","count","results":[{"pageId","title","group","heading":<text>\|null,"url"}]}` | |
| `POST /docs/<siteSlug>/<versionSlug>/search-terms` | `{"term"}` gives 201 `{"term","results":<n>}` | 422 `validation_failed` |
| `PUT /docs/<siteSlug>/ratings/<pageId>` | `{"vote":"yes"\|"no"\|null}` gives 200 `{"pageId","vote"}` and sets `galley_reader` if absent | |

**Analytics**

| Method and path | Success |
|---|---|
| `GET /api/sites/<siteId>/analytics` | 200 `{"pageRatings":[{"pageId","title","versionSlug","yes","no","helpful":"<n>%"\|"-"}],"searchTerms":[{"term","searches","results"}]}` |

**Live events (server-sent events, same port).** Editors subscribe to `GET /api/events?versionId=<id>&pageId=<id>`; both parameters are optional. Event names and data:
- `navigation`: navigation JSON.
- `page`: page JSON, after any save or server rewrite.
- `presence`: `{"pageId","editors":[{"id","name"}]}`.
- `report`: publish-report JSON.
- `role`: `{"userId","role"}`.
- `invite`: invite.
- `analytics`: `{"siteId"}`.

`role`, `invite` and `analytics` reach every open stream of the team. Readers subscribe to `GET /docs/<siteSlug>/events`, which sends `published` with `{"versionId","snapshotId","changedPageIds":[...]}`. Every event reaches its subscribers within one second of the change.

**Grading routes** (only when `GRADING_ROUTES` is `on`; otherwise 404 `not_found`):
- `POST /api/grading/seed`: body and response in Seed data. 201. 409 `email_in_use` or `slug_taken` on a clash with existing records; 422 `validation_failed`.
- `POST /api/grading/outage`: `{"service":"storage"|"mail","ms":<n>}` with `ms` from 1 to 600000. Answers 200 `{"service","until"}` at once. For `ms` milliseconds of server time, every call the app makes to that service fails as if it were unreachable.

### Business rules (DP-05, DP-06, DP-07, DP-10, DP-11, DP-13, DP-14, DP-15, DP-16, DP-18, DP-19, DP-20, DP-22, DP-23, DP-24, DP-26, DP-27, DP-29, DP-30, DP-31, DP-33, DP-34, DP-39, DP-40, DP-42, DP-43, DP-45, DP-46)

#### Writing pages

**Page source.** A page's source is CommonMark: headings, paragraphs, lists, links, emphasis, inline code, fenced code and images. It may also contain the six components below, and nothing else is a component.
- Every opening and closing component tag sits on its own line.
- Attribute values are double-quoted.
- A line that starts with `<` followed by a capital letter and is not one of these tags is an unknown component.
- Raw HTML anywhere else, including `<script>`, `<iframe>`, `<style>` and `on…` attributes, renders as escaped visible text and is never interpreted.
- Code blocks are text, and no page content is ever run.

| Component | Source | Rules (each broken rule is one gate message) | Rendered |
|---|---|---|---|
| Callout | `<Callout type="note">` … `</Callout>` | `type` is `note`, `tip`, `warning` or `danger` | a note-role aside named for its type |
| Tabs | `<Tabs>` holding 2 or more `<Tab title="…">` … `</Tab>` | `<Tab>` only directly inside `<Tabs>`; every tab titled; titles unique within the group | WAI-ARIA tabs, first tab selected |
| Code group | `<CodeGroup>` holding 2 or more fenced code blocks whose info string is `<language> <title>` | every block titled; titles unique within the group | the tabs pattern under `Code examples`, one `Copy` per panel |
| Steps | `<Steps>` holding 1 or more `<Step title="…">` … `</Step>` | `<Step>` only directly inside `<Steps>`; every step titled | an ordered list; each item's h3 is the step heading |
| Accordion | `<Accordion title="…">` … `</Accordion>` | titled | button plus hidden region, closed at load |
| Cards | `<Cards>` holding 1 or more `<Card title="…" href="…">` … `</Card>` | `<Card>` only directly inside `<Cards>`; title and href present; href is an internal link | a list of links |

**Links.**
- Links whose target starts with `/` are internal, version-relative links, with an optional `#anchor`. They render as `/docs/<siteSlug>/<versionSlug><path>`.
- `#anchor` alone is a same-page link.
- `http:`, `https:` and `mailto:` links render as links and are not checked.
- Any other target renders as its link text only, with no link.

**Images.** An image is written `![alt](/assets/<siteSlug>/<imageId>)` and must name an image uploaded to this site.

**Headings and anchors.** The page title is the page's only h1. `#` and `##` in source render as h2, `###` as h3, and deeper levels as h4 to h6. Every h2 and h3 gets an anchor:
- Take the heading text and lower-case it.
- Keep the letters a to z and the digits 0 to 9.
- Turn every run of other characters into one `-`, then trim `-` from both ends. An empty result becomes `section`.
- When an anchor repeats on the same page, its second use gets `-2` appended, its third use `-3`, and each later use the next whole number, in page order.

For example, `Install on macOS (Apple silicon)` becomes `install-on-macos-apple-silicon`. Only h2 and h3 appear in the table of contents.

**Snippets.** The slash menu inserts exactly these snippets. `‸` marks where the caret goes and is not inserted.
- Callout: `<Callout type="note">`, a line `‸`, `</Callout>`.
- Tabs: `<Tabs>`, `<Tab title="First">`, `‸`, `</Tab>`, `<Tab title="Second">`, an empty line, `</Tab>`, `</Tabs>`.
- Code group: the lines below.

~~~
<CodeGroup>
```bash Shell
‸
```
```js JavaScript

```
</CodeGroup>
~~~

- Steps: `<Steps>`, `<Step title="First step">`, `‸`, `</Step>`, `</Steps>`.
- Accordion: `<Accordion title="Question">`, `‸`, `</Accordion>`.
- Cards: `<Cards>`, `<Card title="Title" href="/‸">`, `</Card>`, `</Cards>`.

Each list item above is one line.

**Paths.** A path has 1 to 5 segments joined by `/`. Each segment is 1 to 60 characters drawn from letters, digits, `-` and `_`. There is no leading or trailing `/` inside page JSON. Paths are case-sensitive. Editors cannot create or rename a page onto a path a live page in the version already uses (`path_taken`). Two pages can share a path only when an import generates a path that another page already has, or the grading seed lists one twice; the gate then reports `duplicate_slug` on each.

**Saves and limits.**
- Every save carries the `revision` the editor last loaded. A save with any other revision is refused with `revision_conflict` naming who saved last, and nothing changes.
- A page's source is at most 200,000 bytes in UTF-8. The limit itself is allowed; more is `too_large`.
- Images are PNG, JPEG or WebP of at most 5,000,000 bytes. The limit itself is allowed; more is `too_large` with the image-size message.

#### Page states

A page moves through these states:
- `draft` on creation.
- `in_preview` while it has a shared preview link that is neither revoked nor expired and it has never been published. It returns to `draft` when no such link remains.
- `published` once a successful publish included it. It stays `published` through later edits, with `hasDraftChanges` true until the next publish.
- `removed` after a delete, from any other state.

A rename keeps the state and leaves a redirect behind. `removed` is final: any write to a removed page, including a second delete, is refused with `page_removed`. A removed page drops out of navigation, and after the next publish its path shows the not-found page unless a redirect covers it.

#### Navigation

A version's navigation is tabs, then groups, then pages. Moves are applied one at a time on the server. When two moves race, the later one wins and both saves keep the navigation consistent. Empty groups appear in the editor but are left out of the public sidebar. Public navigation changes only when the version is published.

#### Redirects

Every redirect is one hop from a path to a live page's path in the same version.

**A rename from old path O to new path N:**
1. Adds an `auto` redirect from O to N.
2. Changes every redirect whose target was O to target N, so chains collapse. For example, renaming A to B and then B to C leaves A to C and B to C.
3. Rewrites, in every page of the version (draft source), every internal link and Card `href` whose path is exactly O so it points to N, keeping any `#anchor`. Each occurrence counts once in `linksRewritten`. Links to other paths that redirect to O are left alone, because they now resolve in one hop. Every page rewritten this way gets a new revision.
4. If N is the `from` of an `auto` redirect that targets this same page (a rename back), removes that redirect instead of making a loop. For example, after A to C and B to C, renaming C back to A leaves C to A and B to A. If N is the `from` of an `auto` redirect to a different page, that redirect is removed and the renamed page takes the path.

`redirectAdded` and `redirectRemoved` in the rename response report steps 1 and 4.

**Manual redirects** are added on the Redirects screen with a `From` path and a `To` path.
- `To` must be a live page's path in the same version. A full URL, a protocol-relative value, or anything with a scheme or host is refused as `redirect_off_site`. A path with no live page is `redirect_target_missing`. A second redirect from the same `From` is `redirect_exists`.
- On the public site a manual redirect takes precedence over a page at its `From` path.

**Loops.** A manual redirect or a rename that would make any path lead back to itself is refused with `redirect_loop`, and nothing changes. `cycle` lists the loop starting and ending with the path being saved. For example: manual `/old` to `/setup` exists; renaming `/setup` to `/old` is refused with `cycle` `["/old","/setup","/old"]` and the redirect-loop message. A manual redirect whose `From` equals its `To` is a loop of two entries.

**Public resolution.** Renames, rewritten links and redirects are drafts until the next publish. A public request in a published version is resolved against that version's live snapshot in this order: manual redirect, then page, then automatic redirect, then not found.
- A redirect answers **308** with `Location: /docs/<siteSlug>/<versionSlug><to path>`, where `<to path>` is the redirect's target written with its leading `/`, so there is exactly one `/` between the version slug and the path. It is always a path on this site. For example, a redirect to `/guides/install` in version `v1` of site `fernhill` answers `Location: /docs/fernhill/v1/guides/install`. The query string is dropped and the browser keeps the fragment.
- Not found answers **404** with the not-found page.

#### Publishing

**What the check reports.** The check validates every non-removed page of the version:
- `broken_link`: an internal link or Card `href` to a path that has no live page and no redirect.
- `broken_anchor`: a link to `#anchor` (on any page, or after following one redirect) whose target page has no heading with that anchor.
- `unknown_component` and `invalid_component`: per the components table.
- `invalid_image`: an image path outside `/assets/<siteSlug>/` or naming no uploaded image.
- `duplicate_slug`: one per page that shares its path; `line` is 1.

`file` is `pages/<pagePath>.md`. `line` is the 1-based source line of the offending link, tag or image. Errors are sorted by file, then line, then code (A to Z), then position in the line. Links inside code are never checked.

**The check endpoint.**
- `pages` is the number of non-removed pages.
- `changedPages` is the number of pages whose rendered content or path differs from the live snapshot, plus pages added or removed since it. On a first publish, that is every page.
- A check that finds errors records a `blocked` attempt as the publish report. A clean check records nothing.

**Publish runs all or nothing:**
1. `validating`. Any error ends the attempt as `blocked` with 409 `publish_blocked`, and nothing is written.
2. `uploading`. Every rendered page and asset reference is written to file storage, and the manifest is written last.
3. Only after storage confirms the manifest write is the version switched to that snapshot. The search index for that version is rebuilt from it, `publishedAt` and `snapshotId` are set, `status` becomes `published`, and readers get the `published` event.

If any write fails, `status` is `failed`, the response is 503 `storage_unavailable`, readers keep the previous snapshot, and no page changes state.

**Idempotency.** `Idempotency-Key` is required. Replaying a key for the same version returns the stored status and body without publishing again. The same key on another version is `idempotency_key_reused`. Keys are kept for 24 hours.

**Concurrency.** While a version is `validating` or `uploading`, another publish of it gets 409 `publish_in_progress`. Of two simultaneous publishes, exactly one runs.

Readers are always served the last confirmed snapshot, including while file storage is unreachable.

#### Preview and collaboration

- A signed-in preview renders the current draft exactly as the public site will, plus the draft banner.
- A shared preview token is random with at least 128 bits of entropy. It shows only its one page: the sidebar lists that page alone, and its internal links point at the public site. It is valid until revoked, or until `PREVIEW_LINK_TTL_MS` after creation as decided by the server clock, whichever comes first. A shared preview shows the draft as it is when loaded.
- Presence: an editor is present on a page while their event stream for that page is open. Their presence ends no later than `PRESENCE_TIMEOUT_MS` after the stream closes.

#### Versions

- A site has one or more versions, each with a slug (path rule, one segment), a title, and exactly one default.
- A new version copies the draft source of every non-removed page, the navigation and the redirects of the version it is copied from. Everything gets new ids, and the new version starts unpublished.
- Only published versions are public. Each is served only from its own snapshot, so a page, search result, redirect or sidebar never mixes versions.
- `/docs/<siteSlug>` answers 302 to the first page, in navigation order, of the default version's live snapshot. If the default version is unpublished it answers 404.
- Only a published version can become the default.
- The switcher lists published versions in creation order.

#### API reference

**Import.**
- Accepted: an OpenAPI 3.0 JSON file (`openapi` starts with `3.0.`) of at most 1,000,000 bytes (the limit itself is allowed), in which every operation has a unique `operationId`. Anything else is `invalid_openapi`, or `too_large` for size.
- The file is stored exactly as received, with every byte, whitespace, key order and trailing newline untouched. The working copy used for generation may be parsed and normalised freely.
- Import creates the group `API reference`, appended to the version's last tab, or reuses it on re-import. It holds one page per operation in file order (paths in key order, methods in key order). Each page has `kind` `reference`, path `api/<operationId>` and title the operation's `summary`.
- Re-importing replaces the group's pages. A page whose `operationId` matches keeps its id and current path. Operations no longer in the file become `removed`. New operations are appended.
- The `servers` URLs are never contacted.

**Reference page sections**, in this order. A section with nothing to show is left out.
1. A monospace line `<METHOD> <path>`, for example `GET /kettles/{kettleId}`.
2. The summary as the h1.
3. The description.
4. h2 `Parameters`: a table with columns Name, In, Type, Required, Description. Rows are path parameters, then query, then header, each in file order. Required is `Yes` or `No`, and path parameters are always `Yes`.
5. h2 `Request body`: the example JSON.
6. h2 `Responses`: one h3 `<code> <description>` per status code in ascending order, each followed by its example JSON pretty-printed with two spaces.
7. h2 `Try it` with the panel.

Generation is deterministic: the same stored file always gives the same rendered pages.

**Try it.** `Response code` lists the documented codes; the default is the lowest 2xx. The mock route answers with the chosen code and that code's example body. It checks required parameters and that `body` is valid JSON when the operation has a request body, and refuses an undocumented code with `mock_unknown_code`. The status line uses these reason phrases: 200 `OK`, 201 `Created`, 400 `Bad Request`, 404 `Not Found`, 422 `Unprocessable Content`.

#### Reading and search

**Scope and bands.** Search covers the published content of the current version only. Matching is case-insensitive substring matching on the trimmed query. There are three bands:
1. The page title contains the query.
2. Any h2 or h3 contains it. The result's `heading` is the first such heading in the page, and `url` ends `#<anchor>`.
3. Only body text contains it.

A page appears once, in its best band. Within a band, results follow navigation order: tab, then group, then page. All matches are returned. An empty query returns nothing and shows no count line.

#### Feedback and analytics

**Votes.** A vote is keyed by the reader cookie and the page id. A new vote replaces the old one, and a `null` vote removes it.

**Search terms.** A term is recorded when the reader has stopped typing for the search-record pause with 2 or more characters after trimming, or presses Enter, whichever comes first. One record per pause. It is lower-cased and trimmed, and saved with the result count at that moment. Terms of fewer than 2 characters are `validation_failed`.

**Analytics** cover only the team's own sites. Every number is computed from stored votes and records.
- Page ratings has one row per non-removed page of every version. Helpful is Yes divided by (Yes plus No), as a whole percent rounded half up, written `<n>%`. It is `-` with no votes. Rows are sorted by total votes (most first), then title A to Z, then version slug.
- Search terms has one row per term. Searches is its record count. Results is the result count of its latest record. Rows are sorted by searches (most first), then term A to Z.
- Both tables update within one second of a vote or record.

#### Team and roles

- Each user belongs to one team, and each team has exactly one owner.
- **Owner:** everything, including the team screen, invites, role changes, setting the default version and creating versions.
- **Editor:** writes pages, tabs, groups and redirects; reorders; renames; removes; imports; uploads images; shares previews; publishes; creates versions.
- **Viewer:** reads the editor, previews and analytics. Viewers never see edit or publish controls: they are absent, not disabled, and the source is read-only. Every write they attempt answers 403 `forbidden_role`.
- Only owners reach `/app/team`. Others get a 403 page with the no-access message.
- The owner's own role cannot change (`owner_role_fixed`).
- A role change reaches every open session of that user within one second, without a reload.

**Invites.**
- Each invite carries a random single-use token valid for `INVITE_TTL_MS`.
- Inviting an email that already has an account is `email_in_use`. Inviting an email with an invite still `held` or `sent` and unexpired is `invite_pending`.
- Accepting creates the user with the invited role and signs them in. A used, expired or unknown token gets `invite_invalid`.
- An invite is `sent` only once the mail server has accepted the message. If sending fails it is `held` and retried every `MAIL_RETRY_MS`. `Send now` retries at once.

**Sign-in.** `next` is honoured only when it is a path that starts with a single `/` and contains no `\` and no scheme or host. Any other value goes to `/app`.

#### Timers

Client timers (milliseconds of page time):

| Timer | Value |
|---|---|
| autosave pause | 800 |
| search debounce | 150 |
| search-record pause | 1000 |
| drawer | 200 |
| accordion | 150 |
| theme cross-fade | 200 |
| splice strike | 240 |
| splice set | 420 |
| splice stagger | 18 |
| splice file | 320 |
| splice count | 600 |
| notice fade | 4000 |

Server timers are set in Configuration and secrets.

### Services (DP-08, DP-20, DP-29, DP-46)

**Postgres** holds the following, and every analytics number is computed from these rows:
- teams, users with password hashes, roles and sessions;
- sites, versions, tabs, groups, pages and their sources and revisions, the redirect map and the link graph;
- publish attempts and idempotency keys;
- the search index, votes and search records;
- preview links, invites and their status.

Apply the schema idempotently every time the server starts.

**MinIO file storage.** Use the bucket in `S3_BUCKET`, creating it if it is missing. Object keys:
- Snapshot page: `sites/<siteId>/versions/<versionId>/snapshots/<snapshotId>/pages/<pagePath>.html`.
- Snapshot manifest: `sites/<siteId>/versions/<versionId>/snapshots/<snapshotId>/manifest.json`. Contents: `{"snapshotId","versionId","publishedAt","pages":[{"pageId","path","title","key"}],"navigation":<navigation JSON>}`. The manifest is written last, and a snapshot exists only once its manifest does.
- Imported OpenAPI file: `sites/<siteId>/versions/<versionId>/openapi/<importId>.json`, byte for byte as uploaded.
- Image: `sites/<siteId>/assets/<imageId>`.

Snapshot objects are never overwritten or deleted.

When storage is unreachable:
- publish answers 503 with the publish-outage message, and the live site is unchanged;
- image upload answers 503 with the image-outage message, and the source is unchanged;
- import answers 503 with the import-outage message, and nothing is imported;
- `/assets/...` answers 503.

Sign-in, editing, moves, renames, checks, previews, search, ratings and reading the last confirmed snapshot all keep working.

**Mailpit.** Each invite sends one message:
- From: `MAIL_FROM`.
- To: the invitee.
- Subject: `<inviter name> invited you to <team name> on Galley`.
- Plain-text body containing the link `<APP_PUBLIC_URL>/invite/<token>`.

When mail is unreachable, the invite is saved as held (202 with the invite-held message) and retried as set in Team and roles. Once the server accepts the message, the status becomes `Sent` on the team screen within one second. Nothing else sends mail.

### Seed data (DP-04, DP-29, DP-30, DP-45)

Every person, team, product and company below is invented.

**Demo data at first start.** When the database has no teams, the app creates the following:
- Team `Quire Labs`.
- Users, each with the password shown:
  - owner `Ines Varga`, `ines@quire.test`, `quire-owner-2026`;
  - editor `Dara Okafor`, `dara@quire.test`, `quire-editor-2026`;
  - viewer `Lev Marsh`, `lev@quire.test`, `quire-viewer-2026`.
- Site `quire`, titled `Quire Docs`, with versions `v1` (`Version 1`) and `v2` (`Version 2`, the default).
- Version `v1` contents:
  - Tab `Guides` with group `Getting started` (pages `introduction` "Introduction", `guides/install` "Install", `guides/configure` "Configure") and group `Publishing` (page `guides/publish` "Publishing").
  - Tab `Reference` with group `CLI` (page `reference/cli` "CLI").
- Version `v2` contents: the same, plus `guides/themes` "Themes" at the end of `Getting started`, and an `auto` redirect from `/setup` to `/guides/install`.
- Page content: every demo page has at least two h2 sections, and `introduction` uses each component once.
- Ratings for `introduction` in `v2`: 7 Yes and 2 No.
- Search terms: `install` with 5 searches and 3 results.

Both versions are published at first start when storage is reachable; otherwise they stay unpublished. The demo is for people and judges; checks build their own data with the grading seed.

**Grading seed body** (`POST /api/grading/seed`). Each call creates a new team. Users are referred to by `key`, and exactly one member is the owner. Tabs and groups are given in order, and the pages are given in order within each group. When a page path is listed twice, both pages are created. `published: true` runs a real publish of that version after creation.

```json
{"users":[{"key":"owner","email":"ada@fernhill.test","name":"Ada Fern","password":"fernhill-owner-1"},
          {"key":"ed","email":"bo@fernhill.test","name":"Bo Lind","password":"fernhill-editor-1"},
          {"key":"view","email":"cy@fernhill.test","name":"Cy Moor","password":"fernhill-viewer-1"}],
 "team":{"name":"Fernhill","members":[{"user":"owner","role":"owner"},{"user":"ed","role":"editor"},
                                      {"user":"view","role":"viewer"}]},
 "sites":[{"slug":"fernhill","title":"Fernhill Docs",
   "versions":[{"slug":"v1","title":"Version 1","default":true,"published":true,
     "tabs":[{"title":"Guides","groups":[
       {"title":"Getting started","pages":[
         {"path":"introduction","title":"Introduction","source":"## Overview\n\nSee [Install](/guides/install#requirements).\n"},
         {"path":"guides/install","title":"Install","source":"## Requirements\n\nLinux or macOS.\n"}]},
       {"title":"Publishing","pages":[{"path":"guides/publish","title":"Publishing","source":"## Steps\n\nPress Publish.\n"}]}]}],
     "redirects":[{"from":"/old","to":"/guides/publish","kind":"manual"}]}],
   "ratings":[{"version":"v1","path":"introduction","yes":3,"no":1}],
   "searchTerms":[{"version":"v1","term":"install","searches":4,"results":1}]}]}
```

Response (201):

```json
{"users":{"owner":"usr_a1","ed":"usr_a2","view":"usr_a3"},"teamId":"tm_a1",
 "sites":{"fernhill":{"id":"site_a1","publish":{"v1":"published"},
   "versions":{"v1":{"id":"ver_a1","tabs":{"Guides":"tab_a1"},
     "groups":{"Getting started":"grp_a1","Publishing":"grp_a2"},
     "pages":{"introduction":"pg_a1","guides/install":"pg_a2","guides/publish":"pg_a3"},
     "pageList":[{"id":"pg_a1","path":"introduction","title":"Introduction"},
                 {"id":"pg_a2","path":"guides/install","title":"Install"},
                 {"id":"pg_a3","path":"guides/publish","title":"Publishing"}]}}}}}
```

- `pages` maps each path to the first page with it. `pageList` lists every page in navigation order.
- `publish` gives each version marked published as `published`, `blocked` or `failed`. Records are kept whatever the outcome.
- Group titles are unique within a seeded version.

**OpenAPI fixture.** This is the only OpenAPI file used to check Galley:

```json
{
  "openapi": "3.0.3",
  "info": { "title": "Kettle Stock API", "version": "1.0.0" },
  "servers": [{ "url": "https://api.kettlestock.example" }],
  "paths": {
    "/kettles": {
      "get": {
        "operationId": "listKettles",
        "summary": "List kettles",
        "description": "Returns every kettle in stock, newest first.",
        "parameters": [
          { "name": "X-Trace-Id", "in": "header", "required": false, "description": "Echoed back for tracing.", "schema": { "type": "string" } },
          { "name": "limit", "in": "query", "required": false, "description": "Most kettles to return.", "schema": { "type": "integer" } }
        ],
        "responses": {
          "200": { "description": "Kettles in stock", "content": { "application/json": { "example": { "kettles": [{ "id": "k_101", "name": "Stovetop 2L", "stock": 12 }] } } } },
          "400": { "description": "Limit out of range", "content": { "application/json": { "example": { "error": "limit must be 1 to 100" } } } }
        }
      },
      "post": {
        "operationId": "createKettle",
        "summary": "Add a kettle",
        "requestBody": { "required": true, "content": { "application/json": { "example": { "name": "Gooseneck 1L", "stock": 4 } } } },
        "responses": {
          "201": { "description": "Kettle added", "content": { "application/json": { "example": { "id": "k_102", "name": "Gooseneck 1L", "stock": 4 } } } },
          "422": { "description": "Invalid kettle", "content": { "application/json": { "example": { "error": "name is required" } } } }
        }
      }
    },
    "/kettles/{kettleId}": {
      "get": {
        "operationId": "getKettle",
        "summary": "Get a kettle",
        "parameters": [
          { "name": "X-Trace-Id", "in": "header", "required": false, "description": "Echoed back for tracing.", "schema": { "type": "string" } },
          { "name": "fields", "in": "query", "required": false, "description": "Comma-separated fields to return.", "schema": { "type": "string" } },
          { "name": "kettleId", "in": "path", "required": true, "description": "The kettle's id.", "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "The kettle", "content": { "application/json": { "example": { "id": "k_101", "name": "Stovetop 2L", "stock": 12 } } } },
          "404": { "description": "No such kettle", "content": { "application/json": { "example": { "error": "kettle not found" } } } }
        }
      }
    }
  }
}
```

## Technical requirements

### Deployment (DP-01)

- The runtime is Node.js 22 with npm, and all app code is TypeScript.
- `/app/run.json` holds the string commands `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` answers 200 `{"status":"ok"}` on every instance, outage instances included. It never depends on MinIO or Mailpit and never answers 503.
- Grading also runs two outage instances, each with its own empty database: one where file storage is unreachable from boot, and one where mail is unreachable from boot. Each starts, signs in and edits normally.

### Configuration and secrets (DP-02, DP-04)

The app reads these at start. Nothing is hard-coded, there are no undocumented fallbacks, and none is ever sent to the browser.

- Postgres: `DATABASE_URL`.
- File storage: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM` (grading uses `Galley <docs@galley.test>`).
- `APP_PUBLIC_URL`: the origin used in mailed links.
- `GRADING_ROUTES`: off unless it equals `on`; grading sets `on`.
- `INVITE_TTL_MS`: default 604800000; grading uses 20000.
- `MAIL_RETRY_MS`: default 60000; grading uses 2000.
- `PREVIEW_LINK_TTL_MS`: default 259200000 (72 hours); grading uses 6000.
- `PRESENCE_TIMEOUT_MS`: default 30000; grading uses 4000.

### Server boundary (DP-03, DP-23, DP-45)

- **Body limits.**
  - JSON bodies are at most 1,000,000 bytes.
  - Image uploads are at most 5,000,000 bytes.
  - OpenAPI uploads are at most 1,000,000 bytes.
  - Each limit itself is allowed. More is 413 `too_large`. A wrong content type is 415 `unsupported_media_type`.
- **Origin.** A state-changing request whose `Origin` header names another origin is refused with 403 `cross_origin`. Requests without `Origin` are judged by the session alone. No CORS headers are sent.
- **Never served:** source files, source maps, `package.json`, lockfiles, `run.json`, environment files, `node_modules`, and any credential. Such paths answer 404.
- **No outside calls.** The browser never loads anything from another host: fonts, scripts, icons and images all come from the app. The server calls only Postgres, MinIO and Mailpit, never an outside host, and never the OpenAPI `servers`.
- **Redirect targets** are always same-site paths (Business rules, Redirects and Team and roles).
- **Boot.**
  - If Postgres is unreachable, the server retries for up to 60 seconds before listening, then exits with a non-zero status.
  - If MinIO or Mailpit is unreachable, it starts normally and serves the outage behaviour in Services.

### Browser support and performance (DP-36, DP-37, DP-49)

- Supported browsers: current Chromium, Firefox and WebKit.
- Published viewports: 375x812, 768x1024 and 1280x800, plus widths 320, 767, 1023 and 1024 for layout edges.
- A public page shows its article and sidebar within two seconds. The editor is usable within three seconds.
- Search results appear within one second after the debounce. Live updates arrive within one second.

### How Galley is checked (DP-04, DP-05, DP-16, DP-37, DP-40, DP-48)

- The verifier pauses the page clock and blocks service workers. It advances the page clock after each action before reading the page: 50 milliseconds of page time for anything without its own published timer. Client timers, debounces and animations must therefore run on page timers and animation frames, never on stylesheet animation events.
- Saved state is read only through page JSON, navigation JSON and publish-report JSON, never through the database schema.
- File storage and mail are read through MinIO and Mailpit themselves.
- Tests sign in through `/signin` in the browser. Invite links are read from Mailpit only. Data comes from the grading seed, and outages come from the outage route or the outage instances.
- Tests never compare screenshots. Only published widths, tap sizes and theme colours are measured on screen.

## Working rules

- **IF-01** — `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build or serve.
- **IF-02** — `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its version and licence, plus the bundled fonts.
- **IF-03** — Every shipped package is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0, and the fonts are under OFL-1.1.
- **IF-04** — The app uses only Postgres, MinIO and Mailpit: no other datastore, queue, search engine, cache server or outside service, and no AI or language-model package or key.
- **IF-05** — All application source is TypeScript; plain JavaScript appears only in generated build output and tool config files.
- **IF-06** — The provided service configuration (the dev compose file and its seeded credentials) is left unchanged.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` casts that escape type checking.
- Names in code match this brief's domain terms: page, path, redirect, snapshot, manifest, publish report, gate, splice, version, invite.
- Each domain rule is decided in exactly one place in the source. That covers page state transitions, publish status transitions, redirect collapsing and loop detection, the anchor rule, the gate's error order, search ranking and the helpful percentage.
- No abstraction has only one implementation, and there are no defensive checks for states the rules make impossible.
- There is no dead, commented-out or unreachable code.
- Every API error is produced through the one error shape and the one precedence rule.
- There are no features, routes or settings beyond this brief.
