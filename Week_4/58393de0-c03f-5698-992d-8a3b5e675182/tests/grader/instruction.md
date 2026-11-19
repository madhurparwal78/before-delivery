# Hollowbrook Maker Co. Quarkyard

Quarkyard is a browser maker studio for one-person after-school STEM businesses. A founder-instructor runs 3D design, beginner electronics and block-coding classes for children aged 8 to 13 at several schools, libraries and community-education programmes. One Educator account runs every classroom. Children join with a class code and a nickname, so they have no email and no password. Students build in three editors: the **3D Workshop** (solid and hole shapes, grouping, printable exports), the **Circuit Bench** (batteries, LEDs, resistors and switches with a live simulation) and the **Block Lab** (block programs that build 3D objects). The instructor watches every child's work live from a roster, and a single docked viewer called **Glancet** lets them follow one child's model while they work with the rest of the class. Parents and older learners can also use Quarkyard at home as Personal makers with a verified email. The backend stores accounts, classrooms, rosters and project records in Postgres. Every project snapshot and exported file goes in MinIO. Mailpit receives verification emails. Live updates are server-sent events from the app itself. All 3D rendering, solid/hole geometry, circuit solving, block-program running and STL/OBJ/SVG file building happen in the browser. The following are out of scope: server-side mesh generation, any external rendering or compiling service, microcontroller code, payments, parent accounts, single sign-on, project deletion, and any datastore beyond the three named services.

## Problem and users

Many after-school 3D design and coding classes are run by one person. Community-education catalogues and district enrichment programmes contract that person for one to four hours a week per site. Terms run about ten weeks, with 12 to 20 children per class. Every site has its own rules and machines. Free browser tools keep their class features behind school accounts. Paid block-CAD classroom licences cost about $7.50 per student per year, and the instructor pays that out of a per-class fee. Children under 13 often cannot be given email logins at all, because children's privacy law and district policy rule them out. So the first fifteen minutes of every session go on password resets. The instructor cannot see what eighteen children are building without walking the room. At the end of term they collect STL files from USB sticks, and half of them cannot be printed or are in the wrong units. Parents find out a project was lost when the laptop cart was wiped. Quarkyard removes each of these problems: nickname sign-in, a live roster, server-kept snapshots, server-decided hand-in, and exports that are checked and saved.

Users:

- **Founder-instructor (Educator, owner).** Uses Quarkyard daily. They run several classrooms from one account, with join codes, nickname rosters, a live view of every Student's design, hand-in deadlines and print-ready exports.
- **Assistant instructor (Educator added to a classroom).** Uses Quarkyard weekly. They cover a site for one term and see only the classrooms they were added to.
- **Student.** Uses Quarkyard weekly. They join with the class code and the nickname their instructor gives them, build in the three editors, and have their work saved and handed in. They have no email and no password.
- **Personal maker.** Uses Quarkyard occasionally. A parent or older learner with a verified email account, who designs at home and exports STL or OBJ for a home printer.

## Journeys

1. **Setting up a term.** Start: the founder is signed in on the dashboard with no classroom called "Space Camp". They press `Create classroom` and type the name. They keep the default time zone, join window and hand-in time, then save. They open `Show join code` and read the code to the room. End: the classroom page shows the state "Open for joining" and an empty roster that asks them to share the join code.
2. **Joining on a tablet.** Start: a child on a shared tablet opens `/join`. They type the class code and the nickname the instructor gave them, then press Enter. End: they see the join confirmation and their class home with the hand-in countdown. On the instructor's phone or laptop, the roster gains their tile without a reload, and Status announces the join. A second child who types the same nickname in different letter case is told the nickname is taken.
3. **Building and handing in a 3D part.** Start: a Student in the 3D Workshop. They add a box and a cylinder by keyboard, size them, turn the cylinder into a hole, select both, align their centres and group them. They nudge, rotate and set a workplane, then save. End: the scene shows one mesh with the carved volume. The instructor's roster tile shows the new revision live. When the hand-in time passes on the server's clock, the Student's next save is refused with the hand-in copy, and the tile reads "Handed in".
4. **Wiring a night light.** Start: a Student in the Circuit Bench. They add a battery and an LED and wire them by keyboard terminals, then start the simulation. The LED burns out. They reset it, put a 330 Ω resistor in series and run again. The LED lights, and changing the resistance updates the reading in place. End: the readouts show the LED lit at the solved current, and the project is saved.
5. **Coding a tower.** Start: a Student in the Block Lab with an empty program. They insert a Repeat block with Add Sphere and Move Z by inside it, set the count and distance, then press Play. End: the program steps one block at a time, three spheres stand in the viewer, and Status announces the finish. The instructor's Glancet for that Student shows three meshes after the save.
6. **Watching one child.** Start: the founder is on the Robotics Lab roster. They press Enter on `Watch Tiny Turtle live`. The Glancet viewer docks in the corner and takes focus. They scroll and sort the roster underneath it, expand the viewer and shrink it back. The Student saves, and the viewer's revision goes up by one live. End: Escape closes the viewer, focus returns to the play button, and the scroll position is unchanged.
7. **Ending someone's access mid-term.** Start: Blue Fox and the Assistant instructor each have the classroom open. Blue Fox opens a classmate's project link and sees "Project not found". The founder removes Blue Fox from the roster by keyboard. End: Blue Fox's open editor shows the removal notice at once, and their next save is refused. The founder then removes the Assistant, and the Assistant's open Glancet closes with the removal notice.
8. **A Personal maker at home.** Start: signed out. They sign up as a Personal maker and design a part. Their first save is refused until they verify. They open the verification email and follow the link. End: the confirmation copy shows and the save succeeds. They export STL in inches, see the size in inches before download, receive the file and see it in their library.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Classroom creation** A verified Educator creates a classroom from the dashboard with a name, an IANA time zone, a join window and a hand-in time, and can do it entirely by keyboard.
- **DP-02 — Join codes** Each classroom has exactly one current join code, shown large in the Join code dialog and replaced immediately by `New code`, as qualified in Business rules.
- **DP-03 — Student join** A Student joins at `/join` with a class code and a nickname, with no email or password, and gets a session bound to that one classroom.
- **DP-04 — Nickname rules** Nicknames meet the stated length and character rules and are unique per classroom compared case-insensitively, both on join and on an instructor's rename.
- **DP-05 — Live roster joins** A successful join adds that Student's tile to every open roster of the classroom and announces it in Status without a reload, within the live-update delay in Business rules.
- **DP-06 — Classroom states** A classroom is draft, open, in session, handed in or archived exactly as Business rules derive it, and every illegal transition is refused with its stated status.
- **DP-07 — Join window on server time** Join codes are accepted only inside the join window, judged on the server's time in the classroom's time zone.
- **DP-08 — Hand-in freeze** At the classroom's hand-in time every Student project, and at a Student's own hand-in that one project, becomes read-only, and every save to it is refused with the stated copy.
- **DP-09 — Server countdown** The hand-in countdown and every classroom state label come from values the server publishes, never from the device clock, and refresh as qualified in Business rules.
- **DP-10 — 3D Workshop shapes** The 3D Workshop adds boxes, cylinders and spheres by button or key, sizes them in millimetres, and keeps the hidden scene description current.
- **DP-11 — Holes and grouping** Solid/Hole, Group and Ungroup follow the geometry rules in Business rules, grouping runs in a Web Worker, and equal inputs always give an equal result.
- **DP-12 — Revisions and saving** Saves, by autosave or `Ctrl+S`, create gapless per-project revision numbers that count only after storage confirms the snapshot.
- **DP-13 — Live roster saves** Each Student save updates that Student's roster tile render, revision number and saved time in place and announces it in Status, within the live-update delay.
- **DP-14 — Keyboard transforms** Arrow keys, Shift with arrows, Page Up and Page Down, and rotate mode move and turn the selection by the steps in Interactions.
- **DP-15 — Undo and persistence** Undo and redo step through edits one at a time, and every object property survives a save and a reload unchanged.
- **DP-16 — Selection** Tab, Shift+Tab, Shift+click and `Ctrl+A` select objects on the workplane, and Delete removes the selection.
- **DP-17 — Align** The Align dialog moves two or more selected shapes so their centres share the selection's bounding-box centre on one axis, as one undoable step.
- **DP-18 — Phone editor** At phone width the 3D Workshop shows a full-width canvas, a `Shapes` bottom sheet for adding shapes, and tap-to-select.
- **DP-19 — Camera by touch and pointer** A one-finger or mouse drag on empty canvas orbits the camera, and a pinch or the mouse wheel zooms it, also under reduced motion.
- **DP-20 — Workplane** The Workplane tool moves the workplane onto a chosen face of a shape, and new shapes land on that workplane.
- **DP-21 — Circuit Bench parts and wiring** Batteries, LEDs, resistors and switches are added from the parts toolbar, wired by dragging or by pressing terminal buttons, and listed by label.
- **DP-22 — Circuit solver** The simulation solves the circuit with the LED model in Business rules, burns out an LED above its current limit until it is reset, and gives zero current past an open switch.
- **DP-23 — Live readouts** While the simulation runs, every readout, LED state and LED brightness updates in place within one simulation tick of an edit, with no submit button.
- **DP-24 — Stale tabs and concurrent saves** A save based on an old revision is refused without overwriting, exactly one of several simultaneous saves wins, and open tabs of a project see each other's saves.
- **DP-25 — Block Lab programs** The Block Lab builds programs from palette blocks by pointer or keyboard, including blocks nested inside a Repeat body.
- **DP-26 — Block Lab run** Play runs the program one action block per step interval and produces the objects Business rules define, which saves and viewers then show.
- **DP-27 — Export dialog** The Export dialog offers STL, OBJ and SVG in millimetres or inches and shows the size line before download, as qualified in Business rules.
- **DP-28 — Export files** Export files are built in a Web Worker as closed meshes, scaled exactly for inches, and count as exported only after storage confirms them.
- **DP-29 — Hand-in files** A classroom's Educators see every Student export on the classroom page and download it from there.
- **DP-30 — Glancet docking** `Watch <nickname> live` opens one docked Glancet viewer that takes focus and stays in place while the roster scrolls under it.
- **DP-31 — Glancet live and controls** Glancet updates in place on each save, expands and shrinks, and closes by button or Escape, returning focus and leaving the scroll position unchanged.
- **DP-32 — Glancet motion** Glancet fades in and out at an even rate over the configured time and turns its model at the stated speed, with the reduced-motion and phone variants in Motion and effects.
- **DP-33 — Project visibility** Projects, snapshots and exports that a person may not see answer as not found and never load.
- **DP-34 — Instructor-only classroom actions** Roster, rename, removal, hand-in and join-code actions are refused for Students and for Educators who are not in the classroom.
- **DP-35 — Immediate removal** Removing a Student or an Assistant takes effect on that person's next request, closes their live stream and shows them the removal notice.
- **DP-36 — Assistant instructors** A classroom's owner adds Assistants by email and removes them, and an Assistant sees only the classrooms they were added to.
- **DP-37 — Sign-up and verification email** Personal makers and Educators sign up with email and password and verify through an emailed link, which expires and is replaced when a new one is sent.
- **DP-38 — Unverified and pending sessions** An unverified account cannot create a classroom, save or export, and a Student who has not confirmed a nickname reaches no editor and no data.
- **DP-39 — Storage outage** When storage is unreachable, health reports it, saves and exports fail with the stated copy, and unsaved edits stay in the browser.
- **DP-40 — Run manifest, health and grading hooks** The app runs from `/app/run.json`, answers the health route, and provides the grading seed, session and clock routes exactly as specified.
- **DP-41 — Configuration from environment** Every service address, credential, token and timer is read from the named environment variables at start and never sent to the browser.
- **DP-42 — Server boundary** The server answers same-origin requests only, enforces the body-size limits and serves no source files or credentials.
- **DP-43 — Landing page** The public landing page carries the workshop header bar, blueprint welcome hero, live build poster card, three-editor intro row, classroom stats doodle band, editor feature rows, starter project card grid, start-a-classroom closing band and site footer.
- **DP-44 — Working screens look** The dashboard, roster, editors, forms, dialogs, empty states and error bands follow the visual design language in Visual design.
- **DP-45 — Responsive layouts** Every screen fits 375×812, 768×1024 and 1280×800 with no horizontal scrolling, and every control is at least 44 pixels square to tap.
- **DP-46 — Hover, focus and motion rules** Hover and focus change colour only, dialogs fade at an even rate, nothing loops unless named, and reduced motion removes every fade and loop.
- **DP-47 — Landing scenes and previews** The build poster loop, the feature-row previews and the starter-card previews behave as stated, each with a pause control and a still fallback; the hero's 3D scene stays still.
- **DP-48 — Dialogs and Status region** Every modal dialog (the list under Dialogs in Interactions) keeps Tab inside it, closes on Escape and returns focus to its opener, and every page announces messages in one polite Status region.
- **DP-49 — Browser-side geometry and simulation** Rendering, solid/hole geometry, circuit solving, block running and file building are done by the product's own browser code, and none of it is simulated or computed on the server.

## Frontend

### Screens and layout (DP-01, DP-03, DP-18, DP-29, DP-30, DP-43, DP-44, DP-45)

Viewports are narrow (under 600 pixels wide, checked at 375×812), medium (600 to 1023, checked at 768×1024) and wide (1024 and over, checked at 1280×800). No screen scrolls sideways at any of them.

- **Every page.** The workshop header bar is fixed at the top: a solid cobalt bar with the Quarkyard mark and wordmark at the left. On medium and wide screens, four nav links sit in the centre and the sign-in and sign-up pills sit at the right. Signed-in pages show the account's display name or nickname and `Sign out` instead of the pills. On narrow screens the bar is shorter and holds a `Menu` button at the left, the centred logo and an `Account` link at the right; the nav links, the display name, the pills and `Sign out` are hidden there and the nav links with `Sign in` and `Sign up` (signed out) or `Sign out` (signed in) move into dialog `Menu`. A full-width Notice band sits directly under the header whenever a page has a standing notice, such as an outage, a hand-in, a removal, a verification reminder or a stale tab. The Status region is visually anchored at the bottom-left of the viewport on medium and wide screens and at the bottom edge on narrow screens, and stays above page content.
- **Landing `/`.** In order:
  1. The blueprint welcome hero, which fills the full width in cobalt.
  2. The live build poster card, straddling the hero's lower edge.
  3. A centred intro paragraph with the `Start a classroom` and `Join a class` pills.
  4. The three-editor intro row.
  5. The classroom stats doodle band.
  6. Three editor feature rows, with text and media alternating sides.
  7. The starter project card grid, four columns wide, two medium, one narrow.
  8. The start-a-classroom closing band.
  9. The site footer.

  Content sits in a centred column about 1050 pixels wide on wide screens. On narrow screens everything stacks into one column with 24-pixel side margins, feature rows show text above media, and pills stretch to the full column.
- **Sign up `/signup`, Sign in `/signin`, Verify `/verify?token=<token>`, Join `/join`.** A single centred card on the white ground, with the form fields stacked. `/signup?type=educator` preselects the Educator account type. The Verify page shows the verification result as a heading and links to the account's home.
- **Educator dashboard `/dashboard`** (the Educator's home):
  - a `Classrooms` list of cards, each showing the name, state label and student count;
  - the `Create classroom` pill;
  - the three editor launch pills;
  - a `My projects` card grid;
  - a `My exports` list.

  Wide screens show three classroom cards per row, medium two, narrow one.
- **Classroom page `/classrooms/<id>`.** A heading with the classroom name, the state label, the join window line and the hand-in line in the formats from Feedback states, plus the action pills `Show join code`, `Edit times` (owner only), `Hand in all projects` and `Archive classroom` (owner only). Below that come the `Sort roster` select and the `Classroom roster` grid of design tiles: four per row wide, two medium, one narrow. Each tile shows a still render of the Student's most recently saved project, the nickname, the revision number in equal-width figures, the saved time in the tile format from Feedback states, and the `Handed in` label exactly when that Student's `handedIn` is true (API), otherwise nothing. The `Instructors` section follows, then the `Hand-in files` list.
- **Student home `/class`.** The classroom name, the hand-in countdown, the three editor launch pills, `My projects` cards and a `My exports` list.
- **Personal home `/projects`.** The three editor launch pills, `My projects` cards and a `My exports` list.
- **Editors `/editor/<projectId>` and `/editor/new?kind=3d|circuit|blocks`.** The editor fills the viewport below the header:
  - A top toolbar holds the `Project name` field, the save indicator, `Undo`, `Redo`, `Save`, `Export` and, for Students, `Hand in`, with the hand-in countdown beside them.
  - **3D Workshop:** the `Shapes` toolbar and editing buttons on the left on wide screens and along the top on medium; the WebGL workplane in the centre; the `Inspector` panel on the right. On narrow screens the canvas is full width, the shape buttons move into a bottom sheet opened by `Shapes`, and the Inspector folds into a collapsible panel under the canvas.
  - **Circuit Bench:** a `Parts` toolbar, a breadboard canvas, a `Components` list, a `Wires` list and a `Readouts` panel.
  - **Block Lab:** the `Blocks palette` on the left, the `Program` list in the middle and the `Block Lab viewer` on the right. On narrow screens these three stack in that order.

  A project the viewer may not open shows a page with the heading `Project not found` and a link home. An Educator opening a Student's project sees it read-only, with a Notice band naming the Student.
- **Glancet.** A docked viewer that floats over the classroom page. Sizes are in Motion and effects and Interactions.

### Public screens and controls (DP-01 to DP-05, DP-10, DP-16 to DP-21, DP-25, DP-27, DP-29 to DP-31, DP-35 to DP-37, DP-43, DP-47, DP-48)

Only the roles, names and hidden state elements below are public, and every one is spelled exactly as here. `<nickname>`, `<classroom>`, `<label>` and `<name>` are filled from the record shown. In terminal names, `−` is the minus sign character, not a hyphen.

| Where | Role and accessible name | Notes |
|---|---|---|
| Every page | `banner` containing link `Quarkyard home` | workshop header bar |
| Every page, medium and wide | `navigation` `Main` with links `Editors`, `For classrooms`, `Starter projects`, `Join a class` | |
| Every page, signed out | links `Sign in` (outline pill), `Sign up` (filled pill) | sign-in and sign-up pills; in the header on medium and wide, inside dialog `Menu` on narrow |
| Every page, signed in | button `Sign out` | in the header on medium and wide, inside dialog `Menu` on narrow |
| Every page, narrow | button `Menu` (opens dialog `Menu` holding navigation `Main` with the nav links, `Sign in` and `Sign up` or `Sign out`, and button `Close`), link `Account` | `Account` goes to `/signin` signed out, or to the account's home route (`/dashboard`, `/projects` or `/class`) signed in |
| Every page | `status` `Status` | the one polite live region |
| Every page | `region` `Notice` | full-width band, present only while a notice stands |
| Landing | `heading` level 1 `Make a thing you can hold by Friday.` | hero headline |
| Landing | `region` `Build preview`, with button `Play build preview` and toggle button `Pause build preview` | live build poster card; the toggle reports pressed while paused |
| Landing | links `Start a classroom` and `Join a class` (pills under the intro) | |
| Landing | `region` `Editors`, with headings `3D Workshop`, `Circuit Bench`, `Block Lab` and links `Explore 3D Workshop`, `Explore Circuit Bench`, `Explore Block Lab` | three-editor intro row |
| Landing | `region` `Classroom stats` | classroom stats doodle band |
| Landing | links `Open 3D Workshop`, `Open Circuit Bench`, `Open Block Lab`; toggle buttons `Pause 3D Workshop preview`, `Pause Circuit Bench preview`, `Pause Block Lab preview` | editor feature rows and preview pause toggles |
| Landing | `region` `Starter projects`, with links `Desk Name Tag`, `Pencil Cup`, `Rainbow Lamp`, `Spiral Tower`, toggle button `Pause starter previews` and link `Start a blank 3D design` | starter project card grid |
| Landing | link `Set up your first class` | start-a-classroom closing band |
| Landing | `contentinfo` with links `Privacy`, `Terms`, `Student data` | site footer |
| `/signup` | textboxes `Name`, `Email`, `Password`; radiogroup `Account type` with radios `Educator`, `Personal maker`; button `Create account` | |
| `/signin` | textboxes `Email`, `Password`; button `Sign in` | |
| Unverified account pages | button `Resend verification email` | inside the Notice band |
| `/join` | textboxes `Class code`, `Nickname`; button `Join class` | |
| Dashboard | button `Create classroom`; list `Classrooms` (one link per classroom name); list `My projects`; list `My exports` with links `Download <file>` | |
| Home pages | links `New 3D design`, `New circuit`, `New block program` | editor launch pills |
| Dialog `Create classroom`, and dialog `Classroom times` from `Edit times` | textbox `Classroom name` (create only); combobox `Time zone` (create only); textboxes `Join opens`, `Join closes`, `Hand-in time`; buttons `Save classroom`, `Cancel` | the three time fields are plain text boxes; format, placeholders and zone options in Interactions |
| Classroom page | buttons `Show join code`, `Edit times`, `Hand in all projects`, `Archive classroom`; combobox `Sort roster` with options `Nickname (A–Z)`, `Most recently saved` | `Nickname (A–Z)` is preselected on every page load; sort orders are in Interactions |
| Dialog `Join code` | the code in large equal-width letters; buttons `New code`, `Close` | the dialog's text contains the code exactly as the API's `joinCode` (for example `ROBO42`), one letter per box, with no space, hyphen or other separator between letters |
| Classroom page | list `Classroom roster`, one listitem per Student, named by the nickname | design tiles |
| Each roster tile | buttons `Watch <nickname> live`, `Rename <nickname>`, `Remove <nickname>` | the Watch button is the Glancet play control |
| Dialog `Rename <nickname>` | textbox `Nickname`; buttons `Save nickname`, `Cancel` | |
| Alertdialog `Remove <nickname>?` and alertdialog `Remove <name>?` | buttons `Remove from classroom`, `Cancel` | |
| Alertdialog `Hand in all projects?` | buttons `Hand in now`, `Cancel` | |
| Classroom page | `region` `Instructors` with list `Instructors`, textbox `Assistant's email`, button `Add assistant`, and button `Remove <name>` per Assistant (owner only) | |
| Classroom page | `region` `Hand-in files` with list `Hand-in files` (links `Download <file>`) | newest first; each listitem holds the Student's nickname, then the link `Download <file>`, then `<FORMAT> · <unit> · <size>` (for example `STL · mm · 1.2 KB`), so one Student's file is found by the listitem containing their nickname |
| Glancet | `dialog` `Glancet: <nickname>`; buttons `Expand viewer` (reports expanded or collapsed), `Close viewer`; toggle button `Pause turntable` | the Glancet docked viewer |
| Editors | textbox `Project name`; buttons `Undo`, `Redo`, `Save`, `Export`; button `Hand in` (Students only) | |
| Student hand-in | alertdialog `Hand in <project name>?` with buttons `Hand in now`, `Cancel` | |
| 3D Workshop | `application` `3D workplane` | focusable canvas |
| 3D Workshop | `toolbar` `Shapes` with buttons `Box`, `Cylinder`, `Sphere` | inside dialog `Shapes` (bottom sheet) on narrow screens, opened by button `Shapes`; a shape button there adds the shape, closes the sheet and returns focus to `Shapes` |
| 3D Workshop | toggle buttons `Solid`, `Hole`; buttons `Group`, `Ungroup`, `Align`, `Workplane`, `Reset workplane`, `Delete` | |
| 3D Workshop | `region` `Inspector` with textboxes `Width (mm)`, `Depth (mm)`, `Height (mm)` | |
| Dialog `Align` | buttons `Align centers on X`, `Align centers on Y`, `Align centers on Z`, `Cancel` | opens only with two or more shapes selected; an Align button applies the alignment, closes the dialog and returns focus to its opener (`Align`, or the control that had focus when `L` was pressed, such as `3D workplane`) |
| Circuit Bench | `toolbar` `Parts` with buttons `Battery`, `LED`, `Resistor`, `Switch` | |
| Circuit Bench | list `Components`, one `group` per component, named `<label>, <state words>` | state words in Business rules |
| Each component group | buttons `<label> + terminal`, `<label> − terminal`, `Delete <label>`; textbox `Voltage (V)` (battery); textbox `Resistance (Ω)` (resistor); `switch` `<label>` (switch, on = closed); button `Reset LED` (LED) | |
| Circuit Bench | list `Wires`, with a listitem `<from> to <to>` and button `Delete wire <from> to <to>` per wire | `<from>` and `<to>` read like `BAT-1 +` |
| Circuit Bench | buttons `Start Simulation` / `Stop Simulation` (one shown at a time); `region` `Readouts` | |
| Block Lab | `toolbar` `Blocks palette` with buttons `Add Box`, `Add Cylinder`, `Add Sphere`, `Move X by`, `Move Y by`, `Move Z by`, `Make hole`, `Repeat` | |
| Block Lab | list `Program`, one listitem per block; nested list `Repeat body` inside each Repeat | |
| Block Lab blocks | textboxes `Repeat count`, `Move X by (mm)`, `Move Y by (mm)`, `Move Z by (mm)`; button `Delete block` | |
| Block Lab | buttons `Play`, `Stop`; `region` `Block Lab viewer` | |
| Dialog `Export` | radiogroup `Format` with radios `STL`, `OBJ`, `SVG`; radiogroup `Unit` with radios `Millimetres`, `Inches`; the size line; buttons `Download`, `Cancel` | |
| Stale tab | button `Reload` | inside the Notice band |
| Kept edits | buttons `Restore`, `Discard` | inside the Notice band |

**Hidden state elements.** Each of these is visually hidden but present in the page while its view is open. Tests read them, and they never replace the visible UI. Lengths are in millimetres. The no-trailing-zeros rule covers `data-x`, `data-y`, `data-z`, `data-w`, `data-d`, `data-h` and the workplane vectors (for example `10`, `0.5`, `0,0,1`, never `10.00`); `data-camera-distance`, `data-current-ma`, `data-voltage` and `data-brightness` always print their stated decimals (for example `200.0`, `280.0`, `0.0`, `9.00`, `1.00`), and counts, degrees and volumes are whole numbers.

- **3D Workshop** (always present while the editor is open): `<div id="qy-scene" data-mesh-count data-total-volume data-triangle-count data-selected data-workplane-normal data-workplane-origin data-camera-azimuth data-camera-distance>`.
  - `data-mesh-count` is the number of top-level objects.
  - `data-total-volume` is the summed volume of the top-level solids in cubic millimetres, rounded to the nearest integer. Holes count zero.
  - `data-triangle-count` is the sum of triangles over all top-level meshes.
  - `data-selected` is a comma-separated list of the selected object ids, or empty.
  - Vectors are `x,y,z` with up to 2 decimals.
  - `data-camera-azimuth` is in whole degrees, 0 to 359. `data-camera-distance` is in millimetres with one decimal.
  - There is one child per top-level object: `<div data-object-id data-kind="box|cylinder|sphere|group" data-mode="solid|hole" data-x data-y data-z data-w data-d data-h data-rotation-z data-volume>`. Here `x, y, z` is the centre in world millimetres. `w, d, h` is the shape's own size before rotation; for a group it is the bounding box of its result. `data-rotation-z` is in whole degrees, 0 to 359, and `data-volume` is in cubic millimetres, rounded.
- **Block Lab viewer:** `<div id="qy-blocks-scene" data-mesh-count data-sphere-count data-step data-state="idle|running|done">` with one `data-object-id` child per object, using the same attributes as above.
- **Circuit Bench:** `<div id="qy-circuit" data-sim="stopped|running">` with one child per component, `<div data-component="<label>" data-status data-current-ma data-voltage data-brightness>`.
  - `data-current-ma` is the absolute current with one decimal.
  - `data-voltage` is the voltage across the component with two decimals.
  - `data-brightness` is 0 to 1 with two decimals (LEDs only).
- **Glancet** (present while it is open): `<div id="qy-glancet-state" data-student data-revision data-mesh-count>`, where `data-student` is the Student's id.
- **Export dialog:** `<div id="qy-export" data-state="idle|working|done|failed" data-format="stl|obj|svg" data-unit="mm|in" data-triangle-count data-bytes>`. It is present the whole time the editor is open, not only while the dialog is: after a successful export the dialog closes and the element keeps `data-state="done"` with that file's format, unit, triangle count and byte size until `Export` is opened again, which resets it to `idle` with the preselected format and unit and empty `data-triangle-count` and `data-bytes`.
- **Looping previews:** each looping preview (poster card, feature-row media, starter cards, Glancet turntable) carries `data-playing="true|false"`.

### Interactions (DP-01 to DP-05, DP-10, DP-14 to DP-21, DP-23, DP-25, DP-27, DP-30, DP-31, DP-48)

**General keyboard rules.** Every action works by keyboard. Shortcuts work while focus is on any control inside that editor, including toolbar buttons and the canvas, but not while typing in a text box. On macOS, Cmd works wherever Ctrl is listed.

**Dialogs.** The modal dialogs are Create classroom, Classroom times, Join code, Rename, Remove, Hand in, Align, Export, Menu and the narrow Shapes sheet, plus Glancet when it is expanded.

- Opening a modal dialog moves focus to its first control.
- Tab from its last control wraps to its first, and Shift+Tab from its first wraps to its last.
- Escape closes it.
- Closing in any way returns focus to the control that opened it, unless that dialog's own rule below names another landing place. "The next tile" always means the tile that came after the removed one in the roster's current sort order.

**Dashboard and classroom.**

- `Create classroom` opens its dialog. The name is required.
- `Time zone` is a single-choice list (a native select is fine) of full IANA zone names in Area/Location form, sorted alphabetically. Each option's visible text and value are the full name, for example `America/Chicago`. Its preselection is in Business rules.
- `Join opens`, `Join closes` and `Hand-in time` are plain text boxes that take `YYYY-MM-DD HH:mm` on a 24-hour clock in the chosen zone, for example `2026-11-20 09:00`. A `T` in place of the space is also accepted. The browser sends them to the API as `YYYY-MM-DDTHH:mm`.
- In the Create classroom dialog the three time fields start empty, with the placeholders `Now`, `14 days after Join opens` and `70 days after Join opens` in that order. An empty field means the server default in Business rules.
- In the Classroom times dialog the three time fields are prefilled with the stored local times. A field the Educator empties keeps its stored value.
- Enter in any field submits. On Create classroom success the dialog closes and the page moves to the new classroom page, with focus on its level-1 heading. On Classroom times success the dialog closes, the page's times update in place, and focus returns to `Edit times`.
- `Show join code` opens the Join code dialog. `New code` replaces the code in place.
- `Sort roster` reorders tiles at once. The default is `Nickname (A–Z)`: nicknames compared ignoring letter case and accents, with digit runs compared as numbers (`Kid 2` before `Kid 10`), ties broken by Student id. `Most recently saved` puts the newest `latestProject.savedAt` first, Students with no saved project last, and breaks ties by the nickname order.
- `Rename <nickname>` and `Remove <nickname>` open their dialogs. Focus lands as follows:
  - Rename success: the tile shows the new nickname (and moves if the sort order needs it), and focus goes to that same tile's `Rename <new nickname>` button.
  - Rename cancelled by `Cancel` or Escape: focus returns to `Rename <nickname>`.
  - Remove cancelled by `Cancel` or Escape: focus returns to `Remove <nickname>`.
  - Remove success: the tile disappears and focus goes to the next tile's `Watch <nickname> live` button. When the removed tile was the last in sort order and other tiles remain, focus goes to the Watch button of the tile that is now last. When no tiles remain, focus goes to `Show join code`.
  - Removing an Assistant: success moves focus to `Assistant's email`; cancel returns it to `Remove <name>`.
- `Hand in all projects` asks for confirmation first.

**Joining.** On `/join`, Enter in either textbox or `Join class` submits the code step and then the nickname step in one go. When the browser already holds a pending session from the same code (for example after `nickname_taken` or a nickname 422), the page skips the code step and sends only the nickname; a different code runs the code step again. The code is accepted in any letter case, with spaces and hyphens ignored. On success the page moves to `/class` and Status shows the join copy. A field error appears under its field and is announced.

**3D Workshop shortcuts.**

| Key | Action |
|---|---|
| `B`, `C`, `S` | add a box, cylinder or sphere at the workplane origin, resting on the workplane, and select it |
| `Tab` / `Shift+Tab` (focus on `3D workplane`) | select the next or previous object in creation order; Tab from the last object, or Shift+Tab from the first, leaves the workplane |
| `Ctrl+A` | select every top-level object |
| `Shift+click` / `Shift+tap` | add an object to the selection or remove it |
| Arrow keys | move the selection 1 mm along the workplane's own axes (table in Business rules): Right +X, Left −X, Up +Y, Down −Y |
| `Shift` + arrow keys | move 10 mm |
| `PageUp` / `PageDown` | move 1 mm up or down the workplane normal (`Shift` makes it 10 mm) |
| `H` | toggle the selection between Solid and Hole |
| `Ctrl+G` / `Ctrl+Shift+G` | group / ungroup |
| `L` | open the Align dialog |
| `W` | start the Workplane tool |
| `R` | enter rotate mode: `ArrowRight` turns each selected object +15° about the vertical axis through its own centre, whatever the workplane, `ArrowLeft` −15°, `Shift` with an arrow ±1°; `Enter` or `Escape` leaves rotate mode |
| `Delete` / `Backspace` | delete the selection |
| `Ctrl+Z` / `Ctrl+Shift+Z` (also `Ctrl+Y`) | undo / redo |
| `Ctrl+S` | save now |

- Only changes to the objects or the workplane are undo steps: each key press, button press, size change, toggle, group, ungroup, align, workplane change, rotation step, add or delete that changes them is one step, and a pointer drag that moved the selection is one step. Selection changes (Tab, `Ctrl+A`, click, tap), camera changes, entering or leaving rotate mode or the Workplane tool, and actions that change nothing are not undo steps. Undo and redo also restore the selection that went with the step. The undo history holds the last 100 steps in the open editor and does not survive a reload.
- **Size textboxes.** These apply on Enter or when focus leaves the field. For a cylinder, `Width (mm)` and `Depth (mm)` stay equal to the diameter: changing one changes both. For a sphere all three stay equal. A size change keeps the object's bottom-centre point fixed.
- **Pointer.** Click selects an object, and clicking empty canvas clears the selection. Dragging an object moves it on the workplane. Dragging empty canvas orbits the camera and the wheel zooms.
- **Touch.** A tap selects an object. A one-finger drag on empty canvas orbits, which changes `data-camera-azimuth`. A one-finger drag on a selected object moves it. A two-finger pinch zooms, which changes `data-camera-distance`. Orbit and zoom work the same under reduced motion.
- **Workplane tool.** `W` or `Workplane` starts it, and Status asks the user to pick a face. Clicking or tapping a face of any shape, or pressing Enter to use the top face of the selected object, moves the workplane there. Escape cancels. `Reset workplane` returns it to the ground.

**Circuit Bench.**

- Parts buttons add the next numbered component (`BAT-1`, `LED-1`, `R-1`, `SW-1`, numbered per kind in insertion order) to the next free spot on the breadboard and move focus to its group.
- Wiring by keyboard: press Enter or Space on one terminal button. It reports pressed and Status says which terminal is waiting. Then press Enter on another terminal to draw the wire, or Escape to cancel.
- Wiring by pointer: drag from one terminal to another.
- Space on a switch toggles it.
- Typing in `Resistance (Ω)` or `Voltage (V)` applies each valid value as it is typed, with no Enter needed.
- Undo, redo and `Ctrl+S` work as in the 3D Workshop.

**Block Lab.**

- The Program has an insertion point, drawn as a highlighted gap. It starts at the end of the program.
- Pressing Enter or clicking on a palette block inserts that block at the insertion point and moves the insertion point to just after the new block.
- In the Program list, ArrowUp and ArrowDown move focus between blocks.
- ArrowRight on a Repeat block moves the insertion point to the end of that Repeat's body. ArrowLeft on a block inside a body moves the insertion point to just after the enclosing Repeat.
- Delete removes the focused block.
- Pointer users drag palette blocks into the Program.

**Roster and Glancet.**

- Enter or Space on `Watch <nickname> live` opens Glancet for that Student and moves focus into the viewer.
- The docked viewer is non-modal. Tab from its last control continues to the page control after the opener, and F6 moves focus between the viewer and the opener tile.
- Escape closes Glancet when focus is inside it, or anywhere on the classroom page while no other dialog is open. `Close viewer` closes it too. Either way, focus returns to that tile's Watch button and the page's scroll position does not change.
- `Expand viewer` enlarges the viewer and makes it modal. The same button shrinks it back to the corner and the viewer becomes non-modal again. Below 600 pixels wide, `Expand viewer` is hidden.
- Opening another tile's Watch button replaces the Student in the open viewer.
- When Glancet closes because its Student was removed, focus lands as for a Remove success on that Student's tile if focus was inside the viewer; otherwise focus stays where it was.
- With a mouse, the roster under a docked viewer keeps scrolling, sorting and taking clicks.

**Export.** `Export` opens the dialog with `STL` and `Millimetres` preselected, or `SVG` and `Millimetres` for a circuit project, where `STL`, `OBJ` and `Inches` are disabled. Changing a radio updates the size line at once. `Download` builds and stores the file, then downloads it. The dialog closes when the download starts, and focus returns to `Export`; `#qy-export` stays in the editor and keeps showing `done` for that file.

**Hand in.** A Student's `Hand in` asks for confirmation. On success, the editor becomes read-only and Status shows the hand-in copy.

**Starter cards.** Signed in, a starter card opens `/editor/new?kind=3d&starter=<id>` in the 3D Workshop with that starter's shapes as an unsaved design named `Untitled 3D design` (an unknown `starter` opens a blank design). Signed out, it goes to `/signup`. `Start a blank 3D design` opens `/editor/new?kind=3d` signed in and `/signup` signed out. The starters, all 3D and resting on the default workplane: `Desk Name Tag` (`desk-name-tag`, 6 top-level objects: a 60 × 28 × 4 box plate, a 6 mm hole cylinder and four 4 mm-thick letter boxes); `Pencil Cup` (`pencil-cup`, 2: a solid cylinder 44 mm across and 56 tall, and a hole cylinder 36 mm across); `Rainbow Lamp` (`rainbow-lamp`, 4: cylinders 46, 36 and 28 mm across stacked, topped by a 34 mm sphere); `Spiral Tower` (`spiral-tower`, 6: 8 mm-tall boxes stacked, 40 mm square shrinking by 3 mm per level, each turned 15° more than the one below).

### Visual design (DP-43, DP-44, DP-45)

The direction follows the reference design: a bright, friendly maker-education look rebuilt with original copy, renders and doodles.

- **Typefaces.** Fira Sans throughout, served by the app: semibold for display headings, regular for body text, semibold or bold for labels, pills and nav, and bold with equal-width figures for revision numbers, counts, readouts and countdowns. Headings step up by about one fifth per level. The hero headline is three times the body size and drops to a little over twice the body size on phones, across two lines. Section headings are twice the body size. Body text is the normal reading size at about one and a half line height.
- **Palette roles.**
  - White working ground.
  - A very pale cool grey for alternate bands and the footer.
  - Near-black ink for body copy.
  - Slate grey for secondary paragraphs.
  - A darker slate for eyebrows.
  - A bright cobalt accent for the header, hero ground, primary pills and focus rings.
  - A deeper royal blue for the closing band and pressed or hovered pills.
  - A navy-cobalt for section headings on white.
  - A bright azure field colour for the 3D Workshop.
  - A vivid violet for the Block Lab.
  - The deeper royal blue for the Circuit Bench.
  - A light grey-blue for card and tile edges.
  - White for text on any accent.

  Each editor's own pills, eyebrow and heading take that editor's field colour, and so does each editor launch pill on the home pages, including the empty-state one. Body text and controls meet WCAG 2.2 AA contrast on their grounds.
- **Mood and shape.** Friendly and buildable. There are two corner rules only: every pill and button is fully rounded, and every card, tile and dialog has slightly rounded corners. Hover and focus change colour only. Density is comfortable, with generous section padding and controls at least 44 pixels square to tap.
- **Composition.** A fixed cobalt header sits over a cobalt blueprint hero, and a live poster card straddles the hero's lower edge. Below it the page is a calm white column about 1050 pixels wide, with alternating text and media rows. Editors take the full viewport below the header.
- **Hero.** The blueprint welcome hero is cobalt with a thin white perspective grid, faint enough to read through, that converges to the centre. The white headline sits over a WebGL toy scene built from the product's own primitives: a green wedge, a purple cylinder and an orange box with a hole carved through it.
- **Working screens.** The dashboard, roster, forms and dialogs use the same Fira Sans scale, white ground and pale grey bands.
  - Project and starter cards have a thin light grey-blue edge, a procedural render on white and a semibold label below it. The edge tints to accent on hover.
  - Roster tiles are the same card shape, showing a live render, the nickname, `Rev <n>` in equal-width figures and the saved time.
  - Empty states show a thin-stroke procedural doodle (a cylinder, a U-loop and a dashed line) above one plain sentence and one pill. That pill is the page's own primary action moved into the empty state: `Create classroom` on an empty dashboard, `Show join code` on an empty roster, `New 3D design` on an empty project list.
  - Errors and the storage-outage notice are the full-width pale Notice band under the header, with ink text and an icon. Never use red floods.
  - On phones every list stacks into one column with 24-pixel margins and pills stretch to full width.
- **Renders.** The classroom view stays toy-bright on purpose. Solids render in chunky saturated primaries (green, purple, orange, azure). Holes render as translucent grey with diagonal stripes, because the colour of a hole versus a solid is the information the instructor reads.
- **Icons.** Icons are from the Lucide set. Doodles and renders are the product's own procedural SVG and WebGL.

### Motion and effects (DP-19, DP-30, DP-31, DP-32, DP-46, DP-47)

- **Hover and focus.** Pills, links, cards and icons change colour only, over about a quarter of a second with a gentle ease. Nothing grows, shrinks or slides on hover. Focus shows a two-ring halo: white inside, accent outside.
- **Dialogs.** Modal dialogs fade in and out at an even rate in about a sixth of a second.
- **Glancet, step by step.**
  1. At rest, each roster tile shows a small circular outlined play button on its render.
  2. Pressing it opens the `Glancet: <nickname>` dialog. The dialog fades from invisible to fully visible at an even rate over `QY_GLANCET_FADE_MS` (150 milliseconds by default) and takes focus.
  3. Docked at medium and wide widths, it is 360 by 203 pixels, with its edges 24 pixels from the viewport's bottom and right edges. At narrow widths it is full width, 216 pixels tall and pinned to the bottom edge.
  4. It shows a WebGL turntable of the Student's current saved revision. The model turns once every 12 seconds. The nickname and `Rev <n>` in equal-width figures appear in the viewer's top bar.
  5. The roster scrolls under it while it keeps the same place in the viewport.
  6. When the Student saves, the mesh swaps in place with a crossfade of about a quarter of a second. `Rev <n>` goes up by one and the matching tile updates, with no reload.
  7. `Expand viewer` enlarges it to 80% of the viewport width at a 16:9 shape, horizontally centred, with its top edge 109 pixels below the top of the viewport. The same control shrinks it back to the corner.
  8. Closing fades it out at the same even rate over the same time.
- **Poster card.** The live build poster card plays a procedural looping build of the hero scene. The wedge drops in, the cylinder rises, the box appears and the hole carves through it. The loop lasts 6 to 10 seconds. While it plays, `Pause build preview` stops it at the current frame. While it is paused, the circular `Play build preview` control sits at the card's centre and resumes it.
- **Hero scene.** The hero's toy scene is still. It does not move by itself.
- **Feature rows.** Each feature row's media loops a short procedural demo: a part with a selection box and corner handles turning slowly, an LED brightening as a resistor changes, and coloured block chips stacking. Each has its own pause toggle.
- **Starter cards.** Each starter card's preview fades in over about a quarter of a second when first drawn. After that the model turns once every 20 to 30 seconds. `Pause starter previews` pauses all of them.
- **No other loops.** Nothing else moves on its own. There are no scroll-linked effects and no decorative loops beyond those named here.
- **Reduced motion.** When the device asks for reduced motion:
  - Every dialog, Glancet included, appears and disappears at once with no fade.
  - The Glancet turntable starts paused on a three-quarter view, and `Pause turntable` reports pressed (showing the play glyph).
  - Live revision swaps happen in place without a crossfade.
  - The poster card, feature-row media and starter previews show their finished frame, start paused with their toggles reporting pressed, and appear without fades.
  - Block Lab `Play` runs the whole program at once and shows the end state, with the same objects and the same Status copy.
  - Orbit, zoom and every function still work.
- **Without WebGL.** The hero, poster card, previews, tiles and Glancet show still SVG renders of the same scenes and hide their play controls. Editors replace the 3D view with a flat top-view drawing. Editing, keyboard control and the hidden state elements all keep working.
- **Page timers.** Every timer in the page runs on the browser's ordinary timers and animation frames: autosave, block steps, simulation ticks, toast removal and Glancet fades. A test that pauses and advances the page clock controls them.

### Feedback states (DP-03, DP-04, DP-08, DP-09, DP-11 to DP-13, DP-17, DP-20, DP-22 to DP-24, DP-26, DP-28, DP-33, DP-35, DP-37 to DP-39, DP-48)

**Status region.** Every message below with the place "Status" appears in the single polite `Status` region. The region shows up to the three newest messages, one per line with the newest last. Each line is removed after `QY_TOAST_MS` (4000 milliseconds by default). Field errors appear under their field, are linked to it as its description, and are also posted to Status. Notice-band copy is also posted to Status once.

**Placeholders.**

| Placeholder | Meaning |
|---|---|
| `<classroom>` | classroom name |
| `<nickname>` | the Student's nickname as stored |
| `<n>` | count or revision number |
| `<axis>` | `X`, `Y` or `Z` |
| `<face>` | `top`, `bottom`, `front`, `back`, `left` or `right` (the normal points +Z, −Z, −Y, +Y, −X or +X) |
| `<label>` | component label |
| `<mA>` | current in milliamps, one decimal |
| `<file>` | export file name |
| `<unit word>` | `millimetres` or `inches` |
| `<email>` | the account email |
| `<zone>` | the IANA zone name |

**Pending states.**

- Save indicator: `Saving…` while a save is in flight, `Saved · revision <n>` after storage confirms, and `Unsaved changes` whenever edits are not yet confirmed, including after a failed save.
- Grouping in progress: `Grouping…` in Status. The `Group` button is disabled until the worker answers.
- Export in progress: `Preparing <file>…` in Status, and `#qy-export` `data-state="working"`.
- Joining: `Join class` is disabled while the request is in flight.

**Copy table.** API `message` fields carry the copy for their error code.

| Situation (API code where one exists) | Copy | Place |
|---|---|---|
| Join succeeded | `Joined <classroom> as <nickname>` | Status |
| `nickname_taken` | `That nickname is taken in this classroom.` | under `Nickname` |
| Nickname invalid (`validation`, field `nickname`) | `Use 2 to 24 letters, numbers, spaces, hyphens or apostrophes.` | under `Nickname` |
| `unknown_code`, `join_closed` | `This class code is not open for joining.` | under `Class code` |
| `classroom_full` | `This classroom is full. Ask your instructor.` | under `Class code` |
| `too_many_attempts` | `Too many attempts. Try again in 60 seconds.` | under `Class code` |
| A Student joined (roster) | `<nickname> joined` | Status |
| A Student saved (roster) | `<nickname> saved revision <n>` | Status |
| A Student handed in any one project (roster, on each `project-handed-in` event) | `<nickname> handed in` | Status |
| Tile label after hand-in | `Handed in` | tile |
| Classroom created | `Created <classroom>` | Status |
| Join code replaced | `New join code ready` | Status |
| Nickname changed | `Renamed to <nickname>` | Status |
| Student removed (to the Educator acting) | `Removed <nickname>` | Status |
| Assistant added | `Added <name>` | Status |
| Shapes grouped | `Grouped <n> shapes` | Status |
| Shapes ungrouped | `Ungrouped <n> shapes` | Status |
| Group with no solid | `A group needs at least one solid.` | Status |
| Group or Align with fewer than two selected | `Select two or more shapes first.` | Status |
| Shapes aligned | `Aligned <n> shapes on <axis>` | Status |
| Workplane tool waiting | `Pick a face for the workplane` | Status |
| Workplane set | `Workplane set to <face> face` | Status |
| Workplane reset | `Workplane reset` | Status |
| Size out of range | `Enter a size from 0.1 to 1000 mm.` | under the size field |
| Object limit reached | `This design has the most shapes it can hold (200).` | Status |
| Saved by `Ctrl+S` or `Save` | `Saved revision <n>` | Status |
| `stale_revision` | `This project changed in another tab. Reload to see the latest version.` | Notice band with `Reload`, and Status |
| `classroom_handed_in` | `This classroom was handed in. Changes are no longer saved.` | Notice band and Status |
| `project_handed_in` | `You handed in this project. Changes are no longer saved.` | Notice band and Status |
| Student hand-in succeeded | `Handed in <project name>` | Status |
| `classroom_not_started` | `This classroom hasn't opened yet.` | Status |
| `not_handed_in` | `Hand in the classroom before archiving it.` | Status |
| `classroom_archived` | `This classroom is archived.` | Status |
| `owner_cannot_leave` | `The classroom owner can't be removed.` | Status |
| `already_added` | `That instructor is already in this classroom.` | under `Assistant's email` |
| `no_such_educator` | `No verified Educator account uses that email.` | under `Assistant's email` |
| Wiring started | `Wiring from <label> <+ or −>` | Status |
| Wire drawn | `Wired <from> to <to>` | Status |
| `Those terminals are already wired.` | (same copy) | Status |
| Simulation started | `Simulation started` | Status |
| Simulation stopped | `Simulation stopped` | Status |
| LED burnt out | `<label> burnt out at <mA> mA` | Status |
| LED lit, or lit current changed after an edit | `<label> lit at <mA> mA` | Status |
| LED reset | `<label> reset` | Status |
| Battery shorted | `<label> is short-circuited` | Status |
| Resistance out of range | `Enter a resistance from 1 to 10000000 Ω.` | under the field |
| Voltage out of range | `Enter a voltage from 1 to 12 V.` | under the field |
| Program finished | `Program finished: <n> objects` | Status |
| Program hit the step limit | `Program stopped after 500 steps.` | Status |
| Program stopped by `Stop` | `Program stopped` | Status |
| Export size line (3D and Block Lab) | `Size: <w> × <d> × <h> <unit>`, where `<unit>` is `mm` (one decimal) or `in` (two decimals) | Export dialog |
| Export size line (circuit) | `Size: wiring diagram, 297 × 210 mm page` | Export dialog |
| Export downloaded | `Exported <file> (<unit word>)` | Status |
| Export stored | `Saved to your library` | Status, right after the line above |
| `storage_unavailable` on export | `Export failed: storage is unavailable. Your design is safe; try again.` | Status and Notice band |
| `storage_unavailable` on save | `Save failed: storage is unavailable. Your design is safe; try again.` | Status and Notice band |
| `storage_unavailable` on opening a project | `Storage is unavailable. Try again in a minute.` | Notice band |
| `mesh_not_closed` | `Export failed: the mesh is not closed.` | Status |
| Nothing to export (3D and Block Lab) | `Add a solid shape before exporting.` | Export dialog; `Download` disabled |
| Nothing to export (circuit) | `Add a component before exporting.` | Export dialog; `Download` disabled |
| `not_found` on a project or export | `Project not found` | page heading and Status |
| `not_found` on anything else | `Not found.` | Status |
| `forbidden` | `Only this classroom's instructors can do that.` | Status |
| `removed` (to the removed Student or Assistant) | `You were removed from <classroom>.` | Notice band and Status |
| Glancet closed because its Student was removed | `<nickname> was removed from <classroom>.` | Status |
| `email_unverified` on save | `Verify your email to save projects.` | Status and Notice band |
| `email_unverified` on classroom creation | `Verify your email to create classrooms.` | Status |
| `email_unverified` on export | `Verify your email to export files.` | Status |
| Unverified reminder | `Check your inbox at <email> to verify your account.` | Notice band with `Resend verification email` |
| Verification succeeded | `Email verified. You can save projects now.` | Verify page heading and Status |
| `link_expired` | `This verification link has expired or was replaced. Send a new one from your account.` | Verify page heading |
| `already_verified` | `Your email is already verified.` | Status |
| Verification email sent | `Verification email sent to <email>` | Status |
| `rate_limited` | `Wait a minute before sending another email.` | Status |
| `mail_unavailable` | `We couldn't send the email. Try again in a minute.` | Status and Notice band |
| `email_taken` | `An account already uses that email.` | under `Email` |
| Password under 10 or over 200 characters (`validation`, field `password`) | `Use at least 10 characters.` | under `Password` |
| `bad_credentials` | `Email or password is wrong.` | Status |
| `signed_out` | `Sign in to continue.` | Status |
| `not_a_classroom_project` | `Only classroom projects are handed in.` | Status |
| `idempotency_conflict` | `That save was already sent with different content.` | Status |
| `too_large` | `That is too large to upload.` | Status |
| `validation` (generic) | `Check the highlighted fields.` | Status |
| Time zone invalid | `Choose a time zone from the list.` | under `Time zone` |
| Local time in a daylight-saving gap | `That time does not exist in <zone>.` | under that field |
| Join window order wrong | `Join closes must be after Join opens.` | under `Join closes` |
| Hand-in before join closes | `Hand-in time must be at or after Join closes.` | under `Hand-in time` |
| Hand-in time at or before server now | `Hand-in time must be later than now.` | under `Hand-in time` |
| Local time not in the accepted form | `Use the form YYYY-MM-DD HH:mm.` | under that field |
| Classroom name invalid (field `name`), display name invalid (field `displayName`), or project name invalid (field `name`) | `Use 1 to 60 characters.` | under `Classroom name`, or under `Name` on `/signup`; in an editor an invalid `Project name` goes back to the last valid name when it is committed |
| Kept edits found | `This browser kept unsaved changes to this project.` | Notice band with `Restore` and `Discard` |
| Storage down (standing notice) | `Storage is unavailable. Your edits are kept in this browser until it is back.` | Notice band |
| Hand-in countdown | `Hand-in in <d>d <h>h <m>m` | Student home and editor toolbar |
| Tile and project-card saved time | `Saved <YYYY-MM-DD HH:mm>`, an absolute 24-hour time with no zone label; for example `Saved 2026-11-06 14:05`. Student projects use the classroom's zone; an Educator's or Personal maker's own projects use the browser's time zone setting (never its clock) | roster tile and `My projects` cards |
| Classroom join window | `Join window: <YYYY-MM-DD HH:mm> to <YYYY-MM-DD HH:mm> (<zone>)`, absolute, in the classroom's zone | classroom page |
| Classroom hand-in | `Hand-in: <YYYY-MM-DD HH:mm> (<zone>)`, absolute, in the classroom's zone | classroom page |
| Classroom state labels | `Draft`, `Open for joining`, `In session`, `Handed in`, `Archived` | classroom page and cards |

## Backend

### API (DP-01 to DP-04, DP-06 to DP-09, DP-12, DP-24, DP-28, DP-29, DP-33 to DP-40)

**General.**

- Request and response bodies are `application/json` unless stated otherwise. A JSON route given another content type answers `415 {"error":"unsupported_media","message":"Check the highlighted fields."}`.
- Body limits are inclusive. JSON bodies may be up to 1,000,000 bytes, project create and save bodies up to 2,000,000 bytes, and export uploads up to 20,000,000 bytes. A larger body answers `413` with code `too_large`.
- The session is the cookie `qy_session`: HttpOnly, SameSite=Lax, Path `/`. The cookie value changes on sign-in, sign-up, and nickname confirmation.
- Times are ISO-8601 instants in UTC with `Z`. Local times are `YYYY-MM-DDTHH:mm` in the classroom's zone.

**Error shape.** Every error uses the shape `{"error":"<code>","message":"<copy>"}`. Validation adds fields: `422 {"error":"validation","message":"Check the highlighted fields.","fields":{"<field>":"<copy>"}}`. `stale_revision` adds `"currentRevision":<n>`. `too_many_attempts` and `rate_limited` add `"retryAfterSeconds":<n>` and a `Retry-After` header.

**Error precedence** (one rule for the whole API). Checks run in this order:

1. 413 too large.
2. 401 signed out. This includes pending join sessions and ended sessions.
3. 429 rate limit.
4. 404 unknown resource, or a resource outside the caller's reach.
5. 403 forbidden role, or `email_unverified`.
6. 409 state conflict.
7. 422 validation.
8. 503 dependency down.

An idempotent replay returns its stored response before any check after authentication and the 404 check. On `PUT /api/projects/:id` the replay and `idempotency_conflict` are both decided right after that 404 check, before every 403 and every other 409. Inside 409 the order is fixed: on a save, `idempotency_conflict`, then `classroom_handed_in`, then `project_handed_in`, then `stale_revision`; on `POST /api/projects/:id/hand-in`, `not_a_classroom_project`, then `classroom_handed_in`, then `project_handed_in`; on `POST /api/join/code`, `join_closed`, then `classroom_full`; on `POST /api/join/nickname`, `join_closed`, then `nickname_taken`, then `classroom_full`, with the nickname 422 after all three.

**Shapes.**

- **Account:** `{"id","kind":"educator"|"personal"|"student","displayName","email"|null,"emailVerified":bool,"classroomId"|null,"nickname"|null}`.
- **Classroom:** `{"id","name","timeZone","state":"draft"|"open"|"in_session"|"handed_in"|"archived","joinCode","joinOpensLocal","joinClosesLocal","handInLocal","joinOpensAt","joinClosesAt","handInAt","serverNow","secondsToHandIn","ownerId","role":"owner"|"assistant","students":[{"id","nickname","handedIn":bool,"latestProject":{"id","kind","name","revision","savedAt"}|null}],"educators":[{"id","displayName","email","role"}]}`. `secondsToHandIn` is a whole number, 0 once handed in. `latestProject` also carries `"state"` (`editing` or `handed_in`). `students[].handedIn` is true when the classroom is `handed_in` or `archived`, or when that Student's `latestProject` is `handed_in`; otherwise it is false.
- **Student classroom view:** `{"id","name","timeZone","state","handInAt","serverNow","secondsToHandIn"}`.
- **Project:** `{"id","kind":"3d"|"circuit"|"blocks","name","ownerId","classroomId"|null,"revision","savedAt","state":"editing"|"handed_in"}`.
- **Export:** `{"id","projectId"|null,"ownerId","fileName","format":"stl"|"obj"|"svg","unit":"mm"|"in","bytes","triangleCount"|null,"bbox":{"x","y","z"}|null,"createdAt","downloadUrl"}`. `bbox` is in the export's unit, and is `null` for a circuit export. `triangleCount` is `null` for every SVG export. `downloadUrl` is `/api/exports/<id>/download`.

**Snapshots.** Snapshots are JSON objects. The server checks only that `kind` matches the project's kind and that the size is within the limit; anything else answers 422.

- **3D:** `{"kind":"3d","objects":[{"id","kind":"box"|"cylinder"|"sphere"|"group","mode":"solid"|"hole","x","y","z","w","d","h","rotationZ","color","children":[...]}],"workplane":{"origin":[x,y,z],"normal":[x,y,z]}}`. Group members are in `children` with world coordinates. `color` is a lowercase six-digit hex colour string with a leading hash; new shapes cycle the four solid shape colours of Visual design (green, violet, orange, blue) in creation order, holes draw as grey stripes whatever their `color`, and a value that is not a CSS colour draws in the cycle colour for its position. A group object carries its own fields too: `x`, `y`, `z` the centre of its result's bounding box (to 0.01 mm), `w`, `d`, `h` that box's size (to 0.1 mm) in the group's own frame, before its turn, `rotationZ` the group's own turn in whole degrees (0 until the group itself is rotated), and the `color` of its first solid member. A group's `children` keep their positions and turns from before the group's own turn; Ungroup applies that turn to each member, moving its centre about the group's centre and adding the turn to its `rotationZ`; non-group objects have `"children":[]`. Editors and viewers render any snapshot of this shape.
- **Circuit:** `{"kind":"circuit","components":[{"label","type":"battery"|"led"|"resistor"|"switch","volts"?,"ohms"?,"closed"?,"broken"?}],"wires":[{"from":"BAT-1+","to":"LED-1+"}]}`. Terminal ends are written `<label>+` and `<label>-`.
- **Blocks:** `{"kind":"blocks","program":[{"block":"repeat","count":3,"body":[{"block":"addSphere"},{"block":"moveZ","mm":10}]}],"objects":[<3D objects>]}`. The block names are `addBox`, `addCylinder`, `addSphere`, `moveX`, `moveY`, `moveZ`, `makeHole` and `repeat`.

**Accounts and sessions.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/auth/signup` | `{"email","password","displayName","accountType":"educator"\|"personal"}` | `201 {"account":Account,"verificationEmailSent":bool}`, signs in | 409 `email_taken`; 422 |
| `POST /api/auth/signin` | `{"email","password"}` | `200 {"account":Account}` | 401 `bad_credentials` |
| `POST /api/auth/signout` | none | `204` | none |
| `GET /api/session` | none | `200 {"account":Account\|null,"pendingJoin":{"classroomName"}\|null}` (never 401) | none |
| `POST /api/auth/verify` | `{"token"}` | `200 {"account":Account}` | 410 `link_expired` |
| `POST /api/auth/resend-verification` | none | `202 {"sentTo":"<email>"}` | 409 `already_verified`; 429 `rate_limited`; 503 `mail_unavailable` |
| `GET /api/config` | none | `200 {"autosaveMs","blocksStepMs","simTickMs","toastMs","glancetFadeMs"}` | none |

**Joining.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/join/code` | `{"code"}` | `200 {"classroom":{"name"}}`, sets a pending session bound to that classroom | 404 `unknown_code`; 409 `join_closed`; 409 `classroom_full`; 429 `too_many_attempts` |
| `POST /api/join/nickname` | `{"nickname"}` (needs the pending session) | `201 {"account":Account}`, replaces the cookie with a Student session | 401 `signed_out` without a pending session; 409 `join_closed`; 409 `nickname_taken`; 409 `classroom_full`; 422 |
| `GET /api/class` | none (Student) | `200` Student classroom view | none |

**Classrooms.** These routes answer 404 to anyone who is neither the owner nor an added Educator, and 403 `forbidden` to a Student of that classroom.

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/classrooms` | Educator | none | `200 {"classrooms":[Classroom]}`, owned or added only | none |
| `POST /api/classrooms` | verified Educator | `{"name","timeZone","joinOpensLocal"?,"joinClosesLocal"?,"handInLocal"?}` | `201` Classroom | 403 `email_unverified`; 422 |
| `GET /api/classrooms/:id` | its Educators | none | `200` Classroom | none |
| `PATCH /api/classrooms/:id` | owner | any of `joinOpensLocal`, `joinClosesLocal`, `handInLocal` | `200` Classroom | 403 `forbidden` (Assistant); 409 `classroom_handed_in`; 409 `classroom_archived`; 422 |
| `POST /api/classrooms/:id/join-code` | its Educators | none | `200 {"joinCode"}` | 409 `classroom_archived` |
| `POST /api/classrooms/:id/hand-in` | its Educators | none | `200` Classroom | 409 `classroom_not_started`; 409 `classroom_handed_in`; 409 `classroom_archived` |
| `POST /api/classrooms/:id/archive` | owner | none | `200` Classroom | 403 `forbidden`; 409 `not_handed_in`; 409 `classroom_archived` |
| `PATCH /api/classrooms/:id/students/:studentId` | its Educators | `{"nickname"}` | `200 {"id","nickname"}` | 404 unknown Student; 409 `nickname_taken`; 422 |
| `DELETE /api/classrooms/:id/students/:studentId` | its Educators | none | `204` | 404 unknown Student |
| `POST /api/classrooms/:id/educators` | owner | `{"email"}` | `201 {"id","displayName","email","role":"assistant"}` | 403 `forbidden`; 409 `already_added`; 422 `no_such_educator` |
| `DELETE /api/classrooms/:id/educators/:educatorId` | owner | none | `204` | 403 `forbidden`; 404; 409 `owner_cannot_leave` |
| `GET /api/classrooms/:id/exports` | its Educators | none | `200 {"exports":[Export plus "nickname"]}` | none |

**Projects.** A project is visible to its owner and, for a Student's project, to the Educators of that Student's classroom. Everyone else gets 404 `not_found` with the copy `Project not found`. Only the owner may write.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/projects` | none | `200 {"projects":[Project]}` (own only) | none |
| `POST /api/projects` | `{"kind","name","snapshot"}` | `201 {"project":Project}` with revision 1 | 403 `email_unverified`; 409 `classroom_handed_in`; 422; 503 `storage_unavailable` |
| `GET /api/projects/:id` | none | `200 {"project":Project,"snapshot":{...}}` | 503 `storage_unavailable` |
| `PUT /api/projects/:id` | `{"baseRevision","snapshot","name"?}`, optional header `Idempotency-Key` | `200 {"project":Project}` | 403 `forbidden` (a non-owner who can see it); 403 `email_unverified`; 409 `stale_revision`; 409 `classroom_handed_in`; 409 `project_handed_in`; 409 `idempotency_conflict`; 422; 503 `storage_unavailable` |
| `POST /api/projects/:id/hand-in` | none (owner Student) | `200 {"project":Project}` | 409 `project_handed_in`; 409 `classroom_handed_in`; 409 `not_a_classroom_project` |

**Exports.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/exports?format=<stl\|obj\|svg>&unit=<mm\|in>&name=<fileName>&projectId=<id>` (`projectId` optional) | raw file bytes, `application/octet-stream` | `201` Export | 403 `email_unverified`; 404 (unknown or other's project); 422 `validation` (`format`, `unit` or `name` invalid; file not of that format); 422 `mesh_not_closed`; 503 `storage_unavailable` |
| `GET /api/exports` | none | `200 {"exports":[Export]}` (own) | none |
| `GET /api/exports/:id/download` | none | `200` bytes, with `Content-Type` `model/stl`, `model/obj` or `image/svg+xml` and `Content-Disposition: attachment; filename="<fileName>"` | 404; 503 `storage_unavailable` |

Exports are visible to their owner and to the Educators of the owning Student's classroom.

**Live stream.**

`GET /api/stream` answers `200 text/event-stream` to any signed-in session; a pending or ended session gets 401. The server sends a comment line every 15 seconds. The events are:

| Event | Data |
|---|---|
| `student-joined` | `{"classroomId","student":{"id","nickname"}}` |
| `student-renamed` | `{"classroomId","studentId","nickname"}` |
| `student-removed` | `{"classroomId","studentId","nickname"}` |
| `project-saved` | `{"projectId","ownerId","classroomId"\|null,"revision","savedAt","kind","name"}` |
| `project-handed-in` | `{"projectId","ownerId","classroomId"}` |
| `classroom-state` | `{"classroomId","state","serverNow","secondsToHandIn"}` |
| `access-ended` | `{"classroomId","message"}` |

Who receives what:

- An Educator receives events for every classroom they own or were added to, plus their own projects.
- A Student receives their classroom's `classroom-state` events and their own project events.
- A Personal maker receives their own project events.
- Every open tab of the owner receives `project-saved` for that owner's projects.

**Health and grading.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | none | `200 {"status":"ok"}` when Postgres and storage both answer within 2 seconds; otherwise `200 {"status":"unavailable"}` | none |
| `POST /api/grading/seed` (header `X-Grading-Token`) | none | `200` seed JSON (Seed data) | 403 `forbidden` on a missing or wrong token |
| `GET /api/grading/session?user=<id>&token=<token>` | none | `302` to the user's home route (`/dashboard` for an Educator, `/projects` for a Personal maker, `/class` for a Student) with a fresh `qy_session` cookie for that user | 403 `forbidden`; 404 unknown user |
| `POST /api/grading/clock` (header `X-Grading-Token`) | `{"now":"<ISO-8601>"\|null}` | `200 {"now":"<ISO-8601>"}` | 403 `forbidden`; 422 |

### Business rules (DP-02 to DP-04, DP-06 to DP-09, DP-11 to DP-17, DP-20, DP-22 to DP-24, DP-26, DP-28, DP-33 to DP-38)

**Server time.** Server time is the real clock unless `POST /api/grading/clock` has set it. In that case it equals the given instant and then runs forward in real time. `{"now":null}` and the seed route both restore the real clock. Every join check, hand-in check, state, countdown and verification expiry uses server time. The device clock may be wrong and is never consulted.

**Classroom states** are derived from server time `now` and the stored instants:

- `draft` while `now` is before join opens;
- `open` from join opens (inclusive) until join closes (exclusive);
- `in_session` from join closes (inclusive) until the hand-in time (exclusive);
- `handed_in` from the hand-in time (inclusive);
- `archived` once the owner archives a handed-in classroom.

Transitions and rejections:

- An owner's time edit may move a classroom between `draft`, `open` and `in_session`.
- A time edit on a `handed_in` classroom answers 409 `classroom_handed_in`. On an `archived` classroom it answers 409 `classroom_archived`.
- Manual hand-in sets the hand-in time to `now`. It is legal from `open` or `in_session`. From `draft` it answers 409 `classroom_not_started`, from `handed_in` 409 `classroom_handed_in`, and from `archived` 409 `classroom_archived`.
- Archive is legal only from `handed_in`. From `draft`, `open` or `in_session` it answers 409 `not_handed_in`, and from `archived` 409 `classroom_archived`.
- An archived classroom's Student sessions end. Their next request answers 401 `signed_out`.
- There is no way back from `handed_in` or `archived`.

**Classroom times.**

- `timeZone` must be an IANA zone name, otherwise 422.
- A local time not of the form `YYYY-MM-DDTHH:mm` answers 422 with the format copy.
- Local times are converted in that zone. A local time inside a daylight-saving gap answers 422 with the gap copy. An ambiguous local time in a fall-back hour means its first occurrence.
- Join closes must be after join opens, otherwise 422 with field `joinClosesLocal` and the join-window-order copy.
- The hand-in time must be later than server `now`, both on create (including a defaulted hand-in time) and on any edit that sets `handInLocal`. It must also be at or after join closes. Either failure answers 422 `validation` with field `handInLocal`, and nothing changes. The only way to hand in a classroom early is `Hand in all projects`.
- Each field carries at most one copy. For `handInLocal` the checks run in this order, and only the first that fails is returned in `fields.handInLocal` and shown under `Hand-in time`:
  1. the accepted form (format copy);
  2. the daylight-saving gap (gap copy);
  3. later than server `now` (not-later-than-now copy);
  4. at or after join closes (hand-in-before-join-closes copy).

  For example, with the seed data at start, a `handInLocal` one hour before server `now` is also before Join closes, and the answer carries only `Hand-in time must be later than now.`
- On create, an empty `joinOpensLocal` means `now` rounded down to the minute in the zone. An empty `joinClosesLocal` means 14 days after join opens, and an empty `handInLocal` means 70 days after join opens, at the same local wall time.
- The Create classroom dialog's `Time zone` preselects the zone of the Educator's most recently created classroom, or `America/Chicago` when they have none.
- Classroom names are 1 to 60 characters after trimming.

**Join codes.**

- A code is 6 characters drawn from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, unique among non-archived classrooms. Seeded codes may use other letters.
- Entry ignores letter case, spaces and hyphens.
- `New code` replaces the code at once. The old code then answers 404 `unknown_code`.
- A code is accepted only while its classroom is `open`. In any other state it answers 409 `join_closed`. The nickname step re-checks the state.
- Failed code attempts (404 or 409) count per client IP address. When the count reaches `QY_JOIN_RATE_LIMIT` (default 5) within 60 seconds, further code attempts answer 429 `too_many_attempts` until 60 seconds after the first counted attempt.
- A classroom holds at most 40 Students; 40 is allowed. Joining a full classroom answers 409 `classroom_full`.

**Nicknames.**

- Surrounding spaces are trimmed and inner runs of spaces collapse to one.
- After that the nickname must be 2 to 24 characters (both allowed, counted as UTF-16 code units) of letters, digits, spaces, hyphens and apostrophes. Letters and digits are any Unicode letter or number (so `Zoë` is valid); the space is U+0020, the hyphen only U+002D and the apostrophe only U+0027 (the typographic `’` is refused). Anything else answers 422.
- Uniqueness within a classroom compares nicknames case-insensitively, by their Unicode lowercase form with accents kept, so `tiny turtle` collides with `Tiny Turtle` and `ZOË` with `zoë`, but `Zoe` does not collide with `Zoë`. A collision answers 409 `nickname_taken`.
- The same rules apply to a rename.
- Students have no email and no password. A Student session is bound to one classroom.

**Join sessions.** `POST /api/join/code` creates a pending session that holds only the classroom. A pending session can call `POST /api/join/code` (which replaces it with a new pending session for the code typed; a failed code attempt leaves it as it was), `POST /api/join/nickname`, `POST /api/auth/signout` (which ends it) and `GET /api/session` (which reports `pendingJoin`). Every other API route answers it as signed out (401 `signed_out`), and every page other than `/join` redirects it to `/join`. Confirming the nickname replaces the pending session with a new Student session that has a different cookie value.

**Accounts and verification.**

- Emails are unique, compared case-insensitively. Passwords are 10 to 200 characters. Display names are 1 to 60 characters. A sign-up email that is not of the form `<text>@<text>.<text>` with no spaces, or is over 254 characters, answers 422 with field `email` and the copy `Enter a valid email address.`, shown under `Email`. Sign-up field keys are `email`, `password` and `displayName`; their copies are in Feedback states, and `email_taken` is checked before them.
- An account is unverified until its link is used. An unverified Educator or Personal maker may sign in and open editors with unsaved designs. Creating a classroom, creating or saving a project, and uploading an export each answer 403 `email_unverified`.
- Sign-up sends the verification email. A verification token lasts `QY_VERIFY_TTL_SECONDS` (default 86400 seconds, which is 24 hours) of server time from sending. At exactly that age it is expired.
- Resending makes a new token and invalidates the old one at once.
- Every verification email Mailpit accepts for an account, the sign-up email included, starts a 60-second window measured on server time, so the grading clock moves it. A resend before 60 seconds have passed answers 429 `rate_limited` with `retryAfterSeconds` set to the whole seconds left, rounded up; at exactly 60 seconds it is allowed. A send Mailpit did not accept starts no window.
- A used, expired or replaced token answers 410 `link_expired`.
- Verification takes effect on the account's next request in every session.

**Roles.**

- The owner of a classroom is the Educator who created it. Assistants are Educators the owner added.
- Owner and Assistants may: view the classroom and roster, replace the join code, rename and remove Students, hand in the classroom, view Student projects read-only, list and download hand-in files, and open Glancet.
- Only the owner may: edit times, archive, add Assistants and remove Assistants.
- An Assistant asking for an owner-only action gets 403 `forbidden`.
- A Student asking for any classroom route of their own classroom gets 403 `forbidden`. Students of other classrooms, Personal makers and unrelated Educators get 404.
- Only a project's owner may save it, hand it in or attach exports to it. Others who can see it get 403 `forbidden`.

**Visibility.** A project, its snapshot and its exports are reachable only as described under Projects and Exports in API. Any other id answers 404, whether it is in a path, a query or a body (for example `projectId` on an export upload). It never answers 403 or 422.

**Removal.**

- Removing a Student ends every session of that Student. Every later request on those ended sessions answers 401 with code `removed` and the removal copy (an `EventSource` reconnect does not use this up), except `GET /api/session`, which answers 200 with `"account":null` and `"pendingJoin":null`, and `POST /api/auth/signout`, which answers 204 and clears the cookie. Their live stream receives `access-ended` and is closed.
- The removed Student's projects, snapshots and exports are deleted, and the nickname becomes free. Storage objects are deleted at removal, or at the next server start if storage was down.
- Removing an Assistant ends their access to that classroom on their next request. Its routes and its Students' projects then answer 404. Their live stream receives `access-ended` for that classroom and is closed; the browser reconnects for their remaining classrooms.
- Educators watching that classroom receive `student-removed`. A Glancet showing the removed Student closes at once with the Glancet removal copy.
- The owner cannot be removed: 409 `owner_cannot_leave`.

**Live-update delay.** Every stream event reaches open pages within 2 seconds of the change that caused it. The one exception is a `classroom-state` caused only by time passing (join opening or closing, or the hand-in time arriving, with no request), which reaches open pages within 7 seconds of that instant (the 5-second re-check below plus 2 seconds). Roster tiles, Glancet, revision numbers, state labels, countdowns and removal notices update from these events without reload.

**Classroom state events.** The server re-checks every classroom's state at least once every 5 seconds and sends `classroom-state` when the state changes. It also sends `classroom-state` immediately when the grading clock is set, when a time edit, `Hand in all projects` or archive succeeds, and every 30 seconds to each open Student and Educator stream of a non-archived classroom.

**Countdown.** The countdown shows `secondsToHandIn` from the newest of: the page load (`GET /api/class`) and the latest `classroom-state` event. Save responses carry no countdown and do not refresh it. It is rounded down to whole minutes and split into days, hours and minutes. The page never subtracts device clock times, so the countdown shown is at most 30 seconds old.

**Projects and revisions.**

- Creating a project stores revision 1.
- Each accepted save stores revision `baseRevision + 1`. Revision numbers per project start at 1, never repeat and have no gaps.
- A revision counts as saved only after storage confirms its snapshot object. If storage fails, the save answers 503 `storage_unavailable` and the revision number is not used.
- A save whose `baseRevision` is not the current revision answers 409 `stale_revision` and changes nothing.
- When several saves with the same `baseRevision` arrive together, exactly one succeeds and every other answers 409 `stale_revision`.
- An `Idempotency-Key` is remembered for 24 hours per project and account:
  - Repeating the same key with a byte-identical body returns the stored response and stores nothing new.
  - The same key with a different body answers 409 `idempotency_conflict`.
- Names are 1 to 60 characters. New projects are named `Untitled 3D design`, `Untitled circuit` or `Untitled block program`.
- A Student's roster tile and Glancet show that Student's most recently saved project.

**Autosave and kept edits.**

- An editor saves automatically `QY_AUTOSAVE_MS` (default 1500 milliseconds) after the last edit. `Ctrl+S` and `Save` save at once.
- A tab with no unsaved edits that receives `project-saved` for its open project at a newer revision loads that revision in place. A tab with unsaved edits keeps them, and its next save gets `stale_revision`.
- Unsaved edits are also kept in the browser's local storage for that project until a save is confirmed. Reopening the project in the same browser offers them in a Notice band.

**Hand-in.**

- Hand-in is per project. A Student's `Hand in` hands in only the open project; their other projects stay `editing` until the Student hands each in or the classroom is handed in.
- A Student project is `handed_in` when its classroom is `handed_in` or the Student handed it in. Otherwise it is `editing`. There is no move back.
- A roster tile shows `Handed in` exactly when that Student's `handedIn` is true (API). It appears live on the `project-handed-in` event for the tile project, and on the `classroom-state` event that reports `handed_in`. `project-handed-in` is sent only for a Student's own `Hand in`. A classroom hand-in (manual or at the hand-in time) sends `classroom-state` alone and no `project-handed-in` events, so the roster's Status gets no `<nickname> handed in` lines; after `Hand in now` the acting Educator's Status shows `Handed in <classroom>`.
- Creating projects in a handed-in classroom answers 409 `classroom_handed_in`.
- Saves on a project whose classroom is handed in answer 409 `classroom_handed_in`. Saves on a project its Student handed in answer 409 `project_handed_in`. When both apply, `classroom_handed_in` wins (full 409 order under Error precedence).
- The check is made at the moment the save would commit, so a save arriving at the exact hand-in instant is refused.
- Handed-in snapshots stay frozen at their last revision.
- Hand-in applies only to Student projects; others answer 409 `not_a_classroom_project`.

**3D geometry.**

- New shapes measure 20 × 20 × 20 mm. A cylinder's 20 mm across is its diameter, and so is a sphere's.
- Sizes run from 0.1 to 1000 mm (both allowed), stored to one decimal. Positions are stored to 0.01 mm. A design holds at most 200 top-level objects.
- On every workplane, new shapes keep the world orientation: `w` along world X, `d` along world Y, `h` along world Z, rotation 0, so a cylinder always stands upright. A new shape's centre is the workplane origin plus the normal times half the shape's extent along that normal (half of `h` for a top or bottom face, half of `d` for front or back, half of `w` for left or right). For example, a new 20 mm box on the default workplane is centred at `0,0,10`; on the right face of that box (origin `10,0,10`) a new 20 mm box is centred at `20,0,10`.
- Cylinders and spheres are drawn with 64 segments around, and spheres with 32 rings pole to pole. Each curved mesh is scaled outward just enough that its mesh volume equals the exact volume: π r² h for a cylinder, 4⁄3 π r³ for a sphere. The cylinder is scaled radially only (its height stays `h`); the sphere is scaled uniformly on all three axes. The first vertex of every ring sits on the object's own +X axis (angle 0), and each cylinder cap is a fan of 64 triangles around a centre vertex. Triangle counts per primitive: box 12, cylinder 256 (128 side + 64 per cap), sphere 3968 (64 at each pole + 30 bands of 128). A top-level primitive's `data-triangle-count` share is exactly its count above. A group's or an export's count is that of its computed result, which is fixed only through the equality rules below and the file itself.
- Every published volume is the mesh volume of the shape or group result, rounded to the nearest cubic millimetre. For example, a 20 × 20 × 20 box grouped with a 10 mm diameter, 20 mm tall hole cylinder fully inside it gives one object of volume 6429.
- A group needs at least two selected objects and at least one solid, otherwise Status shows the matching copy and nothing changes.
- A group's result is the union of its solids minus the union of its holes, computed in a Web Worker. The result is a single object with `data-kind="group"`, solid by default, and `H` may make the whole group a hole.
- A hole that touches no solid leaves the result identical to the solids alone, with the same triangle count and bounding box.
- Grouping the same members in the same places always gives the same triangle count and bounding box.
- Ungroup restores the members, moved by any move the group received.
- Rotate turns each selected object by the stated steps about the vertical world Z axis through its own centre, on every workplane. `data-rotation-z` is that turn in whole degrees, 0 to 359, and `w`, `d`, `h` do not change.
- Align sets each selected object's centre on the chosen axis to the centre of the bounding box of the whole selection, and leaves the other axes unchanged.
- The workplane tool takes the picked face's outward normal and snaps it to the nearest of the six world axis directions; a tie goes to the first of +Z, −Z, +X, −X, +Y, −Y. The workplane normal is that direction, and its origin is the centre of the side of the picked object's world bounding box that faces it. Enter with an object selected picks its top. The default workplane is origin `0,0,0`, normal `0,0,1`.
- Each workplane has its own in-plane axes, used by the arrow keys and pointer moves:

  | Face | `data-workplane-normal` | Workplane +X is | Workplane +Y is |
  |---|---|---|---|
  | top | `0,0,1` | world +X | world +Y |
  | bottom | `0,0,-1` | world +X | world −Y |
  | front | `0,-1,0` | world +X | world +Z |
  | back | `0,1,0` | world −X | world +Z |
  | right | `1,0,0` | world +Y | world +Z |
  | left | `-1,0,0` | world −Y | world +Z |
- The camera starts at azimuth 45 and distance 200.0. It looks at the point `0,0,10` with world +Z up, from an elevation of 35° above the ground; azimuth 0 views from −Y and the azimuth grows toward +X. The vertical field of view is 40° on a canvas at least as wide as it is tall; on a taller canvas the horizontal field of view is 40°. So at start a new 20 mm shape on the default workplane sits at the centre of the canvas. Other faces are picked and other shapes tapped at their projected screen positions under this camera. Orbit changes the azimuth by 1 degree per 2 pixels of horizontal drag (dragging right lowers it), and vertical drag tilts the elevation by 0.25° per pixel between 5° and 85° (dragging down raises it). Pinch and wheel change the distance between 20.0 and 2000.0 mm, both allowed.
- `data-total-volume` sums the top-level solids only.

**Circuit model.**

- Batteries are ideal sources with 9 V by default (1 to 12 V allowed). Resistors are 1000 Ω by default (1 to 10,000,000 Ω allowed). Switches start open.
- An LED conducts only from its + terminal to its − terminal. While conducting it is a 2.0 V forward drop in series with 25 Ω, and otherwise it is open.
- The solver uses modified nodal analysis with Newton iteration over the LED states until they are consistent.
- An LED is `lit` when it carries current above 0.0 mA and at most 20.0 mA, and `off` with no current. It becomes `broken` when its unrounded current is above 20.0 mA. A broken LED then acts as an open circuit until `Reset LED` makes it `off`.
- LED brightness is current ÷ 20 mA, capped at 1.
- An open switch, a missing wire or a broken LED gives zero current through everything in series past it.
- A battery whose + and − are joined by wires and closed switches alone is `shorted`. Every current is then 0, and Status shows the short copy.
- `data-status` values and the state words in a component's accessible name:

  | Component | `data-status` | Name words |
  |---|---|---|
  | Battery | `ok`, `shorted` | `ok`, `short-circuited` |
  | LED | `off`, `lit`, `broken` | `off`, `lit <mA> mA`, `burnt out` |
  | Resistor | `ok` | `<ohms> Ω` |
  | Switch | `open`, `closed` | `open`, `closed` |

- While stopped, every current reads 0.0, lit LEDs read `off`, and broken LEDs stay `broken`.
- While running, the solver runs every `QY_SIM_TICK_MS` (default 100 milliseconds). An edit is reflected by the next tick.
- Status announces an LED when its state changes. It also announces a lit LED whose rounded current changed after an edit.
- Worked values, all with a 9 V battery: straight into an LED gives (9 − 2) ÷ 25 = 280.0 mA, broken. Through 330 Ω it gives 7 ÷ 355 = 19.7 mA, lit, brightness 0.99. Through 1000 Ω it gives 6.8 mA, lit, brightness 0.34.
- A wire joins two different terminals. A second wire between the same pair is refused with its copy.

**Block Lab.**

- A cursor starts at `0,0,0`.
- `Add Box`, `Add Cylinder` and `Add Sphere` add a 20 mm solid of that kind centred on the cursor. `Make hole` turns the most recently added object into a hole. `Move X by`, `Move Y by` and `Move Z by` move the cursor by their value, from −500 to 500 mm (both allowed, default 10). `Repeat` runs its body `Repeat count` times, from 1 to 50 (both allowed, default 3).
- Play clears the previous output and runs one action block per step. Repeat itself is not a step.
- The first step runs `QY_BLOCKS_STEP_MS` (default 400 milliseconds) after Play, and each later step one interval after the previous one.
- `data-step` counts the steps run so far and `data-state` is `running` throughout. After the last step `data-state` is `done` and Status shows the finish copy with the object count.
- The 501st step is never run: the program stops after 500 steps with its copy.
- `Stop` ends the run at once with `data-state="done"`.
- Editing the program is disabled while it runs.
- For example, Repeat 3 { Add Sphere; Move Z by 10 } runs 6 steps and makes 3 spheres centred at Z = 0, 10 and 20.
- The snapshot stores the program and the objects of the last run. Viewers render those objects.

**Glancet mesh count.** `data-mesh-count` is the number of top-level objects in the shown snapshot: 3D objects, Block Lab output objects, or circuit components.

**Exports.**

- Files are built in a Web Worker from the whole design: every top-level solid is unioned and every top-level hole subtracted, as if all were grouped. A 3D or Block Lab design with no solid cannot be exported, and nor can a circuit with no components.
- STL is binary and little-endian. It has an 80-byte header that starts with `Quarkyard`, a 32-bit triangle count, and 50 bytes per triangle.
- OBJ is text, with one `o` per export and `v` and `f` lines. Every face is a triangle, written `f a b c` with 1-based vertex indices.
- STL and OBJ meshes are closed: every edge is shared by exactly two triangles, with shared vertices written identically.
- Coordinates are in millimetres. Inches divide every coordinate by exactly 25.4.
- For a 3D or Block Lab design, SVG is the design's top view. Its `width` and `height` carry the unit suffix `mm` or `in` and equal the bounding box's X and Y extents, rounded to 3 decimals in mm or 5 in inches with no trailing zeros (for a lone 20 mm box, `width="20mm"` or `width="0.7874in"`).
- A circuit project exports only SVG in millimetres: its wiring diagram on a page with `width="297mm"` and `height="210mm"`. It has no bounding box, so the Export's `bbox` is `null` and the dialog shows the circuit size line. An upload for a circuit project with any other format or unit answers 422 `validation`.
- The file name is the project name lowercased, with every run of characters other than `a-z` and `0-9` (so non-ASCII letters too) turned into one hyphen, trimmed of hyphens, cut to 60 characters and trimmed of trailing hyphens again, plus `.stl`, `.obj` or `.svg`; when nothing is left the stem is `design`. For example `Gear Box` gives `gear-box.stl`. `name` must match that form (1 to 60 characters before the extension) and the format. The server checks only the pattern `^[a-z0-9]+(-[a-z0-9]+)*\.(stl|obj|svg)$` with the extension equal to `format`, never the project's name.
- The server checks a binary STL's length (84 bytes + 50 × triangles) and that it is closed, checks that an OBJ has faces and is closed, and checks that an SVG parses. Failures answer 422.
- An export counts as done only when storage confirms the object. Only then does the browser download the stored copy and post the two export lines to Status.
- `#qy-export` `data-triangle-count` equals the file's triangle count and is empty for every SVG export, and `data-bytes` equals the file's size.
- For 3D and Block Lab designs, the size line shows the bounding box in the chosen unit: one decimal for mm, two for in. Circuit projects show the circuit size line instead.

### Services (DP-12, DP-28, DP-37, DP-39)

- **Postgres** (`DATABASE_URL`) holds the following:
  - accounts (Educator, Personal and Student) and email-verification tokens with their send time;
  - sessions, including pending join sessions;
  - classrooms with join codes, zones, local times, instants and archive state;
  - rosters and classroom-Educator links;
  - projects with revision rows pointing at their snapshot objects;
  - export rows;
  - remembered idempotency keys;
  - join-attempt counts.

  The app applies its schema on every serve start without losing data.
- **MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) stores each snapshot at `projects/<projectId>/rev-<revision>.json` and each export at `exports/<ownerId>/<exportId>/<fileName>`. The bucket stays private. The browser never talks to MinIO: downloads stream through the app.
  - **When MinIO is unreachable:** project creates, saves and export uploads answer 503 `storage_unavailable` with no revision or export row written. Opening a project answers 503 `storage_unavailable`. There is no health polling: a page learns of the outage only from a 503 reply to its own request, and only editors show storage notices. The Notice band lists every standing notice as its own item. A save answered 503 adds two items, the save-failed copy and the standing storage-down copy, and both clear on the next successful save. Opening a project answered 503 shows the opening copy in the Notice band and in the page body with a `Try again` button. An export answered 503 adds the export-failed copy. Dashboards, rosters and home pages show no storage notice. Editors keep unsaved edits in memory and local storage. `/api/health` answers 200 `{"status":"unavailable"}`. Sign-in, joining, rosters and the live stream keep working.
- **Mailpit** (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`) receives one message per sign-up and per resend.
  - **To:** the account email.
  - **From:** `MAIL_FROM`, whose published value is `Hollowbrook Maker Co. <no-reply@hollowbrook.test>`.
  - **Subject:** `Verify your Quarkyard email`.
  - **Body:** plain text containing the link `<APP_PUBLIC_URL>/verify?token=<token>` on its own line, and the line `This link expires at <expiry instant in UTC>.`

  Students never receive or need email. **When Mailpit is unreachable:** sign-up still creates and signs in the account with `"verificationEmailSent":false`, the page shows the `mail_unavailable` copy, and resend answers 503 `mail_unavailable`.

### Seed data (DP-40)

`POST /api/grading/seed` empties every app table and every app object in the bucket, restores the real clock, then creates the records below. Every person, school and business here is invented. Instants are relative to server time at seeding (`T`), rounded down to the minute.

**Founder Educator:**

| Field | Value |
|---|---|
| Name | `Dana Whitlock` |
| Email | `dana@hollowbrook.test` |
| Password | `kiln-maple-2026` |
| Verified | yes |
| Owns | `Robotics Lab` |

**Assistant Educator:**

| Field | Value |
|---|---|
| Name | `Sam Ortega` |
| Email | `sam@hollowbrook.test` |
| Password | `brass-tack-2026` |
| Verified | yes |
| Added to | `Robotics Lab` |

**Personal maker:**

| Field | Value |
|---|---|
| Name | `Priya Natarajan` |
| Email | `priya@makers.test` |
| Password | `orbit-glue-2026` |
| Verified | no |

No verification email is sent for her at seeding.

**Classroom `Robotics Lab`:**

| Field | Value |
|---|---|
| Owner | Dana |
| Time zone | `America/Chicago` |
| Join code | `ROBO42` |
| Join opens | `T` − 1 day |
| Join closes | `T` + 7 days |
| Hand-in time | `T` + 14 days |
| State | `open` |
| Students | `Tiny Turtle`, `Blue Fox` |

**Projects.** Tiny Turtle, Blue Fox and Dana each own three projects, all at revision 3. Storage holds revisions 1 to 3 with identical content.

- **`Gear Box` (3D).** One solid group of a 40 × 40 × 20 mm box and a 16 mm diameter, 20 mm tall hole cylinder, both centred at `0,0,10`. Volume 27979. For example, with the seed data at start, its Export dialog in inches shows `Size: 1.57 × 1.57 × 0.79 in`, and its file name is `gear-box.stl`. It is saved most recently, at `T` − 5 minutes, so it is each Student's tile project.
- **`Night Light` (circuit).** `BAT-1` 9 V, `R-1` 330 Ω and `LED-1`, wired `BAT-1+` to `R-1+`, `R-1-` to `LED-1+`, and `LED-1-` to `BAT-1-`. Simulation stopped. Saved at `T` − 20 minutes.
- **`Sphere Tower` (blocks).** Repeat 3 { Add Sphere; Move Z by 10 }, with its 3 output spheres at Z 0, 10 and 20. Saved at `T` − 30 minutes.

There are no exports.

**Seed response** (`200`):

```json
{
  "educator":  {"id":"…","email":"dana@hollowbrook.test","password":"kiln-maple-2026","displayName":"Dana Whitlock"},
  "assistant": {"id":"…","email":"sam@hollowbrook.test","password":"brass-tack-2026","displayName":"Sam Ortega"},
  "personal":  {"id":"…","email":"priya@makers.test","password":"orbit-glue-2026","displayName":"Priya Natarajan"},
  "classroom": {"id":"…","name":"Robotics Lab","joinCode":"ROBO42","timeZone":"America/Chicago",
                "joinOpensAt":"…","joinClosesAt":"…","handInAt":"…"},
  "students":  [{"id":"…","nickname":"Tiny Turtle"},{"id":"…","nickname":"Blue Fox"}],
  "projects":  [{"id":"…","ownerId":"…","kind":"3d","name":"Gear Box","revision":3}],
  "storageSeeded": true
}
```

`projects` lists all nine projects. When storage is down, the seed still writes the database, answers 200 with `"storageSeeded": false`, and opening those projects answers 503.

## Technical requirements

### Deployment (DP-40)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same build step.

- `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example: `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}`.
- The server listens on `0.0.0.0` at port 4173, or at `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` behaves as in API, answering HTTP 200 with JSON `{"status":"ok"}` when healthy.
- The lockfile is committed.
- Schema creation runs on every serve start and is safe to repeat.

### Configuration and secrets (DP-41)

All of these are read once at start. None is written into source, and none is sent to the browser except the five timer values served by `/api/config`.

- `DATABASE_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`;
- `APP_PUBLIC_PORT`, and `APP_PUBLIC_URL` (the origin used in emailed links and the same-origin check);
- `GRADING_TOKEN`, which defaults to `qy-grading-local` when unset;
- `QY_AUTOSAVE_MS` (default 1500), `QY_BLOCKS_STEP_MS` (400), `QY_SIM_TICK_MS` (100), `QY_TOAST_MS` (4000), `QY_GLANCET_FADE_MS` (150);
- `QY_JOIN_RATE_LIMIT` (5), `QY_VERIFY_TTL_SECONDS` (86400).

### Server boundary (DP-42)

- The app serves its pages, built assets and API from one origin.
- A state-changing request that carries an `Origin` header other than the `APP_PUBLIC_URL` origin answers 403 `forbidden`.
- Cross-origin reads get no CORS permission.
- Body limits are as in API.
- The server never serves source files, the run manifest, lockfiles, environment values, database contents outside the API, or storage credentials. Paths outside the built assets and the routes in this brief answer 404.
- If Postgres is unreachable at boot, the server still starts listening, retries every 2 seconds, and answers health with `{"status":"unavailable"}` and other API routes with 503 `{"error":"database_unavailable","message":"Storage is unavailable. Try again in a minute."}` until Postgres answers.
- If storage is unreachable at boot, the server starts and behaves as in Services.

### Browser support and performance (DP-45, DP-49)

- The app supports current Chromium, Firefox and WebKit at 375×812, 768×1024 and 1280×800.
- Touch is supported on phones and tablets.
- The landing page and dashboard are usable within three seconds on a fresh load. Editors accept keyboard input within three seconds.
- A group of two primitives finishes within one second.
- A circuit of up to 20 components solves within one tick.
- A roster of 40 tiles scrolls with Glancet open without dropping input.
- Only Glancet runs a live WebGL view on the classroom page. Tiles use still renders redrawn when their project saves.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its licence. Shipped packages means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib, BlueOak-1.0.0 or CC0-1.0. Fonts are under OFL-1.1. Nothing shipped is GPL, LGPL or AGPL.
- IF-04: The app uses no datastore or service beyond Postgres, MinIO and Mailpit. That means no Redis, no SQLite or file-based database, and no external API at runtime.
- IF-05: Fira Sans and every icon are served from the app itself. Pages make no requests to other origins.
- IF-06: The provided service configuration and environment variable names are used unchanged.
- IF-07: The package lockfile is committed and the install command uses it.
- IF-08: No asset, copy, font or name is taken from any existing maker-education site. Icons come from the Lucide set, and every render and doodle is generated by the app.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes and no disabled type checks.
- Names in code match the domain terms in this brief: classroom, join window, hand-in, roster, nickname, revision, snapshot, solid, hole, group, workplane, LED, Glancet.
- Each domain rule is decided in exactly one place in the source, and every caller uses it. Examples: classroom state from server time, nickname normalisation, the revision rule, LED status.
- There is no abstraction with a single implementation and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the types already rule out.
- Every API error goes through one shared error shape and one precedence order.
- There are no features, routes, flags or settings beyond those in this brief, apart from the grading routes it defines.
