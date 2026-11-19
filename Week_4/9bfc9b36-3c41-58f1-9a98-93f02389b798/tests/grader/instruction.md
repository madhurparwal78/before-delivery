# Tabling Works Boltrope

Boltrope is a loft workbench for an independent sailmaker who works alone or with one part-time loft hand. It turns the rig figures a yacht owner measures with a tape into a sail drawing. The server computes the drawing's areas and its crosscut panel geometry. The sail moves through four steps at their own addresses: measure, draw, nest and confirm. Boltrope nests the panels onto real rolls and offcuts of sailcloth, with one mill lot per sail, and tucks alternate panels end for end. It keeps a paired cloth ledger that always equals what is on the shelf. It keeps a sail account in exact pence. It issues a stored cut sheet, and the sailmaker can let an owner see that sheet and later withdraw it. Boltrope uses exactly three backend services. Postgres is the system of record. Keycloak holds the one realm with the three roles. MinIO stores cut sheets and tape photographs. These are out of scope: card or online payment processing (payments are recorded, not taken), email, chat, scheduling, production-loft features such as multi-loft tenancy, any datastore beyond these three, and any third-party API.

## Problem and users

An owner measures their own rig by hand: I, J, P, E, the luff length (LL) and the luff perpendicular (LP). Two owners of the same class of boat can send figures 40 mm apart because one of them changed a furler or replaced a boom. Some owners read the inch side of the tape, often as feet, inches and sixteenths typed on a phone that curls the quote marks. Others write the inch figure into the millimetre box. Today the sailmaker copies the figures from a paper form into a spreadsheet and works out sail areas on a calculator, switching between inches and millimetres. They draw crosscut panels by hand. Then they lay them by eye on a roll that may be 914 mm or 1372 mm wide, tucking alternate triangles end for end. That roll comes from a mill lot whose finish differs from the next lot's. When a roll runs out mid-sail, the rest has to come from another roll of the same lot. Offcuts go into a bin nobody measures, so the stock figure in the spreadsheet never matches the shelf.

A unit slip cuts a sail 25 mm short, and that wastes cloth at forty to ninety pounds a metre. When two people cut from one roll on the same morning, they quietly disagree about who had the last good metre. The owner gets a blurry photo of a pencil drawing, and the sailmaker can never take it back.

- **Sailmaker** (daily): turns a measured rig into a sail drawing, nests its panels onto rolls and offcuts of one lot, cuts, keeps the cloth ledger equal to the shelf, issues cut sheets, records payments, and decides the figures owners submit.
- **Loft hand** (weekly): claims roll length for an assigned sail drawing and confirms cuts on the cutting-floor tablet without colliding with the sailmaker's claims.
- **Yacht owner** (occasional): submits their own hand-measured rig figures in millimetres, decimal inches or feet and inches, and looks at their sail's issued cut sheet and account while sight is granted.

## Journeys

1. **Setting up an owner.**
   - Start: the sailmaker is signed out on the landing page.
   - They choose Open the loft and sign in. They create an owner account. They add the owner's boat and land on that boat's page with focus on its heading.
   - They record the first tape figures for I, J, P, E, LL and LP, which the guard does not check because a first entry has no current value to compare against. They then record a second entry for I, typed as `488` from the inch side of the tape. It is refused as inches typed into the millimetre field, and they correct it by entering `12400` in millimetres, which is inside the band and leaves I Measured.
   - They attach a tape photograph to P. A PNG sent as a JPEG is refused.
   - They receive a new roll of cloth C-18, lot `L-2614`, which becomes R-17.
   - End: the boat page lists six Measured dimensions in mm and inches, with the foretriangle area at poster size. The stock shelf grid shows a card for R-17 with its lot, and the ledger shows its receipt pair.
2. **An owner sends figures.**
   - Start: an owner is signed in on My boats.
   - They submit P as `38’ 1 1/2”`, typed on a phone that curled the marks. In the console, the sailmaker accepts it together with other pending submissions in one bulk action.
   - End: the owner sees the figure exactly as they typed it, beside its conversion. The boat shows P as Remeasure, with a due date counted in loft working days. Every submission that was not applied is reported with its reason. When the sailmaker records a settling figure inside the band, the flag clears.
3. **Drawing a sail.**
   - Start: a drawing on its Draw step.
   - The sailmaker chooses Draw sail and lands on the Nest step.
   - They go back to the Measure step and record a changed P. The Nest and Confirm steps close, and the area clears. They draw the sail again.
   - End: the cobalt canvas shows numbered crosscut panels. The sail area fills its field at poster size in m² and ft², with its basis underneath: the rule set, the formula and the tolerance. The layout changes exactly at the published widths while the window is resized.
4. **The race for the last length.**
   - Start: the loft hand is on the cutting-floor tablet with drawing BR-0141 assigned, and roll R-14 has 3 200 mm free.
   - The sailmaker and the loft hand both claim that whole length within a second, from two instances.
   - End: one of them holds the length, with a countdown taken from the server. The other sees the conflict copy naming the winner and holds nothing. The drawing is now pinned to lot `L-2614`. A claim on stock of another lot is refused, and so is a claim on another cloth.
5. **Nesting and cutting across two rolls.**
   - Start: a held claim on R-14 for BR-0141.
   - The sailmaker lays panels by keyboard. Each ghost starts at the server's first-fit position, and alternate panels turn end for end to tuck into the slant of the one before. Only two panels fit on R-14's last length. The loft hand claims R-17 of the same lot and lays the rest by touch on a tablet and on a phone, where the panel list opens from its Panels button.
   - Each panel travels from the drawing to its nest position on the black roll strip. The countdown ticks while the Claim length dialog is open, and nothing typed is lost. At one minute left, the tablet says so once.
   - They undo one panel during its travel and lay it again. They confirm the cut on R-14. The tablet double-taps Confirm cut on R-17 while its session has expired.
   - End: the session refreshes without an error and one set of ledger pairs is posted. A long enough unused tail appears as a new offcut of the same lot. The roll strip, the stock shelf and the ledger footer all show the same remaining length and on-hand area.
6. **Issuing, paying and sharing.**
   - Start: a Cut drawing while the store is down.
   - The sailmaker chooses Issue cut sheet. The drawing reads Pending store under the tomato outage banner. When the store returns, the open page turns to Issued in place and announces it once.
   - The sailmaker records the deposit and a part payment. The sail account shows the exact pence and the balance left.
   - They grant the owner sight. The owner opens the sheet on the boat club's shared tablet, sees only the owner's view of the record, and signs out. A second owner signs in and never sees the first owner's boats or sheets.
   - The sailmaker withdraws sight. End: the first owner's open viewer shows the refusal copy within ten seconds, with no reload.
7. **Running the loft.**
   - Start: the console.
   - The sailmaker corrects an owner's display name, reads the audit trail, and reads the season's tape standing, which announces its owner count. They reverse an accepted submission.
   - They record a shelf count that differs from the ledger, giving a reason that begins with an equals sign. They page back through the ledger filtered to that roll. Reloading and going Back keep the filter and the page. They check reconciliation and download the ledger CSV.
   - End: the counted adjustment pair appears and reconciliation reads a difference of zero. The CSV carries the reason neutralised. The standing shows the corrected name and the effect of the reversal.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from `/app/run.json` on the published port and answers the health address as qualified in Technical requirements.
- **DP-02 — Recovery without restart** With Postgres or Keycloak unreachable the app answers the published unavailable bodies, and it recovers within the Server boundary limit after the dependency returns, with no restart and with every missing seeded account re-created.
- **DP-03 — Sign-in and session cookie** Signing in with email and password sets the published session cookie and returns a bearer token, and a write carrying only the cookie is refused as unauthenticated.
- **DP-04 — Bearer token verification** Unsigned, tampered, wrongly signed, expired and deleted-account tokens all receive the identical unauthenticated refusal.
- **DP-05 — Role, ownership and authority from stored records** Every call takes the caller's role, ownership and cutting authority from the stored records, never from token claims, so an owner only ever reaches their own boats and granted drawings, and a deletion or authority withdrawal by the sailmaker takes effect on the caller's very next request.
- **DP-06 — Uniform not-found** A record that belongs to someone else and a record that never existed answer the byte-identical not-found body with the identical set of response headers at every address, nested addresses included.
- **DP-07 — One refusal ladder** Every endpoint ranks its refusals in the single published order, so a request that breaks two rules receives only the higher-ranked status.
- **DP-08 — Unknown and privileged members ignored** Every write stores only the members its endpoint publishes, leaves privileged members exactly as stored, and echoes the stored record.
- **DP-09 — No secret reaches the browser** No page, script, attribute or source map carries a credential, token or seeded password, and every page carries the published content security policy with no inline script or inline handler.
- **DP-10 — Accounts made by the sailmaker** The sailmaker creates owner and loft hand accounts that exist in the Keycloak realm with their realm role, and can delete them, after which the account's records remain under the published deleted-account name and its email stays taken.
- **DP-11 — Versioned saves** Saving a boat, a stock item or a future rule set needs its current revision, and a missing or stale revision is refused with its published status and changes nothing.
- **DP-12 — Receiving a roll** Receiving a roll creates stock with its cloth, mill lot, width and length and posts one balanced ledger receipt pair.
- **DP-13 — Loft setup journey** The sailmaker signs in, creates an owner, adds the owner's boat with tape measurements and a photo, receives a roll of a named lot, and sees all of it on the loft, boat and stock screens.
- **DP-14 — Tolerance bands and Remeasure** A new measurement outside the pinned tolerance band of the previous one marks the dimension Remeasure and blocks drawing any sail that uses it, until a measurement inside the band settles it.
- **DP-15 — Remeasure deadline in loft working days** A Remeasure dimension carries a due date counted in loft working days after the measurement date, skipping weekends and seeded loft closures, reproducing the worked example in Business rules.
- **DP-16 — Tape photographs in the store** A tape photograph is recorded on its measurement only after the bytes read back from MinIO under the published key have its length and SHA-256, it is streamed back only to callers who may see that boat, and a store outage mid-upload leaves the measurement without a photo.
- **DP-17 — Owner request limit** An owner's measurement submissions and cut-sheet fetches are limited per account per window across every instance, and refusals carry the published retry copy and a whole-second Retry-After while other accounts are unaffected.
- **DP-18 — Owner submission journey** An owner signs in, submits a hand-measured figure for their own boat in millimetres, decimal inches or feet and inches, sees it pending exactly as typed beside its conversion, and later sees the sailmaker's decision on it.
- **DP-19 — Sail areas computed once on the server** Mainsail, foretriangle and headsail areas follow the published formulae with the pinned roach factor, are computed and rounded once on the server, and every surface that shows one area shows the same digits.
- **DP-20 — Paired units on every surface** Every length shows millimetres then inches and every area square metres then square feet, converted and rounded by the published rule on screens, in the cut sheet and in the API, with an owner's figure also shown exactly as submitted.
- **DP-21 — Crosscut panel geometry** Drawing a sail produces crosscut panels perpendicular to the leech at the cloth's usable width less the pinned seam overlap, with outlines and areas exactly as the published construction gives.
- **DP-22 — Rule sets that take effect at their instant** A rule-set version becomes current exactly at its effective instant with no job or restart, and a drawing keeps the version it pinned when it was drawn.
- **DP-23 — Drawing state machine** A sail drawing moves only along the published transitions, and every illegal move answers its published refusal.
- **DP-24 — Drawing a sail journey** The sailmaker moves a measured drawing to its Draw step, draws the sail, and sees its panels on the cobalt canvas with the governing area at poster size in both units with its basis.
- **DP-25 — Lay rules** A panel lays only inside the claimed length and the stock's usable width, turned 0° or 180°, without overlapping another panel on the same hold, at the requested position or at its automatic position.
- **DP-26 — Keyboard nesting** With the keyboard alone the sailmaker selects a panel, nudges it by the small or large step, turns it 180°, lays it and undoes it, with visible focus, and the published keys work wherever focus sits in the nesting region except a text field or an open dialog, while Enter on a focused button only activates that button.
- **DP-27 — Touch nesting on tablet and phone** On the tablet and phone layouts a panel is laid by dragging it onto the roll strip and lands at the position under the finger, as qualified in Interactions for the phone's collapsed panel list.
- **DP-28 — Thread Lay** A laid panel lifts, travels to its server nest position without ever turning a quarter turn, lands with its number, and the remaining figures count to the new value, with the published timings and an instant reduced-motion substitute.
- **DP-29 — Nesting journey** The sailmaker claims length, lays every panel of a drawing onto the roll strip, sees the drawing move to Nested, and undoes and re-lays a panel.
- **DP-30 — Claims on free length** A claim holds length on a roll or offcut, for a drawing of the same cloth and pinned lot, only while that length is free of other live holds.
- **DP-31 — One winner per race** Of simultaneous claims, cuts, decisions, releases, issues, payments or account creations on the same record, exactly one wins, the rest answer the published refusal, and nothing is written twice, also across instances sharing one database.
- **DP-32 — Holds lapse on the server** A hold lapses on the server at its deadline with no job, its laid panels return to the drawing, and a lapsed hold can never be cut.
- **DP-33 — Countdown from the server deadline** The tablet counts down from the server's remaining seconds by elapsed time, ignores the device clock, and asks the server again at zero, showing whatever status the server answers.
- **DP-34 — Loft hand claim journey** The loft hand opens an assigned drawing on the cutting floor, claims length and sees the hold countdown, and when the sailmaker has already taken the last length, the loft hand sees the conflict copy with the sailmaker's name.
- **DP-35 — Confirm cut posts paired lines** Confirming a cut takes the whole claimed length off the stock as balanced ledger pairs to the drawing's panels, a new offcut and waste, and the stored on-hand always equals the ledger.
- **DP-36 — Confirm cut once per key** A retried confirmation with the same key returns the same status and byte-identical body and posts nothing more, even when the two arrive together, at two instances, or the retry follows a session refresh, and a different key on a cut hold is refused.
- **DP-37 — Remnants become offcuts** The unused tail of a cut hold that meets the pinned minimum size becomes offcut stock with its own length and its parent's width and lot, and it can take later panels.
- **DP-38 — Cutting authority on the claim's date** A loft hand may take and cut holds only under a cutting authority in force when the hold was taken, so neither a later withdrawal nor a later grant reaches back.
- **DP-39 — Cutting journey** The loft hand confirms the cut on the tablet, a double tap or an expired session does no harm, and the roll strip, the stock shelf and the ledger footer show the new remaining length together.
- **DP-40 — Shelf counts** Recording a shelf count either matches the ledger or posts a counted adjustment pair with its reason, so the ledger always equals the last count.
- **DP-41 — Ledger pages** The cloth ledger pages newest first by opaque cursor with the published cap and tie-break, so walking every page returns each line exactly once even while new lines are posted.
- **DP-42 — Whole-set totals and reconciliation** Every total covers every ledger line, and the reconciliation address answers the stored and computed on-hand with a difference of zero and a ledger sum of zero.
- **DP-43 — One figure on three surfaces** After a cut, the roll strip, the stock shelf card and the ledger footer show the same remaining length, offcut count and on-hand area in both units, as scoped in the API under Same figures on three surfaces.
- **DP-44 — Newest answer wins** When the ledger filter or page changes, including by Back or Forward, while an earlier answer is still in flight, the table and footer show only the newest answer.
- **DP-45 — Issued only after the store confirms the bytes** A drawing shows Issued only after the bytes read back from its cut-sheet key have the rendered length and a computed SHA-256 equal to the render, a key holding other bytes is overwritten once, and issuing again writes no second object.
- **DP-46 — Pending store and recovery** With the store unreachable, issuing leaves the drawing Pending store with the published outage copy, and the drawing becomes Issued by itself once the store answers, with no restart and no duplicate object.
- **DP-47 — Cut sheet document** The cut sheet is an SVG at a permanent content-addressed key, every figure in it carries its pinned rule set, method and tolerance, re-rendering it gives byte-identical output, and the sailmaker and the owner fetch the same bytes.
- **DP-48 — Revisions and superseded sheets** Revising an issued drawing creates a successor, and once the successor is issued, the predecessor stays readable at its own address, marked as superseded by the successor.
- **DP-49 — Issue journey** The sailmaker issues the cut sheet of a Cut drawing, sees Pending store turn to Issued on the open page, and opens the sheet.
- **DP-50 — Sight grants** The sailmaker grants an owner sight of an issued drawing at a grant address and can withdraw it, after which that address answers not-found for that owner on the next request and never works again, while other grants are unaffected and every instance sharing the database answers the grant identically.
- **DP-51 — Sight end dates** The server treats a grant that carries an end instant as withdrawn from that instant on, whatever the owner's device clock says.
- **DP-52 — Owner viewing journey** An owner opens a shared cut sheet showing both units and the sail account, signs out on a shared tablet for another owner, and after the sailmaker withdraws sight the owner sees the published refusal.
- **DP-53 — Bulk submission decisions** Deciding several submissions at once applies each one independently and answers a per-item result list in submitted order, with the pending count moving once per applied item.
- **DP-54 — Audit trail** Every state change made by a request writes one audit row in the same transaction with actor, target, before and after state, and reason, listed newest first, and the bulk path attributes like the single path.
- **DP-55 — Role matrix** The console shows the published role table, and any attempt to change an account's role is refused and still audited.
- **DP-56 — Ledger export** The ledger CSV export follows the published byte-exact format over every line, newest first, matching a walk of every ledger page line for line, and ends with exactly one line feed.
- **DP-57 — Console journey** The sailmaker selects pending submissions, accepts some and rejects others with a reason, sees refused items reported, and finds the decisions in the audit trail.
- **DP-58 — Tape standing** The season's tape standing per owner is derived on every request from one consistent snapshot of submission decisions by the published counted, accepted, streak, ranking and standing rules, and a reversal removes volume but never breaks a streak.
- **DP-59 — Standing journey** The sailmaker opens the standing tab, hears the owner count announced, reverses an accepted submission, and on returning sees that owner's accepted count fall while the streak, rank and chip follow the published rules.
- **DP-60 — Motion timings and reduced motion** The meter, the counting figures, the staggered ledger rows, the moving shelf cards, the card lift and the step transitions run with the published timings, and under reduced motion every one of them has exactly zero duration and delay and reaches the same end state.
- **DP-61 — Responsive layout without shift** Every screen fits every published width with nothing scrolling sideways, every control is a comfortable tap target, and no element shifts after first paint on public routes.
- **DP-62 — Published copy verbatim** Every published string renders, and is announced in its named live region, character for character.
- **DP-63 — Landing statement** The landing page carries the duotone statement hero: the poster headline,````task.spec.yaml (continued from DP-63) the sail drawn in white strokes, and the single tomato action.
- **DP-64 — Duotone working screens** Working screens follow the published field rotation: the cobalt drawing canvas, the black roll strip, the single tomato action, and poster-size governing figures in both units.
- **DP-65 — Wiring from the environment** Every service credential and URL is read from the environment, the browser never talks to a service directly, and each domain rule is decided in one place in the source.
- **DP-66 — Lot-true sails** A drawing pins the mill lot of its first Held or Cut claim, unpins it only when every claim is released or lapsed with none cut and without any job, and refuses a claim on stock of another lot with the published field copy.
- **DP-67 — Unit-slip guard and decimal inches** A millimetre figure that reads as inches typed into the millimetre field is refused, and an owner may instead send decimal inches, converted half away from zero in integer arithmetic and kept exactly as submitted.
- **DP-68 — Tape photo kept as uploaded** A tape photograph streams back byte for byte with its uploaded content type and its SHA-256 as ETag, the same bytes again write nothing, and different bytes are refused.
- **DP-69 — Only the published API surface** Any API address or method outside the endpoint table answers the uniform not-found body and headers whether or not the caller is signed in, and no response carries framework, method-list or cross-origin headers.
- **DP-70 — Published landing route after each action** Creating a boat or drawing, drawing a sail, revising, receiving a roll, finishing a cut and signing out each land on the published address with focus on the published control, and reloading that address shows the same screen.
- **DP-71 — Exact live layout breakpoints** The draw and nest steps and the tables switch between desktop, tablet and phone layouts exactly at 1024 px and 600 px wide, live on resize with no reload, keeping selection, ghost and hold.
- **DP-72 — Collapsed panel list on the phone** On the phone layout the panel list stays collapsed behind its Panels button and collapses again whenever the phone layout is entered, and while it is collapsed no panel button can be seen, focused, tapped or found in the accessibility tree.
- **DP-73 — Hold countdown keeps the screen state** The hold countdown's ticks never close an open dialog, clear a typed figure, or move focus, the ghost or the selection, and at lapse the screen shows what the server answers with the published copy and focus.
- **DP-74 — Expired session resumes the action** A write refused as unauthenticated refreshes the session once and repeats with the same body and key, and a failed refresh sends the user to sign in and back to the same page.
- **DP-75 — Ledger address holds filter and page** The ledger's stock filter and page cursor live in the address so reload, Back and Forward restore them, and a cursor from another filter is refused with the published copy.
- **DP-76 — Live in place updates** A drawing page open in Pending store turns Issued in place and the cutting floor shows a newly assigned drawing, each without a reload and within the Business rules limit, announcing once and keeping focus.
- **DP-77 — Owner projection** Owners receive boats, drawings, photos, submissions and sail accounts only as the published owner projection, with no notes, revisions, store keys, claims, lot, assignment, decider or recorder.
- **DP-78 — CSV formula neutralisation** Every ledger CSV text field that starts with a formula character is prefixed with a single quote before quoting, and numbers are never prefixed.
- **DP-79 — Standing announced and fresh** Each standing load and season change announces the published owner count, the tab and season live in the address, and the standing never shows a table from before a reversal.
- **DP-80 — Feet, inches and sixteenths** An owner may send a figure from the tape's feet-and-inches side, with straight or phone-curled marks and a reduced fraction from halves to sixteenths, converted half away from zero in integer arithmetic and stored exactly as typed.
- **DP-81 — Automatic first-fit position** The automatic position of every unlaid panel on a hold is the published first-fit search over 0° and 180°, decided in exact integer arithmetic and published on the claim, reproducing the worked examples in Business rules.
- **DP-82 — Ghost held on the cloth** Keyboard and touch moves of the ghost are clamped so its turned outline stays inside the claimed length and the usable width, and the readout shows the clamped figure.
- **DP-83 — Cutting after a partial lapse** In Cutting, a lapse, release or undo keeps the drawing in Cutting with its lot pinned, and a further cut needs every uncut panel laid on a Held claim.
- **DP-84 — A lot that runs out mid-sail** A drawing may be nested across several holds of its pinned lot, the panels that fit on the last length of one roll are laid there and the rest on another roll of the same lot, as the worked example in Business rules shows.
- **DP-85 — Cut sheets keep the values recorded at Draw** Renaming a boat or an account changes every live surface but never an issued cut sheet, whose preview stays byte-identical to its stored object, while a successor drawn after the rename carries the new name.
- **DP-86 — Interrupted Thread Lay** An undo or a further lay pressed while a panel is travelling acts on the server state at once, and no stale animation ever moves a panel the server has since lifted or moved.
- **DP-87 — One-minute hold warning** When a hold passes one minute remaining by elapsed time, the polite region announces the published warning exactly once for that hold, whatever the device clock says, and disturbs nothing on screen.
- **DP-88 — Twin boot on one empty database** Two instances started together on one empty database and bucket apply schema and seed exactly once, serve the identical seeded loft, and continue one shared code sequence.
- **DP-89 — Tape photo signature and headers** A tape photo whose bytes do not start with the signature of its declared JPEG or PNG type is refused 415 with nothing written, and every photo is served with nosniff, an inline file name and no caching.
- **DP-90 — Answers scoped to the caller** Interleaved requests from different owners only ever answer the caller's own records with private no-store caching, and after sign-out the next account never sees the previous account's data, by repaint or by Back.
- **DP-91 — Ledger and audit refused at the database** The tables `ledger_line` and `audit_trail` refuse UPDATE and DELETE at the database for every role, and each audit row names the acting account from its stored record, including loft hand claim actions.
- **DP-92 — Renames reach every surface** Correcting an account's display name shows on the next request on the standing, submissions, boats, grants, comboboxes and conflict copy, and is audited with the before and after names.
- **DP-93 — Withdrawal reaches an open viewer** An owner's open cut-sheet viewer checks its grant at least every 5 seconds and replaces the sheet with the published refusal within 10 seconds of a withdrawal or end instant, with no reload.
- **DP-94 — One email, one account** Account emails are compared after Unicode normalisation and lower-casing, so a case or composition variant of a stored email and two simultaneous creates of one email leave exactly one account.
- **DP-95 — Four-step sail flow** Each drawing moves through Measure, Draw, Nest and Confirm steps at their own addresses, a reload resumes the same step from server state, a step reached by typing its address before the earlier steps are met lands on the first unmet step, and stepping back clears every later step's figures.
- **DP-96 — Step transitions** Moving between steps fades the outgoing step out and the incoming step in with the published timings while the step marker slides, and the two steps are never laid out at once.
- **DP-97 — Card grids for the shelf and the cutting queue** The stock shelf and the cutting queue are card grids with the published column count at each layout, the published gap, equal card heights in a row, comfortable targets, a lift on hover, a focus ring and reading-order Tab.
- **DP-98 — Sail account in exact pence** Every Cut, Pending store or Issued drawing carries a sail account whose charge, tax, total, deposit and balance are integer pence rounded half away from zero, reproducing the worked example in Business rules, with paid, credited and balance always summing to the total.
- **DP-99 — Payments that never overpay** A payment or credit note is refused when it exceeds the balance, a payment replayed with its key answers byte-identically and posts once, and two payments fired together can never take the balance below zero.

## Frontend

### Screens and layout (DP-13, DP-18, DP-24, DP-29, DP-34, DP-39, DP-49, DP-52, DP-57, DP-59, DP-61, DP-71, DP-95, DP-97)

**Routes.**

- `/`: the landing page (public).
- `/signin`: the sign-in form (public). Signing in sends each role to its home: the sailmaker to `/loft`, the loft hand to `/floor`, the owner to `/owner`. The one exception is a valid `resume` address, described in Interactions.
- `/loft` (sailmaker): the Boats table and the Sail drawings table, with a Status filter.
- `/boats/<boat code>` (sailmaker): the rig dimensions with every measurement, the tape photos and the Remeasure flags. The foretriangle area is shown at poster size.
- `/drawings/<drawing code>` (sailmaker): the drawing's overview. It shows the step rail, the status, the assignment, the sight grants, the sail account, and the issue and revise actions.
- The four step addresses (sailmaker), each with the step rail across the top:
  - `/drawings/<drawing code>/measure`: the drawing's used dimensions, their status and the Record measurement action.
  - `/drawings/<drawing code>/draw`: the drawing screen. It shows the cobalt sail drawing canvas, Draw sail, and the sail area at poster size with its basis.
  - `/drawings/<drawing code>/nest`: the nesting screen.
  - `/drawings/<drawing code>/confirm`: the holds to cut, each with its own Confirm cut, and the remaining figures.
- `/floor/<drawing code>` (loft hand): the nesting screen, with no step rail. It is the same layout as the Nest step: the cobalt drawing canvas with its panel list, the black roll strip of the active hold, the placement readout, the hold countdown, and the remaining figures at poster size.
- `/floor` (loft hand): the cutting queue, a card grid of the drawings assigned to them.
- `/stock` (sailmaker): the stock shelf. It is a card grid of every roll and offcut, each card showing its lot, remaining length, on-hand area and shelf location. The Stock on hand summary sits above the grid.
- `/ledger` (sailmaker): the cloth ledger, with the Stock filter, the older and newest page controls, and the ledger footer. Its address carries `stock` and `cursor`, as described in Interactions.
- `/console` (sailmaker): tabs for Submissions, Audit, Standing, Roles and Export. Its address carries `tab` and `season`.
- `/rulesets` and `/accounts` (sailmaker): the rule-set versions and the accounts.
- `/owner` (owner): My boats, the owner's own submissions with their status, and the Cut sheets shared with them.
- `/sheets/<grant id>` (owner): the cut-sheet viewer and the sail account.
- Any other path shows the not-found page.

**Layouts by width.** There are exactly three layouts, decided by the viewport width alone:

- **Desktop** is 1024 px wide and wider.
- **Tablet** is from 600 px to 1023 px.
- **Phone** is 599 px and narrower.

No other width changes the layout. Resizing the window across 1024 px or 600 px switches the layout at once, with no reload. The published check sizes are 1280×800, 768×1024 and 375×812, plus the edge widths 1024, 1023, 600 and 599.

- **Draw step.**
  - Desktop: the canvas fills the left of the page, about three fifths of the width. `region "Sail area"`, the status chip and the controls stack in the right column.
  - Tablet and phone: the canvas runs full width at the top, with the sail area under it and the controls under that. On the phone, the controls wrap.
- **Nesting screen** (the Nest step and `/floor/<drawing code>`).
  - Desktop: the canvas is on the left, about three fifths of the width. `list "Panels"` and the placement controls are on the right, level with the canvas. The roll strip runs the full width below both.
  - Tablet: the canvas sits above the roll strip, and both are full width. The placement controls run in a row under the strip, and `list "Panels"` is laid out as a wrapping row under the controls. It is always open.
  - Phone: one column, with the canvas, then the roll strip, then the `Panels (<n> unlaid)` button with its collapsible list, then the controls, which wrap.
- **Overview, Measure and Confirm steps:** one column at every width, with the step rail across the top. On the phone, the rail's four steps share one row.
- **Tables.** Every table keeps its table, row and cell semantics at every width.
  - Desktop and tablet: each row stays on one line, with its cells side by side. On the tablet, columns narrow and text wraps inside its cell.
  - Phone: each row becomes a stacked card, with its cells one under another.
- **Card grids.** Both grids leave a gap of exactly 16 px between neighbouring cards, across and down. Every card in a row has the same height, and every card in the grid has the same width.

  | Grid | Desktop | Tablet | Phone |
  |---|---|---|---|
  | Stock shelf (`list "Rolls and offcuts"`) | 4 columns | 2 columns | 1 column |
  | Cutting queue (`list "Cutting queue"`) | 3 columns | 2 columns | 1 column |

At every width nothing scrolls sideways, except the inside of the roll strip, which pans by drag. Loading shows the field colour and the heading at once. Data fills in without any shimmer placeholders.

### Public screens and controls (DP-03, DP-26, DP-27, DP-34, DP-50, DP-53, DP-55, DP-56, DP-62, DP-70, DP-72, DP-95, DP-97, DP-98)

Only these roles and names are public; everything else is free.

| Where | Role and accessible name | Visible copy / notes |
|---|---|---|
| Landing | `heading "BOLTROPE"` (level 1) | `BOLTROPE` |
| Landing | `link "Open the loft"` | goes to `/signin`; styled as the tomato button |
| Landing | text | `A loft workbench for one sailmaker`; second field `42.60 m² · 458.54 ft²` and `The figure that ruins a sail is the one you misread.` |
| Sign-in | `heading "Sign in to the loft"`, fields labelled `Email` and `Password`, `button "Sign in"` | |
| Signed-in pages | `navigation "Loft"` with links for the role: sailmaker `Loft`, `Stock`, `Ledger`, `Console`, `Rule sets`, `Accounts`; loft hand `Cutting floor`; owner `My boats`, `Cut sheets`; and `button "Sign out"` | |
| Every page | `status "Loft status"` (polite live region) and one `alert` region | pending, success and refusal copy from Feedback states |
| Every page during a store outage | `region "Store outage"` | the outage copy in the tomato banner |
| Loft | `table "Boats"`, `table "Sail drawings"`, combobox `Status`, `button "New boat"`, `button "New drawing"` | |
| Dialogs | `dialog "New boat"` (fields `Boat name`, `Class`, `Notes`, combobox `Owner`, `button "Create boat"`); `dialog "New drawing"` (comboboxes `Boat`, `Sail`, `Cloth`, `button "Create drawing"`); `dialog "Edit boat"` (fields `Boat name`, `Class`, `Notes`, `button "Save boat"`); `dialog "Edit <stock code>"` (fields `Shelf location`, `Note`, `button "Save stock"`); `dialog "Reverse submission"` (field `Reason`, `button "Reverse"`), opened by `button "Reverse <submission id>"`; `dialog "Edit account"` (field `Display name`, `button "Save account"`), opened by `button "Edit <email>"`; `dialog "New rule set"` and `dialog "Edit rule set"` (fields `Seam overlap (mm)`, `Roach (permille)`, `Tolerance (mm)`, `Minimum offcut width (mm)`, `Minimum offcut length (mm)`, `Effective at`, `button "Save rule set"`) | every dialog also has `button "Cancel"`; edit dialogs open holding the record's current values |
| Boat | `heading "<boat code> · <boat name>"` (level 1), `table "Rig dimensions"` (one row per dimension, chip `Measured` or `Remeasure`, and `Remeasure by <due date>` when flagged), `button "Record measurement"` opening `dialog "Record measurement"` (combobox `Dimension`, fields `Measured length (mm)`, `Measured on`, file field `Tape photo`, `button "Save measurement"`), `button "Edit boat"` | |
| Step rail (overview and every step) | `navigation "Sail steps"` holding, in order, `Measure`, `Draw`, `Nest`, `Confirm` | a reachable step is a `link`; an unreachable step is plain text; the step on screen is marked as the current step; a solid marker bar sits under the current step |
| Overview | `heading "<drawing code>"` (level 1), status chip, combobox `Loft hand` and `button "Assign"`, `button "Issue cut sheet"`, `button "Revise drawing"`, `button "Grant sight"` opening `dialog "Grant sight"` (combobox `Owner`, field `Sight ends`, `button "Grant"`), one `button "Withdraw sight from <owner name>"` per granted grant, `link "Open cut sheet"`, `region "Sail account"` | status chip with the drawing status label |
| Sail account (overview) | `region "Sail account"` with the account chip and the figure lines from Feedback states, `button "Record payment"` opening `dialog "Record payment"` (fields `Amount (£)`, `Note`, `button "Save payment"`), `button "Issue credit note"` opening `dialog "Credit note"` (fields `Amount (£)`, `Reason`, `button "Save credit note"`) | |
| Measure step | `heading "Measure <drawing code>"` (level 1), `table "Used dimensions"`, `button "Record measurement"` (the same dialog as the boat page, with `Dimension` listing only the used dimensions) | |
| Draw step | `heading "Draw <drawing code>"` (level 1), `region "Sail drawing"` (cobalt canvas) with one `button "Panel <n>"` per panel, `region "Sail area"`, `button "Draw sail"` | empty-state copy before Draw |
| Nesting (Nest step and floor) | `heading "Nest <drawing code>"` (level 1); `region "Nesting"` containing: `list "Panels"` with `button "Panel <n>"` (pressed when selected); on the phone, `button "Panels (<n> unlaid)"` with an expanded or collapsed state; canvas outlines as `img "Drawing panel <n>"`; combobox `Active hold`; `region "Roll strip"`; `img "Placement of panel <n>"` (the ghost); `img "Laid panel <n>"` per laid panel on the active hold; `group "Placement"` readout; `button "Turn 180°"`, `button "Lay"`, `button "Undo"`; `button "Claim length"` opening `dialog "Claim length"` (combobox `Roll or offcut`, field `Length (mm)`, `button "Claim"`); `timer "Hold"`; `button "Confirm cut"`, `button "Release hold"`; `region "Roll remaining"` | readout `x <mm> mm (<in> in) · y <mm> mm (<in> in) · <0 or 180>°`; timer `Hold ends in <mm:ss>`, or chip `Lapsed`; `<n>` in the Panels button is the number of unlaid uncut panels the server reports |
| Confirm step | `heading "Confirm <drawing code>"` (level 1), `table "Holds to cut"` (one row per Held claim with at least one lay: stock code, lot, used length, panel numbers), one `button "Confirm cut on <stock code>"` per row, `region "Roll remaining"` | |
| Floor | `heading "Cutting floor"`, `list "Cutting queue"` with one card per assigned drawing, each holding `link "<drawing code> · <boat name> <Mainsail or Headsail>"` | |
| Stock | `heading "Stock shelf"`, `region "Stock on hand"`, `list "Rolls and offcuts"` with one card (list item) per item holding `link "<stock code>"` (goes to `/ledger?stock=<stock code>`), `button "Count <stock code>"` opening `dialog "Shelf count"` (fields `Counted length (mm)`, `Reason`, `button "Record count"`), `button "Edit <stock code>"`; `button "Receive roll"` opening `dialog "Receive roll"` (combobox `Cloth`, fields `Lot`, `Length (mm)`, `Shelf location`, `button "Receive"`) | |
| Ledger | `heading "Cloth ledger"`, combobox `Stock`, `table "Ledger lines"`, `button "Older lines"`, `button "Newest lines"`, `region "Ledger footer"` | |
| Console | `heading "Console"`, `tablist` with tabs `Submissions`, `Audit`, `Standing`, `Roles`, `Export` | |
| Console · Submissions | `table "Pending submissions"`, `checkbox "Select <submission id>"` per row, `button "Accept selected"`, `button "Reject selected"` opening `dialog "Reject submissions"` (field `Reason`, `button "Reject"`), `table "Decided submissions"` with `button "Reverse <submission id>"` on accepted rows | count `<n> pending` |
| Console · Audit | `table "Audit trail"`, `button "Older entries"` | |
| Console · Standing | `table "Tape standing"` with the standing chip per row, combobox `Season` | |
| Console · Roles | `table "Role abilities"` | |
| Console · Export | `link "Download ledger CSV"` | |
| Rule sets | `table "Rule sets"`, `button "New rule set"` opening `dialog "New rule set"`, `button "Edit v<n>"` on future versions | |
| Accounts | `table "Accounts"`, `button "New account"` opening `dialog "New account"` (fields `Display name`, `Email`, `Password`, combobox `Role`, `button "Create account"`), `button "Edit <email>"`, `button "Delete <email>"` | |
| Owner | `heading "My boats"`, `button "Submit measurement"` per boat opening `dialog "Submit measurement"` (combobox `Dimension`, field `Measured length`, combobox `Unit`, fields `Measured on`, `Note`, `button "Send to the loft"`), `table "My submissions"`, `heading "Cut sheets"`, `link "Open cut sheet <drawing code>"` | |
| Owner viewer | `heading "Cut sheet <drawing code>"`, `img "Cut sheet <drawing code>"`, `region "Sail account"` (figures only, no buttons) | superseded banner when it applies |
| Not-found page | `heading "That page is not in the loft."` | |

**Option labels.** Comboboxes list their options with these visible labels:

- `Dimension`: the key alone (`I`, `J`, `P`, `E`, `LL`, `LP`).
- `Cloth`: `<cloth code> · <cloth name>`, ordered by code. For example, `C-07 · Cruising crosscut 5.6 oz`.
- `Boat`: `<boat code> · <boat name>`. For example, `B-01 · Kittiwake`.
- `Sail`: `Mainsail` or `Headsail`.
- `Owner` and `Loft hand`: the account's current display name. For example, `Maren Holt`. `Owner` lists only owners, and `Loft hand` lists only loft hands.
- `Roll or offcut`: `<stock code> · lot <lot>`, listing every item of the drawing's cloth, ordered by code. For example, `R-14 · lot L-2614`.
- `Active hold`: `<stock code> · lot <lot>` for each Held claim of the drawing, newest first. The newest is selected when the screen opens and after every new claim.
- `Stock`: `All stock`, followed by every stock code.
- `Status`: `All`, then `Measuring`, `Remeasure`, `Drawn`, `Nested`, `Cutting`, `Cut`, `Pending store`, `Issued`.
- `Season`: the four-digit year, newest first, for every year that has a submission.
- `Role`: `Yacht owner` or `Loft hand`.
- `Unit`: `mm` (the default) or `in`. With `in`, `Measured length` takes decimal inches or feet and inches.

**Fields and table cells.**

- Date fields take `YYYY-MM-DD`.
- `Sight ends` and `Effective at` take `YYYY-MM-DDTHH:MM:SSZ`. An empty `Sight ends` means no end.
- `Amount (£)` takes pounds, with up to two decimals.
- In `table "My submissions"`, `table "Pending submissions"` and `table "Decided submissions"`, the figure cell shows the submission's `as_submitted` text exactly as stored, then ` · `, then the converted figure as `<mm> mm (<in> in)`. For example, `456.70 in · 11 600 mm (456.69 in)` and `38’ 1 1/2” · 11 621 mm (457.52 in)`.

**Table columns.** These tables carry exactly these column headers, in this order:

| Table | Column headers |
|---|---|
| `table "Tape standing"` | `Rank`, `Owner`, `Counted`, `Accepted`, `Rejected`, `Reversed`, `Streak`, `Standing` |
| `table "Audit trail"` | `When`, `Actor`, `Action`, `Target`, `Before`, `After`, `Reason` |
| `table "Ledger lines"` | `Line`, `Posted`, `Account`, `Stock`, `Drawing`, `Amount`, `Actor`, `Reason` |
| `table "Pending submissions"` | `Select`, `Submission`, `Owner`, `Boat`, `Dimension`, `Figure`, `Measured on`, `Submitted`, `Note`, `Result` |
| `table "Decided submissions"` | `Submission`, `Owner`, `Boat`, `Dimension`, `Figure`, `Status`, `Decided`, `Reason`, `Action` |

- `Owner` shows the submitter's display name, and `Standing` shows the standing chip.
- `Actor` shows the acting account's email.
- `Amount` shows the line's area as `<m²> m² (<ft²> ft²)`, with a leading hyphen-minus when the line is negative.
- `Status` shows the status chip (`Accepted`, `Rejected` or `Reversed`).
- `Select` holds the row's checkbox, and `Action` holds `button "Reverse <submission id>"` on accepted rows.
- `Result` is empty until a bulk decision refuses that row. It then shows the bulk refusal copy from Feedback states.
- Instants show as `YYYY-MM-DD HH:MM` UTC.

### Interactions (DP-26, DP-27, DP-33, DP-44, DP-53, DP-70, DP-71, DP-72, DP-73, DP-74, DP-75, DP-76, DP-79, DP-82, DP-86, DP-87, DP-90, DP-93, DP-95, DP-97)

**Dialogs.**

- Opening a dialog moves focus to its first field.
- Tab and Shift+Tab wrap inside the dialog and never reach the page behind it.
- Escape closes the dialog without saving.
- Closing a dialog by Escape, by Cancel or by success returns focus to the control that opened it. The one exception is a success with a landing route below, which moves focus as that route says.

**Landing routes.** Each of these actions changes the address bar to the address shown, and reloading or opening that address shows the same screen:

- Creating a boat goes to `/boats/<new boat code>`, with focus on `heading "<boat code> · <boat name>"`.
- Creating a drawing goes to the address of its first unmet step (see Four steps), with focus on that step's heading.
- A Draw sail that succeeds goes to `/drawings/<drawing code>/nest`, with focus on `heading "Nest <drawing code>"`.
- Choosing a step link in the rail goes to that step's address, with focus on its heading.
- Revising goes to the successor's `/drawings/<successor code>`, with focus on its heading.
- Receiving a roll stays on `/stock`, with focus on the new card's `button "Count <new stock code>"`.
- Creating an account stays on `/accounts`, with focus on the new row's `button "Edit <new email>"`.
- A Confirm cut that makes the drawing Cut goes to `/floor` for the loft hand, with focus on `heading "Cutting floor"`. For the sailmaker it goes to `/drawings/<drawing code>`, with focus on its heading.
- Signing out ends the session and goes to `/`, with focus on `heading "BOLTROPE"`.

**Protected routes.**

- Every route except `/`, `/signin` and the not-found page belongs to the roles listed for it under Routes.
- A signed-out visitor who opens a protected route (directly, by reload or by a link) is sent to `/signin?resume=<that path, percent-encoded>`. After signing in, they return there under the `resume` rule in Expired session. The session-ended copy does not show on this path.
- A signed-in user who opens a route of another role, or a route that names a record their role cannot see, sees the not-found page at that address, and the address is unchanged. The same applies when an honoured `resume` path belongs to another role. The one exception is an owner at `/sheets/<grant id>` for a grant that is not theirs, withdrawn or ended: that page shows the owner viewer refusal copy from Feedback states.

**Four steps.**

- The rail and every step read the drawing's `step` from the server, which names its first unmet step. The browser never works out the step itself.
- A step address is reachable when every earlier step is met. Opening or reloading a reachable step address shows that step from server state.
- Opening an unreachable step address (by typing it, by a stale link or by Back) replaces the address with the first unmet step's address. That step shows, and the `alert` shows the step copy from Feedback states.
- `/drawings/<drawing code>` is the overview. It is always reachable and is not a step.
- When a measurement on the Measure step sends a Drawn or Nested drawing back to Measuring (see Business rules), the rail at once shows Nest and Confirm as plain text, and the area poster and panels clear. No figure from before the measurement stays on screen.

**Selecting a panel.**

- Click, tap or Enter on `button "Panel <n>"` selects that panel.
- On the nesting screen, the ghost appears on the roll strip at that panel's entry in the active hold's `next_positions`, and the placement readout shows its position. When the entry has no position, the ghost appears at x 0, y 0, 0°.
- On the Draw step, selecting a panel shows that panel's length, width and area under the canvas.
- Escape clears the selection.

**Phone panel list.**

- On the phone layout, `list "Panels"` starts collapsed behind `button "Panels (<n> unlaid)"`, and that button reports its collapsed state.
- Entering the phone layout always collapses the list, including after a resize from the tablet layout where it was open. Leaving the phone layout shows the list open.
- While collapsed, the list and every `button "Panel <n>"` in it are hidden, cannot be focused or tapped, and are absent from the accessibility tree.
- Activating the Panels button expands the list and reports the expanded state.
- Selecting a panel collapses the list again and moves focus to `button "Lay"`.
- The count in the button's label follows the server's laid state after every lay, undo, release and lapse.
- The tablet and desktop layouts have no Panels button. Their list is always open, and selecting a panel there leaves focus on that panel's button.
- A layout switch keeps the selection, the ghost's position and the active hold exactly as they were.

**Keyboard nesting.** These keys work while focus is anywhere inside `region "Nesting"`, except a text field or an open dialog:

- Arrow Right and Arrow Left move the ghost 1 mm along the roll.
- Arrow Down and Arrow Up move it 1 mm across the roll, away from and toward the near edge.
- Shift with any arrow moves 10 mm.
- `R` turns the ghost 180°.
- `L` lays the panel at the ghost position.
- `U` undoes the most recent lay on the active hold.

**Ghost on the cloth.**

- Every keyboard move and every touch drag of the ghost is clamped. Its turned outline stays within x from 0 to the claim's `length_mm` and y from 0 to the stock's `usable_width_mm`.
- A move past an edge stops at the edge, and the readout shows the clamped figure. A lay there is accepted.
- `R` near the far edge turns the ghost and then clamps it again.
- For example, a ghost at x 5 mm becomes `x 0 mm (0.00 in)` after Shift+Arrow Left. Holding Shift+Arrow Down stops at y equal to the usable width less the panel's `width_mm`.

Enter and Space on a focused button only activate that button:

- Enter on `button "Panel <n>"` selects the panel.
- Enter on `button "Claim length"` opens its dialog.
- Enter on `button "Confirm cut"` confirms the cut.
- Enter on `button "Lay"` lays the panel.
- Enter never lays from any other control.

The same actions are on `button "Turn 180°"`, `button "Lay"` and `button "Undo"`. The Tab order in the region is: the panel list (on the phone, the Panels button), Active hold, Turn 180°, Lay, Undo, Claim length, Confirm cut, Release hold. Every focused control shows a thick ring in the action colour that is plainly visible on cobalt, black and off-white fields.

**Touch.**

- Dragging a panel from the panel list or from its outline on the canvas onto the roll strip shows the ghost under the finger, clamped as above.
- Releasing it lays the panel at the ghost's position, rounded to whole mm.
- Dragging the ghost moves it.
- Dragging empty strip pans the strip.

On the phone the canvas outlines stay draggable while the list is collapsed.

**Server answers.**

- Every lay, undo, claim and cut waits for the server's answer before any stock figure changes. A refused lay sends the panel back (see Motion and effects).
- Undo or a further lay pressed while a panel is still travelling is sent at once. The newest server answer decides what the strip shows.

**Hold countdown.**

- `timer "Hold"` starts from the server's `seconds_remaining` and counts down by elapsed time from the moment that answer arrived. It never reads the device date or time, so moving the device clock forwards or backwards changes nothing that is shown.
- The countdown updates once a second. A tick changes only the timer's text. It never closes or reopens a dialog, clears or alters a typed value, moves focus, moves the ghost, or clears the selection.
- When the elapsed countdown first passes 60 seconds remaining for a hold, `status "Loft status"` announces the one-minute copy from Feedback states. It does this exactly once per hold, never again on a re-render, a reopened dialog or a switch of `Active hold`, and it changes nothing else.
- At zero, the page asks the server for the claim again:
  - If the server answers `lapsed`, the chip reads `Lapsed`. Laid panels return to the panel list and to the canvas, and the selection and ghost clear. The `alert` shows the `claim_lapsed` copy from Feedback states, and focus moves to `button "Claim length"`.
  - If the server still answers `held`, the countdown restarts from the new `seconds_remaining`.

**Expired session.**

- The browser keeps the bearer token in memory. When any write answers 401 `unauthenticated`, the browser calls `GET /api/session` once. Several writes refused at the same moment share that one call.
- With the fresh token, the browser repeats each original request once, with the same body and the same `Idempotency-Key`, and shows no error. The user sees only the original action's pending copy and then its result.
- If `GET /api/session` also answers 401, the browser goes to `/signin?resume=<the current path, percent-encoded>`. For example, it goes to `/signin?resume=%2Ffloor%2FBR-0141`. The sign-in page reached this way shows the session-ended copy from Feedback states.
- After signing in, the browser returns to the `resume` path. `resume` is honoured only when it is exactly `/`, or starts with `/` followed by a character other than `/` or `\`. Any other value sends the user to their role home.
- A Confirm cut that never received an answer keeps its confirmation key for that hold in the same browser tab. Pressing Confirm cut again after signing in reuses that key.

**Signing out.**

- Signing out drops every record the browser holds before the next screen paints.
- The next account to sign in on that tab never sees the previous account's boats, submissions, drawings, sheets or names, not even for one frame.
- Back after signing out shows the sign-in page, never a page of the previous account.

**Ledger address.**

- `/ledger` keeps the filter in `stock` (a stock code, or absent for `All stock`) and the page in `cursor` (absent for the newest page).
- Changing the `Stock` filter pushes a new history entry without a cursor. `Older lines` pushes an entry with the next cursor, and `Newest lines` pushes one without a cursor.
- Reloading shows the same filter and the same lines. Back and Forward restore the filter and page, fetch them again, and show them.
- If the server refuses the cursor as belonging to another filter, the page drops the cursor from the address, shows the newest page of the current filter, and shows the field copy in the `alert`.

**Newest answer wins.** Every filter change, page move, Back or Forward starts a new request. If an earlier request answers late, its answer is discarded. The table and the footer only ever show the answer to the newest request.

**Console.**

- `/console?tab=<submissions|audit|standing|roles|export>&season=<yyyy>` keeps the tab and, on Standing, the season. Changing either updates the address, and reloading restores both. Without `tab` the Submissions tab shows, and without `season` the current UTC year is used.
- Every time the Standing tab is shown, and every time the `Season` changes, the page fetches the standing again and never shows a table kept from earlier. Each load announces the standing count copy from Feedback states.
- Checking rows and choosing Accept selected sends one bulk request. Reject selected first asks for a reason in its dialog.
- After the answer, decided rows leave the pending table. Refused rows stay, with the bulk refusal copy for their reason in their `Result` cell. The pending count reflects only the applied items.

**Live updates in place.**

- **Pending store.** While the overview shows Pending store, it fetches the drawing at least every 5 seconds, with no reload. On the first answer that reads Issued:
  - The chip changes to `Issued` in place.
  - `region "Store outage"` disappears.
  - `link "Open cut sheet"` and `button "Grant sight"` appear.
  - `status "Loft status"` announces the issue success copy exactly once.
  - Focus stays where it was.
- **Sail drawings table.** The table on `/loft` shows the server's status each time it loads. It never shows Issued before the server does.
- **Cutting floor.** `/floor` fetches the loft hand's drawings at least every 5 seconds. A drawing newly assigned to them appears as a card within 10 seconds of the assignment, with no reload. Each new card is announced once with the queue copy from Feedback states, and focus stays where it was.
- **Owner viewer.** `/sheets/<grant id>` fetches its grant at least every 5 seconds. Within 10 seconds of a withdrawal or of its end instant, the sheet image and the account are removed. The viewer then shows the owner viewer refusal copy on a black field, with no reload.

**Card grids.**

- Hovering a card lifts it 2 px within about a tenth of a second. It settles back when the pointer leaves.
- Keyboard focus on a card's link draws the thick action-colour ring around the whole card.
- Tab moves through the cards in reading order, row by row and left to right, and through each card's link and buttons in that order.
- Every link and button on a card is at least 44 px in both directions.

### Visual design (DP-63, DP-64, DP-97)

The direction is a duotone swap: whole flat fields of one colour, edge to edge, each carrying type in its partner colour.

- **Typefaces.** Red Hat Display, at its heaviest weight and in uppercase, sets headlines and poster figures. Red Hat Text sets everything else. All figures are tabular, so columns of numbers line up digit under digit.
- **Size steps.** Each heading step is about one third larger than the one below it. Body text in lists and the ledger is a comfortable reading size, slightly larger than a typical default.
- **Palette.**
  - A warm off-white ground.
  - Pure white surface panels.
  - Near-black ink.
  - A warm mid-grey for secondary text.
  - A saturated cobalt blue as the accent field, with white type on it.
  - Tomato red with black type. It appears once per page as the single statement field, as the one action colour, and as the outline of offcuts drawn on the roll strip.
- **Field rotation.** Fields alternate: cobalt with white type, then off-white with black type, then black with off-white type. No two neighbouring sections share a field. Corners are square everywhere. Pages have a narrow, even outer margin. There are no hairline rules, glass effects or decorative numbering.
- **Hero.**
  - A full-screen cobalt field carries `BOLTROPE` in white and uppercase, as large as the screen allows: about an eighth of the screen width on desktop, tightly leaded, and cropped by the right edge.
  - Behind the headline, one mainsail triangle is drawn in thin white strokes. Its luff runs up the left column, and its crosscut seams line up with the headline's baselines.
  - The label and the tomato `Open the loft` button sit in the bottom-left corner.
  - On the phone, the headline grows to almost a fifth of the screen width over three lines, with the label and button beneath it.
  - The next section swaps to off-white and carries the giant cropped area figure in black.
- **Working screens.**
  - Working pages sit on the off-white ground with white surface panels.
  - The sail drawing canvas is always a cobalt field with white panel outlines and white figures.
  - The roll strip is always a black field with off-white cloth and tomato-outlined offcuts.
  - The step rail is a black band with off-white step names. The current step's marker is a solid off-white bar under its name.
  - Shelf and queue cards are white surface panels with square corners on the off-white ground. Each card's governing figure (remaining length in mm and inches) is set large in the display face.
  - Tomato appears only on the one primary action of a screen (Lay, Confirm cut, Issue cut sheet), on the store-outage banner, and on the outlines of offcuts drawn on the roll strip.
  - Every dimension cell shows mm then inches. Every area shows m² then ft². Every amount of money shows pounds with two decimals.
  - The ledger groups the two lines of a pair by spacing alone, not by rules.
  - Empty states put one sentence at display size on a cobalt field.
  - Errors and conflicts sit on a black field with off-white copy at a large reading size.
- **Poster figures.** The governing figures fill whole fields at poster size, about a tenth of the screen width, in the heaviest display weight and in both unit systems. They are the sail area on the Draw step, the foretriangle area on the boat screen, and the remaining length on the nesting screen and the Confirm step.
- **Comfort.** Density is comfortable. Every control is at least 44 px in both directions. All text meets WCAG 2.2 AA contrast on its field.

### Motion and effects (DP-28, DP-60, DP-61, DP-86, DP-96)

All motion eases out: it starts quickly and settles softly. Nothing loops for decoration. The hero sail is still.

**Thread Lay (signature).** When a panel is laid by the `L` key, by Lay or by a drop, three things happen in order:

1. Its outline on the cobalt canvas lifts: it grows by about three percent over 120 milliseconds.
2. It travels as one shape from its drawing position to the nest position the server returned on the black roll strip. As it travels, it shrinks or grows from drawing scale to strip scale. It turns only 0° or 180°, never a quarter turn, so the thread line stays along the roll. The travel takes 420 milliseconds.
3. It lands filled off-white with its panel number. Then the figures in `region "Roll remaining"` count down in mm and inches to the new server value over 320 milliseconds. Over the same 320 milliseconds, the remaining-length meter on the strip shrinks to the new value. Both land exactly on the server value.

The new ledger figures appear in the footer once the cut is confirmed. The landed outline's position, converted back to mm at the strip's scale, matches the stored nest coordinates within 0.5 mm. A refused lay (overlap, off the cloth, or a lapsed or lost hold) sends the panel back along the same path over the same 420 milliseconds, and no stock figure changes.

**Interruptions.** These follow the Server answers rule in Interactions:

- `U` pressed during a travel lifts the panel on the server. The travel is abandoned, and the panel returns to the panel list and the canvas.
- `L` on the next panel during a travel starts that panel's own travel. The first panel still lands at its own server position, with no snap and no replay.
- A refused lay's return path never overwrites a later success.
- No animation frame ever positions a panel the server has since lifted or moved.

**Roll strip scale.** The strip draws the active hold's full claimed length across its full inner width. The same mm-to-pixel scale applies in both directions, so the strip's height shows the stock's usable width.

**Step transitions.** Moving between two step addresses inside the app happens in two parts, and at no moment are both steps laid out:

1. The outgoing step's content fades out over 160 milliseconds and is then removed.
2. The incoming step's content fades in over 160 milliseconds.

Meanwhile, the rail's marker slides from the old step to the new one over 320 milliseconds. A reload or a typed address shows the step at once.

**Staggered ledger rows.** When a ledger page loads, its rows fade and slide in over 200 milliseconds each. Row *n* starts *n* × 30 milliseconds after the page arrives, for rows 1 to 10. Row 10 starts at 10 times row 1's delay, and every later row shares row 10's delay.

**Shelf cards keep identity.** On the stock shelf, cards are ordered by on-hand area, smallest first, then by code. When a cut or count moves a card to a new place, that card travels to its new place over 320 milliseconds. Other cards only close up or open the gap. No card disappears and reappears.

**Press and hover feedback.** A pressed button darkens slightly within a tenth of a second. A hovered card lifts as described under Card grids.

**Reduced motion.** When the device asks for reduced motion, every motion above has a duration and delay of exactly zero seconds, not a near-zero value, and reaches the identical end state:

- The panel appears at its nest position at once.
- The remaining figures and the meter are set at once.
- Steps swap at once, and the marker jumps.
- The card lift happens at once.

The polite region still announces the lay copy from Feedback states. Placement, undo, touch dragging and keyboard control are unchanged.

**No shift.** On `/`, `/signin` and the not-found page, no laid-out element moves after the first paint. Fonts are loaded so that text does not reflow.

### Feedback states (DP-03, DP-17, DP-46, DP-62, DP-67, DP-68, DP-75, DP-79, DP-80, DP-87, DP-89, DP-94, DP-95, DP-98, DP-99)

**Live regions and fields.**

- Pending and success copy goes to `status "Loft status"`. Refusal copy goes to the `alert` region, on a black field.
- Field errors appear under their field and are linked to it. In the owner dialog, errors on `value_mm` and `value_in` both appear under `Measured length`. Errors on `amount_pence` appear under `Amount (£)`.
- The store-outage copy also fills `region "Store outage"` as the tomato banner. It stays for as long as the last store-dependent answer was an outage.
- Placeholders:
  - `<mm>` is a whole number of millimetres.
  - `<in>` is inches to two decimals.
  - `<signed mm²>` is a whole number of square millimetres with an explicit sign.
  - `<£>` is pounds with two decimals and no currency sign (the copy supplies `£`).
  - `<code>` is a stock code.
  - `<kind>` is `roll` or `offcut`.
- Every `<mm>`, `<in>`, `<£>` and `<signed mm²>` in published copy uses the screen grouping from Units: an integer part of 1000 or more is grouped in threes with one ordinary space.
- `<signed mm²>` starts with `+` when positive or `-` (the ordinary hyphen-minus) when negative. It is never zero, because a zero difference uses the other count copy. For example, `Count recorded with an adjustment of +1 195 635 mm².` and `Count recorded with an adjustment of -1 195 635 mm².`
- Every published string below renders and is announced character for character. Boltrope's own copy uses straight apostrophes and ordinary hyphens. An owner's figure is shown exactly as stored, curled marks included.

**Pending copy:**

| Action | Copy |
|---|---|
| Claim | `Claiming length...` |
| Lay | `Laying panel <n>...` |
| Confirm cut | `Confirming cut...` |
| Issue | `Issuing cut sheet...` |
| Owner submission | `Sending to the loft...` |
| Any save | `Saving...` |

**Success copy:**

| Action | Copy |
|---|---|
| Measurement | `Measurement saved.`, or `Measurement saved. <dimension> needs remeasuring by <YYYY-MM-DD>.` |
| Owner submission | `Submission sent to the loft.` |
| Draw | `Sail drawn: <count> panels.` |
| Claim | `Holding <mm> mm on <code> until <HH:MM> UTC.` (from the server's `expires_at`) |
| Lay | `Panel <n> laid on <kind> <code>. <mm> mm (<in> in) remaining.` (from the server's `after_laid_mm`) |
| Undo | `Panel <n> lifted from <kind> <code>.` |
| Turn | `Panel <n> turned to <0 or 180>°.` |
| Release | `Hold released on <code>.` |
| One minute left | `One minute left on the hold on <code>.` |
| Cut | `Cut confirmed on <kind> <code>. <mm> mm (<in> in) remaining.`, followed by ` Offcut <new code> added to the shelf.` when one is created |
| Issue, store confirmed | `Cut sheet issued.` |
| Grant | `Sight granted to <owner name>.` |
| Withdraw | `Sight withdrawn from <owner name>.` |
| Payment | `Payment of £<£> recorded. Balance £<£>.` |
| Credit note | `Credit note of £<£> recorded. Balance £<£>.` |
| Count | `Count recorded. The ledger matches the shelf.`, or `Count recorded with an adjustment of <signed mm²> mm².` |
| Bulk decision | `<applied> applied, <refused> refused.` |
| Single decision | `Submission <id> accepted.` or `Submission <id> rejected.` |
| Reverse | `Submission <id> reversed.` |
| Receive | `Roll <code> received.` |
| Account | `Account created for <email>.` |
| Rule set | `Rule set v<n> saved.` |
| Standing load | `<n> owners in season <yyyy>.`, or `1 owner in season <yyyy>.` when n is 1, where n is the number of rows in the standing |
| Cutting queue, new assignment | `<drawing code> is on your cutting floor.` |
| Sign-in page reached after a failed session refresh (see Expired session) | `Your session ended. Sign in to carry on.` |
| Any other save | `Saved.` |

**Step copy** (in the `alert`, after an unreachable step address is replaced): `Finish the <Measure, Draw or Nest> step first.`, naming the first unmet step.

**Bulk refusal copy** (in the refused row's `Result` cell, by the item's `reason`):

| Reason | Copy |
|---|---|
| `already_decided` | `Already decided.` |
| `not_found` | `No such submission.` |
| `reason_required` | `Give a reason.` |
| `invalid_decision` | `Choose accept or reject.` |

**Sail account lines** (in `region "Sail account"`, in this order, each amount as `£<£>`): `Cloth charge`, `Tax at 20%`, `Total`, `Deposit`, `Paid`, `Credit notes`, `Balance`. The account chip reads `Deposit due`, `Balance due` or `Settled`.

**Outage copy.**

- **Sailmaker issuing** (answer 202, Pending store): `The cut-sheet store is not answering. This cut sheet will be issued as soon as the store is back.` This copy stays true while the drawing waits.
- **Owner fetching a sheet** (503): `The cut-sheet store is not answering. Try again in a few minutes.`
- **Photo upload or fetch** (503): `The cut-sheet store is not answering. The tape photo was not saved.`
- **Identity provider down** (503): `Sign-in is not answering. Try again in a minute.`
- **Database down** (503): `The loft records are not answering. Try again in a minute.`

**Empty states** (display size on cobalt):

| Where | Copy |
|---|---|
| Ledger filter with no lines | `No cloth has moved on this stock yet.` |
| Owner with no sheets | `No cut sheet has been shared with you yet.` |
| Owner with no boats | `No boat is on your account yet.` |
| Console with no pending submissions | `Every submission has been decided.` |
| Floor with nothing assigned | `Nothing is assigned to you on the cutting floor.` |
| Draw step before Draw | `This sail has not been drawn yet.` |

**Other copy.**

- **Owner viewer after a 404:** `That cut sheet is not shared with you.`
- **Superseded banner:** `Superseded by <drawing code>.`
- **Status chip labels:** `Measuring`, `Remeasure`, `Drawn`, `Nested`, `Cutting`, `Cut`, `Pending store`, `Issued`, `Lapsed`, `Measured`.
- **Standing chips:** `True tape`, `Steady tape`, `New tape`.
- **Deleted account name:** `Former account`.

**Refusal copy.** Every refusal body is `{"error":"<code>","message":"<copy>"}`. A 422 also carries `"fields":{"<member>":"<field copy>"}`.

| Code | Status | Copy |
|---|---|---|
| `unauthenticated` | 401 | `Sign in to continue.` |
| `bad_credentials` | 401 | `That email and password do not match an account.` |
| `not_found` | 404 | `Not found.` |
| `forbidden` | 403 | `Your role cannot do that.` |
| `no_cutting_authority` | 403 | `You hold no cutting authority right now.` |
| `no_authority_on_claim_date` | 403 | `You held no cutting authority when this length was claimed.` |
| `role_change_forbidden` | 403 | `Roles cannot be changed from the console.` |
| `precondition_required` | 428 | `Reload before saving.` |
| `stale_revision` | 412 | `Someone saved this first. Reload to see their change.` |
| `sealed` | 409 | `This drawing is sealed. Revise it to change anything.` |
| `wrong_state` | 409 | `That cannot be done in the current state.` |
| `remeasure_required` | 409 | `Remeasure the flagged dimensions before drawing this sail.` |
| `not_nested` | 409 | `Lay every panel before confirming a cut.` |
| `claim_empty` | 409 | `Lay a panel on this hold before cutting it.` |
| `claim_conflict` | 409 | `<winner display name> claimed this length first. Choose another roll or offcut.` |
| `claim_lapsed` | 409 | `This hold has lapsed. Claim the length again before cutting.` |
| `claim_closed` | 409 | `This hold is already closed.` |
| `already_cut` | 409 | `This length has already been cut.` |
| `idempotency_key_reused` | 409 | `That confirmation key belongs to another request.` |
| `lay_overlap` | 409 | `Panel <n> overlaps panel <m>. Nothing was laid.` |
| `panel_laid` | 409 | `Panel <n> is already laid.` |
| `already_issued` | 409 | `This cut sheet has already been issued.` |
| `already_revised` | 409 | `This drawing already has a revision.` |
| `already_decided` | 409 | `This submission has already been decided.` |
| `not_accepted` | 409 | `Only an accepted submission can be reversed.` |
| `account_in_use` | 409 | `This account still owns boats.` |
| `email_taken` | 409 | `An account already uses that email.` |
| `photo_exists` | 409 | `This measurement already has its tape photo.` |
| `exceeds_balance` | 409 | `That is more than the balance left on this sail.` |
| `rate_limited` | 429 | `Too many requests from this account. Try again in <seconds> seconds.` (`<seconds>` equals the Retry-After value) |
| `invalid` | 422 | `Check the highlighted fields.` |
| `too_large` | 413 | `That is larger than the loft accepts.` |
| `unsupported_media` | 415 | `That content type is not accepted here.` |
| `store_unavailable` | 503 | the owner or photo outage copy above, by address |
| `identity_unavailable` | 503 | the identity outage copy above |
| `database_unavailable` | 503 | the database outage copy above |

**Field copy:**

| Field problem | Copy |
|---|---|
| Missing | `Required.` |
| Length out of range, including an inch figure whose conversion is out of range | `Enter whole millimetres from 1 to 60000.` |
| Inches malformed or not above 0 (on `value_in`) | `Enter inches above 0 with up to two decimals, or feet and inches as 38' 1 1/2".` |
| Both or neither of `value_mm` and `value_in` (on `value_mm`) | `Enter the figure in mm or in inches, not both.` |
| A millimetre figure that reads as inches (on `value_mm`) | `That looks like inches. Enter millimetres.` |
| Bad date | `Enter a date as YYYY-MM-DD.` |
| Bad instant | `Enter a future instant as YYYY-MM-DDTHH:MM:SSZ.` |
| Lot empty, longer than 20 characters or not printable | `Enter a lot of 1 to 20 characters.` |
| Cloth mismatch (on `stock_code`) | `This cloth does not match the drawing.` |
| Lot mismatch (on `stock_code`) | `This lot does not match the cloth already on this sail.` |
| Claim too long | `Longer than the cloth left on <code>.` |
| Panel off the cloth | `Panel <n> runs off the cloth. Nothing was laid.` |
| Reject or reverse without a reason | `Give a reason.` |
| Count differs without a reason | `Give a reason for the difference.` |
| Reason longer than 200 characters | `Keep the reason to 200 characters or fewer.` |
| Bad rotation | `Turn 0 or 180 only.` |
| Amount not a whole number of pence above 0 (on `amount_pence`) | `Enter an amount in pounds above 0 with up to two decimals.` |
| Cursor from another filter (on `cursor`) | `This page belongs to another filter.` |
| Cursor the server never issued (on `cursor`) | `That page marker is not valid.` |
| Text outside its length range (`<min>` and `<max>` from Member bounds) | `Enter <min> to <max> characters.` |
| Whole number outside its range (`<min>` and `<max>` from Member bounds) | `Enter a whole number from <min> to <max>.` |
| Email malformed (on `email`) | `Enter an email address.` |
| Password length (on `password`) | `Enter a password of 12 to 128 characters.` |
| Some but not all of `x_mm`, `y_mm` and `rotation` (on `position`) | `Send x_mm, y_mm and rotation together, or none of them.` |
| Unknown dimension (on `dimension`) | `Choose one of I, J, P, E, LL and LP.` |
| Unknown sail (on `sail`) | `Choose mainsail or headsail.` |
| Unknown cloth (on `cloth_code`) | `Choose a cloth from the list.` |
| Unknown role (on `role`) | `Choose yacht-owner or loft-hand.` |
| Not an owner account that has not been deleted (on `owner_email`) | `Choose an owner account.` |
| Not a loft hand account that has not been deleted (on `loft_hand_email`) | `Choose a loft hand account.` |
| Unknown boat (on `boat_code`) | `Choose a boat from the list.` |
| Unknown stock item (on `stock_code`) | `Choose a roll or offcut from the list.` |
| Unknown drawing (on `drawing_code`) | `Choose a drawing from the list.` |
| Not a panel of the drawing (on `panel_number`) | `Choose a panel of this drawing.` |
| Decision other than `accept` or `reject` (on `decision`) | `Choose accept or reject.` |

## Backend

### API (DP-01, DP-03 to DP-12, DP-14, DP-16, DP-17, DP-25, DP-30, DP-35, DP-36, DP-40 to DP-42, DP-45 to DP-48, DP-50, DP-53 to DP-56, DP-58, DP-68, DP-69, DP-77, DP-78, DP-81, DP-89, DP-93, DP-98, DP-99)

**Wire format.**

- All addresses are under `/api` and are same-origin.
- Request and response bodies are `application/json; charset=utf-8`. The exceptions are photo upload, the cut-sheet and photo fetches, and the CSV export.
- Timestamps are UTC `YYYY-MM-DDTHH:MM:SSZ`, and dates are `YYYY-MM-DD`.
- Integer mm, mm² and pence are JSON numbers. The derived figures (`*_in`, `*_m2`, `*_ft2`) are strings with two decimals and no grouping, computed by the rule in Business rules.

**Published surface.**

- The endpoint table below is the whole API. A request to any `/api` address that is not in the table, or with a method the table does not list for that address, answers 404 `not_found`. It does so whether or not the caller is signed in, before every other check. This covers `HEAD`, `OPTIONS` and `TRACE` everywhere, and `PUT` on an address that only lists `GET`.
- Every 404 from the API, for any reason and at any address (nested addresses included), has the byte-identical body `{"error":"not_found","message":"Not found."}` and the identical set of header names and values, apart from `Date`. No 404 sets a cookie.
- No API response carries `X-Powered-By`, `Allow` or any `Access-Control-*` header.

**Authentication.**

- Every address except `GET /api/health`, `POST /api/session` and `GET /api/session` needs a caller.
- A caller is a bearer access token issued for client `AUTH_CLIENT_ID` by the realm at `AUTH_ISSUER_URL`. Its signature is checked against the realm's published keys, along with its issuer and expiry. Its subject must map to a stored account that has not been deleted.
- Role, ownership and cutting authority are read from the stored records on every call. Role or email claims inside the token are never used.
- `GET` requests may instead carry the session cookie. Any other method that carries only the cookie answers 401 `unauthenticated`.
- A forged, unsigned, tampered, wrongly signed, expired or deleted-account token answers the identical 401 `unauthenticated` body.

**Refusal ladder (one rule for the whole API).**

- An address or method outside the table is answered first, as above.
- Transport refusals come next: 413 `too_large`, then 415 `unsupported_media`. A photo whose bytes do not carry its declared type's signature is a 415 at this rank.
- Then the ladder runs in this order: 401 `unauthenticated`, 404 `not_found` (unknown, or not visible to this caller), 403 (role or authority), 428 `precondition_required`, 412 `stale_revision`, 409 `sealed`, 409 for state (every other 409 code), 429 `rate_limited`, 422 `invalid`.
- When a request breaks several rules, only the highest-ranked status appears.
- An idempotent replay returns its stored response after the 403 rank, before any later check.

**Mass assignment.**

- Every write stores only the members listed for that endpoint below, and silently ignores all other members. Ignored members include `id`, `code`, `role` (except where listed), `owner`, `status`, `step`, `revision`, `version`, `lot` (except on `POST /api/rolls`), `remaining_mm`, `on_hand_mm2`, `as_submitted`, `balance_pence`, any count, and any timestamp other than those listed.
- Responses echo the stored record, never the submitted body.
- `PATCH /api/accounts/<id>` is the one exception: a body carrying `role` is refused 403 `role_change_forbidden` and still audited.

**Lists.**

- Every collection answers `{"items":[...],"next_cursor":"<opaque>"|null,"total":<whole-set count for the filter>}`.
- `limit` defaults to 20. A value above 50 is answered with 50 items. A `limit` below 1, or one that is not an integer, answers 422.
- `cursor` is the opaque value from the previous page. A cursor belongs to the filter that produced it, meaning every query member other than `limit` and `cursor`. Using it with any other filter answers 422 on `cursor` with the other-filter copy. A value the server never issued answers 422 on `cursor` with the invalid-marker copy.
- Order is newest first by the list's ordering instant, then by id descending. Ids that end in a number (`B-12`, `BR-0241`, `S-0123`, `G-0061`, `A-10`) compare by that number, integer ids compare numerically, and opaque ids compare as text. The ordering instant of each paged or listed collection is:

  | Collection | Ordering instant |
  |---|---|
  | Ledger lines | `posted_at` |
  | Audit rows | `at` |
  | Submissions | `submitted_at` |
  | Grants | `granted_at` |
  | Claims | `taken_at` |
  | Authorities | `valid_from` |
  | Boats, drawings, accounts | creation order, so the highest id number is newest |

  The lists that the endpoint table orders another way (stock and cloths by code ascending, closures by date ascending, rule sets by version descending) keep that order, and their cursors follow it.

**Versioned records.** Boats, stock items and rule sets carry `revision`, an integer starting at 1. For the sailmaker, their `GET` sends `ETag: "<revision>"`. Their `PATCH` needs `If-Match: "<revision>"`. A missing `If-Match` answers 428, and a stale one answers 412 and changes nothing. A match saves and adds 1 to the revision.

**Objects.**

- **Account:** `{"id","email","display_name","role":"sailmaker"|"loft-hand"|"yacht-owner"}`.
- **Boat:** `{"code","name","class_name","owner":{"email","display_name"},"notes","revision","foretriangle":{"area_mm2","area_m2","area_ft2","basis"},"dimensions":[Dimension]}`.
- **Dimension:** `{"key":"I"|"J"|"P"|"E"|"LL"|"LP","value_mm","value_in","status":"measured"|"remeasure","remeasure_due":null|date,"measurements":[{"id","value_mm","value_in","measured_on","source":"sailmaker"|"submission","submission_id":null|id,"photo":null|{"key","size","sha256","content_type"}}]}`. Measurements are listed oldest first, by `measured_on` and then by recording order.
- **Submission:** `{"id","boat_code","dimension","value_mm","value_in","as_submitted","measured_on","note","status":"pending"|"accepted"|"rejected"|"reversed","submitted_by":{"email","display_name"},"submitted_at","decided_at","decided_by":null|email,"reason"}`.
- **Rule set:** `{"version","effective_at","current","seam_overlap_mm","roach_permille","tolerance_mm","min_offcut_width_mm","min_offcut_length_mm","revision"}`. `current` is decided at request time.
- **Cloth:** `{"code","name","weight","width_mm","usable_width_mm","rate_pence_per_m2"}`.
- **Drawing:**
  - `{"code","boat_code","boat_name","sail":"mainsail"|"headsail","cloth_code","lot":null|string,"status","step":"measure"|"draw"|"nest"|"confirm","ruleset_version":null|int,"assigned_to":null|{"email","display_name"},"luff_mm","foot_mm",`
  - `"area":null|{"area_mm2","area_m2","area_ft2","basis"},"panels":[Panel],"claim_ids":[...],`
  - `"cut_sheet":null|{"sha256","size","key","superseded_by":null|code},"predecessor":null|code,"successor":null|code}`.
  - `status` is one of `measuring`, `remeasure`, `drawn`, `nested`, `cutting`, `cut`, `pending_store`, `issued`.
  - `boat_name` is the boat's current name. `step` is the first unmet step, as defined in Business rules.
- **Panel:** `{"number","outline":[[x,y],...],"length_mm","width_mm","area_mm2","area_m2","area_ft2","laid":null|{"claim_id","stock_code","x_mm","y_mm","rotation"},"cut":bool}`. `outline` is in the panel's own frame at 0°.
- **Stock:** `{"code","kind":"roll"|"offcut","cloth_code","lot","width_mm","usable_width_mm","remaining_mm","remaining_in","free_mm","after_laid_mm","after_laid_in","on_hand_mm2","on_hand_m2","on_hand_ft2","shelf_location","note","last_count":null|{"counted_mm","at"},"revision"}`.
- **Claim:** `{"id","stock_code","drawing_code","holder":{"email","display_name"},"length_mm","status":"held"|"cut"|"lapsed"|"released","taken_at","expires_at","seconds_remaining","used_mm","lays":[{"panel_number","x_mm","y_mm","rotation","outline":[[x,y],...]}],"next_positions":[{"panel_number","x_mm","y_mm","rotation"}]}`.
  - The lay outlines are in the claim frame.
  - A lapsed or released claim has empty `lays` and `next_positions`.
  - `next_positions` has one entry for every unlaid, uncut panel of the drawing, in panel order. It is derived on every read. A panel that fits nowhere on the hold has `x_mm`, `y_mm` and `rotation` all null.
- **Ledger line:** `{"line_id","pair_id","posted_at","account","amount_mm2","stock_code","drawing_code","actor_email","reason"}`.
- **Grant:** `{"id","drawing_code","owner":{"email","display_name"},"status":"granted"|"withdrawn","granted_at","ends_at","withdrawn_at"}`. A grant past its `ends_at` reads `withdrawn`, with `withdrawn_at` equal to `ends_at`.
- **Authority:** `{"id","loft_hand":{"email","display_name"},"valid_from","valid_until","status":"in_force"|"not_yet"|"ended"}`.
- **Audit row:** `{"id","at","actor_email","action","target","before","after","reason"}`.
- **Sail account:** `{"drawing_code","status":"deposit_due"|"balance_due"|"settled","cloth_code","rate_pence_per_m2","area_mm2","charge_pence","tax_rate_percent","tax_pence","total_pence","deposit_pence","paid_pence","credited_pence","balance_pence","entries":[{"id","kind":"payment"|"credit_note","amount_pence","at","note","reason","recorded_by"}]}`. Entries are listed newest first. A payment carries `note` and a null `reason`. A credit note carries `reason` and a null `note`.

**Owner projection.** An owner caller receives these shapes in place of the ones above, on every address that returns them, inside lists too:

- **Boat:** the Boat object without `notes` and `revision`, sent with no `ETag` header. Each measurement's `photo` is `null` or `{"size","sha256"}`.
- **Drawing:** exactly `code`, `boat_code`, `boat_name`, `sail`, `status`, `area`, `panels`, `cut_sheet`, `predecessor` and `successor`. Each panel omits `laid`. `cut_sheet` is `null` or `{"sha256","size","superseded_by"}`.
- **Submission:** the Submission object without `decided_by`.
- **Sail account:** the Sail account object with each entry omitting `recorded_by`.

No owner response contains a store key, a claim, a lot, an assignment, a sailmaker's or loft hand's email, or a sailmaker's note.

**Endpoints.** The role column says who may call each address.

- A role that is not listed gets 403 `forbidden` on an address with no record id (a collection). For example, an owner calling `GET /api/stock` gets 403.
- It gets 404 `not_found` on an address naming a record that role cannot see. For example, an owner calling `GET /api/stock/R-03` gets 404.
- It gets 403 on a record it can see but may not change.

Visibility by role:

- **Sailmaker:** everything.
- **Loft hand:**
  - Drawings assigned to them, and the boats of those drawings, read-only. `GET /api/boats` lists exactly those boats.
  - The stock items of those drawings' cloth.
  - Claims on those drawings, whoever holds them.
  - Cloths and closures.
  - Never submissions, grants, sail accounts, accounts, rule sets, the ledger, authorities, the audit trail or exports.
- **Owner:**
  - Their own boats, with those boats' dimensions, photos and submissions.
  - Drawings with an active grant to them, with those drawings' sail accounts, and their own grants.
  - Never stock, claims, the ledger, cloths, closures, authorities, accounts, rule sets, the audit trail or exports.

| Method and path | Role | Request members | Success | Own extra errors |
|---|---|---|---|---|
| `GET /api/health` | none | | 200 `{"status":"ok"}` | 503, see Server boundary |
| `POST /api/session` | none | `email`, `password` | 200 `{"account":Account,"access_token","expires_in"}` + cookie | 401 `bad_credentials`, 503 `identity_unavailable` |
| `GET /api/session` | cookie | | 200, same body with a fresh token | 401 |
| `DELETE /api/session` | any | | 204, clears the cookie | |
| `GET /api/accounts` / `POST /api/accounts` | sailmaker | `email`, `display_name`, `password`, `role` (`yacht-owner` or `loft-hand` only) | 200 list / 201 Account | 409 `email_taken`, 422 |
| `PATCH /api/accounts/<id>` | sailmaker | `display_name` | 200 Account | 403 `role_change_forbidden` |
| `DELETE /api/accounts/<id>` | sailmaker | | 204 | 409 `account_in_use` |
| `GET /api/admin/roles` | sailmaker | | 200 `{"items":[{"ability","sailmaker","loft-hand","yacht-owner"}]}` | |
| `GET /api/rulesets` | sailmaker | | 200 list, version descending | |
| `POST /api/rulesets` | sailmaker | the five rule figures, `effective_at` | 201 | 422 |
| `PATCH /api/rulesets/<version>` | sailmaker | the five figures, `effective_at` | 200 | 409 `sealed` once current or past |
| `GET /api/cloths`, `GET /api/closures` | sailmaker, loft hand | | 200 list, ordered by code / date ascending | |
| `GET /api/boats`, `GET /api/boats/<code>` | all | | 200 | |
| `POST /api/boats` | sailmaker | `name`, `class_name`, `owner_email`, `notes` | 201 Boat | 422 |
| `PATCH /api/boats/<code>` | sailmaker | `name`, `class_name`, `notes` | 200 | |
| `POST /api/boats/<code>/measurements` | sailmaker | `dimension`, `value_mm`, `measured_on` | 201 Boat | 422 |
| `PUT /api/measurements/<id>/photo` | sailmaker | raw JPEG or PNG body | 200 Dimension | 409 `photo_exists`, 503 `store_unavailable` |
| `GET /api/measurements/<id>/photo` | all who see the boat | | 200 image bytes | 503 |
| `POST /api/boats/<code>/submissions` | owner | `dimension`, exactly one of `value_mm` (integer) or `value_in` (string), `measured_on`, `note` | 201 Submission | 429, 422 |
| `GET /api/submissions` | sailmaker (all), owner (own) | `?status=` | 200 list by `submitted_at` | |
| `POST /api/submissions/<id>/decision` | sailmaker | `decision` (`accept` or `reject`), `reason` | 200 Submission | 409 `already_decided`, 422 |
| `POST /api/submissions/<id>/reverse` | sailmaker | `reason` | 200 Submission | 409 `not_accepted`, 422 |
| `POST /api/admin/submissions/decisions` | sailmaker | `decisions:[{"id","decision","reason"}]` (1 to 50 items) | 200 `{"results":[{"id","outcome":"applied"\|"refused","reason":null\|"already_decided"\|"not_found"\|"reason_required"\|"invalid_decision","status"}]}` | 422 for 0 or more than 50 items |
| `GET /api/drawings`, `GET /api/drawings/<code>` | sailmaker, loft hand, owner with grant | `?status=&boat=` | 200 | |
| `POST /api/drawings` | sailmaker | `boat_code`, `sail`, `cloth_code` | 201 Drawing in `measuring` or `remeasure` | 422 |
| `POST /api/drawings/<code>/draw` | sailmaker | | 200 Drawing | 409 `remeasure_required`, `wrong_state`, `sealed` |
| `POST /api/drawings/<code>/assign` | sailmaker | `loft_hand_email` | 200 | 409 `sealed`, 422 |
| `POST /api/drawings/<code>/issue` | sailmaker | | 200 Drawing `issued`, or 202 Drawing `pending_store` | 409 `already_issued`, `wrong_state` |
| `GET /api/drawings/<code>/cut-sheet/preview` | sailmaker | | 200 `image/svg+xml` bytes rendered now, not stored | 409 `wrong_state` before `cut` |
| `POST /api/drawings/<code>/revise` | sailmaker | | 201 successor Drawing | 409 `already_revised`, `wrong_state` |
| `GET /api/cut-sheets/<sha256>` | sailmaker | | 200 `image/svg+xml` | 503 `store_unavailable` |
| `GET /api/drawings/<code>/account` | sailmaker, owner with grant | | 200 Sail account | 409 `wrong_state` before `cut` |
| `POST /api/drawings/<code>/payments` | sailmaker | header `Idempotency-Key` (1 to 100 printable ASCII characters), `amount_pence`, `note` | 201 Sail account | 409 `exceeds_balance`, `wrong_state`, `idempotency_key_reused`, 422 |
| `POST /api/drawings/<code>/credit-notes` | sailmaker | `amount_pence`, `reason` | 201 Sail account | 409 `exceeds_balance`, `wrong_state`, 422 |
| `POST /api/drawings/<code>/grants` | sailmaker | `owner_email`, `ends_at` (optional) | 201 Grant | 409 `wrong_state` unless issued, 422 |
| `POST /api/grants/<id>/withdraw` | sailmaker | | 200 Grant | 409 `wrong_state` if already withdrawn |
| `GET /api/drawings/<code>/grants` | sailmaker | | 200 list | |
| `GET /api/grants/<id>` | sailmaker, owner of that grant while active | | 200 Grant | |
| `GET /api/my/cut-sheets` | owner | | 200 list of active Grants | |
| `GET /api/grants/<id>/cut-sheet` | owner of that grant | | 200 `image/svg+xml` | 429, 503 `store_unavailable` |
| `GET /api/stock`, `GET /api/stock/<code>` | sailmaker, loft hand | `?kind=` | 200, ordered by code | |
| `GET /api/stock/summary` | sailmaker, loft hand | | 200 `{"rolls","offcuts","on_hand_mm2","on_hand_m2","on_hand_ft2"}` | |
| `POST /api/rolls` | sailmaker | `cloth_code`, `lot`, `length_mm`, `shelf_location` | 201 Stock | 422 |
| `PATCH /api/stock/<code>` | sailmaker | `shelf_location`, `note` | 200 | |
| `POST /api/stock/<code>/counts` | sailmaker | `counted_length_mm`, `reason` | 200 Stock | 409 `wrong_state` while a hold is live, 422 |
| `POST /api/claims` | sailmaker, loft hand | `stock_code`, `drawing_code`, `length_mm` | 201 Claim | 403 `no_cutting_authority`, 409 `claim_conflict`, `sealed`, `wrong_state`, 422 |
| `GET /api/claims/<id>` | sailmaker, loft hand | | 200 Claim | |
| `POST /api/claims/<id>/lays` | sailmaker, loft hand | `panel_number`, and either none or all of `x_mm`, `y_mm`, `rotation` | 201 `{"claim":Claim,"stock":Stock,"drawing_status"}` | 409 `claim_lapsed`, `claim_closed`, `lay_overlap`, `panel_laid`, 422 |
| `DELETE /api/claims/<id>/lays/<panel number>` | sailmaker, loft hand | | 200, same body | 409 `claim_lapsed`, `claim_closed` |
| `POST /api/claims/<id>/release` | sailmaker, loft hand | | 200 Claim | 409 `claim_lapsed`, `claim_closed` |
| `POST /api/claims/<id>/cut` | sailmaker, loft hand | header `Idempotency-Key` (1 to 100 printable ASCII characters) | 200 `{"claim":Claim,"stock":Stock,"offcut":null\|Stock,"pairs":[{"pair_id","lines":[Line,Line]}],"drawing_status"}` | 403 `no_authority_on_claim_date`, 409 `claim_lapsed`, `already_cut`, `claim_closed`, `claim_empty`, `not_nested`, `idempotency_key_reused`, 422 missing key |
| `GET /api/authorities`, `POST /api/authorities` | sailmaker | `loft_hand_email`, `valid_from`, `valid_until` (optional) | 200 / 201 | 422 if `valid_from` is in the past |
| `POST /api/authorities/<id>/withdraw` | sailmaker | | 200 | 409 `wrong_state` if ended |
| `GET /api/ledger` | sailmaker | `?stock=&limit=&cursor=` | 200 list + `"footer":{"stock_code","remaining_mm","remaining_in","offcut_count","on_hand_mm2","on_hand_m2","on_hand_ft2","lines"}` | |
| `GET /api/ledger/reconciliation` | sailmaker | | 200 `{"lines","ledger_sum_mm2","stored_on_hand_mm2","ledger_on_hand_mm2","difference_mm2","items":[{"stock_code","stored_on_hand_mm2","ledger_on_hand_mm2","difference_mm2"}]}` | |
| `GET /api/exports/ledger.csv` | sailmaker | | 200 `text/csv; charset=utf-8` | |
| `GET /api/admin/audit` | sailmaker | `?limit=&cursor=` | 200 list | |
| `GET /api/admin/standing` | sailmaker | `?season=<year>` (default: current UTC year) | 200 `{"season","items":[{"rank","owner_email","owner_name","counted","accepted","rejected","reversed","streak","standing"}]}` | |

**Photo fetch.** `GET /api/measurements/<id>/photo` answers the stored bytes exactly as uploaded, with no re-encoding and no metadata stripped. It carries these headers:

- `Content-Type`, set to the uploaded type.
- `Content-Length`.
- `ETag: "<sha256 hex of the bytes>"`.
- `X-Content-Type-Options: nosniff`.
- `Content-Disposition: inline; filename="<measurement id>.jpg"`, or `.png` for a PNG.

**Ledger footer.**

- With `stock` set, the footer shows that item's remaining length, its on-hand area and its line count. The `stock` filter, `lines` and `total` all count the lines whose `stock_code` equals the item's code.
- Without `stock`, `remaining_mm` and `remaining_in` are null, and the area covers all stock.
- `offcut_count` is always the number of offcuts with stock left, across all stock.

**Same figures on three surfaces.**

- `region "Roll remaining"` on the nesting screen and the Confirm step shows three figures:
  - the remaining length of the active hold's stock item in mm and inches (its `after_laid_mm`),
  - that item's on-hand area in m² and ft²,
  - the offcut count.
- The item's shelf card shows its `remaining_mm` and on-hand area. The ledger footer filtered to the item shows the same two figures.
- `region "Stock on hand"` shows the roll count, the offcut count and the all-stock on-hand area. The unfiltered footer shows the same all-stock area.
- After a cut on an item with no other live hold, the strip, the shelf card and the filtered footer show the same remaining length and on-hand area. The offcut count is the same on the strip, in `region "Stock on hand"` and in either footer.

**Role table.** `GET /api/admin/roles` returns exactly these rows:

| Ability | sailmaker | loft-hand | yacht-owner |
|---|---|---|---|
| `manage accounts` | `yes` | `no` | `no` |
| `record measurements` | `yes` | `no` | `no` |
| `submit measurements` | `no` | `no` | `own boats` |
| `decide submissions` | `yes` | `no` | `no` |
| `draw and issue sails` | `yes` | `no` | `no` |
| `claim, lay and cut` | `yes` | `assigned drawings with authority` | `no` |
| `manage stock and ledger` | `yes` | `no` | `no` |
| `record payments` | `yes` | `no` | `no` |
| `view cut sheets` | `yes` | `no` | `while sight is granted` |

**CSV export, byte-exact.**

- The header row is exactly `line_id,pair_id,posted_at,account,amount_mm2,stock_code,drawing_code,actor_email,reason`.
- Each line becomes one row, newest first by `posted_at`, then by `line_id` descending compared numerically. The rows are line for line the lines that walking every page of `GET /api/ledger` (with no filter) returns, in the same order.
- Lines end with a line feed only, and the file ends with exactly one line feed.
- **Formula neutralisation.** The text fields are `account`, `stock_code`, `drawing_code`, `actor_email` and `reason`. When one of them starts with `=`, `+`, `-`, `@`, a tab or a carriage return, a single `'` is put in front of it. This happens first, before quoting. `line_id`, `pair_id`, `posted_at` and `amount_mm2` are never prefixed, so a negative amount such as `-1195635` appears exactly as it is.
- **Quoting.** After neutralisation, a field is put in double quotes only when it contains a comma, a double quote or a line feed. An embedded double quote is doubled. For example, the reason `=HYPERLINK("x")` becomes the field `"'=HYPERLINK(""x"")"`.
- Numbers have no grouping. Timestamps use the API format. Empty values are empty fields.

### Business rules (DP-05, DP-11, DP-14, DP-15, DP-19 to DP-23, DP-25, DP-30 to DP-32, DP-35 to DP-38, DP-40 to DP-43, DP-45 to DP-48, DP-50, DP-51, DP-53, DP-54, DP-58, DP-66, DP-67, DP-68, DP-76, DP-80, DP-81, DP-83, DP-84, DP-85, DP-88, DP-91, DP-92, DP-94, DP-95, DP-98, DP-99)

**Codes.** New records continue each seeded sequence with the same zero padding:

| Record | Next code |
|---|---|
| Boat | `B-13` |
| Drawing | `BR-0241` |
| Roll | `R-17` |
| Offcut | `O-09` |
| Submission | `S-0123` |
| Grant | `G-0061` |
| Account | `A-10` |

- Each sequence is held in the database and shared by every instance using that database. For example, a boat created on one instance is B-13, and the next boat created on another instance sharing the database is B-14.
- Claim, measurement, pair, payment and audit ids are opaque strings.
- Ledger `line_id` is an integer. The seeded lines are 1 to 1200, and each new line takes the next integer from 1201, in the order posted. Two lines of one pair share `posted_at`, so they are ordered by `line_id` compared numerically.

**Member bounds.**

- Every bound is inclusive. Characters are counted as Unicode code points.
- A missing required member answers `Required.`. A member whose range starts at 0 characters is optional.
- A value outside its bound answers 422 on that member with the copy named here, from Feedback states.
- Bounds not listed here are stated with their rules: lot, `measured_on`, reasons, `value_mm`, `value_in`, `amount_pence` and `ends_at`.

| Member | Where | Accepted | Copy |
|---|---|---|---|
| `name`, `class_name` | boats | 1 to 60 characters | text length |
| `notes` | boats | 0 to 500 characters | text length |
| `display_name` | accounts | 1 to 80 characters | text length |
| `email` | accounts | 3 to 254 characters, with exactly one `@`, at least one character before it, and after it a domain that contains a `.` that is neither its first nor its last character | email |
| `password` | accounts | 12 to 128 characters | password |
| `seam_overlap_mm` | rule sets | whole number 0 to 100 | whole number |
| `roach_permille` | rule sets | whole number 1000 to 1300 | whole number |
| `tolerance_mm` | rule sets | whole number 1 to 100 | whole number |
| `min_offcut_width_mm` | rule sets | whole number 1 to 2000 | whole number |
| `min_offcut_length_mm` | rule sets | whole number 1 to 60000 | whole number |
| `effective_at` | `POST` and `PATCH` rule sets | an instant after the request instant | bad instant |
| `length_mm` | rolls, claims | whole number 1 to 60000 | length out of range |
| `shelf_location` | rolls, stock | 1 to 40 characters | text length |
| `note` | stock, submissions, payments | 0 to 200 characters | text length |
| `counted_length_mm` | counts | whole number 0 to 60000 | whole number |

**References in a body.**

- A body member that names another record is checked at the 422 rank, never as 404. An unknown or unsuitable reference answers 422 on that member with its field copy from Feedback states.
- This covers `boat_code`, `cloth_code`, `stock_code`, `drawing_code`, `owner_email`, `loft_hand_email` and `panel_number`, and the enumerated members `dimension`, `sail`, `role` and `decision`.
- The ladder still applies first. For example, a loft hand naming a drawing not assigned to them answers 403 `no_cutting_authority`.

**Units.**

- Lengths are stored as integer mm, areas as integer mm², and money as integer pence.
- Inches = mm ÷ 25.4, ft² = mm² ÷ 92 903.04, m² = mm² ÷ 1 000 000, and pounds = pence ÷ 100.
- Each derived figure is shown to two decimals, rounded half away from zero.
- On screens and in the cut sheet, an integer part of 1000 or more is grouped in threes with one ordinary space (`3 206`, `4 044.11`, `£1 658.82`). The API and the CSV never group.

**Owner figures in inches.** `value_in` takes one of two forms.

- **Decimal inches:** digits, optionally followed by a point and one or two digits, with a value above 0. With h the figure in hundredths of an inch, the stored mm = h × 254 ÷ 1000, rounded half away from zero in integer arithmetic. For example, `456.69` becomes 11600, `456.70` becomes 11600, `458.27` becomes 11640, and `457.50` becomes 11621.
- **Feet and inches**, the tape's other side, written as `<feet><foot mark> <inches>[ <n>/<d>]<inch mark>`:
  - Feet is a whole number from 0 to 196 and inches is a whole number from 0 to 11, both written without leading zeros.
  - The optional fraction has d equal to 2, 4, 8 or 16, with 0 < n < d, and n/d in lowest terms.
  - The parts are separated by exactly one ordinary space each.
  - The foot mark is `'` or the typographic `’`. The inch mark is `"` or the typographic `”`. Any mix of the two styles is accepted.
  - With t the total in sixteenths of an inch, the stored mm = t × 127 ÷ 80, rounded half away from zero in integer arithmetic. The total must be above 0.
  - For example:
    - `38' 0 11/16"` becomes 11600.
    - `38' 1 1/2"` and `38’ 1 1/2”` both become 11621. Floating-point arithmetic would round this one wrongly to 11620.
    - `38' 1 2/4"` is refused because the fraction is not reduced.
    - `38' 12"` is refused because inches must be 11 or less.
- Every other text in `value_in` is refused 422 with the inches field copy.
- The 1 to 60000 range check applies to the converted mm.
- `as_submitted` is set once and never changes:
  - `<value_mm> mm` for a millimetre submission,
  - `<value_in exactly as sent> in` for decimal inches (so `456.70` stays `456.70`),
  - the feet-and-inches text exactly as sent, with no suffix, keeping every character and code point, curled marks included.

**Unit-slip guard.**

- The guard applies to a sailmaker measurement and to an owner submission sent in `value_mm`, when the dimension already has a current value c. The first measurement of a dimension has no current value, so the guard does not apply to it and it is recorded as sent.
- A value v is refused 422 on `value_mm` with the inches field copy when |round(v × 25.4) − c| ≤ the `tolerance_mm` of the rule set current at the request, rounding half away from zero. The edge itself is refused.
- Figures sent in `value_in` skip the guard. A figure in inches and the same figure in millimetres store identical millimetres.
- For example, with the seed data at start and v3 current (tolerance 20):
  - B-01 P (11600) with v = 457 is refused, because round(11607.8) = 11608 and the difference 8 is no more than 20.
  - B-08 I (13950) with v = 550 is refused, because 13970 − 13950 = 20, exactly the tolerance.
  - B-01 I (12400) with v = 489 is not refused, because 12421 − 12400 = 21. It is recorded, and it flags Remeasure.
  - A newly created boat whose I is first recorded as 12400 and then sent again as v = 488 is refused, because round(12395.2) = 12395 and the difference 5 is no more than 20.

**Sail areas.** Each area is computed once on the server when its inputs change, rounded half away from zero to whole mm²:

- Foretriangle = I × J ÷ 2.
- Mainsail = P × E ÷ 2 × (roach_permille ÷ 1000) of the drawing's pinned rule set.
- Headsail = LP × LL ÷ 2.

`basis` is a string:

- Mainsail: `P × E / 2 × <roach to three decimals> · tolerance ±<t> mm · rule set v<n>`.
- Headsail: `LP × LL / 2 · tolerance ±<t> mm · rule set v<n>`.
- Foretriangle: `I × J / 2 · tolerance ±<t> mm · rule set v<n>`, using the rule set current at the request.

Every surface that shows an area (the API, the Draw step, the boat page, the cut sheet and the owner viewer) shows the same digits. For example, with the seed data at start, B-01's foretriangle is 24 180 000 mm² (24.18 m², 260.27 ft²). BR-0191 drawn under v3 has a mainsail area of 24 684 800 mm² (24.68 m², 265.70 ft²).

**Tolerance bands and Remeasure.**

- A dimension's value is its latest recorded measurement.
- When a new measurement differs from the previous one by more than the `tolerance_mm` of the rule set current when it is recorded, the dimension becomes Remeasure. A difference exactly equal to the tolerance is inside the band.
- A later measurement within the band of its predecessor returns the dimension to Measured.
- Measurements come from the sailmaker directly or from an accepted submission. Reversing a submission removes its measurement, and the status is derived again.
- A mainsail uses P and E, and a headsail uses LP and LL. Any used dimension in Remeasure blocks Draw with 409 `remeasure_required`.
- **Stepping back.** When the current value of a used dimension changes while a drawing is Drawn or Nested, that drawing returns to Measuring (or to Remeasure when the dimension is flagged). Its panels and area are discarded, and every lay on its Held claims is lifted. The claims stay Held. Drawings in Cutting or later keep the figures recorded at Draw.
- `measured_on` must lie from 2020-01-01 to 2030-12-31, both included.

**Remeasure deadline.**

- `remeasure_due` is the 5th loft working day after the flagging measurement's `measured_on`. A loft working day is Monday to Friday and not a seeded closure.
- Worked example: a measurement on Thursday 2026-12-24 is due on 2027-01-05.
  - The count skips the 25th (closure), the 26th and 27th (weekend) and the 28th (closure).
  - The 29th, 30th and 31st count as days 1 to 3.
  - January 1st is skipped (closure), and the 2nd and 3rd are a weekend.
  - The 4th and 5th count as days 4 and 5.

**Tape photographs.**

- A photo is attached to one measurement. Its object key is derived from its bytes, as given under Services.
- Its bytes must start with the signature of its declared type: JPEG starts with the bytes FF D8 FF, and PNG starts with 89 50 4E 47 0D 0A 1A 0A. Any other body under an image type, including SVG or HTML, answers 415 `unsupported_media`, and nothing is written.
- **Store confirmation.** The server writes the bytes and then reads the key back. The photo is recorded on the measurement only when the bytes read back have the uploaded length and a SHA-256 equal to the upload's. If the store fails or does not confirm, the answer is 503 `store_unavailable`, the measurement's `photo` stays null, and nothing is recorded.
- Uploading the same bytes to a measurement that already holds them answers 200 and writes no second object.
- Uploading different bytes answers 409 `photo_exists`. Nothing is written, and the stored object is unchanged.
- The stored bytes are exactly the uploaded body, with EXIF and every other byte kept.

**Rule sets.**

- The current version is the one with the latest `effective_at` at or before the request instant. This is decided on every request, with no job and no restart.
- A version whose `effective_at` is in the future may be patched (with `If-Match`). Its `effective_at` must stay in the future, otherwise the answer is 422. Once a version is current or past, it is sealed: 409 `sealed`.
- Draw pins the version current at that instant. A drawing never changes its pinned version.

**Crosscut panel construction (done by Draw).**

- `luff_mm` and `foot_mm` are P and E for a mainsail, and LL and LP for a headsail.
- Lay the sail as the right triangle with tack (0,0), clew (foot,0) and head (0,luff). The leech runs from clew to head, with length Λ = √(foot² + luff²).
- Use leech coordinates. *s* is the distance along the leech from the clew. *v* is the distance from the leech toward the tack. The tack sits at s_T = foot² ÷ Λ, v_T = foot × luff ÷ Λ.
- The sail's depth at *s* is h(s) = luff × s ÷ foot when s ≤ s_T, and foot × (Λ − s) ÷ luff otherwise.
- The panel spacing is w = the cloth's `usable_width_mm` − the pinned `seam_overlap_mm`.
- There are ⌈Λ ÷ w⌉ panels, numbered from 1 at the clew. Panel *k* spans a = (k−1)w to b = min(kw, Λ).
- Its vertices, in order, are (a,0), (b,0), (b,h(b)), then (s_T,v_T) only if a < s_T < b, then (a,h(a)).
- Each vertex maps to the panel frame as x = round(v), y = round(s − a), rounding half away from zero. Drop any vertex equal to the one before it, and drop the last vertex if it equals the first.
- `length_mm` is the largest x, and `width_mm` is the largest y. `area_mm2` is the absolute shoelace area of the rounded outline, halved and rounded half away from zero.
- Draw also records the boat name, the owner's display name and the used dimension values at that instant. These recorded values feed the cut sheet.
- Example 1, with the seed data at start: BR-0191 (the B-01 mainsail on C-07 under v3, so w = 885) has 14 panels.
  - Panel 1 has outline `[[0,0],[0,885],[2702,885]]`, length 2702, width 885 and area 1 195 635 mm².
  - Panel 14 has outline `[[0,0],[0,702],[230,0]]` and area 80 730 mm².
- Example 2: BR-0132 (the B-02 headsail on C-06 under v3, so w = 1341) has 9 panels. The first four are:

  | Panel | Outline | Length |
  |---|---|---|
  | 1 | `[[0,0],[0,1341],[3103,1341]]` | 3103 |
  | 2 | `[[0,0],[0,1341],[3525,1341],[3947,365],[3103,0]]` | 3947 |
  | 3 | `[[0,0],[0,1341],[2946,1341],[3525,0]]` | 3525 |
  | 4 | `[[0,0],[0,1341],[2366,1341],[2946,0]]` | 2946 |

- Example 3: BR-0141 (the B-01 mainsail on C-18 under v3, so w = 1341) has 10 panels.
  - Panel 1 has outline `[[0,0],[0,1341],[3559,1341],[3611,1183]]` and length 3611.
  - Panel 2 has length 3559.
  - Panel 3 has outline `[[0,0],[0,1341],[2681,1341],[3120,0]]` and area 3 889 571 mm².
  - Panel 9 has outline `[[0,0],[0,1341],[45,1341],[484,0]]` and area 354 695 mm².
  - Panel 10 has outline `[[0,0],[0,138],[45,0]]`.

**Drawing state machine.**

Legal moves:

- Measuring → Drawn by Draw, when every used dimension is Measured.
- Measuring or Drawn or Nested → Remeasure whenever a used dimension becomes Remeasure. Leaving Drawn or Nested this way discards its panels.
- Drawn or Nested → Measuring when a used dimension's current value changes inside its band (Stepping back).
- Remeasure → Measuring when every used dimension is Measured again.
- Drawn → Nested when every panel is laid on a Held claim, across any number of claims. Nested → Drawn when an undo, release or lapse leaves a panel unlaid.
- Nested → Cutting on the first confirmed cut while panels remain uncut.
- In Cutting, an undo, release or lapse that leaves an uncut panel unlaid keeps the drawing in Cutting. Claims and lays stay allowed. A lapse or release never unlays a cut panel.
- Nested or Cutting → Cut when every panel is cut.
- Cut → Pending store by Issue when the store does not confirm. Cut or Pending store → Issued when the store confirms.

Illegal moves:

- Draw outside Measuring answers 409 `wrong_state`, or `remeasure_required` from Remeasure.
- Claim or lay outside Drawn, Nested or Cutting answers 409 `wrong_state`.
- Confirming a cut answers 409 `not_nested` unless every uncut panel is laid on a Held claim and the drawing is Nested or Cutting.
- Issue before Cut answers 409 `wrong_state`. Issue on Pending store or Issued answers 409 `already_issued`.
- Revise outside Issued answers 409 `wrong_state`. Revise on a drawing that already has a successor answers 409 `already_revised`.
- Pending store and Issued are sealed: draw, assign, claim and lay answer 409 `sealed`.

**Four steps.** Each step is met when:

| Step | Met when |
|---|---|
| Measure | the status is not `remeasure` |
| Draw | the drawing has panels (Drawn or later) |
| Nest | every uncut panel is laid on a Held claim, or every panel is cut |
| Confirm | the status is `cut`, `pending_store` or `issued` |

- `step` is the first step that is not met, or `confirm` when all are met.
- A step address is reachable when every earlier step is met. Nest and Confirm show read-only content once the drawing is Cut.

**Mill lots.**

- Every stock item carries a `lot` of 1 to 20 printable characters. A roll's lot is given when it is received. An offcut takes its parent's lot.
- A drawing's `lot` is the lot of its earliest claim that is Held or Cut. It is derived on every read. It becomes null only when every claim of the drawing is Released or Lapsed and none is Cut, so a lapse unpins the lot with no job, and a Cut claim keeps it pinned.
- A claim on a stock item whose lot differs from the drawing's pinned lot answers 422 on `stock_code` with the lot-mismatch copy. When both cloth and lot differ, the cloth-mismatch copy is the one shown.
- For example, with the seed data at start: claim R-02 for BR-0132 and lay one panel. A claim on O-02 (same cloth, lot `L-2502`) for BR-0132 is then refused with the lot-mismatch copy.

**Claims.**

- A claim is for a drawing and a stock item of the drawing's cloth. A cloth mismatch is 422 on `stock_code`.
- `free_mm` = `remaining_mm` − the lengths of the item's Held claims whose deadline is still ahead.
- When `length_mm` exceeds `free_mm` and some live hold exists, the answer is 409 `claim_conflict`. It names the current display name of the holder of the most recently taken live hold, and the body adds `"winner":{"display_name","claim_id"}`. With no live hold, the answer is 422 on `length_mm`.
- A loft hand may claim only on assigned drawings, and only while holding a cutting authority in force at that instant. Otherwise the answer is 403 `no_cutting_authority`. A withdrawal takes effect on the loft hand's next request.
- Claims are checked under a lock on the stock item. Of simultaneous claims that together exceed the free length, exactly the earliest committed ones win, and every loser holds nothing. This holds across every running instance that shares the database.

**Holds and time.**

- A hold lasts `CLAIM_HOLD_SECONDS` seconds from `taken_at` (the default is 1200, which is 20 minutes). `expires_at` = `taken_at` + that.
- At and after `expires_at`, every read answers the claim as `lapsed`, with `seconds_remaining` 0 and its lays unlaid, with no job.
- Cutting, laying, undoing or releasing on a lapsed hold answers 409 `claim_lapsed`. Release, lay or undo on a cut or released hold answers 409 `claim_closed`.
- Release returns the length to free and unlays its panels.

**Laying.**

- The claim frame has x along the roll, from 0 to the claim's `length_mm`, and y across the stock's `usable_width_mm`, from 0 at the near edge.
- At 0° a panel's outline is its panel-frame outline plus (x_mm, y_mm). At 180°, each point (x,y) of the panel-frame outline first becomes (the panel's `length_mm` − x, the panel's `width_mm` − y), and then the offset is added.
- The whole outline must lie within 0 ≤ x ≤ the claim's `length_mm` and 0 ≤ y ≤ the stock's `usable_width_mm`. Otherwise the answer is 422 on `position` with the off-the-cloth field copy.
- Two outlines overlap when their interiors share an area above zero. Touching at a vertex or along an edge, including a shared slanted edge, is allowed. Overlap is decided in exact integer arithmetic. An overlap with another outline laid on the same hold answers 409 `lay_overlap`.
- A `rotation` other than 0 or 180 answers 422.
- `used_mm` is the largest x of all laid outlines on the hold, or 0 when none.
- `after_laid_mm` = `remaining_mm` − the sum of `used_mm` over the item's live Held claims.

**Automatic position (first fit with the tuck).**

- A lay with no position uses the panel's automatic position on that hold:
  1. For each rotation, 0° and then 180°, find the smallest whole-mm x ≥ 0 at which the turned outline placed at (x, 0) lies inside the claim and overlaps no outline already laid on the hold.
  2. Take the rotation with the smaller x. A tie goes to 0°.
  3. If neither rotation fits, the lay answers 422 on `position` with the off-the-cloth copy.
- This is how a cutter tucks alternate crosscut panels into each other's slant. `next_positions` publishes the same answer for every unlaid panel.
- Worked example 1, with the seed data at start: claim the whole 24 800 mm of R-02 for BR-0132, then lay panels 1 to 4 in order with no position:

  | Lay | x_mm | y_mm | rotation | used_mm after |
  |---|---|---|---|---|
  | Panel 1 | 0 | 0 | 0 | 3103 |
  | Panel 2 | 2259 | 0 | 180 | 6206 |
  | Panel 3 | 6206 | 0 | 0 | 9731 |
  | Panel 4 | 9152 | 0 | 180 | 12098 |

- Worked example 2, the last length (DP-84), with the seed data at start: claim the whole 3 200 mm of R-14 for BR-0141, then lay panels 1 to 10 in order with no position.
  - Panels 1 and 2 are longer than 3 200 mm at either turn, so they answer 422.
  - Panel 3 lands at x 0, y 0, 0°.
  - Panels 4 to 8 answer 422.
  - Panel 9 lands at x 2681, y 0, 180°, sharing panel 3's slanted edge.
  - Panel 10 answers 422.
  - Two panels sit on R-14, with `used_mm` 3165 and R-14's `after_laid_mm` at 35. The other eight need a second hold of lot `L-2614`.

**Confirm cut.**

- A cut is allowed on a Held, unexpired claim with at least one lay (otherwise 409 `claim_empty`), under the not_nested rule of the state machine.
- A loft hand needs a cutting authority in force at the claim's `taken_at`. An authority withdrawn after that instant still covers the claim. An authority whose `valid_from` is after that instant never does: 403 `no_authority_on_claim_date`. The sailmaker may always cut.
- A cut takes the claim's whole length L = `length_mm` off the stock: `remaining_mm` falls by L.
- The tail is T = L − `used_mm`. It becomes a new offcut when T ≥ the pinned `min_offcut_length_mm` and the stock's `width_mm` ≥ the pinned `min_offcut_width_mm`. Both limits are inclusive. The offcut takes the next offcut code, the same cloth and lot, the parent's `width_mm` and `usable_width_mm`, length T, and the shelf location `Offcut bin`. A shorter tail goes to waste.
- The stock gives up `width_mm` × L, posted as balanced pairs, each from the stock line:
  - one pair to `panels <drawing code>` for the sum of the laid panel areas,
  - one pair to the new offcut's code for `width_mm` × T when the offcut exists (the offcut's receipt),
  - one pair to `waste` for the rest, when that is above zero.
- The claim becomes `cut`, and its panels become `cut: true`.
- For example, cutting the R-14 hold of worked example 2 (once the drawing is Nested) posts a panels pair of 4 244 266 mm² and a waste pair of 146 134 mm². R-14 then reads 0 mm with 0 mm² on hand, and no offcut is made, because the 35 mm tail is too short.

**Confirm cut idempotency.**

- The first answer to a key on a claim is stored. That answer is a 200, or any 409 or 422 after the 403 rank.
- A replay of that key on that claim returns the same status and the byte-identical body, and writes nothing. This includes a replay that follows a session refresh, and a replay sent to another instance sharing the database. Two simultaneous calls with the same key both answer the identical stored response.
- The same key on another claim answers 409 `idempotency_key_reused`.
- A different key on a cut claim answers 409 `already_cut`. Of two simultaneous different-key cuts on one claim, exactly one answers 200.

**Ledger.**

- Every cloth movement posts one pair: two lines with the same `pair_id` and `posted_at`, whose amounts sum to zero. The stock line is positive when stock grows.
- Lines live in the table `ledger_line`. A database trigger refuses every UPDATE and DELETE on it, for every role, the app's own role included.
- The accounts are stock codes, `panels <drawing code>`, `waste`, `count-adjustment`, `supplier-receipt`, `opening-stock` and `imported-history`.
- A stock item's `on_hand_mm2` is stored. It always equals the sum of the ledger lines whose `account` is its code, and it also equals `width_mm` × `remaining_mm`.
- Receiving a roll posts a `supplier-receipt` pair with reason `Received, full roll`.
- A stock line's `account` is the stock code. The `stock` filter, the footer's `lines` and the list `total` match on `stock_code`, never on `account`. Every line's `actor_email` is the acting account's email.

Each pair type lays out its two lines as follows:

- **Receipt of a roll** (and seed pairs 1 to 16): the stock line is positive, `width_mm` × length. The counter line has account `supplier-receipt` and is negative. Both carry the roll code as `stock_code`.
- **Opening count and imported cut:** as in Seed data. Both lines carry the item's code as `stock_code`.
- **Cut, panels:** the stock line is negative, the sum of the laid panel areas. The counter line has account `panels <drawing code>` and is positive. Both carry the claim's stock code and the drawing code, with reason `Panels cut`.
- **Cut, waste** (when above zero): the stock line is negative. The counter line has account `waste` and is positive. Both carry the claim's stock code and the drawing code, with reason `Waste`.
- **Cut, offcut receipt** (when an offcut is created):
  - The stock line is on the claim's stock item, negative, `width_mm` × T, with the claim's stock code as `stock_code`.
  - The counter line has the new offcut's code as its account, is positive, and carries the new offcut's code as `stock_code`.
  - This is the one pair whose two lines carry different `stock_code` values. Both lines carry the drawing code, with reason `Offcut received`.
  - Filtering to the new offcut therefore shows exactly that one line, and the offcut's on-hand equals that line.
- **Shelf count adjustment:** the stock line is `width_mm` × (counted − remaining), positive when the count is higher. The counter line has account `count-adjustment` and the opposite amount. Both carry the item's code, with the reason given.

**Shelf count.**

- When `counted_length_mm` equals `remaining_mm`, the count is recorded and nothing is posted.
- Otherwise a `reason` of 1 to 200 characters is required (422). A `count-adjustment` pair of `width_mm` × (counted − remaining) is posted with that reason, and `remaining_mm` becomes the count.
- Counting while the item has a live hold answers 409 `wrong_state`.

**Totals.**

- `total`, every footer, the stock summary and the reconciliation are computed over every row, never over a page.
- Reconciliation answers:
  - `ledger_sum_mm2`: the sum of all lines, which is always 0.
  - `stored_on_hand_mm2`: the sum of stored on-hand over all stock.
  - `ledger_on_hand_mm2`: the sum of the stock-account lines.
  - `difference_mm2`: always 0, both overall and per item.

**Issuing.**

- Issue renders the cut sheet. It then reads the content-addressed key from the store and compares the bytes:
  - When the bytes read back have exactly the rendered length and a SHA-256, computed over the returned bytes, equal to the render's, the store has confirmed.
  - When the key is missing or holds other bytes, Issue writes the render to that key once and then reads it back and compares again.
  - The object's `sha256` metadata never confirms anything on its own, so a planted object with the right metadata but the wrong bytes is overwritten.
- When the store confirms, the drawing becomes `issued` (200). If the store does not answer or does not confirm, the drawing becomes `pending_store` (202), with the issuing outage copy.
- Every running instance retries every `pending_store` drawing at least every 5 seconds, using the same procedure. A drawing becomes `issued` by itself within 30 seconds of the store answering, with no restart. The key always holds exactly one object.
- An open overview shows the change as described under Live updates in place in Interactions.
- Of two simultaneous issues of one drawing, exactly one proceeds and the other answers 409 `already_issued`.

**Cut sheet document.**

- The cut sheet is an SVG of the drawing, rendered only from values recorded at Draw and from the nest of each Cut claim. Those values are the boat name and owner's display name as recorded at Draw, the used dimensions, the cloth, the pinned rule set and the panels. The sheet contains no clock-dependent value and no money.
- The same drawing always renders the same bytes. Renaming a boat or an account later changes the drawing's live `boat_name` and every live surface, but never the rendered sheet. So the preview of an issued drawing equals its stored object byte for byte, before and after a rename. A successor drawn after the rename renders the new name.
- The sailmaker's fetch and the owner's fetch of one sheet answer the same bytes.
- Its `<title>` is `Cut sheet <drawing code>`. It carries one text line for each item below, in this order:
  - `Cut sheet <drawing code> · <boat name> · <Mainsail or Headsail> · <owner display name>`
  - `Cloth <cloth code> <cloth name> · usable width <mm> mm (<in> in) · catalogue width, tolerance ±<t> mm · rule set v<n>`
  - one line per used dimension: `<key> <mm> mm (<in> in) · tape, tolerance ±<t> mm · rule set v<n>`
  - `Sail area <m²> m² (<ft²> ft²) · <formula as in basis> · tolerance ±<t> mm · rule set v<n>`
  - one line per panel: `Panel <k> · <length mm> mm (<in> in) × <width mm> mm (<in> in) · <m²> m² (<ft²> ft²) · crosscut perpendicular to leech, seam overlap <o> mm · tolerance ±<t> mm · rule set v<n>`
  - one line per Cut claim, followed by its panel outlines: `Nest on <stock code> · <used mm> mm (<in> in) of <width mm> mm (<in> in) cloth · thread along the roll · lot <lot> · tolerance ±<t> mm · rule set v<n>`
  - when the drawing has a predecessor: `Supersedes <drawing code>`
- `<t>` and `<o>` come from the pinned rule set.

**Revisions.**

- Revise creates the next drawing code with the same boat, sail and cloth, in Measuring, with `predecessor` set and no lot.
- When the successor becomes Issued, the predecessor's `cut_sheet.superseded_by` names it. The predecessor's object is never deleted or changed.
- Fetching a superseded sheet answers its unchanged bytes with the header `Boltrope-Superseded-By: <code>`. A successor's sheet carries `Boltrope-Supersedes: <code>`.

**Sail account.**

- A drawing in Cut, Pending store or Issued has a sail account:
  - `charge_pence` = round(area_mm2 × `rate_pence_per_m2` of its cloth ÷ 1 000 000).
  - `tax_rate_percent` is 20, and `tax_pence` = round(charge_pence × 20 ÷ 100).
  - `total_pence` = charge + tax.
  - `deposit_pence` = round(total_pence × 40 ÷ 100).
  - `paid_pence` is the sum of payments, and `credited_pence` is the sum of credit notes.
  - `balance_pence` = total − paid − credited. Paid, credited and balance always sum to the total, and the balance is never below 0.
- Every rounding is half away from zero, in integer arithmetic, and the figures are stored as integer pence.
- `status`:
  - `deposit_due` while paid + credited is below the deposit,
  - `settled` when the balance is 0,
  - otherwise `balance_due`.
- Worked example, with the seed data at start: BR-0071 (the B-01 mainsail on C-07, area 24 684 800 mm², rate 5600) has:

  | Figure | Pence | Shown as |
  |---|---|---|
  | Charge | 138 235 (from 138 234.88) | £1 382.35 |
  | Tax | 27 647 | £276.47 |
  | Total | 165 882 | £1 658.82 |
  | Deposit | 66 353 (from 66 352.8) | £663.53 |

  After a 66 353 payment the balance is 99 529 pence (£995.29) and the status is `balance_due`.
- A payment or credit note of `amount_pence` (a whole number of at least 1) above the balance at its commit answers 409 `exceeds_balance`, and nothing is written.
- Payments and credit notes are applied under a lock on the drawing's account. For example, after the deposit above, two payments of 60 000 fired together give one 201 and one 409.
- **Payment idempotency.** A payment's `Idempotency-Key` stores its first answer. A replay with the same key and body returns the same status and the byte-identical body, and writes nothing. The same key with another drawing or another amount answers 409 `idempotency_key_reused`.
- Credit notes need a `reason` of 1 to 200 characters.

**Sight.**

- A grant goes to one owner for one Issued drawing, at its own address `/api/grants/<id>/cut-sheet`.
- Withdrawal is final for that grant. Granting again creates a new id, and the old address never works again.
- The server treats a grant as withdrawn from its `ends_at` instant on. `ends_at` must be in the future, otherwise 422.
- Every request checks the grant afresh. A withdrawn or ended grant's addresses, its drawing, its sail account and its sheet answer 404 `not_found` to that owner. Other grants are untouched.
- Every instance sharing the database answers the same grant with the byte-identical JSON body.

**Owner limit.**

- Per owner account, within any window of `OWNER_RATE_WINDOW_SECONDS` seconds (default 3600), the server allows at most `OWNER_SUBMISSION_LIMIT` successful submissions (default 10) and at most `OWNER_SHEET_FETCH_LIMIT` successful cut-sheet fetches (default 30).
- The counts are kept in the database, so they are shared by every instance using it.
- The next request answers 429 `rate_limited` with `Retry-After` in whole seconds. That value is the time until the oldest counted request leaves the window, rounded up, and at least 1.
- A refused request, whatever its status, writes nothing and is not counted.
- Counts are per account, never per address or network address, so a second owner is unaffected.

**Submissions and decisions.**

- Accept turns a pending submission into a measurement, which may raise Remeasure. Reject needs a `reason`. Deciding a submission that is not pending answers 409 `already_decided`.
- Of two simultaneous decisions on one submission, including a bulk item racing a single decision, exactly one applies.
- The bulk path applies each item independently, in submitted order, and never rolls back the others:
  - Unknown ids give `not_found`.
  - Decided ones give `already_decided`.
  - A reject with no reason gives `reason_required`.
  - A `decision` other than `accept` or `reject` gives `invalid_decision`.
- The pending `total` falls by exactly the number of applied items.
- Reverse turns an accepted submission into `reversed` (a reason is required) and removes its measurement. It leaves `decided_at` and `decided_by` unchanged and replaces `reason` with the reversal reason. A reversed submission therefore keeps its place in the streak order.
- Every reason is 1 to 200 characters.

**Tape standing (derived on every request, never stored).**

- Each answer is computed from one consistent snapshot of the submissions. A reversal committed while a standing request runs is reflected either completely or not at all.
- For each owner with at least one submission in the season (the UTC calendar year of `submitted_at`):
  - `counted`: every submission.
  - `accepted`: accepted and not reversed.
  - `rejected` and `reversed`: their counts.
  - `streak`: the run of consecutive decided submissions ending at the newest, ordered by `decided_at` and then id. Accepted and reversed both count toward it. A rejection ends the run, and pending submissions are skipped.
- Rank by `accepted`, descending. Break ties by the earliest `decided_at` among the owner's accepted, non-reversed submissions, then by email ascending.
- `standing` is:
  - `True tape` when accepted ≥ 15 and streak ≥ 10,
  - otherwise `Steady tape` when accepted ≥ 10,
  - otherwise `New tape`.
- `owner_name` is the owner's current display name.

**Names.** Every surface that shows a person's name reads the account's current display name on each request:

- standing `owner_name`,
- `submitted_by`,
- `Boat.owner`,
- `Grant.owner`,
- `assigned_to`,
- `holder`,
- the `Owner` and `Loft hand` comboboxes,
- the `claim_conflict` winner copy.

The one exception is the cut sheet, as described above. A rename writes `account.rename`, with `before` and `after` holding the old and new display names.

Wherever a deleted account's name would show, every one of these surfaces shows the deleted-account name from Feedback states as `display_name`, and the stored email stays as it is. `Boat.owner` never shows it, because an account that owns boats cannot be deleted. The standing keeps a deleted owner's row, ranked as before, with the email tie-break using the stored email.

**Audit.**

- Every state change made by a request writes one audit row in the same transaction as the change. If either fails, neither is stored.
- The rows live in the table `audit_trail`. A database trigger refuses every UPDATE and DELETE on it, for every role.
- `actor_email` comes from the stored account of the bearer, including a loft hand's claim actions.
- Each row carries the target id or code, the `before` and `after` status (or name, for a rename, or null), and the reason.
- `action` is one of:
  - accounts: `account.create`, `account.delete`, `account.rename`, `account.role_change_refused`
  - boats and measurements: `boat.create`, `boat.update`, `measurement.record`, `photo.attach`
  - submissions: `submission.create`, `submission.accept`, `submission.reject`, `submission.reverse`
  - rule sets: `ruleset.create`, `ruleset.update`
  - drawings: `drawing.create`, `drawing.draw`, `drawing.assign`, `drawing.issue`, `drawing.revise`
  - claims: `claim.take`, `claim.lay`, `claim.unlay`, `claim.release`, `claim.cut`
  - stock: `stock.receive`, `stock.update`, `stock.count`
  - grants and authorities: `grant.create`, `grant.withdraw`, `authority.create`, `authority.withdraw`
  - money: `payment.record`, `credit_note.record`
- A bulk decision writes one row per applied item, with the same actor as the single path.
- A refused role change writes `account.role_change_refused`, with `before` and `after` both set to the unchanged role.
- An Issue request writes one `drawing.issue` row whether it answers 200 or 202.
- Three things write no row, because nobody requests them: lapses, the automatic Pending store → Issued step, and seeding.

**Accounts.**

- Emails are stored and compared after Unicode NFC normalisation and lower-casing. For example, `Maren@Owners.example` is the same email as `maren@owners.example`, and an `e` followed by a combining acute accent is the same as `é`.
- Creating an account whose normalised email is already stored answers 409 `email_taken`. Of two simultaneous creates of one email, exactly one answers 201, and the realm holds one user.
- Creating an account creates the Keycloak user (username and email set to the normalised email, enabled, with a permanent password) and assigns the realm role named by `role`. When the realm already holds a user with that email, the account links to that user and sets the given password and role.
- A stored account is linked to its Keycloak user by that user's id. Seeding finds an existing user by email before creating one.
- No action changes an existing account's role or moves a boat to another owner.
- Deleting an account marks it deleted and deletes its Keycloak user. Its tokens answer 401 from its next request on, and it is never re-created.
- A deleted account's email stays taken. Creating an account with the same normalised email answers 409 `email_taken`, and no Keycloak user is created.
- Every record a deleted account touched stays stored, under the name rule in Names: its submissions, grants, claims, assignments, authorities, ledger lines and audit rows.
  - Its grants stay as they are, and nobody can use them.
  - Its live holds lapse at their deadline as usual.
  - Drawings assigned to it stay assigned until the sailmaker assigns another loft hand.
- Deleted accounts are absent from `GET /api/accounts` and from the `Owner` and `Loft hand` comboboxes. Naming one in `owner_email` or `loft_hand_email` answers 422 with that member's field copy. `DELETE` on an already deleted account answers 404 `not_found`.

**Twin boot.**

- Several instances may start at the same moment on one empty database and bucket. They apply the schema and the seed exactly once between them, and all of them become healthy within 60 seconds.
- Every instance then serves the identical seeded loft. The bucket holds exactly 70 objects under `cut-sheets/`, and the realm holds one user per seeded email.

### Services (DP-10, DP-16, DP-45 to DP-47, DP-65, DP-68, DP-88, DP-91)

- **Postgres** is the system of record. It holds accounts, boats, dimensions and measurements, submissions, rule sets, cloths, closures, drawings and panels, stock and lots, claims, authorities, grants, sail accounts and their entries, the ledger (`ledger_line`), rate-limit counts, idempotency records, code sequences and the audit trail (`audit_trail`).
  - Row locks and uniqueness rules decide concurrent claims, cuts, decisions, payments and account creations.
  - A database-wide lock taken on start makes the schema and seed apply exactly once, idempotently, on every serve.
- **Keycloak** holds realm `KEYCLOAK_REALM` at `KEYCLOAK_URL`.
  - On serve, the app ensures the realm roles `sailmaker`, `loft-hand` and `yacht-owner` exist, and that every seeded account that is not deleted exists as a user with its role and seeded password.
  - It checks this again at least every 15 seconds and re-creates any missing user of a stored, non-deleted seeded account.
  - Sign-in uses the password grant of client `AUTH_CLIENT_ID`. The browser never talks to Keycloak.
  - When Keycloak does not answer, sign-in and token checks answer 503 `identity_unavailable`.
- **MinIO** holds bucket `S3_BUCKET`.
  - Cut sheets are stored at `cut-sheets/<drawing code>/<sha256 of the SVG bytes>.svg`, with content type `image/svg+xml` and user metadata `sha256` set to the hex digest.
  - Tape photos are stored at `tape-photos/<boat code>/<measurement id>/<sha256 of the bytes>.jpg` or `.png`, with the uploaded content type and user metadata `sha256`.
  - The browser never receives a store address. The server streams every object after checking access.
  - When the store does not answer, issuing behaves as described in Business rules, and photo upload and every sheet or photo fetch answer 503 `store_unavailable`. Nothing else is affected, and health stays 200.

### Seed data (DP-13, DP-15, DP-17, DP-22, DP-41, DP-42, DP-58, DP-66, DP-84, DP-88, DP-98)

Every seeded person, boat, boat class, mill lot, price and business is invented. Seeding happens on serve, exactly once per database.

**Accounts.**

| Id | Display name | Email | Role | Password |
|---|---|---|---|---|
| A-01 | Morwenna Teague | `morwenna@tabling.example` | sailmaker | `Loft-Bench-2026!` |
| A-02 | Jory Pascoe | `jory@tabling.example` | loft-hand | `Cutting-Floor-26!` |
| A-03 | Kit Rowe | `kit@tabling.example` | loft-hand | `Cutting-Floor-26!` |
| A-04 | Maren Holt | `maren@owners.example` | yacht-owner | `Tape-Measure-26!` |
| A-05 | Tobias Wren | `tobias@owners.example` | yacht-owner | `Tape-Measure-26!` |
| A-06 | Ines Calder | `ines@owners.example` | yacht-owner | `Tape-Measure-26!` |
| A-07 | Rafe Okonkwo | `rafe@owners.example` | yacht-owner | `Tape-Measure-26!` |
| A-08 | Saoirse Lindqvist | `saoirse@owners.example` | yacht-owner | `Tape-Measure-26!` |
| A-09 | Priya Marlow | `priya@owners.example` | yacht-owner | `Tape-Measure-26!` |

**Cutting authorities.**

- Jory Pascoe: from 2026-01-01T00:00:00Z, with no end.
- Kit Rowe: from 2026-01-01T00:00:00Z until 2026-06-30T00:00:00Z.

**Rule sets** (all at revision 1):

| v | effective_at | overlap | roach | tolerance | min offcut width | min offcut length |
|---|---|---|---|---|---|---|
| 1 | 2024-01-01T00:00:00Z | 20 | 1080 | 25 | 300 | 500 |
| 2 | 2025-01-01T00:00:00Z | 18 | 1100 | 20 | 300 | 600 |
| 3 | 2026-01-01T00:00:00Z | 15 | 1120 | 20 | 250 | 600 |
| 4 | 2027-03-01T00:00:00Z | 15 | 1150 | 15 | 250 | 500 |

**Cloths (24 rows).**

- For k = 1 to 12, the weight is 3.8, 4.4, 5.0, 5.6, 6.2, 6.8, 7.4, 8.0, 8.6, 9.2, 9.8 and 10.4 oz in turn.
- Code `C-<2k−1>` (two digits) is that weight at width 914, usable 900. Code `C-<2k>` is that weight at width 1372, usable 1356.
- Both codes of weight k cost `rate_pence_per_m2` = 4400 + 400 × (k − 1).
- Each name is `Cruising crosscut <weight> oz`, and `weight` is `<weight> oz`.
- For example:
  - C-06 is `Cruising crosscut 5.0 oz` at 1372 mm wide, at 5200.
  - C-07 is `Cruising crosscut 5.6 oz` at 914 mm wide, at 5600.
  - C-18 is `Cruising crosscut 8.6 oz` at 1372 mm wide, at 7600.

**Loft closures (12 rows):** 2026-01-01, 2026-04-03, 2026-04-06, 2026-05-04, 2026-05-25, 2026-08-31, 2026-12-25, 2026-12-28, 2027-01-01, 2027-03-26, 2027-03-29, 2027-05-03.

**Boats** (all at revision 1). Each dimension has one sailmaker measurement of the listed value on 2026-01-15, except where noted.

| Code | Name | Class | Owner | I | J | P | E | LL | LP |
|---|---|---|---|---|---|---|---|---|---|
| B-01 | Kittiwake | Halyard 32 | Maren | 12400 | 3900 | 11600 | 3800 | 12200 | 5400 |
| B-02 | Skerry Light | Seabrook 27 | Maren | 10200 | 3150 | 9400 | 3200 | 9950 | 4300 |
| B-03 | Morwen | Halyard 32 | Tobias | 12380 | 3900 | 11640 | 3780 | 12180 | 5400 |
| B-04 | Tide Clerk | Tamar 36 | Tobias | 13900 | 4300 | 13100 | 4400 | 13650 | 6000 |
| B-05 | Shearwater | Penwith 30 | Ines | 11300 | 3600 | 10600 | 3500 | 11050 | 4900 |
| B-06 | Gull Reach | Lowen 34 | Ines | 13100 | 4100 | 12300 | 4100 | 12850 | 5700 |
| B-07 | Fairlead | Carrick 29 | Rafe | 10900 | 3400 | 10100 | 3400 | 10650 | 4700 |
| B-08 | Quiet Hour | Tamar 36 | Rafe | 13950 | 4300 | 13080 | 4420 | 13700 | 6000 |
| B-09 | Pellow | Seabrook 27 | Saoirse | 10180 | 3150 | 9420 | 3200 | 9930 | 4300 |
| B-10 | Lantic | Penwith 30 | Saoirse | 11320 | 3600 | 10580 | 3500 | 11070 | 4900 |
| B-11 | Wherry Ann | Lowen 34 | Priya | 13120 | 4100 | 12300 | 4100 | 12870 | 5700 |
| B-12 | Small Hours | Carrick 29 | Priya | 10880 | 3400 | 10120 | 3400 | 10630 | 4700 |

- B-11 P has a second measurement of 12345 on 2026-10-29, so it is Remeasure, due 2026-11-05.
- B-12 P has a second measurement of 10080 on 2026-10-30, so it is Remeasure, due 2026-11-06.
- Every accepted, non-reversed seeded submission also appears as a measurement with `source` `submission`, equal to the current value.
- No seeded measurement has a photo.

**Rolls (16).**

- Roll R-<ii> (two digits, i = 1 to 16) has cloth C-<i+4> and lot `L-26<ii>`. For example, R-02 is lot `L-2602` and R-14 is lot `L-2614`.
- Each roll was received at 50000 mm.
- The shelf location is `Rack A` for R-01 to R-08 and `Rack B` for R-09 to R-16.

| Roll | Cloth | Width | Usable | Remaining mm | On hand mm² |
|---|---|---|---|---|---|
| R-01 | C-05 | 914 | 900 | 28400 | 25957600 |
| R-02 | C-06 | 1372 | 1356 | 24800 | 34025600 |
| R-03 | C-07 | 914 | 900 | 21200 | 19376800 |
| R-04 | C-08 | 1372 | 1356 | 17600 | 24147200 |
| R-05 | C-09 | 914 | 900 | 14000 | 12796000 |
| R-06 | C-10 | 1372 | 1356 | 32000 | 43904000 |
| R-07 | C-11 | 914 | 900 | 35600 | 32538400 |
| R-08 | C-12 | 1372 | 1356 | 10400 | 14268800 |
| R-09 | C-13 | 914 | 900 | 39200 | 35828800 |
| R-10 | C-14 | 1372 | 1356 | 6800 | 9329600 |
| R-11 | C-15 | 914 | 900 | 26600 | 24312400 |
| R-12 | C-16 | 1372 | 1356 | 23000 | 31556000 |
| R-13 | C-17 | 914 | 900 | 19400 | 17731600 |
| R-14 | C-18 | 1372 | 1356 | 3200 | 4390400 |
| R-15 | C-19 | 914 | 900 | 15800 | 14441200 |
| R-16 | C-20 | 1372 | 1356 | 12200 | 16738400 |

**Offcuts (8).** All are at shelf location `Offcut bin`. Offcut O-<ii> has lot `L-25<ii>`; for example, O-02 is lot `L-2502`.

| Offcut | Cloth | Width | Usable | Length | On hand mm² |
|---|---|---|---|---|---|
| O-01 | C-05 | 914 | 900 | 1800 | 1645200 |
| O-02 | C-06 | 1372 | 1356 | 2400 | 3292800 |
| O-03 | C-07 | 914 | 900 | 900 | 822600 |
| O-04 | C-08 | 1372 | 1356 | 1500 | 2058000 |
| O-05 | C-05 | 600 | 600 | 2000 | 1200000 |
| O-06 | C-09 | 914 | 900 | 3000 | 2742000 |
| O-07 | C-10 | 1372 | 1356 | 700 | 960400 |
| O-08 | C-12 | 1372 | 1356 | 1200 | 1646400 |

All stock is at revision 1. At start, the stock summary is 16 rolls, 8 offcuts and 375710200 mm² (375.71 m², 4 044.11 ft²).

**Ledger (1200 lines, 600 pairs).**

- Pair *p* is posted at 2026-03-02T08:00:00Z plus (p − 1) × 4 hours. Its stock line has `line_id` 2p − 1, and its counter line has `line_id` 2p. Both lines carry the pair's `stock_code`, an empty `drawing_code`, and `actor_email` `morwenna@tabling.example`.
- Pairs 1 to 16 are receipts for R-01 to R-16: account `supplier-receipt`, amount width × 50000, reason `Received, full roll`.
- Pairs 17 to 24 are opening counts for O-01 to O-08: account `opening-stock`, amount the on-hand area, reason `Opening count`.
- Pairs 25 to 600 are imported cuts. Pair 25 + j (j = 0 to 575) belongs to roll R-<(j mod 16) + 1>. Its stock line is −(width × c), and its `imported-history` line is the opposite amount, with reason `Imported from spreadsheet`. Each roll has 36 imported cuts, where c is the roll's (50000 − remaining) ÷ 36.

**Drawings (240).**

- BR-0001 to BR-0230 are on boat B-<((n − 1) mod 10) + 1>, where n is the drawing number. An odd n is a mainsail on C-07, and an even n is a headsail on C-06.
- BR-0231 to BR-0240 are mainsails on C-07: BR-0231 to BR-0235 on B-11, and BR-0236 to BR-0240 on B-12.
- Status by number:

| Drawings | Status | Pinned rule set |
|---|---|---|
| BR-0001 to BR-0060 | issued | v2 for BR-0001 to BR-0030, v3 after |
| BR-0061 to BR-0070 | pending_store | v3 |
| BR-0071 to BR-0130 | cut | v3 |
| BR-0131 to BR-0190 | drawn | v3 |
| BR-0191 to BR-0230 | measuring | none |
| BR-0231 to BR-0240 | remeasure | none |

- Every seeded drawing from Drawn on records the boat name, owner name and used dimensions of the seed as its Draw values.
- Every seeded Issued and Pending store drawing carries a `cut_sheet` (`sha256`, `size`, `key`) rendered by the same renderer as a live issue, from the drawing's own record.
- With the store reachable at first serve, the object of each of those 70 drawings is written and confirmed under its key at seed, and the sixty Issued drawings are Issued at once. Within 30 seconds of that first serve, the ten Pending store drawings become Issued. After startup, a test sees 0 pending_store and 70 issued.
- With the store unreachable at first serve, all 70 start as Pending store. Each becomes Issued by itself, within 30 seconds of the store answering, once its object is written and confirmed. Meanwhile an owner's sheet fetch on their grant answers 503 `store_unavailable`, and the open drawing shows the outage copy.
- Issued, Pending store and Cut drawings were imported. Each has one Cut claim, on R-03 for mainsails (lot `L-2603`) or R-02 for headsails (lot `L-2602`). Its panels were laid at their automatic positions, in panel order, on a 50000 mm claim, and the claim's `length_mm` is then its `used_mm`. These claims carry no ledger lines of their own, and they have no payments or credit notes.
- BR-0131 to BR-0150 are assigned to Jory Pascoe.
- BR-0141 to BR-0150 are on cloth C-18 instead of the cloth the rule above gives. C-18 has usable width 1356 mm, the same as C-06, so roll R-14 can be claimed on them. For example, BR-0141 is a mainsail on B-01 and can claim R-14's 3 200 mm.
- BR-0132 is a headsail on C-06 for B-02. It can be nested whole on R-02.

**Sight grants.** G-0001 to G-0060 cover BR-0001 to BR-0060, one each, granted to the boat's owner at 2026-07-01T09:00:00Z with no end. G-0010 was withdrawn at 2026-08-01T09:00:00Z.

**Submissions (122).**

- They are numbered S-0001 upward, owner by owner in the order Maren, Tobias, Ines, Rafe, Saoirse, Priya. Within each owner they follow sequence number *k*, starting at 1.
- Submission *k* of owner *o* (Maren = 1 … Priya = 6) is submitted at 2026-02-02T09:00:00Z plus (k − 1) days plus (o − 1) hours. It is decided 2 hours later.
- Its boat is the owner's first boat (B-01, B-03, B-05, B-07, B-09, B-11).
- Its dimension cycles I, J, P, E (for Priya: I, J, E). Its `value_mm` equals that dimension's current value, its `as_submitted` is `<value_mm> mm`, and its `measured_on` is the submission date.
- In each owner's sequence string, A = accepted, R = rejected with reason `Figure taken to the wrong mark`, V = accepted then reversed with reason `Tape slipped on the black band`, and P = pending:

| Owner | Sequence | counted | accepted | rejected | reversed | streak | standing | rank |
|---|---|---|---|---|---|---|---|---|
| Maren Holt | A×5 R A×15 V A×2 P×3 | 27 | 22 | 1 | 1 | 18 | True tape | 1 |
| Tobias Wren | A×8 R A×4 R A×6 P×3 | 23 | 18 | 2 | 0 | 6 | Steady tape | 3 |
| Ines Calder | A×12 V V A×4 R A×3 P×2 | 24 | 19 | 1 | 2 | 3 | Steady tape | 2 |
| Rafe Okonkwo | R A×18 P×2 | 21 | 18 | 1 | 0 | 18 | True tape | 4 |
| Saoirse Lindqvist | A×5 R R A×7 P×2 | 16 | 12 | 2 | 0 | 7 | Steady tape | 5 |
| Priya Marlow | A×3 V A×4 P×3 | 11 | 7 | 0 | 1 | 8 | New tape | 6 |

- The 15 pending submissions are S-0025 to S-0027, S-0048 to S-0050, S-0073 to S-0074, S-0094 to S-0095, S-0110 to S-0111 and S-0120 to S-0122.
- Every decided seeded submission, reversed ones included, has `decided_by` `morwenna@tabling.example` and keeps the `decided_at` given above. A reversed one carries the reversal reason as its `reason`. Pending ones carry null `decided_at`, `decided_by` and `reason`.
- The audit trail starts empty.

## Technical requirements

### Deployment (DP-01, DP-88)

**Runtime.** TypeScript on Node.js 22 LTS with npm.

**Run manifest.** `/app/run.json` holds string commands and the schema tag. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

**Port.** The server binds `0.0.0.0` on port 4173. When `APP_PUBLIC_PORT` is set, it uses that port instead.

**Health.** `GET /api/health` answers 200 `{"status":"ok"}` when Postgres and Keycloak answer.

**Several instances.** Several instances of the same build may run at once with different environments. They may share one database and bucket, or each use its own empty database and bucket, which the app fills with schema and seed on serve. Every rule in this brief holds across instances that share a database, including when they start at the same moment.

### Configuration and secrets (DP-02, DP-65)

The server reads all of these at start:

- Postgres: `DATABASE_URL`.
- Keycloak: `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. The bucket is created when it is missing.
- Product settings, with the defaults given in Business rules: `CLAIM_HOLD_SECONDS`, `OWNER_SUBMISSION_LIMIT`, `OWNER_SHEET_FETCH_LIMIT`, `OWNER_RATE_WINDOW_SECONDS`.

No credential is hard-coded or sent to the browser.

### Server boundary (DP-02, DP-03, DP-06, DP-09, DP-69, DP-89, DP-90)

**Origin.** Same-origin only. The server sends no cross-origin allowance headers.

**Session cookie.** `boltrope_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`.

**Caching.** Every API response and every HTML page carries `Cache-Control: private, no-store`. That includes every 404, every refusal and every photo and cut-sheet fetch. Only the app's own fonts and scripts may be cached. Nothing that depends on the caller is kept in server memory between requests.

**Body limits.**

- JSON bodies may be up to 65536 bytes. 65536 is allowed, and 65537 answers 413.
- Photos may be up to 5000000 bytes, with the same inclusive rule: 5000000 is allowed and 5000001 answers 413.
- A JSON address given another content type answers 415. A photo that is not `image/jpeg` or `image/png`, or whose bytes do not carry that type's signature, answers 415.

**Content security policy.** Every HTML response carries a `Content-Security-Policy` header. It allows scripts only from the app's own origin, with no inline script, no inline event handlers and no eval. No page uses an inline script or handler.

**What the server never serves.**

- Source files, `run.json`, `package.json`, lockfiles, environment files and source maps: a request for any of them answers the not-found page.
- No HTML, script, attribute or map contains `DATABASE_URL`, `AUTH_CLIENT_SECRET`, `S3_SECRET_ACCESS_KEY`, a bearer token or a seeded password.
- No response, HTML or API, carries `X-Powered-By`.

**Dependencies at boot.** When Postgres or Keycloak does not answer at boot, the server still starts and keeps retrying.

- With Postgres down, health and every address answer 503: health with `{"status":"unavailable","dependency":"database"}`, and every other address with `database_unavailable`.
- With Keycloak down, health answers 503 `{"status":"unavailable","dependency":"identity"}`, and sign-in and authenticated calls answer `identity_unavailable`.
- Within 30 seconds of the dependency returning, everything recovers with no restart: the schema and seed are applied, and missing seeded Keycloak users are re-created. A failure is never cached.

### Browser support and performance (DP-61)

- Current Chromium, Firefox and WebKit, at every width from 320 px up, checked at 375×812, 768×1024 and 1280×800 and at the edge widths. Touch is used on the two smaller sizes.
- Fonts are self-hosted.
- Each screen is usable within three seconds on a local connection.
- Every list address, a ledger page included, answers within one second with the full seed loaded.

## Working rules

- IF-01: `/app/run.json` exists with `_schema` `run-manifest-v1` and string `install`, `build` and `serve` members, and nothing else is needed to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and both font families, each with its licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and font carries one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1.
- IF-04: The app stores data only in the provided Postgres, Keycloak and MinIO, and uses no other database, cache, queue or file-based store.
- IF-05: The provided service configuration and dev compose files stay unchanged.
- IF-06: Server and browser source is TypeScript with strict type checking on, and the build runs the type check.
- IF-07: Fonts and scripts are served from the app itself, and no page loads anything from another origin.

## Engineering standards

- The TypeScript is idiomatic: strict types, no `any` in domain code, async/await throughout, and no unhandled promise.
- Names in the code match this brief's domain terms: drawing, panel, claim, hold, lay, tuck, cut, tail, offcut, lot, ledger pair, shelf count, sight grant, rule set, Remeasure, step, cutting authority, sail account, owner projection.
- Each domain rule is decided in exactly one place, and a second copy anywhere is a defect. This covers:
  - unit conversion and rounding, the inch and feet-and-inches conversion, and the unit-slip guard
  - the area formulae and the panel construction
  - the first-fit search and the overlap test
  - the drawing transitions and the step derivation
  - the lot pin and the free-length rule
  - the refusal ladder and the owner projection
  - the ledger pairing, the totals, pagination and cursor binding
  - CSV neutralisation
  - the cut-sheet render and the store confirmation
  - the sail account figures
  - the tape standing
- Money, lengths and areas are integers throughout the server. No floating-point value is stored or used to round a published figure.
- There is no abstraction with a single implementation.
- There is no dead, commented-out or unreachable code, no unused export, and no defensive check for a state this brief makes impossible.
- Every refusal uses the one published error shape, and each published copy string lives in exactly one place in the source.
- The browser has one request path that adds the bearer token and handles the session refresh, and every write goes through it.
- The code has no features beyond this brief.
