# Bellwake Games Squallglass

Build Squallglass, a browser lane-defence strategy game for harbour players, challenge makers and community competitors. In the fictional harbour of Orrel Sound, players defend piers, compare possible placements, earn verified campaign achievements and publish challenges backed by winning demonstrations. Use PostgreSQL for accounts, sessions, authoritative records and shared replay presentation; MinIO for immutable definitions and command evidence; and Meilisearch for published-challenge discovery. Include accounts. Exclude payments, multiplayer combat, chat, moderation, executable custom scripts, external statistics integrations and additional persistent services.

## Problem and users

Players invest evenings learning encounters and comparing strategies. Suspicious results create disputes and support appeals. Makers repeatedly test whether their challenges are beatable. Make strategy inspectable through reproducible commands, retain the evidence behind accepted results and explain rejected runs without restricting an account.

The Harbour player plays daily to learn the rules, select an unlocked encounter, assemble a crew, defend the piers and return to verified achievements.

The Challenge maker works weekly to arrange buildable cells, configure seeded waves, save privately, verify a winning playtest and publish its exact definition.

The Community competitor visits weekly to discover challenges, attempt their original rules, compare verified rankings and inspect another keeper's replay with other spectators.

## Journeys

Each journey starts with independently created accounts and, where needed, independently created and proved challenges. Do not depend on another journey's leftovers. Every journey finishes by reading the named API responses and comparing exact computed values with the browser.

1. **Arrive, learn and earn.** Start signed out. Create an account, complete tutorial practice, sign out and sign in. Inspect campaign gates, select a loadout, use a placement forecast and finish the first encounter. Submit its commands. Finish by reading the session, run, result, terminal frame and progress: identity and ticket bindings match the selections, the accepted metrics match the terminal frame, and practice contributes no completion.

2. **Plan a conserved defence.** Start with a fresh campaign ticket. Preview two placements from the same frozen state, cancel one, confirm the other, upgrade and salvage. Use keyboard controls or deliberate touch confirmation throughout. Finish the run and submit. Read its frames and ledger; compare forecast contacts with the corresponding command-free interval, balance every movement and reconcile reserve, installations, source and sink with the terminal frame.

3. **Recover verification and return.** Start with a fresh ticket and a completed local encounter. Submit, repeat the same evidence and retry pending work. Inspect a separately submitted illegal log without losing account access. Leave and sign in again. Finish by reading both results, campaign progress, ledger and any qualifying board: repeated work has one terminal result and one set of effects, while the rejected run exposes its first failure and contributes none.

4. **Make, revise and prove.** Start with a new private draft. Edit cells, names, difficulty and displayed wave times; save and reopen. Playtest the saved revision using Lantern Cast, then verify it. Revise the draft and inspect the older proof. Finish by reading the level, both revision-bound tickets, proof states and terminal frames: definitions and seeds match their tickets, the old proof cannot qualify the new revision, and only a matching winning proof is eligible.

5. **Publish across interruption.** Start with a saved private revision and matching winning proof. Publish, recover interrupted work and reopen the result. Also withdraw a separate draft before publication. Finish by reading the level, proof, public challenge, discovery response and proof replay: pending publication is private, committed publication agrees with both stored objects, indexing may still be pending, and the withdrawn draft is absent.

6. **Discover and attempt original rules.** Start in Community with independently published challenges. Search with case and accent variations, combine typed filters, and open a returned challenge. Attempt and verify its original definition. Withdraw a separate published challenge and refresh discovery. Finish by reading search results, the attempt ticket, result and board: bindings match the chosen challenge, the accepted attempt contributes to computed rankings, and withdrawn content disappears from discovery.

7. **Compare a season boundary.** Start with two competitors and an independently published challenge. Submit accepted attempts, including equal metrics and repeated use of different crews. Inspect season records on both sides of the published day boundary using offset-bearing instants. Finish by reading the ordinary board and season response: ranks, personal best, distinct-account completions, crew percentages, daily challenge and streak agree with their defined inputs.

8. **Study together across processes.** Start with an eligible accepted replay. Its owner shares playback; another signed-in viewer follows through a second app process. Open a crew inspector, advance, pause and restart while another accepted attempt changes the board. Finish by reading the shared snapshot, frame page and leaderboard: version, cursor, frame, selected installation and computed rankings agree, and the inspector's focused control remains focused.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Account-to-victory journey.** Provide the arrival journey through practice, account return, encounter selection and an accepted victory with exact identity, frame and progress read-back.
- **DP-02 — Durable identity.** Persist isolated accounts and revocable sessions with authoritative uniqueness and authentication.
- **DP-03 — Unranked tutorial.** Provide guided local practice that cannot create verified progress.
- **DP-04 — Inspectable rules.** Expose every simulation, arithmetic, randomness, ranking and limit rule through the Rules reference and API.
- **DP-05 — Campaign gates.** Derive ordered encounter completion and unlocks exclusively from accepted campaign victories.
- **DP-06 — Bound tickets.** Bind issued tickets immutably to their owner, definition, seed, loadout, source revision and ruleset.
- **DP-07 — Conserved defence journey.** Support the complete forecast, deployment, upgrade and salvage journey with exact frame and ledger reconciliation.
- **DP-08 — Deterministic frames.** Produce every frame through the published integer tick rules, including simultaneous attacks, deaths and breaches.
- **DP-09 — Charge transfers.** Persist balanced append-only transfers and balances for the independently reproduced legal command prefix.
- **DP-10 — Command legality.** Reject the first illegal command without trusting claims, sorting commands or repairing evidence.
- **DP-11 — Lantern Cast agreement.** Compare two spatial deployment forecasts from one frozen state and match subsequent command-free simulation.
- **DP-12 — Installation lifecycle.** Apply the documented upgrade, cooldown, salvage and installation-identity rules.
- **DP-13 — Verification recovery journey.** Support interrupted submission, identical replay, illegal evidence and later account return with exact result and derived-state read-back.
- **DP-14 — Independent acceptance.** Accept a result only after confirmed immutable evidence is read and independently reproduced by the server.
- **DP-15 — Submission ownership.** Give each ticket one canonical evidence submission and one terminal result under retries and concurrency.
- **DP-16 — Persistent return.** Restore verified completions, unlocks and result details after sign-out and sign-in.
- **DP-17 — Accepted effects.** Commit accepted metrics and qualifying progress or ranking effects together.
- **DP-18 — Revision-and-proof journey.** Support private editing, saved-revision playtesting and revision changes with exact definition, proof and frame read-back.
- **DP-19 — Private revisions.** Isolate private records and guard edits and proof associations by their saved revision.
- **DP-20 — Bounded work.** Enforce the published inclusive input and simulation bounds before expensive processing.
- **DP-21 — Proof qualification.** Expose proof states and qualify only a matching accepted winning demonstration.
- **DP-22 — Publication recovery journey.** Support proof-backed publication, interruption recovery and withdrawal with exact public and private read-back.
- **DP-23 — Complete publication.** Expose playable challenges only after required immutable objects and the authoritative publication commit exist.
- **DP-24 — Discovery-to-ranking journey.** Support indexed discovery and an original-rules attempt ending in exact ticket, result and board read-back.
- **DP-25 — Indexed discovery.** Search published challenges through Meilisearch with typed filters, truthful indexing state and recovery without restart.
- **DP-26 — Immutable public history.** Preserve published definitions and eligible historical results while applying the documented withdrawal visibility rules.
- **DP-27 — Season comparison journey.** Support multi-account comparison across the season boundary with exact ranks, percentages, daily challenge and streak read-back.
- **DP-28 — Derived rankings.** Derive ranks, personal best, completion counts and crew percentages from the same qualifying accepted results.
- **DP-29 — Shared study journey.** Support replay presentation and inspection across app processes with exact snapshot and frame read-back.
- **DP-30 — Evidence playback.** Reconstruct eligible replay and accepted frames from confirmed immutable objects under the documented access rules.
- **DP-31 — Keyboard completeness.** Implement the roving board, layered dialogs, shortcuts and focus preservation defined in Business rules.
- **DP-32 — Responsive touch layout.** Implement the reference viewport orders, contained table scrolling and explicit touch confirmation.
- **DP-33 — Observable motion.** Implement the forecast phases, meaningful feedback and immediate reduced-motion substitutes.
- **DP-34 — Harbour visual identity.** Present the specified materials, silhouettes, typography and restricted amber signals.
- **DP-35 — Announced feedback.** Show the documented pending, success, invalid, stale and unavailable states through the named live regions.
- **DP-36 — Dependency recovery.** Preserve authoritative state and the documented retry behavior through database, evidence and discovery failures.
- **DP-37 — Runtime and boundary.** Supply the deployment, initialization, configuration and same-origin boundary contracts.
- **DP-38 — Provider and simulation integrity.** Use real providers, explicit service configuration and one shared pure simulation implementation.
- **DP-39 — Live snapshots.** Follow database-backed replay presentation and leaderboard changes across processes while preserving inspector identity and focus.
- **DP-40 — Exact value presentation.** Preserve integer API and storage values while converting charge, percentages and editable game times exactly.
- **DP-41 — Season surfaces.** Present the season day, local time, daily challenge, standings and authenticated player's streak.
- **DP-42 — Season computation.** Compute every season surface from the same offset-aware day and ticket-bound daily selection.
- **DP-43 — Published transitions.** Enforce the run, challenge and proof transition tables, including system-only and nonpublic states.
- **DP-44 — Reviewable source.** Meet the explicit TypeScript engineering standards without duplicate ranking or transition decisions.
- **DP-45 — Spatial forecast composition.** Make the paired traces, contact marks, placement silhouette and charge comparison legible together over the actual pier.

## Frontend

### Screens and layout (DP-01, DP-07, DP-13, DP-18, DP-22, DP-24, DP-27, DP-29, DP-32, DP-41)

Provide Account, Tutorial, Campaign, Loadout, Defence, Result, Editor, Community, Leaderboard and Replay views. Keep Rules reachable through navigation. Account shows authentication and current identity. Campaign shows every encounter and its gate. Loadout shows device effects and selections. Result distinguishes the local outcome from authoritative verification.

Editor combines the owner's levels, definition fields, buildable-cell chart, waves, saved revision, proof history and publication state. Community combines search, difficulty and ruleset filters, indexing state, season summary, daily challenge and selected challenge details. Leaderboard shows ordinary and selected-day standings, personal best, completion count, crew usage and replay actions. Replay reuses the harbour chart, ordered events, playback controls, shared presentation and a crew inspector; it has no purchasing controls.

Use these reference viewport arrangements, measured in CSS pixels:

| Viewport | Working-surface order |
| --- | --- |
| 1280 by 800 | Board beside a narrow manifest; compact crew rack and actions below the board. On comparison views, leaderboard beside replay, with personal best and completions below the table. |
| 768 by 1024 | Board, crew rack, leaderboard when present, manifest, personal best and completions when present, remaining actions. |
| 375 by 812 | Board, manifest, crew rack, actions, personal best and completions when present, leaderboard. |

Apply the middle arrangement from its reference width up to the desktop reference width, and the narrow arrangement below it. Match visual and reading order.

Keep the page and body free of horizontal overflow. Pan and zoom the board inside its own region rather than shrinking cells. Put the leaderboard table in its own focusable horizontally scrolling region with its column header attached to the top while rows scroll. Keyboard scrolling in that region moves the table without moving the page sideways.

Keep selected coordinates, charge and confirmation controls outside the panning surface. Combat readouts update after each simulated tick; forecast readouts update after preview. Server-backed surfaces refresh after successful actions, reopening and explicit refresh. Live surfaces use the live-snapshot contract. Season time uses its separate refresh contract.

### Public screens and controls (DP-01, DP-03, DP-07, DP-11, DP-13, DP-18, DP-22, DP-24, DP-27, DP-29, DP-31, DP-35, DP-39, DP-41)

These roles and accessible names are the public browser contract. Visible labels match accessible names unless stated otherwise. Semicolon-separated names identify separate controls. Table column names below are column headers.

Placeholders come from the displayed record: `<title>` is its title, `<device>` its device name, `<id>` its run ID, `<lane>` and `<cell>` its decimal coordinates, and `<n>` its one-based wave number.

| Role and accessible name | Visible content |
| --- | --- |
| heading "Squallglass" | Product name |
| navigation "Harbour navigation" | Screen navigation |
| button "Account"; "Tutorial"; "Campaign"; "Editor"; "Community"; "Rules" | Screen names |
| textbox "Email"; "Player name"; "Password" | Account fields; mask Password |
| button "Create account"; "Sign in"; "Sign out" | Authentication actions |
| region "Current player" | Current identity or signed-out state |
| region "Tutorial instructions" | Current practice step |
| button "Begin practice"; "Finish practice"; "Restart practice" | Practice actions |
| region "Campaign encounters" | Encounter cards and gate reasons |
| button "Inspect <title>" | Encounter title |
| region "Encounter manifest" | Title, seed, digest, ruleset, waves and gate |
| button "Choose loadout" | Loadout navigation |
| group "Crew loadout" | Device choices and effects |
| checkbox "<device>" | Device name and price |
| button "Start defence" | Start encounter |
| region "Defence" | Board and shortcut scope |
| grid "Harbour chart" | Spatial board |
| row "Lane <lane>" | Lane |
| gridcell "Lane <lane>, cell <cell>" | Buildability, occupant, tier and selection |
| region "Selected cell" | Coordinates and occupant |
| toolbar "Defence controls" | Defence actions |
| button "<device>" | In-run crew selection |
| button "Plan"; "Pause"; "Upgrade"; "Salvage" | Defence actions |
| combobox "Playback speed" | "1x" and "2x" |
| region "Charge account" | Reserve, installed, source and sink |
| dialog "Planning" | Frozen board and proposal controls |
| dialog "Placement" | Nested placement popover |
| button "Preview"; "Place"; "Cancel" | Proposal actions |
| region "Lantern Cast" | Placement and paired summaries |
| table "Forecast events" | Branch, Number, Tick, Cell, Target, Damage, Breach |
| button "Pan left"; "Pan right"; "Pan up"; "Pan down"; "Zoom in"; "Zoom out" | Chart navigation |
| dialog "Paused" | Pause actions |
| button "Resume"; "Leave run" | Pause actions |
| dialog "Leave run" | Discard confirmation |
| button "Keep playing"; "Discard run" | Leave actions |
| region "Run result" | Local outcome, verification state, failure and metrics |
| button "Submit result"; "Retry verification"; "Refresh result"; "Return to campaign" | Result actions |
| region "Verified progress" | Completed and unlocked titles |
| button "Refresh progress" | Refresh action |
| region "Private levels" | Owner's levels |
| button "New level"; "Open <title>" | Editor navigation |
| textbox "Level title"; "Description" | Definition text |
| spinbutton "Seed" | Seed |
| combobox "Difficulty" | Definition difficulty |
| button "Toggle buildable cell" | Toggle selected editor cell |
| table "Waves" | Time, Creature, Count, Interval, Lane, Actions |
| button "Add wave"; "Remove wave <n>" | Wave actions |
| textbox "Wave <n> time"; "Wave <n> interval" | Displayed game times |
| spinbutton "Wave <n> count"; "Wave <n> lane" | Integer fields |
| combobox "Wave <n> creature" | Creature choices |
| button "Save private level"; "Playtest"; "Publish challenge"; "Retry publication"; "Withdraw level" | Maker actions |
| region "Saved revision" | Revision, digest, proof history and publication state |
| textbox "Search challenges" | Search text |
| combobox "Filter difficulty"; "Filter ruleset" | Typed filters and an unfiltered choice |
| button "Search"; "Refresh challenges" | Discovery actions |
| region "Discovery indexing" | Confirmed or pending index state |
| region "Published challenges" | Search results |
| button "Open challenge <title>" | Open result |
| button "Attempt challenge"; "View leaderboard" | Challenge actions |
| region "Leaderboard scroll area" | Focusable table viewport |
| table "Verified leaderboard"; "Season standings" | Rank, Player, Breaches, Completion time, Remaining charge, Replay |
| region "Personal best" | Current viewer's best or absence |
| region "Challenge completions" | Distinct winning accounts |
| table "Crew usage" | Crew, Deployments, Usage |
| button "Refresh leaderboard" | Refresh action |
| button "Watch replay <id>" | "Watch replay" |
| region "Command replay" | Board, game time and ordered events |
| button "Play replay"; "Pause replay"; "Restart replay" | Local playback |
| button "Share playback"; "Follow playback"; "Stop following" | Shared playback |
| region "Shared playback" | Version, cursor and playing state |
| button "Inspect crew <lane>, <cell>" | "Inspect crew" |
| region "Crew inspector" | Installation identity, type, tier, invested charge, next firing tick and presence |
| button "Close inspector" | Inspector action |
| region "Season summary" | Season day and Kathmandu local time |
| region "Daily challenge" | Daily challenge or absence |
| region "Season streak" | Authenticated viewer's streak |
| textbox "Season instant" | Offset-bearing instant |
| button "Inspect season" | Inspect selected instant |
| region "Rules reference" | Complete published rules |
| status "Harbour status" | Polite action feedback |
| alert "Harbour error" | Failure feedback |

Use persistent field labels. Preserve gridcell identity across updates. An empty cell's inspector action is unavailable. If an inspected installation disappears, retain its identity and inspector, showing that it is absent at the current cursor.

### Interactions (DP-01, DP-03, DP-07, DP-11, DP-12, DP-18, DP-24, DP-29, DP-31, DP-32, DP-39)

Successful authentication opens Campaign. Encounter inspection displays its gate and definition. Selecting devices changes the loadout; starting requests its bound ticket.

Plan freezes the current state and opens Planning. Select a device and cell, then open Placement. Preview computes the counterfactual; Place checks the exact command with the server before committing it locally. A successful check closes planning and resumes. A refusal closes Placement, returns focus to the selected cell in Planning and retains the proposal and frozen state. Cancel in Placement discards that proposal and returns to its cell. Cancel in Planning restores the preceding running or paused state without spending charge.

Changing cells replaces the proposal using the same frozen state. Upgrade and Salvage use the same explicit preview and confirmation controls, showing their cost or refund instead of deployment counterfactual traces.

Click or tap selects a cell. Hover reveals coordinates and occupant without purchasing. Dragging and wheel movement pan only inside the chart. Zoom preserves selected-cell visibility. A repeated tap, drag release, pan or zoom never confirms a command. Scrolling outside the chart moves the page.

The editor changes unsaved fields locally. Save replaces the shown saved revision only after confirmation. Playtest always uses the saved definition. Search runs on Search, Refresh challenges or a filter change; typing alone changes only the field.

Replay advances forward, pauses and restarts; do not offer arbitrary seeking. Share playback makes the owner the presenter. Follow playback follows the stored cursor. Stop following returns to local presentation. Preserve inspector identity and focus through replay and ranking updates.

Use the complete keyboard and touch policies in Business rules.

### Visual design (DP-34, DP-45)

Use deep sea teal around warm beige piers, pale lavender storm creatures and warm off-white reading panels. Reserve amber exclusively for offensive lantern emitters, their attack beams, proposed-placement silhouettes, forecast traces and forecast contact marks. Navigation, ordinary buttons, rankings, errors and decorative trim use other colours.

Use Bricolage Grotesque for compact expressive headings and Atkinson Hyperlegible for reading text. Make the main heading about twice body size and section headings about one and a half times body size. Align numeric readouts with tabular numerals. Bundle local fonts and their notices.

Weather the piers with restrained stippling and ruled cell edges. Keep light beams sharply bounded. Give every device and creature its Seed data silhouette, recognizable without colour. The harbour chart dominates; the manifest resembles a narrow ruled paper instrument.

Keep the two forecast branches visible together over actual lanes. Separate numbered contacts from silhouettes and lane boundaries. Connect the event table and paired balances to those marks through consistent branch labels and numbering. Preserve enough contrast and spacing to read crossings without hiding the underlying pier.

Use comfortable spacing, visible focus outlines on sea and paper, and WCAG 2.2 AA contrast. Every interactive target, including board cells and dense-row actions, measures at least 44 CSS pixels in both directions. Use original procedural canvas or SVG art with an accessible spatial counterpart. Do not require WebGL.

### Motion and effects (DP-11, DP-33)

Lantern Cast places a hatched silhouette at the selected cell, reveals the beam over the pier, then reveals numbered contacts. Proposed-command traces are solid; no-command traces are dotted. Give damage, death and breach marks distinguishable shapes. Display immediate cost, branch endpoint times and balances alongside the spatial view. The event table contains the same numbered events.

Use the phase and timing contract in Business rules. Cancellation removes the proposal immediately. Another preview replaces it; it does not accumulate old traces. This interaction has no scroll-driven reversal.

Panels enter and settle in under half a second. Hover and press feedback appears in under a quarter of a second; pressed controls darken until release. Creature interpolation connects computed tick positions and stops when paused. The board accepts input from the first rendered frame, including during any panel entrance.

Use static text for pending work rather than fabricated progress percentages. Do not add decorative loops, scroll-driven effects or three-dimensional scenes. Apply the reduced-motion contract to every transition and interpolation.

### Feedback states (DP-13, DP-22, DP-25, DP-35, DP-36, DP-39)

Announce pending and successful actions through status "Harbour status"; announce failures through alert "Harbour error". Keep relevant feedback visible until replaced by another action. Disable a submitting action while its request is outstanding without moving focus.

Inspection includes opening, refreshing or reading back a server-backed screen. Background successful polling does not replace action feedback or reannounce unchanged state.

| Action | Pending copy | Success copy |
| --- | --- | --- |
| Create account | "Creating your harbour account…" | "Account ready – your harbour's open." |
| Sign in | "Signing in…" | "Welcome back." |
| Sign out | "Signing out…" | "Signed out." |
| Inspection | "Loading harbour records…" | "Harbour records loaded." |
| Start defence or playtest | "Preparing the encounter…" | "Encounter ready." |
| Save private level | "Saving private level…" | "Private level saved." |
| Check command | "Checking this command…" | "Command placed." |
| Submit or retry verification | "Checking command evidence…" | Use the verification outcome below |
| Publish or retry publication | "Preparing publication…" | Use the publication outcome below |
| Withdraw level | "Withdrawing challenge…" | "Challenge withdrawn." |
| Search or refresh discovery | "Searching harbour challenges…" | "Search complete." |
| Share playback | "Sharing playback…" | "Playback shared – follow the keeper's cursor." |
| Follow playback | "Following playback…" | "Following shared playback." |
| Stop following | No request | "Local playback restored." |

Show practice completion as "Practice complete. No ranked result is submitted."

Accepted victory uses "Verified victory – your strategy's recorded." Accepted defeat uses "Verified defence ended." Rejection uses "Run rejected at tick <tick>: <reason>. Your account remains available." Here `<tick>` is the stored integer failure tick and `<reason>` its stored reason. Also display the failing sequence when supplied.

Pending evidence uses "Evidence storage unavailable. Verification is pending; retry this result." Pending publication uses "Publication pending. Your challenge is still private; retry publication." Committed publication uses "Challenge published."

Discovery with outstanding index work shows "Discovery is indexing – published results may still be arriving." A confirmed index shows "Discovery is current." Keep publication success separate from indexing state.

Announce a completed preview as "Preview ready." Announce cancellation as "Preview cancelled." Local proposal failures use the command-reason vocabulary.

Field errors use "<field>: <message>" beside each field and in the error region, where the placeholders are its API field path and validation message. Other failures display the API message. A background failure retains the last confirmed snapshot, adds visible "Stale" text and announces the dependency error once until recovery. Recovery removes that marker.

Local selection, navigation, pause, speed, board navigation and inspector actions have no fabricated network pending state. Their resulting selected, paused or expanded state is exposed directly.

## Backend

### API (DP-02, DP-04, DP-06, DP-08, DP-10, DP-14, DP-15, DP-19, DP-21, DP-25, DP-26, DP-28, DP-30, DP-39, DP-40, DP-41, DP-42, DP-43)

Use `application/json` for nonempty request and response bodies. Integer fields are JSON numbers, never numeric strings. IDs are opaque strings unless defined otherwise. Unmarked shape members are required; explicitly nullable members remain present.

Public shapes:

- `Account`: `{id,email,playerName}`.
- `Definition`: `{title,description,difficulty,seed,buildable,waves}`. Difficulty is `calm`, `rough` or `severe`. Buildable cells are unique `{lane,cell}` pairs sorted by lane then cell. Waves preserve editor order and contain `{tick,creature,count,interval,lane}`.
- `Proof`: `{runId,revision,state}`.
- `Level`: `{id,revision,state,definition,digest,proofRunId,challengeDigest,proofs,indexing}`. The two IDs may be null. Proofs sort by run ID. Indexing is `pending` or `current`.
- `Ticket`: `{id,accountId,mode,sourceId,revision,seed,levelDigest,loadout,ruleset,initialReserve,initialHealth,seasonDay,daily}`. Mode is `campaign`, `playtest` or `challenge`. Revision and seasonDay are nullable. Daily is boolean.
- `Command`: `{seq,tick,type,lane,cell,device}`. Device is a device ID for deployment and null otherwise.
- `Metrics`: `{outcome,breaches,completionTick,remainingCharge,health}`. Outcome is `victory` or `defeat`; remainingCharge is reserve only.
- `Failure`: `{tick,seq,reason}`, with nullable seq for log-wide failures.
- `Transfer`: `{movementId,tick,account,delta,reason,deviceId}`. Account is `reserve`, `source`, `sink` or `installed:<entityId>`. DeviceId is that installation's integer ID on installed entries and null otherwise. Reason is `initial`, `harbour-generation`, `collector-generation`, `deploy`, `upgrade`, `salvage-refund` or `salvage-loss`.
- `Result`: `{runId,state,evidenceDigest,metrics,failure}`. Pending states have null metrics and failure; accepted has reproduced metrics and null failure; rejected has null metrics and a failure.
- `Run`: `{ticket,state,result,ledger,proof}`, with nullable result and proof.
- `Challenge`: `{digest,ruleset,title,description,difficulty,creatorName,definition,proofRunId,completions}`.
- `BoardRow`: `{rank,accountId,playerName,runId,breaches,completionTick,remainingCharge}`.
- `Usage`: `{device,deployments,tenthsPercent}`.
- `Board`: `{digest,ruleset,rows,personalBest,completions,crewUsage}`. PersonalBest is nullable. CrewUsage follows device order.
- `Progress`: `{completed,unlocked}`, arrays of campaign IDs in campaign order.
- `Rules`: `{ruleset,tickRate,arithmetic,randomness,tickOrder,devices,creatures,limits,commandRules,rankingRules,seasonRules,transitions}`. Use the nested response contract below; its values describe the existing rules rather than additional settings.
- `Playback`: `{version,tick,playing}`.
- `Snapshot`: `{runId,playback,frame,leaderboard}`. Leaderboard is null outside challenge mode; otherwise it is the requesting viewer's Board.
- `Season`: `{instant,localTime,seasonDay,dailyDigest,standings,streak}`. DailyDigest is nullable. Standings is a nullable Board for the daily challenge. Streak is null when signed out.

A `Frame` is complete state immediately before resolving its tick:
`{tick,rngState,nextEntityId,nextMovementId,health,breaches,reserve,source,sink,devices,creatures,spawned,events,transfers,outcome}`.

Devices sort by entity ID and contain `{id,device,lane,cell,tier,installedCharge,nextFireTick}`. Tier is `base` or `upgraded`; nextFireTick is null for nonattackers. Creatures sort by entity ID and contain `{id,creature,lane,position,health,movements}`. Surviving creature health is positive. Spawned holds cumulative counts in wave order.

Events describe the transition into the frame and are initially empty:

- Damage: `{kind:"damage",tick,deviceId,targetId,lane,cell,damage,resultingHealth}`.
- Death: `{kind:"death",tick,creatureId,lane,cell}`.
- Breach: `{kind:"breach",tick,creatureId,lane,cell}`.

Transfers contains that transition's transfers, except the initial frame contains starting allocation. Outcome is null until terminal. Next IDs are the next unallocated positive integers. Source and sink are balances; installed balances appear on devices. Removed installations retain their ledger history.

Canonical JSON preserves array order and recursively sorts object keys lexicographically by unsigned UTF-16 code units, comparing the original unescaped keys. Encode integers in decimal without a leading plus, leading zeros or exponent; encode zero without a minus. Encode booleans and null with their lowercase JSON spellings. Include no insignificant whitespace or byte-order mark.

For every JSON string, escape quotation mark as `\"` and backslash as `\\`. Encode backspace, tab, line feed, form feed and carriage return as `\b`, `\t`, `\n`, `\f` and `\r`, respectively. Encode every other character from U+0000 through U+001F as lowercase `\u00xx`. Emit every other Unicode scalar value literally, including slash, accented letters, supplementary characters, U+2028 and U+2029. Encode the resulting text as UTF-8. Do not normalize Unicode. Equivalent input escape spellings therefore produce identical canonical bytes, while composed and decomposed character sequences remain distinct. Reject unpaired UTF-16 surrogates through field validation at the forbidden-character stage.

Unicode test vector: input `{"\u00e9":"\u96ea","a":"\u000a","emoji":"\ud83c\udf0a"}` canonicalizes to `{"a":"\n","emoji":"🌊","é":"雪"}`. In that canonical text, `\n` denotes the two ASCII bytes backslash and lowercase n; it is not a literal line feed. The emoji, accented key and snow character are literal UTF-8 characters.

LevelDigest is lowercase hexadecimal SHA-256 of canonical Definition. Evidence is canonical `{commands,endTick}`; claims are excluded. Challenge digest is SHA-256 of canonical `{levelDigest,ruleset}`.

| Method and path | Request | Success status and body |
| --- | --- | --- |
| POST `/api/accounts` | `{email,password,playerName}` | 201 `{account:Account}` and session cookie |
| POST `/api/session` | `{email,password}` | 200 `{account:Account}` and session cookie |
| GET `/api/session` | None | 200 `{account:Account}` |
| DELETE `/api/session` | None | 204, empty |
| GET `/api/rules` | None | 200 `Rules` |
| GET `/api/campaign` | None | 200 `{encounters:[{id,title,definition,digest,unlocked,completed}],progress:Progress}` |
| GET `/api/progress` | None | 200 `Progress` |
| POST `/api/runs` | `{mode,sourceId,revision,loadout}` | 201 `{ticket:Ticket}` |
| POST `/api/runs/<id>/start` | `{}` | 200 `Run` |
| POST `/api/runs/<id>/commands/check` | `{commands,atTick,proposal:Command}` | 200 `{command:Command,state:CommandState}` |
| POST `/api/runs/<id>/submit` | `{commands,endTick,claims}`; claims optional | 200 `Result` when terminal; 202 `Result` when pending |
| POST `/api/runs/<id>/retry` | `{}` | Same status and body alternatives as submission |
| GET `/api/runs/<id>` | None | 200 `Run` |
| GET `/api/runs/<id>/frames?from=<from>&to=<to>` | Decimal integer bounds | 200 `{runId,from,to,frames:[Frame]}` |
| POST `/api/levels` | `{definition:Definition}` | 201 `Level` |
| GET `/api/levels` | None | 200 `{levels:[Level]}`, title then ID order |
| GET `/api/levels/<id>` | None | 200 `Level` |
| PUT `/api/levels/<id>` | `{expectedRevision,definition:Definition}` | 200 `Level` |
| POST `/api/levels/<id>/publish` | `{expectedRevision,proofRunId}` | 201 `Challenge` on first commit; 200 `Challenge` on identical committed replay; 202 `Level` while pending |
| POST `/api/levels/<id>/withdraw` | `{expectedRevision}` | 200 `{id,state}` |
| GET `/api/challenges?q=<q>&difficulty=<difficulty>&ruleset=<ruleset>` | All parameters optional | 200 `{challenges:[Challenge],indexing}` |
| GET `/api/challenges/<digest>` | None | 200 `Challenge` |
| GET `/api/challenges/<digest>/leaderboard` | None | 200 `Board` |
| GET `/api/results/<id>/replay` | None | 200 `{ticket:Ticket,definition:Definition,commands,endTick,metrics:Metrics}` |
| GET `/api/results/<id>/snapshot` | None | 200 `Snapshot` |
| PUT `/api/results/<id>/playback` | `{expectedVersion,tick,playing}` | 200 `Playback` |
| GET `/api/season?at=<instant>` | Optional offset-bearing ISO instant | 200 `Season` |

Omitted search text means empty text. Omitted difficulty or ruleset means no filter; provided values must be allowed enum values. Search text is at most 100 Unicode code points, inclusive. An unsupported ruleset is invalid input rather than a free-form provider filter. Return all matching records in title then digest order; do not expose provider relevance scores.

Command checking independently reconstructs the prefix to atTick, applies prefix commands at that tick in supplied order, then validates and applies the proposal before spawning. Require a playing run, proposal.tick equal to atTick and prefix commands no later than atTick. It changes neither ticket nor staged evidence. A legality failure uses the command-refusal error; malformed fields use validation.

`CommandState` has Frame members plus `phase:"after-commands"`. Its tick remains atTick, its state includes commands at that tick and the proposal, its events are empty, and transfers contain only those commands' transfers. It is not a normal frame and never replaces the pre-command frame in frame pages.

Frame bounds are required nonnegative integers, from no greater than to, with at most 201 frames per request, inclusive. Include `[from,to)` and reject to beyond the last available tick plus one. Empty intervals are valid. Before acceptance, only an owner with a rejected result may read frames, ending at the last complete legal frame. Other nonaccepted states use the transition error. Accepted reads reconstruct from confirmed objects. Do not repeat terminal frames.

Rules, search, public challenge reads, leaderboards, season reads and eligible replay reads are public. Account and session creation are public. Other operations require authentication. Signed-out personalBest and streak are null. Private levels and run operations are owner-only. Accepted run-frame reads are public when replay-eligible and otherwise owner-only. Shared playback changes additionally require the owner.

Replay eligibility requires acceptance and either campaign mode, challenge mode for a challenge that has ever committed publication, or a playtest whose exact run ID is that committed publication's proof. Other playtests are ineligible, even to their owner. Ineligible replay, snapshot and playback resources use the absent-resource error before object access. Both accepted victories and defeats may be replay-eligible.

Use one error envelope:
`{"error":{"code":"<code>","message":"<message>","fields":{}}}`.
Validation fills fields with request paths and messages; other errors leave it empty.

Field paths start at the request JSON root, without a leading dot or root marker. Separate object members with dots and append zero-based array indices in square brackets. Examples are `definition.title`, `definition.waves[0].tick`, `definition.buildable[1].cell`, `commands[2].seq`, `proposal.tick` and `loadout[0]`. Use the containing field's path when that field is missing or has the wrong container type; do not invent descendant errors beneath it. An unknown member uses its own path. Array-wide limits and relationships use the array's path, such as `definition.waves` for excessive waves or total scheduled creatures and `commands` for an excessive submission command count. For the combined command-check count, use `commands`. Query parameters use their bare names, such as `from`, `to` and `at`. Cross-field errors use the field explicitly named by its contract; otherwise attach them to the later field in the documented request shape. The reserved path `depth` identifies excessive nesting.

Apply this global precedence: transport, origin and byte bounds; authentication; unknown or other-owner resource; permission; identical stored-operation replay; state and concurrency conflicts; field validation. Stored replay still checks preceding stages. Within validation, check JSON types first, then depth, forbidden characters, lengths and ranges, cross-field relationships, then aggregate limits. Return all failures from the first failing validation stage. Command legality after structural validation is a verification outcome.

| Category | Status | Code | Message |
| --- | --- | --- | --- |
| Malformed JSON or nonobject root | 400 | `INVALID_JSON` | "Send a valid JSON object." |
| Authentication required | 401 | `AUTH_REQUIRED` | "Sign in to continue." |
| Incorrect credentials | 401 | `INVALID_CREDENTIALS` | "Email or password is incorrect." |
| Absent or other-owner resource | 404 | `NOT_FOUND` | "Harbour record not found." |
| Cross-origin mutation | 403 | `ORIGIN_REFUSED` | "Use this harbour's own page." |
| Permission refused | 403 | `FORBIDDEN` | "Only this run's owner can share playback." |
| Duplicate normalized email | 409 | `EMAIL_EXISTS` | "This email already has an account." |
| Locked encounter | 409 | `ENCOUNTER_LOCKED` | "Complete the preceding encounter first." |
| Stale revision | 409 | `REVISION_CHANGED` | "Reload the saved revision before continuing." |
| Any invalid entity transition | 409 | `INVALID_TRANSITION` | "This harbour record can't make that change." |
| Different ticket evidence | 409 | `EVIDENCE_CONFLICT` | "This ticket already holds different command evidence." |
| Missing or mismatched proof | 409 | `PROOF_REQUIRED` | "Verify a victory for this saved revision first." |
| Duplicate challenge identity | 409 | `CHALLENGE_EXISTS` | "This definition is already published." |
| Stale presentation version | 409 | `PLAYBACK_CHANGED` | "Reload shared playback before changing it." |
| Command check refused | 422 | `COMMAND_REFUSED` | First command reason from Business rules |
| Invalid fields | 422 | `INVALID_FIELDS` | "Check the highlighted fields." |
| Wrong content type | 415 | `JSON_REQUIRED` | "Send application/json." |
| Unsupported method on known path | 405 | `METHOD_REFUSED` | "Use a documented method." |

Every validation field message is "Use a permitted value." Unknown API paths use the absent-resource error. Dependency and byte-limit errors belong to Services and Server boundary.

Require strict JSON types without coercion: booleans are not integers, numeric strings are not numbers, and null is valid only where explicitly allowed. Reject unknown request members except inside optional claims, whose contents are ignored.

Normalize email by trimming and lowercasing. Permit syntactically valid email up to 254 Unicode code points and passwords from 12 through 128 UTF-8 bytes, inclusive. Trim player names and level titles before their length checks. Player names contain 1 through 32 Unicode code points. Level titles contain 1 through 60; descriptions contain zero through 500. Reject Unicode category Cc, U+0085 and U+2028 in player names, titles and descriptions before trimming. Do not normalize away accents. Hash passwords irreversibly.

Use an opaque random `squallglass_session` cookie with HttpOnly, SameSite=Lax and Secure under HTTPS. Sessions remain valid until sign-out revokes the current session. Concurrent account creation for one normalized email has one winner; the others receive the duplicate-email response.

Season instants require a real calendar date, time, seconds and explicit `Z` or numeric offset. Accept fractional seconds through three digits; reject offsetless or invalid dates. The API returns instant normalized to UTC with three fractional digits and localTime as `YYYY-MM-DDTHH:mm:ss.SSS+05:45`. A supplied instant selects an inspection context only; it cannot backdate a ticket or accepted result.

#### Nested Rules response contract

All members below are required, with no additional members. Numeric constants are integer JSON numbers; flags are JSON booleans. A nullable member is present with null when inapplicable. Arrays retain the stated order. Read constant values from the owning Business rules, Seed data, API or Server boundary section; do not convert their units or represent them as prose. The root ruleset and tickRate use the Integer simulation values.

- `arithmetic` is `{positionUnit,chargeUnit,division,salvageDivision,contactDivision,integerOnly,wallClockInputs}`. The unit strings are `thousandth-cell` and `milli-charge`; division is `half-away-from-zero`; both exception strings are `floor`; integerOnly is true and wallClockInputs is false.
- `randomness` is `{algorithm,wordBits,shifts,drawsPerSpawn,drawForExplicitLane,randomLaneRule,otherGameplayDraws,cosmeticDraws,example}`. Algorithm is `xorshift32`; wordBits describes its unsigned state width. Shifts is an ordered array of `{direction,bits}`, using direction `left`, `unsigned-right`, then `left`, with the corresponding published shifts. DrawsPerSpawn uses the published draw count; drawForExplicitLane is true; randomLaneRule is `1+draw%laneCount`; otherGameplayDraws and cosmeticDraws are zero. Example is `{seed,draws,lanes}`, containing the complete worked example in Seeded waves.
- `tickOrder` is the ordered string array `["commands","spawn","move-and-change-lane","prepare-attacks","simultaneous-damage","deaths","generation","breaches","terminal-check"]`.
- `devices` is an array in Seed data device order. Each entry is `{id,name,cost,upgradeCost,range,cooldown,damage,maxTargets,laneOffsets,ignoresArmour,generation,slowdownDivisor,upgradedSlowdownDivisor}`. Copy identity, prices and applicable mechanics from its seed row. Range and cooldown are null when absent. Damage, maxTargets and generation are zero when absent. LaneOffsets is `[0]` for same-lane attackers, `[-1,0,1]` for the cross-lane attacker and empty for nonattackers. IgnoresArmour is true only for the armour-ignoring attacker. Both slowdown divisors are null except on the wall, where they contain its published base and upgraded divisors. Damage and generation contain base-tier values.
- `creatures` is an array in Seed data creature order. Each entry is `{id,name,health,speed,armour,laneChange}`. Armour is zero unless its seed row specifies armour. LaneChange is null except for the lane-crossing creature, where it is `{everyMovements,laneDelta,wrap}` using its published cadence, forward lane increment and wrap=true.
- `limits` is `{lanes,cellsPerLane,minWaves,maxWaves,maxCreatures,maxCompletedTicks,minCommandTick,maxCommandTick,minEndTick,maxEndTick,maxCommands,commandBodyBytes,otherBodyBytes,maxDepth,minSeed,maxSeed,minWaveCount,minWaveInterval,minWaveTick,maxWaveLane,maxFramePage,minLoadout,maxLoadout,maxSearchCodePoints,minPlayerNameCodePoints,maxPlayerNameCodePoints,minTitleCodePoints,maxTitleCodePoints,minDescriptionCodePoints,maxDescriptionCodePoints,maxEmailCodePoints,minPasswordBytes,maxPasswordBytes,maxInstantFractionDigits}`. Each member contains its corresponding inclusive published bound. MaxWaveLane is the highest explicit lane; the separately permitted random-lane sentinel remains zero. CommandBodyBytes covers both command-check and submission bodies. MaxCommands covers either submission commands or prefix plus proposal. MaxFramePage is the maximum number of returned frames, not an endpoint tick.
- `commandRules` is `{types,reasonOrder,initialReserve,initialHealth,harbourGeneration,generationPeriod,spawnPosition,harbourPosition,cellWidth,deviceCentreRule,initialEntityId,initialMovementId,initialTier,maxUpgrades,upgradeDamageMultiplier,upgradeGenerationMultiplier,salvageRefundDivisor,commandTransfersAt,otherEventsAt,framePhase,targetOrder,damageMode,damageEventHealth,wallCombination,cooldownAfterFire,upgradeResetsCooldown,deadCanBreach,terminalOrder,forecastTransitions,forecastPhases,legality}`. Types is `["deploy","upgrade","salvage"]`. ReasonOrder contains the command-reason strings verbatim in their published precedence. The initial values, generation amount and period, positions, cell width, starting IDs, upgrade count and multipliers, salvage divisor and forecast horizon contain the corresponding published integers. InitialTier is `base`; deviceCentreRule is `cellWidth*cell-cellWidth/2`; commandTransfersAt is `t`; otherEventsAt is `t+1`; framePhase is `before-commands`; targetOrder is `["position-ascending","entity-id-ascending"]`; damageMode is `simultaneous`; damageEventHealth is `pre-health-minus-all-prepared-hits`; wallCombination is `strongest-once`; cooldownAfterFire is `t+cooldown`; upgradeResetsCooldown and deadCanBreach are false; terminalOrder is `["zero-health-defeat","all-spawned-and-none-alive-victory","tick-limit-defeat"]`.
- Within commandRules, `forecastPhases` is an ordered array of `{phase,durationMs}` containing the timed reveal phases and a final ready phase with duration zero. `legality` is `{sequence,tickOrder,deployment,upgrade,salvage,terminalCommand,repair,missingTerminalReason}`. Sequence is `strictly-increasing`; tickOrder is `nondecreasing`; deployment is `["valid-buildable-cell","loadout-member","empty-cell","sufficient-reserve"]`; upgrade is `["valid-cell","installed-device","base-tier","sufficient-reserve"]`; salvage is `["valid-cell","installed-device"]`; terminalCommand is `reject-at-or-after-terminal-frame`; repair is false; missingTerminalReason contains the published log-wide reason verbatim.
- `rankingRules` is `{qualifyingOutcome,perAccount,metricOrder,rankStyle,equalAccountMetrics,tiedAccountOrder,completions,usageSource,usageScale,usageRounding,usageTieOrder,emptyUsage}`. QualifyingOutcome is `victory`; perAccount is `best-only`; metricOrder is `["breaches-ascending","completionTick-ascending","remainingCharge-descending"]`; rankStyle is `competition`; equalAccountMetrics is `earliest-committed`; tiedAccountOrder is `account-id-ascending`; completions is `distinct-accounts`; usageSource is `deploy-commands-in-selected-best-runs-including-salvaged`; usageScale is the published tenths-percent total; usageRounding is `largest-remainder`; usageTieOrder is `device-order`; emptyUsage is `all-zero`.
- `seasonRules` is `{timeZone,utcOffset,dayStart,dayFormat,selectionEpoch,selectionOrder,selectionRule,selectionFreeze,emptySelection,ticketDaySource,streakAnchor,refreshSeconds}`. TimeZone is `Asia/Kathmandu`; utcOffset is the published numeric-offset string; dayStart is the published local boundary formatted `HH:mm`; dayFormat is `YYYY-MM-DD`; selectionEpoch is the published epoch date; selectionOrder is `digest-lexicographic`; selectionRule is `nonnegative-days-since-epoch-modulo-count`; selectionFreeze is `first-season-read-or-challenge-ticket`; emptySelection is null; ticketDaySource is `server-issuance-instant`; streakAnchor is `inspected-day-if-completed-else-preceding-day`; refreshSeconds contains the current-time refresh bound.
- `transitions` is `{run,challenge,proof}`, each an array of `{source,actorAction,destinationCondition}`. Include one entry for each row of the corresponding transition table, in table order. Source is the first column with the entity name and following comma removed. ActorAction and destinationCondition are the exact text of the second and third columns. These are strings, including the table's conditions and replay qualifications; do not invent extra state names from explanatory text.

### Business rules (DP-03, DP-04, DP-05, DP-06, DP-08, DP-09, DP-10, DP-11, DP-12, DP-15, DP-16, DP-17, DP-19, DP-21, DP-23, DP-26, DP-28, DP-31, DP-32, DP-33, DP-39, DP-40, DP-42, DP-43)

#### Integer simulation

Use ruleset `orrel-1` and 20 fixed ticks per simulated second. Positions, ranges and charge are integer milli-units. Gameplay uses no floating-point arithmetic or wall-clock inputs. Division rounds half away from zero: divide magnitudes, round exact halves upward, then restore the sign. Downward quotients explicitly identified below are exceptions.

Frame t is immediately before commands stamped t. Resolving it produces frame t+1. Command transfers carry tick t; other events and generation transfers carry t+1. Initial allocation carries zero. Stop at the first terminal frame.

Resolve each tick in this numbered order:

1. Apply commands stamped t in supplied sequence order.
2. Spawn due creatures in wave-array order, then creature-index order.
3. Move every creature using walls from pre-movement positions, then perform lane changes.
4. Prepare attacks in device-ID order against the same post-movement creature state.
5. Apply all prepared damage simultaneously.
6. Remove dead creatures and emit deaths.
7. Generate harbour charge, then surviving installed collectors' charge on a generation boundary.
8. Remove surviving creatures at or beyond the harbour and emit all breaches.
9. Determine defeat, victory or continued play.

Devices and creatures share an increasing entity-ID counter beginning at one. Commands allocate installations before spawns allocate creatures. Movement and spawn counts begin at zero. Deployment sets nextFireTick to its command tick. A newly deployed collector participates in that tick's generation.

Spawn at position 8999; the harbour is position zero. Device centres are `1000 × cell − 500`. Devices do not block movement. Test a wall's same-lane inclusive absolute range before movement. Use the strongest applicable slowdown once. Subtract the resulting integer speed, increment movement count and then apply lane changes.

An attacker is eligible when t is at least nextFireTick. A target must occupy an allowed lane and lie within inclusive absolute range. Order targets by smaller position, then entity ID. After an attack, set nextFireTick to t plus cooldown. With no target, leave it unchanged. Upgrading changes no cooldown timestamp.

Apply armour independently to every prepared hit, with minimum damage one unless armour is ignored. Attackers may hit the same target even if their combined damage exceeds its health. Each damage event reports pre-damage health minus the sum of all hits on that target, so simultaneous hits share resultingHealth. Emit damage events in attacker-ID then selected-target order, deaths in creature-ID order, and breaches in creature-ID order.

A dead creature never breaches, including one that crosses the harbour in its death tick. Contact cell is one plus the downward quotient of position clamped to zero through 8999 divided by cell width. Damage and death contacts use the target's post-movement lane and position. Breach contacts use the first cell.

Process every surviving breach even if their count exceeds remaining health. Increase breaches once per creature and reduce health to no less than zero. Zero health means defeat before any victory check. Otherwise victory requires all scheduled creatures spawned and none alive. At the run limit, unfinished play becomes defeat. CompletionTick is the terminal frame tick. Generation occurs before this terminal decision.

#### Seeded waves

Use unsigned 32-bit xorshift32 with nonzero ticket seed. For each draw, xor state with its left shift by 13 and truncate to unsigned 32 bits; xor with its unsigned right shift by 17 and truncate; xor with its left shift by 5 and truncate.

Worked example: seed 1 produces 270369, 67634689 and 2647435461. Those draws choose random lanes 5, 5 and 2.

Draw once for every spawned creature, including explicit-lane spawns. Lane zero selects one plus draw modulo lane count. No other gameplay action consumes randomness. Cosmetics use no gameplay draws.

A wave's tick is its first spawn's command-time tick. Later spawns use tick plus zero-based creature index times interval. Newly spawned creatures move immediately. That movement counts toward lane-crossing behavior.

#### Charge and commands

For the Harbour player's defence, record starting allocation, generation, deployment, upgrade and salvage as paired equal-and-opposite integer transfers sharing a movement ID. All accounts start at zero. Transfer supply from source to reserve, purchases from reserve to installed accounts, salvage refund from installed to reserve and salvage loss from installed to sink.

Allocate movement IDs in operation order and emit debit before credit. Generate harbour supply before collectors in entity-ID order. Append corrections as reversing movements; never edit prior entries. Reserve plus installed balances plus sink equals initial supply plus generated supply. Source is the negative of supplied charge. Persist the independently reproduced ledger, including the legal prefix of a rejected run.

Deploy only a loadout device into an empty buildable cell with sufficient reserve. Each installation has one base and one upgraded tier. Upgrade transfers its price into the same installed account, doubles offensive damage or collector generation, and applies the upgraded wall effect. It does not reset a firing timestamp.

Salvage removes the installation, refunds half its total installed charge rounded down in milli-charge and sends the rest to sink. Its balance becomes zero. Repeated salvage is illegal; redeployment receives a new identity.

Use the first applicable command reason:

1. "Unknown command" for a type outside deploy, upgrade and salvage.
2. "Command sequence is not increasing" when seq is not greater than its predecessor.
3. "Command tick moved backwards" for decreasing tick order.
4. "Command follows terminal state" at or beyond a terminal frame.
5. "Invalid cell" outside the board or on a nonbuildable deployment cell.
6. "Device is outside the loadout" for an unavailable deployment device.
7. "Cell is occupied" for deployment over an installation.
8. "No installed device" for upgrade or salvage in an empty cell.
9. "Device is already upgraded" for another upgrade.
10. "Insufficient charge" when a purchase would make reserve negative.

Require positive integer seq and integer tick. Structurally valid unknown types are legality failures, not shape errors. Never sort commands.

Stop at the first illegal command. Preserve earlier legal commands from the same tick in the ledger, but do not resolve that tick or expose its intermediate state as a Frame. A missing terminal outcome produces "Run has no terminal outcome", null seq and failure tick endTick.

Replay through endTick or earlier termination, then inspect remaining commands for terminal violations. EndTick earlier than any command is a field error. Rejection gives no progress, ranking or qualifying proof and leaves the account usable.

#### Forecast, keyboard and motion

Lantern Cast clones entities, counters, random state, cooldowns, spawn counts and balances. Compare exactly one proposed deployment against no new command, resolving 100 transitions or stopping each branch at its terminal frame. Never mutate or advance the source clone.

The region exposes `data-phase` values `beam`, then `contacts`, then `ready`. Reveal the beam over 180 milliseconds and contacts over the following 260 milliseconds, with no simulated time advancing. Preview events include damage, deaths and breaches, separately numbered within each branch in event order. Show immediate cost, endpoint tick and endpoint reserve for both branches. With no intervening commands, confirmed live play agrees exactly.

For the Harbour player, make every action keyboard-operable. The board has one roving tab stop: one gridcell has tabindex zero and all others minus one. Arrows move one cell without wrapping; Home and End move to the lane ends; boundaries clamp. Preserve selected coordinates and focused cell through updates and command refusal.

Within Defence and Planning, number keys select devices in Seed data order even when a nontext control has focus. Enter on a cell opens Placement. Enter there activates Preview until a valid preview exists, then Place. Do not intercept editing in text fields.

Tab follows visual reading order outside dialogs. Trap Tab and Shift+Tab within the topmost dialog. Escape closes only that layer and restores its opener. Placement returns to its cell inside Planning; Planning returns to its original cell; Leave run returns to Paused. Updates never steal focus.

For touch users, Preview and Place require distinct activations. Board navigation cannot purchase. Under reduced motion, stop cosmetic loops, skip intermediate reveal phases, expose `ready` immediately and display the same traces, marks and event table. Every element's computed transition-duration is 0s; run no transition or interpolation animation. Simulation may display discrete computed states.

Pause and presentation speed change no simulation result. Planning and cosmetic effects cannot consume gameplay randomness.

#### Tickets, revisions and transition tables

Issue immutable tickets from authoritative definitions. Loadouts contain one through four unique permitted devices. Playtests require the current saved revision; other modes require null revision. Issued tickets retain their snapshots after later edits.

The following tables list every permitted state change. Unlisted transitions use the API transition error, unless the API precedence selects a more specific conflict. A replay listed here returns its stored operation rather than making a new transition.

| Entity and source | Actor/action | Destination and condition |
| --- | --- | --- |
| Run, absent | Owner issues ticket | issued |
| Run, issued | Owner starts | playing |
| Run, playing | Owner starts again | playing, identical replay |
| Run, playing | Owner stages first submission | submitted |
| Run, submitted | System confirms and reads evidence | verifying |
| Run, verifying | System reproduces legal terminal play | accepted |
| Run, verifying | System finds illegal or nonterminal play | rejected |
| Run, verifying | System loses evidence access or resumes interrupted work | submitted |
| Run, submitted | Owner retries or repeats identical evidence | submitted or system verification path |
| Run, accepted or rejected | Owner repeats identical evidence or retries | same state and stored result |
| Challenge, absent | Owner saves definition | private |
| Challenge, private | Owner saves matching revision | private, next revision |
| Challenge, private | Owner begins qualified publication | proof-pending |
| Challenge, proof-pending | System commits complete publication | published |
| Challenge, proof-pending | Owner retries same publication | proof-pending or system publication path |
| Challenge, published | Owner repeats identical publication | published, stored challenge |
| Challenge, private or proof-pending | Owner withdraws | withdrawn |
| Challenge, published | Owner withdraws | unlisted |
| Challenge, unlisted | Owner repeats withdrawal | unlisted |
| Proof, absent | Owner issues playtest ticket | pending |
| Proof, pending | System begins verification | verifying |
| Proof, verifying | System returns run to submitted | pending |
| Proof, verifying | System accepts matching current-revision victory | qualified |
| Proof, verifying | System rejects or accepts defeat | failed |
| Proof, pending, verifying or qualified | Owner saves a new level revision | obsolete |
| Proof, verifying | System accepts victory after its revision becomes outdated | obsolete |

Run accepted and rejected, proof failed and obsolete, and challenge withdrawn are terminal. An obsolete proof remains obsolete if its run subsequently completes. Retrying failed proof work requires a new ticket.

Private, proof-pending, withdrawn and every proof state are never public discovery states. A withdrawn-before-publication level is omitted from owner lists and returns the absent-resource response on every record endpoint, even to its owner; its private runs remain independently addressable by run ID. Unlisted levels remain visible to their owner.

The first durably staged canonical evidence owns a ticket. For the Harbour player retrying an interrupted response, identical evidence shares pending work or returns the stored result without another ledger, achievement or ranking entry. Different evidence conflicts after staging. Retry uses staged bytes rather than replacement commands. Only one terminal result commits, even if concurrent verifiers compute it.

Campaign gates follow Seed data order. The first encounter starts unlocked. Accepted campaign victories complete their encounter and unlock the next. Completion is unique per account and encounter. Practice has no ticket and cannot affect progress.

Private levels start at revision one. Saving increments once and clears proofRunId. Concurrent edits at the same expectedRevision have one winner. Existing proof history remains inspectable with its updated state.

A matching qualified proof may populate proofRunId only while the level is private and that association is empty. Serialize qualifying acceptance against the level: the first committed matching victory supplies it. Later victories do not replace it. Publication may choose any qualified owner proof for the current revision; entering proof-pending pins that selected run. Later acceptance and retries cannot change the pinned proof.

Publication and withdrawal serialize on the level. If withdrawal commits first, publication cannot commit. If publication commits first, withdrawal unlists it. Edits and new playtest tickets are invalid outside private state; already issued playtests may finish without altering a pinned association. Different pending-publication requests cannot replace the stored operation and use the transition error after revision and proof checks.

#### Publication and rankings

For the Challenge maker, expose a playable challenge only after MinIO confirms its immutable definition and winning evidence objects and the PostgreSQL publication record commits. Partial failure leaves no public card, playable encounter or board. Unreferenced objects grant nothing. Keep interrupted work private and retryable.

Challenge identity is unique. Concurrent publication of one digest has one committed winner; other level records receive the duplicate-challenge response and remain private. Published definitions and rulesets never change.

Withdrawal of a published challenge removes it from discovery and prevents new tickets or direct challenge-detail reads. Existing issued tickets can finish. Historical leaderboards, replays and frames remain available from its immutable committed history. Withdrawal before publication creates no public history.

Commit accepted metrics, campaign completion effects and qualifying challenge results in one PostgreSQL transaction. Defeats receive metrics without progress, ranking or proof qualification.

For the Community competitor, rank, personal best, completions and crew usage derive from the same accepted challenge victories for a digest and ruleset. Each account contributes only its best: fewer breaches, then lower completionTick, then greater remainingCharge. Equal metrics share competition rank with the following gap. Retain an account's earliest committed result on equal metrics. Order tied accounts by account ID without changing rank.

Completions counts distinct qualifying accounts. Exclude pending, rejected, campaign and playtest runs from challenge boards.

Crew usage counts legal deploy commands in those selected best runs, including subsequently salvaged installations. Include every device, even unused ones. Convert counts to tenths of a percent by taking each downward integer quotient of count times 1000 divided by total deployments, then distribute remaining tenths to largest remainders, breaking ties by device order. Nonempty usage sums to exactly 1000 tenths; an empty total produces all zeros. Display tenthsPercent with one decimal digit and a percent sign.

#### Season days

Use the Asia/Kathmandu calendar, offset UTC+05:45, with days running from local 05:00 inclusive to the next local 05:00 exclusive. SeasonDay is the calendar date of the interval's start, formatted `YYYY-MM-DD`. Standings, daily selection and streak use this same function.

The optional season inspection instant selects that context; when omitted use current server time. Show its localTime and seasonDay. Refresh current-time season surfaces on opening, after relevant actions and at least every 30 seconds while visible. An explicitly inspected historical instant remains fixed until edited or cleared.

Freeze daily selection on the first season read or challenge-ticket issuance for that day. In one database transaction, sort currently published digests lexicographically and select index equal to nonnegative days since 1970-01-01 modulo their count. Persist that digest; persist null if there are none. Concurrent first reads share one selection. Later publications or withdrawals do not replace it.

A selected daily challenge retains a historical season card and board after withdrawal, but cannot issue new tickets while unlisted. Previously issued tickets remain valid.

Challenge tickets receive server-issued seasonDay and daily=true exactly when their digest equals that day's frozen selection. Other ticket modes have null seasonDay and daily=false. Ticket issuance time, not submission time, selects the day. Season standings include accepted victories with daily=true and that seasonDay, using the same board computation as ordinary rankings.

Streak counts consecutive season days with at least one accepted daily victory by that account. Anchor at the inspected day if it is completed; otherwise anchor at its preceding day. If neither is completed, streak is zero. Repeated victories never add a second day.

#### Shared presentation

Each eligible replay has one PostgreSQL presentation initialized at version zero, tick zero and paused when it becomes eligible. Snapshot reads do not create additional records. Only the owner changes presentation.

Atomically compare expectedVersion. One concurrent writer wins, increments version once and stores tick and playing. Others receive the version conflict. Tick must identify an existing frame and may remain unchanged, advance, or restart at zero. Other backward changes are invalid input. Playing at the terminal frame is invalid.

Local controls change local playback. While sharing and playing, publish the computed cursor at least once per second. Pause and restart publish immediately. Stop publishing when sharing ends or the view closes. Server wall time never synthesizes combat or advances a stored cursor.

Followers reflect confirmed presentation changes and newly committed rankings within two seconds without reload across app processes. Database-backed polling is allowed. Read presentation and Board from the same database snapshot; the returned frame corresponds to its cursor. Preserve inspector identity, selection and focus. On version conflict, reload confirmed presentation before allowing another update.

#### Values and formatting

Persist charge, ledger deltas, breach counts, completion ticks, deployment counts and percentage numerators as PostgreSQL int8. Expose only exact integers within the JSON-number safe integer range.

Display milli-charge as whole charge units with exactly three decimal places. Use U+2212 for negative balances and no sign for nonnegative values. Do not clamp source debts.

Display ticks as `mm:ss.t`, where mm is minutes padded to at least two digits, ss is two-digit seconds and t is exactly three fractional-second digits. For example, 21 ticks displays `00:01.050`. Editor time and interval fields accept that form and send integer ticks. Reject times between simulation boundaries. Reapply conversions on every read, including reopened editor records, results, frames and rankings.

### Services (DP-02, DP-09, DP-14, DP-17, DP-19, DP-23, DP-25, DP-26, DP-30, DP-36, DP-38, DP-39)

**PostgreSQL:** Persist accounts, session hashes, campaign definitions, private revisions, tickets, staged evidence, verification states, proofs, append-only ledger entries, accepted metrics, unique completions, publication operations, index work, frozen daily selections and shared presentation. Enforce email, ticket-result, account-completion, challenge-digest and season-day uniqueness authoritatively.

Unavailable authoritative database operations return HTTP 503 with code `DATABASE_UNAVAILABLE` and message "Harbour records unavailable. Try again." Display that message through the error region. Never substitute process memory or browser storage for authoritative records.

**MinIO:** Use the supplied private bucket. Store canonical definitions at `levels/<levelDigest>.json` and evidence at `evidence/<evidenceDigest>.json`. Never replace a key with different bytes. Keep all objects private.

For the Community competitor, acceptance requires acknowledged object writes, subsequent server reads of both exact objects, digest validation and independent simulation from tick zero. Ignore claimed score, charge, health, unlocks and outcome. Queued writes and client outcomes grant no acceptance.

Replay and accepted-frame reconstruction read confirmed object bytes rather than silently using staged database commands. Publication reuses its proof's exact objects.

An object failure during submission or retry retains staged work and returns the API pending alternative. During publication it retains private proof-pending work and returns the publication pending alternative. Feedback states owns their copy.

Other object-dependent reads return HTTP 503 with code `EVIDENCE_UNAVAILABLE` and message "Replay evidence unavailable. Try again." Database-backed progress, result summaries and rankings remain readable.

Treat absent objects, corrupt bytes and digest mismatches as unavailable evidence. Keep affected verification or publication pending. Retry may restore an absent object from authoritative staged bytes; conflicting bytes cannot be overwritten. Objects stored before a database failure grant no accepted or public state.

**Meilisearch:** Use index `published_challenges`, with primary key `digest`. Documents contain `{digest,ruleset,title,description,difficulty,creatorName}`. Search title, description and creatorName. Configure difficulty and ruleset as filterable and title and digest as sortable. Disable typo tolerance so case and diacritic normalization can be inspected without approximate spelling matches. Use matching strategy requiring all query terms.

Send user text as a search value and construct typed equality filters; never accept raw filter expressions. Discovery must actually query this index. Hydrate returned digests from PostgreSQL and remove any no-longer-published records before responding.

Commit index work with publication or withdrawal, then await provider task confirmation asynchronously. `indexing` is pending while any committed discovery work is unconfirmed, otherwise current. Publication does not claim indexing completion.

Delete unpublished documents, including stale documents found during reconciliation. Reconcile pending work on discovery and maker reads and in a running process. Once the provider recovers, settle queued changes within five seconds without restart. A withdrawal immediately stops app-visible discovery even while deletion is pending.

Discovery provider failure returns HTTP 503 with code `DISCOVERY_UNAVAILABLE` and message "Challenge search unavailable. Try again." The rest of the app remains available. Do not return a fabricated empty search response. Publication and withdrawal may commit with indexing pending during an index outage.

### Seed data (DP-03, DP-04, DP-05, DP-06, DP-08, DP-18, DP-21, DP-34)

Every seeded person, business and place is invented. Start with no accounts, runs, private levels, published challenges, frozen daily selections or ranking rows. Do not seed a login.

Every encounter begins with reserve 120000 milli-charge and health 10. Harbour generation adds 1000 milli-charge whenever the resulting frame tick is divisible by 20.

Costs and upgrade prices are milli-charge; ranges and speeds are thousandths of a cell; cooldowns are ticks. Device order is number-key and percentage-tie order.

| ID and name | Silhouette | Cost / upgrade | Range / cooldown | Base effect |
| --- | --- | --- | --- | --- |
| wick, Wickwarden | Narrow tower with square light hood | 20000 / 10000 | 3500 / 10 | One same-lane hit for 12 |
| chime, Undertow Chime | Twin hanging bells | 30000 / 15000 | 2500 / 20 | Up to two same-lane targets, each hit for 10 |
| siphon, Brine Siphon | Three open tide cups | 25000 / 12500 | No attack | Generate 3000 at each harbour generation boundary |
| wall, Foldwall | Hinged zigzag plates | 15000 / 7500 | 1000 / no attack | Divide affected speed by two; upgraded divides by four |
| prism, Salt Prism | Faceted triangular beacon | 35000 / 17500 | 3000 / 15 | One same-lane hit for 9, ignoring armour |
| gong, Crosswake Gong | Circular gong on branching stand | 40000 / 20000 | 2000 / 25 | One hit for 8 among its lane and immediately adjacent lanes |

| ID and name | Silhouette | Health | Speed | Special rule |
| --- | --- | --- | --- | --- |
| mote, Foam Mote | Ragged teardrop | 24 | 30 | No armour or lane change |
| shell, Shingleback | Broad layered shell | 60 | 20 | Reduce ordinary hits by 4 |
| skipper, Seam Skipper | Split-finned crescent | 32 | 40 | After every 40 movements increase lane by one, wrapping to the first |
| mass, Wreckmass | Square driftwood knot | 120 | 15 | No armour or lane change |

Campaign descriptions equal their teaching topics. All cells are buildable except listed exclusions. Wave tuples are `(tick,creature,count,interval,lane)`.

| ID | Title / teaching topic | Difficulty | Seed | Exclusions | Ordered waves |
| --- | --- | --- | --- | --- | --- |
| c1 | First Lantern / Placement and forecast | calm | 1 | None | `(0,mote,5,80,3)` |
| c2 | Cup of Tide / Charge generation | calm | 7 | None | `(0,mote,6,60,2)`, `(200,mote,5,70,4)` |
| c3 | Bellwater / Multiple targets | calm | 19 | None | `(0,mote,10,30,3)`, `(240,mote,6,40,1)` |
| c4 | Shingle Reach / Armour | rough | 31 | Lane 2 cell 4; lane 4 cell 6 | `(0,shell,6,90,3)`, `(180,mote,6,50,5)` |
| c5 | Crossing Foam / Lane changes | rough | 43 | Lane 2 cell 4; lane 4 cell 6 | `(0,skipper,8,70,2)`, `(280,mote,6,50,4)` |
| c6 | Hinged Breakwater / Delay and salvage | rough | 59 | Lane 2 cell 4; lane 4 cell 6 | `(0,mass,4,140,3)`, `(240,shell,6,80,1)` |
| c7 | Storm Choir / Mixed defence | severe | 73 | Lane 2 cell 4; lane 4 cell 6 | `(0,mote,12,35,0)`, `(200,skipper,8,60,0)`, `(400,shell,8,80,0)` |
| c8 | Orrel Unbroken / Complete strategy | severe | 97 | Lane 2 cell 4; lane 4 cell 6 | `(0,mass,6,120,0)`, `(200,skipper,10,50,0)`, `(400,shell,10,70,0)` |

A new draft has title "Untitled harbour", empty description, calm difficulty, seed 101, all cells buildable and one wave `(0,mote,3,80,3)`. Add wave appends that default wave.

Practice uses the first campaign definition, all devices and the common starting values. Guide Wickwarden selection, an active-lane cell, preview and placement, then allow a local terminal outcome. Restart resets the entire practice state.

## Technical requirements

### Deployment (DP-37)

Use TypeScript with Node.js and a production dependency lockfile. Supply `/app/run.json` with string install, build and serve commands and this schema marker:

```json
{
  "_schema": "run-manifest-v1",
  "install": "npm ci",
  "build": "npm run build",
  "serve": "npm run start"
}
```

These commands install, build and run the app. Bind to `0.0.0.0`, default to port 4173 and honor `APP_PUBLIC_PORT`. Return HTTP 200 JSON `{"status":"ok"}` from `/api/health` whenever the process can serve requests, including dependency outages.

Apply schema, index settings and seed data idempotently on serve. Do not require build-time provider access or manual initialization. Support multiple app processes sharing the supplied services.

### Configuration and secrets (DP-37, DP-38)

Read `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `MEILISEARCH_URL` and `MEILISEARCH_API_KEY` at process start. Read the public-port setting when provided.

Require service settings explicitly, without `??` or `||` fallback expressions on service environment reads. Missing configuration produces an explicit startup diagnostic while static pages and liveness remain available. Dependent requests use their service-unavailable response until configuration is corrected by restart.

Never hard-code service credentials or bucket names. Never expose connection strings, provider keys, password hashes or session hashes in browsers or logs. Do not use observer credentials. Browsers contact only the app, not the three providers directly.

### Server boundary (DP-20, DP-36, DP-37)

Serve browser assets and API from one origin. Reject cross-origin mutations using the API error registry; do not enable credentialed cross-origin access.

For the Challenge maker's playtests, publication and verification, enforce these inclusive bounds:

- Five lanes with nine cells each, numbered from one.
- One through 40 waves and at most 600 scheduled creatures.
- At most 18000 completed ticks; command ticks range from zero through 17999.
- Required integer endTick from zero through the completed-tick bound; zero resolves no transitions.
- At most 2000 commands in a submission or command-check prefix plus proposal.
- At most 262144 bytes in submission and command-check request bodies, before parsing.
- At most 1048576 bytes in other JSON request bodies.
- At most 16 levels of JSON container nesting, counting the root container as one.
- Seed from one through 4294967295.
- Positive wave count and interval; nonnegative wave tick; last scheduled spawn within command-tick bounds.
- Wave lane zero or a valid board lane.

Reject byte excess before parsing or simulation with HTTP 413, code `BODY_TOO_LARGE` and message "This request exceeds the published byte limit." Other bounds use field validation. Use `endTick` for invalid endTick, `depth` for excessive nesting and the actual field path otherwise.

Return limit rejection within two seconds after the full body arrives. Validate types, nesting and aggregate wave and command limits before simulation. Custom definitions contain data only and cannot execute scripts.

Do not serve application source, development configuration, environment files, credentials, unrestricted object listings or private records outside authorized APIs. Keep static pages available when a dependency is unreachable at boot. Retry failed initialization on subsequent relevant requests without overwriting records or terminating the process.

### Browser support and performance (DP-32, DP-33, DP-37)

Support current Chromium, Firefox and WebKit with keyboard, touch and reduced motion at the reference viewports. Make a selected board usable within three seconds after required responses arrive. Acknowledge local selection within one tenth of a second. Return bounded verification or a truthful pending response within ten seconds. Bound provider calls rather than waiting indefinitely.

## Working rules

- IF-01: Supply the working run manifest defined in Deployment.
- IF-02: Include `THIRD_PARTY_NOTICES.md` listing shipped packages and bundled font licences; shipped packages means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Use only MIT, ISC, BSD-2-Clause, BSD-3-Clause or Apache-2.0 licences for shipped packages, SIL OFL-1.1 for bundled fonts and original procedural artwork.
- IF-04: Use only PostgreSQL, MinIO and Meilisearch as persistent services, without fallback datastores or fabricated provider success.
- IF-05: Preserve supplied service and evaluation configuration and do not use observer credentials.

## Engineering standards

- Use idiomatic TypeScript with explicit types at API, persistence and simulation boundaries.
- Use domain names that distinguish tickets, evidence, accepted results, revisions, proofs and published challenges.
- Decide each domain rule, arithmetic conversion and derived value in exactly one source location.
- Share one pure simulation module across browser play, forecasts, replay, frame production and server verification.
- Use one state-transition module per entity and keep ranking decisions exclusively on the server.
- Use direct code without abstractions that have only one implementation.
- Keep shipped source free of dead, commented-out or unreachable code and defensive branches for states excluded by validated boundaries.
- Use the documented error envelope consistently and ship only the described features, real provider operations and original procedural graphics.
