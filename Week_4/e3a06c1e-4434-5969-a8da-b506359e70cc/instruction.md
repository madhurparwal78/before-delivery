# Lowfield Signal Lowfield Console

Lowfield Console is a web console for engineering teams that run live speech recognition in contact-centre agent assist and clinical dictation. Every action in it is controlled by role and project. Named teams hold project API keys, and each project has a hard monthly audio-minute quota. Teams stream or replay audio through a bundled recognizer that always gives the same output for the same input, and they watch each session as an audio-reactive 3D spectrum field. Billable minutes are computed once under the plan's published rounding rule and confirmed by the billing system. Transcript segments with low confidence go through a correction-and-approval flow that never overwrites the machine original. A public site explains the signal path, the plans and the rounding rules, and takes trial requests.

Build it on three backend services:
- **Postgres** is the system of record.
- **MinIO**, an S3-compatible object store, holds audio and transcript artifacts byte for byte.
- **Kill Bill** holds one billing account per organisation, that account's plan subscription, and the usage recorded for each closed session.

Out of scope: self-serve organisation signup, single sign-on, email delivery, any real network speech model, model catalogues, payment collection, and any datastore other than these three services.

## Problem and users

Teams that put live speech recognition into agent assist and clinical dictation pay for it in three ways today.

1. **Invoices are reconciled by hand.** Some vendors round each session up to a whole minute. Others bill per second with a minimum. Dashboards rarely say which rule produced a number.
2. **Budgets run out overnight.** Quotas are enforced per account, not per project, so one runaway integration can burn a month's audio budget overnight.
3. **Accuracy is hard to track.** Accuracy is measured as word error rate against a reference transcript that a person has checked. QA leads export low-confidence segments to spreadsheets, have agents correct them, and lose the original machine output. A wrong digit in a policy number or a dosage gets past a quick skim and breaks everything downstream.

Users:

- **Org admin.** Creates projects, sets each project's monthly audio-minute quota, invites teammates with roles, and changes plan. A new plan counts only once billing confirms it. Uses the console weekly.
- **Project developer.** Issues and revokes project API keys, starts live or replayed recognition sessions and synthesis jobs, and watches the session field to check that the audio path is healthy. Uses the console daily, sometimes from a phone. Key names and synthesis text often hold accented clinical terms, unit symbols and emoji status marks.
- **Transcript reviewer.** Works through the low-confidence segments of sessions by keyboard, corrects words against the retained audio, and submits the corrections. Uses the console daily.
- **Review approver.** Approves or returns corrections that other reviewers submitted, so the reviewed transcript and the measured word error rate update. Several approvers often work the same queue at once. Uses the console daily.
- **Billing viewer.** Reads billable minutes and cost per project for the current UTC month. Each figure is marked confirmed or pending by the billing system. Uses the console weekly.
- **Prospective buyer.** Reads the signal path, the plans and the rounding rules on the public site before requesting a trial workspace. Visits occasionally.

## Journeys

1. **A buyer checks the rounding rules.**
   - Start: signed out, at `/`.
   - The buyer scrolls the hero, and the Signal path section steps through its five stages.
   - In Plans, they type a session length and pick mono or stereo. The billed minutes for both plans update as they type.
   - They fill in the trial form and send it.
   - End: the form's fields are removed. The Trial status region stays on the page where the form was and announces the confirmation.
2. **An admin sets up a project and a teammate.**
   - Start: Ines Okafor is signed in at `/console/projects`.
   - She creates a project with a monthly quota. At the same moment, a second admin creates one whose name differs only in case. Only one of the two projects exists afterwards.
   - Ines's console lands on her project's Keys tab.
   - She opens Members, invites a reviewer assigned to the new project, and copies the invitation link.
   - The invitee opens the link, chooses a password and lands in the console.
   - End: the invitee sees only the projects they were assigned to.
3. **A developer streams, watches and rotates a key.**
   - Start: Teo Marlow is signed in, on Ward Dictation's Keys tab.
   - He issues a key named with an emoji status mark and copies the secret once.
   - His integration streams audio over the live endpoint. He opens the session from the Sessions tab.
   - The detail field shows Connecting, then Live, and rows advance.
   - He revokes the key on the Keys tab.
   - End: the session ends as revoked and the field freezes grey. A reload still shows the revoked state.
4. **A developer replays a recording and finds it again.**
   - Start: Teo is on the Sessions tab.
   - He opens Start session, picks a key, chooses Upload recording, and attaches a WAV file with its WebVTT sidecar. Storage drops out on the first press of Start. When storage is back, he presses Start again in the same dialog.
   - The console lands on the new session's detail route. Only one session was created.
   - The field plays the recording in real time, and transcript segments appear as the audio passes them.
   - Later he types fast in Search sessions.
   - End: the results always match what is in the box.
5. **A quota runs out mid-stream.**
   - Start: two stereo integrations stream at once into one project whose quota is nearly used.
   - Every surface shows the same quota figure while audio accrues.
   - The combined audio reaches the quota.
   - End: both sessions are halted together. Both fields freeze grey and the quota-halt banner appears. New sessions on that project are refused until the next UTC month or until an admin raises the quota.
   - Lowering a quota to or below usage halts open sessions in the same way.
6. **A reviewer corrects and two approvers decide.**
   - Start: Rhea Santos opens Seed dictation 01.
   - Using only the keyboard, she moves to the first flagged segment, plays its audio, opens the word editor, types the corrected words and submits. Focus moves to the next flagged segment.
   - Ari Lindqvist and a second approver open the same correction, and both press Approve almost together. One sees the approval. The other sees that it was already decided, and their view keeps its tiles until the server's correction event retints them.
   - End: the reviewed transcript shows the corrected words, that segment's ribbon tiles turn to the accent, and the word error rate updates on both views. The machine transcript is unchanged.
7. **A billing viewer reads the month and an admin upgrades.**
   - Start: Kim Baptiste opens `/console/usage` and reads each project's billable minutes and cost. Each figure is marked Confirmed or Pending.
   - Ines opens Plan and switches Harbourline Health to Scale. Her retry after a network hiccup does not create a second change.
   - End: the plan shows as waiting for billing, then as active once billing confirms. Sessions started after that are billed under the Scale rule.
8. **Billing or storage is down, then comes back.**
   - Start: billing or object storage is unreachable.
   - The billing viewer sees the billing outage banner and Pending figures.
   - The reviewer presses Play and sees the storage outage banner. The banner stays as new frames arrive, and their draft is untouched.
   - End: when the service returns, Pending figures confirm and the next Play works and clears the banner. No server restart is needed.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Public site story** A signed-out visitor at / sees the full-bleed hero field, the Signal path section, the Plans section with the rounding calculator, and the trial request form, in that order, as laid out in Screens and layout.
- **DP-02 — Signal path scroll scrub** The Signal path section steps through its five stages over the published scroll range, moving forward when the visitor scrolls down and back through each stage when they scroll up, as specified in Motion and effects.
- **DP-03 — Rounding calculator** The Plans calculator updates its billed-minutes status for both plans on every keystroke or channel change, with no submit and no reload, using the rounding rules in Business rules.
- **DP-04 — Trial workspace request** The trial form stores a request through POST /api/trial-requests, validates each field under the text-limit rule with the published field errors, and treats a repeat from the same email as a replay of the first request.
- **DP-05 — Sign-in landing routes** Signing in lands each role on its published console route, and reloading or opening that address directly shows the same screen.
- **DP-06 — Teammate invitation** An admin invites a teammate with a role and project assignments, and the invitee opens the single-use link, chooses a password and lands in the console, seeing only their assigned projects.
- **DP-07 — Role permissions** Every console and API action is allowed only to the roles in the permission table in Business rules, and every other role is refused with the published status.
- **DP-08 — Immediate role changes** Changing a member's role or project assignments, or removing the member, applies on that member's next request, including requests from a session that is already signed in.
- **DP-09 — Project-scoped object access** A member can't reach a session, segment, correction, key, retained audio or transcript artifact outside their visible projects, whether the id sits in the URL, the API path or the request body, and gets the published not-found response.
- **DP-10 — Project creation lands on Keys** After an admin creates a project, the address bar shows that project's Keys tab route, reloading it shows the same tab, and the Keys status announces the creation.
- **DP-11 — Unique project names under concurrency** Project names are unique within an organisation after trimming, normalisation and case folding, decided by the database so that of several simultaneous creates with matching names exactly one succeeds and every other gets the published name conflict.
- **DP-12 — Monthly quota and UTC period** Each project carries a whole-minute monthly quota over the server's current UTC calendar month that only admins set, concurrent quota saves each apply whole with the last committed one in force, and lowering the quota to or below usage halts every open session on the project within the bound in Business rules.
- **DP-13 — Project API keys** Developers and admins issue named project keys whose secret is shown exactly once and stored only as a hash, whose names follow the text-limit rule and are stored as the trimmed normalised string, and which are listed by name and prefix.
- **DP-14 — Key revocation ends live sessions** Revoking a key ends every live session streaming on it as revoked within the bound in Business rules and refuses every later request made with that key.
- **DP-15 — Speech synthesis jobs** A synthesis job counts its text under the text-limit rule, splits words on any Unicode whitespace, renders deterministic audio whose length follows from the word count, stores it in object storage and returns it for playback, as qualified in Business rules.
- **DP-16 — Key rotation journey** A developer issues a key, watches a session streaming on it, revokes the key from the Keys tab, and the session detail shows the revoked end state before and after a reload.
- **DP-17 — Live streaming endpoint** The live endpoint accepts key-authenticated 16 kHz 16-bit PCM over a WebSocket, sends the published state, segment and quota messages, and closes with the published close code for each end state.
- **DP-18 — Server-decided session state** The server alone moves sessions between states, including the idle close and the time cap from Business rules, and the console shows the server's state whatever the device clock says, including after a reload.
- **DP-19 — Stream connections released** Each open live socket and event stream holds exactly one dedicated, labelled database connection, which is gone within the bound in Business rules after the client leaves, and a dropped live socket ends its session.
- **DP-20 — Announced session states** Each session state change is announced once in the polite Session status region with its published copy, without moving focus.
- **DP-21 — Watching a live session** A developer opens a live session from the Sessions tab, sees Connecting, then Live, rows advancing and segments arriving, and then the closed state when the stream ends.
- **DP-22 — Replay session start** Starting a replay or test-tone session from the Start session dialog lands on that session's detail route, where the recording plays in real time until it closes at the end of the audio.
- **DP-23 — Upload validation and retried starts** Session start validates the audio and sidecar with the published field errors, and retries of a start with one Idempotency-Key create at most one session, following the idempotency rules in Business rules.
- **DP-24 — Originals stored byte for byte** Uploaded audio, uploaded sidecars, live captures and the machine transcript artifact are stored and served back exactly as submitted or produced, and corrections never alter them.
- **DP-25 — Search for the current text only** Session search updates its results and count in place for the search box's current text only, discarding replies for earlier text, and returns and counts only sessions in the user's visible projects.
- **DP-26 — List-to-detail morph** Opening a session from the Sessions table morphs the row's spectrum thumbnail into the detail field header, as specified in Motion and effects, and the swap is instant under reduced motion.
- **DP-27 — Spectrum readback strip** The session field's always-readable canvas carries a bottom strip of 64 bars whose columns and lit heights match the front spectrum row within the published tolerance, and data attributes that match the server's state, frame and peak bin.
- **DP-28 — Terrain state order** The terrain sits flat while connecting, advances rows at the published rate while live, and freezes and turns grey on a quota halt or revocation, in the order given in Motion and effects.
- **DP-29 — Confidence ribbon** The ribbon above the field shows one tile per reviewed word in three confidence bands, each marked by more than colour, as specified in Screens and layout.
- **DP-30 — Reduced motion and still fallback** Under reduced motion the terrain holds still and the strip steps once per second, and without WebGL a still 2D strip and a confidence table keep the same data attributes.
- **DP-31 — Session workspace breakpoints** The session detail workspace is stacked below the first published breakpoint, two panes from the first up to the second, and three side-by-side columns from the second up, with no horizontal overflow.
- **DP-32 — Phone touch targets** On a 375 px wide phone, every control on the session detail screen meets the published touch size and the field stays fully in view.
- **DP-33 — Inspector keeps its draft** The open segment inspector keeps its unsaved text, caret and focus while new segments arrive, while ribbon tiles retint and while the server ends the session.
- **DP-34 — One quota figure and joint halt** Quota usage is derived from stored sessions on every read, every surface that shows it reports the same figure, and when open sessions together reach the limit every one of them is halted, as qualified in Business rules.
- **DP-35 — Refusal until reset or raise** While a project's quota is exhausted, new live, replay and test-tone sessions on it are refused with the published status until the next UTC month or until an admin raises the quota above usage.
- **DP-36 — Quota-halt banner** Every project tab and session detail screen of an exhausted project shows the quota-halt banner copy from Feedback states character for character.
- **DP-37 — Flagged segments and playback** Segments whose lowest word confidence is below the published threshold are flagged, and each segment's audio slice plays from the retained original.
- **DP-38 — Keyboard review and inert closed panels** A reviewer moves between flagged segments, plays audio, opens the editor and submits using only the published shortcuts and Tab, with focus moving to the next flagged segment; every open dialog keeps Tab inside it and returns focus on close, and closed dialogs and sheets can't take focus or clicks.
- **DP-39 — Correction drafting rules** Each segment has at most one open correction at a time, only its author edits, submits or reopens it, and the submit result is announced without moving focus.
- **DP-40 — Reviewer pass journey** A reviewer opens Seed dictation 01, corrects its first flagged segment by keyboard, submits it, and sees it listed as awaiting approval.
- **DP-41 — Correction approval rules** Approvers approve or return submitted corrections from other people, never their own, along the published state machine, and exactly one of two simultaneous decisions wins.
- **DP-42 — Reviewed transcript and word error rate** The reviewed transcript applies only each segment's latest approved correction on top of the machine transcript, and the session's word error rate is derived from those two.
- **DP-43 — Server-driven retint** Ribbon tiles, reviewed segment text and the word error rate change only from the server's approve reply or correction event, reaching every open view within the delay in Business rules, and a refused decision leaves all three unchanged and shows its published copy.
- **DP-44 — Approver queue journey** An approver opens the Review tab, follows a submitted correction to its segment, approves it, and sees the reviewed text and word error rate update.
- **DP-45 — Billable seconds by plan rule** Each closed session's billable seconds are computed once, under the plan in force at its start, using the per-channel rounding rule in Business rules.
- **DP-46 — Usage recorded once in billing** Each closed billable session's billable seconds are recorded exactly once as usage on its organisation's Kill Bill subscription, and the session reads pending until billing accepts the record.
- **DP-47 — Integer-cent cost** Cost per project and the organisation total are exact integer cents derived by the single rounding step in Business rules.
- **DP-48 — Organisation-only usage totals** Usage totals and per-project figures include only the caller's own organisation's projects.
- **DP-49 — Usage review journey** A billing viewer opens the Usage screen and reads each project's sessions, billable minutes, cost and Confirmed or Pending status, plus the organisation total.
- **DP-50 — Billing-confirmed plan changes** A plan change is requested, then confirmed or failed only by Kill Bill's answer, the console shows the new plan as active only once confirmed, and retries with one Idempotency-Key replay or run afresh as the idempotency rules in Business rules state.
- **DP-51 — Plan in force at session start** A session keeps the confirmed plan in force when it started for its rounding and pricing, even if the plan changes before it closes.
- **DP-52 — Plan upgrade journey** An admin switches the organisation to Scale on the Plan screen, sees the waiting state, and then sees Scale active once billing confirms.
- **DP-53 — Billing outage** While Kill Bill is unreachable, the console stays up, refuses plan changes with the published status and copy, keeps usage figures pending, and shows the billing outage banner.
- **DP-54 — Storage outage** While object storage is unreachable, session starts and audio playback are refused with the published status, and the storage outage banner appears and stays through every later repaint until storage answers, without losing any typed draft.
- **DP-55 — Recovery without restart** When billing or storage comes back, pending usage confirms, plan changes work, and playback and uploads resume within the delays in Services, with no server restart.
- **DP-56 — Run manifest and health** The app installs, builds and serves from /app/run.json on the published port and answers the health check, as specified in Deployment.
- **DP-57 — Server boundary** The server enforces same-origin writes and the published body limits, and never serves source files or credentials.
- **DP-58 — Nocturnal instrumented look** The public site and the console follow the near-black, single-accent, tabular-numeral look described in Visual design.
- **DP-59 — Real signal path in source** The source computes spectra by a real FFT of the received samples, takes words from the sidecar, renders synthesis procedurally, and derives every displayed state from server data, with no canned frames or fake status paths.
- **DP-60 — Credentials from environment** Every service URL and credential is read from the environment at start, never hard-coded, logged or sent to the browser.

## Frontend

### Screens and layout (DP-01, DP-05, DP-10, DP-22, DP-29, DP-31, DP-32, DP-34, DP-36, DP-49)

The published viewports are 375x812, 768x1024 and 1280x800. No screen scrolls horizontally at any of them.

**Public site, `/`.** Four sections, in this order:
1. **Hero.** The session field runs full bleed and loops the bundled demo spectrum. A short headline, one sentence and a `Sign in` link sit over the left third. At 375 the text moves below the field.
2. **Signal path.** Five stages: Capture, Stream, Recognise, Review and Meter. Each has a heading and one or two sentences.
3. **Plans.** Two plan cards, Pilot and Scale. Each states its price per minute and its rounding rule from Business rules. The rounding calculator follows the cards. The cards sit side by side at 768 and 1280 and stack at 375.
4. **Trial request form.**

**Sign in (`/sign-in`) and join (`/join/<token>`).** Each is a single centred card on the near-black ground.

**Console shell.**
- **1200 px wide and up:** a fixed left rail 240 px wide holds the wordmark, the Console navigation, and the session search with its results.
- **Below 1200 px:** the rail becomes a top bar with a `Menu` button that opens the Navigation dialog. The search sits inside that dialog.
- Every console screen has the Service status region directly under the top of the workspace.

**Landing routes after sign-in or join.** Admins, developers, reviewers and approvers land on `/console/projects`. Billing viewers land on `/console/usage`.

**Projects list, `/console/projects`.** A table of the caller's visible projects, with these columns:
- name;
- quota used, in the meter format from Business rules;
- month-to-date sessions, counted as `sessions` in Business rules.

Admins also see the `New project` button.

**Project page, `/console/projects/<project_id>/<tab>`.**
- `<tab>` is one of `keys`, `sessions`, `review`, `synthesis` or `settings`. Each tab is shown only to the roles the permission table allows.
- The header shows the project name, the quota meter, and the Quota status region. That region holds the quota-halt banner whenever the project is exhausted.
- The tab list sits below the header. Each tab has its own route, and reloading a route shows the same tab.
- The tabs hold:
  - **Keys:** the key table and the `Issue key` button.
  - **Sessions:** the `Start session` button and the sessions table. Each row shows a small spectrum thumbnail (the session's mean spectrum), label, kind, state, audio length, billable minutes and start time.
  - **Review:** a table of corrections awaiting approval and the caller's own open corrections.
  - **Synthesis:** the render form and the last rendered audio.
  - **Settings:** the quota form.

**Session detail, `/console/sessions/<session_id>`.** The optional query `?segment=<segment_id>` opens the inspector on that segment. The workspace has five parts:
- **Confidence ribbon.** A band at the top of the first pane, directly above the field and touching its top edge.
- **Session field.** Sits directly under the ribbon and always keeps a 16:6 shape. Along its top edge runs the field header: a thin title bar with the session label and state chip, marked `data-morph="<session_id>"`.
- **Stat strip.** Right-aligned monospaced figures directly under the field: Audio, Frame, Peak bin, Channels, Billable minutes, Quota used and Word error rate.
- **Transcript region.** Lists the segments in order. The Review status region sits at its top, outside the inspector, at every width.
- **Segment inspector.**

The layout changes at two breakpoints. Each boundary width belongs to the wider layout:
- **Under 768 px wide:** one column, in the order ribbon, field, stat strip, Transcript. The inspector opens as a full-screen dialog sheet.
- **From 768 px up to, but not including, 1200 px:** two panes side by side. The left pane holds the ribbon, field and stat strip in that order from the top. The right pane holds Transcript. The inspector opens as a dialog sheet over the right pane.
- **1200 px and wider:** three columns side by side:
  1. the ribbon, field and stat strip, stacked in that order;
  2. Transcript;
  3. the inspector, as a permanent region. When no segment is selected, it shows its empty prompt from Feedback states.

On a 375 px wide screen, the whole field and its strip are inside the viewport at load without scrolling. Every control meets the touch size in Visual design.

**Confidence ribbon.**
- One tile per word of the reviewed transcript, in time order.
- Each tile carries `data-confidence` (two decimals) and `data-band` (`high`, `medium` or `low`). The band boundaries are set in Business rules.
- **High** tiles are filled with the accent.
- **Medium** tiles use plain ink with a dashed outline.
- **Low** tiles use the caution colour with diagonal hatching, and show the visible text label `low` after the word.

**Usage, `/console/usage`.**
- The Usage by project table has the columns Project, Sessions, Billable minutes, Cost and Status. Status is a `Confirmed` or `Pending` badge.
- The Organisation total region shows the month and the total cost.
- Billable minutes and cost use the display formats in Business rules.

**Members (`/console/org/members`) and Plan (`/console/org/plan`).** These are admin only.
- Members holds the member table and the invite dialog.
- Plan shows the confirmed plan with an `Active` badge, any open change with its state, and one switch button.

### Public screens and controls (DP-01, DP-02, DP-03, DP-04, DP-06, DP-10, DP-12, DP-13, DP-15, DP-22, DP-25, DP-27, DP-29, DP-30, DP-36, DP-37, DP-38, DP-43, DP-49, DP-50)

Only these roles and names are public contract. Everything else is free.

| Screen | Role and accessible name | Visible copy or contents |
|---|---|---|
| Public | `link "Sign in"` | Sign in |
| Public, detail | `img "Session field"` (the canvas) | carries `data-session-state`, `data-end-state`, `data-frame`, `data-peak-bin` |
| Public | `region "Signal path"` with `data-stage` `1` to `5`. Its `list` holds five `listitem`s, and the active one has `aria-current="step"` | Capture, Stream, Recognise, Review, Meter |
| Public | `region "Plans"` holding `article` elements headed `Pilot` and `Scale` | plan price and rounding rule |
| Public | `textbox "Session length in seconds"` | starts empty |
| Public | `radiogroup "Channels"` with `radio "Mono"` (checked at start) and `radio "Stereo"` | Mono, Stereo |
| Public | `status "Billed minutes"` | calculator copy from Feedback states |
| Public | `form "Request a trial workspace"` with `textbox "Name"`, `textbox "Work email"`, `textbox "Company"`, `combobox "Team"` (options `Contact centre`, `Clinical dictation`), `button "Request trial"`, `status "Trial status"` | |
| Sign in | `textbox "Email"`, a password field labelled `Password`, `button "Sign in"`, `status "Sign-in status"` | |
| Join | a password field labelled `Choose a password`, `button "Join workspace"`, `status "Join status"` | |
| Shell | `navigation "Console"` with links `Projects`, `Usage`, `Members`, `Plan`, each shown only to roles allowed to open it | |
| Shell | `button "Menu"` opening `dialog "Navigation"` (below 1200 px) | Menu |
| Shell | `searchbox "Search sessions"`, `status "Search results"`, `list "Session results"`, shown only to roles allowed to search sessions | |
| Shell | `status "Service status"` | outage banners |
| Projects | `button "New project"` opening `dialog "New project"` with `textbox "Project name"`, `textbox "Monthly quota (minutes)"`, `button "Create project"`, `button "Cancel"` | |
| Projects | `table "Projects"` | name, quota used, sessions |
| Project | `progressbar "Quota used"` (value 0 to 100, derived as in Business rules) | `<used> / <limit> min` |
| Project | `status "Quota status"` | quota-halt banner |
| Project | `tablist "Project"` with `tab` items `Keys`, `Sessions`, `Review`, `Synthesis`, `Settings`, each shown only to roles allowed it | |
| Keys | `button "Issue key"` opening `dialog "Issue key"` with `textbox "Key name"` and `button "Create key"`. After creation: a read-only `textbox "New key"` and `button "Copy key"` | |
| Keys | `table "API keys"`. Each row has `button "Revoke <key name>"`, which opens `dialog "Revoke key"` with `button "Revoke key"` and `button "Cancel"` | |
| Keys | `status "Keys status"` | |
| Sessions | `button "Start session"` opening `dialog "Start session"` with `combobox "API key"`, `radiogroup "Source"` (`radio "Test tone (1 kHz)"`, `radio "Upload recording"`), file inputs labelled `Audio file` and `Sidecar (WebVTT)`, `textbox "Label"`, `button "Start"`, `status "Upload status"` | |
| Sessions | `table "Sessions"`. Each row has a link named with the session label, and an `img "Spectrum thumbnail"` carrying `data-morph="<session_id>"` | |
| Detail | the field header, carrying `data-morph="<session_id>"` | session label and state |
| Detail | `list "Confidence ribbon"` of `listitem` tiles | words |
| Detail | `region "Session stats"` | Audio, Frame, Peak bin, Channels, Billable minutes, Quota used, Word error rate |
| Detail | `status "Session status"` | session copy from Feedback states |
| Detail | `button "Stop session"` (live sessions; developers and admins) | Stop session |
| Detail | `region "Transcript"`. Each segment is a `button` named `Segment <n>: <reviewed text>`, where `<n>` is the index plus 1. Flagged segments carry `data-flagged="true"` and the visible label `Flagged` | |
| Detail | `region "Segment inspector"` (1200 px and wider) or `dialog "Segment inspector"` (narrower), with `button "Play segment audio"`, `textbox "Corrected text"`, `button "Save draft"`, `button "Submit for approval"`, and `button "Close inspector"` (dialog only). For the author of a returned correction, the inspector shows `button "Reopen as draft"` in place of Corrected text, Save draft and Submit for approval | |
| Detail | `status "Review status"`, at the top of the Transcript region, outside the inspector | review copy from Feedback states |
| Detail, approvers | in the inspector: `button "Approve correction"`, `textbox "Return note"`, `button "Return correction"` | |
| Detail, no WebGL | `table "Segment confidence"` with columns Word, Start, Confidence | |
| Review | `table "Awaiting approval"`. Each row has a link `Open correction` to the session detail with `?segment=` | |
| Synthesis | `combobox "API key"`, `textbox "Text to speak"`, `radiogroup "Voice"` (`radio "Lumen"`, `radio "Basalt"`), `button "Render"`, `status "Synthesis status"`, an audio player labelled `Rendered audio` | |
| Settings | `textbox "Monthly quota (minutes)"`, `button "Save quota"`, `status "Settings status"` | |
| Usage | `table "Usage by project"`, `region "Organisation total"` | |
| Members | `button "Invite teammate"` opening `dialog "Invite teammate"` with `textbox "Name"`, `textbox "Email"`, `combobox "Role"` (options `Admin`, `Developer`, `Reviewer`, `Approver`, `Billing viewer`), one `checkbox` per project named with the project name, `button "Create invitation"`, and a read-only `textbox "Invitation link"` | |
| Members | `table "Members"`. Each row has `combobox "Role for <name>"` and `button "Remove <name>"`. Also `status "Members status"` | |
| Plan | `region "Current plan"`, `button "Switch to Scale"` or `button "Switch to Pilot"`, `status "Plan status"` | |

### Interactions (DP-02, DP-03, DP-10, DP-15, DP-22, DP-23, DP-25, DP-26, DP-33, DP-38, DP-39, DP-43, DP-50)

**Public site.**
- Typing in Session length in seconds, or changing Channels, recomputes the Billed minutes status on every input event. There is no submit button.
- Scrolling drives the Signal path stages as described in Motion and effects.
- Submitting the trial form disables `Request trial` until the reply arrives. On success, the form's fields and the `Request trial` button are removed. The `Trial status` region stays on the page and holds the success copy from Feedback states.

**Console navigation.** Moving between console screens through the console's own links, tabs and search results changes the address bar but doesn't reload the page. Reloading any console address shows the same screen.

**Console search.**
- Typing in Search sessions sends the query 250 ms after the last keystroke.
- The Session results list and the Search results status update in place.
- Only the reply for the box's current text may update the list or the status. A reply for any earlier text is thrown away, even when it arrives last.
- Clearing the box empties the list and the status, sends nothing, and announces nothing.
- A `422` reply leaves the previous results and status in place and announces nothing.
- Pressing Enter on a result opens that session's detail route.

**Creating a project.**
1. `New project` opens its dialog with focus on Project name.
2. `Create project` submits the form.
3. On success, the address bar becomes `/console/projects/<project_id>/keys`, and the Keys status announces the creation.

**Starting a session.**
1. `Start session` opens its dialog. Each time the dialog opens, it makes one fresh Idempotency-Key.
2. `Start` submits the form, and Upload status shows the upload progress.
3. The dialog keeps the same key across every press of `Start` until a success closes it or the user cancels it. So pressing Start again after a `503` or a field error retries with the same key, and a double press creates only one session.
4. On success, the address bar becomes `/console/sessions/<session_id>`. Reloading or deep-linking to that route shows the same session.

**Rendering speech.**
1. `Render` sends the Synthesis form with the chosen key's id; the browser never holds or sends an API key secret.
2. On success, Synthesis status announces the result and the `Rendered audio` player loads the job's `console_audio_url`, the cookie-authorised console route in API.
3. If that load fails because storage is unreachable, the storage outage banner appears in Service status.

**Switching plan.**
- The first press of `Switch to Scale` or `Switch to Pilot` makes one Idempotency-Key.
- Every later press reuses that key until a `202` or a `409` reply arrives.
- The button is disabled while a request is in flight.

**Revoking a key.**
1. `Revoke <key name>` opens a confirm dialog.
2. `Revoke key` revokes the key and closes the dialog.
3. Focus returns to the key table, and the result is announced in Keys status.

**Dialogs and sheets.**
- An open dialog or sheet keeps focus inside itself. Tab past the last control goes to the first, and Shift+Tab before the first goes to the last.
- Escape closes it, and focus returns to the control that opened it.
- If a dialog is closed and then reopened, it stays open. A leftover close timer never hides it again.
- A closed Navigation dialog (below 1200 px) and a closed inspector sheet (below 1200 px) are fully unavailable. None of their controls can take focus, receive clicks, or appear in the accessibility tree. Moving them off-screen doesn't count as closed.
- While a dialog or sheet is open, the content behind it is inert.

**Review by keyboard.** These shortcuts work whenever focus is anywhere in the Transcript region or the segment inspector, including on a button. They don't apply while focus is in Corrected text or Return note. Below 1200 px, while the inspector sheet is open, the segments behind it are inert, so `J` and `K` do nothing and focus stays where it is.
- `J` moves focus to the next flagged segment. At the last flagged segment, focus stays put.
- `K` moves focus to the previous flagged segment.
- `E`, or Enter on a segment, opens the inspector for it and moves focus to Corrected text. The text box is prefilled with the segment's reviewed text, or with this reviewer's unsaved draft for the segment if one exists.
- `P` plays the selected segment's audio. The same action is reachable by Tab as the `Play segment audio` button.

Inside Corrected text:
- **Ctrl+Enter, or Cmd+Enter on macOS,** submits the correction (`Submit for approval`). The console creates the draft first if needed.
- **Escape** closes the inspector (the sheet, below 1200 px). The typed text is kept as an unsaved draft for that segment on this page, and focus returns to the segment's button.

After a successful submit:
- Below 1200 px, the inspector sheet closes.
- Focus moves to the next flagged segment's button. If none remains, it stays on the submitted segment's button.
- The result is announced in Review status.
- At 1200 px and wider, the inspector loads the segment that now has focus.

**Deciding a correction.**
- While an approve or return is in flight, its button shows the pending copy from Feedback states and is disabled.
- The ribbon tiles, the segment button's reviewed text and the Word error rate stat change only from:
  - the approve reply; or
  - the `correction` event, for every view of the session.
- A refused decision (`403` or `409`):
  - leaves all three exactly as they were;
  - shows its Review status copy;
  - keeps focus in the inspector;
  - enables the inspector's controls again.
- When the decision that won was an approval, its `correction` event then retints the tiles and updates the text and the rate, so the final view matches the server. The refusal copy stays in Review status until the next review action.

**Inspector stability.** While the inspector is open, none of these clears Corrected text, moves its caret, or moves focus:
- segments arriving in Transcript;
- frames of the event stream;
- the session changing state (for example, to `idle_closed`);
- ribbon retints.

The Session status announcement happens at the same time without taking focus. A failed save or play shows its error in Review status or Service status, and no later repaint erases it.

**Touch.** Every control works by tap. In the stacked layout, the inspector sheet closes with `Close inspector`.

### Visual design (DP-32, DP-58)

**Colour roles.**
- **Ground:** near-black, covering every surface.
- **Surface:** a slightly lifted charcoal for panels.
- **Ink:** pale grey-white for text.
- **Accent:** one saturated mint-green. It appears only on live signal and on confirmed-good states:
  - live signal: the readback bars and terrain crest while live, and the live state chip;
  - confirmed-good states: high-confidence ribbon tiles, the `Confirmed` badge and the `Active` plan badge.
  
  Nothing else uses the accent.
- **Caution:** a warm amber for low-confidence tiles, the `Pending` badge, and the quota-halt and outage banners.
- **Rules:** one-pixel hairlines in a dim grey separate regions on a 12-column grid.

**Type.**
- Display headings use Space Grotesk, which has a geometric, slightly technical feel.
- Body text uses Inter.
- Every number (minutes, cents, frames, bins, timestamps, percentages) uses a monospaced face with tabular figures and a fixed number of decimal places, so columns of figures line up.
- Starting from body text, each heading step is about a quarter larger than the one below it.

**Density.** Compact: tight tables, short rows and small gaps.

**Composition.**
- On the public site, the field is a full-bleed hero, and overlay type stays in the left four columns.
- In the console, a fixed rail sits beside the workspace. The confidence ribbon and the field always head their pane, and the stat strip sits right-aligned beneath the field.

**Touch and accessibility.**
- On touch layouts, every interactive control is at least 44 px by 44 px.
- Text and meaningful graphics meet WCAG 2.2 AA contrast against the near-black ground.
- The focus ring is a two-pixel pale outline and is always visible.

### Motion and effects (DP-02, DP-26, DP-27, DP-28, DP-30, DP-43)

All motion starts quickly and settles softly. Apart from the continuous field, no transition lasts longer than half a second.

**Confidence Strata, the session field.**

*The scene.*
- It is a WebGL 3D terrain, seen from a fixed camera above and in front, looking down at a shallow angle with a narrow field of view.
- The terrain is 64 frequency bins across, from low frequencies at the left to high at the right, and 240 history rows deep.
- The newest row is at the front edge. Its heights are the session's spectrum values from Business rules. Older rows recede into the distance.

*The readback strip.*
- The bottom 48 pixel rows of the canvas are a flat strip of 64 bars across the full canvas width, mirroring the front row, with the lowest bin at the left.
- The canvas's drawing buffer is exactly its displayed size, one buffer pixel per layout pixel. It is preserved between frames, so its pixels can be read at any time.
- With `W` the canvas width in pixels, bar `i` occupies columns ⌊i·W/64⌋ to ⌊(i+1)·W/64⌋−1. It is a solid fill rising from the bottom row.
- Everything else in the strip is the ground. A bar's lit height is the number of its non-ground pixel rows counted from the bottom, and it equals round(value × 48) within 2 pixels.
- Bars are accent while live, pale grey when closed, and dim grey when halted.
- While live, a bar rises within about a twentieth of a second and falls back over about a quarter of a second, smoothed frame by frame. Once the front row stops changing, the bars settle on the exact heights within half a second.
- For a closed session, the strip mirrors the last row returned by the spectrum endpoint.
- With the bundled 1 kHz tone fixture, the tallest bar is the peak bin given in Business rules.

*Data attributes.* The canvas carries four:
- `data-session-state` is one of `idle`, `connecting`, `live`, `closed` or `quota_halted`:
  - `idle` means no session is loaded;
  - `closed` covers the server states `closed` and `idle_closed`;
  - `quota_halted` covers `quota_halted` and `revoked`, both frozen halts.
- `data-end-state` is the exact server state.
- `data-frame` is the server frame number of the row drawn at the front: the latest `frame` event while open, or the spectrum endpoint's `frame` for an ended session.
- `data-peak-bin` is that same row's `peak_bin`.

*Order of change.*
1. While `connecting`, the terrain lies flat at its baseline, and no strip bar is taller than 2 pixels.
2. On `live`, rows advance at 30 rows per second, newest at the front.
3. On `quota_halted` or `revoked`, the field stops advancing and fades to grey in about a quarter of a second. The strip keeps its last frame.
4. On `closed` or `idle_closed`, the field stops advancing.
5. A closed session shows its last 240 stored rows, without motion.

*Ribbon retint.* When an approved correction lifts a segment to the high band, its tiles change colour over about a third of a second. The only triggers are the ones in Interactions, "Deciding a correction".

*The hero.* The public hero runs the same scene on the bundled demo spectrum. This is the one named loop: it replays the 12-second demo at 30 rows per second and then starts over. Its `data-session-state` is `live`.

**Signal path scroll.**
- The hero and the Signal path panel stay pinned while the visitor scrolls the first 1,600 pixels of the page.
- Each stage owns one fifth of that range: 0–319 Capture, 320–639 Stream, 640–959 Recognise, 960–1279 Review, 1280–1600 Meter.
- The active stage's text fades in, and the previous stage's text fades out, each within about a quarter of a second.
- `data-stage` and `aria-current` follow the scroll position.
- The field emphasises each stage in turn:
  - Capture: only the strip moves.
  - Stream: rows advance.
  - Recognise: the ribbon appears.
  - Review: low tiles show their hatching.
  - Meter: the stat strip figures count up.
- Scrolling back up walks back through the stages in reverse, one by one, at the same thresholds.

**List-to-detail morph.**
- Opening a session from the Sessions table grows that row's spectrum thumbnail into the detail field header. The morph takes about 0.4 seconds, starting fast and easing to a stop. Then the live field takes over.
- The row's thumbnail and the detail field header carry the same `data-morph` value.
- During the morph, one element carrying that value moves and grows from the thumbnail's on-screen position and size to the field header's. It takes between 0.3 and 0.5 seconds and is seen at in-between positions on the way. Afterwards it sits exactly on the field header.
- Under reduced motion, the field header is at its final position on the first painted frame of the detail page, with no in-between positions.

**Other feedback.**
- Dialogs fade in and rise slightly, within about a fifth of a second.
- Buttons darken on press, within a tenth of a second.
- The quota meter fill slides to its new value within a quarter of a second.

**No unnamed decorative loops.** Nothing moves continuously except the session field and the hero's named demo loop.

**Reduced motion.** When the operating system's reduce-motion setting is on:
- The terrain stops scrolling and holds one frame.
- The readback strip and `data-frame` step once per second to the latest row, with no easing. For a live session at real time, each step advances `data-frame` by about 30.
- Ribbon tiles change colour instantly, and the halt greys out instantly.
- The Signal path shows all five stages at once as static labelled panels, with `data-stage="5"`.
- The list-to-detail morph becomes an instant swap.
- The hero holds the demo's first frame.

**Still fallback without WebGL.**
- A 2D canvas still image replaces the scene, with the same accessible name and the same four data attributes. The `Segment confidence` table sits beside it.
- The still draws the session's `mean` spectrum in the same 48-pixel strip, under the same column and height contract: bar `i`'s lit height is round(`mean[i]` × 48) within 2 pixels of the `mean` it was drawn from.
- **Refresh.** For a `connecting` or `live` session, the still is redrawn once per second, with no easing, from the `mean` in a fresh read of the spectrum endpoint; its bars match that reading. For an ended session it is drawn once from the final `mean` and doesn't change.
- **Attributes stay front-row values.** `data-frame` and `data-peak-bin` keep the meaning given above (the front row's frame and peak bin) and are never derived from the drawn mean. So the tallest drawn bar can differ from `data-peak-bin` for a changing signal; for a steady signal such as the tone fixture, both name the published peak bin.

### Feedback states (DP-03, DP-04, DP-10, DP-13, DP-14, DP-15, DP-20, DP-23, DP-25, DP-36, DP-39, DP-41, DP-43, DP-50, DP-53, DP-54)

Every string in backticks renders character for character, with straight apostrophes. Placeholders in angle brackets are filled as described.

Each async action is announced once, in its named polite `status` region, and announcements never move focus. A field error appears under its field and is linked to it, and the field is marked invalid.

**Session status (detail screens).** When a detail page loads or reloads, the region already holds the copy for the session's current server state. That counts as the one announcement for that state. Each later state change replaces it once.

| Server state | Copy |
|---|---|
| connecting | `Session connecting.` |
| live | `Session live.` |
| closed, reason `client`, `disconnect` or `end_of_audio` | `Session closed.` |
| closed, reason `cap` | `Session closed: time limit reached.` |
| idle_closed | `Session closed: no audio received.` |
| quota_halted | `Session halted: project quota reached.` |
| revoked | `Session ended: API key revoked.` |

**Quota status (the quota-halt banner).** Shown on every project tab and detail screen of an exhausted project, and after a refused start:

`Quota reached. This project's <quota> audio minutes for <month> are used up. New sessions are refused until <reset date> UTC or until an admin raises the quota.`

- `<quota>` is the limit in whole minutes, with no separators.
- `<month>` is the current UTC month, written like `October 2026`.
- `<reset date>` is the first day of the next UTC month, written like `1 November 2026`.
- All three come from the server's quota object.

**Service status (outage banners).**
- **Billing outage**, on Usage and Plan while billing is unreachable:
  `Billing is unreachable. Figures marked Pending will confirm automatically once it's back.`
- **Storage outage**, after a session start, upload or playback (session, segment or synthesis audio) fails because storage is unreachable:
  `Audio storage is unreachable. Playback and uploads will resume once it's back, and nothing you've typed is lost.`
- Once shown, the storage banner stays through every repaint, event-stream frame and move between console screens. It clears only when the console's next request that touches storage succeeds.

**Plan status.**
- Requested: `Waiting for billing to confirm the <plan> plan.`
- Confirmed: `<plan> plan is active.`
- Failed: `Billing declined the change. You're still on the <current plan> plan.`
- Billing unreachable when requested: `Billing is unreachable, so your plan hasn't changed. Try again in a minute.`
- `<plan>` and `<current plan>` are `Pilot` or `Scale`.

**Usage badges.** `Confirmed` or `Pending`.

**Review status.**

| Event | Copy |
|---|---|
| Draft saved | `Draft saved.` |
| Submitted | `Correction submitted for approval.` |
| Approved | `Correction approved. Reviewed transcript updated.` |
| Returned | `Correction returned to <author name>.` |
| Reopened | `Correction reopened as a draft.` |
| Open-correction conflict | `Another reviewer already has an open correction on this segment.` |
| Own correction | `You can't approve your own correction.` |
| Already decided | `This correction was already decided.` |
| Corrected text field error | `Enter the corrected words.` |
| Return note field error | `Add a note of up to 500 characters.` |
| Inspector empty prompt | `Select a flagged segment to review it.` |

Button labels while a request is pending:
- the submit button reads `Submitting`;
- the approve button reads `Approving`;
- the return button reads `Returning`.

**Upload status (Start session).**
- Pending: `Uploading audio`.
- Audio field error: `Upload a 16 kHz, 16-bit PCM WAV file with one or two channels.`
- Too large (an audio file over its limit, or a `413` reply): `Audio files can be up to 50,000,000 bytes.`
- Sidecar field error: `The sidecar must be WebVTT with one confidence per word.`
- Key field error: `Choose an active API key.`
- Refused for quota: the quota-halt banner.
- Storage unreachable: the storage outage banner.

**Keys status.**
- Project created: `Project created. Issue its first API key.`
- Key issued: `Key created. Copy it now; it won't be shown again.`
- Key revoked: `Key revoked. Live sessions closed: <n>.`, where `<n>` is the count the API returns.
- Key name field error: `Enter a key name of up to 60 characters.`

**New project field errors.** The quota error is shared with Settings.
- Name: `Enter a project name of up to 60 characters.`
- Name taken: `A project with this name already exists.`
- Quota: `Enter a whole number of minutes from 1 to 1000000.`

**Settings status.** `Quota saved.`

**Billed minutes (calculator).**
- Empty field, at load or after clearing: the status is empty and no field error shows.
- Valid length: `Pilot: <pilot> billed minutes. Scale: <scale> billed minutes.` Each value is billed minutes with two decimals.
- Any non-empty value that isn't a valid length as defined in Business rules: the field error `Enter a length from 0 to 3600 seconds.`, with the status left empty.

**Trial status.**
- Success, including on a repeat: `Trial request received. We reply within two working days.`
- Field errors: `Enter your name.`, `Enter a work email address.`, `Enter your company.`

**Sign-in status.** `That email and password don't match.`

**Join status.**
- Link already used: `This invitation has already been used.`
- Password field error: `Use at least 12 characters.`

**Members status.**
- Invitation created: `Invitation created. Share the link below with <name>.`
- `Member updated.`
- `Member removed.`
- Changing or removing yourself: `You can't change or remove your own membership.`
- Invitation name field error: `Enter a name of up to 100 characters.`

**Search results.** `<n> sessions found.`, or `1 session found.` when there is exactly one.

**Synthesis status.**
- Pending: `Rendering`.
- Success: `Rendered <seconds> seconds of audio.`, where `<seconds>` is the duration with three decimals.
- Text field error: `Enter 1 to 1000 characters.`

**API field errors.** Every `422 validation_failed` lists each failing field under `fields`, keyed by its request field name, and each message is the copy in this table. The `Idempotency-Key` header reports as `idempotency_key`; `/v1/listen` query values report under their query names. Rows that name a copy by reference use the string given above in this section. This table is the complete set of field messages.

| Endpoint | Field | Message |
|---|---|---|
| `POST /api/trial-requests` | `name`, `email`, `company` | the Trial status field errors, in that order |
| `POST /api/trial-requests` | `team` | `Choose a team.` |
| `POST /api/org/invitations` | `name` | the Members invitation name field error |
| `POST /api/org/invitations` | `email` | `Enter an email address of up to 200 characters.` |
| `POST /api/org/invitations`, `PATCH /api/org/members/<member_id>` | `role` | `Choose a role.` |
| `POST /api/org/invitations`, `PATCH /api/org/members/<member_id>` | `project_ids` | `Choose projects from the list.` |
| `POST /api/invitations/<token>/accept` | `password` | the Join password field error |
| `POST /api/projects` | `name` | the New project Name error |
| `POST /api/projects`, `PATCH /api/projects/<project_id>/quota` | `monthly_quota_minutes` | the New project Quota error |
| `POST /api/projects/<project_id>/keys` | `name` | the Keys key name field error |
| `POST /api/projects/<project_id>/sessions`, `POST /api/projects/<project_id>/synthesis` | `key_id` | the Upload key field error |
| `POST /api/projects/<project_id>/sessions` | `source` | `Choose a source.` |
| `POST /api/projects/<project_id>/sessions` | `audio` | the Upload Too large copy for an over-size file, otherwise the Upload Audio field error |
| `POST /api/projects/<project_id>/sessions` | `sidecar` | the Upload Sidecar field error |
| `POST /api/projects/<project_id>/sessions`, `GET /v1/listen` | `label` | `Enter a label of up to 80 characters.` |
| `POST /api/projects/<project_id>/sessions`, `POST /api/org/plan-changes` | `idempotency_key` | `Use an idempotency key of 1 to 100 characters.` |
| `GET /v1/listen` | `channels` | `Use 1 or 2 channels.` |
| `GET /v1/listen` | `sample_rate` | `Use a sample rate of 16000.` |
| `GET /api/sessions/search` | `q` | `Enter 1 to 100 characters.` |
| `POST /api/sessions/<session_id>/segments/<segment_id>/corrections`, `PATCH /api/corrections/<correction_id>` | `text` | the Corrected text field error |
| `POST /api/corrections/<correction_id>/return` | `note` | the Return note field error |
| `POST /api/projects/<project_id>/synthesis`, `POST /v1/speak` | `text` | the Synthesis text field error |
| `POST /api/projects/<project_id>/synthesis`, `POST /v1/speak` | `voice` | `Choose a voice.` |
| `POST /api/org/plan-changes` | `plan` | `Choose Pilot or Scale.` |

- `project_ids` fails validation only when it isn't a list of ids. A listed id outside the caller's organisation answers `404 not_found` by the error precedence.
- `POST /api/auth/sign-in` never answers `422`: any missing or wrong value answers `401 invalid_credentials`.

**Generic failure, in any region.** `Something went wrong. Try again.`

## Backend

### API (DP-04, DP-05, DP-06, DP-09, DP-11, DP-12, DP-13, DP-14, DP-15, DP-17, DP-23, DP-24, DP-25, DP-37, DP-39, DP-41, DP-42, DP-48, DP-50, DP-53, DP-54)

**Conventions.**
- JSON bodies are UTF-8. A request with a JSON body must send `Content-Type: application/json`, or it gets `415`.
- JSON bodies may be up to 65,536 bytes. Anything larger gets `413`.
- Multipart bodies may be up to 50,400,000 bytes in total, and that size itself is allowed. Anything larger gets `413`. This leaves room for the largest allowed audio file, sidecar and fields, so an audio file just over its own limit gets the `422` audio field error, not `413`.
- Times are ISO 8601 UTC with milliseconds and `Z`. Ids are UUIDs. Money fields end in `_cents` and are integers.
- `server_time` is a key inside every Session object and every Quota object, as listed under Objects, wherever those objects appear: as a response body's `session`, in lists, nested in a `project`, as a `PATCH …/quota` reply's `quota`, and in `quota` and `state`-carrying events that hold those objects. It holds the server's clock when that object was built. It is never added at the top level of a response. The WebSocket `quota` message is not a Quota object and has no `server_time`.
- Text fields are measured and stored as the text-limit rule in Business rules says.

**Authentication.**
- Console routes under `/api` use the session cookie set at sign-in or join.
- Routes under `/v1` use `Authorization: Token <key>`.
- Public routes: `/api/health`, `/api/trial-requests`, `/api/public/demo-spectrum`, `/api/auth/sign-in`, `/api/invitations/<token>/accept` and `/fixtures/...`.

**Error shape.**
- Every error body is `{"error":"<code>","message":"<human text>"}`.
- Validation errors add `"fields":{"<field>":"<message>"}`. The field messages are those in Feedback states under API field errors.

**Error precedence.** When several errors apply, the first one in this order is returned:
1. `413` or `415`.
2. `401`: `unauthenticated` on `/api`, `invalid_key` on `/v1`.
3. `404 not_found`: an unknown id, another organisation's id, or a project the caller isn't assigned to, including ids inside bodies such as `key_id`.
4. `403`.
5. Idempotency outcomes: the stored response replayed, `409 idempotency_conflict`, or `409 idempotency_in_progress`.
6. State conflicts: `409` and `429`.
7. `422 validation_failed`.
8. `503`: provider unavailable.

The rows below list only each endpoint's own extra errors.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | none | `200 {"status":"ok"}` | |
| `POST /api/auth/sign-in` | `{"email","password"}` | `200 {"user":{"id","name","email","role","org_id"},"landing":"<route>"}`; sets the cookie | `401 invalid_credentials` |
| `POST /api/auth/sign-out` | none | `204` | |
| `GET /api/me` | none | `200 {"user":{...},"org":{"id","name","slug","plan"},"project_ids":[...]}` | |
| `POST /api/trial-requests` | `{"name","email","company","team":"contact_centre"\|"clinical_dictation"}` | `201 {"id","received_at"}`. A repeat from the same email returns `200` with the first `id` and `received_at` | `422` |
| `GET /api/public/demo-spectrum` | none | `200 {"frame_rate":30,"rows":[[64 numbers],...]}` | |
| `GET /api/org/members` | none | `200 {"members":[{"id","name","email","role","project_ids","joined_at"}],"invitations":[{"id","name","email","role","project_ids","used":false}]}` | |
| `POST /api/org/invitations` | `{"name","email","role":"admin"\|"developer"\|"reviewer"\|"approver"\|"billing","project_ids":[...]}` | `201 {"id","invite_url":"/join/<token>"}` | `409 email_taken`, `422` |
| `POST /api/invitations/<token>/accept` | `{"password"}` | `201 {"user":{...},"landing":"<route>"}`; sets the cookie | `404` for an unknown token, `410 invitation_used`, `422` |
| `PATCH /api/org/members/<member_id>` | `{"role"?,"project_ids"?}` | `200 {"member":{...}}` | `409 self_change`, `422` |
| `DELETE /api/org/members/<member_id>` | none | `204` | `409 self_change` |
| `GET /api/projects` | none | `200 {"projects":[{"id","name","sessions","quota":{...}}]}` | |
| `POST /api/projects` | `{"name","monthly_quota_minutes"}` | `201 {"project":{"id","name","sessions","quota":{...}}}` | `409 name_taken`, `422` |
| `GET /api/projects/<project_id>` | none | `200 {"project":{...}}` | |
| `PATCH /api/projects/<project_id>/quota` | `{"monthly_quota_minutes"}` | `200 {"quota":{...}}`, as this request committed it | `422` |
| `GET /api/projects/<project_id>/keys` | none | `200 {"keys":[{"id","name","prefix","created_at","revoked_at"}]}` | |
| `POST /api/projects/<project_id>/keys` | `{"name"}` | `201 {"key":{"id","name","prefix","created_at","revoked_at":null},"secret":"lf_live_<32 hex>"}` | `422` |
| `DELETE /api/projects/<project_id>/keys/<key_id>` | none | `200 {"key":{...,"revoked_at"},"closed_sessions":["<session_id>",...]}` | `409 already_revoked` |
| `POST /api/projects/<project_id>/sessions` | multipart: `key_id`, `source` (`tone` or `upload`), `audio` (file, required for upload), `sidecar` (optional file), `label` (optional). Optional header `Idempotency-Key` | `201 {"session":{...}}` | `409 key_revoked`, `429 quota_exhausted`, `422`, `503 storage_unavailable` |
| `GET /api/projects/<project_id>/sessions` | optional `?state=<state>` | `200 {"sessions":[...]}`, newest first | |
| `GET /api/sessions/search` | `?q=<text>` | `200 {"total":<n>,"sessions":[...]}`, newest first, at most 50 | `422` |
| `GET /api/sessions/<session_id>` | none | `200 {"session":{...}}` | |
| `GET /api/sessions/<session_id>/events` | none | `200 text/event-stream` with the events below | |
| `GET /api/sessions/<session_id>/spectrum` | none | `200 {"frame","peak_bin","rows":[[64 numbers],...],"mean":[64 numbers]}`. `rows` holds the last 240 rows at most, oldest first; `frame` and `peak_bin` describe the last of them; `mean` covers every row received so far | |
| `POST /api/sessions/<session_id>/close` | none | `200 {"session":{...}}` | `409 session_ended` |
| `GET /api/sessions/<session_id>/audio` | none | `200` with the retained original bytes: `audio/wav` for uploads and tone, `audio/L16;rate=16000;channels=<n>` for live captures | `503 storage_unavailable` |
| `GET /api/sessions/<session_id>/transcript` | none | `200 {"segments":[segment...],"wer":<number or null>}` | |
| `GET /api/sessions/<session_id>/transcript/machine.json` | none | `200 application/json` with the stored artifact bytes, unchanged | `409 session_open` while the session hasn't ended, `503 storage_unavailable` |
| `GET /api/sessions/<session_id>/segments/<segment_id>/audio` | none | `200 audio/wav`, the segment's slice of the retained audio | `503 storage_unavailable` |
| `POST /api/sessions/<session_id>/segments/<segment_id>/corrections` | `{"text"}` | `201 {"correction":{...}}`, in `draft` | `409 correction_open`, `422` |
| `PATCH /api/corrections/<correction_id>` | `{"text"}` | `200 {"correction":{...}}` | `403 not_author`, `409 invalid_transition`, `422` |
| `POST /api/corrections/<correction_id>/submit` | none | `200 {"correction":{...}}` | `403 not_author`, `409 invalid_transition` |
| `POST /api/corrections/<correction_id>/approve` | none | `200 {"correction":{...},"segment":{...},"wer":<number>}` | `403 own_correction`, `409 invalid_transition` |
| `POST /api/corrections/<correction_id>/return` | `{"note"}` | `200 {"correction":{...}}` | `403 own_correction`, `409 invalid_transition`, `422` |
| `POST /api/corrections/<correction_id>/reopen` | none | `200 {"correction":{...}}` | `403 not_author`, `409 invalid_transition` |
| `GET /api/projects/<project_id>/corrections` | optional `?state=<state>` | `200 {"corrections":[...]}` | |
| `POST /api/projects/<project_id>/synthesis` | `{"key_id","text","voice":"lumen"\|"basalt"}` | `201 {"job":{...}}` | `409 key_revoked`, `422`, `503 storage_unavailable` |
| `GET /api/projects/<project_id>/synthesis/<job_id>/audio` | none (session cookie) | `200 audio/wav`, the job's stored render | `503 storage_unavailable` |
| `GET /api/usage` | none | `200 {"month":"YYYY-MM","billing_reachable":<bool>,"org_total_cents","projects":[{"project_id","name","sessions","billable_seconds","cost_cents","billing_state":"confirmed"\|"pending","pending_sessions","by_plan":[{"plan","billable_seconds","cost_cents"}]}]}` | |
| `GET /api/org/plan` | none | `200 {"plan":"pilot"\|"scale","billing_reachable":<bool>,"change":null\|{"id","target","state","requested_at","decided_at"}}` | |
| `POST /api/org/plan-changes` | `{"plan":"pilot"\|"scale"}`. Optional header `Idempotency-Key` | `202 {"change":{...,"state":"requested"}}` | `409 plan_unchanged`, `409 change_pending`, `422`, `503 billing_unavailable` |
| `GET /v1/listen` (WebSocket upgrade) | `Authorization: Token <key>`. Query: `channels=1\|2` (default 1), optional `sample_rate` (must be `16000`), optional `label` | `101` | Before the upgrade, as plain HTTP: `401 invalid_key`, `429 quota_exhausted`, `422`, `503 storage_unavailable` |
| `POST /v1/speak` | `{"text","voice"}` | `201 {"job":{...}}` | `401 invalid_key`, `422`, `503 storage_unavailable` |
| `GET /v1/speak/<job_id>/audio` | `Authorization: Token <key>` of the same project | `200 audio/wav` | `401 invalid_key`, `503 storage_unavailable` |
| `GET /fixtures/tone-1khz.wav` | none | `200 audio/wav`, the bundled tone fixture | |

**Objects.**
- **Quota:**
  `{"limit_minutes","used_seconds","period_start","resets_at","exhausted":<bool>,"server_time"}`
- **Session:**
  `{"id","project_id","kind":"live"|"replay","source":"live"|"tone"|"upload","label","state","close_reason":null|"client"|"disconnect"|"end_of_audio"|"cap","channels","sample_rate":16000,"audio_ms","frame","plan","key_id","started_at","live_at","ended_at","billable_seconds":null|<int>,"billing_state":"open"|"not_billable"|"pending"|"confirmed","flagged_segments","wer":null|<number>,"server_time"}`
- **Segment:**
  `{"id","index","start_ms","end_ms","flagged","machine":{"text","words":[{"text","confidence","start_ms","end_ms"}]},"reviewed":{"text","words":[...],"source":"machine"|"correction","correction_id"},"open_correction":null|{"id","state","author_id"}}`
- **Correction:**
  `{"id","session_id","segment_id","author":{"id","name"},"state","text","note","created_at","submitted_at","decided_at","decided_by"}`
- **Synthesis job:**
  `{"id","project_id","voice","characters","duration_ms","audio_url":"/v1/speak/<job_id>/audio","console_audio_url":"/api/projects/<project_id>/synthesis/<job_id>/audio","created_at"}`

**Event stream, `/api/sessions/<session_id>/events`.**
- `state`: `{"state","close_reason"}`.
- `frame`: `{"frame","audio_ms","peak_bin","bins":[64 numbers]}`. At most 30 per second, always the latest.
- `segment`: a segment object.
- `correction`: `{"segment","wer"}`, sent on every approval.
- `quota`: a quota object, sent at least every 2 seconds while the session is live.

The stream ends after the final `state` event.

**Live WebSocket protocol.**

Client messages:
- **Sidecar.** The first text message may be `{"type":"sidecar","vtt":"<WebVTT text>"}`, up to 200,000 bytes. A sidecar sent any later is answered with `{"type":"error","error":"sidecar_too_late"}` and ignored.
- **Audio.** Binary messages are interleaved signed 16-bit little-endian PCM at 16,000 Hz.
  - A message may be up to 64,000 bytes, and that size itself is allowed.
  - A larger message closes the socket with code `1009`.
  - A message that isn't a whole number of sample frames closes the socket with code `1007`.
  - Either way, the session ends as `closed` with reason `client`.
- **Close.** The text message `{"type":"close"}` ends the session as `closed` with reason `client`.

Server messages:
- `{"type":"session","session_id"}`, right after the upgrade.
- `{"type":"state","state","close_reason"}`, on every state change.
- `{"type":"segment","segment":{...}}`, as each segment becomes final.
- `{"type":"quota","used_seconds","limit_seconds"}`, every 2 seconds.

After the final state, the socket closes with one of these codes:

| Final state | Close code |
|---|---|
| `closed` | `1000` |
| `idle_closed` | `4000` |
| `quota_halted` | `4002` |
| `revoked` | `4003` |

### Business rules (DP-03, DP-04, DP-06, DP-07, DP-08, DP-11, DP-12, DP-13, DP-14, DP-15, DP-18, DP-19, DP-23, DP-24, DP-25, DP-29, DP-34, DP-35, DP-37, DP-39, DP-41, DP-42, DP-43, DP-45, DP-46, DP-47, DP-48, DP-50, DP-51)

**Text-limit rule.** Every text limit counts Unicode code points, measured after NFC normalisation and after trimming leading and trailing Unicode whitespace.
- Both bounds are allowed.
- A value that is empty after trimming fails a minimum of 1.
- The stored value is that trimmed NFC string.
- Passwords are the exception: they count code points without trimming or normalisation.
- "Unicode whitespace" means every character with the Unicode White_Space property, including the no-break space (U+00A0) and the ideographic space (U+3000).
- Wherever this brief says "words", it means the runs of text between Unicode whitespace.

| Field | Limit (code points) |
|---|---|
| Project name, key name | 1 to 60 |
| Session label | 0 to 80; optional |
| Correction text, return note | 1 to 500 |
| Synthesis text | 1 to 1,000 |
| Search query `q` | 1 to 100 |
| Trial name, trial company, invitation name | 1 to 100 |
| Trial email, invitation email | up to 200, with exactly one `@` and text on both sides |
| `Idempotency-Key` header | 1 to 100 |
| Password | at least 12 |

A value outside its limit gets `422` with its field message from Feedback states.

**Roles and visibility.**
- Each member has one role in one organisation.
- Admins and billing viewers see every project in their organisation.
- Developers, reviewers and approvers see only the projects they are assigned to.
- A project outside the caller's visibility, and anything inside it, answers `404 not_found`.

**Permission table.** A role not listed for an action gets `403 forbidden`.

| Action | Allowed roles |
|---|---|
| Read own profile (`GET /api/me`); sign out | admin, developer, reviewer, approver, billing |
| List projects and read a project with its quota (`GET /api/projects`, `GET /api/projects/<project_id>`); open the Projects list | admin, developer, reviewer, approver, billing |
| Create projects; set quotas and open the Settings tab; list and manage members and invitations; read and change the plan | admin |
| List keys and open the Keys tab | admin, developer |
| Issue and revoke keys; start and stop sessions; run synthesis, play rendered synthesis audio through the console route, and open the Synthesis tab | admin, developer |
| List and view sessions; search sessions; the field, transcripts, retained audio and artifacts; open the Sessions tab | admin, developer, reviewer, approver |
| List corrections and open the Review tab | admin, developer, reviewer, approver |
| Create, edit, submit and reopen corrections | reviewer, approver |
| Approve or return corrections | approver |
| Read usage | admin, billing |

Opening a console route for an action the role isn't allowed redirects to that role's landing route. Billing viewers never receive transcript text or audio from any endpoint.

**Membership changes.**
- Role changes, assignment changes and removals take effect on the member's next request. A removed member's existing cookie gets `401 unauthenticated`.
- An admin who changes or removes their own membership gets `409 self_change`.
- Invitations are single-use and don't expire. A second accept gets `410 invitation_used`.
- An invitation to an email already used by a member, or by an open invitation, gets `409 email_taken`.

**Projects and quota.**
- **Unique names.** Two names match when they are equal after the text-limit rule and Unicode lower-casing. The database decides this with a unique constraint on that folded form. When several creates with matching names arrive at once, exactly one gets `201` and every other gets `409 name_taken`. Exactly one project row results.
- **Quota value.** `monthly_quota_minutes` is a whole number from 1 to 1,000,000, both ends allowed.
- **Concurrent quota saves.** Each `PATCH …/quota` applies whole. The final `limit_minutes` is that of the last request committed, and each `200` reply carries the quota as that request committed it.
- **The period.** The quota period is the current calendar month in UTC, by the server's clock.
  - `period_start` is the first of the month at 00:00 UTC.
  - `resets_at` is the first of the next month at 00:00 UTC.
  - The browser never computes either one.
- **Usage.** `used_seconds` is derived from the stored sessions on every read. It is never a counter that is incremented separately. It is the sum of:
  - the billable seconds of the project's sessions that ended within the period; and
  - for each session still open, its received audio milliseconds × its channels ÷ 1,000, rounded down.
- **Exhausted.** `exhausted` is true when `used_seconds` is at least `limit_minutes` × 60.
- **Meter display.** The meter format is `<used> / <limit> min`.
  - `<used>` is `used_seconds` ÷ 60, rounded half up to two decimals.
  - `<limit>` is `limit_minutes`, with no separators.
  - The progressbar value is `used_seconds` ÷ (`limit_minutes` × 60) × 100, rounded half up to a whole number and capped at 100.
- **One figure everywhere.** These surfaces all report the same `used_seconds` for the same moment, each fresh to within 2 seconds of audio being received:
  - the Projects list cell;
  - the project header meter;
  - the detail stat strip's Quota used (same format);
  - `quota` events;
  - the WebSocket `quota` message;
  - `GET /api/projects` and `GET /api/projects/<project_id>`.

**Quota enforcement.**
- **Halting.** As soon as a project is exhausted, every open session on it ends as `quota_halted` within 1 second. This applies whichever key a session uses and whichever socket carries it, and whether usage crossed the limit through audio accrual or because an admin lowered the quota to or below `used_seconds`.
- **Billing after a halt.** Each halted session's billable seconds are then computed by the normal rule. After the halt, `used_seconds` equals the sum of the halted sessions' billable seconds plus those of the period's earlier closed sessions, and it may exceed the limit by that rounding.
- **Refusals.** While a project is exhausted, every new start (live, tone or upload) is refused with `429 quota_exhausted`.
- **Raising the quota.** Raising the quota above `used_seconds` allows new starts again at once. Halted sessions stay halted.
- **Monthly reset.** At `resets_at`, usage starts again from zero for the new month.

**API keys.**
- A key is `lf_live_` followed by 32 lowercase hex characters. Only its hash is stored. `prefix` is the key's first 12 characters.
- Revoking a key:
  - sets `revoked_at`;
  - ends every open session started on it as `revoked` within 2 seconds;
  - makes every later `/v1` request with it get `401 invalid_key`;
  - makes every later console start or synthesis that names it get `409 key_revoked`.
- Revoking a key twice gets `409 already_revoked`.

**Session state machine.** `connecting → live → closed | idle_closed | quota_halted | revoked`.
- A session is created in `connecting`. It becomes `live` once its capture object exists in storage.
- The end states are final. Any action that needs an open session gets `409 session_ended`.
- Only the server moves a session between states. Clients only request a close.
- Close reasons for `closed`:
  - `client`: a close message, Stop session, or a protocol error;
  - `disconnect`: the socket dropped;
  - `end_of_audio`: a replay or tone session reached the end of its file;
  - `cap`: the time cap was reached.
- **Idle close.** A live session that receives no audio message for `LOWFIELD_IDLE_SECONDS` seconds (default 30) ends as `idle_closed`.
- **Time cap.** A session ends as `closed` with reason `cap` when either its wall time since `live_at` or its received audio reaches `LOWFIELD_SESSION_CAP_SECONDS` seconds (default 3,600).
- **Speed.** Replay and tone sessions are fed through the recognizer at real time: one second of audio per second of wall time. Live streams are processed as fast as they arrive.

**Stream lifecycle.**
- **Labelled connection.** For as long as it stays open, each live socket and each `/events` stream holds exactly one dedicated Postgres connection whose `application_name` is `lowfield-stream:<session_id>`. No other connection uses that prefix. The dedicated connection is never left idle inside a transaction.
- **Release.** Within 5 seconds of the client leaving (a socket dropped, a tab closed, an event stream aborted), that connection is gone from the server's connection list.
- **Dropped socket.** A dropped live socket also ends its session as `closed` with reason `disconnect`, within the same 5 seconds.
- **No leaks.** Repeated drops leave no app connection active or idle inside a transaction, and the app's total connection count doesn't grow.

**Recognizer stand-in: spectrum.**
- Each row covers one thirtieth of a second of audio, so 10 seconds of audio make 300 rows. `frame` counts rows from 0.
- Each row is computed from the most recent 2,048 samples (zero-padded before the start), with the channels averaged, using a Hann window and a real FFT. Levels are in dBFS, where a full-scale sine reads 0 dB.
- Bin `i` (0 to 63) covers frequencies from 80 × 100^(i/64) Hz up to, but not including, 80 × 100^((i+1)/64) Hz.
  - Its level is the strongest FFT bin in that range.
  - A band that contains no FFT bin takes the FFT bin nearest its geometric centre.
- The normalised value is (dB + 90) ÷ 80, clamped to the range 0 to 1 and rounded to three decimals.
- `peak_bin` is the index of the largest value, taking the lowest index on a tie. For the bundled 1 kHz tone fixture, the peak bin is 35.
- `mean` is the average of all rows received so far, bin by bin.

**Recognizer stand-in: words.**
- **The sidecar format.** Words come from the WebVTT sidecar.
  - The file starts with `WEBVTT`.
  - Each cue has a timing line `[HH:]MM:SS.mmm --> [HH:]MM:SS.mmm`, followed by exactly one text line of space-separated tokens written `word@confidence`. The confidence is a number from 0 to 1 with at most two decimals.
  - Cues must be in order and must not overlap, and each cue must end after it starts. Otherwise the start gets `422`, field `sidecar`.
- **Segments.** Each cue becomes one segment. Its words divide the cue's span evenly: word `k` of `n` starts at start + k × span ÷ n, rounded down to the millisecond.
- **Becoming final.** A segment becomes final when the received audio passes its end time. At close, cues that start beyond the received audio are dropped, and a cue cut off by the end of the audio keeps its words.
- **No sidecar.** A session with no sidecar has no segments.
- **Flagging.** A segment is flagged when its lowest machine word confidence is below 0.85.
- **Ribbon bands.**
  - high: 0.85 and above;
  - medium: from 0.60 up to, but not including, 0.85;
  - low: below 0.60.
- Reviewed words from an approved correction have confidence 1.00.

**Uploads.**
- `audio` must be a RIFF WAV file of 16-bit PCM at 16,000 Hz, with one or two channels, and up to 50,000,000 bytes (that size itself allowed). Otherwise the start gets `422`, field `audio`.
- `sidecar` may be up to 200,000 bytes, and that size itself is allowed. A larger sidecar gets `422`, field `sidecar`.
- The `tone` source uses the bundled tone fixture.

**Idempotency.** Session starts and plan changes accept an optional `Idempotency-Key`.
- **Scope.** Each key is scoped to the calling member. Another member sending the same key value gets an independent evaluation.
- **Kept.** Records are kept for at least 24 hours.
- **What is stored.** A result is stored only for requests that began executing and ended with a `2xx`, a `409` state conflict, or a `429`.
- **What is not stored.** A `422` or a `503` stores nothing, so a retry with the same key is processed afresh.
- **Replay.** A repeat with the same key and the same request gets the stored status and body, byte for byte. Same request means the same method, path and field values, plus the same file bytes for multipart. The replay holds even when state has moved on since: a replayed plan-change `202` still says `requested` after the change was confirmed.
- **Conflict.** The same key with a different request gets `409 idempotency_conflict`.
- **In progress.** While the first request with a key is still executing, a duplicate with that key gets `409 idempotency_in_progress`.
- Neither `409 idempotency_conflict` nor `409 idempotency_in_progress` is stored.

**Stored originals.**
- Uploaded audio, the uploaded sidecar and the live capture are stored byte for byte, exactly as received. The live capture is the received PCM messages joined in order.
- At close, the server writes the machine transcript artifact once, as UTF-8 JSON of the form:
  `{"session_id":"<id>","segments":[{"index","start_ms","end_ms","words":[{"text","confidence","start_ms","end_ms"}]}]}`
  It is never rewritten.
- Corrections never modify any of these.

**Correction state machine.** `draft → submitted → approved | returned`, plus `returned → draft` (reopen).
- Every other transition gets `409 invalid_transition`.
- Corrections may be made on any final segment of any session.
- **One open correction.** A segment has at most one open correction (`draft`, `submitted` or `returned`) at a time. Creating another gets `409 correction_open`. When several creates arrive at once, exactly one succeeds and the rest get that `409`.
- **Author only.** Only the author edits a correction (in `draft` only), submits it or reopens it. Anyone else gets `403 not_author`.
- **Deciding.** Approving and returning need the approver role, and the approver must not be the author (`403 own_correction`).
- **Simultaneous decisions.** When an approve and a return, or two approvals, arrive at once, exactly one succeeds. The other gets `409 invalid_transition` and changes nothing.
- After an approval, the segment may receive a new correction.
- Every open view of the session receives the `correction` event within 2 seconds of the approval.

**Reviewed transcript and word error rate.**
- **Reviewed transcript.** It is the machine transcript, with each segment replaced by the words of its latest approved correction, spread evenly across the segment's span.
- **Word error rate.**
  - It is (substitutions + deletions + insertions) ÷ the reviewed word count, from a word-level edit distance between all machine words and all reviewed words.
  - The comparison ignores case, and ignores the characters `.,?!;:` at either end of a word.
  - It is rounded to four decimals.
  - It is null when the reviewed transcript has no words.
- **Display.** The console shows it as a percentage with two decimals, followed by `%`, or `n/a` when it is null.

**Billable seconds.**
- A session's audio length is `audio_ms`: samples per channel × 1,000 ÷ 16,000, rounded down.
- At close, billable seconds are computed once under the session's `plan`. That is the organisation's confirmed plan at the moment the session was created.
  - **Pilot:** channels × 60 × (`audio_ms` ÷ 60,000, rounded up). Each session is rounded up to whole minutes, per channel.
  - **Scale:** channels × the greater of 15 and (`audio_ms` ÷ 1,000, rounded up). Each session is billed per second with a 15-second minimum, per channel.
  - A session whose `audio_ms` is 0 bills 0 seconds on either plan and is `not_billable`.
- Billable minutes for display are billable seconds ÷ 60, rounded half up to two decimals.
- **Calculator.** The public calculator applies the same rules to a valid typed length, converted to milliseconds.
  - A valid length is digits with an optional decimal point and at most three digits after it, from 0 to 3,600 inclusive.
  - Non-numeric text, a sign, an exponent, more than three decimals, and values above 3,600 are invalid.
  - For example, 61 seconds mono bills Pilot 2.00 and Scale 1.02, and 5 seconds stereo bills Pilot 2.00 and Scale 0.50.

**Cost.**
- Pilot costs 6 cents per billable minute. Scale costs 3 cents per billable minute.
- For each project, each plan and the current UTC month, sum the billable seconds of the sessions that ended in that month. That plan's cost in cents is the sum × price ÷ 60, rounded up to a whole cent. This is the only rounding step.
- A project's `cost_cents` is the sum of its plans' costs. `org_total_cents` is the sum of the project costs.
- Everything above uses integer arithmetic.
- Cost displays as `$<dollars>.<cents>`.
- **Session counts.**
  - A project's `sessions` counts its billable sessions that ended within the current UTC month, meaning those whose `billing_state` is `pending` or `confirmed`. Open and `not_billable` sessions are excluded. The Projects list's month-to-date sessions use this count.
  - `pending_sessions` counts those of `sessions` whose `billing_state` is `pending`.
- A project's `billing_state` is `pending` when `pending_sessions` is above 0, and `confirmed` otherwise.

**Usage scope.**
- Usage totals, search results, counts and session lists only ever include the caller's own organisation and the caller's visible projects.
- Search matches the query, ignoring case, as a substring of the session label or of its machine transcript text.

**Plan change state machine.** `requested → confirmed | failed`.
- Requesting the current plan gets `409 plan_unchanged`.
- Requesting while a change is `requested` gets `409 change_pending`. When two requests arrive at once, exactly one gets `202`.
- The server asks Kill Bill to change the subscription immediately.
  - The change becomes `confirmed` only after the server reads the subscription back from Kill Bill with the target plan. Only then does the organisation's plan change.
  - If Kill Bill refuses, the change becomes `failed`, and the plan stays as it was.
- The decision is reached within 10 seconds of the request.

**Synthesis.**
- `voice` is `lumen` or `basalt`.
- A job's `characters` is the text's code-point count under the text-limit rule.
- `duration_ms` is the number of words × 300. For example, `take` + no-break space + `two` + ideographic space + `tablets` is 3 words, so 900 milliseconds.
- The output is a 16 kHz, mono, 16-bit WAV of procedural formant tones: a 44-byte canonical header followed by exactly `duration_ms` × 32 bytes of sample data.
- The same text and voice always render identical bytes. `/v1/speak/<job_id>/audio`, the console route `/api/projects/<project_id>/synthesis/<job_id>/audio` and the stored object all hold those same bytes.
- Synthesis isn't metered against the quota and isn't billed.

**Trial requests.** `team` is one of the two values listed in API. The other fields follow the text-limit rule.

### Services (DP-15, DP-24, DP-46, DP-50, DP-53, DP-54, DP-55)

**Postgres** is the system of record. It holds:
- organisations, members, roles and assignments, invitations, and sign-in sessions with their cookie tokens;
- API key hashes, projects and quotas;
- sessions with their server-decided state, stored spectrum rows and segments;
- corrections, idempotency records, plan changes, synthesis jobs and trial requests.

Apply the schema idempotently every time the server starts.

**MinIO** (the bucket named in `S3_BUCKET`) uses these object keys:

| Object key | Holds |
|---|---|
| `orgs/<org_id>/projects/<project_id>/sessions/<session_id>/upload.wav` | replay uploads and tone sessions |
| `.../sessions/<session_id>/sidecar.vtt` | the uploaded sidecar |
| `.../sessions/<session_id>/capture.pcm` | live session captures |
| `.../sessions/<session_id>/machine-transcript.json` | the machine transcript artifact |
| `orgs/<org_id>/projects/<project_id>/synthesis/<job_id>.wav` | synthesis renders |

- An upload counts as complete only after storage confirms the object. Until then, the session isn't created.
- While storage is unreachable:
  - session starts, `/v1/listen` and synthesis get `503 storage_unavailable`, and nothing is created;
  - reads of session audio, segment audio, synthesis audio (either route) and artifacts get the same `503`;
  - the console shows the storage outage banner.

**Kill Bill.**
- **Catalog.** At start, the server uploads a catalog to the tenant if it is missing. The catalog has one product and two usage-only monthly plans, `lowfield-pilot` and `lowfield-scale`. Each plan has one consumable in-arrear usage with unit `billable-second`, priced at 0.001 USD per unit on Pilot and 0.0005 USD per unit on Scale.
- **Accounts.** Each organisation has one USD account, named after the organisation, with external key `<LOWFIELD_BILLING_PREFIX>-<org slug>`. The account has one subscription on the catalog plan matching its plan.
- **Startup.** Accounts and subscriptions are looked up by external key and created if missing at start. This is retried until Kill Bill is reachable.
- **Usage records.** Each closed session with billable seconds above 0 is recorded once as usage on its organisation's subscription:
  - tracking id: the session id;
  - unit: `billable-second`;
  - amount: the session's billable seconds;
  - record date: the session's `ended_at`.
- **Confirmation.** A session's `billing_state` becomes `confirmed` only after Kill Bill accepts its record. Kill Bill reporting that the tracking id already exists also counts as accepted.
- **Plan changes** move the subscription to the target catalog plan immediately.
- While Kill Bill is unreachable:
  - sessions still close, and their usage stays `pending`;
  - `billing_reachable` is false, based on a probe no more than 5 seconds old;
  - Usage and Plan show the billing outage banner;
  - plan changes get `503 billing_unavailable`, and no change is created.

**Recovery.**
- Every server instance retries pending usage records every 5 seconds.
- No failed connection to storage or billing is cached.
- When a service returns, the next storage or billing call succeeds, and pending figures confirm and the billing banner clears within 10 seconds. No restart is needed.
- An instance may start while its configured storage or billing address is unreachable, and keep running until that same address later starts answering as the real service. It must recover then, as described above. So every retry connects to the configured address afresh.

### Seed data (DP-05, DP-37, DP-40, DP-44, DP-48, DP-49)

Every seeded person and business is invented.
- Seed records are created idempotently at start.
- Seed sessions exist in Postgres even while storage is unreachable. Their audio and artifacts are uploaded whenever missing, retrying until storage is reachable.
- All seeded members use the password `lowfield-demo-2026`.

**Organisation Harbourline Health** (slug `harbourline`, plan Pilot)

Projects:

| Project | Quota | Seed key | Key name |
|---|---|---|---|
| Ward Dictation | 600 minutes | `lf_live_00000000000000000000000000000a01` | `Seed ward key` |
| Clinic Intake | 120 minutes | `lf_live_00000000000000000000000000000a02` | `Seed intake key` |

Members:

| Name | Email | Role | Assigned projects |
|---|---|---|---|
| Ines Okafor | `ines.okafor@harbourline.example` | admin | (all) |
| Teo Marlow | `teo.marlow@harbourline.example` | developer | Ward Dictation, Clinic Intake |
| Rhea Santos | `rhea.santos@harbourline.example` | reviewer | Ward Dictation |
| Ari Lindqvist | `ari.lindqvist@harbourline.example` | approver | Ward Dictation |
| Jo Adeyemi | `jo.adeyemi@harbourline.example` | reviewer | Clinic Intake only |
| Kim Baptiste | `kim.baptiste@harbourline.example` | billing viewer | (all) |

**Organisation Corvane Contact** (slug `corvane`, plan Scale)

Project: Agent Assist EU, quota 3,000 minutes, seed key `lf_live_00000000000000000000000000000c01`, named `Seed assist key`.

Members:

| Name | Email | Role | Assigned projects |
|---|---|---|---|
| Nadia Voss | `nadia.voss@corvane.example` | admin | (all) |
| Sam Ruiz | `sam.ruiz@corvane.example` | developer | Agent Assist EU |
| Lee Chandra | `lee.chandra@corvane.example` | reviewer | Agent Assist EU |

**Seed session `Seed dictation 01`.**
- Project Ward Dictation, kind replay, source upload, plan Pilot.
- It ended at server start, in the current UTC month, as `closed` with reason `end_of_audio`.
- Audio: a 12.000-second, 16 kHz, mono, 16-bit WAV that the app generates deterministically.
- Sidecar cues:
  - `00:00.000 --> 00:03.000`: `patient@0.97 reports@0.95 dizziness@0.91`
  - `00:03.000 --> 00:06.000`: `after@0.93 starting@0.88 lisinopril@0.52`
  - `00:06.000 --> 00:09.000`: `fifteen@0.71 milligrams@0.90 daily@0.94`
  - `00:09.000 --> 00:12.000`: `review@0.96 in@0.93 two@0.58 weeks@0.90`
- Segments 2, 3 and 4 (indexes 1 to 3) are flagged.
- For example, with the seed data at start: billable seconds 60, billable minutes 1.00, Ward Dictation cost `$0.06`, word error rate 0.00%.

**Seed session `Seed call 01`.**
- Project Agent Assist EU, kind replay, plan Scale.
- It ended at server start, in the current UTC month, as `closed` with reason `end_of_audio`.
- Audio: a 75.000-second, 16 kHz, stereo, 16-bit WAV that the app generates deterministically.
- Sidecar cues:
  - `00:00.000 --> 00:05.000`: `thanks@0.96 for@0.95 calling@0.94 corvane@0.62`
  - `00:05.000 --> 00:10.000`: `your@0.93 policy@0.90 number@0.88 is@0.97 four@0.55 one@0.91 seven@0.89`
- For example, with the seed data at start: billable seconds 150, billable minutes 2.50, Agent Assist EU cost `$0.08`.

Both seed sessions are recorded to Kill Bill like any other closed session.

**Bundled fixtures.**
- `/fixtures/tone-1khz.wav` is 10.000 seconds of a 1,000 Hz sine at half full scale, 16 kHz, mono, 16-bit.
- The public demo spectrum is the spectrum of the Seed dictation 01 audio.

## Technical requirements

### Deployment (DP-56)

- **Runtime.** Node.js 22 with npm is available. Server and browser code are TypeScript.
- **Run manifest.** Ship `/app/run.json` with the string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:
  `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`
- **Port.** `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- **Health.** Once the database schema is applied, `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}`, even while storage or billing is unreachable.
- **Database and bucket.** The database named in `DATABASE_URL` and the bucket named in `S3_BUCKET` already exist when `serve` starts, possibly empty. The app creates neither. On every start it applies its schema and seed data into them.
- **Several instances.** Several instances of the app may run at the same time against one Kill Bill tenant. Each has its own database, `LOWFIELD_BILLING_PREFIX` and port, and may have its own timer settings; two instances may be given the same `S3_BUCKET`, so the app never lists, deletes or overwrites objects outside its own `orgs/<org_id>/...` keys.

### Configuration and secrets (DP-60)

Read these environment variables at start:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `LOWFIELD_IDLE_SECONDS` (default 30), `LOWFIELD_SESSION_CAP_SECONDS` (default 3600), `LOWFIELD_BILLING_PREFIX` (default `lowfield`)
- `APP_PUBLIC_PORT`

Never hard-code, log or send to the browser any URL or credential of Postgres, storage or Kill Bill. The browser reaches audio only through the app's own routes.

### Server boundary (DP-19, DP-57)

- **Same origin only.** The app sends no CORS headers. Its origin is the request's own scheme and `Host` header, so each URL an instance is served on is its own origin.
  - A state-changing `/api` request whose `Origin` header doesn't match that origin gets `403 cross_origin`.
  - A request with no `Origin` header is allowed.
- **Body limits** are those in API.
- **What is served.** The server serves only the built browser assets and the routes in this brief. Source files, source maps, `package.json`, `.env` files and `run.json` get `404`.
- **Cookies.** Session cookies are HttpOnly and SameSite=Lax.
- **Unreachable dependencies at boot.**
  - If storage or Kill Bill is unreachable, the server still starts, and recovers as stated in Services.
  - If Postgres is unreachable, the server keeps retrying, and health doesn't answer 200 until the schema is applied.
- **Stream connections** are held and released as stated in Business rules under Stream lifecycle.

### Browser support and performance (DP-30, DP-31)

- Supported browsers are current Chromium, Firefox and Safari, at the three published viewports.
- Every console screen is usable within three seconds of navigation.
- The session field draws its first frame within one second of the detail page loading. Without WebGL, the still fallback appears instead, within the same second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its version and licence; shipped packages are the production dependency tree, `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package and bundled font uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app stores data only in the provided Postgres, MinIO and Kill Bill: no SQLite, Redis, embedded database or data files used as storage.
- IF-05: The provided service configuration and environment files are left unmodified.
- IF-06: Fonts and scripts are bundled with the app, and the browser loads nothing from third-party hosts.
- IF-07: Authored server and browser source is TypeScript.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript, with no `any` used to bypass types at service boundaries.
- Names match this brief's domain terms: session, segment, correction, billable seconds, quota, plan change, key, idempotency record.
- Each domain rule is decided in exactly one place in the source: session and correction transitions, billable seconds, cost, quota usage, flagging, word error rate, the text-limit measure and idempotency replay.
- No abstraction has a single implementation, and no wrapper only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive checks for states that the types or state machines rule out.
- Every API error goes through one error shape with the published codes.
- There are no features, endpoints or screens beyond this brief.
