# Fennbright Works Gatecut

Gatecut is a browser editor for a freelance video editor who cuts for agency teams. The editor owns the workspace. They upload rushes, cut on a multi-row timeline, name cuts, share review links with the client and export cut manifests. An agency colleague can cut alongside them, an agency producer pins notes and approves, and the client reviews from a link on a phone or laptop. Gatecut works only on exact frame data and never decodes pictures. Every clip, caption, keyframe and note pin sits on a whole frame, and the stage draws each layer as a coloured box at its computed position. The app stores its data in Postgres and its files and manifests in MinIO object storage. It keeps allowance counters, waveform peaks and read-token request counts in Valkey, runs export jobs through a RabbitMQ queue and sends mail through SMTP, which Mailpit captures. Out of scope: self-service sign-up, payments and billing, video decoding or playback of real pictures, rendering real video files, any datastore or service beyond those five, and any third-party sign-in.

## Problem and users

Freelance editors who cut for agencies spread one job across three or four tools. The desktop editor runs on one machine, the review site sits in another tab, and a file-transfer service and an email thread carry everything in between. Producers and client marketing leads send notes like "at 0:42", typed from a player that rounds to seconds, while the cut runs at 23.976 or 25 frames per second. So the editor rebuilds each note's position by hand, round after round. A late note on cut three lands on a clip that has moved since. Nobody can say which cut a delivered file came from. Two editors on one job overwrite each other's trims. The same 4 GB rushes file gets uploaded again because nobody can tell it is already stored. A monthly allowance of export minutes and storage runs out without warning. Gatecut puts all of this in one browser editor that the freelancer owns. Everything sits on whole frames, and everyone sees the same frame within a second.

- **Owner**: the freelance editor. Owns the workspace and the monthly export-minute and storage allowance. Uploads rushes, cuts, names cuts, shares review links, starts exports, manages members, issues read tokens to the agency's tools and edits their availability line. Uses Gatecut daily.
- **Editor**: an agency in-house editor invited onto one project. Cuts, trims, groups and edits captions alongside the owner without losing work. Uses Gatecut daily.
- **Commenter**: an agency producer. Pins notes to frames or clips, mentions people, replies and approves a cut. Uses Gatecut weekly.
- **Client**: the client's marketing lead. Opens a review link on a phone or laptop, scrubs the cut, comments and approves. Never sees team-only notes or unshared cuts, and has no account. Uses Gatecut occasionally.

## Journeys

1. **Bring the rushes in.** The owner, signed in on the project list, opens Library and uploads two MP4 rushes and a WAV music bed. A progress line appears for each file. The owner reloads mid-upload. The Uploads list still shows that file at its received percent, and choosing the same file again resumes the upload from the first missing chunk. One MP4 is already stored, so it is reported as already in the library and is not uploaded or counted again. A truncated MP4 is refused with its reason. At the end the library sheet shows the new files as checksum-coloured boxes and a white waveform strip, and the storage figure in the band has risen by exactly the new bytes.
2. **Cut together.** The owner and the editor Idris open Harbour Light 30s in two browsers. Idris tabs into the timeline and works only from the keyboard. He nudges a clip three frames right, splits it at the playhead, hides a title, groups two clips and ripple-removes a shot. The owner sees each change and Idris's name within a second, announced once in the hidden activity region. Both trim the same clip in the same second. The first save wins, and the other person sees the clip settle with the winner's name, while their other pending changes still save.
3. **Caption the cut.** Idris opens Captions, imports an SRT file into the Captions row, fixes a typo in one cue inline (a counter shows the characters left on the cue's longest line), saves the cue, and downloads the row as SRT. An untouched imported file comes back byte for byte. An oversized or malformed file is refused by name and leaves the row unchanged.
4. **Skim and shape a title.** The owner moves the pointer over the timeline. The Frame Loupe appears above the pointer with nine frame cells, the centre cell shows its timecode, and the stage switches to that frame. Near a clip edge the loupe snaps and a white guide line appears. The owner adds two opacity diamonds with an eased curve. The stage box, the inspector and the loupe all show the same value at each frame. Pressing L pins the loupe, the arrows step it, Enter moves the playhead there, and Escape returns focus to the clip.
5. **Client review on a phone.** The owner names "Cut 3" and shares it on the existing review link. The client, Ada, opens the link on a 375 px phone. She sees a stacked clip list with a scrubber, scrubs to a shot, types her name and a comment, and taps Approve this cut. Her comment appears in the owner's Comments panel within a second. The owner revokes the link, and Ada's open page switches to the revoked message at once.
6. **Producer notes and mail.** Maren, the producer, opens the project on a laptop, pins a team-only note to a clip and mentions @noor and @idris. Her half-written reply survives a reload because the server keeps the draft. Within the mail window each mentioned person gets one grouped mail for the project. A late client note on Cut 1, pinned to a clip that has moved since, shows on the live timeline at that clip's current position.
7. **Export and allowance.** The owner exports Cut 3 at 1080p. The band's export-minute figure rises at once on every open screen. Progress shows in the Exports table on every open screen and survives a reload, and the activity region announces the result. The owner downloads the manifest through an expiring link and gets an export-finished mail. Exporting the same cut at the same size again returns the same manifest. After a later edit, the export is marked stale and names its cut.
8. **Shape the title.** The owner selects the "Harbour Light" title layer on the stage and drags it. Near the middle it locks to the frame centre and a white guide line shows. They drag a corner handle to make it larger, and the Inspector follows. One change is saved on release. Then they change the project frame to "9:16" from Frame size: every layer keeps its place in the new frame by the fit rule, and Undo puts every position back exactly. Idris, watching in another browser, sees both changes announced once.
9. **Find the frame again.** Idris zooms the timeline in twice to read a two-frame gap. The frame under the playhead stays in the middle of the canvas. He presses End: the playhead reaches the last frame, the canvas scrolls so that frame is the last one visible, and focus lands on the last clip. He opens the Inspector, reloads the page, and the same frame, zoom level, selected clip and panel come back from the address. Back returns him to the zoom level he had before.
10. **Go back to Cut 1.** The owner compares Cut 2 with Cut 1, decides Cut 1 was right and restores it. The timeline becomes Cut 1 in one saved change, Idris's open screen follows within a second and announces it once, and the client's review link still shows what it showed before. The owner undoes the restore and the timeline returns exactly. With the Music row locked, a restore that would move the music is refused whole and nothing changes.
11. **Agency dashboard.** On Profile the owner issues a read token named "Kestrel dashboard" and copies it once. The agency's script pages through projects, clips and exports with stable cursors while Idris keeps adding clips, with nothing skipped or repeated. It never sees team-only notes or unshared cuts. When the script loops too fast it is told how long to wait, and the editors' own work is unaffected.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** `/app/run.json` installs, builds and serves the app on port 4173 (or `APP_PUBLIC_PORT`), and `GET /api/health` answers 200 with `{"status":"ok"}` even when MinIO, RabbitMQ or SMTP is unreachable.
- **DP-02 — Services wired from the environment** Every service URL and credential is read from the environment at start, the app really stores in Postgres, MinIO, Valkey and RabbitMQ and sends through SMTP, and none of it reaches the browser.
- **DP-03 — Published routes and one error shape** Only the routes in the API section answer; others get 404, a wrong method 405 with `Allow`, a wrong body type 415 and an oversized body 413, all in the one error shape and precedence order of the API section.
- **DP-04 — Whole-frame time and timecode** Every stored time is a whole frame, every conversion from seconds, MP4 header durations or SRT milliseconds follows the published rounding rule, and every timecode shown or returned uses the published form.
- **DP-05 — Older projects upgraded to frames** The two seeded projects stored in seconds are upgraded to frames once at start by the published rounding rule, stay readable during the upgrade, and are not changed again by a restart.
- **DP-06 — Sign-in and sign-out** Seeded people sign in with email and password, and signing out ends the session and closes every open socket of that session at once.
- **DP-07 — Create a project and bring in the team** The owner creates a project from the New project dialog, adds an editor and a commenter by email, and each of them finds it on their project list with their role.
- **DP-08 — Roles decide every action** Each endpoint allows only the roles in the role table, a non-member gets 404 for the project, and a forbidden action changes nothing. A commenter opens the project with every editing control absent.
- **DP-09 — Role changes reach open screens** Changing or removing a member's role switches that person's open project screen within one second, closes its socket and sends it no later data.
- **DP-10 — Upload rushes in resumable chunks** The owner uploads files in chunks from the library; after a reload the open upload stays listed and choosing the same file again resumes from the first missing chunk, and the file appears in the library only after storage confirms it.
- **DP-11 — Files judged by their header** The server reads MP4 box structure, WAV header and PNG header to decide the type and dimensions, and refuses a damaged, unknown or unsafely named file with the published reason.
- **DP-12 — One object per checksum** A file whose checksum is already stored is never stored or counted twice, and a WAV's waveform peaks are computed once per checksum and dropped when the file is replaced.
- **DP-13 — Storage outage holds uploads** While MinIO is unreachable, uploads and exports answer 503 with the published copy, the outage banner shows, and no file is half-listed.
- **DP-14 — Bounded library search** Library search obeys the published term and length caps, refuses a longer query by name and answers within one second. The library sheet shows its published two columns at 375 px with no sideways page scroll.
- **DP-15 — Files in use stay** Deleting a file used by any project is refused with the list of projects that use it, and an unused file is deleted with its stored object.
- **DP-16 — Cut a sequence from the keyboard** An editor nudges, splits, hides, removes, groups, reorders rows and moves the playhead entirely from the keyboard on the timeline, and every change is saved. Every clip block's left edge and width read back as its own frames on the canvas scale at every zoom level.
- **DP-17 — Clips never overlap** A move stops at the nearest free frame and says why, a move onto another row needs the target free, and a move that cannot go one frame is refused.
- **DP-18 — Ripple edits respect locked rows** A ripple remove or trim shifts every later clip, caption and pin on the row by the exact frame count, and a change that would move a locked item is refused whole. A refused ripple leaves every clip, caption and pin frame unchanged on a second open screen.
- **DP-19 — Groups move as one** Moving or trimming a grouped clip moves or trims every member across rows, and if one member cannot go the whole change is refused. The group outline spans every member's rows, and a refused move keeps focus on the member that was the current clip.
- **DP-20 — Per-person undo and redo** Undo and redo reverse only the caller's own changes, recomputed against the current timeline, and an undo that would overlap is refused with the reason.
- **DP-21 — Dialogs keep and return focus** Every dialog keeps Tab and Shift+Tab inside itself, closes on Escape and returns focus to the exact control that opened it.
- **DP-22 — Keyframe curves agree everywhere** Values between diamonds follow the published linear or eased curve to two decimals, and the frame endpoint, the stage, the inspector and the Frame Loupe show the same number at every frame. A diamond set by another person reaches every open screen within one second, where the stage and the Inspector agree at that frame.
- **DP-23 — Frame Loupe skims without editing** Entering the timeline canvas shows the Frame Loupe with nine frame cells within 120 milliseconds and puts the stage in skim view, while the playhead, the address, other playheads and the saved timeline stay unchanged.
- **DP-24 — Loupe snapping and keyboard pinning** The loupe centre snaps within the published distance with a white guide line, and L, the arrow keys, Enter and Escape drive it from the keyboard.
- **DP-25 — Playback follows the page clock** During playback the playhead advances with the page clock at the project's frame rate, loops a set range, and never changes the document.
- **DP-26 — Brand kits apply once** Applying a brand kit copies its colours and weight into every text layer in one saved change, and later kit edits never change a project.
- **DP-27 — Caption a cut from an SRT file** An editor imports an SRT file into a caption row, edits a cue inline and downloads the row again as SRT.
- **DP-28 — SRT files held to published caps** An SRT import over the byte, cue, line or line-length caps, or malformed, is refused by name within two seconds and changes nothing.
- **DP-29 — Typed captions held to the same limits** Typed cue text meets the same per-line and line-count limits in the browser and on the server, counted in code points.
- **DP-30 — SRT round trip byte for byte** A canonical SRT file imported and downloaded with no edits comes back byte for byte, and edited cues are written by the published rounding rule.
- **DP-31 — Two editors on one timeline** Owner and editor cut the same project in two browsers and each sees the other's changes, playhead and name within one second.
- **DP-32 — First save wins** When two people change the same clip from the same version, the first save in server order wins, the other gets 412 with the winner's name, and their other changes still save.
- **DP-33 — One socket per page with replay** Each project page holds one WebSocket, sends nothing before it opens, and after a drop replays missed changes with none applied twice and focus kept on the same clip.
- **DP-34 — Remote changes announced once in order** The hidden Project activity region announces each remote change, export result and allowance change once, in server order, with the published copy.
- **DP-35 — Pin notes and approve a cut** A commenter pins notes to frames or clips, mentions people, replies and approves a cut, and the notes show on the timeline at their frames.
- **DP-36 — Note limits and mentions** Note bodies and mention counts meet the published code-point limits in the browser and on the server, and unknown mentions are refused.
- **DP-37 — Drafts kept on the server** A half-written note is kept on the server per person and project and comes back after a reload or on another device.
- **DP-38 — Grouped mention mail and visible outbox** Mentions and replies send one grouped mail per person per project per window, and while SMTP is unreachable mail waits in the visible outbox and is never sent twice.
- **DP-39 — Project page at three widths** A project opened at 375, 768 and 1280 px wide shows the review list, the two-pane review and the full editor respectively.
- **DP-40 — Client review on a phone** The client opens a review link on a phone, scrubs the cut, comments and approves without seeing team-only notes or unshared cuts.
- **DP-41 — Review link lifecycle** A review link only reads, comments and approves, expires on the server clock, and on revoke or regenerate ends its open sessions within one second.
- **DP-42 — Review ETag follows the shared cut** The review response carries an ETag that answers 304 while unchanged and changes the moment a different cut is shared on the link.
- **DP-43 — Phone review layout** At 375 px the review shows a stacked clip list with a scrubber, 44 px targets, a comment box never covered by the fixed bar, and no loupe motion under reduced motion.
- **DP-44 — Name and compare cuts** The owner names a cut, opens it read-only and compares two cuts as lists of added, removed and changed clips by frame.
- **DP-45 — Late notes follow moved clips** A note pinned to a clip in an older cut shows on the live timeline at that clip's current position.
- **DP-46 — Export a cut** The owner exports a named cut at a published size, follows its progress on every open screen and after reload, and downloads the manifest.
- **DP-47 — Export states and cancel** An export moves queued, running, then done, cancelled or failed, cancel stops a running job, a done export turns stale after a later edit, and the requester gets an export-finished mail.
- **DP-48 — One manifest per cut and size** A repeated request or a second delivery of the same job yields one manifest, counted once, in the published form with frame totals and checksum.
- **DP-49 — Queue outage refuses exports cleanly** While RabbitMQ is unreachable an export request answers 503 with the published copy, nothing is queued and no minutes are taken.
- **DP-50 — Allowance from the shared counter** Every screen shows the month's export minutes and storage from the shared counter and updates within one second of a change, and minutes reset at the UTC month boundary.
- **DP-51 — Allowance never passed in parallel** Parallel exports or uploads never take the allowance past its limit, and a refused request answers 409 with the amount used.
- **DP-52 — Issue and revoke read tokens** The owner issues a named read token shown once, the agency reads with it, and a revoked token stops working at once.
- **DP-53 — Read tokens see only the published surface** A read token reaches only the read endpoints and fields published for it, with no team-only notes, unshared cuts, write verbs or other routes.
- **DP-54 — Stable capped paging** Read-token lists page with opaque cursors at no more than 100 items, and nothing is skipped or repeated while clips are added or removed. Every open Profile screen shows that token's request count for the current window, rising within one second of each call.
- **DP-55 — Per-token rate limit** Each read token gets 30 requests per 10-second window, then 429 with the published copy and `Retry-After`, without slowing anyone's session.
- **DP-56 — Contact-sheet project list** The project list is the text band over a sheet of procedural frames in the dark-suite contact-sheet direction, with the hover index preview.
- **DP-57 — Editor and working screens** The editor, library, profile and review screens carry the same band, sheet, one type size and gold-only-for-the-main-action language.
- **DP-58 — Project list at three widths** The project list shows the published columns and run layout at 375, 768 and 1280 px without sideways page overflow, with loading frames at their final sizes.
- **DP-59 — Reduced motion** Under reduced motion every effect jumps to its end state with no scale, fade or easing, while the Frame Loupe, snapping and keyboard pinning work the same.
- **DP-60 — Readable** Every control meets WCAG 2.2 AA contrast, is at least 44 by 44 px on touch layouts, and shows a visible focus ring.
- **DP-61 — Trims, speed and splits stay exact** A trim stops at the source's own edge or the neighbouring clip and says why, a speed change sets the length by the published rounding rule, and a split gives both parts exact source offsets with re-based keyframes. After a split focus stays on the left part, and every other open screen announces it once.
- **DP-62 — Zoom holds the playhead frame, Home and End bring a clip into view** Changing zoom keeps the playhead frame centred on the canvas at the published scale, and Home and End move the playhead, scroll the canvas and focus the first or last clip.
- **DP-63 — Restore a cut** Restoring a named cut replaces the timeline in one saved change that raises the version, every open screen follows within one second, it can be undone, and a locked row refuses the whole restore.
- **DP-64 — The address carries the view** The project address holds the playhead frame, the zoom level, the selected clip and the open panel, and those four survive a reload, Back and a second tab.
- **DP-65 — Shape a layer on the stage** A layer box is moved and scaled by pointer or keyboard on the stage, snaps to the frame centre and edges with a guide, saves one change on release, and is refused on a locked row.
- **DP-66 — Changing the frame refits every layer** Changing a project's aspect ratio converts every layer position and position keyframe by the published fit rule in one saved change, and undo restores every value exactly.

## Frontend

### Screens and layout (DP-07, DP-39, DP-43, DP-56, DP-57, DP-58)

Pages are served at these addresses. Anyone signed out who opens a page other than the sign-in page or a review page is sent to `/sign-in`.

- `/sign-in`: the band with "Gatecut" and, in the sheet position, the sign-in form.
- `/` **Project list**: the text band, then the sheet of project runs (see Visual design for the hero).
  - **1280x800**: a seven-column grid. Project runs flow left to right in seed order, packed into rows of seven frame columns, so a run of three and a run of four share a row. Every frame is the same width. Each frame keeps its project's aspect ratio, and the height of a sheet row is set by its tallest frame.
  - **768x1024**: four frame columns, one project run per row.
  - **375x812**: two frame columns. Each run scrolls sideways inside itself, the page itself never scrolls sideways, and the "New project" link is fixed to the bottom-right corner.
  - The band reflows at the two narrower widths: brand and allowance first, then the availability line, then open projects, then agencies. At 375 px Profile and Sign out stay in the band's top line.
- `/library` **Media library**: the band, a search box and the Upload files control, then a contact sheet of files grouped by folder. The folder title sits above each run, and "Used in <project titles>" sits beneath it as plain text (or "Not used yet"). MP4 files are flat boxes at their header aspect ratio, filled with their checksum colour. WAV files are white waveform strips, all exactly 96 px tall. PNG files are boxes at their natural ratio in their checksum colour. The sheet has seven columns at 1280, four at 768 and two at 375. The uploads list sits under the band.
- `/projects/<project id>` **Project page**. The root `main` element carries `data-layout`, whose value depends only on viewport width:
  - Under 700 px wide: `data-layout="review-list"`. From top to bottom: the band; the stage; the Scrubber slider; the Clips list, stacked in timeline order; the Comments panel; then a bar fixed to the bottom holding Pin note (and Approve cut for roles that can approve). There is no timeline canvas and no editing.
  - 700 to 1099 px: `data-layout="two-pane"`. The left pane holds the stage, the Scrubber and the Clips list. The right pane holds Comments. There is no timeline canvas and no editing.
  - 1100 px and wider: `data-layout="editor"`. The band runs across the top. Below it the stage fills columns one to four, the Inspector column five, and Comments columns six and seven. The timeline spans all seven columns underneath, with the Exports table below it.
  So 375x812 gets the review list, 768x1024 the two-pane review and 1280x800 the full editor. Commenters see the editor layout with every editing control absent.
- `/profile` **Profile**: the band, then plain lists for the availability line, read tokens, brand kits and the outbox. These are owner only; anyone else sees their name and email and a Sign out button.
- `/review/<review token>` **Review page** (client): the band shows the project title, frame rate and the shared cut's name. Under 700 px it follows the review-list order above. The fixed bottom bar holds "Send comment" and "Approve this cut", and the comment box sits above the bar. From 700 px up it uses the two-pane review. It never uses the editor layout.

No page scrolls sideways at any of the three viewports. Only a project run at 375 px and the timeline canvas scroll sideways, and both scroll inside themselves.

### Public screens and controls (DP-06, DP-07, DP-10, DP-14, DP-16, DP-21, DP-23, DP-24, DP-27, DP-35, DP-40, DP-44, DP-46, DP-52)

Only the roles, names and attributes in this table are public. Everything else is up to you.

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| Sign-in | textbox "Email"; password field labelled "Password"; button "Sign in" | |
| Every signed-in page | link "Projects"; link "Library" (owner, editor); link "Profile"; button "Sign out" | |
| Every signed-in page | element with `data-allowance` in the band | the allowance text (format in Business rules) |
| Every signed-in page | `status` "Notices" | the visible strip under the band; holds own-action results and outage banners |
| Project page | `status` "Project activity" | visually hidden, polite; remote events only |
| Project list | link "New project" | gold |
| Project list | `region` "Projects"; a `group` named by each project title, with `data-role` set to the signed-in person's role on that project (`owner`, `editor` or `commenter`), containing link "<project title>" and its frames as `img` "<project title> at <timecode>" with `data-sheet-frame` and `data-project-id` | the role word ("owner", "editor" or "commenter") in muted ink after the title |
| Project list | element `data-index-preview` | shown on hover |
| Dialog "New project" | textbox "Title", textbox "Agency", textbox "Description", combobox "Frame rate", combobox "Aspect ratio", button "Create project", button "Cancel" | |
| Library | searchbox "Search media"; file input labelled "Upload files"; `list` "Uploads" with one `progressbar` "<file name>" per upload; `region` "Media library"; each folder a `group` "<folder>"; each file has `data-media-id` and button "Delete <file name>" | |
| Dialog "Delete media" | button "Delete", button "Keep" | |
| Project band | button "Export" (gold, owner), button "Name cut" (owner), button "Share" (owner), button "Compare cuts", button "Captions" (owner, editor), button "Members" (owner), button "Frame size" (owner), button "Undo", button "Redo" (owner, editor) | project title, frame rate, aspect ratio and the playhead timecode in `data-playhead-timecode` |
| Stage | `region` "Stage" with `data-stage-mode` (`playhead` or `skim`) and `data-stage-frame`; one element per drawn layer with `data-layer-box` = clip id and `data-x`, `data-y`, `data-width`, `data-height`, `data-scale`, `data-rotation`, `data-opacity` (two decimals). In the editor layout each drawn layer of an unhidden clip on an unlocked row is a button named "Layer <clip name>" and carries four corner handles: buttons named "Top left handle <clip name>", "Top right handle <clip name>", "Bottom right handle <clip name>" and "Bottom left handle <clip name>", with `data-handle` set to `nw`, `ne`, `se` and `sw` in that order. The guide line is `data-stage-guide` = `centre-x`, `centre-y`, `left`, `right`, `top` or `bottom` | handles are 12 by 12 px, centred on the box corner |
| Inspector | `region` "Inspector"; one row per property with `data-prop` = `x`, `y`, `scale`, `rotation`, `opacity` showing the value to two decimals; combobox "Brand kit", button "Apply kit" | |
| Timeline | `region` "Timeline"; button "Zoom in"; button "Zoom out"; canvas element `data-timeline-canvas` with `data-px-per-frame`, `data-first-frame`, `data-zoom-level` (0 to 5) and `data-visible-frames`; each row a `group` "<row name>" with a button "Row <row name>"; each clip a button named "<clip name>, <start timecode> to <end timecode>" with `data-clip-id`, `data-row-id`, `data-start-frame`, `data-end-frame`, `data-hidden`, `data-group-id`; each group an element with `data-group-outline` = group id, `data-group-first-row` and `data-group-last-row` holding the top and bottom row ids it spans; each caption a button "Caption <n>, <start timecode> to <end timecode>" with `data-caption-id`; each note pin a button "Note by <name> at <timecode>" with `data-comment-id` and `data-frame`; markers with `data-marker-frame`; playhead with `data-playhead-frame`; other people's playheads with `data-remote-playhead` = person name | |
| Frame Loupe | `group` "Frame Loupe" with `data-loupe`; nine cells with `data-loupe-frame` = frame number; centre cell also `data-loupe-centre`, showing its timecode; marks with `data-loupe-mark` = `clip-edge`, `keyframe`, `caption-edge` or `pin` and `data-frame`; guide line `data-snap-guide` (in the loupe and in the timeline) | |
| Comments | `region` "Comments"; textbox "Note"; `radiogroup` "Who can see this" with radios "Team only" and "Client can see"; button "Pin note"; button "Reply" per note; button "Approve cut" (owner, commenter); counter `data-count` holding the number of code points used in the note box as a bare integer | the counter reads "<used> of 2,000" |
| Review list / two-pane | slider "Scrubber" (value = frame, value text = timecode); `list` "Clips" with buttons named as timeline clips | |
| Dialog "Name cut" | textbox "Cut name", button "Save cut" | |
| Dialog "Share for review" | combobox "Cut", combobox "Link lasts" (options "1 hour", "1 day", "7 days", "30 days"), button "Create link", textbox "Review link" (read-only), button "Share this cut", button "Regenerate link", button "Revoke link" | |
| Dialog "Export cut" | combobox "Cut", `radiogroup` "Size" with radios "2160p", "1080p", "720p", button "Start export" | |
| Exports | `region` "Exports"; per export button "Cancel export <cut name> <size>p" and link "Manifest <cut name> <size>p" | state text |
| Dialog "Captions" | combobox "Caption row", file input labelled "SRT file", button "Import captions", link "Download SRT"; `list` "Cues" with one button "Edit cue <n>" per cue on the chosen row, where `<n>` counts from 1 in start order; activating it opens a multi-line textbox "Cue text" (one text line per cue line), a counter `data-count`, button "Save cue" and button "Cancel cue". `data-count` holds the code points left on the cue's longest line, that is 42 minus the code points of its longest line, as a bare integer that goes below zero when the line is over the limit | each cue item shows its start and end timecodes and its text; the counter reads "<n> characters left" |
| Dialog "Compare cuts" | combobox "From cut", combobox "To cut"; `table` "Cut differences"; button "Restore cut <to cut name>" (owner) | |
| Dialog "Frame size" | combobox "Aspect ratio", button "Change frame", button "Cancel" (owner); opened by button "Frame size" in the project band | |
| Dialog "Project members" | combobox "Role for <name>", button "Remove <name>", textbox "Email", combobox "Role", button "Add member" | |
| Profile | textbox "Availability", button "Save availability"; `region` "Read tokens" with textbox "Token name", button "New read token", button "Revoke <token name>", and per token an element with `data-token-window` holding the requests that token has made in the current rate window as a bare integer; `region` "Brand kits" with textbox "Kit name", textbox "Text colour", textbox "Box colour", combobox "Weight", button "Save kit"; `region` "Outbox" with one row per message showing its subject, the address it goes to, and its state as the bare word `waiting` or `sent` | |
| Review page | `region` "Review"; textbox "Your name"; textbox "Comment"; button "Send comment"; button "Approve this cut"; `status` "Review status" | |

### Interactions (DP-10, DP-16, DP-21, DP-23, DP-24, DP-25, DP-27, DP-31, DP-33, DP-35, DP-40, DP-43, DP-56, DP-62, DP-64, DP-65)

**Keyboard on the timeline.** Tab enters the timeline once, on the current clip. Within the timeline, focus is roving: only one clip is in the Tab order at a time, and Tab leaves the timeline. The "current clip" is the clip that last had focus. The shortcuts below work while focus is anywhere inside the Timeline region, whether on a clip, a caption, a row button or a pin. They are inactive only while focus is in a text field.

- Left and Right Arrow nudge the current clip by one frame. Shift+Left and Shift+Right nudge it by one second (the nominal frame count of the project's rate).
- Up and Down Arrow move focus to the clip on the row above or below whose start is nearest the current clip's start.
- S splits the current clip at the playhead.
- H hides or shows the current clip.
- Delete or Backspace removes the current clip. Shift+Delete removes it with ripple.
- Enter adds the current clip to the selection, or removes it.
- Command+G (macOS) or Control+G (other systems) groups the current clip with the selection. Adding Shift ungroups the current clip's group.
- Alt+Up and Alt+Down move the current clip's row one place up or down in the stack.
- Home moves the playhead to frame 0, scrolls the canvas so `data-first-frame` is 0, and moves focus to the first clip in timeline order. End moves the playhead to the last frame, which is the project's `total_frames` minus 1 (see Business rules), scrolls the canvas so that frame is the last visible one, and moves focus to the last clip in timeline order. Timeline order is by start frame, then by row position, then by clip id. Both bring their clip fully inside the canvas (Business rules, Zoom and scroll).
- Plus and Minus (the `+` and `-` keys, with or without Shift) zoom the canvas in and out one level, the same as the "Zoom in" and "Zoom out" buttons.
- Comma and Period step the playhead back or forward by one frame.
- Space plays or pauses.
- I and O set the in and out frames of the play range at the playhead. Pressing I and then O at the same frame clears the range.
- M adds a marker at the playhead.
- Command or Control+Z undoes, and adding Shift redoes.
- L pins the Frame Loupe (below).

Each change goes to the server as one saved change. Focus stays on the same clip, matched by clip id, through every redraw: after its own save, after a remote change and after a reconnect replay. After a split, focus stays on the left half. After a remove, focus moves to the next clip on the row, or else to the previous one.

**Pointer on the timeline.** Dragging a clip body moves it. Dragging within 6 px of a clip's edge trims that edge. Clicking empty canvas moves the playhead. Command-click or Control-click adds a clip to the selection or removes it.

**Frame Loupe.** The frame under the pointer is `data-first-frame` plus the pointer's distance from the canvas's left edge divided by `data-px-per-frame`, rounded down.

1. When the pointer enters the timeline canvas, the loupe appears within 120 milliseconds. Its bottom edge sits 16 px above the pointer, and it is centred horizontally on the pointer and kept inside the window. It is 360 by 96 px, square-cornered and drawn in the surface colour.
2. It shows nine cells, each 40 px wide, centred on the frame under the pointer. Clip edges, keyframe diamonds, caption bounds and note pins that fall on those frames are drawn at that scale. The centre cell shows its timecode.
3. At the same moment the stage switches to `data-stage-mode="skim"` and draws the centre frame's layer boxes, and the Inspector shows the same numbers for the current clip at that frame.
4. Nothing else changes: the playhead, the address bar, other people's playheads and the saved timeline stay as they were.
5. Snapping: when the pointer frame is within the snap distance (Business rules) of a clip edge, the playhead or a marker, the loupe centre locks to that frame. The white guide line then appears through the loupe's centre cell and down the timeline at that frame. It disappears once the pointer moves out of the snap distance.
6. When the pointer leaves the canvas, the loupe disappears and the stage returns to the playhead frame within 200 milliseconds.
7. Keyboard: L pins the loupe at the playhead. While it is pinned, Left and Right move it by one frame, and with Shift by one second, without nudging clips. Enter moves the playhead to the loupe frame. Escape closes the loupe and returns focus to the clip that was current when L was pressed, or to the Timeline region if no clip was current.

On touch screens, pressing and holding the Scrubber thumb shows the loupe above the thumb, following the thumb's frame. Releasing hides it.

**Shaping a layer on the stage.** Only in the editor layout, only while `data-stage-mode` is `playhead`, and only for an unhidden clip on an unlocked row. Stage pixels and project pixels are related by the stage box's own width: one project pixel is the stage element's client width divided by the project's frame width.

1. Dragging a layer body moves it. The layer's `x` and `y` follow the pointer by the offset the drag began with, converted to project pixels and rounded by the rounding rule.
2. Dragging a corner handle scales the layer about its own centre. The new scale is the old scale multiplied by the pointer's distance from the box centre divided by that distance when the drag began, rounded to two decimals and clamped to 1 and 1,000 percent. `x` and `y` do not change.
3. Snapping while dragging the body: if `x` is within 8 project pixels of half the frame width it locks there, and so does `y` against half the frame height; if the box's left, right, top or bottom edge is within 8 project pixels of the frame's own edge, the box locks so that edge sits exactly on it. The centre locks are tested before the edge locks, and `x` is tested before `y`. While a lock holds, `data-stage-guide` names it and the white guide line shows.
4. Nothing is saved while the pointer is down. On release the page sends one `set_layer` op. A drag that ends with the same `x`, `y` and scale sends nothing.
5. Keyboard: with a layer button focused, the arrow keys move the layer by one project pixel and with Shift by 10; `[` and `]` change the scale by one percent and with Shift by 10. Each key press is its own `set_layer` op. Escape moves focus to that clip's own button on the timeline.
6. The handles and the layer button are absent for a hidden clip and for a clip on a locked row. A `set_layer` that still arrives for a locked row, as when another person locks the row while the pointer is down, answers `row_locked`, changes nothing, and the box returns to its saved place.

**The address.** The project page address is `/projects/<project id>` with these query parameters, in this order when more than one is present: `frame`, `zoom`, `clip`, `panel`. `panel` is one of `inspector`, `comments`, `exports` or `none`.

1. `clip` holds the id of the current clip, which is the clip that last had focus (Keyboard on the timeline, above). Adding a clip to the selection with Enter or Command-click never changes `clip`. After a remove, `clip` takes the id of the clip that receives focus by the rule above, and is empty only when no clip is left on that row.
2. On load the page applies all four: the playhead goes to `frame` (clamped to 0 and `total_frames` − 1), the canvas to that `zoom` level, focus to the clip named by `clip` if it still exists, and the named panel opens. A missing parameter means frame 0, the default zoom level, no selected clip and `panel=none`. A parameter that is not a whole number in range, or a clip id that does not exist, is ignored and the default used.
3. Moving the playhead by click, Home, End, comma, period or Enter from the loupe replaces the current history entry. Changing zoom, selecting a clip or opening a panel pushes a new history entry.
4. Playback never writes the address, and the Frame Loupe never writes it.
5. Back restores the previous `frame`, `zoom`, `clip` and `panel` within one second, and applies them as on load.
6. A second tab opened on the same address shows the same frame, zoom level, selected clip and open panel.

**Playback.** Space starts playback from the playhead. The playhead frame is the start frame plus the elapsed page-clock time multiplied by the project's exact rate, rounded down. With a range set, playback jumps back to the in frame when it reaches the out frame. Without a range, playback stops at the last frame, the same frame End moves to. Playback and scrubbing never save anything. Your own playhead is sent over the socket at most four times a second and drawn for others as a thin line with your name.

**Dialogs.** Every dialog is modal. On open, focus moves to its first field. Tab and Shift+Tab wrap from the last control to the first and back without leaving the dialog. Escape or Cancel closes it. On close, focus returns to the exact control that opened it. A dialog whose save failed stays open, with focus on the error summary.

**Uploads.** Choosing files with "Upload files" computes each file's SHA-256 in the browser, creates its upload and sends its chunks in order, one at a time, starting from the first chunk not yet received, while its progress bar in the Uploads list rises. When the library page loads, it reads the owner's open uploads from the server and shows each one in the Uploads list with the after-reload copy from Feedback states. The page cannot keep a file across a reload, so the owner chooses the same file again: creating the upload answers with the same open upload and its received chunks, and only the missing chunks are sent.

**Captions.** "Captions" opens on the row chosen in "Caption row", and the Cues list shows that row's cues. Activating "Edit cue <n>" opens that cue's text in "Cue text" and moves focus there. Enter inserts a line break. "Save cue", or Command or Control+Enter inside "Cue text", saves the cue as one caption change and returns focus to its "Edit cue <n>" button. "Save cue" is disabled while the text breaks the caption limits in Business rules. "Cancel cue" drops the unsaved text and returns focus to "Edit cue <n>". Escape closes the whole dialog as every dialog does, dropping any unsaved cue text.

**Comments.** In the editor layout, clicking a frame and then "Pin note" pins to that frame. If a clip is current, the note also pins to that clip and its row. In the review layouts, the note pins to the Scrubber's frame. Tapping a Clips list item moves the Scrubber to that clip's start. The note box shows a live count of used code points against the limit and disables "Pin note" while the count is over the limit. "Reply" opens the note box as a reply to that note. The note box saves its draft to the server about a second after typing pauses and restores it on load.

**Project list hover.** Hovering a project run dims every other run to 30% and shows that project's description and last-cut timecode in the index preview. Moving off restores the other runs. Tab focus on a run's title link does the same.

**Socket life.** Each project page and review page opens exactly one WebSocket after load and sends nothing until it is open. When the socket drops, the page reconnects with backoff (1, 2, 4, then every 8 seconds) and asks for the changes after its last version. During the drop, own edits are still saved over HTTP.

### Visual design (DP-56, DP-57, DP-60)

The direction is a contact sheet, like the proof sheet a photographer pins up: a strict run of frames, none featured.

- **Mood.** A dark grading suite. The ground is a warm near-black, like a grading room with the lights down, and only the footage boxes carry colour. Every project is shown as an archival run of frames. Every timecode is set in tabular figures, so a column of timecodes lines up to the pixel.
- **Palette in words.** Ground: a warm near-black. Surface: a slightly lifted warm brown-black, used for the timeline, the loupe, loading frames and the error strip. Ink: pure white for titles and values that matter. Muted: a warm mid-grey for secondary values and labels. Accent: a muted antique gold, used only on "New project", "Export" and other primary actions. Text on a gold control is set in the ground colour.
- **Type.** Work Sans for everything people read, at one size. Hierarchy comes from position and from white versus muted ink, never from size or weight. The only text a step larger, about one fifth bigger, is the word "Gatecut" in the band and dialog titles. Sometype Mono appears only where API material is shown: a read token string and the API base path on Profile. Timecodes use Work Sans with tabular figures.
- **Density.** Compact. Rows of the timeline and lists sit tight, and there is no card padding.
- **Composition.** A seven-column grid with 14 px margins and gutters. Every screen opens with one band of plain text hanging 20 px from the top, followed by a sheet of square-cornered frames in strict rows. In the editor the timeline is the sheet. The editor band holds the project name, frame rate, aspect ratio and playhead timecode at text size, with gold only on Export.
- **Hero (project list).** In the text band:
  - column one: "Gatecut";
  - column two: the owner's availability sentence;
  - column three onward: the open projects, one title per line;
  - column five: the agency names;
  - column seven: Profile and the gold "New project" link at the right edge.
  This month's allowance appears as plain text in the band. About 300 px of bare ground follows, and then the sheet. Each project is a run of three or four frames, one per marker. Each frame is drawn procedurally as that marker frame's layer boxes at their computed positions, at the project's own aspect ratio. A box's colour is the first six hexadecimal digits of its media checksum read as a red-green-blue colour. Text layers use their own box colour. The project title sits above the first frame of its run. The eight seeded projects give 28 frames.
- **Working screens.** These screens use the same language:
  - The stage is a box drawing on black.
  - Timeline clips are square-cornered blocks on the surface colour, with the clip name in white and timecodes in muted ink.
  - Panels are plain lists: titles in white, values in muted ink.
  - Tables (cut differences, exports, tokens, outbox) are aligned text columns with tabular figures and no rules.
  - An empty state is one sentence in the band position, with the sheet area left as bare ground.
  - Errors and outage banners appear in the surface-coloured Notices strip under the band, carrying the published copy and the reason in white.
  - Loading shows every frame and clip block as an empty surface rectangle at its final size.
- **Icons.** Icons are few, line-drawn and at text size, and never stand alone without a text label.
- **Touch and contrast.** Every control is at least 44 by 44 px in the review-list and two-pane layouts. Body text and muted text meet WCAG 2.2 AA contrast against the ground and the surface. Every focusable control shows a visible two-pixel white focus ring with a ground-coloured gap.

Do not add a paper or cream ground, hairline rules, monospace labels, index numbering, glass effects, gradients or shadows.

### Motion and effects (DP-23, DP-24, DP-43, DP-59)

Motion is brief and functional. Things settle quickly and softly, with no bounce.

- **Frame Loupe enter.** The loupe fades in while growing from slightly smaller to full size, and is fully visible within 120 milliseconds. While the pointer moves it follows without trailing. Its cells change frame by frame, with no tween between frames.
- **Stage return.** When the pointer leaves the canvas, the stage crossfades back to the playhead frame within 200 milliseconds.
- **Index preview.** The other runs dim within 120 milliseconds, and the description appears at the same time.
- **Remote change.** A clip moved by someone else glides to its new place within 200 milliseconds, and the winner's name shows on the block for two seconds.
- **Export progress.** The progress text and bar step in tens of percent, with no animation between steps.
- **Press feedback.** Buttons darken instantly on press.
- **Banned.** There are no idle, looping or decorative animations anywhere, and no spinners. Pending states are text and empty surface rectangles.
- **Reduced motion.** When the system asks for reduced motion:
  - The loupe appears, moves and disappears with no scale, fade or easing, jumping cell to cell.
  - The stage swaps frames instantly.
  - Remote moves jump.
  - The project list dims instantly.
  Frame cells, snapping, the guide line, the skim view and keyboard pinning work exactly the same.

### Feedback states (DP-03, DP-09, DP-10, DP-13, DP-28, DP-32, DP-34, DP-36, DP-38, DP-41, DP-47, DP-49, DP-50, DP-63, DP-66)

**Live regions.**

- **`status` "Notices"** (polite) announces the result of the person's own actions and shows outage banners in the strip under the band.
- **`status` "Project activity"** (polite, visually hidden) announces events from the socket that someone else caused, plus export results and allowance changes. It announces each event once, in the order the server sent it. It never announces the person's own saved changes.
- **`status` "Review status"** on the review page announces the client's own results and link changes.
- **Field errors** appear under their field and are tied to it. In a dialog with more than one field, an error summary heads the dialog, with one link per invalid field that moves focus to that field.

**Error copy.** The UI shows this copy, and every API error body carries it as `message`. `<…>` placeholders are filled from the record.

| `error` code | Copy |
|---|---|
| `unauthenticated` | Sign in to continue. |
| `bad_credentials` | That email and password do not match. |
| `not_found` | Nothing here. It may have been removed or you may not have access. |
| `method_not_allowed` | This address does not accept that request. |
| `unsupported_media_type` | Send this request as <expected type>. |
| `too_large` | This request is over <limit> bytes. |
| `forbidden` | Your role on this project cannot do that. |
| `validation` | Check the highlighted fields. |
| `conflict` | <winner name> changed <clip name> first. Your change to it was not saved. |
| `blocked` | <clip name> cannot move: <blocker reason>. |
| `row_locked` | <row name> is locked. |
| `group_blocked` | The group cannot move: <member clip name> <reason>. |
| `undo_blocked` | Undo would overlap <clip name> on <row name>. |
| `undo_missing` | Undo needs <clip name>, which was removed. |
| `nothing_to_undo` | Nothing to undo. |
| `nothing_to_redo` | Nothing to redo. |
| `cut_name_taken` | A cut called <cut name> already exists. |
| `media_in_use` | <file name> is used in <project titles joined by ", ">. |
| `upload_incomplete` | Chunks still missing: <missing chunk numbers joined by ", ">. |
| `upload_refused` | Gatecut could not use <file name>: <reason>. |
| `allowance_exceeded` | Allowance reached: export minutes <used> of <allowance> · storage <used GB> of <allowance GB> GB. |
| `export_finished` | This export already ended as <state>. |
| `export_not_ready` | The manifest is ready once the export is done. |
| `link_expired` | This review link has expired. Ask <owner name> for a new one. |
| `link_revoked` | This review link was turned off. Ask <owner name> for a new one. |
| `rate_limited` | This read token is over 30 requests in 10 seconds. Try again in <n> seconds. |
| `storage_unavailable` | Media storage is unreachable. Uploads and exports are paused; nothing was saved. |
| `queue_unavailable` | The export queue is unreachable. No export was started and no minutes were used. |

**Blocker reasons** (the `<blocker reason>` in `blocked`, the `<reason>` in `group_blocked` and the `reason` in `stopped`). One of:

| Reason | When |
|---|---|
| "<other clip name> is in the way" | a move or trim on the same row meets another clip, or a ripple meets an item that is not shifting |
| "the source starts there" | a trim passes the source's own start |
| "the source ends there" | a trim passes the source's own end |
| "the target row is not free" | a move to another row lands on an occupied frame |
| "the new length does not fit" | a speed change would overlap the next clip |
| "<row name> is locked" | the item sits on a locked row, or would move onto one |
| "the timeline starts there" | a move or ripple would take an item before frame 0 |

**Upload refusal reasons** (the `<reason>` above):

- "unknown file type"
- "MP4 header is damaged"
- "WAV header is damaged"
- "PNG header is damaged"
- "checksum does not match"
- "replacement must be the same type"
- "replacement is shorter than its use in <project title>"

**Field error copy** (in `errors`):

| Field | Copy |
|---|---|
| `title` | Give the project a title of 1 to 80 characters. |
| `frame_rate` | Choose a frame rate from the list. |
| `aspect_ratio` | Choose an aspect ratio from the list. |
| `name` (cut) | Name the cut in 1 to 60 characters. |
| `name` (reviewer) | Add your name in 1 to 60 characters. |
| `body` | Notes are 1 to 2,000 characters. |
| `mentions` | A note can mention at most 5 people. |
| `mention` | No one on this project is called @<handle>. |
| `text` | Captions are 1 or 2 lines of at most 42 characters each. |
| `q` | Search is limited to 8 words and 200 characters. |
| `limit` | Page size must be 1 to 100. |
| `cursor` | This cursor is not valid. |
| `file_name` | File names are 1 to 120 characters with no slashes, control characters or leading dot. |
| `email` | No Gatecut account uses that email. |
| `expires_in_seconds` | Links last 10 to 2,592,000 seconds. |
| `srt` | first problem found, one of: "This SRT file has more than 5,000 cues."; "Line <n> is longer than 42 characters."; "Cue <n> has more than 2 text lines."; "Cue <n> has a malformed time line."; "Cue <n> ends before it starts."; "Cue <n> is shorter than one frame."; "Cue <n> overlaps the cue before it."; "This file is not UTF-8 text." |
| any other field | That value is not allowed here. |

**Async actions.** Pending, success and failure copy goes to Notices unless noted.

| Action | Pending | Success | Failure |
|---|---|---|---|
| Sign in | "Signing in…" | page loads | `bad_credentials` |
| Upload | per file: "Uploading <file name> — <percent>%" in its progress bar, where `<percent>` is received chunks ÷ chunks × 100, rounded down | "<file name> is in the library." | "<file name> is already in the library as <existing name>." for a duplicate; any error copy |
| Upload after a reload | per open upload: "<file name> — <percent>% · choose the file again to resume" in its progress bar | as Upload | as Upload |
| Timeline change | the clip block shows in muted ink until saved | silent, unless it stopped short: "Stopped at <timecode>: <reason>." | error copy |
| Name cut | "Saving cut…" | "<cut name> saved." | error copy |
| Restore cut | "Restoring…" | "<cut name> restored." | error copy |
| Change the frame | "Changing frame…" | "The frame is now <aspect ratio>." | error copy |
| Share or regenerate link | "Making link…" | "Review link ready. It works until <local date and time>." | error copy |
| Revoke link | "Turning off link…" | "Review link turned off." | error copy |
| Pin note | "Pinning…" | "Note pinned at <timecode>." | error copy |
| Approve | "Approving…" | "<cut name> approved." | error copy |
| Start export | "Starting export…" | "Export of <cut name> at <size>p queued." | error copy |
| Cancel export | "Cancelling…" | "Export cancelled." | error copy |
| Import captions | "Reading <file name>…" | "<n> captions imported into <row name>." | `srt` field error in the dialog |
| New read token | "Making token…" | "Copy this token now; it will not be shown again." | error copy |
| Client comment | "Sending…" | "Comment sent." in Review status | error copy |

**Activity copy** (Project activity):

- move: "<name> moved <clip name> to <timecode>."
- trim: "<name> trimmed <clip name>."
- split: "<name> split <clip name> at <timecode>."
- remove: "<name> removed <clip name>."
- hide or show: "<name> hid <clip name>." / "<name> showed <clip name>."
- shape a layer: "<name> shaped <clip name>."
- restore a cut: "<name> restored <cut name>."
- change the frame: "<name> changed the frame to <aspect ratio>."
- any other timeline change: "<name> edited the timeline."
- new note: "<name> pinned a note at <timecode>."
- export done: "Export of <cut name> at <size>p is ready."
- export failed: "Export of <cut name> at <size>p failed."
- export cancelled: "Export of <cut name> at <size>p was cancelled."
- allowance change: "Allowance now: <allowance text>."
- cut shared: "<cut name> is now shared for review."

**Screen switches.**

- After a role change, the page shows "Your role on <project title> is now <role>." in Notices.
- After removal from a project, the page shows "You no longer have access to <project title>." in place of the project.
- After sign-out elsewhere, the page shows the sign-in page with "You were signed out." in Notices.
- On the review page, a revoked or expired link replaces the review with the `link_revoked` or `link_expired` copy.

**Outage banners.** These are owner only, because only the owner starts the uploads and exports they concern. The owner sees them in the Notices strip on load, from `GET /api/status`, and after any failing action of theirs. An editor or commenter has no status endpoint and never sees them. A banner stays until a later action of the owner's succeeds.

- storage down: the `storage_unavailable` copy;
- queue down: the `queue_unavailable` copy;
- mail down: "Mail is waiting in the outbox: <n> messages." (owner only).

**Empty states.**

- Project list: "No projects yet. Start one with New project."
- Library: "No files yet. Upload rushes to start the library."
- Search: "No files match <query>."
- Comments: "No notes on this cut yet."
- Exports: "No exports yet."
- Read tokens: "No read tokens yet."
- Outbox: "The outbox is empty."

## Backend

### API (DP-03, DP-06, DP-07, DP-08, DP-10, DP-14, DP-15, DP-22, DP-27, DP-35, DP-37, DP-41, DP-42, DP-44, DP-46, DP-50, DP-52, DP-53, DP-54, DP-55, DP-63, DP-65, DP-66)

**Basics.**

- All endpoints live under `/api`. Request and response bodies are `application/json; charset=utf-8` unless a row says otherwise.
- A JSON body may be at most 1,000,000 bytes. An upload chunk may be at most 5,242,880 bytes, and an SRT body at most 1,000,000 bytes. A body exactly at its limit is accepted.
- Session requests use the `gatecut_session` cookie (HttpOnly, SameSite=Lax, Path=/). Read-token requests use `Authorization: Bearer <token>`.
- Times are ISO 8601 UTC strings.

**Error shape.** Every error answers `{"error":"<code>","message":"<copy>"}`, with the copy from Feedback states. A 422 also carries `"errors":{"<field>":"<copy>"}`. Some codes add extra fields: `conflict` adds `"winner":"<name>","items":[<current state of each contested item>]`. `media_in_use` adds `"projects":["<title>",...]`. `upload_incomplete` adds `"missing":[n,...]`. `upload_refused` adds `"reason":"<reason>"`. `allowance_exceeded` adds the allowance object.

**Error precedence.** Checks run in this order, and the first failure answers:

1. Routing and the boundary: an unknown path answers 404 `not_found`. A known path with a wrong method answers 405 `method_not_allowed` with an `Allow` header listing the allowed methods. A body over its limit answers 413 `too_large`. A wrong content type answers 415 `unsupported_media_type`. An `Origin` header that is not the app's own origin answers 403 `forbidden`.
2. A missing or invalid session or token answers 401 `unauthenticated`.
3. A read token over its rate answers 429 `rate_limited`.
4. A replayed `op_id` or chunk returns its first response.
5. An unknown resource, or a project the caller is not a member of, answers 404 `not_found`.
6. A role not allowed answers 403 `forbidden`.
7. State conflicts answer 409, 410 or 412.
8. Validation answers 422 `validation`.
9. Last, an action that needs MinIO or RabbitMQ answers 503 while that service is unreachable. So a replayed `op_id`, a 404, a 403, a repeated export request and a validation error all answer before the outage does, and a request refused at step 9 queues nothing and takes nothing.

**Status codes per error code.**

| Status | Codes |
|---|---|
| 401 | `unauthenticated`, `bad_credentials` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 409 | `blocked`, `row_locked`, `group_blocked`, `undo_blocked`, `undo_missing`, `nothing_to_undo`, `nothing_to_redo`, `cut_name_taken`, `media_in_use`, `upload_incomplete`, `allowance_exceeded`, `export_finished`, `export_not_ready` |
| 410 | `link_expired`, `link_revoked` |
| 412 | `conflict` |
| 413 | `too_large` |
| 415 | `unsupported_media_type` |
| 422 | `validation`, `upload_refused` |
| 429 | `rate_limited` |
| 503 | `storage_unavailable`, `queue_unavailable` |

**Record shapes.**

- **person**: `{"id","name","email","handle"}`
- **project**: `{"id","title","agency","description","frame_rate","aspect_ratio","width","height","time_unit","version","total_frames","role","markers":[{"frame","label"}],"last_cut":{"id","name","total_frames"}|null}`. `time_unit` is `"frames"`, or `"seconds"` until upgraded. `role` is `owner`, `editor` or `commenter`.
- **row**: `{"id","name","kind":"video|audio|caption","position","locked"}`. Position 1 is the top of the stack and is drawn frontmost.
- **clip**: `{"id","row_id","name","kind":"mp4|wav|png|text","media_id"|null,"start_frame","end_frame","source_in","source_out","speed_percent","hidden","group_id"|null,"text"|null,"text_colour"|null,"box_colour"|null,"font_weight"|null,"keyframes":{"<property>":[{"frame","value","curve":"linear|eased"}]}}`. `end_frame` is exclusive.
- **caption**: `{"id","row_id","start_frame","end_frame","text"}`
- **comment**: `{"id","author_name","body","visibility":"team|review","parent_id"|null,"cut_id"|null,"pin":{"frame","row_id"|null,"clip_id"|null,"live_frame"},"mentions":["<handle>"],"created_at"}`
- **cut**: `{"id","name","version","total_frames","shared","approvals":[{"name","at"}],"created_at"}`
- **media**: `{"id","name","kind":"mp4|wav|png","folder","bytes","sha256","width"|null,"height"|null,"duration_seconds"|null,"sample_rate"|null,"used_in":["<project title>"]}`. `duration_seconds` is a number with three decimals.
- **export**: `{"id","project_id","cut_id","cut_name","size","state","progress","minutes","stale","requested_by","manifest_checksum"|null,"created_at","finished_at"|null}`
- **allowance**: `{"workspace_id","month":"YYYY-MM","export_minutes_used","export_minutes_allowance","storage_bytes_used","storage_bytes_allowance","resets_at","text"}`

**Session, people and workspace.**

| Method and path | Request | Success |
|---|---|---|
| `GET /api/health` | none | 200 `{"status":"ok"}`, no auth |
| `POST /api/session` | `{"email","password"}` | 200 `{"person"}` and sets the cookie |
| `GET /api/session` | none | 200 `{"person","is_owner"}` |
| `DELETE /api/session` | none | 204, clears the cookie |
| `GET /api/status` | none (owner) | 200 `{"storage":"up|down","queue":"up|down","mail":"up|down"}` |
| `GET /api/allowance` | none (any signed-in person) | 200 allowance |
| `GET /api/profile` | none | 200 `{"name","availability"}` |
| `PUT /api/profile` | `{"availability"}`, 0 to 140 code points (owner) | 200 `{"name","availability"}` |
| `GET /api/outbox` | none (owner) | 200 `{"items":[{"id","to","subject","state":"waiting|sent","attempts","created_at","sent_at"|null}]}` |

**Projects, members and timeline.**

| Method and path | Request | Success |
|---|---|---|
| `GET /api/projects` | none | 200 `{"items":[project]}`, the caller's projects in seed or creation order |
| `POST /api/projects` | `{"title","agency","description","frame_rate","aspect_ratio"}` (owner) | 201 project, with rows Titles (video), Picture (video), Audio (audio) and Captions (caption) |
| `GET /api/projects/{id}` | none | 200 `{"project","rows","clips","captions","members":[{"person","role"}]}` |
| `PUT /api/projects/{id}` | `{"op_id","base_version","aspect_ratio"}` (owner) | 200, the same shape as an op, with the new `project` |
| `GET /api/projects/{id}/ops?after=<version>` | none | 200 `{"ops":[{"version","author":{"id","name"},"op","changes"}]}`, in version order |
| `POST /api/projects/{id}/ops` | an op body (below) | 200 `{"version","changes":{"clips":[...],"captions":[...],"comments":[...],"rows":[...]},"removed":["<id>"],"stopped":null|{"at_frame","reason"}}` |
| `POST /api/projects/{id}/undo` | `{"op_id"}` | 200, same shape as an op |
| `POST /api/projects/{id}/redo` | `{"op_id"}` | 200, same shape as an op |
| `GET /api/projects/{id}/frames/{frame}` | none | 200 `{"frame","timecode","layers":[{"clip_id","row_id","x","y","width","height","scale","rotation","opacity"}]}`, back to front |
| `GET /api/projects/{id}/members` | none | 200 `{"items":[{"person","role"}]}` |
| `POST /api/projects/{id}/members` | `{"email","role":"editor|commenter"}` (owner) | 201 `{"person","role"}` |
| `PUT /api/projects/{id}/members/{person_id}` | `{"role":"editor|commenter"}` (owner) | 200 `{"person","role"}` |
| `DELETE /api/projects/{id}/members/{person_id}` | none (owner) | 204 |

**Op bodies.** Every op carries `"op_id"` (a client-made unique string, 1 to 64 characters), `"base_version"` (the project version the client last saw) and `"type"`, plus the fields below. All frames are whole numbers of at least 0.

- `add_clip` `{"row_id","media_id","start_frame"}`
- `add_text` `{"row_id","start_frame","end_frame","text"}`
- `move` `{"clip_id","start_frame","row_id"}`
- `trim` `{"clip_id","edge":"start|end","delta_frames","ripple":false}`
- `split` `{"clip_id","at_frame"}`
- `remove` `{"clip_id","ripple":false}`
- `set_hidden` `{"clip_id","hidden"}`
- `set_speed` `{"clip_id","speed_percent"}`
- `group` `{"clip_ids":[...]}`
- `ungroup` `{"group_id"}`
- `add_row` `{"name","kind"}`
- `reorder_row` `{"row_id","position"}`
- `lock_row` `{"row_id","locked"}`
- `set_keyframe` `{"clip_id","property","frame","value","curve"}`
- `remove_keyframe` `{"clip_id","property","frame"}`
- `add_marker` `{"frame","label"}`
- `set_layer` `{"clip_id","frame","x"?,"y"?,"scale"?}`

`set_aspect` and `restore_cut` are op types too, each recorded in the op log, announced and undone like any other, but `POST …/ops` does not accept them: they arrive only through `PUT /api/projects/{id}` and `POST …/cuts/{cut_id}/restore`. Either type sent to `POST …/ops` answers 422 on `type`.
- `caption_add` `{"row_id","start_frame","end_frame","text"}`
- `caption_edit` `{"caption_id","start_frame","end_frame","text"}`
- `caption_remove` `{"caption_id"}`
- `apply_kit` `{"kit_id"}`

`set_keyframe` uses a frame relative to the clip's start. Properties are `x`, `y`, `scale`, `rotation` and `opacity`.

**Captions.**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/projects/{id}/rows/{row_id}/captions/import` | the raw file as `application/x-subrip` | 200 `{"cues":<n>,"version"}` |
| `GET /api/projects/{id}/rows/{row_id}/captions/export` | none | 200 `application/x-subrip` with `Content-Disposition: attachment; filename="<project id>-<row id>.srt"` |

**Cuts and review links.**

| Method and path | Request | Success |
|---|---|---|
| `GET /api/projects/{id}/cuts` | none | 200 `{"items":[cut]}` |
| `POST /api/projects/{id}/cuts` | `{"name"}` (owner) | 201 cut |
| `GET /api/projects/{id}/cuts/{cut_id}` | none | 200 `{"cut","rows","clips","captions"}`, read-only snapshot |
| `GET /api/projects/{id}/cuts/{a}/compare/{b}` | none | 200 `{"added":["<clip id>"],"removed":["<clip id>"],"changed":[{"clip_id","from":{"row_id","start_frame","end_frame"},"to":{...}}],"frame_delta"}`; `frame_delta` = b's total frames minus a's |
| `POST /api/projects/{id}/cuts/{cut_id}/approval` | none (owner, commenter) | 200 `{"cut_id","approvals"}` |
| `POST /api/projects/{id}/cuts/{cut_id}/restore` | `{"op_id","base_version"}` (owner) | 200, the same shape as an op |
| `POST /api/projects/{id}/review-links` | `{"cut_id","expires_in_seconds"}` (owner) | 201 `{"id","token","url","cut_id","expires_at","state":"active"}` |
| `GET /api/projects/{id}/review-links` | none (owner) | 200 `{"items":[...]}` with `state` `active`, `expired` or `revoked` |
| `PUT /api/review-links/{id}` | `{"cut_id"}` (owner) | 200 link, now sharing that cut |
| `POST /api/review-links/{id}/regenerate` | none (owner) | 201 link with a new token, same cut and expiry; the old token is revoked |
| `DELETE /api/review-links/{id}` | none (owner) | 204 |

**Review (client, no session).** The review token in the path is the only credential.

| Method and path | Request | Success |
|---|---|---|
| `GET /api/review/{token}` | optional `If-None-Match` | 200 `{"project":{"title","frame_rate","aspect_ratio","width","height"},"owner_name","cut":{"id","name","total_frames","rows","clips","captions"},"comments":[review-visibility comments on this cut],"approvals"}` with `ETag` and `Cache-Control: private, no-cache`; 304 with no body when `If-None-Match` matches |
| `POST /api/review/{token}/comments` | `{"name","body","frame"}` | 201 comment |
| `POST /api/review/{token}/approve` | `{"name"}` | 200 `{"cut_id","approvals"}` |

**Comments and drafts.**

| Method and path | Request | Success |
|---|---|---|
| `GET /api/projects/{id}/comments?cut_id=<id>` | none (`cut_id` optional) | 200 `{"items":[comment]}` in creation order |
| `POST /api/projects/{id}/comments` | `{"body","frame","row_id"?,"clip_id"?,"cut_id"?,"visibility","parent_id"?}` | 201 comment |
| `GET /api/projects/{id}/comment-draft` | none | 200 `{"draft":null|{"body","frame","row_id","clip_id","cut_id","visibility","parent_id","updated_at"}}` |
| `PUT /api/projects/{id}/comment-draft` | the same fields as a comment, `body` 0 to 2,000 code points | 200 `{"draft"}` |

**Media and uploads.**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/uploads` | `{"file_name","bytes","sha256","folder","replaces"?}` (owner) | 201 `{"upload_id","chunk_bytes":5242880,"chunks":<n>,"chunks_received":[]}` for a new upload; 200 with the same shape for the owner's existing open or receiving upload with that `sha256`, carrying its real `chunks_received`; or 200 `{"duplicate":true,"media"}` when the checksum is already stored |
| `GET /api/uploads` | none (owner) | 200 `{"items":[{"upload_id","file_name","folder","bytes","sha256","chunks","chunks_received","state"}]}`, the owner's open and receiving uploads, oldest first |
| `PUT /api/uploads/{id}/chunks/{n}` | raw bytes as `application/octet-stream`; `n` counts from 0 | 204 |
| `GET /api/uploads/{id}` | none | 200 `{"state":"open|receiving|confirmed|refused","chunks_received":[...],"next_chunk":n|null}` |
| `POST /api/uploads/{id}/complete` | none | 201 `{"duplicate":false,"media"}` or 200 `{"duplicate":true,"media"}` |
| `GET /api/media?q=&folder=&cursor=&limit=` | none (owner, editor) | 200 `{"items":[media],"next_cursor"}`, ordered by folder then name |
| `GET /api/media/{id}/peaks` | none (owner, editor; WAV only) | 200 `{"peaks":[1000 numbers]}` |
| `DELETE /api/media/{id}` | none (owner) | 204 |

**Exports and manifests.**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/projects/{id}/exports` | `{"cut_id","size":2160|1080|720}` (owner) | 202 export (new), or 200 export (the existing one for that cut and size) |
| `GET /api/projects/{id}/exports` | none | 200 `{"items":[export]}`, newest first |
| `GET /api/exports/{id}` | none | 200 export |
| `POST /api/exports/{id}/cancel` | none (owner) | 200 export |
| `GET /api/exports/{id}/manifest` | none | 302 `Location: <expiring storage link>` |

**Brand kits.** Colours are six hexadecimal digits with no prefix, and `font_weight` is 400 or 600.

| Method and path | Request | Success |
|---|---|---|
| `GET /api/kits` | none (owner, editor) | 200 `{"items":[{"id","name","text_colour","box_colour","font_weight"}]}` |
| `POST /api/kits` | `{"name","text_colour","box_colour","font_weight"}` (owner) | 201 kit |
| `PUT /api/kits/{id}` | the same fields (owner) | 200 kit |

**Read tokens and the agency read API.**

| Method and path | Request | Success |
|---|---|---|
| `POST /api/tokens` | `{"name"}`, 1 to 60 code points (owner) | 201 `{"id","name","token","created_at"}`; `token` is `gct_` plus 40 lowercase hex digits and is returned only here |
| `GET /api/tokens` | none (owner) | 200 `{"items":[{"id","name","created_at","last_used_at"}]}` |
| `DELETE /api/tokens/{id}` | none (owner) | 204 |

The agency read API lives under `/api/v1` and answers **only** to `Authorization: Bearer <token>`. Every route there is GET only, and any other method answers 405 with `Allow: GET`. Every list accepts `limit` (default 25, 1 to 100) and `cursor`, and answers `{"items":[...],"next_cursor":"<opaque>"|null}`. Each item carries exactly the fields listed here and no others:

| Path | Item fields | Order |
|---|---|---|
| `/api/v1/projects` | `id,title,agency,frame_rate,aspect_ratio,total_frames,updated_at` | creation order |
| `/api/v1/projects/{id}` | the same single object | |
| `/api/v1/projects/{id}/clips` | `id,row_id,name,kind,start_frame,end_frame,hidden` | the order clips were added |
| `/api/v1/projects/{id}/cuts` | `id,name,total_frames,created_at`, shared cuts only | creation order |
| `/api/v1/projects/{id}/exports` | `id,cut_id,size,state,minutes,finished_at` | creation order |
| `/api/v1/projects/{id}/comments` | `id,cut_id,frame,body,author_name,created_at`, review-visibility comments only | creation order |

**Live socket.** `GET /api/live` upgrades to a WebSocket and checks the session cookie, or a `review` query parameter carrying a review token.

- **Client messages:** `{"type":"subscribe","project_id","after_version"}` (or `{"type":"subscribe_review"}`), and `{"type":"playhead","frame"}`.
- **Server messages:** `{"type":"op","version","author","op","changes","removed"}`, `{"type":"comment","comment"}`, `{"type":"export","export"}`, `{"type":"allowance","allowance"}`, `{"type":"playhead","person","frame"}`, `{"type":"cut_shared","cut"}`, `{"type":"role_changed","role"|null}`.
- **Close codes:** 4401 when the session ended, 4403 after a role change or removal, 4410 when a review link was revoked or expired.

### Business rules (DP-04, DP-05, DP-08, DP-10, DP-11, DP-12, DP-14, DP-15, DP-17, DP-18, DP-19, DP-20, DP-22, DP-24, DP-26, DP-28, DP-29, DP-30, DP-32, DP-36, DP-38, DP-41, DP-42, DP-45, DP-47, DP-48, DP-50, DP-51, DP-54, DP-55, DP-61, DP-62, DP-63, DP-65, DP-66)

**Frame rates and the rounding rule.** Projects run at these rates. Each has an exact value and a nominal rate.

| Rate | Exact value | Nominal rate |
|---|---|---|
| "23.976" | 24000/1001 | 24 |
| "24" | 24/1 | 24 |
| "25" | 25/1 | 25 |
| "29.97" | 30000/1001 | 30 |
| "30" | 30/1 | 30 |
| "50" | 50/1 | 50 |
| "59.94" | 60000/1001 | 60 |
| "60" | 60/1 | 60 |

Every stored time is a whole frame. **The rounding rule:** compute the exact rational value, never in floating point, and round to the nearest whole number, with an exact half rounding up. Conversions:

- Seconds to frames: seconds × exact rate.
- MP4 header duration to source frames: duration × exact rate ÷ timescale.
- WAV length to source frames: samples ÷ sample rate × exact rate.
- SRT milliseconds to frames: ms × exact rate ÷ 1000.
- Frames to SRT milliseconds: frame × 1000 ÷ exact rate.

**Timecode** is always `HH:MM:SS:FF`, non-drop, counted at the nominal rate from frame 0. FF is the frame mod the nominal rate. Seconds, minutes and hours come from the frame divided by the nominal rate, rounded down. For example, frame 1439 at "23.976" is `00:00:59:23`. "One second" of keyboard movement is the nominal rate in frames.

**Upgrade of older projects.** Projects with `time_unit` `"seconds"` store decimal seconds. At every start, each such project is converted once by the rounding rule: clip start, source in and source out, captions, markers and pins. Each project is converted in one transaction, after which its `time_unit` becomes `"frames"`. The server keeps serving while the upgrade runs. A read of a project that is not yet upgraded answers in frames, converted on the fly by the same rule, so the values are identical before and after. A restart never converts a project twice.

A clip's `end_frame` is never converted from seconds. It is the converted `start_frame` plus the length rule above, applied to the converted source and the clip's `speed_percent`, so a clip's length always agrees with its source. With the seed data this gives:

| Clip | start | source in to out | end | project `total_frames` |
|---|---|---|---|---|
| `qs-c1` | 0 | 0 to 309 | 309 | `quayside` 496 |
| `qs-c2` | 309 | 51 to 238 | 496 | |
| `ol-c1` | 0 | 101 to 1539 | 1438 | `orchard-lane` 1438 |

A marker may sit at or past a project's `total_frames`, as `orchard-lane`'s 60-second marker does at frame 1439. Its sheet frame then draws no layers.

**Project frame size.** Each aspect ratio has a frame size in pixels: "16:9" is 1920×1080, "9:16" is 1080×1920, "1:1" is 1080×1080 and "4:5" is 1080×1350.

**Timeline length.** A project's `total_frames` is the largest `end_frame` among all its clips (hidden ones included) and captions on every row, or 0 when it has none. A cut's `total_frames` is the same value over its snapshot. Frames run from 0 to `total_frames` − 1, so the last frame of a timeline is `total_frames` − 1, or frame 0 for an empty timeline.

**Zoom and scroll.** The timeline canvas is drawn at one of six zoom levels. `data-zoom-level` holds the level, `data-px-per-frame` its scale and `data-first-frame` the leftmost drawn frame.

| Level | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| `data-px-per-frame` | 0.25 | 0.5 | 1 | 2 | 4 | 8 |

- A project page opens at level 2. "Zoom in" and the `+` key go one level up, "Zoom out" and the `-` key one level down; at level 5 and level 0 the matching control is disabled.
- `data-visible-frames` is the canvas element's client width divided by `data-px-per-frame`, rounded down.
- **Zoom holds the playhead frame.** After any zoom change, `data-first-frame` is the playhead frame minus half of `data-visible-frames` rounded down, and never less than 0. The playhead frame itself never changes with zoom.
- Moving the playhead does not scroll the canvas, except through Home and End. Home sets `data-first-frame` to 0. End sets it to `total_frames` minus `data-visible-frames`, and never less than 0, so the last frame is the last visible one.
- **Where a block sits.** A clip, caption or pin block's left edge sits at its own start frame minus `data-first-frame`, multiplied by `data-px-per-frame`, measured from the canvas's left edge; a clip or caption block's width is its length multiplied by `data-px-per-frame`. This holds at every zoom level, so a block's place on screen always reads back as its frames.
- A clip is **fully in view** when its `start_frame` is at or after `data-first-frame` and its `end_frame` is at or before `data-first-frame` plus `data-visible-frames`. After Home the first clip in timeline order is fully in view, and after End the last one is, at every zoom level where the clip is no longer than `data-visible-frames`.

**Roles.**

| Action | Owner | Editor | Commenter |
|---|---|---|---|
| View project, timeline, cuts, comments, exports | yes | yes | yes |
| Timeline ops, undo, redo, caption import and export, apply kit | yes | yes | no |
| Library read, search, peaks; kit list | yes | yes | no |
| Comments and drafts | yes | yes | yes |
| Approve a cut | yes | no | yes |
| Name cuts, restore a cut, change the frame, review links, exports (start, cancel), members, uploads, media delete, kits create and edit, tokens, profile, outbox, status | yes | no | no |

The workspace owner is the owner of every project. A forbidden request changes nothing. Changing or removing a member's role takes effect at once:

1. The server sends `role_changed` to that person's open sockets for the project.
2. It closes those sockets with 4403 and sends them nothing more.
3. The page applies the new role within one second (editing controls appear or disappear), or shows the removal copy, and then opens a new socket if it still has access.

Signing out deletes the session and closes all of its sockets with 4401.

**Uploads.** An upload moves from open to receiving, then to confirmed or refused.

- `file_name` is 1 to 120 code points, with no `/`, `\` or control character and no leading dot. `folder` is 1 to 80 code points, made of segments joined by " / ", none of them `.` or `..`. `bytes` is 1 to 8,000,000,000, inclusive. `sha256` is 64 lowercase hex digits.
- The file is split into chunks of exactly 5,242,880 bytes, except the last. A chunk of the wrong length for its index is a 422 on `chunk`. Re-sending a chunk that is already received answers 204 and changes nothing.
- On create, a `sha256` already in the library answers the duplicate response, and nothing is uploaded or counted.
- On create, if the owner already has an open or receiving upload with the same `sha256`, the server answers 200 with that upload and its received chunks, keeps the first create's `file_name`, `folder` and `replaces`, and creates nothing new. A different `bytes` for that `sha256` is a 422 on `bytes`. This is how a reloaded page resumes an upload.
- On create, if storage used plus `bytes` would pass the allowance, the request is refused with `allowance_exceeded`.
- `complete` runs these steps in order:
  1. It answers `upload_incomplete` if any chunk is missing.
  2. It assembles the chunks and computes SHA-256. A mismatch is refused with "checksum does not match".
  3. It judges the type by content alone, never by extension (rules below). Anything else is refused with "unknown file type", including SVG, text and archives.
  4. If the checksum is now in the library, it answers the duplicate response, and nothing is stored or counted.
  5. It takes the bytes from the storage allowance in one atomic step.
  6. It stores the object once and waits for storage to confirm it.
  7. Only then does it create the library entry.
  If storing fails, the bytes are given back and nothing is listed. Chunk objects are deleted once the upload is confirmed or refused. `complete` reads the chunks from storage, so while MinIO is unreachable it answers 503 `storage_unavailable` at step 2 and refuses nothing on content: the checksum and type refusals are reachable only while storage is up.
- A refused upload answers 422 `upload_refused` and stores nothing.
- `replaces` (a media id) keeps that file's id and name but points it at the new object. The new file must be the same kind, and long enough for every clip that uses it. The old object and its waveform peaks are then deleted, and the storage counter loses the old bytes.

**Judging a file by its header.**

- **MP4.** The first box is `ftyp`. Top-level boxes chain exactly to the end of the file: each size is at least 8, size 1 means a 64-bit size follows, and size 0 means "to the end of the file". There is a top-level `moov` holding an `mvhd` (version 0 or 1) with timescale above 0 and duration above 0, and at least one `trak` whose `tkhd` has width and height above 0. The first such `tkhd` gives the dimensions (16.16 fixed point, integer part). Anything else that starts as an MP4 is refused with "MP4 header is damaged". No `mdat` is needed.
- **WAV.** The file starts with `RIFF`, the RIFF size equals the file length minus 8, and the form type is `WAVE`. There is a `fmt ` chunk with format 1 (PCM), 1 to 8 channels, a sample rate from 8,000 to 192,000, 16 or 24 bits, and block align equal to channels × bits ÷ 8. There is a `data` chunk whose size is a multiple of block align and fits inside the file. Otherwise the file is refused with "WAV header is damaged".
- **PNG.** The 8-byte PNG signature is followed by an `IHDR` chunk of length 13 with a correct CRC, and width and height from 1 to 16,384. Otherwise the file is refused with "PNG header is damaged".

**Library.**

- Each checksum has exactly one library entry and one stored object.
- Deleting a file used by any clip in any project, or in any cut, answers `media_in_use` with the project titles in title order. Otherwise the entry and its object are deleted, and the storage counter loses its bytes.
- Search terms are separated by whitespace and matched literally (no wildcard or pattern syntax). A file matches when every term is a case-insensitive prefix of a word (a run of letters and digits) in its name or folder. `q` may have at most 8 terms and 200 code points. Both limits are allowed exactly. Beyond them the search is refused on `q`. Every search answers within one second.
- **Waveform peaks** cover the first channel of the WAV's N sample frames in 1,000 buckets. Bucket i (0 to 999) covers sample frames from floor(i × N ÷ 1000) up to, but not including, floor((i + 1) × N ÷ 1000); a bucket that covers no samples has the value 0. Each value is the largest absolute sample in its bucket divided by full scale, which is 32,768 for 16-bit and 8,388,608 for 24-bit, rounded to four decimals with halves rounding up. They are computed on the first request and kept per checksum. Later requests read the kept copy, and replacing the file deletes it.

**Clips on rows.**

- Clips on one row never overlap. A clip occupies the frames from `start_frame` up to, but not including, `end_frame`, and is at least one frame long. MP4 and PNG clips go on video rows, WAV clips on audio rows, text clips on video rows and captions on caption rows. A wrong row answers 422.
- A clip's length is `source_out − source_in` scaled by speed: (source_out − source_in) × 100 ÷ speed_percent, by the rounding rule. `speed_percent` is a whole number from 25 to 400.
- Source frames for MP4 and WAV come from the header by the rounding rule. A PNG has a source of 3,600 seconds' worth of frames, and a new PNG clip is 5 seconds long. A text clip has no source limit.
- **Move on the same row:** if the target overlaps, the clip goes as far as it can in the direction of travel and stops on the nearest free frame, and the response carries `stopped` with the reason "<other clip name> is in the way". A move that cannot go a single frame answers `blocked`.
- **Move to another row:** the target must be free, or the move answers `blocked`.
- **Trim:** a trim changes the source edge by `delta_frames` × speed_percent ÷ 100, by the rounding rule. It stops at the source's own start or end (reason "the source starts there" or "the source ends there") or at the neighbouring clip, and answers `stopped` the same way. A trim that cannot change a single frame answers `blocked`.
- **Speed change:** the start stays, and the end follows the length rule. If the new end would overlap the next clip, the change answers `blocked` and nothing changes.
- **Split:** `at_frame` must be strictly inside the clip, or the request answers 422. The left part keeps the id. The right part gets a new id, the same name, the same group, and the keyframes from that point re-based to its own start.
- Any op touching an item on a locked row, or moving onto one, answers `row_locked`. `lock_row` itself is always allowed for owner and editor.

**Ripple.**

- `ripple: true` is accepted on `remove` and on `trim` of the `end` edge, and is a 422 elsewhere.
- The edit point is the clip's original end. Every clip, caption and row-pinned note on the same row that starts at or after the edit point shifts by exactly the frame count removed or added. So does every member of any group those clips belong to.
- If any item to be shifted sits on a locked row, or would overlap an item that is not shifting, the whole change answers `row_locked` or `blocked`, and nothing changes. Items on locked rows are never moved.

**Groups.**

- A group holds 2 or more clips from any rows, and a clip belongs to at most one group.
- A move of any member shifts every member by the same frame count. A move to another row is a 422 for grouped clips.
- A trim of any member applies the same edge and delta to every member.
- If any member would be blocked, stopped short, locked or out of source, the whole change answers `group_blocked`, naming the first such member in timeline order with its reason, and nothing changes. Groups never stop partway. Focus stays on the member that was the current clip, and the Notices strip carries the `group_blocked` copy.
- **The group outline.** While any member of a group is the current clip, the timeline draws one outline for that group. `data-group-first-row` is its topmost member's row and `data-group-last-row` its bottom one, by row position. The outline's left edge sits at the earliest member's `start_frame` and its right edge at the latest member's `end_frame`, at the canvas scale, so it covers every member at every zoom level. A group with members on one row only still draws the outline on that row.

**Keyframes.**

- Values: x and y are −10,000 to 10,000 pixels, scale is 1 to 1,000 percent, rotation is −3,600 to 3,600 degrees, and opacity is 0 to 100 percent. Defaults with no diamonds are x = half the frame width, y = half the frame height, scale 100, rotation 0 and opacity 100.
- At a clip-relative frame f between diamonds (f0, a) and (f1, b), t = (f − f0) ÷ (f1 − f0). The value is a + (b − a) × e(t), where e(t) = t for `linear` and e(t) = t² × (3 − 2t) for `eased`. The left diamond's curve decides the segment.
- Before the first diamond, the value is the first diamond's value. After the last, it is the last diamond's value.
- Values are computed in double precision and rounded to two decimals, with halves away from zero. A value within one millionth of a half counts as a half.
- The frame endpoint, the stage, the Inspector and the Frame Loupe all use this one rule.
- **Box size:** the media's width and height are fitted inside the project frame without cropping. A text clip's base box is 60% of the frame width by 12% of its height. The fitted box is then multiplied by scale ÷ 100 and centred on x and y. Hidden clips are not drawn.

**Shaping a layer.** `set_layer` carries `clip_id`, `frame` and any of `x`, `y` and `scale`, within the ranges above. It is one op, allowed for owner and editor, and refused with `row_locked` on a locked row.

- `frame` is a frame counted from the clip's own start, like `set_keyframe`. It is at least 0 and less than the clip's length, or the op answers 422 on `frame`. The page sends the playhead frame minus the clip's `start_frame`, and the layer button and its handles are absent while the playhead sits outside the clip.
- A property with **no diamond** on that clip has its base value set, so the value holds at every frame, whatever `frame` says.
- A property with **one or more diamonds** instead takes a diamond at `frame`, with the given value and the `linear` curve. If a diamond already sits on `frame`, its value is replaced and its curve kept.
- So the stage, the Inspector and the Frame Loupe keep showing one number for a frame, by the keyframe rule above.
- `set_layer` is refused with 422 when it carries no property, or a value outside its range.

**Changing the frame.** `set_aspect` carries `aspect_ratio`, is owner only, and is one op.

- Every clip's `x` is multiplied by the new frame width divided by the old frame width, and every `y` by the new frame height divided by the old frame height, each by the rounding rule. Every diamond on `x` and on `y` is converted the same way.
- `scale`, `rotation`, `opacity`, every clip's frames and every caption are unchanged. A text clip's base box is 60% of the new frame width by 12% of its new height.
- For example, moving a 1920×1080 project to "9:16" (1080×1920) converts a layer at x 1600, y 540 to x 900, y 960.
- The op stores every previous value, so undo restores every `x`, `y` and diamond exactly.
- `aspect_ratio` outside the published list answers 422 on `aspect_ratio`.

**Frame Loupe snap distance.** The loupe snaps within 2 frames, inclusive, of a clip edge, the playhead or a marker. It snaps to the nearest such frame, and the earlier frame wins a tie.

**Brand kits.** `apply_kit` is one op. It copies the kit's text colour, box colour and weight into every text clip in the project. Text clips added later keep their own values, and editing a kit afterwards changes no project and no cut.

**Captions.**

- Cue text is 1 or 2 lines, each at most 42 code points (42 is allowed), and not only whitespace. Lengths everywhere in Gatecut count Unicode code points: an accented letter typed as one character counts 1, the clapper-board emoji counts 1, and a flag emoji made of two code points counts 2.
- A cue is at least one frame long, and cues on one row never overlap.
- **SRT import** replaces every cue on the row in one op, which can be undone. The row must be a caption row and unlocked. The file must be UTF-8, and may start with a byte-order mark. Lines end in LF or CRLF. Cues are separated by one or more blank lines. Each cue is an index line of digits, a time line `HH:MM:SS,mmm --> HH:MM:SS,mmm` (hours with two or more digits), then 1 or 2 text lines.
- **Import caps** (each limit itself is allowed):
  - at most 1,000,000 bytes, refused with 413 `too_large` beyond that;
  - at most 5,000 cues;
  - every line of the file at most 42 code points;
  - at most 2 text lines per cue.
  The first breach or format problem is refused with 422 on `srt`, using the matching copy, and nothing changes. Every import answers within two seconds.
- **SRT export:**
  1. Cues are numbered 1 to n in start order.
  2. Times are written as `HH:MM:SS,mmm --> HH:MM:SS,mmm`.
  3. Each cue's text lines follow its time line.
  4. Every cue, including the last, is followed by one empty line.
  5. The export uses the line ending and byte-order mark of the row's last import, or LF and no mark if the row was never imported.
  6. A cue whose frames have not changed since import writes its original milliseconds. An added or retimed cue writes frames to milliseconds by the rounding rule.
  So a file already in that layout, imported and exported without edits, comes back byte for byte.

**Saving changes and the concurrency winner.**

- Every timeline change is one op applied in server order, and each op raises the project `version` by one.
- An op whose `base_version` is current always applies.
- An op whose `base_version` is older applies only if none of the clips, captions, rows or groups it touches was changed by another person's op after `base_version`.
- Otherwise it answers 412 `conflict`. The 412 names the winner, the person whose op changed the item first, and carries the current state of those items.
- When two people send ops on the same clip from the same version, exactly one gets 200 and the other gets 412.
- The losing page moves the clip to the winner's state and shows the conflict copy. Its other pending ops still save, because they touch other items. Text typed in open fields is kept.
- An `op_id` already used by the same person returns the first response without applying again.

**Undo and redo.** Each person has their own undo and redo stacks per project, and a new op by that person clears their redo stack. Undo applies the opposite of the person's latest op that is not yet undone, computed against the timeline as it is now:

- a move by d frames moves back by d from the clip's current place;
- a trim by d at an edge trims by −d;
- a remove re-adds the clip at its old place and row;
- an add removes the clip;
- a split joins the halves if both still exist and touch;
- hide shows again;
- a keyframe change restores the previous value;
- an import restores the previous cues;
- a `set_layer` restores the previous base value, or the previous diamond, or removes the diamond it added;
- a `set_aspect` restores the previous aspect ratio with every previous `x`, `y` and diamond;
- a `restore_cut` puts back every row, clip and caption as they were before it.

If the result would overlap, the undo answers `undo_blocked`. If an item it needs is gone, it answers `undo_missing`. An empty stack answers `nothing_to_undo` or `nothing_to_redo`. Undo and redo are saved as ordinary ops and are announced to others the same way.

**Cuts.** A named cut is a read-only snapshot of the timeline at the current version. Names are 1 to 60 code points and unique per project. A duplicate answers `cut_name_taken`. A cut is `shared` once any review link has ever shown it.

**Restoring a cut.** `restore_cut` carries `cut_id`, is owner only, and is one op that raises the version by one.

- Every row, clip and caption becomes the cut's snapshot: clips and captions the cut does not hold are removed, ones it holds and the timeline does not are added back with their own ids, and the rest take the cut's frames, source, speed, hidden flag, group and keyframes.
- Row `locked` flags and row positions are not part of the restore and do not change. If the snapshot would add, remove or change any item on a locked row, the whole restore answers `row_locked` and nothing changes.
- Markers, comments, pins, cuts, review links and exports are untouched. A pin whose clip comes back keeps that clip, and `live_frame` follows the restored clip by the pin rule above.
- It is an ordinary op: it is announced to every other open screen, which redraws within one second, and the person who did it can undo it, which puts back every row, clip and caption exactly as they were.
- Restoring never makes a cut and never changes a cut's own snapshot.

**Notes and pins.**

- `body` is 1 to 2,000 code points (2,000 allowed) and not only whitespace. Mentions are `@handle` tokens for people on the project. At most 5 distinct mentions are allowed (5 allowed), and an unknown handle is refused on `mention`. Commenter, editor and owner may choose `team` or `review` visibility. Client comments are always `review`, on the link's current cut.
- A pin has a frame, and optionally a row and a clip.
- A pin attached to a clip moves with that clip by every move or ripple. If the clip is removed, the pin keeps its last frame and row.
- A row-only pin shifts with ripple. A pin with no row never moves.
- A pin made on a cut is stored with its cut frame and clip. Its `live_frame` is the clip's current start plus the pin's offset from that clip's start in the cut, or the stored frame if the clip no longer exists. The live timeline draws pins at `live_frame`.
- Posting a note clears the poster's draft. Approval is recorded once per person (or client name) per cut, and repeating it answers 200 unchanged.

**Review links.** A review link is active, then expired or revoked.

- `expires_in_seconds` is 10 to 2,592,000 (both allowed). The UI's "Link lasts" choices are 3,600, 86,400, 604,800 and 2,592,000.
- Expiry is decided by the server clock at every request. At expiry the server also closes the link's open sockets with 4410 within one second.
- Revoke and regenerate end every open session of the old token at once: sockets close with 4410, and the next request answers `link_revoked`. Regenerate gives a new token with the same cut and expiry.
- An expired token answers `link_expired`.
- A review token can only read the review, comment and approve. Any other method on those paths answers 405, and it opens no other route.
- `PUT` on a link shares a new cut on it. Open review pages get `cut_shared` and redraw.
- The ETag is a strong hash of the exact response body. It is therefore the same while nothing changes and different the moment another cut is shared or a review comment or approval lands. `If-None-Match` with the current ETag answers 304.

**Exports.** An export moves from queued to running, then to done, cancelled or failed.

- **Sizes.** The size is the short side in pixels: 2160, 1080 or 720. The long side is the short side × the aspect ratio by the rounding rule. For example, 1080 at 16:9 is 1920×1080, and 720 at 4:5 is 720×900.
- **Minutes and the allowance.** `minutes` = the cut's total frames ÷ exact rate ÷ 60, rounded up to a whole minute. A request is accepted only if those minutes can be taken from the month's counter in one atomic step. Otherwise it answers `allowance_exceeded`. Cancelled and failed exports give their minutes back once.
- **Repeated requests.** A request for a cut and size that already has a queued, running or done export answers 200 with that export and takes nothing. After a cancel or failure, a new request makes a new export.
- **The worker.** It takes a message from the queue and works in 10 steps, each `EXPORT_STEP_MS` long. Progress rises by 10 per step and is sent to every open screen of the project. At 100 it writes the manifest and marks the export done.
- **Second delivery.** A message delivered a second time for an export that is running or ended is acknowledged and does nothing. The manifest object is written only if it does not already exist, so one export has one manifest and its minutes are counted once.
- **Cancel.** Cancel works from queued or running and stops a running job before its next step. Cancelling an export that already ended answers `export_finished`.
- **Failure.** If storage is unreachable when the manifest is written, the export is marked failed.
- **Stale.** A done export is `stale: true` once any op lands on the project after it finished. The Exports table then shows "Stale · from <cut name>".
- **Manifest download.** `GET …/manifest` answers `export_not_ready` until the export is done.
- **Manifest form.** The manifest is JSON: `{"project":{"id","title"},"cut":{"id","name"},"frame_rate":"<num>/<den>","size","width","height","total_frames","rows":[{"row_id","name","kind","items":[{"clip_id","name","kind","media_sha256"|null,"start_frame","end_frame","source_in","source_out","speed_percent","hidden","keyframes"}]}],"captions":[{"row_id","start_frame","end_frame","text"}],"checksum":"sha256:<64 lowercase hex>"}`. The checksum is SHA-256 of the manifest without its `checksum` field, serialised with keys sorted and no whitespace. `total_frames` is the cut's total frames as defined under Timeline length.

**Allowance.**

- The monthly export-minute allowance is `EXPORT_MINUTE_ALLOWANCE` (default 600). The storage allowance is `STORAGE_ALLOWANCE_BYTES` (default 100,000,000,000).
- Export minutes belong to the UTC calendar month and reset at its first instant, through a new counter per month. `resets_at` is that instant for the next month.
- Storage used is the seeded carried storage plus the bytes of every confirmed library file.
- Uploads and exports check and take the allowance in one atomic step against the shared counter, so parallel requests can never pass it. Taking exactly up to the limit is allowed.
- If a month's counter is missing at start, it is rebuilt from Postgres: the seeded opening usage if it was seeded that month, plus the minutes of that month's exports that were not cancelled or failed.
- The allowance text is "Export minutes <used> of <allowance> · storage <used GB> of <allowance GB> GB". GB is bytes ÷ 1,000,000,000 with one decimal (halves up), shown without a decimal when it is a whole number.
- Every change is pushed to every open screen of the workspace within one second.

**Read tokens.**

- A token reaches only `/api/v1`. On any other route it counts as unauthenticated, and a session cookie never authenticates `/api/v1`. A revoked token answers 401 at once.
- **Paging.** Cursors are opaque and encode the position after the last item. A page holds the next items strictly after that position in the stated order, so items added while paging appear only after the position and nothing is repeated. A removed item never makes another item skip. A `limit` outside 1 to 100 or a bad cursor is refused on that field.
- **Rate limit.** Each token may make at most 30 requests in each fixed 10-second window (the 30th is allowed). Further requests answer `rate_limited` with `Retry-After` set to the whole seconds until the window ends, at least 1. Session requests and sockets are never counted against a token.
- **The owner watches it.** Every open Profile screen shows each token's `data-token-window`: the count held for the current window, which rises within one second of each request that token makes and reads 0 once the window has passed. The count comes from the shared counter, so two open Profile screens always show the same number.

**Mail.**

- When a person is mentioned, or someone replies to their note, a notification is queued for that person and project. Nobody is notified about their own note.
- The first notification opens a window of `MAIL_GROUP_SECONDS`. At its end, one message goes to that person covering every notification in the window, in time order. Each line reads "<author> at <timecode>: <body>". The subject is "Gatecut · <project title> · notes for you (<n>)".
- When an export finishes done, the person who requested it gets "Gatecut · export ready · <cut name> · <size>p". The body gives the manifest checksum and the project page address.
- Every message first enters the outbox as waiting. Sending is retried every `OUTBOX_RETRY_SECONDS`. A message is marked sent the moment the SMTP server accepts it and is never sent again.

### Services (DP-02, DP-12, DP-13, DP-38, DP-47, DP-48, DP-49, DP-50, DP-55)

- **Postgres.** Postgres holds:
  - people and sessions;
  - the workspace and its random `workspace_id`, made at seeding;
  - projects, rows, clips, captions and markers;
  - every op in version order;
  - cuts and their snapshots;
  - comments, pins and drafts;
  - members and roles;
  - review links, read tokens and kits;
  - media entries and uploads;
  - exports, the outbox and the opening usage.
  Apply the schema idempotently on every serve, not only at build, and seed only an empty database. All data survives a restart.
- **MinIO** (bucket `S3_BUCKET`). It holds:
  - upload chunks at `uploads/<upload id>/<chunk number>`;
  - each confirmed file once at `media/<sha256>`;
  - manifests at `manifests/<export id>.json`.
  Manifest links are presigned GET links that expire after `MANIFEST_LINK_SECONDS`. While MinIO is unreachable, upload create, chunk, complete and export start answer 503 `storage_unavailable`, the banner shows, and nothing is listed or counted. Reads that come from Postgres keep working.
- **Valkey.** Keys:
  - `gatecut:<workspace id>:export-minutes:<YYYY-MM>`: an integer, expiring 40 days after it is created;
  - `gatecut:<workspace id>:storage-bytes`: an integer, no expiry;
  - `gatecut:peaks:<sha256>`: a JSON array, no expiry, deleted when its file is replaced or deleted;
  - `gatecut:rate:<token id>:<window number>`: an integer, expiring after 20 seconds. The window number is Unix seconds ÷ 10, rounded down.
- **RabbitMQ.** The durable queue named by `EXPORT_QUEUE`, which defaults to `gatecut.exports`, carries persistent messages with the JSON body `{"export_id","project_id","cut_id","size","requested_by"}`. One message is published per new export, and a message is acknowledged only after the export ends or is found already handled. While RabbitMQ is unreachable, export start answers 503 `queue_unavailable`, no export is created and no minutes are taken. Cancel still works for exports already running.
- **SMTP / Mailpit.** Messages are sent from `MAIL_FROM` (the From line is `Gatecut <notes@gatecut.fennbright.example>`) to the person's email, with the subjects in Business rules. While SMTP is unreachable, messages wait in the outbox, which is visible on Profile and through `GET /api/outbox`, together with the mail banner. They go out once SMTP answers again.

### Seed data (DP-05, DP-07, DP-40, DP-44, DP-45, DP-50, DP-56)

Every person, agency, client and project below is invented. Seed only an empty database.

**People.**

| Name | Email | Password | Handle | Role |
|---|---|---|---|---|
| Noor Achterberg | noor@gatecut.example | reel-owner-4417 | noor | workspace owner |
| Idris Fallowfield | idris@kestrelvane.example | reel-editor-2290 | idris | |
| Pia Marchetti | pia@kestrelvane.example | reel-editor-5531 | pia | |
| Maren Okafor | maren@kestrelvane.example | reel-producer-8812 | maren | |
| Theo Brandt | theo@lowtide.example | reel-editor-6604 | theo | on no project |

Noor's availability is "Booked through 14 November; taking new cuts from 17 November."

**Opening usage.** 212 export minutes, dated at the moment of seeding, stand for exports made before Gatecut. Carried storage is 41,200,000,000 bytes, standing for rushes kept from before Gatecut. Every seeded media file below is a small stand-in written to MinIO at seeding, and their total size is at most 2,000,000 bytes:

- **MP4 stand-ins** are `ftyp` (major brand `isom`) followed by `moov` with `mvhd` (version 0, the timescale and duration given) and one `trak`/`tkhd` (the width and height given), with no `mdat`.
- **WAV stand-ins** are 16-bit mono PCM at 8,000 Hz holding a 110 Hz sine whose amplitude rises steadily from 0 to half full scale.
- **The PNG stand-in** is a solid 1200×400 image.

**Media.** Media ids are listed with the file name in brackets.

| Id (file name) | Folder | Header |
|---|---|---|
| `hl-a001-c003` (HL_A001_C003.mp4) | Harbour Light / Rushes | 1920×1080, timescale 24000, duration 480480 |
| `hl-a002-c011` (HL_A002_C011.mp4) | Harbour Light / Rushes | 1920×1080, 24000, 288288 |
| `hl-a004-c002` (HL_A004_C002.mp4) | Harbour Light / Rushes | 1920×1080, 24000, 600600 |
| `harbour-bed` (harbour_bed.wav) | Harbour Light / Audio | 240,240 samples |
| `cl-hero-01` (CL_HERO_01.mp4) | Copperline / Rushes | 1920×1080, 25000, 1600000 |
| `cl-hero-02` (CL_HERO_02.mp4) | Copperline / Rushes | 1920×1080, 25000, 1500000 |
| `sm-reel-01` (SM_REEL_01.mp4) | Saltmarsh / Rushes | 1080×1920, 25000, 375000 |
| `ng-run-01` (NG_RUN_01.mp4) | Northgate / Rushes | 1080×1080, 30000, 600600 |
| `fb-expl-01` (FB_EXPL_01.mp4) | Ferrow Bank / Rushes | 1920×1080, 24, 1080 |
| `bh-recap-01` (BH_RECAP_01.mp4) | Blue Hour / Rushes | 1920×1080, 25000, 1500000 |
| `qs-014` (QS_014.mp4) | Quayside / Rushes | 1920×1080, 25000, 600000 |
| `qs-022` (QS_022.mp4) | Quayside / Rushes | 1920×1080, 25000, 300000 |
| `ol-int-01` (OL_INT_01.mp4) | Orchard Lane / Rushes | 1080×1350, 24000, 1801800 |
| `kv-logo` (kv_logo.png) | Kestrel & Vane / Brand | 1200×400, used in no project |

**Projects** are listed in seed order. Each has as many markers as listed, and the markers give the contact-sheet frames: 28 in total.

1. **`harbour-light`, "Harbour Light 30s"**
   - Agency Kestrel & Vane, rate "23.976", aspect "16:9". Description: "Thirty seconds for a harbour lamp-maker's anniversary."
   - Members: Noor (owner), Idris (editor), Pia (editor), Maren (commenter).
   - Rows, top to bottom: `hl-titles` "Titles" (video), `hl-picture` "Picture" (video), `hl-music` "Music" (audio, locked), `hl-captions` "Captions" (caption).
   - Clips:
     - `hl-c1` "HL_A001_C003" on Picture: start 0, end 240, source 48 to 288.
     - `hl-c2` "HL_A002_C011" on Picture: 240 to 480, source 0 to 240. Keyframes: opacity at 0 = 0 (eased) and at 24 = 100; scale at 0 = 100 (linear) and at 240 = 120.
     - `hl-c3` "HL_A004_C002" on Picture: 480 to 719, source 120 to 359.
     - `hl-c4` "harbour_bed" on Music: 0 to 719, source 0 to 719.
     - `hl-c5`, a text clip "Harbour Light" on Titles: 24 to 120, white text on a black box, weight 600.
   - Group `hl-g1` holds `hl-c1` and `hl-c5`.
   - Captions on `hl-captions`: `hl-cap-1` 30 to 96 "Every boat comes home"; `hl-cap-2` 264 to 360 "to the same light."; `hl-cap-3` 600 to 700 "Harbour Light. Since 1898."
   - Markers: 0 "Open", 240 "Gull", 480 "Lamp", 600 "Tagline".
   - Cuts:
     - `hl-cut-1` "Cut 1": the same as now except `hl-c3` runs 500 to 719 with source 120 to 339. Shared, total 719.
     - `hl-cut-2` "Cut 2": equal to the current timeline. Unshared, total 719.
   - Review link `hl-link-1`, token `rv-harbour-cut1-7f3a2c`, shows Cut 1 and expires 30 days after seeding.
   - Comments:
     - `hl-n1` by Maren, team: "Hold on the gull a beat longer @noor", pinned at frame 300 to `hl-c2` on `hl-picture`.
     - `hl-n2` by the client "Ada Brightwater", review, on Cut 1: "Can the lamp shot hold longer?", pinned at cut frame 560 to `hl-c3`. Its live frame is 540.
   - Project version 1.
2. **`copperline`, "Copperline Launch Teaser"**
   - Kestrel & Vane, "25", "16:9". Description: "Launch teaser for a copper cookware line."
   - Members: Noor (owner), Maren (commenter).
   - Row `cl-picture` "Picture" (video). Clips: `cl-c1` "CL_HERO_01" 0 to 1500, source 0 to 1500; `cl-c2` "CL_HERO_02" 1500 to 2950, source 0 to 1450.
   - Markers: 0, 750, 1500, 2250. Cut `cl-cut-1` "Director's 2m", total 2950 (2 export minutes).
3. **`saltmarsh`, "Saltmarsh Coffee Reels"**
   - Lowtide Studio, "25", "9:16". Description: "Three vertical reels for a roastery."
   - Row "Picture" with clip "SM_REEL_01" 0 to 375. Markers: 0, 125, 250, 350.
4. **`northgate`, "Northgate Run Club"**
   - Lowtide Studio, "29.97", "1:1". Description: "Square spots for a weekly running club."
   - Row "Picture" with clip "NG_RUN_01" 0 to 600. Markers: 0, 150, 300, 450.
5. **`ferrow-bank`, "Ferrow Bank Explainer"**
   - Kestrel & Vane, "24", "16:9". Description: "Explainer for a small regional bank."
   - Row "Picture" with clip "FB_EXPL_01" 0 to 1080. Markers: 0, 360, 720.
6. **`blue-hour`, "Blue Hour Festival Recap"**
   - Lowtide Studio, "25", "16:9". Description: "One-minute recap of a night market."
   - Row "Picture" with clip "BH_RECAP_01" 0 to 1500. Markers: 0, 500, 1000.
7. **`quayside`, "Quayside Teaser"**
   - Kestrel & Vane, "25", "16:9". Description: "An older teaser kept for reference."
   - Seeded with `time_unit` "seconds". Row `qs-picture` "Picture".
   - Clips: `qs-c1` "QS_014" start 0 s, source 0 s to 12.34 s; `qs-c2` "QS_022" start 12.34 s, source 2.02 s to 9.5 s. Markers at 0 s, 6.1 s and 12.34 s.
   - For example, with the seed data at start, after the upgrade `qs-c2` starts at frame 309 with source 51 to 238, and the markers are at 0, 153 and 309.
8. **`orchard-lane`, "Orchard Lane Interview"**
   - Lowtide Studio, "23.976", "4:5". Description: "Sit-down interview with an orchard keeper."
   - Seeded with `time_unit` "seconds". Row `ol-picture` "Picture".
   - Clip `ol-c1` "OL_INT_01" start 0 s, source 4.2 s to 64.2 s. Markers at 0 s, 30 s and 60 s.
   - For example, with the seed data at start, after the upgrade the source runs from 101 to 1539 and the markers are at 0, 719 and 1439.

Projects 3 to 8 have Noor as their only member. There are no seeded read tokens, brand kits, exports or outbox messages.

## Technical requirements

### Deployment (DP-01)

The runtime is Node.js 22 with npm, and the source is written in TypeScript. `/app/run.json` holds string commands for `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers 200 `{"status":"ok"}` as soon as the server accepts connections.

### Configuration and secrets (DP-02)

Read all of these at start:

- Postgres: `DATABASE_URL`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Valkey: `VALKEY_URL`.
- RabbitMQ: `AMQP_URL`.
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- `APP_PUBLIC_URL`, which builds review-link and mail addresses.
- Tunables with their defaults:
  - `MAIL_GROUP_SECONDS` (60)
  - `OUTBOX_RETRY_SECONDS` (10)
  - `MANIFEST_LINK_SECONDS` (900)
  - `EXPORT_QUEUE` (gatecut.exports), the durable queue this instance publishes to and consumes from. The app declares the queue itself, so two instances given different names never take each other's export messages.
  - `EXPORT_STEP_MS` (400)
  - `EXPORT_MINUTE_ALLOWANCE` (600)
  - `STORAGE_ALLOWANCE_BYTES` (100000000000)

Never hard-code a credential. Never send any of these values, or a service host name, to the browser. The only exception is a presigned manifest link.

### Server boundary (DP-03, DP-13, DP-53)

- **Same origin only.** Send no CORS headers. Refuse a state-changing request or a WebSocket upgrade whose `Origin` is not the app's own origin, as stated in API.
- **Limited surface.** The server answers only the API routes and pages in this brief, plus built static assets. It never serves source files, maps, the run manifest, environment files, credentials or any debug, test or admin route, and those paths answer 404. Answers outside `/api` for unknown paths are 404 pages in the same visual language.
- **Body limits** are as stated in API. The server stops reading an over-limit body at the limit.
- **Boot.** At start, the server retries Postgres for up to 60 seconds. If MinIO, RabbitMQ or SMTP is unreachable, it starts anyway, serves health and pages, and answers the affected actions as stated in Services. It reconnects without a restart when they return.

### Browser support and performance (DP-23, DP-31, DP-58)

Support the current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800.

- The project list and the editor are usable within three seconds of navigation on the seed data.
- A saved change reaches other open screens within one second.
- The Frame Loupe appears within 120 milliseconds of the pointer entering the canvas and keeps up with pointer movement without dropping behind by more than one frame cell.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and the app starts using only those commands.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package, font and icon set, with its licence. Shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- IF-03: Shipped packages, fonts and icons use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1 licences.
- IF-04: The app uses only Postgres, MinIO, Valkey, RabbitMQ and SMTP. There is no other datastore, queue, search engine or hosted service, and no data is written to local files.
- IF-05: Server and browser source is TypeScript. Build and tooling scripts, which the server and the browser never import, may be JavaScript, and they live in a top-level `scripts/` or `tools/` directory; configuration files whose name carries `.config.` may be JavaScript wherever they sit.
- IF-06: Work Sans, Sometype Mono and the icons are served from the app itself, with no font or icon request to another origin.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes. Names use this brief's domain terms: clip, row, cut, op, pin, review link, read token, allowance, export, manifest.
- Each domain rule is decided in exactly one place in the source, and every path that needs it uses that place. The rules include the rounding rule, the timecode form, keyframe interpolation, overlap and ripple checks, the export state transitions, allowance taking, the ETag and the error copy.
- There is one error shape for every API response, built in one place, with copy taken from one table.
- No abstraction has only one implementation. There is no dead, commented-out or unreachable code, and no defensive checks for states the types already rule out.
- Timeline changes go through the single op path that records server order. No endpoint changes timeline state outside it.
- There are no features, routes, settings or screens beyond this brief.
