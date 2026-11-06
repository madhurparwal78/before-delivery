# Tidewrack Cairn

Cairn is a local-first notebook of linked Markdown notes for independent investigative researchers: freelance investigative journalists, OSINT researchers and independent fact-checkers. The notebook is free and works in the browser without an account. Notes live on the device and still work with the network off. Two paid add-ons extend it. **Sync** carries end-to-end encrypted revisions of a case vault between the investigator's devices and a research partner's devices. The server only ever holds ciphertext and hashes. **Publish** turns a bounded slice of the case into a public dossier. The investigator draws the boundary on the Exposure Ring, and the server refuses to let anything outside it reach the published site. Cairn uses four backend services: PostgreSQL as the server-side system of record, MinIO for encrypted revision blobs and rendered dossier objects, Kill Bill for the Sync and Publish subscriptions, and Mailpit as the outbound mail sink. Out of scope: payment card collection (Kill Bill invoices accrue against the account), note attachments and images, real-time collaborative cursors, passphrase recovery, custom domains for dossiers, and any datastore beyond the four services named here.

## Problem and users

Investigators keep a case as hundreds of densely linked notes: people, companies, documents, timelines and sources. They need those notes on a laptop and a phone, often offline in the field. From time to time they also need to publish a slice of the case, such as an explainer, a public dossier or a corrections page. Today that means an encrypted notes app, a separate blog or wiki host, and manual copying between the two. Two things go wrong. On shared vaults, sync conflicts silently drop one device's edits because the latest timestamp wins. And publishing one linked note leaks the titles of the private notes it links to, through rendered links, backlink panels, link previews, search indexes and sitemaps. A single leaked title such as a source's role and city can burn that source. Researchers lose hours to manual redaction before each publish, lose field edits, and sometimes lose a source.

Users:

- **Freelance investigator** (daily). Captures and links case notes offline on two devices, syncs them, and publishes a bounded dossier without leaking any unpublished note's title.
- **Research partner** (weekly). Co-edits a shared case vault from their own device, and neither their edits nor the investigator's are ever silently overwritten. Restores earlier versions of a note when needed.
- **Commissioning editor** (occasional). Reviews a draft dossier through a time-limited preview link before it goes live, with no account.
- **Public reader** (occasional). Reads, searches and follows links inside a published dossier, usually on a phone.
- **Founder-operator** (weekly). Sees each account's Sync and Publish subscription state, watches the lapse and grace deadlines play out, and confirms that the server holds only ciphertext for synced notes.

## Journeys

1. **Field capture and two-device sync.** Start: the investigator has a fresh browser and no account. They open Cairn, load the sample case, edit a note and add a wikilink. The Backlinks tab updates. They create an account, add Sync, set a vault passphrase and create the vault. Every note's badge moves from "pending" to "synced". End: the global sync status reads all changes synced, and the notes survive a reload with the network off.
2. **Approving a second device.** Start: the investigator has an approved laptop and opens Cairn on their phone. They sign in. The phone shows that it is waiting for device approval, and an approval email arrives at their address. They open the email link and approve. End: the phone pulls the vault, they unlock it with the vault passphrase, and an edit made on the phone appears on the laptop at the next pull.
3. **Co-editing with a partner.** Start: the investigator owns a synced vault. They invite the research partner by email. The partner accepts the link, signs in, unlocks the vault with the passphrase the investigator gave them separately, and edits a note. The investigator edits the same note offline from the same revision. When the investigator reconnects, their push loses. End: their notebook shows the partner's version, their own edit survives as a visible conflict copy note, and the partner restores an earlier revision from the History tab, which appears as a new revision.
4. **Drawing the boundary and publishing.** Start: the investigator has the Publish add-on and the sample case. In the Publish tab they create a dossier rooted at the case's summary note and drag the Exposure Ring outward hop by hop. Nodes fill, links get cut, the counters change and the live preview shows cut links as plain text. They pin a source note as private, check that the server's boundary matches, and publish. End: the dossier is live at its public address, and no page, index or sitemap names any note outside the boundary.
5. **Editor review.** Start: a dossier is a draft. The investigator creates a preview link and sends it to the commissioning editor, who has no account. The editor reads the draft and follows its internal links. The investigator then revokes the link (or it reaches its expiry). End: the editor's next request shows the ended-link page.
6. **Reading on a phone, then takedown.** Start: a dossier is published. On a phone, the public reader opens it, follows links, checks the Linked from panel and searches. The investigator then narrows the boundary and republishes, and later takes the dossier down. End: pages for notes now outside the boundary, and finally every page, answer not found to the reader.
7. **Subscription lapse.** Start: the investigator has Sync and Publish and a live dossier. They cancel both add-ons. The vault stays writable until the grace deadline and then becomes read-only. Before the Publish takedown deadline the investigator receives a warning email, and at takedown the dossier goes offline and is marked lapsed. End: the founder-operator's console shows each deadline and the lapsed state, and storage holds no objects for that dossier.
8. **Storage outage in the field.** Start: the investigator is editing while object storage is unreachable. Pushes are refused and the app reports that sync is paused because storage is unavailable, with a count of queued revisions. A publish attempt leaves the live dossier untouched. End: once storage answers again, the queued revisions push on their own with no reload and no server restart, and the badges turn to synced.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Accounts with a home time zone** Creating an account records email, display name, password and an IANA time zone, signs the browser in as the account's first approved device, and answers the errors listed in API.
- **DP-02 — New-device approval email** Signing in from a new device on an account that already has an approved device sends one approval email to the account address, carrying the approval link and no note titles or note text.
- **DP-03 — Unapproved devices pull nothing** Until its approval link is used, a device is refused every vault key, revision list, blob and history request, and the approval link stops working after the expiry set in Business rules.
- **DP-04 — Second-device sign-in journey** An investigator signs in on a second browser, sees the waiting-for-approval state, approves from the email, sees the Unlock vault dialog within the approval detection delay from Business rules, and after entering the vault passphrase sees the vault's notes within the unlock delay from Business rules.
- **DP-05 — Local notebook without an account** Without signing in, a person creates, links and reopens notes that persist in the browser across reloads, including with the network off after the first load, and the Backlinks tab lists every note that links to the open note.
- **DP-06 — Ciphertext-only sync** Every synced revision reaches the server as an encrypted envelope, so no vault-blobs object and no database row contains a note's title, alias, frontmatter or body text.
- **DP-07 — Revision push and pull** A push based on the current head records the vault's next revision number and stores its blob under the key pattern from Services, and every vault member pulls revisions in revision order.
- **DP-08 — Retried pushes record once** Repeating a push with the same Idempotency-Key and body returns the original response and records no second revision, blob or cursor step, while the same key with a different body is refused as stated in API.
- **DP-09 — Honest per-note sync badge** A note's badge reads synced only after the server has recorded that note's latest revision, and a conflict or rejection turns the badge to the matching state from Feedback states.
- **DP-10 — Two-device field sync journey** Edits made on one of the investigator's devices appear on their other signed-in device within the pull interval from Business rules, and both badges read synced.
- **DP-11 — Boots and stays healthy with providers down** The server starts and passes its health check while storage or billing is unreachable, and each request that needs the missing provider gets the matching unavailable answer from API.
- **DP-12 — Storage outage reported honestly** While storage is unreachable, pushes, restores, publishes, preview links and takedowns are refused with the storage-unavailable answer, a refused publish leaves the previously live dossier unchanged, a refused takedown leaves the dossier offline as qualified in Business rules, and the app shows the sync-paused copy with the queued revision count.
- **DP-13 — Queued revisions resume by themselves** Revisions queued during a storage outage stay on the device across reloads and are pushed in order at the client's next retry once storage answers, with no server restart and no user action.
- **DP-14 — Billing outage keeps the last known plan** While Kill Bill is unreachable, plan changes are refused with the billing-unavailable answer and change nothing, and pushes and publishes use the account's last known entitlement, or get the billing-unavailable answer when none is known.
- **DP-15 — Shared-vault invite email** A vault owner's invite sends one email to the partner, with an expiring accept link and no vault name, note titles or note text, and accepting it makes the partner a vault member.
- **DP-16 — Vault isolation** Every blob, revision list, history, key, cursor or invite request for a vault the caller does not belong to answers not found, including when it reuses a real vault id, note id or revision number from another vault.
- **DP-17 — One winner per base revision** Of any number of simultaneous pushes to one note from the same base revision, exactly one is recorded and every other gets the conflict answer naming the current head.
- **DP-18 — Co-editing journey with conflict copies** When a device's push loses, its notebook shows the winning version, keeps the device's own edit as a visible conflict copy note, and lets the user restore an older revision from the History tab.
- **DP-19 — Version history** A note's history lists every revision recorded for it, newest first, with revision number, base revision, device name, time and any restored-from revision, and no entry is ever removed or changed.
- **DP-20 — Byte-exact restore as a new revision** Restoring a revision records a new head revision whose blob is byte-identical to the chosen revision's blob and whose base is the current head, and a stale base gets the conflict answer.
- **DP-21 — Server boundary preview** For a dossier's root note, a hop radius from 0 to 4 and the candidate notes, the manifest preview returns exactly the notes inside the boundary and the severed-link count defined in Business rules.
- **DP-22 — Exposure Ring controls and counters** The publish workbench shows the ring slider, hop stepper and counters, moves one hop per arrow key and straight to the chosen hop from the stepper, and its counters always equal the server's manifest preview for the same radius and private pins.
- **DP-23 — Boundary crossing sequence** Each time the boundary crosses a hop ring, nodes fill and gain checks, outbound links split with a scissor mark, the counters count to their new values and the live preview re-renders, in that order, and moving back reverses the sequence one hop at a time.
- **DP-24 — Reduced-motion Exposure Ring** When reduced motion is requested, the ring jumps between hops, cuts appear at once as dashed lines with scissor marks, the counters change without counting, and the boundary announcement live region reports each hop.
- **DP-25 — Exposure Ring look** The ring looks like a forensic instrument: concentric hop rings on a near-black canvas, amber only on public nodes, red with scissor marks only on cut links, and lock marks on private notes.
- **DP-26 — Dossier lifecycle** Dossiers move only along the transitions listed in Business rules, and any other move is refused with the dossier's current state.
- **DP-27 — All-or-nothing publish** A publish either stores every rendered object and then switches the live pointer, or leaves the previously live dossier serving exactly as before.
- **DP-28 — No leak beyond the boundary** No published or preview object (page, search index, sitemap, link preview or backlink panel) contains the title, alias, frontmatter or id of a note outside the boundary, and links to such notes render as unlinked text.
- **DP-29 — Publish journey** The investigator creates a dossier rooted at the note open in the editor, sets the boundary on the Exposure Ring, publishes, and opens the live dossier at its public address.
- **DP-30 — Draft preview links** A preview link shows only its own draft, stops working on the first request after it is revoked, replaced or expired, and refuses anything other than reading.
- **DP-31 — Editor review journey** The commissioning editor opens the preview link with no account, reads the draft and follows its internal links, and after revocation sees the ended-link page.
- **DP-32 — Takedown removes every object** Taking a dossier down deletes all of its pages, assets, search index, link previews and sitemap from storage, and every public address of the dossier answers not found on the next request.
- **DP-33 — Narrowing the boundary removes pages** Republishing with a smaller radius or a new private pin removes the pages, search entries, link previews and sitemap lines of notes now outside the boundary, and their addresses answer not found.
- **DP-34 — Allowlisted dossier pages** In published and preview pages, rendered note bodies contain only the allowlisted body elements, attributes and link schemes from Business rules and the page around them contains only the listed page-shell elements, so pasted scripts, event attributes and script URLs show up as inert text.
- **DP-35 — Public reader journey** On a phone, a public reader opens a dossier, follows internal links, uses the Linked from panel and searches the dossier, with results limited to published notes.
- **DP-36 — Sync and Publish in Kill Bill** Adding or cancelling an add-on creates the named plan on the account's Kill Bill account, or cancels it at the end of the term, and entitlement for pushes and publishes is read from Kill Bill on each request.
- **DP-37 — Sync grace then read-only** After the Sync period ends, the vault stays writable until the grace deadline from Business rules, then refuses pushes as read-only while pulls keep working.
- **DP-38 — Publish retention, warning and takedown** After the Publish period ends, live dossiers stay up until the takedown deadline, the warning email goes out at the warning time and always before takedown, and takedown removes every publish object and marks the dossiers lapsed.
- **DP-39 — Operator console** The founder-operator sees every account's plan states, deadlines, vault and blob counts and live dossiers, and can run the lapse check on demand.
- **DP-40 — Responsive three-column layout** At 375, 768 and 1280 pixel widths every screen fits without horizontal scrolling, with the rail, note column and context pane arranged as in Screens and layout.
- **DP-41 — Keyboard and focus** Every control in Public screens and controls can be reached with Tab in visual order and shows a visible focus ring, dialogs keep focus inside, Escape closes them, and focus returns to the control that opened them.
- **DP-42 — Nocturnal forensic look** Every view keeps the near-black ground, Fraunces headings, IBM Plex Sans body text and tabular mono numerals for counts and revision numbers, with amber only where something crosses the public boundary and on keyboard focus rings.
- **DP-43 — Credentials from the environment** Every service URL and credential is read from the environment variables named in Configuration and secrets, and none appears in source code or in anything sent to the browser.
- **DP-44 — Real client-side encryption** Note encryption and decryption run in the browser using the platform's built-in cryptography, and the server code never receives a vault key or vault passphrase.
- **DP-45 — Server boundary** The server enforces the content type, origin and body-size rules from Server boundary, and never serves source files or credentials.

## Frontend

### Screens and layout (DP-05, DP-18, DP-29, DP-35, DP-39, DP-40)

**Notebook (path `/`).** This is the main working screen and it has three columns.

- **File tree rail.** Holds the notebook switcher, the note list as a tree, and New note.
- **Note column.** Shows the open note: its title, an edit/read toggle, the private pin, the sync badge and the body, set to a reading line of about 68 characters. In read mode, wikilinks to existing notes are links that open those notes. Links to notes that don't exist show in muted text.
- **Context pane.** Has four tabs: Backlinks, History, Graph and Publish. Backlinks lists every note whose body links to the open note by title or alias. History lists the server revisions of the open note, and only appears for synced notes. Graph shows the open note at the centre with its linked notes on hop rings, read-only. Publish holds the publish workbench.

A top bar carries the global sync status and the Account button. The Account dialog holds sign-in or account creation, plans, devices, vault creation, invites and sign-out.

**Publish workbench (Publish tab).** The workbench contains:

- the dossier address and its state;
- the Exposure Ring canvas, with its slider handle, hop stepper and counters;
- the boundary check line;
- the live preview of the root note's page as it will publish;
- the publish, preview link, takedown and reopen controls.

**Approval page (`/devices/approve/<token>`), invite page (`/invites/<token>`) and operator console (`/ops`).** Each is a single centred column on every viewport. The operator console is a full-width table that scrolls vertically inside its own region. On narrow screens, each row stacks into a labelled card instead of scrolling sideways.

The console shows one row per account with the values from `GET /api/ops/accounts`, as defined in API:

- Vaults is `vault_count`.
- Ciphertext blobs is `blob_count`.
- Stored bytes is `stored_bytes`.
- Live dossiers lists the slugs in `live_dossiers`.

The values are fetched when the page loads and again after each Run lapse check now.

**Public dossier (`/d/<slug>/...`) and draft preview (`/p/<token>/...`).** These are single reading columns, each about 68 characters wide. The order from top to bottom is:

1. the dossier heading;
2. a navigation list of the dossier's notes;
3. the note body;
4. the Linked from panel;
5. the search form;
6. a footer line with the publish date and note count.

The draft preview adds a banner at the top.

Viewport arrangements:

| Viewport | Notebook | Publish workbench |
|---|---|---|
| 1280x800 | The rail, the note column and the context pane sit side by side. | The context pane widens to about half the screen and the note column narrows. The ring canvas sits on the left of the pane with the live preview on the right. |
| 768x1024 | Below 1024 pixels wide, the rail becomes a drawer opened by the Files button. The note column and the context pane sit side by side. | The workbench takes the full width under the top bar, with the canvas on top and the live preview below. |
| 375x812 | A single column showing the note. The rail is a drawer. Below 760 pixels wide, the context pane is a bottom sheet opened by the Context button. | The workbench is a full-height bottom sheet: the canvas scales to the screen width, with the stepper, counters, boundary check and live preview stacked below it. |

No screen scrolls horizontally at any of the three viewports.

### Public screens and controls (DP-04, DP-05, DP-09, DP-18, DP-22, DP-24, DP-29, DP-31, DP-35, DP-39, DP-41)

Only the controls and regions below are public, meaning tests and judges may touch them. Everything else is up to you. Copy for live regions is owned by Feedback states.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Top bar | `button "Account"` | "Account" |
| Top bar | `status "Sync status"` | global sync copy |
| Top bar (whenever the rail is a drawer, below 1024 px wide) | `button "Files"` | "Files" |
| Top bar (below 760 px) | `button "Context"` | "Context" |
| Rail | `navigation "Case files"` containing `combobox "Notebook"` and `tree "Notes"` with one `treeitem` per note, named by its title | note titles; each item also shows its sync badge text |
| Rail | `button "New note"` | "New note" |
| Rail (empty notebook only) | `button "Load sample case"` | "Load sample case" |
| Note column | `textbox "Note title"`, `textbox "Note body"` | — |
| Note column | `button "Read"` / `button "Edit"` | toggles the body between Markdown editing and the rendered reading view |
| Note column | `button "Pin as private"` with pressed state | "Private" with a lock icon when pressed |
| Note column | `status "Note sync status"` | the open note's badge |
| Note column | `region "Conflict"` containing `link "Open conflict copy"` and `button "Dismiss"` | conflict notice copy |
| Context pane | `complementary "Context"` with `tablist "Context"` and tabs `tab "Backlinks"`, `tab "History"`, `tab "Graph"`, `tab "Publish"` | — |
| Backlinks tab | `list "Backlinks"` of `link` items named by note title | — |
| History tab | `list "Revisions"`, one item per revision, each with `button "Restore r<rev>"` | "r<rev>", device name, time, "restored from r<rev>" when set |
| Restore | `dialog "Restore revision"` with `button "Restore"` and `button "Cancel"` | "Restore r<rev> as a new revision?" |
| Restore | `status "Restore status"` | restore copy |
| Account dialog | `dialog "Account"`; signed out: `textbox "Email"`, `textbox "Password"`, `textbox "Display name"`, `textbox "Device name"`, `button "Sign in"`, `button "Create account"` | — |
| Account dialog | `status "Account status"`; errors in an `alert` | account copy |
| Account dialog, signed in | `region "Plans"` with `button "Add Sync"`, `button "Cancel Sync"`, `button "Add Publish"`, `button "Cancel Publish"`, and `status "Plan status"` | each plan's state and dates |
| Account dialog, signed in | `list "Devices"`; `button "Sign out"` | device names with "approved" or "waiting for approval" |
| Account dialog, signed in | `button "Enable sync for this notebook"` | — |
| Vault | `dialog "Set vault passphrase"` with `textbox "Vault passphrase"`, `textbox "Confirm passphrase"`, `button "Create vault"` | — |
| Vault | `dialog "Unlock vault"` with `textbox "Vault passphrase"`, `button "Unlock"` | — |
| Vault | `button "Invite partner"` opening `dialog "Invite partner"` with `textbox "Partner email"`, `button "Send invite"` | — |
| Vault | `status "Vault status"` | vault copy |
| Global | `button "Sync now"` | "Sync now" |
| Publish tab | `textbox "Dossier address"`, `button "Create dossier"`; while another note's dossier is shown, `button "Start a dossier from “<title>”"` for the open note (typographic quotes; <title> is "Untitled" for a note with no title) | — |
| Publish tab | `status "Dossier state"` | "Draft", "In review", "Published", "Unpublished" or "Lapsed" |
| Exposure Ring | `group "Exposure Ring"` containing the canvas; every note node is an `img` named "<title>, hop <h>, public", "<title>, hop <h>, outside" or "<title>, hop <h>, private"; every cut link is an `img` named "Cut link <n>" | — |
| Exposure Ring | `slider "Publish boundary"` with values 0 to 4 and value text "Hop <h>" | the ring handle |
| Exposure Ring | `radiogroup "Hop"` with `radio "Hop 0"` through `radio "Hop 4"` | the hop stepper |
| Exposure Ring | `group "Exposure counts"` | "notes public <N> · links severed <M>" |
| Exposure Ring | `status "Boundary announcement"` (polite) | announcement copy |
| Exposure Ring | `status "Boundary check"` | boundary check copy |
| Publish tab | `region "Live preview"` | the root note's page as it would publish |
| Publish tab | `button "Publish dossier"` opening `dialog "Publish dossier"` with `button "Publish now"` and `button "Cancel"` | "Publish <N> notes and cut <M> links?" |
| Publish tab | `status "Publish status"` | publish copy |
| Publish tab | `button "Create preview link"`, read-only `textbox "Preview link"`, `button "Copy link"`, `button "Revoke preview link"` opening `dialog "Revoke preview link"` with `button "Revoke"`, `status "Preview link status"` | preview copy |
| Publish tab | `button "Take down dossier"` opening `dialog "Take down dossier"` with `button "Take down"`; `button "Reopen as draft"` | — |
| Approval page | `button "Approve this device"`, `status "Device approval status"` | — |
| Invite page | `button "Accept invite"`, `status "Vault status"` | — |
| Operator console | `table "Accounts"` with column headers Account, Time zone, Sync, Writable until, Publish, Warning at, Takedown at, Vaults, Ciphertext blobs, Stored bytes, Live dossiers | — |
| Operator console | `status "Billing source"`, `button "Run lapse check now"`, `status "Lapse check"` | — |
| Public dossier | `main` with `heading` level 1 (the note title); `navigation "Dossier"` with one `link` per published note | — |
| Public dossier | `region "Linked from"` with links to published notes that link to this page | "Linked from" |
| Public dossier | `search` landmark with `searchbox "Search this dossier"` and `button "Search"`; `list "Search results"` | — |
| Public dossier | `tooltip` link preview | title and excerpt of a published note |
| Draft preview | `region "Draft preview"` | "Draft preview · expires <when>" |

### Interactions (DP-04, DP-05, DP-13, DP-18, DP-22, DP-23, DP-35, DP-41)

- **Notes.** New note creates an untitled note, opens it in edit mode and focuses the title. Typing saves to the device about one second after the last keystroke. If the notebook is synced, that save also queues a revision. Read and Edit toggle the body. In read mode, clicking a wikilink opens its note and moves focus to the note title. Load sample case fills an empty notebook with the sample case from Seed data. Pin as private toggles the note's private pin, and the change is saved like any other edit.
- **Notebook switcher.** The combobox lists the local notebook and every vault the account belongs to. Choosing one replaces the tree and opens its first note.
- **Account dialog.** Opens from Account, and focus lands on its first field. Enter submits the focused form. Escape closes the dialog and returns focus to Account. Create account sends the browser's own IANA time zone. Add and Cancel buttons call the billing API and show the result in the plan status region. After a new-device sign-in, the device polls for approval as described in Business rules. At the first poll that sees the approval, the Unlock vault dialog opens for each vault, within the approval detection delay from Business rules. After a correct passphrase, the vault's notes appear within the unlock delay from Business rules. **Locked vaults:** When the signed-in account can see a vault that this browser has not unlocked, the Unlock vault dialog opens by itself. Dismissing it leaves the vault in `combobox "Notebook"` as "<vault name> · locked", and choosing that entry opens the dialog again.
- **Conflicts.** When a push loses, the client pulls the head, puts the winning version into the note, and creates a conflict copy note holding the device's own edit. The copy is titled as described in Feedback states and gets a red conflict marker in the tree. The original note shows the Conflict region. Open conflict copy opens the copy. Dismiss hides the notice and sets the original note's badge back to synced.
- **History.** Restore r<rev> opens the Restore revision dialog with focus on Restore. Confirming restores the revision, refreshes the note body, and puts the new revision at the top of the list. Cancel or Escape closes the dialog and returns focus to the button that opened it.
- **Exposure Ring.**
  - **Mouse and touch.** Drag the ring handle anywhere along its radius. The boundary circle follows the pointer continuously, and every hop ring it passes triggers the crossing sequence from Motion and effects. On release, the circle settles to the nearest hop. While a finger drags the handle, the page does not scroll.
  - **Keyboard.** With the slider focused, ArrowRight and ArrowUp move out one hop, ArrowLeft and ArrowDown move in one hop, Home goes to hop 0 and End goes to hop 4. Choosing a radio in the Hop stepper moves straight to that hop, running the crossing sequence once for each ring crossed.
  - **Boundary check.** After each settle, the workbench asks the server for a manifest preview. If the hop changes before the answer arrives, that answer is ignored.
  - **Private pins.** Pinning or unpinning a note as private while the workbench is open recomputes the boundary at the current hop.
- **Publishing.** Create dossier makes a Draft dossier rooted at the note open in the editor. The Publish tab shows the dossier rooted at the open note; when the open note roots no dossier, it keeps showing the dossier last worked on, at the hop last set for it, and Start a dossier from “<title>” brings up the Dossier address form for the open note. Publish dossier opens a confirmation dialog that repeats the counts. The button is disabled until the boundary check reads as a match. Copy link copies the preview URL. Revoke preview link and Take down each act after one confirmation: a dialog named "Revoke preview link" or "Take down dossier", whose confirm button is `button "Revoke"` or `button "Take down"`.
- **Public reader.** Hovering a link to a published note, or focusing it with the keyboard, shows its preview tooltip after about a third of a second. Moving away or pressing Escape hides it. On touch screens a tap simply follows the link. Search submits to the dossier's search page.
- **Keyboard everywhere.** Tab follows the visual order: top bar, rail, note column, then context pane. Every interactive element shows a visible amber focus ring. Dialogs and bottom sheets keep Tab inside themselves until they close. Escape closes the topmost dialog, sheet or drawer, and focus returns to the control that opened it.

### Visual design (DP-25, DP-42)

- **Ground and surfaces.** The ground is a near-black with a faint cool cast in every view, including the public dossier. Panels, sheets and the canvas sit on a slightly lighter charcoal surface. Text is a warm parchment off-white. Secondary text is the same parchment at reduced strength, and it still meets the contrast rule below.
- **Amber accent.** One saturated amber marks anything that is public or about to become public: public nodes on the ring, the Publish button, the Published state and internal links in published pages. The one other use is the keyboard focus ring on every interactive element. That is an accessibility cue and carries no boundary meaning.
- **Brick red.** A brick red is kept for cut links, conflicts and errors, and always comes with an icon (a scissor, a warning triangle or a broken link) so meaning never depends on colour alone. Nothing else uses saturated colour.
- **Type.** Note titles, dossier headings and screen headings use Fraunces, a sharp, high-contrast serif. Body text and controls use IBM Plex Sans. Every count, revision number, hop value, byte size and timestamp is set in IBM Plex Mono with figures of equal width, so columns of numbers line up. Each heading level is about one fifth larger than the level below it.
- **Density and composition.** Spacing is comfortable, with clear air between list rows. The note column keeps a reading line of about 68 characters. The composition reads like a forensic desk: a quiet rail, a calm reading column, and a context pane where all the instruments live.
- **Icons.** Lucide icons, drawn in thin strokes.
- **Accessibility.** Tap targets are at least 44 by 44 pixels. All text and meaningful graphics meet WCAG 2.2 AA contrast against their background.

### Motion and effects (DP-23, DP-24)

- **Panels, sheets and drawers.** They slide in from their edge in about a quarter of a second, starting fast and settling softly, and leave in about a sixth of a second.
- **Badge changes.** Badges cross-fade in about a sixth of a second.
- **Hover and press.** Buttons lighten their surface within about a tenth of a second on hover and darken slightly on press. The ring handle grows a little on hover and focus.
- **Pending indicator.** While a sync request is in flight, the global sync status shows a softly pulsing dot. It stops the moment the request settles.
- **Signature: the Exposure Ring crossing.**
  - **Layout.** The root note sits at the centre. Notes sit on four evenly spaced concentric rings by hop distance, with hop 4 near the canvas edge. Each note reached through a link is drawn at its hop. Link targets that are not on the rings, meaning a note beyond hop 4 or a link to a note that doesn't exist, appear as small unnamed stubs just outside the outer ring. The boundary is a circle whose radius runs from the centre (hop 0) to the outer ring (hop 4).
  - **Moving outward.** Each time the circle crosses a ring outward, four steps play in order, each starting when the previous one ends:
    1. Over about a sixth of a second, nodes newly inside fill with amber and gain a check mark.
    2. Over just over a quarter of a second, every link from an inside node to an outside node or stub snaps. The line splits at its midpoint, both halves pull back towards their ends, and a red scissor mark appears at the gap. Links that now join two inside nodes rejoin and turn amber.
    3. Over a little under half a second, the counters count up or down to their new values.
    4. The live preview re-renders, and every link to a note outside the boundary becomes plain unlinked text.
  - **Moving inward.** Crossing a ring inward reverses the same steps one hop at a time: nodes lose their fill and check, cut marks move inward, the counters count back, and the preview re-renders.
  - **Snap and timing.** On release, the circle settles to the nearest hop in about a quarter of a second. A whole crossing finishes in under one second.
  - Private notes keep a lock mark and stay unfilled at every radius.
- **No other loops.** No decorative or looping animation exists anywhere other than the pending dot.
- **Reduced motion.** When the system asks for reduced motion:
  - panels, sheets and badges change instantly;
  - the pending dot is static;
  - the ring jumps straight to each hop with no sweep;
  - nodes fill at once;
  - cut links change at once to a dashed red style with the scissor mark;
  - the counters show their new values without counting;
  - the preview re-renders at once.

  The Hop stepper and the Boundary announcement live region are present in every mode, and they give the same control and the same feedback.

### Feedback states (DP-09, DP-12, DP-13, DP-14, DP-18, DP-22, DP-24, DP-30, DP-35, DP-39)

Placeholders used in this section:

- `<n>` is the number of revisions queued on the device.
- `<N>` and `<M>` are the public note count and severed link count.
- `<h>` is the hop, from 0 to 4.
- `<rev>` and `<new>` are revision numbers.
- `<email>` is an email address.
- `<when>` is a date and time in the viewer's account time zone (for public and preview pages, the dossier owner's time zone), formatted like "27 Oct 2026, 14:05".
- `<inviter>` is the inviter's display name.
- `<q>` is the search text.

**Global `status "Sync status"`.** Exactly one of these at a time:

| State | Copy |
|---|---|
| Signed out | "Local only — not syncing" |
| Device waiting for approval | "Waiting for device approval — check your email" |
| Requests in flight | "Syncing — <n> queued" |
| Everything acknowledged | "All changes synced" |
| Browser offline | "Offline — <n> queued" |
| Storage unavailable | "sync paused: storage unavailable — <n> queued" |
| Billing unavailable and no entitlement known | "sync paused: billing unavailable — <n> queued" |
| Vault read-only | "Vault is read-only — Sync has lapsed" |

**Per-note badge.** Shown in `status "Note sync status"` and in the tree. Exactly one of:

| Badge | When |
|---|---|
| "local only" | not in a vault |
| "pending" | saved on the device, not yet acknowledged |
| "synced" | the server answered created, or a replay of created, for the note's latest revision |
| "conflict" | the push lost |
| "sync error" | the push was refused as read-only, not entitled or invalid |
| "paused" | storage or billing is unavailable |

A "sync error" badge also shows "This revision was rejected: <server message>" under the title.

**Conflict.** The conflict copy is titled "<original title> (conflict copy, <device name>)". The Conflict region reads "Another device saved this note first. Your version is kept as a conflict copy."

**Account status.**

| Situation | Copy |
|---|---|
| Pending | "Signing in…" or "Creating account…" |
| Signed in | "Signed in as <email>" |
| Account created | "Account created — this browser is your first device." |
| Wrong credentials | "Wrong email or password." |

Field errors show the server's message for each field, under the field, and in the dialog's `alert`.

**Device approval status.**

| Situation | Copy |
|---|---|
| Approved | "Device approved. You can close this tab." |
| Expired | "This approval link has expired. Sign in again on the new device to get a fresh one." |
| Already used | "This device is already approved." |

**Plan status.**

| Situation | Copy |
|---|---|
| Pending | "Updating plan…" |
| Active | "Sync active" or "Publish active" |
| Ending | "Sync ends <when>" or "Publish ends <when>" |
| Billing outage | "Billing is unavailable. Your plan hasn't changed — try again shortly." |

**Vault status.**

| Situation | Copy |
|---|---|
| Creating | "Creating vault…" |
| Created | "Vault created — this notebook now syncs" |
| Invite created | "Invite created — an email is on its way to <email>" |
| Invite accepted | "You've joined the vault. Enter the vault passphrase from <inviter> to unlock it." |
| Invite expired | "This invite has expired." |
| Wrong recipient | "This invite was sent to a different email address." |
| Wrong passphrase | "That passphrase doesn't unlock this vault." |

**Restore status.**

| Situation | Copy |
|---|---|
| Pending | "Restoring r<rev>…" |
| Success | "Restored r<rev> as r<new>" |
| Conflict | "This note changed on another device. The latest version is loaded — choose a revision again." |
| Storage outage | "Restore paused: storage unavailable. Nothing changed." |

**Exposure Ring.**

- `group "Exposure counts"` shows "notes public <N> · links severed <M>".
- `status "Boundary announcement"` shows "Hop <h>: <N> notes public, <M> links severed".
- `status "Boundary check"`:

| Situation | Copy |
|---|---|
| Pending | "Checking boundary…" |
| Match | "Server boundary matches: <N> public · <M> severed" |
| Mismatch | "Server boundary differs — publishing is blocked until it matches" |
| Failure | "Boundary check unavailable — try again" |

**Publish status.**

| Situation | Copy |
|---|---|
| Pending | "Publishing…" |
| Success | "Published <N> notes · <M> links severed" |
| Storage outage | "Publish paused: storage unavailable. The live dossier hasn't changed." |
| Not entitled | "Publishing needs the Publish add-on." |
| Already running | "Another publish of this dossier is still running." |
| Takedown pending | "Taking down…" |
| Takedown success | "Dossier taken down" |
| Takedown storage outage | "Takedown paused: storage unavailable. Try again shortly." |
| Reopened | "Reopened as draft" |
| Billing outage | the Plan status billing-outage copy |

**Preview link status.**

| Situation | Copy |
|---|---|
| Pending | "Creating preview link…" |
| Success | "Preview link ready — expires <when>" |
| Revoked | "Preview link revoked" |
| Storage outage | "Preview paused: storage unavailable." |

**Public and preview pages.**

| Situation | Copy |
|---|---|
| Not found | "This dossier isn't available." |
| Ended preview link | "This preview link has ended." |
| Storage outage | "This dossier is temporarily unavailable." |
| No search results | "No published notes match <q>." |

**Operator console.**

- `status "Billing source"` reads "Live from Kill Bill", or during a billing outage "Billing unavailable — showing last known state from <when>".
- `status "Lapse check"` reads "Running lapse check…" while running, then "Lapse check done: <w> warnings sent, <t> dossiers taken down", where `<w>` and `<t>` are the counts returned by the sweep.
- A footer line reads "Every stored revision passed the encrypted-envelope check on upload."

## Backend

### API (DP-01, DP-02, DP-03, DP-07, DP-08, DP-11, DP-12, DP-14, DP-15, DP-16, DP-17, DP-19, DP-20, DP-21, DP-26, DP-27, DP-30, DP-32, DP-34, DP-36, DP-39)

**General conventions.**

- All `/api` bodies are JSON (`application/json; charset=utf-8`).
- Timestamps are UTC ISO 8601 with seconds and a trailing `Z`.
- Ids are UUIDs. Revision numbers are positive integers.
- Authentication uses the `cairn_session` cookie (HttpOnly, SameSite=Lax, Path=/), set by sign-up and sign-in.

**Error shape.** Every error uses one shape:

`{"error":{"code":"<code>","message":"<human text>"}}`

Validation errors add `"fields":{"<field>":"<message>"}` and use code `validation_failed` with status 422. Some codes add the extra keys listed with their endpoint.

**Error precedence.** The whole API checks errors in this order, and the first failing check answers:

1. Server boundary checks (415, 413, cross-origin 403).
2. Unauthenticated: `401 unauthenticated`.
3. Unknown resource, or a resource in a vault, dossier or account the caller doesn't belong to: `404 not_found`.
4. For requests with an `Idempotency-Key` already used by this device on this endpoint: the stored response, or `409 idempotency_key_reused`.
5. Forbidden (403).
6. Not entitled (402). `503 billing_unavailable` takes the place of 402 when entitlement can't be determined.
7. State conflicts (409, 410).
8. Validation (422).
9. `503 storage_unavailable` or `503 billing_unavailable` when the provider the action needs doesn't answer.

Each endpoint below lists only its own extra errors.

**Common objects.**

- `Account`: `{"id","email","display_name","time_zone","operator":bool}`
- `Device`: `{"id","name","approved":bool,"created_at"}`
- `Vault`: `{"id","name","role":"owner"|"partner","created_at"}`
- `Revision`: `{"rev","note_id","base_revision":int|null,"ciphertext_sha256","byte_length","device_id","device_name","created_at","restored_from":int|null}`
- `Dossier`: `{"id","slug","root_note_id","state","radius":int|null,"public_count":int|null,"severed_count":int|null,"published_at":ts|null,"url":"/d/<slug>/","preview_link":PreviewLink|null}`
- `PreviewLink`: `{"id","state":"active"|"revoked"|"replaced"|"expired","created_at","expires_at"}`
- `Addon`: `{"state":"none"|"active"|"ending"|"grace"|"lapsed","period_end":ts|null,"checked_at":ts,"source":"killbill"|"cache"}`. Sync adds `"writable_until":ts|null`. Publish adds `"warning_at":ts|null,"takedown_at":ts|null`.

**Health**

- `GET /api/health` → `200 {"status":"ok"}`

**Accounts, sessions and devices**

- `POST /api/accounts` with body `{"email","password","display_name","time_zone","device_name"}`
  - Success: `201 {"account":Account,"device":Device}`. The device is approved and the session cookie is set.
  - `409 email_taken`.
  - 422 fields:
    - `email`: must be a valid address, up to 254 characters;
    - `password`: 10 to 128 characters;
    - `display_name`: 1 to 60 characters;
    - `time_zone`: must be an IANA zone name;
    - `device_name`: 1 to 40 characters.
- `POST /api/sessions` with body `{"email","password","device_name","device_id":uuid|null}`
  - Success: `200 {"account":Account,"device":Device}` and the session cookie is set. A `device_id` that belongs to this account reuses that device. Otherwise a new device is created.
  - Wrong credentials: `401 invalid_credentials`.
- `DELETE /api/sessions/current` → `204`
- `GET /api/me` → `200 {"account":Account,"device":Device}`
- `GET /api/devices` → `200 {"devices":[Device]}`
- `POST /api/device-approvals/<token>` (no session needed)
  - Success: `200 {"device":Device}`.
  - Unknown token: `404 not_found`. Already used: `409 link_used`. Expired: `410 link_expired`.

**Vaults**

- `POST /api/vaults` with body `{"name","key_envelope":{"salt","iterations","iv","wrapped_key"}}`
  - `salt`, `iv` and `wrapped_key` are base64, and `iterations` is an integer.
  - Success: `201 {"vault":Vault}`.
  - `402 sync_not_entitled` unless the caller's Sync state is `active`.
  - `403 device_not_approved`.
  - 422 fields `name` (1 to 80 characters) and `key_envelope`.
- `GET /api/vaults` → `200 {"vaults":[Vault]}`
- `GET /api/vaults/<vault_id>`
  - Success: `200 {"vault":Vault,"key_envelope":{...},"members":[{"display_name","role"}],"head":int|null}`.
  - `403 device_not_approved`.
- `POST /api/vaults/<vault_id>/invites` with body `{"email"}`
  - Success: `201 {"invite":{"id","email","expires_at"}}`.
  - `403 not_vault_owner`.
  - 422 field `email`.
- `POST /api/invites/<token>/accept` (session needed)
  - Success: `200 {"vault":Vault}`.
  - `403 invite_email_mismatch`; `409 link_used`; `410 link_expired`.

**Revisions.** Every revision endpoint also answers `403 device_not_approved`.

- `POST /api/vaults/<vault_id>/notes/<note_id>/revisions`
  - Header `Idempotency-Key`: 8 to 128 characters from letters, digits, `-` and `_`. Required.
  - Body `{"base_revision":int|null,"ciphertext":"<base64>","ciphertext_sha256":"<64 lowercase hex>"}`.
  - Success: `201 {"revision":Revision,"cursor":int}`.
  - `403 vault_read_only`.
  - `409 revision_conflict` with extra key `"head_revision":int|null`.
  - 422 fields:
    - `Idempotency-Key`;
    - `ciphertext`: not base64, not an encrypted envelope, or over the size limit;
    - `ciphertext_sha256`: does not match the SHA-256 of the decoded ciphertext bytes;
    - `base_revision`.
  - `503 storage_unavailable`.
- `POST /api/vaults/<vault_id>/notes/<note_id>/restore`
  - Header `Idempotency-Key` with the same rules.
  - Body `{"revision":int,"base_revision":int}`.
  - Success: `201 {"revision":Revision,"cursor":int}`.
  - `404` when the revision doesn't belong to this note.
  - `403 vault_read_only`; `409 revision_conflict` with `head_revision`; `503 storage_unavailable`.
- `GET /api/vaults/<vault_id>/revisions?after=<int, default 0>&limit=<1..500, default 100>`
  - Success: `200 {"revisions":[Revision],"next_after":int,"cursor":int}`, in ascending revision order.
  - 422 fields `after` and `limit`.
- `GET /api/vaults/<vault_id>/revisions/<rev>/blob`
  - Success: `200`, `application/octet-stream`, the exact stored ciphertext bytes.
  - `503 storage_unavailable`.
- `GET /api/vaults/<vault_id>/notes/<note_id>/history` → `200 {"note_id","revisions":[Revision]}`, newest first.
- `GET /api/vaults/<vault_id>/cursor` → `200 {"device_id","cursor":int}`

**Billing**

- `GET /api/billing` → `200 {"sync":Addon,"publish":Addon}`
- `POST /api/billing/subscriptions` with body `{"addon":"sync"|"publish"}`
  - Success: `201 {"sync":Addon,"publish":Addon}`.
  - `409 already_subscribed`.
  - 422 field `addon`.
  - `503 billing_unavailable`.
- `DELETE /api/billing/subscriptions/<addon>`
  - Success: `200 {"sync":Addon,"publish":Addon}`.
  - `409 not_subscribed`; `503 billing_unavailable`.

**Dossiers.** Here `notes` is the candidate list: `[{"id":uuid,"title":string,"aliases":[string],"frontmatter":object,"body":string,"private":bool}]`.

- `POST /api/dossiers` with body `{"slug","root_note_id"}`
  - Success: `201 {"dossier":Dossier}` in state `draft`.
  - `402 publish_not_entitled`; `409 slug_taken`.
  - 422 field `slug`: 3 to 48 characters from lowercase letters, digits and hyphens.
- `GET /api/dossiers` → `200 {"dossiers":[Dossier]}`
- `GET /api/dossiers/<id>` → `200 {"dossier":Dossier}`
- `POST /api/dossiers/<id>/manifest-preview` with body `{"radius":0..4,"notes":[...]}`
  - Success: `200 {"radius","public_count","severed_count","inside":[{"note_id","hop"}]}`, with `inside` sorted by hop and then note id. Nothing is stored.
  - 422 fields `radius` and `notes`. The `notes` messages are:
    - "must include the root note";
    - "root note cannot be private";
    - "duplicate title or alias";
    - "duplicate id";
    - "at most 500 notes".
- `POST /api/dossiers/<id>/publish` with the same body
  - Success: `200 {"dossier":Dossier}`.
  - `402 publish_not_entitled`.
  - `409 invalid_transition` with extra key `"state"`.
  - `409 publish_in_progress`.
  - 422 as for manifest preview.
  - `503 storage_unavailable`.
- `POST /api/dossiers/<id>/unpublish`
  - Success: `200 {"dossier":Dossier}`.
  - `409 invalid_transition`; `503 storage_unavailable`.
- `POST /api/dossiers/<id>/reopen`
  - Success: `200 {"dossier":Dossier}`.
  - `409 invalid_transition`.
- `POST /api/dossiers/<id>/preview-links` with the same body as publish
  - Success: `201 {"preview_link":PreviewLink,"url":"/p/<token>/"}`. The URL is returned only here.
  - `402 publish_not_entitled`; `409 invalid_transition`; 422 as above; `503 storage_unavailable`.
- `GET /api/dossiers/<id>/preview-links` → `200 {"preview_links":[PreviewLink]}`, newest first, without tokens.
- `DELETE /api/dossiers/<id>/preview-links/<link_id>`
  - Success: `200 {"preview_link":PreviewLink}`.
  - `409 preview_link_inactive`.

**Operator**

- `GET /api/ops/accounts`
  - Success: `200 {"source":"killbill"|"cache","accounts":[{"account":Account,"sync":Addon,"publish":Addon,"vault_count","blob_count","stored_bytes","live_dossiers":[{"slug","published_at"}]}]}`.
  - `vault_count` is the number of vaults the account owns (role `owner`). Partner memberships are not counted.
  - `blob_count` is the number of revisions recorded in those owned vaults, including restores. Each revision is one `vault-blobs` object.
  - `stored_bytes` is the sum of those revisions' `byte_length`. Publish and preview objects are not counted.
  - `live_dossiers` lists the account's dossiers whose state is `published` and whose live pointer is set. Dossiers in `draft`, `in_review`, `unpublished` or `lapsed` are not listed.
  - `403 not_operator`.
- `POST /api/ops/sweep`
  - Success: `200 {"warnings_sent":int,"dossiers_taken_down":int,"objects_removed":int}`.
  - `403 not_operator`; `409 sweep_running`.

**Public routes (no session).** These pages are HTML. Every response carries `Cache-Control: no-cache` and a content security policy that allows scripts, styles and fetches only from the same origin and blocks all frames and plugins. Preview responses also carry `X-Robots-Tag: noindex`.

| Route | Answer |
|---|---|
| `GET /d/<slug>/` | the root page |
| `GET /d/<slug>/<page_slug>` | a published note's page |
| `GET /d/<slug>/search?q=<text>` | server-rendered results |
| `GET /d/<slug>/sitemap.xml` | the sitemap |
| `GET /d/<slug>/search-index.json`, `GET /d/<slug>/previews.json`, `GET /d/<slug>/assets/<file>` | the stored objects |
| `GET /p/<token>/`, `GET /p/<token>/<page_slug>`, `GET /p/<token>/previews.json`, `GET /p/<token>/assets/<file>` | preview pages and objects |

- A dossier with no live publish, or an unknown page or file: `404` with the not-found copy.
- A preview token that was never issued: `404` with the not-found copy.
- A revoked, replaced or expired token: `410` with the ended-link copy.
- Any method other than GET or HEAD on `/d/` or `/p/`: `405`.
- Storage unreachable while serving a dossier that has a live pointer, or an active preview link: `503` with the temporarily-unavailable copy.

Public routes decide the 404 and 410 answers from PostgreSQL alone, before touching storage, so a dossier with no live pointer answers 404 even while storage is unreachable.

**Browser routes.** `/`, `/ops`, `/devices/approve/<token>` and `/invites/<token>` serve the app shell.

### Business rules (DP-03, DP-04, DP-06, DP-07, DP-08, DP-09, DP-10, DP-13, DP-14, DP-17, DP-19, DP-20, DP-21, DP-22, DP-26, DP-27, DP-28, DP-30, DP-32, DP-33, DP-34, DP-36, DP-37, DP-38)

**Devices and approval**

- A sign-in on an account with no approved device approves that device immediately. Any other new device starts unapproved, and the server sends it the approval email.
- An approval link is valid while the current time is before its creation time plus `CAIRN_DEVICE_APPROVAL_TTL_SECONDS` (default 1800). It works once.
- An unapproved device polls `GET /api/me` every 5 seconds. The Unlock vault dialog opens within 5 seconds of the approval link being used. This is the approval detection delay.
- After the correct vault passphrase is entered in the Unlock vault dialog, the vault's notes appear in the `tree "Notes"` within 5 seconds. This is the unlock delay.

**Encrypted envelope**

- Each note is encrypted in the browser as one JSON object with title, aliases, frontmatter, body and private pin. Encryption uses AES-GCM with the vault's 256-bit key and a fresh 12-byte IV.
- The blob is the 4 ASCII bytes `CRN1`, then the IV, then the ciphertext with its 16-byte tag.
- A push sends the blob base64-encoded in `ciphertext`. `ciphertext_sha256` is the SHA-256 of the decoded blob bytes, not of the base64 text. These are the exact bytes stored in MinIO and returned by the blob endpoint.
- The server refuses a ciphertext that doesn't start with `CRN1`, is shorter than 32 bytes, or is longer than 2,000,000 bytes after base64 decoding. Exactly 2,000,000 bytes is allowed.
- The vault key is created in the browser. It is wrapped with a key derived from the vault passphrase by PBKDF2-SHA-256 with 600,000 iterations and a random 16-byte salt. The server stores only the wrapped key envelope.
- Vault passphrases are at least 12 characters, checked in the browser. A lost passphrase cannot be recovered.

**Revision log**

- Each vault numbers its revisions consecutively from 1.
- A push is recorded only if its `base_revision` equals the note's current head. A first push of a note has base `null` and is recorded only if the note has no revisions yet.
- Of any set of simultaneous pushes from the same base, exactly one is recorded. Every other one answers `revision_conflict` with the head that won. No losing push is ever applied.
- A recorded revision is never edited or deleted.
- A restore copies the chosen revision's blob byte-for-byte into a new revision. That new revision's base is the stated current head and its `restored_from` is the chosen revision.

**Repeated requests**

- Push and restore keys are scoped to the device and the endpoint. They are kept for `CAIRN_IDEMPOTENCY_TTL_SECONDS` (default 86400).
- A repeat with the same key and the same body returns the stored status and body with the header `Cairn-Replayed: true`. It records nothing: no new revision, blob or cursor change.
- A repeat with the same key and a different body answers `409 idempotency_key_reused`.
- Only 2xx and 4xx responses are stored. A 503 leaves the key free, so the retry can succeed.

**Device cursor**

- Each device has one cursor per vault: the highest revision number recorded by that device or returned to it by a pull. The cursor never moves backwards.

**Sync timing (browser)**

- The client pushes queued revisions one at a time, in the order they were saved.
- While signed in and visible, it pulls every 15 seconds, when the window gains focus, and on Sync now.
- After a storage or billing 503 or a network failure, it retries the oldest queued revision every 10 seconds. Queued revisions survive reloads.

**Badge rules**

- A note's badge becomes "synced" only when the server's answer for that note's latest queued revision is 201, or a replay of a 201.
- A 409 conflict sets "conflict" and starts the conflict copy flow from Interactions.
- A 402, 403 or 422 answer sets "sync error".
- A 503 sets "paused".
- An edit made after an acknowledged revision sets "pending" again.

**Entitlement and deadlines**

- **Source of entitlement.** Entitlement comes from the account's Kill Bill subscription for each add-on. It is read from Kill Bill on every push, restore, vault creation, dossier creation, preview link creation and publish, and on every sweep. Each successful read is cached. When Kill Bill doesn't answer, the cached state is used, and with no cache the request answers `503 billing_unavailable`.
- **Period end.** When Kill Bill shows a billing end date for the subscription, the period end is 00:00 on that date in the account's time zone.
- **Add-on states.**
  - `none`: no subscription.
  - `active`: no billing end date.
  - `ending`: the period end is in the future.
  - `grace`: the period end has passed but the add-on's deadline has not.
  - `lapsed`: the deadline has passed.
- **Sync deadline (`writable_until`).** Seven calendar days after the period end in the account's time zone. When `CAIRN_SYNC_GRACE_SECONDS` is set, it is instead that many seconds after the period end.
  - Pushes and restores are allowed in `active`, `ending` and `grace`. Once `lapsed`, they answer `403 vault_read_only`, while pulls, blobs and history keep working.
  - Pushes to a shared vault follow the vault owner's Sync state.
- **Publish deadlines.**
  - `takedown_at` is 14 calendar days after the period end, or `CAIRN_PUBLISH_RETENTION_SECONDS` seconds after it when that variable is set.
  - `warning_at` is 3 calendar days before `takedown_at`, or `CAIRN_PUBLISH_WARNING_LEAD_SECONDS` seconds before it when that variable is set.
  - Creating dossiers, preview links and publishes needs Publish to be `active` or `ending`.
- **New subscriptions.** A new subscription is allowed only when Kill Bill has no active subscription for that add-on. When it is created, the add-on returns to `active` and any pending read-only state or takedown is cleared.

**Sweep**

- The server runs a sweep every `CAIRN_SWEEP_INTERVAL_SECONDS` (default 30, allowed 1 to 60). `POST /api/ops/sweep` runs one immediately.
- Each sweep does the following:
  1. Refreshes entitlement from Kill Bill for every account that has a non-`none` add-on.
  2. Sends the Publish warning email once per lapse to each account whose `warning_at` has passed and that has a published dossier.
  3. Takes down, as `lapsed`, every published dossier of each account whose `takedown_at` has passed and whose warning was sent in an earlier sweep. If both are due in the same sweep, only the warning is sent and the takedown waits for the next sweep.
  4. Deletes objects for ended preview links and for publish ids that never went live.
  5. Retries unsent emails.
- Takedowns from the sweep remove objects exactly as an unpublish does.

**Boundary**

- **Wikilinks.** A wikilink is `[[target]]`, `[[target|label]]`, `[[target#heading]]` or `[[target#heading|label]]`. The target is the text before `#` or `|`, trimmed. It resolves to the candidate note whose title or alias matches it, ignoring case.
- **Hops.** The hop of a note is the fewest outgoing-link steps from the root note, travelling only through notes that are not private.
- **Inside set.** For radius r, the inside set is every non-private candidate note with hop ≤ r. The root is always inside. Private notes are never inside and are never travelled through.
- **Severed count.** The severed count is the number of distinct pairs (inside note, link target text compared ignoring case) whose target does not resolve to an inside note. This includes targets that are private, beyond the radius, or not among the candidates.
- **Candidate notes.** The browser sends as candidates every non-private note within hop 4 of the root. It never sends private notes, but if one arrives marked private the server applies the same rules.
- **Same answer everywhere.** The workbench counters, the manifest preview and the stored publish all use these rules, and they agree for the same radius and pins.

**Rendering allowlist.** This applies to published and preview pages. The body rules below cover the markup rendered from a note's Markdown. The page-shell rule covers everything around it.

- Note bodies are Markdown. Markdown headings of levels 1, 2 and 3 render as levels 2, 3 and 4, and deeper ones render as level 4. Each page's level 1 heading is its note title.
- Allowed body elements: paragraphs, headings of levels 2 to 4, emphasis, strong, inline code, code blocks, block quotes, ordered and unordered lists, list items, horizontal rules, line breaks, tables (head, body, rows, header and data cells) and links.
- Inside the body, the only allowed attributes are `href` and `rel` on links.
- **Page shell.** Around the body, a page contains only these elements:
  - the document root element and the body element;
  - the document head, with a character-set meta tag, a viewport meta tag, a title, one stylesheet link to the dossier's `assets/reader.css`, and one script element whose source is the dossier's `assets/reader.js`;
  - the Draft preview banner, on preview pages only;
  - the `main` region with the level 1 title heading;
  - the `navigation "Dossier"` list of links;
  - the container for the rendered body;
  - the `region "Linked from"` with its heading, list and links;
  - the search form with its search landmark, search input and button;
  - the `list "Search results"` with its links;
  - the footer line.

  Every element the browser creates to structure the document is part of the shell as well. Shell elements carry only these attributes: `class`, `id`, `lang`, `role`, `aria-` attributes, `href` on internal links and the stylesheet link, `src` on the script, `action` and `method="get"` on the search form, `name`, `type` and `value` on the search input, and `charset`, `name` and `content` on meta tags. No element anywhere on a page has an event attribute or an inline style attribute. No page has inline script. A link `href` must use `http`, `https` or `mailto`, or be an internal dossier path. External links carry `rel="noopener noreferrer nofollow"`.
- Raw HTML in a note appears as escaped visible text. A link with any other scheme renders as its label in plain text.
- Frontmatter is never rendered. Note ids never appear in pages, indexes or sitemaps.
- **Internal links.** A wikilink that resolves to an inside note renders as a link to that note's page, using the label if there is one and otherwise the inside note's title. The heading part is ignored.
- **Severed links.** Every other wikilink renders as plain text with no link element: its label if it has one, otherwise the text "[withheld]".
- **Page slugs.** Each inside note except the root gets a page slug. It is the lowercased title with every run of characters other than letters and digits turned into one hyphen, trimmed of hyphens. When slugs collide, the first note in order of hop and then title keeps the plain slug, and each later one gets the suffix "-<k>", where `<k>` is the smallest whole number from 2 upward that makes its slug unique. The root page is the dossier's index.
- **Each page shows:**
  - the title;
  - the rendered body;
  - a Linked from panel listing only inside notes that link to it;
  - the dossier's note navigation, listing only inside notes.
- **Search index and link previews.** The search index holds, for each inside note, its page path, title and plain text. Link previews hold, for each inside note, its title and the first 160 characters of its plain text.
- **Sitemap and search.** The sitemap lists the absolute URL of every published page. Search matches its text against titles and plain text, ignoring case, and lists matching pages by title.

**Dossier lifecycle**

| From | Action | To |
|---|---|---|
| — | create | `draft` |
| `draft` or `in_review` | create a preview link | `in_review` (any active link becomes `replaced`) |
| `in_review` | revoke the active link | `draft` |
| `in_review` | the active link expires | `draft`, as reported from that moment |
| `draft`, `in_review` or `published` | publish | `published` (any active link becomes `revoked`) |
| `published` | unpublish | `unpublished` |
| `published` | sweep takedown | `lapsed` |
| `unpublished` or `lapsed` | reopen | `draft` |

Every other action answers `409 invalid_transition` with the current state. Only one publish per dossier runs at a time, and a second one answers `409 publish_in_progress`.

**Publishing**

1. A publish renders every object under a new publish id and writes all of them.
2. Only then does it switch the dossier's live pointer to that publish id.
3. Then it deletes the previous publish id's objects.

If any write fails, the pointer is not switched, the earlier dossier keeps serving unchanged, and the answer is the storage 503. Public routes read only through the live pointer, on every request, so a republish with a smaller boundary immediately leaves the removed pages answering 404.

**Unpublish and takedown**

1. Clear the live pointer, so readers get 404 at once. This step needs only PostgreSQL.
2. Delete every object under the dossier's publish prefix, then list the prefix to confirm that it is empty.
3. Only when no object remains, set the state and answer success. An unpublish or takedown never reports success while any object of the dossier remains in storage.

This gives one outcome whenever storage is unreachable during an unpublish or takedown, whether it was down from the start or fails part-way through step 2. The answer is the storage 503, the live pointer stays cleared so every public address of the dossier answers 404, and the state stays `published`. Repeating the unpublish, or the next sweep for a takedown, resumes from step 2. Unlike a refused publish, a refused unpublish or takedown never leaves the dossier serving.

**Preview links**

- A token is 32 random bytes in URL-safe base64. Only its hash is stored.
- A link is `active` while the current time is before `expires_at`, which is its creation time plus `CAIRN_PREVIEW_TTL_SECONDS` (default 259200, which is 72 hours). From `expires_at` onward it is `expired`.
- A dossier has at most one active link.
- A preview link renders the draft at creation time, under the same boundary and allowlist rules, and serves only that draft's pages and files. It never reaches another dossier, the live dossier or any `/api` route.
- Revoking a link deletes its objects.

**Invites**

- An invite link is valid while the current time is before its creation time plus `CAIRN_INVITE_TTL_SECONDS` (default 604800). It works once.
- It is accepted only by a signed-in account whose email matches the invite, ignoring case. That account becomes a partner. Only the owner can invite.

### Services (DP-02, DP-06, DP-11, DP-12, DP-14, DP-15, DP-32, DP-36, DP-38)

**PostgreSQL** holds accounts, sessions, devices and cursors, vault membership, wrapped key envelopes, the revision log (number, note id, base, ciphertext hash, byte length, device, stored repeat-request responses), dossiers, publish manifests (inside note ids, page slugs and object keys), preview link hashes, the entitlement cache, the email outbox and sweep records. It never holds note titles, aliases, frontmatter or bodies of synced notes, nor any title or alias of a note outside a publish boundary. The schema is applied idempotently every time the server starts.

**MinIO.** Everything lives in the one bucket named by `S3_BUCKET`, under three key prefixes:

- `vault-blobs/<vault_id>/<note_id>/<rev>.bin`: exactly the ciphertext bytes of a revision.
- `publish/<slug>/<publish_id>/`: `index.html`, `pages/<page_slug>.html`, `search-index.json`, `previews.json`, `sitemap.xml`, `assets/reader.css` and `assets/reader.js`.
- `preview/<link_id>/`: `index.html`, `pages/<page_slug>.html`, `previews.json` and the same two assets.

Published and preview content is the investigator's deliberate public plaintext. It is the only note content Cairn ever stores in plaintext. Account, device, vault, billing and email-delivery records in PostgreSQL are ordinary plaintext metadata, and they never include note content.

While MinIO is unreachable:

- every action that writes or reads objects answers `503 storage_unavailable`;
- public pages answer 503;
- health stays 200;
- the next request after MinIO returns works with no restart.

**Kill Bill**

- **Catalog.** On start, and again in the sweep until it succeeds, the server uploads a catalog if the tenant has none. It has two BASE products, `CairnSync` and `CairnPublish`, each with one monthly plan in USD on the DEFAULT price list with no trial: `cairn-sync-monthly` at 6.00 USD per month and `cairn-publish-monthly` at 9.00 USD per month.
- **Accounts.** Each Cairn account that subscribes gets one Kill Bill account with external key equal to the Cairn account id, the display name as its name, the account email, currency USD, and the Cairn time zone as its time zone.
- **Adding an add-on** creates one subscription to that plan, in its own bundle, with external key `<account_id>-sync` or `<account_id>-publish`.
- **Cancelling** cancels that subscription with end-of-term entitlement and billing policies. Cancellations made directly in Kill Bill are honoured the same way.
- **Outage.** While Kill Bill is unreachable, add and cancel answer `503 billing_unavailable` and nothing changes. Entitlement follows the cache rule in Business rules, and health stays 200.

**Mailpit (via SMTP).** Emails are sent from "Cairn <no-reply@cairn.example>". They are plain text plus HTML, and they never contain a note title, alias, frontmatter, body text or vault name. Links are absolute, built from `APP_PUBLIC_URL`. If SMTP is unreachable, emails wait in the outbox and the sweep retries them.

| Email | To | Subject | Contents |
|---|---|---|---|
| Device approval | the account email | "Approve a new Cairn device" | the device name, the sign-in time in the account's time zone, the link `<APP_PUBLIC_URL>/devices/approve/<token>` and its expiry |
| Invite | the invited email | "<inviter> invited you to a shared Cairn vault" | the link `<APP_PUBLIC_URL>/invites/<token>`, its expiry, and a line saying the inviter will share the vault passphrase separately |
| Publish warning | the account email | "Cairn Publish: your dossiers go offline on <when>" (the takedown time) | the takedown time and the public address of each published dossier |

### Seed data (DP-01, DP-21, DP-22, DP-36, DP-39)

Every seeded person and business is invented. On start, the server creates any of these accounts that are missing. Each has no devices, vaults or dossiers.

| Email | Password | Display name | Time zone | Operator | Add-ons |
|---|---|---|---|---|---|
| ops@tidewrack.example | cairn-ops-7731-dev | Tidewrack Ops | Europe/Lisbon | yes | none |
| ines.marlow@casefile.example | field-notes-4418 | Ines Marlow | Europe/Lisbon | no | Sync and Publish active |
| tomasz.reyes@casefile.example | co-edit-2290 | Tomasz Reyes | America/Bogota | no | none |
| hana.okoye@ledgerdesk.example | other-case-6603 | Hana Okoye | Asia/Singapore | no | Sync active |

The server creates the Kill Bill accounts and subscriptions for the seeded add-ons on start. If Kill Bill is down at start, the sweep creates them when it returns.

**Sample case.** Load sample case adds these notes to the local notebook, with fresh ids. In the table, "private" means pinned as private, and `\n` means a line break.

| # | Title | Aliases | Frontmatter | Private | Body |
|---|---|---|---|---|---|
| N0 | Port Ellery fuel contracts | — | case: PE-2026-03 | no | `# What we found\n\nThe 2025 fuel tender is laid out in [[Tender timeline 2025]]. The winning bidder was [[Saltmarsh Logistics]], confirmed by the [[Tender award letter]]. Pricing was checked with [[Harbour pilot, Vigo\|a harbour pilot]].` |
| N1 | Tender timeline 2025 | — | — | no | `- 3 March: tender opens, run by [[Mara Quint]].\n- 28 March: board approves, see [[Board minutes, March]].` |
| N2 | Saltmarsh Logistics | Saltmarsh | — | no | `Registered in Port Ellery. Fuel is supplied through [[Ellery Bunkering SA]]. Tender contact: [[Mara Quint]].` |
| N3 | Tender award letter | — | — | no | `Approval recorded in [[Board minutes, March]]; summary in [[Port Ellery fuel contracts]].\n\nPasted from the scraped portal:\n\n<script>alert('x')</script>\n\n<img src="x" onerror="alert('x')">\n\n[portal copy](javascript:alert('x')) and [registry](https://registry.example/filing/2291)` |
| N4 | Mara Quint | M. Quint | role: procurement officer | no | `Ran the tender. Reports to [[D. Hallam]]. Bid sheet came from [[Procurement clerk]].` |
| N5 | Board minutes, March | — | — | no | `The board approved the award. [[M. Quint]] presented.` |
| N6 | Ellery Bunkering SA | — | — | no | `Filing history in [[Registry filing 2024]].` |
| N7 | D. Hallam | — | — | no | `Director. Also sits on [[Northgate Holdings]].` |
| N8 | Registry filing 2024 | — | — | no | `Lists [[Northgate Holdings]] as majority owner.` |
| N9 | Northgate Holdings | — | — | no | `Parent company. Unconfirmed: [[Offshore account lead]].` |
| N10 | Offshore account lead | Cayman lead | status: unverified tip-off | no | `Tip received by phone. Do not publish.` |
| P1 | Harbour pilot, Vigo | Pilot V. | contact: signal only | yes | `Met twice at the marina. Confirms [[Ellery Bunkering SA]] delivery volumes.` |
| P2 | Procurement clerk | Clerk K. | — | yes | `Handed over the bid sheet. Links to [[Northgate Holdings]].` |
| N11 | Call log scratch | — | — | no | `Unanswered calls to the registry office.` |

For example, with the seed data at start and N0 as the root, the boundary rules give these results:

| Hop | Notes public | Links severed |
|---|---|---|
| 0 | 1 | 4 |
| 1 | 4 | 6 |
| 2 | 7 | 4 |
| 3 | 9 | 4 |
| 4 | 10 | 3 |

At every hop, the titles and aliases of P1, P2 and N10 (and their frontmatter) are outside the boundary.

## Technical requirements

### Deployment (DP-11, DP-45)

- Node.js 22 LTS with npm is available. Server and browser code are written in TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The serve command binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}`.
- On every start, the server applies its schema, the Kill Bill catalog and the seed accounts idempotently. Graders may run extra instances on other ports that share the database, with one provider pointed at an unreachable address.

### Configuration and secrets (DP-43)

The server reads these at start:

- **PostgreSQL:** `DATABASE_URL`.
- **MinIO:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- **Kill Bill:** `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`.
- **Mail:** `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (the From address, "Cairn <no-reply@cairn.example>").
- **Server:** `APP_PUBLIC_PORT`; `APP_PUBLIC_URL` (default `http://localhost:<port>`).
- **Timers:** `CAIRN_DEVICE_APPROVAL_TTL_SECONDS`, `CAIRN_INVITE_TTL_SECONDS`, `CAIRN_PREVIEW_TTL_SECONDS`, `CAIRN_IDEMPOTENCY_TTL_SECONDS`, `CAIRN_SYNC_GRACE_SECONDS`, `CAIRN_PUBLISH_RETENTION_SECONDS`, `CAIRN_PUBLISH_WARNING_LEAD_SECONDS`, `CAIRN_SWEEP_INTERVAL_SECONDS`.

No credential or service URL is hard-coded, logged, or sent to the browser in any form.

### Server boundary (DP-11, DP-12, DP-45)

- **Same origin only.** There are no CORS headers. A POST, PUT, PATCH or DELETE whose `Origin` header doesn't match the server's own origin answers `403 cross_origin`.
- **Content type.** `/api` requests with a body must use `application/json`, or they answer `415 unsupported_media_type`.
- **Body size limits.** Each limit allows a body of exactly that size, and one byte more answers `413 payload_too_large`.

  | Requests | Limit |
  |---|---|
  | `/api` requests in general | 1,000,000 bytes |
  | Revision pushes | 4,000,000 bytes |
  | Manifest preview, publish and preview link requests | 5,000,000 bytes |

- **What is served.** The server serves only the built browser assets, the API, and the public and preview routes. Source files, `run.json`, package manifests, lockfiles, environment files and dotfiles answer 404.
- **Unreachable providers.** If PostgreSQL is unreachable at start, the server retries every 2 seconds and answers health only once connected. If MinIO, Kill Bill or SMTP is unreachable at start or at any later time, the server starts and stays up, and follows the outage behaviour in Services. It reconnects on the next request after the provider returns.

### Browser support and performance (DP-05, DP-40)

- Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800.
- The notebook is usable within three seconds of the first load. After the first load, it opens and edits with the network off, including after a reload.
- Each Exposure Ring hop change shows its full crossing within one second, including with the sample case's twelve notes on the rings.
- Public dossier pages are readable within two seconds and work with scripts disabled. Only link previews need the dossier's own script.

## Working rules

- IF-01: `/app/run.json` exists and holds exactly the string keys `install`, `build` and `serve` plus `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package, meaning the production dependency tree from `npm ls --omit=dev --all --json`, plus every bundled font, each with its version and licence.
- IF-03: Every shipped package and font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Unlicense, BlueOak-1.0.0 or SIL OFL 1.1.
- IF-04: The server uses no datastore other than PostgreSQL, MinIO, Kill Bill and Mailpit. There is no SQLite, Redis, or file-based database or queue on the server.
- IF-05: The provided service configuration files and environment defaults are left unchanged.
- IF-06: All server and browser source code is TypeScript.
- IF-07: Fonts and icons are bundled with the app, using Lucide icons and self-hosted Fraunces and IBM Plex. At runtime, the app makes no request to any third-party host.

## Engineering standards

- The code is idiomatic TypeScript with strict type checking. Domain values are typed as unions or interfaces, not `any`.
- Names match this brief's terms: vault, revision, base revision, head, cursor, envelope, dossier, boundary, hop, severed link, preview link, period end, grace deadline, takedown, sweep.
- Each domain rule is decided in exactly one place in the source, and the browser and server share it where both need it. This covers the boundary and severed count, the rendering allowlist, dossier transitions, add-on state and deadline math, and the repeated-request handling.
- There is no abstraction with only one implementation, and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the code cannot reach.
- Every API error uses the one error shape defined in API.
- No feature, endpoint, screen or setting exists beyond this brief.
