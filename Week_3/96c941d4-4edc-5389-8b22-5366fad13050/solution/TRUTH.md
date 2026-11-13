# TRUTH — Squallglass

The product authority is instruction.md. Source: brief: Bellwake Games Squallglass. This file records intended behaviour and concrete presentation, with no test-only product values.

## Ideal journeys

### 1. Arrive, learn and earn

Source: brief: Journey 1; Account / Tutorial / Campaign / Loadout / Defence / Result; Seed data.
Start signed out with no account or progress. Create an independently chosen account using Email, Player name and Password; PostgreSQL stores the normalized unique identity, irreversible password hash and session hash. The HttpOnly squallglass_session cookie identifies the keeper. Successful authentication opens Campaign. Open Tutorial and Begin practice, select Wickwarden, select an active-lane cell, Plan, Preview and Place using separate activations; complete local practice. No ticket, completion or ranking is created. Sign out revokes that session, then sign in restores the same identity. Inspect First Lantern and all ordered campaign gates; choose one through four unique devices, and Start defence requests an immutable campaign ticket. Compare placement forecasts, confirm a legal command with the server, reach a local terminal frame and Submit result. MinIO receives canonical definition/evidence objects and the server reads both, verifies digests, reproduces from zero and commits one result, append-only ledger and qualifying completion in PostgreSQL. Read session, run, result, terminal frame and progress; browser values use exact formatting, and practice contributed nothing.

### 2. Plan a conserved defence

Source: brief: Journey 2; Integer simulation; Charge and commands; Forecast, keyboard and motion.
Start with a fresh campaign ticket. Plan freezes the full state including counters, RNG, cooldowns, balances and waves. Preview two deployment cells from that same state; cancel one and confirm the other through Preview then Place. Cancellation spends nothing. Upgrade and salvage use explicit cost/refund preview and confirmation; new deployments receive increasing shared entity IDs, upgrades preserve cooldown and salvage removes identity while retaining ledger history. Complete and submit. Compare every command-free forecast transition and numbered contact with frames; reconcile paired equal-and-opposite transfers, reserve plus installed plus sink against the negative source balance. Every transfer uses integer milli-charge and an increasing movement ID. Invalid commands stop at first failure; earlier legal transfers in the same unresolved tick remain in the ledger while no incomplete frame is exposed.

### 3. Recover verification and return

Source: brief: Journey 3; Tickets, revisions and transition tables; Services.
Start a new ticket, finish locally, stage canonical evidence, repeat identical evidence and retry pending work. One durable evidence digest owns the ticket; different evidence conflicts. During MinIO failure, submitted work remains pending with null metrics/failure and no accepted effects; retry uses the staged bytes, restores absent objects without replacing conflicting bytes, reads and reproduces independently, then commits once. Submit a separate illegal log; its result exposes the first tick, sequence and command reason, its legal-prefix ledger remains inspectable and it grants no effect. The account remains usable. Sign out/in and read both results, progress, ledger and any qualifying board from PostgreSQL. Claims never influence acceptance.

### 4. Make, revise and prove

Source: brief: Journey 4; Private revisions; Seed data; API.
Create a new unsaved Untitled harbour draft (seed 101, calm, all 45 buildable cells, default wave), edit title/description/difficulty/seed, cells and displayed wave times, then save. PostgreSQL creates private revision one and its immutable saved revision record. Reopening converts integer wave times back to mm:ss.SSS. Playtest requests the current saved definition, revision, seed and loadout; unsaved edits do not alter it. Forecast, play and submit its evidence. A reproduced current-revision victory qualifies its proof and, if the private association is empty, pins the first qualifying run. Save a revision; optimistic expectedRevision gives one concurrent winner, increments once and makes pending/verifying/qualified older proofs obsolete. Old ticket snapshots remain unchanged and old proof history remains visible; only an accepted winning proof for the current saved revision can publish.

### 5. Publish across interruption

Source: brief: Journey 5; Publication and rankings; Services.
Start a private saved revision and a matching qualified proof. Publish pins the chosen proof in proof-pending. Pending state remains private and retryable. Confirm exact canonical definition and proof evidence objects, validate digests, then atomically commit the unique challenge publication and index work in PostgreSQL. Only then can detail reads or new tickets expose playable content. Meilisearch confirmation is independent and indexing may remain pending. Repeat an identical committed operation to read its stored challenge without another publication. Withdraw a separate private level: it disappears even from its owner's list/detail, creates no public history and leaves independently addressable tickets. Withdraw a published one: it becomes unlisted, disappears immediately from discovery and detail/ticket issuance, while historical boards and eligible replays remain.

### 6. Discover and attempt original rules

Source: brief: Journey 6; Indexed discovery; Publication and rankings.
Begin Community with independently published challenges. Search is a real Meilisearch query across title, description and creatorName; case/diacritic normalization uses the provider, typo tolerance is disabled, matching requires all terms and difficulty/ruleset filters are typed enums. Typing alone edits local input; Search, Refresh challenges and filters execute requests. Hydrate provider digests from PostgreSQL and remove withdrawn results; return title/digest ordering. Open a challenge, issue a challenge ticket bound to its exact original definition, play, verify and read the Board. Only accepted challenge victories qualify. Distinct accounts contribute their best metrics; deploy counts include later-salvaged devices. Withdraw a separate published challenge and refresh; it vanishes even if provider deletion is still pending. Index recovery settles committed work without process restart.

### 7. Compare a season boundary

Source: brief: Journey 7; Season days; Values and formatting.
Create two independent competitors and a proved published challenge. Submit victories with equal metrics and repeat with different crews. Ordinary and daily boards use the same server ranking computation: fewer breaches, earlier completion tick, greater reserve; one best per account, earliest committed result on equal metrics, competition ranks and account-ID order for ties. Completion counts are distinct qualifying accounts. Largest-remainder crew usage follows device order and sums to 1000 tenths when nonempty. Inspect explicit offset-bearing instants on both sides of Kathmandu local 05:00; API returns normalized UTC instant, +05:45 local time, common seasonDay, frozen daily digest, daily standings and authenticated streak. The day's first season read or challenge ticket transaction freezes sorted-digest selection; later publication/withdrawal cannot replace it. Ticket issuance, never inspected time or submission, binds daily qualification. Streak anchors to inspected completed day or preceding day. Current-time visible season values refresh at most 30 seconds apart; explicitly inspected instants remain fixed.

### 8. Study together across processes

Source: brief: Journey 8; Shared presentation; API replay eligibility.
Start with eligible accepted evidence (campaign; historical published challenge; or the exact committed proof run). Its owner opens Replay and Share playback. A second signed-in viewer through a second app process opens the same run and Follow playback. PostgreSQL owns version/cursor/playing state, with one winner for expectedVersion writes; snapshots read playback and rankings from one transaction snapshot, then reproduce the exact frame from confirmed MinIO objects. Advance forward, pause, restart at zero; no arbitrary seeking. While sharing/playing publish at least once a second; followers and ranking surfaces poll every 750ms. Open a crew inspector; preserve its installation identity and focused Close inspector through cursor and board changes. If the installation disappears, retain its identity and show absence. Stop following restores local presentation. Closing Replay stops its timers. Outages retain last confirmed state, mark Stale and announce the dependency error once until recovery.

## Palette roles

Source: brief: Visual design defines sea, timber, paper, lavender and exclusive amber roles. Exact hex values are decided to provide the intended materials and AA contrast.

| --sea-deep | #06282f | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |
| --sea | #0d3b45 | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |
| --sea-line | #16525e | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |
| --pier | #d8c2a0 | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |
| --pier-dark | #8f7650 | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |
| --paper | #fbf7ee | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |
| --ink | #17262b | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |
| --ink-soft | #3d5158 | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |
| --storm | #cfc4ec | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |
| --storm-dark | #534677 | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |
| --amber | #b06c00 | decided: Amber exclusively for offensive emitters, beams, placement silhouettes, forecast traces and contacts. |
| --amber-bright | #ffc962 | decided: Amber exclusively for offensive emitters, beams, placement silhouettes, forecast traces and contacts. |
| --rank | #1f514e | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |
| --alert | #8c2f2a | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |
| --focus | #0f5f7c | decided: Sea/pier/paper/storm/ink role named by token; maintain AA contrast. |

Amber appears exclusively on offensive emitters/attack beams, proposed silhouettes, cast traces and contact marks. Paper is the focus ring on sea; --focus is the ring on paper. Error text uses --alert on paper and lavender on sea. Source: brief: Visual design; decided: accessible focus/error material pairs.

## Typography, space and layout

Source: brief: Visual design names Bricolage Grotesque headings and Atkinson Hyperlegible reading text. Decided: locally bundled 600/700 headings and 400/700 reading weights, 16px/24px body, 32px product and 24px sections, 18px subheadings, 14px metadata and 12px minimum labels; 65ch prose. Numeric readouts use tabular numerals. Source: brief: headings about twice/one-and-a-half body; decided: readable compact scale.

Source: decided: 4px spacing unit with 8/12/16/24/32px rhythm, 6px controls, 8px panels, 1px rules, 2px chart edges and 3px focus ring with 2px offset. Controls and cells are at least 44×44px (brief: Visual design). The chart has a 630px intrinsic surface inside a 350px-high panning viewport; source: decided: retain usable geometry without shrinking cells. Account combines an original five-pier harbour engraving with a compact paper identity form. Empty working records explain their absence without seeded accounts.

| Breakpoint / reference | Reading and visual order | Source |
|---|---|---|
| <768px / 375×812 | Board, manifest, crew, actions, personal best/completions, leaderboard | brief: Screens and layout |
| 768–1279px / 768×1024 | Board, crew, leaderboard, manifest, personal best/completions, actions | brief: Screens and layout |
| ≥1280px / 1280×800 | Board beside narrow manifest; crew/actions below; comparison leaderboard beside replay, summaries below | brief: Screens and layout |

No body/page horizontal overflow. The board pans/zooms within its region; selected coordinates and confirmation stay outside its panning surface. Tables scroll within focusable regions with sticky headers. Source: brief: Screens and layout. Account form and illustration stack below 768px; navigation becomes a three-column, two-row grid; source: decided: readable 44px controls.

## Motion table

| Element | Trigger | Duration | Easing / properties | Reduced motion | Source |
|---|---|---|---|---|---|
| Beam | Preview | 180ms | linear scaleX reveal | immediate final beam | brief: Forecast, keyboard and motion |
| Contacts | beam end | 260ms | linear opacity reveal | all marks immediately | brief: Forecast, keyboard and motion |
| Ready phase | reveal ends | 0ms | final static cast | same | brief: Forecast, keyboard and motion |
| Dialog panel | opens | 240ms | ease-out opacity/translateY | immediate | decided: below brief's half-second bound |
| Hover/press | pointer | 160ms | ease background-color/transform | immediate darkening | decided: below brief's quarter-second bound |
| Creature | computed tick | 50ms at 1x; 25ms at 2x | linear left/top | discrete computed positions | brief: 20 fixed ticks and interpolation; decided: speed-matched presentation |

Pause and Planning stop interpolation at computed positions; cancellation clears cast immediately. No decorative loops, scroll reversal, 3D or wall-clock simulation inputs. All computed transitions are 0s and animations removed under reduced motion. Source: brief: Motion and effects / Forecast, keyboard and motion.

Both branches share the actual pier: solid P / Proposed command versus dotted N / No command. Contact badges carry the branch letter and event number with collision spacing and leader lines; damage is a diamond, death a cross and breach a square. Hatched placement and ruled cell boundaries remain independently readable. Cost, endpoint time/reserve and the event table repeat the same branch key. Source: brief: DP-45; decided: 22px badges, 24px collision spacing and leader rails.

## Async action states

Source: brief: Feedback states. Status Harbour status is polite; Harbour error is an alert. Pending controls use aria-disabled/aria-busy and block activation without dropping focus. Feedback persists until the next action, while successful background reads do not overwrite it. Field errors appear beside inputs and in the alert using API paths.

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


Source: brief: Feedback states. Practice: “Practice complete. No ranked result is submitted.” Accepted victory: “Verified victory – your strategy's recorded.” Accepted defeat: “Verified defence ended.” Rejection uses its stored tick/reason and sequence, and explicitly says the account remains available. Pending evidence: “Evidence storage unavailable. Verification is pending; retry this result.” Pending publication: “Publication pending. Your challenge is still private; retry publication.” Committed publication: “Challenge published.” Indexing is independently pending/current using the exact published copy. Preview announces “Preview ready.” and cancellation “Preview cancelled.” Field messages are “Use a permitted value.” with their API field paths.

Source: brief: Services. Database unavailable is 503 DATABASE_UNAVAILABLE / “Harbour records unavailable. Try again.” Evidence-dependent reads are 503 EVIDENCE_UNAVAILABLE / “Replay evidence unavailable. Try again.” Discovery outage is 503 DISCOVERY_UNAVAILABLE / “Challenge search unavailable. Try again.” Liveness and static assets remain available. Staged evidence and publication remain pending with no fabricated acceptance/public state. There is no persistent fallback.

## Media and licences

Source: brief: Visual design and IF-02/IF-03. All piers, stippling, timber rules, devices, creatures, engraving, beams and contact marks are original procedural SVG/CSS in app source, licence original. No external photographs, stock images, video, audio, models or browser CDN requests. Fontsource 5.3.0 supplies local Bricolage Grotesque 600/700 and Atkinson Hyperlegible 400/700 Latin/Latin-ext WOFF2 under OFL-1.1. app/assets.json records every binary's path, SHA-256 and source; font licence texts are local and reproduced in THIRD_PARTY_NOTICES.md. That notice inventories all production and build dependencies with versions/licences/copyrights. Source: decided: native DOM/SVG keeps the shared TypeScript core and small build; pg 8.16.3 (MIT) is the sole production direct dependency, with TypeScript/esbuild and type packages as pinned build tools.

## Provider and source boundaries

Source: brief: Services / Deployment / Configuration / Engineering standards. PostgreSQL stores identities, revoked sessions, campaign definitions, immutable saved revision history, tickets, evidence staging, results with int8 metrics, append-only ledger, proof/history, publication/index work, frozen daily selection and shared presentation. MinIO stores private immutable levels/<digest>.json and evidence/<digest>.json. Meilisearch published_challenges supplies real search. One shared pure simulation handles browser play, forecasts, frames, replay and verification. Per-entity transition modules own runtime decisions and Rules tables; server-only rankings and shared formatting each have one source. Startup uses an advisory-lock transaction for schema/seed and retries failed relevant initialization. The same-origin Node server honors APP_PUBLIC_PORT (default 4173) and reads only the named provider settings; run.json supports cold npm ci/build/start without build-time service access.
