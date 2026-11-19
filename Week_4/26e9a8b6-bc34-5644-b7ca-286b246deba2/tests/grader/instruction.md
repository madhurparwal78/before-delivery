# Pennywasher Works Pennywasher

Pennywasher is a site for community repair guides. Each guide is built on an uploaded 3D model of the thing being fixed and is written by a home fixer who repaired something they own. Readers follow a repair while the model comes apart step by step, and they see which part to touch and what the parts have cost so far. Authors bind named parts to a binary glTF file (.glb), write numbered steps, keep versions and answer questions. Forkers adapt a guide and keep credit to its source, and embedders place one guide on their own page. The backend uses Postgres for all records and search, MinIO for model files, and Mailpit as the SMTP sink for the confirmation message. Accounts are email and password only. Out of scope: outside sign-in, AI features, paid plans, analytics, third-party requests of any kind, and any other datastore, queue or cache.

## Problem and users

People who fix a bike hub, a coffee grinder or a game controller can already publish photo steps, but a close-up photo does not show where a part sits or what is behind it. An exploded view still has to be animated by hand in a desktop tool, so a fixer who owns a working .glb has nowhere to turn it into a guide. Readers pay with stripped screws, snapped clips and whole machines thrown away over a cheap part, and they often learn the parts cost only at the end. Authors rewrite the same guide when a better method turns up, with no safe way back and no credit when someone improves on it. Junk questions bury them too, so every account must prove a real mailbox before it can upload, save, like or ask.

- **Reader** (occasional): follows a repair step by step, sees which part to touch and the parts cost so far, and asks the author when stuck.
- **Author** (weekly): turns a .glb into a guide with named parts and numbered steps, keeps versions, and answers questions as they arrive. An author may share a guide with co-authors.
- **Forker** (occasional): takes a public guide for a slightly different model of the same object, adapts it and keeps credit to the source version.
- **Embedder** (occasional): puts one guide on a blog or club page, opening at the step that matters.

## Journeys

1. **Build by keyboard.** An author opens a draft in the editor with no mouse in reach. They add a step, type its text, tick its parts, set how far apart the model comes, save a version and move the step. The end state is a new version number shown in every open tab of that guide.
2. **Change your mind.** An author and a co-author are editing the same draft. The author undoes and redoes their own edits and a step move, and the co-author's edit stays in place. The end state is a saved version holding exactly the undone state.
3. **Read a repair.** A reader opens a public guide at the top and scrolls. The model comes apart band by band, the focus parts take their own colours, the running cost counts up and each step is spoken. The end state is the closing total on a red field, and scrolling back reverses everything.
4. **Share a step.** Someone opens a link to step 3 and sees it settled. They move on, go Back and reload without losing their place. A signed-out reader who asks a question signs in and returns to the same step.
5. **Read without motion, or without 3D.** A reader with reduced motion moves through the steps by buttons, and every pose and total appears at once. A reader whose browser has no WebGL gets a still image of each step with the same text and totals.
6. **Fix it on a phone.** A reader on a phone scrolls past the stage without getting stuck, and turns on free look to orbit the model. An author corrects a step on the phone, and it appears live on their desktop.
7. **Bring a model.** An author drops a .glb on the stage and previews it without sending anything. They then upload it and see it confirmed as stored. Bad files are refused with the reason, and when storage is unreachable both the author and the reader are told while the text keeps working.
8. **Go back safely.** An author compares two versions, reads what changed and what the parts cost difference is, and restores an older one as a new version. History stays intact and a second tab sees the new version live.
9. **Adapt someone's guide.** A reader forks a public guide and gets their own copy with a credit naming the source and version. Later changes to the source never touch the fork, and it sits on the reader's dashboard.
10. **Edit together.** Two people work in one draft and see where each other is. Different fields merge. When both change the same field, a dialog shows both sides and the person chooses.
11. **Ask and answer.** A new account proves its mailbox from the delivered message and then asks about a step. The author's open dashboard gets the question live, and the reader gets the answer live.
12. **Find a guide.** A signed-out visitor types in search, adds tags and pages through results. Later they arrange a collection by keyboard and like a guide, and the author's open page shows the new count.
13. **Embed a step.** An embedder opens the embed address at a chosen step. It looks the same for everyone, sets no cookie and stays silent until the sound button is pressed.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Keyboard authoring journey.** From a grading world's `draft` guide open in the editor, the author adds a step, chooses its parts, sets its apart amount, saves a version, moves the step and resizes the panes using only the keyboard, while the author's second tab shows the new version number live.
- **DP-02 — Editor toolbar Tab order.** Tab walks the `Editor tools` toolbar in exactly the numbered order published in Interactions, and Shift+Tab walks it backwards.
- **DP-03 — Add step and choose parts by keyboard.** Pressing Enter on `Add step` puts focus in the new step's title field and announces the addition in `Editor status`, and Space in the `Parts in this step` group sets that step's focus parts.
- **DP-04 — Apart slider applies after its delay.** Arrow keys on `Apart amount` leave `data-explode` unchanged until the editor apply delay in Motion and effects has fully passed, and change it exactly then.
- **DP-05 — Save shortcut from any control.** Ctrl+S or Cmd+S from a step text field saves a version without opening the browser's save dialog, announces the saved copy from Feedback states in `Editor status`, and updates `Latest version` in the author's second tab live.
- **DP-06 — Step move and pane separator by keyboard.** Alt+ArrowUp and Alt+ArrowDown move the focused step and announce the move, and the `Resize stage and steps` separator follows the keys and value range published in Interactions, resizing the panes at once.
- **DP-07 — Typed limits keep the text.** Guide titles and step text accept exactly their published limit counted in code points with an emoji as one, and one more is refused with the copy naming the limit in `Editor status`, with the typed text still in the field after the notice has cleared.
- **DP-08 — Undo and redo journey.** With author and co-author in one draft in two browser contexts, the author undoes and redoes a text edit and a step move while the co-author's edit stays in place, and then saves the undone state as a version.
- **DP-09 — Undo restores own step text.** Ctrl+Z restores the author's last step-text edit character for character, Ctrl+Shift+Z brings it back, and each is announced with the undo and redo templates and labels from Feedback states.
- **DP-10 — Undo of a step move.** Undoing a step move restores the previous step order in the page and in the working-copy API and announces the move's label.
- **DP-11 — Undo spares a co-author's edit.** The author's undo never reverts an edit made by the co-author, as checked in both browser contexts and through the working-copy API, and an edit the co-author has since overwritten gives the cannot-undo copy.
- **DP-12 — Guide total follows price edits.** Changing `Unit price` updates `data-figure="total-cost"` in place from the server's reply with no reload and announces the guide total copy, and undo returns the earlier figure the same way.
- **DP-13 — Shortcuts on toolbar focus and empty stacks.** Undo and redo shortcuts work while a toolbar button has focus, and an empty stack gives the nothing-to-undo and nothing-to-redo copy from Feedback states.
- **DP-14 — Saving the undone state.** After an undo, Ctrl+S stores a version whose JSON holds the undone values and not the undone edit.
- **DP-15 — Scroll reading journey.** A reader of the world's `public` guide scrolls through all steps and back, and the stage hooks, counter, spoken progress and running cost follow the published scroll mapping both ways, ending at the closing total.
- **DP-16 — Scroll position sets the step.** Each scroll range in the published mapping sets `data-step`, the `Step counter` text and the `Reading progress` announcement for that step.
- **DP-17 — Apart amount follows the band.** Within a step's section `data-explode` rises or falls linearly through the published band, holds outside it, returns exactly on scrolling back, and the camera matrices drawn by the stage differ between steps with different poses.
- **DP-18 — Parts cost counts both ways.** On each change of current step `data-figure="parts-cost"` shows values strictly between old and new during its count, the exact final text at the end of the published duration, and counts downward when going back.
- **DP-19 — Header figures count up.** On opening a guide without a step address, the header figures count up over the published duration and end at the exact seeded text.
- **DP-20 — Stage keys orbit and zoom.** On the focused `Model stage` the keys in the keyboard table change `data-yaw`, `data-pitch` and `data-zoom` by the published amounts within their clamps, Home returns to the step's saved pose, and Tab leaves the stage.
- **DP-21 — Reader layouts and own-origin loading.** At each published viewport the reader shows the published stage and steps geometry with no sideways overflow and every callout inside the viewport, and every request the page makes goes to the app's own origin.
- **DP-22 — Apart at the Step look.** Each guide phase is a flat full-height field in its published colour butted against the next, the transparent stage holds still in front of the passing edge, non-focus parts are flat silhouettes in the field's text colour, and focus parts show their own materials with an opposing outline.
- **DP-23 — Waterline hero.** The home page opens with the published bone-over-red waterline headline, cut by the seam in two colours, with the wordmark, the solid slate link and the one supporting sentence and no image.
- **DP-24 — Stage built on bundled three.js.** The source renders the stage with three.js installed as a dependency, bundled and served from the app's own origin, with bundled font files and no remote code, font, image or model.
- **DP-25 — Deep link journey.** Starting from a world in two browser contexts, a step address opens settled, reading updates the address, Back and reload keep the place, signing in returns to the same step, and a second context cannot reach the private guide.
- **DP-26 — Step address opens settled.** Opening `?step=<n>` shows step n with its seeded `data-explode`, saved pose and final figures on first paint and no tween, and a reload keeps that step.
- **DP-27 — Address follows reading.** Scrolling replaces the address with the current `?step=<n>` and adds no history entry, while `Previous step`, `Next step` and step links add an entry, so Back returns to the previous step without a reload.
- **DP-28 — Step past the end.** A step number beyond the last opens the last step and shows the exact past-the-end notice from Feedback states.
- **DP-29 — Sign-in returns to the step.** `Ask the author` while signed out goes to the sign-in page with a local return path and, after signing in with the published controls, comes back to that exact path and step.
- **DP-30 — Non-local return lands on the dashboard.** A return address that is an absolute URL, starts with two slashes or a backslash pair, or carries a scheme lands on `/dashboard` after sign-in.
- **DP-31 — Private guide hidden from others.** The owner sees the world's `private` guide, while a signed-out context and the `reader` context get the not-found answer at the reader, embed, API, versions, forks and model routes, and it never appears in search.
- **DP-32 — Reduced motion journey.** Under reduced motion a reader moves through the `public` guide by buttons with every pose and figure final at once, and with WebGL off the same journey runs on stills.
- **DP-33 — Step buttons replace scrolling.** Under reduced motion `Previous step` and `Next step` change `data-step` and the step text, announce `Reading progress`, and scrolling the page never changes the step.
- **DP-34 — Pose snaps with no animation.** Under reduced motion a step change sets the hooks at once, no animations run on the stage or figures, and the camera matrices are final on the next drawn frame.
- **DP-35 — Figures final at once.** Under reduced motion every `data-figure` shows its exact final text immediately on load and on each step change, with no value in between.
- **DP-36 — Still fallback without WebGL.** With WebGL unavailable the stage has `data-state="still"`, an image named by the published template, the step text beside it, and the exact still-fallback copy in `Stage status`.
- **DP-37 — Still follows the step buttons.** With WebGL unavailable `Next step` changes the still's accessible name and image and the step text together.
- **DP-38 — Reduced motion controls fit a thumb.** At 375x812 under reduced motion, `Previous step` and `Next step` are at least 44 by 44 px and the page has no sideways overflow.
- **DP-39 — Phone journey.** At 375x812 with touch, a reader scrolls past the stage, uses `Free look` and reads the `Parts` list, and an author edits and saves in the `Editor panes` tabs while their desktop context sees the edit live.
- **DP-40 — Editor panes on a phone.** At 375x812 the `Editor panes` tabs show one pane at a time by touch and arrow keys, with the other panes out of the accessibility tree and Tab order.
- **DP-41 — Numbered parts list replaces callouts.** At 375x812 the reader shows the numbered `Parts` list of the current step's focus parts under the stage and shows no floating callouts.
- **DP-42 — Vertical drag scrolls the page.** With `Free look` off, a one-finger vertical drag on the stage scrolls the page and leaves `data-yaw` and `data-pitch` unchanged.
- **DP-43 — Free look orbits and pinches.** With `Free look` on, a one-finger drag on the stage changes `data-yaw` and `data-pitch` without scrolling the page, and a two-finger pinch changes `data-zoom`.
- **DP-44 — Phone edit reaches the desktop live.** A step text edit committed in the phone editor and saved there appears in the author's desktop context within the published live delay and without a reload.
- **DP-45 — Phone and tablet geometry.** At 375x812 and 768x1024 the reader and editor match the published layouts, with no sideways overflow and every control at least 44 by 44 px.
- **DP-46 — Model upload journey.** An author previews `bike-hub.glb` by drop, chooses a file by keyboard and uploads it, sees it confirmed as stored, sees refusals on the `short-limits` instance, and sees the outage copy on the `storage-down` instance.
- **DP-47 — Drop preview stays in the browser.** Dropping a valid .glb on the editor stage sets `data-state="preview"`, draws the model (draw calls and vertex buffer bytes rise), shows the exact previewing copy, and sends no request to the server.
- **DP-48 — Choosing a file by keyboard.** `Choose a model file` opens the file picker by Enter or Space as the alternative to drop, gives the same preview, and `Upload model` then reports upload progress in `Stage status`.
- **DP-49 — Stored only after MinIO confirms.** An upload shows the stored copy only after MinIO confirms length and checksum, the object at the published key is byte-identical to the file, and a replacement keeps every part with missing ones listed as unbound, as qualified in Business rules.
- **DP-50 — Upload refusals name the reason.** On `short-limits`, a renamed text file, a file one byte over `MODEL_MAX_BYTES`, a model with `MODEL_MAX_PARTS` plus one parts and a model with an outside URI each show their exact refusal in `Stage status`, answer the published status and body, and store nothing, while files exactly at the limits are accepted.
- **DP-51 — Storage outage for authors.** On `storage-down` an upload shows the author outage copy and answers the published 503 body, saving text still works, publishing is refused with its copy, and health answers as published.
- **DP-52 — Storage outage for readers.** On `storage-down` the reader page of a world made on the primary shows the exact reader outage copy with the step text, parts and costs intact and `data-state="error"`.
- **DP-53 — Credentials from the environment.** The source reads every service credential and URL from the published environment variables at start, and no credential is hard-coded or sent to the browser.
- **DP-54 — Versions journey.** The author opens `Versions`, compares two seeded versions by keyboard, restores an older one through its dialog and sees the new version in a second tab, and the compare stays open while notices expire.
- **DP-55 — Picking versions by keyboard.** Tab reaches each `Version <n>` checkbox in the `Versions` region, Space picks it, and `Compare` opens the `Version compare` region for the two picked versions.
- **DP-56 — Compare labels and cost difference.** The compare lists steps in the published order labelled exactly by the published four words, marks removed and added words with words and a side bar as well as colour, and shows the seeded cost difference text.
- **DP-57 — Restore dialog by keyboard.** `Restore version <n>` opens its dialog by keyboard, Tab and Shift+Tab wrap inside it, and Escape closes it and returns focus to the button that opened it.
- **DP-58 — Restore appends a version.** Restoring announces the exact restored copy, and the versions JSON shows a new newest version with `restored_from` set and every earlier version unchanged.
- **DP-59 — New version appears live in a second tab.** The author's second tab adds the new version to `Versions` and updates `Latest version` within the published live delay and without a reload.
- **DP-60 — Compare outlasts notices.** While the compare, unsaved step text or a drop preview is open, an expiring `Editor status` notice or an arriving question leaves them open and unchanged, and an older notice timer never clears a newer message.
- **DP-61 — Forms and compare look.** Forms are adjoining outlined cells with sentence-case labels and square corners, and the version compare is two butted fields, older on the darker bone and newer on bone, with thick side bars marking changes.
- **DP-62 — Forking journey.** The `reader` forks the world's `public` guide by keyboard, sees the credit on the fork, and finds the fork on their dashboard after reload, while the author's open page shows the fork count live.
- **DP-63 — Fork dialog by keyboard.** `Fork guide` opens its dialog by keyboard with Tab wrapping and Escape returning focus, and its confirm button creates the fork and opens the fork's editor.
- **DP-64 — Fork credit and JSON.** The fork page shows the exact credit copy with a link to the source guide, and the fork API answers with the published `forked_from` JSON.
- **DP-65 — Fork count updates live.** The source guide's open reader page changes `Fork count` to the published text within the published live delay and without a reload.
- **DP-66 — Fork stays independent.** Later edits, saved versions, withdrawal or deletion of the source never change the fork's steps, model or credit, and the fork's reader page still loads its stage.
- **DP-67 — Forks shelf and empty shelves.** The fork sits under `Forks` on the owner's dashboard after reload and in a new session, and an account with nothing on a shelf sees that shelf's exact empty sentence.
- **DP-68 — Private guides cannot be forked.** Forking the world's `private` guide as `reader` answers the not-found answer and creates no fork row.
- **DP-69 — Co-editing journey.** Author and co-author in one draft see each other's presence, merge edits to different fields, and settle a same-field change through the conflict dialog by keyboard, in two browser contexts.
- **DP-70 — People editing shows who and where.** `People editing` lists the other person and their step within the published live delay, and at 375x812 it sits directly above the `Editor panes` tabs.
- **DP-71 — Presence drops after the tab closes.** When a co-editor's tab closes, their entry leaves `People editing` within `PRESENCE_GRACE_SECONDS` plus the published live delay.
- **DP-72 — Different fields merge.** Edits by two people to different fields of one draft both appear in both contexts and in the working-copy API, with no dialog.
- **DP-73 — Same-field conflict dialog.** A same-field change opens the `Edit conflict` alertdialog with the exact copy naming the other person, both values shown, and `Keep mine` and `Take theirs` reachable by keyboard with Tab wrapping.
- **DP-74 — Conflict choices store the chosen value.** `Keep mine` and `Take theirs` each give the published stored value in the working-copy API, in both contexts, and their exact `Editor status` announcement.
- **DP-75 — Stale saves are refused.** A version save with an old base answers the published 409 body and overwrites nothing, and in the editor it shows the stale copy, keeps the typed text, and opens the compare of both sides.
- **DP-76 — Questions journey.** `newcomer` is refused, confirms through the delivered message and asks about step 4 by keyboard, the author's open dashboard gets the question live, and the reader sees the answer live.
- **DP-77 — Unconfirmed account refused.** A signed-in unconfirmed account pressing `Ask the author` gets the exact refusal copy in `Guide status` and a `Resend confirmation` button, and upload, save, like and ask answer the published 403 body.
- **DP-78 — Confirmation message from Mailpit.** The delivered message has the published sender, subject and link, a resend voids the earlier token, an expired token is refused after `CONFIRM_TOKEN_TTL_SECONDS` on `short-limits`, and no page or API response ever carries the token.
- **DP-79 — Ask dialog by keyboard.** `Ask the author` opens its dialog by keyboard at the current step, Tab and Shift+Tab wrap inside it, Escape returns focus to the button, and sending adds the question.
- **DP-80 — Question reaches the open dashboard.** A new question appears on the author's open dashboard within the published live delay and without a reload, announced with the exact `Question alerts` copy, and none are lost or repeated after a dropped connection.
- **DP-81 — Literal text and live answers.** Question and answer text with markup characters shows exactly as typed with no interpreted element, and the author's answer appears on the reader's open page live with its `Question alerts` copy.
- **DP-82 — Limits tell when to try again.** The `short-limits` instance refuses the third question in its window with 429, `Retry-After` and the exact copy in `Ask status`, and failed sign-ins and resends meet their published limits the same way.
- **DP-83 — Discovery journey.** A signed-out visitor searches by words and tags and pages through results, then a signed-in owner reorders a collection by keyboard and a reader likes a guide while the author's page updates live.
- **DP-84 — Search updates in place.** Typing in `Search guides` updates the results and huge count in place, with no reload, after the published delay, and announces the exact count copy in `Search status`.
- **DP-85 — Tags by keyboard.** In the `Filter by tag` combobox, arrow keys and Enter add a tag, each tag has a named remove button, and Backspace in the empty field removes the last tag, with results updating each time.
- **DP-86 — Search lives in the address.** The query and tags live in the address and survive a reload, and private, draft and withdrawn guides never appear in results.
- **DP-87 — Paging and search limits.** `Load more` continues from a cursor without repeating or skipping a guide while new guides are published, the API caps page size, and over-long queries and too many tags answer 422 with their exact `Search status` copy.
- **DP-88 — Collection order by keyboard.** On a collection page the owner moves a focused guide with Alt+ArrowUp and Alt+ArrowDown, hears the exact `Collection status` copy, and sees the same order after a reload.
- **DP-89 — Likes count once and live.** `Like` toggles `aria-pressed`, each account counts once, and the author's open page shows the exact `Like count` text within the published live delay.
- **DP-90 — Dashboard and search look.** The dashboard is a stack of full-bleed shelves in the published colours with large display headings on one left edge and big type rows rather than cards, and search shows results on bone with the count set huge.
- **DP-91 — Embed and sound journey.** An embedder opens a step address on the embed route, sees it settled and read-only, moves between steps, presses the sound button on and off, and checks a withdrawn guide's page, at desktop and phone sizes.
- **DP-92 — Embed opens settled and read-only.** `/embed/<slug>?step=3` shows step 3's settled hooks and final parts cost on first paint, with the published controls and no edit, like, fork or question control.
- **DP-93 — Embed ignores the session.** The embed page looks identical to signed-in and signed-out contexts, sets no cookie, shows no account name, and carries the published frame-ancestors headers while every other page carries the other published value.
- **DP-94 — Sound stays off until pressed.** Before the first press of `Workshop sound` no audio context, source or gain exists, every new page load starts off, and `sound=off` hides the button.
- **DP-95 — Sound presses set the master gain.** The first press starts one looping generated source through one master gain at the published level with `aria-pressed="true"`, and the next press sets that gain to 0 with `aria-pressed="false"`.
- **DP-96 — Publish states reach the embed.** `Publish` and `Withdraw` in the editor follow the published guide states with their copy and rejections, and the embed and reader show the exact withdrawn copy until the guide is published again, with private, draft and unknown guides showing the not-found page.
- **DP-97 — Embed fits a phone.** At 375x812 the embed view has no sideways overflow, the numbered `Parts` list replaces callouts, and every control is at least 44 by 44 px.

## Frontend

### Screens and layout (DP-21, DP-22, DP-23, DP-39, DP-40, DP-41, DP-45, DP-61, DP-67, DP-70, DP-90, DP-97)

The published viewports are exactly 375x812, 768x1024 and 1280x800. The desktop layout starts at 1200 px wide, the tablet layout covers 768 to 1199, and the phone layout is below 768. No width in between changes which layout a published viewport gets. No page ever overflows sideways. Every control is at least 44 by 44 px at 375x812 and 768x1024.

**Home `/`.** The waterline hero described in Visual design fills the first viewport. Straight after it comes the seeded coffee grinder guide's first step on its stage, with `Read this guide` and `Find a guide` links.

**Reader `/g/<slug>`.** The window scrolls, not an inner element. The page is a guide header exactly one viewport tall, one section per step exactly one viewport tall, then a closing total section one viewport tall (total page height is the viewport height times steps plus two). The stage and the reader bar add nothing to the scroll length.
- The header section shows the title, author name, tags, `Like count`, `Fork count`, the fork credit if any, and the summary figures.
- A step panel stays pinned in place while its step is current. It shows the phase name, the step's title as a level 2 heading, the plain text, the step's questions, and the `Steps` links. Only the current step's panel is shown. The panel carries its own phase colour as a solid block, so its contrast never depends on where a passing field edge is. Text too long for the panel scrolls inside the panel.
- The running parts cost and the step counter stay visible beside the stage.
- The closing total section sits on post red and shows the guide's total in `data-figure="closing-total"`.
- 1280x800: the steps column is on the left, and the stage starts at 42% of the width and fills the rest at full height, staying in place. The reader bar sits across the top of the steps column.
- 768x1024: the stage stays across the top at 46% of the viewport height, the step panel sits below it, and the reader bar is fixed to the bottom.
- 375x812: the stage takes the top 40% of the viewport, `Stage status` and the numbered `Parts` list sit below it in place of floating callouts, then the step panel, and the reader bar is fixed to the bottom and may wrap to two rows.

**Editor `/edit/<slug>`** (owner and co-authors). The header shows the guide title, `Latest version`, `People editing`, the guide total in `data-figure="total-cost"`, and the fork credit if any. The `Editor tools` toolbar sits below it and wraps as needed.
- 1280x800: stage pane and steps pane side by side with the `Resize stage and steps` separator. The stage pane holds the stage, `Stage status`, `Apart amount`, `Use this view`, the model scale fields and the Parts tools.
- 768x1024: the stage stacked above the steps, with no separator shown.
- 375x812: the `Editor panes` tablist with tabs `Stage`, `Steps` and `Parts`. The `Stage` pane holds the stage, `Stage status`, `Free look`, `Apart amount`, `Use this view` and the model scale fields. The `Steps` pane holds guide details and step rows. The `Parts` pane holds the part tree and part fields. One pane is visible at a time, and the others are hidden, out of the accessibility tree and out of the Tab order. `People editing` sits directly above the tablist.

**Dashboard `/dashboard`** (signed in; signed out goes to `/signin?next=/dashboard`). A stack of full-bleed shelves, each with a level 2 heading: `Questions`, `Drafts`, `Published`, `Forks`, `Collections`. Drafts holds the owner's non-fork guides in draft. Published holds published and withdrawn guides, with a withdrawn row saying `Withdrawn`. Forks holds the owner's forks. Each guide row is a big type row linking to the editor, never a card. An empty shelf carries one giant sentence (copy in Feedback states).

**Search `/search`.** The search box, tag combobox, the huge count, result rows and `Load more` run down one left edge on bone. The address holds `q` and repeated `tag` values.

**Collection `/c/<slug>`.** The title and a list of guide rows. For the owner, the rows can be reordered.

**Sign-in `/signin`, sign-up `/signup`, confirm `/confirm`, with `?token=<token>` when opened from the message.** Single-column forms of adjoining outlined cells.

**Embed `/embed/<slug>`.** The reader's stage, counter, step text, `Previous step`, `Next step`, `Open on Pennywasher`, the `Parts` list on a phone, and `Workshop sound` unless hidden. It uses the same three layouts as the reader, one step at a time, without the header and closing sections. Nothing else appears.

**Not-found and withdrawn pages.** A full-width maroon band with white text and a link home.

### Public screens and controls (DP-02, DP-03, DP-04, DP-06, DP-20, DP-29, DP-33, DP-36, DP-40, DP-41, DP-43, DP-47, DP-48, DP-55, DP-57, DP-63, DP-70, DP-73, DP-79, DP-84, DP-85, DP-88, DP-89, DP-92, DP-94)

Only these are public; everything else is free. A role plus a name below is the accessible role and accessible name.

| Where | Role and name | Notes |
|---|---|---|
| All pages | `link "Pennywasher"` | Goes home |
| Home | `heading` level 1 `TAKE IT APART.`, `link "Start a guide"`, `link "Read this guide"`, `link "Find a guide"` | `Start a guide` goes to the dashboard's start dialog |
| Stage | `application "Model stage"` | Focusable, wraps the WebGL canvas |
| Stage | `status "Stage status"` | One line under the stage |
| Stage | `img "<guide title>, step <n> still"` | Only when WebGL is unavailable |
| Stage, phone only | `switch "Free look"` | Off on every load |
| Reader bar | `button "Like"` with `aria-pressed`; `button "Fork guide"`; `button "Add to collection"`; `button "Ask the author"`; `button "Workshop sound"` with `aria-pressed`; `button "Previous step"`; `button "Next step"` | On a first or last step, `Previous step` or `Next step` is `aria-disabled` and stays focusable |
| Reader | `status "Step counter"`, `status "Reading progress"`, `status "Guide status"`, `status "Question alerts"`, `status "Like count"`, `status "Fork count"` | |
| Reader | `navigation "Steps"` with `link "Step <n>: <step title>"` | The visible text is the number |
| Reader | `list "Questions on this step"` | Question and answer text |
| Reader, phone | `list "Parts"` | Numbered focus parts of the current step |
| Reader, unconfirmed | `button "Resend confirmation"` | Appears beside the refusal |
| Dialog | `dialog "Ask the author"`: `textbox "Your question"`, `status "Ask status"`, `button "Send question"`, `button "Cancel"` | Shows `Asking about step <n>` |
| Dialog | `dialog "Fork guide"`: `button "Fork version <n>"`, `button "Cancel"` | |
| Dialog | `dialog "Add to collection"`: `combobox "Collection"`, `textbox "New collection title"`, `button "Add"`, `button "Cancel"` | |
| Editor | `status "Latest version"`, `status "Editor status"`, `status "Question alerts"`, `list "People editing"` | Item text and who is listed are in Feedback states |
| Editor | `toolbar "Editor tools"`: `button "Add step"`, `button "Undo"`, `button "Redo"`, `button "Save version"`, `button "Versions"` with `aria-expanded`, `button "Choose a model file"`, `button "Upload model"`, `button "Co-authors"`, `button "Publish"`, `button "Withdraw"`, `button "Delete guide"` | All are Tab stops at all times; a control not available now has `aria-disabled="true"` and stays focusable |
| Editor | `separator "Resize stage and steps"` | `aria-valuenow` is the stage width percent; desktop only |
| Editor, phone | `tablist "Editor panes"` with `tab "Stage"`, `tab "Steps"`, `tab "Parts"` | |
| Editor stage pane | `slider "Apart amount"`, `button "Use this view"`, `spinbutton "Model scale"`, `button "Confirm scale"` | Applies to the selected step; the bounding box in millimetres shows beside the scale |
| Editor guide details | `textbox "Guide title"`, `combobox "Currency"`, `textbox "Tags"`, `combobox "Visibility"` | Options `Public`, `Private` |
| Editor step row | `group "Step <n>"`: `textbox "Step <n> title"`, `textbox "Step <n> text"`, `combobox "Step <n> phase"`, `button "Delete step <n>"` | |
| Editor selected step | `group "Parts in this step"` with `checkbox "<part label>"`; `textbox "Callout for <part label>"` for each ticked part | `<part label>` is the part name alone when no other part in the guide has that name. When the name is shared, it is the part name, one space, then the full node path in round brackets, for example `Locknut (Locknut[1])`. This label is the whole accessible name of the checkbox, the callout textbox and the tree item |
| Editor parts | `tree "Model parts"` with `treeitem "<part label>"` | Up and Down move, Right opens, Left closes, Enter selects |
| Editor selected part | `textbox "Part name"`, `combobox "Apart axis"` (`X`, `Y`, `Z`), `spinbutton "Apart distance in millimetres"`, `spinbutton "Quantity"`, `textbox "Unit price"`, `combobox "Fitted at step"` (`Not fitted new` or `Step <n>`), `button "Remove part"`, `combobox "Bind to node"` | `Unit price` is typed in major units (`18.90`, or `1240` for yen); `Bind to node` is for unbound parts |
| Editor | `list "Unbound parts"` | Names of unbound parts |
| Versions | `region "Versions"`: `checkbox "Version <n>"`, `button "Compare"`, `button "Restore version <n>"`, `button "Load more versions"` | |
| Versions | `region "Version compare"` | Non-modal |
| Dialog | `dialog "Restore version <n>"`: `button "Restore"`, `button "Cancel"` | |
| Dialog | `alertdialog "Edit conflict"`: text blocks headed `Yours` and `Theirs`, `button "Keep mine"`, `button "Take theirs"` | |
| Dialog | `dialog "Co-authors"`: `textbox "Co-author email"`, `button "Add co-author"`, `button "Remove <name>"`, `button "Close"` | |
| Dialog | `dialog "Delete guide"`: `button "Delete"`, `button "Cancel"` | |
| Dashboard | `button "Start a guide"`; `dialog "Start a guide"`: `textbox "Title"`, `combobox "Currency"` (`EUR`, `GBP`, `USD`, `JPY`), `button "Create"`, `button "Cancel"` | |
| Dashboard | `status "Question alerts"`, `list "Questions"`, `button "Answer"` on each row, `button "Load more questions"`, `button "Sign out"` | |
| Dialog | `dialog "Answer question"`: `textbox "Your answer"`, `button "Send answer"`, `button "Cancel"` | |
| Search | `searchbox "Search guides"`, `combobox "Filter by tag"`, `button "Remove tag <tag>"`, `status "Search status"`, `button "Load more"` | The huge count is in `data-figure="result-count"` |
| Collection | `list "Guides in this collection"`, `status "Collection status"` | Each row is focusable for the owner |
| Forms | Fields labelled `Name`, `Email`, `Password`; `button "Sign in"`, `button "Sign up"`, `status "Account status"`, `link "Create an account"`, `button "Send a new link"` | |
| Embed | `link "Open on Pennywasher"` plus the stage, `Step counter`, `Previous step`, `Next step`, `Reading progress`, `Workshop sound` | |

**Stage hooks.** `Model stage` carries these attributes, updated on every drawn frame and after every input:

| Attribute | Format |
|---|---|
| `data-step` | Current step number from 1; `0` in the editor before any step exists |
| `data-explode` | Current apart amount, `0.000` to `1.000`, three decimals |
| `data-yaw`, `data-pitch` | Whole degrees; yaw wraps within -180 to 180 |
| `data-zoom` | Two decimals; `1.00` is the step's saved distance |
| `data-state` | `loading`, `ready`, `preview`, `error` or `still` |

**Figure hooks.** `data-figure` takes `parts-cost` (hidden from assistive technology, since the announcement carries the value), `total-cost`, `part-count`, `step-count`, `closing-total` and `result-count`.

**Callout hooks.** At desktop and tablet each visible callout carries `data-callout="<part label>"`, with `data-part-hidden="true"` when the part is hidden behind others and its tether shows a hollow end marker.

**Cost text.** Costs show the currency symbol, thousands separators and two decimals (`€1,234.50`), with yen shown without decimals (`¥1,240`). A difference has a sign (`+€2.10`, `-€0.50`, and `+€0.00` for none), using a hyphen-minus.

### Interactions (DP-02 to DP-06, DP-09 to DP-14, DP-16 to DP-20, DP-26 to DP-30, DP-33, DP-40, DP-42, DP-43, DP-55, DP-57, DP-63, DP-73, DP-79, DP-84, DP-85, DP-88, DP-94, DP-95)

**Page clock and timing.** The verifier pauses the page clock and blocks service workers. Every client timer, debounce, tween and count runs on page timers (timeouts, intervals, animation frames, `performance.now`), so advancing the page clock drives them. Nothing waits for a stylesheet animation's end event. There is no service worker. After each pointer, touch, scroll or keyboard action, the page shows its new state after the page clock advances 64 ms, unless the action states its own duration.

**Live changes.** Changes from other people (presence, edits, questions, answers, likes, fork counts, new versions) arrive over one same-origin live connection. They are applied to the DOM and announced inside its message handler, without waiting for a page timer or animation frame. They reach every open page on the same app instance within 2 seconds of real time (the published live delay). Only motion a live change starts runs on page time. A dropped connection tries again on the browser's `online` event and within 1 second of page time, then catches up on what it missed with nothing lost or repeated.

**Keyboard table.**

| Where | Key | Result |
|---|---|---|
| Focused stage | ArrowLeft / ArrowRight | `data-yaw` -15 / +15 |
| Focused stage | ArrowUp / ArrowDown | `data-pitch` +15 / -15, clamped to -60 and 60 |
| Focused stage | `+` / `-` | `data-zoom` times 1.25 / 0.8, clamped to 0.50 and 3.00 |
| Focused stage | Home | Yaw, pitch and zoom return to the current step's saved pose (`data-zoom="1.00"`) |
| Stage | Tab, Shift+Tab | Move into and out of the stage normally; it never traps focus |
| Editor, any focused control | Ctrl+S (Cmd+S on macOS) | Saves a version; never opens the browser's save dialog |
| Editor, any focused control | Ctrl+Z, Ctrl+Shift+Z (Cmd on macOS) | Undo and redo the signed-in person's own last edits in this guide, also while a toolbar button has focus |
| Editor, focus in a step row | Alt+ArrowUp, Alt+ArrowDown | Move that step one position; focus stays with the moved step; announced |
| `Resize stage and steps` | ArrowLeft, ArrowRight | Value -5, +5; range 30 to 70, start 50; panes resize at once |
| `Resize stage and steps` | Home, End | Value 30, 70 |
| `Editor panes` | ArrowLeft, ArrowRight | Previous, next tab, shown at once |
| Any dialog or sheet, the `Versions` region | Escape | Closes it and returns focus to the control that opened it |
| Any dialog | Tab, Shift+Tab | Wrap inside the dialog; the first control takes focus on opening |
| Collection row (owner) | Alt+ArrowUp, Alt+ArrowDown | Move the row one position; announced |
| `Filter by tag` | ArrowUp, ArrowDown, Enter, Backspace on empty | Move in options, add the tag (typed or highlighted), remove the last tag |

These shortcuts work whichever control in the region has focus. In text fields, Ctrl+Z is the app's undo and not the browser's.

**Editor toolbar Tab order.**

1. `Add step`
2. `Undo`
3. `Redo`
4. `Save version`
5. `Versions`
6. `Choose a model file`
7. `Upload model`
8. `Co-authors`
9. `Publish`
10. `Withdraw`
11. `Delete guide`

**Reader bar Tab order.**

1. `Pennywasher`
2. `Like`
3. `Fork guide`
4. `Add to collection`
5. `Ask the author`
6. `Workshop sound`
7. `Previous step`
8. `Next step`
9. `Model stage`, then `Free look` on a phone

**Scroll mapping.** H is the viewport height and y is the window's scroll position.
- While y is in `[n x H, (n + 1) x H)`, step n is current (`data-step="n"`). Below H, step 1 is current. From `(total + 1) x H` on (the closing section), the last step stays current.
- Within step n's section, `data-explode`, yaw and pitch move linearly from step n-1's values to step n's values as y goes from `n x H + 0.35 x H` to `n x H + 0.65 x H`, and hold outside that band. Step 1 holds its own values. Zoom is `1.00`. Scrolling back reverses every value exactly, because the pose depends only on y.
- The settled position of step n is `y = n x H + 0.65 x H`. `Previous step`, `Next step`, step links and `?step=<n>` jump the window straight to that position. A jump by button or link plays the step-change tween, and any user scroll during the tween ends it so the mapping takes over.
- Manual orbit lasts until the band is entered or the step changes, and then the mapping takes over again. Dragging the stage with a mouse orbits at 1 degree per 2 px, also under reduced motion. The wheel always scrolls the page and never zooms the stage.

**On each change of current step** (scroll, buttons, keys, deep link): `Step counter` and `Reading progress` update, the parts-cost figure counts, and the step panel swaps at once. Outgoing callouts fade between the section top and the band. When the pose reaches its end of the band, the focus parts swap and new callouts appear.

**Address.** `?step=<n>` opens step n settled with no tween. Scrolling replaces the address with the current `?step=<n>` and adds no history entry. `Previous step`, `Next step` and step links add a history entry, so Back returns to the previous step without a reload. Reload keeps the step.

**Sign-in return.** `Ask the author`, `Like`, `Fork guide` or `Add to collection` while signed out goes to `/signin?next=<encoded local path>`, and sign-in returns to that exact path and step. A `next` that is not a local path (an absolute URL, `//host`, `/\host`, a scheme) lands on `/dashboard`.

**Sign-up and confirmation.**
- A successful `Sign up` leaves the person signed in and takes them to `/confirm`, the waiting screen, with the waiting copy in `Account status` and `Send a new link`. If the SMTP server did not accept the message, the same screen shows the mail-failed copy instead of the waiting copy.
- `/confirm` with no token, opened later, shows `Send a new link` and no claim that a message was sent to a signed-in unconfirmed person, the confirmed copy to a signed-in confirmed person, and redirects a signed-out person to `/signin?next=/confirm`.
- Opening the link from the message needs no session. It confirms the account without starting or ending a session. The bad-token page also shows `Send a new link`.
- Pressing `Send a new link` while signed in calls the resend route. `Account status` then shows the waiting copy once the SMTP server accepted, the mail-failed copy, the resend-limited copy, or the confirmed copy if the account is already confirmed.
- Pressing `Send a new link` while signed out sends nothing and goes to `/signin?next=/confirm`, and after sign-in the person presses it there.

**Reduced motion.** Scrolling is replaced by the step buttons. Steps show one at a time, the scroll position never changes the step, and `Previous step` and `Next step` change it. Address, history and announcements behave as above.

**Phone touch.** The stage leaves vertical panning to the page until `Free look` is on. Then a one-finger drag orbits at 1 degree per 2 px, and a two-finger pinch multiplies `data-zoom` by the ratio of finger distances, within the clamps.

**Editor flow.**
- Focus in a step row selects that step, and the stage shows it (`data-step`).
- Text and number fields commit 250 ms after the last keystroke and on leaving the field. One commit is one undo entry. Sliders, checkboxes and selects commit on the same 250 ms delay after the last change.
- An undo pressed with text not yet committed commits it first and then undoes it. Undo history belongs to the open editor page and to its signed-in person, and ends when the page closes. Committing a new edit empties the redo stack.
- `Add step` adds the step at the end, puts focus in its title field and selects it.
- `Use this view` records the stage's yaw, pitch and zoom as the selected step's saved pose.
- In the part tree, a part fitted new shows its price and step.

**Same-field conflict.** An incoming change to a field you have no uncommitted text in is applied at once, even if the field has focus. If you have uncommitted text in that field, or your commit is refused as stale, `Edit conflict` opens, showing `Yours` and `Theirs`. `Keep mine` commits your value on top of theirs. `Take theirs` drops yours. Escape closes the dialog with your text still uncommitted in the field, and the next commit raises it again.

**Versions.** `Versions` toggles the non-modal `Versions` region. Space on a `Version <n>` checkbox picks it, and picking a third drops the earliest picked. `Compare` is `aria-disabled` until two are picked. The compare stays open until the author closes the region or compares again.

**Model files.** Dropping a file on the editor stage, or choosing one with `Choose a model file` (Enter or Space opens the file picker), runs the browser checks and then previews it. `Upload model` is `aria-disabled` until a valid preview exists. A preview lasts until upload, a new file or a reload.

**Search.** Typing runs the search 250 ms after the last keystroke and replaces the address, adding no history entry. Adding or removing a tag runs it at once.

**Sound.** `Workshop sound` appears on the reader and on the embed view unless `sound=off`. Before the first press no audio context is created, no source is started and no gain is connected. The first press creates the audio context, starts one looping generated buffer source (generated noise, no audio file) connected through one master gain node set to 0.25 to the output, and sets `aria-pressed="true"`. The next press sets that master gain to 0 and `aria-pressed="false"`, and a further press sets it back to 0.25. Every new page load starts with sound off. Reduced motion does not change sound. The verifier observes started sources, their loop flag, whether they pass through the master gain, and the master gain values.

### Visual design (DP-22, DP-23, DP-61, DP-90)

The direction is colour chapters, and the mood is loud, plain and handled. A whole viewport of post red sits behind one object, there is one grid and one left edge with no ornament on any field, and the model is the only thing with material colour, like the part in your hand.

**Type.** Dela Gothic One for display and DM Sans for everything else, both bundled. Each heading level is a quarter larger than the one below it, and body text is at least 16 px. Numerals, including step numbers and costs, use DM Sans tabular figures. Lucide supplies the icons. Density is comfortable.

**Colour roles.** The ground is warm bone. The surface is a slightly darker bone. Ink is a near-black brown. Muted text is a mid brown. The accent is slate blue with white on it. The field colours add post red, mustard and maroon. All text meets WCAG 2.2 AA contrast.

**Guide phases.** Every phase is a floor-to-ceiling flat field butted against the next with a hard edge and the same 12-column grid.

| Phase | Field | Text |
|---|---|---|
| Open up | Post red | White |
| Take out | Bone | Ink |
| Fit new | Mustard | Ink |
| Close up | Slate | White |
| Test it | Maroon | White |
| Closing total | Post red | White |

The field for a step fills the viewport exactly at that step's settled position, so a phase's new colour arrives just as its pose finishes. Neighbouring steps in one phase share one field with no edge. A fixed transparent 3D stage stays still while those edges pass behind it.

**The stage's rule.** Saturated fields could bury small details, so every non-focus part renders as a flat silhouette in the field's text colour, and only the step's focus parts keep their own materials, the way a service manual inks only the part being discussed. Silhouettes change ink per pixel exactly on a passing field edge.

**Hero.** Bone above and post red below meet at exactly half the height (46% on a phone). The headline in Dela Gothic One capitals reads `TAKE IT` on one line and `APART.` on the next, and the seam cuts through `APART.`, slate above the seam and ink below it, built from two clipped copies with the lower copy hidden from assistive technology. The Pennywasher wordmark sits top-left and a solid slate rectangle reading `Start a guide` sits top-right. The one supporting sentence in white on red reads `Upload the thing you fixed, and readers watch it come apart one step at a time.` There is no image, and the first guide stage comes straight after.

**Working screens.** The dashboard shelves are Questions on post red, Drafts on bone, Published on mustard, Forks on slate and Collections on maroon, each with a large display heading on the common left edge and its guides as big DM Sans type rows, never cards on a field. Search keeps results on bone with the count set huge. Forms are adjoining cells with a 2 px outline and sentence-case labels at 16 px. Corners are square everywhere with no exception. The version compare is two butted fields, older on the darker bone and newer on bone, marking changes with words and a thick side bar as well as colour. An empty shelf carries one giant sentence. Loading shows the flat field with step text already in place and the stage arriving afterwards. Errors are full-width maroon bands with white text. Controls are large enough to tap comfortably, at least 44 px. A keyboard focus ring is a thick outline in the field's text colour, always visible. Add no shadows, gradients, rounded corners, glass, hairline rules, monospace labels or index numbering.

### Motion and effects (DP-04, DP-17, DP-18, DP-19, DP-22, DP-34, DP-35, DP-36, DP-42, DP-43)

Motion starts quickly and settles softly. Everything named here runs on page timers.

| Motion | Meaning | Time |
|---|---|---|
| Step change by button, key or link | Camera and part offsets move to the new step | 320 ms |
| Editor edit of apart amount, parts or pose | The stage applies it: unchanged at 249 ms, changed at 250 ms after the last change, with no tween | 250 ms |
| Callouts | Fade in and out | 180 ms |
| `data-figure="parts-cost"` | Counts from previous to new, strictly between during the count, exact final text at 640 ms and after | 640 ms |
| `total-cost`, `part-count`, `step-count` in the reader header | Count up from zero when the header first renders, exact final text at 800 ms; on a `?step` address they show final text at once | 800 ms |
| Button hover and press | Fill swaps to the opposite colours at once | Immediate |

**Signature: Apart at the Step.** The reader learns which part to touch, where it sits inside the whole object, how it comes out and what the repair has cost so far, without leaving the step. Each step has a saved pose, focus parts, an apart amount and up to 6 callouts. A part's offset at a step is its apart distance in millimetres along its axis, times the step's apart amount, times the model scale. Moving from one step to the next in order:
1. The counter, announcement and cost figure change on entering the section.
2. Outgoing callouts fade.
3. Between 35% and 65% of the section's scroll, the camera and offsets move in step with the scroll, and scrolling back gives the same pose at the same place.
4. Focus parts swap from silhouette to their own materials with an opposing outline, so focus does not rely on colour alone.
5. Callouts tethered to each focus part's projected anchor appear, flipping sides to stay inside the viewport, with a hollow end marker when the part is hidden.

Everything reverses step by step going back. When a phase changes, the hard colour edge crosses the stage and silhouettes change ink exactly on that edge.

**The 3D stage.** The stage draws real meshes through WebGL with three.js. The verifier watches WebGL draw calls, vertex buffer bytes and camera matrix values, so what shows must be drawn this way. It shows the guide's model on a transparent canvas. It never moves on its own: no idle spin. Only scroll, step changes and input move it. A drag orbits it, also with reduced motion. There are no unnamed decorative loops anywhere.

**Reduced motion.** The pose snaps, with no running animations on the stage or figures and the camera matrices final on the next drawn frame. Callouts appear at once, and the figures show final text at once. Manual orbit, keys, the step list, the parts list and spoken totals work unchanged.

**Without WebGL.** `data-state="still"`. The stage shows the named image, a still drawn by the server for that step at its saved pose and apart amount. The step text stays beside it, and `Stage status` shows the still-fallback copy.

### Feedback states (DP-05, DP-07, DP-09, DP-11, DP-13, DP-16, DP-28, DP-36, DP-47 to DP-52, DP-56, DP-58, DP-64, DP-67, DP-73 to DP-75, DP-77, DP-80 to DP-82, DP-84, DP-87, DP-88, DP-96)

Every region below is a distinct polite live region with the role `status` and the given name. Placeholders: `<cost>` is cost text in the guide's currency; `<limit>` and `<size>` have thousands separators in copy; `<file>` is the file's name; `<seconds>` is the whole seconds from the server's `Retry-After`. Copy renders character for character with straight apostrophes.

**`Stage status`**

| State | Copy |
|---|---|
| Loading | `Loading the model.` |
| Ready | `Model ready.` |
| Guide with no model | `No model yet. Drop a .glb on the stage or use Choose a model file.` |
| Previewing | `Previewing <file>. It is not uploaded.` |
| Uploading | `Uploading <file>: <percent>%.` |
| Stored | `<file> is stored. <size> bytes confirmed.` |
| Refused: not glTF 2.0 binary | `<file> is not a glTF 2.0 binary file.` |
| Refused: over byte limit | `This file is over the limit of <limit> bytes.` |
| Refused: over part limit | `<file> has <count> parts. The limit is <limit> parts.` |
| Refused: outside files | `<file> refers to outside files, so it cannot be used.` |
| Storage out, reader | `Storage unreachable. The steps and parts below still work.` |
| Storage out, author | `Storage unreachable. Uploading and publishing wait until it returns; your text still saves.` |
| Still fallback | `3D view is not available here. Showing a still of this step.` |

**Upload progress.** From the press of `Upload model` until the server replies, `Stage status` holds the uploading copy and is never empty. It shows `Uploading <file>: 0%.` at once on the press, before any byte is sent, then rises as the browser reports bytes sent. `<percent>` is a whole number, bytes sent over the file size rounded down, at most 100 and never falling. It keeps its last value until the server's reply replaces it with the stored, refusal or outage copy. There is no minimum display time, so this state lasts exactly as long as the server takes to reply.

During a storage outage, `Stage status` shows as a full-width maroon band and the stage stays empty with `data-state="error"`. The page retries the model every 5 seconds of page time and recovers with no reload.

**`Reading progress`:** `Step <n> of <total>: <step title>. Parts so far: <cost>.`

**`Step counter`:** `<nn> / <total>` with two-digit numbers, for example `02 / 05`.

**`Latest version`:** `Latest version <n>`, or `No saved versions` before the first.

**`Editor status`.** An outcome clears after 5 seconds of page time, a newer message restarts that timer, and an older timer never clears a newer message. Commits that succeed announce nothing.

| Event | Copy |
|---|---|
| Saving | `Saving version.` |
| Saved | `Saved as version <n>.` |
| Stale save | `Version <current> was saved elsewhere. Nothing was overwritten.` |
| Step added, deleted | `Step <n> added.`, `Step <n> deleted.` |
| Step moved | `Step <from> moved to position <to>.` |
| Step at an end | `Step <n> is already first.`, `Step <n> is already last.` |
| Undo, redo | `Undid: <label>.`, `Redid: <label>.` |
| Empty stacks | `Nothing to undo.`, `Nothing to redo.` |
| Undo blocked | `Cannot undo: <name> has changed this since.` |
| Total changed | `Guide total <cost>.` |
| Restored | `Restored version <old> as version <new>.` |
| Conflict settled | `Kept your text in <field label>.`, `Took the text from <name> in <field label>.` |
| Text over limit | `<field label> can be at most <limit> characters.` |
| Count over limit | `A guide can have at most <limit> steps.`, `Step <n> can have at most <limit> callouts.`, `A guide can have at most <limit> tags.` |
| Commit failed | `Your last change was not saved. Try again.` |
| Publishing | `Publishing.` |
| Published, withdrawn | `Published version <n>.`, `Withdrawn.` |
| Publish refused | `Save a version before publishing.`, `Upload a model before publishing.`, `Storage unreachable. Publishing waits until it returns.`, `These parts need a node or removal before publishing: <names>.`, `Confirm the model scale before publishing.` |

`<label>` is one of: `Edit guide title`, `Edit step <n> title`, `Edit step <n> text`, `Change step <n> phase`, `Change step <n> apart amount`, `Change step <n> parts`, `Change step <n> view`, `Edit callout on step <n>`, `Add step <n>`, `Delete step <n>`, `Move step <from> to <to>`, `Edit part <part name>`. `<field label>` is the control's accessible name.

**`Edit conflict` dialog text:** `<name> changed <field label> while you were editing it.`

**`Question alerts`** (author's dashboard and editor; reader's page)

- To the author: `New question on <guide title>, step <n>.`
- To the asker: `<author name> answered your question on step <n>.`

**`Ask status`** (inside the dialog; a refusal keeps the dialog open with the text in place)

- `Sending your question.`
- `Write a question first.`
- `Your question can be at most <limit> characters.`
- `Too many questions. Try again in <seconds> seconds.`

**`Guide status`**

| Event | Copy |
|---|---|
| Question sent | `Question sent.` |
| Unconfirmed account | `Confirm your email before you can do that. Check your inbox or send the message again.` |
| Resend accepted by the SMTP server | `We sent a new confirmation message to <email>.` |
| Resend limited | `Too many messages. Try again in <seconds> seconds.` |
| Like | `Liked.`, `Like removed.` |
| Forking | `Forking.` |
| Failure | `That did not work. Try again.` |

**`Search status`**

- `Searching.`
- `<n> guides found.`
- `1 guide found.`
- `No guides found.`
- `Search terms can be at most <limit> characters.`
- `Search can use at most <limit> tags.`
- `That search took too long. Try fewer words.`

**`Collection status`**

- `<guide title> moved to position <n>.`
- `<guide title> is already first.`
- `<guide title> is already last.`
- `Added to <collection title>.`

**`Account status`**

| Event | Copy |
|---|---|
| Waiting screen, after the SMTP server accepted | `Check <email>. We sent a confirmation link.` |
| Mail failed | `We could not send the message. Try again.` |
| Resend limited | The same copy as resend limited in `Guide status` |
| Email taken | `That email already has an account.` |
| Bad sign-in | `That email and password do not match.` |
| Sign-in limited | `Too many sign-in attempts. Try again in <seconds> seconds.` |
| Confirmed | `Your email is confirmed.` |
| Bad token | `This confirmation link has expired or was replaced. Send a new one.` |

**Live counts:** `Like count` shows `<n> likes` or `1 like`; `Fork count` shows `<n> forks` or `1 fork`.

**`People editing` items.** Each list item's text is exactly `<name>, step <n>`, where `<name>` is the person's account name and `<n>` is the number of the step they have selected. An editor opens with step 1 selected. In a guide with no steps, the item text is `<name>, no step`. The list has one item per other person and never lists the viewer, even when the viewer has the guide open in another tab. With nobody else present, the list stays in place and has no items.

**Fixed page text**

| Where | Copy |
|---|---|
| Not-found page, with HTTP 404 | `We could not find that page.` |
| Withdrawn reader and embed page | `This guide was withdrawn.` |
| Step past the end | `This guide has <total> steps. Showing step <total>.` |
| Fork credit | `Forked from <title> by <author name>, version <n>.` The title is a link to the source while it is readable, plain text afterwards |
| Empty `Questions` | `No questions waiting.` |
| Empty `Drafts` | `Nothing on the bench yet.` |
| Empty `Published` | `Nothing out in the world yet.` |
| Empty `Forks` | `No forks yet. Find a guide worth adapting.` |
| Empty `Collections` | `No collections yet.` |

**Compare rows.** Each row carries a label word, then `Step <n>: <title>` in the newer version's numbering, or `Was step <n>: <title>` for a removed step. Changed text shows `Removed: <words>` and `Added: <words>` as separate lines. A part row reads `<part name>: <field> <from> to <to>`, with prices as cost text. The difference reads `Parts cost difference <signed cost>`.

## Backend

### API (DP-05, DP-07, DP-11, DP-14, DP-31, DP-49 to DP-51, DP-58, DP-64, DP-68, DP-72, DP-74, DP-75, DP-77, DP-78, DP-82, DP-87, DP-89, DP-93, DP-96)

All bodies are JSON (`application/json`) except model uploads, with a body limit of 1,000,000 bytes (exactly that is accepted). A larger body answers `413 {"error":"body_too_large","limit":1000000}`. JSON nested deeper than 32 levels answers `422 {"error":"too_deep"}`. Every error body has the shape `{"error":"<code>", ...}`.

**Route checks come first:** an unknown path answers `404 {"error":"not_found"}` (a page path gets the not-found page with status 404), a wrong method answers 405 with an `Allow` header and `{"error":"method_not_allowed"}`, and a wrong content type answers `415 {"error":"unsupported_media_type"}`.

**Routes open without a session.** `GET /api/health`, `GET /api/limits`, `GET /api/search`, `GET /api/tags`, `POST /api/accounts`, `POST /api/session`, `POST /api/account/confirm`, the grading route, `GET /samples/<name>.glb`, and these reads for anyone who can see the record: `GET /api/guides/<id>`, `GET /api/guides/<id>/versions`, `GET /api/guides/<id>/versions/<n>`, `GET /api/guides/<id>/versions/compare`, `GET /api/guides/<id>/questions`, `GET /api/guides/<id>/stills/<n>`, `GET /api/models/<modelId>.glb` and `GET /api/collections/<id>`. Every other API route needs a session.

**Error precedence, for the whole API.** First, 404 when the path names a guide that is unknown or that the caller may not see, so a signed-out call to any route on a private or draft guide, including its POST routes, answers 404 and never 401. Then 401 when the route needs a session and the caller is not signed in (`{"error":"not_signed_in"}`). Then 404 for any other unknown record or one the caller may not see. Then 410 for a withdrawn guide to anyone but its owner and co-authors (`{"error":"withdrawn"}`). Then 403 for a visible record the caller may not change (`{"error":"forbidden"}`), or when the account is unconfirmed (`{"error":"unconfirmed"}`). Then 409 for a state or version conflict. Then 413 or 422 for limits and validation. Then 429 for rate limits, except sign-in, which checks its limit first. Then 503 when a dependency is out. Only valid questions count toward the question limit.

**Length refusal:** `422 {"error":"too_long","field":"<field>","limit":<limit>}`. **Count refusal:** `422 {"error":"too_many","field":"<field>","limit":<limit>}`. **Other validation:** `422 {"error":"invalid","field":"<field>"}`. **Rate limit:** `429 {"error":"rate_limited","retry_after":<seconds>}` with `Retry-After: <seconds>`.

**Accounts and sessions**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/accounts` | `{"name","email","password"}` | `201 {"user":<user>,"message_sent":true}` after the SMTP server accepted, sets the session cookie | `409 {"error":"email_taken"}`; `503 {"error":"mail_unavailable"}` (account kept, session cookie set) |
| `POST /api/session` | `{"email","password"}` | `200 {"user":<user>}`, sets an HttpOnly session cookie | `401 {"error":"bad_credentials"}`; 429 |
| `GET /api/session` | | `200 {"user":<user>}` | 401 |
| `DELETE /api/session` | | `204` | |
| `POST /api/account/resend` | `{}` | `200 {"sent":true}` after the SMTP server accepted | `409 {"error":"already_confirmed"}`; 429; 503 as above |
| `POST /api/account/confirm` | `{"token"}` | `200 {"confirmed":true}` | `410 {"error":"token_invalid"}` for an unknown, voided, used or expired token |

`<user>` is `{"id","name","email","confirmed"}`. Passwords hold 8 to 200 characters, names 1 to 80 code points. Emails compare in lower case.

**Guides and working copy**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/limits` | | `200` with every limit in `snake_case` (for example `{"model_max_bytes":20000000,"model_max_parts":64,"step_text_max":2000,...}`) | |
| `POST /api/guides` | `{"title","currency"}` | `201 {"id","slug"}` | Limits |
| `GET /api/guides/<id>` | | `200` guide reading JSON, below | |
| `DELETE /api/guides/<id>` | | `204` | Owner only |
| `GET /api/guides/<id>/working` | | `200` working JSON, below | Owner and co-authors only |
| `PATCH /api/guides/<id>/working` | `{"field":"<field path>","value":<value>,"based_on":<field revision>}` | `200 {"revision":<n>,"field_revision":<n>,"guide_total":<minor>,"guide_total_text":"<cost>"}` | `409 {"error":"edit_conflict","field":"<field path>","yours":<value>,"theirs":{"value":<value>,"revision":<n>,"by":"<name>"}}` |
| `POST /api/guides/<id>/steps` | `{"title":"<text>"}` | `201 {"id","number","revision"}`, added at the end | Limit |
| `DELETE /api/guides/<id>/steps/<stepId>` | | `200 {"revision"}` | |
| `POST /api/guides/<id>/steps/<stepId>/move` | `{"position":<n>}` | `200 {"revision","order":["<stepId>",...]}` | `422 {"error":"invalid","field":"position"}` |
| `DELETE /api/guides/<id>/parts/<partId>` | | `200 {"revision"}` | |
| `POST /api/guides/<id>/coauthors` | `{"email"}` | `201 {"id","name"}` | Owner only; 404 for an unknown email |
| `DELETE /api/guides/<id>/coauthors/<userId>` | | `204` | Owner only |
| `POST /api/guides/<id>/publish` | `{"version":<n>}` or `{}` for the latest | `200 {"state":"published","published_version":<n>}` | Owner only; see Business rules |
| `POST /api/guides/<id>/withdraw` | `{}` | `200 {"state":"withdrawn"}` | Owner only; see Business rules |
| `PUT /api/guides/<id>/like` | `{}` | `200 {"liked":true,"like_count":<n>}` | Replays answer the same |
| `DELETE /api/guides/<id>/like` | | `200 {"liked":false,"like_count":<n>}` | Replays answer the same |

**Field paths:** `title`, `currency`, `tags`, `visibility`, `model_scale`, `model_scale_confirmed`, `step/<stepId>/title`, `step/<stepId>/text`, `step/<stepId>/phase`, `step/<stepId>/explode`, `step/<stepId>/focus_parts`, `step/<stepId>/camera`, `step/<stepId>/callouts`, `part/<partId>/name`, `part/<partId>/axis`, `part/<partId>/apart_mm`, `part/<partId>/quantity`, `part/<partId>/unit_price`, `part/<partId>/fitted_at`, `part/<partId>/node_path`.

**Field revisions.** `field_revisions` lists every field path that exists in the working copy. Each starts at 0, and a path that appears when a step or part is added or brought back starts at 0. Every change to a field, by commit or by restore, adds 1, so the first commit on an untouched field sends `"based_on":0`. In a refusal from the commit route, `field` is the field path.

**Field values.** A value of the wrong shape or out of range answers the other-validation 422. Numeric ranges not given here are in Business rules.

| Field path | Value |
|---|---|
| `title`, `step/<stepId>/title`, `step/<stepId>/text`, `part/<partId>/name` | String |
| `currency` | `"EUR"`, `"GBP"`, `"USD"` or `"JPY"` |
| `tags` | Array of strings |
| `visibility` | `"public"` or `"private"` |
| `model_scale` | Number above 0 |
| `model_scale_confirmed` | Boolean |
| `step/<stepId>/phase` | One of the `phase` values listed under `<step>` |
| `step/<stepId>/explode` | Number from 0 to 1 |
| `step/<stepId>/focus_parts` | Array of part ids |
| `step/<stepId>/camera` | `{"yaw":<whole degrees, -180 to 180>,"pitch":<whole degrees, -60 to 60>,"zoom":<0.50 to 3.00>}` |
| `step/<stepId>/callouts` | Array of `{"part_id":"<partId>","text":"<text>"}` |
| `part/<partId>/axis` | `"x"`, `"y"` or `"z"` |
| `part/<partId>/apart_mm` | Number, negative for the opposite direction |
| `part/<partId>/quantity` | Integer |
| `part/<partId>/unit_price` | Integer in minor units |
| `part/<partId>/fitted_at` | Step id or null |
| `part/<partId>/node_path` | String, a node path in the guide's current model |

**Working JSON:** `{"id","slug","title","state","visibility","currency","tags","revision","latest_version":<n or null>,"guide_total","guide_total_text","field_revisions":{"<field path>":<n>},"model":<model or null>,"parts":[<part>],"steps":[<step>],"forked_from":<null or fork object>}`.

**Guide reading JSON:** `{"id","slug","title","author":{"id","name"},"state","visibility","currency","tags","published_version","like_count","fork_count","model_id","total_cost","total_cost_text","part_count","step_count","parts":[<part>],"steps":[<step with parts_cost, parts_cost_text>],"forked_from":<null or fork object>}`. It holds the published version. For an owner or co-author of a guide with no published version, it holds the latest saved version.

- `<step>`: `{"id","number","title","text","phase","explode","focus_parts":["<partId>"],"camera":{"yaw","pitch","zoom"},"callouts":[{"part_id","text"}]}`; `phase` is `open_up`, `take_out`, `fit_new`, `close_up` or `test_it`.
- `<part>`: `{"id","name","node_path","unbound":<bool>,"axis":"x|y|z","apart_mm","quantity","unit_price":<minor>,"fitted_at":"<stepId or null>"}`.
- `<model>`: `{"id","state":"stored","bytes","sha256","bbox_mm":[x,y,z],"scale","scale_confirmed"}`.

**Models and stills**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/guides/<id>/model` | Raw bytes, `Content-Type: model/gltf-binary` or `application/octet-stream`, optional URL-encoded `X-File-Name` | `201 {"model":<model>,"parts":[<part>],"unbound":["<part name>"]}` | `413 {"error":"model_too_large","limit":<limit>}`; `422 {"error":"not_glb"}`; `422 {"error":"too_many_parts","count":<n>,"limit":<limit>}`; `422 {"error":"external_uri"}`; `503 {"error":"storage_unavailable"}` |
| `GET /api/models/<modelId>.glb` | | `200` bytes as `model/gltf-binary` | `503 {"error":"storage_unavailable"}` |
| `GET /samples/<name>.glb` | | `200` bytes as `model/gltf-binary` | |
| `GET /api/guides/<id>/stills/<n>` | | `200` an image of step n | |

A model is readable by anyone who can see a guide or fork that references it. Otherwise it answers 404.

**Versions and forks**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/guides/<id>/versions` | `{"base_version":<n or null>}` | `201 {"number":<n>}` | `409 {"error":"version_conflict","current":<n>,"fields":["<field path>"]}` |
| `GET /api/guides/<id>/versions?cursor=&limit=` | | `200 {"items":[{"number","saved_at","saved_by":"<name>","restored_from":<n or null>,"step_count","parts_cost","parts_cost_text"}],"next_cursor":<string or null>}`, newest first | |
| `GET /api/guides/<id>/versions/<n>` | | `200 {"number","steps":[<step>],"parts":[<part>],"model_id","parts_cost","parts_cost_text"}` | |
| `POST /api/guides/<id>/versions/<n>/restore` | `{}` | `201 {"number":<new>,"restored_from":<old>}` | |
| `GET /api/guides/<id>/versions/compare?older=<a>&newer=<b>` | | `200` compare JSON, below | |
| `POST /api/guides/<id>/forks` | `{}` | `201 {"id","slug","forked_from":{"guide_id","title","author_name","version"}}` | |

`fields` in a version conflict names the field paths that differ between the base version and the current one. **Compare JSON:**

```json
{"older": 1, "newer": 3,
 "added":   [{"position": 5, "title": "..."}],
 "removed": [{"position": 1, "title": "..."}],
 "changed": [{"position": 4, "title": "...", "fields": ["text"]}],
 "moved":   [{"title": "...", "from": 3, "to": 2}],
 "part_changes": [{"part": "...", "field": "unit_price", "from": 1640, "to": 1890}],
 "cost_difference": 490, "cost_difference_text": "+€4.90"}
```

Positions come from the version each belongs to. `from` is the position in the older version and `to` the position in the newer. `field` in part changes is `name`, `quantity`, `unit_price` or `fitted_at`, and `fitted_at` values are step titles or null. A step present in both is matched by its step id. It is `moved` if its order among the steps present in both versions differs, and `changed` if its title, text, phase, apart amount, focus parts, pose or callouts differ. It can be in both lists; the compare row then says `Changed`. **Diff rows:** steps run in the newer version's order, each labelled exactly `Added`, `Changed` or `Moved`, then removed steps in the older version's order labelled `Removed`. Changed text is compared word by word, split on white space.

**Search, collections, questions**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/search?q=&tag=&tag=&cursor=&limit=` | | `200 {"items":[{"id","slug","title","author_name","tags","like_count","step_count","parts_cost_text"}],"total":<n>,"next_cursor":<string or null>}` | `422 {"error":"query_too_long","limit":<limit>}`; `422 {"error":"too_many_tags","limit":<limit>}`; `503 {"error":"search_timeout"}` |
| `GET /api/tags?prefix=` | | `200 {"items":["<tag>"]}`, 20 at most | |
| `POST /api/collections` | `{"title","visibility"}` | `201 {"id","slug","title"}` | |
| `GET /api/collections/<id>` | | `200 {"id","slug","title","visibility","owner_name","items":[{"guide_id","title","slug","position"}]}` | |
| `POST /api/collections/<id>/items` | `{"guide_id"}` | `201 {"position":<n>}` | `409 {"error":"already_in_collection"}` |
| `POST /api/collections/<id>/items/<guideId>/move` | `{"position":<n>}` | `200 {"order":["<guideId>",...]}` | |
| `GET /api/guides/<id>/questions?cursor=&limit=` | | `200 {"items":[<question>],"next_cursor":<string or null>}`, newest first | |
| `POST /api/guides/<id>/questions` | `{"step":<n>,"text"}` | `201 <question>` | `422 {"error":"invalid","field":"step"}`; 429 |
| `POST /api/questions/<id>/answer` | `{"text"}` | `201 <question>` | Owner and co-authors only; `409 {"error":"already_answered"}` |

`<question>`: `{"id","guide_id","step","text","asked_by":"<name>","asked_at","answer":<null or {"text","answered_by","answered_at"}>}`. `GET /api/dashboard` answers `200 {"drafts":[...],"published":[...],"forks":[...],"collections":[...],"questions":[<question>],"questions_next_cursor"}` for the signed-in person, with first-page lists of `{"id","slug","title","state"}`.

**List pages.** `limit` defaults to 24 and any value above 100 acts as 100. Cursors are opaque.

**Other routes.** `GET /api/health` is printed in Services. Page routes are those in Screens and layout.

#### Grading route

`POST /api/grading/world` exists only when `GRADING_ROUTES=on`. With any other value or unset, it answers 404 like any unknown path. Body `{}`. It answers `201` within 2 seconds with one fresh, isolated world each call, with unique emails such as `author-<random>@example.test`. Its contents are in Seed data. Each world stores its own copies of the sample models in MinIO. On an instance whose storage is unreachable, it answers `503 {"error":"storage_unavailable"}`, so `storage-down` uses worlds made on the primary.

```json
{"author":   {"id": "...", "name": "...", "email": "...", "password": "..."},
 "coauthor": {"id": "...", "name": "...", "email": "...", "password": "..."},
 "reader":   {"id": "...", "name": "...", "email": "...", "password": "..."},
 "newcomer": {"id": "...", "name": "...", "email": "...", "password": "..."},
 "guides": {"public":    {"id": "...", "slug": "...", "title": "..."},
            "private":   {"id": "...", "slug": "...", "title": "..."},
            "withdrawn": {"id": "...", "slug": "...", "title": "..."},
            "draft":     {"id": "...", "slug": "...", "title": "..."}},
 "collection": {"id": "...", "slug": "...", "title": "..."},
 "question":   {"id": "...", "guide_id": "...", "step": 2}}
```

### Business rules (DP-07, DP-11, DP-12, DP-14, DP-31, DP-49, DP-50, DP-58, DP-66, DP-68, DP-74, DP-75, DP-77, DP-78, DP-81, DP-82, DP-86, DP-87, DP-89, DP-96)

**Account states.** Unconfirmed to confirmed, once and only through the token in the delivered message. An unconfirmed account can sign in and read, but cannot upload, save, edit, like, fork, collect or ask (the 403 `unconfirmed` answer). A token stops working `CONFIRM_TOKEN_TTL_SECONDS` after it was sent, on the server clock, as soon as it is used, and as soon as a newer message voids it. The token never appears in a page or API response except the address the person opened from the message. The waiting screen and resend copy show only after the SMTP server accepted the message.

**Model states.** Checked in browser, uploading, stored, refused. Checked in browser and uploading exist only in the page. A row counts as stored only after MinIO confirms the object's byte length and SHA-256. A refused or failed upload leaves no row and no object. No guide can publish with a model that is not stored.

**Upload rules.** Accepted: binary glTF 2.0 only: magic `glTF`, container version 2, a declared length equal to the file size, a JSON chunk first, at most one BIN chunk after it, and no buffer or image with a `uri`. The file's name and extension play no part. A part is a node with a mesh. `MODEL_MAX_BYTES` and `MODEL_MAX_PARTS` are limits where exactly that value is accepted.

Checks run in this order and the first failure decides: byte limit, container and chunk checks (with JSON that does not parse, or is nested deeper than 64 levels, counting as `not_glb`), outside files, part limit. The same checks run in the browser on drop, before anything renders, using `GET /api/limits` as read when the page loaded, and again on the server on upload, where the server decides. Checking one file ends within 5 seconds. The file name is shown only as text and never forms any part of a storage key.

**Parts and binding.** Parts bind to a node path, not a name, since node names are not guaranteed unique. A node path joins the segments from the root node down with `/`, each segment being `<node name>[<k>]`, where k counts from 0 among siblings with the same name. An unnamed node uses the name `node`. Duplicate names stay distinct parts. The hierarchy is a strict tree, so moving a parent carries its children once, and an offset along a model-space axis is converted through the parent's transform.

**Scale.** glTF lengths are metres, but real files arrive at the wrong scale. The author sees the bounding box in millimetres and confirms or corrects a model scale. The correction applies to offsets and camera distance alike. A new or replacement model starts with its scale unconfirmed.

**Replacing a model** keeps every part. Parts whose node path no longer exists become unbound and are listed by name, nodes with no part become new parts, and the guide cannot publish until each unbound part is rebound or removed.

**Costs.** Integer minor units in one guide currency from EUR, GBP, USD and JPY (one yen is one minor unit). A part counts only if it is fitted new, and only once, at its fitted step. The running cost at step n is the sum of quantity times unit price for parts fitted at or before n, computed by the server, and the guide total is the running cost at the last step. The editor, reader, embed view and version compare all show that figure. Quantity is 1 to 999, and unit price is 0 to 99,999,999 minor units. Deleting a step makes parts fitted there not fitted.

**Plain text.** Step titles, step text, callouts, part names, guide titles, tags, question text and answer text are stored and shown exactly as typed, with line breaks kept. There is no formatting, HTML or markdown: `<b>x</b>`, `**x**` and `[a](b)` render as those literal characters, and no markup is ever interpreted.

**Published limits**, each counted in Unicode code points where it counts text (an emoji such as a single smiley counts as 1), with exactly the limit accepted and defaults in Configuration: guide title, step title, step text, callout, part name, question, answer, tag length, tags per guide, steps per guide, callouts per step.

**Editing and merging.** A guide has one shared working copy, and every commit is one field change with the field's revision it was based on. A commit on a field with the same revision succeeds, and edits to different fields never conflict. A stale `based_on` on the same field answers the `edit_conflict` 409, and the stored value stays. Keep mine re-sends with the newer revision. Of two simultaneous commits on one field, the first to reach the database wins and the other gets the 409. Step moves and step adds merge with text edits, and positions are decided by the order they reach the database.

**Undo.** Undo re-sends the field's earlier value as a normal commit, so it reaches other people like any edit. It covers only the signed-in person's own entries in this open page. If someone else has changed that field since, the field keeps their value, the entry is dropped and the undo-blocked copy shows. Undoing a move moves the step back, undoing an add deletes the step, and undoing a delete brings the step back with its id.

**Versions and restore.** Saving a version stores steps, parts, bindings, phases and the model reference as written. It carries the base version, and a base other than the latest answers the `version_conflict` 409 and writes nothing. Live updates move an open editor's base forward. Restore appends a new version equal to the chosen one, makes the working copy equal to it, and never rewrites history. Restoring does not change what is published. Owner and co-authors can save and restore.

**Guide states.** Draft, published, withdrawn. Every published guide is tied to a saved version.

| From | Action | Result |
|---|---|---|
| Draft | Publish | Published |
| Published | Publish | Published, moved to the named or latest version; `409 {"error":"illegal_transition","from":"published","to":"published"}` if that version is already the one published |
| Withdrawn | Publish | Published |
| Published | Withdraw | Withdrawn |
| Draft | Withdraw | `409 {"error":"illegal_transition","from":"draft","to":"withdrawn"}` |
| Withdrawn | Withdraw | `409 {"error":"illegal_transition","from":"withdrawn","to":"withdrawn"}` |

**Publish checks** run in this order after the state check:

1. No saved version: `422 {"error":"no_version"}`.
2. No stored model in that version: `422 {"error":"model_not_stored"}`.
3. Storage unreachable, or MinIO not confirming the object's length: `503 {"error":"storage_unavailable"}`.
4. Unbound parts: `422 {"error":"unbound_parts","parts":["<name>"]}`.
5. Scale unconfirmed: `422 {"error":"scale_unconfirmed"}`.

**Visibility.** Public or private, applied at once and separate from state. A private guide answers 404 everywhere for everyone but its owner and co-authors: reader page, embed view, API, versions, forks, model file and search. A draft guide is the same. The embed view also answers its not-found page to the owner of a private or draft guide. A withdrawn guide answers status 410 with the withdrawn page at the reader and embed routes, for everyone. A guide with no saved version has no reader page and answers 404 there. Only the owner can change visibility, publish, withdraw, delete or manage co-authors (403 for a co-author).

**Forks.** A fork records the source guide and the source's published version, pinned at that moment, along with the source title and author name as written then. It belongs to the forker, starts as a public draft titled `<source title> (fork)` with a copy of the pinned version as its own version 1, and has its own history. Withdrawing or deleting the source leaves the fork and its model working, and the fork still credits the source by name. Only a public published guide can be forked. An object stays in MinIO while any version or fork references it. `fork_count` is derived from fork rows.

**Likes.** Each account can like a guide once. `like_count` is derived from like rows.

**Questions.** Questions need a confirmed account, are about one step of the published version, and can be answered once, by the owner or a co-author. They are public on the reader page.

**Rate limits** use server-side rolling windows, and each refusal states when to try again:
- Failed sign-ins are counted per pair of email and client address: `SIGNIN_LIMIT` per `SIGNIN_WINDOW_SECONDS`. Only failures count.
- Resends are counted per account: `RESEND_LIMIT` per `RESEND_WINDOW_SECONDS`.
- Questions are counted per account: `QUESTION_LIMIT` per `QUESTION_WINDOW_SECONDS`.

**Search.** A query holds at most 200 characters and at most 8 tags, and exactly those are accepted. Over-limit input answers before any database work. Database time is bounded at 2 seconds. Every word in the query must match the start of a word in the published version's guide title, step titles, step text, part names or tags. Characters with special meaning in patterns are matched literally. Tags must all match. Tags compare in lower case. Only public published guides appear, newest published first, with an empty query listing them all. Pages hold 24 guides, and `Load more` continues from a cursor that never repeats or skips a guide while new guides are published.

**Collections.** A collection is public or private and owned by one person. Only public published guides can be added, or the owner's own guides. A guide that stops being visible to the viewer is left out of the list without disturbing the order. A private collection answers 404 to others.

**Embed.** It reads the latest published version, ignores the viewer's session, sets no cookie and shows no account name. A step past the end behaves as on the reader.

### Services (DP-49, DP-51, DP-52, DP-78)

**Postgres** holds accounts, guides, steps, parts, bindings, versions, forks with their pinned source version, collections, tags, likes and questions, and serves word and tag search. Apply the schema and seed idempotently on every serve, and let two instances starting at once on one database both come up.

**MinIO** holds every uploaded .glb at key `models/<modelId>.glb`, byte-identical to the file. The bucket stays private, bytes reach readers only through `GET /api/models/<modelId>.glb`, and bucket listings are never offered.

**Mailpit** receives the confirmation message by SMTP. To: the account's email. From: the `MAIL_FROM` value, `Pennywasher Works <no-reply@pennywasher.example>`. Subject: `Confirm your Pennywasher account`. The body carries one link, `<public origin>/confirm?token=<token>`, where the public origin is `APP_PUBLIC_URL`. Opening the link confirms the account and shows the confirmed or bad-token copy. World creation sends no mail, so `newcomer` starts with an empty inbox and asks for the message by `Resend confirmation`. If the SMTP server refuses or is unreachable, the mail failure answer and copy apply.

**Health and storage outage.** `GET /api/health` always answers HTTP 200: `{"status":"ok"}` when Postgres and MinIO answer, and `{"status":"unavailable"}` when either does not, within 3 seconds. It never answers 503. With storage unreachable:
- uploads and model fetches answer the 503 from API
- the stage goes to the outage state in Feedback states
- the reader keeps step text, parts and costs in place
- saving text and versions still works
- previews by drop still work
- publishing is refused
- everything recovers with no restart

**Instances.** The primary uses all defaults. `storage-down` points `S3_ENDPOINT` at a closed port and shares the primary's database, so a world made on the primary is visible there. `short-limits` has its own database and bucket with short limits (`MODEL_MAX_BYTES` 400000, `MODEL_MAX_PARTS` 12, `QUESTION_LIMIT` 2, `QUESTION_WINDOW_SECONDS` 30, `CONFIRM_TOKEN_TTL_SECONDS` 5). The verifier sets `GRADING_ROUTES=on` on every instance.

### Seed data (DP-15 to DP-19, DP-26, DP-28, DP-37, DP-41, DP-56, DP-92)

Every seeded person, business and guide is invented. Lists below are exact.

**Sample models.** `/samples/coffee-grinder.glb`, `/samples/bike-hub.glb` and `/samples/game-controller.glb` are valid binary glTF 2.0, generated by the app's build from simple solids. Each is under 200,000 bytes, so all samples pass on every instance. Each node with a mesh is one part, and part names are the node names.

| Sample | Parts as node paths |
|---|---|
| coffee-grinder (9) | `Housing[0]`, `Housing[0]/Hopper[0]`, `Housing[0]/Bean chute[0]`, `Housing[0]/Upper burr[0]`, `Housing[0]/Motor[0]`, `Housing[0]/Drive shaft[0]`, `Housing[0]/Drive shaft[0]/Lower burr[0]`, `Base plate[0]`, `Grounds tray[0]` |
| bike-hub (9) | `Hub shell[0]`, `Axle[0]`, `Left cone[0]`, `Right cone[0]`, `Left bearing[0]`, `Right bearing[0]`, `Freehub body[0]`, `Locknut[0]`, `Locknut[1]` |
| game-controller (10) | `Front shell[0]`, `Back shell[0]`, `Main board[0]`, `Left stick[0]`, `Right stick[0]`, `Left stick module[0]`, `Right stick module[0]`, `Button pad[0]`, `Battery[0]`, `Trigger spring[0]` |

**Coffee grinder guide, version 3** (currency EUR, tags `coffee`, `grinder`, `burrs`, scale 1 confirmed). Saved zoom is 1.00, and each focus part has one callout whose text is the part's name.

| Step | Title | Phase | Apart | Focus parts | Yaw, pitch | Running cost | Text |
|---|---|---|---|---|---|---|---|
| 1 | `Lift off the hopper` | Open up | 0.000 | Hopper | 30, 15 | €0.00 | `Unplug the grinder, then turn the hopper a quarter turn and lift it straight up.` |
| 2 | `Free the upper burr` | Take out | 0.250 | Upper burr | 45, 20 | €0.00 | `Undo the two clips and lift the upper burr out by its handle.` |
| 3 | `Draw out the lower burr` | Take out | 0.500 | Lower burr, Drive shaft | 60, 10 | €0.00 | `Pull the lower burr straight up off the drive shaft without twisting it.` |
| 4 | `Fit the new burr set` | Fit new | 0.850 | Upper burr, Lower burr | 60, 25 | €18.90 | `Seat the new burrs and turn them a quarter turn until they click.` |
| 5 | `Refit the chute and close up` | Close up | 0.000 | Bean chute | 30, 15 | €21.30 | `Press the new chute home, then refit the hopper and run a few beans through.` |

Fitted new: `Lower burr`, quantity 1 at €18.90, at step 4; `Bean chute`, quantity 1 at €2.40, at step 5. The header figures are total `€21.30`, parts `9`, steps `5`. Apart distances along Y in millimetres: Hopper 120, Upper burr 80, Bean chute 60, Lower burr 50, Drive shaft 30, Base plate -40, Grounds tray -70, Housing 0, Motor 0.

**Earlier versions of the same guide.** All were saved by its author, and `Bean chute` has unit price €2.40 in each.

| Version | Steps in order | Fitted new | Total |
|---|---|---|---|
| 1 | `Unplug and empty the grinder`, `Lift off the hopper`, `Draw out the lower burr`, `Free the upper burr`, `Fit the new burr set` | Lower burr at €16.40 | €16.40 |
| 2 | `Lift off the hopper`, `Draw out the lower burr`, `Free the upper burr`, `Fit the new burr set`, `Refit the chute and close up` | Lower burr at €16.40, Bean chute | €18.80 |
| 3 | The table above | Lower burr at €18.90, Bean chute | €21.30 |

In versions 1 and 2, `Fit the new burr set` has the text `Seat the new burrs and turn them a quarter turn by hand.` The step `Unplug and empty the grinder` has the text `Unplug the grinder and tip out any beans.`, with phase Open up, apart 0.000, focus Hopper. Other steps match version 3.

For example, with this seed: comparing version 1 to 3 gives Added `Refit the chute and close up`; Removed `Unplug and empty the grinder`; Moved `Free the upper burr` and `Draw out the lower burr`; Changed `Fit the new burr set` with `Removed: by hand.` and `Added: until they click.`; part changes `Lower burr` unit price 1640 to 1890 and `Bean chute` fitted_at null to `Refit the chute and close up`; difference `+€4.90`. Comparing 2 to 3 gives moved `Draw out the lower burr` from 2 to 3 and `Free the upper burr` from 3 to 2, difference `+€2.50`. Comparing 1 to 2 gives difference `+€2.40`.

**Bike hub steps** (currency GBP, tags `bike`, `hub`, `bearings`, scale 1 confirmed, one saved version; each focus part has one callout with its name).

| Step | Title | Phase | Apart | Focus parts | Yaw, pitch | Running cost | Text |
|---|---|---|---|---|---|---|---|
| 1 | `Undo the locknuts` | Open up | 0.000 | Locknut[0], Locknut[1] | 20, 10 | £0.00 | `Hold one cone with a thin spanner and turn each locknut off.` |
| 2 | `Slide out the axle` | Take out | 0.400 | Axle | 40, 15 | £0.00 | `Pull the axle out from the freehub side and catch the cones.` |
| 3 | `Fit new bearings` | Fit new | 0.700 | Left bearing, Right bearing | 60, 20 | £6.40 | `Press a new bearing into each side of the shell until it sits flat.` |
| 4 | `Set the cones` | Close up | 0.200 | Left cone, Right cone | 40, 10 | £6.40 | `Thread the cones back on until the axle turns with no play.` |
| 5 | `Spin the wheel` | Test it | 0.000 | Hub shell | 20, 10 | £6.40 | `Spin the wheel and listen for grinding before you ride.` |

Fitted new: `Left bearing` and `Right bearing`, quantity 1 at £3.20 each, at step 3. Apart distances along X in millimetres: Locknut[0] -90, Locknut[1] 90, Left cone -60, Right cone 60, Left bearing -35, Right bearing 35, Axle 120, Freehub body 50, Hub shell 0.

**Game controller steps** (currency JPY, tags `controller`, `games`, `sticks`, scale 1 confirmed, one saved version; each focus part has one callout with its name).

| Step | Title | Phase | Apart | Focus parts | Yaw, pitch | Running cost | Text |
|---|---|---|---|---|---|---|---|
| 1 | `Open the shell` | Open up | 0.300 | Back shell | 25, 20 | ¥0 | `Undo the back screws and ease the clips apart with a plastic tool.` |
| 2 | `Fit the new stick module` | Fit new | 0.800 | Left stick module | 50, 30 | ¥1,240 | `Lift the board, swap the left stick module and press its connector home.` |

Fitted new: `Left stick module`, quantity 1 at ¥1,240, at step 2. Apart distances along Z in millimetres: Back shell -60, Battery -35, Main board -15, Left stick module 15, Right stick module 15, Left stick 40, Right stick 40, Button pad 25, Trigger spring -25, Front shell 0.

**Present at start on every instance.** One confirmed account, Odile Brandt, `odile@pennywasher.example`, password `workshop-bench-41`, owning three public published guides with the data above: `Coffee grinder: fit new burrs` (slug `coffee-grinder-fit-new-burrs`, versions 1 to 3, version 3 published), `Bike hub: regrease the bearings` (slug `bike-hub-regrease-the-bearings`), and `Game controller: replace a stick` (slug `game-controller-replace-a-stick`). The home page uses the coffee grinder guide. If storage is unreachable at start, the seed's objects are stored once it answers.

**Each grading world.** Every user is confirmed except `newcomer`, each with a unique invented name ending in the random suffix, and with `like_count` and `fork_count` 0 on every guide.

| Key | Contents |
|---|---|
| `guides.public` | Owner `author`, co-author `coauthor`; `Coffee grinder: fit new burrs <suffix>`; public, published version 3; the coffee grinder data with all three versions; own copy of `coffee-grinder.glb` |
| `guides.private` | Owner `author`; `Bike hub: private notes <suffix>`; private, published version 1; the bike hub data; own copy of `bike-hub.glb` |
| `guides.draft` | Owner `author`, co-author `coauthor`; `Bike hub: regrease the bearings <suffix>`; public, draft with saved version 1; the bike hub data; own copy of `bike-hub.glb` |
| `guides.withdrawn` | Owner `author`; `Game controller: replace a stick <suffix>`; public, withdrawn with saved version 1 published earlier; the game controller data; own copy of `game-controller.glb` |
| `collection` | Owner `author`; `Kitchen fixes <suffix>`; public; holds `public` |
| `question` | From `reader` on `public`, step 2, text `Which way does the upper burr turn?`, unanswered |

`<suffix>` is six random lowercase letters and digits, so two worlds never collide in search.

## Technical requirements

### Deployment (DP-24)

Build in TypeScript on the Node.js and npm available in the image. `/app/run.json` is the run manifest, holding string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

The server binds `0.0.0.0` on port 4173 and honours `APP_PUBLIC_PORT` when it is set. `GET /api/health` is the health path, as printed in Services. The build generates the sample models.

### Configuration and secrets (DP-53)

Read each of these at start. Never hard-code a credential or send one to the browser.

**From the services:** `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`. **From the platform:** `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`.

| Variable | Default | Meaning |
|---|---|---|
| `GRADING_ROUTES` | unset | `on` enables the grading route |
| `MODEL_MAX_BYTES` | 20000000 | Bytes per model file |
| `MODEL_MAX_PARTS` | 64 | Parts per model |
| `QUESTION_LIMIT`, `QUESTION_WINDOW_SECONDS` | 10, 3600 | Questions per account |
| `SIGNIN_LIMIT`, `SIGNIN_WINDOW_SECONDS` | 5, 900 | Failed sign-ins per email and address |
| `RESEND_LIMIT`, `RESEND_WINDOW_SECONDS` | 3, 3600 | Resends per account |
| `CONFIRM_TOKEN_TTL_SECONDS` | 86400 | Confirmation token life |
| `PRESENCE_GRACE_SECONDS` | 2 | Presence after a connection ends |
| `GUIDE_TITLE_MAX`, `STEP_TITLE_MAX` | 120, 120 | Code points |
| `STEP_TEXT_MAX` | 2000 | Code points |
| `CALLOUT_TEXT_MAX`, `PART_NAME_MAX` | 60, 80 | Code points |
| `QUESTION_TEXT_MAX`, `ANSWER_TEXT_MAX` | 1000, 1000 | Code points |
| `TAG_TEXT_MAX`, `GUIDE_TAG_MAX` | 32, 8 | Code points per tag, tags per guide |
| `GUIDE_STEP_MAX`, `STEP_CALLOUT_MAX` | 60, 6 | Steps per guide, callouts per step |
| `SEARCH_QUERY_MAX`, `SEARCH_TAG_MAX` | 200, 8 | Characters, tags |
| `SEARCH_DB_TIMEOUT_MS` | 2000 | Database time per search |
| `PAGE_SIZE_DEFAULT`, `PAGE_SIZE_MAX` | 24, 100 | List pages |

The browser timings in Motion and effects are fixed, not configured.

### Server boundary (DP-31, DP-93)

Everything is same-origin. The browser never talks to Postgres, MinIO or Mailpit. The server answers only the published routes: bucket listings, other people's private model objects, debug and test routes, source files, source maps of server code, environment files and credentials all answer the not-found answer. The grading route exists only under its setting.

**Framing headers.** Responses on `/embed/` routes, including their not-found and withdrawn pages, carry `Content-Security-Policy: frame-ancestors *` and no `X-Frame-Options`. Every other page carries `Content-Security-Policy: frame-ancestors 'self'`. Embed responses and their assets set no cookie.

**Boot.** The app comes up and answers health when MinIO is unreachable, and it waits and retries for Postgres before listening. It never exits because a dependency is out.

### Browser support and performance (DP-21, DP-45)

Current Chromium, Firefox and Safari at the three published viewports, with WebGL handled as published. A reader page shows step text at once and the stage is usable within three seconds on the seeded models. Live delays are in Interactions.

## Working rules

- **IF-01** `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- **IF-02** `THIRD_PARTY_NOTICES.md` at the repository root lists every shipped package and bundled font with its licence; shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`, or the lockfile's non-dev group).
- **IF-03** Shipped packages and bundled fonts use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1 licences; shipped packages means the production dependency tree as in IF-02.
- **IF-04** Postgres and MinIO are the only datastores, with no other database, queue or cache service and no state in server files.
- **IF-05** The app makes no third-party request in the browser or on the server beyond the listed services: no CDN, remote font, remote image, remote model or analytics.
- **IF-06** No service worker is registered anywhere in the source.
- **IF-07** A lockfile is committed and the seeded dev service configuration stays unchanged.

## Engineering standards

- The code is idiomatic strict TypeScript with no `any` outside third-party typings gaps, and names match the domain terms in this brief (guide, step, part, node path, apart amount, version, fork).
- Each domain rule, such as the running parts cost, a guide state transition or the .glb container checks, is decided in exactly one place in the source, even though the browser and the server both run the .glb checks.
- No abstraction has a single implementation, and there are no wrappers that only forward a call.
- There is no dead, commented-out or unreachable code and no defensive check for an impossible state.
- Every API error goes through one consistent error shape and one error precedence.
- All page text in Feedback states comes from one place, so the same copy cannot drift between pages.
- Page-time motion is driven by page timers from one frame loop rather than by separate ad hoc timers per element.
- There are no features, routes or settings beyond this brief.
