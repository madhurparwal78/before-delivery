# TRUTH — Perilune Ledger

The application preserves the supplied TypeScript build and repairs it in place. `instruction.md` is the product authority. Values marked **brief** come from its named sections; values marked **decided** fill only its visual or implementation silence.

## Product and boundaries

**brief: Problem and users, Out of scope.** One replay author reconstructs lunar flights from raw telemetry; readers inspect published replay capabilities. No accounts, payment methods, comments, orbital propagation, audio or additional services are present. The app has the Missions page, author console, public replay, fixed link-state pages and not-found pages only.

**brief: Deployment, Configuration and secrets.** Node.js 22, npm, strict TypeScript on server and browser, one origin, `0.0.0.0`, port 4173 or `APP_PUBLIC_PORT`. `run.json` runs `npm ci`, `npm run build`, `npm run start`. `/api/health` answers `{"status":"ok"}` independently of optional providers. Only Postgres is required at boot. All service URLs and credentials come from the exact environment variables in USER_README.md and the brief, with no credential or service-address fallback.

**decided: preserve the existing small architecture.** Native DOM controls and Canvas 2D carry the UI; Node HTTP serves the API and built assets. `pg`, `amqplib` and `ioredis` are the only runtime packages. Provider HTTP calls use Node fetch. Build tooling is TypeScript and esbuild. No capture or dossier is written to local disk.

## Ideal end-to-end journeys

### 1. First pass on a new mission, over a flaky link

**brief: Journeys 1; New mission; Upload; Pass state machine; Seed data.** Start on Missions with the seeded Tessera-3 link and Free Archive plan. Enter a mission name and GMT day-of-year epoch. An invalid epoch stays in the form, marks the field invalid with `Use GMT day-of-year: YYYY-DDD/HH:MM:SS.`, focuses it and sends no request. A valid epoch becomes an exact ISO UTC instant and creates a Postgres mission; its console shows `No passes on this mission yet` and `Upload a capture to draw the first ground track.`

Choose an unchanged capture whose filename includes Unicode. The browser computes SHA-256 and sends percent-encoded UTF-8 filename, checksum and one fresh request key. It shows `Uploading`, announces once, and fills an actual byte-progress rule. A request with no HTTP answer retries once after 1 second with the same bytes/key; an in-progress answer is retried once per second. MinIO must accept and read back the exact object with the same checksum before the pass becomes `stored`. That transition, its audit entry and `pass.parse` outbox row commit together. The UI announces stored/checksum verified once and polls the pass. RabbitMQ consumption parses it, confirms or records search writes, and atomically saves samples, lines, version, audit and webhook outbox. The disc and perilune appear; the parsed announcement and one ntfy alert reflect the real counts. Replaying the same request key creates nothing else.

### 2. Bad line and parser failure

**brief: Journeys 2; Capture line format; Parser failure; Broker; Push alerts.** Upload a capture with a 2,000-byte comment on line 3. The byte-identical object remains in MinIO; parsing rejects it at line 3 with `line_too_long`. The list and Upload status show the published reason; one warning push is sent. Uploading a centre-of-Moon sample causes a genuine parser failure. The consumer rejects with requeue, RabbitMQ's quorum delivery limit dead-letters it into both configured dead queues, and the failed queue consumer settles it once as `parser_failed`, with no line number and one urgent alert. Original downloads remain exact. Keyboard Delete opens the designed confirmation with focus on Keep pass, traps Tab and supports Escape. Confirmation removes the settled pass everywhere and returns focus to Passes. A corrected file then follows the normal upload path.

**decided: RabbitMQ 4.4 transport semantics.** Use `basic.reject(requeue=true)` for genuine parser failures; `basic.nack` no longer increases the broker's delivery count. The app does not publish to the dead-letter exchange itself or keep an application delivery counter.

### 3. Inspect, replay and pin

**brief: Journeys 3; Pointer; Keyboard on the slider; Playback; Pin event; MET.** Open seeded Tessera-3 at the first sample. Focusing Track loupe opens a 160×160 CSS-pixel lens at that sample, showing the scene at 4× with a crosshair. Arrow keys step one; Shift+arrow steps 60; Home and End select ends. The plate, oversized MET, slider value text and current transcript line follow within a tenth of a second. Key-up writes `t` while preserving all other address parameters. Transcript scrolling changes only its own list.

Go to GMT accepts exact station-log day-of-year notation, converts independently of browser time zone and snaps at or before the instant. Play at 1×, 10× or 60× uses only the monotonic page clock, the specified 10/25 fps grid and server frame values. Pause shows the snapped sample and writes its moment. Reduced motion shows samples only. Enter on the track opens Pin event, prefills MET and focuses Title. A typed MET is checked before any request. Save uses the opening's single request key; double-save produces one public event at its snapped sample, one search document or pending write, one audit/version/webhook and one success announcement. Private note remains author-only. Focus returns to the opener.

**decided: bounded frame transport.** Fetch inclusive whole-second chunks of 119 seconds so the 25fps request has 2,976 frames, below the brief's 3,000 cap, and the next chunk stays on the same grid.

### 4. Units, landmarks and reference on a tablet

**brief: Journeys 4; Channels; Landmarks; Reference; Display formats.** At 768px, open Channels by keyboard: it is modal, focus starts on checked Distance, Tab wraps, and Escape/Close returns to Channels. Select nmi and ft/s. Only the changed unit member is sent as a merge patch. The plate, Events and perilune update from immutable server SI values and a new share view starts in those saved units. The closed drawer is hidden and inert.

Type a landmark name and hemisphere coordinates. Invalid coordinates show their exact field errors without a request. A valid addition writes one Postgres landmark, audit and version; it appears in creation order, as a visible rust square when on the near side and as a shared great-circle range line. Full Unicode canonical caseless matching refuses equivalent names. Remove deletes the mark/range/list item and focuses Landmark name. Up to five landmarks are admitted under one locked domain rule.

Set a reference target. The server fetches all Link-paged vectors from WireMock, converts kilometres and km/s to SI, and records the reference. The plate gains ΔR, which matches a fresh share page, CSV and dossier. Refresh revalidates with ETag and honours both Retry-After forms. Unknown target refuses without trace; unavailable/malformed/slow answers preserve the replay with unavailable reference and dash residuals. Clearing uses `reference_target:null`, removes vectors/residuals and hides ΔR. Sets, refreshes and clears serialize per mission; sample settlement reads reference state under the mission row lock.

### 5. Search while working

**brief: Journeys 5; Search; Search refresh; Latest query wins.** Type a phrase. After a quarter-second pause the address gains trimmed `q`, pending copy appears and the current query's final count is announced once. Earlier responses and refreshes are discarded if query/token no longer matches. Results contain only this mission's live transcript lines and public event titles in MET order. Speakers list each exact speaker string and count, ordered by descending count then Unicode code point; names such as `__proto__` are ordinary data.

With the phrase in the box, pin a matching public event. Search confirms or records the new write, then refreshes results in place and announces the new count without changing text, caret or focus. Selecting a result moves lens sample, plate, current line and `t`, preserving `q`. Deletion removes that pass's lines/events and refreshes results. Private notes and landmarks never enter Meilisearch.

### 6. Full archive, upgrade and deletion

**brief: Journeys 6; Archive plan; Storage quota; Billing; Deleting a pass.** Free quota is 268,435,456 bytes. Upload reservations include every non-deleted pass across all missions. Concurrent admission is serialized; exact quota is allowed and over-quota is refused with used/quota bytes and exact UI copy. Billing being down does not lower the last confirmed quota.

Choose Archive 1 GiB and Change plan. Kill Bill creates/reuses `perilune-author`, creates/changes the base subscription and computes the invoice. The app waits for the chosen plan and charged-through date before saving its confirmed quota. Price, next date and balance show the plan answer; money uses integer cents and exact decimal conversion. Retrying the refused upload under its absent key succeeds against the new quota.

Delete a settled pass through its keyboard dialog. Storage is checked before search. Refusal leaves the pass, original bytes, mission version/audit and public notices unchanged. Success confirms search and object removal before committing the deleted state, removes samples/lines/events/pending writes/parse outbox rows, appends one deletion audit/webhook/version and frees bytes. Same-pass concurrent deletions yield one success and gone responses. A shared per-pass lock prevents indexing or pinning after deletion. Earlier audit hashes never change.

### 7. Checked replay across instances

**brief: Journeys 7; Share links; Change stream; Readers; Downloads; Webhooks.** Add a valid club subscriber URL; Svix confirms its endpoint before the subscriber/audit is saved. Three endpoints maximum, serialized per mission. Create a share with typed day-of-year expiry or its exact 30-day default. A cryptographically random capability authorizes reads only. Its token never appears in audit/webhook data.

A reader on another instance/time zone opens the link. It starts in saved units unless valid unit address parameters override them independently. The open EventSource creates a Valkey reader key, renewed before its 30-second expiry; the author sees its count within five seconds. Reader GMT navigation, local unit changes, search and playback do not mutate the mission. Capture range/full downloads remain byte-identical, with strong ETag, Repr-Digest and RFC conditional/range rules. Event CSV uses current reader units, CRLF records, RFC quoting and formula neutralisation. The Gotenberg dossier uses the same shared formats and bundled fonts; public PDFs omit notes.

An author change commits its hash-chain entry/version/outbox and Postgres notice. Every instance's share stream sends exactly that version; readers refetch in place, preserve their view/drafts/focus and see the change within five seconds. Svix receives one public signed change message. Closing the page immediately deletes its reader presence and releases server work. Revocation ends the stream after its final change and displays the withdrawn page. Expiry displays the expired page and refuses every subsequent share route. Replacing kills the old capability.

**decided: real Svix compatibility.** The outbox event id retains `<mission id>:<version>`. Real Svix accepts only letters, digits, hyphen, underscore and dot; transport uses `<mission id>.<version>` in `eventId`. Public payload fields and version are unchanged. This is disclosed rather than claiming the rejected colon can be delivered.

### 8. Outages and recovery

**brief: Journeys 8; Every dependency; Feedback states; Services.** Storage-down consoles show the published storage banner. Upload/delete/capture-download return storage 503 with exact copy; playback remains available. Failed uploads remove admission and request key; retry after recovery succeeds without restart. Search outage shows its banner, refuses search and deletion, and accepts uploads/pins with pending writes. Catch-up retries at the configured interval and before search, checks source liveness under the same pass lock as deletion and never revives a deleted document. Landmarks remain writable and never indexed.

Queue outage still permits storage-confirmed 202 with the queued announcement; transactional outbox rows wait and relay oldest-first after reconnect. Storage-unreachable parse delivery is acknowledged and resets its outbox sent marker, never consumes the parser failure budget. Gotenberg outage refuses dossier generation within ten seconds. Valkey outage serves share reads without a limit and reports unknown reader count. Billing outage refuses plan changes and preserves quota. Svix outage preserves changes/outbox and sends each once after recovery, but refuses endpoint changes. ntfy failures are dropped after one attempt with no later retry. Status checks clear banners automatically and never disturb focus, dialogs, drawers, drafts, search, moment or units.

**decided: multi-instance scheduling and outbox races.** Global relay locking preserves oldest-first publishing across instances. Fully available parse workers have higher RabbitMQ consumer priority, determined by real storage/search/push probes at connection. Lower-priority workers remain consumers and work when no fully available worker is free. Outbox rows are locked through publisher confirm and sent-marker commit, preventing a fast consumer's retry reset from being overwritten. Mission audit locking uses `FOR NO KEY UPDATE`, which serializes sequence allocation while remaining compatible with foreign-key key-share locks. Schema application is serialized for simultaneous boot.

## Seed and exact calculations

**brief: Seed data.** One Tessera-3 mission, epoch `2026-03-14T00:00:00Z`, default km and m/s, and `tessera3-orbit1.cap` with 720 samples at ten-second intervals and six invented transcript lines. The capture is generated from the brief's orbit equations and one-decimal half-away rounding, starts with its three specified comments, uses LF and ends with LF. Seed request key is `seed-tessera3-orbit1`. The sample at k=360 has MET 7200 and altitude 20.0 km; event `Perilune pass` carries the exact author-only seed note. Seeding stores/queues/parses normally, preserves change_version 0, sends no webhook/push and appends the four specified audit entries.

**brief: Business rules, Display formats.** Mean lunar radius 1,737,400m; nmi 1,852m; ft 0.3048m. SI derivations are stored once; display conversion and half-away rounding have one shared implementation. Altitude/range/residual show one decimal; speed shows whole units; coordinates show two decimals and hemisphere letters; rounded zero has no minus. MET uses whole seconds and `+DDD:HH:MM:SS` / `T-DDD:HH:MM:SS`. GMT uses exact UTC day of year. Hermite interpolation, held gaps above 600 seconds, half-even frame grid, coordinate entry, CSV safety, JCS canonicalisation, I-JSON checks, money and binary sizes each have one owner shared by their consumers.

## Palette roles

All colour hex values below are **decided: warm regolith instrument interpretation of brief: Visual design / Colour**, except forced-colour names, which are **brief: Forced colours**.

| Role | Hex | Use |
|---|---|---|
| Warm ground | #d9d4c7 | Page, plate, dialogs; no pure white |
| Sunk ground | #cfc9ba | Fields and disc |
| Ink | #17150f | Text, primary fills |
| Secondary | #514c3d | AA labels and secondary text |
| Rust | #a7471b | Track, loupe rim/crosshair, perilune, pins, landmarks, byte rule; never small text |
| Signal | #2f3f66 | Links, focus and current line |
| Hairline | #8d8678 | Rules and graticule |
| Maria | #b9b2a2 | Procedural patches at 0.55 opacity |
| Error text | #8a2d12 | Field errors in words |

Forced colours draw Canvas fill, CanvasText track/perilune/crosshair, Highlight rim, LinkText pins/landmarks, GrayText graticule and omit maria. They are resolved from computed system styles at draw time. Source: **brief: Forced colours**.

## Type, space and responsive layout

**brief: Type and Mood and numerals.** Archivo headings, IBM Plex Sans body, IBM Plex Mono tabular numerals/readout, all locally bundled. **decided:** body 16px/1.45; heading steps 1.33rem, 1.77rem, 2.37rem with 1.15 line height; plate 0.95rem, mono labels 0.78rem; wide MET 5.2rem/1 at weight 500. Phone MET is 2.925rem (two scale steps down), medium 3.9rem. Tracking fits the full label and long day values can wrap without clipping. The phone band puts Channels above MET, with both controls inside it.

**brief: Density, composition and Size/focus.** No shadows, gradients, rounded cards or decorative background images. Hairline pane/table rules; 44×44px minimum controls; 2px blue focus outline. **decided:** 4px spacing base with 8/12/16px gaps, 12px console margins, 16px Missions margins, 1px rules and 2px focus offset. The initial complete data view becomes visible only when its actual data and local font promises finish; aria-busy states the pending view, without a timer or overlay. Missions prose measure is 40ch, centred; its heading aligns to the same 400px column. Label/input pairs remain grouped when forms wrap.

| Viewport | Concrete layout | Source |
|---|---|---|
| 375×812 | One column in the exact published order; sticky MET/Channels; square disc, docked plate, GMT/play/pin, Transcript then Events and remaining regions; closed modal Channels drawer | brief: Published layouts |
| 768×1024 | Sticky full-width band/header/banners; left two-thirds square track, right third plate/GMT/play/pin; remaining regions full width in order | brief: Published layouts |
| 1280×800 to 1920 wide | 12 columns: permanent Channels 2, centre 7, Transcript 3; all pane tops visible; no sticky band or Channels button; plate floats inside centre | brief: Published layouts |

Only 768 and 1280 change the published console layout. **brief: Breakpoints.** Canvas width is `min(100%,72vh)` with a strict 1:1 CSS surface and backing store CSS size × actual DPR. **decided: square disc constrained by available height as required by Disc geometry.** A pointer picks only the nearest visible projected sample within 24 CSS pixels; exact picking is shared with touch at every DPR. Events is itself focusable and horizontally scrolls all columns. Sticky-band measured height drives scroll padding. The plate may overlap only the wide slider, never another control. **brief: DP-66/67 and Published layouts.**

## Motion table

| Element / trigger | Duration and easing | Reduced substitute | Source |
|---|---|---|---|
| Lens enter/leave | 200ms ease-out scale/opacity; full diameter 160px | immediate full-size appearance/removal | brief: Lens |
| Lens snap | 200ms ease-out position | immediate jump | brief: Lens |
| Changed digit | 250ms ease-out translateY/opacity, direction follows change; unchanged digits still | in-place value | brief: Numeral roll |
| Current line | 200ms opacity rule, list-only scroll below 500ms | immediate rule and list position | brief: Current line |
| Channels | 250ms ease-out horizontal transform, then hidden/inert | immediate | brief: Drawer |
| Banners/dialogs/results/push/plan/count updates | opacity only, at most 200ms | immediate | brief: Motion and effects |
| Byte progress | real bytes sent, non-looping width | same | brief: Upload progress |
| Playback | each animation frame, no slide or roll | snapped samples, same monotonic timing | brief: Playback |
| Hover/press | 120ms named colour/rule transitions | immediate colour | decided: restrained instrument feedback |

Nothing moves while idle. No transition uses `all`. Playback reads no wall clock. Source: **brief: Motion and effects, Engineering standards**.

## Async states

**brief: Feedback states.** Exact copy is centralized in shared/copy.ts; the brief's named Upload, Search, Console, Download and Plan status regions announce once per action. All field errors appear adjacent, describe their field and mark it invalid. No browser alert/confirm/prompt/Notification is used.

| Action | Pending | Success | Refusal/outage treatment |
|---|---|---|---|
| Upload | Uploading list entry, determinate rule, named status | Stored only after checksum confirmation; Parsed or Rejected with exact counts/line/reason | Exact duplicate/quota/size/validation/storage copy; no retained failed key |
| Search | Searching only on typed/initial query; refresh has no pending copy | Current-query count replaces results in place | Search offline copy/banner; old replies discarded |
| Pin | Pinning event; disabled Save | One snapped event and announcement; return focus | Dialog stays with first field error focused |
| Landmark | Real submit only | Added/removed exact status and list/map/range update | Field/conflict errors under name/coordinates |
| Reference | Fetching target except clear | Ready/unchanged/unavailable/cleared exact messages | Unknown target field error; unavailable shows dash residual |
| Units | Immediate view from shared SI formats | Saved units exact confirmation | Save-refusal copy preserves previous share defaults |
| Share | Expiry checked locally | Ready/replaced/revoked exact confirmation | Field error, unchanged capability on refusal |
| Subscriber | Add disabled while pending | Confirmed endpoint/list change and exact status | Field/conflict or webhooks-offline copy; retained item on failed removal |
| Plan | Changing plan; radios/button disabled | Confirmed plan lines and exact success | Previous lines/radio retained, exact too-small/offline copy |
| Delete | Deleting and disabled dialog controls | One deletion, views refreshed, focus Passes | Dialog closes, item stays, focus Delete, exact storage/search/conflict copy |
| Download | No artificial pending | Browser attachment, page remains | Exact named Download status; no navigation |
| Status/streams | No disruptive pending UI | Banners/count/public changes update in place | Only documented service effects; automatic recovery |

## Media and licences

**brief: Fonts; Lunar disc.** Six Latin WOFF2 faces from Fontsource 5.3.0: Archivo 400/600, IBM Plex Sans 400/600, IBM Plex Mono 400/500, all under the SIL Open Font License 1.1, self-hosted and sent to the renderer. Full OFL texts and all runtime/build/transitive package notices are in THIRD_PARTY_NOTICES.md.

**decided: code-drawn instrumentation.** The orthographic Moon, procedural maria, graticule, ground track, reticle, pins, landmark marks and magnified loupe are original Canvas/CSS work. No downloaded photograph, texture, icon set, audio, video or model is used. Unicode 17.0 C/F case-fold data is generated into TypeScript and credited under Unicode-3.0. No browser asset or source file references a third-party origin.

## Verification and explicit limitation

The install/build/typecheck and browser/provider results are recorded in PLAN.md and selftest logs. The reference suites are unmodified and are invoked against real services; probes and all tooling remain outside app/. Fresh design, visual and code critiques are recorded at the work root. Local provider overrides are separate from the unchanged environment definitions. All local instances/services are stopped at handoff.

**brief: API Plan (line 808), Archive plan money (line 1162), Billing (line 1557).** The app asks Kill Bill for `accountWithBalance=true`, because Kill Bill returns `accountBalance:null` without that flag, and converts the returned decimal account balance to integer cents. After billing confirms a change, the app also waits up to 5 seconds for the change's invoice, then reads the balance, so a Plan answer never reports the balance from before that invoice.

## Final measured outcome

**decided: collected verification evidence, not additional product values.** Node 22 unprivileged install/build/serve and strict/no-unused TypeScript checks passed. Focused post-change checks passed six time-entry journeys, six unit/address/live/timer journeys and four disc/accessibility cases. Eight final page probes recorded CLS 0, overflow 0, no axe violations, no script/request errors and no targets smaller than 44px. Final seed-console readiness was 0.125/0.107/0.131/0.114 seconds at 375/768/1280/1920. The own-sample/idempotency/audit and reader-default-unit live checks passed. Dependency notices were checked against the actual build/tree. Critic findings are closed in their reports.

## Current handoff repairs and provider qualification

**decided: evidence-based revalidation of the carried build.** Fresh design review held the design decisions. Fresh source review identified and closed URL error handling, share initialization/reconnection gaps, virtual-host S3 destination signing, full-response dependency failures, ephemeris envelope validation, Pause/display snapping and unbounded frame counting. The native file-selector button now uses ink/ground tokens and 44px height; maria use deterministic irregular contours in the same existing shade/opacity. These are refinements of **brief: Colour, Lunar disc, Services, Playback, Server boundary**, with no new product features or media.

**Dispute DP-98 — brief: Webhooks per change (line 1319), Webhooks (line 1567).** The exact colon-form eventId is rejected by the supplied real Svix service's identifier alphabet. The application retains the exact colon id in Postgres/outbox/broker and transports it to Svix with a dot separator, preserving mission/version and service idempotency. The signed public payload is unchanged and excludes private notes. This operational compatibility choice does not satisfy the brief's literal transport eventId; DP-98 is therefore qualified/disputed, even when the webhook behavior tests pass. No provider validation or service definition is altered.

Current local execution uses `perilune-golden-local` because the literal `golden-local` Docker project belongs to another workspace on this machine. Every service image, development credential and definition remains the supplied one. Local port overrides and tooling stay outside app/. The final measurements and teardown are recorded below when complete.

## Current measured outcome

**decided: current verification evidence.** Seven IF checks pass after the final notice correction. Strict/no-unused TypeScript, generated JavaScript and Python syntax, source equality and all installed production-package notice coverage pass. Extra client/provider boundary assertions, malformed URL/Host refusals, database-listener reconnection and bounded century-wide frame requests pass. The final 24 page/viewport probes have CLS 0, overflow 0, no axe/script/console/request errors, no third-party browser requests, no reduced-motion activity and no targets below 44px. The designed not-found page correctly contributes four HTTP 404 document responses. Focused console readiness is 0.192/0.232/0.177/0.209 seconds at 375/768/1280/1920. Fresh critics close every finding. The bundle's full suite on the published app is proven by the Harbor oracle trial.

**brief: API Plan / Billing, current evidence.** Kill Bill returns null without its balance-query flag and a numeric balance with the flag; the app's integer cents equal the requested balance. Evidence: `selftest/current-provider-balance-evidence.json`. The literal Svix identifier refusal is recorded in `selftest/current-svix-identifier-evidence.json`. DP-98's literal transport identifier remains qualified and is not claimed complete.

Current teardown is complete: eleven app ports closed; test container and isolated provider project removed, including volumes; temporary credential files deleted. Other workspaces' services were untouched. No capture, PDF, database file or node_modules ships in app/. The one qualification is DP-98, above.
