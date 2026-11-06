# Quarrystone Strata

Strata is a self-hosted data governance catalog for regulated analytics teams at mid-size health plans and credit unions. Data stewards use it for five jobs:

- tag sensitive columns, one at a time or several at once
- suppress a tag on a column whose values have been de-identified, and record why
- trace column-level lineage before a change
- certify or deprecate assets with signed evidence
- curate a business glossary

Analysts use it to find a certified table they can trust, and to see what it holds and where each tag came from. Member identifiers stay masked. Every open view stays current while stewards work, including the lineage drawing and lineage that arrives from the nightly ingestion. Admins do four things:

- manage people, roles and passwords
- follow a tamper-evident audit log live without losing their place, and check it on the server
- open the whole catalog read-only as it stood at any point in that log
- answer the auditor's "what was the answer at quarter end" in the plan's own business time

Every rule about who may see or change what is enforced on the server, on every route and every live stream. This includes masking and roles. The interface only reflects those rules. When another person changes something, every open screen follows the change in place, without a reload.

Strata runs on three backing services:

- **Postgres** is the system of record. It holds the append-only, chained audit log, and it fans committed changes out to every running Strata instance.
- **MinIO** stores certification evidence exactly as submitted.
- **Mailpit** receives the deprecation notices sent to downstream owners.

Out of scope:

- SQL parsing and warehouse connectors (lineage arrives through the ingestion API)
- single sign-on, self-registration, self-service password change, account deactivation and multiple tenants
- enforcing access in the warehouse itself
- editing sample values, and exporting data
- fetching any URL a person supplies
- any datastore beyond those three services

## Problem and users

Every quarter, auditors and privacy officers ask stewards at regional health plans (HIPAA) and credit unions (GLBA) the same three questions:

- Where does the member SSN go?
- Who can see it?
- Which dashboards still depend on the retired claims table?

They also ask what the answer was at quarter end, in the plan's own business time, and not only today. Stewards answer from spreadsheets of hand-traced SQL, chat threads and memory. Each audit costs a steward one to two weeks, and the answer still misses multi-hop paths and feedback loops, such as a scoring table that feeds the staging table it reads from. Nobody can reconstruct the quarter-end picture.

The usual tools fall short:

- SaaS catalogs send metadata off-premises.
- Open-source catalogs ship tag propagation switched off, or at dataset level only. They propagate only downstream and stop at a fixed hop count. They have no rule for transforms that make a value no longer sensitive: a hash of an SSN, a count by region, or a ZIP code cut to its first three digits under the HIPAA Safe Harbor method.
- They leave stale inherited tags behind after the source tag is removed, and they show other people's edits only after a reload. A lineage diagram left open keeps showing a tag that was withdrawn minutes ago, a table that has since been retired, or none of the edges last night's ingestion added.
- They enforce visibility in the interface rather than the server, so a copied request or an open browser tab keeps working after someone's access changes.
- Anyone with database access can quietly rewrite their audit trails, and a live audit view jumps around while the reader is in the middle of it.

The compliance budget pays twice: once in steward time, and again in remediation when an analyst export turns out to carry an unmasked identifier.

The four roles:

- **Admin** (weekly):
  - manages users and roles with immediate effect;
  - resets a person's password to end every session they hold;
  - reinstates deprecated assets;
  - pages through and follows the full audit log live, and checks its hash chain on the server;
  - opens the catalog read-only as of any audit seq or any quarter-end time in the plan's business time zone.
- **Steward** (daily):
  - tags sensitive columns, singly or in bulk with undo, and suppresses tags on de-identified columns with a justification;
  - registers assets and lineage;
  - runs impact analysis before a change;
  - certifies or deprecates assets with evidence;
  - curates glossary terms.
- **Analyst** (daily) finds a trustworthy certified table by term, owner or tag. They see what it contains and where its tags come from, with PII masked. The view stays current as stewards change it.
- **Viewer** (occasional) browses the glossary and asset descriptions and never sees a tagged sample value.

## Journeys

1. **An Analyst finds a trustworthy table.**
   - Lena Marsh (Analyst) signs in and lands on the catalog, which lists every asset.
   - Lena types "claims", changes it to "risk" before the first answer arrives, then picks the PII tag.
     - The results, facet counts and spoken result count only ever reflect "risk" with PII.
     - Focus stays on the control Lena just used.
     - The Tag facet still shows how many "risk" assets carry Confidential.
   - Lena copies the URL to a colleague, who opens it and gets the same results and selections.
   - On her phone, Lena opens Filters with PII chosen. Focus lands on the checked Tag choice. While the sheet is open, Rui Takahashi (Steward) tags PII on `src.eligibility_2019.member_id`. Within three seconds, inside the still-open sheet, the PII count rises from 5 to 7, her choices and focus stay put, and her screen reader hears the new matching count once. Tab never leaves the sheet. Escape closes it back onto the Filters button. The longer result rows such as `stg.eligibility_spans` and `mart.claims_by_region` fit the phone without sideways scrolling.
   - Lena clicks `stg.member_claims`, then quickly `src.members`. Only `src.members` ever paints.
   - She opens a column. The detail pane lists its tag glyphs and the columns each inherited tag comes from. Every PII sample arrives from the server as the masked placeholder, inherited ones included.
   - On her phone, the Columns table reads as labelled cards. A freshly ingested asset with a very long id and long unbroken samples never makes the page scroll sideways.
2. **Stewards tag, suppress and withdraw while others watch.**
   - Dana Okafor (Steward) works by keyboard alone. She opens `mart.claims_by_region.region_zip`, which carries only the three-digit ZIP prefix, and suppresses its inherited Confidential tag with a Safe Harbor justification.
     - Focus lands on the control that replaced the one she pressed.
     - The tag disappears there and on `dash.claims_overview.region`. In the same moment the asset counts, the facet counts and the canvas nodes drop to match.
   - Dana presses Tag PII on `src.members.member_id`. Rui tagged the same column a moment earlier. Dana's refusal is announced once, her column resyncs in place to show PII, and focus lands on Withdraw PII.
   - On `src.claims_legacy`, Dana ticks `claim_id`, `diagnosis_code` and `service_date` and applies Confidential to the selected rows. `diagnosis_code` already carries it, so her screen reader hears "Confidential applied to 2 of 3 columns." once. A moment later she presses Undo, and both columns go back to exactly the tags they had, in one audit row. A second Undo is refused.
   - On her phone, by touch, Dana suppresses the inherited PII on `stg.member_claims.member_ssn`, whose values the modelling team tokenises. Omar Haddad (Analyst) has `mart.member_risk.member_ssn` open on the lineage canvas at his desk, and has just switched his system to reduced motion. Once the server confirms, Dana's column tags, the asset's PII count, the result row's count and the facet count all change in one paint, and her screen reader hears the suppression once. Within three seconds, with no transition, Omar's drawing shows the suppression seal on the staging column and drops the PII glyph from it and from the focus node.
   - Rui is on his phone with a finished trace from `stg.member_claims.member_ssn` in the hop list. Dana withdraws PII on `src.members.ssn`. Within three seconds, with nothing moving, only the `src.members.ssn` item loses its glyph. The focus node keeps PII, and its source line now names only `src.claims_legacy.member_ssn`. Rui's scroll position and focused node stay put. Dana's screen reader hears that the tag still reaches 3 columns through other paths.
   - Later Rui withdraws the claims extract's SSN tag. Lena has `/catalog?tag=PII` open with `mart.member_risk.member_ssn` showing. Within three seconds her results shrink, her PII count drops, the SSNs on her open column appear unmasked, and her screen reader hears the new count once. If Lena changes the Tag filter while that refresh is still on its way, only her newer choice ever paints.
3. **A Steward traces impact through a cycle while lineage arrives.**
   - Dana focuses `src.claims_legacy.paid_amount` and presses Trace impact.
     - Hop bands light left to right, and each edge turns drawn as its target band lights.
     - Aggregate edges end at seal marks.
     - The loop between the risk score columns is drawn once, as an arc labelled "cycle".
   - Partway through, Dana arrows along the edges to a hop-2 node and presses Enter. The old sweep stops dead: none of its nodes or edges light later, and its summary is never spoken.
   - She traces `src.claims_legacy.member_ssn`. The counter stops at the new total, and the screen reader hears that trace's summary once.
   - Rui's ingestion run then registers a new outreach extract fed from `stg.member_claims.member_ssn`. Within three seconds the new edge appears dashed on Dana's finished drawing, and its new node sits unlit in hop band 2. Every other node keeps its state, and the counter and summary stay as they were. Her screen reader hears once that lineage changed since this trace. Lena, who has the same column's hop list open on her phone, sees the new node under Hop 2.
   - Dana taps a node. It takes focus and is announced with its hop. When she narrows the window to phone width, the hop list shows the same node chosen and focused.
   - On a tablet, Dana drags the canvas from its empty bottom strip and pinches in on a node. The node stays under her fingers.
4. **A Steward verifies with a sign-off on a phone.**
   - Dana opens `src.members` on her phone, presses Verify, and first attaches `signoff.docx` by mistake.
     - The refusal is announced once.
     - The Evidence file field is marked invalid and described by that message, and focus moves to it.
   - A file named with a tab character is refused.
   - She attaches the privacy officer's signed PDF, whose descriptive filename runs close to the 200-character limit. While it uploads, Dialog status reads the pending copy and a thin progress line runs along the dialog's top edge; under reduced motion the line stays still. The asset turns verified only after the evidence store confirms the file. The dialog closes, focus lands on Deprecate, and the success copy with the filename is announced once. The long filename and the SHA-256 wrap inside the detail pane.
   - Lena has `src.members` open on her own phone. Within three seconds, with no reload, her screen shows verified and the Download evidence link, wrapped with no sideways scrolling.
   - Lena downloads the PDF. It has the same bytes and the same name, and it arrives as a download that can never run as a page. A resumed download asks for the rest by byte range, and a reader asks for several scattered ranges at once. Each gets exactly those bytes.
   - Every delivered download leaves one audit row, even one Lena cancels halfway.
5. **A Steward retires the legacy claims table.**
   - Dana has the Verify asset dialog open on `stg.member_claims` with her file and note chosen. Rui deprecates `src.claims_legacy`.
     - Within three seconds the deprecated-upstream warning appears behind her dialog. The dialog stays open with its file and note.
     - Her submit is refused with the published reason, and focus stays on Verify asset.
     - When Morgan Ellery (Admin) reinstates the table, the warning clears in place. Dana's resubmit from the same dialog succeeds, and focus lands on Deprecate.
   - When Dana's verify races Rui's deprecation, only two outcomes are possible:
     - the verification lands first, and `stg.member_claims` stays verified with the warning;
     - or it is refused with the published reason and nothing is stored.
   - Omar has the lineage canvas open on `mart.claims_by_region.total_paid` at his desk, and Lena has the same column's hop list open on her phone. When Rui deprecates `src.claims_legacy`, both drawings mark the claims extract's node as deprecated, and mark every node downstream of it with that nearest deprecated upstream, in place within three seconds. Rui's success copy, with the server's queued-notice count, is announced once. When Morgan reinstates, the marks clear in place.
   - Rui presses Escape on the Deprecate asset dialog and reopens it at once. It stays open.
   - Rui Takahashi, Lena Marsh and Omar Haddad own the downstream assets. Each gets one email listing their affected assets and columns, with no sample values.
   - An owner Morgan created as `O'Brien, Ngozi "Zee" Ångström` gets exactly one message addressed to that exact name.
6. **An Admin governs.**
   - Dana is on her phone with the Lineage rail open and a trace on its way. Morgan opens Admin and changes Dana from Steward to Analyst. Within three seconds:
     - Dana's trace is cancelled and the hop list returns to rest, with no summary spoken;
     - Trace impact disappears and focus lands on Close lineage, never the page body;
     - the samples on her open column re-render masked;
     - her screen reader hears "Your role changed to Analyst." once;
     - if Dana's system asks for reduced motion, none of this animates.

     Morgan's own screen announces the role update once, and Dana's next tag change is refused.
   - Morgan demotes Rui while Rui has the Verify asset dialog open and an upload running. Rui's dialog closes, and the upload is refused at commit with nothing stored.
   - Omar may have leaked a password. Morgan resets Omar's password. Both of Omar's open tabs land on the sign-in screen within five seconds with the session-ended copy. Even an exact retry of an old request from his old session is refused.
   - Morgan scrolls down to read last week's rows while stewards on two instances keep working. The rows on screen don't move. A "Show new audit rows" button above the table counts up as rows arrive, and its first appearance is announced once. Pressing it puts the new rows on top in order, with no gaps, and moves focus to the newest row's Seq link.
   - Morgan reads the When column in her own browser's time zone, with the offset shown. Two rows written an hour apart during the autumn clock change show the same wall time with different offsets.
   - For the auditor, Morgan types the quarter-end business time, `2026-09-30T23:59:59`, into Catalog as of. The catalog opens read-only as of the last row before Chicago's quarter end. It shows the old term name, the old tags, the old certification and no write controls, even on a phone in the Filters sheet and the Lineage rail. While stewards keep working, nothing in that view changes, except a line counting the newer changes, which is announced once. Back returns Morgan to the same audit rows with the same row in view. Forward, a reload, or sharing the link with another Admin shows the same past view.
7. **A service is down.**
   - Strata boots while the evidence store is unreachable. Dana presses Verify.
     - The asset never shows verified, not even briefly.
     - The dialog keeps the refusal, the file and the note, and the outage banner appears at once.
     - Focus stays on Verify asset, and while the banner flickers on and off, Tab stays inside the dialog.
     - Her resubmit from the same dialog sends the same request key.
   - On a replica that can't reach the mail relay, Dana deprecates `src.claims_legacy`. The success copy and the banner both show the server's count of queued notices. Later status polls never change the success copy. The notices go out from another instance on the same database that can reach the relay.
   - On a replica that has its own database and can't reach the relay, so nothing can send its notices, Dana deprecates `src.claims_legacy` and Morgan then reinstates it. Its three queued notices are cancelled and never arrive.
   - On a replica that can reach neither service, Dana on a phone sees the evidence banner, then the mail banner, under the top bar and above the Filters button, overlapping nothing.
   - When a service returns, its banner clears and work resumes without a restart.
8. **Stewards ingest and curate; a Viewer reads.**
   - Dana and Rui both run the nightly ingestion for `stg.claims_2026` at once. One registration and one copy of each edge result. The other run gets the published refusal, with nothing partial left. Lena, whose open search matches the new asset, sees it join her results within three seconds and hears the new count once.
   - Descriptions, samples and column names in non-Latin scripts and emoji are measured in characters as a person counts them. They wrap inside canvas nodes and hop-list items. A description such as `Totals <net> & "gross"` shows exactly those characters.
   - Rui has "Eligibility span" open in the Edit term dialog and types a new name. Meanwhile Dana renames the term to "Coverage period".
     - The card behind Rui's dialog changes to Dana's name.
     - Rui's typed text and loaded revision stay in the dialog.
     - Rui's save is refused with the stale-term copy and changes nothing.
     - Rui's list never shows Rui's unsaved name.
   - The new name reaches every linked asset, search, the term facet and the glossary grid in the same request.
   - Sam Whitlock (Viewer) reads the glossary on his phone with focus on the `ref.providers` link in the Provider card. Rui renames Provider to `Contracted provider for claims adjudication and network adequacy review`. Within three seconds the card shows the new name wrapped inside it and moves to second place in the same paint. Focus stays on the same link, and Sam's screen reader hears the rename once. Sam sees every tagged sample masked and no edit controls.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign in and session** Each seeded person signs in with email and password and gets a new session that replaces any session the browser already held, a wrong password answers 401 with the published copy, and the database stores no session token or password in readable form.
- **DP-02 — Server-enforced roles** Every API route and every activity stream enforces the published role rules on the server, so a refused request answers 403 and leaves state, the evidence store and the audit log unchanged whatever the interface shows.
- **DP-03 — User and role administration** An Admin lists users, creates a user with a role and changes another user's role, which applies to that user's next request; changing your own role or resetting your own password answers 409.
- **DP-04 — Ingested lineage reaches open views** Within 3 seconds of another person's lineage write, an open live canvas or hop list adds each new edge and node in place with the published attributes and removes each removed edge, keeping every other node's lit, drawn and hop state, the sweep counter and Trace summary; Lineage status announces the lineage-changed copy once; a chosen node stays chosen across a breakpoint crossing; non-Latin labels wrap inside their nodes; and a newly registered asset matching an open search joins its results with the new count announced once, as set out in Interactions and Motion and effects.
- **DP-05 — Live audit rows keep the reading position** While an Admin has scrolled the Audit log's first row out of view, rows committed on any instance are held behind a Show <n> new audit rows button that counts in place and is announced once, the rows in view stay within 2 pixels of their place, and pressing the button inserts the held rows in strictly descending, contiguous seq and focuses the first row's Seq link, at every published viewport, as set out in Interactions.
- **DP-06 — Bulk tag apply with undo** A Steward or Admin applies one tag to several selected Columns rows in one request that reports a per-row outcome and applies the tag wherever allowed, the published count is announced once, the request honours an Idempotency-Key, and one Undo restores those rows' exact direct tags as one audit row or is refused with the published message, as qualified in API.
- **DP-07 — Password reset ends sessions** An Admin's password reset of another person replaces their password and ends every session they hold in the same request, so their next request, even an exact Idempotency-Key replay, answers 401, their streams close and their open screens reach the sign-in screen within 5 seconds.
- **DP-08 — Role changes reach open screens** A person whose role changes sees role-gated controls, open dialogs and focus follow the new role within 3 seconds exactly as published in Interactions, while their next request already uses it; what a role change does to a trace is owned by DP-95.
- **DP-09 — Authority rechecked at commit** Every write re-reads its actor's session and role when it commits, so a verify whose uploader is demoted or signed out while the evidence uploads is refused with nothing stored and no audit row.
- **DP-10 — Attributed audit trail** Every successful state change and every delivered evidence download writes exactly one audit row with actor, actor role, action, target, before, after and a millisecond server timestamp, and refused, failed or replayed requests write none.
- **DP-11 — Audit log cannot change** No route edits or deletes audit rows (405 for every role, Admin included), and UPDATE, DELETE or TRUNCATE on the audit table fails even as the app's own database role.
- **DP-12 — Chained audit log and chain check** Audit rows carry a gapless seq from 1 in commit order and a SHA-256 chain anyone can recompute, and GET /api/audit/chain reports the first gap, broken link or wrong hash within 2 seconds for 10,000 rows, shown on the Admin screen in the published words.
- **DP-13 — Admin console** An Admin opens Admin from the main navigation, changes roles and resets passwords in the Users table and sees every new audit row reach the Audit log table within 3 seconds without a reload, a duplicate or a lost row, as qualified by DP-05; other roles see no Admin link.
- **DP-14 — Audit paging** GET /api/audit pages backwards with before_seq and next_before_seq so that paging while new rows are written never repeats or skips a row, and the Admin screen loads older rows on request.
- **DP-15 — Catalog search** GET /api/search matches every character of the query literally against asset ids, descriptions, column names and linked term names and narrows by tag, owner, state and term, each filter AND-combined.
- **DP-16 — Facet counts** Each facet group's counts apply the query and every other selected filter but not that group's own selection, computed from effective tags, so they match a fresh recompute after any edit.
- **DP-17 — Search state in the URL** The query and every selected filter live in the catalog URL, so reloading, sharing or going back and forward reproduces the same results, selections and counts.
- **DP-18 — In-place filtering** Typing or choosing a facet value updates results and counts in place without a page load, keeps focus on the control just used, and announces each settled result count once in the published words.
- **DP-19 — Empty state and bounded search** A search with no matches shows the published empty-state copy and one Clear filters button, a query over 200 code points answers 422, and every accepted search answers within one second.
- **DP-20 — Latest input wins** Only the response for the newest search state or the latest opened asset or column ever renders or announces, even when an older response arrives later.
- **DP-21 — Keyboard-complete facets** Each facet group is one Tab stop keyed by value, and below 768 pixels the Filters sheet opens on the checked Tag radio, chooses and searches with arrow keys, keeps Tab inside, closes back onto the Filters button and reports the active filter count, as set out in Interactions.
- **DP-22 — Published response fields** Asset, column, graph and lineage responses carry exactly the published keys for every role and never contain an evidence storage key, an owner's email or another internal identifier.
- **DP-23 — Masked samples by role** The server replaces every sample hidden from the caller's role by its effective tags with the published placeholder in every response that carries samples, live or point-in-time, direct or inherited, and a suppressed tag no longer masks.
- **DP-24 — Tag glyphs** Every PII tag shows as a hatched mark with a P glyph and every Confidential tag as a dotted outline with a C glyph, in column rows, search result rows and canvas nodes, so no tag relies on colour alone.
- **DP-25 — Workspace breakpoints and overlays** The catalog workspace shows three panes at 1200 pixels and wider, two from 768 to 1199 pixels and a single hop-stacked column below 768 pixels, no screen scrolls horizontally even with the longest real ids, and at every published viewport each open dialog, Filters sheet and Lineage rail sits uncut above every other layer with each control hit-testing to itself, the page behind neither scrolling nor taking pointer events, and no focused control under the sticky top bar.
- **DP-26 — Collapsed panels and settled states** Below 768 pixels the Filters sheet and the Lineage side rail are hidden, unfocusable and absent from the accessibility tree while closed, and every dialog, sheet, rail, canvas layout and sweep exposes its published settled-state attribute, which reaches its settled value at once, with the same announcement, while reduced motion is on, including when it is switched on live.
- **DP-27 — Columns table at every width** Below 768 pixels the Columns table renders labelled stacked cards that keep table roles, and long ids, names, descriptions and unbroken samples wrap inside the detail pane with no horizontal scrolling at every published viewport.
- **DP-28 — Stored text renders inert** Text people enter always renders as literal characters and never as markup.
- **DP-29 — Direct tag changes** A Steward or Admin adds or withdraws a direct PII or Confidential tag on a column, with the 409s and single-winner outcomes qualified in API and Business rules.
- **DP-30 — Effective tag propagation** A column's effective tags are its direct tags plus every tag reaching it along copy, rename, cast, filter, join or concat edges on paths that avoid every column suppressing that tag, while hash and aggregate edges pass nothing on.
- **DP-31 — Tag controls in the column pane** A Steward or Admin tags, withdraws, suppresses or lifts from Column detail, also by touch at 375x812 with every such control at least 44 by 44 pixels, and once the server confirms sees the column's tags and sources, the asset's counts, the result row's glyph counts and the facet counts change in one paint with the success copy announced once, while another person's open canvas shows the suppression seal and drops the glyph within 3 seconds, with no transition under reduced motion.
- **DP-32 — Withdrawal respects other paths** Withdrawing a direct tag removes the inherited copy only from columns no other unsuppressed tagged upstream path still reaches, including tags only a lineage cycle kept alive, the result never depends on edit order, and the reply reports how many columns the tag still reaches.
- **DP-33 — Tagged-column counts** Each asset's tagged, PII and Confidential column counts are recomputed in the same request as any tag, suppression, lineage or asset change and always match a fresh recompute from effective tags.
- **DP-34 — Tag suppression** A Steward or Admin suppresses an inherited tag on a de-identified column with a justification, stopping it there and downstream, and the suppression persists while dormant until explicitly lifted.
- **DP-35 — Tag provenance** Every column reports, per effective tag, the sorted set of direct-tag columns that reach it along unsuppressed pass-through paths, and the column pane names them.
- **DP-36 — Graph writes are serialised** After any interleaving of concurrent tag, bulk tag, suppression, edge and asset writes, stored effective tags, sources, counts and facets equal a fresh recompute and each response's changed columns are that request's own difference in commit order.
- **DP-37 — Focus follows the replacing control** After a confirmed tag, withdrawal, suppression or lift removes the pressed control, focus moves to the published replacement control or the Column detail heading, and on an error it stays on the pressed control.
- **DP-38 — Refused tag actions resync** A tag action refused with 409 is announced once in Activity, re-reads the column, counts and search in place, and leaves focus on the pressed control if still shown, else on the DP-37 replacement.
- **DP-39 — Impact analysis** GET /api/columns/{id}/lineage with direction downstream returns every reached column once with its shortest hop, the focus tags it carries with their sources and those sealed by a suppression there, and each traversed edge marked as flow, seal or cycle.
- **DP-40 — Cycles and traversal bounds** A traversal through a lineage cycle terminates, reports each cycle edge once without revisiting its target, and stops at 12 hops or 500 columns with the truncated flag and both limits published, answering within two seconds.
- **DP-41 — Lineage canvas** Opening a column draws upstream hop bands to the left of the focus column and downstream hop bands to the right, with mono hop numbers along the top edge.
- **DP-42 — Downstream sweep** Pressing Trace impact lights downstream hop bands on the published schedule from the response's time zero, draws seal marks and a single labelled cycle arc, counts up to the total, and ends with the canvas matching the server response and the summary announced once.
- **DP-43 — Edge drawing state** Every canvas edge exposes its ends, kind, drawn state and edge state, and during a sweep each downstream edge turns drawn exactly when its target band begins lighting and each cycle edge when its source hop does.
- **DP-44 — Sweep survives interruption** A canvas rebuilt mid-sweep resumes on the original schedule, and a refocus or re-trace mid-sweep cancels the old sweep so none of its nodes light, none of its edges draw and its summary is never announced.
- **DP-45 — Keyboard lineage navigation** The lineage canvas and hop list are one roving Tab stop whose arrow, Home, End, Enter, Space, Escape and T keys move focus and act exactly as set out in Interactions, never dropping focus to the page body.
- **DP-46 — Canvas zoom keys and focus visibility** Zoom keys follow the published zoom formula, and a node taking keyboard focus outside the canvas content area pans by the smallest amount that brings it fully inside, keeping the zoom.
- **DP-47 — Touch pan and pinch** On a touch screen a one-finger drag, including one started in the canvas's always-empty bottom strip, pans the lineage canvas and a two-finger pinch zooms it between half and double size, keeping the content point under the pinch midpoint fixed by the published formula.
- **DP-48 — Reduced motion, followed live** Strata follows the system's reduced-motion setting as it changes without a reload, and while it is on nothing on the page animates and Trace impact shows every reached hop at once with a hop-number badge on each node and the final count, keeping seal marks, cycle arc and the announcement.
- **DP-49 — Verify with evidence** A Steward or Admin verifies a draft asset by attaching a PDF or text sign-off, and the asset becomes verified only after the evidence store confirms the upload.
- **DP-50 — Evidence stored as submitted** The evidence object holds exactly the uploaded bytes under the published key with the server-decided type and its SHA-256 on record, and a refused, failed or interrupted verification leaves no object, record or audit row.
- **DP-51 — Times in the viewer's zone** The Audit log's When column and the Point in time note's recorded time show each instant in the viewer's browser time zone with its UTC offset in the published format, so two instants in a repeated fall-back hour show the same wall time with different offsets, while Catalog as of keeps America/Chicago.
- **DP-52 — Evidence download** Admins, Stewards and Analysts download evidence through the app with the original bytes and filename, Viewers get 403, no storage URL or key reaches the browser, and ETag, If-None-Match, If-Range, HEAD and single ranges follow API exactly.
- **DP-53 — Multiple byte ranges** A Range of 2 to 10 specs is resolved, sorted and merged, answering a single-part 206 for one merged range or a multipart/byteranges 206 with one part per merged range, exactly as published in API.
- **DP-54 — Evidence access logging** Each evidence GET answering 200 or 206 commits one evidence.download row with the hash and merged range before its first byte, an aborted download keeps its row and releases its connection and store stream within 5 seconds, and no other response writes one.
- **DP-55 — Idempotency keys** Verify and deprecate under one Idempotency-Key replay the stored response with no new effects, answer 409 for a different request under that key, and answer 409 idempotency_in_progress with no effect while the first is still running.
- **DP-56 — Certification dialogs** A Steward verifies through the Verify asset dialog and deprecates through the Deprecate asset dialog and sees the new state, evidence link and published success copy, with focus kept inside the dialog until it closes.
- **DP-57 — Certification by keyboard** After a confirmed verify, deprecate or reinstate, focus moves to the first shown certification control or the Asset detail heading, a refused verify keeps focus on Verify asset with the file and note kept, and the deprecated-upstream warning links to the upstream asset.
- **DP-58 — Verification blocked by deprecated upstream** Verifying an asset with any deprecated transitive upstream, checked before the upload and again at commit, answers 409 with the published reason naming the nearest one and leaves no object, record or audit row, so a race with a deprecation or edge write ends in a serial outcome.
- **DP-59 — Deprecated-upstream warning** Every transitive downstream asset of a deprecated asset shows the published warning naming its nearest deprecated upstream, in API responses and on its asset page.
- **DP-60 — Upstream changes reach an open verify** While a Verify asset dialog is open, a deprecation or reinstatement of an upstream makes the warning appear or clear behind it within 3 seconds without closing the dialog, moving focus or clearing its file, note or Idempotency-Key.
- **DP-61 — Certification transitions and reinstatement** Certification moves only draft to verified, draft or verified to deprecated, and deprecated to draft by Admin reinstatement, which clears downstream warnings and blocks, and every other move answers 409 or 403 with no change.
- **DP-62 — Deprecate with reason** A Steward or Admin deprecates a draft or verified asset with a reason, the response reports this deprecation's queued notices and the total unsent, and of simultaneous deprecations of one asset exactly one succeeds.
- **DP-63 — Downstream owner notices** Each deprecation sends exactly one plain-text email per distinct owner of a transitive downstream asset, listing their affected assets and columns and the nearest deprecated upstream and never a sample value, evidence key, filename or bucket address.
- **DP-64 — Notices reach each owner once** Each owner gets exactly one notice whose single To recipient is the owner's exact stored name and email, with a plain-text UTF-8 body in the published format, and user names refuse control characters.
- **DP-65 — Cancelled notices** An Admin reinstatement cancels that asset's unsent, unclaimed deprecation notices in the same transaction, reports how many, and those notices never reach the mail relay.
- **DP-66 — Service status and banners** GET /api/status reports evidence storage, mail relay and unsent notices, and every signed-in screen shows one published banner per service that is down, in flow under the top bar, evidence before mail, without overlap or horizontal scrolling.
- **DP-67 — Evidence outage keeps draft** While evidence storage is unreachable, verifying answers 503 with the published copy, the asset stays draft and nothing else in the catalog stops working.
- **DP-68 — Queued notices are delivered once** While the relay is unreachable deprecation still succeeds and its notices wait in the database, then go out exactly once with their published Message-ID from any instance on the same database that reaches the relay, with no restart, as qualified in Services.
- **DP-69 — No outcome before confirmation** Asset state, evidence link, tag glyphs and counts change only after the server confirms, a verify 503 shows the evidence banner within half a second, and the mail banner shows the server's queued-notice count.
- **DP-70 — Outage replies survive status changes** Each opening of the Verify or Deprecate dialog uses one Idempotency-Key for every resubmit, and a dialog's error copy, file and note survive any number of banner changes, with exactly one banner element per service.
- **DP-71 — Banners stay out of the keyboard path** Outage banners hold no focusable element, never move focus when they appear, clear or reorder, and stay outside an open dialog's Tab cycle, and a verify 503 keeps focus on Verify asset.
- **DP-72 — Dialogs survive their own timers** A dialog reopened during its exit transition stays open, success or error copy survives later polls and refreshes unchanged, and the banner's queued-notice count is never replaced by a poll sent before the deprecation or reinstatement reply, as qualified in Feedback states.
- **DP-73 — Glossary terms and revisions** Stewards and Admins create and edit terms whose names are unique after trimming, whitespace collapse and case-folding, every edit carries the revision it edited, a stale revision answers 409 with no change, and a rename reaches asset term lists, search, the term facet and glossary order in the same request.
- **DP-74 — Term links** A Steward or Admin links and unlinks glossary terms on assets, linked terms appear on the asset, in search matching and in the term facet, and a link racing a rename ends in a serial outcome as qualified in Business rules.
- **DP-75 — Glossary screen and live renames** The Glossary screen lists each term with its definition and linked assets in a row-major grid of one, two or three columns by width, with New term and Edit only for Stewards and Admins, and another person's rename reaches an open Glossary in place within 3 seconds with focus kept and one announcement, as set out in Interactions.
- **DP-76 — Glossary shows confirmed edits only** Term cards, Edit buttons and glossary order never show an unsaved or refused name, and the Edit term dialog keeps the revision and typed text it opened with through every refresh and a reopen during its exit transition.
- **DP-77 — Asset registration** A Steward or Admin registers a table, view or dashboard with its columns and samples through the ingestion API, starting in draft, with column names in any script under the published rules.
- **DP-78 — Lineage edge recording** A Steward or Admin records or removes column-level lineage edges with a transform kind, cycles allowed and self-edges refused, with effective tags and counts recomputed in the same request within 2 seconds at the published catalog scale.
- **DP-79 — Single winner for ingestion** Of simultaneous identical asset registrations exactly one answers 201, and of overlapping edge batches each pair is stored once while every losing batch stores nothing and answers 409 naming its lowest conflicting entry.
- **DP-80 — Limits count code points** Every character limit counts Unicode code points with inclusive bounds, and JSON bodies of exactly 1,000,000 bytes and multipart bodies of exactly 6,000,000 bytes are accepted while one byte more answers 413.
- **DP-81 — Activity stream** GET /api/events streams one event per committed audit row the caller may see, carrying only seq, action and target, with keep-alives, as qualified in API and Business rules.
- **DP-82 — Stream resume and fan-out** A stream resumed with Last-Event-ID or after_seq delivers every later visible row exactly once in ascending seq, rows committed on any instance reach every instance's streams within 2 seconds, and a stream closes within 5 seconds of its session ending.
- **DP-83 — Streams release resources** An instance holds at most 12 Postgres connections however many event streams are open, and an abandoned stream's connections and timers are released within 5 seconds.
- **DP-84 — Per-stream cursor and visibility** Each activity stream keeps its own cursor and decides each row's visibility from its caller's role as it stood right after that row committed, so promotion widens and demotion narrows from its own row, identically for live and resumed delivery, and concurrent reads never share masking.
- **DP-85 — Live workspace refresh** An open catalog workspace refreshes affected results, facets, asset and column in place within 3 seconds of another person's relevant change, yielding to any newer search state, keeping focus and dialogs untouched, changing the canvas only as DP-04, DP-97 and DP-99 allow, announcing a changed count once and marking the applied event's seq.
- **DP-86 — Point-in-time reads** Search, asset, column, graph and lineage reads accept as_of_seq or as_of_time and answer exactly what that read returned right after the resolved seq committed, masked by the caller's current role, as qualified in API and Business rules.
- **DP-87 — Point-in-time workspace** An Admin following an audit Seq link or the Catalog as of form opens a read-only catalog as of that seq with the published note and no write control or evidence link anywhere at any width, whose results, detail, canvas and hop list never change while data-synced-seq stays at that seq, whose newer-changes line updates in place within 3 seconds and is announced once, whose Back returns to the same Admin audit rows with the same row in view and whose Forward or reload reproduces it, while other roles have the parameter removed.
- **DP-88 — Quarter end in business time** The Admin's Catalog as of form converts an America/Chicago wall time with the offset in force on that date, the earlier one on a repeated hour and shifted forward across a skipped hour, and opens the read-only catalog at the seq the server resolves.
- **DP-89 — Run manifest and health** The app installs, builds and serves from /app/run.json on port 4173 or APP_PUBLIC_PORT and answers GET /api/health with 200 and the published body even when a dependency is down.
- **DP-90 — Seeded first-run state** On first start against an empty database the catalog holds exactly the seed users, assets, columns, samples, edges, tags, terms and states listed in Seed data, with no audit rows.
- **DP-91 — Credentials from the environment** Every service URL and credential is read from the published environment variables at start, never hard-coded and never sent to the browser.
- **DP-92 — Server boundary** The server refuses oversized bodies and over-nested JSON with the published statuses, answers combined faults by the one published precedence, and never serves source files, environment files or credentials.
- **DP-93 — Drafting-sheet look** The workspace reads as a warm paper drafting sheet: hairline rules between panes, one dark ink with two tag hues, a serif display face, mono numerals and no gradients or shadows.
- **DP-94 — Field errors tied to fields** A dialog 422 announces the first field message once, marks each invalid field with aria-invalid and a description holding exactly its API message, and focuses the first invalid field.
- **DP-95 — Demotion reaches an open trace** When a person's role changes to one that may not trace while their workspace has a trace pending or running, the trace is cancelled, the canvas or hop list returns to rest for the same focus column, samples re-render under the new role's masking, focus lands on the published fallback and the role-change copy is announced once, within 3 seconds.
- **DP-96 — Live counts in an open Filters sheet** Below 768 pixels, another person's change reaching an open Filters sheet updates its facet counts and the results behind it in place within 3 seconds, keeps the sheet open with its selections and focus, and announces a changed result count once.
- **DP-97 — Open canvas follows tag changes** Within 3 seconds of another person's tag change, an open lineage canvas or hop list drops a glyph only from the nodes that lose the tag while a node kept tagged by another path or a cycle keeps its glyph and its hop-list source line names the remaining source, keeping every node's lit, drawn and hop state, the sweep state, counter, summary, scroll position, view and focus, with no transition under reduced motion, and a withdrawal whose tag still reaches other columns announces the published remaining-reach copy once in the withdrawer's Activity.
- **DP-98 — Verification reaches every open view** After a confirmed verification, every other open screen on that asset shows verified and the evidence link within 3 seconds without a reload, and the evidence filename and SHA-256 wrap inside the detail pane with no horizontal scrolling at every published viewport.
- **DP-99 — Open canvas marks deprecation** An open lineage canvas or hop list marks each node's deprecated asset and nearest deprecated upstream through published attributes in place within 3 seconds of a deprecation or reinstatement, without changing any sweep or view state.

## Frontend

### Screens and layout (DP-04, DP-05, DP-13, DP-25, DP-26, DP-27, DP-41, DP-66, DP-75, DP-87, DP-96, DP-98)

**Routing.**
- Every route except `/signin` needs a session. A browser without one is sent to `/signin`.
- `/` redirects to `/catalog`.

**Sign in** (`/signin`). The wordmark "Quarrystone Strata" in the display face, then an Email field, a Password field and a Sign in button. They are centred in one narrow column at every viewport.

**Catalog workspace** (`/catalog`). One route holds search, lineage and detail. Its URL carries `q`, `tag`, `owner`, `state`, `term`, `asset` and `column` (DP-17). For Admins it can also carry `as_of` (DP-87).

**Top bar.** It holds:
- the wordmark;
- the main navigation: Catalog, Glossary, and Admin for Admins only;
- the signed-in person's name and role;
- Sign out.

At every width the top bar sticks to the top edge of the viewport while the page scrolls. Nothing scrolls underneath it in a way that hides a focused control: when a control takes keyboard focus, the page scrolls if needed so that the control's whole box sits below the top bar, and the centre of the focused control then hit-tests to that control.

**Left rail (search and facets).**
- The search box.
- Search status, directly under the search box.
- Four single-choice facet groups (Tag, Owner, State, Term), each option with its count in mono.
- The results area. It holds the one Clear filters button, directly above either the results list or the empty-state copy.
- Each result shows the asset id, kind, certification state and owner name, plus its PII and Confidential column counts in mono beside their glyphs.

**Centre (lineage canvas).** The centre pane is filled by the canvas group, `group "Lineage canvas"`. From top to bottom the group holds three parts, and nothing of the canvas sits outside it:
1. **The canvas header.** It holds the focus column id, the Trace impact button (Stewards and Admins only), the mono sweep counter, the Zoom in, Zoom out and Reset view buttons, the Trace summary region and the Lineage status region.
2. **The content area.** Every node, edge, hop label, seal mark and cycle arc is drawn here.
   - It is at least 240 pixels tall at 768x1024 and at 1280x800.
   - Content panned or zoomed beyond its edges is cut off at them, so drawn content never overlaps the header or the strip.
   - The focus column sits in band 0. Upstream hop bands run leftwards (1, 2, 3 …) and downstream hop bands run rightwards, with hop numbers along the top edge like survey stations. Each band is a vertical stack of column nodes sorted by column id. Edges are drawn as lines between nodes.
   - Every node in a band has the same width. A node's label (its column id) wraps onto further lines inside the node, breaking between any two characters where it must, and the node grows taller to hold it. A column id with a 60-code-point column name in a non-Latin script with combining marks never spills: each label's box lies inside its node's box.
   - With no asset open, the content area shows the no-asset copy from Feedback states.
3. **The empty strip.** It is 48 pixels tall along the group's bottom edge and set off by a hairline. It never holds a node, edge, label or control, at any zoom or pan.

**Right (detail pane).** It shows:
- the asset id as a display heading;
- kind, description, owner, certification state and linked terms;
- the deprecated-upstream warning, when it applies;
- the certification actions the role allows;
- the evidence link, with the evidence's SHA-256 in mono;
- for Stewards and Admins in a live view, the bulk tag bar directly above the Columns table: `combobox "Tag to apply"` (PII or Confidential, PII first) and `button "Apply tag to selected"`;
- a Columns table with one row per column: for Stewards and Admins in a live view a selection checkbox, then name, type, tag glyphs and three samples.

**Evidence block at every width (DP-98).** The Download evidence link (whose text is the evidence filename) and the SHA-256 sit in the detail pane under the certification state. A filename of up to 200 code points, with or without spaces, and the 64-character SHA-256 break between any two characters where they must. So at 375x812, 768x1024 and 1280x800 the page never scrolls horizontally, and both boxes lie inside the detail pane's box. The filename is shown exactly as stored.

**Column detail.** Choosing a column row makes that column the focus column (the URL `column` updates) and opens the Column detail region. The region shows:
- the column id as a heading;
- direct tags;
- inherited tags, each with its source lines;
- suppressed tags;
- the tag and suppression controls the role allows;
- the samples.

**Columns table at every width (DP-27).**
- From 768 pixels up, the Columns table is a ruled table with the column headers Name, Type, Tags and Samples. For Stewards and Admins in a live view, a first column headed Select holds the row checkboxes.
- Below 768 pixels, each row is shown as a stacked card. Each cell is preceded by its visible label: `Select` (Stewards and Admins in a live view only), `Name`, `Type`, `Tags` or `Samples`. The table keeps its table, row and cell roles, so each row's `button "<column name>"` is still found inside `table "Columns"`.
- At 375x812, 768x1024 and 1280x800, none of these widen the page or spill out of the detail pane:
  - an asset id of 120 characters;
  - a column name of 60 code points, in any script;
  - a description of 500 characters;
  - a sample of 200 code points with no space or other break opportunity.
- Such text breaks between any two characters where it must. The page never scrolls horizontally, and every Columns cell's box lies inside the detail pane's box.
- Samples stay in the mono face, and their text is shown unchanged.

**In-flow notes under the top bar (DP-66, DP-87).**
- These notes sit in the page flow directly under the top bar, in this order:
  1. the evidence outage banner;
  2. the mail outage banner;
  3. in an Admin's point-in-time view, `note "Point in time"` with its Back to the live catalog link.
- They scroll with the page and never float over or cover other content. Each spans the full content width.
- At 1280x800 and 768x1024 they span all panes, above the rail and the canvas.
- At 375x812 the order is top bar, banners, the Point in time note, then the Filters button and the search box.
- Text wraps onto further lines and never causes horizontal scrolling. No note's box overlaps any other element's box.

**Layout by width (DP-25).**
- **1200 pixels and wider** (1280x800 is the published case): three panes side by side (rail, canvas and detail), split by hairline rules.
- **768 to 1199 pixels** (768x1024): two panes. The rail is on the left. The right pane stacks the canvas above the detail pane.
- **Below 768 pixels** (375x812): one column, in this order:
  1. top bar
  2. banners and the Point in time note
  3. Filters button, search box and Search status
  4. either the results area (Clear filters, then the results list or the empty-state copy), or, with `asset` set, a Back to results link and the detail pane
  5. the Lineage button

At this narrow width:
- The facets live in the Filters sheet.
- **Search status inside the sheet (DP-96).** There is exactly one `status "Search status"` on the page at any time. While the Filters sheet is open, it is shown inside the sheet, directly under the sheet's Close filters button. While the sheet is closed, it sits under the search box. Moving between the two never announces anything by itself.
- The lineage canvas is replaced by a hop-stacked list inside the Lineage side rail. Trace impact, the sweep counter, Trace summary and Lineage status sit at the top of the rail.
- The list has sections headed `Upstream hop 2`, `Upstream hop 1`, `Focus`, `Hop 1`, `Hop 2` and onward, each listing that hop's nodes. Each item shows its column id, its tag glyphs and one source line per tag it shows (Public screens and controls).
- The hop list has no zoom, no pan and no edge lines. It scrolls inside the rail.
- Result rows, facet labels and hop-list items wrap inside the screen width. The longest seed ids, such as `stg.eligibility_spans`, `mart.claims_by_region` and `stg.eligibility_spans.coverage_start`, and column names of 60 code points in non-Latin scripts with combining marks, never cause horizontal scrolling.

At every width:
- No viewport scrolls horizontally on Catalog, Glossary or Admin, whatever the longest real id, column name, term name or audit target shown.
- The Filters button and the Lineage button exist only below 768 pixels.
- Each published viewport always gets the layout listed here for its width, whatever width the window had before. No other breakpoint changes which layout 375, 768 or 1280 pixels gets.

**Overlays (DP-25).** The overlays are every dialog, plus the Filters sheet and the Lineage rail below 768 pixels.
- At 375x812, 768x1024 and 1280x800, an open overlay lies wholly inside the viewport, uncut on every side. It sits above every other layer: the top bar, banners, panes and canvas included. When an overlay is taller than the viewport, its own content scrolls inside it.
- The centre of each control inside an open overlay, once that control is scrolled into view within the overlay, hit-tests to that control.
- While an overlay is open, the page behind it does not scroll, by wheel, keys or touch drag, and takes no pointer events. A point outside the overlay hit-tests to the overlay's backdrop, never to a control behind it.

**Glossary** (`/glossary`, DP-75).
- The heading "Glossary", then `list "Terms"` with one card per term, in glossary order (Business rules).
- Each term card shows its name in the display face, its definition and links to its assets. Each link opens that asset in the catalog.
- New term and Edit appear only for Stewards and Admins.
- The cards form a grid of 1 column below 768 pixels, 2 columns from 768 to 1199 pixels, and 3 columns from 1200 pixels.
- The grid reads row by row in glossary order. Card i+1 sits to the right of card i on the same row, or starts the next row at its left edge. DOM order, visual order and glossary order are the same.
- A term name of 80 characters, with or without spaces, wraps inside its card, and the page never scrolls horizontally.

**Admin** (`/admin`, Admins only, DP-05, DP-13).
- The heading "Admin".
- The Users table: name, email, role picker and Reset password. Below it, the Add user button.
- The Catalog as of group, which takes a business time (DP-88).
- The Check audit chain button and its Chain check status.
- The Audit log section:
  - the Audit log updates status and, while rows are held, the `Show <n> new audit rows` button, directly above the table and in the page flow;
  - the Audit log table, newest first, with the columns Seq, When, Actor, Role, Action, Target, Before and After. Seq and When are in mono, and each Seq is a link to the point-in-time catalog;
  - under the table, the Audit rows shown status and the Load older audit rows button.
- The screen first loads the newest 50 rows. Each press of Load older audit rows appends the next 50 older rows. New rows arrive live, as set out in Interactions.
- Other roles who open `/admin` see the admin-only heading from Feedback states and the 403 message from API.
- At 375 pixels the two tables become stacked cards with labelled fields. Targets such as `stg.eligibility_spans.coverage_start` and long Before and After values wrap inside each card with no horizontal scrolling.

### Public screens and controls (DP-04, DP-05, DP-06, DP-13, DP-18, DP-19, DP-21, DP-26, DP-31, DP-42, DP-43, DP-45, DP-48, DP-51, DP-56, DP-57, DP-66, DP-69, DP-75, DP-85, DP-87, DP-88, DP-94, DP-97, DP-98, DP-99)

Only these roles, names and attributes are public. Everything else is free.

Accessible names are exact. Several names are contained in longer ones, and each is a different control:
- `Filters`, `Close filters` and `Clear filters`
- `Lineage`, `Close lineage`, `Lineage canvas` and `Lineage status`
- `Verify` and `Verify asset`
- `Deprecate` and `Deprecate asset`
- `Reinstate` and `Reinstate asset`
- `Reset password` and `Reset password for <name>`
- `Password` and `New password`
- `Activity`, `Audit log updates` and `Glossary updates`
- `Audit log` and `Audit log updates`

| Role and accessible name | Where | Notes |
|---|---|---|
| `textbox "Email"`, password field labelled `Password`, `button "Sign in"` | Sign in | Sign-in errors and the session-ended copy appear in `alert` |
| `status "Sign-in status"` | Sign in | Pending copy |
| `main` | Catalog, Glossary, Admin | Carries `data-synced-seq`, as set out in Feedback states, and `data-motion` (`reduced` or `full`), as set out in Motion and effects |
| `navigation "Main"` with `link "Catalog"`, `link "Glossary"`, `link "Admin"` | Top bar | Admin link only for Admins |
| `button "Sign out"` | Top bar | |
| `alert "Evidence storage outage"`, `alert "Mail relay outage"` | Under top bar | Present only while that service is down, and never more than one of each. Neither holds a focusable element. The mail banner holds an element carrying `data-queued-notices`, set in mono, whose text is a whole number |
| `note "Point in time"` with `link "Back to the live catalog"` | Under the banners | Only in an Admin's point-in-time view. Holds an element carrying `data-recorded-at` (the recorded-time line) and, once there are newer changes, an element carrying `data-newer-changes` whose text is the newer-changes line |
| `searchbox "Search catalog"` | Rail | |
| `radiogroup "Tag"`, `radiogroup "Owner"`, `radiogroup "State"`, `radiogroup "Term"` | Rail or Filters sheet | Each holds `radio "Any"` plus one radio per facet entry. A radio's accessible name is the value label alone (`PII`, `Confidential`, `draft`, `verified`, `deprecated`, owner name, term name). Each radio carries `data-value` (its facet `value`, or empty for Any). Its count shows beside it in an element carrying `data-facet-count` |
| `button "Clear filters"` | Results area, above the results list or the empty-state copy, never inside the Filters sheet | Exactly one on the page whenever the results area is shown, and none otherwise. Resets the query and all facets |
| `list "Search results"` with one `link "<asset id>"` per result | Rail | Each result row holds its two tag glyphs and, beside each, its count in an element carrying `data-tag-count` (`PII` or `Confidential`) |
| `status "Search status"` | Rail, or inside the open Filters sheet below 768 px | Search announcements. Exactly one on the page |
| `button "Filters"` (with expanded state) / `dialog "Filters"` / `button "Close filters"` | Below 768 px | The button holds an element carrying `data-active-filters` |
| `group "Lineage canvas"` | Centre, 768 px and wider | The root carries `data-sweep` (`idle`, `running` or `done`), `data-layout` (`settling` or `settled`), `data-zoom` (scale, two decimals, starts at `1.00`), and `data-pan-x` and `data-pan-y` (whole screen pixels, start at `0`), with the meaning given in Interactions and Motion and effects. It contains the canvas header, the content area (an element carrying `data-canvas-content`) and the empty strip (an element carrying `data-canvas-strip`) |
| canvas nodes, `button "<column id>"` | Content area or hop list | Each carries `data-column`, `data-hop` (negative upstream, `0` for the focus, positive downstream), `data-lit` (`true` or `false`), `data-tags` (the space-separated tags the node shows, empty when none), `data-deprecated` (`true` when the node's asset is deprecated, else `false`), `data-deprecated-upstream` (the node's asset's nearest deprecated upstream asset id, empty when none) and `data-selected` (`true` on the one chosen node, else `false`); values per node as set out in Motion and effects and Interactions. Exactly one node at a time is in the Tab order |
| canvas edge | Content area only | An element carrying `data-edge`, `data-from` and `data-to` (the edge's real source and target column ids), `data-kind` (`flow`, `seal` or `cycle`, the response's `kind`), `data-drawn` (`true` or `false`) and `data-edge-state` (`current` or `new`) |
| tag glyph | Column rows, search result rows, canvas nodes, hop-list items | An element carrying `data-tag-glyph="PII"` with text `P`, or `data-tag-glyph="Confidential"` with text `C`. This element is the hatched (PII) or dotted-outlined (Confidential) mark |
| hop-list source line | Hop-list items only | One element per tag in the item's `data-tags`, carrying `data-source-line="<tag>"`, with the source-line copy from Feedback states |
| deprecation flag | Canvas nodes, hop-list items | An element carrying `data-deprecation-flag` with text `D`, shown exactly while the node's `data-deprecated` is `true` or its `data-deprecated-upstream` is not empty |
| hop label | Top edge of the content area | An element carrying `data-hop-label="<n>"`, where `<n>` is the band's signed hop. Its text is the hop number without sign, in mono, set above its band |
| hop-number badge on a node | Content area or hop list | An element carrying `data-hop-badge`; its text is the hop number. Only under reduced motion, and only on lit downstream nodes |
| seal mark | Content area or hop list | An element carrying `data-seal="transform"` at the end of each hash or aggregate edge, or `data-seal="suppression"` on a node whose suppression seal rule in Motion and effects applies |
| cycle arc | Content area or hop list | An element carrying `data-cycle`, with visible text `cycle` |
| sweep counter | Canvas header or Lineage rail | An element carrying `data-sweep-count`; its text is a whole number |
| `button "Trace impact"` | Canvas header or Lineage rail | Stewards and Admins only |
| `button "Zoom in"`, `button "Zoom out"`, `button "Reset view"` | Canvas header | |
| `status "Trace summary"` | Canvas header or Lineage rail | Trace announcements |
| `status "Lineage status"` | Canvas header, or the top of the Lineage rail below 768 px | Lineage-changed and node-chosen announcements. Exactly one on the page |
| `button "Lineage"` (with expanded state) / `complementary "Lineage"` / `button "Close lineage"` | Below 768 px | The `complementary "Lineage"` element carries `data-sweep` and `data-layout` at this width |
| `region "Asset detail"` with `heading "<asset id>"` | Detail pane | The heading can take focus |
| `note "Deprecated upstream"` | Asset detail | Warning copy. Holds `link "<asset id>"` on the named upstream |
| `table "Columns"` with one `button "<column name>"` per row | Asset detail | Below 768 px each row is a stacked card with visible labels `Name`, `Type`, `Tags`, `Samples` (and `Select` where the checkbox is shown) |
| `checkbox "Select <column name>"` | Each Columns row | Stewards and Admins, live view only |
| `combobox "Tag to apply"`, `button "Apply tag to selected"` | Directly above the Columns table | Stewards and Admins, live view only. The combobox offers `PII` and `Confidential` and starts on `PII` |
| `button "Undo"` | Directly after `status "Activity"` | Shown only after a confirmed bulk apply that applied at least one row, as set out in Interactions |
| `region "Column detail"` with `heading "<column id>"` | Detail pane | The heading can take focus |
| `list "Tag sources"` | Column detail | One `listitem` per source line, in tag order, then source order |
| `button "Tag PII"`, `button "Tag Confidential"` | Column detail | Stewards and Admins. Shown only while the column has that tag neither as an effective tag nor in `suppressed_tags` |
| `button "Withdraw PII"`, `button "Withdraw Confidential"` | Column detail | Stewards and Admins. Shown only while the column carries that tag directly |
| `button "Suppress PII"`, `button "Suppress Confidential"` | Column detail | Stewards and Admins. Shown only while the column carries that tag as an inherited effective tag |
| `button "Lift PII suppression"`, `button "Lift Confidential suppression"` | Column detail | Stewards and Admins. Shown only while the column's `suppressed_tags` holds that tag |
| `dialog "Suppress tag"` | Column detail | Holds `textbox "Justification"`, `button "Suppress tag"`, `button "Cancel"`, `status "Dialog status"` |
| `button "Verify"` / `dialog "Verify asset"` | Asset detail | Shown for a draft asset. The dialog holds a file field labelled `Evidence file`, `textbox "Note"`, `button "Verify asset"`, `button "Cancel"`, `status "Dialog status"`, and, only while an upload is pending, an element carrying `data-upload-progress` |
| `button "Deprecate"` / `dialog "Deprecate asset"` | Asset detail | Shown for a draft or verified asset. The dialog holds `textbox "Reason"`, `button "Deprecate asset"`, `button "Cancel"`, `status "Dialog status"` |
| `button "Reinstate"` / `dialog "Reinstate asset"` | Asset detail, Admins only | Shown for a deprecated asset. The dialog holds `button "Reinstate asset"`, `button "Cancel"`, `status "Dialog status"` |
| every `dialog`, `dialog "Filters"`, `complementary "Lineage"` | Wherever shown | Each carries `data-transition` (`entering`, `open` or `leaving`), as set out in Motion and effects |
| `link "Download evidence"` | Asset detail | Its visible text is the evidence filename. Hidden for Viewers |
| `status "Activity"` | Workspace, Glossary, Admin | Action and role-change announcements |
| `heading "Glossary"`, `list "Terms"`, `button "New term"`, `button "Edit <term name>"`, `dialog "New term"` / `dialog "Edit term"` | Glossary | Each term card is a `listitem` carrying `data-revision` (its confirmed revision) and `data-term-id`. The dialogs hold `textbox "Term name"`, `textbox "Definition"`, `button "Save term"`, `button "Cancel"`, `status "Dialog status"` |
| `status "Glossary updates"` | Glossary | Announces other people's renames |
| `heading "Admin"`, `table "Users"` with `combobox "Role for <name>"` per row, `button "Add user"`, `dialog "Add user"` | Admin | The dialog holds `textbox "Name"`, `textbox "Email"`, `combobox "Role"`, password field labelled `Password`, `button "Create user"`, `button "Cancel"`, `status "Dialog status"` |
| `button "Reset password for <name>"` / `dialog "Reset password"` | Admin, each Users row except the signed-in Admin's own | The dialog holds a password field labelled `New password`, `button "Reset password"`, `button "Cancel"`, `status "Dialog status"` |
| `group "Catalog as of"` with `textbox "Business time"`, `button "Open catalog as of"`, `status "Point in time status"` | Admin | |
| `button "Check audit chain"`, `status "Chain check"` | Admin | |
| `status "Audit log updates"`, `button "Show <n> new audit rows"` | Admin, directly above the Audit log table | The button exists only while rows are held |
| `table "Audit log"` with one `link "<seq>"` per row in the Seq column, `button "Load older audit rows"`, `status "Audit rows shown"` | Admin | Each row's When cell is an element carrying `data-at` (the row's `at` exactly as received) whose text follows the viewer-zone time format. The Load older button is absent once the server reports no older row |

Only controls the role may use are rendered. An Admin's point-in-time view renders none of the write controls, at any width, including inside the Filters sheet and the Lineage rail. The server still enforces every rule (DP-02).

**Field errors (DP-94).** In a dialog, an invalid field carries `aria-invalid="true"` and an `aria-describedby` pointing to an element whose text is exactly that field's API message. The fields and their API field keys:

| Dialog | Field | API key |
|---|---|---|
| Verify asset | `Evidence file` | `evidence` |
| Verify asset | `Note` | `note` |
| Deprecate asset | `Reason` | `reason` |
| Suppress tag | `Justification` | `justification` |
| New term, Edit term | `Term name` | `name` |
| New term, Edit term | `Definition` | `definition` |
| Add user | `Name` | `name` |
| Add user | `Email` | `email` |
| Add user | `Role` | `role` |
| Add user | `Password` | `password` |
| Reset password | `New password` | `password` |

No text field sets a length limit of its own. The search box and every dialog field accept any length, and limits are judged only by the server in code points.

### Interactions (DP-04, DP-05, DP-06, DP-07, DP-08, DP-13, DP-14, DP-17, DP-18, DP-21, DP-26, DP-31, DP-37, DP-45, DP-46, DP-47, DP-51, DP-56, DP-57, DP-60, DP-73, DP-75, DP-76, DP-87, DP-88, DP-95, DP-96, DP-97, DP-98)

#### Requests from the browser

- After the person's own role change, the screen reads GET /api/session again before it sends its next write.
- The interface never retries a refused write by itself.
- Column ids and asset ids in request paths are sent percent-encoded as UTF-8.

#### Search and facets

**Search as you type.**
- A search runs after a 300-millisecond pause in typing and replaces the current history entry.
- Each facet choice runs the search at once and adds a history entry, so Back and Forward step through filter states and restore the results, selected radios and counts.
- Opening a result sets `asset` in the URL. Loading any catalog URL restores everything it names.
- A search the server refuses leaves the results list and facet counts as they were. Search status shows the copy Feedback states gives.

**Facet radios (DP-21).**
- Each facet group is a radio group and a single Tab stop: the checked radio, which is "Any" when nothing is selected.
- Arrow keys move the choice and run the search at once. Focus stays on the newly chosen radio.
- Choosing "Any" removes that filter from the URL.
- Radios are identified by their value, not their label or position. A refresh may relabel or move the focused radio, for example after a term rename. Focus then stays on the radio with the same value. It stays checked, the URL is unchanged, and Search status announces nothing unless the result count changed.
- Focus never drops to the page body.

**Filters sheet (DP-21, DP-96), below 768 pixels.**
- The element carrying `data-active-filters` inside `button "Filters"` shows the number of facet groups not at Any, from 0 to 4. The query is not counted.
- Opening the sheet moves focus to the checked radio of `radiogroup "Tag"`.
- Inside the sheet, arrow keys choose and search exactly as in the rail, and the sheet stays open.
- Tab and Shift+Tab wrap inside the sheet and never reach the page behind it.
- Escape or `button "Close filters"` closes the sheet and returns focus to `button "Filters"`.
- **Another person's change while the sheet is open.** The live refresh (Feedback states) runs exactly as when the sheet is closed, and then:
  - the sheet stays open, and its radios keep their checked values and focus;
  - `data-active-filters` and the URL don't change;
  - each radio's `data-facet-count` takes its new count in place;
  - the results list behind the sheet is repainted;
  - Search status, shown inside the sheet, announces `Matching assets: <n>` once if the count changed;
  - `main[data-synced-seq]` takes the event's seq once all of that has painted.

For example, with the seed data at start: Lena at 375x812 on `/catalog?tag=PII` opens Filters, and Rui tags PII on `src.eligibility_2019.member_id`. Within 3 seconds the open sheet's PII count reads 7, focus is still on the PII radio, and Search status says `Matching assets: 7` once.

#### Lineage canvas

**Canvas keyboard (DP-45).** The same keys work in the hop-stacked list below 768 pixels, where each hop section counts as a band.

- **Tab order.**
  - Inside the canvas group: Trace impact (when shown), Zoom in, Zoom out, Reset view, then the one node Tab stop.
  - In the Lineage rail: Close lineage, Trace impact (when shown), then the one node Tab stop.
- **One roving Tab stop.**
  - Exactly one node is in the Tab order.
  - Tabbing to the nodes lands on the node that last had focus there.
  - After a column is opened, or after a redraw that removed that node, it lands on the focus node.
  - A redraw for the same focus column, an open-canvas update (DP-04, DP-97, DP-99) or a rebuild across a breakpoint keeps keyboard focus on the node with the same `data-column`, if a node had focus and that column is still drawn. A crossing that hides the drawing follows Focus across a breakpoint, in Choosing a node.
- **Row index.** A node's row index is its zero-based position in its band, which is sorted by column id.
- **Linked edges.** The edges used below are those in the current upstream and downstream lineage responses for the focus column, plus edges added by DP-04, leaving out every edge whose `kind` is `cycle`.
- **Right Arrow** (focus on a node) moves into the next band to the right (signed hop + 1):
  - If the focused node has linked edges to nodes in that band, focus goes to the first of those nodes by column id.
  - Otherwise focus goes to the node at the same row index in that band, or to that band's last node when the band is shorter.
  - If there is no band to the right, focus stays.
- **Left Arrow** mirrors Right Arrow into the next band to the left (signed hop − 1). It uses the nodes in that band that have a linked edge into the focused node.
- **Up Arrow and Down Arrow** move to the previous or next node in the same band and stop at its ends.
- **Home** moves to the focus node.
- **End** moves to the last node, by column id, of the downstream band with the largest hop. When there is no downstream node, End moves to the focus node.
- Arrow keys, Home and End move focus and the roving Tab stop only. They never change which node is chosen and never announce.
- **Space** on a node chooses it (Choosing a node, below).
- **Enter** on a node chooses it, then:
  - makes its column the focus column (the URL `column`, and if needed `asset`, update);
  - redraws the canvas for that column, where the new focus node is the chosen node;
  - moves focus to the Column detail heading.
- **Escape**, with focus inside the Column detail region, returns focus to the control that opened that column. That is the canvas node with that `data-column` when the column was opened by Enter, otherwise the `table "Columns"` row button.
- **T** (either case) starts Trace impact, for Stewards and Admins only, while focus is on any of these:
  - inside the canvas group: a node, `button "Trace impact"`, `button "Zoom in"`, `button "Zoom out"` or `button "Reset view"`;
  - inside the Lineage rail: a node, `button "Trace impact"` or `button "Close lineage"`.

  With focus anywhere else, T does nothing to the canvas.
- **Zoom keys (DP-46).** These keys work while focus is on a node, `button "Trace impact"`, `button "Zoom in"`, `button "Zoom out"` or `button "Reset view"` inside the canvas group. Each does exactly what the matching button does, and none of them does anything in the hop list.
  - `+` or `=` zooms in.
  - `-` zooms out.
  - `0` resets the view.
- **Keeping the focused node visible (DP-46).** A node may take keyboard focus while its box is not fully inside the content area inset by 16 pixels on every side. The pan then changes by the smallest amount that brings it inside on each axis, and the zoom stays as it is.
  - If the node's left edge is less than 16 pixels from the content area's left edge, the horizontal pan grows by the difference.
  - If its right edge is closer than 16 pixels to the content area's right edge, or past it, the horizontal pan shrinks by the difference.
  - The same applies vertically, with the content area's top edge and its bottom edge (the top of the empty strip).
  - The amounts are computed from the unrounded pan.

For example, with the seed data at start, open `src.claims_legacy.paid_amount` and Tab to the nodes. Then:
- Right lands on `stg.member_claims.paid_amount`.
- Right again lands on `mart.claims_by_region.total_paid`.
- Down lands on `scr.risk_scores.risk_score`.
- Right lands on `mart.member_risk.risk_score`.
- Up lands on `dash.claims_overview.total_paid`.
- Right lands on `dash.risk_outreach.risk_score`, through the row-index rule.
- End also lands on `dash.risk_outreach.risk_score`, and Home returns to `src.claims_legacy.paid_amount`.

**Choosing a node (DP-04).**
- A tap or click on a node, Space on a focused node, or Enter on a node chooses it. The chosen node takes keyboard focus (for Enter, before focus moves to the Column detail heading) and becomes the roving Tab stop. It reads `data-selected="true"`, and every other node reads `false`.
- Each choice announces the node-chosen copy (Feedback states) once in `status "Lineage status"`.
- A tap or click on a node never opens its column and never pans. Opening a column is Enter, a Columns row, or a result link.
- The chosen node is separate from the focus column in the URL. It never changes `column` or `asset` by itself.
- The choice survives every rebuild of the drawing for the same focus column. This includes crossing 768 pixels in either direction, opening or closing the Lineage rail, an open-canvas update and a sweep. After the rebuild, the node with the same `data-column` reads `data-selected="true"`. If keyboard focus was on a node before the rebuild, it is on that node after it.
- Opening another column makes its focus node the chosen node. A redraw that no longer draws the chosen column leaves no node chosen.
- **Focus when the Lineage rail opens.** Opening `complementary "Lineage"` moves focus to the first of these that is drawn in the hop list:
  1. the node that last had keyboard focus in the canvas or the hop list for the current focus column;
  2. the chosen node;
  3. otherwise `button "Close lineage"`.

  A node that receives focus this way becomes the roving Tab stop.
- **Focus across a breakpoint.** Focus never falls to the page body when the window crosses 768 pixels.
  - Crossing below 768 pixels while keyboard focus is on a node or any control inside `group "Lineage canvas"`: the Lineage rail stays closed and focus moves to `button "Lineage"`. A node that had focus is kept as the last focused node, so opening the rail lands on it.
  - Crossing to 768 pixels or wider while keyboard focus is on a hop-list node: focus moves to the canvas node with the same `data-column`. While focus is on any other control inside the Lineage rail, focus moves to `button "Trace impact"` in the canvas header when shown, otherwise to `button "Zoom in"`.

For example, Dana at 1280x800 with a finished trace of `src.claims_legacy.member_ssn` taps `mart.member_risk.member_ssn`. Lineage status says `mart.member_risk.member_ssn, hop 2` once. When she narrows the window to 375 pixels and opens Lineage, the hop list item `mart.member_risk.member_ssn` reads `data-selected="true"` and has focus.

**Pan and zoom (DP-47).**
- **Placement.** A content point at (x, y) appears on screen at (pan x + zoom × x, pan y + zoom × y). This is measured from the top-left corner of the content area, the `data-canvas-content` element.
- **Unrounded values.** The app keeps pan and zoom unrounded, and every later step starts from those values: drag, pinch, zoom button, zoom key, focus pan and placement. Only the recorded attributes are rounded:
  - `data-pan-x` and `data-pan-y` to the nearest whole pixel, with halves rounded up toward positive infinity;
  - `data-zoom` to two decimals.
- **Tolerance.** Every check of a recorded pan value, or of a point a gesture keeps fixed, allows a difference of up to 1 pixel from the exact formula.
- **Drag.** A one-finger drag or mouse drag adds the drag distance to the pan.
  - It pans only when it starts in the content area on a point not covered by a node, or anywhere in the empty strip. The empty strip always qualifies.
  - A drag that starts in the canvas header, on a node or on a button leaves the pan unchanged.
- **Pinch.** A two-finger pinch whose fingers both start in the content area or the empty strip keeps the content point under the pinch midpoint `m` fixed:
  1. The new zoom `z'` is clamped to 0.50 to 2.00 (both allowed).
  2. Each pan value becomes `m − (m − pan) × (z'/z)`, where `z` is the zoom before the step and `m` is measured from the content area's top-left corner.

  At a clamp bound, the point under `m` therefore stays fixed.
- **Zoom buttons.** Zoom in and Zoom out step the zoom by 0.25 within the same bounds, using the same formula with `m` at the centre of the content area. Reset view returns to zoom 1.00 and pan 0, 0.
- Pan and pinch work the same with reduced motion.
- An open-canvas update never changes zoom or pan.

For example, from rest at 768x1024, pressing Zoom in twice leaves zoom `1.50`. Each pan value is then minus half the content area's centre coordinate on that axis, which is minus a quarter of the content area's width or height, within the 1-pixel tolerance.

**Hop list scrolling (DP-97).** An open-canvas update, a live refresh or a role update that leaves the hop list's sections in place keeps the rail's scroll position within 2 pixels and keeps focus on the same node. An item that gains or loses a glyph or source line does not move the items above it.

#### Dialogs and actions

**Dialogs and sheets.**
- Opening a dialog moves focus to its first field. A dialog without fields (Reinstate asset) focuses its confirming button. Opening the Filters sheet focuses the checked Tag radio (Filters sheet, above). Opening the Lineage rail focuses the target set out in Choosing a node.
- Tab and Shift+Tab wrap inside it and never reach the page behind, banners included.
- Escape or Cancel closes it. On close, focus returns to the control that opened it when that control is still shown. Otherwise focus goes to the heading of the region the dialog belonged to, in this order of preference:
  - the Asset detail heading or the Column detail heading;
  - `heading "Glossary"` or `heading "Admin"`;
  - `heading "Admin only"`, once the Admin screen shows that.
- A confirmed certification move sends focus where DP-57 says instead.
- The Filters sheet and the Lineage rail follow the same rules, except for where focus lands when they open. While closed, they follow the closed-panel guarantee in Feedback states.
- Field errors come only from the server's 422. Dialogs never block a submit with checks of their own.
- **One opening, one key (DP-70, DP-76).**
  - Each opening of the Verify asset or Deprecate asset dialog generates one Idempotency-Key. Every submit from that opening sends it, including resubmits after an error.
  - Each new opening starts with empty fields and a new key. This includes a reopen during the exit transition.
  - Each opening of Edit term loads the term's current confirmed name, definition and revision.

**Verify (DP-56, DP-98).**
1. Verify opens the dialog.
2. The person picks the file, optionally types a note, and presses Verify asset.
3. While the upload runs, Dialog status shows the pending copy and the dialog shows the `data-upload-progress` line (Motion and effects). The line is removed when the reply arrives.
4. On success the dialog closes. The state reads verified, the Download evidence link and SHA-256 appear, Activity carries the success copy once, and focus lands by the DP-57 rule (on `button "Deprecate"`).
5. Every other open screen showing that asset, in any session or instance, shows verified and the Download evidence link within 3 seconds through the live refresh, with the filename and SHA-256 wrapped as set out in Screens and layout (DP-98).
6. On an error the dialog stays open with the error handling from Feedback states, and the asset stays as it was.

**Deprecate (DP-56).** Deprecate opens the dialog. The person types a reason and presses Deprecate asset. On success the dialog closes, the state reads deprecated, and Activity carries the success copy.

**Reinstate.** Reinstate opens the dialog, and Reinstate asset confirms.

**Certification focus (DP-57).**
- After a confirmed Verify, Deprecate or Reinstate closes its dialog, focus moves to the first of these that is now shown: `button "Verify"`, `button "Deprecate"`, `button "Reinstate"`. If none is shown, it moves to the Asset detail heading. So:
  - Verify lands on Deprecate.
  - An Admin's Deprecate lands on Reinstate. A Steward's Deprecate lands on the heading.
  - Reinstate lands on Verify.
- When the Verify asset dialog gets a 409 or a 503:
  - the dialog stays open;
  - Dialog status announces the API message once;
  - focus is on `button "Verify asset"`;
  - the chosen file and the note stay as they were.

  Escape then returns focus to `button "Verify"`.
- **Upstream link.** Enter or a click on the `link "<asset id>"` inside `note "Deprecated upstream"` opens that asset in the workspace. The URL `asset` updates, and focus moves to that asset's Asset detail heading.

**Open Verify dialog and upstream changes (DP-60).**
- While the Verify asset dialog is open, a live refresh of the asset behind it may make `note "Deprecated upstream"` appear or clear. That refresh:
  - never closes or re-renders the dialog;
  - never moves focus;
  - never clears the chosen file, the note or the opening's Idempotency-Key.
- A resubmit from the same opening after the upstream is reinstated sends the same key and can succeed, because refused requests are never stored.

**Tags and suppressions (DP-31, DP-34).**
- Pressing a Tag, Withdraw or Lift button sends the change. On a touch screen, a tap does the same.
- Suppress opens the Suppress tag dialog. The person types a justification and presses Suppress tag.
- At 375x812, every Tag, Withdraw, Suppress and Lift button, and the Suppress tag dialog's buttons, are at least 44 by 44 pixels.
- **One paint after the confirm.** When the server confirms, the screen reads again the column, the asset and the current search (under the latest-input rule). It paints these four together, in the same frame, once all those reads have answered:
  - Column detail's tag glyphs, tag sources and controls;
  - the asset's mono counts;
  - the matching result row's glyph counts (`data-tag-count`);
  - the facet counts.

  None of the four changes before that frame.
- In that same frame the canvas is redrawn for the same focus column, exactly as when a column is opened. A running or finished sweep is cancelled, and the downstream side returns to unlit.
- Activity carries the success copy once.
- The redraw never takes focus.

**Focus after a tag action (DP-37).** A confirmed Tag, Withdraw, Suppress (through its dialog) or Lift may remove the control that was pressed, or the one that opened the dialog. Focus then moves to the first of these now shown for the same tag:
1. `Withdraw <tag>`
2. `Tag <tag>`
3. `Suppress <tag>`
4. `Lift <tag> suppression`

If none is shown, focus moves to the Column detail heading. It never falls to the page body.
- The same rule applies when any refresh removes the focused tag control.
- Cancel on the Suppress tag dialog returns focus to the Suppress button.

For example, with the seed data at start:
- Suppressing Confidential on `mart.claims_by_region.region_zip` lands on `button "Lift Confidential suppression"`.
- Lifting it lands on `button "Suppress Confidential"`.
- Pressing `Tag PII` on `src.members.member_id` lands on `button "Withdraw PII"`.

**Refused tag actions (DP-38).** When a Tag, Withdraw or Lift answers 409, or the Suppress tag dialog's submit does:
- Activity announces the API message exactly once.
- The column, the asset's counts and the current search are read again and repainted in place, so the glyphs, sources, controls and counts show the confirmed state.
- Focus stays on the pressed control if it is still shown. Otherwise it moves by the DP-37 order.
- A Suppress tag dialog that got a 409 stays open with its justification.
- The later stream event for the other person's committed change never announces again and never clears that Activity message.

For example, with the seed data at start: if Rui tags PII on `src.members.member_id` just before Dana's Tag PII arrives, Dana's screen announces the `tag_exists` message once, shows the PII glyph, and focus is on `button "Withdraw PII"`.

**Bulk tag apply and undo (DP-06).**
1. A Steward or Admin ticks one or more `checkbox "Select <column name>"` boxes, picks a tag in `combobox "Tag to apply"`, and presses `button "Apply tag to selected"`.
2. The screen sends one bulk request with a new Idempotency-Key, and Activity shows the pending copy. A second press while the request is pending sends nothing.
3. On the reply, the column rows, counts and search repaint from fresh reads in one paint, exactly as for a single tag action. Activity announces the bulk success copy once. Every checkbox is cleared, and focus stays on `button "Apply tag to selected"`.
4. When the reply's `applied` is at least 1, `button "Undo"` appears directly after Activity. It stays until the person's next action or until pressed. It undoes only the latest bulk apply made on this screen.
5. Pressing Undo sends the undo request. On success, the rows repaint as above, Activity announces the undo success copy once, the Undo button is removed, and focus moves to `button "Apply tag to selected"`.
6. A refused Undo announces the API message once in Activity, removes the Undo button, re-reads the column, counts and search in place, and moves focus to `button "Apply tag to selected"`.
7. A refused bulk request (for example a 422) announces its message in Activity and keeps the ticked boxes.

For example, with the seed data at start: on `src.claims_legacy`, ticking `claim_id`, `diagnosis_code` and `service_date` and applying Confidential announces `Confidential applied to 2 of 3 columns.` Undo then announces `Bulk tag undone on 2 columns.`, and `claim_id` and `service_date` carry no direct tag again.

#### Glossary

**Glossary edit (DP-73, DP-76).**
- The Edit term dialog always sends the revision it loaded when it opened, even after a refresh shows a newer card behind it.
- A refresh never changes the dialog's fields or its Dialog status.
- On success the dialog closes, and focus returns to the term's Edit button, now named for the saved name.
- On a refusal, Cancel returns focus to the term's Edit button, named for the confirmed name the card now shows.

**New term by keyboard (DP-73).**
- New term and Edit term focus Term name, and Tab and Shift+Tab cycle only Term name, Definition, Save term and Cancel.
- A confirmed New term save moves focus to the new term's `button "Edit <name>"` at its glossary position.
- A 409 keeps focus on Save term with the typed text kept. A 422 follows DP-94.
- Escape returns focus to the opener.

**Another person's rename on an open Glossary (DP-75).**
- The Glossary screen follows the activity stream. Within 3 seconds of a `term.*` row committing, it re-reads GET /api/terms and repaints in place.
- In one paint, a renamed card shows its new name, takes its new grid position, and updates `data-revision` and its Edit button's name.
- Every focusable element inside a card (its Edit button and its asset links) is identified by the term id and, for links, the asset id. When a refresh relabels or moves the card holding the focused element, focus stays on the same element of the same term, in the same paint.
- When a refresh changes a card's confirmed name from the name this screen showed, `status "Glossary updates"` announces the rename copy (Feedback states) exactly once. A rename the person made on this screen has already painted, so it announces nothing there.
- The refresh never changes an open dialog, Activity or Dialog status.

For example, with the seed data at start: Sam at 375x812 on `/glossary` has focus on `link "ref.providers"` in the Provider card. Rui renames Provider to `Contracted provider for claims adjudication and network adequacy review`. Within 3 seconds:
- that card is listitem index 1, with the new name wrapped inside it, and reads `data-revision="2"`;
- focus is still on `link "ref.providers"` inside it;
- Glossary updates reads `Term renamed: Provider is now Contracted provider for claims adjudication and network adequacy review.` once.

#### Admin

**Admin screen (DP-13, DP-14).**
- Changing a role picker saves at once; there is no submit button.
- The Users table follows the activity stream. Within 3 seconds of a `user.create` or `user.role_change` row from any Admin session on any instance, the screen re-reads GET /api/users and repaints the table in place, in name order.
  - Role pickers and Reset password buttons are identified by user id, so a refresh that moves or relabels the focused control keeps focus on the same person's control.
  - The refresh never closes an open dialog and never changes Activity or Dialog status.
  - A refused role save shows the confirmed role again, with the API message in Activity.
- The Audit log table follows the activity stream. Within 3 seconds of any row committing, from anyone on any instance, the row reaches the table: either shown at the top, or held as set out below. The table's rows:
  - are always ordered by descending seq;
  - never hold one seq twice;
  - never skip a seq between their newest and oldest row;
  - never drop an older row already shown.
- Audit rows shown is rewritten at the moments Feedback states lists.
- Load older audit rows appends older rows below the ones shown.
- Check audit chain asks the server to check the log and reports the result in Chain check.
- A Seq link opens `/catalog?as_of=<seq>` in the same tab, as a new history entry.

**Held audit rows (DP-05).**
- **When rows are held.** A row is held when either of these is true as it arrives:
  - the table's first row has its top edge above the top of the viewport, because the Admin has scrolled down past it;
  - the `Show <n> new audit rows` button is already shown.

  Otherwise, including when the first row is still in view or below the viewport, the row is shown at the top of the table as it arrives.
- **Holding.** Held rows are not added to the table.
  - The first held row makes `button "Show <n> new audit rows"` appear directly above the table, and `status "Audit log updates"` announces the held-rows copy (Feedback states) exactly once.
  - Each further held row raises the button's `<n>` in place, with no further announcement.
- **Reading position.** Neither the button appearing nor any count change moves the rows in view: every audit row inside the viewport keeps its vertical position within 2 pixels, by scrolling the page to make up for anything added above.
- **Audit rows shown** does not change while rows are held.
- **Showing them.** Pressing the button, by click, tap, Enter or Space:
  1. inserts every held row at the top of the table in strictly descending seq, contiguous with the rows already shown, with no duplicate and no gap, whichever instance each row came from and in whatever order they arrived;
  2. removes the button;
  3. scrolls the new first row into view below the top bar;
  4. moves focus to that row's Seq link;
  5. rewrites Audit rows shown as Feedback states lists.
- Load older audit rows keeps working while rows are held.
- At 375x812 the stacked audit cards follow exactly the same rules.

**Back from a point-in-time view (DP-87).**
- Before following a Seq link, the Admin screen records in its own history entry the oldest seq the Audit log table shows and the seq of the link followed.
- Back to that entry shows `/admin` with the Audit log re-read from the newest row down to that same oldest seq. The followed row is scrolled into view below the top bar, and focus is on its Seq link. Audit rows shown follows Feedback states for the re-read.
- Rows that commit after that re-read follow the held-rows rule.

**Times in the viewer's zone (DP-51).**
- Each When cell, and the recorded-time line of the Point in time note, shows its instant in the browser's own time zone, with the UTC offset in force in that zone at that instant, in the time format Feedback states gives.
- It is computed only from the `at` string received. So a row whose `at` falls inside a repeated fall-back hour shows that hour's wall time with the offset in force at its own instant.
- The Catalog as of form ignores the browser's zone and always uses America/Chicago.

For example, for a browser in Europe/London, a row with `at` `2026-10-25T00:30:00.000Z` shows `2026-10-25 01:30:00.000 UTC+01:00`, and a row with `at` `2026-10-25T01:30:00.000Z` shows `2026-10-25 01:30:00.000 UTC+00:00`.

**Catalog as of (DP-88).**
1. The Admin types a business time into `textbox "Business time"` in the form `YYYY-MM-DDTHH:mm:ss`. They press `button "Open catalog as of"`, or press Enter in the field.
2. Input that is not exactly that form, or not a real calendar date and time, shows the malformed copy in Point in time status and sends nothing.
3. Otherwise the screen converts the wall time by the business-time rule in Business rules, whatever the browser's own time zone. It sends GET /api/search with `as_of_time=<wall time><offset>`, for example `as_of_time=2026-09-30T23:59:59-05:00`.
4. It then opens `/catalog?as_of=<as_of_seq from that response>`.
5. A refused request shows the API message in Point in time status.

**Password reset (DP-07).** `button "Reset password for <name>"` opens `dialog "Reset password"`. The Admin types the new password and presses Reset password. On success the dialog closes, focus returns to the opener, and Activity carries the success copy.

**Role change on an open screen (DP-08, DP-95).** Every signed-in screen follows the activity stream. When the person's own `user.role_change` event arrives, the screen reads GET /api/session again. Within 3 seconds of the change committing, the screen does all of the following.

- **Controls.** It re-renders every role-gated control for the new role.
- **Reads.** On the catalog it re-reads the current search, the open asset and the open column, under the latest-request rule, so samples follow the new role's masking. For example, a Steward demoted to Analyst sees `[masked]` in place of the PII samples of the open column.
- **Dialogs.**
  - It closes any open dialog the new role may not use:
    - Steward and Admin dialogs: Verify asset, Deprecate asset, Suppress tag, New term, Edit term;
    - Admin-only dialogs: Reinstate asset, Add user, Reset password.
  - The reply to any request such a dialog still had in flight is never shown.
  - The Filters sheet and the Lineage rail stay as they are.
- **Traces (DP-95).** What a role change does to a trace is set out here and owned by DP-95.
  - When the new role may not trace (Analyst or Viewer), a trace whose response has not arrived yet, or whose sweep is running, is cancelled. Its response never paints, and no node lights and no edge turns drawn for it. The canvas or hop list is redrawn at rest for the same focus column exactly as when the column is opened: `data-sweep="idle"`, counter 0, and no badges, seal marks or cycle arcs from the trace. Trace summary is emptied and announces nothing.
  - A finished sweep stays as it is.
  - When the new role may still trace, a running sweep finishes on its original schedule and its summary is announced once.
  - Trace impact disappears, and T no longer starts a trace, when the new role may not trace.
- **Focus.** If the focused element was removed, focus moves as follows, and never to the page body:
  - from a tag or suppression control: by the DP-37 order;
  - from a bulk tag control or Undo: the Asset detail heading;
  - from a certification control or its closed dialog: the first shown of `button "Verify"`, `button "Deprecate"`, `button "Reinstate"`, else the Asset detail heading;
  - from Trace impact (DP-95): `button "Zoom in"` in the canvas header, or `button "Close lineage"` in the Lineage rail;
  - from New term, an Edit button or their closed dialog: `heading "Glossary"`;
  - from any Admin control or its closed dialog: `heading "Admin only"`.

  A node that had focus keeps it through the redraw.
- **Activity** announces the role-change copy exactly once, and that copy stays until the person's next action.
- **Marker.** `main[data-synced-seq]` takes the role change's seq once all of the above has painted.
- **Admin screens.**
  - On `/admin`, a person who is no longer an Admin sees the admin-only heading, and the Admin link disappears.
  - In a point-in-time view, a person who is no longer an Admin has `as_of` removed with a history replace and sees the live catalog.
  - A person promoted to Admin sees the Admin link appear.

For example, with the seed data at start: Dana at 375x812 on `/catalog?asset=src.members&column=src.members.ssn` opens Lineage and presses Trace impact while the trace response is still on its way. Morgan sets Dana to Analyst. Within 3 seconds:
- Dana's `complementary "Lineage"` reads `data-sweep="idle"`;
- Trace impact is gone, and focus is on `button "Close lineage"`;
- the samples of `src.members.ssn` read `[masked]`;
- Activity has said `Your role changed to Analyst.` once.

Morgan's own Activity says `Role updated: Dana Okafor is now Analyst.` once, and Dana's row picker shows Analyst.

**Session ended on an open screen (DP-07).**
- When a screen's activity stream ends, the screen reads GET /api/session again. Any 401 after sign-in takes the person to `/signin`, which shows the session-ended copy.
- After an Admin resets someone's password, each of that person's open screens reaches `/signin` this way within 5 seconds.

**Point-in-time workspace (DP-87).**
- With `as_of=<k>` in the URL, an Admin's workspace:
  - shows `note "Point in time"`;
  - makes every read (search, asset, column, both lineage directions and Trace impact) with `as_of_seq=k`;
  - renders no Tag, Withdraw, Suppress, Lift, Verify, Deprecate or Reinstate control, no row checkbox, no Tag to apply, no Apply tag to selected, no Undo and no Download evidence link, at any width, including inside the Filters sheet and the Lineage rail (Trace impact stays);
  - never changes its results, facets, asset detail, column detail, canvas or hop list because of another person's change;
  - opens its activity stream with `after_seq=k` and uses it only for the newer-changes line and for the person's own role change.
- **Newer changes.** `<n>` in the newer-changes line is the number of rows the stream has delivered with a seq above k.
  - The line appears in the note once `<n>` is at least 1, and is announced exactly once in `status "Activity"` when it first appears.
  - After that, `<n>` updates in place within 3 seconds of each further commit, with no further announcement.
- **Marker.** `main[data-synced-seq]` reads k for as long as the view is open, and never changes.
- **What the past view shows.** It shows the catalog as of k at every width. For example, the hop list at 375x812 still shows a tag that was withdrawn after k and still lists a node reached only through an edge removed after k. Long ids wrap with no horizontal scrolling.
- `link "Back to the live catalog"` removes `as_of` from the URL and leaves the other parameters.
- The search, facet, canvas, sweep and keyboard rules apply unchanged.
- Back returns to the Admin screen as set out above. Forward reopens the same as-of view, and reloading or sharing the URL with another Admin reproduces it.
- If the server refuses the seq with 422, the screen removes `as_of` with a history replace and shows the live catalog.
- For every other role, `as_of` is removed from the URL with a history replace and ignored.

**Hover and press.** Result rows, nodes and buttons get an ink underline or a pale ink tint on hover, and a slightly darker tint on press. Keyboard focus shows a clear ink ring set slightly outside the control.

### Visual design (DP-24, DP-28, DP-93, DP-99)

**Colour roles.** No gradients, no shadows and no other hues:
- a warm off-white paper ground;
- one near-black slate ink for text, emphasised rules, lit nodes, drawn edges and actions;
- a warm grey for the hairline rules that divide panes and bands, and for unlit nodes and undrawn edges;
- a burnt orange used only for PII;
- a deep teal used only for Confidential.

**Tag encoding.** PII is diagonal hatching plus a "P" glyph. Confidential is a dotted outline plus a "C" glyph. Tags therefore never depend on colour alone.
- A column row shows one glyph per effective tag.
- A canvas node or hop-list item shows one glyph per tag in its `data-tags`.
- A search result row always shows both glyphs, each beside its column count, even at 0.
- The hatching is a hard-edged repeating stripe pattern. It is not a gradient: the no-gradient rule bans only smooth colour blends.

**Deprecation on the drawing.** A node whose asset is deprecated shows its column id struck through with a single ink line and a dashed outline. A node whose asset sits downstream of a deprecated asset keeps its solid outline. Both carry the small mono "D" flag in their top-right corner, so deprecation never depends on colour alone.

**New lineage on the drawing.** An edge with `data-edge-state="new"` is drawn as a dashed ink line, so it reads as lineage the trace has not yet covered. A node added by DP-04 is drawn unlit, in warm grey.

**Text people typed.** Every value a person entered is shown as plain characters exactly as stored: descriptions, samples, column names, term names and definitions, reasons, notes, justifications, filenames, user names and emails. A value such as `Totals <net> & "gross"` shows those characters and creates no element.

**Type.**
- Display headings use Fraunces, a soft, high-contrast serif.
- Body text uses IBM Plex Sans.
- Every count, hop number, sequence number, hash, sample value and timestamp uses IBM Plex Mono with even-width figures.
- Each heading step is about a fifth larger than the one below it. The asset heading jumps to roughly two and a half times body size.

**Density and composition.**
- Rows are compact, on a steady 4, 8, 16 and 24 pixel rhythm.
- The workspace reads as a surveyed drafting sheet:
  - 1-pixel hairlines frame every pane;
  - the hop numbers along the canvas top read like survey stations;
  - the focus band carries a slightly heavier ink rule;
  - the canvas header sits above the drawing behind a hairline;
  - the empty strip at the canvas bottom reads as the sheet's blank margin: plain paper below a hairline.
- Banners and the Point in time note are full-width bands of ink text on paper, set off from the panes by hairline rules. The Point in time note's seq and times are in mono.
- The sticky top bar has a solid paper ground and a hairline under it, so nothing shows through it.
- An open dialog or sheet sits on a flat, semi-opaque paper-toned backdrop over the page.

**Comfort and contrast.**
- Every control is at least 44 by 44 pixels to tap.
- Text and glyphs meet WCAG 2.2 AA contrast on the paper ground. Where a tag hue would fall short for small text, the text stays ink and the hue carries only the pattern.

### Motion and effects (DP-04, DP-26, DP-42, DP-43, DP-44, DP-47, DP-48, DP-97, DP-98, DP-99)

**General feel.** Motion starts quickly and settles softly.
- Dialogs, the Filters sheet and the Lineage rail fade and slide in over about a quarter of a second, and leave in about a fifth of a second.
- Result and count changes cross-fade in under a fifth of a second.
- A node's tag tint, seal mark or deprecation mark that changes on a live refresh cross-fades in about a fifth of a second.
- When an open-canvas update adds nodes to a band, the band's nodes ease to their new places over about a quarter of a second.
- A glossary card that moves after a rename takes its new place in the same paint as its new name. It does not slide.
- Hover tints respond within a tenth of a second.
- **Upload progress.** While a verify upload is pending, the `data-upload-progress` element is a thin ink line along the Verify asset dialog's top edge, with a short segment travelling across it about once a second. This is the only repeating motion in Strata, and it stops when the reply arrives.
- There is no other looping or decorative animation anywhere.

**Settled states (DP-26).** Every animated transition ends in a published settled state that can be read from the page:
- Each dialog, the Filters sheet and the Lineage rail carry `data-transition`:
  - `entering` while they appear;
  - `open` once they have settled open;
  - `leaving` from the moment they start to close until they are hidden.

  From the moment a close starts, the panel is inert. A reopen during `leaving` returns it to `entering` or `open`, and it stays open.
- The canvas group (and `complementary "Lineage"` below 768 pixels) carries `data-layout`: `settling` while nodes ease to new places after an open-canvas update or a rebuild, and `settled` otherwise.
- The sweep's settled state is `data-sweep="done"`.
- While `data-motion` is `reduced`, every one of these reaches its settled value at once: `open` (or hidden), `settled`, and `done`. Each makes the same announcement it makes with full motion. This also holds when reduced motion is switched on while a transition is under way: it jumps to its settled value in the next frame.

**Reduced motion, followed live (DP-48).**
- `main` carries `data-motion="reduced"` while the system asks for reduced motion and `data-motion="full"` otherwise. Strata follows a change of that setting as it happens, without a reload, and the attribute changes before the next frame paints.
- While `data-motion` is `reduced`, nothing on the page animates or transitions: the page reports no running animations at any moment.
  - Dialogs and panels appear and disappear at once.
  - Live refresh changes and open-canvas updates paint at once.
  - The upload progress line is a still line.
- A sweep running when reduced motion switches on jumps at once to its finished reduced-motion form (below), and its summary is announced once.

**Canvas at rest.** Opening a column requests its upstream and downstream lineage and draws:
- **The focus node** in band 0. It always has `data-lit="true"`, and its `data-tags` equal the response's `focus_tags`.
- **Upstream nodes** from the upstream response, in negative bands. Each has `data-lit="false"`, and its `data-tags` equal its `carried_tags`. No trace changes them.
- **Upstream edges**, every one with `data-drawn="true"`.
- **Downstream nodes** from the downstream response, in warm grey. Each has `data-lit="false"` and empty `data-tags` until a trace lights it.
- **Downstream edges**, every one with `data-drawn="false"`.
- **Every edge** with `data-edge-state="current"`.
- **Every node's** `data-deprecated` and `data-deprecated-upstream` from the lineage response's `assets` entry for its asset.
- **Hop-list source lines** for each node's `data-tags`, from the response's `focus_tag_sources` (focus node) or the node's `tag_sources`.

A lit node or drawn edge stays that way until the next trace starts or the canvas is redrawn for a column.

**Suppression seal rule.** A node shows a `data-seal="suppression"` mark exactly while its response entry's `sealed_tags` is not empty and either:
- it is a lit downstream node; or
- it is an upstream node.

**Downstream sweep (signature).**
1. **Reset.** Pressing Trace impact (or T) requests the downstream lineage. In the same moment it resets the downstream side:
   - any running sweep is cancelled;
   - every downstream node, lit or not, returns at once to warm grey with `data-lit="false"` and empty `data-tags`;
   - every downstream edge element is removed;
   - the seal marks, cycle arcs and hop-number badges of an earlier trace are removed;
   - the counter shows 0;
   - Lineage status is emptied without an announcement;
   - the canvas reads `data-sweep="idle"` until the response arrives.

   This holds for a first trace, a re-trace after a finished sweep, and a re-trace mid-sweep alike.
2. **Time zero** is the moment the browser receives the response. The canvas then reads `data-sweep="running"`. The downstream nodes and edges are rebuilt to match the response, all unlit, with empty `data-tags`, `data-drawn="false"` and `data-edge-state="current"`. The focus node and the upstream side are left as they are.
3. **Step.** The step is the smaller of 140 milliseconds and 1580/N milliseconds, where N is the response's deepest hop. Hop band k begins lighting k steps after time zero.
4. **Lighting a band.** As band k begins lighting:
   - each of its nodes takes `data-lit="true"` and `data-tags` equal to its `carried_tags`;
   - every downstream edge whose target is in band k takes `data-drawn="true"`, except cycle edges.

   Over 220 milliseconds each node fills from warm grey to ink, the edges into it draw from left to right, and its carried tags tint its hatch or outline.
5. **Seals.** An edge whose `kind` is `seal` draws to a seal mark, a short perpendicular bar, and no tint passes it. A node whose `sealed_tags` is not empty gets a suppression seal mark as it lights.
6. **Cycles.** Each cycle edge takes `data-drawn="true"` as its source's hop begins lighting. It is drawn once, as a return arc labelled "cycle", and its target is not lit again.
7. **Counter.** A hop settles 220 milliseconds after it begins. The mono counter starts at 0. As each hop settles, it shows the running total of reached columns through that hop, ending at the response's column total.
8. **Done.** When the last hop settles (at once if nothing is reached), the canvas reads `data-sweep="done"`.
   - Every downstream node's `data-hop`, `data-lit` and `data-tags` match the response.
   - Every downstream edge reads `data-drawn="true"`.
   - The Trace summary region replaces the pending copy with the summary.
   - The whole sweep therefore ends within 1.8 seconds of time zero.
9. Within one trace the sweep never runs backwards. Feedback states sets out what a rebuild, an interruption or a role change does to it. Live activity events never change a sweep's lit, drawn, hop, counter or summary state. They change the drawing only as the open-canvas rules below allow.

**Open canvas follows tag and certification changes (DP-97, DP-99).** A live canvas or hop list (not a point-in-time one) follows other people's changes in place.
- **When.** Within 3 seconds of a `tag.*` or `certification.*` row committing, it re-reads the upstream and downstream lineage of its focus column. It then updates the nodes already drawn, matched by column id:
  - the focus node's `data-tags` take the new `focus_tags`;
  - each upstream node's `data-tags` take its new `carried_tags`, and its suppression seal mark follows its new `sealed_tags`;
  - each lit downstream node's `data-tags` take its new `carried_tags`, and its suppression seal mark follows its new `sealed_tags`; unlit downstream nodes keep empty `data-tags`;
  - every hop-list source line follows the node's new `data-tags` and its new sources;
  - every node's `data-deprecated`, `data-deprecated-upstream` and deprecation flag follow the new `assets` entries;
  - tag glyphs follow `data-tags`.
- **What stays.** Nothing else changes. Which nodes and edges are drawn, `data-lit`, `data-drawn`, `data-hop`, `data-edge-state`, `data-selected`, `data-sweep`, the counter, Trace summary, zoom, pan, the hop list's scroll position and focus all stay as they were. A node the new responses no longer list keeps its values.
- If a sweep is running when the update is ready, the update is applied in the frame the sweep reaches `done`.
- With `data-motion` `reduced`, the update paints at once, with no transition.
- `main[data-synced-seq]` takes the event's seq once the canvas update, and any other refresh the event calls for, has painted.

**Open canvas follows lineage changes (DP-04).** Within 3 seconds of a `lineage.add` or `lineage.remove` row committing, a live canvas or hop list re-reads the upstream and downstream lineage of its focus column. It then changes only what follows:
- **New edges.** Every edge in the new responses that is not drawn yet is added. It carries `data-edge`, `data-from`, `data-to`, `data-kind` (from the new response), `data-drawn="true"` and `data-edge-state="new"`.
- **New nodes.** Every end of a new edge that is not drawn yet is added as a node in the hop band given by the new response, with `data-lit="false"`. A band that did not exist yet is created in its place. A new downstream node has empty `data-tags`. A new upstream node has `data-tags` equal to its `carried_tags`. Its deprecation attributes come from the new `assets` entry. Below 768 pixels the new node is added to its hop section of the hop list, in column id order.
- **Removed edges.** Every drawn edge that the new responses no longer list is removed. Its nodes stay.
- **What stays.** Every node already drawn keeps its `data-lit`, `data-hop`, `data-tags` and `data-selected`, and every edge already drawn keeps its `data-drawn` and `data-edge-state`. `data-sweep`, the counter, Trace summary, zoom, pan, the chosen node and focus stay as they were.
- **Layout.** The canvas reads `data-layout="settling"` while the band's nodes ease to their places, then `settled`, at once under reduced motion.
- **Announcement.** When an update adds or removes at least one edge, `status "Lineage status"` shows the lineage-changed copy (Feedback states). It is announced exactly once per drawing, however many edges and events arrive. It stays until the next trace starts or the canvas is redrawn for a column.
- If a sweep is running when the update is ready, the update is applied in the frame the sweep reaches `done`.
- `asset.register` rows don't change a drawn canvas by themselves.
- `main[data-synced-seq]` takes the event's seq once the update has painted.

For example, with the seed data at start: Dana at 1280x800 has a finished trace of `src.claims_legacy.member_ssn` (5 columns over 3 hops). Rui registers `mart.member_outreach` with a column `member_ssn` and records `copy ← stg.member_claims.member_ssn`. Within 3 seconds:
- an edge with `data-from="stg.member_claims.member_ssn"`, `data-to="mart.member_outreach.member_ssn"`, `data-kind="flow"` and `data-edge-state="new"` appears;
- `mart.member_outreach.member_ssn` sits in hop band 2 with `data-lit="false"`;
- every other node still reads as before, the counter still reads 5, and Trace summary is unchanged;
- Lineage status says `Lineage changed since this trace. Trace again to include it.` once.

Lena at 375x812 with `src.claims_legacy.member_ssn` open in the hop list sees `mart.member_outreach.member_ssn` under `Hop 2`.

For example, with the seed data at start: Rui at 375x812 has a finished trace of `stg.member_claims.member_ssn` open in the hop list, scrolled so the `Hop 2` section is at the top, with focus on `mart.member_risk.member_ssn`. Dana withdraws PII on `src.members.ssn`. Within 3 seconds:
- the `src.members.ssn` item (Upstream hop 1) drops its PII glyph and source line;
- the focus item keeps its PII glyph, and its source line reads `PII from src.claims_legacy.member_ssn`;
- the lit `mart.member_risk.member_ssn` and `dash.risk_outreach.member_ssn` keep PII, with the same source line;
- the rail's scroll position and focus are unchanged.

Dana's Activity says `PII tag withdrawn from src.members.ssn. Still reaches 3 columns through other paths.` once.

For example, with the seed data at start: Omar at 1280x800 has `mart.member_risk.member_ssn` open, and switches reduced motion on. Dana suppresses PII on `stg.member_claims.member_ssn`. Within 3 seconds, with no transition:
- the upstream node `stg.member_claims.member_ssn` gains a `data-seal="suppression"` mark and reads empty `data-tags`;
- the focus node, `src.members.ssn` and `src.claims_legacy.member_ssn` read empty `data-tags`, with no PII glyph.

For example, with the seed data at start: Omar has `mart.claims_by_region.total_paid` open, and Rui deprecates `src.claims_legacy`. Within 3 seconds:
- `src.claims_legacy.paid_amount` reads `data-deprecated="true"`;
- `stg.member_claims.paid_amount`, the focus node and `dash.claims_overview.total_paid` read `data-deprecated-upstream="src.claims_legacy"`.

After Morgan reinstates, all read `false` and empty again.

**Reduced-motion sweep.** When `data-motion` is `reduced`:
- Trace impact resets the downstream side exactly as in step 1. On the response it goes straight from idle to done:
  - every reached downstream node lights at once with its carried tags and a hop-number badge;
  - every downstream edge is drawn;
  - the counter shows the final total immediately.
- The focus and upstream nodes carry no badge. Without reduced motion, no node carries one.
- Seal marks, cycle arcs and the summary announcement are unchanged.

**Below 768 pixels.** The hop-stacked list sweeps the same way. Each hop section's items reset and light on the same schedule, with the same reduced-motion substitute and the same open-canvas updates, and the list draws no edge elements. At this width the sweep state (`data-sweep`) and `data-layout` are carried by the `complementary "Lineage"` element.

### Feedback states (DP-04, DP-05, DP-06, DP-08, DP-18, DP-19, DP-20, DP-26, DP-31, DP-38, DP-42, DP-44, DP-51, DP-56, DP-59, DP-66, DP-69, DP-70, DP-71, DP-72, DP-75, DP-76, DP-85, DP-87, DP-88, DP-94, DP-95, DP-96, DP-97, DP-98)

Every async action shows pending copy, then success or error copy, in its named live region. API error messages are shown exactly as the server sends them, including 403 refusals.

| Action | Live region | Pending | Success | Error |
|---|---|---|---|---|
| Sign in | `Sign-in status` / `alert` | `Signing in...` | goes to `/catalog` | API message in `alert` |
| Search | `Search status` | `Searching...` | `Matching assets: <n>` | for a 422, the first message in the response's `fields`; for any other failure, `Search is unavailable. Try again.` |
| Tag | `Activity` | `Saving...` | `<tag> tag added to <column id>.` | API message |
| Withdraw | `Activity` | `Saving...` | `<tag> tag withdrawn from <column id>.` when `<reach>` is 0; `<tag> tag withdrawn from <column id>. Still reaches <reach> columns through other paths.` when `<reach>` is above 0 | API message |
| Suppress | `Dialog status`, then `Activity` | `Saving...` | `<tag> suppressed on <column id>.` | API message |
| Lift suppression | `Activity` | `Saving...` | `<tag> suppression lifted on <column id>.` | API message |
| Apply tag to selected | `Activity` | `Saving...` | `<tag> applied to <a> of <n> columns.` | API message |
| Undo | `Activity` | `Saving...` | `Bulk tag undone on <a> columns.` | API message |
| Trace impact | `Trace summary` | `Tracing...` | the response's `summary` | `Trace is unavailable. Try again.` |
| Another person's lineage change on an open drawing | `Lineage status` | — | `Lineage changed since this trace. Trace again to include it.` | — |
| Choosing a node | `Lineage status` | — | `<column id>, hop <hop>` | — |
| Verify | `Dialog status`, then `Activity` | `Uploading evidence...` | `Verified. Evidence stored as <filename>.` | API message (409 or 503); for 422, the field rule below |
| Deprecate | `Dialog status`, then `Activity` | `Saving...` | `Deprecated. Downstream owner notices queued: <n>.` | API message |
| Reinstate | `Dialog status`, then `Activity` | `Saving...` | `Reinstated to draft. Unsent notices cancelled: <n>.` | API message |
| Save term | `Dialog status`, then `Activity` | `Saving...` | `Term saved.` | API message |
| Change role | `Activity` | `Saving...` | `Role updated: <name> is now <role>.` | API message |
| Create user | `Dialog status`, then `Activity` | `Saving...` | `User created: <name>.` | API message |
| Reset password | `Dialog status`, then `Activity` | `Saving...` | `Password reset: <name> was signed out of <n> sessions.` | API message |
| Open catalog as of | `Point in time status` | `Resolving...` | opens the point-in-time catalog | `Use YYYY-MM-DDTHH:mm:ss in America/Chicago time.` for malformed input; API message otherwise |
| Check audit chain | `Chain check` | `Checking...` | `Audit chain intact through seq <n>.` / `Audit chain broken at seq <n>.` | API message |
| Load older audit rows | `Audit rows shown` | `Loading...` | `Showing <n> of <total>.` | API message |
| Rows held above the Audit log | `Audit log updates` | — | `<n> new audit rows.` | — |
| Newer changes in a point-in-time view | `Activity` | — | the newer-changes line below | — |
| Own role changed by someone else | `Activity` | — | `Your role changed to <role>.` | — |
| Another person's rename on Glossary | `Glossary updates` | — | `Term renamed: <old name> is now <new name>.` | — |

**Placeholders.**
- `<n>` is a whole number in plain digits:
  - for Search, the response's `total`;
  - for Apply tag to selected, the number of columns the request named (`requested`);
  - for Deprecate, the response's `notices_queued`;
  - for Reinstate, its `notices_cancelled`;
  - for Reset password, its `sessions_ended`;
  - for Check audit chain, `checked_through` when intact and `first_broken_seq` when broken;
  - for Audit rows shown, the number of rows in that table;
  - for Rows held above the Audit log, and for the button `Show <n> new audit rows`, the number of rows held at that moment (the announcement is made only once, when the button first appears).
- `<a>` is the reply's `applied` for Apply tag to selected, and `restored` for Undo.
- `<reach>` is the withdrawal reply's `still_reaching`.
- `<hop>` is the node's `data-hop` value as written, with a hyphen-minus for upstream hops (for example `-2`).
- `<total>` starts as the `total` of the latest GET /api/audit response the screen received. It goes up by one for each live row the Audit log table adds after that response, including each held row when it is shown.
- `<tag>` is `PII` or `Confidential`.
- `<filename>` is the original evidence filename.
- `<role>` is the role name as in Seed data.
- `<name>` is the person's name.
- `<old name>` is the card's name as this screen showed it before the refresh, and `<new name>` its confirmed name after.

**Audit rows shown.** Its success copy `Showing <n> of <total>.` is rewritten after exactly these moments, and at no others:
- the first load of the Audit log table, and the re-read when Back returns to the Admin screen;
- each reply to Load older audit rows;
- each live row the table adds from the activity stream without holding it, which raises both `<n>` and `<total>` by one;
- each press of `Show <n> new audit rows`, which raises both by the number of rows it inserts.

**Time format (DP-51).** A viewer-zone time is `YYYY-MM-DD HH:mm:ss.sss UTC±HH:MM`: the date, a space, the 24-hour time with three fractional digits, a space, then `UTC`, a plus or minus sign and the offset's hours and minutes, each two digits. A zero offset is written `UTC+00:00`.

**Fixed copy.**
- **Empty search state.** Shown in the results area in place of the results list, directly below the one Clear filters button: `No assets match these filters. Clear a filter or search a broader term.`
- **Deprecated-upstream warning.** In `note "Deprecated upstream"`: `Upstream <asset id> is deprecated. Values here may stop updating.`, where `<asset id>` is the response's `deprecated_upstream` and is the text of the note's link.
- **Evidence outage banner:** `Evidence storage is unreachable. Verification is paused; everything else works.`
- **Mail outage banner:** the line `The mail relay is unreachable. Deprecation notices are queued and will send when it returns.`, then a second line `Queued notices: <count>`, where `<count>` is the text of the `data-queued-notices` element.
- **Point in time note.** In this order:
  1. `Catalog as of audit seq <k>. Later changes are not shown.`, where `<k>` is the resolved seq, in mono;
  2. the recorded-time line: `Seq <k> was recorded at <time>.`, where `<time>` is the response's `as_of_at` in the viewer-zone time format, or `Seq 0 is the seeded first-run state.` when k is 0;
  3. once there are newer changes, the newer-changes line: `<n> newer changes since seq <k>.`;
  4. `link "Back to the live catalog"`.
- **Session ended.** After sign-in, any 401 sends the person to `/signin`, which shows `Your session ended. Sign in again.` in `alert`.
- **Tag source line** in Column detail: one line per source in `list "Tag sources"`, with ids in mono: `<tag> inherited from <source column id>` for an inherited tag, and `<tag> set directly` for a direct tag.
- **Hop-list source line:** `<tag> from <source column ids joined by ", ">`, with ids in mono.
- **Canvas with no asset open:** `Pick an asset to see its lineage.`
- **Admin screen for other roles:** heading `Admin only`.

**Dialog field errors (DP-94).**
- When a dialog submit answers 422, Dialog status announces the first invalid field's API message once. "First" follows the order of fields in the dialog.
- Each field named in `fields` is marked as set out in Public screens and controls, and focus moves to the first invalid field.
- Marks stay when another file is chosen. A successful resubmit, or Cancel, clears every mark.
- 409 and 503 replies mark no field.

**Banners (DP-66, DP-69, DP-70, DP-71).**
- Banners follow GET /api/status, polled every 5 seconds. They appear or clear within 10 seconds of the service changing state.
- A verify that answers 503 shows the evidence banner within half a second of that reply, without waiting for the next poll.
- A status poll whose request was sent before the latest verify, deprecation or reinstatement reply arrived is ignored.
- However often a service's status flips, there is never more than one banner element for it, and the order stays evidence, then mail.
- A banner appearing, clearing or reordering never moves focus. Banners hold no focusable element. While a dialog is open, Tab and Shift+Tab cycle only through that dialog's controls, so the Verify asset dialog cycles through exactly Evidence file, Note, Verify asset and Cancel.

**Interface guarantees.**

- **Confirmed outcomes only (DP-69).** No screen shows an outcome before the server confirms it.
  - From pressing Verify asset until the reply, the asset's state, the Download evidence link and the column and asset counts keep their earlier values. The word "verified" and the evidence link never appear for a request that ends in an error, not even briefly.
  - Tag glyphs, tag sources and counts change only after a 2xx reply. A refused change leaves them as they were until the DP-38 re-read shows the confirmed state.
  - The `data-queued-notices` count takes the deprecation or reinstatement reply's `queued_notices` as soon as that reply arrives. After that it takes `queued_notices` from each status poll that is not ignored, so it follows the server's count as other instances queue, send or cancel notices.
  - The `<n>` in the Deprecate and Reinstate success copy in Activity is fixed by the reply and never changes. Polls and refreshes update only the banner's `data-queued-notices`, never the Activity copy.
- **Outage replies hold (DP-70).** A Verify asset dialog that shows the 503 copy keeps that copy, the chosen file and the note through every status poll, banner change and refresh. Only the person's next submit or Cancel changes them. A resubmit from the same opening sends the same Idempotency-Key.
- **Glossary shows confirmed edits only (DP-76).**
  - While a Save term request is pending, these keep their earlier values: the term card's name, definition and `data-revision`, its `Edit <term name>` button, and the glossary order.
  - On 409 or 422 the dialog stays open with the person's typed values unchanged. The list shows only confirmed values, including another Steward's confirmed rename that arrived by refresh.
  - On 200 the card, the button name, `data-revision` and the card's grid position change together, in the same paint.
- **Latest request wins (DP-20).** A search state is the query plus every facet selection, as held in the URL.
  - Each of three surfaces (the search results, the open asset and the open column) paints only the response to the latest request sent for that surface, whatever triggered it: the person's input, the re-read after their own action, a DP-38 resync, a role-change re-read or an event refresh.
  - A response to an earlier request never renders or announces, even if it arrives after the newer one.
  - After any run of typing, facet choices, Back and Forward, the screen settles on the results for the URL left at the end.
  - Every search the person triggers (typing, a facet choice, Clear filters, or a Back or Forward step) sets Search status to `Searching...` and then, when it settles, to `Matching assets: <n>`. Each such refinement announces its count exactly once, even when unchanged.
  - Searches the person did not trigger directly (an event refresh, the re-read after the person's own action, a DP-38 resync or a role-change re-read) never write `Searching...`. They leave Search status untouched unless `<n>` differs from the count last announced, and then announce `Matching assets: <n>` once.
  - Opening asset A then asset B, or focusing column X then column Y, before the earlier answer arrives paints only B or Y, in the Asset detail heading, the Column detail and the canvas's `data-column` values.
  - Another person's event never clears or changes the Activity copy of the person's own action.
- **Live refresh (DP-85).** The catalog workspace follows the activity stream. A change counts when it is any event except `user.*` and `evidence.download`. Within 3 seconds of such a change committing, the workspace re-runs the current search state and reloads the open asset and column, in place. So a newly registered asset that matches the open search state joins the results within 3 seconds, and the changed count is announced once.
  - A refresh search is built from the URL at the moment it is sent. If the person changes the search state or opens another asset or column before it answers, its response never renders or announces, and it does not set the baseline for the next count announcement.
  - The refresh keeps focus where it was, except under the DP-37 rule and the radio rule in Interactions.
  - It never closes or resets an open dialog, and never closes an open Filters sheet or Lineage rail.
  - It changes the lineage canvas only as the open-canvas rules in Motion and effects allow. Otherwise the canvas changes only when a column is opened, Trace impact is pressed, the person's own tag action is confirmed, or the person's own role change cancels a trace.
  - A refresh, whether from an event or from the person's own action, follows the rule for searches the person did not trigger in Latest request wins: it announces only a changed count, and then only once.
  - The Glossary screen and the Admin screen apply events as set out in Interactions. A point-in-time view never refreshes.
- **Applied-event marker.**
  - On the Catalog, Glossary and Admin screens, the `main` element carries `data-synced-seq`: the seq of the latest activity event the screen has received. It is set once every refresh, canvas update, re-render or role update that event calls for has painted, or at once when the event affects nothing on screen.
  - When a refresh was superseded by the person's newer state, the marker takes that event's seq only once the newer state's response has painted.
  - On a live screen the attribute is absent until the first event arrives. In a point-in-time view it reads the as-of seq from the start and never changes.
- **Messages stay until the next action (DP-72).**
  - A success or error message an action put in Activity or Dialog status stays until the same person's next action writes a new one. Status polls, event refreshes and asset reloads never clear or change it.
  - A dialog reopened during its exit transition stays open, with focus on its first field. A close from before the reopen never hides it.
- **Sweeps follow time zero (DP-44).** Sweep progress depends only on the time since time zero.
  - The canvas may be torn down and rebuilt mid-sweep: by crossing 768 pixels in either direction, by opening or closing the Lineage rail, or by the Filters sheet. The rebuilt nodes and edges then show at once the lit state, drawn state and count that time zero implies, and the sweep finishes on its original schedule.
  - Any of these cancels the current sweep:
    - choosing another focus column;
    - a canvas redraw after the person's own tag action;
    - starting another trace while one is running;
    - the person's own role change to a role that may not trace (DP-95).

    After a cancel, no node lights and no edge turns drawn for the old response, the counter never advances for it, and Trace summary never receives its summary.
  - Trace summary receives each completed trace's summary exactly once.
- **Closed panels are unavailable (DP-26).**
  - A closed Filters sheet or Lineage rail is hidden and inert at every viewport: nothing inside it is visible, focusable or in the accessibility tree.
  - Moving a panel off-screen is not closing it.
  - Its controls become reachable only after it opens.
- **Keyboard reach.** Every action in this brief works by keyboard alone, using the keys in Interactions.

## Backend

### API (DP-01, DP-03, DP-06, DP-07, DP-11, DP-12, DP-14, DP-15, DP-19, DP-22, DP-29, DP-32, DP-34, DP-39, DP-40, DP-49, DP-52, DP-53, DP-55, DP-58, DP-62, DP-73, DP-74, DP-77, DP-78, DP-81, DP-86, DP-92, DP-99)

#### Conventions

**Content types and errors.**
- All bodies are `application/json; charset=utf-8`, except the verify upload (`multipart/form-data`), the evidence download and the activity stream.
- Unknown body keys are ignored.
- Every error uses one shape: `{"error":{"code":"<code>","message":"<copy>"}}`.
- Validation errors use code `validation` and the message `Check the highlighted fields.`, unless an endpoint gives another message. They add `"fields":{"<field>":"<copy>"}`.
- A "write" is any POST, PATCH, PUT or DELETE under `/api`.
- Every character limit counts Unicode code points (DP-80).
- Ids in paths are percent-encoded UTF-8.

**Error precedence (whole API).** The first matching rule decides the response, and a request answered by any error changes nothing:
1. 413 oversized body
2. 401 `unauthenticated`, including a session ended by sign-out or password reset
3. an idempotent replay, which returns its stored response, or 409 `idempotency_in_progress`, before any later check
4. 404 unknown resource, and 405 on the audit log routes
5. 403 `forbidden`
6. 409 state conflicts
7. 422 validation
8. 503 dependency

Sign-in (POST /api/session) has no session, so rule 2 doesn't apply to it. Its own order is: 413, then 401 `invalid_credentials`.

Where an endpoint lists several 409 codes, its entry gives their order. Some examples:
- An Analyst who PATCHes an unknown term gets 404.
- A Steward who PATCHes a term with a stale revision and an empty name gets 409 `term_stale`.
- A Steward who reuses an Idempotency-Key with a changed body and an over-long reason gets 409 `idempotency_conflict`.
- A Steward demoted to Analyst who resends a stored verify with the same key and body gets the stored response. With a changed body, the same person gets 403 `forbidden`.
- A person whose password was reset gets 401 for an exact replay from the old session.
- An Admin resetting their own password with an 8-character password gets 409 `own_password`.

Endpoint entries below name only their own extra errors.

**Shared error bodies.**
- 401: `{"error":{"code":"unauthenticated","message":"Sign in to continue."}}`
- 403: `{"error":{"code":"forbidden","message":"You don't have permission to do that."}}`
- 404: `{"error":{"code":"not_found","message":"Not found."}}`
- 405: `{"error":{"code":"method_not_allowed","message":"This action isn't allowed."}}`
- 413: `{"error":{"code":"payload_too_large","message":"Request body is too large."}}`
- 409 bad move: `{"error":{"code":"invalid_transition","message":"Cannot move <asset id> from <from> to <to>."}}`

**Published object shapes.** These are the exact keys, the same for every role. Masking changes values, never keys.
- **user ref:** `id`, `name`
- **term ref:** `id`, `name`
- **asset summary:**
  - `id`, `kind` (`table`, `view` or `dashboard`), `description`, `owner` (user ref), `state` (`draft`, `verified` or `deprecated`)
  - `terms` (term refs in name order)
  - `tagged_column_count`, `pii_column_count`, `confidential_column_count`
  - `deprecated_upstream` (asset id or null)
- **column:**
  - `id` (`<asset id>.<name>`), `name`, `data_type`
  - `direct_tags`, `effective_tags`, `suppressed_tags`
  - `tag_sources`: an object with one key per effective tag, each value a list of column ids
  - `samples` (strings), and `masked` (true when any sample was replaced)
- **asset detail:** asset summary plus:
  - `verified_at`: server time or null
  - `evidence`: null, or `filename`, `content_type`, `size_bytes`, `sha256` (lowercase hex of the stored bytes), `uploaded_at` and `uploaded_by` (user ref)
  - `deprecation`: null, or `reason`, `at` and `by` (user ref)
  - `columns`: the asset's columns, in registration order
- **term:** `id`, `name`, `definition`, `revision`, and `assets` (a list of `{"id"}` sorted by asset id)
- **audit row:** `id`, `seq`, `at`, `actor` (user ref), `actor_role`, `action`, `target` (`{"type","id"}`), `before`, `after`, `prev_hash`, `hash`
- **graph column:** `id`, `asset` (the asset id as a plain string, for example `"src.members"`), `direct_tags`, `effective_tags`, `suppressed_tags`, `tag_sources`

**Tag order.** Every tag list is sorted alphabetically (`Confidential` before `PII`). This covers:
- `direct_tags`, `effective_tags` and `suppressed_tags`;
- lineage `focus_tags`, `carried_tags` and `sealed_tags`;
- the tag lists in audit `before` and `after`;
- the space-separated `data-tags` on canvas nodes.

`tag_sources` and `focus_tag_sources` keys follow the same order, and each value is sorted by column id.

**Times.** All server times are UTC strings formatted `YYYY-MM-DDTHH:mm:ss.sssZ`, always with exactly three fractional digits.

**Point-in-time parameters (DP-86).** These reads accept `as_of_seq` or `as_of_time`:
- GET /api/search
- GET /api/assets/{id}
- GET /api/columns/{id}
- GET /api/graph
- GET /api/columns/{id}/lineage

The parameters:
- `as_of_seq` is a whole number from 0 to the latest seq, both allowed.
- `as_of_time` is an RFC 3339 instant with `Z` or an explicit offset (for example `2026-09-30T23:59:59-05:00`), with optional fractional seconds. It resolves as set out in Business rules.

Errors:
- A malformed or out-of-range `as_of_seq` answers 422 `fields.as_of_seq` `Use an audit seq from 0 to the latest seq.`
- A malformed `as_of_time`, or one without an offset, answers 422 `fields.as_of_time` `Use an RFC 3339 time with an offset.`
- Sending both answers 422 `fields.as_of_time` `Send as_of_seq or as_of_time, not both.`
- An id unknown in the current catalog answers 404 before any of these checks. With a valid parameter, an asset or column absent at the resolved seq answers 404.

Response shape when either parameter is given:
- Search, graph and lineage bodies gain a top-level `"as_of_seq":<k>` (the resolved seq) and `"as_of_at"` (the `at` of audit row k, or null when k is 0).
- The asset read answers `{"as_of_seq":<k>,"as_of_at":…,"asset":asset detail}`.
- The column read answers `{"as_of_seq":<k>,"as_of_at":…,"column":<the usual column read body>}`.

Without either parameter, the shapes are unchanged.

**Idempotency (DP-06, DP-55: verify, deprecate and bulk tag apply).**
- POST /api/assets/{id}/verify, POST /api/assets/{id}/deprecate and POST /api/assets/{id}/tags/bulk accept an optional `Idempotency-Key` header of 1 to 100 letters, digits, `-` or `_`.
- A malformed key answers 422 `fields.idempotency_key` `Use 1 to 100 letters, digits, hyphens or underscores.`
- A key is scoped to the caller, the route and the asset.
- The fingerprint is:
  - for deprecate, the reason;
  - for verify, the evidence bytes, filename and note;
  - for bulk tag apply, the tag and the column list in the order sent.
- **While running.** While a request under a key is still running, every other request under that key, with the same fingerprint or a different one, answers 409 `{"error":{"code":"idempotency_in_progress","message":"A request with this Idempotency-Key is still in progress. Retry shortly."}}` and has no effect.
- **After success.** Only successful responses are stored, and stored responses never expire.
  - A replay with the same key and fingerprint, from a live session, returns the stored status and body, whatever the caller's role or the asset's state now. It creates no object, no tag change, no audit row and no email.
  - The same key with a different fingerprint answers 409 `{"error":{"code":"idempotency_conflict","message":"This Idempotency-Key was already used with a different request."}}`.
- **After failure.** A failed request frees its key, so a retry under the same key runs again.

#### Session, health and status

- **POST /api/session** (anyone).
  - Request: `{"email","password"}`.
  - 200 `{"user":{"id","name","email","role"}}`. The response sets cookie `strata_session` (HttpOnly, SameSite=Lax, Path=/) to a new session.
  - If the request carried a valid `strata_session`, that earlier session is ended in the same request.
  - A wrong or unknown email or password answers 401 `{"error":{"code":"invalid_credentials","message":"Email or password is incorrect."}}`.
- **GET /api/session** (signed in): 200 with the same body, with the role as it stands now.
- **DELETE /api/session** (signed in): 204, and the cookie is cleared.
- **GET /api/health** (anyone): 200 `{"status":"ok"}`.
- **GET /api/status** (signed in): 200 `{"evidence":"up"|"down","mail":"up"|"down","queued_notices":<int>}`.

#### Activity stream

**GET /api/events** (signed in).
- The cursor is optional. It is the `Last-Event-ID` header, or the `after_seq` query parameter; the header wins when both are sent.
- 200 with `Content-Type: text/event-stream; charset=utf-8` and `Cache-Control: no-store`.
- Each visible committed audit row becomes one event, followed by a blank line:

  ```
  id: <seq>
  event: change
  data: {"seq":<seq>,"action":"<action>","target":{"type":"<type>","id":"<id>"}}
  ```

- `data` is one line of JSON with exactly those keys. It never carries an actor, `before`, `after`, a hash or a sample.
- A comment line `: keep-alive` is sent at least every 15 seconds.
- A cursor that isn't a non-negative whole number answers 422 `fields.after_seq` `Use a non-negative whole number.`, whichever source it came from.
- Visibility, resume and fan-out are set out in Business rules.

#### Search and reads

**GET /api/search** (signed in).
- Optional query parameters: `q`, `tag`, `owner` (user id), `state`, `term` (term id), plus the point-in-time parameters.
- 200 `{"results":[asset summary],"total":<int>,"facets":{"tag":[…],"owner":[…],"state":[…],"term":[…]}}`. Each facet entry is `{"value","label","count"}`.
- 422 messages:
  - `fields.q`: `Search text must be 200 characters or fewer.`
  - `fields.tag`: `Tag must be PII or Confidential.`
  - `fields.state`: `State must be draft, verified or deprecated.`
- Facet order:
  - `tag` always lists `PII`, then `Confidential`.
  - `state` always lists `draft`, `verified`, `deprecated`, even at count 0.
  - `owner` (label = the person's name) and `term` (label = the term name) list every value with a count above 0, plus any selected value, in name order.
- Results are sorted by asset id, at most 100. `total` is the full match count.

**Single reads** (signed in, each accepting the point-in-time parameters).
- **GET /api/assets/{id}:** 200 asset detail.
- **GET /api/columns/{id}:** 200 column, plus `asset` `{"id","state"}`.
- **GET /api/graph:** 200 `{"columns":[graph column],"edges":[{"id","from","to","transform"}]}`. Columns are sorted by id, and edges by `from`, then `to`.

**GET /api/columns/{id}/lineage** (signed in).
- Query parameters: `direction` (`downstream` or `upstream`), plus the point-in-time parameters.
- 200 with the lineage body below.
- 422 `fields.direction` `Direction must be downstream or upstream.`

**Lineage body.**

```
{"focus":"<column id>","direction":"downstream"|"upstream","focus_tags":[…],
 "focus_tag_sources":{"<tag>":[…]},
 "reached":[{"column","asset","hop","carried_tags":[…],"sealed_tags":[…],"tag_sources":{"<tag>":[…]}}],
 "edges":[{"from","to","transform","kind":"flow"|"seal"|"cycle"}],
 "cycles":[{"from","to"}],
 "assets":{"<asset id>":{"state","deprecated_upstream"}},
 "totals":{"columns","hops","cycles"},
 "truncated":false,
 "limits":{"max_hops":12,"max_columns":500},
 "summary":"<summary>"}
```

- `focus_tags` are the focus column's effective tags, and `focus_tag_sources` is the focus column's `tag_sources`.
- `reached` leaves out the focus and is sorted by hop, then column id. In each entry, `column` is the column id and `asset` is its asset's id, both as plain strings. Each entry's `tag_sources` is that column's own `tag_sources`, keeping only the keys in its `carried_tags`.
- `assets` (DP-99) has one key for the focus column's asset and for every asset in `reached`, in ascending asset id order. Each value holds that asset's `state` and `deprecated_upstream` (asset id or null), exactly as an asset read at the same moment or seq would report them.
- `totals.columns` is the length of `reached`. `totals.hops` is its largest hop, or 0 when `reached` is empty. `totals.cycles` is the length of `cycles`.
- `<summary>` is `Trace complete. Columns reached: <columns>. Hops: <hops>. Cycles: <cycles>.`. When `truncated` is true, ` Truncated at the 12-hop or 500-column limit.` is appended after one space.

#### Tags and suppressions (Steward, Admin)

- **POST /api/columns/{id}/tags.**
  - Request: `{"tag"}`.
  - 201 `{"column":column,"changed_columns":[ids]}`.
  - 409 errors, in this order:
    1. `tag_exists`: `<column id> already carries <tag> directly.`
    2. `tag_suppressed`: `<tag> is suppressed on <column id>; lift the suppression first.`
  - 422 `fields.tag` as in search.
  - Audit action: `tag.add`.
- **DELETE /api/columns/{id}/tags/{tag}.**
  - 200 `{"column":column,"changed_columns":[ids],"still_reaching":<int>}`, where `still_reaching` is defined in Business rules.
  - 409 errors, in this order:
    1. `tag_inherited`: `<tag> on <column id> is inherited; withdraw it at its source.`
    2. `tag_absent`: `<column id> does not carry <tag>.`
  - 422 `fields.tag` as in search.
  - Audit action: `tag.withdraw`.
- **POST /api/columns/{id}/suppressions.**
  - Request: `{"tag","justification"}`.
  - 201, with the same shape as tag add.
  - 409 errors, in this order:
    1. `suppression_exists`: `<tag> is already suppressed on <column id>.` This covers any recorded suppression, active or dormant.
    2. `tag_not_inherited`: `<tag> on <column id> is not inherited; withdraw it instead.` The column holds the tag directly.
    3. `tag_absent`: as above, when the tag doesn't currently reach the column.
  - 422 errors:
    - `fields.tag` as in search;
    - `fields.justification`: `Give a justification of 10 to 500 characters.`, applied to the trimmed justification.
  - Audit action: `tag.suppress`.
- **DELETE /api/columns/{id}/suppressions/{tag}.**
  - 200, with the same shape as tag add.
  - 404 when no such suppression is recorded.
  - Audit action: `tag.unsuppress`.

**POST /api/assets/{id}/tags/bulk (DP-06).**
- Request: `{"tag","columns":[column ids]}`. Takes an optional `Idempotency-Key`.
- 200:

  ```
  {"batch_id":"<uuid>"|null,"tag":"<tag>","requested":<n>,"applied":<a>,
   "results":[{"column","outcome":"applied"|"already_present"|"refused","error":null|{"code","message"}}],
   "columns":[column],"changed_columns":[ids]}
  ```

  - `results` has one entry per requested column, in request order.
  - `outcome` is `already_present` when the column already carries the tag directly. It is `refused` when a single tag add on that column would answer 409 `tag_suppressed`; its `error` then holds that code and message. Otherwise it is `applied`, and the column gains the tag directly. `error` is null for every outcome but `refused`.
  - Rows that can take the tag get it, whatever the other rows' outcomes.
  - `applied` counts the applied rows. `batch_id` is a fresh lowercase random UUID when `applied` is at least 1, and null otherwise.
  - `columns` holds the column body of every requested column after the request, in request order.
- 422 errors:
  - `fields.tag` as in search;
  - `fields.columns`: `Select 1 to 200 columns of this asset.` when the list is empty, longer than 200 or names a column twice;
  - `fields["columns[<i>]"]`: `Unknown column of this asset.`, for each entry that isn't a column of this asset, where `<i>` is the zero-based index.
- 409 after rule 3: `idempotency_conflict`.
- Audit action: `tag.bulk_add`, written only when `applied` is at least 1.

**POST /api/tag-batches/{batch id}/undo (DP-06).**
- Request: `{}`.
- 200 `{"batch_id","restored":<a>,"columns":[column],"changed_columns":[ids]}`. `restored` is the number of rows the batch applied, and `columns` holds each of those columns after the undo, in the batch's request order.
- 404 for an unknown batch id.
- 409 errors, in this order:
  1. `{"error":{"code":"batch_undone","message":"This bulk tag apply was already undone."}}`
  2. `{"error":{"code":"batch_changed","message":"Undo refused: <column id> changed after the bulk apply."}}`, naming the lowest column id that changed, as defined in Business rules.
- Audit action: `tag.bulk_undo`.

#### Certification and evidence

**POST /api/assets/{id}/verify** (Steward, Admin).
- Multipart fields: `evidence` (file) and `note` (optional).
- 200 asset detail.
- 409 errors, in this order, after rule 3:
  1. `idempotency_conflict`
  2. `invalid_transition`
  3. `{"error":{"code":"upstream_deprecated","message":"Verification blocked: upstream <asset id> is deprecated."}}`
- 422 `fields.evidence` holds one message: the first of these that applies.
  1. The file is missing or 0 bytes: `Attach a PDF or text sign-off.`
  2. The file is over 5,000,000 bytes: `Evidence must be 5,000,000 bytes or smaller.`
  3. The filename is over 200 code points: `Evidence filename must be 200 characters or fewer.`
  4. The filename contains `/` or `\`: `Evidence filename cannot contain / or \.`
  5. The filename contains any character from U+0000 to U+001F, or U+007F: `Evidence filename cannot contain control characters.`
  6. The filename ends in neither `.pdf` nor `.txt`, compared without regard to letter case: `Evidence must be a .pdf or .txt file.`
- 422 `fields.note`: `Note must be 500 characters or fewer.`
- 503 `{"error":{"code":"evidence_unavailable","message":"Evidence storage is unreachable. The asset stays in draft; try again shortly."}}`.
- The commit-time rechecks in Business rules may also answer 401, 403 or 409.
- Audit action: `certification.verify`.

**GET and HEAD /api/assets/{id}/evidence** (Admin, Steward, Analyst).

*Headers.*
- Every response with status 200, 206, 304 or 416 carries:
  - `Cache-Control: private, no-store`
- 200 and 206 also carry:
  - `Accept-Ranges: bytes`
  - `ETag: "<sha256>"`
  - `Content-Disposition: attachment; filename="<ASCII fallback>"; filename*=UTF-8''<encoded original>`.
- The ASCII fallback is the original filename with each non-ASCII code point, each `"` and each `\` replaced by one `_`. For example, `Sign-off – Privacy Officer №3.pdf` falls back to `Sign-off _ Privacy Officer _3.pdf`.
- The encoded original is the filename's UTF-8 bytes, with every byte outside the RFC 8187 attr-char set percent-encoded as `%` and two uppercase hex digits. The attr-char set is the ASCII letters, the digits and ``! # $ & + - . ^ _ ` | ~``. So a space becomes `%20` and `(` becomes `%28`.
- A 200 also carries `Content-Type` (as stored) and `Content-Length`.

*Evaluation, in this order.*
1. **If-None-Match.** The value is `*` or a comma-separated list of entity tags. If `*` is sent, or any listed tag equals the ETag by weak comparison (a `W/` prefix is ignored on both sides), the answer is 304 with `ETag` and no body. This is decided from the recorded `sha256`, before the store is contacted.
2. **Range syntax.** A `Range` header is used only when it is the unit `bytes`, written in any letter case, followed by `=` and 1 to 10 comma-separated specs. Each spec has the form `a-b`, `a-` or `-n`, and spaces around commas are allowed. The header is ignored, and the answer is 200 with the full body, when it has:
   - more than 10 specs;
   - another unit;
   - a spec `a-b` with a greater than b;
   - any other malformed spec.
3. **If-Range.** When `If-Range` is present, the Range is used only if its value is a strong entity tag exactly equal to the ETag. An HTTP-date, a weak tag or any other tag makes the Range ignored, and the answer is 200 with the full body.
4. **Resolving specs.**
   - A spec whose first byte is at or past the end of the file, or `-0`, is unsatisfiable and is dropped.
   - An end past the file is clamped to its last byte.
   - A suffix longer than the file covers the whole file.
   - If no spec remains, the answer is 416 with `Content-Range: bytes */<size>` and `{"error":{"code":"range_not_satisfiable","message":"Requested range is outside the evidence file."}}`. This is decided from the record.
5. **Merging (DP-53).** The remaining ranges are sorted by first byte. A range whose first byte is at most one past the previous range's last byte is merged into it.
6. **One merged range** answers 206 with `Content-Type` as stored, `Content-Range: bytes <a>-<b>/<size>`, a matching `Content-Length` and exactly those bytes.
7. **Two or more merged ranges** answer 206 with `Content-Type: multipart/byteranges; boundary=<boundary>`, where `<boundary>` is a fresh random token of 16 to 70 letters and digits. The body is, for each merged range in order:

   ```
   --<boundary>\r\n
   Content-Type: <stored type>\r\n
   Content-Range: bytes <a>-<b>/<size>\r\n
   \r\n
   <those bytes>\r\n
   ```

   then `--<boundary>--\r\n`. `Content-Length` is the exact body length.

*Other cases.*
- HEAD answers exactly the status and headers GET would, with no body.
- 404 when the asset has no evidence.
- 503 `evidence_unavailable` when a 200 or 206 needs the store and the store is unreachable.
- Audit action: `evidence.download`, on GET 200 and 206 only.

For example, `bytes=0-99,50-149,300-` on a 5,000,000-byte file answers two parts, `0-149` and `300-4999999`. `BYTES=0-0,0-0` answers a single-part 206 for byte 0.

**POST /api/assets/{id}/deprecate** (Steward, Admin).
- Request: `{"reason"}`.
- 200 `{"asset":asset detail,"notices_queued":<int>,"queued_notices":<int>}`. `notices_queued` is this deprecation's count, and `queued_notices` is the database's unsent count after commit.
- 409 errors, in this order, after rule 3:
  1. `idempotency_conflict`
  2. `invalid_transition`
- 422 `fields.reason`: `Give a reason of 1 to 500 characters.`
- Audit action: `certification.deprecate`.

**POST /api/assets/{id}/reinstate** (Admin).
- Request: `{}`.
- 200 `{"asset":asset detail,"notices_cancelled":<int>,"queued_notices":<int>}`.
- 409 `invalid_transition`.
- Audit action: `certification.reinstate`.

#### Ingestion (Steward, Admin)

**POST /api/assets.**
- Request: `{"id","kind","description","owner_id","columns":[{"name","data_type","samples"}]}`.
- 201 asset detail.
- 409 `{"error":{"code":"asset_exists","message":"<asset id> is already registered."}}`.
- 422, per field, under the rules in Business rules:
  - `fields.id`: `Use schema.table in lowercase letters, digits and underscores.`
  - `fields.kind`: `Kind must be table, view or dashboard.`
  - `fields.description`: `Use 1 to 500 characters.`
  - `fields.owner_id`: `Unknown user.`
  - `fields.columns`: `Give 1 to 200 columns with unique names.`
  - `fields["columns[<i>]"]`: `Check this column's name, type and samples.`
- Audit action: `asset.register`.

**POST /api/lineage/edges.**
- Request: `{"edges":[{"from","to","transform"}]}`.
- 201 `{"edges":[{"id","from","to","transform"}],"changed_columns":[ids]}`.
- 409 `{"error":{"code":"edge_exists","message":"An edge from <from> to <to> already exists."}}`, naming the conflicting entry with the lowest index.
- 422 errors:
  - `fields.edges`: `Send 1 to 1,000 edges.`
  - Per entry, where `<i>` is the zero-based batch index:
    - `fields["edges[<i>].from"]` or `fields["edges[<i>].to"]`: `Unknown column.`, once for each unknown end.
    - `fields["edges[<i>].to"]`: `An edge cannot point to its own column.`
    - `fields["edges[<i>].transform"]`: `Transform must be one of copy, rename, cast, filter, join, concat, hash, aggregate.`
- Audit action: `lineage.add`.

**DELETE /api/lineage/edges/{edge id}.**
- 200 `{"changed_columns":[ids]}`.
- Audit action: `lineage.remove`.

#### Glossary

- **GET /api/terms** (signed in): 200 `{"terms":[term]}` in glossary order.
- **POST /api/terms** (Steward, Admin).
  - Request: `{"name","definition"}`.
  - 201 `{"term":term}` with `revision` 1.
  - 409 `{"error":{"code":"term_exists","message":"A term named <existing name> already exists."}}`.
  - 422 errors:
    - `fields.name`: `Use 1 to 80 characters.`
    - `fields.definition`: `Use 1 to 1,000 characters.`
  - Audit action: `term.create`.
- **PATCH /api/terms/{id}** (Steward, Admin).
  - Request: `{"revision","name"?,"definition"?}`.
  - 200 `{"term":term}`.
  - 409 errors, in this order:
    1. `{"error":{"code":"term_stale","message":"This term changed since you opened it. Reload and try again."}}`
    2. `term_exists`
  - 422 errors:
    - `fields.revision`: `Send the revision you edited.` when the revision is missing or not a positive whole number;
    - `fields.name` and `fields.definition` as in POST.
  - Audit action: `term.update`.
- **POST /api/assets/{id}/terms** (Steward, Admin).
  - Request: `{"term_id"}`.
  - 200 asset detail.
  - 409 `{"error":{"code":"term_linked","message":"<term name> is already linked."}}`.
  - 422 `fields.term_id`: `Unknown term.`
  - Audit action: `term.link`.
- **DELETE /api/assets/{id}/terms/{term id}** (Steward, Admin).
  - 200 asset detail.
  - 404 when the term is not linked.
  - Audit action: `term.unlink`.

#### Users and audit (Admin)

- **GET /api/users:** 200 `{"users":[{"id","name","email","role"}]}` in name order.
- **POST /api/users.**
  - Request: `{"name","email","role","password"}`.
  - 201 `{"user":{…}}`.
  - 409 `{"error":{"code":"email_exists","message":"That email is already in use."}}`.
  - 422 errors:
    - `fields.name`: `Use 1 to 80 characters without control characters.` The name is trimmed. It may not contain any character from U+0000 to U+001F, or U+007F.
    - `fields.password`: `Use at least 12 characters.`
    - `fields.role`: `Role must be Admin, Steward, Analyst or Viewer.`
    - `fields.email`: `Enter a valid email address.`
  - Audit action: `user.create`.
- **PATCH /api/users/{id}.**
  - Request: exactly one of `{"role"}` or `{"password"}`.
  - A role change answers 200 `{"user":{…}}`.
  - A password reset answers 200 `{"user":{…},"sessions_ended":<int>}`.
  - 409 errors:
    - `{"error":{"code":"own_role","message":"You can't change your own role."}}`
    - `{"error":{"code":"own_password","message":"You can't reset your own password here."}}`
  - 422 errors:
    - `fields.role`: `Send either a role or a password.` when both or neither are sent;
    - `fields.role` as in POST for an unknown role;
    - `fields.password` as in POST.
  - Audit actions: `user.role_change` and `user.password_reset`.
- **GET /api/audit.**
  - Query: `limit` (1 to 500, both allowed, default 100) and optional `before_seq` (a positive whole number).
  - 200 `{"rows":[audit row],"total":<int>,"next_before_seq":<int>|null}`.
    - `rows` are the rows with `seq` below `before_seq` (all rows when it is absent), newest first, at most `limit` of them.
    - `next_before_seq` is the `seq` of the last row returned. It is null when no row was returned, or when the last row returned has `seq` 1.
    - `total` counts all rows at the moment of answering.
  - 422 errors:
    - `fields.limit`: `Use a whole number from 1 to 500.`
    - `fields.before_seq`: `Use a positive whole number.`
- **GET /api/audit/chain.** 200 `{"intact":<bool>,"checked_through":<int>,"first_broken_seq":<int>|null}`, as set out in Business rules.
- **Writes on the logs** (anyone): PUT, PATCH or DELETE on `/api/audit`, `/api/audit/chain` or `/api/audit/{id}`, and POST on `/api/audit` or `/api/audit/chain`, answer 405 for every role, Admin included, at precedence rule 4.

`changed_columns` is always a sorted list of column ids, as defined in Business rules.

### Business rules (DP-01, DP-02, DP-03, DP-06, DP-07, DP-09, DP-10, DP-12, DP-14, DP-15, DP-16, DP-19, DP-23, DP-30, DP-32, DP-33, DP-34, DP-35, DP-36, DP-39, DP-40, DP-50, DP-54, DP-55, DP-58, DP-59, DP-61, DP-62, DP-65, DP-73, DP-74, DP-77, DP-78, DP-79, DP-80, DP-82, DP-84, DP-86, DP-88)

#### Access and sessions

**Roles (DP-02).**
- Each endpoint's allowed roles are the ones API names. Any other signed-in role gets the 403 `forbidden`.
- Evidence download is the one read a Viewer is refused.
- Trace impact is offered only to Stewards and Admins; the lineage read itself is open to every signed-in role.
- A role is read from the database on every request, so a role change applies to the person's next request. Precedence rule 3 still holds: an exact idempotent replay from a live session returns its stored response.
- A refused request changes nothing, stores nothing and writes no audit row. For example, an Analyst replaying a Steward's verify request under a new key gets 403; the asset stays draft and no object is stored.

**Sessions (DP-01).**
- A session token is at least 128 bits of randomness. The database stores only its SHA-256, so no cookie value appears in any table.
- Passwords are stored only as salted scrypt or Argon2id hashes.
- Signing in always creates a new session and ends the one the request carried, if any.

**Authority at commit (DP-09).**
- Every write reads its actor's session and role again inside its committing transaction, at its place in the commit order.
- If the session has ended by then, the write answers 401 `unauthenticated`. If the role no longer allows the action, it answers 403 `forbidden`.
- Either way nothing commits. A verify deletes its stored object before answering, and no evidence record or audit row remains.
- So a write that races a role change or password reset of its own actor ends in one of two serial outcomes:
  - the write commits first, with its audit seq below the role change's or reset's;
  - or the write is refused.

**Password reset (DP-07).** One transaction does all of this:
1. replaces the person's password hash;
2. deletes every session that person holds;
3. writes one `user.password_reset` row.

Then:
- The old password answers 401 `invalid_credentials`, and the new one signs in.
- Every request from an ended session answers 401 `unauthenticated`, an exact Idempotency-Key replay included.
- Each of that person's open activity streams ends within 5 seconds.
- `sessions_ended` is the number of sessions deleted.

#### Graph writes and derived state

**One commit order.**
- Every request that writes an audit row takes its place in one commit order shared across all instances. That covers every write in API, plus each delivered evidence download.
- Its state change, the recompute of everything derived from it, and its audit row commit together at that place.
- Nothing a request did is visible to others before it commits, and a rolled-back request leaves nothing.

**Pass-through and reach (DP-30).**
- `copy`, `rename`, `cast`, `filter`, `join` and `concat` edges are pass-through. `hash` and `aggregate` edges pass nothing on.
- A tag held by column u **reaches** column v when both of these hold:
  - a path of pass-through edges leads from u to v;
  - no column on that path after u (v included) suppresses that tag.

**Effective tags and sources (DP-32, DP-35).**
- A column's effective tags are its direct tags, plus every tag held directly by some column that reaches it.
- Inherited tags are the effective tags that are not direct.
- `tag_sources[<tag>]` lists the columns that hold the tag directly and either are this column or reach it. A source appears once, even when cycles give it many paths.
- Effective tags, tag sources, masking, counts and facets are always the fixed result of the committed direct tags, suppressions and edges. They never depend on the order of past edits.
- Withdrawing a direct tag removes the inherited copy only from columns that no other holder of that tag still reaches. A tag that only a cycle kept alive disappears.
- **`still_reaching`** in a withdrawal reply is the number of columns, other than the withdrawn column, that held the withdrawn tag as an effective tag with the withdrawn column among its sources just before the withdrawal, and still hold that tag as an effective tag just after it.
- `changed_columns` lists, sorted by id, every column whose `effective_tags`, `suppressed_tags` or `tag_sources` changed in that request.

**Suppression (DP-34).** A suppression is recorded for one column and one tag, with a justification, the actor and the server time.
- It can be created only while the tag reaches the column as an inherited tag.
- **Active.** While the tag would otherwise reach the column, the tag is not among that column's effective tags and does not flow on from it.
- **Dormant.** While the tag no longer reaches the column, the suppression stays recorded. It applies again as soon as the tag returns.
- It ends only through the lift endpoint.
- A column never holds a direct tag and a suppression of the same tag at once:
  - adding that tag directly answers 409 `tag_suppressed`, and a bulk apply reports that row as `refused`;
  - suppressing a direct tag answers 409 `tag_not_inherited`.
- Masking, counts, facets, search and lineage all follow the suppressed result.

**Bulk tag apply and undo (DP-06).**
- A bulk apply is one request with one place in the commit order. Each row's outcome is decided against the state committed before it, and the applied rows gain the tag directly together.
- **The batch.** A bulk apply that applies at least one row records a batch: its id, its tag, its applied columns, and each applied column's direct tags just before the apply.
- **Undo** restores, in one request, each applied column's direct tags to exactly the recorded list. It writes one `tag.bulk_undo` row. A batch can be undone once.
- **Changed after the batch.** A column of the batch has changed when any committed row after the batch's own row is a `tag.add`, `tag.withdraw`, `tag.suppress`, `tag.unsuppress`, `tag.bulk_add` or `tag.bulk_undo` that changed that column's direct tags or suppressed tags. This covers changes by anyone, the batch's own actor included. If any applied column has changed, the undo answers 409 `batch_changed`, naming the lowest such column id, and changes nothing.
- An undo racing another tag write on one of its columns ends in a serial outcome: the undo commits first, or it is refused with `batch_changed`.
- The undo's `changed_columns` and recompute follow the same rules as any graph write.

**Derived counts and facets (DP-16, DP-33).**
- Per asset:
  - `tagged_column_count` is the number of columns with any effective tag;
  - `pii_column_count` is the number with effective PII;
  - `confidential_column_count` is the number with effective Confidential.
- An asset carries a tag when at least one of its columns has it as an effective tag.
- **Facet counts.** A facet group's count for a value is the number of assets that match all of these:
  - the query;
  - every selected filter of the other groups;
  - that value.

  The group's own selection is left out. The results list applies every filter.
- **What a write updates.** A write's response, and every read that commits after it, reflects the write in all of these at once:
  - effective tags and tag sources;
  - per-asset counts;
  - facet counts;
  - lineage `focus_tags`, `focus_tag_sources`, `carried_tags`, `sealed_tags`, `tag_sources` and `assets`;
  - masked samples for every role.

**Scale (DP-78).** With up to 5,000 columns and 10,000 edges registered:
- every tag, bulk tag, undo, suppression and edge write, including a 1,000-edge batch, answers within 2 seconds;
- every lineage read answers within 2 seconds;
- every search answers within 1 second.

#### Concurrent writes and their single outcomes (DP-36)

Every race ends exactly as if the requests had run one at a time in commit order. Each request's audit row is written only if it committed, and at its place in that order. After any race:
- stored effective tags, `tag_sources`, counts and facets equal a fresh recompute;
- each response's `changed_columns` is exactly the difference its own request made to the state that the writes committed before it left.

In particular:

- **Same tag, same column.**
  - Of simultaneous identical tag adds, exactly one answers 201; the rest answer 409 `tag_exists`.
  - Of identical withdrawals, exactly one answers 200; the rest answer 409 `tag_absent`.
  - Of identical suppressions, exactly one answers 201; the rest answer 409 `suppression_exists`.
  - A single tag add racing a bulk apply that names the same column and tag: whichever commits second sees the tag already present (409 `tag_exists`, or the row's outcome `already_present`).
- **Same tag, two upstream columns feeding one downstream column.**
  - Two Stewards adding or withdrawing that tag on the two upstream columns both succeed, and the downstream column's tags and sources afterwards equal the recompute.
  - For example, simultaneous withdrawals of PII on `src.members.ssn` and `src.claims_legacy.member_ssn` both answer 200. The first to commit lists the three downstream SSN columns in `changed_columns` because their sources shrink, and reports `still_reaching` 3. The second lists them because they lose PII, and reports `still_reaching` 0.
- **Suppression against the source withdrawal.** A suppression racing a withdrawal of the only source of that tag ends in one of two ways:
  - the suppression commits first and is then left dormant;
  - the withdrawal commits first and the suppression answers 409 `tag_absent`.
- **Verify against upstream changes and against its actor's role.** These follow the verify rules below and DP-09.
- **Term rename against a link of that term.**
  - Both commit in a serial order, and the link's response names the term by its name at the link's commit.
  - Right after both, the asset's `terms`, search and the term facet show the new name.
- **Two edits of one term.**
  - Two PATCHes at the same revision: exactly one answers 200, and the other 409 `term_stale`.
  - A rename racing a create, or another rename, to a conflicting name: exactly one succeeds, and the other answers 409 `term_exists`.
- **Registrations and edge batches (DP-79).**
  - Of simultaneous registrations of the same asset id, exactly one answers 201; the rest answer 409 `asset_exists`. There is exactly one `asset.register` row.
  - Of simultaneous edge batches that share an ordered pair, each pair is stored once. A batch that commits after another batch stored one of its pairs stores none of its entries. It answers 409 `edge_exists`, naming its lowest-index entry that conflicts with the state committed before it.

#### Search, masking and lineage

**Search matching (DP-15).**
- `q` is trimmed; an empty `q` is no filter.
- A match is a case-insensitive substring of any of these:
  - the asset id;
  - its description;
  - any of its column names;
  - the current name of any term linked to it.
- Every character of `q` matches only itself. `%`, `_`, `\`, quotes and semicolons have no special meaning. For example, with the seed data at start, `q=%` returns no results, and `q=100%_match` returns no results and changes nothing.
- Filters combine with AND. An unknown owner or term id yields no results.
- A `q` longer than 200 code points after trimming is refused, as listed in API.
- A search answers within one second.

**Masking (DP-23).**
- Masking is decided on the server, per request, from effective tags and the caller's role.
- A masked sample is replaced by the exact string `[masked]` before the response is built. The raw value never leaves the server for a masked role, in any response.
- No cache or shared state carries one caller's view into another's response.
- The graph, lineage, audit, bulk-reply `results` and activity-stream responses carry no samples. Column bodies in any reply are masked by the same rule.

| Column's effective tags | Admin | Steward | Analyst | Viewer |
|---|---|---|---|---|
| none | raw | raw | raw | raw |
| Confidential only | raw | raw | raw | `[masked]` |
| PII (with or without Confidential) | raw | raw | `[masked]` | `[masked]` |

**Lineage traversal (DP-39, DP-40).**
- **Direction and order.**
  - Downstream follows edges from source to target. Upstream follows them in reverse.
  - The traversal is breadth-first from the focus. Each column is visited at most once, at its shortest hop, and columns within a hop are processed by column id.
- **`carried_tags`.**
  - Downstream: the focus's effective tags that reach the column, treating the focus as their holder.
  - Upstream: the column's effective tags that reach the focus, treating the column as their holder.
- **`sealed_tags`.**
  - Downstream: the focus's effective tags that the column suppresses and that would reach it from the focus if it didn't.
  - Upstream: the tags whose suppression on that column is active.
- **`edges`** lists, once each, every traversed edge whose ends are both the focus or reached columns.
- **Walking an edge.** Walking an edge in the traversal direction takes the traversal from column u to column v. Downstream, u is the edge's source and v its target. Upstream, u is the target and v the source.
- **`kind`.** An edge's `kind` is `cycle` when both of these hold:
  - v is the focus, or was reached at a hop no later than u's;
  - some path, walked in the traversal direction, leads from v back to u.

  Otherwise `kind` is `seal` for hash and aggregate edges and `flow` for the rest.
- In both directions, `edges` and `cycles` give the edge's real source as `from` and its real target as `to`.
- Each cycle edge appears once in `cycles`, and its target is never revisited.
- **Bounds.**
  - Columns at hop 12 are included; the traversal never reaches past hop 12.
  - The 500-column bound counts entries of `reached` only; the focus is not counted.
  - The traversal first finds every column of a hop, then adds them to `reached` in ascending column id. When adding a column would make `reached` longer than 500, that column and every later one are left out.
  - `truncated` is true when either bound left reachable columns out.
- Every lineage response answers within two seconds.

#### Point in time

**Point-in-time reads (DP-86).**
- With a resolved seq k, a read answers exactly what the same read returned right after audit row k committed. k = 0 is the seeded first-run state.
- **Resolving `as_of_time`.** It resolves to the largest seq whose `at` is at or before that instant. That is 0 before the first row, and the latest seq for a future instant. Instants are compared as moments in time, so `2026-09-30T23:59:59-05:00` equals `2026-10-01T04:59:59Z`.
- **What k covers.** Every fact that can change is taken as of k:
  - the assets and columns registered by then, and the edges then;
  - direct tags and suppressions (bulk applies and undos included), with dormant suppressions applying exactly as they did then;
  - effective tags, `tag_sources`, counts and facets;
  - lineage `carried_tags`, `sealed_tags`, `tag_sources`, `assets` and edge kinds;
  - state, `verified_at`, evidence metadata, `deprecation` and `deprecated_upstream`;
  - term names, and asset `terms` sorted by those names;
  - search matching on term names as of k, and facet labels and order.
- Every derived value comes from the same single rules as the live catalog.
- Owners, descriptions, column types and samples never change after registration.
- Samples are masked by the caller's **current** role, using the effective tags as of k.
- An asset registered after k is absent from search and answers 404.

**Business time (DP-88).**
- Strata's business time zone is America/Chicago.
- A business wall time converts to an instant with the UTC offset in force in Chicago at that wall time, on that date:
  - **Repeated time.** A wall time that occurs twice in the November fall-back hour takes the earlier offset, -05:00.
  - **Skipped time.** A wall time skipped by the March spring-forward moves forward by the length of the gap. For example, `2026-03-08T02:30:00` becomes `2026-03-08T03:30:00-05:00`.
- So, for example:

  | Wall time | Sent as |
  |---|---|
  | `2026-09-30T23:59:59` | `2026-09-30T23:59:59-05:00` |
  | `2026-12-31T23:59:59` | `2026-12-31T23:59:59-06:00` |
  | `2026-11-01T01:30:00` | `2026-11-01T01:30:00-05:00` |

#### Certification

**Certification state machine (DP-61).** Every legal move writes one audit row, with its move time taken from the server clock.

| From \ move | verify | deprecate | reinstate |
|---|---|---|---|
| draft | → verified (evidence confirmed, no deprecated upstream at check and at commit, actor still allowed at commit) | → deprecated | 409 `invalid_transition` |
| verified | 409 `invalid_transition` | → deprecated | 409 `invalid_transition` |
| deprecated | 409 `invalid_transition` | 409 `invalid_transition` | → draft (Admin only) |

**Asset lineage and deprecation (DP-59).**
- Asset B is downstream of asset A when any column edge runs from a column of A to a column of B. "Transitive" follows that relation over any number of hops.
- An asset is never its own transitive downstream or upstream, even when a lineage cycle leads back to it. A deprecated asset therefore:
  - never shows a warning naming itself;
  - never appears in its own notices;
  - adds nothing to its own `notices_queued`.
- The nearest deprecated upstream is the deprecated transitive upstream asset with the fewest asset-level hops; ties go to the lower asset id. Every asset that has one reports it in `deprecated_upstream` and shows the DP-59 warning.
- A verified asset whose upstream is deprecated later stays verified and shows the warning.

**Verify order (DP-49, DP-58).**
1. The precedence checks run, including the 409s in the order API gives.
2. The whole body is received, the evidence acceptance rules are applied, and the SHA-256 of the evidence bytes is computed.
3. The evidence is stored, and the store must confirm the write within 10 seconds.
4. In the committing transaction, at its place in the commit order, the server checks again, in this order:
   1. the session and role (DP-09);
   2. the asset is still draft;
   3. no transitive upstream is deprecated.
5. Only then do the verified state, `verified_at`, the evidence record and the audit row commit together.

**When verification fails after the upload (DP-50).**
- A recheck failure answers 401 or 403 under DP-09, 409 `invalid_transition` when the asset is no longer draft, and otherwise 409 `upstream_deprecated` naming the nearest deprecated upstream.
- In every case the stored object is deleted before the response, and no evidence record or audit row remains.
- An asset is verified exactly when its confirmed evidence object exists with a matching `sha256`. No half-verified state is ever visible.
- A failed, refused or interrupted upload leaves the asset in draft, with no evidence record, no audit row and no object. This includes a client that drops the connection partway through the body.

**Serial outcomes across assets.** A verify of asset B may race either of these:
- a deprecation of one of B's transitive upstream assets A;
- an edge write that makes a deprecated asset an upstream of B.

It always ends in one of two ways:
- B is verified, with `verified_at` no later than A's `deprecation.at`, and with its `certification.verify` audit `seq` below the deprecation's (or the edge write's);
- B is refused with 409 `upstream_deprecated`, with nothing stored.

**Same-asset concurrency (DP-62).**
- Of simultaneous verifies of one asset under different keys, or with no key, exactly one succeeds. The others answer 409 `invalid_transition` and leave no object. Under one shared key, DP-55 decides instead.
- Of simultaneous deprecations of one asset, exactly one succeeds. The others answer 409 `invalid_transition`, and only the winner queues notices.
- A verify and a deprecate racing on the same draft asset end in one of two ways:
  - the verify commits first, then the deprecation makes the legal verified → deprecated move: both succeed, with the verify's `seq` below the deprecation's;
  - the deprecation commits first, and the verify answers 409 `invalid_transition` with its object deleted.

**Evidence acceptance (DP-49).**
- The checks run in the order listed in API. Extensions are compared without regard to letter case.
- The server decides the stored type from the accepted extension: `application/pdf` for `.pdf`, and `text/plain; charset=utf-8` for `.txt`. This type is the object's content type in the store and the record's `content_type`.
- A UTF-8 byte-order mark at the start of a `.txt` is allowed and stored as sent.
- The file is 1 to 5,000,000 bytes (5,000,000 allowed).
- The filename is at most 200 code points (200 allowed). It is stored exactly as sent.
- The note is at most 500 code points (500 allowed).

**Evidence access logging (DP-54).**
- Before sending the status line of a GET that will answer 200 or 206, the server:
  1. confirms the object exists in the store, answering 503 with no row if it can't;
  2. commits the `evidence.download` row;
  3. only then starts streaming.
- A client that aborts mid-body keeps its row.
- The server releases that download's store stream and database connection within 5 seconds. No app session is left active or idle in a transaction.

**Deprecate.**
- The reason is trimmed and must be 1 to 500 code points (500 allowed).
- A deprecation creates one deprecation event and queues one notice per distinct owner of a transitive downstream asset. `notices_queued` is that count.

**Reinstate (DP-61, DP-65).**
- Reinstating moves an asset from deprecated to draft and clears `deprecation`, `evidence` and `verified_at`. The stored object stays in the store.
- Downstream warnings and verification blocks that depended on this asset lift in the same request.
- In the same transaction, every notice of this asset's deprecation events that is unsent and not under an unexpired claim becomes cancelled. A cancelled notice is never sent and no longer counts in `queued_notices`.
- `notices_cancelled` is the number cancelled.
- A later deprecation creates a new event, with new notices and new Message-IDs.

**Notice states.**
- A notice moves from queued to claimed, under a 30-second lease.
- A claimed notice ends as sent, or returns to queued after a failed attempt or an expired lease.
- A queued notice becomes cancelled through reinstatement.
- A sent or cancelled notice never changes again.

#### Audit log

**Which requests write rows (DP-10).**
- Every successful write in API writes exactly one row with its listed action, and so does each evidence GET that answers 200 or 206.
- These write no row:
  - sign-in and sign-out;
  - refused, failed or replayed requests;
  - a bulk apply that applied no row;
  - setting a role to the one a person already has;
  - evidence responses 304, 403, 404, 416 and 503;
  - every HEAD request;
  - the chain check and every read.
- The seed writes no rows.

**Sequence and time (DP-12).**
- `seq` is 1 for the first row ever written and goes up by exactly 1 in commit order, with no gaps. A rolled-back request consumes no `seq`.
- `at` is the server time in the published format. That exact string is hashed, stored and returned. `at` never decreases as `seq` increases.

**Chain (DP-12).**
- `prev_hash` is the previous row's `hash`. Row 1 uses 64 `0` characters.
- `hash` is the lowercase hex SHA-256 of a UTF-8 string made of three parts:
  - `prev_hash`;
  - a newline;
  - the canonical JSON of the payload `{"seq","at","actor_id","actor_role","action","target_type","target_id","before","after"}`, where `actor_id` is the actor's user id.
- Canonical JSON follows RFC 8785:
  - object keys are sorted by UTF-16 code units;
  - there is no whitespace between tokens;
  - strings and numbers are written as standard JSON serialisation writes them.
- Payloads hold only strings, whole numbers, booleans, null, arrays and objects.
- No two rows share a `prev_hash`.
- Rows are never edited or deleted, by any route or any database role.

**Chain check (DP-12).** The server walks the stored rows of the `audit_log` table (Services) in ascending `seq`, recomputing from the stored column values. The expected seq starts at 1 and goes up by one per row. For each row, it checks in this order:
1. its `seq` equals the expected seq;
2. its `prev_hash` equals the previous row's `hash` (64 `0` characters for the first);
3. its `hash` equals the recomputed hash.

The result:
- When every row passes: `intact` is true, `checked_through` is the latest seq (0 for an empty log), and `first_broken_seq` is null.
- At the first failure: `intact` is false. `first_broken_seq` is the expected seq when check 1 fails, and otherwise the row's `seq`. `checked_through` is `first_broken_seq` − 1.

The check answers within 2 seconds for 10,000 rows and writes nothing.

**Audit row contents.**

| action | target type, id | before | after |
|---|---|---|---|
| `tag.add`, `tag.withdraw` | `column`, column id | `{"direct_tags":[…]}` | `{"direct_tags":[…]}` |
| `tag.suppress` | `column`, column id | `{"suppressed_tags":[…]}` | `{"suppressed_tags":[…],"justification":"<text>"}` |
| `tag.unsuppress` | `column`, column id | `{"suppressed_tags":[…]}` | `{"suppressed_tags":[…]}` |
| `tag.bulk_add` | `asset`, asset id | `{"direct_tags":{"<column id>":[…]}}` for each applied column | `{"batch_id":"<uuid>","tag":"<tag>","direct_tags":{"<column id>":[…]}}` for each applied column |
| `tag.bulk_undo` | `asset`, asset id | `{"batch_id":"<uuid>","direct_tags":{"<column id>":[…]}}` | `{"direct_tags":{"<column id>":[…]}}` |
| `certification.verify` | `asset`, asset id | `{"state":"draft"}` | `{"state":"verified","evidence_sha256":"<sha256>","filename":"<filename>","content_type":"<type>","size_bytes":<n>}` |
| `certification.deprecate` | `asset`, asset id | `{"state":"<from>"}` | `{"state":"deprecated","reason":"<reason>"}` |
| `certification.reinstate` | `asset`, asset id | `{"state":"deprecated"}` | `{"state":"draft","notices_cancelled":<n>}` |
| `evidence.download` | `asset`, asset id | null | `{"evidence_sha256":"<sha256>","range":"<ranges>"}`, or `"range":null` for a 200 |
| `asset.register` | `asset`, asset id | null | `{"kind","owner_id","columns":[names]}` |
| `lineage.add` | `lineage`, id of the batch's first new edge | null | `{"edges":[{"id","from","to","transform"}]}` |
| `lineage.remove` | `lineage`, edge id | `{"edge":{"id","from","to","transform"}}` | null |
| `term.create` | `term`, term id | null | `{"name","definition","revision":1}` |
| `term.update` | `term`, term id | changed fields and old `revision` | changed fields and new `revision` |
| `term.link`, `term.unlink` | `asset`, asset id | `{"terms":[term ids]}` | `{"terms":[term ids]}` |
| `user.create` | `user`, user id | null | `{"name","email","role"}` |
| `user.role_change` | `user`, user id | `{"role"}` | `{"role"}` |
| `user.password_reset` | `user`, user id | null | `{"sessions_ended":<n>}` |

- For `evidence.download`, `<ranges>` is the merged inclusive byte ranges sent, each written `<a>-<b>` and joined by commas in order. For example, `bytes=1024-` on a 4,096-byte file logs `"1024-4095"`, `bytes=0-99,50-149,300-` on a 5,000,000-byte file logs `"0-149,300-4999999"`, and an If-Range mismatch logs `null`.
- For a verify, `verified_at`, `uploaded_at` and `uploaded_by` are the row's `at` and actor.
- For a deprecation, `deprecation.at` and `deprecation.by` are the row's `at` and actor.
- No row holds a password, a hash of one, a session token or a sample value.

**Audit paging (DP-14).** Paging with `before_seq` is stable while rows are being written. Rows written after a page was fetched always have higher `seq` values. Following `next_before_seq` from any first page until it is null therefore yields every row up to that first page's newest row exactly once.

#### Activity stream (DP-81, DP-82, DP-84)

- **Visibility.**
  - An Admin's stream carries every row.
  - Every other role's stream carries every row except `user.*` rows and `evidence.download`. The one exception is a `user.role_change` whose target is the caller.
  - Each stream decides each row's visibility from its own caller's role as it stood right after that row committed. That role comes from the role history the audit log records, not from the caller's role now.
  - So a promotion to Admin widens visibility from the promotion row onward, and a demotion narrows it from the demotion row onward. Each of these rows is visible as the caller's own role change.
  - Live delivery and resumed delivery make identical decisions, and rows are never back-filled.
- **Example.** Omar (Analyst) is promoted to Admin (row p), Morgan creates a user (c1), Omar is demoted to Analyst (d), Morgan creates a user (c2), and Dana tags a column (t). Then:
  - Omar's already-open stream delivers exactly p, c1, d and t;
  - a new stream with `after_seq` = p − 1 delivers the same four rows.
- **Per-stream state.** Each stream keeps its own cursor, its own backlog position and its own visibility decisions. Streams on one instance never share them.
- **Resume.**
  - With a cursor, the stream first sends every visible row with `seq` above the cursor, in ascending `seq`, then live rows. No row is repeated or skipped at the switch, even while writes commit during the catch-up.
  - Without a cursor, it sends only rows with `seq` above the highest committed `seq` at the moment the stream was accepted.
- **Order.** A stream never sends `seq` n after a higher `seq`.
- **Fan-out.** A row committed through any Strata instance on the same database reaches the open streams of every instance within 2 seconds.
- **Ending.** A stream ends within 5 seconds after its session is deleted, by sign-out or password reset.

#### Glossary terms and asset registration

**Glossary terms (DP-73, DP-74).**
- **Names.**
  - A name is stored trimmed, with each run of internal whitespace collapsed to one space. Case is kept.
  - Two names conflict when they are equal after that and after case-folding. A term may change only the case of its own name.
- **Revisions.** `revision` starts at 1 and goes up by 1 with every accepted PATCH. A PATCH whose `revision` isn't the current one answers 409 `term_stale`, with no change and no audit row.
- **Renames.** A rename takes effect in the same request everywhere the term shows:
  - every asset's `terms`, re-sorted by the new name;
  - search matching: the old name no longer matches through the term, and the new one does;
  - the term facet's label and position;
  - the glossary order.
- Links and URLs use term ids and keep working.
- **Name order** (for terms, owners and users) compares case-folded names, with ties broken by id. Glossary order is the name order of terms.

**Asset registration (DP-77).**
- `id` is `<schema>.<table>`. Each part uses lowercase ASCII letters, digits and `_` and starts with a letter. The whole id is at most 120 characters.
- `kind` is `table`, `view` or `dashboard`.
- `description` is 1 to 500 code points.
- `owner_id` names an existing user.
- There are 1 to 200 columns with unique names.
- **Column names.** A column name is 1 to 60 code points. It may hold letters of any script, combining marks, decimal digits and `_`, and it starts with a letter. It holds no uppercase or titlecase letter. For example, `member_ssn`, `адрес_улица` and `नाम_सदस्य` are accepted, and `Member` and `2nd_line` are refused.
- Each column has a `data_type` of 1 to 40 code points and 0 to 5 samples of at most 200 code points each.
- The column id is `<asset id>.<column name>`.
- The asset starts in draft, with no tags, suppressions, terms or edges.

**Edges (DP-78).**
- `transform` is one of `copy`, `rename`, `cast`, `filter`, `join`, `concat`, `hash`, `aggregate`.
- Both ends must exist, and an edge never joins a column to itself.
- There is at most one edge per ordered pair of columns. Cycles are allowed.
- A batch holds 1 to 1,000 entries and is all or nothing.
- An entry conflicts when its ordered pair already exists, or when the same pair appears at a lower index in the same batch.
- A 422 lists every failing entry.

**Character limits (DP-80).**
- Every character limit in this brief counts Unicode code points after any published trimming, never UTF-16 units or bytes, and both bounds are allowed. This covers ids, column names, descriptions, data types, samples, term names and definitions, reasons, notes, justifications, filenames, user names and `q`.
- Text is compared and counted as sent, with no normalisation. So `é` written as `e` plus a combining accent counts as two code points.
- For example:
  - a description of 500 copies of `𝔸` is accepted, and 501 are refused;
  - a sample of 200 copies of `🧾` is accepted and returned unchanged, and 201 are refused;
  - a `q` of 200 decomposed `é` (400 code points) is refused, while 200 precomposed `é` are accepted.

**Time.** Audit `at`, `verified_at`, `uploaded_at`, `deprecation.at`, and suppression times all come from the server clock. Any time the client sends is ignored.

### Services (DP-50, DP-63, DP-64, DP-65, DP-66, DP-67, DP-68, DP-82)

**Postgres.** Postgres is the system of record. It holds:
- users, password hashes and hashed session tokens;
- assets, columns and samples;
- edges with their transform kinds;
- direct tags, suppressions with justifications, tag batches, and the derived effective tags and tag sources;
- certification state, evidence records and deprecation events;
- notices, with their claims and their sent or cancelled state;
- terms, revisions and links;
- idempotency records, with their in-progress state;
- audit rows.

**The audit table.** Audit rows live in a table named `audit_log`, one row per audit row, with at least these columns:

| column | holds |
|---|---|
| `seq` | the audit seq, a whole number |
| `at` | the `at` string exactly as hashed and returned, as text |
| `actor_id`, `actor_role`, `action`, `target_type`, `target_id` | the payload values of the same names, as text |
| `before`, `after` | the payload values, as `json` or `jsonb` |
| `prev_hash`, `hash` | 64-character lowercase hex text |

**Append-only protection.**
- A database trigger or rule on the audit table makes any UPDATE, DELETE or TRUNCATE fail, even when the app's own database role issues it.
- The protection is made only of user-defined triggers and rules on the table itself, never of privileges, row-level security or a second copy of the data.
- So the table's owning role can lift it on purpose with `ALTER TABLE audit_log DISABLE TRIGGER USER` and `ALTER TABLE audit_log DISABLE RULE <name>` for each of its rules, then restore it with the matching ENABLE statements. Checks of the chain check use exactly this to edit or delete a row, so the chain check must report what it then finds in the stored columns.

Committed rows reach other instances through database notifications or polling, either within the fan-out bound. Schema and seed are applied idempotently on every serve. Even when two instances start against the same database at the same moment, the seed is written exactly once.

**MinIO (evidence).**
- Each verification stores one object at key `evidence/<asset id>/<evidence id>`, where `<evidence id>` is a fresh random UUID.
- The object holds exactly the uploaded bytes and carries the server-decided content type. The original filename and the SHA-256 live in Postgres.
- Downloads stream only through the app's evidence route. No presigned URL, bucket name or key ever appears in a response, page or email.
- A missing bucket is created at start.

**Mailpit (notices, DP-63, DP-64).** For each deprecation event, every distinct owner of a transitive downstream asset gets exactly one plain-text email.

*Headers.*
- **From:** the value of `MAIL_FROM`, which is `Strata Catalog <strata@quarrystone.test>`.
- **To:** exactly one recipient: the owner's name as an RFC 5322 display name, then the owner's email in angle brackets.
  - A name made only of ASCII letters, digits and spaces is written as is.
  - A name with any other ASCII character is written as a quoted string, with `"` and `\` escaped.
  - A name with any non-ASCII character is written as standard RFC 2047 UTF-8 encoded-words.
  - The relay therefore parses one recipient whose name equals the stored name exactly.
- **Subject:** `Strata: <deprecated asset id> was deprecated`
- **Message-ID:** `<notice-<notice id>@strata.quarrystone.test>`, where `<notice id>` is the notice's lowercase random UUID, assigned when it is queued.
- **Content-Type:** `text/plain; charset=utf-8`.
- No other header carries text a person entered.

*Body.*
1. the line `<deprecated asset id> was deprecated by <actor name>.`
2. the line `Reason: <reason>`. Each line break in the reason becomes one space here. The stored reason and the audit row keep it as sent.
3. a blank line
4. the line `Your affected assets:`
5. for each of the owner's affected assets, in asset id order, two lines:
   - `- <asset id> - nearest deprecated upstream: <asset id>`
   - two spaces, then `Columns: `, then the reached column names, sorted and joined by `, ` (a comma and one space)

   The reached columns are that asset's columns that are downstream of any column of the deprecated asset.

An email never contains a sample value, an evidence key, an evidence filename, or a bucket name or address.

For example, an owner named `O'Brien, Ngozi "Zee" Ångström` is parsed by Mailpit with that exact name. A reason `Retired after the claims migration.` produces the body line `Reason: Retired after the claims migration.`. A reason typed on two lines, `Retired after the claims migration.` then `Use stg.claims_2026 instead.`, produces the single body line `Reason: Retired after the claims migration. Use stg.claims_2026 instead.`, and the message still has exactly the headers listed above and one recipient.

**Notice delivery (DP-68).**
- Notices are written in the deprecation's transaction.
- Every instance runs a sender that tries every 5 seconds.
- A sender claims a notice with a 30-second lease recorded in Postgres:
  - While a claim is unexpired, no other instance sends that notice.
  - A failed attempt releases the claim at once.
  - An expired claim, such as one left by a crashed or stalled claimant, can be taken by any instance.
  - A notice is marked sent as soon as the relay accepts it. It is never sent twice, and a cancelled notice is never sent.
- A notice queued by an instance that can't reach the relay goes out from any instance on the same database that can.
- **Timing.** With a reachable relay, a notice arrives within 10 seconds of the deprecation, or within 10 seconds of the relay becoming reachable. A notice held by an abandoned claim arrives within 10 seconds of that claim expiring.
- `queued_notices` counts unsent, uncancelled notices across all instances.
- **When notices can be cancelled.** While no instance on the database can reach the relay, queued notices stay queued and unclaimed for as long as that lasts, so a reinstatement cancels all of them. Where some instance on the database can reach the relay, a reinstatement cancels only the notices not yet claimed or sent at its commit. The cancellation journey is therefore observed on an instance whose database no relay-reachable instance shares: `notices_cancelled`, `queued_notices` and the Mailpit inbox show the result, and a later deprecation there queues fresh notices.

**Health probes (DP-66).** The server probes the evidence store and the mail relay every 5 seconds and reports the latest result in GET /api/status. A verify or download that fails because the store is unreachable marks evidence `down` at once.

**When a service is unreachable (DP-67).**
- **Evidence store:**
  - Verify answers the 503 from API, and the asset stays draft.
  - Evidence downloads that need the bytes answer 503 with the same body.
  - Everything else works.
- **Mail relay:** deprecation answers 200 and queues its notices.
- **Recovery.** When either service returns, whether it was down at boot or failed later, the next probe marks it up. Verification works again and queued notices go out within the delivery times above, with no restart.
- **How recovery is observed.** An instance's broken dependency is never brought back while it runs, so recovery is checked in two ways that need no restart:
  - a notice queued by an instance that can't reach the relay is sent by another instance on the same database that can, within the delivery times above;
  - each screen follows GET /api/status, so its banners appear and clear as the reported status changes.

  The rule that a service returning to the same instance is picked up by the next probe still applies.

### Seed data (DP-90)

On first serve against an empty database, the app writes exactly these records, and no audit rows. Every person, health plan, clinic and value below is invented, and "Lakeshore Mutual Health Plan" is a fictional customer.

**Users** (password `strata-seed-2026` for all):

| id | name | email | role |
|---|---|---|---|
| u-morgan | Morgan Ellery | morgan.ellery@lakeshore-health.test | Admin |
| u-dana | Dana Okafor | dana.okafor@lakeshore-health.test | Steward |
| u-rui | Rui Takahashi | rui.takahashi@lakeshore-health.test | Steward |
| u-lena | Lena Marsh | lena.marsh@lakeshore-health.test | Analyst |
| u-omar | Omar Haddad | omar.haddad@lakeshore-health.test | Analyst |
| u-sam | Sam Whitlock | sam.whitlock@lakeshore-health.test | Viewer |

**Terms** (all at revision 1):

| id | name | definition |
|---|---|---|
| t-claim | Claim | A request for payment for a covered service. |
| t-eligibility-span | Eligibility span | A continuous period of coverage for one member. |
| t-member | Member | A person enrolled in a Lakeshore health plan. |
| t-paid-amount | Paid amount | Dollars paid on a claim after adjustments. |
| t-provider | Provider | A clinician or facility that bills the plan. |
| t-risk-score | Risk score | Modelled likelihood of high-cost care in the next 12 months. |

**Assets.**
- Every asset is draft except `src.eligibility_2019`. That one is deprecated by u-morgan with reason `Replaced by the 2024 eligibility feed.` at first-run server time, with no notices and no audit row.
- No asset is verified, no evidence exists, no suppression is recorded and no tag batch exists.

| id | kind | owner | terms | description |
|---|---|---|---|---|
| src.members | table | u-dana | Member | Enrolled members, one row per member. |
| src.claims_legacy | table | u-dana | Claim | Extract from the retired claims system. |
| stg.member_claims | table | u-rui | Claim, Member | Claims joined to members for modelling. |
| scr.risk_scores | table | u-rui | Risk score | Member risk scores from the outreach model. |
| mart.claims_by_region | table | u-lena | Paid amount | Paid claims rolled up by 3-digit ZIP prefix. |
| mart.member_risk | table | u-lena | Member, Risk score | Members ranked by risk for outreach. |
| dash.claims_overview | dashboard | u-omar | Paid amount | Regional paid-claims dashboard. |
| dash.risk_outreach | dashboard | u-omar | Risk score | Outreach worklist dashboard. |
| src.eligibility_2019 | table | u-morgan | Eligibility span | Eligibility spans from the 2019 feed. |
| stg.eligibility_spans | table | u-rui | Eligibility span | Cleaned eligibility spans. |
| ref.providers | table | u-dana | Provider | Contracted providers. |

**Columns**, in registration order. "Edges in" are the column's upstream edges, written as `transform ← source column`.

| column id | type | direct | edges in | samples |
|---|---|---|---|---|
| src.members.member_id | integer | — | — | `100231`, `100232`, `100233` |
| src.members.ssn | text | PII | — | `900-11-2041`, `900-11-3378`, `900-11-4402` |
| src.members.full_name | text | PII | — | `Avery Quill`, `Jordan Pike`, `Rowan Vale` |
| src.members.date_of_birth | date | PII | — | `1961-04-12`, `1978-09-30`, `1990-01-17` |
| src.members.zip_code | text | Confidential | — | `53202`, `53704`, `54301` |
| src.claims_legacy.claim_id | text | — | — | `CL-0007781`, `CL-0007782`, `CL-0007783` |
| src.claims_legacy.member_ssn | text | PII | — | `900-11-2041`, `900-11-3378`, `900-11-4402` |
| src.claims_legacy.diagnosis_code | text | Confidential | — | `E11.9`, `I10`, `J45.909` |
| src.claims_legacy.paid_amount | numeric | — | — | `412.50`, `1280.00`, `96.75` |
| src.claims_legacy.service_date | date | — | — | `2026-03-02`, `2026-03-09`, `2026-03-15` |
| stg.member_claims.claim_id | text | — | copy ← src.claims_legacy.claim_id | `CL-0007781`, `CL-0007782`, `CL-0007783` |
| stg.member_claims.member_ssn | text | — | join ← src.members.ssn; copy ← src.claims_legacy.member_ssn | `900-11-2041`, `900-11-3378`, `900-11-4402` |
| stg.member_claims.diagnosis_code | text | — | copy ← src.claims_legacy.diagnosis_code | `E11.9`, `I10`, `J45.909` |
| stg.member_claims.paid_amount | numeric | — | cast ← src.claims_legacy.paid_amount | `412.50`, `1280.00`, `96.75` |
| stg.member_claims.zip_code | text | — | join ← src.members.zip_code | `53202`, `53704`, `54301` |
| stg.member_claims.risk_score | numeric | — | copy ← scr.risk_scores.risk_score | `0.82`, `0.41`, `0.67` |
| scr.risk_scores.member_key | text | — | hash ← stg.member_claims.member_ssn | `9f2c41d07ab3`, `4e81aa0c55d2`, `c03b7f19e6a4` |
| scr.risk_scores.risk_score | numeric | Confidential | aggregate ← stg.member_claims.paid_amount; copy ← stg.member_claims.risk_score | `0.82`, `0.41`, `0.67` |
| mart.claims_by_region.region_zip | text | — | cast ← stg.member_claims.zip_code | `532`, `537`, `543` |
| mart.claims_by_region.total_paid | numeric | — | aggregate ← stg.member_claims.paid_amount | `18240.25`, `9310.00`, `4402.75` |
| mart.claims_by_region.claim_count | integer | — | aggregate ← stg.member_claims.claim_id | `212`, `118`, `57` |
| mart.member_risk.member_key | text | — | copy ← scr.risk_scores.member_key | `9f2c41d07ab3`, `4e81aa0c55d2`, `c03b7f19e6a4` |
| mart.member_risk.member_ssn | text | — | copy ← stg.member_claims.member_ssn | `900-11-2041`, `900-11-3378`, `900-11-4402` |
| mart.member_risk.risk_score | numeric | — | copy ← scr.risk_scores.risk_score | `0.82`, `0.41`, `0.67` |
| dash.claims_overview.region | text | — | rename ← mart.claims_by_region.region_zip | `532`, `537`, `543` |
| dash.claims_overview.total_paid | numeric | — | copy ← mart.claims_by_region.total_paid | `18240.25`, `9310.00`, `4402.75` |
| dash.risk_outreach.member_ssn | text | — | copy ← mart.member_risk.member_ssn | `900-11-2041`, `900-11-3378`, `900-11-4402` |
| dash.risk_outreach.risk_score | numeric | — | copy ← mart.member_risk.risk_score | `0.82`, `0.41`, `0.67` |
| src.eligibility_2019.member_id | integer | — | — | `100231`, `100232`, `100233` |
| src.eligibility_2019.plan_code | text | — | — | `HMO-GOLD`, `PPO-SILVER`, `HMO-BRONZE` |
| src.eligibility_2019.coverage_start | date | — | — | `2019-01-01`, `2019-04-01`, `2019-07-01` |
| stg.eligibility_spans.member_id | integer | — | copy ← src.eligibility_2019.member_id | `100231`, `100232`, `100233` |
| stg.eligibility_spans.plan | text | — | rename ← src.eligibility_2019.plan_code | `HMO-GOLD`, `PPO-SILVER`, `HMO-BRONZE` |
| stg.eligibility_spans.coverage_start | date | — | cast ← src.eligibility_2019.coverage_start | `2019-01-01`, `2019-04-01`, `2019-07-01` |
| ref.providers.npi | text | — | — | `1003000126`, `1003000134`, `1003000142` |
| ref.providers.provider_name | text | — | — | `Northgate Family Clinic`, `Harbor Street Pediatrics`, `Linden Cardiology` |

The deliberate cycle is `scr.risk_scores.risk_score` ⇄ `stg.member_claims.risk_score`.

**Worked examples** (for example, with the seed data at start):

- **Counts per asset** (tagged / PII / Confidential):

  | asset | counts |
  |---|---|
  | src.members | 4/3/1 |
  | src.claims_legacy | 2/1/1 |
  | stg.member_claims | 4/1/3 |
  | scr.risk_scores | 1/0/1 |
  | mart.claims_by_region | 1/0/1 |
  | mart.member_risk | 2/1/1 |
  | dash.claims_overview | 1/0/1 |
  | dash.risk_outreach | 2/1/1 |
  | every other asset | 0/0/0 |

- **Tag facet with no filters:** PII 5, Confidential 8.
- **Tagging PII on `src.eligibility_2019.member_id`** gives it PII directly and `stg.eligibility_spans.member_id` PII by copy; both assets go to 1/1/0 and the no-filter PII facet rises to 7.
- **`q=risk&tag=PII`** returns 3 results: `dash.risk_outreach`, `mart.member_risk` and `stg.member_claims`. Its facets:
  - Tag: PII 3, Confidential 4
  - State: draft 3, verified 0, deprecated 0
  - Owner: Lena Marsh 1, Omar Haddad 1, Rui Takahashi 1
  - Term: Claim 1, Member 2, Risk score 2
- **Tag sources:**
  - `stg.member_claims.member_ssn`, `mart.member_risk.member_ssn` and `dash.risk_outreach.member_ssn` each have PII from `["src.claims_legacy.member_ssn","src.members.ssn"]`.
  - `stg.member_claims.risk_score` has Confidential from `["scr.risk_scores.risk_score"]`.
  - `scr.risk_scores.risk_score` has Confidential from `["scr.risk_scores.risk_score"]` only, despite the cycle.
  - `scr.risk_scores.member_key` and `mart.member_risk.member_key` have no tags.
- **Withdrawing PII on `src.members.ssn`** removes no downstream tag. Its `changed_columns` is `["dash.risk_outreach.member_ssn","mart.member_risk.member_ssn","src.members.ssn","stg.member_claims.member_ssn"]`, and its `still_reaching` is 3.
- **Then withdrawing PII on `src.claims_legacy.member_ssn`:**
  - removes PII from `stg.member_claims.member_ssn`, `mart.member_risk.member_ssn` and `dash.risk_outreach.member_ssn`, with `still_reaching` 0;
  - drops the no-filter PII facet to 1;
  - leaves `tag=PII` returning only `src.members`.
- **Withdrawing Confidential on `scr.risk_scores.risk_score`** removes it from all four risk score columns, with `still_reaching` 0.
- **Suppressing Confidential on `mart.claims_by_region.region_zip`**, with justification, for example, `Truncated to the 3-digit ZIP prefix under HIPAA Safe Harbor.`:
  - removes Confidential there and from `dash.claims_overview.region`;
  - takes both assets to 0/0/0;
  - drops the no-filter Confidential facet to 6;
  - lets Sam see those samples raw.
- **Suppressing PII on `stg.member_claims.member_ssn`:**
  - removes PII there and from `mart.member_risk.member_ssn` and `dash.risk_outreach.member_ssn`;
  - takes `stg.member_claims` to 3/0/3, `mart.member_risk` to 1/0/1 and `dash.risk_outreach` to 1/0/1;
  - drops the no-filter PII facet to 2;
  - lets Lena see those samples raw.

  Withdrawing both source tags afterwards leaves the suppression dormant, still listed in `suppressed_tags`. Re-adding either source tag brings it back into force.
- **After that suppression, the upstream trace of `mart.member_risk.member_ssn`** lists `stg.member_claims.member_ssn` at hop 1 with `carried_tags` `[]` and `sealed_tags` `["PII"]`, and `src.claims_legacy.member_ssn` and `src.members.ssn` at hop 2 with `carried_tags` `[]`. Its `focus_tags` is `[]`.
- **Suppressing Confidential on `stg.member_claims.risk_score`** removes it only there.
- **Bulk apply of Confidential on `src.claims_legacy`** to `["src.claims_legacy.claim_id","src.claims_legacy.diagnosis_code","src.claims_legacy.service_date"]` reports outcomes `applied`, `already_present`, `applied`, with `requested` 3 and `applied` 2. It gives `stg.member_claims.claim_id` Confidential by copy; `mart.claims_by_region.claim_count` stays untagged behind its aggregate edge. `src.claims_legacy` goes to 4/1/3. Undoing the batch returns every column to its earlier tags, with `restored` 2.
- **Downstream trace of `src.claims_legacy.member_ssn`** reaches 5 columns across 3 hops, with 0 cycles.
  - Hop 1: `stg.member_claims.member_ssn`. Hop 2: `mart.member_risk.member_ssn`, `scr.risk_scores.member_key`. Hop 3: `dash.risk_outreach.member_ssn`, `mart.member_risk.member_key`.
  - `scr.risk_scores.member_key` is reached by a seal edge and carries no tag.
  - After the member_ssn suppression above, the same trace shows `stg.member_claims.member_ssn` with `carried_tags` `[]` and `sealed_tags` `["PII"]`.
- **Downstream trace of `src.claims_legacy.paid_amount`** reaches 7 columns across 4 hops, with 1 cycle: the edge `stg.member_claims.risk_score` → `scr.risk_scores.risk_score`.
  - Hop 1: `stg.member_claims.paid_amount`.
  - Hop 2: `mart.claims_by_region.total_paid`, `scr.risk_scores.risk_score`.
  - Hop 3: `dash.claims_overview.total_paid`, `mart.member_risk.risk_score`, `stg.member_claims.risk_score`.
  - Hop 4: `dash.risk_outreach.risk_score`.
  - The `reached` entry for `stg.member_claims.paid_amount` is `{"column":"stg.member_claims.paid_amount","asset":"stg.member_claims","hop":1,"carried_tags":[],"sealed_tags":[],"tag_sources":{}}`.
  - Its `assets` map has keys `dash.claims_overview`, `dash.risk_outreach`, `mart.claims_by_region`, `mart.member_risk`, `scr.risk_scores`, `src.claims_legacy` and `stg.member_claims`, each `{"state":"draft","deprecated_upstream":null}`.
  - In the sweep, the cycle edge turns drawn when hop 3 begins lighting. The edge into `scr.risk_scores.risk_score` from `stg.member_claims.paid_amount` turns drawn when hop 2 does.
- **Downstream trace of `stg.member_claims.member_ssn`** has `focus_tag_sources` `{"PII":["src.claims_legacy.member_ssn","src.members.ssn"]}`, and its `mart.member_risk.member_ssn` entry has `tag_sources` `{"PII":["src.claims_legacy.member_ssn","src.members.ssn"]}`.
- **Upstream trace of `scr.risk_scores.risk_score`** reaches 3 columns across 2 hops, with 1 cycle.
  - Hop 1: `stg.member_claims.paid_amount` (by a seal edge) and `stg.member_claims.risk_score`.
  - Hop 2: `src.claims_legacy.paid_amount`.
  - The cycle edge is `scr.risk_scores.risk_score` → `stg.member_claims.risk_score`.
- **Upstream trace of `stg.eligibility_spans.plan`** has `assets` `{"src.eligibility_2019":{"state":"deprecated","deprecated_upstream":null},"stg.eligibility_spans":{"state":"draft","deprecated_upstream":"src.eligibility_2019"}}`.
- **Deprecations:**
  - Deprecating `src.claims_legacy` queues 3 notices: u-rui, u-lena and u-omar. Reinstating it before they are sent or claimed reports `notices_cancelled` 3.
  - Deprecating `stg.member_claims` queues 3 notices: u-rui (for `scr.risk_scores` only), u-lena and u-omar. `stg.member_claims` shows no warning of its own.
  - `stg.eligibility_spans` shows the warning for `src.eligibility_2019`, and verifying it is blocked.
- **Renaming `t-eligibility-span` to `Coverage period`** at revision 1 gives revision 2.
  - `q=coverage period` then returns `src.eligibility_2019` and `stg.eligibility_spans`.
  - A point-in-time read at any seq before the rename still shows `Eligibility span` as the term's name and facet label.
  - Creating a term named `claim` answers 409 `term_exists`.
- **Renaming `t-provider` to `Contracted provider for claims adjudication and network adequacy review`** moves it to glossary position 1, between Claim and Eligibility span.
- **The first state change after first boot** is audit row `seq` 1, with `prev_hash` of 64 `0` characters. Afterwards, `as_of_seq=0` still returns the seed catalog above, with `as_of_at` null.

## Technical requirements

### Deployment (DP-89)

- Node.js 22 with npm is available. Write the app in TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

  ```
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- GET /api/health answers as listed in API whenever the process is serving.
- Schema and seed apply idempotently on every serve, so a freshly emptied database is ready without a rebuild.
- Several instances may serve at once from the same build, each with its own environment and port. Besides the main instance, expect these:
  - one sharing the main database whose evidence store is unreachable;
  - one sharing the main database whose mail relay is unreachable;
  - one sharing the main database that can reach neither the evidence store nor the mail relay;
  - one on its own empty database whose mail relay is unreachable, so no instance can send its notices.

### Configuration and secrets (DP-91)

The app reads these at start. It never hard-codes them and never sends them to the browser:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`
- `MAIL_FROM`, set by the environment to the From line in Services and used as given
- `APP_PUBLIC_PORT`

`MAILPIT_URL` is for inspection only; the app does not need it.

### Server boundary (DP-28, DP-80, DP-83, DP-92)

- **Same site only.** A request from another site cannot change data.
- **Body limits.**
  - JSON bodies may be up to 1,000,000 bytes and multipart bodies up to 6,000,000 bytes, both limits allowed. Anything larger gets 413.
  - **JSON depth.** The top-level value is at depth 1. Each object or array nested inside another object or array is one level deeper; strings, numbers, booleans and null add no depth. A body whose deepest object or array is at depth 20 is accepted. Depth 21 or more answers 422 `{"error":{"code":"validation","message":"Request body is nested too deeply.","fields":{}}}`. For example, `{"a":[1]}` has depth 2.
- **What is served.** Only the built client assets and the API.
  - Source files and source maps of server code answer 404, as do `/.env`, `/run.json`, `/package.json`, lockfiles and any credential.
  - No response, page or email carries a credential, a database URL, a bucket name or an object key.
- **No outbound fetches.** The server never fetches a URL taken from a request or from stored data. It talks only to the configured Postgres, evidence store and mail relay.
- **Connections and streams.**
  - An instance holds at most 12 Postgres connections at any moment, however many event streams are open.
  - When a stream's client goes away, its connection use, timers and subscriptions are released within 5 seconds.
  - After repeated open-then-abandon cycles of streams or evidence downloads, no session of the app stays active or idle in a transaction, the instance's connection count returns to its earlier level within 5 seconds, and GET /api/health answers within one second.
- **Dependency outages at boot.** Postgres must be reachable. If the evidence store or the mail relay is unreachable at boot, the app still starts, serves, and recovers as stated in Services.

### Browser support and performance (DP-19, DP-40)

- Current Chromium, Firefox and WebKit, at 375x812 (touch), 768x1024 (touch) and 1280x800.
- The catalog is usable within three seconds of navigation.
- Search, lineage and graph writes answer within the limits in Business rules.
- A sweep completes within 1.8 seconds of its response.
- Live refreshes, open-canvas updates, held audit rows, role-change updates and session-ended redirects land within the times in Interactions, Motion and effects and Feedback states.

## Working rules

- IF-01 — `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and nothing else starts the app.
- IF-02 — `/app/THIRD_PARTY_NOTICES.md` names every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`), every font and the icon set, each with its licence.
- IF-03 — Every shipped package (as defined in IF-02) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, and fonts are under the SIL Open Font License 1.1.
- IF-04 — The app uses no datastore beyond the provided Postgres, MinIO and Mailpit: no SQLite, no Redis, no in-process store shared between instances, no files used as a database.
- IF-05 — The provided service configuration files and seeded development credentials stay unmodified.
- IF-06 — Fonts (Fraunces, IBM Plex Sans, IBM Plex Mono) and Lucide icons are bundled with the app, and the browser makes no request to any third-party origin.
- IF-07 — `package-lock.json` is committed at `/app` and matches `package.json`.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes on domain data, and no request-specific state held in module or process scope.
- Names follow this brief's domain terms: asset, column, edge, transform, direct tag, effective tag, suppression, tag source, tag batch, certification, evidence, deprecation event, notice, term, revision, steward, audit seq, activity stream, held rows, point in time, business time, sweep.
- Each of these domain rules is decided in exactly one place and reused everywhere it applies, including point-in-time reads and live refreshes:
  - reach and effective tags with suppression;
  - tag sources and remaining reach after a withdrawal;
  - bulk apply outcomes and the undo change check;
  - masking by role;
  - role permissions;
  - the certification state machine and its commit-time rechecks;
  - nearest deprecated upstream;
  - lineage traversal and its bounds;
  - derived counts and facet counts;
  - the audit chain payload and its check;
  - event visibility from role history;
  - term-name normalisation;
  - column-name rules;
  - evidence acceptance and conditional and range request evaluation;
  - notice state and header encoding;
  - business-time conversion and viewer-zone time formatting;
  - canvas pan and zoom placement;
  - sweep progress from time zero, and which events may change a drawn canvas and how.
- No abstraction has a single implementation, and there are no defensive checks for states the rules make impossible.
- Every error leaves the server in the one published error shape, built in one place, and the error precedence is applied in one place.
- The source has no dead, commented-out or unreachable code, and no feature beyond this brief.
- Schema, seed and the append-only rules on the audit log are declared once and applied idempotently on serve.
