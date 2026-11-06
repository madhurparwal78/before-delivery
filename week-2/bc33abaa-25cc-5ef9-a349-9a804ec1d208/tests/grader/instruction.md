# Orrery Labs Orrery Studio

Orrery Studio is a browser workspace where brand and product-marketing teams build interactive 3D scenes for launch pages, review them, and publish them. A scene is a product that turns on hover, a camera that glides in on scroll, or a colourway that changes on click. Owners, admins, billing managers, editors, viewers and outside AI agents all work in one governed workspace. Every change is an attributed operation that can be undone. Every published embed traces back to an exact saved version. Build it as one TypeScript web application backed by five services. PostgreSQL holds workspaces, members, scenes, the operation log and the ledgers. PocketBase carries live presence, object locks and comment threads. MinIO stores files. Kill Bill handles billing. Mailpit receives every email. Out of scope: single sign-on, self-hosted payment card vaults, a desktop app, AI features inside the product, a marketplace, and any datastore beyond these five services. Each person belongs to exactly one workspace.

## Problem and users

Interactive WebGL now leads launch pages, but the scenes are still made the old way. A motion designer authors them in a desktop tool. Reviewers send screenshots with notes like "make the lid shinier in the hover state". Agencies hand over zip files that nobody versions. The browser editors teams have tried fail in four places. Nobody controls who may publish. Two people editing one object silently overwrite each other. Outside agents, such as catalogue bots that pose every product variant or QA bots that check framing, are handed a person's password. And a live embed cannot be traced back to the edits behind it. Companies pay for this in agency retainers, re-shot launch pages, and the occasional leak of an unreleased product through an unprotected preview link.

| Role | Goal | How often |
|---|---|---|
| Owner | Set up the workspace, choose the plan, keep unreleased products out of public view | Occasionally |
| Admin | Invite and offboard members, issue and revoke agent tokens, read the audit trail | Weekly |
| Billing manager | Start a paid plan after the trial, change plan or seats with predictable proration, resolve failed payments before the grace period ends | Occasionally |
| Editor | Build scenes with states and transitions alongside teammates and agents without losing work, then schedule a versioned publish | Daily |
| Viewer | Review a scene's states, leave comments pinned to objects, approve before launch | Weekly |
| Agent token | Read the scene graph, apply batched operations and set named camera views under the same permissions, locks and undo as a person | Daily |
| Site visitor | Understand the product from the public site and compare plans before starting a trial | Occasionally |

## Journeys

1. **From visitor to trial.** A site visitor lands on the home page, reads the numbered sections and opens Pricing. They switch the billing period between monthly and annual, then press "Start free trial". They fill in the trial form and land on the dashboard of their new workspace. The dashboard shows the trial end time and how many seats are used.
2. **Setting up the team.** An admin of the seeded Kestrel Audio workspace opens Members, invites a new editor, and sees the seats-used count go up. The invitee opens the emailed link, chooses a password and joins. The admin then issues an edit-scope agent token, copies the secret it shows once, and opens the audit trail. The trail shows the invitation, the join and the token issue, each with who did it.
3. **Building with teammates and an agent.** An editor opens the scene "Arc One headphones". They select "Left cup" in the hierarchy and nudge its X position from the keyboard. They add a clearcoat material layer. The changes appear in the viewport and as new ticks on the timeline. A second editor opens the same scene and sees the first editor's presence and lock. When the second editor tries to change the locked cup, a takeover prompt appears. Meanwhile the agent applies a batch that sets a camera view, and its tick appears as a square. Each author undoes only their own work.
4. **Rewind and restore.** An editor drags the timeline playhead back across the agent's operations. The viewport shows the scene as it was, changed objects flash an outline, the inspector numbers count to their old values, and later ticks fade. The editor releases on a past tick and chooses "Restore as new operation". New operations are appended, and the scene now matches that earlier point while the history stays intact.
5. **Review and approval.** An editor saves a version and submits it for review. A viewer opens the scene, switches between its states, pins a comment to "Headband" and mentions a teammate picked from the list. Then the viewer approves the version. The editor sends a review link to an agency contact outside the workspace. That person opens it without signing in and sees only that version. The editor later revokes the link, and it stops working.
6. **Scheduled launch.** An editor schedules the approved version for a time in the workspace's time zone and gets a confirmation email. At that instant, by the server's clock, the version goes live. The editor opens the public embed, sees the product turn and react to hover and click, and downloads an export bundle. The publish-notice email names the version and links to the embed.
7. **Paying for the workspace.** A billing manager opens Billing during the trial. They choose a plan, a billing period and extra seats, enter a card and press "Start paid plan". They see the active plan, the paid invoice and the receipt in the inbox. Later they preview an upgrade, see the prorated amount the billing gateway calculated, confirm it, and add a seat.
8. **A failed payment.** The payment gateway reports that a payment failed. The workspace becomes past due, a notice reaches the billing contacts, and a banner shows the grace-period deadline. A billing manager pays the reopened invoice before the deadline. The banner disappears, publishing stays available and the receipt arrives.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Public site and plan comparison** Show a public home page with numbered sections and a pricing page that compares the Team and Business plans for monthly and annual billing at the prices in Business rules.
- **DP-02 — Start a trial** A site visitor starts a trial from the public site, which creates a workspace, makes them its owner, signs them in and lands them on a dashboard that shows when the trial ends.
- **DP-03 — Sign-in and sessions** Members sign in with email and password into a session cookie, agents authenticate with bearer tokens, and every non-public API route gives the unauthenticated answer from API without a valid credential.
- **DP-04 — Server-decided trial end** A trial ends at the instant the server computes from the workspace's creation, as qualified in Business rules, and the workspace is then read-only until a paid plan starts.
- **DP-05 — Invite and join** An admin or billing manager invites a person by email, the invitation reaches the inbox, and the invitee joins with the chosen role and appears in the members list.
- **DP-06 — Role permissions enforced by the server** Every action in the permission table in Business rules is refused by the server with the forbidden answer for any caller the table does not allow, whatever the interface shows.
- **DP-07 — Seat accounting and the last seat** Seats used counts members and open invitations and never exceeds seats purchased, and of several simultaneous invitations for the last seat exactly one succeeds.
- **DP-08 — Offboarding a member** Removing a member ends their sessions at once, frees their seat and releases their object locks.
- **DP-09 — Audit trail** Every audited action writes exactly one attributed entry, and owners and admins can read the entries newest first.
- **DP-10 — Workspace dashboard totals** The dashboard shows seats used, seats purchased, scene counts and subscription state, computed only from the caller's own workspace.
- **DP-11 — Agent token lifecycle** Admins issue agent tokens with a name, scope and expiry, see the secret once and revoke tokens; the server stops accepting a token at its expiry instant and emails a warning ahead of it, as qualified in Business rules.
- **DP-12 — Agent scope limits** An agent token can do only what its scope allows in the permission table, and an edit-scope token can never publish, change billing or seats, refund or issue tokens, however the request is shaped.
- **DP-13 — Agent batch session** An edit-scope agent reads a scene graph, applies a batch of operations and sets a named camera view, and an editor with the scene open sees the result credited to the agent within the realtime delay.
- **DP-14 — Scene library and search** Members list, create and search scenes and assets, and search returns only results from the searcher's own workspace.
- **DP-15 — Scene graph operations** Every scene change is an operation from the operation table in API, validated, applied all-or-nothing per batch, and stored with its inverse.
- **DP-16 — States, transitions and camera views** Editors and agents define named states with per-object overrides, hover, click and scroll transitions between states, and named camera views, and the editor previews each state.
- **DP-17 — Build a scene in the editor** An editor opens a scene in the three-column editor, selects objects in the hierarchy, changes transforms and material layers in the inspector, and sees each change in the viewport and on the timeline.
- **DP-18 — Keyboard-complete editing** Every core editing job works from the keyboard alone, using the keys listed in Interactions.
- **DP-19 — One holder per object lock** Each object has at most one lock holder, exactly one of several simultaneous claims wins, and a change from a non-holder is rejected with the lock conflict answer and never merged.
- **DP-20 — Live presence and lock indicators** Every open editor shows who is in the scene, what each person or agent has selected, and which objects are locked and by whom, within the realtime delay.
- **DP-21 — Pending transforms that roll back** An inspector change shows at once and is marked pending, and when the server rejects it the value visibly returns to the server's value with an announced reason.
- **DP-22 — Two editors and a takeover** When an editor tries to change an object the editor already shows as held by another author, a takeover prompt appears; confirming it moves the lock to them, applies the change and tells the previous holder.
- **DP-23 — Attributed operation log** The operation log lists every operation in order with its author (person or agent), its server time and its inverse, and never shows author emails.
- **DP-24 — Per-author undo and redo** Undo and redo act only on the caller's own batches, by appending stored inverse operations, and work the same for people and agent tokens.
- **DP-25 — Graph replay and hash** The server replays operations 0 to N into a scene graph and its hash, and the viewport exposes the hash of the graph it renders, which matches the server's.
- **DP-26 — Op-log rewind timeline** Dragging or stepping the timeline playhead re-renders the scene as of that operation, outlines changed objects, counts inspector values, fades later ticks and announces the operation, in the order and timing given in Motion and effects.
- **DP-27 — Rewind with reduced motion** When reduced motion is requested, the playhead jumps, values switch instantly and a plain-text list of changes replaces the highlight animation.
- **DP-28 — Rewind and restore** An editor rewinds to a past operation and restores it as new operations; the scene's current hash then equals the hash at that past operation and earlier history is unchanged.
- **DP-29 — Upload a model and texture** An editor uploads a binary glTF model and a texture, sees both in the asset list, and adds the model to the scene as a mesh.
- **DP-30 — Upload content and size checks** Uploads are judged by their actual bytes against the type and size rules in Business rules, and a rejected file never reaches the object store.
- **DP-31 — File storage outage** While the object store is unreachable, including at start, uploads, versions and exports give the storage outage answer, editing keeps working and a notice names file storage.
- **DP-32 — Comments pinned to objects** Members post comment threads pinned to an object, see the pin in the viewport and resolve threads, and comments reach every open editor within the realtime delay.
- **DP-33 — Mention picker** Typing @ in a comment offers only active members of the scene's own workspace.
- **DP-34 — Foreign IDs answer not found** An ID belonging to another workspace, anywhere in a path or a request body, gets the same not-found answer as an ID that never existed.
- **DP-35 — Review and approve a version** An editor saves a version and submits it for review, and a viewer reviews its states, comments on objects and approves it.
- **DP-36 — Draft review links** Editors create unguessable, read-only review links for one unpublished version, and a link stops working when revoked, regenerated, expired, turned off by the owner or once the version is published, as qualified in Business rules.
- **DP-37 — Outside reviewer journey** A person outside the workspace opens a review link without signing in, orbits the scene and switches its states, and sees no comments, operation log or author details.
- **DP-38 — Version lifecycle** Scene versions move only along the legal transitions in Business rules, and any other move is rejected with the transition conflict answer.
- **DP-39 — Scheduled publish on the server clock** An approved, scheduled version goes live by the server's clock, never early and within the delay set in Business rules, and the confirmation and publish-notice emails are sent.
- **DP-40 — Published embed** The public embed page renders the scene's published version in 3D, runs its hover, click and scroll transitions, turns slowly when idle, and falls back to a still image when WebGL is unavailable.
- **DP-41 — Published copies carry only published data** The embed, the export bundle and the publish-notice email contain only the published version's geometry, materials, states and asset files, never comments, later states, author details or the operation log.
- **DP-42 — Schedule a launch** An editor schedules an approved version in the workspace time zone, sees it go live, opens the embed and downloads the export bundle.
- **DP-43 — Checkout from trial** A billing manager picks a plan, a period and extra seats, pays by card, and sees the active plan, the paid invoice and the receipt.
- **DP-44 — Idempotent billing requests** Billing requests carry an idempotency key; a replay returns the original answer and a reused key with a different body is refused, so each key produces at most one charge, one invoice and one receipt.
- **DP-45 — Plan changes with gateway proration** Upgrades take effect immediately and charge the prorated amount from the gateway's invoice, downgrades take effect at the end of the term, and a preview shows the gateway's amount beforehand.
- **DP-46 — Seat purchases** Billing managers add seats immediately with a prorated charge and remove seats at the end of the term, never below seats used.
- **DP-47 — Billing outage** While the billing gateway is unreachable, including at start, billing actions give the billing outage answer and nothing is charged, while editing and publishing keep working.
- **DP-48 — All-or-nothing invoice payment** Paying an invoice records the gateway payment, stores the invoice document and emails the receipt all together or not at all.
- **DP-49 — Gateway webhook ledger** Signed payment events from the gateway are processed once per event ID, and a replayed event changes nothing.
- **DP-50 — Refunds** Owners and billing managers refund all or part of a payment; the refund is recorded in the gateway and confirmed by email.
- **DP-51 — Pay an invoice** A billing manager opens the invoices table, pays an unpaid invoice, downloads its document and finds the receipt in the inbox.
- **DP-52 — Dunning notices and grace period** A failed payment makes the subscription past due, sends notices at each grace-period step, and suspends publishing when the grace period ends, all by the server's clock.
- **DP-53 — Suspended and cancelled workspaces** A suspended or cancelled workspace is read-only for scene work while billing, sign-in and offboarding keep working, and cancellation is final.
- **DP-54 — Recover from a failed payment** A billing manager sees the past-due notice and pays the overdue invoice, and the workspace returns to active with publishing restored.
- **DP-55 — Run manifest and health** The app installs, builds and serves from its run manifest on the stated port and answers the health check.
- **DP-56 — Server boundary** The server accepts state changes only from its own origin, enforces body limits, never serves source or credentials, and starts while dependencies are down and connects to each once it first becomes reachable, as qualified in Server boundary.
- **DP-57 — Real wiring from the environment** Service URLs and credentials come only from the environment, every provider effect is a real call to that provider, and the viewport, review page and embed draw the actual scene graph with WebGL.
- **DP-58 — Responsive layout** Every screen works without horizontal scrolling at 375 by 812, 768 by 1024 and 1280 by 800, using the arrangements in Screens and layout.
- **DP-59 — Interface motion and feedback** Hover, press, focus, panel and dialog feedback follow the timings and reduced-motion rules in Motion and effects, with no unnamed decorative loops.
- **DP-60 — Visual identity** The product looks like a drafting table: a warm paper ground, ink text, cobalt actions, vermilion alerts, a faint ruled grid, the stated typefaces and tabular figures.

## Frontend

### Screens and layout (DP-01, DP-02, DP-10, DP-14, DP-17, DP-58)

Every screen fits each of the three test viewports (375×812, 768×1024 and 1280×800) with no horizontal scrolling. Long names wrap or truncate with an ellipsis and show the full name as a tooltip.

**Public site.**
- **Home (`/`).** A ruled page with five numbered sections. A number rail in the left margin reads 01 to 05. The sections are: what Orrery Studio is; how the operation-log rewind works; agents under the same rules as people; plans; start a trial. At 1280 the rail sits in its own narrow margin column and the content uses a 12-column ruled grid. At 768 the rail shrinks to small numerals above each section heading. At 375 the sections stack, with the numeral inline before each heading.
- **Pricing (`/pricing`).** A plan comparison table with a billing-period switch above it. At 375 the table becomes one card per plan, stacked.
- **Start trial (`/signup`), sign-in (`/login`) and invitation (`/invite/<token>`).** Each is a single centred form column, full width at 375.

**Signed-in app.** A top bar shows the workspace name and the signed-in person. Beside it is the workspace navigation, showing only the links the person's role may use (see the permission table in Business rules). At 375 the navigation collapses behind a menu button. The app screens are:
- **Dashboard (`/app`).** Seats, subscription, scene counts and active agent tokens, as a ruled grid of figure tiles (four across at 1280, two at 768, one at 375).
- **Scenes (`/app/scenes`).** A search box, a "New scene" button and the scene list.
- **Editor (`/app/scenes/<sceneId>`).** The editor is a drafting table.
  - At 1280 it is a three-column grid: Hierarchy on the left (about a fifth of the width), Viewport in the middle, Inspector on the right (about a fifth). The operation-log timeline runs across the full width below all three. A thin header holds the scene name, the presence list, Undo, Redo and a "Versions" toggle. "Versions" opens a side sheet with the Versions, Review links, Comments and Assets panels.
  - At 768 the viewport spans the full width on top. Hierarchy and Inspector sit side by side below it, and the timeline is at the bottom.
  - At 375 the viewport is on top, the timeline directly under it, and below that a tab strip switches between Hierarchy, Inspector, Comments and Versions.
- **Members (`/app/members`), Agents (`/app/agents`) and Audit (`/app/audit`).** Tables. At 375 each table row becomes a stacked card.
- **Billing (`/app/billing`).** The current plan, the change-plan form, the proration preview, seats, the card form and the invoices table. Two columns at 1280; one column at 768 and at 375.
- **Settings (`/app/settings`).** Workspace time zone and the review-link switch.

**Public scene pages.**
- **Review page (`/review/<token>`).** A read-only viewport with a state switcher and a header reading the scene name, the version number and "Review copy · read only".
- **Embed (`/embed/<embedId>`).** The published scene fills the frame. There is no other chrome apart from the state switcher, which is shown only when the scene has more than one state.

### Public screens and controls (DP-01–DP-60)

Only the controls and regions below are public. Tests and judges reach them by ARIA role and accessible name, plus the few `data-` attributes listed. Everything else is free. The `<placeholders>` are defined in Business rules or Feedback states.

| Screen | Role and accessible name | Visible copy and notes |
|---|---|---|
| All public pages | `navigation "Main"` with links "Product", "Pricing", "Sign in", "Start free trial" | |
| Home | `heading` level 1 "3D scenes your whole team can trace" | Each section `region` is named by its heading and preceded by its rail numeral "01" to "05" |
| Pricing | `radiogroup "Billing period"` with `radio "Monthly"`, `radio "Annual"` | Monthly is selected at load |
| Pricing | `table "Compare plans"` | Columns "Team" and "Business". Rows "Price", "Included seats", "Extra seat", "Agent tokens", "Scheduled publishing", "Review links". Prices follow the selected period, with "/ month" or "/ year" |
| Pricing | `link "Start free trial"` | Goes to `/signup` |
| Start trial | `form "Start your trial"`: `textbox "Workspace name"`, `textbox "Your name"`, `textbox "Work email"`, `textbox "Password"`, `combobox "Time zone"`, `button "Start 14-day trial"` | |
| Sign in | `form "Sign in"`: `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Invitation | `form "Join workspace"`: `textbox "Your name"`, `textbox "Password"`, `button "Join <workspace name>"` | |
| App shell | `navigation "Workspace"` with links "Dashboard", "Scenes", "Members", "Agents", "Audit", "Billing", "Settings" (each shown only to roles allowed to use it), `button "Sign out"` | |
| App shell | `status "Service status"` | The banner from Feedback states |
| Dashboard | `region "Seats"` | "<seats used> of <seats purchased> seats used" |
| Dashboard | `region "Subscription"` | One of: "Trial ends <local time>", "Active: <plan name> <period name>", "Past due: grace period ends <local time>", "Suspended", "Cancelled" |
| Dashboard | `region "Scenes"`, `region "Agent tokens"` | "<n> scenes, <m> published", "<k> active agent tokens" |
| Scenes | `searchbox "Search scenes"`, `list "Scenes"` (one `link` per scene named by its name), `list "Search results"` | |
| Scenes | `button "New scene"` opens `dialog "New scene"` with `textbox "Scene name"` and `button "Create scene"` | |
| Editor | `tree "Scene hierarchy"` | One `treeitem` per node, named by node name. A locked node's treeitem has accessible description "Locked by <holder name>" |
| Editor | `region "Viewport"` | Attributes `data-op-seq` (the operation index shown), `data-graph-hash` (hash of the graph rendered), `data-highlighted` (comma-separated IDs of the nodes currently outlined, empty otherwise) |
| Editor | `list "People in this scene"` | One item per author present: "<name>" for a person, "<name> (agent)" for an agent, followed by "· <selected node name>" when they have a selection |
| Editor | `region "Inspector"` | `spinbutton "Position X"`, `"Position Y"`, `"Position Z"`, `"Rotation X"`, `"Rotation Y"`, `"Rotation Z"`, `"Scale X"`, `"Scale Y"`, `"Scale Z"`. While a value awaits the server, its field carries `data-pending="true"` and a visible "Pending" tag |
| Editor | `list "Material layers"`, `button "Add material layer"` opens `menu "Layer type"` with `menuitem` "Base", "Clearcoat", "Sheen", "Emission" | Each layer item shows its type and its colour, roughness and metalness fields as `spinbutton "<type> roughness"` and similar |
| Editor | `listbox "States"` (first option "Rest"), `button "Add state"` opens `dialog "Add state"` with `textbox "State name"` and `button "Add"`, `listbox "Camera views"` | Choosing a state previews it in the viewport |
| Editor | `button "Undo"`, `button "Redo"` | |
| Editor | `slider "Operation log"` | Minimum 0, maximum the latest operation number, value is the operation shown. Each tick element carries `data-op-seq` and `data-author-kind` ("member" or "agent") |
| Editor | `status "Rewind announcement"` | Copy in Feedback states |
| Editor | `button "Restore as new operation"`, `button "Return to latest"` | Shown only while the playhead is before the latest operation |
| Editor | `list "Changes"` | Shown only with reduced motion. Copy in Feedback states |
| Editor | `dialog "Object locked"` with `button "Take over"`, `button "Cancel"` | "<holder name> is editing <node name>." |
| Editor | `status "Editor status"` | Editing feedback |
| Comments panel | `region "Comments"`, `textbox "Comment"`, `button "Post comment"`, `listbox "Mention a teammate"`, per thread `button "Resolve"` | Each viewport pin is a `button "Comment on <node name>"` |
| Versions panel | `button "Save version"` opens `dialog "Save version"` with `textbox "Version label"` and `button "Save"`. Per version: `button "Submit for review"`, `button "Approve"`, `button "Schedule publish"`, `button "Unschedule"`, `button "Withdraw"`, `button "Create export"`, `link "Download export"` | Each version row shows "v<number> · <label> · <state>" with the states written "Draft", "In review", "Scheduled", "Published", "Withdrawn" |
| Versions panel | `dialog "Schedule publish"` with `textbox "Publish date"` (YYYY-MM-DD), `textbox "Publish time"` (HH:mm:ss), the text "Time zone: <IANA zone>", `button "Schedule"` | |
| Review links panel | `button "Create review link"` opens `dialog "Create review link"` with `textbox "Expires"` (`YYYY-MM-DD HH:mm:ss` in the workspace time zone; an entry in any other format shows the field error "Use YYYY-MM-DD HH:mm:ss." and sends nothing) and `button "Create link"`. Per link: `button "Copy link"`, `button "Regenerate link"`, `button "Revoke link"` | |
| Assets panel | `button "Upload model"`, `button "Upload texture"`, `list "Assets"`, per asset `button "Add <asset name> to scene"`, `status "Upload status"` | |
| Members | `table "Members"`, `button "Invite member"` opens `dialog "Invite member"` with `textbox "Email"`, `combobox "Role"`, `button "Send invite"`. Per row `button "Remove <name>"` opens `alertdialog "Remove member"` with `button "Remove"` and `button "Cancel"`. `status "Members status"` | |
| Agents | `table "Agent tokens"`, `button "Issue token"` opens `dialog "Issue agent token"` with `textbox "Token name"`, `radiogroup "Scope"` (`radio "Read"`, `radio "Edit"`), `textbox "Expires"` (same format and field error as the review-link "Expires" field), `button "Issue token"`. `region "New token"` shows the secret once with "Copy this token now. It will not be shown again." Per row `button "Revoke <token name>"` | |
| Audit | `table "Audit trail"` | Columns "Time", "Actor", "Action", "Target" |
| Billing | `region "Plan"`, `radiogroup "Plan"` (`radio "Team"`, `radio "Business"`), `radiogroup "Billing period"`, `spinbutton "Extra seats"`, `textbox "Card number"`, `textbox "Expiry (MM/YY)"`, `textbox "CVC"`, `button "Start paid plan"`, `button "Preview change"`, `region "Proration preview"`, `button "Change plan"`, `button "Update seats"`, `button "Cancel subscription"` opening `alertdialog "Cancel subscription"` with `button "Cancel subscription"` and `button "Keep subscription"` | |
| Billing | `table "Invoices"` | Columns "Invoice", "Date", "Amount", "Balance", "Status". Per row `button "Pay invoice <invoice number>"` (unpaid only), `link "Download invoice <invoice number>"` (document stored), `button "Refund invoice <invoice number>"` (paid only). `status "Billing status"` |
| Settings | `combobox "Workspace time zone"`, `switch "Allow review links"`, `button "Save settings"` | |
| Review page | `region "Viewport"`, `listbox "States"` | |
| Embed | `region "3D scene"` | Attributes `data-state` (ID of the state shown) and `data-yaw` (current turn in degrees, 0 up to but not including 360). `img "<scene name>"` is the no-WebGL fallback |

### Interactions (DP-16, DP-17, DP-18, DP-20, DP-21, DP-22, DP-26, DP-28, DP-29, DP-32, DP-33, DP-37, DP-40)

**General.**
- Tab order follows reading order: top bar, navigation, then the screen from left to right and top to bottom. In the editor that is the header, Hierarchy, Viewport, Inspector, then the timeline.
- Every dialog keeps focus inside itself while open. Escape closes it. Focus then returns to the control that opened it.
- Enter activates a focused button. Space toggles a focused switch or radio.

**Hierarchy.**
- Up and Down move between treeitems. Right expands a group or moves into it. Left collapses it or moves to its parent.
- Home and End jump to the first and last treeitem. Typing letters jumps to the next treeitem whose name starts with them.
- Enter or a click selects the node. Selecting asks for that node's lock and releases the lock on the previously selected node.

**Inspector.**
- Each transform field accepts typed numbers. Enter commits the typed value; Escape restores the last committed value.
- Up and Down nudge the focused axis and commit at once:
  - Position: 0.1 per press, 1 with Shift.
  - Rotation: 1 degree per press, 15 with Shift.
  - Scale: 0.01 per press, 0.1 with Shift.
- Dragging horizontally on a field's label scrubs the value (one unit of the plain nudge step per 4 pixels of drag) and commits on release.
- Every commit shows the new value at once, marks the field pending, and clears the mark when the server accepts the change. If the server rejects it, the field returns to the server's value, its edge turns vermilion for about two seconds, and `status "Editor status"` announces the rejection copy from Feedback states.
- If the hierarchy already shows the node as locked by another author when you commit, the editor sends nothing and opens `dialog "Object locked"` instead. Initial focus is on "Cancel". Enter on "Take over" takes the lock and then sends the committed value. Escape or "Cancel" closes the dialog, puts back the server's value, and returns focus to the field.
- If the node was shown as free but the server answers with the `locked` conflict, because another author claimed it before the editor learned of it, no dialog opens. The field rolls back as above and announces the lock-conflict copy from Feedback states. The node then shows as locked, so the next commit on it opens the dialog.

**Materials.** Enter on "Add material layer" opens the "Layer type" menu. Up and Down move between its items, and Enter adds the chosen layer. Focus then moves to the new layer's first field. Escape closes the menu and returns focus to the button.

**States.**
- Choosing a state in "States" previews it in the viewport with that state's overrides applied. "Rest" shows the base graph.
- "Add state" opens `dialog "Add state"`. Typing a name in "State name" and pressing "Add" (or Enter) appends a state with that name and a generated ID, selects it and closes the dialog.
- Changing a transform while a state other than Rest is selected writes a state override, not a base change.

**Viewport.**
- Dragging orbits the camera around the scene centre. The mouse wheel or a pinch zooms. A two-finger drag pans.
- Clicking an object selects it, the same as selecting it in the hierarchy.
- With focus in the viewport, the arrow keys orbit 5 degrees per press.

**Timeline.**
- Dragging the playhead maps its horizontal position across the timeline's width to operation numbers 0 up to the latest.
- With the slider focused, Left and Right step one operation and Shift with Left or Right steps ten. Home goes to operation 0 and End goes to the latest.
- Releasing the pointer, or any key step, counts as the playhead settling.
- While the playhead is before the latest operation, the inspector is read-only and shows "Viewing operation <N>. Return to latest to edit."
- "Restore as new operation" restores the scene to the shown operation (the restore endpoint). "Return to latest" jumps to the latest operation.
- New operations from others add ticks while the playhead stays where it is.

**Undo and redo.** Ctrl+Z (Cmd+Z on macOS) undoes and Ctrl+Shift+Z (Cmd+Shift+Z) redoes, whenever focus is not in a text field. The Undo and Redo buttons do the same.

**Comments.** Typing "@" in "Comment" opens "Mention a teammate", filtered by the letters typed after it. Up and Down move through the list, Enter inserts the mention, and Escape closes the list. Clicking a pin, or pressing Enter on it, opens that thread and selects its node.

**Uploads.** "Upload model" and "Upload texture" open the file picker. Each chosen file uploads at once. "Add <asset name> to scene" adds a mesh node using that asset under the selected node, or under the root when nothing is selected.

**Review page and embed.**
- Dragging orbits the camera, also under reduced motion. Choosing a state in "States" moves to it.
- On the embed, pointer hover over the scene runs the scene's hover transition and leaving runs it back. A click or tap runs the click transition. Scrolling the embed page runs the scroll transition in step with scroll progress, and scrolling back reverses it, as set out in Motion and effects.

### Visual design (DP-60)

**Colour.**
- The page ground is a warm off-white like drafting paper.
- Text and hairlines are a near-black ink with a faint olive cast.
- A saturated cobalt blue marks every action, the selection, the focus ring and the rewind outline.
- A vermilion red-orange marks alerts, rejections, overdue billing and destructive buttons.
- A putty grey draws rules, panel borders and the background grid.
- Text and controls meet WCAG 2.2 AA contrast. Vermilion appears on small text only in a darkened shade that meets AA, or as a bar or icon beside ink text.

**Drafting-table feel.**
- A faint square hairline grid, one square every 8 pixels, shows behind every panel and the public pages, so the layout reads as drafted.
- Panels are flat, edged with one putty rule and no drop shadows.
- Pressed controls sink by one pixel and show a shallow inner shadow, like a physical key.

**Type.**
- Display headings use Space Grotesk, a squared geometric grotesque.
- Body text and labels use IBM Plex Sans.
- Every numeric field, price, seat count, time and operation number uses IBM Plex Mono with equal-width figures, so columns of numbers line up.
- Each heading level is one quarter larger than the level below it, starting from body text.

**Density and composition.**
- The density is compact: rows are tight and labels short. Still, every interactive control is at least 44 by 44 pixels to tap.
- The editor reads as a drafting table: hierarchy, viewport and inspector as three ruled columns, with the timeline as a full-width ruler beneath them.
- The public site uses the same ruled grid, with numbered section rails in the left margin.
- Timeline ticks are small cobalt marks: a circle for a person and a square for an agent token.

### Motion and effects (DP-26, DP-27, DP-40, DP-59)

**General feel.** Every motion starts quickly and settles gently with no bounce or overshoot. Nothing moves without a meaning. The only repeating motions are:
- the embed's idle turn, and
- the busy bar on a pending button: a thin cobalt bar that sweeps once per second while the request is out.

There are no other loops, parallax effects or ambient animation.

**Feedback timings.**
- **Hover.** Buttons, rows and treeitems gain a cobalt tint within about a sixth of a second (160 ms).
- **Press.** The one-pixel sink appears at once when pressed and lifts when released.
- **Focus.** A two-pixel cobalt ring appears instantly.
- **Panels, sheets and dialogs.** They enter by fading in and sliding about 8 pixels into place over about a quarter of a second (240 ms). They leave in about a sixth of a second (160 ms).
- **Pending values.** The "Pending" tag appears instantly. A rejected value returns to the server's value over about a sixth of a second.

**Editor viewport.**
- The viewport has no idle motion.
- Dragging orbits, also under reduced motion.
- A state preview chosen in "States" moves the objects over the transition's authored duration, or over about a quarter of a second when no transition links the two states.

**Signature: op-log rewind.** Each time the playhead reaches tick N, four things begin in this order, all within the same quarter second:
1. The viewport re-renders the scene graph as it was after operation N, before the next screen refresh. `data-op-seq` becomes N and `data-graph-hash` becomes the hash of that graph.
2. Every object that differs between the previous playhead position and N gets a cobalt outline. `data-highlighted` lists those objects for about 0.42 seconds (420 ms), then clears.
3. The inspector's numbers for the selected object count from their old values to their op-N values over about a quarter of a second (240 ms).
4. Ticks after N fade to 35 percent strength over about a sixth of a second (160 ms), and ticks at or before N return to full strength. When the playhead settles, `status "Rewind announcement"` announces operation N.

Moving the playhead backwards or forwards repeats these steps for each tick crossed, so dragging back undoes the view step by step. Settling on a tick before the latest shows "Restore as new operation".

**Reduced motion.** When the system asks for reduced motion:
- the playhead jumps without tweening;
- outlines, numbers and tick fades switch instantly;
- `list "Changes"` replaces the highlight animation, listing each changed property between the previous and new positions;
- the announcement and the restore action stay the same;
- panels and dialogs appear and disappear without sliding;
- the busy bar is replaced by the static word "Working…";
- embed hover and click transitions jump to their end state, the scroll transition still follows the scroll position, and the embed's idle turn stops.

**Embed 3D.**
- The embed draws the published graph with WebGL.
- When no pointer has been over the scene for 3 seconds, the whole scene turns about the vertical axis once every 25 to 35 seconds, and `data-yaw` advances accordingly. Any pointer over the scene stops the turn.
- Dragging orbits the camera, also under reduced motion.
- Hover and click transitions run over their authored durations, and `data-state` changes to the target state when a transition starts.
- **Scroll.** This applies when the published graph has a scroll transition from Rest.
  - The embed page is two frame heights tall and the 3D scene stays pinned in view while the page scrolls.
  - Scroll progress is the page's vertical scroll position divided by (page height minus frame height). It runs from 0 at the top to 1 at the bottom.
  - The scene is shown blended from the Rest values at 0 to the target state's values at 1, in proportion to progress, whatever the transition's duration.
  - `data-state` is `rest` while progress is below 0.5, and the target state's ID from 0.5 up.
  - Scroll transitions from other states do not run on the embed. Without a scroll transition from Rest, the page does not scroll.
- Without WebGL, the embed shows the version's stored thumbnail as `img "<scene name>"` with the fallback copy from Feedback states.

**Editor and review viewport without WebGL.** The viewport shows the latest stored thumbnail of the scene, if there is one, and the fallback copy from Feedback states. The hierarchy, inspector and timeline keep working.

### Feedback states (DP-21, DP-22, DP-26, DP-27, DP-28, DP-31, DP-36, DP-40, DP-43, DP-45, DP-46, DP-47, DP-50, DP-52, DP-53)

Every async action shows a pending state on the control that started it: the busy bar (or "Working…" under reduced motion), with the control disabled. The pending, success and error copy below is announced through the named live region. Field errors show under their field, are tied to it as its error message, and repeat the API's message. Placeholders follow Business rules: `<local time>`, `<local date>`, `$<amount>`, `<plan name>`, `<period name>`.

**Service status.** The banner in `status "Service status"` shows on every app screen while its condition holds. It updates on page load and within 5 seconds of the condition changing.

| Condition | Copy |
|---|---|
| File storage unreachable (any 503 with service `file_storage`) | "File storage is unavailable. Your edits are saved; uploads, versions and publishing will resume when it is back." |
| Billing gateway unreachable (any 503 with service `billing`) | "Billing is unavailable right now. Nothing was charged. Editing and publishing keep working." |
| Subscription past due | "Payment failed. Pay invoice <invoice number> by <local time> to keep publishing." |
| Suspended after the grace period | "This workspace is read-only until the overdue invoice is paid." |
| Suspended after the trial | "Your trial has ended. Start a paid plan to keep editing." |
| Cancelled | "This subscription is cancelled. The workspace is read-only." |

**Editor and timeline.**

| Action | Region | Pending | Success | Error |
|---|---|---|---|---|
| Inspector commit | `status "Editor status"` | Field marked "Pending" | Mark clears silently | Lock conflict on a node shown as free: "Change to <node name> rolled back: <holder name> is editing it." Out of range: "<field label> must be between <min> and <max>." |
| Take over | `status "Editor status"` | Busy "Take over" button | "You now hold <node name>." | — |
| Lock taken over from you | `status "Editor status"` | — | "<name> took over <node name>." | — |
| Undo / Redo | `status "Editor status"` | Busy button | "Undone." / "Redone." | "Nothing to undo." / "Nothing to redo." / "Cannot undo: <holder name> is editing <node name>." / "Cannot undo: a later change removed <node name>." / "Cannot undo: a later change removed or uses state <state name>." |
| Restore | `status "Editor status"` | Busy button | "Restored to operation <N>." | "Cannot restore: <holder name> is editing <node name>." |
| Settle playhead | `status "Rewind announcement"` | — | "Operation <N> of <latest>: <op type> on <node name> by <author name> (<person or agent>) at <time>". For operations without a node: "Operation <N> of <latest>: <op type> by <author name> (<person or agent>) at <time>". At 0: "Start of log". Placeholders are defined below the table | — |
| Reduced-motion change list | `list "Changes"` | — | One item per change: "<node name> <property>: <old value> → <new value> by <author name>" | — |
| No WebGL in editor or review viewport | `region "Viewport"` | — | "3D preview needs WebGL. The hierarchy, inspector and operation log still work." | — |

**Rewind copy placeholders.**
- `<op type>` is the operation's `type` exactly as written in the API operation table, for example `transform.set`.
- `<node name>` in the announcement is the name of the node the operation names through `id` or `nodeId`. For `node.add` it is the new node. The name is as it reads just after operation N, or just before it for `node.remove`. Operations of type `state.add`, `state.remove`, `transition.set` and `camera.view.set` use the form without a node.
- `<author name>` is the member's name or the agent token's name. `<person or agent>` is the literal word "person" or "agent".
- `<latest>` is the latest operation number. `<time>` is the operation's server time as HH:mm:ss in the workspace time zone.
- For example, with the seed data at start: "Operation 4 of 9: transform.set on Left cup by Catalogue poser (agent) at 10:15:02". The time depends on when the seed ran.
- In `list "Changes"`, one item is listed for each property that differs between the previous and the new playhead positions. Names and IDs below are ordered by Unicode code point. Items appear in this order:
  - **Node items first**, grouped by node ID. Within one node:
    1. the single `node` item, when the node is absent on one side (and then nothing else for that node);
    2. `name`, `parent`, `position`, `rotation`, `scale`, `visible`, in that order;
    3. layer items, by layer number `<n>`, and within one layer the fields `type`, `color`, `roughness`, `metalness`, in that order;
    4. state overrides, by state name, and within one state the fields `position`, `rotation`, `scale`, `visible`, in that order.
  - **Scene-level items last**: first states by state name, then transitions by from-state name and then trigger in the order hover, click, scroll, then camera views by view name.
- `<property>` is one of the following:
  - `name`, `parent`, `position`, `rotation`, `scale` or `visible`;
  - `layer <n> <field>`, where `<n>` is the layer's 1-based place in the node's list at the new playhead position, or at the previous position when the layer is absent at the new one, and `<field>` is `type`, `color`, `roughness` or `metalness`. A layer present on one side only gets all four field items, with `none` on the absent side;
  - `<field> in <state name>` for a state override.
- A node absent on one side gets the single item `<node name> node: none → present` (or the reverse) and no other items.
- Scene-level changes use the node name "Scene graph" with the property `state <state name>`, `transition <from state name> <trigger>` or `camera view <view name>`.
- `<old value>` and `<new value>` are the values at the previous and new positions, written as follows:
  - numbers in shortest decimal form with at most 4 decimals, and an ASCII hyphen for minus;
  - vectors as `[x, y, z]`;
  - booleans as `true` or `false`;
  - `parent` as the parent's name;
  - transitions as `<n> ms`;
  - states and camera views as `present`;
  - `none` for anything absent.
- `<author name>` in a change item is the author of the latest operation between the two positions that changed that property.
- For example, with the seed data:
  - moving the playhead from 3 to 4 lists "Left cup position: [0, 0, 0] → [-0.6, 0, 0] by Catalogue poser";
  - moving from 5 to 6 lists, in order, "Headband layer 1 type: none → base by Sol Navarro", "Headband layer 1 color: none → [0.12, 0.12, 0.11] by Sol Navarro", "Headband layer 1 roughness: none → 0.6 by Sol Navarro", "Headband layer 1 metalness: none → 0.1 by Sol Navarro";
  - moving from 6 to 9 lists, in order, "Left cup rotation in Hover: none → [0, 15, 0] by Sol Navarro", "Scene graph state Hover: none → present by Sol Navarro", "Scene graph transition Rest hover: none → 420 ms by Sol Navarro".

**Assets, comments, versions and review links.**

| Action | Region | Pending | Success | Error |
|---|---|---|---|---|
| Upload | `status "Upload status"` | "Uploading <file name>…" | "<file name> uploaded." | Too large: "<file name> is too large. The limit is <limit> bytes." Wrong content: "<file name> is not a binary glTF model or a PNG or JPEG texture." Bad name: "<file name> has a name that is not allowed." Oversized texture: "Textures can be at most 4096 by 4096 pixels." |
| Post comment | `status "Editor status"` | Busy button | "Comment posted." | Field error under "Comment" |
| Save version | `status "Editor status"` | Busy button | "Version <number> saved." | Field error under "Version label" |
| Submit / Approve | `status "Editor status"` | Busy button | "Submitted for review." / "Approved." | "Only in-review versions can be approved." |
| Schedule | `status "Editor status"` | Busy button | "Version <number> goes live <local time>." | Too soon or too far: "Pick a time between 5 seconds and 365 days from now." Needs approval: "This version needs an approval from someone other than its author." Another scheduled: "Another version of this scene is already scheduled." Read-only: the Service status copy |
| Unschedule / Withdraw | `status "Editor status"` | Busy button | "Back in review." / "Withdrawn. The embed no longer shows this version." | — |
| Go-live waiting for storage | Version row | "Waiting for file storage" | Row switches to "Published" within the realtime delay | — |
| Create export | `status "Editor status"` | Busy button | "Export ready." | "Only published versions can be exported." |
| Create / regenerate / revoke review link | `status "Editor status"` | Busy button | "Review link created. It expires <local time>." / "New link created. The old link no longer works." / "Link revoked." | Turned off: "Review links are turned off for this workspace." Wrong version state: "Review links are only for versions that are not yet published." |

**Members and agent tokens.**

| Action | Region | Pending | Success | Error |
|---|---|---|---|---|
| Invite | `status "Members status"` | Busy button | "Invitation created for <email>. The email is on its way." | No seat: "No seats left. Add seats in Billing or remove a member." Duplicate: "<email> is already a member or invited." |
| Remove member | `status "Members status"` | Busy button | "<name> was removed. Their seat is free." | "The owner cannot be removed." |
| Issue / revoke token | `status "Members status"` (on the Agents screen) | Busy button | "Token <token name> issued." / "Token <token name> revoked." | Field errors |

**Billing.**

| Action | Region | Pending | Success | Error |
|---|---|---|---|---|
| Start paid plan / pay invoice | `status "Billing status"` | Busy button, "Processing payment…" | "Payment recorded for invoice <invoice number>. A receipt is on its way." | Declined: "Your card was declined. Nothing was charged." Too many seats used: "You have <seats used> people and invitations, more than the <seats> seats this choice includes." Already paid: "This invoice is already paid." |
| Preview change | `region "Proration preview"` | "Calculating…" | Immediate: "Due today: $<amount>". End of term: "No charge today. Your plan changes on <local date>." | — |
| Change plan | `status "Billing status"` | Busy button | Immediate: "Plan changed to <plan name> <period name>. Charged $<amount>." End of term: "Your plan changes to <plan name> <period name> on <local date>." | "You are already on this plan." |
| Update seats | `status "Billing status"` | Busy button | Increase: "Seats updated to <seats purchased>. Charged $<amount>." Decrease: "Seats drop to <seats> on <local date>." | Below seats used: the too-many-seats copy above |
| Refund | `status "Billing status"` | Busy button | "Refunded $<amount> for invoice <invoice number>." | "That is more than the refundable balance." |
| Cancel subscription | `status "Billing status"` | Busy button | "Subscription cancelled. The workspace is now read-only." | — |
| Any billing action while the gateway is unreachable | `status "Billing status"` | — | — | The billing Service status copy |

**Sign-in and trial forms.** Pending copy is "Signing in…" or "Creating your workspace…", in a `status "Form status"` region. A wrong password shows "Email or password is incorrect." A taken email, on the trial form or the Join form, shows "That email already has a workspace. Sign in instead." On success the browser goes to the dashboard.

**Public page states.**

| Page | Condition | Copy |
|---|---|---|
| Review | Expired link | "This review link has expired. Ask the editor for a new one." |
| Review | Revoked, replaced, turned off, published or unknown link | "This review link is not valid." |
| Embed | Withdrawn, cancelled or unknown | "This scene is no longer available." |
| Embed | No WebGL | "Interactive 3D needs WebGL." |
| Invitation | Expired, revoked or unknown | "This invitation is no longer valid." |

## Backend

### API (DP-03, DP-05, DP-08, DP-09, DP-11, DP-13, DP-14, DP-15, DP-19, DP-23, DP-24, DP-25, DP-29, DP-32, DP-33, DP-34, DP-36, DP-38, DP-40, DP-43, DP-45, DP-46, DP-48, DP-49, DP-50, DP-55)

**Conventions.**
- Requests and responses are JSON (`application/json; charset=utf-8`). The exceptions are uploads (`multipart/form-data`), thumbnails (`image/png`), file downloads and the event stream. Body limits are in Server boundary.
- Times are ISO 8601 in UTC with a trailing `Z`, to the second.
- Money is in integer cents.
- IDs are opaque strings.

**Credentials.**
- Members authenticate with the `orrery_session` cookie (HttpOnly, SameSite=Lax, Path=/).
- Agents authenticate with `Authorization: Bearer <token>`. When that header is present, the cookie is ignored.
- Routes marked *public* need no credential.

**Error shapes.** Every error uses one of these shapes:

| Status | Body |
|---|---|
| 401 | `{"error":"unauthenticated"}` |
| 403 | `{"error":"forbidden"}` |
| 403 | `{"error":"cross_origin"}` |
| 404 | `{"error":"not_found"}` |
| 402 | `{"error":"workspace_read_only"}` |
| 402 | `{"error":"card_declined"}` |
| 409 | `{"error":"<code>", ...extra fields}` |
| 413 | `{"error":"payload_too_large","limitBytes":<n>}` |
| 413 | `{"error":"file_too_large","limitBytes":<n>}` |
| 415 | `{"error":"unsupported_type"}` |
| 422 | `{"errors":{"<field path>":"<message>"}}` |
| 503 | `{"error":"service_unavailable","service":"billing"\|"file_storage"}` |

**Error precedence.** One order holds for the whole API. The first failing check wins:
1. Body too large (413 `payload_too_large`).
2. Cross-origin state change (403 `cross_origin`).
3. Unauthenticated (401).
4. Unknown or other-workspace resource, anywhere in the path or body (404).
5. Forbidden by role or scope (403).
6. Idempotent replay: returns the stored response, before any of the checks below.
7. Read-only workspace (402 `workspace_read_only`).
8. State conflicts (409).
9. Validation (422 and 415, and 413 `file_too_large`), with uploads checked in the order set out under Uploads in Business rules.
10. Provider outcomes (402 `card_declined`, 503).

Endpoint rows list only their own extra errors.

**Shared objects.**
- `Author`: `{"kind":"member"|"agent"|"system","id":"…","name":"…"}`. The scheduler appears as `{"kind":"system","id":"system","name":"Orrery scheduler"}`.
- `Member`: `{"id","name","email","role":"owner"|"admin"|"billing_manager"|"editor"|"viewer","joinedAt"}`.
- `Op`: `{"seq","batchId","type","payload","inverse","author":Author,"createdAt","undoOf":null|batchId,"redoOf":null|batchId,"restoreTo":null|seq}`.
- `Lock`: `{"nodeId","holder":Author,"expiresAt"}`.
- `Version`: `{"id","sceneId","number","label","state":"draft"|"in_review"|"scheduled"|"published"|"withdrawn","seq","createdBy":Author,"approvals":[{"member":Author,"at"}],"publishAt":null|time,"publishedAt":null|time,"embedId":null|id}`.
- `Subscription`: `{"state":"trial"|"active"|"past_due"|"suspended"|"cancelled","plan":"team"|"business","period":"monthly"|"annual","seatsPurchased","extraSeats","trialEndsAt":null|time,"graceEndsAt":null|time,"pendingChange":null|{"plan","period","extraSeats","effectiveAt"}}`.
- `Invoice`: `{"id","number","date","amountCents","balanceCents","status":"paid"|"unpaid","pdfAvailable":bool}`. `id` and `number` are Kill Bill's invoice ID and invoice number.
- `Payment`: `{"id","invoiceId","amountCents","refundedCents","createdAt"}`. `id` is Kill Bill's payment ID.
- `BatchResult`: `{"batchId","firstSeq","lastSeq","latestSeq","hash"}`.

**Audit.** A row marked "audit `x`" writes exactly one audit entry with action `x` when it succeeds.

#### Health, sign-up and sessions

- `GET /api/health` *public* → `200 {"status":"ok"}`.
- `POST /api/signup` *public*.
  - Body: `{"workspaceName","name","email","password","timeZone"}`.
    - `workspaceName`: 1–80 characters.
    - `name`: 1–80 characters.
    - `password`: at least 10 characters.
    - `timeZone`: an IANA zone name.
  - → `201 {"workspace":{"id","name","timeZone"},"member":Member,"subscription":Subscription}` and sets the session cookie.
  - Extra error: `409 {"error":"email_taken"}`.
  - Audit `workspace.created`.
- `POST /api/auth/login` *public* `{"email","password"}` → `200 {"member":Member,"workspace":{"id","name","timeZone"}}` and sets the cookie. Wrong email or password → `401 {"error":"invalid_credentials"}`.
- `POST /api/auth/logout` → `204`. The session ends.
- `GET /api/me` → `200 {"member":Member,"workspace":{…},"subscription":Subscription}`. For an agent token: `200 {"agent":{"id","name","scope"},"workspace":{…}}`.
- `GET /api/workspace` → `200 {"id","name","timeZone","reviewLinksEnabled"}`.
- `PATCH /api/workspace` `{"name"?, "timeZone"?, "reviewLinksEnabled"?}` → `200` with the same shape. Audit `workspace.updated`.
- `GET /api/dashboard` → `200 {"seatsUsed","seatsPurchased","scenes","publishedScenes","scheduledVersions","activeAgentTokens","subscription":Subscription}`.

#### Members, invitations and audit

- `GET /api/members` → `200 {"members":[Member],"invites":[{"id","email","role","expiresAt","invitedBy":Author}]}`.
- `POST /api/members/invites` `{"email","role"}`, where role is anything except `owner`.
  - → `201 {"id","email","role","expiresAt"}`.
  - Extra errors: `409 {"error":"no_seats_left","seatsUsed":<n>,"seatsPurchased":<n>}` and `409 {"error":"already_member"}`.
  - Audit `member.invited`.
- `DELETE /api/members/invites/:inviteId` → `204`. Audit `invite.revoked`.
- `GET /api/invites/:token` *public* → `200 {"workspace":{"name"},"email","role"}`. An expired or revoked invitation answers 404.
- `POST /api/invites/:token/accept` *public* `{"name","password"}` → `201 {"member":Member,"workspace":{…}}` and sets the cookie. Extra error: `409 {"error":"email_taken"}`, as set out under Invitations in Business rules. Audit `member.joined`.
- `DELETE /api/members/:memberId` → `204`. Extra error: `409 {"error":"owner_cannot_be_removed"}`. Audit `member.removed`.
- `GET /api/audit?limit=<1–500, default 100>` → `200 {"entries":[{"id","at","actor":Author,"action","target":{"type","id"}}]}`, newest first.

#### Agent tokens

- `GET /api/agent-tokens` → `200 {"tokens":[{"id","name","scope":"read"|"edit","expiresAt","status":"active"|"expired"|"revoked","issuedBy":Author}]}`. The secret is never included.
- `POST /api/agent-tokens` `{"name" (1–60 characters),"scope","expiresAt"}`.
  - → `201 {"id","name","scope","expiresAt","status":"active","issuedBy":Author,"token":"orr_<at least 40 random letters and digits>"}`.
  - The secret appears only in this response.
  - Audit `token.issued`.
- `DELETE /api/agent-tokens/:tokenId` → `204`. A token that is already expired or revoked → `409 {"error":"invalid_transition","from":"<status>","to":"revoked"}`. Audit `token.revoked`.

#### Scenes, graph, operations and search

- `GET /api/scenes` → `200 {"scenes":[{"id","name","latestSeq","updatedAt","publishedVersion":null|number}]}`.
- `POST /api/scenes` `{"name" (1–80 characters)}` → `201 {"id","name","latestSeq":0}`. Audit `scene.created`.
- `GET /api/scenes/:sceneId` → `200 {"id","name","latestSeq","graph","hash"}`.
- `GET /api/scenes/:sceneId/graph?at=<N>` → `200 {"seq":N,"graph","hash"}`. `N` outside 0..latestSeq → `422 {"errors":{"at":"…"}}`.
- `GET /api/scenes/:sceneId/ops?after=<seq, default 0>&limit=<1–1000, default 500>` → `200 {"ops":[Op],"latestSeq"}`, in ascending `seq`.
- `POST /api/scenes/:sceneId/ops` `{"ops":[{"type","payload"}]}` (1–200 ops) → `201 BatchResult`.
  - Extra error: `409 {"error":"locked","nodeId","holder":Author}`.
  - Validation errors use paths such as `ops[2].payload.position`.
- `POST /api/scenes/:sceneId/undo` and `POST /api/scenes/:sceneId/redo` (empty body) → `201 BatchResult`.
  - Extra errors: `409 {"error":"nothing_to_undo"}`, `409 {"error":"nothing_to_redo"}`, `409 {"error":"undo_conflict","nodeId"}` and the `locked` conflict.
- `POST /api/scenes/:sceneId/restore` `{"toSeq"}` → `201 BatchResult` plus `"restoredTo"`.
  - Extra errors: the `locked` conflict, and `422 {"errors":{"toSeq":"…"}}` unless `0 ≤ toSeq < latestSeq`.
  - Audit `scene.restored`.
- `GET /api/search?q=<at least 2 characters>` → `200 {"scenes":[{"id","name"}],"assets":[{"id","name"}]}`. Matching is a case-insensitive substring match on names.

**Graph shape.** A graph is `{"nodes":[Node],"states":[State],"transitions":[Transition],"cameraViews":[CameraView]}`.

- `Node`: `{"id","name","kind":"group"|"mesh"|"camera"|"light","parentId":null|id,"primitive":null|"box"|"sphere"|"cylinder"|"plane","assetId":null|id,"position":[x,y,z],"rotation":[x,y,z],"scale":[x,y,z],"materialLayers":[Layer],"visible":true|false}`.
  - Rotation is in degrees.
  - Exactly one node has `parentId` null: the root.
- `Layer`: `{"id","type":"base"|"clearcoat"|"sheen"|"emission","color":[r,g,b],"roughness","metalness"}`. Each value is between 0 and 1.
- `State`: `{"id","name","overrides":[{"nodeId","field":"position"|"rotation"|"scale"|"visible","value"}]}`. The base state `{"id":"rest","name":"Rest","overrides":[]}` is always present.
- `Transition`: `{"from":stateId,"to":stateId,"trigger":"hover"|"click"|"scroll","durationMs"}`.
- `CameraView`: `{"name","position":[x,y,z],"target":[x,y,z],"fov"}`.

**Hash.** The hash is the lowercase hex SHA-256 of the graph serialised canonically:
- object keys sorted;
- no whitespace;
- `nodes`, `states` and each state's `overrides` sorted by ID (overrides by `nodeId` then `field`);
- `transitions` sorted by `from` then `trigger`;
- `cameraViews` sorted by `name`;
- every number rounded to 4 decimal places and written as the shortest JSON number for that value.

**Operations.** Every operation's stored `inverse` is the operation that exactly undoes it, recorded at apply time. IDs match `^[a-z0-9_-]{1,40}$` and names are 1–80 characters.

| `type` | `payload` | Validation |
|---|---|---|
| `node.add` | `{"node":Node,"overrides"?:[{"stateId","field","value"}]}` (`materialLayers` may be omitted; `overrides` recreates state overrides for the new node) | ID unused in the scene, parent exists, `assetId` names a model asset in the same workspace, each override's state exists and is not `rest` |
| `node.remove` | `{"id"}` | Node exists, has no children and is not the root. Removing a node also removes every state override that names it. Its stored inverse is a `node.add` carrying the node as it was, material layers included, and those overrides |
| `node.rename` | `{"id","name"}` | Node exists |
| `node.reparent` | `{"id","parentId"}` | No cycles, not the root |
| `transform.set` | `{"id","position"?,"rotation"?,"scale"?}`, with at least one field | Position components −1000 to 1000, rotation −360 to 360, scale 0.001 to 1000, all inclusive |
| `material.layer.add` | `{"id","layer":Layer,"index"?}` | At most 8 layers per node |
| `material.layer.set` | `{"id","layerId","color"?,"roughness"?,"metalness"?}` | Layer exists |
| `material.layer.remove` | `{"id","layerId"}` | Layer exists |
| `state.add` | `{"state":{"id","name"}}` | ID unused, not `rest`. Its stored inverse is a `state.remove` of that ID |
| `state.remove` | `{"id"}` | State exists and is not `rest`, and no state override or transition names it. Its `id` names a state, not a node, so it takes no lock. Its stored inverse is a `state.add` with the same ID and name |
| `state.override.set` | `{"stateId","nodeId","field","value"}` (`value` null clears the override) | State exists and is not `rest`, node exists, value in the field's range |
| `transition.set` | `{"from","to","trigger","durationMs"}` (`durationMs` null clears the transition for `from` + `trigger`) | States exist and differ, `durationMs` 0 to 2000 inclusive |
| `camera.view.set` | `{"name","position","target","fov"}` (`position` null removes the view) | `fov` 10 to 120 inclusive |

Any other `type` → `422 {"errors":{"ops[<i>].type":"Unknown operation"}}`.

#### Realtime, presence and locks

- `GET /api/scenes/:sceneId/events` → `200 text/event-stream`. Events:
  - `op` with `{"batchId","ops":[Op]}`;
  - `lock` with `{"nodeId","holder":null|Author}`;
  - `presence` with `{"authors":[{"author":Author,"selection":null|nodeId}]}`;
  - `comment` with a comment;
  - `version` with a `Version`.
- `POST /api/scenes/:sceneId/presence` `{"selection":null|nodeId,"cursor":[x,y]}` (each value 0 to 1) → `204`.
- `GET /api/scenes/:sceneId/locks` → `200 {"locks":[Lock]}`.
- `POST /api/scenes/:sceneId/locks` `{"nodeId"}` → `200 {"lock":Lock}`. Extra error: the `locked` conflict.
- `DELETE /api/scenes/:sceneId/locks/:nodeId` → `204`. Extra error: `409 {"error":"not_lock_holder"}`.
- `POST /api/scenes/:sceneId/locks/:nodeId/takeover` → `200 {"lock":Lock,"previousHolder":null|Author}`.

#### Assets and thumbnails

- `POST /api/assets` (multipart, fields `kind` = `model`|`texture` and `file`) → `201 {"id","kind","name","bytes","contentType"}`.
  - Extra errors: 413 `file_too_large`, 415, and `422 {"errors":{"file":"File name is not allowed"}}` or `422 {"errors":{"file":"Texture is larger than 4096 by 4096 pixels"}}`.
  - Audit `asset.uploaded`.
- `GET /api/assets` → `200 {"assets":[{"id","kind","name","bytes","contentType","uploadedBy":Author}]}`.
- `GET /api/assets/:assetId/file` → `200` with the asset's bytes and its content type.
- `PUT /api/versions/:versionId/thumbnail` (`image/png` body) → `204`. A body that is not a PNG → 415.

#### Comments and mentions

- `GET /api/scenes/:sceneId/comments` → `200 {"comments":[{"id","nodeId","body","author":Author,"mentions":[{"id","name"}],"resolved","createdAt"}]}`.
- `POST /api/scenes/:sceneId/comments` `{"nodeId","body" (1–2000 characters),"mentions":[memberId]}` → `201` with the comment. Audit `comment.posted`.
- `PATCH /api/comments/:commentId` `{"resolved":true|false}` → `200` with the comment. Audit `comment.resolved` or `comment.reopened`.
- `GET /api/scenes/:sceneId/mentionable?q=<0 or more characters>` → `200 {"members":[{"id","name","role"}]}`. No emails, and at most 20 results.

#### Versions, publishing and exports

- `GET /api/scenes/:sceneId/versions` → `200 {"versions":[Version]}`.
- `POST /api/scenes/:sceneId/versions` `{"label" (1–60 characters)}` → `201 Version` in `draft`, snapshotting the graph at the current `latestSeq`. Audit `version.saved`.
- `POST /api/versions/:versionId/submit` → `200 Version`. Audit `version.submitted`.
- `POST /api/versions/:versionId/approve` → `200 Version`. Extra error: `409 {"error":"not_in_review"}`. Audit `version.approved`.
- `POST /api/versions/:versionId/schedule` `{"publishAt"}` → `200 Version`.
  - Extra errors: `409 {"error":"approval_required"}`, `409 {"error":"another_version_scheduled"}` and `422 {"errors":{"publishAt":"…"}}`.
  - Audit `version.scheduled`.
- `POST /api/versions/:versionId/unschedule` → `200 Version`. Audit `version.unscheduled`.
- `POST /api/versions/:versionId/withdraw` → `200 Version`. Audit `version.withdrawn`.
- Illegal moves on submit, schedule, unschedule and withdraw → `409 {"error":"invalid_transition","from":"<state>","to":"<state>"}`.
- `POST /api/versions/:versionId/exports` → `201 {"id","versionId","bytes"}`. Extra error: `409 {"error":"not_published"}`. Audit `export.created`.
- `GET /api/exports/:exportId` → `200 application/zip` containing:
  - `scene.json`: the published payload;
  - `assets/<assetId>.<glb|png|jpg>`: every asset the graph references;
  - `viewer.html`: a standalone viewer that loads `scene.json` from its own folder.
- `GET /api/embed/:embedId` *public* → `200` with the published payload: `{"scene":{"name"},"version":{"number","label","publishedAt"},"graph"}`. Withdrawn or cancelled → `410 {"error":"gone"}`.
- `GET /api/embed/:embedId/assets/:assetId` *public* → the asset's bytes, only for assets referenced by the published graph, otherwise 404.
- `GET /embed/:embedId` *public* → the embed page.

#### Review links

- `GET /api/versions/:versionId/review-links` → `200 {"links":[{"id","expiresAt","status":"active"|"expired"|"revoked","createdBy":Author}]}`.
- `POST /api/versions/:versionId/review-links` `{"expiresAt"}` → `201 {"id","token","url":"/review/<token>","expiresAt"}`.
  - Extra errors: `409 {"error":"review_links_disabled"}`, `409 {"error":"version_not_reviewable"}` and `422 {"errors":{"expiresAt":"…"}}`.
  - Audit `review_link.created`.
- `POST /api/review-links/:linkId/regenerate` → `200 {"id","token","url","expiresAt"}`. Audit `review_link.regenerated`.
- `DELETE /api/review-links/:linkId` → `204`. Audit `review_link.revoked`.
- `GET /api/review/:token` *public* → `200 {"scene":{"name"},"version":{"number","label","state"},"graph"}`. An expired link → `410 {"error":"link_expired"}`. Every other invalid link → 404.
- `GET /review/:token` *public* → the review page.
- Any method other than GET or HEAD on `/review/…` or `/api/review/…` → `405 {"error":"read_only"}`, whatever the token.

#### Billing

All billing `POST` routes except the webhook need an `Idempotency-Key` header, as set out in Business rules. A missing key → `422 {"errors":{"Idempotency-Key":"Required"}}`. A replayed response carries the header `Idempotent-Replayed: true`.

- `GET /api/billing` → `200 {"subscription":Subscription,"card":null|{"last4"}}`. This is served from the app's own records, so it works while the gateway is down.
- `POST /api/billing/checkout` `{"plan","period","extraSeats" (0–500),"card":{"number","expMonth","expYear","cvc"}}`.
  - → `201 {"subscription":Subscription,"invoice":Invoice,"payment":Payment}`.
  - Extra errors: `409 {"error":"invalid_transition","from","to":"active"}`, `409 {"error":"seats_in_use","seatsUsed","seatsAfter"}` and 402 `card_declined`.
  - Audit `subscription.started`.
- `GET /api/billing/plan/preview?plan=&period=` → `200 {"change":"immediate"|"end_of_term","amountCents","effectiveAt"}`. `amountCents` is 0 for end-of-term changes.
- `POST /api/billing/plan` `{"plan","period"}`.
  - Immediate change → `200 {"change":"immediate","subscription":Subscription,"invoice":Invoice,"payment":Payment}`.
  - End-of-term change → `200 {"change":"end_of_term","subscription":Subscription,"effectiveAt"}`.
  - Extra errors: `409 {"error":"subscription_not_active"}`, the `seats_in_use` conflict and `422 {"errors":{"plan":"Already on this plan"}}`.
  - Audit `subscription.plan_changed`.
- `POST /api/billing/seats` `{"extraSeats" (0–500)}`.
  - Increase → `200 {"change":"immediate","subscription":Subscription,"invoice":Invoice,"payment":Payment}`.
  - Decrease → `200 {"change":"end_of_term","subscription":Subscription,"effectiveAt"}`.
  - Extra errors: the `subscription_not_active` and `seats_in_use` conflicts, and `422 {"errors":{"extraSeats":"No change"}}`.
  - Audit `subscription.seats_changed`.
- `GET /api/billing/invoices` → `200 {"invoices":[Invoice],"payments":[Payment]}`, newest first.
- `GET /api/billing/invoices/:invoiceId/pdf` → `200 application/pdf`. 404 until the document is stored.
- `POST /api/billing/invoices/:invoiceId/pay` `{"card":{…}}` → `200 {"invoice":Invoice,"payment":Payment,"subscription":Subscription}`.
  - Extra errors: `409 {"error":"invoice_already_paid"}` and 402 `card_declined`.
  - Audit `invoice.paid`.
- `POST /api/billing/payments/:paymentId/refund` `{"amountCents"?}` (the full refundable balance when omitted) → `200 {"payment":Payment}`.
  - Extra error: `422 {"errors":{"amountCents":"More than the refundable balance"}}`.
  - Audit `payment.refunded`.
- `POST /api/billing/cancel` → `200 {"subscription":Subscription}`. Extra error: the `invalid_transition` conflict. Audit `subscription.cancelled`.
- `GET /api/billing/gateway` → `200 {"signingSecret"}`.
- `POST /api/billing/webhook` *public, signed*.
  - Header: `Orrery-Signature: sha256=<lowercase hex HMAC-SHA256 of the raw body with the workspace's signing secret>`.
  - Body: `{"id","type":"payment.succeeded","workspaceId","invoiceId","amountCents"}` or `{"id","type":"payment.failed","workspaceId","paymentId","reason"}`.
  - → `200 {"received":true,"duplicate":false|true}`.
  - Extra errors: `401 {"error":"invalid_signature"}` for a bad signature or unknown workspace, `409 {"error":"idempotency_key_reused"}`, `422` for an unknown `type` or, on an invoice with a balance above zero, for `amountCents` different from that balance, and 503.

### Business rules (DP-04, DP-06, DP-07, DP-08, DP-11, DP-12, DP-15, DP-19, DP-20, DP-24, DP-28, DP-30, DP-34, DP-36, DP-38, DP-39, DP-44, DP-45, DP-46, DP-49, DP-52, DP-53)

**Display placeholders.**
- `<local time>` is an instant in the workspace's time zone as `YYYY-MM-DD HH:mm:ss (<IANA zone>)`, for example `2026-11-03 09:00:00 (Europe/Berlin)`.
- `<local date>` is `YYYY-MM-DD` in the workspace's time zone.
- `$<amount>` is US dollars with thousands separators and two decimals, for example `$1,234.50`.
- `<plan name>` is "Team" or "Business", and `<period name>` is "monthly" or "annual".
- `<invoice number>` is Kill Bill's invoice number.
- `<seats used>` and `<seats purchased>` are the derived seat values below.

**Permissions.** A caller's permissions come only from its credential. A role, member ID, workspace ID or scope named in a body, query or header never grants anything. A denied action answers the 403 forbidden body.

| Action | Owner | Admin | Billing manager | Editor | Viewer | Agent (read) | Agent (edit) |
|---|---|---|---|---|---|---|---|
| Read scenes, graph, ops, locks, versions, comments, assets; search | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Dashboard, members list, mention picker | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Create scenes; upload assets and thumbnails | ✓ | — | — | ✓ | — | — | — |
| Apply ops, undo, redo, restore; locks, takeover, presence | ✓ | — | — | ✓ | — | — | ✓ |
| Post and resolve comments | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Save, submit, schedule, unschedule, withdraw versions; exports; review links | ✓ | — | — | ✓ | — | — | — |
| Approve a version (never its own creator) | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Invite and revoke invitations (billing managers cannot invite admins) | ✓ | ✓ | ✓ | — | — | — | — |
| Remove members; issue, list and revoke agent tokens; read the audit trail | ✓ | ✓ | — | — | — | — | — |
| Workspace settings; cancel subscription; read the gateway signing secret | ✓ | — | — | — | — | — | — |
| Billing: read, checkout, plan, seats, pay, refund | ✓ | — | ✓ | — | — | — | — |

Presence also comes from viewers and other members who only read a scene. Their heartbeat is accepted for presence only.

**Workspace isolation.** Every resource belongs to one workspace. The rule covers scenes, nodes, versions, comments, assets, exports, review links, invitations, members, agent tokens, invoices and payments. An ID from another workspace, whether in the path, in a body field (`assetId`, `mentions`, `nodeId`, `invoiceId`, `paymentId`) or in a webhook, is treated exactly like an ID that never existed: the same 404 body. Search, the mention picker, the dashboard totals, the audit trail, member lists and exports draw only on the caller's workspace.

**Plans and prices.** These prices are in US dollars.

| Plan | Period | Kill Bill plan | Price | Included seats | Extra seat | Kill Bill seat plan |
|---|---|---|---|---|---|---|
| Team | monthly | `team-monthly` | $96.00 per month | 8 | $12.00 per month | `seat-team-monthly` |
| Team | annual | `team-annual` | $960.00 per year | 8 | $120.00 per year | `seat-team-annual` |
| Business | monthly | `business-monthly` | $380.00 per month | 20 | $16.00 per month | `seat-business-monthly` |
| Business | annual | `business-annual` | $3,800.00 per year | 20 | $160.00 per year | `seat-business-annual` |

- The trial is the Team plan with 8 seats, at no charge and with no card.
- The pricing table shows, for both plans:
  - "Agent tokens": "Up to 5" for Team and "Up to 25" for Business, counting active tokens. Issuing beyond the limit → `409 {"error":"token_limit_reached"}`.
  - "Scheduled publishing": "Included".
  - "Review links": "Included".

**Seats.**
- *Seats purchased* is the plan's included seats plus the extra seats, or 8 during the trial.
- *Seats used* is active members plus open invitations (not revoked, not accepted, not expired). Agent tokens never use seats.
- An invitation is refused with `no_seats_left` when seats used already equals seats purchased.
- Of N simultaneous invitations for the last free seat, exactly one is created and the rest get `no_seats_left`. Seats used never exceeds seats purchased.
- Removing a member or revoking an invitation frees its seat at once.
- A plan or seat change that would leave seats purchased below seats used is refused with `seats_in_use`.
- Billing changes for one workspace apply one at a time, in arrival order.

**Invitations.**
- Emails compare case-insensitively.
- `already_member` answers only when the email belongs to an active member or an open invitation of the inviter's own workspace.
- An email that belongs to a member of another workspace is invited like any new address: 201, the invitation email is sent, and the invitation uses a seat. The answer reveals nothing about other workspaces.
- Accepting such an invitation answers `email_taken` and creates no member. The invitation stays open until it is revoked or expires.

**Offboarding.** Removing a member does all of the following at once:
- every session of theirs gets 401 on its next request;
- their object locks and presence are cleared, and open editors see this within the realtime delay;
- their seat is freed.

Their past operations, comments and audit entries keep their name. Agent tokens they issued stay valid, because tokens belong to the workspace.

**Agent tokens.**
- A token is `active` from issue until it expires or is revoked. `expired` and `revoked` are final.
- Only a hash of the secret is stored.
- `expiresAt` must be at least 10 seconds and at most 365 days after the server's current time; otherwise 422.
- A revoked or expired token gets 401 on every request.
- An edit-scope token can never publish, schedule, manage versions or review links, change billing or seats, refund, invite or issue tokens. Every such route answers 403 for it, and no op type exists that does these things.

**Operations and batches.**
- Each batch is applied whole or not at all and gets consecutive `seq` numbers. `seq` starts at 1 per scene, and 0 means the scene's initial graph.
- Every operation is credited to the credential that sent it: a member, or an agent by its token name.
- `createdAt` is the server's time. Client-sent times are ignored.
- Each stored operation carries its inverse.
- The operation log is append-only. Nothing rewrites or deletes an operation.

**Object locks.**
- *Lockable operations* are every operation in the table that names an existing node through `id` or `nodeId`. `node.add` locks the new node for its author.
- A batch takes every free lock it needs. If any needed node is held by another author, the whole batch is refused with the `locked` conflict, naming the first such node in batch order and its holder, and no lock is taken.
- A lock request on a free node takes it. On a node held by another author it gets the `locked` conflict.
- Of N simultaneous claims on one free node, through lock requests, batches or both, exactly one wins. Every other claim gets the `locked` conflict naming the winner. Nothing is merged.
- A lock lapses 30 seconds after its holder's last operation, lock request or presence heartbeat. A lapsed lock is free.
- A lock is released by the holder's DELETE, by takeover, by offboarding the holder, or by revoking the holding token.
- Takeover moves the lock at once to any caller allowed to apply ops, whether a person or an agent. After a takeover, the previous holder's operations on that node get the `locked` conflict.
- The editor opens the takeover prompt only when a person commits a change to a node it already shows as held by another author. A `locked` conflict on a node it showed as free rolls the change back instead. Undo, redo and restore conflicts show their Feedback states copy. Neither case opens the prompt, as set out in Interactions.

**Realtime delay.** Operations, locks, takeovers, presence, comments and version state changes reach every open editor of the scene within one second. Presence lapses 30 seconds after an author's last heartbeat. The editor sends a heartbeat at least every 10 seconds while open.

**Undo, redo and restore.**
- Each author, person or agent token, has their own undo list of their batches.
- Undo takes the caller's most recent batch that has not been undone and appends, as one new batch by the caller, the stored inverses of its operations in reverse order (`undoOf` set).
- Redo appends the operations of the caller's most recently undone batch again (`redoOf` set).
- Any new batch by the caller clears their redo list.
- Undo and redo need the same locks as any batch.
- If an inverse no longer applies, because a later change by someone else removed the node, layer or state it names, or gave the state it removes an override or a transition, undo gets `undo_conflict` and nothing is appended. Its `nodeId` is null when the conflict is about a state.
- Restore to `toSeq` appends one batch by the restorer containing the inverses of operations `toSeq+1` to `latestSeq` in reverse order (`restoreTo` set). Afterwards the scene's hash equals the hash at `toSeq`. A restore batch is undoable like any other.

**States, transitions and camera views.**
- States override the base graph field by field. `rest` is the base.
- At most one transition exists per `from` + `trigger`.
- A scroll transition runs in proportion to scroll progress.
- Camera views are keyed by name.

**Uploads.** Every check reads the complete received bytes. Nothing is written to the object store unless all checks pass. Checks run in this order, and the first failure gives the answer:
1. The `kind` field and the file name (422).
2. Size against the declared kind's limit (413 `file_too_large`).
3. Content type (415).
4. Texture dimensions (422).
- **Model** (`kind` `model`):
  - The bytes must be a binary glTF 2.0 file: the first four bytes are the ASCII letters `glTF`, the next four-byte little-endian integer is 2, and the next four-byte little-endian integer equals the file's exact byte count.
  - The file name must end in `.glb` (any case).
  - At most 20,000,000 bytes; exactly 20,000,000 is allowed.
- **Texture** (`kind` `texture`):
  - The bytes must be a PNG (standard 8-byte PNG signature) named `.png`, or a JPEG (starting with bytes FF D8 FF) named `.jpg` or `.jpeg`.
  - At most 8,000,000 bytes; exactly 8,000,000 is allowed.
  - Width and height, read from the image header, each at most 4096 pixels.
- **Rejections:**
  - Anything else, including SVG, other formats and any name and content mismatch, is refused with 415.
  - A file over its kind's limit is refused with 413 `file_too_large`, carrying that limit.
  - A file name must be 1–120 characters and contain no `/`, `\`, `..` or control characters, otherwise 422. Stored keys never use the file name.

**Version lifecycle.** The legal moves are:

| From | To | Trigger and guard |
|---|---|---|
| `draft` | `in_review` | Submit |
| `in_review` | `scheduled` | Schedule. Needs at least one approval from a member other than the version's creator (`approval_required`). No other version of the scene may be `scheduled` (`another_version_scheduled`). `publishAt` must be at least 5 seconds and at most 365 days after the server's current time, otherwise 422. The workspace must be neither suspended nor cancelled (402). The version's snapshot must be readable from file storage, otherwise 503 `file_storage` |
| `scheduled` | `in_review` | Unschedule, before go-live |
| `scheduled` | `published` | The server, at `publishAt` |
| `published` | `withdrawn` | Withdraw, or automatically when a newer version of the same scene is published |

- Every other move is refused with `invalid_transition`.
- Approval is allowed only in `in_review` (`not_in_review`). A repeat approval by the same member changes nothing and answers 200.
- Saving a version snapshots the graph at the current `latestSeq`, so later edits never change a saved version.

**Go-live.**
- A scheduled version goes live at its stored `publishAt` by the server's clock: never before, and within 2 seconds after.
- On going live, the server:
  - writes the published payload to file storage;
  - gives the scene a stable `embedId` on its first publish and reuses it after that;
  - moves the previously published version of the scene to `withdrawn`;
  - writes audit `version.published` with the scheduler as actor;
  - sends the publish notice.
- If file storage is unreachable at that instant, the version stays `scheduled` and the server retries at least every 5 seconds. It goes live on the first success, and the notice reports the real `publishedAt`.
- If the workspace is suspended at that instant, the version stays `scheduled` and goes live within 2 seconds of the subscription becoming active again.
- The embed shows the scene's current published version. When that version is withdrawn, or the subscription is cancelled, the embed answers 410.

**Published data.** The published payload, the export bundle and the publish notice contain only:
- the scene name;
- the version number, label and `publishedAt`;
- the version's snapshot graph (nodes, material layers, the states, transitions and camera views present at the version's `seq`);
- the asset files that graph references, plus the embed URL in the notice.

They never contain comments, operations or inverses, author or member names, IDs or emails, review link tokens, states or nodes added after the version's `seq`, or other versions.

**Review links.**
- A token is at least 43 URL-safe characters drawn from at least 32 random bytes.
- A link opens only its own version's snapshot, and no request parameter can make it open another version.
- Links may be created for versions in `draft`, `in_review` or `scheduled` (`version_not_reviewable` otherwise).
- `expiresAt` must be at least 10 seconds and at most 30 days after the server's current time, otherwise 422.
- A link works while all of these hold: the server's time is before `expiresAt` (at `expiresAt` exactly it has expired); it has not been revoked; it has not been regenerated (regenerating issues a new token and the old one answers 404 at once); the workspace's `reviewLinksEnabled` is true; and its version is still `draft`, `in_review` or `scheduled`.
- An expired link answers 410. Every other failure answers 404.
- While `reviewLinksEnabled` is false, creating a link gets `review_links_disabled`.

**Subscription lifecycle.**

| From | To | Trigger |
|---|---|---|
| `trial` | `active` | Successful checkout |
| `trial` | `suspended` | The trial ends with no checkout |
| `active` | `past_due` | A `payment.failed` event for one of the workspace's payments |
| `past_due` | `active` | No unpaid invoices remain after a payment |
| `past_due` | `suspended` | The grace period ends |
| `suspended` | `active` | Checkout, if suspended by trial end; no unpaid invoices remain, if suspended by dunning |
| any except `cancelled` | `cancelled` | The owner cancels |

- Other moves (checkout from `active`, `past_due`, `cancelled` or a dunning suspension, and any move out of `cancelled`) get `invalid_transition`.
- Plan and seat changes need `active` (`subscription_not_active`).
- While `suspended` or `cancelled`, only these state-changing requests keep working:
  - sign-in and sign-out;
  - every billing route and the webhook;
  - member removal and invitation revocation;
  - agent token revocation and review link revocation;
  - workspace settings;
  - presence heartbeats and lock release;
  - unschedule and withdraw.
- Every other state-changing request answers 402 `workspace_read_only`. That includes operations, undo, redo, restore, lock claims, takeover, scene creation, uploads and thumbnails. It also includes saving, submitting, approving and scheduling versions, exports, creating and regenerating review links, posting and resolving comments, inviting, accepting invitations and issuing agent tokens.
- Reads keep working.
- Existing embeds stay live while suspended and answer 410 once cancelled.
- `past_due` restricts nothing.

**Plan changes and proration.**
- A change is an *upgrade* when it moves from Team to Business (either period), or from monthly to annual within the same plan. It takes effect immediately.
- Every other change is a *downgrade* and takes effect at the end of the current term, Kill Bill's charged-through date.
- Extra seats carry over to the new plan at the new plan's seat price, under the same policy.
- Seat increases are immediate and seat decreases take effect at the end of the term.
- Every charged amount, including proration credit and charge, is the amount on the invoice Kill Bill generates. The preview is Kill Bill's dry-run invoice for the same change.
- The app never computes a prorated amount itself. It stores and shows Kill Bill's amounts to the cent.
- An immediate change whose invoice amount is zero or less records no payment and sends no receipt.
- A pending end-of-term change shows in `pendingChange` until it takes effect.

**Cards.**
- A card is the JSON object `{"number","expMonth","expYear","cvc"}`:
  - `number` and `cvc` are strings of digits;
  - `expMonth` is an integer from 1 to 12;
  - `expYear` is a four-digit integer;
  - for example `{"number":"4242424242424242","expMonth":12,"expYear":2030,"cvc":"123"}`.
- The billing form's "Expiry (MM/YY)" entry is sent with the year as 20YY. A field of the wrong JSON type answers 422 with its path.
- A card number must be 13–19 digits and pass the Luhn check.
- The expiry month and year must not be before the current month by the server's clock.
- The CVC must be 3–4 digits. Otherwise 422 with the field path, for example `card.number`.
- The test card `4000000000000002` is declined with 402 `card_declined`, and nothing is recorded anywhere. Every other valid number is accepted.
- Only the last four digits are stored. The full number and the CVC never reach the database, logs, Kill Bill or any email.

**Payments are all-or-nothing.** Paying an invoice, whether through checkout, pay, an immediate change or a `payment.succeeded` event, produces three things: the Kill Bill payment, the stored invoice PDF and the receipt email. Either all three exist or none do.
- If file storage is unreachable, no payment is recorded and nothing is sent: 503 `file_storage`.
- If Kill Bill fails, no PDF remains and nothing is sent: 503 `billing`.
- The receipt is sent only after both the payment and the PDF exist.
- A failed checkout leaves no subscription, payment, PDF or receipt. An empty Kill Bill account may remain.

**Idempotency.**
- Billing `POST` routes need an `Idempotency-Key` of 1–200 visible ASCII characters, scoped to the workspace and kept for 24 hours.
- The first request with a key is processed, and its status and body are stored.
- A later request with the same key and a byte-identical body gets the stored status and body and changes nothing.
- The same key with a different body gets `409 {"error":"idempotency_key_reused"}`.
- A request whose key is still being processed gets `409 {"error":"request_in_progress"}`.
- Responses that end in 503 are not stored, so a retry after recovery runs afresh.
- Each key therefore yields at most one Kill Bill payment, one invoice charge and one receipt.

**Gateway webhook.**
- Each workspace has its own signing secret.
- An event is processed once per `id`. A replay with the same body answers 200 with `duplicate:true` and changes nothing. The same `id` with a different body gets `idempotency_key_reused`.
- An event that fails with 503 is not recorded, so the gateway's retry processes it.
- `payment.succeeded` pays the named invoice under the all-or-nothing rule, for the invoice's exact balance. If the invoice's balance is already zero, the event changes nothing beyond recording its ID, and the webhook answers 200 with `duplicate:false`, whatever `amountCents` says.
- `payment.failed` means a payment the gateway had accepted did not settle. The app records a Kill Bill chargeback on that payment, which reopens the invoice balance. If the subscription is `active`, it becomes `past_due`. A payment that is already charged back records nothing.

**Refunds.** A refund is at most the payment's amount minus what has already been refunded. It records a Kill Bill refund and sends the refund email. Refunds do not change seats or plan.

**Time rules.** The server judges every time rule by its own clock and ignores client-supplied times and `Date` headers. The server's scheduler runs at least once per second. Each scheduled effect happens at its instant or within 2 seconds after, never before, and exactly once.
- **Trial.** `trialEndsAt` is the workspace's creation instant plus `TRIAL_LENGTH_SECONDS` seconds (default 1,209,600, which is 14 days). The trial is running while the server's time is before `trialEndsAt`. At `trialEndsAt` exactly it has ended, and the subscription moves to `suspended`. Seeded workspaces are the exception: their trials end 14 days after seeding, whatever `TRIAL_LENGTH_SECONDS` says.
- **Dunning.**
  - Let D be `DUNNING_DAY_SECONDS` (default 86,400, which is one day), and `failedAt` the server's time when the `payment.failed` event that made the subscription past due was received.
  - Notices go out at `failedAt` (day 0), `failedAt + 3D` (day 3) and `failedAt + 7D` (day 7).
  - `graceEndsAt` is `failedAt + 7D`. Publishing is allowed while the server's time is before `graceEndsAt`. At `graceEndsAt` exactly the subscription is `suspended`, and the day-7 notice is the suspension notice.
  - Becoming `active` cancels the notices not yet sent.
- **Scheduled publish.** The time is the stored `publishAt` instant, entered and shown in the workspace's time zone.
- **Agent tokens.** A token is valid while the server's time is before `expiresAt`, and expired at `expiresAt` exactly. The expiry warning goes out at `expiresAt − TOKEN_WARNING_LEAD_SECONDS` (default 86,400, which is 24 hours), or at issue if that instant has already passed. It goes out once, and not at all for a token revoked before then.
- **Review links.** See Review links above.
- **Invitations.** An invitation expires 7 days after it is created.
- **Locks and presence.** See Object locks and Realtime delay above.

**Audit.**
- Every successful request marked with an audit action writes exactly one entry of its own: the actor (member or agent), the action and the target. Any scheduler entries listed below are written in addition to it.
- Changes the server makes on its own write entries with the scheduler as actor. This includes changes a gateway webhook triggers. Go-live writes `version.published`.
- Subscription transitions write exactly these entries and no others:

| Transition | Entries (actor) |
|---|---|
| `trial` → `active`, or a trial-end `suspended` → `active`, by checkout | `subscription.started` (the caller) |
| `trial` → `suspended` at trial end | `subscription.trial_ended` (scheduler) |
| `active` → `past_due` by a `payment.failed` event | `subscription.past_due` (scheduler) |
| `past_due` → `active`, or a dunning `suspended` → `active`, by paying the last unpaid invoice through the pay route | `invoice.paid` (the caller), then `subscription.reactivated` (scheduler) |
| The same move by a `payment.succeeded` event | `invoice.paid` (scheduler), then `subscription.reactivated` (scheduler) |
| `past_due` → `suspended` at the end of the grace period | `subscription.suspended` (scheduler) |
| any → `cancelled` | `subscription.cancelled` (the caller) |

- `invoice.paid` is written only by the pay route and by `payment.succeeded` events. When either pays an invoice without moving the subscription, it writes only `invoice.paid`, credited to the caller for the pay route or to the scheduler for the event.
- Checkout, immediate plan changes and seat increases also pay an invoice, but each writes only its own route entry (`subscription.started`, `subscription.plan_changed` or `subscription.seats_changed`, credited to the caller) and never `invoice.paid`.
- A `payment.failed` event that moves no subscription writes no entry. Neither does an end-of-term change taking effect.
- Scene operations are recorded in the operation log, not in the audit trail.

### Services (DP-05, DP-11, DP-20, DP-31, DP-39, DP-43, DP-47, DP-48, DP-50, DP-52, DP-57)

**PostgreSQL** (`DATABASE_URL`) is the source of truth for:
- workspaces, members, roles and sessions;
- agent tokens with scopes and expiry;
- scenes, versions, approvals and the append-only operation log (author, operation, inverse);
- review links, the scheduled-publish queue, idempotency records, the processed-webhook ledger and the audit trail.

Apply the schema and the seed idempotently on every serve. Insert seed records only when they are absent, and never duplicate them.

**PocketBase** (`POCKETBASE_URL` and the admin credentials) is the live collaboration layer. On every serve the app creates these collections idempotently:
- `presence`: `workspace`, `scene`, `authorKind`, `authorId`, `authorName`, `selection`, `cursor`, `seenAt`;
- `object_locks`: `workspace`, `scene`, `node`, `holderKind`, `holderId`, `holderName`, `expiresAt`;
- `comments`: `workspace`, `scene`, `commentId`, `node`, `body`, `authorId`, `authorName`, `mentions` (a JSON list of member IDs), `resolved`.

`object_locks` holds exactly one record for each held lock, and that record matches the API's holder. The browser never talks to PocketBase directly; the app relays changes through the scene event stream.

**MinIO** (`S3_*`). Every object lives under `ws/<workspaceId>/`:

| Object | Key |
|---|---|
| Version snapshot `{"seq","graph","hash"}` | `ws/<workspaceId>/scenes/<sceneId>/versions/<versionId>/snapshot.json` |
| Version thumbnail | `ws/<workspaceId>/scenes/<sceneId>/versions/<versionId>/thumbnail.png` |
| Uploaded asset | `ws/<workspaceId>/assets/<assetId>` |
| Published payload | `ws/<workspaceId>/published/<embedId>/scene.json` |
| Export bundle | `ws/<workspaceId>/exports/<exportId>.zip` |
| Invoice document | `ws/<workspaceId>/invoices/<invoiceId>.pdf` (a valid PDF starting with `%PDF-`, showing the workspace name, invoice number, date, line items, total and amount paid) |

When MinIO is unreachable:
- uploads, thumbnails, version saving, scheduling, exports, invoice payment and checkout answer 503 `file_storage`, and the editor shows the file storage banner from Feedback states;
- operations, undo, restore, locks, comments, review of existing links, embeds already cached in memory and every other non-file action keep working;
- go-live waits, as set out in Business rules.

**Kill Bill** (`KILLBILL_*`).
- On serve, while Kill Bill is reachable, the app uploads its catalog to the tenant idempotently:
  - products `Team` and `Business` (base) and `Seat` (add-on);
  - the plans and seat plans from Business rules, with no trial phase, billed in advance in USD.
- One account per workspace, with external key equal to the workspace ID, created at the first checkout. The account carries Kill Bill's `AUTO_PAY_OFF` control tag, so only the app records payments, and uses Kill Bill's external payment method.
- Checkout creates the base subscription and, when extra seats are bought, seat add-on subscriptions. Extra seats on the account equal the sum of the active seat add-on subscriptions' quantities (each counts as 1 when no quantity is set).
- Every charge is a Kill Bill PURCHASE payment against the generated invoice, on the workspace's account, with transaction external key `<workspaceId>:<Idempotency-Key>`, or `<workspaceId>:<event id>` for webhooks.
- Refunds are REFUND transactions and failed settlements are CHARGEBACK transactions on the original payment.
- Upgrades use the IMMEDIATE change policy and downgrades the END_OF_TERM policy. Cancellation cancels immediately.

When Kill Bill is unreachable:
- checkout, preview, plan, seats, invoices, pay, refund, cancel and webhooks answer 503 `billing`;
- nothing is charged, stored or sent;
- `GET /api/billing`, invitations (seat counts come from the app's own records), editing and publishing keep working.

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`).
- Every message is sent once, from `MAIL_FROM` (`Orrery Studio <studio@orrery-labs.test>`). The exception is invitations, whose sender display name is "<inviter name> via Orrery Studio" with the address from `MAIL_FROM`.
- Display names and subjects are header-safe: carriage returns, line feeds and other control characters are removed, names containing special characters are quoted, and non-ASCII text is encoded.
- *Billing contacts* means the owner and all billing managers. A message to them is one message with every billing contact in To.

| Message | To | Subject | Sent when |
|---|---|---|---|
| Invitation | Invitee | `Join <workspace name> on Orrery Studio` | Invitation created. The body holds `<APP_PUBLIC_URL>/invite/<token>` |
| Receipt | Billing contacts | `Receipt for invoice <invoice number>: $<amount>` | After the payment and the PDF both exist |
| Refund | Billing contacts | `Refund for invoice <invoice number>: $<amount>` | Refund recorded |
| Dunning day 0 | Billing contacts | `Payment failed for <workspace name>` | At `failedAt` |
| Dunning day 3 | Billing contacts | `Reminder: payment still due for <workspace name>` | At day 3 |
| Dunning day 7 | Billing contacts | `Publishing suspended for <workspace name>` | At `graceEndsAt` |
| Schedule confirmation | The scheduling member | `Scheduled: <scene name> v<number> goes live <local time>` | Version scheduled |
| Publish notice | The scheduling member and the version's creator (once each, one message) | `Published: <scene name> v<number>` | Go-live. The body holds only the published data allowed in Business rules |
| Token expiry warning | The issuing member, or the owner if that member was removed | `Agent token <token name> expires soon` | Per the token time rule. The body states `<local time>` of expiry |

### Seed data (DP-03, DP-07, DP-11, DP-14, DP-32, DP-34, DP-49)

Every seeded person, business, product and token below is invented. All seeded members use the password `orrery-demo-2026`.

**Workspace `ws_kestrel`, "Kestrel Audio".**
- Time zone `Europe/Berlin`, `reviewLinksEnabled` true.
- Subscription `trial`, ending 14 days after seeding.
- Seats purchased 8. Seats used 7: 6 members and 1 open invitation.

| ID | Name | Email | Role |
|---|---|---|---|
| `mem_mara` | Mara Lindqvist | mara@kestrel.test | owner |
| `mem_theo` | Theo Brandt | theo@kestrel.test | admin |
| `mem_priya` | Priya Raman | priya@kestrel.test | billing_manager |
| `mem_jun` | Jun Okafor | jun@kestrel.test | editor |
| `mem_sol` | Sol Navarro | sol@kestrel.test | editor |
| `mem_ines` | Ines Duarte | ines@kestrel.test | viewer |

- Open invitation `inv_kestrel_ada` for ada.kim@kestrel.test, role viewer, invited by Theo, expiring 7 days after seeding.
- Gateway signing secret: `whsec_kestrel_4c1e9a7b20d35f86`.
- Agent tokens, both issued by Theo and expiring `2027-12-31T00:00:00Z`:
  - `tok_kestrel_poser`, "Catalogue poser", scope `edit`, secret `orr_kestrelposer3f9a1c7e5b2d4a6081c9e7f2ab`;
  - `tok_kestrel_qa`, "Framing QA", scope `read`, secret `orr_kestrelframingqa8b2e4d6f1a3c5e7092b4cd`.

**Scene `sc_arc_one`, "Arc One headphones".** At seq 0 the graph holds:
- `n_root` "Scene": group, no parent;
- `n_cam` "Main camera": camera under `n_root`, position [0, 1.2, 4], rotation [−15, 0, 0];
- `n_key` "Key light": light under `n_root`, position [2, 3, 2].

Unless stated otherwise, every node has position [0, 0, 0], rotation [0, 0, 0], scale [1, 1, 1], no material layers, and is visible. Nine single-operation batches follow:

| seq | Author | Operation |
|---|---|---|
| 1 | Jun Okafor | `node.add` `n_headband` "Headband", mesh, primitive cylinder, under `n_root`, position [0, 0.8, 0], rotation [0, 0, 90], scale [0.1, 1.2, 0.1] |
| 2 | Jun Okafor | `node.add` `n_cup_l` "Left cup", mesh, primitive sphere, under `n_root`, scale [0.45, 0.45, 0.2] |
| 3 | Jun Okafor | `node.add` `n_cup_r` "Right cup", mesh, primitive sphere, under `n_root`, scale [0.45, 0.45, 0.2] |
| 4 | Catalogue poser (agent) | `transform.set` `n_cup_l` position [−0.6, 0, 0] |
| 5 | Catalogue poser (agent) | `transform.set` `n_cup_r` position [0.6, 0, 0] |
| 6 | Sol Navarro | `material.layer.add` on `n_headband`, layer `l_band_base`, type base, color [0.12, 0.12, 0.11], roughness 0.6, metalness 0.1 |
| 7 | Sol Navarro | `state.add` `st_hover` "Hover" |
| 8 | Sol Navarro | `state.override.set` `st_hover`, `n_cup_l`, rotation, [0, 15, 0] |
| 9 | Sol Navarro | `transition.set` from `rest` to `st_hover`, trigger hover, 420 ms |

**Scene `sc_arc_case`, "Arc One case".** Seq 0 only, with the same three starting nodes and no operations.

**Kestrel comment** `cmt_kestrel_band` on `n_headband` in `sc_arc_one`, by Ines Duarte: "Can the band read more matte in Hover?" It has no mentions and is unresolved.

**Workspace `ws_fernhall`, "Fernhall Furniture".**
- Time zone `America/Chicago`, `reviewLinksEnabled` true.
- Subscription `trial`, ending 14 days after seeding. 8 seats purchased, 3 used.
- Gateway signing secret: `whsec_fernhall_9b2d6e1f73a04c58`.

| ID | Name | Email | Role |
|---|---|---|---|
| `mem_ezra` | Ezra Cole | ezra@fernhall.test | owner |
| `mem_lena` | Lena Moss | lena@fernhall.test | editor |
| `mem_ravi` | Ravi Shah | ravi@fernhall.test | viewer |

- Agent token `tok_fernhall_poser`, "Fernhall poser", scope `edit`, secret `orr_fernhallposer6d1f3b5a7c9e2b4d608a1fde`, issued by Ezra, expiring `2027-12-31T00:00:00Z`.
- Scene `sc_lowback`, "Lowback lounge chair": the same three starting nodes, plus seq 1 by Lena Moss: `node.add` `n_seat` "Seat", mesh, primitive box, under `n_root`, scale [1, 0.3, 1].
- Comment `cmt_fernhall_seat` on `n_seat` by Ravi Shah: "Seat cushion looks too tall."

No Kill Bill accounts, MinIO objects, versions, review links, exports or uploaded assets exist at start.

## Technical requirements

### Deployment (DP-55)

**Runtime.** Node.js 22 with npm is available. Write the server and browser code in TypeScript.

**Run manifest.** `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

**Port and health.**
- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` as soon as PostgreSQL is reachable and the schema is applied, whatever the state of the other services.

**Startup.** Schema, PocketBase collections, the Kill Bill catalog and the seed are applied idempotently on every serve. Do not rely on the build step for any of them.

### Configuration and secrets (DP-57)

**Read at start from the environment.** Never hard-code these, and never send them to the browser:
- **PostgreSQL:** `DATABASE_URL`.
- **PocketBase:** `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`.
- **MinIO:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- **Kill Bill:** `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`.
- **Mail:** `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- **Public URL:** `APP_PUBLIC_URL`, used for links in emails. Default `http://localhost:<port>`.
- **Time rules:** `TRIAL_LENGTH_SECONDS`, `DUNNING_DAY_SECONDS`, `TOKEN_WARNING_LEAD_SECONDS`, with the defaults in Business rules.
  - Tests also run a second serve instance, the short-clock instance, with `TRIAL_LENGTH_SECONDS=20`, `DUNNING_DAY_SECONDS=5` and `TOKEN_WARNING_LEAD_SECONDS=15`.
  - Tests check the trial, dunning and token-warning edges there, so each rule must read these variables exactly.

Ignore any `*_OBSERVER_*` variables.

### Server boundary (DP-56)

**Same origin.**
- The app serves its pages and API from one origin and sends no CORS allowances.
- A state-changing request (any method other than GET, HEAD or OPTIONS) whose `Origin` header is present and differs from the app's own origin answers 403 `cross_origin`.
- The app's own origin is the scheme and host of the request itself. The host is the `Host` header. The scheme is `https` when the request carries `X-Forwarded-Proto: https`, and `http` otherwise. An `Origin` equal to the origin of `APP_PUBLIC_URL` is accepted as well.
- The webhook and public review and embed GETs are the exceptions: they need no `Origin`.

**Body limits.** `POST /api/assets` takes at most 20,100,000 bytes, `PUT /api/versions/:versionId/thumbnail` at most 1,000,000 bytes, and every other request at most 1,000,000 bytes. Each limit itself is allowed. Larger bodies answer 413 `payload_too_large` with the limit and are not read further.

**What the server never serves.**
- Source files, source maps of server code, `run.json`, `package.json`, lockfiles, environment files, or any path outside the built browser assets and the routes in API. These answer 404.
- Credentials, tokens other than the one-time new-token response, hashes or card numbers, in any response, page or log line.

**Dependencies down at boot.**
- The server starts and answers health while PocketBase, MinIO, Kill Bill or Mailpit is unreachable, and retries each one in the background.
- Actions that need a down service answer as set out in Services.
- The app never caches a failed connection. When a service that was unreachable at start first becomes reachable, the next request that needs it succeeds without a restart. The Kill Bill catalog and the PocketBase collections are applied at that point.
- Mail that cannot be sent is retried until it is sent, still exactly once.

### Browser support and performance (DP-58)

Support the current Chromium, Firefox and WebKit (Safari) desktop browsers and their mobile equivalents, at the three viewports in Screens and layout. Tests use Chromium, with software WebGL available.

| Measure | Limit |
|---|---|
| Editor usable (hierarchy, inspector and viewport drawn) after navigation, with a seeded scene, at 1280×800 | 3 seconds |
| Public home page fully drawn | 2 seconds |
| `GET /api/scenes/:sceneId/graph?at=N` for a scene with 1,000 operations | 1 second |
| Timeline drag across 100 ticks | Keeps up with the pointer, with no frame longer than a tenth of a second |

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its version and licence. "Shipped packages" means the production dependency tree reported by `npm ls --omit=dev --all --json`. The file also lists every bundled font and asset.
- IF-03: Every shipped package and bundled font or asset is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, OFL-1.1 or CC0-1.0.
- IF-04: The app stores data only in the five provided services. No SQLite, Redis, embedded database, or files on disk used as a datastore.
- IF-05: The provided service configuration and seeded service credentials stay unmodified.
- IF-06: Fonts, scripts, styles and 3D libraries are served from the app's own origin. No page loads anything from a third-party host at runtime.
- IF-07: Server and browser source is TypeScript with strict mode on, and `package-lock.json` is committed.

## Engineering standards

- The code is idiomatic, strict TypeScript, with no `any` in domain logic and no type assertions that hide a real mismatch.
- Names match this brief's domain terms: scene, node, operation, inverse, batch, lock holder, takeover, version, review link, seat, grace period, dunning notice, idempotency key.
- Each domain rule is decided in exactly one place in the source. That covers the permission table, every version and subscription transition, the seat counts, the lock winner, undo and restore inverses, the graph hash, idempotent replay, upload checks and every time-rule edge.
- Every error response is built through one consistent error shape that matches the API section.
- No abstraction has only one implementation, and there is no dead, commented-out or unreachable code.
- There are no defensive checks for states the rules make impossible. Real provider failures map to the outage answers.
- There are no features, endpoints, screens or settings beyond this brief.
