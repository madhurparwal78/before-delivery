# Halyard Instrument Works Kerfline Bench

Kerfline Bench is a browser workspace where one-person hardware founders model their own parts and assemblies. The founder sketches 2D profiles and constrains them until they cannot move. They extrude those profiles into parts, combine extrusions with join, cut and intersect, and assign a material to each part. Parts and purchased fasteners go into nested assemblies. The server computes volume, surface area, centroid, mass and a rolled-up bill of materials, and the founder can trust those figures when quoting machine shops in millimetres or inches. One founder and one invited contract engineer share a workspace. The app uses two backend services. Postgres is the source of truth for members, sessions, parts, sketches, constraints, revisions, features, materials, assemblies and the confirmed figures. MinIO object storage holds each part's computed body. The following are out of scope: self-registration, password reset, inviting new members, file import or export, version history, drawings, sharing links, email, billing, approvals and audit logs. Do not use any datastore beyond Postgres and MinIO.

## Problem and users

Solo hardware founders design their own lamp arms, bike mounts and sensor enclosures. They cannot pay for professional CAD or product-data seats, and free CAD licences cap editable documents, forbid commercial use or make documents public. So the geometry lives in one tool and the bill of materials lives in a spreadsheet the founder retypes by hand, and the two drift apart. A subassembly used twice is counted once. A bracket redesigned from aluminium to acetal keeps its aluminium mass. An inch figure sent to a shop was rounded from millimetres and then rounded again. A sketch that looks finished is still free to move and shifts the next time a dimension changes. The founder pays directly for each of these: a wrong shipping-weight class, scrapped first articles, and re-quotes that cost days.

- **Founder** (daily): sketches profiles until they are fully held, extrudes and combines them into parts with materials, builds nested assemblies, and reads mass properties and a rolled-up bill of materials they can quote from.
- **Contract engineer** (weekly): a part-time mechanical engineer the founder has invited. They refine individual part sketches and dimension values without overwriting the founder's work done at the same time. They cannot change materials, features or assemblies.

## Journeys

1. **First sign-in on the sample lamp.** Starting state: a freshly deployed app. Ines Varga (founder) signs in. The Ostra Desk Lamp assembly opens in the Model tab. The Assembly tree lists Base Plate, Pivot Bracket, the M4 screws and a collapsed Arm Assembly row. The totals match the seeded rollup. The feature tree lists the three assemblies, five parts and two purchased parts.
2. **Hold and extrude the switch cover.** Starting state: the seeded Switch Cover sketch shows Slack 2, with blue rings on three of its corners. Ines selects Line 1 and applies a dimension of 24 mm. The rings shrink, then the readout counts down to Slack 1. She dimensions Line 2 by typing "0.63 in", and the readout becomes Fully held while every stroke turns to ink. She presses Extrude, types a depth, confirms, and sees Save status go from Saving… to Stored with confirmed volume and mass.
3. **Refuse a conflicting constraint.** Starting state: the seeded, unextruded Switch Cover sketch is open at Slack 2. Ines selects Line 1 and applies a dimension of 24 mm, and the readout reaches Slack 1. She selects Line 1 again and applies a second dimension of 30 mm. The sketch does not change. A ghost Distance glyph and the existing Distance 1 glyph flash in the conflict colour twice, and the Model message names both constraints. She deletes Distance 1, the constraint the message names, and the readout returns to Slack 2. She applies the 30 mm dimension to Line 1 again, which now succeeds, and the readout shows Slack 1.
4. **Cut a hole and read the mass.** Starting state: an extruded Switch Cover. Ines creates a new sketch, places a circle, holds it fully with two positional distances and a diameter, extrudes it as a Cut, then switches the material. The Measurements show the confirmed reduced volume and the new mass. An Intersect that would leave nothing is refused with a named message.
5. **Build a subassembly.** Starting state: the seeded lamp, whose seeded parts are Stored. Ines creates a "Hinge Assembly". She adds one Pivot Bracket and two M3 brass heat-set inserts to it, then adds the Hinge Assembly to the lamp. Pressing Add twice on a slow connection still creates one instance. When she tries to add the Ostra Desk Lamp into the Hinge Assembly, the app refuses with a named message.
6. **Redesign the pivot bracket and quote in inches.** Starting state: the seeded lamp. Ines changes the Pivot Bracket's extrude depth, then its material. Every assembly containing the bracket shows the server's new quantities, masses and piece counts, including the collapsed Arm Assembly row. She switches display to inches with three decimals to read figures for an inch-based shop. She adds a tolerance to a dimension, then switches back to millimetres and sees the original figures. Later, on a phone, she opens the bill of materials and reads stacked rows with the same figures.
7. **Save while storage is down.** Starting state: the object store is unreachable. Ines edits a part. The outage banner appears, the part is marked Not stored, and the lamp keeps its last confirmed figures. Once storage is reachable again, her next save marks the part Stored, with no restart.
8. **Two people on one sketch.** Starting state: Ines and Teo Lindqvist (contract engineer) both have the Pivot Bracket sketch open. Teo changes a dimension value. Ines then applies a change from her older view. Her change is refused, and the Save conflict notice names Teo and the revision. She presses Reload and sees Teo's change intact.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Member sign-in** A seeded member signs in with email and password and gets a session cookie, and every endpoint except health refuses requests without a session, as specified in API.
- **DP-02 — Exact sample product** On first boot against an empty database the workspace holds exactly the records in Seed data and nothing else, with every seeded part that has extrudes Stored and its body object present once storage confirms the boot write, and the Switch Cover reading No body.
- **DP-03 — First sign-in opens the lamp** When the founder signs in, the Ostra Desk Lamp opens in the Model tab with its Assembly tree, Arm Assembly collapsed, and totals equal to the server's rollup.
- **DP-04 — Degrees of freedom from the solver** The server computes each sketch's slack from the entity freedoms minus the rank of its consistent constraints and reports every sketch point's remaining freedom of 0, 1 or 2, as qualified in Business rules.
- **DP-05 — Constraint ranks and redundancy** Each accepted constraint lowers slack by the freedom it actually removes, and a consistent constraint that removes none is accepted and marked redundant.
- **DP-06 — Slack rings and readout** Each sketch point with remaining freedom shows a slack-coloured ring whose radius grows with its freedom, the bottom strip reads Slack N, and a sketch at zero turns its strokes to ink with the readout Fully held.
- **DP-07 — Slack ring motion order** When a constraint is accepted, the affected rings first resize and only then does the readout count step by step to the new total, within the timings in Motion and effects.
- **DP-08 — Constrain a profile until Fully held** The founder selects entities on the Switch Cover sketch and applies constraints and dimensions until the readout shows Fully held and every stroke is ink.
- **DP-09 — Over-constraint refused** A constraint that would over-constrain a sketch is refused, the sketch and its revision stay unchanged, and the response names the existing constraint it conflicts with by the rule in Business rules.
- **DP-10 — Conflict flash** A refused constraint's glyph and the named existing constraint's glyph both flash twice in the conflict colour while the Model message names both constraints.
- **DP-11 — Resolve a conflicting constraint** The founder tries a conflicting constraint, reads which constraint blocks it, deletes that constraint and then applies the new one successfully.
- **DP-12 — Millimetre storage** Every length is stored once in millimetres at full precision, and changing display units or decimals never changes a stored value, so switching mm to in and back shows the original figure.
- **DP-13 — Dimension input with units** Every length input accepts a decimal or fraction with an optional mm or in suffix, stores the exact converted millimetre value, and rejects anything else as a field error.
- **DP-14 — Tolerances** A dimension carries an optional symmetric or asymmetric tolerance stored separately in millimetres and shown at the member's display precision in the formats in Business rules.
- **DP-15 — Switch units and precision** The founder switches display to inches with three decimals, types a dimension in inches with a tolerance, and switches back to see the original millimetre figures.
- **DP-16 — Extrude rules** Only a closed, fully held profile can be extruded, with the operation order, depth limits and directions in Business rules, and a sketch that drives an extrude must stay fully held.
- **DP-17 — One feature per Extrude press** Extrude requests carry an Idempotency-Key, a replay returns the first response without a second feature, and pressing Confirm extrude twice on a slow connection adds one feature.
- **DP-18 — Live depth preview** While the depth handle is dragged or the depth typed, the Measurements region shows Preview volume and mass that update in place, and the confirmed server figures replace them when the change commits.
- **DP-19 — Extrude a part from a sketch** The founder extrudes the fully held Switch Cover sketch using only the keyboard and sees the part Stored with confirmed volume and mass.
- **DP-20 — Booleans give one connected body** Join, cut and intersect always give one connected closed body, and a result that is empty or in separate pieces is refused with nothing changed.
- **DP-21 — Server mass properties** The server computes volume, surface area, centroid and mass from the stored body, agreeing with closed-form values within the tolerances in Business rules.
- **DP-22 — Cut a hole and read the mass** The founder sketches a hole on the extruded Switch Cover, cuts it, changes the material and reads the new confirmed mass.
- **DP-23 — Stored only after storage confirms** A part save marks the part Stored and replaces its confirmed figures only after the body object is written at the key and in the format given in Services.
- **DP-24 — Save a part and see Stored** The founder changes a part, watches Save status pass from Saving… to Stored, and the Part view draws the newly stored body.
- **DP-25 — Storage outage keeps confirmed figures** When storage refuses a save, the change is kept, the part is Not stored, its confirmed figures and every assembly figure stay at the last stored values, and the next save after storage returns is Stored without a restart.
- **DP-26 — Save during a storage outage** With storage unreachable the founder edits a part, sees the outage banner and Not stored, and the lamp's figures stay unchanged.
- **DP-27 — Multi-level BOM rollup** A bill of materials multiplies quantities through every nesting level, merges each part into one line, includes purchased parts at their declared mass, and totals mass as the sum of its lines.
- **DP-28 — Redesign ripples to every assembly** After the founder changes the Pivot Bracket's depth or material, every assembly containing it shows the server's new rolled-up quantity, mass and piece count, including collapsed subassembly rows.
- **DP-29 — No assembly contains itself** Adding an assembly to itself, or to any assembly it contains at any depth, is refused with a named message.
- **DP-30 — One instance per Add** Add-to-assembly requests carry an Idempotency-Key, a replay returns the first response without a second instance, and pressing Add twice on a slow connection adds one instance.
- **DP-31 — Purchased parts** The founder records purchased parts with a declared mass and places them in assemblies, and the bill of materials shows them as Purchased lines.
- **DP-32 — Build a subassembly** The founder creates a subassembly, adds a part and a purchased fastener to it, places it in the lamp, and is refused when trying to place the lamp inside it.
- **DP-33 — Stale saves refused** A change carrying an older base revision is refused with a conflict naming who saved the newer revision, and of simultaneous changes from the same revision exactly one succeeds.
- **DP-34 — Contract engineer scope** The contract engineer can change sketches and save parts but is refused every founder-only action listed in Business rules, and the browser does not show them those controls.
- **DP-35 — Two people on one sketch** The founder and the contract engineer edit the same sketch, the later stale change shows the Save conflict naming the other person, and Reload shows that person's change intact.
- **DP-36 — Check the BOM on a phone** On a phone-width screen the founder opens the lamp's bill of materials, reads stacked rows with the same figures as the server, and opens the feature tree as a bottom sheet.
- **DP-37 — Keyboard-complete sketching** Drawing a line, selecting entities, applying a parallel or dimension constraint with units and confirming an extrude all work with the keyboard alone, with visible focus on the canvas selection and the panel fields.
- **DP-38 — Sheets, dialogs and shortcuts** Tab and Shift+Tab wrap inside every open dialog and sheet, Escape closes it and returns focus to its opener, and sketch shortcuts work whichever control in the sketch workspace has focus.
- **DP-39 — Published layouts** At 1280×800, 768×1024 and 375×812 the workspace shows the published layout with no horizontal page overflow, the feature tree becomes a bottom sheet below 768 px, and the bill of materials becomes stacked rows below 600 px.
- **DP-40 — Live regions and feedback copy** Every async action shows its pending, success, error and outage states with the exact copy in Feedback states, announced through the named live regions.
- **DP-41 — Reduced motion** With reduced motion requested, every motion is replaced by the instant or steady substitute in Motion and effects, with the same information on screen.
- **DP-42 — Vellum workspace look** The workspace reads as a full-bleed vellum canvas with a hairline grid, light floating panels, tabular figures, and blue used only for slack, as described in Visual design.
- **DP-43 — Run manifest and health** The run manifest installs, builds and serves the app on the published port, and the health endpoint answers once the database and seed are ready, as specified in Deployment.
- **DP-44 — Server boundary** The server refuses cross-origin writes and non-JSON or oversized bodies, never serves source or configuration files, seeds once when two processes start together, and starts normally without storage.
- **DP-45 — Real wiring** Credentials and URLs come from the environment, slack and mass figures come from a real solver and real geometry on the server, and bodies are really written to and read from object storage.

## Frontend

### Screens and layout (DP-03, DP-36, DP-39)

**Sign-in screen.** A centred form on the vellum ground. Above it, the wordmark "Kerfline Bench" with "Halyard Instrument Works" in smaller type. The form has an Email field, a Password field and a Sign in button. At 375×812 the form spans the width minus a comfortable margin. At the larger sizes it is a narrow column about 360 px wide.

**Workspace.** After sign-in the member lands in the workspace with the workspace's product assembly (Ostra Desk Lamp) open. The layers, from back to front:

- **Canvas**: covers the whole viewport edge to edge and holds the hairline grid. It shows one of the following:
  - the Part view: a still, fixed three-quarter view of the open part's stored body;
  - the Assembly view: every instance's stored body drawn once, left to right in tree order, each labelled "×<quantity>";
  - the Sketch canvas: the open sketch drawn flat on its plane;
  - the Bill of materials, when that tab is active.
- **Brand corner**: top left. The wordmark, the signed-in member's name and the Sign out button.
- **Feature tree**: a narrow floating panel on the left, below the brand corner, in three groups:
  - Assemblies;
  - Parts, each expandable to its sketches and extrudes;
  - Purchased parts.

  Each part shows its body status chip.
- **Properties panel**: floats on the right. Its content depends on the mode:
  - Assembly mode: the Assembly tree, Assembly totals and Add to assembly.
  - Part mode: Save status, the Material, the Measurements, Save part and New sketch.
  - Sketch mode: Save status at the top of the panel, then the tool form, Constrain selection, the dimension fields and the Constraints list.
  - Editing an extrude: the extrude form.
- **Assembly view tabs**: in assembly mode, a small "Model / Bill of materials" tab pair floats top-centre.
- **Command strip**: one strip along the bottom edge. It holds the Tools toolbar, the Slack readout, the Units choice and Decimals. On phones it also holds the Feature tree and Properties buttons.

Layout per published viewport (all three have no horizontal page overflow, and the canvas always fills the viewport behind everything):

| Viewport | Feature tree | Properties | Command strip | Bill of materials tab |
|---|---|---|---|---|
| 1280×800 | Floating panel on the left, about 240 to 280 px wide, its left edge within 24 px of the viewport's left edge | Floating panel on the right, about 300 to 340 px wide, its right edge within 24 px of the viewport's right edge | One row, centred along the bottom | Full-width table with six columns in one header row; the feature tree and Properties panel are hidden while this tab is active |
| 768×1024 | Floating panel on the left, about 200 to 240 px wide | Floating panel on the right, about 260 to 300 px wide | One row spanning the bottom | Same full-width six-column table |
| 375×812 | Not visible at load; opens as a bottom sheet from the Feature tree button | Not visible at load; opens as a bottom sheet from the Properties button | Spans the bottom and wraps to at most two rows | Stacked rows, as described below |

The breakpoints are exact:

- Below 768 px wide (767 and under), the feature tree and the Properties panel are bottom sheets.
- At 768 and above, they float.
- Below 600 px wide, each Bill of materials row is a stacked block. Its cells sit one under another at the full row width, in column order (Item, Kind, Material, Qty, Unit mass, Line mass). Each cell shows its column name before its value.
- At 600 and above, the Bill of materials is a regular table.

Bottom sheets cover at most 70% of the viewport height, measured from the bottom edge. The canvas stays visible above them. Only one sheet is open at a time.

In visual order, left to right on the larger viewports: feature tree, canvas centre, Properties panel. The command strip sits below all three.

### Public screens and controls (DP-03, DP-06, DP-10, DP-36, DP-37, DP-38, DP-39, DP-40)

Only the controls and regions listed here are public. Everything else is free. `<name>` is a record's name. `<label>` is an entity, point or constraint label from Business rules.

| Role and accessible name | Where | Visible copy and notes |
|---|---|---|
| `form "Sign in"` | Sign-in screen | Contains the three controls below |
| `textbox "Email"` | Sign in | Label "Email" |
| password field labelled "Password" | Sign in | Label "Password" |
| `button "Sign in"` | Sign in | "Sign in" |
| `button "Sign out"` | Brand corner | "Sign out" |
| `navigation "Workspace"` | Desktop and tablet feature tree panel | Contains `tree "Feature tree"` |
| `tree "Feature tree"` | Feature tree panel or sheet | Its `treeitem`s have accessible names beginning with the item's name; part items carry a chip reading "Stored", "Not stored", "Saving…" or "No body" |
| `button "New part"`, `button "New assembly"`, `button "New purchased part"` | Feature tree (founder only) | Same copy |
| `dialog "New part"` | Modal | `textbox "Name"`, `combobox "Material"`, `button "Create part"`, `button "Cancel"` |
| `dialog "New assembly"` | Modal | `textbox "Name"`, `button "Create assembly"`, `button "Cancel"` |
| `dialog "New purchased part"` | Modal | `textbox "Name"`, `textbox "Declared mass (g)"`, `button "Create purchased part"`, `button "Cancel"` |
| `tablist "Assembly view"` | Assembly mode | `tab "Model"`, `tab "Bill of materials"` |
| `img "Assembly view: <name>"` | Canvas, assembly Model tab | Drawn from stored bodies |
| `img "Part view: <name>"` | Canvas, part mode | Drawn from the part's stored body |
| `complementary "Properties"` | Properties panel at 768 px and wider | |
| `dialog "Properties"` | Properties sheet below 768 px | Same content, plus `button "Close"` |
| `dialog "Feature tree"` | Feature tree sheet below 768 px | Contains `tree "Feature tree"` and `button "Close"` |
| `button "Feature tree"`, `button "Properties"` | Command strip below 768 px | Open the sheets |
| `table "Assembly tree"` | Properties, assembly mode | Columns "Item", "Qty", "Unit mass", "Subtotal", "Pieces"; one row per instance; nested rows appear under an expanded assembly row |
| `button "Expand <name>"` / `button "Collapse <name>"` | Assembly tree, on assembly rows | Has `aria-expanded` |
| `spinbutton "Quantity of <name>"` | Assembly tree row (founder) | Whole numbers |
| `button "Remove <name>"` | Assembly tree row (founder) | "Remove" |
| `region "Assembly totals"` | Properties, assembly mode | Three lines: "Total mass <mass>", "Pieces <n>", "Lines <n>" |
| `button "Add to assembly"` | Properties, assembly mode (founder) | "Add to assembly" |
| `dialog "Add to assembly"` | Modal | `combobox "Component"` (parts, purchased parts and assemblies by name), `spinbutton "Quantity"` (starts at 1), `button "Add"`, `button "Cancel"` |
| `table "Bill of materials"` | Canvas, Bill of materials tab | Column headers "Item", "Kind", "Material", "Qty", "Unit mass", "Line mass"; Kind reads "Made" or "Purchased"; Material is "—" for purchased lines; a line whose part is Not stored also reads "Not stored" in its Item cell; a last row "Total" shows the total mass |
| `combobox "Material"` | Properties, part mode (founder) | Options "<material name> · <density> g/cm³" |
| `button "Save part"` | Properties, part mode | "Save part" |
| `button "New sketch"` | Properties, part mode (founder) | Opens `dialog "New sketch"`, which has `radiogroup "Plane"` (radios "Top", "Front", "Right"), `textbox "Offset"`, `button "Create sketch"` and `button "Cancel"` |
| `status "Measurements"` | Properties, part mode | Rows "Volume", "Surface area", "Centroid", "Mass"; a heading word "Preview" or "Confirmed"; or the copy for a part with no body from Feedback states |
| `status "Save status"` | Properties, part mode and sketch mode (at the top of the panel in sketch mode) | Copy from Feedback states |
| `group "Sketch canvas"` | Canvas, sketch mode | One Tab stop. Contains `button "Origin"`, one `button "<entity label>"` per entity and one `button "<point name>"` per sketch point, each with `aria-pressed` showing selection; one `img "<constraint label>"` per constraint glyph; one `img "Slack ring at <point name>"` per point with freedom above zero |
| `toolbar "Tools"` | Command strip | `button "Select"`, `button "Line"`, `button "Circle"`, `button "Arc"`, `button "Point"`, `button "Extrude"` (Extrude for the founder only); the active tool has `aria-pressed="true"` |
| `group "Line"` | Properties, Line tool | `textbox "Start X"`, `textbox "Start Y"`, `textbox "End X"`, `textbox "End Y"`, `button "Place line"` |
| `group "Circle"` | Properties, Circle tool | `textbox "Centre X"`, `textbox "Centre Y"`, `textbox "Diameter"`, `button "Place circle"` |
| `group "Arc"` | Properties, Arc tool | `textbox "Centre X"`, `textbox "Centre Y"`, `textbox "Radius"`, `textbox "Start angle"`, `textbox "End angle"`, `button "Place arc"` |
| `group "Point"` | Properties, Point tool | `textbox "X"`, `textbox "Y"`, `button "Place point"` |
| `group "Constrain selection"` | Properties, sketch mode | Buttons "Coincident", "Horizontal", "Vertical", "Parallel", "Perpendicular", "Equal", "Fix", "Dimension", "Horizontal distance", "Vertical distance"; a button that cannot apply to the current selection is disabled |
| `textbox "Dimension value"`, `textbox "Tolerance"`, `button "Apply dimension"` | Properties, while adding or editing a dimension | |
| `list "Constraints"` | Properties, sketch mode | One item per constraint showing its label, its value and tolerance if it has one, and "redundant" when redundant; `button "Edit <label>"` on dimensions; `button "Delete <label>"` on each |
| `button "Delete selection"` | Properties, sketch mode | "Delete selection" |
| `button "Close sketch"` | Properties, sketch mode | Returns to the Part view |
| `form "Extrude"` | Properties, new extrude | `textbox "Depth"`, `radiogroup "Operation"` (radios "New body", "Join", "Cut", "Intersect"), `radiogroup "Direction"` (radios "Normal", "Reverse", "Symmetric"), `button "Confirm extrude"`, `button "Cancel"` |
| `form "Edit <feature name>"` | Properties, existing extrude (founder) | `textbox "Depth"`, `radiogroup "Direction"`, `button "Apply depth"` |
| `slider "Extrude depth"` | Canvas, beside the profile, while an extrude form is open | Value text is the depth in display units |
| `status "Slack"` | Command strip | "Slack <n>" or "Fully held"; empty outside sketch mode |
| `radiogroup "Units"` | Command strip | Radios "mm", "in" |
| `spinbutton "Decimals"` | Command strip | 0 to 4 |
| `status "Model message"` | Floating just above the command strip | Model messages from Feedback states and server refusals |
| `alert "Storage outage"` | Top-centre banner | Copy from Feedback states |
| `alert "Save conflict"` | Top-centre notice | Server conflict message plus `button "Reload"` |

### Interactions (DP-08, DP-11, DP-15, DP-19, DP-37, DP-38)

**Focus order.** Tab order in the workspace:

1. Brand corner.
2. Feature tree (one Tab stop).
3. Assembly view tabs, when shown.
4. Sketch canvas (one Tab stop), when shown.
5. Properties panel controls, top to bottom.
6. Command strip controls, left to right.

Every focused control shows an ink focus ring at least 2 px thick with a ground-coloured gap, so it stays visible on panels and on the canvas.

**Feature tree.**

- ArrowUp and ArrowDown move between visible items. ArrowRight expands an item and ArrowLeft collapses it.
- Enter, a click or a tap opens the item:
  - an assembly opens in assembly mode;
  - a part opens in part mode;
  - a sketch opens in sketch mode;
  - an extrude opens its edit form.
- On phones, opening an item closes the sheet and returns focus to the Feature tree button.

**Sketch canvas selection.**

- When the canvas group has focus, ArrowRight and ArrowDown move a roving highlight forward and ArrowLeft and ArrowUp move it back. The order is Origin, then each entity in creation order, each followed by its points.
- Space or Enter toggles the highlighted item in the selection.
- Escape clears the selection.
- With a mouse, a click selects one item and replaces the selection, and Shift+click adds or removes an item. On touch, each tap toggles an item.
- Selected entities draw twice as thick with a ground-coloured halo. The keyboard-highlighted item also carries the focus ring.
- The wheel or a pinch zooms. Dragging empty canvas, or a two-finger drag, pans. The + and − keys zoom while the canvas has focus.

**Shortcuts.** These work whenever focus is anywhere in the sketch workspace (canvas, Properties panel, command strip) except inside a text field, a spinbutton, or an open dialog or sheet:

| Group | Keys |
|---|---|
| Tools | L Line, O Circle, A Arc, K Point, Esc Select (after clearing the selection), X Extrude |
| Constraints | C Coincident, H Horizontal, V Vertical, P Parallel, R Perpendicular, E Equal, F Fix, D Dimension |
| Editing | Delete or Backspace deletes the selection |

**Drawing.**

- Choosing Line by key or button shows the Line group in Properties with Start X focused. The fields are prefilled with a 20 mm horizontal line beside the last entity.
- Tab moves through the fields. Enter in any field, or pressing Place line, places the line. Escape cancels and returns focus to the canvas.
- Circle, Arc and Point work the same way with their own fields.
- With a pointer, a Line takes two clicks (start, end) and a Circle takes two clicks (centre, a point on the rim). An Arc takes three clicks (centre, start, end, counter-clockwise). A Point takes one click.
- Placing never adds constraints automatically.
- After placing, the new entity is highlighted on the canvas and focus returns to the canvas.

**Constraining.**

- With the right entities selected, pressing a constraint key or button sends the constraint immediately.
- Dimension (D) works out its kind from the selection: one line gives a Distance, two points give a Distance, a circle gives a Diameter, and an arc gives a Radius. It opens Dimension value, prefilled with the current measured value and focused, plus Tolerance. Enter in either field, or Apply dimension, sends it. Escape cancels and focus returns to the canvas.
- Edit <label> on a dimension opens the same fields filled with its value and tolerance.
- After an accepted constraint, focus returns to the canvas with the same selection.

**Extruding.**

- Extrude (X or the button) opens the Extrude form with Depth focused. Operation defaults to New body for a part's first extrude and Join after that. Direction defaults to Normal.
- Typing in Depth updates the preview as you type. ArrowUp and ArrowDown on the slider change the depth by one step (1 mm when displaying mm, 0.05 in when displaying inches), and Shift with an arrow changes it by ten steps. Dragging the slider handle does the same continuously.
- Enter in Depth, or Confirm extrude, sends the extrude. Escape cancels and focus returns to the canvas.
- For an existing extrude, releasing the slider handle, pressing Enter on the slider or in Depth, or pressing Apply depth commits the change.
- While a request is pending, the confirming button is disabled and repeated presses do nothing. The browser keeps one Idempotency-Key per intended action and sends the same key again if the founder presses again after an unanswered request.

**Assemblies.**

- Add to assembly opens its dialog with Component focused. Enter on Add sends the request, and while it is pending repeated presses do nothing (same key rule as extruding).
- In the tree, a Quantity of <name> change commits on Enter or when focus leaves the field.
- Expand and Collapse toggle nested rows. All assembly rows start collapsed each time an assembly opens.

**Dialogs and sheets.**

- Opening one moves focus to its first field (or to its first control if it has no fields).
- Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Focus never leaves the open dialog or sheet.
- Escape, Cancel, Close or a tap on the dimmed area outside closes it and returns focus to the control that opened it.

**Units and precision.** Choosing mm or in, or changing Decimals, saves the preference and redisplays every figure in place without a reload.

**Conflict notice.** Reload in the Save conflict notice refetches the open sketch, part or assembly, discards the browser's unsent edit, and hides the notice.

### Visual design (DP-06, DP-42)

**Colour roles.**

- **Ground**: a warm, pale vellum off-white, like drafting film. It is the colour of the canvas and the page.
- **Ink**: a near-black with a slight blue-grey cast. Used for text, fully held strokes, outlines, buttons and focus rings.
- **Slack accent**: a clear cobalt blue. It is used only for slack: slack rings, the strokes of a sketch that still has slack, and the Slack readout numerals while the slack is above zero. Nothing else in the product is blue.
- **Conflict**: a brick red. Used only for conflict flashes and outlines, field errors, the Save conflict notice edge and the storage outage banner edge.
- **Rule**: a warm mid-grey. Used for the canvas grid, panel edges and table rules.

Panels are the ground colour lifted very slightly lighter, edged with a single rule-grey hairline and a soft, short shadow. Panels have no heavy borders or dark title bars.

**Grid.** The canvas grid is drawn with the thinnest line the screen can render: half a pixel on high-density screens, one pixel otherwise. Lines are every 10 mm at the current zoom, with every tenth line slightly darker.

**Type.**

- Space Grotesk for display: the wordmark, panel titles and the readout word "Fully held".
- IBM Plex Sans for body text and labels.
- IBM Plex Mono with tabular figures for every number in the product, so columns of figures line up digit for digit.
- Each heading level is one-fifth larger than the level below it, starting from body text.

**Density and size.** Density is compact, with tight rows and small gaps. Every interactive control still has a hit area of at least 44 by 44 px, including canvas entity and point targets.

**Contrast.** All text and essential icons meet WCAG 2.2 AA contrast against the surface they sit on.

**Composition.** One full-bleed vellum sheet with the grid as the base layer. Floating panels hover on it, and nothing on the canvas is boxed by heavy chrome. The Part and Assembly views shade bodies in two warm greys with ink hairline edges.

### Motion and effects (DP-07, DP-10, DP-18, DP-41)

Motion uses a fast start and a long, gentle finish unless noted.

| Motion | What it means | How it moves |
|---|---|---|
| Sheet enter and exit | A sheet opening or closing | A bottom sheet slides up from the bottom edge in about a quarter of a second and slides down in about a fifth of a second |
| Dialog enter | A dialog opening | Fades in and scales from very slightly smaller, in under a fifth of a second |
| Hover and press | Pointer feedback | Buttons darken slightly on hover within a tenth of a second and sink slightly while pressed |
| Status change | Save status or a chip changes | Changes with a quick fade under a fifth of a second; "Saving…" is text, never a spinner |

**Signature: Slack rings.** Each sketch point with freedom shows an unfilled slack-blue ring centred on it. The ring's radius is 6 px per remaining degree of freedom: 6 px for one, 12 px for two, and no ring for none. The radius is measured in screen pixels and stays the same at every zoom. When the server accepts a constraint, in order:

1. Every affected ring grows or shrinks to its new radius, taking between about 0.15 and 0.3 seconds (aim for a little under a quarter of a second). A ring that reaches zero disappears.
2. Only after the rings finish, the numerals in the Slack readout count from the old total to the new one. They show each whole number in between once, evenly spaced, over between about 0.25 and 0.4 seconds (aim for about a third of a second). If the total goes up (a constraint was deleted), the rings grow and the numerals count up the same way.
3. When the count reaches zero, every sketch stroke changes from slack blue to ink over between about 0.1 and 0.25 seconds (aim for about a sixth of a second), and the readout changes to "Fully held".

**Conflict flash.** When a constraint is refused:

- A ghost glyph for the refused constraint appears where it would have been drawn.
- The ghost glyph and the glyph of the existing constraint the server named both turn conflict red and back, twice. Each turn lasts between about 0.12 and 0.22 seconds (aim for about a sixth of a second).
- The ghost glyph then disappears. The sketch does not move.

**Depth handle settle.** When the founder releases the Extrude depth handle, or steps it with the keyboard, the handle overshoots the target by a few pixels (no more than 6 px). It springs back and comes to rest exactly at the depth shown in Depth within half a second.

**Banned motion.** There is no looping or decorative animation anywhere: no idle movement in the Part or Assembly views, no pulsing and no shimmer. The Part and Assembly views are still images that only redraw when a stored body changes.

**Reduced motion.** When the operating system asks for reduced motion:

- Rings jump to their new radius at once.
- The readout shows the new number with no count.
- Strokes change colour at once.
- Instead of the flash, the ghost glyph and the named glyph both show a steady conflict-red outline. The outline stays until the next sketch action (any key handled by the canvas, any click on the canvas, or any constraint request) and comes with the same Model message.
- The depth handle stops at its target with no overshoot.
- Sheets and dialogs appear and disappear without sliding or scaling.

The state and information on screen are the same as with full motion.

### Feedback states (DP-18, DP-25, DP-26, DP-33, DP-40)

The browser shows the server's `message` exactly wherever this table says "server message". Field errors appear under their field in conflict red. The field gets `aria-invalid="true"` and is described by the error text.

| Action | Pending | Success | Error | Outage |
|---|---|---|---|---|
| Sign in | Button reads "Signing in…" and is disabled | Workspace opens | Server message in an `alert` inside the Sign in form; field errors under fields | — |
| Any part change (sketch edit, extrude, depth, material, Save part), except as stated under Part with no body below | `status "Save status"` reads "Saving…"; the part's chip reads "Saving…" | Save status reads "Stored"; chip "Stored"; Measurements heading "Confirmed" with the server's figures | Refusals go to `status "Model message"` as the server message; field errors under fields; nothing changes on screen | Save status reads "Not stored"; chip "Not stored"; Measurements show the last confirmed figures under "Confirmed" |
| Constraint accepted | Readout unchanged until the reply | Model message "<label> added. Slack <n>." or, at zero, "<label> added. Fully held." | Model message is the server message; conflict flash | as for any part change |
| Redundant constraint accepted | as above | Model message "<label> added and marked redundant." | — | as above |
| Extrude confirmed | Confirm extrude reads "Extruding…" and is disabled | Model message "<feature name> added." | Server message in Model message | as for any part change |
| Add to assembly | Add reads "Adding…" and is disabled | Dialog closes; Model message "<name> ×<quantity> added to <assembly name>." | Server message under Component, or the field error | — |
| Stale change (412) | — | — | `alert "Save conflict"` shows the server message and Reload | — |
| No answer from the server | — | — | Model message "No answer from the server. Your change was not confirmed." and the pending state ends | — |

Other states:

- **Storage outage.** `alert "Storage outage"` reads "Storage is unreachable. Changes are kept, but parts are marked Not stored until a save reaches storage." It appears while the latest storage status check reports storage as unreachable. The browser checks when the workspace opens, after every part change, and every 10 seconds. The banner disappears after a check reports storage as reachable.
- **Part with no body.** For a part whose status is `none`, Measurements read "No stored body yet", the chip reads "No body", and the Part view shows "No stored body yet" in place of the drawing. A change to such a part, other than its first extrude, shows Save status "Saving…" while pending and "No body yet" once the server accepts it, and the chip stays "No body". A part whose status is `not_stored` with no confirmed figures shows Measurements "No stored body yet", chip "Not stored", Save status "Not stored", and "No stored body yet" in place of the Part view drawing.
- **Body view unavailable.** If a stored body cannot be loaded, the Part or Assembly view shows "Body view unavailable while storage is unreachable." in place of the drawing.
- **Preview.** While a depth is being dragged or typed, the Measurements heading reads "Preview" and shows the preview figures from Business rules. A Preview figure that cannot be estimated shows "—".

## Backend

### API (DP-01, DP-09, DP-13, DP-17, DP-20, DP-23, DP-25, DP-29, DP-30, DP-33, DP-34)

**General conventions.**

- All endpoints are under `/api`. Request and response bodies are JSON (`application/json`), with the body size limit in Server boundary.
- Lengths in responses are millimetre numbers at full precision. Masses are grams and densities are grams per cubic centimetre.
- Wherever a request field is a length, it accepts either a number (millimetres) or a string in the Dimension input grammar in Business rules.
- Unknown request fields are ignored.
- Keys in `fields` are the dotted path of the offending request field. Examples: `entity.start.x`, `entity.end.y`, `entity.center.x`, `entity.radius`, `entity.start_angle_deg`, `entity.end_angle_deg`, `entity.x`, `depth`, `offset`, `value`, `quantity`, `declared_mass_g`. A problem anywhere inside a tolerance, whether sent as an object or a string, is reported under `tolerance`. A missing or bad `Idempotency-Key` header is reported under `idempotency_key`. A bad `component` object is reported under `component`. Each field reports only its first problem.
- IDs are opaque strings.
- The session is an HttpOnly, SameSite=Lax cookie named `kerfline_session`.

**Error body.** Every error uses one shape:

```json
{"error":{"code":"<code>","message":"<message>","fields":{"<field>":"<field message>"}}}
```

`fields` is present only for `invalid`. Some codes add extra keys inside `error`, as noted in the table below.

**Error precedence.** One order applies to the whole API, after the checks in Server boundary:

1. 401 unauthenticated.
2. 404 for an unknown resource, or one outside the member's workspace.
3. 403 for a founder-only action by the engineer.
4. An idempotent replay returns its stored response.
5. 412 for a stale base revision.
6. 422 for validation.
7. 409 for model refusals.

Endpoint rows below list only their own extra errors.

**Error codes.**

| Status | code | message |
|---|---|---|
| 401 | `unauthenticated` | Sign in to continue. |
| 401 | `bad_credentials` | Email or password is not right. |
| 403 | `forbidden` | Only the founder can change this. |
| 404 | `not_found` | Not found. |
| 409 | `idempotency_conflict` | This Idempotency-Key was already used for a different request. |
| 409 | `over_constrained` | `<refused label> would conflict with <existing label>. Nothing was changed.` Adds `"refused_label"` and `"conflicts_with":{"id","label"}` |
| 409 | `unsolvable` | No shape satisfies every constraint with this value. Nothing was changed. |
| 409 | `sketch_drives_feature` | `<sketch name> drives <feature name> and must stay fully held. Nothing was changed.` |
| 409 | `profile_not_ready` | `<sketch name> needs a closed, fully held profile before it can be extruded.` |
| 409 | `empty_body` | `<operation> leaves no material. Nothing was changed.` (operation is "Cut" or "Intersect") |
| 409 | `separate_bodies` | `<operation> would leave separate pieces; a part must be one connected body. Nothing was changed.` (operation is "Join", "Cut" or "Intersect") |
| 409 | `assembly_cycle` | `<assembly name> cannot contain itself.` (the assembly being added to) |
| 409 | `no_confirmed_body` | `<part name> has no stored body yet, so it cannot be placed.` |
| 412 | `stale_revision` | `<member name> saved <thing> at revision <n> after you opened it. Reload to see their changes.` Adds `"current_revision"` and `"saved_by":{"id","name"}` |
| 422 | `invalid` | Check the highlighted fields. |
| 503 | `storage_unavailable` | Storage is unreachable. |

In the `stale_revision` message:

- `<member name>` is the member who made the current revision.
- `<n>` is the current revision.
- `<thing>` is `<sketch name> on <part name>` for a sketch, `<part name>` for a part, or the assembly's or purchased part's name.

**Field messages (422).**

| Field | Message |
|---|---|
| Any length that fails the grammar | Enter a number, optionally followed by mm or in. |
| Length out of range | Enter a length greater than 0 and at most 10000 mm. |
| Coordinate or offset out of range | Enter a coordinate from −10000 mm to 10000 mm. |
| Angle (`entity.start_angle_deg`, `entity.end_angle_deg`) | Enter an angle in degrees. |
| `tolerance` | Enter a tolerance like ±0.05 or +0.1/−0.05. |
| `refs` | These entities cannot take a <Kind> constraint. |
| `base_revision` missing or not a whole number | Send the revision you started from. |
| `idempotency_key` | Send an Idempotency-Key header of 1 to 100 visible characters. |
| `name` empty or too long | Enter a name of 1 to 80 characters. |
| `name` already used | That name is already used. |
| `quantity` | Enter a whole number from 1 to 999. |
| `declared_mass_g` | Enter a mass greater than 0 and at most 100000 g. |
| `operation` | The first extrude makes the body; later extrudes join, cut or intersect. |
| `plane`, `direction`, `units`, `precision`, `kind` | Choose one of the listed options. |
| `material_id` | Choose one of the listed materials. |
| `component` | Choose one of the listed components. |
| `email` | Enter your email. |
| `password` | Enter your password. |

**Resource shapes.**

- **Member**: `{"id","name","email","role":"founder"|"engineer","units":"mm"|"in","precision":0..4}`.
- **Material**: `{"id","name","density_g_cm3"}`.
- **Part**:

  ```json
  {"id","name","revision","material":Material,
   "sketches":[{"id","name","plane","offset_mm","revision","slack","fully_held"}],
   "features":[{"id","name","sketch_id","operation":"new"|"join"|"cut"|"intersect","depth_mm","direction":"normal"|"reverse"|"symmetric"}],
   "body":{"status":"none"|"saving"|"stored"|"not_stored","build":<latest attempt number or null>},
   "confirmed":null | {"build","object_key","volume_mm3","area_mm2","centroid_mm":{"x","y","z"},"mass_g"}}
  ```

- **Sketch**:

  ```json
  {"id","part_id","name","plane":"top"|"front"|"right","offset_mm","revision","slack","fully_held",
   "drives":[feature ids],
   "entities":[{"id","label","type":"point"|"line"|"circle"|"arc", ...geometry}],
   "constraints":[{"id","label","kind","refs":[...],"value_mm"?,"tolerance"?,"redundant"}],
   "points":[{"ref","name","x","y","freedom"}]}
  ```

  Geometry by entity type:
  - point: `x`, `y`;
  - line: `start:{x,y}`, `end:{x,y}`;
  - circle: `center:{x,y}`, `radius`;
  - arc: `center:{x,y}`, `radius`, `start_angle_deg`, `end_angle_deg` (counter-clockwise from start to end).

  A tolerance is `{"kind":"symmetric"|"asymmetric","plus_mm","minus_mm"}`.
- **Assembly**: `{"id","name","revision","instances":[{"id","component":{"type":"part"|"purchased"|"assembly","id","name"},"quantity"}],"rollup":{"mass_g","part_count","line_count"}}`.
- **Purchased part**: `{"id","name","declared_mass_g","revision"}`.

**Sessions and workspace.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST /api/session | `{"email","password"}` | 200 `{"member":Member}` and sets the cookie | 401 `bad_credentials`; 422 |
| DELETE /api/session | — | 204 | — |
| GET /api/me | — | 200 `{"member":Member}` | — |
| PATCH /api/me | `{"units"?,"precision"?}` | 200 `{"member":Member}` | 422 |
| GET /api/workspace | — | 200 `{"name","product":{"assembly_id","name"},"members":[{"id","name","role"}]}` | — |
| GET /api/materials | — | 200 `{"materials":[Material]}` sorted by name | — |
| GET /api/status | — | 200 `{"storage":"ok"|"unreachable"}`, reflecting a storage check made within the last 5 seconds | — |
| GET /api/health | — | 200 `{"status":"ok"}`, needs no session (see Deployment) | — |

**Parts.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET /api/parts | — | 200 `{"parts":[Part]}` sorted by name | — |
| POST /api/parts | `{"name","material_id"}` | 201 `{"part":Part}`, body status `none` | 403; 422 |
| GET /api/parts/:id | — | 200 `{"part":Part}` | — |
| PATCH /api/parts/:id | `{"base_revision","name"?,"material_id"?}` | 200 `{"part":Part}` (a part save) | 403; 412; 422 |
| POST /api/parts/:id/save | `{}` | 200 `{"part":Part}` (a part save) | 409 `no_confirmed_body` style refusal is not used here; a part with no features answers 200 with status `none` |
| GET /api/parts/:id/body | — | 200: the confirmed body object exactly as stored, `application/json` | 404 if there is no confirmed body; 503 `storage_unavailable` |
| POST /api/parts/:id/sketches | `{"base_revision","plane","offset"}` | 201 `{"sketch":Sketch,"part":Part}` named "Sketch <n>" | 403; 412; 422 |
| POST /api/parts/:id/features | header `Idempotency-Key`; body `{"base_revision","sketch_id","operation","depth","direction"}` | 201 `{"feature":{...},"part":Part}` named "Extrude <n>" (a part save) | 403; 409 `idempotency_conflict`, `profile_not_ready`, `empty_body`, `separate_bodies`; 412; 422 |
| PATCH /api/parts/:id/features/:fid | `{"base_revision","depth"?,"direction"?}` | 200 `{"feature":{...},"part":Part}` (a part save) | 403; 409 `empty_body`, `separate_bodies`; 412; 422 |

**Sketches.** Each change listed below is a sketch change, and therefore a part save.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET /api/sketches/:sid | — | 200 `{"sketch":Sketch}` | — |
| POST /api/sketches/:sid/entities | `{"base_revision","entity":{"type", ...geometry}}` | 201 `{"sketch","part","entity"}` | 409 `sketch_drives_feature`; 412; 422 |
| DELETE /api/sketches/:sid/entities/:eid?base_revision=<n> | — | 200 `{"sketch","part"}`; also removes the entity's constraints | 409 `sketch_drives_feature`; 412 |
| POST /api/sketches/:sid/constraints | `{"base_revision","kind","refs":[...],"value"?,"tolerance"?}` | 201 `{"sketch","part","constraint"}`; `constraint.redundant` tells whether it was redundant | 409 `over_constrained`, `unsolvable`; 412; 422 |
| PATCH /api/sketches/:sid/constraints/:cid | `{"base_revision","value"?,"tolerance"?}` | 200 `{"sketch","part","constraint"}` | 409 `over_constrained`, `unsolvable`; 412; 422 |
| DELETE /api/sketches/:sid/constraints/:cid?base_revision=<n> | — | 200 `{"sketch","part"}` | 409 `sketch_drives_feature`; 412 |

Constraint `kind` is one of `coincident`, `horizontal`, `vertical`, `parallel`, `perpendicular`, `equal`, `fix`, `distance`, `horizontal_distance`, `vertical_distance`, `diameter`, `radius`. `refs` are:

- `"origin"`;
- an entity id;
- an entity id followed by `.start`, `.end` or `.center` for its points.

The request `tolerance` is one of:

- `{"kind":"symmetric","value":<length>}`;
- `{"kind":"asymmetric","plus":<length>,"minus":<length>}`;
- the tolerance text grammar from Business rules as a string;
- `null` to clear it.

**Assemblies and purchased parts.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET /api/assemblies | — | 200 `{"assemblies":[Assembly]}` sorted by name | — |
| POST /api/assemblies | `{"name"}` | 201 `{"assembly":Assembly}` | 403; 422 |
| GET /api/assemblies/:id | — | 200 `{"assembly":Assembly}` | — |
| POST /api/assemblies/:id/instances | header `Idempotency-Key`; body `{"base_revision","component":{"type","id"},"quantity"}` | 201 `{"assembly":Assembly,"instance":{...}}` | 403; 409 `idempotency_conflict`, `assembly_cycle`, `no_confirmed_body`; 412; 422 |
| PATCH /api/assemblies/:id/instances/:iid | `{"base_revision","quantity"}` | 200 `{"assembly":Assembly}` | 403; 412; 422 |
| DELETE /api/assemblies/:id/instances/:iid?base_revision=<n> | — | 200 `{"assembly":Assembly}` | 403; 412 |
| GET /api/assemblies/:id/tree | — | 200 `{"assembly":{"id","name"},"rows":[Row]}` | — |
| GET /api/assemblies/:id/bom | — | 200 `{"assembly_id","lines":[Line],"total_mass_g","part_count","line_count"}` | — |
| GET /api/purchased | — | 200 `{"purchased":[Purchased part]}` sorted by name | — |
| POST /api/purchased | `{"name","declared_mass_g"}` | 201 `{"purchased":Purchased part}` | 403; 422 |
| PATCH /api/purchased/:id | `{"base_revision","name"?,"declared_mass_g"?}` | 200 `{"purchased":Purchased part}` | 403; 412; 422 |

A tree Row is:

```json
{"instance_id","component":{"type","id","name"},"quantity","unit_mass_g","subtotal_mass_g","pieces","body_status","children":[Row]}
```

`body_status` is the part's body status for parts and `null` otherwise. `children` is present for assembly rows. A BOM Line is:

```json
{"item":{"type":"part"|"purchased","id","name"},"kind":"made"|"purchased","material":<name or null>,"quantity","unit_mass_g","line_mass_g","body_status"}
```

### Business rules (DP-04, DP-05, DP-09, DP-12, DP-13, DP-14, DP-16, DP-17, DP-18, DP-20, DP-21, DP-23, DP-25, DP-27, DP-29, DP-30, DP-31, DP-33, DP-34)

**Roles.** The founder may do everything. The contract engineer may only:

- read everything;
- add and delete sketch entities;
- add, edit and delete constraints;
- Save part;
- change their own preferences.

Every other change answers 403 `forbidden` to the engineer. That covers creating parts, sketches, extrudes, assemblies and purchased parts; editing extrudes, part names, materials, instances and purchased parts. The browser does not show founder-only controls to the engineer.

**Labels.** Inside each sketch, entities and constraints are numbered separately for each kind, starting at 1, and numbers are never reused after a delete. Examples: "Line 1", "Circle 1", "Arc 1", "Point 1", "Coincident 3", "Horizontal distance 1".

- Constraint label words: Coincident, Horizontal, Vertical, Parallel, Perpendicular, Equal, Fix, Distance, Horizontal distance, Vertical distance, Diameter, Radius.
- Point names: "<entity label> start", "<entity label> end", "<entity label> centre", or the label of a point entity. The sketch origin is "Origin".
- A refused constraint is shown with the next unused number for its kind, and that number is not used up.
- Sketch names are "Sketch <n>" and extrude names are "Extrude <n>", numbered per part.

**Freedom and the solver.** The server solves every sketch.

- Each entity brings its own freedom: point 2, line 4 (two endpoints), circle 3 (centre and radius), arc 5 (centre, radius and two angles). The origin is fixed and brings none.
- Each constraint removes freedom when it is independent of the constraints added before it: Coincident (two points) 2, Fix (one point) 2, all other kinds 1.
- A sketch's slack is the total entity freedom minus the rank the constraints actually contribute at the solved geometry.
- A point's freedom is the number of independent directions, 0, 1 or 2, in which that point can still move while every constraint stays satisfied.
- Lines must keep a length above zero, and circles and arcs a radius above zero. A placement that collapses one does not count as a solution.
- After each accepted change the server moves the geometry as little as possible so that every constraint holds within 0.000001 mm.
- "Fully held" means slack 0.

**Constraint references.**

| Kind | References |
|---|---|
| Coincident | Two points |
| Horizontal, Vertical | One line |
| Parallel, Perpendicular | Two lines |
| Equal | Two lines, or two circles or arcs |
| Fix | One point |
| Distance | One line (its length) or two points |
| Horizontal distance, Vertical distance | Two points; the value is the size of the horizontal or vertical separation |
| Diameter | A circle or arc |
| Radius | A circle or arc |

Wrong references answer 422 on `refs`.

**Redundant and conflicting constraints.**

- A new constraint that can be satisfied together with all existing ones but removes no freedom is accepted. It is stored with `redundant: true`, and slack is unchanged.
- Redundancy is recomputed after every change, in creation order, so deleting an earlier constraint can make a later redundant one count.
- A new constraint, or a new dimension value, that no placement can satisfy is refused with 409 `over_constrained` (for a new constraint) or `unsolvable` (for a changed value). Nothing is stored and the sketch revision is unchanged.
- The constraint named in `conflicts_with` is chosen as follows:
  1. If one existing constraint on the same references makes the new one impossible on its own, that constraint is named. Examples: Horizontal versus Vertical on one line, Parallel versus Perpendicular on one pair of lines, two different Distance values on one line, two different Diameters on one circle.
  2. Otherwise, the most recently added existing constraint that shares a reference with the new one is named. Two constraints share a reference when any reference of one and any reference of the other are the same entity, or the same point, or one is a line, circle or arc and the other is one of that entity's own points (its start, end or centre). The origin never counts as a shared reference.
  3. If no existing constraint shares a reference with the new one, the most recently added existing constraint in the sketch is named.

**Sketches that drive extrudes.** A sketch used by an extrude must stay fully held. Adding an entity, deleting a constraint, or deleting an entity that would leave slack answers 409 `sketch_drives_feature`. Changing a dimension value or tolerance on such a sketch is allowed and rebuilds the part.

**Lengths and units.**

- Every length is stored once, in millimetres, as entered after conversion and at full double precision.
- One inch is exactly 25.4 mm.
- Display units (`mm` or `in`) and display precision (0 to 4 decimals) are per-member preferences. They never change any stored value.

**Dimension input grammar.** A length string is:

1. optional spaces;
2. a number;
3. optional spaces;
4. an optional unit `mm` or `in` (any letter case);
5. optional spaces.

A number is digits with an optional decimal part (".25" is allowed), or a fraction of two whole numbers "n/d" where d is not 0. Coordinate and offset fields also accept a leading "-" or "−". With no unit, the member's display unit applies. For example, "0.25 in", "1/4in" and "6.35" (with mm display) all store 6.35 mm.

**Limits.**

- Lengths (dimension values, diameters, radii, depths) must be greater than 0 and at most 10000 mm. 10000 itself is allowed.
- Coordinates and offsets must be from −10000 to 10000 mm, inclusive.
- Angles are degrees and must be finite numbers.

**Tolerances.** A tolerance belongs to a Distance, Horizontal distance, Vertical distance, Diameter or Radius constraint. It is stored separately from the nominal value, in millimetres.

- Text grammar: symmetric is "±" or "+-" followed by a length number; asymmetric is "+" followed by a length number, "/", then "-" or "−" followed by a length number. Spaces are allowed around each part, and one optional unit at the end applies to both numbers. An empty string clears the tolerance.
- Each tolerance number must be at least 0 and at most 10000 mm.

**Display formatting.**

- Lengths, areas and volumes are shown in the member's unit (mm, mm², mm³ or in, in², in³). They use exactly the member's precision in decimals, plain digits, no thousands separator and a point as the decimal mark, followed by a space and the unit.
- Rounding is half away from zero.
- 1 in² is 645.16 mm², and 1 in³ is 16387.064 mm³.
- Mass is always grams with two decimals ("200.57 g"). Density is shown with two decimals ("2.70 g/cm³").
- Centroid reads "(x, y, z) <unit>".
- A toleranced dimension reads "<nominal> ± <t> <unit>" (symmetric) or "<nominal> +<plus> −<minus> <unit>" (asymmetric, with a true minus sign), all at the same precision.
- Canvas dimension labels show the same text without the unit.
- For example, with the seed data at start, the founder sees Base Plate's volume as "74286.73 mm³".

**Sketch planes.** A sketch point (u, v) maps into part space as follows:

| Plane | Part space point | Extrude Normal direction |
|---|---|---|
| Top | (u, v, offset) | +Z |
| Front | (u, offset, v) | +Y |
| Right | (offset, u, v) | +X |

**Profiles and extrudes.**

- A sketch's profile is closed when:
  - every line and arc endpoint is coincident with exactly one other line or arc endpoint;
  - those joins form loops;
  - no two loops or their edges cross.

  A circle is a loop by itself, and point entities are ignored.
- The profile is the region inside the loops, with loops nested inside another loop treated as holes (alternating inside and outside).
- Extruding a sketch that is not closed or not fully held answers 409 `profile_not_ready`.
- Depth follows the length limits. Normal extrudes along the plane's direction, Reverse against it, and Symmetric half each way.
- A part's first extrude must use operation `new`, and every later extrude must use `join`, `cut` or `intersect`. Any other order answers 422 on `operation`.
- Each part has exactly one body, built by applying its extrudes in order.
- Join is union, cut is subtraction and intersect is intersection with the new extrusion.
- The result must be one connected, closed, manifold solid. Touching counts as connected.
- An empty result answers 409 `empty_body`, and a result in more than one piece answers 409 `separate_bodies`. In both cases nothing is stored.
- Editing an extrude's depth or direction rebuilds every later extrude, and the same refusals apply.

**Mass properties.** On every part save, the server computes from the stored body mesh:

- volume (mm³);
- surface area (mm²);
- centroid (mm);
- mass in grams: density in g/cm³ × volume in mm³ ÷ 1000.

Volume, area and mass agree with the exact closed-form values of the modelled shape within 0.1% relative. Each centroid coordinate agrees within 0.1% of the body's largest bounding-box side. Curved edges are faceted finely enough to meet these limits.

**Part body states.** Every accepted change to a part is a part save. That covers its sketches, extrudes, name or material, as well as Save part.

| From | Event | To |
|---|---|---|
| `none` | First extrude accepted | `saving` |
| `stored`, `not_stored` | Any part save | `saving` |
| `saving` | Storage confirms the object write | `stored`: `confirmed` is replaced with this build's figures and key |
| `saving` | Storage refuses, errors, or gives no answer within 5 seconds | `not_stored`: the change itself stays saved and `confirmed` is untouched |
| `saving` | The server stops mid-save | `not_stored` at the next boot |

Further rules:

- A part with status `none` stays `none` on every part save before its first extrude is accepted (Save part, sketch changes, name or material changes), because there is nothing to build.
- Each save attempt takes the part's next build number, starting at 1.
- If an older build finishes after a newer build has been stored, it never replaces the newer confirmed figures.
- No request can set the status or confirmed figures directly.
- The part save response returns only after the write is confirmed or refused.
- The next save after storage becomes reachable again goes to `stored`, with no restart.

**Preview figures.** While the founder drags or types an extrude depth, the browser shows a preview:

- For a New body or Join extrude, preview volume is the confirmed volume plus the profile area × the change in depth. For a part with no confirmed body, the starting volume is 0.
- For Cut, it is the confirmed volume minus that amount.
- Intersect shows "—".
- Preview mass is preview volume × density ÷ 1000.
- When the change commits, the server's reply replaces the preview. That is the new confirmed figures if the part is Stored, or the unchanged last confirmed figures if it is Not stored.

**Assemblies and the bill of materials.**

- An instance places a part, a purchased part or an assembly, with a whole quantity from 1 to 999.
- Only a part with confirmed figures can be placed. Otherwise the request answers 409 `no_confirmed_body`.
- An assembly cannot contain itself, directly or through any descendant at any depth. Adding one that would answers 409 `assembly_cycle`.
- Names are unique across parts, purchased parts and assemblies, ignoring letter case. A duplicate answers 422 on `name`.
- Assembly figures always use each part's last confirmed mass, and each purchased part's declared mass.
- A part with no confirmed figures has no unit mass. Its tree rows carry `unit_mass_g` and `subtotal_mass_g` as `null`, and its BOM line carries `unit_mass_g` and `line_mass_g` as `null`. It adds 0 g to every assembly total and subassembly unit mass, while its quantity still counts in `pieces` and `part_count`. The browser shows "—" in those mass cells and "Not stored" in the Item cell.

The bill of materials for an assembly:

- Gives each part and purchased part a rolled-up quantity: the sum, over every path from the assembly down to that item, of the product of the instance quantities along the path.
- Has exactly one line per distinct part or purchased part.
- Gives each line a line mass equal to its quantity × its unit mass.
- Has `total_mass_g` equal to the sum of line masses, `part_count` equal to the sum of line quantities, and `line_count` equal to the number of lines.
- Sorts lines by name, ignoring letter case.

In the assembly tree, each row shows:

- `unit_mass_g`: a part's confirmed mass, a purchased part's declared mass, or a subassembly's own total mass;
- `subtotal_mass_g`: quantity × unit mass;
- `pieces`: quantity × 1 for parts and purchased parts, or quantity × the subassembly's `part_count` for subassemblies.

**When figures update in the browser.** An assembly's figures in the browser are fetched from the server every time an assembly view or tab opens, and again immediately after any change made from this browser tab. That includes collapsed rows. Changes by another member appear the next time the view opens or after Reload.

**Revisions and simultaneous changes.** Each revision starts at 1 and rises by 1 on every accepted change.

| Record | Changes that bump its revision |
|---|---|
| Sketch | Its entities and constraints |
| Part | Its name, material, sketch list and extrudes |
| Assembly | Its instances |
| Purchased part | Its own fields |

Every change request carries `base_revision`. If it is not the current revision, the request answers 412 `stale_revision` and nothing changes. The server never merges a stale change. Of any number of simultaneous changes carrying the same current base revision for the same record, exactly one succeeds and every other answers 412.

**Idempotent presses.** POST /api/parts/:id/features and POST /api/assemblies/:id/instances require an `Idempotency-Key` header. Keys are scoped to the member and the endpoint path and are kept for the life of the database.

- **Replay.** A repeat with the same key and the same JSON body returns the first response's status and body, with the header `Idempotent-Replayed: true`. It creates nothing and changes no revision, even if the record has changed since.
- **Conflict.** The same key with a different body answers 409 `idempotency_conflict`.
- **Simultaneous duplicates.** Two requests with the same key arriving at the same moment create one record, and both receive that record's response.

### Services (DP-23, DP-25, DP-45)

- **Postgres** holds everything except the body meshes:
  - members, hashed passwords and sessions;
  - materials;
  - parts, sketches, entities and constraints with revisions;
  - extrudes;
  - confirmed figures with build numbers;
  - assemblies and instances;
  - purchased parts;
  - idempotency records.

  The app applies its schema idempotently every time it starts.
- **MinIO** holds one object per stored build in the provided bucket. The bucket already exists, and the app never creates or deletes buckets.
  - Key pattern: `bodies/<part id>/build-<build>.json`.
  - Content type: `application/json`.
  - Payload: `{"part_id","build","units":"mm","vertices":[[x,y,z],...],"triangles":[[a,b,c],...]}`. The triangles form one closed, manifold mesh with outward-facing counter-clockwise winding, in part-space millimetres.
  - The volume computed from this mesh is the confirmed `volume_mm3`.
  - Earlier builds' objects may remain.
  - The server reads bodies back from storage to serve GET /api/parts/:id/body.
- **When storage is unreachable:**
  - Part saves end `not_stored` with the normal success status of their endpoint, and the response's `part.body.status` is `not_stored`.
  - GET /api/status reports `unreachable`.
  - GET /api/parts/:id/body answers 503 `storage_unavailable`.
  - The browser shows the outage banner and Not stored copy from Feedback states.
  - Postgres-backed reads, sketch solving and assembly figures keep working.

### Seed data (DP-02, DP-03)

Every seeded person, business and product is invented. On first boot against an empty database, the server creates exactly the following. All revisions are 1, and nothing else exists.

**Workspace**: "Ostra Lighting". Its product assembly is "Ostra Desk Lamp".

**Members**:

| Name | Email | Password | Role | Units | Decimals |
|---|---|---|---|---|---|
| Ines Varga | ines@ostra-lighting.example | lamp-founder-7341 | founder | mm | 2 |
| Teo Lindqvist | teo@lindqvist-eng.example | lamp-engineer-5826 | engineer | in | 3 |

**Materials**: "6061-T6 aluminium" 2.70 g/cm³; "Acetal (POM-C)" 1.41 g/cm³; "PETG" 1.27 g/cm³.

**Purchased parts**: "M4 × 12 socket head cap screw" with a declared mass of 2.10 g; "M3 brass heat-set insert" with a declared mass of 0.40 g. Both names use the multiplication sign "×" where shown.

**Rectangle W × H sketch.** Several sketches use the same rectangle layout, drawn at its final size with the lower-left corner on the origin:

- Entities:
  - Line 1 from (0,0) to (W,0);
  - Line 2 from (W,0) to (W,H);
  - Line 3 from (W,H) to (0,H);
  - Line 4 from (0,H) to (0,0).
- Constraints, in this order:
  1. Coincident 1 (Line 1 end, Line 2 start).
  2. Coincident 2 (Line 2 end, Line 3 start).
  3. Coincident 3 (Line 3 end, Line 4 start).
  4. Coincident 4 (Line 4 end, Line 1 start).
  5. Horizontal 1 (Line 1).
  6. Vertical 1 (Line 2).
  7. Horizontal 2 (Line 3).
  8. Vertical 2 (Line 4).
  9. Coincident 5 (Line 1 start, Origin).
  10. Distance 1 (Line 1, W).
  11. Distance 2 (Line 2, H).

  None of them is redundant.

**Parts** (all sketches are on the Top plane at offset 0):

| Part | Material | Sketches (slack) | Extrudes |
|---|---|---|---|
| Base Plate | 6061-T6 aluminium | Sketch 1: rectangle 120 × 80 (Fully held). Sketch 2: Circle 1 with centre (60, 40) and radius 10; constraints Horizontal distance 1 (Origin, Circle 1 centre, 60), Vertical distance 1 (Origin, Circle 1 centre, 40), Diameter 1 (Circle 1, 20) (Fully held) | Extrude 1: Sketch 1, new, 8, normal. Extrude 2: Sketch 2, cut, 20, symmetric |
| Arm Link | 6061-T6 aluminium | Sketch 1: rectangle 160 × 16 (Fully held) | Extrude 1: Sketch 1, new, 6, normal |
| Pivot Bracket | Acetal (POM-C) | Sketch 1: rectangle 30 × 20 (Fully held) | Extrude 1: Sketch 1, new, 12, normal |
| Shade | PETG | Sketch 1: Circle 1 (centre (0,0), radius 30) and Circle 2 (centre (0,0), radius 28); constraints Coincident 1 (Circle 1 centre, Origin), Diameter 1 (Circle 1, 60), Coincident 2 (Circle 2 centre, Origin), Diameter 2 (Circle 2, 56) (Fully held) | Extrude 1: Sketch 1, new, 40, normal |
| Switch Cover | PETG | Sketch 1: rectangle layout drawn 24 × 16, with only constraints 1 to 9 (no Distance constraints): Slack 2 | none; body status `none` |

The Switch Cover sketch's point freedoms are:

| Points | Freedom |
|---|---|
| Line 1 start, Line 4 end | 0 |
| Line 1 end, Line 2 start | 1 |
| Line 3 end, Line 4 start | 1 |
| Line 2 end, Line 3 start | 2 |

**Seeded body status.** The seed creates every part that has extrudes with body status `not_stored`, `build` null and `confirmed` null. Switch Cover has status `none`. The boot-time seed body write in Server boundary then saves each part with extrudes as build 1. That makes it Stored with the confirmed figures below and its object at `bodies/<part id>/build-1.json`, without changing any revision.

- When storage is reachable at boot, this has happened before health answers 200.
- When storage is unreachable at boot, those parts stay `not_stored` with `confirmed` null until a save reaches storage: Save part, any other part save, or the write at a later boot with storage reachable. Meanwhile the rollup and display follow the rule for parts with no confirmed figures in Business rules.

**Confirmed figures of the seeded parts** once stored:

| Part | Volume (mm³) | Surface area (mm²) | Centroid (mm) | Mass (g) |
|---|---|---|---|---|
| Base Plate | 76800 − 800π ≈ 74286.7259 | 22400 − 40π ≈ 22274.3363 | (60, 40, 4) | ≈ 200.5742 |
| Arm Link | 15360 | 7232 | (80, 8, 3) | 41.472 |
| Pivot Bracket | 7200 | 2400 | (15, 10, 6) | 10.152 |
| Shade | 4640π ≈ 14576.9899 | 4872π ≈ 15305.8394 | (0, 0, 20) | ≈ 18.5128 |

**Assemblies.** Instances are listed in tree order:

| Assembly | Instances |
|---|---|
| Ostra Desk Lamp | Base Plate ×1; Pivot Bracket ×1; M4 × 12 socket head cap screw ×2; Arm Assembly ×1 |
| Arm Assembly | Arm Link ×2; Pivot Bracket ×2; M4 × 12 socket head cap screw ×4; Head Assembly ×1 |
| Head Assembly | Shade ×1; M3 brass heat-set insert ×3 |

**Bill of materials of Ostra Desk Lamp at start**:

| Item | Kind | Qty | Line mass (g) |
|---|---|---|---|
| Arm Link | Made | 2 | 82.944 |
| Base Plate | Made | 1 | ≈ 200.5742 |
| M3 brass heat-set insert | Purchased | 3 | 1.20 |
| M4 × 12 socket head cap screw | Purchased | 6 | 12.60 |
| Pivot Bracket | Made | 3 | 30.456 |
| Shade | Made | 1 | ≈ 18.5128 |

Total mass ≈ 346.2869 g, pieces 16, lines 6. Arm Assembly's own total is ≈ 131.3608 g with 12 pieces. Head Assembly's is ≈ 19.7128 g with 4 pieces.

## Technical requirements

### Deployment (DP-43)

The runtime has Node.js 22 with npm, and the app is written in TypeScript.

**Run manifest.** The app root `/app` contains `run.json` with string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

**Port.** The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or 4173 when that is unset. More copies of the server may run at the same time on other ports against the same database.

**Health.** GET /api/health answers HTTP 200 with JSON `{"status":"ok"}` once the schema is applied, the seed exists and the boot-time seed body check has run. Until then it answers 503 `{"status":"starting"}`.

### Configuration and secrets (DP-45)

The server reads these at start and never hard-codes them or sends them to the browser:

- `DATABASE_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`;
- `APP_PUBLIC_PORT`.

The browser talks only to the app's own origin. Bodies reach the browser through GET /api/parts/:id/body, never from storage directly.

### Server boundary (DP-44)

These checks run before anything in API's precedence order:

- A POST, PATCH or DELETE whose `Origin` header is present and whose host and port differ from the request's `Host` answers 403 `{"error":{"code":"cross_origin","message":"Requests from another site are refused."}}`. The server sends no cross-origin permission headers.
- A request body that is present but not `application/json` answers 415 `{"error":{"code":"unsupported_media_type","message":"Send JSON with Content-Type application/json."}}`.
- A body larger than 1,000,000 bytes answers 413 `{"error":{"code":"payload_too_large","message":"Request body is larger than 1,000,000 bytes."}}`. Exactly 1,000,000 bytes is allowed.
- An unknown `/api` path answers 404 `not_found`.

The server never serves:

- source files or source maps;
- `package.json`, lockfiles or `run.json`;
- `.env` files or any credential.

Such paths answer 404.

**Starting up.**

- When Postgres is unreachable at boot, the server keeps waiting for it and health answers 503 until the database is ready.
- When storage is unreachable at boot, the server starts normally and health answers 200.
- If two server processes start against an empty database at the same moment, the seed is created exactly once.
- At every boot, after the seed exists, the server writes the body of any seeded part that has never been stored, following the part body states in Business rules. The write is skipped while storage is unreachable.

### Browser support and performance (DP-39)

**Browsers.** Supported browsers are current Chromium, Firefox and WebKit, at 1280×800, 768×1024 and 375×812.

**Response times** with the seed data:

- The workspace is usable within three seconds of loading.
- A constraint request on a sketch of up to 200 entities answers within one second.
- A bill of materials answers within one second.
- A part save answers within six seconds, including the five-second storage limit.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package and every bundled font with its name, version and licence. Shipped packages are the production dependency tree as reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (as defined in IF-02) and every bundled font uses one of these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, or OFL-1.1 for fonts.
- IF-04: The app keeps state only in the provided Postgres database and MinIO bucket. No other database, cache server, embedded datastore or on-disk state file is used.
- IF-05: `package-lock.json` is committed, and `npm ci` installs from it.
- IF-06: The provided development service configuration and its credentials are left unchanged.
- IF-07: All scripts, styles and fonts are served from the app's own origin, with no external CDN or font service.
- IF-08: Server and browser source is TypeScript. No hand-written JavaScript source exists outside tool configuration files.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes and no disabled type checks.
- Names in the code match the domain terms in this brief: sketch, entity, constraint, slack, fully held, profile, extrude, operation, body, build, confirmed figures, assembly, instance, bill of materials, rolled-up quantity, purchased part, revision.
- Each domain rule is decided in exactly one place in the source:
  - the part body state transitions;
  - the slack and rank count;
  - the conflict-naming rule;
  - the unit conversion and input grammar;
  - the BOM rollup;
  - the cycle check;
  - the revision check;
  - the idempotency replay.
- Every error response is built through one consistent error shape, and every refusal message is defined once.
- No abstraction has only a single implementation, and there are no defensive checks for states the rules make impossible.
- There is no dead, commented-out or unreachable code.
- There are no features, endpoints or screens beyond this brief.
